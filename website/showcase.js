(() => {
  const stage = document.querySelector('#theater');
  const cards = [
    ['sha', '♠', '7', '杀', '基本'],
    ['guohe', '♣', '3', '过河拆桥', '锦囊'],
    ['nanman', '♠', 'K', '南蛮入侵', '锦囊'],
  ];
  const props = [
    ['flower', '鲜花'],
    ['egg', '鸡蛋'],
    ['wine', '美酒'],
    ['shoe', '草鞋'],
  ];
  const picture = (path, description = '') =>
    '<img data-theater-src="assets/' +
    path +
    '.webp" alt="' +
    description +
    '" draggable="false" decoding="async">';
  stage.innerHTML = `
    <div class="th-wrap">
      <header class="th-header"><p class="th-kicker">出牌与互动</p>
        <h2 id="theater-title">每张牌，每一掷，<em>皆有回响。</em></h2>
      </header>
      <div class="th-stage">
        <div class="th-deck">
          <div class="th-fan">${cards
            .map(
              ([id, suit, rank, name, type]) => `
            <button type="button" data-card="${id}" aria-label="打出${name}" disabled>
              <span class="th-face">${picture('cards/card-' + id)}
                <span class="th-foil"></span><span class="th-rank">${rank}<small>${suit}</small></span>
                <span class="th-title"><small>${type}</small><b>${name}</b></span>
              </span>
              <canvas data-impact="${id}" width="480" height="260" aria-hidden="true"></canvas>
            </button>`,
            )
            .join('')}
          </div>
          <p class="th-hint">轻点卡面出牌</p>
        </div>
        <div class="th-range">
          <div class="th-range-head">${picture('props/prop-basket')}<h3>手杀菜篮子</h3></div>
          <div class="th-arena" aria-hidden="true">
            <div class="th-plinth"></div><div class="th-target">${picture('emblems/emblem-identity')}</div>
            <div class="th-splat">${picture('props/prop-egg-splat')}</div><b class="th-combo">×1</b>
          </div>
          <div class="th-ammo">${props.map(([id, name]) => `<button type="button" data-prop="${id}" aria-label="投掷${name}" disabled>${picture('props/prop-' + id)}<span>${name}</span></button>`).join('')}</div>
          <p class="th-hint">连点道具，掷向玉印</p>
        </div>
      </div>
    </div>`;
  stage.setAttribute('aria-labelledby', 'theater-title');
  const fan = stage.querySelector('.th-fan');
  const arena = stage.querySelector('.th-arena');
  const target = arena.querySelector('.th-target');
  const splat = arena.querySelector('.th-splat');
  const combo = arena.querySelector('.th-combo');
  const idleAlpha = 0;
  // Touch browsers may queue a compatibility click after the finger has lifted.
  // React to the completed tap itself, preserving scrolling and native keyboard activation.
  function onActivation(button, activate) {
    let touch = null;
    let handledTouch = false;
    button.addEventListener('pointerdown', (event) => {
      handledTouch = false;
      touch =
        event.isPrimary && event.pointerType === 'touch'
          ? { id: event.pointerId, x: event.clientX, y: event.clientY }
          : null;
    });
    button.addEventListener('pointercancel', () => {
      touch = null;
    });
    button.addEventListener('pointerup', (event) => {
      if (!touch || touch.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - touch.x, event.clientY - touch.y);
      touch = null;
      handledTouch = true;
      if (moved < 12 && !button.disabled) activate();
    });
    button.addEventListener('click', (event) => {
      if (!handledTouch || event.detail === 0) activate();
      handledTouch = false;
    });
  }
  const cardStates = [];
  const flyers = [];
  let comboCount = 0;
  let lastThrow = -Infinity;
  let lastHit = -Infinity;
  let hitKind = '';
  let drumStart = -Infinity;
  let lastEgg = -Infinity;
  let fanWidth = 1;
  let arenaWidth = 1;
  let arenaHeight = 1;
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === fan) {
        fanWidth = entry.contentRect.width;
      }
      if (entry.target === arena) {
        arenaWidth = entry.contentRect.width;
        arenaHeight = entry.contentRect.height;
      }
    }
  });
  resize.observe(fan);
  resize.observe(arena);

  // Bake the light, debris and brush edges once. Each burst is a single texture;
  // its presentation needs no path clipping, shadow raster or particle layer creation.
  const palette = {
    sha: ['#f35c33', '#ffe4a1'],
    guohe: ['#65aa94', '#d4f6d9'],
    nanman: ['#c18e4c', '#ffe5ab'],
    flower: ['#b75468', '#ffccd0'],
    egg: ['#f5ca6d', '#fff2b8'],
    wine: ['#ad6330', '#ffca68'],
    shoe: ['#bd9c63', '#ffde97'],
  };
  function paintBurst(canvas, id, card) {
    // These are one-time paint masters. Upload the finished bitmap as a layer.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const [dark, light] = palette[id];
    const w = canvas.width,
      h = canvas.height;
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / 480, h / 260);
    if (id === 'guohe' || id === 'shoe' || id === 'flower') {
      const fog = ctx.createRadialGradient(0, 0, 7, 0, 0, 118);
      fog.addColorStop(0, id === 'guohe' ? '#96e7cc89' : '#ffe0a441');
      fog.addColorStop(1, '#ccb58900');
      ctx.save();
      ctx.scale(1.85, 0.82);
      ctx.fillStyle = fog;
      ctx.fillRect(-118, -118, 236, 236);
      ctx.restore();
    }
    if (id === 'flower') {
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffda9be6';
      ctx.beginPath();
      ctx.ellipse(0, 16, 186, 58, -0.19, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (id === 'wine' || id === 'shoe') {
      const ribbon = ctx.createLinearGradient(-190, 0, 192, 0);
      ribbon.addColorStop(0, dark + '00');
      ribbon.addColorStop(0.4, dark + 'dd');
      ribbon.addColorStop(0.68, light);
      ribbon.addColorStop(1, light + '00');
      ctx.fillStyle = ribbon;
      for (let i = 0; i < 3; i++) {
        const dy = i * 24;
        ctx.beginPath();
        ctx.moveTo(-173, dy + 23);
        ctx.quadraticCurveTo(-5, -62 + dy, 150 + i * 12, -54 + dy);
        ctx.quadraticCurveTo(-10, -37 + dy, -173, dy + 23);
        ctx.fill();
      }
    }
    if (card) {
      if (id === 'nanman') {
        const halo = ctx.createRadialGradient(0, 0, 10, 0, 0, 116);
        halo.addColorStop(0, '#c8934938');
        halo.addColorStop(0.78, '#dead632b');
        halo.addColorStop(1, '#dca65e00');
        ctx.fillStyle = halo;
        ctx.fillRect(-120, -120, 240, 240);
        for (let i = 0; i < 4; i++) {
          ctx.strokeStyle = i % 2 ? dark : light;
          ctx.lineWidth = 2 - i * 0.3;
          ctx.beginPath();
          ctx.ellipse(0, 0, 94 - i * 14, 90 - i * 13, 0, 0.08 + i * 0.1, Math.PI * 2 - 0.04);
          ctx.stroke();
        }
      } else {
        const blade = ctx.createLinearGradient(-205, 0, 205, 0);
        blade.addColorStop(0, dark + '00');
        blade.addColorStop(0.25, id === 'guohe' ? light : dark);
        blade.addColorStop(0.57, id === 'guohe' ? '#f3d591' : light);
        blade.addColorStop(1, dark + '00');
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.fillStyle = blade;
          ctx.globalAlpha = 1 - i * 0.21;
          ctx.translate((i - 1) * 12, (i - 1) * 13);
          ctx.scale(1 - i * 0.11, 1);
          ctx.beginPath();
          ctx.moveTo(-230, 45);
          if (id === 'sha') {
            ctx.quadraticCurveTo(-28, 7, 229, -35);
            ctx.quadraticCurveTo(20, -26, -230, 45);
          } else {
            ctx.bezierCurveTo(-155, 6, -86, -37, -18, -11);
            ctx.lineTo(-2, -23);
            ctx.lineTo(-9, -7);
            ctx.bezierCurveTo(-85, -29, -123, 15, -230, 45);
            ctx.moveTo(11, -16);
            ctx.bezierCurveTo(99, -74, 152, -28, 225, -43);
            ctx.bezierCurveTo(139, -21, 91, -62, 15, -9);
          }
          ctx.fill();
          ctx.restore();
        }
      }
    }
    for (let i = 0; i < (card ? 60 : id === 'egg' ? 25 : 36); i++) {
      const angle = i * 2.399963,
        distance = 15 + ((i * 47) % 103);
      const x = Math.cos(angle) * distance * (id === 'nanman' ? 1 : id === 'egg' ? 1.2 : 1.7),
        y = Math.sin(angle) * distance * (id === 'shoe' ? 0.4 : 0.83);
      ctx.fillStyle = i % 4 ? dark : light;
      ctx.globalAlpha = 0.45 + (i % 6) * 0.1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      if (id === 'flower' || id === 'wine') {
        const size = id === 'flower' ? 10 + (i % 6) : 4 + (i % 5);
        if (id === 'flower') ctx.fillStyle = i % 3 ? ['#cc637d', '#f695a0'][i % 2] : light;
        ctx.moveTo(-size, 0);
        ctx.bezierCurveTo(-size * 0.5, -size, size, -size * 0.55, size, 0);
        ctx.bezierCurveTo(size * 0.45, size * 0.65, -size * 0.3, size * 0.6, -size, 0);
      } else if (id === 'guohe' && i % 5 === 0) {
        ctx.moveTo(-8, -2);
        ctx.lineTo(10, -4);
        ctx.lineTo(5, 4);
        ctx.lineTo(-6, 5);
        ctx.fillStyle = light;
      } else {
        ctx.ellipse(0, 0, 2 + (i % 5), 1 + (i % 2) * 0.5, 0, 0, 2 * Math.PI);
      }
      ctx.fill();
      ctx.restore();
    }
  }
  const debris = props.map(([id]) => {
    const el = document.createElement('canvas');
    el.width = 240;
    el.height = 130;
    el.className = 'th-debris';
    el.dataset.debris = id;
    arena.append(el);
    return { id, el, start: -Infinity };
  });
  function renderCard(card, time) {
    card.x += (card.aimX - card.x) * 0.19;
    card.y += (card.aimY - card.y) * 0.19;
    const t = Math.max(0, Math.min(1, (time - card.start) / 670));
    const kick = (1 - t) ** 3;
    const drum = Math.max(0, (time - drumStart - card.drumDelay) / 320);
    const tremor = drum > 0 && drum < 1 ? Math.sin(drum * 19) * (1 - drum) ** 2 : 0;
    card.face.style.transform = `perspective(650px) translate3d(${tremor * 7}px,${-22 * kick}px,0) rotateX(${card.y * 8 + kick * 6}deg) rotateY(${card.x * 12}deg) rotateZ(${tremor * 2.8}deg) scale(${1 + kick * 0.06})`;
    card.foil.style.transform = `translate3d(${card.x * 57 + kick * 83}%,0,0)`;
    card.fx.style.opacity = String(Math.max(idleAlpha, Math.min(1, (1 - t) * 2)));
    if (card.id === 'sha')
      card.fx.style.transform = `rotate(-53deg) translate3d(${t * 18}%,0,0) scale(${0.72 + t * 0.85},${1 - t * 0.6})`;
    if (card.id === 'guohe')
      card.fx.style.transform = `translate3d(0,${-t * 12}%,0) rotate(-9deg) scale(${0.68 + t * 0.7})`;
    if (card.id === 'nanman') card.fx.style.transform = `scale(${0.52 + t * 1.43})`;
    card.dirty =
      t < 1 || drum < 1 || Math.abs(card.x - card.aimX) + Math.abs(card.y - card.aimY) > 0.006;
  }
  for (const [id] of cards) {
    const el = stage.querySelector(`[data-card="${id}"]`);
    const card = {
      el,
      id,
      face: el.querySelector('.th-face'),
      foil: el.querySelector('.th-foil'),
      fx: stage.querySelector(`[data-impact="${id}"]`),
      drumDelay: id === 'nanman' ? 0 : id === 'guohe' ? 55 : 105,
      x: 0,
      y: 0,
      aimX: 0,
      aimY: 0,
      dirty: false,
      start: -Infinity,
    };
    cardStates.push(card);
    function tilt(event) {
      const w = Math.max(1, fanWidth * 0.34);
      card.aimX = Math.max(-1, Math.min(1, (event.offsetX / w) * 2 - 1));
      card.aimY = Math.max(-1, Math.min(1, 1 - (event.offsetY / (w * 1.4)) * 2));
      card.dirty = true;
    }
    el.addEventListener('pointermove', tilt);
    el.addEventListener('pointerdown', tilt);
    const neutral = () => {
      card.aimX = card.aimY = 0;
      card.dirty = true;
    };
    el.addEventListener('pointerleave', neutral);
    el.addEventListener('pointercancel', neutral);
    onActivation(el, () => {
      const time = performance.now();
      if (id === 'nanman') {
        drumStart = time;
        for (const neighbor of cardStates) neighbor.dirty = true;
      }
      card.start = time;
      card.dirty = true;
      renderCard(card, time);

      performance.mark('theater:card:' + id);
    });
  }
  function renderFlight(flight, time) {
    const t = Math.min(1, Math.max(0, (time - flight.start) / flight.duration));
    const p = flight.id === 'shoe' ? t ** 1.65 : t;
    const x = ((1 - p) * flight.from + flight.curve * p * (1 - p)) * arenaWidth;
    const y = ((1 - p) * 0.64 - flight.arc * p * (1 - p)) * arenaHeight;
    const spin = flight.id === 'wine' ? -112 * t ** 1.4 : (p - 1) * flight.spin;
    flight.el.style.transform = `translate3d(${x}px,${y}px,0) rotate(${spin}deg) scale(${0.78 + 0.38 * Math.sin(p * Math.PI)})`;
    flight.el.style.opacity = t < 1 ? '1' : String(idleAlpha);
    if (t === 1) {
      flight.live = false;
      lastHit = time;
      hitKind = flight.id;
      if (flight.id === 'egg') lastEgg = time;
      debris[flight.index].start = time;
    }
  }
  props.forEach(([id], index) => {
    const group = [];
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.className = 'th-flight';
      el.dataset.flight = id;
      el.innerHTML = picture('props/prop-' + id);
      arena.append(el);
      const flight = {
        el,
        id,
        live: false,
        start: 0,
        from: (index - 1.5) * 0.19,
        index,
        spin: id === 'shoe' ? 320 : id === 'flower' ? -92 : 132,
        duration: id === 'shoe' ? 310 : id === 'flower' ? 610 : 520,
        arc: id === 'flower' ? 3.1 : id === 'shoe' ? 1.45 : id === 'wine' ? 2.65 : 2.25,
        curve: id === 'shoe' ? 0.68 : id === 'wine' ? -0.45 : 0,
      };
      flyers.push(flight);
      group.push(flight);
    }
    let next = 0;
    onActivation(stage.querySelector(`[data-prop="${id}"]`), () => {
      const time = performance.now();
      const flight = group[next++ % group.length];
      flight.start = time;
      flight.live = true;
      comboCount = time - lastThrow < 1100 ? comboCount + 1 : 1;
      lastThrow = time;
      combo.textContent = '×' + comboCount;
      combo.style.opacity = '1';
      combo.style.transform = 'scale(1.22)';
      renderFlight(flight, time);
      performance.mark('theater:prop:' + id);
    });
  });
  function frame(time, active) {
    if (!active) return;
    for (const card of cardStates) if (card.dirty) renderCard(card, time);
    for (const flight of flyers) if (flight.live) renderFlight(flight, time);
    for (const burst of debris) {
      if (burst.start === -Infinity) continue;
      const t = Math.min(1, Math.max(0, (time - burst.start) / 520));
      burst.el.style.opacity = String(Math.max(idleAlpha, 1 - t));
      const spread = 1 - (1 - t) ** 2;
      if (burst.id === 'flower')
        burst.el.style.transform = `translate3d(0,${t * t * 13}px,0) rotate(${t * 12}deg) scale(${0.32 + 1.14 * spread})`;
      else if (burst.id === 'wine')
        burst.el.style.transform = `translate3d(${-t * 16}px,${t * t * 28 - 13 * spread}px,0) rotate(${-16 + t * 26}deg) scale(${0.28 + spread},${0.25 + 0.9 * spread})`;
      else if (burst.id === 'shoe')
        burst.el.style.transform = `translate3d(${-t * 31}px,${t * 9}px,0) rotate(18deg) scale(${0.44 + 1.2 * spread},${0.46 + 0.3 * spread})`;
      else
        burst.el.style.transform = `translate3d(0,${t * t * 18}px,0) rotate(${t * 16}deg) scale(${0.15 + 1.5 * t})`;
      if (t === 1) burst.start = -Infinity;
    }
    const hit = Math.max(0, (time - lastHit) / 360);
    if (lastHit !== -Infinity) {
      target.style.transform =
        hit >= 1
          ? 'none'
          : hitKind === 'shoe'
            ? `translate3d(${-Math.sin(hit * 26) * (1 - hit) ** 2 * 14}px,${3 * (1 - hit)}px,0) rotate(${-Math.sin(hit * 24) * (1 - hit) ** 2 * 9}deg)`
            : `translate3d(${Math.sin(hit * 14) * (1 - hit) * 6}px,0,0) rotate(${Math.sin(hit * 12) * (1 - hit) * 5}deg)`;
      if (hit >= 1) lastHit = -Infinity;
    }
    const egg = Math.max(0, (time - lastEgg) / 950);
    if (lastEgg !== -Infinity) {
      splat.style.opacity = String(Math.max(0, 1 - egg ** 3));
      splat.style.transform = `translate3d(0,${Math.min(egg, 1) * 23}px,0)`;
      if (egg >= 1) lastEgg = -Infinity;
    }
    if (lastThrow !== -Infinity) {
      const dt = Math.max(0, time - lastThrow);
      combo.style.opacity = String(Math.min(1, Math.max(0, (1300 - dt) / 220)));
      combo.style.transform = `scale(${1 + 0.22 * Math.max(0, 1 - dt / 180)})`;
      if (dt >= 1300) lastThrow = -Infinity;
    }
  }
  function preparePaint() {
    for (const card of cardStates) paintBurst(card.fx, card.id, true);
    for (const burst of debris) paintBurst(burst.el, burst.id, false);
  }
  async function warm(whenIdle) {
    const pictures = [...stage.querySelectorAll('[data-theater-src]')];
    const groups = new Map();
    for (const image of pictures) {
      const src = image.dataset.theaterSrc;
      if (!groups.has(src)) groups.set(src, []);
      groups.get(src).push(image);
    }
    for (const [src, images] of groups) {
      await whenIdle();
      for (const image of images) image.src = src;
      await Promise.all(images.map((image) => image.decode()));
    }
    for (const el of stage.querySelectorAll('button')) el.disabled = false;
    stage.dataset.ready = 'true';
  }
  window.theater = { frame, warm, preparePaint };
})();
