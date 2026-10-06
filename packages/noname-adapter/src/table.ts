import type { TableItem, TableState, TablePresentation } from '../../shared/src/table.js';

const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const count = (value: unknown, max = 1000) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);
const key = (value: unknown) => (/^[\w.-]{1,80}$/.test(text(value, 80)) ? text(value, 80) : '');
const image = (value: unknown) => {
  const path = text(value, 250);
  return /^\/engine\/(portraits\/[a-f0-9]{64}\/[\w-]+\.webp|core\/[a-f0-9]{40}\/image\/(character|card)\/[\w-]+\.(jpg|png|webp))$/.test(
    path,
  )
    ? path
    : '';
};
function item(value: unknown): TableItem {
  const data = record(value);
  return {
    key: key(data.key),
    action: data.enabled === true ? key(data.action) : '',
    kind: ['card', 'general', 'control'].includes(String(data.kind))
      ? (data.kind as TableItem['kind'])
      : 'text',
    label: text(data.label),
    detail: text(data.detail, 2000),
    image: image(data.image),
    suit: text(data.suit, 8),
    number: text(data.number, 8),
    selected: data.selected === true,
    enabled: data.enabled === true,
  };
}
const items = (value: unknown, max = 96) => list(value, max).map(item);
const notes = (value: unknown, max: number) =>
  list(value, max).map((value) => {
    const data = record(value);
    return { label: text(data.label), detail: text(data.detail, 2000) };
  });

/** Explicit fields only. No native event, functions, storage, card IDs or HTML. */
export function sanitizeTable(value: unknown, playerId: string): TableState | null {
  const data = record(value);
  if (data.playerId !== playerId || !key(data.epoch) || !Number.isSafeInteger(data.revision))
    return null;
  const seats = new Set(list(data.players, 8).map((value) => key(record(value).id)));
  const kinds = new Set([
    'draw',
    'throw',
    'use',
    'respond',
    'damage',
    'health',
    'popup',
    'skill',
    'turn',
    'death',
  ]);
  return {
    epoch: key(data.epoch),
    revision: count(data.revision, Number.MAX_SAFE_INTEGER),
    choice: count(data.choice, Number.MAX_SAFE_INTEGER),
    playerId,
    round: count(data.round),
    phase: text(data.phase),
    prompt: text(data.prompt, 4000),
    choosing: data.choosing === true,
    auto: data.auto === true,
    over: data.over === true,
    result: text(data.result, 1000),
    players: list(data.players, 8).map((value) => {
      const player = record(value);
      return {
        id: key(player.id),
        nickname: text(player.nickname, 32),
        general: text(player.general),
        image: image(player.image),
        identity: text(player.identity),
        hp: count(player.hp, 100),
        maxHp: count(player.maxHp, 100),
        armor: count(player.armor, 100),
        handCount: count(player.handCount),
        dead: player.dead === true,
        linked: player.linked === true,
        turned: player.turned === true,
        current: player.current === true,
        selected: player.selected === true,
        action: key(player.action),
        equipment: items(player.equipment, 16),
        judgments: items(player.judgments, 16),
        marks: notes(player.marks, 24),
        abilities: notes(player.abilities, 20),
      };
    }),
    hand: items(data.hand),
    controls: items(data.controls, 48),
    skills: items(data.skills, 48),
    dialogs: list(data.dialogs, 8).map((value) => {
      const dialog = record(value);
      return {
        key: key(dialog.key),
        text: text(dialog.text, 5000),
        items: items(dialog.items, 192),
        groups: list(dialog.groups, 12).map((value) => {
          const group = record(value);
          return { label: text(group.label), items: items(group.items) };
        }),
        zones: list(dialog.zones, 12).map((value) => {
          const zone = record(value);
          return { label: text(zone.label), action: key(zone.action), items: items(zone.items) };
        }),
      };
    }),
    played: items(data.played, 8),
    abilities: notes(data.abilities, 32),
    autoAction: key(data.autoAction),
    presentedAt: count(data.presentedAt, Number.MAX_SAFE_INTEGER),
    events: list(data.events, 32)
      .map(record)
      .filter(
        (event) =>
          Number.isSafeInteger(event.id) &&
          Number(event.id) > 0 &&
          Number.isSafeInteger(event.at) &&
          Boolean(key(event.source)) &&
          seats.has(key(event.source)) &&
          kinds.has(String(event.kind)),
      )
      .map((event) => ({
        id: Number(event.id),
        at: count(event.at, Number.MAX_SAFE_INTEGER),
        kind: event.kind as TablePresentation['kind'],
        source: key(event.source),
        targets: list(event.targets, 8)
          .map(key)
          .filter((id) => Boolean(id) && seats.has(id)),
        cards: list(event.cards, 8).map((value) => {
          const card = record(value);
          return {
            label: text(card.label, 80),
            image: image(card.image),
            suit: text(card.suit, 8),
            number: text(card.number, 8),
            nature: text(card.nature, 40),
          };
        }),
        count: count(event.count, 96),
        label: text(event.label, 160),
        amount:
          typeof event.amount === 'number' && Number.isFinite(event.amount)
            ? Math.max(-100, Math.min(100, event.amount))
            : 0,
        nature: text(event.nature, 40),
      })),
  };
}

export function tableAction(data: string, state: TableState | undefined): boolean {
  if (!state || data.length > 512) return false;
  try {
    const [type, epoch, choice, action, ...extra] = JSON.parse(data);
    if (type !== 'tableAction' || extra.length || epoch !== state.epoch || choice !== state.choice)
      return false;
    const actions = [
      state.autoAction,
      ...state.players.flatMap((player) => [
        player.action,
        ...player.equipment.map((item) => item.action),
      ]),
      ...[...state.hand, ...state.controls, ...state.skills].map((item) => item.action),
      ...state.dialogs.flatMap((dialog) => [
        ...dialog.items.map((item) => item.action),
        ...(dialog.groups ?? []).flatMap((group) => group.items.map((item) => item.action)),
        ...dialog.zones.flatMap((zone) => [zone.action, ...zone.items.map((item) => item.action)]),
      ]),
    ];
    return typeof action === 'string' && action.length > 0 && actions.includes(action);
  } catch {
    return false;
  }
}
