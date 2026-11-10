// @vitest-environment node
/**
 * `debugAndPrintError()`: a `ServerError` is client-facing, so production keeps
 * it behind `DEBUG=colyseus:errors`. Outside production it's printed too: room
 * code throws them as well (a typo'd room name in `onJoin`), and a silent
 * refusal there left the server log saying the client had joined.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { debugAndPrintError, debugError } from '../src/Debug.ts';
import { setLogger, type Logger } from '../src/Logger.ts';
import { ServerError } from '../src/errors/ServerError.ts';
import { ErrorCode } from '@colyseus/shared-types';

describe('debugAndPrintError', () => {
  const nodeEnv = process.env.NODE_ENV;
  const debugLog = debugError.log;
  const debugEnabled = debugError.enabled;
  let printed: { level: string, text: string }[];

  beforeEach(() => {
    printed = [];
    const capture = (level: string) => (...args: any[]) => { printed.push({ level, text: args.join(' ') }); };
    setLogger({ error: capture('error'), warn: capture('warn') } as Logger);
    debugError.log = capture('debug');
    debugError.enabled = false;
  });

  afterEach(() => {
    setLogger(console);
    debugError.log = debugLog;
    debugError.enabled = debugEnabled;
    if (nodeEnv === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = nodeEnv; }
  });

  const notDefined = () => new ServerError(ErrorCode.MATCHMAKE_NO_HANDLER, 'provided room name "gameRoom" not defined');

  it('prints a ServerError as one warning line outside production', () => {
    delete process.env.NODE_ENV;
    debugAndPrintError(notDefined());
    expect(printed).toEqual([{ level: 'warn', text: 'ServerError 520: provided room name "gameRoom" not defined' }]);
  });

  it('prints what a wrapped exception was, as Room does for a throwing onLeave()', () => {
    delete process.env.NODE_ENV;
    debugAndPrintError(new ServerError(4002, 'onLeave error', { cause: new TypeError('player is undefined') }));
    expect(printed).toHaveLength(1);
    expect(printed[0].level).toBe('warn');
    expect(printed[0].text).toMatch(/^ServerError 4002: onLeave error\nTypeError: player is undefined\n\s+at /);

    printed.length = 0;
    debugAndPrintError(new ServerError(4002, 'onLeave error', { cause: 'oops' })); // a thrown non-Error
    expect(printed).toEqual([{ level: 'warn', text: 'ServerError 4002: onLeave error\noops' }]);
  });

  it('keeps a ServerError silent in production', () => {
    process.env.NODE_ENV = 'production';
    debugAndPrintError(notDefined());
    expect(printed).toEqual([]);
  });

  it('leaves a ServerError to DEBUG=colyseus:errors when that is on', () => {
    delete process.env.NODE_ENV;
    debugError.enabled = true;
    debugAndPrintError(notDefined());
    expect(printed.map((p) => p.level)).toEqual(['debug']);
  });

  it('prints any other error with its stack, in production too', () => {
    process.env.NODE_ENV = 'production';
    debugAndPrintError(new Error('boom'));
    expect(printed).toHaveLength(1);
    expect(printed[0].level).toBe('error');
    expect(printed[0].text).toMatch(/^Error: boom\n\s+at /);
  });
});
