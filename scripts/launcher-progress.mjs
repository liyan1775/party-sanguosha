// SPDX-License-Identifier: GPL-3.0-only
import http from 'node:http';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

function renderHtml(entryMode) {
  const modeLabel = entryMode === 'lan' ? '局域网联机' : '局域网与公网联机';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>正在启动 · 聚会三国杀</title>
  <meta name="color-scheme" content="light dark" />
  <style>
    *,*::before,*::after{box-sizing:border-box}
    :root{
      --bg:#eef4f3;--paper:#fffefb;--ink:#132430;--muted:#415a69;
      --jade:#1f7d72;--jade-ink:#17645c;--wash:#eaf3ef;--gold:#b88b35;
      --gold-ink:#76551c;--line:#d8c69f;--seal:#a8332c;--error:#8b2923;
      --error-bg:#fff1eb;--shade:#102e5626;--heading:"Songti SC",STSong,SimSun,serif;
      background:var(--bg);color:var(--ink);
    }
    @media (prefers-color-scheme:dark){
      :root{
        --bg:#081017;--paper:#11202c;--ink:#eff6f7;--muted:#adc4cf;
        --jade:#5cc9bc;--jade-ink:#80d7ca;--wash:#18343c;--gold:#e0be75;
        --gold-ink:#f5df9e;--line:#626048;--error:#ffbcb1;
        --error-bg:#402725;--shade:#00060c99;
      }
    }
    body{
      margin:0;padding:clamp(24px,9vw,96px) clamp(12px,4vw,32px);
      font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei UI",sans-serif;
    }
    .panel{
      max-width:42rem;margin-inline:auto;padding:clamp(16px,5vw,36px);
      background:linear-gradient(150deg,var(--wash),transparent 35%),var(--paper);
      border:1px solid var(--gold);border-radius:4px;
      box-shadow:0 16px 44px var(--shade),inset 0 0 0 4px var(--paper),inset 0 0 0 5px var(--line);
    }
    p,h1,h2{margin:0}
    .head{display:flex;align-items:center;gap:14px;padding-bottom:20px;border-bottom:1px solid var(--line)}
    .seal{
      width:48px;height:48px;background:var(--seal);color:#fff8ec;flex:none;
      display:grid;place-items:center;font:900 28px/1 var(--heading);
      border:1px solid var(--seal);border-radius:3px;box-shadow:inset 0 0 0 2px #fff8ec8c;
    }
    h1{font:700 clamp(24px,5vw,34px)/1.2 var(--heading);letter-spacing:.06em}
    .sub{font-size:.82rem;color:var(--gold-ink);margin-top:5px}
    .stage-title{font:700 1.25rem/1.45 var(--heading);margin:20px 0 5px;color:var(--jade-ink)}
    .detail{font-size:.875rem;line-height:1.55;color:var(--muted);margin-bottom:16px;overflow-wrap:anywhere}
    progress{display:block;appearance:none;width:100%;height:9px;border:0;border-radius:9px;background:var(--wash);accent-color:var(--jade)}
    progress::-webkit-progress-bar{background:var(--wash);border-radius:9px}
    progress::-webkit-progress-value{background:linear-gradient(90deg,var(--jade),var(--gold));border-radius:9px}
    progress::-moz-progress-bar{background:linear-gradient(90deg,var(--jade),var(--gold));border-radius:9px}
    .meta{display:flex;justify-content:space-between;font-size:.78rem;color:var(--muted);margin-top:8px;font-variant-numeric:tabular-nums}
    .steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0;padding:0;list-style:none}
    .step{padding:8px 5px;border:1px solid var(--line);border-radius:3px;font-size:.78rem;color:var(--muted);text-align:center}
    .step[aria-current]{border-color:var(--jade);background:var(--wash);color:var(--jade-ink);font-weight:700}
    .step.done{color:var(--gold-ink)}
    details{border-top:1px solid var(--line);padding-top:12px;color:var(--muted);font-size:.82rem}
    summary{width:fit-content;cursor:pointer;padding:4px 0}
    :focus-visible{outline:2px solid var(--jade);outline-offset:3px}
    .logs{
      max-height:9rem;overflow-y:auto;margin-top:8px;padding:10px 12px;font:12px/1.55 ui-monospace,Consolas,monospace;
      background:var(--wash);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;
    }
    .err-box{
      margin-top:14px;padding:12px 14px;background:var(--error-bg);border-left:3px solid var(--error);
      color:var(--error);font-size:.85rem;line-height:1.65;overflow-wrap:anywhere;
    }
    .err-box p+p{margin-top:6px}
    .safe-note{margin-top:14px;font-size:.78rem;color:var(--muted);line-height:1.6}
    .go-btn{
      display:inline-block;margin-top:16px;padding:11px 18px;background:#114c45;
      color:#fffaf0;border:1px solid var(--gold);border-radius:3px;font-weight:700;text-decoration:none;
    }
    [hidden]{display:none}
    @media(max-width:520px){.steps{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head>
<body>
  <main class="panel">
    <div class="head">
      <div class="seal" aria-hidden="true">杀</div>
      <div>
        <h1>聚会三国杀</h1>
        <p class="sub">本机启动 · ${modeLabel}</p>
      </div>
    </div>
    <h2 class="stage-title" id="stage" aria-live="polite">正在连接本机服务…</h2>
    <p class="detail" id="detail">正在检查运行环境与本地资源，就绪后自动打开联机与观战页。</p>
    <progress id="progress" max="100" aria-label="启动进度"></progress>
    <div class="meta"><span id="pct" aria-hidden="true">准备中…</span><span id="elapsed">已等待 0 秒</span></div>
    <ol class="steps" aria-label="启动步骤">
      <li class="step" data-s="1">1. 核对环境</li>
      <li class="step" data-s="2">2. 准备资源</li>
      <li class="step" data-s="3">3. 启动引擎</li>
      <li class="step" data-s="4">4. 联机与观战</li>
    </ol>
    <details>
      <summary>启动日志</summary>
      <div class="logs" id="logs" tabindex="0">正在等待启动日志…</div>
    </details>
    <div class="err-box" id="err" role="alert" hidden>
      <p id="error-message"></p>
      <p>请检查网络或系统代理，再双击原启动入口重试。已校验的资源会继续复用，下载可断点续传。</p>
      <p>完整错误日志：<code>.runtime/server-error.log</code></p>
    </div>
    <a class="go-btn" id="go" hidden>进入联机与观战 →</a>
    <p class="safe-note">准备资源不会覆盖山河册与自定义将池。</p>
  </main>
  <script>
    const started = Date.now();
    const stageEl = document.getElementById('stage');
    const detailEl = document.getElementById('detail');
    const progressEl = document.getElementById('progress');
    const pctEl = document.getElementById('pct');
    const elapsedEl = document.getElementById('elapsed');
    const logsEl = document.getElementById('logs');
    const errEl = document.getElementById('err');
    const errorMessageEl = document.getElementById('error-message');
    const goEl = document.getElementById('go');
    let stopped = false;

    async function poll() {
      if (stopped) return;
      elapsedEl.textContent = '已等待 ' + Math.max(0, Math.round((Date.now() - started) / 1000)) + ' 秒';
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) throw new Error('status');
        const data = await res.json();
        const title = data.stageTitle || '正在准备…';
        if (stageEl.textContent !== title) stageEl.textContent = title;
        detailEl.textContent = data.detail || '';
        progressEl.value = data.percent || 0;
        pctEl.textContent = progressEl.value + '%';
        document.querySelectorAll('.step').forEach((node) => {
          const step = Number(node.dataset.s);
          node.classList.toggle('done', step < data.step || data.state === 'ready');
          if (step === data.step && data.state === 'running') node.setAttribute('aria-current', 'step');
          else node.removeAttribute('aria-current');
        });
        if (Array.isArray(data.logs) && data.logs.length) {
          const logs = data.logs.join('\\n');
          if (logsEl.textContent !== logs) {
            const atEnd = logsEl.scrollHeight - logsEl.clientHeight - logsEl.scrollTop <= 2;
            logsEl.textContent = logs;
            if (atEnd) logsEl.scrollTop = logsEl.scrollHeight;
          }
        }
        if (data.state === 'ready' && data.redirectUrl) {
          stopped = true;
          goEl.href = data.redirectUrl;
          goEl.hidden = false;
          setTimeout(() => location.replace(data.redirectUrl), data.redirectDelayMs ?? 450);
          return;
        }
        if (data.state === 'failed') {
          stopped = true;
          errorMessageEl.textContent = '启动未完成：' + (data.error || '未知错误');
          errEl.hidden = false;
          return;
        }
      } catch {
        // 进度服务关闭时可能正完成交接
      }
      setTimeout(poll, 450);
    }
    poll();
  </script>
</body>
</html>`;
}

export async function startProgressServer({ runtimeDir, entryMode }) {
  const state = {
    state: 'running',
    step: 1,
    percent: 10,
    stageTitle: '正在检查运行环境…',
    detail: '首次打开将自动校验并补齐固定游戏资源，已校验文件会自动复用。',
    logs: [],
    redirectUrl: null,
    redirectDelayMs: null,
    error: null,
  };
  let port = 0;
  const html = renderHtml(entryMode);
  const progressFile = path.join(runtimeDir, 'launcher-progress.json');
  const tempFile = path.join(runtimeDir, `launcher-progress.${process.pid}.tmp`);

  const server = http.createServer((req, res) => {
    const host = String(req.headers.host ?? '');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const urlPath = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
    if (urlPath === '/api/status') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(state));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });

  const url = `http://127.0.0.1:${port}/`;
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    tempFile,
    JSON.stringify({ url, pid: process.pid, entryMode, startedAt: Date.now() }),
    'utf8',
  );
  await rename(tempFile, progressFile);

  const pushLog = (line) => {
    const clean = String(line ?? '').trim();
    if (!clean) return;
    state.logs.push(clean.slice(0, 260));
    if (state.logs.length > 40) state.logs.shift();
    state.detail = clean.slice(0, 140);
    const ratio = clean.match(/(\d+)\s*\/\s*(\d+)/);
    if (ratio) {
      const done = Number(ratio[1]);
      const total = Number(ratio[2]);
      if (total > 0 && done <= total) {
        const sub = Math.round((done / total) * 55);
        state.percent = Math.max(state.percent, Math.min(82, 22 + sub));
      }
    }
  };

  return {
    url,
    update(patch) {
      Object.assign(state, patch);
    },
    pushLog,
    setReady(redirectUrl, notice) {
      state.state = 'ready';
      state.step = 4;
      state.percent = 100;
      state.stageTitle = notice ? '保留正在运行的服务' : '本机服务已就绪，正在打开联机与观战页…';
      state.detail = notice ?? redirectUrl;
      state.redirectUrl = redirectUrl;
      state.redirectDelayMs = notice ? 7000 : null;
    },
    setFailed(errorMessage) {
      state.state = 'failed';
      state.stageTitle = '启动准备遇到问题';
      state.error = String(errorMessage ?? '未知错误').slice(0, 400);
    },
    async close() {
      await unlink(progressFile).catch(() => {});
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
