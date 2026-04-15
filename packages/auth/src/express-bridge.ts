import type express from 'express';
import { Readable } from 'node:stream';

/**
 * Minimal Node `IncomingMessage`-shaped shim built from a Fetch `Request`.
 * Only the surface needed by `express` + `express-session` + `grant` on GET
 * traffic is implemented (OAuth start + callback are both GET).
 */
class BridgeIncomingMessage extends Readable {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  httpVersion = '1.1';
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  complete = true;
  connection: any;
  socket: any;

  constructor(init: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    secure: boolean;
    body?: Buffer | null;
  }) {
    super();
    this.method = init.method;
    this.url = init.url;
    this.headers = init.headers;
    const sock = { remoteAddress: '127.0.0.1', encrypted: init.secure };
    this.connection = sock;
    this.socket = sock;
    if (init.body && init.body.length > 0) this.push(init.body);
    this.push(null);
  }

  _read() { /* no-op, body is pre-pushed */ }
}

type HeaderMap = Record<string, string | string[]>;

/**
 * Minimal `ServerResponse`-shaped object. Methods are own-properties so they
 * survive Express's `res.__proto__ = app.response` swap in `app.handle()`.
 */
function createBridgeResponse(req: BridgeIncomingMessage) {
  const headers: HeaderMap = {};
  const bodyChunks: Buffer[] = [];
  const listeners: Record<string, Function[]> = {};

  const res: any = {
    req,
    statusCode: 200,
    statusMessage: '',
    headersSent: false,
    sendDate: false,
    writable: true,
    writableEnded: false,
    writableFinished: false,
    finished: false,
    locals: {},

    setHeader(name: string, value: any) {
      headers[name.toLowerCase()] = Array.isArray(value)
        ? value.map(String)
        : String(value);
      return this;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    getHeaders() {
      return { ...headers };
    },
    getHeaderNames() {
      return Object.keys(headers);
    },
    hasHeader(name: string) {
      return Object.prototype.hasOwnProperty.call(headers, name.toLowerCase());
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
    },

    writeHead(status: number, statusMessage?: any, extraHeaders?: any) {
      if (typeof statusMessage === 'object' && statusMessage !== null) {
        extraHeaders = statusMessage;
        statusMessage = undefined;
      }
      this.statusCode = status;
      if (typeof statusMessage === 'string') this.statusMessage = statusMessage;
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) this.setHeader(k, v);
      }
      this.headersSent = true;
      return this;
    },

    write(chunk: any, encoding?: any, cb?: any) {
      if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
      if (!this.headersSent) this.writeHead(this.statusCode);
      if (chunk != null) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
      }
      if (cb) cb();
      return true;
    },

    end(chunk?: any, encoding?: any, cb?: any) {
      if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
      else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
      if (chunk != null) this.write(chunk, encoding);
      if (!this.headersSent) this.writeHead(this.statusCode);
      this.writableEnded = true;
      this.writableFinished = true;
      this.finished = true;
      this.emit('finish');
      this.emit('close');
      if (cb) cb();
      return this;
    },

    // EventEmitter surface — own properties so they survive Express proto swap.
    on(event: string, fn: Function) {
      (listeners[event] = listeners[event] || []).push(fn);
      return this;
    },
    addListener(event: string, fn: Function) { return this.on(event, fn); },
    off(event: string, fn: Function) { return this.removeListener(event, fn); },
    removeListener(event: string, fn: Function) {
      const list = listeners[event];
      if (list) {
        const idx = list.indexOf(fn);
        if (idx !== -1) list.splice(idx, 1);
      }
      return this;
    },
    once(event: string, fn: Function) {
      const wrapper = (...args: any[]) => {
        this.removeListener(event, wrapper);
        fn.apply(this, args);
      };
      return this.on(event, wrapper);
    },
    emit(event: string, ...args: any[]) {
      const list = listeners[event];
      if (list) for (const fn of list.slice()) fn.apply(this, args);
      return true;
    },
    listenerCount(event: string) {
      return (listeners[event] || []).length;
    },

    _getCapturedBody() {
      return bodyChunks.length ? Buffer.concat(bodyChunks) : null;
    },
    _getCapturedHeaders() {
      return headers;
    },
  };

  return res;
}

/**
 * Run an Express application against a Fetch `Request` and return a Fetch
 * `Response`, without listening on a real socket. Used to bridge
 * `grant` + `express-session` OAuth routes into a better-call endpoint.
 *
 * Only supports the surface required by grant (GET redirects + query parsing)
 * and express-session (cookies via Set-Cookie header). Not a general-purpose
 * Express runner.
 */
export async function runExpressApp(
  app: express.Application,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';

  const rawHeaders: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of request.headers) rawHeaders[name.toLowerCase()] = value;

  const body = (request.method !== 'GET' && request.method !== 'HEAD')
    ? Buffer.from(await request.arrayBuffer())
    : null;

  const req = new BridgeIncomingMessage({
    method: request.method,
    url: url.pathname + url.search,
    headers: rawHeaders,
    secure,
    body,
  });

  const res = createBridgeResponse(req);

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;

      const outHeaders = new Headers();
      for (const [key, value] of Object.entries(res._getCapturedHeaders())) {
        if (Array.isArray(value)) {
          for (const v of value) outHeaders.append(key, v);
        } else if (value != null) {
          outHeaders.set(key, String(value));
        }
      }

      const capturedBody = res._getCapturedBody();
      resolve(new Response(capturedBody, {
        status: res.statusCode,
        headers: outHeaders,
      }));
    };

    res.on('finish', settle);
    res.on('close', settle);

    try {
      (app as any).handle(req, res, (err: any) => {
        if (err) {
          if (settled) return;
          settled = true;
          reject(err);
        } else if (!res.writableEnded) {
          // Fell through without ending — treat as 404.
          res.statusCode = 404;
          res.end('Not Found');
        }
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        reject(err);
      }
    }
  });
}
