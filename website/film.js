/* One presentation clock for the curtain, scroll camera and interaction stage. */
(() => {
  'use strict';
  const one = (selector) => document.querySelector(selector);
  const curtain = one('#curtain');
  const ring = one('.loading-seal i');
  const label = one('#load-status');
  const hardware = one('.hero-hardware');
  const seal = one('.hero-seal');
  const landscape = one('#hero-land');
  const reflection = one('.reflection');
  const titles = [...document.querySelectorAll('#hero-title b')];
  const heroDay = one('#hero-day');
  const heroWipe = heroDay.parentElement;
  const theme = one('#theme');
  const finalSeal = one('.final-mark img');
  const finalLight = one('.final-mark i');
  const dust = one('#dust');
  const paint = dust.getContext('2d');
  const stars = Array.from({ length: 32 }, (_, i) => ({
    x: (i * 163) % 512,
    y: (i * 97) % 256,
    radius: 0.32 + (i % 4) * 0.2,
  }));
  function drawDust() {
    if (!paint) return;
    paint.clearRect(0, 0, dust.width, dust.height);
    paint.fillStyle = '#ecd196';
    for (const s of stars) {
      paint.beginPath();
      paint.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      paint.fill();
    }
  }
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const scenes = ['hero', 'devices', 'theater', 'modes', 'campaign', 'finale'].map((id) => ({
    node: document.getElementById(id),
    top: 0,
    height: 0,
  }));
  let viewport,
    targetY = window.scrollY,
    camera = targetY;
  function measure() {
    viewport = window.innerHeight;
    for (const s of scenes) {
      s.top = s.node.offsetTop;
      s.height = s.node.offsetHeight;
    }
  }
  measure();
  new ResizeObserver(measure).observe(document.querySelector('main'));
  window.addEventListener('resize', measure);
  window.addEventListener(
    'scroll',
    () => {
      targetY = window.scrollY;
    },
    { passive: true },
  );
  // Native fragment navigation also works for repeated clicks on the same hash.
  let alignCamera = false;
  document.addEventListener('click', (event) => {
    if (event.target.closest('a[href^="#"]')) alignCamera = true;
  });
  window.addEventListener('hashchange', () => {
    alignCamera = true;
  });
  let dayTarget = 0,
    day = 0;
  theme.addEventListener('click', () => {
    dayTarget = 1 - dayTarget;
    theme.setAttribute('aria-pressed', String(Boolean(dayTarget)));
    window.acts.themePose(dayTarget);
  });
  let coreReady = false,
    quiet = 0,
    start = null,
    previous = 0,
    lastHeroDay = -1;
  // Rasterize the real stage materials while the loading screen still covers them.
  // A decoded image by itself doesn't prepare the browser's rounded masks,
  // transformed text, alpha blending, or the GPU's first-use paint pipelines.
  const warmShots = [
    [1, 0],
    [1, 1],
    [1, 2],
    [1, 'day'],
    [2, 0],
    [2, 'seam'],
    [3, 0],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [5, 0],
    [0, 0],
  ];
  let warmShot = -1,
    warmStage = null,
    shotStart = 0;
  const reveal = new IntersectionObserver(
    (entries, observer) => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        target.classList.add('is-entered');
        observer.unobserve(target);
      }
    },
    { rootMargin: '-96px 0px 0px', threshold: 0.04 },
  );
  function showLoadProgress(done, message) {
    label.textContent = message;
    const angle = (360 * done) / (4 + warmShots.length);
    ring.style.background = 'conic-gradient(#e5c27b ' + angle + 'deg, #514938 0)';
  }
  function nextWarmShot(t) {
    if (warmStage) {
      warmStage.style.translate = '';
      warmStage.style.zIndex = '';
      warmStage.classList.remove('warming-stage');
    }
    const shot = warmShots[++warmShot];
    showLoadProgress(
      4 + warmShot,
      shot ? '正在预热光影 · ' + (warmShot + 1) + ' / ' + warmShots.length : '准备入席',
    );
    quiet = 0;
    shotStart = t;
    if (!shot) {
      window.acts.devicePose(0, dayTarget);
      window.acts.campaignPose(0);
      warmStage = null;
      return;
    }
    const [index, pose] = shot;
    const scene = scenes[index];
    if (pose === 'seam') {
      // Prime the real adjacent sections in the same frame without moving the scrollbar.
      warmStage = one('main');
      warmStage.style.translate = '0 ' + (targetY - scene.top + viewport * 0.22) + 'px';
      return;
    }
    warmStage = scene.node;
    warmStage.classList.add('warming-stage');
    warmStage.style.translate = '0 ' + (targetY - scene.top) + 'px';
    warmStage.style.zIndex = '8';
    if (index === 1)
      window.acts.devicePose(pose === 'day' ? 1 : pose, pose === 'day' ? 1 : undefined);
    if (index === 4) window.acts.campaignPose(pose);
  }
  const visible = (s) => targetY + viewport > s.top - 10 && targetY < s.top + s.height + 10;
  const whenIdle = () =>
    new Promise((resolve) => {
      if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: 90 });
      else setTimeout(resolve, 16);
    });
  async function backstage() {
    // Yield between subsequent unique full-resolution scene decodes.
    const theaterWarm = window.theater.warm(whenIdle);
    const groups = new Map();
    for (const img of document.querySelectorAll('img[data-src]')) {
      if (img.closest('#theater')) continue;
      const key = img.dataset.src;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(img);
    }
    for (const [src, images] of groups) {
      // The hardware is first in document order. The gallery follows in idle
      // slots, so its real textures can participate in the later warm shots.
      await whenIdle();
      for (const img of images) img.src = src;
      await Promise.all(images.map((img) => img.decode()));
      await new Promise((r) => setTimeout(r, 24));
    }
    await theaterWarm;
    document.body.dataset.backstage = 'ready';
  }
  function backgroundError(error) {
    document.body.dataset.backstage = 'error';
    console.error(error);
  }
  function tick(t) {
    const delta = previous ? t - previous : 16.67;
    previous = t;
    if (start === null) {
      // A 30 Hz screen can also present settled frames. Never skip the quiet-frame gate.
      if (coreReady) {
        quiet = delta < 21 || Math.abs(delta - lastInterval) < 3 ? quiet + 1 : 0;
      }
      lastInterval = delta;
      if (
        coreReady &&
        warmShot < warmShots.length &&
        (warmShot < 0 || (quiet >= 5 && t - shotStart >= 110))
      ) {
        nextWarmShot(t);
      } else if (coreReady && warmShot >= warmShots.length && quiet >= 8 && t - shotStart >= 140) {
        start = t;
        document.body.dataset.phase = 'opening';
      }
    }
    if (start !== null) {
      const elapsed = t - start;
      const showTheater = visible(scenes[2]);
      const gap = targetY - camera;
      if (alignCamera || Math.abs(gap) > viewport * 0.75 || Math.abs(gap) < 0.1) camera = targetY;
      else camera += gap * (1 - Math.exp(-delta / 42));
      alignCamera = false;
      day += (dayTarget - day) * (1 - Math.exp(-delta / 85));
      if (Math.abs(day - dayTarget) < 0.001) day = dayTarget;
      if (document.body.dataset.phase === 'opening') {
        curtain.style.opacity = String(1 - clamp(elapsed / 480));
        if (elapsed >= 480 && !curtain.hidden) {
          curtain.hidden = true;
        }
        for (const [i, title] of titles.entries()) {
          const p = clamp((elapsed - i * 100) / 850);
          title.style.transform = 'translate3d(0,' + 105 * (1 - p) ** 3 + '%,0)';
        }
        if (elapsed >= 1150) {
          document.body.dataset.phase = 'ready';
          curtain.style.display = 'none';
          window.acts.startHighlights();
          for (const { node } of scenes.slice(1)) reveal.observe(node);
        }
      }
      if (visible(scenes[0])) {
        const p = clamp(camera / Math.max(1, viewport));
        const enter = (1 - clamp(elapsed / 1150)) ** 3;
        hardware.style.transform =
          'translate3d(0,' +
          (enter * 52 + Math.sin(t * 0.0007) * 4 - p * 20) +
          'px,0) rotateY(' +
          (-15 - enter * 9 + p * 8) +
          'deg) rotateX(6deg) rotateZ(-3deg)';
        seal.style.transform =
          'translate3d(0,' + (Math.sin(t * 0.001) * 6 + p * 15) + 'px,0) rotate(-10deg)';
        landscape.style.transform =
          'translate3d(0,' +
          p * 18 +
          'px,0) scale(' +
          (1.045 + p * 0.025 + Math.sin(t * 0.00035) * 0.004) +
          ')';
        reflection.style.transform =
          'translate3d(' + (-100 + 200 * clamp((elapsed % 7000) / 2200)) + '%,0,0)';
        if (day !== lastHeroDay) {
          const hidden = (1 - day) * 100;
          heroWipe.style.transform = 'translate3d(' + -hidden + '%,0,0)';
          heroDay.style.transform = 'translate3d(' + hidden + '%,0,0)';
          lastHeroDay = day;
        }
        dust.style.transform =
          'translate3d(' +
          Math.sin(t * 0.00019) * 12 +
          'px,' +
          Math.cos(t * 0.00028) * 15 +
          'px,0)';
      }
      window.theater.frame(t, showTheater);
      if (visible(scenes[5])) {
        finalSeal.style.transform = 'translateY(' + Math.sin(t * 0.001) * 5 + 'px)';
        finalLight.style.opacity = String(0.48 + 0.45 * Math.sin(t * 0.001));
      }
    }
    requestAnimationFrame(tick);
  }
  let lastInterval = 0;
  async function prepare() {
    const core = [one('.loading-seal img'), landscape, one('.hero-screen img'), heroDay];
    const surface = document.createElement('canvas');
    surface.width = 512;
    surface.height = 320;
    const context = surface.getContext('2d');
    let count = 0;
    await Promise.all(
      core.map(async (img) => {
        await img.decode();
        if (!img.naturalWidth) throw Error('首幕图片未解码');
        context?.drawImage(img, 0, 0, 512, 320);
        count++;
        showLoadProgress(count, '准备开场画面 · ' + count + ' / 4');
      }),
    );
    // Paint the actual hardware/text layers behind the nearly opaque curtain.
    drawDust();
    window.theater.preparePaint();
    curtain.style.opacity = '.99';
    for (const image of document.querySelectorAll('img[data-src],img[data-theater-src]')) {
      if (image.closest('#devices')) {
        image.src = image.classList.contains('device-day')
          ? heroDay.src
          : one('.hero-screen img').src;
      } else {
        image.src = image.closest('.campaign-land,.th-face') ? landscape.src : seal.src;
      }
    }
    await window.acts.prepare(heroDay);
    // Decode each asset in idle slots, then warm the actual textures behind the curtain.
    await backstage().catch((error) => {
      backgroundError(error);
      throw error;
    });
    hardware.style.willChange = 'transform';
    document.body.dataset.core = 'warm';
    coreReady = true;
  }
  requestAnimationFrame(tick);
  prepare().catch(() => {
    label.textContent = '开场画面加载失败，仍可从顶栏下载';
    const retry = one('#retry');
    retry.hidden = false;
    retry.onclick = () => location.reload();
  });
})();
