/**
 * Response helpers that set Content-Length + Connection: close.
 *
 * Workaround for a bug in @colyseus/better-call's Node adapter where `res.end()`
 * isn't reliably called for streamed bodies (chunked Transfer-Encoding hangs the
 * keepalive socket). Setting Content-Length tells the client how many bytes to
 * read; Connection: close ensures a poisoned socket can't queue subsequent
 * requests on the same connection.
 *
 * Once the upstream adapter is fixed, this file can be deleted and callers can
 * switch to ctx.json().
 */
const CLOSE_HEADERS = { connection: 'close' } as const;

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const body = JSON.stringify(data);
  const buf = new TextEncoder().encode(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(buf.byteLength),
    ...CLOSE_HEADERS,
    ...(init.headers ?? {}),
  };
  return new Response(buf as any, { status: init.status ?? 200, headers });
}

export function errorResponse(status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return json({ error: message, status }, { status, headers: extraHeaders });
}
