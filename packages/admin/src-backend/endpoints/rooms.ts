/**
 * Live room inspector endpoints. Surfaces the running matchmaker's room
 * registry to the admin panel.
 *
 *   GET    /admin-api/rooms                                    → list every active room (driver query)
 *   GET    /admin-api/rooms/:roomId                            → inspect (clients + state + metadata)
 *   DELETE /admin-api/rooms/:roomId/clients/:sessionId         → kick a single client
 *   DELETE /admin-api/rooms/:roomId                            → dispose the room
 *
 * The two mutation endpoints go through `guard()` against the synthetic
 * `'rooms'` resource and are audit-logged via `database.audit.record()`.
 * Inspection lives behind `guard()` too — viewing live state is sensitive.
 *
 * Implementation note: the inspector calls into Room#getInspectorView()
 * and Room#kickClient() via the framework's existing `remoteRoomCall`
 * IPC, so the endpoints work in single-process AND multi-process (Redis
 * presence) deployments without further plumbing.
 */
import { createEndpoint, matchMaker, type Endpoint, type Room } from '@colyseus/core';
import { errorResponse, json } from '../http.js';
import { ipFromHeaders } from '../rate-limit.js';
import { guard, type EndpointContext } from './context.js';

const ROOMS_RESOURCE = 'rooms';

/** Summary returned by `GET /admin-api/rooms` — flat list for the panel's table view. */
interface RoomSummary {
  roomId: string;
  name: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  private: boolean;
  createdAt: string;
  /** Shorthand the panel sorts by — `Date.now() - createdAt`, ms. */
  elapsedTime: number;
  /** Optional process tag from the matchmaker listing — useful for multi-node. */
  processId?: string | null;
  publicAddress?: string | null;
}

export function listRoomsEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(`${ctx.apiPath}/${ROOMS_RESOURCE}`, { method: 'GET' }, async (reqCtx) => {
    const denied = await guard(ctx, reqCtx, 'list', ROOMS_RESOURCE);
    if (denied) { return denied; }

    const rows: any[] = await matchMaker.query({});
    const summaries: RoomSummary[] = rows.map((r) => ({
      roomId: r.roomId,
      name: r.name,
      clients: r.clients,
      maxClients: r.maxClients,
      locked: r.locked ?? false,
      private: r.private ?? false,
      createdAt: new Date(r.createdAt).toISOString(),
      elapsedTime: Date.now() - new Date(r.createdAt).getTime(),
      processId: r.processId ?? null,
      publicAddress: r.publicAddress ?? null,
    }));
    return json(summaries);
  });
}

export function inspectRoomEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/:roomId`, { method: 'GET' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'read', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { roomId } = reqCtx.params as { roomId: string };
      try {
        // Method name is typed against Room so it resists rename without
        // a code change here. The view already includes `userEmail` per
        // client (read from `client.auth.email`) — no extra database
        // round-trip needed.
        const view = await matchMaker.remoteRoomCall<Room>(
          roomId, 'getInspectorView' as keyof Room,
        );
        return json(view);
      } catch (err: any) {
        ctx.logger?.warn?.({ err, roomId }, '[admin] room inspect failed');
        return errorResponse(404, `room '${roomId}' is not available`);
      }
    },
  );
}

export function kickClientEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/:roomId/clients/:sessionId`, { method: 'DELETE' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'update', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { roomId, sessionId } = reqCtx.params as { roomId: string; sessionId: string };
      try {
        await matchMaker.remoteRoomCall<Room>(roomId, 'kickClient' as keyof Room, [sessionId]);
        // Audit BEFORE returning so a long-running room-side leave hook
        // can't make us forget the operator who initiated the kick.
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'room.kick', resource: ROOMS_RESOURCE, targetId: roomId,
          payload: {
            sessionId,
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, roomId, sessionId }, '[admin] room kick failed');
        return errorResponse(404, `room '${roomId}' is not available`);
      }
    },
  );
}

export function disposeRoomEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/:roomId`, { method: 'DELETE' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'delete', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { roomId } = reqCtx.params as { roomId: string };
      try {
        // `disconnect()` returns a promise that resolves once every
        // client has actually closed — fire-and-forget here so the
        // admin response doesn't block on `onLeave` hooks finishing.
        void matchMaker.remoteRoomCall<Room>(roomId, 'disconnect' as keyof Room);
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'room.dispose', resource: ROOMS_RESOURCE, targetId: roomId,
          payload: {
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, roomId }, '[admin] room dispose failed');
        return errorResponse(404, `room '${roomId}' is not available`);
      }
    },
  );
}

/**
 * Local helper — same try/catch wrapper the CRUD audit calls use.
 * Inlined instead of imported so this file stays self-contained.
 */
async function tryRecord(
  ctx: EndpointContext,
  entry: Parameters<EndpointContext['database']['audit']['record']>[0],
): Promise<void> {
  try {
    await ctx.database.audit.record(entry);
  } catch (err) {
    ctx.logger?.warn?.({ err }, '[admin] audit insert failed');
  }
}
