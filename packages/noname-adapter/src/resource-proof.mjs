import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const proofFile = '.runtime/native-startup-proof.json';
const validToken = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sign = (token, payload) => createHmac('sha256', token).update(payload).digest();

export function assetStamp(engineRoot, entry, device) {
  const info = lstatSync(resolve(engineRoot, entry.path), { bigint: true });
  if (
    !info.isFile() ||
    info.dev !== device ||
    !info.ino ||
    info.ctimeNs <= 0n ||
    info.size !== BigInt(entry.bytes)
  )
    throw new Error('Pinned resource metadata unavailable');
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.birthtimeNs}\n`;
}

export function makeResourceProof(engineRoot, manifestBytes, stamps, token) {
  if (!validToken(token)) throw new Error('Invalid startup proof token');
  const payload = JSON.stringify({
    engineRoot: resolve(engineRoot),
    manifest: sha256(manifestBytes),
    count: stamps.length,
    metadata: sha256(stamps.join('')),
    issued: Date.now(),
  });
  return JSON.stringify({ payload, mac: sign(token, payload).toString('hex') });
}

export function matchesResourceProof(projectRoot, engineRoot, manifestBytes, entries, token) {
  if (process.platform !== 'win32' || !validToken(token)) return false;
  try {
    const { payload, mac } = JSON.parse(readFileSync(resolve(projectRoot, proofFile), 'utf8'));
    if (
      !/^[a-f0-9]{64}$/.test(mac) ||
      !timingSafeEqual(sign(token, payload), Buffer.from(mac, 'hex'))
    )
      return false;
    const proof = JSON.parse(payload);
    if (
      proof.engineRoot !== resolve(engineRoot) ||
      proof.manifest !== sha256(manifestBytes) ||
      proof.count !== entries.length ||
      !entries.length ||
      !Number.isSafeInteger(proof.issued) ||
      Date.now() - proof.issued > 120_000 ||
      proof.issued > Date.now()
    )
      return false;
    const device = lstatSync(engineRoot, { bigint: true }).dev;
    if (!device) return false;
    const metadata = createHash('sha256');
    for (const entry of entries) metadata.update(assetStamp(engineRoot, entry, device));
    return proof.metadata === metadata.digest('hex');
  } catch {
    return false;
  }
}
