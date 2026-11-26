// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';

const identities = {
  zhu: ['主公', 'red'],
  zhong: ['忠臣', 'amber'],
  fan: ['反贼', 'jade'],
  nei: ['内奸', 'purple'],
};
const factions = {
  wei: ['魏', 'blue'],
  shu: ['蜀', 'red'],
  wu: ['吴', 'jade'],
  qun: ['群', 'amber'],
  jin: ['晋', 'purple'],
  shen: ['神', 'gold'],
};

/** Use native starting HP and max HP separately, including live public figures. */
export function draftGeneralFacts(info, live, nameOf) {
  const group = live?.group ?? info?.group;
  const [groupName, color] = factions[group] ?? [group ? nameOf(group) : '', 'jade'];
  const maxHp = live?.maxHp ?? info?.maxHp;
  const hp = live?.hp ?? info?.hp ?? maxHp;
  const health = hp == null ? '' : maxHp != null && hp !== maxHp ? hp + '/' + maxHp : String(hp);
  return {
    group,
    color,
    label: [groupName, health].filter(Boolean).join(' · '),
  };
}

/** Project only the public table and the current phone's own seat. */
export function draftSeats(mode, players, self) {
  return players
    .filter((player) => Number.isInteger(player.seatNum))
    .map((player) => {
      const own = player === self;
      const teammate = mode === 'versus' && !own && player.side === self.side;
      let badge;
      if (mode === 'identity')
        badge =
          own || (player.identityShown && player.identity === 'zhu')
            ? identities[player.identity]
            : null;
      else if (mode === 'versus')
        badge = player.side
          ? [player.seatNum === 1 ? '先手 · 蓝队' : '蓝队', 'blue']
          : ['红队', 'red'];
      else if (mode === 'duel') badge = player.seatNum === 1 ? ['先手', 'amber'] : ['后手', 'jade'];
      else if (mode === 'doudizhu' || mode === 'college')
        badge = player.identity === 'zhu' ? ['地主', 'amber'] : ['农民', 'jade'];
      return {
        number: player.seatNum,
        nickname: player.nickname,
        own,
        teammate,
        badge,
      };
    })
    .sort((left, right) => left.number - right.number);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className, text, action) {
  const control = element('button', className, text);
  control.type = 'button';
  // The engine owns document-level drag/tap handlers. Keep these real HTML
  // controls independent so a synthesized touch click is delivered normally.
  for (const name of ['click', 'mousedown', 'touchstart', 'touchend'])
    control.addEventListener(name, (event) => event.stopPropagation());
  control.addEventListener('click', action);
  return control;
}

const textOnly = (text) =>
  new DOMParser().parseFromString(String(text ?? '').replace(/<br\s*\/?>/gi, '\n'), 'text/html')
    .body.textContent;

/** Style only our explicitly marked startup requests. Native buttons and the
 * native result packet remain the sole authority for every selection. */
export function installHeroDraft(setup) {
  let current;
  const mode = setup.settings.mode;
  const updateZoom = ui.updatez;
  ui.updatez = function (...args) {
    const result = updateZoom.apply(this, args);
    current?.fit();
    return result;
  };
  const nameOf = (id) => textOnly(lib.translate[id] ?? id);
  const picture = (id) => {
    const img = element('img', 'hd-portrait');
    img.alt = '';
    img.draggable = false;
    img.src =
      setup.mobilePortraits?.[id] ??
      setup.assetBase + (setup.portraitAliases?.[id] ?? `image/character/${id}.jpg`);
    return img;
  };
  const badge = (className, id, live) => {
    const { group, color, label } = draftGeneralFacts(lib.character[id], live, nameOf);
    const mark = element('span', className, label);
    mark.dataset.tone = color;
    if (group) mark.dataset.faction = group;
    return mark;
  };
  const tellParent = (active) => {
    if (setup.role === 'player' && !setup.tableView)
      parent.postMessage({ type: 'party-hero-draft', matchId: setup.id, active }, location.origin);
  };
  const groupOf = (native) => native.link?.[2]?.slice(6);
  const groupLabel = (native) => {
    const group = groupOf(native);
    return factions[group]?.[0] ?? nameOf(group);
  };
  const destroy = (stage) => {
    if (current !== stage) return;
    current = null;
    clearTimeout(stage.timer);
    stage.dialog.classList.remove('party-native-draft');
    stage.confirm?.classList.remove('party-native-draft-original-confirm');
    stage.shell.remove();
    tellParent(false);
  };

  function mount(event) {
    const { dialog, partyDraft: request } = event;
    const faction = request.kind === 'faction';
    const shell = element('section', 'hero-draft party-native-draft-shell');
    shell.dataset.mode = mode;
    shell.dataset.draftKind = request.kind;
    shell.setAttribute('aria-label', faction ? '选择势力' : '选将台');
    const top = element('header', 'hd-header');
    const selfSummary = element('div', 'party-draft-self-summary');
    const self = element('div', 'hd-self');
    const lordSummary = element('div', 'party-draft-lord-summary');
    selfSummary.append(self, lordSummary);
    const seats = element('ol', 'hd-seats');
    const metrics = element('div', 'hd-metrics');
    const clock = element('span', 'hd-clock');
    clock.setAttribute('role', 'timer');
    metrics.append(clock);
    top.append(selfSummary, seats, metrics);
    const workspace = element('div', 'hd-workspace');
    const pool = element('div', 'hd-pool');
    const grid = element('div', faction ? 'hd-grid party-draft-factions' : 'hd-grid');
    const columns = Math.min(5, dialog.buttons.length);
    grid.style.setProperty('--hd-columns', columns);
    pool.dataset.fitRows = '';
    pool.style.setProperty('--hd-rows', Math.ceil(dialog.buttons.length / columns));
    pool.append(grid);
    const scroll = element('aside', 'hd-scroll');
    const scrollHeading = element('div', 'hd-scroll-heading');
    const skills = element('div', 'hd-skills');
    const closeSkills = button('hd-button hd-close-skills', '返回候选', closeDetail);
    scroll.append(closeSkills, scrollHeading, skills);
    workspace.append(pool, scroll);
    const footer = element('footer', 'hd-actions');
    const feedback = element('span', 'hd-feedback');
    const buttons = element('div', 'hd-buttons');
    const showSkills = button('hd-button hd-show-skills', '查看技能', openDetail);
    showSkills.setAttribute('aria-expanded', 'false');
    const confirm = button('hd-button hd-primary', '确认出战', () => {
      if (get.event() !== event || !game.check(event)) return;
      const native = Array.from(ui.confirm?.children ?? []).find(
        (control) => control.link === 'ok',
      );
      ui.click.ok(native);
    });
    buttons.append(showSkills, confirm);
    footer.append(feedback, buttons);
    shell.append(top, workspace, footer);
    let focused = faction ? request.general : dialog.buttons[0]?.link;
    let inspection;
    let selection = [];
    const publicLord = () =>
      mode === 'identity' && game.zhu?.identityShown && lib.character[game.zhu.name1]
        ? game.zhu
        : null;
    const selectionText = () =>
      !selection.length
        ? '未预选'
        : '待确认：' +
          selection.map((card) => (faction ? groupLabel(card) : nameOf(card.link))).join('、');

    function openDetail() {
      shell.classList.add('detail-open');
      showSkills.setAttribute('aria-expanded', 'true');
      if (closeSkills.getClientRects().length) closeSkills.focus();
    }

    function closeDetail() {
      inspection = undefined;
      shell.classList.remove('detail-open');
      showSkills.setAttribute('aria-expanded', 'false');
      renderSkills();
      const card =
        selection.at(-1) ??
        dialog.buttons.find((option) => option.link === focused) ??
        dialog.buttons[0];
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth',
      });
    }

    let headingSignature;
    function renderSkills() {
      const lord = inspection === 'lord' ? publicLord() : null;
      const id = lord?.name1 ?? inspection?.link ?? focused;
      const info = lib.character[id];
      const target = selectionText();
      const fresh = JSON.stringify([
        id,
        target,
        Boolean(inspection),
        lord?.group,
        lord?.hp,
        lord?.maxHp,
      ]);
      if (headingSignature === fresh) return;
      headingSignature = fresh;
      scrollHeading.replaceChildren();
      skills.replaceChildren();
      shell.classList.toggle('inspection-open', Boolean(inspection));
      if (!info) return;
      scrollHeading.append(
        element('h3', '', nameOf(id)),
        badge('hd-detail-facts', id, lord),
        element('span', 'hd-detail-selection', target),
      );
      if (inspection)
        scrollHeading.append(
          element('span', 'party-draft-viewing', lord ? '正在查看主公' : '队友已选 · 只读'),
        );
      for (const skill of info.skills ?? []) {
        const description = lib.translate[`${skill}_info`];
        if (!description) continue;
        const item = element('section');
        item.append(element('h4', '', nameOf(skill)), element('p', '', textOnly(description)));
        skills.append(item);
      }
      if (!skills.childElementCount) skills.append(element('p', '', '暂无技能说明'));
      skills.scrollTop = 0;
    }

    for (const native of dialog.buttons) {
      const id = native.link;
      native.classList.add('hd-card');
      native.setAttribute('role', 'button');
      native.tabIndex = 0;
      const name = faction ? groupLabel(native) : nameOf(id);
      const mark = element('span', 'hd-card-mark');
      native.partyDraftMark = mark;
      if (faction) {
        const group = groupOf(native);
        native.dataset.tone = factions[group]?.[1] ?? 'jade';
      } else {
        native.append(picture(id), badge('hd-card-meta', id));
      }
      native.append(element('span', 'hd-card-name', name), mark);
      const inspectTaken = (open = false) => {
        if (faction || native.dataset.taken !== 'true') return false;
        inspection = native;
        renderSkills();
        if (open) openDetail();
        return true;
      };
      const pointer = lib.config.touchscreen ? 'touchend' : 'click';
      native.removeEventListener(pointer, ui.click.button);
      const select = (input) => {
        if (get.event() !== event) return;
        const keyboard = input.type === 'keydown';
        if (keyboard) {
          if (input.key !== 'Enter' && input.key !== ' ') return;
          input.preventDefault();
          input.stopPropagation();
          _status.clicked = false;
        }
        if (inspectTaken(true)) {
          input.stopPropagation();
          return;
        }
        inspection = undefined;
        if (!faction) focused = id;
        if (
          !_status.dragged &&
          !_status.justdragged &&
          get.select(event.selectButton)[1] === 1 &&
          ui.selected.buttons.length &&
          !ui.selected.buttons.includes(native)
        ) {
          game.uncheck('button');
          game.check(event);
        }
        ui.click.button.call(native);
        if (keyboard) _status.clicked = false;
        renderSkills();
      };
      native.addEventListener('focus', () => inspectTaken());
      native.addEventListener(pointer, select);
      if (pointer !== 'click')
        native.addEventListener('click', (event) => {
          // Assistive activation may dispatch click without touchend.
          if (event.detail === 0) select(event);
        });
      native.addEventListener('keydown', select);
      grid.append(native);
    }

    let seatSignature;
    function renderSeats() {
      const publicSeats = draftSeats(mode, game.players, game.me);
      const lord = publicLord();
      const lordFacts = lord && [lord.playerid, lord.name1, lord.group, lord.hp, lord.maxHp];
      const teamTaken = event.partyTeamChoice?.taken;
      const signature = JSON.stringify([publicSeats, lordFacts, teamTaken]);
      if (seatSignature === signature) return;
      seatSignature = signature;
      seats.replaceChildren();
      seats.dataset.count = publicSeats.length;
      lordSummary.replaceChildren();
      if (lord) {
        const title = `主公 · ${nameOf(lord.name1)}`;
        const inspect = button('hd-button party-draft-lord', title, () => {
          inspection = 'lord';
          renderSkills();
          openDetail();
        });
        inspect.setAttribute('aria-label', title);
        inspect.prepend(picture(lord.name1));
        inspect.append(badge('hd-lord-facts', lord.name1, lord));
        lordSummary.append(inspect);
      }
      for (const seat of publicSeats) {
        const label = element('li', 'hd-seat');
        label.dataset.seat = seat.number;
        label.dataset.self = String(seat.own);
        if (seat.badge) label.dataset.tone = seat.badge[1];
        const nickname = element('span', 'hd-seat-nickname', seat.nickname);
        nickname.title = seat.nickname;
        label.append(element('strong', '', `${seat.number}位`), nickname);
        const flags = element('span', 'hd-seat-flags');
        if (seat.own) {
          self.replaceChildren(
            element(
              'strong',
              '',
              `你 · ${seat.number}号位${seat.badge ? ` · ${seat.badge[0]}` : ''}`,
            ),
          );
          if (seat.badge) self.dataset.tone = seat.badge[1];
          flags.append(element('span', 'hd-flag', '你'));
        }
        if (seat.badge) flags.append(element('span', 'hd-flag party-draft-role', seat.badge[0]));
        if (seat.teammate)
          flags.append(
            element(
              'span',
              'hd-flag party-draft-team',
              teamTaken
                ? `队友已锁定 · ${nameOf(teamTaken)}`
                : event.partyTeamChoice?.aiTeammate
                  ? 'AI 队友'
                  : '队友 · 选将中',
            ),
          );
        if (flags.childElementCount) label.append(flags);
        seats.append(label);
      }
    }
    const deadline =
      performance.now() + (request.remainingMs ?? Math.max(0, request.deadline - Date.now()));
    const updateClock = () => {
      const remaining = deadline - performance.now();
      const seconds = Math.max(0, Math.ceil(remaining / 1000));
      clock.textContent = seconds + ' 秒';
      clock.classList.toggle('is-urgent', seconds <= 10);
      if (seconds)
        stage.timer = setTimeout(updateClock, Math.max(1, remaining - (seconds - 1) * 1000));
    };

    const stage = {
      dialog,
      shell,
      event,
      timer: undefined,
      fit() {
        // The engine scales the entire body down to fit a traditional table.
        // This responsive draft already lays out at viewport size.
        const zoom = Math.floor(game.documentZoom * 100) / 100 || 1;
        dialog.style.setProperty('--party-draft-scale', String(1 / zoom));
      },
      update(ok) {
        renderSeats();
        const mine = ui.selected.buttons.filter((option) => dialog.buttons.includes(option));
        selection = mine;
        for (const native of dialog.buttons) {
          const picked = mine.indexOf(native);
          const taken = !faction && event.partyTeamChoice?.taken === native.link;
          const preferred = !faction && request.preference === native.link;
          native.dataset.taken = String(taken);
          native.classList.toggle('is-selected', picked >= 0);
          native.setAttribute('aria-pressed', String(picked >= 0));
          native.removeAttribute('aria-disabled');
          if (taken) native.setAttribute('aria-description', '队友已选 · 只读');
          else native.removeAttribute('aria-description');
          const label =
            event.partyTeamChoice?.aiTeammate && picked >= 0
              ? picked === 0
                ? '自己'
                : 'AI 队友'
              : '';
          native.partyDraftMark.textContent = [preferred && '点将', taken && '队友已选', label]
            .filter(Boolean)
            .join(' · ');
        }
        // Keep the selected and inspected targets independent, including when
        // the worker locks a previously tentative teammate choice.
        renderSkills();
        feedback.textContent = faction
          ? '请选择你的势力'
          : event.partyTeamChoice?.aiTeammate
            ? '按顺序选择自己的武将、AI 队友的武将，再确认出战'
            : '点选武将查看技能，确认后出战';
        confirm.disabled = !ok;
        confirm.textContent = faction
          ? mine.length
            ? `确认势力：${groupLabel(mine[0])}`
            : '确认势力'
          : mine.length
            ? `确认出战：${mine.map((option) => nameOf(option.link)).join('、')}`
            : '确认出战';
        if (ui.confirm && ui.confirm !== stage.confirm) {
          stage.confirm = ui.confirm;
          stage.confirm.classList.add('party-native-draft-original-confirm');
        }
      },
    };
    const originalClose = dialog.close;
    dialog.close = function (...args) {
      this.style.display = 'none';
      destroy(stage);
      return originalClose.apply(this, args);
    };
    dialog.classList.add('party-native-draft');
    dialog.append(shell);
    tellParent(true);
    stage.fit();
    renderSkills();
    updateClock();
    return stage;
  }

  lib.hooks.checkEnd.push(function showPartyDraft(event, { ok }) {
    if (current && (!current.dialog.isConnected || current.event !== event)) destroy(current);
    if (
      event.name !== 'chooseButton' ||
      !event.isMine() ||
      !['general', 'faction'].includes(event.partyDraft?.kind) ||
      !event.dialog?.isConnected ||
      event.dialog.classList.contains('removing') ||
      !event.dialog.buttons?.length
    )
      return;
    current ??= mount(event);
    current.update(ok);
  });
}
