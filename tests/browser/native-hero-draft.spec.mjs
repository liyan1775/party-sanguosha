// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.ts';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = join(root, '.runtime/unified-draft-evidence-20261125');
const desktop = { width: 1280, height: 800 };
const landscape = { width: 844, height: 390 };
const portrait = { width: 390, height: 844 };
const stage = (frame) => frame.locator('.party-native-draft-shell');
const cards = (frame) => stage(frame).locator('.hd-card');
const submit = (frame) => stage(frame).locator('.hd-primary');
const seats = (frame) => stage(frame).locator('.hd-seat');
const offers = (frame) => cards(frame).evaluateAll((nodes) => nodes.map((node) => node.link));

async function table(page) {
  await page.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
  );
  return page.frames().find((frame) => frame.url().includes('/engine/player/'));
}

async function start(browser, mode, nicknames, playerCount, action) {
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, 'native-test-'));
  const party = createPartyServer({
    port: 0,
    webRoot: join(root, 'dist/web'),
    rosterDirectory: join(scratch, 'rosters'),
    shanhetuDirectory: join(scratch, 'shanhetu'),
    adapter: new NativeNonameService(root),
  });
  await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${party.server.address().port}`;
  const contexts = [];
  const errors = [];
  const open = async (options = {}) => {
    const context = await browser.newContext({ viewport: desktop, ...options });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${message.location().url} ${message.text()}`);
    });
    page.on('response', (response) => {
      if (response.status() === 404) errors.push(response.url());
    });
    return page;
  };
  try {
    const computer = await open();
    for (const [name, mime] of [
      ['hero-draft.js', /javascript/],
      ['hero-draft.css', /text\/css/],
      ['hero-draft-native.css', /text\/css/],
    ]) {
      const asset = await computer.request.get(`${base}/engine/runtime/${name}`);
      expect(asset.ok()).toBe(true);
      expect(asset.headers()['content-type']).toMatch(mime);
    }
    // Stabilize who has the first selection for these screenshots. Keep the
    // actual rule, connection, deadline and AI paths in the worker.
    await computer.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      const seatSetup = 'const seats = setup.seats.slice().randomSort();';
      expect(body).toContain(seatSetup);
      body = body
        .replace(seatSetup, 'const seats = setup.seats.slice();')
        .replace('await game.phaseLoop(first);', 'await game.pause();');
      if (mode === 'identity') {
        const roleSetup =
          "const roles = identities(setup.shanhetu ? 'shanhetu' : setup.settings.mode, seats.length);";
        expect(body).toContain(roleSetup);
        body = body.replace(
          roleSetup,
          "const roles = ['fan', 'zhu', 'zhong', 'zhong', 'fan', 'fan', 'fan', 'nei'];",
        );
      }
      await route.fulfill({ response, body });
    });
    await computer.goto(`${base}/server`);
    const pages = await Promise.all(
      nicknames.map((_, i) =>
        open(i === 1 && mode === 'duel' ? { isMobile: true, hasTouch: true } : {}),
      ),
    );
    const [owner] = pages;
    const room = await owner.request.post(`${base}/api/rooms`, {
      data: { nickname: nicknames[0] },
    });
    expect(room.ok()).toBe(true);
    const { code } = (await room.json()).room;
    const settings = await owner.request.put(`${base}/api/rooms/${code}`, {
      data: {
        mode,
        playerCount,
        generalPreset: mode === 'duel' ? 'ol-sgl-2026-stage1' : 'beginner',
        allowGeneralSelection: mode === 'duel',
        extensions: [],
      },
    });
    expect(settings.ok()).toBe(true);
    const url = `${base}/join/${code}`;
    await Promise.all(pages.map((page) => page.goto(url)));
    // Join in order so a given nickname owns the same evidence seat.
    for (const [i, page] of pages.slice(1).entries()) {
      await page.locator('#nickname').fill(nicknames[i + 1]);
      await page.locator('#join-button').click();
      await expect(page.locator('#ready-button')).toBeEnabled();
    }
    if (pages.length < playerCount) {
      const bots = await owner.request.post(`${base}/api/rooms/${code}/bots`, {
        data: { count: playerCount - pages.length },
      });
      expect(bots.ok()).toBe(true);
    }
    if (mode === 'duel') {
      for (const [index, general] of ['shen_zhaoyun', 'ol_sb_dengai'].entries()) {
        const choice = await pages[index].request.put(`${base}/api/rooms/${code}/me/general`, {
          data: { general },
        });
        expect(choice.ok(), await choice.text()).toBe(true);
      }
    }
    await Promise.all(pages.map((page) => page.locator('#ready-button').click()));
    await owner.locator('#start-button').click();
    const frames = await Promise.all(pages.map(table));
    const worker = computer.frames().find((frame) => frame.url().includes('/engine/worker/'));
    await action({ pages, frames, worker });
    expect(errors).toEqual([]);
  } finally {
    const closed = once(party.server, 'close');
    party.stop();
    for (const context of contexts) await context.close();
    party.server.closeAllConnections();
    await closed;
    await rm(scratch, { recursive: true, force: true });
  }
}

async function assertLayout(frame, playerCount) {
  await expect(stage(frame)).toBeVisible();
  await expect(seats(frame)).toHaveCount(playerCount);
  await expect(seats(frame).locator('strong')).toHaveText(
    Array.from({ length: playerCount }, (_, index) => `${index + 1}位`),
  );
  await expect(
    seats(frame).filter({ has: frame.locator('.hd-flag', { hasText: /^你$/ }) }),
  ).toHaveCount(1);
  await expect(stage(frame).locator('.hd-clock')).toHaveText(/^\d+ 秒$/);
  const invalid = () =>
    stage(frame).evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      const box = (name) => root.querySelector(name).getBoundingClientRect();
      if (Math.abs(bounds.width / root.offsetWidth - 1) > 0.07 || box('.hd-primary').height < 32)
        return '原生牌桌缩放影响了选将字号或触控按钮';
      const [head, work, foot] = ['.hd-header', '.hd-workspace', '.hd-actions'].map(box);
      if (head.bottom > work.top + 1 || work.bottom > foot.top + 1) return '主区与情报或操作重叠';
      if (foot.bottom > bounds.bottom + 1 || head.top < bounds.top - 1) return '顶部或底部越界';
      const confirm = box('.hd-primary');
      const hit = document.elementFromPoint(
        (confirm.left + confirm.right) / 2,
        (confirm.top + confirm.bottom) / 2,
      );
      if (!hit?.closest('.hd-primary')) return '底部确认按钮被牌桌遮挡';
      if (work.height < 75) return '候选主区被压缩';
      const rows = [...root.querySelectorAll('.hd-seat')];
      if (
        rows.some((r) => r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1)
      )
        return '座次信息溢出';
      const scroll = root.querySelector('.hd-scroll');
      if (getComputedStyle(scroll).display !== 'none' && scroll.getBoundingClientRect().width < 185)
        return `技能卷轴被压缩到 ${scroll.getBoundingClientRect().width}px（选将台 ${bounds.width}px）`;
      for (const portrait of root.querySelectorAll('.hd-card img')) {
        const r = portrait.getBoundingClientRect();
        if (!r.width && root.classList.contains('detail-open')) continue;
        if (r.width < 40 || r.height < r.width * 1.3) return '候选立绘比例不正确';
      }
      const pool = box('.hd-pool');
      const portrait = matchMedia('(max-width: 500px) and (orientation: portrait)').matches;
      if (!portrait) {
        const names = [...root.querySelectorAll('.hd-card-name')];
        for (const [i, node] of names.entries()) {
          const name = node.getBoundingClientRect();
          const card = node.closest('.hd-card').getBoundingClientRect();
          if (
            name.top < Math.max(0, pool.top, card.top) - 1 ||
            name.bottom > Math.min(innerHeight, pool.bottom, card.bottom) + 1 ||
            name.left < Math.max(0, pool.left, card.left) - 1 ||
            name.right > Math.min(innerWidth, pool.right, card.right) + 1 ||
            name.height < 10 ||
            node.scrollHeight > node.clientHeight + 1 ||
            node.scrollWidth > node.clientWidth + 1
          )
            return `第 ${i + 1}/${names.length} 张候选「${node.textContent}」将名未完整显示`;
        }
      }
      return null;
    });
  await expect.poll(invalid).toBeNull();
}

async function fitViewport(page, viewport) {
  const current = page.viewportSize();
  if (current.width !== viewport.width || current.height !== viewport.height)
    await page.setViewportSize(viewport);
  if (viewport.width < viewport.height) {
    const orientation = page.locator('#match-orientation');
    await expect(orientation).toBeVisible();
    if ((await orientation.textContent()) === '竖屏显示') await orientation.click();
    await expect(orientation).toHaveText('横屏牌桌');
  }
}

async function assertDarkToolbar(page, viewport) {
  const panel = page.locator('#match-panel');
  const toolbar = panel.locator('.match-toolbar');
  const share = toolbar.locator('#match-share');
  await expect(panel).toHaveClass(/\bstage-drafting\b/);
  await expect(toolbar).toHaveCSS('background-color', 'rgb(16, 46, 39)');
  await expect(share).toBeVisible();
  await expect(share).toHaveCSS('background-color', 'rgb(32, 62, 50)');
  const controls = ['#match-sound', '#match-emotions', '#match-table-skin'];
  if (viewport.width <= 880 || viewport.height <= 440) {
    await expect(toolbar.locator('#stage-more')).toBeVisible();
    await expect(toolbar.locator('#stage-more')).toHaveCSS('color', 'rgb(244, 215, 142)');
    await expect(toolbar.locator(controls.concat('.match-volume').join(','))).toHaveCount(0);
  } else {
    for (const selector of controls)
      await expect(toolbar.locator(selector)).toHaveCSS('background-color', 'rgb(32, 62, 50)');
  }
}

async function capture(page, frame, label, viewport, count) {
  await fitViewport(page, viewport);
  await assertDarkToolbar(page, viewport);
  await assertLayout(frame, count);
  await expect
    .poll(() =>
      stage(frame)
        .locator('img')
        .evaluateAll((images) => images.every((img) => img.naturalWidth)),
    )
    .toBe(true);
  await page.screenshot({ path: join(evidence, `${label}.png`) });
}

test('统一选将台 · 八席经典身份主公先选，其他暗身份保持保密', async ({ browser }) => {
  test.setTimeout(120000);
  await start(
    browser,
    'identity',
    ['远道反客', '坐镇主公', '忠心近卫'],
    8,
    async ({ pages, frames, worker }) => {
      const [rebel, lord, loyalist] = frames;
      await expect(stage(lord).locator('.hd-self')).toHaveText('你 · 1号位 · 主公');
      await expect(stage(rebel)).toHaveCount(0);
      await expect(stage(loyalist)).toHaveCount(0);
      await expect(submit(lord)).toBeDisabled();
      await cards(lord).first().click();
      await expect(submit(lord)).toBeEnabled();
      await expect(stage(lord).locator('.hd-skills h4').first()).toBeVisible();
      await expect(stage(rebel)).toHaveCount(0);
      await capture(pages[1], lord, 'identity-lord-desktop', desktop, 8);
      await capture(pages[1], lord, 'identity-lord-landscape', landscape, 8);
      await capture(pages[1], lord, 'identity-lord-portrait', portrait, 8);
      const lordName = await cards(lord).first().locator('.hd-card-name').textContent();
      await submit(lord).click();
      await expect(stage(lord)).toHaveCount(0);
      const revealed = await worker.evaluate(() => {
        const current = partyEngine.game.zhu;
        const base = partyEngine.lib.character[current.name1];
        const group = partyEngine.lib.translate[current.group];
        return {
          faction: current.group,
          label:
            group +
            ' · ' +
            (current.hp === current.maxHp ? current.hp : current.hp + '/' + current.maxHp),
          hp: current.hp,
          maxHp: current.maxHp,
          baseHp: base.hp,
          baseMaxHp: base.maxHp,
        };
      });
      expect(revealed.hp).toBe(revealed.baseHp + 1);
      expect(revealed.maxHp).toBe(revealed.baseMaxHp + 1);
      await expect(stage(rebel).locator('.hd-self')).toHaveText('你 · 8号位 · 反贼');
      await expect(stage(loyalist).locator('.hd-self')).toHaveText('你 · 2号位 · 忠臣');
      for (const frame of [rebel, loyalist]) {
        const shownRoles = await seats(frame).locator('.hd-flag').allTextContents();
        expect(shownRoles.filter((text) => /主公|反贼|忠臣|内奸/.test(text)).sort()).toEqual(
          ['主公', frame === rebel ? '反贼' : '忠臣'].sort(),
        );
        const plaque = frame.getByRole('button', { name: `主公 · ${lordName}` });
        await expect(plaque).toBeVisible();
        await expect(stage(frame).locator('.hd-seat .party-draft-lord')).toHaveCount(0);
        await expect(
          stage(frame).locator('.party-draft-self-summary .party-draft-lord'),
        ).toHaveCount(1);
        await expect(plaque.locator('.hd-lord-facts')).toHaveText(revealed.label);
        await expect(plaque.locator('.hd-lord-facts')).toHaveAttribute(
          'data-faction',
          revealed.faction,
        );
        await plaque.click();
        await expect(stage(frame).locator('.hd-scroll-heading h3')).toHaveText(lordName);
        await expect(stage(frame).locator('.hd-detail-facts')).toHaveText(revealed.label);
        await expect(stage(frame).locator('.hd-skills h4').first()).toBeVisible();
      }
      await capture(pages[0], rebel, 'identity-rebel-desktop', desktop, 8);
      await capture(pages[2], loyalist, 'identity-loyalist-landscape', landscape, 8);
      const seatsLayout = await seats(loyalist).evaluateAll((nodes) =>
        nodes.map((node) => {
          const bounds = node.getBoundingClientRect();
          return [Math.round(bounds.top), Math.round(bounds.left), bounds.height];
        }),
      );
      expect(new Set(seatsLayout.map((box) => box[0])).size).toBe(2);
      expect(new Set(seatsLayout.map((box) => box[1])).size).toBe(4);
      expect(Math.max(...seatsLayout.map((box) => box[2]))).toBeLessThanOrEqual(42);
    },
  );
});

test('统一选将台 · 2v2 公开队色和锁将，其他队伍候选保持保密', async ({ browser }) => {
  test.setTimeout(120000);
  await start(browser, 'versus', ['青锋', '赤羽', '赤石', '青萝'], 4, async ({ pages, frames }) => {
    const [first, second, , ally] = frames;
    for (const frame of frames) {
      await assertLayout(frame, 4);
      expect(
        await seats(frame).evaluateAll((nodes) => nodes.map((node) => node.dataset.tone)),
      ).toEqual(['blue', 'red', 'red', 'blue']);
    }
    await expect(stage(first).locator('.hd-self')).toHaveText('你 · 1号位 · 先手 · 蓝队');
    expect(await offers(first)).toEqual(await offers(ally));
    const opposing = new Set(await offers(second));
    expect((await offers(first)).some((name) => opposing.has(name))).toBe(false);
    const name = await cards(first).first().locator('.hd-card-name').textContent();
    await cards(ally).first().click();
    await expect(submit(ally)).toBeEnabled();
    await cards(first).first().click();
    await submit(first).click();
    await expect(cards(ally).first()).toHaveAttribute('data-taken', 'true');
    await expect(cards(ally).first()).toHaveAttribute('aria-pressed', 'false');
    await expect(submit(ally)).toBeDisabled();
    await expect(seats(ally).first()).toContainText(`队友已锁定 · ${name}`);
    await expect(stage(second)).not.toContainText(name);
    await expect(cards(ally)).toHaveCount(10);
    const picked = cards(ally).nth(1);
    await picked.click();
    const target = await picked.locator('.hd-card-name').textContent();
    const locked = cards(ally).first();
    await locked.focus();
    await expect(stage(ally).locator('.hd-scroll-heading h3')).toHaveText(name);
    await locked.click();
    await expect(stage(ally).locator('.party-draft-viewing')).toHaveText('队友已选 · 只读');
    await expect(stage(ally).locator('.hd-skills h4').first()).toBeVisible();
    await expect(stage(ally).locator('.hd-detail-selection')).toHaveText(`待确认：${target}`);
    await expect(locked).toHaveAttribute('aria-pressed', 'false');
    await expect(picked).toHaveAttribute('aria-pressed', 'true');
    await expect(submit(ally)).toHaveText(`确认出战：${target}`);
    await capture(pages[3], ally, 'versus-team-locked-desktop', desktop, 4);
    await capture(pages[3], ally, 'versus-team-locked-landscape', landscape, 4);
    await fitViewport(pages[3], portrait);
    await expect(stage(ally).locator('.party-draft-viewing')).toHaveText('队友已选 · 只读');
    await expect(submit(ally)).toBeInViewport({ ratio: 1 });
    await capture(pages[3], ally, 'versus-team-readonly-portrait', portrait, 4);
    await stage(ally).getByRole('button', { name: '返回候选' }).click();
    await expect(picked).toBeFocused();
    await capture(pages[3], ally, 'versus-team-locked-portrait', portrait, 4);
    const beforeRefresh = await offers(ally);
    const oldSeconds = Number((await stage(ally).locator('.hd-clock').textContent()).split(' ')[0]);
    await pages[3].reload();
    const recovered = await table(pages[3]);
    await expect(cards(recovered).first()).toHaveAttribute('data-taken', 'true');
    expect(await offers(recovered)).toEqual(beforeRefresh);
    const newSeconds = Number(
      (await stage(recovered).locator('.hd-clock').textContent()).split(' ')[0],
    );
    expect(newSeconds).toBeLessThanOrEqual(oldSeconds + 1);
  });
});

test('统一选将台 · 单挑先后手，三种尺寸、技能抽屉和确认后真实发牌', async ({ browser }) => {
  test.setTimeout(120000);
  await start(browser, 'duel', ['先手关羽', '后手张辽'], 2, async ({ pages, frames, worker }) => {
    const [first, second] = frames;
    await expect(stage(first).locator('.hd-self')).toHaveText('你 · 1号位 · 先手');
    await expect(stage(second).locator('.hd-self')).toHaveText('你 · 2号位 · 后手');
    const pickedName = await cards(first).first().locator('.hd-card-name').textContent();
    await cards(first).first().focus();
    await cards(first).first().press('Enter');
    await expect(stage(first).locator('.hd-scroll-heading h3')).toHaveText(pickedName);
    await expect(submit(first)).toHaveText(`确认出战：${pickedName}`);
    await expect(stage(second)).toBeVisible();
    await expect(cards(second).first().locator('.hd-card-meta')).toHaveText('魏 · 4/5');
    await expect(cards(second).first().locator('.hd-card-meta')).toHaveAttribute(
      'data-faction',
      'wei',
    );
    await capture(pages[0], first, 'duel-desktop', desktop, 2);
    await capture(pages[1], second, 'duel-landscape', landscape, 2);
    await fitViewport(pages[1], portrait);
    await pages[1].locator('#stage-more').click();
    const tools = pages[1].locator('#stage-tools');
    await expect(tools).toBeVisible();
    await expect(tools).toHaveCSS('background-color', 'rgb(16, 46, 39)');
    await expect(tools.locator('#match-sound')).toBeVisible();
    await expect(tools.locator('.match-volume')).toBeVisible();
    const skin = tools.locator('#match-table-skin');
    await expect(skin).toHaveCSS('background-color', 'rgb(32, 62, 50)');
    await skin.selectOption('bamboo');
    await expect(skin).toHaveValue('bamboo');
    const emotions = tools.locator('#match-emotions');
    const previous = await emotions.getAttribute('aria-pressed');
    await emotions.click();
    await expect(emotions).toHaveAttribute('aria-pressed', previous === 'true' ? 'false' : 'true');
    await tools.locator('.close-dialog').click();
    await pages[1].locator('#match-share').click();
    await expect(pages[1].locator('#share-dialog')).toBeVisible();
    await pages[1].locator('#close-share').click();
    const current = cards(second).first();
    const generalName = await current.locator('.hd-card-name').textContent();
    await current.tap();
    await stage(second).getByRole('button', { name: '查看技能' }).click();
    await expect(stage(second).locator('.hd-scroll')).toBeVisible();
    await expect(stage(second).getByRole('button', { name: '查看技能' })).toHaveCount(0);
    await expect(stage(second).getByRole('button', { name: '返回候选' })).toHaveCount(1);
    await expect(stage(second).locator('.hd-scroll-heading h3')).toHaveText(generalName);
    await expect(stage(second).locator('.hd-detail-facts')).toHaveText('魏 · 4/5');
    await expect(stage(second).locator('.hd-detail-selection')).toHaveText(
      `待确认：${generalName}`,
    );
    await capture(pages[1], second, 'duel-portrait-skills', portrait, 2);
    await stage(second).getByRole('button', { name: '返回候选' }).tap();
    await expect(stage(second).locator('.hd-scroll')).toBeHidden();
    await expect(current).toBeFocused();
    await expect(current.locator('.hd-card-name')).toBeInViewport({ ratio: 1 });
    await expect(submit(second)).toBeEnabled();
    await Promise.all([submit(first).click(), submit(second).tap()]);
    await expect(stage(first)).toHaveAttribute('data-draft-kind', 'faction');
    await expect(stage(first).locator('.hd-scroll-heading h3')).toHaveText(pickedName);
    await expect(submit(first)).toBeDisabled();
    await stage(first).locator('.party-draft-factions .hd-card').first().click();
    await expect(submit(first)).toHaveText(/^确认势力：/);
    await capture(pages[0], first, 'duel-faction-desktop', desktop, 2);
    await submit(first).click();
    for (const frame of frames) {
      await expect(stage(frame)).toHaveCount(0);
      await frame.locator('#party-luck-cards button[data-action="keep"]').click();
      await frame.waitForFunction(() => partyEngine.game.me?.countCards('h') >= 4);
    }
    await worker.waitForFunction(() => partyEngine.proof.started);
  });
});
