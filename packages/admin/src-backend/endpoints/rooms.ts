/**
 * Live room inspector endpoints. Surfaces the running matchmaker's room
 * registry to the admin panel.
 *
 *   GET    /admin-api/rooms                                    → list every active room (driver query)
 *   GET    /admin-api/rooms/:roomId                            → inspect (clients + state + metadata)
 *   GET    /admin-api/rooms/by-user/:userId                    → active rooms a user is in (reverse index)
 *   DELETE /admin-api/rooms/:roomId/clients/:sessionId         → kick a single client
 *   PATCH  /admin-api/rooms/:roomId   { locked: boolean }      → lock or unlock the room
 *   PATCH  /admin-api/rooms/:roomId/state { path, value }      → mutate a state leaf in-place
 *   DELETE /admin-api/rooms/:roomId/state { path }             → remove a state entry
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
 *
 * `by-user` is O(1) per lookup: it reads the Presence hash that Room
 * maintains on `_onJoin`/`_onAfterLeave`, then reconciles each entry
 * against `matchMaker.query` so stale rows left by hard crashes (no
 * `onLeave` ran) get dropped from the response and best-effort `hdel`d.
 */
import {
  createEndpoint, matchMaker, userRoomsKey, CloseCode,
  type Endpoint, type Room,
} from '@colyseus/core';
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

/**
 * Single entry of an active user→room association as returned by the
 * reverse-index endpoints. Stays JSON-friendly so the panel can render
 * it without further normalization.
 */
interface ActiveUserRoom {
  roomId: string;
  roomName: string;
  sessionId: string;
  /** unix ms timestamp captured at Room._onJoin time. */
  joinedAt: number;
  /** Optional process tag, when the matchmaker driver knows it. */
  processId?: string | null;
}

/**
 * Reverse-index lookup: every active room/session pair for a user.
 *
 * The Presence hash is the source of truth for "did the room write a
 * tracking entry?" — but a process crash can leave entries behind. The
 * matchmaker `query()` listing is the source of truth for "does this
 * room still exist?". We intersect both, drop entries that fail the
 * second check, and best-effort `hdel` the stragglers so the next
 * request doesn't pay for the same reconcile.
 */
export function listRoomsByUserEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/by-user/:userId`, { method: 'GET' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'read', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { userId } = reqCtx.params as { userId: string };

      const presence = matchMaker.presence;
      const raw = await presence.hgetall(userRoomsKey(userId));
      const fields = Object.keys(raw);
      if (fields.length === 0) { return json([] as ActiveUserRoom[]); }

      // Build a fast lookup of live rooms so reconcile is O(entries)
      // instead of O(entries × rooms).
      const live = new Map<string, any>();
      for (const r of await matchMaker.query({}) as any[]) {
        live.set(r.roomId, r);
      }

      const active: ActiveUserRoom[] = [];
      const stragglers: string[] = [];
      for (const sessionId of fields) {
        let parsed: { roomId: string; roomName: string; joinedAt: number };
        try { parsed = JSON.parse(raw[sessionId]); }
        catch {
          // Corrupt entry — drop it. The hash field will be hdel'd below.
          stragglers.push(sessionId);
          continue;
        }
        const room = live.get(parsed.roomId);
        if (!room) {
          // Room is gone from the matchmaker but its index entry lingers
          // — that's the crash case we exist to clean up.
          stragglers.push(sessionId);
          continue;
        }
        active.push({
          roomId: parsed.roomId,
          roomName: parsed.roomName,
          sessionId,
          joinedAt: parsed.joinedAt,
          processId: room.processId ?? null,
        });
      }

      // Fire-and-forget cleanup. Don't block the response on it — the
      // user-visible answer is `active` either way.
      if (stragglers.length > 0) {
        const key = userRoomsKey(userId);
        void Promise.all(stragglers.map((s) => presence.hdel(key, s))).catch(() => {});
      }

      // Newest-first ordering matches how the user-show "Active
      // sessions" tab wants to render — recently joined sessions
      // at the top.
      active.sort((a, b) => b.joinedAt - a.joinedAt);
      return json(active);
    },
  );
}

export function inspectRoomEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/:roomId`, { method: 'GET' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'read', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { roomId } = reqCtx.params as { roomId: string };
      try {
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
      // Reason is capped at 120 chars — the WebSocket close frame's
      // reason field is limited to 123 bytes (RFC 6455 §5.5.1).
      const rawReason = (reqCtx.body as { reason?: unknown } | null)?.reason;
      const reason = typeof rawReason === 'string'
        ? rawReason.trim().slice(0, 120) || undefined
        : undefined;
      try {
        // Pass an explicit closeCode (not `undefined`) when forwarding a
        // reason — `remoteRoomCall` JSON round-trips args, which turns
        // `undefined` into `null`, and `WebSocket.close(null, reason)`
        // throws "First argument must be a valid error code number".
        const args: any[] = reason !== undefined
          ? [sessionId, CloseCode.CONSENTED, reason]
          : [sessionId];
        await matchMaker.remoteRoomCall<Room>(
          roomId, 'kickClient' as keyof Room, args,
        );
        // Audit before returning so a slow leave hook can't drop the operator.
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'room.kick', resource: ROOMS_RESOURCE, targetId: roomId,
          payload: {
            sessionId,
            reason: reason ?? null,
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

/**
 * Toggle a room's lock state via `Room.lock()` / `Room.unlock()`. Body
 * is `{ locked: boolean }`; same `update` policy as kick. Each toggle
 * is its own audit event (`room.lock` / `room.unlock`) — splits the
 * timeline so you can tell which side of a kick a flap belongs to.
 */
export function lockRoomEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/:roomId`, { method: 'PATCH' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'update', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { roomId } = reqCtx.params as { roomId: string };
      const body = (reqCtx.body as { locked?: unknown } | null) ?? {};
      if (typeof body.locked !== 'boolean') {
        return errorResponse(400, 'body must include { locked: boolean }');
      }
      try {
        await matchMaker.remoteRoomCall<Room>(
          roomId, (body.locked ? 'lock' : 'unlock') as keyof Room,
        );
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId,
          action: body.locked ? 'room.lock' : 'room.unlock',
          resource: ROOMS_RESOURCE, targetId: roomId,
          payload: {
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true, locked: body.locked });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, roomId, locked: body.locked }, '[admin] room lock toggle failed');
        return errorResponse(404, `room '${roomId}' is not available`);
      }
    },
  );
}

/**
 * Validate a `path` argument. The inspector sends a tuple of strings
 * and numbers (e.g. `['players', 0, 'hp']`) addressing a node in the
 * state tree. We don't recursively check the tree shape — that's the
 * Room's job — but we DO reject obviously-bad payloads at the edge
 * so a typo doesn't reach `Room.prototype._editStateProperty` and
 * crash a player-facing process.
 */
function parsePath(raw: unknown): ReadonlyArray<string | number> | null {
  if (!Array.isArray(raw) || raw.length === 0) { return null; }
  const out: Array<string | number> = [];
  for (const seg of raw) {
    if (typeof seg === 'string' || typeof seg === 'number') {
      out.push(seg);
    } else {
      return null;
    }
  }
  return out;
}

export function editRoomStateEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/:roomId/state`, { method: 'PATCH' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'update', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { roomId } = reqCtx.params as { roomId: string };
      const body = (reqCtx.body as { path?: unknown; value?: unknown } | null) ?? {};
      const path = parsePath(body.path);
      if (!path) {
        return errorResponse(400, 'body must include { path: (string | number)[], value }');
      }
      // `value` is intentionally unconstrained — it's whatever JSON the
      // operator typed in the inspector. The Room mutation logic relies
      // on Schema/object setters to reject types they don't accept.
      try {
        await matchMaker.remoteRoomCall<Room>(
          roomId, '_editStateProperty' as keyof Room, [path, body.value],
        );
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'room.state.edit', resource: ROOMS_RESOURCE, targetId: roomId,
          payload: {
            path,
            value: body.value,
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, roomId, path }, '[admin] room state edit failed');
        return errorResponse(404, `room '${roomId}' is not available`);
      }
    },
  );
}

export function deleteRoomStateEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${ROOMS_RESOURCE}/:roomId/state`, { method: 'DELETE' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'update', ROOMS_RESOURCE);
      if (denied) { return denied; }
      const { roomId } = reqCtx.params as { roomId: string };
      // DELETE accepts a JSON body the same way kick does — better-call
      // exposes it on reqCtx.body. The frontend always sends one because
      // the path needs to live somewhere.
      const body = (reqCtx.body as { path?: unknown } | null) ?? {};
      const path = parsePath(body.path);
      if (!path) {
        return errorResponse(400, 'body must include { path: (string | number)[] }');
      }
      try {
        await matchMaker.remoteRoomCall<Room>(
          roomId, '_deleteStateProperty' as keyof Room, [path],
        );
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'room.state.delete', resource: ROOMS_RESOURCE, targetId: roomId,
          payload: {
            path,
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, roomId, path }, '[admin] room state delete failed');
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
