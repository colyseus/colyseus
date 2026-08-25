/**
 * requireOperator() — the "is this caller allowed to use the panel at
 * all" gate used by the catalog (GET /admin-api) and the dashboard.
 *
 * Fakes a minimal EndpointContext: only `enforceRbac`, `resolveUserId`
 * and `database.moderation.getRole` are touched.
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { requireOperator } from '../src-backend/internal/context.ts';

type Role = 'admin' | 'mod' | 'user';

function fakeCtx(opts: {
  enforceRbac?: boolean;
  userId?: string;
  role?: Role;
}): any {
  return {
    enforceRbac: opts.enforceRbac ?? true,
    resolveUserId: async () => opts.userId,
    database: {
      moderation: { getRole: async () => opts.role ?? 'user' },
    },
  };
}

const reqCtx = { getHeader: (_: string) => null };

describe('requireOperator', () => {
  it('allows everything when RBAC is disabled (dev)', async () => {
    const res = await requireOperator(fakeCtx({ enforceRbac: false }), reqCtx);
    assert.equal(res, null);
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const res = await requireOperator(fakeCtx({ userId: undefined }), reqCtx);
    assert.ok(res instanceof Response);
    assert.equal(res!.status, 401);
  });

  it('rejects a plain user-role account with 403', async () => {
    const res = await requireOperator(
      fakeCtx({ userId: 'u1', role: 'user' }),
      reqCtx,
    );
    assert.ok(res instanceof Response);
    assert.equal(res!.status, 403);
  });

  it('allows a mod (regardless of collection scopes)', async () => {
    const res = await requireOperator(
      fakeCtx({ userId: 'u1', role: 'mod' }),
      reqCtx,
    );
    assert.equal(res, null);
  });

  it('allows an admin', async () => {
    const res = await requireOperator(
      fakeCtx({ userId: 'u1', role: 'admin' }),
      reqCtx,
    );
    assert.equal(res, null);
  });
});
