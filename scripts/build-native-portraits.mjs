import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Build small table portraits without altering the pinned upstream originals. */
export async function buildNativePortraits(root) {
  const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
  const engine = resolve(root, `.local/noname/${candidate.tag}`);
  if (!(await readFile(resolve(engine, 'game/build-info.json')).catch(() => null))) return;
  const catalog = JSON.parse(await readFile(resolve(root, 'config/general-catalog.json')));
  const upstream = JSON.parse(await readFile(resolve(root, 'config/noname-lab-assets.json')));
  if (catalog.source.commit !== candidate.commit || upstream.commit !== candidate.commit)
    throw new Error('Portrait sources do not match the pinned engine');
  const output = resolve(root, 'dist/engine/portraits');
  await mkdir(output, { recursive: true });
  const previous = await readFile(resolve(output, 'manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => undefined);
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
    const entry = upstream.assets.find((asset) => asset.path === source);
    const blob = createHash('sha1')
      .update(`blob ${original.length}\0`)
      .update(original)
      .digest('hex');
    if (!entry || blob !== entry.gitBlobSha) throw new Error(`Unverified portrait: ${source}`);
    const bytes = await sharp(original)
      .resize({ width: 256, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await readFile(resolve(output, file)).catch(() => undefined);
    if (!existing || createHash('sha256').update(existing).digest('hex') !== sha256)
      await writeFile(resolve(output, file), bytes);
    const old = previous?.commit === candidate.commit ? previous.files[file] : undefined;
    const version = old?.sha256 === sha256 ? (old.version ?? previous.hash) : sha256;
    files[file] = {
      source,
      sourceBlob: blob,
      originalBytes: original.length,
      bytes: bytes.length,
      sha256,
      // Preserve existing URLs when adding other generals to the manifest.
      version: /^[a-f0-9]{64}$/.test(version) ? version : sha256,
    };
  }
  const hash = createHash('sha256')
    .update(JSON.stringify({ commit: candidate.commit, files, characters }))
    .digest('hex');
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify({ commit: candidate.commit, hash, files, characters }),
  );
  const originalBytes = Object.values(files).reduce((total, file) => total + file.originalBytes, 0);
  const bytes = Object.values(files).reduce((total, file) => total + file.bytes, 0);
  console.log(
    `手机武将图 ${Object.keys(files).length} 张：${(originalBytes / 1048576).toFixed(1)} → ${(bytes / 1048576).toFixed(1)} MiB（原图保留）。`,
  );
}
