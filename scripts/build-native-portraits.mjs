import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const resize = { width: 256, withoutEnlargement: true };
const webp = { quality: 80, effort: 4 };
const encoder = {
  resize,
  webp,
  versions: sharp.versions,
  platform: process.platform,
  arch: process.arch,
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encoding = sha256(JSON.stringify(encoder));

/** Build small table portraits without altering the pinned upstream originals. */
export async function buildNativePortraits(root, buildDir = resolve(root, 'dist')) {
  const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
  const engine = resolve(root, `.local/noname/${candidate.tag}`);
  if (!(await readFile(resolve(engine, 'game/build-info.json')).catch(() => null))) return;
  const catalog = JSON.parse(await readFile(resolve(root, 'config/general-catalog.json')));
  const upstream = JSON.parse(await readFile(resolve(root, 'config/noname-lab-assets.json')));
  if (catalog.source.commit !== candidate.commit || upstream.commit !== candidate.commit)
    throw new Error('Portrait sources do not match the pinned engine');
  const output = resolve(buildDir, 'engine/portraits');
  await mkdir(output, { recursive: true });
  const manifestFile = resolve(output, 'manifest.json');
  const previousContent = await readFile(manifestFile, 'utf8').catch(() => undefined);
  let previous;
  try {
    previous = JSON.parse(previousContent);
  } catch {}
  const sources = new Map(upstream.assets.map((entry) => [entry.path, entry]));
  let reused = 0;
  let encoded = 0;
  const files = {},
    characters = {};
  const portraitEntries = [
    ...catalog.characters,
    ...Object.values(upstream.portraitVariants ?? {})
      .flat()
      .map((id) => ({ id, portrait: `/engine/core/image/character/${id}.jpg` })),
  ];
  for (const character of portraitEntries) {
    const source = character.portrait.replace(/^\/engine\/core\//, '');
    if (!/^image\/character\/[\p{L}\p{N}_-]+\.jpg$/u.test(source))
      throw new Error('Invalid portrait source');
    const file = source
      .split('/')
      .at(-1)
      .replace(/\.jpg$/, '.webp')
      .replace(/[^\w.-]/g, (letter) => `-${letter.codePointAt(0).toString(16)}-`);
    characters[character.id] = file;
    if (files[file]) continue;
    const original = await readFile(resolve(engine, source));
    const entry = sources.get(source);
    const blob = createHash('sha1')
      .update(`blob ${original.length}\0`)
      .update(original)
      .digest('hex');
    if (!entry || original.length !== entry.bytes || blob !== entry.gitBlobSha)
      throw new Error(`Unverified portrait: ${source}`);
    const target = resolve(output, file);
    const old = previous?.commit === candidate.commit ? previous.files?.[file] : undefined;
    const existing = await readFile(target).catch(() => undefined);
    const existingHash = existing && sha256(existing);
    const unchanged =
      old?.source === source &&
      old.sourceBlob === blob &&
      old.originalBytes === original.length &&
      old.encoding === encoding &&
      existing &&
      existing.length === old.bytes &&
      existingHash === old.sha256;
    let bytes;
    let digest;
    if (unchanged) {
      reused++;
      bytes = existing.length;
      digest = existingHash;
    } else {
      encoded++;
      const converted = await sharp(original).resize(resize).webp(webp).toBuffer();
      bytes = converted.length;
      digest = sha256(converted);
      if (digest !== existingHash) await writeFile(target, converted);
    }
    files[file] = {
      source,
      sourceBlob: blob,
      originalBytes: original.length,
      encoding,
      bytes,
      sha256: digest,
      // Preserve existing URLs when adding other generals to the manifest.
      version: digest,
    };
  }
  const hash = createHash('sha256')
    .update(JSON.stringify({ commit: candidate.commit, files, characters }))
    .digest('hex');
  const content = JSON.stringify({ commit: candidate.commit, hash, encoder, files, characters });
  if (content !== previousContent) await writeFile(manifestFile, content);
  const originalBytes = Object.values(files).reduce((total, file) => total + file.originalBytes, 0);
  const bytes = Object.values(files).reduce((total, file) => total + file.bytes, 0);
  console.log(
    `手机武将图 ${Object.keys(files).length} 张：${(originalBytes / 1048576).toFixed(1)} → ${(bytes / 1048576).toFixed(1)} MiB（原图保留，校验复用 ${reused} 张，重编 ${encoded} 张）。`,
  );
  return { reused, encoded };
}
