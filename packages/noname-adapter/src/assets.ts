import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Asset = {
  stamp: string;
  bytes: Buffer;
  gzip?: Buffer;
  br?: Buffer;
  etag: string;
  digest: string;
  compressing: Partial<Record<'br' | 'gzip', Promise<Buffer>>>;
};
const compressGzip = promisify(gzip);
const compressBrotli = promisify(brotliCompress);
function negotiate(request: IncomingMessage, compressible: boolean) {
  const qualities = new Map<string, number>();
  for (const value of (request.headers['accept-encoding'] ?? '').split(',')) {
    const [name, ...parameters] = value
      .toLowerCase()
      .split(';')
      .map((part) => part.trim());
    if (!name) continue;
    const weight = parameters.find((part) => /^q\s*=/.test(part));
    const quality = weight ? Number(weight.split('=')[1]) : 1;
    qualities.set(name, quality >= 0 && quality <= 1 ? quality : 0);
  }
  const wildcard = qualities.get('*');
  const choices = compressible ? (['br', 'gzip', 'identity'] as const) : (['identity'] as const);
  const quality = (name: string) =>
    qualities.get(name) ?? (name === 'identity' ? (wildcard === 0 ? 0 : 0.001) : (wildcard ?? 0));
  const best = [...choices].sort((left, right) => quality(right) - quality(left))[0]!;
  if (!quality(best)) return null;
  return best === 'identity' ? undefined : best;
}

/** Static bytes only. Match setup, cookies and private state never enter this cache. */
export class EngineAssets {
  constructor(private readonly byteLimit = 64 * 1024 * 1024) {}

  private readonly cache = new Map<string, Asset>();
  private readonly loading = new Map<string, Promise<Asset>>();
  private size = 0;
  private trim() {
    while (this.size > this.byteLimit && this.cache.size > 1) {
      const [key, oldest] = this.cache.entries().next().value!;
      this.cache.delete(key);
      this.size -= oldest.bytes.length + (oldest.gzip?.length ?? 0) + (oldest.br?.length ?? 0);
    }
  }

  async send(
    request: IncomingMessage,
    response: ServerResponse,
    file: string,
    mime: string,
    options: {
      immutable?: boolean;
      fingerprint?: string | null;
      cacheControl?: string;
      transform?: ((content: string) => string) | undefined;
    } = {},
  ) {
    const info = await stat(file, { bigint: true });
    const stamp = `${info.dev}:${info.ino}:${info.ctimeNs}:${info.mtimeNs}:${info.size}`;
    let asset = this.cache.get(file);
    if (!asset || asset.stamp !== stamp) {
      const key = `${file}:${stamp}`;
      let loading = this.loading.get(key);
      if (!loading) {
        loading = (async () => {
          const original = await readFile(file);
          const bytes = options.transform
            ? Buffer.from(options.transform(original.toString()))
            : original;
          const previous = this.cache.get(file);
          if (previous)
            this.size -=
              previous.bytes.length + (previous.gzip?.length ?? 0) + (previous.br?.length ?? 0);
          const digest = createHash('sha256').update(bytes).digest('hex');
          const prepared: Asset = {
            stamp,
            bytes,
            etag: `W/"${digest}"`,
            digest,
            compressing: {},
          };
          this.cache.set(file, prepared);
          this.size += bytes.length;
          this.trim();
          return prepared;
        })().finally(() => this.loading.delete(key));
        this.loading.set(key, loading);
      }
      asset = await loading;
    }
    response.setHeader('Content-Type', mime);
    response.setHeader(
      'Cache-Control',
      options.immutable || options.fingerprint === asset.digest
        ? 'public, max-age=31536000, immutable'
        : (options.cacheControl ?? 'public, max-age=0, must-revalidate'),
    );
    response.setHeader('ETag', asset.etag);
    response.setHeader('Vary', 'Accept-Encoding');
    const encoding = negotiate(request, /javascript|text\/|json|svg/.test(mime));
    if (encoding === null) {
      response.setHeader('Cache-Control', 'no-store');
      response.writeHead(406);
      response.end();
      return;
    }
    if (
      (request.headers['if-none-match'] ?? '').split(',').some((value) => {
        const tag = value.trim();
        return tag === '*' || tag.replace(/^W\//, '') === asset.etag.slice(2);
      })
    ) {
      response.writeHead(304);
      response.end();
      return;
    }
    if (encoding && !asset[encoding]) {
      // Compress off the request thread so a cold eight-seat load cannot stall
      // rule messages while large definitions are being compressed.
      asset.compressing[encoding] ??=
        encoding === 'br'
          ? compressBrotli(asset.bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } })
          : compressGzip(asset.bytes, { level: 6 });
      const compressed = await asset.compressing[encoding];
      if (!asset[encoding]) {
        asset[encoding] = compressed;
        if (this.cache.get(file) === asset) {
          this.size += compressed.length;
          this.trim();
        }
      }
    }
    const content = encoding ? asset[encoding]! : asset.bytes;
    if (encoding) response.setHeader('Content-Encoding', encoding);
    response.setHeader('Content-Length', content.length);
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : content);
  }
}
