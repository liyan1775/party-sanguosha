import type { TableState, TablePresentation } from '../../../packages/shared/src/table.js';

/** Native actions with code-drawn decoration; independent of rules and input. */
export function createTableMotion(table: HTMLElement) {
  const layer = document.createElement('div');
  layer.className = 'motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  table.append(layer);
  let epoch = '',
    cursor = 0,
    generation = 0,
    running = false;
  let reduced = localStorage.getItem('party_reduced_motion') === 'true';
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const queue: TablePresentation[] = [];
  const animations = new Set<Animation>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let latest: TableState;
  const compact = () => reduced || preference.matches;
  function reset() {
    generation++;
    queue.length = 0;
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    layer.replaceChildren();
    running = false;
    epoch = '';
  }
  function later(run: () => void, duration: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, duration);
    timers.add(timer);
  }
  function animate(node: HTMLElement, frames: Keyframe[], duration: number) {
    const animation = node.animate(frames, {
      duration: compact() ? Math.min(duration, 120) : duration,
      easing: 'cubic-bezier(.2,.65,.3,1)',
      fill: 'both',
    });
    animations.add(animation);
    void animation.finished
      .catch(() => {})
      .then(() => {
        animations.delete(animation);
        if (animation.playState === 'finished') {
          try {
            animation.commitStyles();
          } catch {
            /* A removed transient effect. */
          }
          animation.cancel();
        }
      });
    return animation;
  }
  function point(id: string, hand = false) {
    const node =
      hand && id === latest.playerId
        ? document.getElementById('hand')
        : [...document.querySelectorAll<HTMLElement>('[data-player-id]')]
            .find((node) => node.dataset.playerId === id)
            ?.querySelector('.player-face');
    const rect = (node ?? table).getBoundingClientRect(),
      base = table.getBoundingClientRect();
    return { x: rect.left - base.left + rect.width / 2, y: rect.top - base.top + rect.height / 2 };
  }
  function make(className: string, text = '') {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = text;
    layer.append(node);
    // Fast native bursts cannot leave an unbounded effect backlog.
    if (layer.childElementCount > 24) layer.firstElementChild?.remove();
    return node;
  }
  function beam(source: string, target: string) {
    const a = point(source),
      b = point(target),
      dx = b.x - a.x,
      dy = b.y - a.y;
    const line = make('motion-beam');
    const rotation = `rotate(${Math.atan2(dy, dx)}rad)`;
    Object.assign(line.style, {
      left: `${a.x}px`,
      top: `${a.y}px`,
      width: `${Math.hypot(dx, dy)}px`,
    });
    animate(
      line,
      [
        { opacity: 0, transform: `${rotation} scaleX(0)` },
        { opacity: 1, transform: `${rotation} scaleX(1)`, offset: 0.45 },
        { opacity: 1, offset: 0.7 },
        { opacity: 0 },
      ],
      900,
    );
    later(() => line.remove(), compact() ? 150 : 950);
  }
  function card(event: TablePresentation, index: number) {
    const drawing = event.kind === 'draw';
    const card = event.cards[index];
    const shown = !drawing && Boolean(card && card.label !== '暗牌');
    const node = make(`motion-card ${shown ? 'face' : 'back'}`);
    if (card && shown) {
      if (card.image) {
        const image = document.createElement('img');
        image.src = card.image;
        image.alt = '';
        image.onerror = () => (image.hidden = true);
        node.append(image);
      }
      const corner = document.createElement('span');
      corner.className = ['♥', '♦'].includes(card.suit) ? 'red-suit' : '';
      corner.textContent = `${card.suit}\n${card.number}`;
      const label = document.createElement('b');
      label.textContent = card.label;
      node.append(corner, label);
    } else node.textContent = '三国杀';
    const center = { x: table.clientWidth / 2 + index * 14, y: table.clientHeight * 0.5 };
    const start = drawing ? center : point(event.source, true);
    const end = drawing ? point(event.source, true) : center;
    Object.assign(node.style, { left: `${start.x - 35}px`, top: `${start.y - 47}px` });
    const dx = end.x - start.x,
      dy = end.y - start.y;
    animate(
      node,
      [
        { transform: `translate(${index * 8}px,0) scale(.65) rotate(-8deg)`, opacity: 0.3 },
        { transform: `translate(${dx}px,${dy}px) scale(1) rotate(0deg)`, opacity: 1 },
      ],
      500,
    );
    // Arrive, settle, hold, then fade: the original movement has time to read.
    later(
      () => {
        if (!node.isConnected) return;
        animate(node, [{ opacity: 1 }, { opacity: 0 }], 350);
        later(() => node.remove(), compact() ? 130 : 370);
      },
      compact() ? 130 : drawing ? 620 : 1200,
    );
  }
  function play(event: TablePresentation) {
    const seat = [...document.querySelectorAll<HTMLElement>('[data-player-id]')].find(
      (node) => node.dataset.playerId === event.source,
    );
    const location = point(event.source);
    if (
      event.kind === 'skill' ||
      (event.kind === 'health' && ['fire', 'thunder'].includes(event.nature))
    ) {
      const glow = make(`motion-glow ${event.nature}`);
      Object.assign(glow.style, { left: `${location.x - 55}px`, top: `${location.y - 55}px` });
      animate(
        glow,
        [
          { opacity: 0, transform: 'scale(.5) rotate(0deg)' },
          { opacity: 0.8, transform: 'scale(1.1) rotate(30deg)', offset: 0.4 },
          { opacity: 0, transform: 'scale(1.3) rotate(60deg)' },
        ],
        1100,
      );
      later(() => glow.remove(), compact() ? 150 : 1150);
    }
    if (['draw', 'throw', 'use', 'respond'].includes(event.kind)) {
      for (
        let index = 0;
        index < Math.min(event.kind === 'draw' ? 3 : 2, Math.max(1, event.count));
        index++
      )
        card(event, index);
      if (event.kind !== 'draw') for (const target of event.targets) beam(event.source, target);
    } else if (event.kind === 'damage' && seat) {
      animate(
        seat,
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-7px)', offset: 0.2 },
          { transform: 'translateX(5px)', offset: 0.45 },
          { transform: 'translateX(-3px)', offset: 0.7 },
          { transform: 'translateX(0)' },
        ],
        500,
      );
    } else if (event.kind === 'turn' && seat) {
      animate(
        seat,
        [
          { filter: 'brightness(1)' },
          { filter: 'brightness(1.35)', offset: 0.5 },
          { filter: 'brightness(1)' },
        ],
        650,
      );
    }
    if (['health', 'popup', 'skill', 'death', 'turn'].includes(event.kind)) {
      const node = make(
        `motion-label ${event.kind}${event.amount > 0 ? ' recovery' : ''}`,
        event.label,
      );
      const offset =
        event.kind === 'turn'
          ? -50
          : event.kind === 'skill'
            ? 25
            : event.kind === 'popup'
              ? -15
              : -25;
      Object.assign(node.style, { left: `${location.x}px`, top: `${location.y + offset}px` });
      const duration = event.kind === 'skill' ? 1500 : event.kind === 'turn' ? 1000 : 1200;
      animate(
        node,
        [
          { opacity: 0, transform: 'translate(-50%,8px) scale(.8)' },
          { opacity: 1, transform: 'translate(-50%,-12px) scale(1.08)', offset: 0.2 },
          { opacity: 1, transform: 'translate(-50%,-16px) scale(1)', offset: 0.7 },
          { opacity: 0, transform: 'translate(-50%,-35px) scale(1)' },
        ],
        duration,
      );
      later(() => node.remove(), compact() ? 150 : duration + 20);
      if (event.kind === 'skill') for (const target of event.targets) beam(event.source, target);
    }
    const source = latest.players.find((player) => player.id === event.source);
    const description = document.getElementById('motion-status')!;
    description.textContent = `${source?.nickname ?? ''} · ${event.kind === 'respond' ? '打出 ' : event.kind === 'use' ? '使用 ' : ''}${event.label}`;
    table.dataset.lastPresentation = event.kind;
    table.dataset.presentationId = String(event.id);
  }
  async function drain() {
    if (running) return;
    running = true;
    const token = generation;
    let previous = queue[0]?.at ?? 0;
    while (queue.length && token === generation) {
      const event = queue.shift()!;
      const delay = Math.min(180, Math.max(0, event.at - previous));
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (token !== generation || document.hidden) break;
      play(event);
      previous = event.at;
    }
    if (token === generation) running = false;
  }
  function update(state: TableState, deliveryAge = 0) {
    latest = state;
    const events = state.events ?? [],
      end = Math.max(0, ...events.map((event) => event.id));
    if (epoch !== state.epoch || document.hidden || state.over) {
      reset();
      epoch = state.epoch;
      cursor = end;
      return;
    }
    const pending = events.filter(
      (event) =>
        event.id > cursor && (state.presentedAt ?? event.at) - event.at + deliveryAge < 3000,
    );
    cursor = Math.max(cursor, end);
    if (deliveryAge > 3000) {
      reset();
      epoch = state.epoch;
      cursor = end;
      return;
    }
    queue.push(...pending.sort((a, b) => a.id - b.id));
    if (queue.length > 12) queue.splice(0, queue.length - 12);
    void drain();
  }
  document.addEventListener('visibilitychange', reset);
  preference.addEventListener('change', reset);
  return {
    update,
    reset,
    get reduced() {
      return reduced;
    },
    toggle() {
      reduced = !reduced;
      localStorage.setItem('party_reduced_motion', String(reduced));
      reset();
      return reduced;
    },
  };
}
