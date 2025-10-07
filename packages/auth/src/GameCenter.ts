import { createPublicKey, createVerify } from 'crypto';
import { URL } from 'url';

export interface GameCenterCredentials {
  playerId: string;
  bundleId: string;
  timestamp: number;
  salt: string;
  signature: string;
  publicKeyUrl: string;
}

const publicKeyCache = new Map<string, string>();

async function fetchPublicKey(publicKeyUrl: string): Promise<string> {
  const cached = publicKeyCache.get(publicKeyUrl);
  if (cached) {
    return cached;
  }

  const url = new URL(publicKeyUrl);
  if (url.protocol !== 'https:' ||
    (!url.hostname.endsWith('.apple.com') && url.hostname !== 'apple.com')) {
    throw new Error("Invalid public key URL domain");
  }

  const certResponse = await fetch(publicKeyUrl);
  if (!certResponse.ok) {
    throw new Error("Failed to fetch public key");
  }
  const certData = await certResponse.arrayBuffer();
  const base64Cert = Buffer.from(certData).toString('base64');
  
  // Convert to PEM format
  const pemCert = `-----BEGIN CERTIFICATE-----\n${base64Cert.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;
  
  publicKeyCache.set(publicKeyUrl, pemCert);
  return pemCert;
}

export async function authenticateGameCenter(credentials: GameCenterCredentials): Promise<{ playerId: string; bundleId: string }> {
  const { playerId, bundleId, timestamp, salt, signature, publicKeyUrl } = credentials;

  if (!playerId) throw new Error("Player ID required");
  if (!bundleId) throw new Error("Bundle ID required");
  if (!timestamp) throw new Error("Timestamp required");
  if (!salt) throw new Error("Salt required");
  if (!signature) throw new Error("Signature required");
  if (!publicKeyUrl) throw new Error("Public key URL required");

  const pemCert = await fetchPublicKey(publicKeyUrl);

  // Convert timestamp to big-endian 8-byte buffer (like Node.js example)
  // Apple Game Center timestamps are in milliseconds, but we need to use them as-is
  const timestampBuffer = Buffer.alloc(8);
  const high = Math.floor(timestamp / 0x100000000);
  const low = timestamp % 0x100000000;
  timestampBuffer.writeUInt32BE(high, 0);
  timestampBuffer.writeUInt32BE(low, 4);

  const verify = createVerify('sha256');
  verify.update(playerId, 'utf8');
  verify.update(bundleId, 'utf8');
  verify.update(timestampBuffer);
  verify.update(salt, 'base64');
  verify.end();

  const signatureBuffer = Buffer.from(signature, 'base64');
  const isValid = verify.verify(pemCert, signatureBuffer);

  if (!isValid) {
    throw new Error("Invalid signature");
  }

  const timestampAge = Date.now() - (timestamp * 1000);
  if (timestampAge > 600000) {
    throw new Error("Timestamp expired");
  }

  return { playerId, bundleId };
}
