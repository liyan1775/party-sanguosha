import type { DoudizhuPrivateState, RoomView } from '../../../packages/shared/src/contracts.js';
import { element } from './ui.js';
import { staticAsset } from './static-assets.js';
import { loadRosterCatalog } from './custom-rosters.js';
import {
  draftBidControl,
  draftCandidateGrid,
  draftMeta,
  focusDraftCandidate,
} from './draft-controls.js';

type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Seat = DoudizhuPrivateState['seats'][number];
type General = {
  id: string;
  name: string;
  portrait: string;
  draftPortrait?: string;
  faction: string;
  hp: string;
  skills: { name: string; description: string }[];
};
type SeatView = {
  seat: Seat;
  tab: HTMLButtonElement;
  section: HTMLElement;
  list: HTMLElement;
  cards: {
    id: string;
    button: HTMLButtonElement;
    image: HTMLImageElement;
    name: HTMLElement;
    meta: HTMLElement;
    mark: HTMLElement;
  }[];
};

/** Private choices stay outside the native executor and use the room's own session. */
export function bindDoudizhuPanel(roomPath: string, request: Request) {
  const panel = document.createElement('section');
  panel.id = 'doudizhu-panel';
  panel.className = 'doudizhu-panel hero-draft';
  panel.hidden = true;
  panel.innerHTML = `<header class="hd-header">
      <div id="doudizhu-self" class="hd-self"><h2 id="doudizhu-heading">叫分</h2><p id="doudizhu-task"></p></div>
      <div id="doudizhu-progress" class="hd-seats" aria-label="出场座次与公开叫分"></div>
      <div class="hd-metrics"><strong id="doudizhu-multiplier" class="hd-multiplier"></strong><span id="doudizhu-deadline" class="hd-clock" role="timer"></span></div>
    </header>
    <nav id="doudizhu-tasks" class="hd-tabs" aria-label="本人、AI代理与队友候选"></nav>
    <div class="hd-workspace"><section class="hd-pool"><div class="draft-pool-heading"><h3 id="doudizhu-seat-title"></h3><span id="doudizhu-quota"></span></div><div id="doudizhu-seats"></div><p id="doudizhu-wait" hidden></p></section>
    <aside id="doudizhu-detail" class="hd-scroll" aria-label="武将技能"><div class="hd-scroll-heading"><div><h3 id="doudizhu-detail-name">查看武将</h3><p id="doudizhu-detail-meta"></p><p id="doudizhu-detail-selection" class="hd-detail-selection"></p></div><button id="doudizhu-close-detail" type="button" class="hd-button hd-close-skills">返回候选</button></div><div id="doudizhu-detail-skills" class="hd-skills" tabindex="0"></div></aside></div>
    <footer class="hd-actions"><div class="hd-feedback"><p id="doudizhu-status" role="status"></p><p id="doudizhu-error" class="hd-error" role="alert" hidden></p><p id="doudizhu-submit-error" class="hd-error" role="alert" hidden></p></div><div class="hd-buttons"><button id="doudizhu-show-detail" class="hd-button hd-show-skills" type="button" aria-controls="doudizhu-detail" aria-expanded="false">查看技能</button><div id="doudizhu-bids" class="hd-buttons" hidden></div><button id="doudizhu-return-bid" class="hd-button hd-primary" type="button" hidden></button><div id="doudizhu-choose-actions" class="hd-buttons"><button id="doudizhu-replace" class="hd-button" type="button">换此将</button><button id="doudizhu-confirm" class="hd-button hd-primary" type="button">确认出战</button></div></div></footer>`;
  element('#game-frame-container').append(panel);
  const find = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector<T>(id)!;
  const heading = find('#doudizhu-heading'),
    task = find('#doudizhu-task'),
    deadline = find('#doudizhu-deadline');
  const status = find('#doudizhu-status'),
    readError = find('#doudizhu-error'),
    submitError = find('#doudizhu-submit-error'),
    bids = find('#doudizhu-bids');
  const seats = find('#doudizhu-seats'),
    tasks = find('#doudizhu-tasks'),
    progress = find('#doudizhu-progress');
  const detail = find('#doudizhu-detail'),
    skills = find('#doudizhu-detail-skills');
  const returnBid = find<HTMLButtonElement>('#doudizhu-return-bid');
  const closeDetail = find<HTMLButtonElement>('#doudizhu-close-detail');
  const confirm = find<HTMLButtonElement>('#doudizhu-confirm');
  const replace = find<HTMLButtonElement>('#doudizhu-replace');
  const showDetail = find<HTMLButtonElement>('#doudizhu-show-detail');
  const views = new Map<string, SeatView>(),
    chips = new Map<string, HTMLElement>();
  const selected = new Map<string, string>();
  let room: RoomView;
  let playerId: string | null = null,
    currentId: string | null = null,
    activeSeat: string | null = null;
  let state: DoudizhuPrivateState | undefined;
  let busy = false,
    reading = false,
    stopped = false,
    detailOpen = false;
  let mutation = 0,
    signature = '',
    detailKey = '',
    bidKey = '';
  let expiresAt = 0,
    serverTime = 0,
    serverAt = 0;
  let catalogPreset = '';
  let generals = new Map<string, General>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const name = (id?: string | null) => (id ? (generals.get(id)?.name ?? id) : '未选择');
  const controllable = (seat?: Seat) => !!seat && !!state?.seats.some((s) => s.id === seat.id);
  const who = (seat: Seat) =>
    seat.id === playerId ? '你' : `${controllable(seat) ? 'AI队友' : '真人队友'} ${seat.nickname}`;
  const allSeats = () => [...(state?.seats ?? []), ...(state?.teammates ?? [])];
  const position = (id: string) => {
    const index = state?.preparation.activeSeatIds.indexOf(id) ?? -1;
    return index < 0
      ? `报名${room.players.findIndex((s) => s.id === id) + 1}位`
      : `本局${index + 1}号位`;
  };
  const ordered = () =>
    allSeats().sort(
      (a, b) =>
        Number(b.id === playerId) - Number(a.id === playerId) ||
        Number(controllable(b)) - Number(controllable(a)),
    );
  const current = () => allSeats().find((s) => s.id === activeSeat);
  const bidActor = () =>
    state?.preparation.phase === 'bidding'
      ? state.seats.find((seat) => seat.id === state?.preparation.bidSeatId)
      : undefined;
  const expired = () =>
    !!state && state.preparation.phase !== 'ready' && performance.now() >= expiresAt;

  let clock: ReturnType<typeof setTimeout> | undefined;
  function updateClock() {
    clearTimeout(clock);
    if (!state || panel.hidden || stopped) return;
    const ready = state.preparation.phase === 'ready';
    const remaining = expiresAt - performance.now();
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    const text = ready ? '正在载入' : seconds ? `${seconds} 秒` : '规则端确认中';
    if (deadline.textContent !== text) deadline.textContent = text;
    deadline.classList.toggle('is-urgent', !ready && seconds <= 10);
    if (!ready && seconds)
      clock = setTimeout(updateClock, Math.max(1, remaining - (seconds - 1) * 1000));
    if (!ready && !seconds) {
      confirm.disabled = true;
      replace.disabled = true;
      for (const button of bids.querySelectorAll<HTMLButtonElement>('button'))
        button.disabled = true;
    }
  }
  function inspect(seat: Seat, id: string) {
    if (busy) return;
    selected.set(seat.id, id);
    paint();
  }
  function updateViews() {
    const legal = new Set(ordered().map((s) => s.id));
    tasks.hidden = legal.size < 2;
    for (const [id, view] of views)
      if (!legal.has(id)) {
        view.tab.remove();
        view.section.remove();
        views.delete(id);
        selected.delete(id);
      }
    for (const seat of ordered()) {
      let view = views.get(seat.id);
      if (!view) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'draft-task hd-button';
        tab.dataset.seat = seat.id;
        tab.onclick = () => {
          activeSeat = seat.id;
          detailOpen = false;
          paint();
        };
        const section = document.createElement('section');
        section.className = 'doudizhu-seat';
        section.dataset.seat = seat.id;
        const list = document.createElement('div');
        list.className = 'doudizhu-candidates hd-grid';
        section.append(list);
        view = { seat, tab, section, list, cards: [] };
        views.set(seat.id, view);
        tasks.append(tab);
        seats.append(section);
      }
      view.seat = seat;
      view.tab.textContent = `${who(seat)} · ${controllable(seat) ? '' : '只读 · '}${seat.locked ? '已锁定' : state?.preparation.phase === 'bidding' ? '候选' : '待确认'}`;
      view.tab.setAttribute('aria-pressed', String(seat.id === activeSeat));
      view.tab.disabled = busy;
      view.section.hidden = seat.id !== activeSeat;
      const { columns, rows } = draftCandidateGrid(seat.candidates.length);
      view.list.style.setProperty('--hd-columns', String(columns));
      view.list.style.setProperty('--hd-rows', String(rows));
      if (seat.selected && !selected.has(seat.id)) selected.set(seat.id, seat.selected);
      if (!seat.candidates.includes(selected.get(seat.id) ?? '')) selected.delete(seat.id);
      for (let index = 0; index < seat.candidates.length; index++) {
        const id = seat.candidates[index]!;
        let card = view.cards[index];
        if (!card) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'draft-general hd-card';
          const image = document.createElement('img');
          image.alt = '';
          image.decoding = 'async';
          image.className = 'hd-portrait';
          const label = document.createElement('strong');
          label.className = 'hd-card-name';
          const meta = document.createElement('span');
          meta.className = 'hd-card-meta';
          const mark = document.createElement('span');
          mark.className = 'hd-card-mark';
          button.append(image, label, meta, mark);
          card = { id: '', button, image, name: label, meta, mark };
          const slot = card,
            ownView = view;
          button.onclick = () => inspect(ownView.seat, slot.id);
          view.cards.push(card);
          view.list.append(button);
        }
        const general = generals.get(id);
        card.id = id;
        card.button.dataset.general = id;
        card.button.disabled = busy;
        card.button.setAttribute('aria-pressed', String(selected.get(seat.id) === id));
        card.button.setAttribute(
          'aria-label',
          `${name(id)}${seat.selected === id ? '，已锁定出战' : ''}，${!controllable(seat) || seat.locked ? '只读查看技能' : '查看技能并选择'}`,
        );
        card.name.textContent = name(id);
        card.meta.hidden = !general;
        card.meta.textContent = general ? draftMeta(general.faction, general.hp) : '';
        card.meta.dataset.faction = general?.faction ?? '';
        const locked = seat.selected === id;
        card.mark.hidden = !locked && seat.pointed !== id;
        card.mark.textContent = locked ? (seat.id === playerId ? '已锁定' : '队友已选') : '点将';
        card.mark.dataset.mark = locked ? (seat.id === playerId ? 'locked' : 'teammate') : 'point';
        const portrait = general?.draftPortrait ?? general?.portrait;
        card.image.hidden = !portrait;
        if (portrait && card.image.dataset.portrait !== portrait) {
          const image = card.image;
          image.dataset.portrait = portrait;
          image.onerror = () => {
            if (general?.draftPortrait && image.getAttribute('src') === general.draftPortrait)
              image.src = general.portrait;
          };
          image.src = portrait;
        }
      }
      while (view.cards.length > seat.candidates.length) view.cards.pop()!.button.remove();
    }
  }
  function paintProgress() {
    const p = state!.preparation;
    const isCollege = room.settings.mode === 'college';
    const bidOrder = p.phase === 'bidding' || !p.activeSeatIds.length;
    const teamOf = (id: string) => (room.series?.teams[1].includes(id) ? 'B' : 'A');
    const ids = bidOrder
      ? room.players.map((seat) => seat.id)
      : [
          ...p.activeSeatIds,
          ...room.players.map((seat) => seat.id).filter((id) => !p.activeSeatIds.includes(id)),
        ];
    const myIndex = p.activeSeatIds.indexOf(playerId ?? '');
    const myRole = bidOrder
      ? p.bidSeatId === playerId
        ? '叫分中'
        : '叫分阶段'
      : myIndex === 0
        ? '地主'
        : myIndex > 0
          ? '农民'
          : '本局待命';
    const registration = room.players.findIndex((seat) => seat.id === playerId) + 1;
    heading.textContent = [
      '你',
      isCollege ? `${teamOf(playerId ?? '')}队` : '',
      bidOrder || myIndex < 0 ? `报名${registration}位` : `${myIndex + 1}号位`,
      myRole,
    ]
      .filter(Boolean)
      .join(' · ');
    find('#doudizhu-self').dataset.tone = isCollege
      ? teamOf(playerId ?? '') === 'A'
        ? 'blue'
        : 'amber'
      : myIndex === 0
        ? 'red'
        : 'jade';
    find('#doudizhu-multiplier').textContent = `${p.highestBid} 倍`;
    progress.style.setProperty('--hd-compact-seats', String(ids.length));
    for (const [order, id] of ids.entries()) {
      const index = room.players.findIndex((seat) => seat.id === id);
      const seat = room.players[index];
      if (!seat) continue;
      let chip = chips.get(seat.id);
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'draft-seat-progress hd-seat';
        chip.append(document.createElement('strong'), document.createElement('span'));
        chips.set(seat.id, chip);
      }
      const existing = progress.children.item(order);
      if (existing !== chip) progress.insertBefore(chip, existing);
      chip.dataset.self = String(seat.id === playerId);
      chip.dataset.tone = isCollege
        ? teamOf(seat.id) === 'A'
          ? 'blue'
          : 'amber'
        : p.landlordId === seat.id
          ? 'red'
          : 'jade';
      chip.classList.toggle('is-current', p.bidSeatId === seat.id);
      const label = `${isCollege ? `${teamOf(seat.id)}队 · ` : ''}${bidOrder ? `报名${index + 1}位 · ` : ''}`;
      chip.querySelector('strong')!.textContent =
        `${label} ${seat.nickname}${seat.id === playerId ? '（你）' : ''}`;
      const bid = p.bids.find((b) => b.seatId === seat.id);
      chip.querySelector('span')!.textContent =
        p.phase === 'bidding'
          ? p.bidSeatId === seat.id
            ? '正在叫分'
            : bid
              ? bid.bid
                ? `叫 ${bid.bid} 倍`
                : '不叫'
              : '等待叫分'
          : p.landlordId === seat.id
            ? '1号位·地主'
            : p.activeSeatIds.includes(seat.id)
              ? `${p.activeSeatIds.indexOf(seat.id) + 1}号位·农民`
              : '本局待命';
    }
  }
  function paintDetail(seat?: Seat) {
    const id = seat ? (selected.get(seat.id) ?? seat.candidates[0]) : undefined;
    const general = id ? generals.get(id) : undefined;
    const key = `${seat?.id}/${id}/${general ? catalogPreset : ''}`;
    if (key !== detailKey) {
      detailKey = key;
      find('#doudizhu-detail-name').textContent = name(id);
      const meta = find('#doudizhu-detail-meta');
      meta.textContent = general ? draftMeta(general.faction, general.hp) : '';
      meta.dataset.faction = general?.faction ?? '';
      skills.replaceChildren();
      for (const skill of general?.skills ?? []) {
        const line = document.createElement('section'),
          title = document.createElement('h4'),
          body = document.createElement('p');
        title.textContent = skill.name;
        body.textContent = skill.description;
        line.append(title, body);
        skills.append(line);
      }
      if (!general) skills.textContent = id ? '正在载入技能说明…' : '选中候选查看技能。';
      skills.scrollTop = 0;
    }
    const selection = find('#doudizhu-detail-selection');
    selection.textContent = !seat
      ? ''
      : seat.locked
        ? seat.selected === id
          ? '已锁定'
          : `已锁定：${name(seat.selected)}`
        : !controllable(seat)
          ? '真人队友 · 只读'
          : selected.has(seat.id) && state?.preparation.phase === 'choosing'
            ? `待确认：${name(id)}`
            : '未预选';
    detail.hidden = !seat;
    panel.classList.toggle('detail-open', detailOpen && !!seat);
    showDetail.setAttribute('aria-expanded', String(detailOpen && !!seat));
    showDetail.hidden = !seat;
  }
  function paint() {
    if (!state) return;
    const p = state.preparation,
      seat = current();
    updateViews();
    paintProgress();
    task.textContent =
      seat?.role === 'landlord' && seat.id !== playerId && controllable(seat)
        ? '本局由你代理地主'
        : p.phase === 'bidding'
          ? '先看候选，再叫分'
          : p.phase === 'ready'
            ? '正在准备牌桌'
            : '选择出战武将';
    find('#doudizhu-seat-title').textContent = seat
      ? `${position(seat.id)} · ${seat.role === 'landlord' ? '地主' : seat.role === 'farmer' ? '农民' : '叫分候选'} · ${who(seat)} · ${seat.candidates.length}${controllable(seat) ? '选1' : '将'}`
      : '本局待命';
    find('#doudizhu-quota').textContent =
      seat && !controllable(seat)
        ? '只读 · 队友自行确认'
        : seat && p.phase !== 'bidding'
          ? `剩余换将 ${seat.replacementsLeft} 次`
          : room.settings.mode === 'college'
            ? '本队候选可互看'
            : '候选仅本人可见';
    const waiting = find('#doudizhu-wait');
    waiting.hidden = !!seat;
    waiting.textContent =
      p.phase === 'ready'
        ? '选将已完成，正在连接同一场比赛。'
        : '队友担任地主，本局你在待命位。选将结束后进入公开牌桌。';
    paintDetail(seat);
    const actor = bidActor();
    const control = draftBidControl(actor?.id, seat?.id);
    bids.hidden = control !== 'bid';
    returnBid.hidden = control !== 'return';
    returnBid.disabled = busy;
    returnBid.textContent = actor ? `返回为 ${actor.nickname} 叫分` : '';
    const nextBidKey = `${p.phase}/${actor?.id}/${p.highestBid}/${state.maxBid}`;
    if (nextBidKey !== bidKey) {
      bidKey = nextBidKey;
      bids.replaceChildren();
      if (p.phase === 'bidding' && actor)
        for (const n of [
          0,
          ...Array.from({ length: state.maxBid - p.highestBid }, (_, i) => p.highestBid + i + 1),
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'hd-button';
          button.dataset.bid = String(n);
          button.textContent = n ? `叫 ${n} 倍` : '不叫';
          button.onclick = () => {
            const latest = bidActor();
            if (latest) void submit(latest, 'bid', n);
          };
          bids.append(button);
        }
    }
    for (const button of bids.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = busy || expired();
    const choosing = p.phase === 'choosing' && controllable(seat);
    find('#doudizhu-choose-actions').hidden = p.phase === 'bidding' && !!actor;
    replace.hidden = !choosing || !!seat?.locked || seat?.replacementsLeft === 0;
    replace.textContent = `换此将（余 ${seat?.replacementsLeft ?? 0} 次）`;
    replace.disabled = busy || expired() || !seat || !selected.has(seat.id);
    confirm.hidden = !choosing || !!seat?.locked;
    confirm.disabled = busy || expired() || !seat || !selected.has(seat.id);
    confirm.textContent = seat
      ? `确认${seat.id === playerId ? '' : 'AI'}出战：${name(selected.get(seat.id))}`
      : '确认出战';
    status.textContent = busy
      ? '正在同步，请稍候…'
      : seat && !controllable(seat)
        ? `正在查看真人队友候选（只读）。${seat.selected ? `队友已锁定 ${name(seat.selected)}。` : '由队友自己叫分、换将和确认出战。'}`
        : p.phase === 'bidding'
          ? actor
            ? `${actor.id === playerId ? '轮到你' : '替AI队友'}叫分；超时按不叫处理。`
            : '等待其他席位叫分，可先查看自己的候选。'
          : seat?.locked
            ? seat.selected
              ? `已锁定 ${name(seat.selected)}，等待其他出场席位。`
              : '此席位已交由原生AI完成，等待进入牌桌。'
            : choosing
              ? '先点选武将；未确认的席位超时由原生AI在合法候选中完成。'
              : '等待本局出场席位完成选择。';
    updateClock();
  }
  function accept(updated: DoudizhuPrivateState) {
    const previous = state;
    state = updated;
    const orderedSeats = ordered(),
      phaseChanged = previous?.preparation.phaseId !== updated.preparation.phaseId;
    const bidActor =
      updated.preparation.phase === 'bidding'
        ? updated.seats.find((s) => s.id === updated.preparation.bidSeatId)
        : undefined;
    if (
      phaseChanged ||
      !allSeats().some((s) => s.id === activeSeat) ||
      (updated.preparation.phase === 'choosing' &&
        controllable(current()) &&
        !previous?.seats.find((s) => s.id === activeSeat)?.locked &&
        current()?.locked &&
        orderedSeats.some((s) => controllable(s) && !s.locked))
    )
      activeSeat =
        (orderedSeats.find((s) => controllable(s) && !s.locked) ?? orderedSeats[0])?.id ?? null;
    if (bidActor && previous?.preparation.bidSeatId !== bidActor.id) activeSeat = bidActor.id;
    const remaining = updated.preparation.deadline - (serverTime + performance.now() - serverAt);
    expiresAt = performance.now() + Math.max(0, remaining);
    paint();
  }
  async function submit(seat: Seat, action: string, value?: string | number) {
    if (!state || busy || expired() || !controllable(seat)) return;
    if (action === 'bid' && (seat.id !== activeSeat || seat.id !== bidActor()?.id)) return;
    const id = currentId;
    mutation++;
    busy = true;
    paint();
    submitError.hidden = true;
    try {
      const updated = await request<DoudizhuPrivateState>(`${roomPath}/me/doudizhu`, 'POST', {
        id: state.preparation.id,
        phaseId: state.preparation.phaseId,
        seatId: seat.id,
        revision: seat.revision,
        action,
        ...(action === 'bid' ? { bid: value } : { general: value }),
      });
      if (currentId === id) accept(updated);
    } catch (cause) {
      if (id === currentId) {
        submitError.hidden = false;
        submitError.textContent = cause instanceof Error ? cause.message : '操作未能同步，请重试。';
      }
    } finally {
      busy = false;
      if (id === currentId) {
        paint();
        void read();
      }
    }
  }
  confirm.onclick = () => {
    const seat = current();
    if (seat) void submit(seat, 'choose', selected.get(seat.id));
  };
  replace.onclick = () => {
    const seat = current();
    if (seat) void submit(seat, 'replace', selected.get(seat.id));
  };
  returnBid.onclick = () => {
    const actor = bidActor();
    if (!actor || busy) return;
    activeSeat = actor.id;
    detailOpen = false;
    paint();
    views.get(actor.id)?.tab.focus({ preventScroll: true });
  };
  function closeSkills() {
    detailOpen = false;
    const seat = current();
    paintDetail(seat);
    const cards = seat ? views.get(seat.id)?.cards : undefined;
    const selectedId = seat ? selected.get(seat.id) : undefined;
    focusDraftCandidate(
      cards?.find((card) => card.id === selectedId)?.button ?? cards?.[0]?.button,
    );
  }
  showDetail.onclick = () => {
    detailOpen = true;
    paintDetail(current());
    closeDetail.focus({ preventScroll: true });
  };
  closeDetail.onclick = closeSkills;
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && detailOpen) {
      event.preventDefault();
      closeSkills();
    }
  });
  async function read() {
    clearTimeout(timer);
    if (stopped || panel.hidden || reading || busy || !currentId) return;
    const id = currentId,
      at = mutation;
    reading = true;
    try {
      const updated = await request<DoudizhuPrivateState>(`${roomPath}/me/doudizhu`);
      if (
        id !== currentId ||
        at !== mutation ||
        updated.preparation.id !== id ||
        updated.preparation.phaseId !== room.doudizhu?.phaseId
      )
        return;
      readError.hidden = true;
      if (
        state &&
        (updated.preparation.bids.length < state.preparation.bids.length ||
          updated.seats.some(
            (s) => (state?.seats.find((old) => old.id === s.id)?.revision ?? 0) > s.revision,
          ))
      )
        return;
      const value = JSON.stringify(updated);
      if (signature !== value) {
        signature = value;
        accept(updated);
      }
    } catch (cause) {
      if (id === currentId && at === mutation) {
        readError.hidden = false;
        readError.textContent =
          cause instanceof Error ? cause.message : '正在恢复赛前选择，原期限继续。';
      }
    } finally {
      reading = false;
      if (!panel.hidden && !stopped && currentId) timer = setTimeout(() => void read(), 800);
    }
  }
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(clock);
    },
    { once: true },
  );
  return {
    context(snapshot: RoomView, memberId: string | null) {
      room = snapshot;
      playerId = memberId;
      if (serverTime !== snapshot.serverTime) {
        serverTime = snapshot.serverTime ?? Date.now();
        serverAt = performance.now();
      }
      const id =
        memberId && snapshot.phase === 'starting' && !snapshot.matchId
          ? (snapshot.doudizhu?.id ?? null)
          : null;
      panel.hidden = !id;
      if (id !== currentId) {
        currentId = id;
        signature = '';
        state = undefined;
        activeSeat = null;
        detailKey = '';
        bidKey = '';
        detailOpen = false;
        selected.clear();
        for (const view of views.values()) {
          view.tab.remove();
          view.section.remove();
        }
        views.clear();
        for (const chip of chips.values()) chip.remove();
        chips.clear();
        readError.hidden = submitError.hidden = true;
        clearTimeout(timer);
      }
      if (!id) {
        clearTimeout(clock);
        return;
      }
      const preset = snapshot.settings.customRoster ? 'custom' : snapshot.settings.generalPreset;
      if (catalogPreset !== preset) {
        catalogPreset = preset;
        const catalog =
          preset === 'custom'
            ? loadRosterCatalog()
            : request<{ characters: General[] }>(
                staticAsset(`/assets/generals-${preset}.json`),
              ).then((data) => data.characters);
        void catalog
          .then((data) => {
            if (catalogPreset !== preset) return;
            generals = new Map(data.map((g) => [g.id, g]));
            detailKey = '';
            paint();
          })
          .catch(() => {
            if (catalogPreset === preset) catalogPreset = '';
          });
      }
      void read();
    },
  };
}
