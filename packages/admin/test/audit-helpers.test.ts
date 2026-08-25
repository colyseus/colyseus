import assert from 'assert';
import { describe, it } from 'node:test';
import { tryAudit } from '../src-backend/internal/helpers.ts';

describe('tryAudit', () => {
  it('runs the work function on success and resolves silently', async () => {
    let called = false;
    await tryAudit(null, async () => { called = true; });
    assert.strictEqual(called, true);
  });

  it('swallows errors from the work fn (audit failure must not break callers)', async () => {
    await assert.doesNotReject(tryAudit(null, async () => {
      throw new Error('boom');
    }));
  });

  it('logs the error with logger.error when a logger is supplied', async () => {
    const logged: any[] = [];
    const logger = { error: (...args: any[]) => logged.push(args) } as any;
    await tryAudit(logger, async () => { throw new Error('boom'); });
    assert.strictEqual(logged.length, 1);
    const [meta, msg] = logged[0];
    assert.deepStrictEqual(meta, { err: 'boom' });
    assert.strictEqual(msg, 'audit log write failed');
  });

  it('logs String(err) when err.message is missing', async () => {
    const logged: any[] = [];
    const logger = { error: (...args: any[]) => logged.push(args) } as any;
    await tryAudit(logger, async () => { throw 'plain-string-throw'; });
    assert.deepStrictEqual(logged[0][0], { err: 'plain-string-throw' });
  });

  it('does not throw if the logger has no .error method', async () => {
    const logger = {} as any;
    await assert.doesNotReject(tryAudit(logger, async () => { throw new Error('x'); }));
  });
});
