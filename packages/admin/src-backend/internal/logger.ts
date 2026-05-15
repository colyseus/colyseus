/**
 * Minimal structured logger for the admin endpoints.
 *
 * No external runtime dep — just JSON-on-stdout. Pino-compatible shape so
 * users can swap in pino/bunyan/winston by passing their own Logger to
 * admin({ logger }) and it'll work the same.
 *
 * Each log line is a single JSON object (one-line, newline-delimited):
 *   {"level":"info","time":1234567890,"msg":"GET /admin-api/users","ctx":{...}}
 *
 * Production deployments can pipe stdout through a structured-log shipper
 * (Loki, Datadog, CloudWatch). This format is intentionally pino-shaped so
 * tooling that expects pino works without transformation.
 */

export interface LogFn {
  (obj: Record<string, any>, msg?: string): void;
  (msg: string): void;
}

export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
  child(bindings: Record<string, any>): Logger;
}

function emit(level: string, base: Record<string, any>, args: any[]) {
  let extra: Record<string, any> = {};
  let msg: string | undefined;
  if (args.length === 1 && typeof args[0] === 'string') {
    msg = args[0];
  } else if (args.length >= 1 && typeof args[0] === 'object') {
    extra = args[0];
    msg = args[1];
  }
  const line = JSON.stringify({
    level,
    time: Date.now(),
    ...base,
    ...extra,
    ...(msg !== undefined ? { msg } : {}),
  });
  // stderr for warn/error so they aren't swallowed by stdout-buffered tools
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

function makeLogger(bindings: Record<string, any> = {}): Logger {
  return {
    info: ((...args: any[]) => emit('info', bindings, args)) as LogFn,
    warn: ((...args: any[]) => emit('warn', bindings, args)) as LogFn,
    error: ((...args: any[]) => emit('error', bindings, args)) as LogFn,
    debug: ((...args: any[]) => {
      if (process.env.LOG_DEBUG) { emit('debug', bindings, args); }
    }) as LogFn,
    child: (extra: Record<string, any>) => makeLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = makeLogger({ pkg: '@colyseus/admin' });

/**
 * Wrap an async endpoint handler with request-scoped logging.
 * Logs method+path+status+durationMs (+userId if available) on completion.
 */
export function withRequestLogger<H extends (ctx: any) => Promise<Response>>(
  log: Logger | null | undefined,
  handler: H,
): H {
  if (!log) { return handler; }
  return (async (ctx: any) => {
    const start = Date.now();
    const path = ctx.path ?? ctx.request?.url ?? '?';
    const method = ctx.method ?? '?';
    try {
      const res = await handler(ctx);
      const status = (res as any)?.status ?? 200;
      const userId = ctx.context?.userId;
      log.info(
        { method, path, status, durationMs: Date.now() - start, userId },
        `${method} ${path} → ${status}`,
      );
      return res;
    } catch (err: any) {
      log.error(
        { method, path, durationMs: Date.now() - start, err: err?.message ?? String(err) },
        `${method} ${path} → exception`,
      );
      throw err;
    }
  }) as H;
}
