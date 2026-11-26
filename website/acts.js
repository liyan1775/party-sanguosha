(() => {
  const devices = document.querySelector('#devices');
  const modes = document.querySelector('#modes');
  const campaign = document.querySelector('#campaign');
  const asset = (name) => `./assets/${name}.webp`;
  const themePair = (name, description) => `
    <div class="device-screen">
      <img data-src="${asset(name + '-night')}" width="1440" height="900" alt="${description} · 夜间">
      <div class="device-wipe"><img class="device-day" data-src="${asset(name + '-day')}" width="1440" height="900" alt="${description} · 日间"></div>
    </div>`;
  const beatButtons = (labels) =>
    labels
      .map(
        (label, i) =>
          `<button type="button" data-beat aria-pressed="${i === 0}"><i aria-hidden="true"></i>${label}</button>`,
      )
      .join('') +
    '<button type="button" class="highlight-play" aria-pressed="true" aria-label="暂停自动轮播"><span aria-hidden="true">⏸</span></button>';
  const chapters = [
    ['共用大屏', '一台电脑开桌，', '满屋手机扫码入席。', '双码联机，一块大屏追踪全桌公开战况。'],
    ['各自入席', '朋友到齐，', '各自就位。', '选玩法，入座准备。手机就是你的席位。'],
    ['日夜双境', '从白昼，', '玩到入夜。', '同一张牌桌，两种光景。顶栏可随时切换。'],
  ];
  devices.innerHTML = `
    <div class="device-pin" data-pose="0">
      <div class="device-layout">
        <div class="device-editorial">
          <div class="act-kicker">多端联机 <i></i> MULTIPLAYER</div>
          <div class="device-captions">
            ${chapters
              .map(
                (
                  [label, first, second, detail],
                  i,
                ) => `<div class="device-caption" aria-hidden="${Boolean(i)}">
              <h2><span>${first}</span><span>${second}</span></h2><p>${detail}</p>
            </div>`,
              )
              .join('')}
          </div>
        </div>
        <div class="device-stage" aria-label="电脑与手机联机实拍">
          <div class="device-laptop"><div class="device-lid">${themePair('console', '电脑联机与公开观战')}</div><div class="device-hinge"></div><div class="device-base"></div></div>
          <div class="device-handset device-lobby">${themePair('lobby', '六玉印模式大厅')}</div>
          <div class="device-handset device-room">${themePair('room', '等待房四人入座')}</div>
        </div>
        <div class="device-cues" role="group" aria-label="联机分镜">${beatButtons(chapters.map(([label]) => label))}</div>
      </div>
    </div>`;
  const games = [
    ['identity', '经典身份', '主公明牌，<wbr>忠反暗战'],
    ['doudizhu', '欢乐斗地主', '农民互看手牌'],
    ['versus', '2v2 对抗', '队友锁将防撞'],
    ['duel', '1v1 单挑', '一人一将，<wbr>一局定胜'],
    ['college', '高校联赛', '轮换出场，<wbr>团队抢分'],
    ['shanhetu', '山河图', '单骑出征，<wbr>逐城构筑'],
  ];
  modes.innerHTML = `
    <div class="mode-gallery">
      <div class="act-kicker">玩法典藏 <i></i> GAME MODES</div>
      <h2>六境同席，<em>一卷山河。</em></h2>
      <ul class="seal-collection">${games
        .map(
          ([id, name, copy]) => `<li>
        <div class="seal-display"><img width="256" height="256" data-src="${asset('emblems/emblem-' + id)}" alt=""></div>
        <h3>${name}</h3><p>${copy
          .split('<wbr>')
          .map((part) => `<span>${part}</span>`)
          .join('<wbr>')}</p></li>`,
        )
        .join('')}</ul>
    </div>`;
  const landscapes = ['luoyang', 'hulao', 'yizhou', 'chibi'];
  const places = ['洛阳', '虎牢', '益州', '赤壁'];
  const counts = [
    [25, '档难度'],
    [14, '座汉末城池'],
    [4, '套古风牌桌'],
  ];
  campaign.innerHTML = `
    <div class="campaign-pin" data-pose="0">
      <div class="campaign-land" aria-hidden="true">${landscapes.map((name, i) => `<img data-active="${i === 0}" data-src="${asset('scenes/scene-' + name)}" width="1600" height="900" alt="">`).join('')}</div>
      <div class="campaign-vignette"></div>
      <div class="campaign-layout">
        <div class="campaign-editorial">
          <div class="act-kicker">单人征程 <i></i> 山河图</div>
          <h2>诸侯伐董<span>。</span></h2>
          <p>过关隘，访集市。带着你的战法，走出自己的行军路。</p>
          <div class="campaign-stats">${counts.map(([n, unit], i) => `<div class="campaign-stat"><strong>${n}</strong><small>${unit}${i === 2 ? '<span>全玩法共用</span>' : ''}</small></div>`).join('')}</div>
        </div>
        <figure class="campaign-hardware"><div class="campaign-map"><img data-src="${asset('shanhetu-map')}" width="430" height="880" alt="山河图实机画面，虎牢关行军路线"></div><figcaption>虎牢关 · 实机行军图</figcaption></figure>
        <div class="campaign-index" role="group" aria-label="山河画卷">${beatButtons(places)}</div>
      </div>
    </div>`;

  const one = (scope, selector) => scope.querySelector(selector);
  const all = (scope, selector) => [...scope.querySelectorAll(selector)];
  const laptop = one(devices, '.device-laptop');
  const lobby = one(devices, '.device-lobby');
  const room = one(devices, '.device-room');
  const captions = all(devices, '.device-caption');
  // The metal rim is static. Its transparent aperture looks through to the
  // original WebP elements; changing their source requires no pixel copies.
  function deviceRim(isLaptop) {
    const canvas = document.createElement('canvas');
    const narrow = matchMedia('(max-width: 780px) and (orientation: portrait)').matches;
    const cssWidth = window.innerWidth * (narrow ? 0.86 : 0.54) * (isLaptop ? 1.08 : 0.49);
    canvas.width = Math.max(160, Math.min(1440, Math.ceil(cssWidth * devicePixelRatio)));
    canvas.height = Math.ceil(canvas.width * (isLaptop ? 0.568 : 0.64));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const w = canvas.width;
    const h = canvas.height;
    const margin = isLaptop ? w * 0.066 : 0;
    const caseWidth = w - 2 * margin;
    const bezel = Math.max(2, caseWidth * (isLaptop ? 0.012 : 0.016));
    const screenWidth = caseWidth - 2 * bezel;
    const screenHeight = (screenWidth * 5) / 8;
    const lidHeight = screenHeight + 2 * bezel;
    const radius = caseWidth * (isLaptop ? 0.022 : 0.067);
    function plate(x, y, width, height, r, fill) {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, r);
      ctx.fillStyle = fill;
      ctx.fill();
    }
    const metal = ctx.createLinearGradient(margin, 0, caseWidth, lidHeight);
    [
      [0, '#e6d4ae'],
      [0.12, '#65685f'],
      [0.33, '#262c29'],
      [0.58, '#9b9c8a'],
      [0.76, '#3c4038'],
      [0.96, '#c9b38b'],
      [1, '#454a40'],
    ].forEach(([point, color]) => metal.addColorStop(point, color));
    plate(margin, 0, caseWidth, lidHeight, radius, metal);
    plate(
      margin + bezel * 0.45,
      bezel * 0.45,
      caseWidth - bezel * 0.9,
      lidHeight - bezel * 0.9,
      radius * 0.94,
      '#101713',
    );
    if (isLaptop) {
      const base = ctx.createLinearGradient(0, lidHeight, 0, h);
      base.addColorStop(0, '#a8a89a');
      base.addColorStop(0.26, '#777a6e');
      base.addColorStop(0.62, '#444a41');
      base.addColorStop(1, '#1c241e');
      plate(0, lidHeight, w, h - lidHeight, [1, 1, h - lidHeight, h - lidHeight], base);
      plate(w * 0.425, lidHeight, 0.15 * w, (h - lidHeight) * 0.26, 1, '#373d34');
    }
    canvas.className = 'device-print';
    canvas.setAttribute('aria-hidden', 'true');
    ctx.globalCompositeOperation = 'destination-out';
    plate(margin + bezel, bezel, screenWidth, screenHeight, Math.max(1, radius - bezel), '#000');
    const scale = isLaptop ? 1.15 : 1;
    return {
      canvas,
      aspect: w / scale / h,
      screen: {
        position: 'absolute',
        left: 100 * (((margin + bezel) / w) * scale - (scale - 1) / 2) + '%',
        top: (100 * bezel) / h + '%',
        width: ((100 * screenWidth) / w) * scale + '%',
        border: 'none',
        borderRadius: isLaptop ? '1% / 2%' : '5% / 8%',
        overflow: 'hidden',
        background: 'transparent',
        visibility: 'visible',
      },
    };
  }
  let mounted = false;
  function prepare(placeholder) {
    if (mounted) return;
    const nodes = [laptop, lobby, room];
    const rims = nodes.map((node) => deviceRim(node === laptop));
    if (rims.some((rim) => !rim)) return;
    nodes.forEach((node, i) => {
      const rim = rims[i];
      const screen = one(node, '.device-screen');
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', one(screen, 'img').alt.split(' · ')[0]);
      Object.assign(screen.style, rim.screen);
      node.style.aspectRatio = String(rim.aspect);
      node.style.padding = '0';
      node.style.border = '0';
      for (const shot of all(screen, 'img')) {
        if (!shot.hasAttribute('src') && placeholder)
          shot.src = placeholder.currentSrc || placeholder.src;
      }
      node.replaceChildren(screen, rim.canvas);
      node.classList.add('device-flattened');
    });
    mounted = true;
  }

  const devicePin = one(devices, '.device-pin');
  const campaignPin = one(campaign, '.campaign-pin');
  const pictures = all(campaign, '.campaign-land img');
  let themeDay = 0;
  let restartDeviceClock;
  function devicePose(beat, wipe = beat === 2 ? 0.52 : themeDay) {
    devicePin.dataset.pose = beat;
    devicePin.style.setProperty('--wipe-offset', (1 - wipe) * 100 + '%');
    captions.forEach((caption, i) => caption.setAttribute('aria-hidden', String(i !== beat)));
  }
  function campaignPose(beat) {
    campaignPin.dataset.pose = beat;
    pictures.forEach((picture, i) => (picture.dataset.active = String(i === beat)));
  }
  function highlights(section, selector, duration, pose, hoverTargets) {
    const bar = one(section, selector);
    const buttons = all(bar, '[data-beat]');
    const toggle = one(bar, '.highlight-play');
    const hovered = new Set();
    let selected = 0;
    let playing = true;
    let visible = false;
    let clock;

    function sync() {
      const running = visible && playing && !document.hidden && hovered.size === 0;
      if (!running) {
        if (clock?.playState === 'running') clock.pause();
        return;
      }
      if (clock) {
        if (clock.playState === 'paused') clock.play();
        return;
      }
      const countdown = one(buttons[selected], 'i').animate(
        [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration, fill: 'forwards' },
      );
      clock = countdown;
      countdown.onfinish = () => {
        if (clock !== countdown) return;
        if (!visible || !playing || document.hidden || hovered.size) {
          clock.pause();
          return;
        }
        select((selected + 1) % buttons.length);
      };
    }
    function setPlaying(value) {
      playing = value;
      toggle.setAttribute('aria-pressed', String(value));
      toggle.setAttribute('aria-label', value ? '暂停自动轮播' : '继续自动轮播');
      toggle.firstElementChild.textContent = value ? '⏸' : '▶';
    }
    function resetClock() {
      clock?.cancel();
      clock = undefined;
    }
    function select(index) {
      resetClock();
      selected = index;
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      pose(index);
      sync();
    }
    buttons.forEach((button, i) =>
      button.addEventListener('click', () => {
        setPlaying(false);
        select(i);
      }),
    );
    toggle.addEventListener('click', () => {
      setPlaying(!playing);
      sync();
    });
    for (const node of [bar, ...all(section, hoverTargets)]) {
      node.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'mouse') return;
        hovered.add(node);
        sync();
      });
      node.addEventListener('pointerleave', () => {
        hovered.delete(node);
        sync();
      });
    }
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.2;
        sync();
      },
      { threshold: 0.2, rootMargin: '-96px 0px 0px' },
    ).observe(section);
    document.addEventListener('visibilitychange', sync);
    return () => {
      resetClock();
      sync();
    };
  }
  function startHighlights() {
    restartDeviceClock = highlights(devices, '.device-cues', 4400, devicePose, '.device-stage');
    highlights(
      campaign,
      '.campaign-index',
      4800,
      campaignPose,
      '.campaign-layout > :not(.campaign-index)',
    );
  }
  function themePose(day) {
    themeDay = day;
    devicePose(Number(devicePin.dataset.pose), day);
    restartDeviceClock?.();
  }
  devicePose(0);
  campaignPose(0);
  window.acts = { prepare, devicePose, campaignPose, startHighlights, themePose };
})();
