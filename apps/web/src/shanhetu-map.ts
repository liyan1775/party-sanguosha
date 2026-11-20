// SPDX-License-Identifier: GPL-3.0-only
import type { ShanhetuCampaignView } from '../../../packages/shared/src/shanhetu.js';
import { button, make } from './shanhetu-ui.js';

type MapView = NonNullable<ShanhetuCampaignView['map']>;
const labels: Record<string, [string, string]> = {
  battle: ['战', '战斗'],
  boss: ['首', '首领'],
  event: ['遇', '奇遇'],
  camp: ['营', '营地'],
  shop: ['市', '集市'],
};
const status = { available: '可前往', completed: '已通过', locked: '暂不可达' };
const chapters = ['一', '二', '三'];

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
  for (const location of map.locations) {
    const [symbol, label] = labels[location.kind] ?? ['途', '地点'];
    const travel = location.duration ? `耗时 ${location.duration} 日` : '不耗行军日';
    const availableAt = location.kind === 'boss' ? map.bossAt : location.unlockDay;
    const lock =
      location.status === 'locked' && availableAt != null && availableAt > days
        ? `行军满 ${availableAt} 日开放`
        : '';
    const preview = [label, status[location.status], travel, lock].filter(Boolean).join(' · ');
    const pin = button('', `shanhetu-pin ${location.status}`);
    pin.dataset.choiceKey = location.id;
    if (location.actionId) pin.dataset.actionId = location.actionId;
    pin.style.left = `${Math.min(89, Math.max(11, 50 + location.x / 14))}%`;
    pin.style.top = `${Math.min(82, Math.max(12, 65 - location.y / 5.8))}%`;
    pin.setAttribute('aria-label', `${location.name} · ${preview}`);
    pin.setAttribute('aria-pressed', 'false');
    pin.append(make('span', 'shanhetu-pin-symbol', location.status === 'completed' ? '✓' : symbol));
    if (location.status === 'available')
      pin.append(make('span', 'shanhetu-pin-label', `${label} · ${location.duration}日`));
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
  for (const [symbol, label] of Object.values(labels)) {
    const item = make('li');
    item.append(make('b', '', symbol), make('span', '', label));
    legend.append(item);
  }
  const figure = make('div', 'shanhetu-map-figure');
  figure.append(board, legend);
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
    for (const from of map.regions) {
      for (const id of from.next) {
        const start = points.get(from.id)!.getBoundingClientRect();
        const finish = points.get(id)?.getBoundingClientRect();
        if (!finish) continue;
        const x = start.left + start.width / 2 - bounds.left;
        const y = start.bottom - bounds.top;
        const endX = finish.left + finish.width / 2 - bounds.left;
        const endY = finish.top - bounds.top;
        const centerY = (y + endY) / 2;
        const marked =
          from.id === map.regionId ||
          (from.completed && (id === map.regionId || regionsById.get(id)?.completed));
        context.strokeStyle = marked ? '#b88d4d' : '#728277';
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
    dispose: () => observer.disconnect(),
  };
}
