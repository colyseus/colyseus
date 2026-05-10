/**
 * Low-level HTTP helpers used by every endpoint:
 *   - `json` / `errorResponse` build Response objects with explicit
 *     Content-Length + Connection: close (workaround for an upstream
 *     better-call adapter bug — see notes below).
 *   - `serveStatic` serves the built admin SPA from disk with a sandboxed
 *     path resolver and SPA fallback.
 *
 * Once the upstream Node adapter reliably terminates streamed bodies, the
 * Content-Length / Connection: close dance can be deleted and callers can
 * switch to `ctx.json()`.
 */
import fs from 'fs/promises';
import path from 'path';

// ---------------------------------------------------------------------------
// JSON + error responses
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Static file serving for the built admin SPA
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
};

/**
 * Serve a file from `root` for the given relative path.
 * - blocks ".." traversal
 * - falls back to index.html for SPA routes (no extension or unknown asset)
 * - sets Content-Length + Connection: close (see top-of-file note)
 */
export async function serveStatic(root: string, relPath: string | undefined): Promise<Response> {
  const safe = sanitize(relPath ?? '');
  const filePath = safe ? path.join(root, safe) : path.join(root, 'index.html');

  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    return new Response('forbidden', { status: 403 });
  }

  const data = await tryRead(resolved);
  if (data) { return fileResponse(data, mimeOf(resolved)); }

  // SPA fallback — serve index.html for any non-asset request
  if (!path.extname(safe)) {
    const index = await tryRead(path.join(resolvedRoot, 'index.html'));
    if (index) { return fileResponse(index, 'text/html; charset=utf-8'); }
  }

  return new Response('not found', { status: 404 });
}

function sanitize(p: string): string {
  return p.replace(/^\/+/, '').split('/').filter((seg) => seg && seg !== '..' && seg !== '.').join('/');
}

function mimeOf(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function tryRead(filePath: string): Promise<Buffer | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) { return null; }
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

function fileResponse(buf: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(buf) as any, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(buf.length),
      'cache-control': 'no-cache',
      'connection': 'close',
    },
  });
}
