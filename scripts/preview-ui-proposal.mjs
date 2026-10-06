import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const portraits = new Set([
  'shen_ganning',
  'caocao',
  'zhaoyun',
  'sunquan',
  'diaochan',
  'shen_lvmeng',
  'guanyu',
  'zhenji',
]);
const cards = new Set(['sha', 'shan', 'tao', 'wuxie', 'guohe', 'wuzhong']);
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json'), 'utf8'));
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const portrait = /^\/portraits\/([\w-]+)\.webp$/.exec(path);
  const card = /^\/cards\/([\w-]+)\.png$/.exec(path);
  let file, type;
  if (path === '/') {
    file = 'docs/ui-preview.html';
    type = 'text/html; charset=utf-8';
  } else if (portrait && portraits.has(portrait[1])) {
    file = `dist/engine/portraits/${portrait[1]}.webp`;
    type = 'image/webp';
  } else if (card && cards.has(card[1])) {
    file = `.local/noname/${candidate.tag}/image/card/${card[1]}.png`;
    type = 'image/png';
  } else if (path === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  } else {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(resolve(root, file));
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(`UI 设计预览：http://127.0.0.1:${server.address().port}/`),
);
