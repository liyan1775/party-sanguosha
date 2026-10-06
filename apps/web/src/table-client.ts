import type { TableItem, TablePlayer, TableState } from '../../../packages/shared/src/table.js';
import { PlayerTransport } from '../../../packages/noname-adapter/runtime/player-transport.js';
import { createTableAudio } from './table-audio.js';
import { createTableMotion } from './table-motion.js';

const matchId = location.pathname.split('/')[3]!;
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};
const notify = (type: string, extra = {}) =>
  parent.postMessage({ type, matchId, ...extra }, location.origin);
let state: TableState | undefined;
let transport: PlayerTransport;
let busy = false;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
let busyTimer: ReturnType<typeof setTimeout> | undefined;
let lobbyFinished = false;
let cardHelp = false;
const motion = createTableMotion(element('table'));
const motionButton = element<HTMLButtonElement>('motion-button');
const motionPreference = () => {
  motionButton.setAttribute('aria-pressed', String(motion.reduced));
  motionButton.textContent = motion.reduced ? '恢复动画' : '精简动画';
  element('table').classList.toggle('reduced-motion', motion.reduced);
};
motionButton.onclick = () => {
  motion.toggle();
  motionPreference();
};
motionPreference();
const itemData = new WeakMap<HTMLElement, { item: TableItem; passive: boolean }>();
const playerData = new WeakMap<HTMLElement, TablePlayer>();
const playerAppearance = new WeakMap<HTMLElement, string>();
const dialogAppearance = new WeakMap<HTMLElement, string>();
function updateItem(button: HTMLButtonElement, item: TableItem, passive = false) {
  const before = itemData.get(button)?.item;
  itemData.set(button, { item, passive });
  button.className = `table-item ${item.kind}${item.selected ? ' selected' : ''}${item.enabled ? ' selectable' : ''}`;
  button.dataset.key = item.key;
  button.dataset.action = passive ? '' : item.action;
  button.setAttribute('aria-label', `${item.label} ${item.suit}${item.number}`.trim());
  button.setAttribute('aria-pressed', String(item.selected));
  button.disabled = item.kind === 'control' && (passive || !item.enabled);
  if (
    !before ||
    ['label', 'image', 'suit', 'number', 'kind'].some(
      (key) => before[key as keyof TableItem] !== item[key as keyof TableItem],
    )
  ) {
    button.replaceChildren();
    if (item.image) button.append(picture(item.image, '', 'item-image'));
    if (item.suit || item.number)
      button.append(
        make(
          'span',
          `card-corner${['♥', '♦'].includes(item.suit) ? ' red-suit' : ''}`,
          `${item.suit}\n${item.number}`,
        ),
      );
    button.append(make('span', 'item-label', item.label));
  }
  const tick = button.querySelector('.selection-tick');
  if (item.selected && !tick) button.append(make('span', 'selection-tick', '✓'));
  if (!item.selected) tick?.remove();
}
function syncItems(parent: HTMLElement, items: TableItem[], passive = false) {
  const old = new Map(
    [...parent.children].map((node) => [
      (node as HTMLElement).dataset.key,
      node as HTMLButtonElement,
    ]),
  );
  const nodes = items.map((item) => {
    const node = old.get(item.key) ?? itemNode(item, passive);
    updateItem(node, item, passive);
    return node;
  });
  // moveBefore/append only when order changes: focused and selected nodes survive.
  nodes.forEach((node, index) => {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
  });
  for (const child of [...parent.children])
    if (!nodes.includes(child as HTMLButtonElement)) child.remove();
}
function details(title: string, entries: { label: string; detail: string }[]) {
  element('detail-title').textContent = title;
  element('detail-content').replaceChildren(
    ...entries.map((entry) => {
      const section = make('section', 'detail-entry');
      section.append(make('h3', '', entry.label), make('p', '', entry.detail || '暂无说明'));
      return section;
    }),
  );
  element<HTMLDialogElement>('detail-dialog').showModal();
}
element('close-detail').addEventListener('click', () =>
  element<HTMLDialogElement>('detail-dialog').close(),
);
element('abilities-button').addEventListener('click', () =>
  details('我的武将技能', state?.abilities ?? []),
);
element('card-help-button').addEventListener('click', () => {
  cardHelp = !cardHelp;
  element('card-help-button').classList.toggle('active', cardHelp);
  element('card-help-button').textContent = cardHelp ? '点牌查看说明' : '牌面说明';
});
element('return-room').addEventListener('click', () => notify('party-return-room'));
element('retry-table').addEventListener('click', () => location.reload());
element('auto-button').addEventListener('click', () => submit(state?.autoAction ?? ''));
function clearBusy() {
  busy = false;
  clearTimeout(feedbackTimer);
  clearTimeout(busyTimer);
  element('action-feedback').hidden = true;
}
function submit(action: string) {
  if (!state || !action || busy || transport.readyState !== 1) return;
  busy = true;
  transport.send(JSON.stringify(['tableAction', state.epoch, state.choice, action]));
  feedbackTimer = setTimeout(() => {
    element('action-feedback').hidden = false;
  }, 350);
  busyTimer = setTimeout(() => {
    clearBusy();
    element('turn-hint').textContent = '同步稍慢，可点击「恢复牌桌」重新连接。';
  }, 5000);
}
function picture(path: string, label: string, className: string) {
  const image = make('img', className);
  image.src = path;
  image.alt = label;
  image.draggable = false;
  image.addEventListener(
    'error',
    () => {
      image.hidden = true;
    },
    { once: true },
  );
  return image;
}
function itemNode(item: TableItem, passive = false) {
  const button = make(
    'button',
    `table-item ${item.kind}${item.selected ? ' selected' : ''}${item.enabled ? ' selectable' : ''}`,
  );
  button.type = 'button';
  button.dataset.key = item.key;
  button.dataset.action = passive ? '' : item.action;
  button.setAttribute('aria-label', `${item.label} ${item.suit}${item.number}`.trim());
  button.setAttribute('aria-pressed', String(item.selected));
  // Unavailable cards still open their explanation; they never send actions.
  if (item.kind === 'control') button.disabled = passive || !item.enabled;
  if (item.image) button.append(picture(item.image, '', 'item-image'));
  const red = ['♥', '♦'].includes(item.suit);
  if (item.suit || item.number)
    button.append(
      make('span', `card-corner${red ? ' red-suit' : ''}`, `${item.suit}\n${item.number}`),
    );
  button.append(make('span', 'item-label', item.label));
  if (item.selected) button.append(make('span', 'selection-tick', '✓'));
  button.addEventListener('click', () => {
    const data = itemData.get(button)!;
    if (cardHelp || data.passive || !data.item.action) {
      if (data.item.detail)
        details(data.item.label, [{ label: data.item.label, detail: data.item.detail }]);
    } else submit(data.item.action);
  });
  itemData.set(button, { item, passive });
  return button;
}
function playerNode(player: TablePlayer, self = false) {
  const node = make(
    'article',
    `player-seat${self ? ' own-seat' : ''}${player.current ? ' current-seat' : ''}${player.selected ? ' selected-seat' : ''}${player.dead ? ' dead-seat' : ''}${player.action ? ' selectable-seat' : ''}`,
  );
  node.dataset.playerId = player.id;
  const face = make('button', 'player-face');
  face.type = 'button';
  face.setAttribute('aria-label', `选择目标 ${player.nickname}（${player.general}）`);
  face.setAttribute('aria-pressed', String(player.selected));
  if (player.image) face.append(picture(player.image, '', 'player-portrait'));
  face.append(
    make('span', 'player-general', player.general || '待选将'),
    make('span', 'player-identity', player.identity),
  );
  const hp = make('span', `health${player.hp <= 1 ? ' low-health' : ''}`);
  for (let i = 0; i < Math.min(player.maxHp, 8); i++)
    hp.append(make('i', i < player.hp ? 'hp filled' : 'hp'));
  hp.append(
    make('b', '', `${player.hp}/${player.maxHp}${player.armor ? ` +${player.armor}盾` : ''}`),
  );
  face.append(hp, make('span', 'hand-badge', `${player.handCount}张`));
  if (player.dead) face.append(make('span', 'dead-stamp', '阵亡'));
  else if (player.linked || player.turned)
    face.append(
      make(
        'span',
        'seat-state',
        [player.linked ? '连环' : '', player.turned ? '翻面' : ''].filter(Boolean).join(' · '),
      ),
    );
  face.addEventListener('click', () => {
    const player = playerData.get(face.closest<HTMLElement>('.player-seat')!)!;
    if (player.action) submit(player.action);
    else
      details(player.nickname, [
        ...player.abilities,
        ...player.equipment.map((item) => ({ label: item.label, detail: item.detail })),
        ...player.judgments.map((item) => ({ label: item.label, detail: item.detail })),
        ...player.marks,
      ]);
  });
  node.append(
    make('span', 'player-nickname', self ? `${player.nickname} · 你` : player.nickname),
    face,
  );
  const equipment = make('div', 'equipment');
  for (const item of player.equipment) {
    const button = make('button', `equipment-item${item.selected ? ' selected' : ''}`, item.label);
    button.type = 'button';
    button.addEventListener('click', () =>
      item.action && !cardHelp
        ? submit(item.action)
        : details(item.label, [{ label: item.label, detail: item.detail }]),
    );
    equipment.append(button);
  }
  if (player.judgments.length || player.marks.length)
    equipment.append(
      make(
        'span',
        'public-marks',
        [
          ...player.judgments.map((item) => item.label),
          ...player.marks.map((mark) => mark.label),
        ].join(' · '),
      ),
    );
  node.append(equipment);
  playerData.set(node, player);
  return node;
}
function syncPlayers(parent: HTMLElement, players: TablePlayer[], self = false) {
  const old = new Map(
    [...parent.children].map((node) => [
      (node as HTMLElement).dataset.playerId,
      node as HTMLElement,
    ]),
  );
  const nodes = players.map((player) => {
    let node = old.get(player.id);
    const appearance = JSON.stringify({
      ...player,
      current: false,
      selected: false,
      action: '',
      hp: 0,
      handCount: 0,
    });
    if (!node) node = playerNode(player, self);
    else if (playerAppearance.get(node) !== appearance) {
      const fresh = playerNode(player, self);
      const oldImage = node.querySelector('img');
      const freshImage = fresh.querySelector('img');
      if (oldImage && freshImage?.src === oldImage.src) freshImage.replaceWith(oldImage);
      node.replaceChildren(...fresh.childNodes);
    }
    playerData.set(node, player);
    playerAppearance.set(node, appearance);
    node.className = `player-seat${self ? ' own-seat' : ''}${player.current ? ' current-seat' : ''}${player.selected ? ' selected-seat' : ''}${player.dead ? ' dead-seat' : ''}${player.action ? ' selectable-seat' : ''}`;
    const face = node.querySelector<HTMLButtonElement>('.player-face')!;
    face.setAttribute('aria-pressed', String(player.selected));
    const hp = face.querySelector<HTMLElement>('.health')!;
    hp.classList.toggle('low-health', player.hp <= 1);
    hp.querySelectorAll('.hp').forEach((dot, i) => dot.classList.toggle('filled', i < player.hp));
    hp.querySelector('b')!.textContent =
      `${player.hp}/${player.maxHp}${player.armor ? ` +${player.armor}盾` : ''}`;
    face.querySelector('.hand-badge')!.textContent = `${player.handCount}张`;
    return node;
  });
  nodes.forEach((node, i) => {
    if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
  });
  for (const child of [...parent.children])
    if (!nodes.includes(child as HTMLElement)) child.remove();
}
function render(next: TableState) {
  if (state && state.epoch === next.epoch && next.revision < state.revision) return;
  const scroll = [...document.querySelectorAll<HTMLElement>('[data-scroll-key]')].map((node) => ({
    key: node.dataset.scrollKey,
    left: node.scrollLeft,
    top: node.scrollTop,
  }));
  state = next;
  Object.assign(window, { partyTable: { state: next } });
  const native = (
    window as Window & { partyEngine?: { _status: { over: boolean }; proof: { booted: boolean } } }
  ).partyEngine;
  if (native) {
    native._status.over = next.over;
    native.proof.booted = true;
  }
  clearBusy();
  element('connection-error').hidden = true;
  const me = next.players.find((player) => player.id === next.playerId);
  syncPlayers(
    element('opponents'),
    next.players.filter((player) => player.id !== next.playerId),
  );
  syncPlayers(element('self'), me ? [me] : [], true);
  syncItems(element('hand'), next.hand);
  element('hand-count').textContent = `手牌 ${next.hand.length}`;
  syncItems(element('played'), next.played, true);
  element('round-label').textContent = next.round ? `第 ${next.round} 轮` : '选择武将';
  if (!next.round && next.hand.length) element('round-label').textContent = '对局进行中';
  const active = next.players.find((player) => player.current);
  element('turn-hint').textContent = next.auto
    ? '正在托管，点击「手动操作」回到牌桌'
    : active
      ? `${active.nickname}的回合`
      : '等待其他玩家选择…';
  element('auto-button').hidden = !next.autoAction || next.over || lobbyFinished;
  element('auto-button').textContent = next.auto ? '手动操作' : '托管';
  syncItems(element('controls'), [...next.skills, ...next.controls]);
  const selected = [
    ...next.hand.filter((item) => item.selected).map((item) => `【${item.label}】`),
    ...next.players.filter((player) => player.selected).map((player) => player.nickname),
  ];
  const confirm = next.controls.find((item) => item.label === '使用' || item.label === '确定');
  element('action-prompt').textContent = selected.length
    ? `已选 ${selected.join('、')} · ${confirm ? `点「${confirm.label}」提交` : '请选择目标或所需材料'}`
    : next.choosing
      ? next.prompt.split('\n')[0] || '请选择牌或目标，然后点确定'
      : next.auto
        ? '托管中'
        : '等待轮到你';
  const dialogs = next.over
    ? []
    : next.dialogs.filter(
        (dialog) =>
          dialog.text || dialog.items.length || dialog.groups?.length || dialog.zones.length,
      );
  element('choice-panel').classList.toggle(
    'prompt-only',
    !dialogs.some((dialog) => dialog.items.length || dialog.groups?.length || dialog.zones.length),
  );
  element('choice-panel').classList.toggle(
    'grouped-choice',
    dialogs.some((dialog) => dialog.groups?.length),
  );
  // Plain prompts remain readable in the center; option pools are scrollable.
  element('choice-panel').hidden = !dialogs.length || !next.choosing;
  const choiceContent = element('choice-content');
  const oldDialogs = new Map(
    [...choiceContent.children].map((node) => [
      (node as HTMLElement).dataset.key,
      node as HTMLElement,
    ]),
  );
  const sections = dialogs.map((dialog) => {
    const previous = oldDialogs.get(dialog.key);
    const layout = JSON.stringify(dialog, (key, value: unknown) =>
      ['enabled', 'selected', 'action'].includes(key) ? undefined : value,
    );
    if (previous && dialogAppearance.get(previous) === layout) {
      const items = new Map(
        [
          ...dialog.items,
          ...(dialog.groups ?? []).flatMap((group) => group.items),
          ...dialog.zones.flatMap((zone) => zone.items),
        ].map((item) => [item.key, item]),
      );
      previous.querySelectorAll<HTMLButtonElement>('.table-item').forEach((node) => {
        const item = items.get(node.dataset.key!);
        if (item) updateItem(node, item);
      });
      previous
        .querySelectorAll<HTMLButtonElement>('.move-destination')
        .forEach((node, i) => (node.dataset.action = dialog.zones[i]?.action ?? ''));
      return previous;
    }
    const section = make('section', 'choice-section');
    section.dataset.key = dialog.key;
    dialogAppearance.set(section, layout);
    if (dialog.text) section.append(make('p', 'choice-text', dialog.text));
    if (dialog.items.length && !dialog.groups?.length) {
      const options = make('div', 'choice-options');
      options.append(...dialog.items.map((item) => itemNode(item)));
      section.append(options);
    }
    for (const group of dialog.groups ?? []) {
      const pool = make('section', 'choice-group');
      pool.append(make('h3', 'choice-group-label', group.label));
      const options = make('div', 'choice-options');
      options.append(...group.items.map((item) => itemNode(item)));
      pool.append(options);
      section.append(pool);
    }
    for (const zone of dialog.zones) {
      const row = make('div', 'move-zone');
      const destination = make('button', 'move-destination', `${zone.label} · 移到此区`);
      destination.type = 'button';
      destination.dataset.action = zone.action;
      destination.addEventListener('click', () => submit(destination.dataset.action ?? ''));
      row.append(destination, ...zone.items.map((item) => itemNode(item)));
      section.append(row);
    }
    return section;
  });
  sections.forEach((node, i) => {
    if (choiceContent.children[i] !== node)
      choiceContent.insertBefore(node, choiceContent.children[i] ?? null);
  });
  for (const child of [...choiceContent.children])
    if (!sections.includes(child as HTMLElement)) child.remove();
  for (const position of scroll) {
    const node = [...document.querySelectorAll<HTMLElement>('[data-scroll-key]')].find(
      (node) => node.dataset.scrollKey === position.key,
    );
    if (node) {
      node.scrollLeft = position.left;
      node.scrollTop = position.top;
    }
  }
  showResult();
  const deliveryAge =
    (window as Window & { partyEngine?: { deliveryAge: number } }).partyEngine?.deliveryAge ?? 0;
  motion.update(next, deliveryAge);
  notify('party-connected');
}
function showResult() {
  element('result-panel').hidden = !state?.over && !lobbyFinished;
  element('result-title').textContent = state?.result || '本局已结束';
  if (state?.over || lobbyFinished) element<HTMLDialogElement>('detail-dialog').close();
}
window.addEventListener('message', (event) => {
  if (
    event.origin !== location.origin ||
    event.source !== parent ||
    event.data?.matchId !== matchId
  )
    return;
  if (event.data.type === 'party-finished') {
    lobbyFinished = true;
    showResult();
  }
});
notify('party-loading', {
  step: 1,
  message: '正在连接轻量牌桌…',
  detail: '只载入界面与本局所需图片',
});
try {
  const response = await fetch(`/engine/table-setup/${matchId}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('座位已失效，请返回房间');
  const setup = await response.json();
  const audio = createTableAudio(setup.assetBase, (enabled, muted) =>
    notify('party-audio', { enabled, muted }),
  );
  Object.assign(window, {
    partyEngine: {
      setup,
      _status: { over: false },
      proof: { booted: false },
      audio,
      deliveryAge: 0,
    },
  });
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  transport = new PlayerTransport(
    `${scheme}//${location.host}/engine/socket/${matchId}/player?client=light`,
  );
  transport.onopen = () =>
    notify('party-loading', {
      step: 3,
      message: '正在同步自己的牌桌…',
      detail: '规则由电脑执行，手机无需载入引擎',
    });
  transport.onmessage = ({ data }) => {
    try {
      const packet = JSON.parse(data);
      if (packet[0] === 'table' && packet[1]?.playerId === setup.playerId) render(packet[1]);
      else if (packet[0] === 'audio') {
        const engine = (window as Window & { partyEngine?: { deliveryAge: number } }).partyEngine;
        audio.play(packet[1], engine?.deliveryAge ?? 0);
      }
    } catch {
      element('connection-error').hidden = false;
      notify('party-disconnected');
    }
  };
  transport.onclose = ({ code, reason }) => {
    motion.reset();
    clearBusy();
    element('connection-error').hidden = false;
    if (code !== 1008 && reason !== '已在另一页面继续对局') notify('party-disconnected');
  };
} catch (error) {
  element('turn-hint').textContent = error instanceof Error ? error.message : '牌桌载入失败';
  element('connection-error').hidden = false;
  notify('party-loading', {
    step: 1,
    failed: true,
    message: '牌桌载入失败',
    detail: '请点击恢复牌桌重试',
  });
}
