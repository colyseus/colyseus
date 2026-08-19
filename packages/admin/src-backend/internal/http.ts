/**
 * Low-level HTTP helpers used by every endpoint:
 *   - `json` / `errorResponse` build Response objects with explicit
 *     Content-Length + Connection: close (workaround for an upstream
 *     better-call adapter bug — see notes below).
 *   - `serveStatic` serves the built admin SPA from disk with a sandboxed
 *     path resolver and SPA fallback.
 *   - `externalUiConfig` resolves the UI's external base + API URL from
 *     the forwarded-prefix headers, so the prebuilt SPA follows express
 *     path mounts and reverse-proxy sub-paths.
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
 * External addressing for the prebuilt SPA. `base` is the UI's external
 * URL prefix (always with a trailing slash); `api` is the external REST
 * base (never with one). Injected into index.html at serve time so one
 * prebuilt bundle works at any mount path.
 */
export interface UiRuntimeConfig {
  base: string;
  api: string;
}

// Path-only charset — no quotes, angle brackets, backslashes or spaces, so a
// sanitized value can be embedded in an attribute and a <script> literally.
// Segments are non-empty, which also rejects protocol-relative `//host` bases.
const SAFE_PATH = /^(\/[A-Za-z0-9._~!$&()*+,;=:@%-]+)+$/;

/** Sanitize an untrusted URL-path prefix; anything off-charset becomes ''. */
export function safePath(raw: string | null | undefined): string {
  if (!raw) { return ''; }
  const trimmed = raw.replace(/\/+$/, '');
  return SAFE_PATH.test(trimmed) ? trimmed : '';
}

/**
 * Resolve the UI's external base + API URL for one request.
 *
 * The express middleware forwards the mount coordinates via internal
 * `x-colyseus-admin-base` / `x-colyseus-admin-api` headers; a reverse
 * proxy serving the app under a sub-path announces it via the de-facto
 * `x-forwarded-prefix`. With neither, the configured paths stand as-is
 * (root mounts, router mode). Values are sanitized to plain URL paths —
 * a spoofed header can only mis-address the spoofer's own page.
 */
export function externalUiConfig(
  getHeader: (k: string) => string | null,
  paths: { uiPath: string; apiPath: string },
): UiRuntimeConfig {
  const base = safePath(getHeader('x-colyseus-admin-base'));
  const api = safePath(getHeader('x-colyseus-admin-api'));
  if (base && api) { return { base: `${base}/`, api }; }
  const prefix = safePath(getHeader('x-forwarded-prefix'));
  return { base: `${prefix}${paths.uiPath}/`, api: `${prefix}${paths.apiPath}` };
}

// <base> makes the bundle's relative asset URLs resolve from deep links
// (`/x/users/42` must load `/x/assets/*`, not `/x/users/assets/*`); the
// global carries the same coordinates to the SPA's router + fetch layer.
function injectRuntimeConfig(buf: Buffer, cfg: UiRuntimeConfig): Buffer {
  const tags = `<base href="${cfg.base}"><script>window.__COLYSEUS_ADMIN__=${JSON.stringify(cfg)}</script>`;
  const html = buf.toString('utf8');
  return Buffer.from(html.includes('</head>') ? html.replace('</head>', `${tags}</head>`) : tags + html);
}

/**
 * Serve a file from `root` for the given relative path.
 * - blocks ".." traversal
 * - falls back to index.html for SPA routes (no extension or unknown asset)
 * - injects the runtime config into any served index.html when `inject` is given
 * - sets Content-Length + Connection: close (see top-of-file note)
 */
export async function serveStatic(root: string, relPath: string | undefined, inject?: UiRuntimeConfig): Promise<Response> {
  const safe = sanitize(relPath ?? '');
  const filePath = safe ? path.join(root, safe) : path.join(root, 'index.html');

  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    return new Response('forbidden', { status: 403 });
  }

  const data = await tryRead(resolved);
  if (data) {
    if (inject && path.basename(resolved) === 'index.html') {
      return fileResponse(injectRuntimeConfig(data, inject), 'text/html; charset=utf-8');
    }
    return fileResponse(data, mimeOf(resolved));
  }

  // SPA fallback — serve index.html for any non-asset request
  if (!path.extname(safe)) {
    const index = await tryRead(path.join(resolvedRoot, 'index.html'));
    if (index) {
      return fileResponse(inject ? injectRuntimeConfig(index, inject) : index, 'text/html; charset=utf-8');
    }
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
