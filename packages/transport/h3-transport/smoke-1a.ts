/**
 * Stage 1a de-risk: raw @fails-components/webtransport datagram round-trip.
 * Isolates the native quiche + self-signed-cert + datagram stack from the full
 * Colyseus SDK path. If this fails, the transport itself is broken (version
 * skew 1.3→1.6, native bindings, Node 22) and nothing downstream can work.
 *
 * Run: node --experimental-strip-types smoke-1a.ts
 */
import { Http3Server, WebTransport } from '@fails-components/webtransport';
import { generateWebTransportCertificate } from './src/utils/mkcert.ts';

const PORT = 14433;
const HOST = 'localhost';

function fail(msg: string, e?: unknown): never {
  console.error(`\n❌ STAGE 1a FAILED: ${msg}`);
  if (e) console.error(e);
  process.exit(1);
}

const hardTimeout = setTimeout(() => fail('timed out after 8s (no datagram received)'), 8000);

async function main() {
  console.log('• generating self-signed cert via mkcert.ts ...');
  const generated = await generateWebTransportCertificate(
    [{ shortName: 'CN', value: HOST }],
    { days: 10 },
  ).catch((e) => fail('cert generation threw', e));

  const fingerprintBytes = generated.fingerprint.split(':').map((h: string) => parseInt(h, 16));
  console.log(`  cert ok, sha-256 fingerprint = ${generated.fingerprint.slice(0, 23)}…`);

  console.log('• starting Http3Server ...');
  const server = new Http3Server({
    host: HOST,
    port: PORT,
    secret: 'smoketest',
    cert: generated.cert,
    privKey: generated.private,
    defaultDatagramsReadableMode: 'bytes',
  });
  server.startServer();

  // Server: accept one session, read one datagram.
  const serverGotIt = (async () => {
    const sessionStream = await server.sessionStream('/');
    const sessionReader = sessionStream.getReader();
    const { value: session, done } = await sessionReader.read();
    if (done || !session) fail('server: session stream closed before a session arrived');
    console.log('• server: session arrived, awaiting ready ...');
    await session.ready;
    console.log('• server: session ready, reading datagrams ...');
    const dgReader = session.datagrams.readable.getReader();
    const { value: bytes } = await dgReader.read();
    return bytes as Uint8Array;
  })();

  // Give the server a moment to begin listening.
  await new Promise((r) => setTimeout(r, 300));

  console.log('• client: connecting WebTransport (Node) ...');
  const url = `https://${HOST}:${PORT}/`;
  const wt = new WebTransport(url, {
    serverCertificateHashes: [{ algorithm: 'sha-256', value: new Uint8Array(fingerprintBytes) }],
  });

  await wt.ready.catch((e: unknown) => fail('client: wt.ready rejected (handshake/cert)', e));
  console.log('• client: ready, writing datagrams ...');

  // Datagrams are unreliable even on loopback during handshake — send a burst.
  // createWritable() = the non-deprecated 1.6 API (finding 1 fix); should NOT log a deprecation warning.
  const writer = wt.datagrams.createWritable().getWriter();
  const payload = new TextEncoder().encode('hello-datagram');
  let stop = false;
  (async () => {
    while (!stop) {
      try { await writer.write(payload); } catch { break; }
      await new Promise((r) => setTimeout(r, 50));
    }
  })();

  const received = await serverGotIt;
  stop = true;
  clearTimeout(hardTimeout);

  const text = new TextDecoder().decode(received);
  console.log(`\n✅ STAGE 1a PASSED: server received ${received.byteLength}-byte datagram: "${text}"`);

  try { wt.close(); } catch {}
  try { server.stopServer(); } catch {}
  process.exit(0);
}

main().catch((e) => fail('unexpected error', e));
