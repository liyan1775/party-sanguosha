// SPDX-License-Identifier: GPL-3.0-only
import http from 'node:http';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

function renderHtml(version, entryMode) {
  const modeLabel = entryMode === 'lan' ? '局域网同 Wi-Fi 模式' : '局域网 + 跨网双码模式';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>正在启动 · 聚会三国杀 v${version}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#edf4f2;--card:#fffefb;--ink:#132430;--ink2:#47606f;--gold:#b88b35;
      --jade:#1f7d72;--jade2:#114c45;--red:#c73c32;--line:rgba(184,139,53,.42);
    }
    @media (prefers-color-scheme:dark){
      :root{--bg:#09121a;--card:#11202c;--ink:#f0f6f7;--ink2:#a9c2ce;--gold:#e0be75;--jade:#5cc9bc;--jade2:#196b63;--red:#e25347;--line:rgba(224,190,117,.38)}
    }
    body{
      min-height:100vh;display:grid;place-items:center;padding:24px;
      font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei UI",sans-serif;
      background:radial-gradient(circle at 75% 20%,rgba(31,125,114,.16),transparent 46%),radial-gradient(circle at 20% 85%,rgba(184,139,53,.14),transparent 48%),var(--bg);
      color:var(--ink);
    }
    .panel{
      width:min(680px,96vw);padding:32px 34px;background:var(--card);
      border:1.5px solid var(--line);position:relative;
      clip-path:polygon(14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px),0 14px);
      box-shadow:0 24px 60px -18px rgba(10,36,44,.28);
    }
    .head{display:flex;align-items:center;gap:14px;margin-bottom:20px}
    .seal{
      width:44px;height:44px;background:var(--red);color:#fff8ec;flex:none;
      display:grid;place-items:center;font-family:"Songti SC",STSong,SimSun,serif;font-size:24px;font-weight:900;
      border:1.5px solid rgba(255,235,200,.65);
    }
    h1{font-family:"Songti SC",STSong,SimSun,serif;font-size:26px;letter-spacing:.08em}
    .sub{font-size:12.5px;color:var(--ink2);margin-top:3px}
    .stage-title{font-family:"Songti SC",STSong,SimSun,serif;font-size:19px;font-weight:800;margin-bottom:6px;color:var(--jade)}
    .detail{font-size:13.5px;color:var(--ink2);margin-bottom:16px;min-height:22px}
    .track{height:10px;background:rgba(184,139,53,.18);overflow:hidden;border:1px solid var(--line);margin-bottom:10px}
    .fill{height:100%;width:12%;background:linear-gradient(90deg,var(--jade),var(--gold));transition:width 320ms ease}
    .meta{display:flex;justify-content:space-between;font-size:12px;color:var(--ink2);margin-bottom:18px}
    .steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px}
    .step{padding:8px 10px;border:1px solid var(--line);font-size:12px;color:var(--ink2);text-align:center}
    .step.on{border-color:var(--jade);background:rgba(31,125,114,.1);color:var(--ink);font-weight:700}
    .step.done{border-color:var(--gold);color:var(--gold)}
    .logs{
      max-height:132px;overflow-y:auto;padding:10px 12px;font:12px/1.55 ui-monospace,Consolas,monospace;
      background:rgba(16,36,44,.06);border:1px solid var(--line);color:var(--ink2);white-space:pre-wrap;word-break:break-word;
    }
    .err-box{
      margin-top:14px;padding:12px 14px;background:rgba(199,60,50,.11);border-left:3.5px solid var(--red);
      color:var(--red);font-size:13px;line-height:1.6;display:none;
    }
    .safe-note{margin-top:16px;font-size:12px;color:var(--ink2);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
    .go-btn{
      display:none;margin-top:16px;padding:11px 22px;background:linear-gradient(168deg,var(--jade),var(--jade2));
      color:#fffaf0;border:1px solid var(--gold);font-weight:700;text-decoration:none;text-align:center;
    }
    @media(max-width:560px){.steps{grid-template-columns:repeat(2,1fr)}.panel{padding:22px 18px}}
  </style>
</head>
<body>
  <main class="panel">
    <div class="head">
      <div class="seal" aria-hidden="true">杀</div>
      <div>
        <h1>聚会三国杀 v${version}</h1>
        <p class="sub">${modeLabel} · 首次准备自动断点续传，升级不覆盖山河册与将池存档</p>
      </div>
    </div>
    <div class="stage-title" id="stage">正在唤醒本机引擎…</div>
    <p class="detail" id="detail">正在检查运行环境与本地资源，就绪后自动进入客厅大屏。</p>
    <div class="track"><div class="fill" id="fill"></div></div>
    <div class="meta"><span id="pct">准备中…</span><span id="elapsed">已等待 0 秒</span></div>
    <div class="steps">
      <div class="step" data-s="1">1. 环境核对</div>
      <div class="step" data-s="2">2. 资源与立绘</div>
      <div class="step" data-s="3">3. 引擎就绪</div>
      <div class="step" data-s="4">4. 打开客厅大屏</div>
    </div>
    <div class="logs" id="logs">正在连接启动进度…</div>
    <div class="err-box" id="err"></div>
    <a class="go-btn" id="go" href="#">立即进入客厅大屏 →</a>
    <div class="safe-note">
      <span>存档受保护：data/shanhetu 与 data/rosters 绝不覆写</span>
      <span>日志位于 .runtime 目录</span>
    </div>
  </main>
  <script>
    const started = Date.now();
    const stageEl = document.getElementById('stage');
    const detailEl = document.getElementById('detail');
    const fillEl = document.getElementById('fill');
    const pctEl = document.getElementById('pct');
    const elapsedEl = document.getElementById('elapsed');
    const logsEl = document.getElementById('logs');
    const errEl = document.getElementById('err');
    const goEl = document.getElementById('go');
    let stopped = false;

    async function poll() {
      if (stopped) return;
      elapsedEl.textContent = '已等待 ' + Math.max(0, Math.round((Date.now() - started) / 1000)) + ' 秒';
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) throw new Error('status');
        const data = await res.json();
        stageEl.textContent = data.stageTitle || '正在准备…';
        detailEl.textContent = data.detail || '';
        fillEl.style.width = Math.max(8, Math.min(100, data.percent || 10)) + '%';
        pctEl.textContent = (data.percent || 0) + '%';
        document.querySelectorAll('.step').forEach((node) => {
          const n = Number(node.dataset.s);
          node.classList.toggle('done', n < data.step);
          node.classList.toggle('on', n === data.step);
        });
        if (Array.isArray(data.logs) && data.logs.length) {
          logsEl.textContent = data.logs.join('\\n');
          logsEl.scrollTop = logsEl.scrollHeight;
        }
        if (data.state === 'ready' && data.redirectUrl) {
          stopped = true;
          goEl.href = data.redirectUrl;
          goEl.style.display = 'inline-block';
          stageEl.textContent = '准备完成，正在进入客厅大屏…';
          setTimeout(() => location.replace(data.redirectUrl), 450);
          return;
        }
        if (data.state === 'failed') {
          stopped = true;
          errEl.style.display = 'block';
          errEl.textContent =
            '启动未完成：' + (data.error || '未知错误') +
            '\\n排查建议：1) 首次使用需联网下载约 441 MiB 无名杀固定资源，中断后再次双击可断点补齐；2) 若网络受限请检查系统代理；3) 完整日志见 .runtime/server-error.log。';
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

export async function startProgressServer({ runtimeDir, version, entryMode }) {
  const state = {
    state: 'running',
    step: 1,
    percent: 10,
    stageTitle: '正在检查运行环境…',
    detail: '首次打开将自动校验并补齐固定游戏资源，已校验文件会自动复用。',
    logs: [],
    redirectUrl: null,
    error: null,
  };
  let port = 0;
  const html = renderHtml(version, entryMode);
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
    setReady(redirectUrl) {
      state.state = 'ready';
      state.step = 4;
      state.percent = 100;
      state.stageTitle = '本机服务已就绪，正在进入客厅大屏…';
      state.detail = redirectUrl;
      state.redirectUrl = redirectUrl;
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
