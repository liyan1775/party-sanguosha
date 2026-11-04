import type { DoudizhuPrivateState, RoomView } from '../../../packages/shared/src/contracts.js';
import { element } from './ui.js';

type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Seat = DoudizhuPrivateState['seats'][number];
type General = {
  id: string;
  name: string;
  portrait: string;
  skills: { name: string; description: string }[];
};
type SeatView = {
  seat: Seat;
  tab: HTMLButtonElement;
  section: HTMLElement;
  list: HTMLElement;
  cards: { id: string; button: HTMLButtonElement; image: HTMLImageElement; name: HTMLElement }[];
};

/** Private choices stay outside the native executor and use the room's own session. */
export function bindDoudizhuPanel(roomPath: string, request: Request) {
  const panel = document.createElement('section');
  panel.id = 'doudizhu-panel';
  panel.className = 'doudizhu-panel';
  panel.hidden = true;
  panel.innerHTML = `<header class="draft-heading"><div><h2 id="doudizhu-heading">叫分</h2><p id="doudizhu-task"></p></div><span id="doudizhu-deadline" class="draft-clock"></span></header>
    <div id="doudizhu-progress" class="draft-progress" aria-label="报名席位与公开叫分"></div>
    <nav id="doudizhu-tasks" class="draft-tasks" aria-label="本人、AI代理与队友候选"></nav>
    <div class="draft-workspace"><section class="draft-pool"><div class="draft-pool-heading"><h3 id="doudizhu-seat-title"></h3><span id="doudizhu-quota"></span></div><div id="doudizhu-seats"></div><p id="doudizhu-wait" hidden></p></section>
    <aside id="doudizhu-detail" class="draft-detail" aria-label="武将技能"><div class="draft-detail-heading"><h3 id="doudizhu-detail-name">查看武将</h3><button id="doudizhu-close-detail" type="button" class="button secondary">返回候选</button></div><div id="doudizhu-detail-skills"></div></aside></div>
    <footer class="draft-actions"><div class="draft-feedback"><p id="doudizhu-status" role="status"></p><p id="doudizhu-error" role="alert" hidden></p></div><div id="doudizhu-bids" class="doudizhu-bids"></div><div id="doudizhu-choose-actions"><button id="doudizhu-show-detail" class="button secondary" type="button">技能</button><button id="doudizhu-replace" class="button secondary" type="button">换此将</button><button id="doudizhu-confirm" class="button primary" type="button">确认出战</button></div></footer>`;
  element('#game-frame-container').append(panel);
  const find = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector<T>(id)!;
  const heading = find('#doudizhu-heading'),
    task = find('#doudizhu-task'),
    deadline = find('#doudizhu-deadline');
  const status = find('#doudizhu-status'),
    error = find('#doudizhu-error'),
    bids = find('#doudizhu-bids');
  const seats = find('#doudizhu-seats'),
    tasks = find('#doudizhu-tasks'),
    progress = find('#doudizhu-progress');
  const detail = find('#doudizhu-detail'),
    skills = find('#doudizhu-detail-skills');
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
  const expired = () =>
    !!state && state.preparation.phase !== 'ready' && performance.now() >= expiresAt;

  function updateClock() {
    if (!state || panel.hidden) return;
    const ready = state.preparation.phase === 'ready';
    const seconds = Math.max(0, Math.ceil((expiresAt - performance.now()) / 1000));
    deadline.textContent = ready ? '正在载入' : seconds ? `${seconds} 秒` : '规则端确认中';
    deadline.classList.toggle('is-urgent', !ready && seconds <= 10);
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
        tab.className = 'draft-task';
        tab.dataset.seat = seat.id;
        tab.onclick = () => {
          activeSeat = seat.id;
          paint();
        };
        const section = document.createElement('section');
        section.className = 'doudizhu-seat';
        section.dataset.seat = seat.id;
        const list = document.createElement('div');
        list.className = 'doudizhu-candidates';
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
      view.list.style.setProperty(
        '--draft-columns',
        String(seat.candidates.length > 6 ? 5 : seat.candidates.length),
      );
      if (seat.selected && !selected.has(seat.id)) selected.set(seat.id, seat.selected);
      if (!seat.candidates.includes(selected.get(seat.id) ?? '')) selected.delete(seat.id);
      for (let index = 0; index < seat.candidates.length; index++) {
        const id = seat.candidates[index]!;
        let card = view.cards[index];
        if (!card) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'draft-general';
          const image = document.createElement('img');
          image.alt = '';
          const label = document.createElement('strong');
          button.append(image, label);
          card = { id: '', button, image, name: label };
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
        card.name.textContent = `${name(id)}${seat.selected === id ? ' · 已锁定' : ''}`;
        card.image.hidden = !general?.portrait;
        if (general?.portrait && card.image.getAttribute('src') !== general.portrait)
          card.image.src = general.portrait;
      }
      while (view.cards.length > seat.candidates.length) view.cards.pop()!.button.remove();
    }
  }
  function paintProgress() {
    const p = state!.preparation;
    for (const [index, seat] of room.players.entries()) {
      let chip = chips.get(seat.id);
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'draft-seat-progress';
        chip.append(document.createElement('strong'), document.createElement('span'));
        progress.append(chip);
        chips.set(seat.id, chip);
      }
      chip.dataset.team = room.settings.mode === 'college' ? (index % 2 ? 'b' : 'a') : '';
      chip.classList.toggle('is-current', p.bidSeatId === seat.id);
      const label =
        room.settings.mode === 'college'
          ? `${index % 2 ? 'B' : 'A'}队·报名${index + 1}位`
          : `报名${index + 1}位`;
      chip.querySelector('strong')!.textContent =
        `${label} ${seat.nickname}${seat.id === playerId ? '（你）' : ''}`;
      const bid = p.bids.find((b) => b.seatId === seat.id);
      chip.querySelector('span')!.textContent =
        p.phase === 'bidding'
          ? p.bidSeatId === seat.id
            ? '正在叫分'
            : bid
              ? bid.bid
                ? `${bid.bid} 倍`
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
    detail.hidden = !seat;
    panel.classList.toggle('detail-open', detailOpen && !!seat);
    showDetail.hidden = !seat;
  }
  function paint() {
    if (!state) return;
    const p = state.preparation,
      seat = current();
    updateViews();
    paintProgress();
    heading.textContent =
      p.phase === 'bidding'
        ? '先看候选，再叫分'
        : p.phase === 'ready'
          ? '选将完成'
          : '选择出战武将';
    task.textContent =
      seat?.role === 'landlord' && seat.id !== playerId && controllable(seat)
        ? `替 ${seat.nickname} 选将 · 本局由你操作地主`
        : p.phase === 'bidding'
          ? `当前 ${p.highestBid} 倍 · ${room.players.find((s) => s.id === p.bidSeatId)?.nickname ?? '下一位'}叫分`
          : `本局 ${p.highestBid} 倍 · ${p.phase === 'ready' ? '正在准备原生牌桌' : '确认后锁定出战武将'}`;
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
    const actor = state.seats.find((s) => s.id === p.bidSeatId);
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
          button.className = `button ${n ? 'primary' : 'secondary'}`;
          button.textContent = n ? `叫 ${n} 倍` : '不叫';
          button.onclick = () => void submit(actor, 'bid', n);
          bids.append(button);
        }
    }
    for (const button of bids.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = busy || expired();
    const choosing = p.phase === 'choosing' && controllable(seat);
    find('#doudizhu-choose-actions').hidden = p.phase === 'bidding' && !!actor;
    replace.hidden = !choosing || !!seat?.locked || seat?.replacementsLeft === 0;
    replace.textContent = `换此将（余${seat?.replacementsLeft ?? 0}）`;
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
    const id = currentId;
    mutation++;
    busy = true;
    paint();
    error.hidden = true;
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
        error.hidden = false;
        error.textContent = cause instanceof Error ? cause.message : '操作未能同步，请重试。';
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
  showDetail.onclick = () => {
    detailOpen = true;
    paintDetail(current());
  };
  find('#doudizhu-close-detail').onclick = () => {
    detailOpen = false;
    paintDetail(current());
    showDetail.focus();
  };
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && detailOpen) {
      detailOpen = false;
      paintDetail(current());
      showDetail.focus();
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
      if (id === currentId) {
        error.hidden = false;
        error.textContent =
          cause instanceof Error ? cause.message : '正在恢复赛前选择，原期限继续。';
      }
    } finally {
      reading = false;
      if (!panel.hidden && !stopped && currentId) timer = setTimeout(() => void read(), 800);
    }
  }
  const clock = setInterval(updateClock, 250);
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
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
        error.hidden = true;
        clearTimeout(timer);
      }
      if (!id) return;
      if (catalogPreset !== snapshot.settings.generalPreset) {
        const preset = snapshot.settings.generalPreset;
        catalogPreset = preset;
        void request<{ characters: General[] }>(`/assets/generals-${preset}.json`)
          .then((data) => {
            if (catalogPreset !== preset) return;
            generals = new Map(data.characters.map((g) => [g.id, g]));
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
