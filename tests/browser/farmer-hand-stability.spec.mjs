// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const runtime = new URL('../../packages/noname-adapter/runtime/', import.meta.url);
async function openTable(page, font, zoom) {
  await page.setViewportSize({ width: 640, height: 320 });
  await page.route('http://fixture.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><style>
          body {margin:0;zoom:${zoom}}
          .player {position:absolute;left:120px;top:100px;width:64px;height:90px}
          #party-farmer-hand-toggle, .party-farmer-toggle {font-size:${font}px !important}
        </style><script type="importmap">{"imports":{"noname":"/noname.js"}}</script>
        <div id="mate" class="player"></div>`,
      });
    if (path === '/noname.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: `const mate = document.getElementById('mate');
          export const lib = {playerOL:{mate}, onover:[]}, game = {players:[mate],dead:[],documentZoom:${zoom}},
          get = {translation:x=>x}, ui = {}, _status = {};`,
      });
    if (['/farmer-hands.js', '/privacy.js'].includes(path))
      return route.fulfill({
        path: fileURLToPath(new URL(path.slice(1), runtime)),
        contentType: 'application/javascript',
      });
    return route.abort();
  });
  await page.goto('http://fixture.test/');
}

for (const [count, font, zoom] of [
  [4, 12, 1],
  [10, 16, 0.85],
]) {
  test(`队友牌临界位置静止后停止调度（${count}张、${font}px、缩放${zoom}）`, async ({ page }) => {
    await openTable(page, font, zoom);
    const samples = await page.evaluate(
      async ({ count, zoom }) => {
        const nativeFrame = window.requestAnimationFrame.bind(window);
        const tick = () => new Promise(nativeFrame);
        let pending = 0;
        window.requestAnimationFrame = (callback) => {
          pending++;
          return nativeFrame((now) => {
            pending--;
            callback(now);
          });
        };
        window.partyEngine = { setup: {} };
        const { installFarmerHandView } = await import('/farmer-hands.js');
        installFarmerHandView();
        partyEngine.updateFarmerHands(
          Array.from({ length: count }, () => ({ name: '杀' })),
          'mate',
          '队友',
        );
        await tick();
        const button = document.querySelector('#party-farmer-hand-toggle');
        const tray = document.querySelector('#party-farmer-hand');

        // At this boundary the old shorter title hits the obstacle and the
        // longer title clears it. Measure both with this browser's actual font.
        const probe = button.cloneNode(false);
        probe.removeAttribute('id');
        button.after(probe);
        probe.textContent = `队友手牌 ${count}张`;
        const normal = probe.getBoundingClientRect().right;
        probe.textContent = `手牌${count}张 · 暂收起`;
        const tucked = probe.getBoundingClientRect().right;
        probe.remove();
        if (tucked <= normal + 1) throw new Error('字体夹具未形成宽窄差异');
        const obstacle = document.createElement('div');
        obstacle.className = 'prompt';
        obstacle.style.cssText = `position:absolute;top:0;left:0;width:${(normal + tucked) / (2 * zoom)}px;height:${innerHeight / zoom}px;pointer-events:none`;
        document.body.append(obstacle);
        button.click();
        await tick();
        await tick();
        const frames = [];
        for (let i = 0; i < 20; i++) {
          await tick();
          frames.push({ hidden: tray.hidden, text: button.innerText.trim(), pending });
        }
        return frames;
      },
      { count, zoom },
    );
    expect(samples, '临界尺寸下应稳定展开，标题不翻转，布局回调队列归零').toEqual(
      Array.from({ length: 20 }, () => ({
        hidden: false,
        text: `队友手牌 ${count}张`,
        pending: 0,
      })),
    );
  });
}

test('延迟移入的询问首击命中，无限动效和取消后不空转', async ({ page }) => {
  await openTable(page, 12, 1);
  await page.evaluate(async () => {
    window.nativeFrame = window.requestAnimationFrame.bind(window);
    window.layoutCallbacks = 0;
    window.requestAnimationFrame = (callback) =>
      nativeFrame((now) => {
        layoutCallbacks++;
        callback(now);
      });
    sessionStorage.setItem('party_farmer_hand_open', '1');
    window.partyEngine = { setup: {} };
    const { installFarmerHandView } = await import('/farmer-hands.js');
    installFarmerHandView();
    partyEngine.updateFarmerHands(
      Array.from({ length: 10 }, () => ({ name: '杀' })),
      'mate',
      '队友',
    );
  });
  const tray = page.locator('#party-farmer-hand');
  await expect(tray).toBeVisible();
  const point = await tray.evaluate(async (node) => {
    const box = node.getBoundingClientRect();
    const prompt = document.createElement('button');
    prompt.id = 'moving';
    prompt.className = 'prompt';
    prompt.style.cssText = 'position:fixed;top:0;left:0;width:40px;height:30px';
    prompt.onclick = () => (prompt.dataset.clicked = 'yes');
    document.body.append(prompt);
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const style = document.createElement('style');
    style.textContent = `@keyframes travel {0%,55% {transform:translate(0,0)} 85%,100% {transform:translate(${x - 20}px,${y - 15}px)}} @keyframes gleam {to {opacity:0.2}}`;
    document.head.append(style);
    prompt.style.animation = 'travel 1500ms linear forwards';
    const animation = prompt.getAnimations()[0];
    await animation.ready;
    while (animation.currentTime < 1300) await new Promise(requestAnimationFrame);
    if (animation.currentTime >= 1500 || document.elementFromPoint(x, y) !== prompt)
      throw new Error('询问在动画后段被牌条拦截');
    return { x, y };
  });
  await page.mouse.click(point.x, point.y);
  const prompt = page.locator('#moving');
  await expect(prompt).toHaveAttribute('data-clicked', 'yes');
  async function checkSettled(visible) {
    if (visible) await expect(tray).toBeVisible();
    else await expect(tray).toBeHidden();
    const reads = await page.evaluate(async () => {
      const tick = () => new Promise(nativeFrame);
      await tick();
      await tick();
      const baseline = layoutCallbacks;
      for (let frame = 0; frame < 16; frame++) await tick();
      return layoutCallbacks - baseline;
    });
    expect(reads, '询问静止或被保守让位后不得持续测量牌条').toBe(0);
  }
  await prompt.evaluate((node) => (node.style.animation = 'gleam 2s infinite alternate'));
  await checkSettled(true);
  await prompt.evaluate((node) => (node.style.animation = 'travel 2s infinite'));
  await checkSettled(false);
  await prompt.evaluate((node) => (node.style.animationPlayState = 'paused'));
  await checkSettled(true);
  await prompt.evaluate((node) => (node.style.animationPlayState = 'running'));
  await checkSettled(false);
  await prompt.evaluate((node) => node.remove());
  await checkSettled(true);
});
