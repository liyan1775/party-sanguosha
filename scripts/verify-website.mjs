import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cpus, platform, release } from 'node:os';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const source = fileURLToPath(new URL('../website/', import.meta.url));
const evidence = fileURLToPath(new URL('../.runtime/website-batch2b-20261126/', import.meta.url));
const prefix = '/party-sanguosha/';
const repo = 'https://github.com/liyan1775/party-sanguosha';
const download = repo + '/releases/latest';
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  { name: 'desktop-reduce', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' },
];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const files = new Map();
for (const file of await readdir(source, { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !mime[extname(file.name)]) continue;
  const path = join(file.parentPath, file.name);
  const raw = await readFile(path);
  files.set(relative(source, path).replaceAll('\\', '/'), {
    raw,
    gzip: /\.(html|css|js)$/.test(path) ? gzipSync(raw) : null,
    type: mime[extname(path)],
  });
}
const server = createServer((request, response) => {
  const path = decodeURI(new URL(request.url, 'http://localhost').pathname);
  const file = files.get(
    (path.startsWith(prefix) ? path.slice(prefix.length) : path.slice(1)) || 'index.html',
  );
  response.setHeader('Cache-Control', 'no-store');
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  const compress = file.gzip && request.headers['accept-encoding']?.includes('gzip');
  const bytes = compress ? file.gzip : file.raw;
  response
    .writeHead(200, {
      'Content-Type': file.type,
      'Content-Length': bytes.length,
      ...(compress ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
    })
    .end(bytes);
});
const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) ?? 0);
await new Promise((resolve, reject) =>
  server.once('error', reject).listen(port, '127.0.0.1', resolve),
);
const origin = 'http://127.0.0.1:' + server.address().port;
console.log('Static preview ' + origin + prefix);

const paths = (folder, stem, names) =>
  names.split(' ').map((name) => 'assets/' + folder + '/' + stem + name + '.webp');
const approved = [
  ...paths('cards', 'card-', 'sha guohe nanman'),
  ...paths('emblems', 'emblem-', 'identity doudizhu versus duel college shanhetu'),
  ...paths('props', 'prop-', 'basket flower egg egg-splat wine shoe'),
  ...paths('scenes', 'scene-', 'luoyang hulao yizhou chibi'),
  ...[
    'lobby-day',
    'lobby-night',
    'room-day',
    'room-night',
    'console-day',
    'console-night',
    'shanhetu-map',
  ].map((name) => 'assets/' + name + '.webp'),
];
const shots = [
  '01-opening',
  '02-hardware',
  '03-card-impact',
  '03-basket-flight',
  '04-six-emblems',
  '04-campaign',
  '05-finale',
];
const limits = {
  minFps: 59,
  maxFrameMs: 17.5,
  p95FrameMs: 17.5,
  maxDroppedPercent: 0,
  clickSubmitBelowMs: 16,
};
const failures = [];
const report = {
  testedAt: new Date().toISOString(),
  platform: platform() + ' ' + release(),
  cpu: cpus()[0]?.model,
  limits,
  profiles: {},
  failures,
};
const round = (n) => Number(n.toFixed(3));
function check(condition, message) {
  if (!condition) failures.push(message);
}
function frames(times, start, end) {
  // Include BOTH straddling intervals. A stall across the very first click/reveal
  // would disappear if we selected only callbacks that fall inside the window.
  assert.ok(Number.isFinite(start) && end > start, 'Invalid sample window');
  const intervals = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] >= start && times[i - 1] <= end) intervals.push(times[i] - times[i - 1]);
  }
  assert.ok(
    intervals.length >= 4 && times[0] <= start && times.at(-1) >= end,
    'Incomplete RAF sample',
  );
  const sorted = intervals.toSorted((a, b) => a - b);
  const lost = intervals.reduce((n, ms) => n + Math.max(0, Math.round((ms * 60) / 1000) - 1), 0);
  const fps = (intervals.length * 1000) / intervals.reduce((a, b) => a + b, 0);
  const max = sorted.at(-1),
    p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
  return {
    samples: intervals.length,
    fps: round(fps),
    maxFrameMs: round(max),
    p95FrameMs: round(p95),
    droppedFrames: lost,
    droppedPercent: round((100 * lost) / (intervals.length + lost)),
    pass:
      fps >= limits.minFps && max <= limits.maxFrameMs && p95 <= limits.p95FrameMs && lost === 0,
    intervalsMs: intervals.map(round),
  };
}
function instrument() {
  const probe = (window.__filmProbe = {
    times: [],
    phase: {},
    phaseFrame: {},
    decoded: [],
    inputs: [],
    longTasks: [],
  });
  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function (...args) {
    return decode.apply(this, args).then((result) => {
      probe.decoded.push([this.currentSrc || this.src, performance.now()]);
      return result;
    });
  };
  const changed = () => {
    const phase = document.body?.dataset.phase;
    if (phase && !(phase in probe.phase)) {
      probe.phase[phase] = performance.now();
      probe.phaseFrame[phase] = probe.times.at(-1);
    }
    if (document.body?.dataset.core === 'warm' && probe.warm === undefined)
      probe.warm = performance.now();
  };
  new MutationObserver(changed).observe(document, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-phase', 'data-core'],
  });
  function recordInput(event) {
    const el = event.target.closest('[data-card],[data-prop]');
    if (el)
      probe.inputs.push({
        id: el.dataset.card || el.dataset.prop,
        type: event.type,
        time: event.timeStamp,
        received: performance.now(),
        pointerType: event.pointerType,
        primary: event.isPrimary,
        trusted: event.isTrusted,
      });
  }
  document.addEventListener('pointerup', recordInput, true);
  document.addEventListener('click', recordInput, true);
  new PerformanceObserver((list) => {
    for (const t of list.getEntries()) probe.longTasks.push([t.startTime, t.duration]);
  }).observe({ type: 'longtask', buffered: true });
  function sample(t) {
    probe.times.push(t);
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}
async function contextFor(browser, profile, path) {
  const { name, reducedMotion, ...device } = profile;
  const ctx = await browser.newContext({ ...device, serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    const observed = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') failures.push(name + ' console: ' + msg.text());
    });
    page.on('pageerror', (error) => failures.push(name + ' pageerror: ' + error.message));
    page.on('requestfailed', (req) =>
      failures.push(name + ' requestfailed: ' + req.url() + ' ' + req.failure()?.errorText),
    );
    page.on('request', (req) => {
      if (!req.url().startsWith(origin + path))
        failures.push(name + ' external or outside mount: ' + req.url());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) failures.push(name + ' HTTP ' + res.status() + ' ' + res.url());
      if (res.headers()['cache-control'] !== 'no-store')
        failures.push(name + ' missing no-store ' + res.url());
      observed.push(res.url());
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.emulateMedia({ reducedMotion: reducedMotion ?? 'no-preference' });
    await page.addInitScript(instrument);
    return { ctx, page, observed };
  } catch (e) {
    await ctx.close();
    throw e;
  }
}
async function ready(page) {
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
}
async function at(page, selector) {
  await page.locator(selector).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    scrollTo({
      top: scrollY + rect.top,
      behavior: 'instant',
    });
  });
}
const waitFrames = (page, count) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        function tick() {
          if (--n <= 0) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
    count,
  );
function saveWindow(record, name, stats) {
  record.frames[name] = stats;
  check(
    stats.pass,
    record.device +
      ' ' +
      name +
      ': max ' +
      stats.maxFrameMs +
      ' ms, p95 ' +
      stats.p95FrameMs +
      ' ms, ' +
      stats.fps +
      ' fps, ' +
      stats.droppedFrames +
      ' missed.',
  );
}
async function journey({ page }, record, path) {
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await waitFrames(page, 3);
  const start = await page.evaluate(() => ({
    phase: window.__filmProbe.phase,
    phaseFrame: window.__filmProbe.phaseFrame,
    warm: window.__filmProbe.warm,
    times: window.__filmProbe.times,
    core: document.body.dataset.core,
    viewport: [innerWidth, innerHeight],
    decodes: window.__filmProbe.decoded,
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  assert.equal(start.core, 'warm', 'Core warm-up must finish before opening');
  assert.deepEqual(start.viewport, [
    record.settings.viewport.width,
    record.settings.viewport.height,
  ]);
  assert.ok(
    start.warm < start.phase.opening &&
      start.times.filter((t) => t > start.warm && t <= start.phaseFrame.opening).length >= 2,
    'Missing settled pre-reveal frames',
  );
  assert.equal(start.reduce, record.device.endsWith('reduce'));
  assert.ok(start.phase.ready > start.phase.opening, 'Missing complete animated opening');
  for (const asset of approved)
    assert.ok(
      start.decodes.some(([url, t]) => url.endsWith('/' + asset) && t <= start.phase.opening),
      'Asset not decoded before opening: ' + asset,
    );
  record.opening = { start: start.phase.opening, end: start.phase.ready };
  saveWindow(record, 'opening', frames(start.times, start.phaseFrame.opening, start.phase.ready));
  // Cache extents before scrolling. Only write scroll position inside the driver.
  const scroll = await page.evaluate(async () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const sections = [...document.querySelectorAll('main > section')].map((el) => ({
      id: el.id,
      top: el.offsetTop,
    }));
    const height = innerHeight;
    const stalls = [];
    let prev,
      lastPosition = 0;
    const begin = performance.now(),
      duration = 6500;
    await new Promise((resolve) => {
      function move(t) {
        const p = Math.max(0, Math.min(1, (t - begin) / duration));
        if (prev && t - prev > 17.5) {
          const section = sections.findLast((s) => s.top <= lastPosition + height / 2);
          stalls.push({
            section: section?.id,
            scrollY: Math.round(lastPosition),
            startMs: prev,
            durationMs: t - prev,
          });
        }
        prev = t;
        lastPosition = max * p;
        scrollTo({ top: max * p, behavior: 'instant' });
        if (p < 1) requestAnimationFrame(move);
        else resolve();
      }
      requestAnimationFrame(move);
    });
    const end = performance.now();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      begin,
      end,
      stalls,
      times: window.__filmProbe.times,
      longTasks: window.__filmProbe.longTasks,
      bottom: scrollY >= max - 1,
      reveals: Array.from(document.querySelectorAll('main > .is-entered'), (el) => el.id),
    };
  });
  assert.ok(scroll.bottom, 'Did not traverse all five acts');
  assert.deepEqual(scroll.reveals, ['devices', 'theater', 'modes', 'campaign', 'finale']);
  saveWindow(record, 'scroll-five-acts', frames(scroll.times, scroll.begin, scroll.end));
  record.longTasks = scroll.longTasks;
  record.scrollStalls = scroll.stalls;
}
async function firstInput({ page }, record, path, key) {
  const prop = ['egg', 'flower', 'wine', 'shoe'].includes(key),
    type = prop ? 'prop' : 'card',
    control = '[data-' + type + '="' + key + '"]';
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page
    .locator(control)
    .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const button = page.locator(control);
  await button.evaluate(
    (el, selector) => {
      const effect = document.querySelector(selector);
      el.addEventListener(
        'pointerup',
        () => {
          const probe = window.__filmProbe;
          function visible() {
            const style = getComputedStyle(effect);
            if (Number(style.opacity) > 0.015 && style.transform !== 'none') {
              probe.firstEffectRaf = performance.now();
            } else if (
              !probe.firstEffectRaf &&
              performance.now() - probe.inputs.at(-1).time < 900
            ) {
              requestAnimationFrame(visible);
            }
          }
          requestAnimationFrame(visible);
        },
        { once: true },
      );
    },
    '[data-' + (prop ? 'flight' : 'impact') + '="' + key + '"]',
  );
  // No interaction, synthetic warm-up click or manual image decode before this press.
  if (record.device === 'mobile') await button.tap();
  else await button.click();
  const probe = await page.evaluate(
    async ({ type, key }) => {
      const probe = window.__filmProbe;
      await new Promise((resolve) => setTimeout(resolve, 900));
      const end = performance.now();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const events = probe.inputs.filter((i) => i.id === key && i.trusted);
      const release = events.find((i) => i.type === 'pointerup' && i.primary);
      const click = events.find((i) => i.type === 'click');
      const marks = performance.getEntriesByName('theater:' + type + ':' + key);
      if (!release || !click || !marks.length)
        throw Error('Missing trusted release/click/effect for ' + key);
      return {
        events,
        count: marks.length,
        start: Math.min(release.time, click.time),
        submit: marks[0].startTime,
        firstEffectRaf: probe.firstEffectRaf,
        end,
        times: probe.times,
        longTasks: probe.longTasks,
      };
    },
    { type, key },
  );
  record.inputs[key] = {
    events: probe.events,
    effectCount: probe.count,
    submitMs: round(probe.submit - probe.start),
    firstEffectRafMs: Number.isFinite(probe.firstEffectRaf)
      ? round(probe.firstEffectRaf - probe.start)
      : null,
    longTasks: probe.longTasks.filter(([t, d]) => t + d >= probe.start && t <= probe.end),
  };
  check(
    probe.count === 1,
    record.device + ' ' + key + ': one gesture started ' + probe.count + ' effects',
  );
  check(
    Number.isFinite(probe.firstEffectRaf),
    record.device + ' ' + key + ': no visible effect style at RAF',
  );
  check(
    probe.submit >= probe.start && probe.submit - probe.start < limits.clickSubmitBelowMs,
    record.device +
      ' ' +
      key +
      ' input-to-effect submission ' +
      record.inputs[key].submitMs +
      ' ms',
  );
  saveWindow(record, 'first-' + key, frames(probe.times, probe.start, probe.end));
}
async function chapterLink(page, id, touch) {
  const link = page.locator('.topbar nav a[href="#' + id + '"]');
  if (touch) await link.tap();
  else await link.click();
  await page.waitForFunction((id) => {
    const top = document.getElementById(id).getBoundingClientRect().top;
    const header = document.querySelector('.topbar').getBoundingClientRect().bottom;
    return location.hash === '#' + id && top >= header - 1 && top <= header + 5;
  }, id);
}
async function inView(page, selector) {
  const clipped = await page.locator(selector).evaluateAll((elements) => {
    const header = document.querySelector('.topbar').getBoundingClientRect().bottom;
    return elements.flatMap((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.top >= header &&
        box.bottom <= innerHeight &&
        box.left >= 0 &&
        box.right <= innerWidth &&
        box.width > 0 &&
        Number(style.opacity) >= 0.75 &&
        style.visibility === 'visible'
        ? []
        : [el.textContent.trim() || el.outerHTML.slice(0, 80)];
    });
  });
  assert.ok(await page.locator(selector).count(), 'Missing ' + selector);
  assert.deepEqual(clipped, [], 'Sections clipped or hidden: ' + selector);
}
async function polish({ page }, record, path) {
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => document.body.dataset.backstage === 'ready');
  const capture = async (name) => {
    const file = record.device + '-' + name + '.png';
    await page.screenshot({ path: join(evidence, file) });
    record.screenshots.push(file);
  };
  const boxes = await page.locator('.topbar :is(a,button)').evaluateAll((els) =>
    els.map((el) => {
      const { left, right, height } = el.getBoundingClientRect();
      return { height, contained: left >= 0 && right <= innerWidth };
    }),
  );
  const heights = boxes.map((box) => box.height);
  assert.equal(heights.length, 6);
  assert.ok(
    boxes.every((box) => box.contained && box.height >= 36),
    'Top bar hit areas: ' + JSON.stringify(boxes),
  );
  const touch = record.device === 'mobile';
  await chapterLink(page, 'theater', touch);
  await page.waitForTimeout(430);
  await inView(page, '#theater h2, [data-card], [data-prop], #theater .th-hint');
  await capture('nav-theater-full');
  record.highlights = {};
  await page.evaluate(() => {
    window.__revealStarts = [];
    document.addEventListener('animationstart', (event) => {
      if (event.animationName === 'highlight-enter')
        window.__revealStarts.push(event.target.className);
    });
  });
  for (const [id, bar, labels, duration, surface] of [
    ['devices', '.device-cues', ['共用大屏', '各自入席', '日夜双境'], 4400, '.device-stage'],
    ['campaign', '.campaign-index', ['洛阳', '虎牢', '益州', '赤壁'], 4800, '.campaign-editorial'],
  ]) {
    await chapterLink(page, id, touch);
    const geometry = await page.locator('#' + id).evaluate((section) => {
      const stage = section.firstElementChild;
      return {
        height: section.offsetHeight,
        viewport: innerHeight,
        sticky: [section, stage, ...stage.querySelectorAll('*')].some(
          (el) => getComputedStyle(el).position === 'sticky',
        ),
      };
    });
    assert.equal(geometry.sticky, false, id + ' has sticky content');
    if (!touch) assert.ok(geometry.height <= geometry.viewport * 1.25, id + ' too tall');
    const buttons = page.locator(bar + ' [data-beat]');
    const toggle = page.locator(bar + ' .highlight-play');
    const tap = (el) => (touch ? el.tap() : el.click());
    const state = () =>
      buttons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-pressed')));
    const expected = (index) => labels.map((_, i) => String(i === index));
    assert.deepEqual(await buttons.allTextContents(), labels);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await toggle.getAttribute('aria-label'), '暂停自动轮播');
    await page.waitForTimeout(450);
    await inView(page, bar + ' button');
    if (id === 'devices') await inView(page, '.device-stage');
    else await inView(page, '.campaign-editorial, .campaign-map, .campaign-hardware figcaption');
    assert.ok(
      await page
        .locator(bar + ' button')
        .evaluateAll((els) =>
          els.every((el) => el.type === 'button' && el.getBoundingClientRect().height >= 36),
        ),
    );
    async function settled(index) {
      await page.waitForTimeout(560);
      assert.deepEqual(await state(), expected(index));
      const rendered = await page.evaluate(() => {
        const query = (selector, fn) => [...document.querySelectorAll(selector)].map(fn);
        const opacity = (el) => Number(getComputedStyle(el).opacity);
        return {
          captions: query(
            '.device-caption',
            (el) => getComputedStyle(el).visibility === 'visible' && opacity(el) > 0,
          ),
          phones: query('.device-handset', opacity),
          wipe: query('.device-wipe', (el) => {
            const style = getComputedStyle(el);
            return 1 + new DOMMatrixReadOnly(style.transform).m41 / parseFloat(style.width);
          }),
          cities: query('.campaign-land img', opacity),
          specs: query('.campaign-stat strong', (el) => el.textContent),
        };
      });
      if (id === 'devices') {
        assert.deepEqual(
          rendered.captions,
          labels.map((_, i) => i === index),
        );
        assert.equal(rendered.phones.length, 2);
        assert.ok(rendered.phones.every((n) => (index === 0 ? n <= 0.01 : n >= 0.99)));
        assert.equal(rendered.wipe.length, 3);
        assert.ok(rendered.wipe.every((n) => Math.abs(n - (index === 2 ? 0.52 : 0)) <= 0.01));
        await inView(
          page,
          '.device-caption[aria-hidden="false"] h2, .device-caption[aria-hidden="false"] p, .device-laptop',
        );
        if (index !== 0) await inView(page, '.device-handset');
      } else {
        assert.equal(rendered.cities.length, 4);
        assert.ok(rendered.cities.every((n, i) => (i === index ? n >= 0.99 : n <= 0.01)));
        assert.deepEqual(rendered.specs, ['25', '14', '4']);
        await inView(page, '.campaign-stat strong, .campaign-stat small');
      }
      return rendered;
    }
    const poses = [];
    for (let index = 0; index < labels.length; index++) {
      await tap(buttons.nth(index));
      assert.deepEqual(await state(), expected(index));
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      assert.equal(await toggle.getAttribute('aria-label'), '继续自动轮播');
      poses.push(await settled(index));
    }
    await capture(id + '-highlights-paused');
    const closeup = record.device + '-' + id + '-capsules.png';
    await page.locator(bar).screenshot({ path: join(evidence, closeup) });
    record.screenshots.push(closeup);

    const last = labels.length - 1;
    const clock = () =>
      buttons.evaluateAll((els) => {
        const animation = els
          .find((el) => el.getAttribute('aria-pressed') === 'true')
          .querySelector('i')
          .getAnimations()[0];
        return animation ? { position: animation.currentTime, state: animation.playState } : null;
      });
    // A manual selection should remove the old running countdown entirely.
    assert.equal(await clock(), null);
    await tap(toggle);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    // Mouse remains over the capsule after clicking Play. Vacate it before timing.
    await page.mouse.move(2, 120);
    await page.waitForTimeout(250);
    const running = await clock();
    assert.ok(running?.state === 'running' && running.position > 0);
    if (!touch) {
      await page.locator(surface).hover();
      await page.waitForTimeout(120);
      const frozen = await clock();
      await page.waitForTimeout(180);
      assert.equal(frozen?.state, 'paused');
      assert.deepEqual(await clock(), frozen, 'Hover must freeze countdown progress');
      await page.mouse.move(2, 120);
    }
    await at(page, '#hero');
    await page.waitForTimeout(120);
    const hidden = await clock();
    await page.waitForTimeout(180);
    assert.equal(hidden?.state, 'paused');
    assert.deepEqual(await clock(), hidden, 'Offscreen countdown must not advance');
    assert.deepEqual(await state(), expected(last));
    await chapterLink(page, id, touch);
    await page.mouse.move(2, 120);
    const started = Date.now();
    await page.waitForFunction(
      (bar) => document.querySelector(bar + ' [data-beat]').getAttribute('aria-pressed') === 'true',
      bar,
      { timeout: duration + 1000 },
    );
    const realAdvanceMs = Date.now() - started;
    assert.ok(realAdvanceMs >= duration - 2000, id + ' did not use the real playback interval');
    await tap(toggle);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await page.mouse.move(2, 120);
    await settled(0);
    const paused = await clock();
    await page.waitForTimeout(400);
    assert.deepEqual(await state(), expected(0));
    assert.ok(paused === null || paused.state === 'paused');
    assert.deepEqual(await clock(), paused, 'Pause must freeze countdown progress');
    await tap(toggle);
    await page.mouse.move(2, 120);
    const playingShot = record.device + '-' + id + '-capsules-playing.png';
    await page.locator(bar).screenshot({ path: join(evidence, playingShot) });
    record.screenshots.push(playingShot);
    await tap(toggle);
    assert.equal(
      await page.evaluate(
        (selector) => window.__revealStarts.filter((name) => name === selector).length,
        id === 'devices' ? 'device-editorial' : 'campaign-editorial',
      ),
      1,
      id + ' reveal must play exactly once',
    );
    record.highlights[id] = { geometry, labels, poses, realAdvanceMs };
  }
  if (record.device === 'mobile') {
    await at(page, '#modes');
    const columns = await page
      .locator('.seal-collection')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns, 2);
    await at(page, '#finale');
    assert.ok(
      await page.locator('#finale h2').evaluate((el) => {
        const first = new Range();
        first.selectNodeContents(el.firstChild);
        const second = new Range();
        second.selectNodeContents(el.querySelector('span'));
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        return a.bottom <= b.top && second.getClientRects().length === 1;
      }),
      'Finale should place the full invitation on line two',
    );
  }
  record.polish = {
    minNavHeight: Math.min(...heights),
    deckFits: true,
    campaign: [25, 14, 4],
    singleCaption: true,
  };
}
async function exercise({ ctx, page, observed }, record, path, capture) {
  // Hold one required asset only in the functional pass, never during timing runs.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/lobby-day.webp', async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  const picture = async (name) => {
    if (capture) {
      const file = record.device + '-' + name + '.png';
      await page.screenshot({ path: join(evidence, file), timeout: 10000 });
      record.screenshots.push(file);
    }
  };
  async function overflow() {
    const d = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.equal(d, 0, 'Horizontal overflow at ' + page.url());
  }
  async function link() {
    const a = page.locator('header a[href="' + download + '"]');
    assert.equal(await a.count(), 1);
    assert.match(await a.getAttribute('aria-label'), /下载\s*Windows\s*启动包/i);
    // Exercise real pointer hit testing, prevent only the final external navigation.
    await a.evaluate((el) =>
      el.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          el.dataset.testClicked = String(event.isTrusted);
        },
        { once: true },
      ),
    );
    if (record.device === 'mobile') await a.tap();
    else await a.click();
    assert.equal(await a.getAttribute('data-test-clicked'), 'true');
    await a.evaluate((el) => delete el.dataset.testClicked);
  }
  try {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await page.locator('#curtain').waitFor({ state: 'visible' });
    assert.ok(
      !['ready', 'opening'].includes(await page.locator('body').getAttribute('data-phase')),
    );
    await link();
    await overflow();
    await picture('00-curtain');
    await page.evaluate(() => {
      const title = document.querySelector('#hero-title span b'),
        curtain = document.querySelector('#curtain');
      const samples = (window.__openingSamples = { title: [], curtain: [] });
      function sample() {
        samples.title.push(getComputedStyle(title).transform);
        samples.curtain.push(getComputedStyle(curtain).opacity);
        if (document.body.dataset.phase !== 'ready') requestAnimationFrame(sample);
      }
      sample();
    });
  } finally {
    release();
  }
  await ready(page);
  await link();
  await overflow();
  const opening = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(window.__openingSamples).map(([k, values]) => [k, new Set(values).size]),
    ),
  );
  assert.ok(
    opening.title > 2 && opening.curtain > 2,
    'Curtain/title did not play: ' + JSON.stringify(opening),
  );
  await picture(shots[0]);
  const style = (selector, key) =>
    page
      .locator(selector)
      .first()
      .evaluate((el, key) => getComputedStyle(el)[key], key);
  await chapterLink(page, 'devices', record.device === 'mobile');
  await page.waitForTimeout(430);
  const laptop = await style('.device-laptop', 'transform');
  // Functional pass only. A single instantaneous switch must not pass as a
  // continuous camera move, even when the system requests reduced motion.
  await page.evaluate(() => {
    const el = document.querySelector('.device-laptop'),
      values = new Set();
    window.__cameraSamples = values;
    const until = performance.now() + 1100;
    function sample(t) {
      values.add(getComputedStyle(el).transform);
      if (t < until) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const nextBeat = page.locator('.device-cues [data-beat]').nth(1);
  if (record.device === 'mobile') await nextBeat.tap();
  else await nextBeat.click();
  await page.waitForTimeout(650);
  assert.notEqual(await style('.device-laptop', 'transform'), laptop, 'Camera did not move');
  const cameraSteps = await page.evaluate(() => window.__cameraSamples.size);
  assert.ok(cameraSteps > 2, 'Device pose did not interpolate after picking a capsule');
  await overflow();
  await picture(shots[1]);
  // Measure the visible intersection in the screen's own coordinates. A
  // translated clip window and its counter-translated image must cancel, so
  // the viewer sees a wipe over a stationary daylight screenshot on all devices.
  await page.evaluate(() => {
    const panes = [...document.querySelectorAll('#devices .device-wipe')].map((el) => ({
      window: el,
      image: el.querySelector('.device-day'),
      width: parseFloat(getComputedStyle(el).width),
    }));
    const samples = (window.__wipeSamples = []);
    function sample() {
      samples.push(
        panes.map((pane) => {
          const clip = getComputedStyle(pane.window),
            image = getComputedStyle(pane.image);
          const windowMatrix = new DOMMatrixReadOnly(
            clip.transform === 'none' ? undefined : clip.transform,
          );
          const imageMatrix = new DOMMatrixReadOnly(
            image.transform === 'none' ? undefined : image.transform,
          );
          const composed = windowMatrix.multiply(imageMatrix);
          const left = Math.max(0, windowMatrix.m41),
            right = Math.min(pane.width, windowMatrix.m41 + pane.width);
          return {
            clip: clip.clipPath,
            x: windowMatrix.m41,
            imageX: imageMatrix.m41,
            visible: Math.max(0, right - left) / pane.width,
            drift: Math.hypot(composed.m41, composed.m42),
            basisError: Math.max(
              ...composed
                .toFloat64Array()
                .map((v, i) => (i === 12 || i === 13 ? 0 : Math.abs(v - (i % 5 === 0 ? 1 : 0)))),
            ),
          };
        }),
      );
    }
    sample();
    document.querySelector('#theme').addEventListener(
      'click',
      () => {
        const start = performance.now();
        function tick() {
          sample();
          if (performance.now() - start < 720) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      },
      { once: true },
    );
  });
  await page.locator('#theme').click();
  assert.equal(await page.locator('#theme').getAttribute('aria-pressed'), 'true');
  assert.notEqual(
    await style('#theme [data-shot="night"]', 'backgroundColor'),
    await style('#theme [data-shot="day"]', 'backgroundColor'),
    'Actual-product daylight control must show its active state',
  );
  await page.waitForTimeout(750);
  const sweep = await page.evaluate(() => window.__wipeSamples);
  assert.equal(sweep[0].length, 3, 'Day/night screens');
  const wipes = sweep[0].map((first, i) => {
    const path = sweep.map((frame) => frame[i]),
      last = path.at(-1);
    assert.ok(/^inset\(0(?:px|%)?(?: 0(?:px|%)?){0,3}\)$/.test(first.clip), 'Fixed inset clip');
    assert.ok(
      path.every(
        (p) =>
          p.clip === first.clip &&
          Number.isFinite(p.visible) &&
          p.drift < 1 &&
          p.basisError < 0.001,
      ),
      'Day image must remain registered with the night image',
    );
    assert.ok(
      first.visible < 0.08 && last.visible > 0.98 && last.x > first.x && last.imageX < first.imageX,
      'Wipe must expose the actual image width',
    );
    const intermediate = new Set(
      path
        .filter((p) => p.visible > 0.08 && p.visible < 0.98)
        .map((p) => Math.round(100 * p.visible)),
    ).size;
    assert.ok(intermediate >= 3, 'Wipe skipped intermediate positions');
    return {
      clip: first.clip,
      startVisible: first.visible,
      endVisible: last.visible,
      intermediate,
      maxImageDriftPx: Math.max(...path.map((p) => p.drift)),
    };
  });
  await picture('02-hardware-day');
  await page.locator('#theme').click();
  assert.equal(await page.locator('#theme').getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.device-wipe')].every((el) => {
      const style = getComputedStyle(el);
      return new DOMMatrixReadOnly(style.transform).m41 <= -0.99 * parseFloat(style.width);
    }),
  );
  for (const [type, key] of [
    ['card', 'sha'],
    ['card', 'guohe'],
    ['card', 'nanman'],
    ['prop', 'flower'],
    ['prop', 'wine'],
    ['prop', 'shoe'],
    ['prop', 'egg'],
  ]) {
    if (type === 'card')
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-impact]')].every(
          (el) => getComputedStyle(el).opacity === '0',
        ),
      );
    const btn = page.locator('[data-' + type + '="' + key + '"]');
    const markName = 'theater:' + type + ':' + key;
    const initialCount = await page.evaluate(
      (n) => performance.getEntriesByName(n).length,
      markName,
    );
    const selector = '[data-' + (type === 'card' ? 'impact' : 'flight') + '="' + key + '"]';
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.evaluate(
      ({ selector, id }) => {
        const elements = [...document.querySelectorAll(selector)];
        if (!elements.length) throw Error('Missing effect ' + selector);
        const probe = (window.__checkEffect = { visible: 0, transforms: new Set() });
        document.addEventListener(
          'click',
          function observe(event) {
            if (!event.target.closest('[data-card="' + id + '"],[data-prop="' + id + '"]')) return;
            document.removeEventListener('click', observe, true);
            const start = performance.now();
            function tick() {
              for (const el of elements) {
                const css = getComputedStyle(el);
                if (
                  Number(css.opacity) > 0.015 &&
                  css.display !== 'none' &&
                  css.visibility !== 'hidden'
                ) {
                  probe.visible++;
                  probe.transforms.add(css.transform);
                }
              }
              if (performance.now() - start < 850) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
          },
          true,
        );
      },
      { selector, id: key },
    );
    if (record.device === 'mobile') await btn.tap();
    else await btn.click();
    if (type === 'card') {
      assert.equal(
        await page.locator(selector).evaluate((el) => el.closest('button')?.dataset.card),
        key,
      );
      await page.waitForTimeout(85);
      await picture(key === 'sha' ? shots[2] : shots[2] + '-' + key);
    }
    if (key === 'egg') {
      await page.waitForTimeout(75);
      for (let i = 0; i < 3; i++) {
        if (record.device === 'mobile') await btn.tap();
        else await btn.click();
      }
      await page.waitForTimeout(70);
      await picture(shots[3]);
    }
    if (type === 'prop' && key !== 'egg') {
      await page.waitForFunction(
        (id) =>
          Number(getComputedStyle(document.querySelector('[data-debris="' + id + '"]')).opacity) >
          0.5,
        key,
      );
      await page.waitForTimeout(150);
      await picture('03-basket-hit-' + key);
    }
    await page.waitForFunction(
      () => window.__checkEffect.visible > 2 && window.__checkEffect.transforms.size > 2,
      undefined,
      { timeout: 1800 },
    );
    assert.equal(
      (await page.evaluate((n) => performance.getEntriesByName(n).length, markName)) - initialCount,
      key === 'egg' ? 4 : 1,
      'One effect per gesture for ' + key,
    );
    await overflow();
  }
  for (const [type, id, key] of [
    ['card', 'sha', 'Enter'],
    ['prop', 'egg', 'Space'],
  ]) {
    const n = 'theater:' + type + ':' + id;
    const count = await page.evaluate((n) => performance.getEntriesByName(n).length, n);
    await page.locator('[data-' + type + '="' + id + '"]').press(key);
    assert.equal(
      await page.evaluate((n) => performance.getEntriesByName(n).length, n),
      count + 1,
      'Keyboard ' + key + ' should trigger one effect',
    );
  }
  await at(page, '#modes');
  await page.waitForTimeout(450);
  await picture(shots[4]);
  await overflow();
  await chapterLink(page, 'campaign', record.device === 'mobile');
  const city = page.locator('.campaign-index [data-beat]');
  const incoming = page.locator('.campaign-land img').nth(1);
  await incoming.evaluate((el) => {
    const samples = (window.__landscapeSamples = []);
    document.querySelectorAll('.campaign-index [data-beat]')[1].addEventListener(
      'click',
      () => {
        const start = performance.now();
        function sample() {
          samples.push([
            Number(getComputedStyle(el).opacity),
            Number(getComputedStyle(el.previousElementSibling).opacity),
          ]);
          if (performance.now() - start < 550) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      },
      { once: true },
    );
  });
  await city.nth(1).click();
  await page.waitForTimeout(570);
  const landscapeSamples = await page.evaluate(() => window.__landscapeSamples);
  const crossfadeSteps = new Set(
    landscapeSamples
      .filter(([a, b]) => a > 0.05 && a < 0.95 && b > 0.05 && b < 0.95)
      .map(([a]) => a),
  ).size;
  assert.ok(
    crossfadeSteps >= 4,
    'Campaign must crossfade, including when system reduced motion is enabled',
  );
  assert.equal(await style('.campaign-land img:nth-child(2)', 'opacity'), '1');
  await picture(shots[5]);
  await overflow();
  await city.nth(3).click();
  await page.waitForTimeout(570);
  assert.equal(await style('.campaign-land img:nth-child(4)', 'opacity'), '1');
  await picture('04-campaign-chibi');
  await at(page, '#finale');
  await page.waitForTimeout(500);
  await picture(shots[6]);
  await overflow();
  const assets = await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(imgs.map((img) => img.decode()));
    return imgs.map((img) => ({
      url: img.currentSrc,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
  });
  assert.ok(
    assets.length > 0 && assets.every((a) => a.width > 0 && a.height > 0),
    'Image decoding failed',
  );
  assert.equal(await page.locator('svg,object[type="image/svg+xml"]').count(), 0);
  const approvedUrls = approved.map((a) => origin + path + a);
  for (const { url } of assets)
    assert.ok(approvedUrls.includes(url), 'Unapproved page image ' + url);
  for (const url of approvedUrls)
    assert.ok(observed.includes(url), 'Missing approved artwork ' + url);
  assert.ok(
    observed.every(
      (url) => !/\.(svg|png|jpe?g|webp)(\?|$)/i.test(url) || approvedUrls.includes(url),
    ),
    'Unapproved image requested',
  );
  const body = await page.locator('body').innerText();
  assert.doesNotMatch(body, /兹白|客厅剧场|素绡|玄泉|玉魁/);
  assert.match(body, /项目代码 GPL-3\.0-only/);
  assert.doesNotMatch(body, /GPL-3\.0 开源免费/);
  assert.deepEqual(
    await page.locator('.download-note').allTextContents(),
    Array(2).fill('下载 Windows 启动包 ZIP · 首次双击自动准备引擎资源'),
  );
  assert.match(body, /无名杀/);
  assert.ok(await page.locator('a[href="' + repo + '"]').count());
  record.verified = {
    opening,
    cameraSteps,
    crossfadeSteps,
    wipes,
    decodedElements: assets.length,
    approvedImages: approvedUrls.length,
    trustedDownloadClicks: 2,
    artwork: assets,
  };
  if (capture)
    for (const name of ['00-curtain', ...shots, shots[2] + '-guohe', shots[2] + '-nanman'])
      assert.ok(record.screenshots.includes(record.device + '-' + name + '.png'));
}

async function humanScroll({ page }, record, path) {
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => document.body.dataset.backstage === 'ready');
  const result = (record.humanScroll = {
    stops: [],
    frames: {},
    inputs: {},
    device: record.device,
  });
  const capture = async (name) => {
    const file = record.device + '-human-' + name + '.png';
    await page.screenshot({ path: join(evidence, file) });
    record.screenshots.push(file);
  };
  const viewport = record.settings.viewport;
  await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
  const wheel = async (delta, target) => {
    await page.mouse.wheel(0, delta);
    await page.waitForFunction((y) => Math.abs(scrollY - y) <= 2, target);
  };

  for (const id of ['devices', 'campaign']) {
    const pin = page.locator('#' + id + ' > div');
    await at(page, '#' + id);
    const before = await pin.evaluate((el) => ({
      y: scrollY,
      top: el.getBoundingClientRect().top,
    }));
    await wheel(105, before.y + 105);
    const after = await pin.evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(Math.abs(before.top - after - 105) <= 2, id + ' held the stage in place');
    await wheel(-70, before.y + 35);
    const reverse = await pin.evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(Math.abs(before.top - reverse - 35) <= 2, id + ' resisted reverse scrolling');
    result.stops.push({ section: id, forward: before.top - after, reverse: reverse - after });
    await capture(id + '-natural-scroll');
  }

  await at(page, '#devices');
  await waitFrames(page, 3);
  const start = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.device-caption')];
    const probe = (window.__pulse = { sampling: true, titleCounts: [], wheels: [] });
    document.addEventListener(
      'wheel',
      (event) => {
        if (event.isTrusted) probe.wheels.push(event.deltaY);
      },
      { passive: true },
    );
    function sample() {
      probe.titleCounts.push(
        titles.filter((el) => {
          const style = getComputedStyle(el);
          return style.visibility === 'visible' && Number(style.opacity) > 0;
        }).length,
      );
      if (probe.sampling) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    return {
      begin: performance.now(),
      y: scrollY,
      bottom: document.documentElement.scrollHeight - innerHeight,
    };
  });
  await page.waitForTimeout(90);
  await wheel(500, start.y + 500);
  await page.waitForTimeout(80);
  await wheel(-300, start.y + 200);
  await page.waitForTimeout(45);
  await wheel(start.bottom, start.bottom);
  await page.waitForTimeout(650);
  const pulse = await page.evaluate(async () => {
    const end = performance.now();
    window.__pulse.sampling = false;
    // RAF timestamps describe presentation time and can trail the input clock.
    // Keep every interval, including the complete one straddling the endpoint.
    await new Promise((resolve) => {
      function covered() {
        if (window.__filmProbe.times.at(-1) >= end) resolve();
        else requestAnimationFrame(covered);
      }
      requestAnimationFrame(covered);
    });
    return { ...window.__pulse, end, times: window.__filmProbe.times };
  });
  assert.deepEqual(pulse.wheels.map(Math.sign), [1, -1, 1], 'Missing trusted wheel pulses');
  assert.ok(
    pulse.titleCounts.length > 10 && pulse.titleCounts.every((n) => n === 1),
    'Overlapping/blank title during wheel reversal',
  );
  saveWindow(result, 'wheel-pulse-reverse-fling', frames(pulse.times, start.begin, pulse.end));
  result.pulse = { wheels: pulse.wheels, singleCaptionFrames: pulse.titleCounts.length };
  result.pass = result.frames['wheel-pulse-reverse-fling'].pass;
}

async function executable() {
  if (process.env.WEBSITE_BROWSER_EXECUTABLE) return process.env.WEBSITE_BROWSER_EXECUTABLE;
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  return platform() === 'win32' &&
    (await access(edge).then(
      () => true,
      () => false,
    ))
    ? edge
    : undefined;
}
async function persist() {
  const lines = [
    '# Batch 2B 官网冷加载实测',
    '',
    report.pass ? '**通过**' : '**未通过**',
    '',
    '在本机 Edge/Chromium 无头浏览器中测试。移动端为 390 × 844、DPR 2 的触控模拟。每次首次出牌和首次投掷分别从全新上下文开始。网络禁用缓存，响应均为 no-store。未限速，未开启截图时计帧。',
    '',
    '60 Hz 门槛沿用最长帧 ≤17.5 ms、平均 ≥59 fps，另需 P95 ≤17.5 ms、漏帧为零。按最接近的 60 Hz 刷新周期数估算错过的刷新机会。点击时延取可信输入时间戳到首次样式提交，必须 <16 ms。动画帧回调反映浏览器调度，不能测量实体屏幕亮起时刻。',
    '',
    '浏览器 ' + (report.browser ?? '未启动') + '，' + report.platform + '，' + report.cpu + '。',
    '',
    '| 设备 | 场景 | 平均 fps | 最长帧 ms | P95 ms | 漏帧率 | 输入至提交 ms | 输入至首次观测到可见特效的 RAF ms | 结果 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|',
  ];
  const devices = [...Object.values(report.profiles), report.laptop].filter(Boolean);
  const timed = devices.flatMap((record) =>
    [record, record.supplemental, record.humanScroll].filter(Boolean),
  );
  for (const record of timed) {
    for (const [name, m] of Object.entries(record.frames ?? {})) {
      const input = record.inputs[name.replace(/^first-/, '')]?.submitMs;
      lines.push(
        '| ' +
          [
            record.device,
            name,
            m.fps,
            m.maxFrameMs,
            m.p95FrameMs,
            m.droppedPercent + '%',
            input ?? '—',
            record.inputs[name.replace(/^first-/, '')]?.firstEffectRafMs ?? '—',
            m.pass && (input === undefined || input < 16) ? '通过' : '未通过',
          ].join(' | ') +
          ' |',
      );
    }
  }
  for (const record of devices) {
    const human = record.humanScroll;
    if (record.highlights) {
      for (const [id, data] of Object.entries(record.highlights))
        lines.push(
          '',
          '- ' +
            record.device +
            ' ' +
            id +
            '：' +
            data.labels.join(' / ') +
            ' 定格通过，实钟自动推进用时 ' +
            data.realAdvanceMs +
            ' ms（不含此前可见时间）。',
        );
    }
    if (!human?.pulse) continue;
    lines.push('', '## ' + record.device + ' 非匀速滚动', '');
    for (const state of human.stops)
      lines.push(
        '- ' +
          state.section +
          ' 随滚轮自然位移 ' +
          state.forward +
          ' px，反向 ' +
          state.reverse +
          ' px。',
      );
    lines.push(
      '- 猛滚与反滚期间采到 ' + human.pulse.singleCaptionFrames + ' 帧，每帧均仅显示一组设备旁白。',
    );
  }
  lines.push('', '## 本次截图', '');
  for (const record of Object.values(report.profiles))
    for (const file of record.screenshots) lines.push('- [' + file + '](./' + file + ')');
  for (const file of report.laptop?.screenshots ?? [])
    lines.push('- [' + file + '](./' + file + ')');
  if (report.profiles.mobile?.polish && report.laptop?.polish)
    lines.push(
      '',
      '桌面、1280×720 笔记本和 390×844 触控模拟检查章节锚点、出牌台两条提示、非粘滞布局、全分镜定格及真实播放/暂停。',
    );
  if (failures.length) lines.push('', '## 未通过项', '', ...failures.map((e) => '- ' + e));
  await writeFile(join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(evidence, 'report.md'), lines.join('\n') + '\n');
}
if (!process.argv.includes('--serve')) {
  await mkdir(evidence, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: await executable(), headless: true });
    report.browser = browser.version();
    const cdp = await browser.newBrowserCDPSession();
    const { gpu } = await cdp.send('SystemInfo.getInfo');
    report.gpu = {
      devices: gpu.devices,
      renderer: gpu.auxAttributes?.glRenderer,
      featureStatus: gpu.featureStatus,
    };
    for (const profile of profiles) {
      const record = (report.profiles[profile.name] = {
        device: profile.name,
        settings: profile,
        frames: {},
        inputs: {},
        screenshots: [],
      });
      async function run(label, task, path = prefix) {
        let session;
        try {
          session = await contextFor(browser, profile, path);
          await task(session, record, path);
        } catch (error) {
          failures.push(profile.name + ' ' + label + ' ' + error.message);
          if (session) {
            const name = profile.name + '-failed-' + label.replaceAll(' ', '-') + '.png';
            await session.page
              .screenshot({ path: join(evidence, name), timeout: 3000 })
              .then(() => record.screenshots.push(name))
              .catch(() => {});
          }
        } finally {
          await session?.ctx.close();
        }
      }
      console.log(
        'Measuring ' +
          profile.name +
          ' cold opening, five-act scroll and four independent first inputs',
      );
      await run('journey', journey);
      for (const key of ['sha', 'guohe', 'nanman', 'egg'])
        await run('first-' + key, (s, r, path) => firstInput(s, r, path, key));
      if (profile.name !== 'desktop-reduce') {
        record.supplemental = { device: profile.name, frames: {}, inputs: {} };
        for (const key of ['flower', 'wine', 'shoe'])
          await run('first-' + key, (s, r, path) => firstInput(s, r.supplemental, path, key));
      }
      await run('visual checks', (s, r, path) =>
        exercise(s, r, path, !profile.name.endsWith('reduce')),
      );
      if (profile.name !== 'desktop-reduce') await run('human scroll', humanScroll);
      if (profile.name !== 'desktop-reduce') await run('chapter polish', polish);
      if (profile.name === 'desktop') {
        await run(
          'root path',
          async ({ page }) => {
            await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
            await ready(page);
            await at(page, '#finale');
            assert.equal(await page.locator('header a[href="' + download + '"]').count(), 1);
          },
          '/',
        );
      }
      await persist();
    }
    const laptop = { name: 'laptop', viewport: { width: 1280, height: 720 } };
    report.laptop = { device: laptop.name, settings: laptop, screenshots: [] };
    const session = await contextFor(browser, laptop, prefix);
    try {
      await polish(session, report.laptop, prefix);
    } finally {
      await session.ctx.close();
    }
    const laptopWheel = await contextFor(browser, laptop, prefix);
    try {
      await humanScroll(laptopWheel, report.laptop, prefix);
    } finally {
      await laptopWheel.ctx.close();
    }
  } catch (error) {
    failures.push(error.stack || error.message);
  } finally {
    await browser?.close();
    server.close();
    report.pass =
      !failures.length &&
      report.laptop?.polish &&
      report.laptop?.humanScroll?.pass &&
      report.profiles.desktop?.polish &&
      report.profiles.mobile?.polish &&
      Object.values(report.profiles).length === profiles.length &&
      Object.values(report.profiles).every(
        (r) =>
          r.verified &&
          Object.keys(r.frames).length === 6 &&
          (r.device === 'desktop-reduce' ||
            (Object.keys(r.supplemental?.frames ?? {}).length === 3 && r.humanScroll?.pass)),
      );
    await persist();
    console.log('Website ' + (report.pass ? 'PASS' : 'FAIL') + ' • ' + join(evidence, 'report.md'));
    for (const failure of failures) console.error(failure);
    if (!report.pass) process.exitCode = 1;
  }
}
