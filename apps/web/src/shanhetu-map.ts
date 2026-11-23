// SPDX-License-Identifier: GPL-3.0-only
import type { ShanhetuCampaignView } from '../../../packages/shared/src/shanhetu.js';
import { button, make } from './shanhetu-ui.js';

type MapView = NonNullable<ShanhetuCampaignView['map']>;
type Location = MapView['locations'][number];
type Point = { x: number; y: number; location: Location };
const labels: Record<string, string> = {
  battle: '战斗',
  boss: '首领',
  event: '奇遇',
  camp: '营地',
  shop: '集市',
};
const status = { available: '可前往', completed: '已通过', locked: '暂不可达' };
const chapters = ['一', '二', '三'];
const svgNS = 'http://www.w3.org/2000/svg';
const icons: Record<string, [string, string]> = {
  battle: [
    'm5 4 5 3 8 12-2 2L7 9 5 4Zm2 13 3-3m-6 6 3-3m7-8 3-4 4-1-1 4-3 3',
    'm15 16 4-4m-1 7 3 2',
  ],
  boss: ['M4 8l4 3 4-6 4 6 4-3-2 10H6L4 8Z', 'M7 21h10m-5-9 2 2-2 2-2-2Z'],
  event: ['M7 20h11V7a3 3 0 0 0-3-3H6a2 2 0 1 0 0 4h2v10a2 2 0 1 1-2-2h12', 'M11 9h4m-4 3h4'],
  camp: ['m2 20 10-15 10 15H2Zm6 0 4-7 4 7', 'm10 4 2 1 2-3'],
  shop: ['M5 11v9h14v-9M3 11l3-6h12l3 6H3Zm6 9v-5h6v5', 'm9 5-1 6m7-6 1 6'],
  card: ['M7 4h10v16H7zM4 7v13m16-13v13', 'm12 8 2 4-2 4-2-4Z'],
  skill: ['M12 3c2 4 4 6 9 9-5 3-7 5-9 9-2-4-4-6-9-9 5-3 7-5 9-9Z', 'M12 8v8m-4-4h8'],
  tactic: ['M6 21V4m0 1h13l-3 4 3 4H6', 'm9 9 2 1 3-3'],
  equipment: ['M12 3 5 6v5c0 4 2 7 7 10 5-3 7-6 7-10V6l-7-3Z', 'M12 8v8m-3-4h6'],
  recruit: [
    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8v-2a6 6 0 0 1 12 0v2',
    'M3 9v4m-2-2h4m16-2v4m-2-2h4',
  ],
  completed: ['m5 12 5 5L20 7', 'M5 6h3m8 13h3'],
  focus: ['M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5', 'M9 12h6m-3-3v6'],
};

export const MARKET_WARNING = '再推 1 日首领现身，未逛集市将自动关闭！';

export function marketWillClose(map: MapView, days: number) {
  const remaining = map.bossAt - days;
  return (
    map.marketClosing ??
    (remaining === 1 &&
      map.locations.some((location) => location.kind === 'shop' && location.status !== 'completed'))
  );
}

export function closesMarket(map: MapView, days: number, actionId: string) {
  const location = map.locations.find((item) => item.actionId === actionId);
  return (
    !!location &&
    location.kind !== 'shop' &&
    days < map.bossAt &&
    days + location.duration >= map.bossAt &&
    map.locations.some((item) => item.kind === 'shop' && item.status !== 'completed')
  );
}

export function shanhetuIcon(kind: string) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.classList.add('shanhetu-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const [outline, detail] = icons[kind] ?? icons.event!;
  const drawing = document.createElementNS(svgNS, 'path');
  drawing.setAttribute('d', outline);
  const accent = document.createElementNS(svgNS, 'path');
  accent.setAttribute('d', detail);
  accent.classList.add('shanhetu-icon-accent');
  svg.append(drawing, accent);
  return svg;
}

function arrangeLocations(locations: Location[]) {
  const placed: Point[] = [];
  for (const location of locations) {
    const x = Math.min(86, Math.max(14, 50 + location.x / 15));
    const preferred = Math.min(83, Math.max(12, 65 - location.y / 5.4));
    const nearby = placed.filter((point) => Math.abs(point.x - x) < 17);
    // Keep adjacent pins tappable on a narrow phone without distorting horizontal geography.
    const offsets = Array.from({ length: 36 }, (_, index) => (index + 1) * 2);
    const positions = [
      preferred,
      ...offsets.flatMap((offset) => [preferred + offset, preferred - offset]),
    ];
    const y =
      positions.find(
        (candidate) =>
          candidate >= 9 &&
          candidate <= 85 &&
          nearby.every((point) => Math.abs(point.y - candidate) >= 14),
      ) ?? preferred;
    placed.push({ location, x, y });
  }
  return placed;
}

function connectLocations(points: Point[]) {
  const routes = document.createElementNS(svgNS, 'svg');
  routes.classList.add('shanhetu-march-lines');
  routes.setAttribute('viewBox', '0 0 100 100');
  routes.setAttribute('preserveAspectRatio', 'none');
  routes.setAttribute('aria-hidden', 'true');
  const remaining = [...points].sort((a, b) => b.y - a.y);
  const origin = remaining.shift();
  if (!origin) return routes;
  const visited = [origin];
  // The paths trace the geography. Availability continues to follow each pin's server state.
  for (const destination of remaining) {
    const from = visited.reduce((nearest, point) =>
      Math.hypot(point.x - destination.x, point.y - destination.y) <
      Math.hypot(nearest.x - destination.x, nearest.y - destination.y)
        ? point
        : nearest,
    );
    const path = document.createElementNS(svgNS, 'path');
    const center = (from.y + destination.y) / 2;
    path.setAttribute(
      'd',
      `M${from.x} ${from.y} C${from.x} ${center}, ${destination.x} ${center}, ${destination.x} ${destination.y}`,
    );
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.classList.add(destination.location.status);
    routes.append(path);
    visited.push(destination);
  }
  return routes;
}

export function renderLocations(
  map: MapView,
  days: number,
  choose: (
    actionId: string | undefined,
    preview: { name: string; description: string },
    key: string,
  ) => void,
) {
  const board = make('div', 'shanhetu-location-map');
  board.setAttribute('aria-label', `${map.name}行军图`);
  const closing = marketWillClose(map, days);
  const points = arrangeLocations(map.locations);
  board.append(connectLocations(points));
  for (const { location, x, y } of points) {
    const label = labels[location.kind] ?? '地点';
    const travel = location.duration ? `耗时 ${location.duration} 日` : '不耗行军日';
    const availableAt = location.kind === 'boss' ? map.bossAt : location.unlockDay;
    const lock =
      location.status === 'locked' && availableAt != null && availableAt > days
        ? `行军满 ${availableAt} 日开放`
        : '';
    const isMarket = location.kind === 'shop';
    const terrain = location.terrainEffect;
    const state =
      isMarket && location.status === 'locked' && days >= map.bossAt
        ? '集市已关闭'
        : status[location.status];
    const preview = [
      [label, state, travel, lock].filter(Boolean).join(' · '),
      location.risk ? `敌力 ${location.risk}` : '',
      location.rewardTypes?.length ? `预计获得 ${location.rewardTypes.join('、')}` : '',
      terrain ? `地形 ${terrain}` : '',
      isMarket && closing && location.status !== 'completed' ? MARKET_WARNING : '',
    ]
      .filter(Boolean)
      .join('\n');
    const pin = button('', `shanhetu-pin ${location.status}`);
    pin.dataset.locationKind = location.kind;
    pin.dataset.choiceKey = location.id;
    if (location.actionId) pin.dataset.actionId = location.actionId;
    pin.style.left = `${x}%`;
    pin.style.top = `${y}%`;
    pin.setAttribute('aria-label', `${location.name} · ${preview}`);
    pin.setAttribute('aria-pressed', 'false');
    pin.append(shanhetuIcon(location.status === 'completed' ? 'completed' : location.kind));
    if (location.status !== 'locked' || location.kind === 'boss') {
      const caption = make('span', 'shanhetu-pin-label', location.name);
      caption.setAttribute('aria-hidden', 'true');
      pin.append(caption);
    }
    if (isMarket && closing && location.status !== 'completed') {
      pin.classList.add('market-closing');
      pin.append(make('span', 'shanhetu-pin-seal', '将关'));
    }
    pin.onclick = () =>
      choose(
        location.actionId,
        {
          name: location.name,
          description: preview,
        },
        location.id,
      );
    board.append(pin);
  }
  const legend = make('ul', 'shanhetu-map-legend');
  for (const [kind, label] of Object.entries(labels)) {
    const item = make('li');
    item.append(shanhetuIcon(kind), make('span', '', label));
    legend.append(item);
  }
  const figure = make('div', 'shanhetu-map-figure');
  const upper = make('div', 'shanhetu-scroll-rod');
  const lower = make('div', 'shanhetu-scroll-rod');
  upper.setAttribute('aria-hidden', 'true');
  lower.setAttribute('aria-hidden', 'true');
  figure.append(upper, board, lower, legend);
  return figure;
}

export function renderRegions(map: MapView, choose: (id: string) => void) {
  const plot = make('div', 'shanhetu-route');
  plot.setAttribute('aria-label', '诸侯伐董章间路线');
  const paths = make('canvas');
  paths.setAttribute('aria-hidden', 'true');
  plot.append(paths);
  const points = new Map<string, HTMLElement>();
  const regionsById = new Map(map.regions.map((region) => [region.id, region]));
  for (const [index, number] of chapters.entries()) {
    const previous = map.regions.filter((region) => region.chapter === index);
    const regions = map.regions
      .filter((region) => region.chapter === index + 1)
      .sort(
        (left, right) =>
          previous.findIndex((region) => region.next.includes(left.id)) -
          previous.findIndex((region) => region.next.includes(right.id)),
      );
    if (!regions.length) continue;
    const row = make('div', 'shanhetu-route-chapter');
    row.setAttribute('aria-label', `第${number}章`);
    row.append(make('span', 'shanhetu-route-chapter-label', `第${number}章`));
    const cities = make('div', 'shanhetu-route-cities');
    if (regions.length > 5) cities.classList.add('shanhetu-route-cities-dense');
    for (const region of regions) {
      const current = region.id === map.regionId;
      const actionId = region.actionId;
      const node = actionId
        ? button('', 'shanhetu-route-city available')
        : make('div', 'shanhetu-route-city');
      if (actionId) {
        node.dataset.actionId = actionId;
        node.dataset.choiceKey = region.id;
        node.setAttribute('aria-pressed', 'false');
        node.onclick = () => choose(actionId);
      }
      if (current) node.classList.add('current');
      if (region.completed) node.classList.add('completed');
      const following = map.regions.filter((city) => region.next.includes(city.id));
      if (following.length || region.terrain)
        node.setAttribute(
          'aria-label',
          [
            region.name,
            region.terrain?.description,
            following.length ? `通往${following.map((city) => city.name).join('、')}` : '',
          ]
            .filter(Boolean)
            .join('，'),
        );
      node.append(
        make('strong', '', region.name),
        make(
          'small',
          '',
          current
            ? region.completed
              ? '已攻下'
              : '所在'
            : region.completed
              ? '已通过'
              : actionId
                ? '可前往'
                : '待抵达',
        ),
      );
      if (region.terrain) node.append(make('small', 'shanhetu-route-terrain', region.terrain.name));
      cities.append(node);
      points.set(region.id, node);
    }
    row.append(cities);
    plot.append(row);
  }

  function drawPaths() {
    const context = paths.getContext('2d');
    const bounds = plot.getBoundingClientRect();
    if (!context || !bounds.width || !bounds.height) return;
    const scale = window.devicePixelRatio || 1;
    paths.width = Math.ceil(bounds.width * scale);
    paths.height = Math.ceil(bounds.height * scale);
    context.scale(scale, scale);
    context.lineWidth = 1.8;
    const palette = getComputedStyle(plot);
    for (const from of map.regions) {
      for (const id of from.next) {
        const start = points.get(from.id)?.getBoundingClientRect();
        const finish = points.get(id)?.getBoundingClientRect();
        if (!start || !finish) continue;
        const x = start.left + start.width / 2 - bounds.left;
        const y = start.bottom - bounds.top;
        const endX = finish.left + finish.width / 2 - bounds.left;
        const endY = finish.top - bounds.top;
        const centerY = (y + endY) / 2;
        const marked =
          from.id === map.regionId ||
          (from.completed && (id === map.regionId || regionsById.get(id)?.completed));
        context.strokeStyle = palette.getPropertyValue(marked ? '--sht-gold' : '--sht-line').trim();
        context.setLineDash(marked ? [] : [3, 4]);
        context.beginPath();
        context.moveTo(x, y);
        context.bezierCurveTo(x, centerY, endX, centerY, endX, endY);
        context.stroke();
      }
    }
  }

  const observer = new ResizeObserver(drawPaths);
  observer.observe(plot);
  const themeObserver = new MutationObserver(drawPaths);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  const terrain = make('dl', 'shanhetu-route-comparison');
  for (const region of map.regions) {
    if (!region.actionId || !region.terrain) continue;
    const entry = make('div');
    entry.append(
      make('dt', '', `${region.name} · ${region.terrain.name}`),
      make('dd', '', `全场${region.terrain.description}`),
    );
    terrain.append(entry);
  }
  return {
    plot,
    terrain: terrain.childElementCount ? terrain : null,
    dispose: () => {
      observer.disconnect();
      themeObserver.disconnect();
    },
  };
}
