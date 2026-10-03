import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachLabRelay } from './relay.mjs';

const labRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(labRoot, '../../..');
const engineRoot = resolve(projectRoot, '.local/noname/v1.11.6');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

// This development-only service exposes the pinned engine, never the workspace.
function engineFile(path) {
  if (path.includes('\\') || path.includes('\0')) throw new Error('Invalid path');
  const file = resolve(engineRoot, path.replace(/^\/+/, ''));
  const within = relative(engineRoot, file);
  if (within.startsWith('..') || isAbsolute(within)) throw new Error('Invalid path');
  return file;
}

async function configuration() {
  const config = JSON.parse(await readFile(engineFile('game/config.json'), 'utf8'));
  Object.assign(config, {
    mode: 'party_duel_lab',
    characters: ['standard'],
    cards: ['standard'],
    extensions: [],
    plays: [],
    show_splash: 'off',
    totouched: true,
    touchscreen: true,
    phonelayout: true,
    compatible: false,
    background_music: 'music_off',
    background_audio: false,
    background_speak: false,
    animation: false,
    low_performance: true,
    game_speed: 'vvfast',
    sync_speed: false,
    show_disclaimer: false,
    new_tutorial: true,
    video: '0',
    card_style: 'default',
    version: '1.11.6',
  });
  Object.assign(config.mode_config.global, {
    player_number: 2,
    free_choose: false,
    change_identity: false,
    swap: false,
    save_progress: false,
  });
  config.mode_config.single = { single_mode: 'dianjiang', change_card: false };
  config.all.stockmode.push('party_duel_lab');
  config.all.sgsmodes.push('party_duel_lab');
  return config;
}

function json(response, data) {
  response.writeHead(200, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

export async function startEngineLab({ host = '127.0.0.1', port = 0, humanCount = 1 } = {}) {
  if (![1, 2].includes(humanCount)) throw new Error('Lab human count must be 1 or 2.');
  await stat(engineFile('noname.js'));
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.writeHead(405).end();
        return;
      }
      const url = new URL(request.url, 'http://lab.local');
      if (url.pathname === '/api/lab-setup') {
        json(response, {
          seats: [
            { id: 'human-1', nickname: '测试玩家 1', kind: 'human' },
            {
              id: humanCount === 2 ? 'human-2' : 'native-ai',
              nickname: humanCount === 2 ? '测试玩家 2' : '原生 AI',
              kind: humanCount === 2 ? 'human' : 'bot',
            },
          ],
        });
        return;
      }
      if (url.pathname === '/checkFile') {
        const path = engineFile(url.searchParams.get('fileName') ?? '');
        const info = await stat(path).catch(() => null);
        json(response, {
          success: true,
          data: info?.isFile() ? 'file' : info?.isDirectory() ? 'directory' : null,
        });
        return;
      }
      if (url.pathname === '/getFileList') {
        const entries = await readdir(engineFile(url.searchParams.get('dir') ?? ''), {
          withFileTypes: true,
        }).catch((error) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        });
        json(response, {
          success: true,
          data: {
            folders: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
            files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
          },
        });
        return;
      }
      if (url.pathname === '/game/config.json') {
        json(response, await configuration());
        return;
      }
      if (url.pathname === '/game/package.js') {
        const upstream = await readFile(engineFile('game/package.js'), 'utf8');
        response.writeHead(200, { 'Content-Type': types['.js'] });
        response.end(`${upstream}\nwindow.noname_package.mode.party_duel_lab = '聚会单挑验证';\n`);
        return;
      }
      const path =
        url.pathname === '/'
          ? resolve(labRoot, 'index.html')
          : url.pathname === '/party-lab.js'
            ? resolve(labRoot, 'bootstrap.js')
            : url.pathname === '/party-relay.js'
              ? resolve(labRoot, 'relay.js')
              : ['/mode/party_duel_lab.js', '/mode/party_duel_lab/index.js'].includes(url.pathname)
                ? resolve(labRoot, 'duel-mode.js')
                : engineFile(decodeURIComponent(url.pathname));
      const bytes = await readFile(path);
      response.writeHead(200, {
        'Content-Type': types[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400).end();
    }
  });
  const closeRelay = attachLabRelay(server, humanCount);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return {
    port: server.address().port,
    close: () =>
      new Promise((resolve, reject) => {
        closeRelay();
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lab = await startEngineLab({ host: '127.0.0.1', port: 3010 });
  console.log(`Noname development lab: http://127.0.0.1:${lab.port}/`);
}
