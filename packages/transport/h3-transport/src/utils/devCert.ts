import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { generateWebTransportCertificate } from './mkcert.ts';

export interface DevCertificate {
  /** PEM certificate chain. */
  cert: string;
  /** PEM private key. */
  key: string;
  /**
   * SHA-256 cert hash (byte array) for WebTransport `serverCertificateHashes`
   * pinning — set ONLY for the untrusted self-signed fallback. `undefined` when
   * the cert is CA-trusted (mkcert), where the browser does normal validation
   * (so the HTTPS matchmake endpoint is trusted too).
   */
  fingerprint?: number[];
}

/**
 * Resolve a development TLS certificate for the h3 (WebTransport) server,
 * preferring a browser-**trusted** cert via the `mkcert` tool so the dev setup
 * is seamless: with a trusted cert, BOTH the HTTPS matchmake `fetch` and the
 * WebTransport connection validate normally — no `--ignore-certificate-errors`
 * flag, no `serverCertificateHashes` pinning.
 *
 * Resolution order:
 *  1. `mkcert` on PATH → install its local CA (idempotent) and issue a cached
 *     leaf for `hostname`. Browser-trusted ⇒ no fingerprint.
 *  2. Fallback → the bundled self-signed generator. WebTransport still works via
 *     `serverCertificateHashes` (fingerprint returned), but the HTTPS matchmake
 *     endpoint isn't browser-trusted — we log how to get the seamless path.
 *
 * Set `H3_SELF_SIGNED=1` to force step 2 even when mkcert is present. Required
 * for **non-browser** (Node) WebTransport clients: they don't use the OS/mkcert
 * trust store, so they can only validate via `serverCertificateHashes` pinning —
 * which needs the fingerprint AND a short-lived cert (mkcert leaves are too
 * long-lived to pin). Browsers want the opposite (trusted CA, no fingerprint),
 * which is the default.
 *
 * Only for dev: production should pass a real `cert`/`key` to the transport.
 */
export async function resolveDevCertificate(hostname: string): Promise<DevCertificate> {
  const preferTrusted = !envFlag('H3_SELF_SIGNED');
  const bin = preferTrusted ? findMkcert() : null;

  if (bin) {
    try {
      return issueWithMkcert(bin, hostname);
    } catch (e) {
      console.warn(
        `@colyseus/h3-transport: \`mkcert\` is installed but failed (${(e as Error).message}); ` +
        `falling back to a self-signed cert.`,
      );
    }
  } else if (preferTrusted) {
    console.warn(
      "@colyseus/h3-transport: using a self-signed dev cert — WebTransport connects (cert is " +
      "pinned by hash), but the HTTPS matchmake endpoint won't be browser-trusted. Install " +
      "`mkcert` (https://github.com/FiloSottile/mkcert) once for a fully-trusted, flag-free dev setup.",
    );
  }

  const gen = await generateWebTransportCertificate(
    [{ shortName: 'CN', value: hostname }],
    { days: 10 },
  );
  return {
    cert: gen.cert,
    key: gen.private,
    fingerprint: gen.fingerprint.split(':').map((hex: string) => parseInt(hex, 16)),
  };
}

/** Truthy-string env flag (`1`/`true`). */
function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v === 'true';
}

/** `mkcert -CAROOT` succeeds iff the binary is present + runnable. */
function findMkcert(): string | null {
  try {
    execFileSync('mkcert', ['-CAROOT'], { stdio: 'ignore' });
    return 'mkcert';
  } catch {
    return null;
  }
}

/**
 * Install mkcert's local CA into the system + browser trust stores (idempotent —
 * only prompts the very first time on a machine) and issue a cached leaf cert
 * for `hostname`. The cached leaf keeps restarts fast and the cert stable so the
 * browser doesn't see it change between runs.
 */
function issueWithMkcert(bin: string, hostname: string): DevCertificate {
  execFileSync(bin, ['-install'], { stdio: 'inherit' });

  const dir = join(tmpdir(), 'colyseus-h3-cert');
  mkdirSync(dir, { recursive: true });
  const certFile = join(dir, `${hostname}.pem`);
  const keyFile = join(dir, `${hostname}-key.pem`);

  if (!existsSync(certFile) || !existsSync(keyFile)) {
    execFileSync(bin, ['-cert-file', certFile, '-key-file', keyFile, hostname, '127.0.0.1', '::1'], { stdio: 'inherit' });
  }

  // CA-trusted ⇒ no fingerprint (normal validation; not pinned).
  return { cert: readFileSync(certFile, 'utf8'), key: readFileSync(keyFile, 'utf8') };
}
