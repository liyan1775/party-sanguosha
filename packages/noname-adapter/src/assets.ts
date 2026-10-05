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
  compressing: Partial<Record<'br' | 'gzip', Promise<Buffer>>>;
};
const compressGzip = promisify(gzip);
const compressBrotli = promisify(brotliCompress);
function accepts(request: IncomingMessage, encoding: string) {
  return (request.headers['accept-encoding'] ?? '').split(',').some((value) => {
    const [name, ...parameters] = value.trim().split(';');
    return (
      name === encoding &&
      !parameters.some((parameter) => /^q\s*=\s*0(?:\.0*)?\s*$/.test(parameter.trim()))
    );
  });
}

/** Static bytes only. Match setup, cookies and private state never enter this cache. */
export class EngineAssets {
  private readonly cache = new Map<string, Asset>();
  private readonly loading = new Map<string, Promise<Asset>>();
  private size = 0;
  private trim() {
    while (this.size > 64 * 1024 * 1024 && this.cache.size > 1) {
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
    options: { immutable?: boolean; transform?: ((content: string) => string) | undefined } = {},
  ) {
    const info = await stat(file);
    const stamp = `${info.mtimeMs}:${info.size}`;
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
          const prepared: Asset = {
            stamp,
            bytes,
            etag: `W/"${createHash('sha256').update(bytes).digest('hex')}"`,
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
      options.immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
    );
    response.setHeader('ETag', asset.etag);
    response.setHeader('Vary', 'Accept-Encoding');
    if (
      (request.headers['if-none-match'] ?? '')
        .split(',')
        .map((value) => value.trim())
        .includes(asset.etag)
    ) {
      response.writeHead(304);
      response.end();
      return;
    }
    const encoding =
      /javascript|text\/|json|svg/.test(mime) && asset.bytes.length > 1024
        ? accepts(request, 'br')
          ? 'br'
          : accepts(request, 'gzip')
            ? 'gzip'
            : undefined
        : undefined;
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
