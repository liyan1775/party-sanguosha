// SPDX-License-Identifier: GPL-3.0-only
import type { RoomView } from '../../../packages/shared/src/contracts.js';
import type { ShanhetuCampaignView } from '../../../packages/shared/src/shanhetu.js';
import growth from '../../../config/shanhetu-growth.json' with { type: 'json' };
import cards from '../../../config/shanhetu-cards.json' with { type: 'json' };
import companionCatalog from '../../../config/shanhetu-companions.json' with { type: 'json' };
import { element } from './ui.js';
import { button, make, plain } from './shanhetu-ui.js';
import { renderLocations, renderRegions } from './shanhetu-map.js';

type Choice = ShanhetuCampaignView['actions'][number];
const kinds: Record<string, string> = {
  battle: '战斗',
  boss: '首领',
  event: '奇遇',
  camp: '营地',
  shop: '集市',
  skill: '额外技能',
  tactic: '战法',
  card: '随身牌',
  equipment: '装备',
};
const rarities = ['', '普通', '稀有', '史诗', '传说'];
const suits: Record<string, string> = {
  spade: '黑桃',
  heart: '红桃',
  club: '梅花',
  diamond: '方片',
};

function choiceTile(action: Choice) {
  const isHero = action.kind === 'hero';
  const tile = button('', 'shanhetu-option');
  tile.dataset.actionId = tile.dataset.choiceKey = action.id;
  tile.dataset.kind = action.kind;
  tile.setAttribute('aria-pressed', 'false');
  if (isHero && action.general) {
    tile.dataset.general = action.general;
    const frame = make('span', 'shanhetu-hero-portrait');
    if (action.portrait) {
      const image = make('img');
      image.alt = '';
      image.src = action.portrait;
      frame.append(image);
    }
    tile.append(frame);
  } else if (action.offer) {
    tile.dataset.rarity = String(action.offer.rarity);
    tile.append(
      make(
        'small',
        'shanhetu-option-type',
        `${kinds[action.offer.kind]} · ${rarities[action.offer.rarity]}`,
      ),
    );
  }
  tile.append(make('strong', '', action.label));
  tile.append(
    make(
      'span',
      'shanhetu-option-description',
      plain(isHero ? action.description.split('\n')[0]! : action.description),
    ),
  );
  if (action.cost) tile.append(make('span', 'shanhetu-price', `${action.cost} 铜币`));
  return tile;
}

/** Choices are rendered from an owner-authorized room snapshot. */
export function bindShanhetuPanel(
  send: (operation: 'action' | 'end' | 'restart', body: unknown) => Promise<void>,
) {
  const host = element('#match-panel');
  const restart = button('重开本关', 'button secondary');
  restart.id = 'shanhetu-restart';
  restart.hidden = true;
  element('#match-share').before(restart);
  const panel = make('section', 'shanhetu-panel shanhetu-theme');
  panel.id = 'shanhetu-panel';
  panel.hidden = true;
  element('#game-frame-container').before(panel);

  const hud = make('div', 'shanhetu-hud');
  const facts = make('div', 'shanhetu-facts');
  const actions = make('div', 'shanhetu-hud-actions');
  const openBuild = button('本局构筑', 'shanhetu-quiet');
  const end = button('结束征程', 'shanhetu-quiet');
  end.id = 'shanhetu-end';
  actions.append(openBuild, end);
  hud.append(facts, actions);

  const scene = make('header', 'shanhetu-scene');
  const kicker = make('p', 'shanhetu-kicker');
  const title = make('h2');
  title.id = 'shanhetu-scene-title';
  title.tabIndex = -1;
  const description = make('p', 'shanhetu-story');
  scene.append(kicker, title, description);
  panel.setAttribute('aria-labelledby', title.id);

  const map = make('section', 'shanhetu-map');
  const mapBody = make('div');
  const mapHeader = make('div', 'shanhetu-map-header');
  const mapText = make('div', 'shanhetu-map-days');
  const mapLabel = make('p');
  const mapTerrain = make('p', 'shanhetu-map-terrain');
  const march = make('progress');
  march.setAttribute('aria-label', '距本城首领的行军进度');
  const mapSwitch = button('章间路线', 'shanhetu-quiet');
  mapText.append(mapLabel, mapTerrain, march);
  mapHeader.append(mapText, mapSwitch);
  map.append(mapHeader, mapBody);

  const list = make('div', 'shanhetu-options');
  list.id = 'shanhetu-options';
  const shopControls = make('div', 'shanhetu-shop-controls');
  shopControls.setAttribute('role', 'group');
  shopControls.setAttribute('aria-label', '集市操作');
  const heroDetail = make('p', 'shanhetu-hero-details');
  heroDetail.tabIndex = 0;
  const aftermath = make('div', 'shanhetu-aftermath');
  const tray = make('div', 'shanhetu-tray');
  const trayInfo = make('div', 'shanhetu-tray-info');
  const trayHeading = make('div', 'shanhetu-tray-heading');
  const detailTitle = make('strong');
  const openSpot = button('详情', 'shanhetu-spot-button');
  openSpot.setAttribute('aria-label', '查看地点详情');
  const detail = make('p');
  detail.id = 'shanhetu-description';
  const status = make('p', 'shanhetu-status');
  status.setAttribute('role', 'status');
  const confirm = button('确认选择', 'shanhetu-primary');
  confirm.id = 'shanhetu-confirm';
  trayHeading.append(detailTitle, openSpot);
  trayInfo.append(trayHeading, detail);
  tray.append(heroDetail, trayInfo, confirm);
  panel.append(hud, scene, map, shopControls, list, aftermath, status, tray);

  const collection = make('dialog', 'shanhetu-theme shanhetu-dialog');
  collection.setAttribute('aria-labelledby', 'shanhetu-build-title');
  const buildHeading = make('header', 'shanhetu-book-heading');
  const buildTitle = make('h2', '', '本局构筑');
  buildTitle.id = 'shanhetu-build-title';
  const closeBuild = button('关闭', 'shanhetu-quiet');
  buildHeading.append(buildTitle, closeBuild);
  const collected = make('div', 'shanhetu-build');
  collection.append(buildHeading, collected);
  host.after(collection);
  openBuild.onclick = () => collection.showModal();
  closeBuild.onclick = () => collection.close();

  const spot = make('dialog', 'shanhetu-theme shanhetu-dialog');
  const spotHeading = make('header', 'shanhetu-book-heading');
  const spotTitle = make('h2');
  spotTitle.id = 'shanhetu-spot-title';
  spot.setAttribute('aria-labelledby', spotTitle.id);
  const spotText = make('p', 'shanhetu-story');
  const closeSpot = button('关闭', 'shanhetu-quiet');
  spotHeading.append(spotTitle, closeSpot);
  spot.append(spotHeading, spotText);
  host.after(spot);
  openSpot.onclick = () => {
    spotTitle.textContent = detailTitle.textContent;
    spotText.textContent = detail.textContent;
    spot.showModal();
  };
  closeSpot.onclick = () => spot.close();

  let room: RoomView;
  let owner = false;
  let busy = false;
  let selected: string | undefined;
  let selectionKey: string | undefined;
  let peek: { name: string; description: string } | undefined;
  let renderedKey = '';
  let showRoutes = false;
  let disposeMap: (() => void) | undefined;
  const dialog = make('dialog', 'shanhetu-theme shanhetu-dialog');
  dialog.id = 'shanhetu-end-dialog';
  const cancel = make('button', 'button secondary', '继续征程'),
    finish = make('button', 'button primary', '结束并回房');
  const dialogTitle = make('h2'),
    dialogDetail = make('p'),
    dialogFeedback = make('p', 'shanhetu-status');
  dialogFeedback.setAttribute('role', 'status');
  cancel.type = finish.type = 'button';
  dialogTitle.id = 'shanhetu-end-title';
  dialog.setAttribute('aria-labelledby', dialogTitle.id);
  const dialogActions = make('div', 'shanhetu-dialog-actions');
  dialogActions.append(cancel, finish);
  dialog.append(dialogTitle, dialogDetail, dialogActions, dialogFeedback);
  host.after(dialog);
  cancel.onclick = () => dialog.close();
  let endingRun: string | undefined;
  let restarting: { runId: string; matchId: string } | undefined;
  let restartMatch: string | null = null;
  let restartDeadline = 0;
  let restartTimer = 0;
  async function submit(operation: 'action' | 'end', body: unknown) {
    if (busy || !owner) return;
    busy = true;
    status.textContent = '正在同步…';
    updateChoice();
    try {
      await send(operation, body);
      status.textContent = '';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '同步失败，请重试。';
    } finally {
      busy = false;
      updateChoice();
    }
  }
  end.onclick = () => {
    const journey = room.shanhetu!;
    if (['won', 'lost'].includes(journey.phase)) {
      void submit('end', { runId: journey.id });
      return;
    }
    endingRun = journey.id;
    restarting = undefined;
    dialogTitle.textContent = '结束本次征程？';
    dialogDetail.textContent = '本次征程结束，已赢得的战斗会计入山河册。';
    dialogFeedback.textContent = '';
    cancel.textContent = '继续征程';
    finish.textContent = '结束并回房';
    dialog.showModal();
  };
  restart.onclick = () => {
    if (!owner || restart.disabled || !room.shanhetu || !room.matchId) return;
    restarting = { runId: room.shanhetu.id, matchId: room.matchId };
    dialogTitle.textContent = '重开本关？';
    dialogDetail.textContent =
      '本场会重新发牌，出征武将和进入本关前的成长会保留。本次征程将消耗一次重开机会。';
    dialogFeedback.textContent = '';
    cancel.textContent = '继续本关';
    finish.textContent = '确认重开';
    dialog.showModal();
  };
  finish.onclick = async () => {
    if (restarting) {
      if (busy || !owner) return;
      busy = finish.disabled = true;
      try {
        await send('restart', restarting);
        dialog.close();
      } catch (error) {
        dialogFeedback.textContent =
          error instanceof Error ? error.message : '重开失败，请查看当前征程。';
      } finally {
        busy = finish.disabled = false;
      }
      return;
    }
    dialog.close();
    void submit('end', { runId: endingRun });
  };
  function renderRestart() {
    window.clearTimeout(restartTimer);
    const journey = room.shanhetu;
    restart.hidden = !owner || room.phase !== 'playing' || journey?.restartAt === undefined;
    if (restart.hidden || !journey) return;
    if (restartMatch !== room.matchId) {
      restartMatch = room.matchId;
      restartDeadline =
        performance.now() + Math.max(0, journey.restartAt! - (room.serverTime ?? Date.now()));
    }
    const remaining = journey.restartsLeft ?? 0;
    const wait = Math.max(0, Math.ceil((restartDeadline - performance.now()) / 1000));
    restart.disabled = !remaining || wait > 0 || !!room.matchRecovery;
    restart.textContent = !remaining
      ? '重开次数已用完'
      : wait
        ? `重开 ${wait}秒后`
        : `重开本关 · 余${remaining}次`;
    if (remaining && wait) restartTimer = window.setTimeout(renderRestart, 250);
  }

  confirm.onclick = () => {
    const journey = room.shanhetu!;
    const action = journey.actions.find((item) => item.id === selected);
    if (action && action.cost <= journey.coins)
      void submit('action', { runId: journey.id, revision: journey.revision, actionId: action.id });
  };

  function choose(id?: string, preview?: { name: string; description: string }, key = id) {
    selected = id;
    selectionKey = key;
    peek = preview;
    updateChoice();
  }

  function updateChoice() {
    const journey = room.shanhetu;
    if (!journey || panel.hidden) return;
    const action = journey.actions.find((item) => item.id === selected);
    const readableName =
      action?.label ?? peek?.name ?? (journey.phase === 'map' ? '点选可达地点' : '点选一项');
    const canAfford = !action || action.cost <= journey.coins;
    for (const tile of panel.querySelectorAll<HTMLButtonElement>('[data-choice-key]')) {
      tile.setAttribute('aria-pressed', String(tile.dataset.choiceKey === selectionKey));
      tile.disabled = busy || !owner;
    }
    mapSwitch.disabled = busy;
    detailTitle.textContent = readableName;
    detail.textContent =
      journey.phase === 'map' ? plain(action?.description ?? peek?.description ?? '') : '';
    openSpot.hidden = (detail.textContent?.length ?? 0) <= 20;
    heroDetail.textContent =
      journey.phase === 'selection' && action
        ? plain(action.description.split('\n').slice(1).join('\n'))
        : '';
    confirm.textContent = busy
      ? '正在同步…'
      : !action
        ? '确认选择'
        : !canAfford
          ? `还差 ${action.cost - journey.coins} 铜币`
          : action.cost
            ? `支付 ${action.cost} 铜币`
            : (
                {
                  hero: '选定武将',
                  enter: '前往此处',
                  region: '进入下一章',
                  reward: '领取',
                  skip: '放弃奖励',
                  choice: '确认选择',
                  buy: '购入',
                  refresh: '刷新',
                  leave: '离开集市',
                  retry: '重新挑战',
                } as const
              )[action.kind];
    confirm.disabled = busy || !owner || !action || !canAfford;
    end.disabled = busy || !owner;
  }

  function renderMap(journey: ShanhetuCampaignView) {
    disposeMap?.();
    disposeMap = undefined;
    const region = journey.map;
    map.hidden = journey.phase !== 'map' || !region;
    mapBody.replaceChildren();
    if (map.hidden || !region) return;
    const leaving = journey.actions.some((action) => action.kind === 'region');
    mapTerrain.hidden = leaving || !region.terrain;
    mapTerrain.textContent = region.terrain
      ? `${region.terrain.name} · 全场${region.terrain.description}`
      : '';
    mapSwitch.hidden = leaving;
    mapSwitch.textContent = showRoutes ? '本城地图' : '章间路线';
    mapSwitch.setAttribute('aria-pressed', String(showRoutes));
    mapLabel.textContent = leaving
      ? '本城已攻下 · 选择下一座城池'
      : journey.days >= region.bossAt
        ? '首领已出现'
        : `行军 ${journey.days} / ${region.bossAt} 日 · 首领`;
    march.max = region.bossAt;
    march.value = Math.min(journey.days, region.bossAt);
    march.hidden = leaving;
    if (showRoutes || leaving) {
      const { plot, dispose } = renderRegions(region, (id) => choose(id));
      disposeMap = dispose;
      mapBody.append(plot);
    } else {
      mapBody.append(renderLocations(region, (id, preview, key) => choose(id, preview, key)));
    }
    if (journey.actions.length === 1) {
      const action = journey.actions[0]!;
      const tile = [...mapBody.querySelectorAll<HTMLElement>('[data-action-id]')].find(
        (candidate) => candidate.dataset.actionId === action.id,
      );
      if (tile) {
        selected = action.id;
        selectionKey = tile.dataset.choiceKey;
      }
    }
  }

  mapSwitch.onclick = () => {
    showRoutes = !showRoutes;
    selected = selectionKey = undefined;
    peek = undefined;
    if (room.shanhetu) renderMap(room.shanhetu);
    updateChoice();
  };

  function renderBuild(journey: ShanhetuCampaignView) {
    const { build } = journey;
    const companions = journey.companions
      .map((id) => companionCatalog.companions.find((companion) => companion.id === id))
      .filter((companion) => !!companion);
    const totals = [
      ['起手', build.initialCards],
      ['摸牌', build.draw],
      ['护甲', build.armor],
      ['出杀次数', build.extraSha],
      ['手牌上限', build.handLimit],
    ]
      .filter(([, amount]) => Number(amount) > 0)
      .map(([name, amount]) => `${name} +${amount}`);
    collected.replaceChildren();
    if (totals.length) collected.append(make('p', 'shanhetu-build-stats', totals.join(' · ')));
    if (journey.initialTactics?.length)
      collected.append(make('p', '', `初始战法 ${journey.initialTactics.join('、')}`));
    function group(label: string, items: { name: string; description: string }[]) {
      const section = make('section', 'shanhetu-build-group');
      section.append(make('h3', '', label));
      if (!items.length) section.append(make('p', 'shanhetu-muted', '尚未取得'));
      for (const item of items) {
        const record = make('div');
        record.append(make('strong', '', item.name), make('p', '', plain(item.description)));
        section.append(record);
      }
      collected.append(section);
    }
    group(
      `额外技能 ${build.skills.length} / ${journey.skillSlots}`,
      growth.skills.filter((item) => build.skills.includes(item.id)),
    );
    group(
      '战法',
      growth.tactics.filter((item) => build.tactics.includes(item.id)),
    );
    group(
      '随身牌与装备',
      cards.cards
        .filter((item) => build.cards?.includes(item.id))
        .map((card) => ({
          name: card.name,
          description: `${suits[card.suit]} ${card.number} · 每场开局${card.autoEquip ? '装备' : '获得'}，进入弃牌堆时销毁`,
        })),
    );
    group(
      '队友',
      companions.map((companion) => ({
        name: companion.name,
        description: `${companion.elite ? '精英' : '普通'}队友 · ${companion.maxHp}体力\n${companion.skills.map((skill) => skill.name).join('、')}`,
      })),
    );
  }

  function render() {
    const journey = room.shanhetu;
    if (!journey || panel.hidden) return;
    const nextKey = `${journey.id}:${journey.revision}:${owner}:${JSON.stringify(journey.bookAward)}`;
    if (renderedKey === nextKey) return;
    renderedKey = nextKey;
    selected = selectionKey = undefined;
    peek = undefined;
    status.textContent = '';
    showRoutes = false;
    const { node, phase } = journey;
    const terminal = phase === 'won' || phase === 'lost';
    const opening = phase === 'reward' && !node;
    const regionName = journey.map?.name ?? '';
    const heading = {
      selection: '择将出征',
      map: journey.map?.name ?? '行军图',
      reward: opening ? '传承' : '战后所得',
      choice: node?.name ?? '此地际遇',
      won: journey.finalReport?.title ?? '征程告捷',
      lost: journey.finalReport?.title ?? '兵败退军',
      interrupted: '战斗中断',
      battle: node?.name ?? '交战中',
    }[phase];
    const stat = (label: string, value: string) => {
      const row = make('span', 'shanhetu-stat');
      row.append(make('small', '', label), make('strong', '', value));
      return row;
    };
    facts.replaceChildren(
      stat('武将', journey.heroName ?? '未选'),
      ...(journey.hero ? [stat('体力', `${journey.hero.hp} / ${journey.hero.maxHp}`)] : []),
      stat('铜币', String(journey.coins)),
    );
    if (journey.hero) {
      const health = facts.querySelectorAll('.shanhetu-stat')[1]!;
      health.classList.add('shanhetu-health');
    }

    panel.dataset.phase = phase;
    scene.dataset.scene = phase === 'choice' ? (node?.kind ?? 'event') : phase;
    const chapter = ['一', '二', '三'][journey.chapter - 1] ?? String(journey.chapter);
    kicker.textContent =
      phase === 'selection'
        ? journey.scenario
        : `第${chapter}章${phase !== 'map' && regionName ? ` · ${regionName}` : ''}`;
    title.textContent = heading;
    description.textContent =
      phase === 'selection'
        ? '选定一名武将，随你走完这趟征程。'
        : phase === 'choice'
          ? plain(node?.description ?? '')
          : opening
            ? '选一项稀有技能，带入本次征程。'
            : phase === 'reward'
              ? [
                  node?.name,
                  journey.lastBattle?.recoveredHp
                    ? `回复${journey.lastBattle.recoveredHp}点体力`
                    : '',
                  '选择一项所得',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : phase === 'interrupted'
                ? '本场尚未结算。'
                : '';
    renderMap(journey);
    const choices = !map.hidden ? [] : journey.actions;
    const isShopControl = (action: Choice) => action.kind === 'refresh' || action.kind === 'leave';
    list.dataset.layout =
      phase === 'selection' ? 'heroes' : phase === 'reward' ? 'rewards' : (node?.kind ?? phase);
    list.replaceChildren(
      ...choices
        .filter((action) => !isShopControl(action))
        .map((action) => {
          const tile = choiceTile(action);
          tile.onclick = () => choose(action.id);
          return tile;
        }),
    );
    shopControls.replaceChildren(
      ...choices.filter(isShopControl).map((action) => {
        const tile = button(action.label, 'shanhetu-quiet');
        tile.dataset.actionId = tile.dataset.choiceKey = action.id;
        tile.onclick = () => choose(action.id);
        return tile;
      }),
    );
    shopControls.hidden = !shopControls.childElementCount;
    list.hidden = !list.childElementCount;
    tray.hidden = !journey.actions.length;
    aftermath.replaceChildren();
    aftermath.hidden = !terminal;
    if (terminal) {
      const stats = make('div', 'shanhetu-result-stats');
      stats.append(
        stat('武将', journey.heroName ?? '征战者'),
        stat('战斗胜利', String(journey.victories)),
        stat('通过地点', String(journey.completedNodes)),
      );
      aftermath.append(stats);
      if (journey.finalReport) {
        const report = journey.finalReport;
        stats.append(
          stat('累计铜币', String(report.earnedCoins)),
          stat('声望', String(report.reputation)),
          stat('智谋', String(report.strategy)),
          stat('战功', String(report.merit)),
          stat('商才', String(report.trade)),
        );
      }
      if (journey.bookAward && 'pending' in journey.bookAward)
        aftermath.append(make('p', 'shanhetu-muted', '山河册等待保存，返回时将再次尝试。'));
      else if (journey.bookAward?.unlocked.length) {
        const unlock = make('section', 'shanhetu-unlocked');
        unlock.append(
          make('h3', '', '奖励池新增'),
          make('p', '', journey.bookAward.unlocked.join('、')),
        );
        aftermath.append(unlock);
      }
      aftermath.append(end);
    } else actions.append(end);
    end.textContent = terminal ? '返回出征' : '结束征程';
    end.className = terminal ? 'shanhetu-primary' : 'shanhetu-quiet';
    openBuild.hidden = !journey.hero;
    renderBuild(journey);
    updateChoice();
    host.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  return {
    context(next: RoomView, isOwner: boolean, visible: boolean) {
      room = next;
      owner = isOwner;
      panel.hidden = !visible;
      const wasJourney = host.classList.contains('shanhetu-journey');
      host.classList.toggle('shanhetu-journey', visible);
      if (wasJourney || visible) element('#game-frame-container').hidden = visible;
      if (
        (!owner ||
          !room.shanhetu ||
          (restarting && (room.phase !== 'playing' || room.matchId !== restarting.matchId))) &&
        dialog.open
      )
        dialog.close();
      renderRestart();
      if (visible) render();
      else {
        if (collection.open) collection.close();
        if (spot.open) spot.close();
        if (wasJourney) {
          disposeMap?.();
          disposeMap = undefined;
          renderedKey = '';
        }
      }
    },
  };
}
