/**
 * Operator workflows on the canonical `users` table that the
 * generic CRUD endpoints can't express in a single PATCH:
 *
 *   POST /admin-api/users/:userId/ban              { reason?, until? }
 *   POST /admin-api/users/:userId/unban
 *   POST /admin-api/users/:userId/revoke-sessions
 *
 * Each delegates to a `database.auth.*` service method that already
 * carries the right multi-column update / version-bump semantics, so
 * this file is just guard + body validation + audit.
 *
 * RBAC: all three gate on `update` against the `users` resource —
 * same rule the generic CRUD update endpoint uses for that table.
 * Admins always have access; mods need a scope assignment.
 *
 * The endpoints are mounted only when the GameDatabase's users table
 * actually carries the columns each method needs (ban needs
 * `bannedUntil`/`bannedReason`; revoke-sessions needs `tokenVersion`).
 * Apps on a custom schema without those columns get a 501.
 */
import {
  createEndpoint, matchMaker, userRoomsKey, CloseCode,
  type Endpoint, type Room,
} from '@colyseus/core';
import { errorResponse, json } from '../internal/http.js';
import { ipFromHeaders } from '../auth/rate-limit.js';
import { guard, type EndpointContext } from '../internal/context.js';

const USERS_RESOURCE = 'users';

/**
 * Audit-log helper — mirrors the inline `tryRecord` in rooms.ts.
 * Records failures via the logger but swallows them so a slow audit
 * insert can't drop the operator's response.
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

/**
 * Force-close every active WebSocket session a user has across the
 * matchmaker. Used by ban + revoke-sessions, both of which need
 * in-flight connections gone *now* — token-version bumps only kick in
 * on the next HTTP request, so a long-lived WS would keep playing
 * until it next reauthenticated otherwise.
 *
 * Reads the user→rooms Presence reverse index (the same hash the
 * by-user inspector consumes), then fires `kickClient` in parallel.
 * Errors are swallowed per-call: a missing/dead room or a stale
 * index entry shouldn't fail the whole revocation. Returns the
 * number of clients we actually closed so the audit log can carry
 * the count.
 */
async function closeUserSessions(
  ctx: EndpointContext,
  userId: string,
  reason: string,
): Promise<number> {
  const presence = matchMaker.presence;
  let raw: Record<string, string>;
  try {
    raw = await presence.hgetall(userRoomsKey(userId));
  } catch (err) {
    ctx.logger?.warn?.({ err, userId }, '[admin] presence read failed during session close');
    return 0;
  }
  const fields = Object.keys(raw);
  if (fields.length === 0) { return 0; }

  let closed = 0;
  await Promise.all(fields.map(async (sessionId) => {
    let roomId: string;
    try {
      const parsed = JSON.parse(raw[sessionId]) as { roomId: string };
      roomId = parsed.roomId;
    } catch {
      // Corrupt index entry — skip it. The by-user inspector cleans
      // these up on its next call, so we don't bother here.
      return;
    }
    try {
      // remoteRoomCall round-trips JSON, so `undefined` would become
      // `null`. We always pass a reason, so the 3-arg form is safe.
      await matchMaker.remoteRoomCall<Room>(
        roomId, 'kickClient' as keyof Room,
        [sessionId, CloseCode.CONSENTED, reason],
      );
      closed++;
    } catch (err) {
      // Room is gone / process unreachable / etc. — the JWT bump
      // covers the next reconnect attempt, so we don't need to fail
      // the request.
      ctx.logger?.debug?.({ err, userId, roomId, sessionId },
        '[admin] kickClient failed during session close (room unavailable)');
    }
  }));
  return closed;
}

/**
 * Best-effort decode of an ISO 8601 string into a Date. Returns
 * `null` on bad input — callers translate to a 400.
 */
function parseUntil(raw: unknown): Date | null | undefined {
  if (raw === undefined || raw === null) { return raw as null | undefined; }
  if (typeof raw !== 'string') { return null; }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function banUserEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${USERS_RESOURCE}/:userId/ban`, { method: 'POST' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'update', USERS_RESOURCE);
      if (denied) { return denied; }
      const { userId } = reqCtx.params as { userId: string };
      const body = (reqCtx.body as { reason?: unknown; until?: unknown } | null) ?? {};

      // Reason is optional, capped at 500 chars — long enough for a
      // policy citation, short enough that the audit row stays sane.
      const reason = typeof body.reason === 'string'
        ? body.reason.trim().slice(0, 500) || undefined
        : undefined;
      const until = parseUntil(body.until);
      if (until === null && body.until !== null) {
        return errorResponse(400, 'until must be an ISO 8601 date string or null');
      }

      try {
        // `until: null` ⇒ permanent ban (service handles the sentinel
        // year-9999 timestamp). `until: undefined` ⇒ service default
        // (also permanent). `ban()` also bumps `tokenVersion` atomically
        // so any JWT issued before this call is rejected on its next
        // verification — no separate `bumpTokenVersion` call needed.
        await ctx.database.auth.ban(userId, { reason, until: until ?? undefined });
        // Eject the banned user from any rooms they're currently in.
        // Without this, an active WS connection would keep playing
        // until it next re-authed (which could be never on a
        // persistent session). The kick reason surfaces in the
        // client's close frame so games can react meaningfully.
        const sessionsClosed = await closeUserSessions(ctx, userId, 'banned');
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'user.ban', resource: USERS_RESOURCE, targetId: userId,
          payload: {
            reason: reason ?? null,
            until: until ? until.toISOString() : null,
            sessionsClosed,
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true, sessionsClosed });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, userId }, '[admin] user ban failed');
        // The service throws when the schema is missing ban columns.
        // 501 (Not Implemented) is the right shape: the endpoint is
        // valid but this deployment's schema can't execute it.
        if (err?.message?.includes('ban')) {
          return errorResponse(501, 'this deployment\'s users table does not carry ban columns');
        }
        return errorResponse(500, err?.message ?? 'ban failed');
      }
    },
  );
}

export function unbanUserEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${USERS_RESOURCE}/:userId/unban`, { method: 'POST' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'update', USERS_RESOURCE);
      if (denied) { return denied; }
      const { userId } = reqCtx.params as { userId: string };
      try {
        await ctx.database.auth.unban(userId);
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'user.unban', resource: USERS_RESOURCE, targetId: userId,
          payload: {
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, userId }, '[admin] user unban failed');
        if (err?.message?.includes('unban')) {
          return errorResponse(501, 'this deployment\'s users table does not carry ban columns');
        }
        return errorResponse(500, err?.message ?? 'unban failed');
      }
    },
  );
}

export function revokeSessionsEndpoint(ctx: EndpointContext): Endpoint {
  return createEndpoint(
    `${ctx.apiPath}/${USERS_RESOURCE}/:userId/revoke-sessions`, { method: 'POST' },
    async (reqCtx) => {
      const denied = await guard(ctx, reqCtx, 'update', USERS_RESOURCE);
      if (denied) { return denied; }
      const { userId } = reqCtx.params as { userId: string };
      try {
        await ctx.database.auth.bumpTokenVersion(userId);
        const tokenVersion = await ctx.database.auth.getTokenVersion(userId);
        // Force-close any in-flight WS sessions. The token-version
        // bump invalidates the JWT on the *next* HTTP request, but
        // an already-open WebSocket would happily keep running
        // otherwise. Kick reason "revoked" surfaces in the client's
        // close frame so the app can show an appropriate message.
        const sessionsClosed = await closeUserSessions(ctx, userId, 'revoked');
        const operatorId = await ctx.resolveUserId({ getHeader: reqCtx.getHeader });
        await tryRecord(ctx, {
          operatorId, action: 'user.revoke_sessions', resource: USERS_RESOURCE, targetId: userId,
          payload: {
            tokenVersion,
            sessionsClosed,
            ip: ipFromHeaders(reqCtx.getHeader),
            userAgent: reqCtx.getHeader('user-agent') ?? null,
          },
        });
        return json({ ok: true, sessionsClosed });
      } catch (err: any) {
        ctx.logger?.warn?.({ err, userId }, '[admin] user revoke-sessions failed');
        return errorResponse(500, err?.message ?? 'revoke-sessions failed');
      }
    },
  );
}
