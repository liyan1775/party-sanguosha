// SPDX-License-Identifier: GPL-3.0-only
import {
  shanhetuOpeningPackages,
  type ShanhetuCampaignView,
} from '../../../packages/shared/src/shanhetu.js';
import { staticAsset } from './static-assets.js';
import { button, make, plain } from './shanhetu-ui.js';
import { draftFactions, draftMeta, focusDraftCandidate } from './draft-controls.js';

type Choice = ShanhetuCampaignView['actions'][number];

function skillLines(action: Choice) {
  if (action.skills?.length) return action.skills;
  const [, ...lines] = action.description.split('\n');
  const skills: NonNullable<Choice['skills']> = [];
  for (const line of lines) {
    const separator = line.indexOf('：');
    if (separator > 0 && separator < 18)
      skills.push({ name: line.slice(0, separator), description: line.slice(separator + 1) });
    else if (skills.length) skills.at(-1)!.description += '\n' + line;
    else if (line) skills.push({ name: '技能', description: line });
  }
  return skills;
}

function heroMeta(action: Choice, chooseGroup = false) {
  const meta = make('span', 'hd-card-meta');
  const group = chooseGroup ? 'shen' : (action.group ?? '');
  meta.dataset.faction = group;
  const [, hp, maxHp] =
    action.description.match(/^[^\n]*?([0-9]+)(?:\s*\/\s*([0-9]+))?\s*体力/) ?? [];
  meta.textContent = draftMeta(group, maxHp ? `${hp}/${maxHp}` : hp);
  return meta;
}

export function bindShanhetuDraft(
  confirm: HTMLButtonElement,
  end: HTMLButtonElement,
  status: HTMLElement,
  choose: (id?: string) => void,
) {
  const root = make('section', 'hero-draft shanhetu-draft');
  root.hidden = true;
  root.setAttribute('aria-labelledby', 'shanhetu-draft-title');
  const header = make('header', 'hd-header');
  const self = make('div', 'hd-self');
  const seal = make('img', 'shanhetu-draft-seal');
  seal.alt = '';
  const title = make('h2');
  title.id = 'shanhetu-draft-title';
  title.tabIndex = -1;
  self.append(seal, title);
  const opening = make('div', 'hd-seats');
  const metric = make('div', 'hd-metrics');
  metric.append(make('span', 'hd-clock', '自由择将'));
  header.append(self, opening, metric);

  const workspace = make('div', 'hd-workspace');
  const pool = make('section', 'hd-pool');
  pool.setAttribute('aria-label', '出征候选');
  const grid = make('div', 'hd-grid');
  pool.append(grid);
  const scroll = make('aside', 'hd-scroll');
  scroll.id = 'shanhetu-draft-skills';
  scroll.setAttribute('aria-label', '武将技能');
  const scrollHeading = make('header', 'hd-scroll-heading');
  const headingText = make('div');
  const hero = make('h3');
  const selectionText = make('p', 'hd-detail-selection');
  headingText.append(hero, selectionText);
  const closeSkills = button('返回候选', 'hd-button hd-close-skills');
  scrollHeading.append(headingText, closeSkills);
  const skills = make('div', 'hd-skills');
  skills.tabIndex = 0;
  skills.setAttribute('aria-label', '技能说明');
  scroll.append(scrollHeading, skills);
  workspace.append(pool, scroll);

  const footer = make('footer', 'hd-actions');
  const feedback = make('div', 'hd-feedback');
  const hint = make('p');
  const operations = make('div', 'hd-buttons');
  const factions = make('div', 'shanhetu-draft-factions');
  factions.setAttribute('role', 'group');
  factions.setAttribute('aria-label', '选择出征势力');
  factions.hidden = true;
  const showSkills = button('查看技能', 'hd-button hd-show-skills');
  showSkills.setAttribute('aria-controls', scroll.id);
  showSkills.setAttribute('aria-expanded', 'false');
  feedback.append(hint, factions);
  operations.append(showSkills);
  footer.append(feedback, operations);
  const tacticDialog = make('dialog', 'hd-tactic-dialog');
  const tacticTitle = make('h3', '', '初始战法');
  tacticTitle.id = 'shanhetu-opening-tactic-title';
  const tacticList = make('div', 'hd-skills');
  const closeTactics = button('返回候选', 'hd-button');
  closeTactics.onclick = () => tacticDialog.close();
  tacticDialog.setAttribute('aria-labelledby', tacticTitle.id);
  tacticDialog.append(tacticTitle, tacticList, closeTactics);
  root.append(header, workspace, footer, tacticDialog);

  let active: Choice[] | undefined;
  let explicitlyFocused = false;
  let buttons: { card: HTMLButtonElement; actions: Choice[] }[] = [];

  function setDrawer(open: boolean) {
    root.classList.toggle('detail-open', open);
    showSkills.setAttribute('aria-expanded', String(open));
    if (open) closeSkills.focus({ preventScroll: true });
    else focusDraftCandidate(buttons.find(({ actions }) => actions === active)?.card);
  }
  showSkills.onclick = () => setDrawer(true);
  closeSkills.onclick = () => setDrawer(false);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !tacticDialog.open && root.classList.contains('detail-open')) {
      event.preventDefault();
      setDrawer(false);
    }
  });

  function inspect(actions: Choice[]) {
    const action = actions[0]!;
    active = actions;
    hero.replaceChildren(action.label, heroMeta(action, actions.length > 1));
    skills.replaceChildren(
      ...skillLines(action).map(({ name, description }) => {
        const section = make('section');
        section.append(make('h4', '', name), make('p', '', plain(description)));
        return section;
      }),
    );
    if (!skills.childElementCount) skills.textContent = '此武将暂无可显示的技能说明。';
    skills.scrollTop = 0;
  }

  return {
    root,
    grid,
    mount(journey: ShanhetuCampaignView, tacticDescriptions: ReadonlyMap<string, string>) {
      seal.src = staticAsset('/assets/emblems/emblem-shanhetu.webp');
      title.textContent = `${journey.scenario} · 择将出征`;
      const pack = shanhetuOpeningPackages.find(({ name }) => name === journey.openingPackage);
      const briefing = [
        ['初始战法', journey.initialTactics?.join('、') ?? '无'],
        ['开局流派', journey.openingPackage ?? '无'],
      ] as const;
      opening.replaceChildren(
        ...briefing.map(([label, value]) => {
          const hasTactics = label === '初始战法' && !!journey.initialTactics?.length;
          const chip = hasTactics
            ? button(`${label} · ${value}`, 'hd-seat hd-button hd-tactic-trigger')
            : make('div', 'hd-seat');
          chip.dataset.tone = 'jade';
          if (hasTactics) {
            chip.setAttribute('aria-haspopup', 'dialog');
            chip.onclick = () => {
              if (root.classList.contains('detail-open')) setDrawer(false);
              tacticList.replaceChildren(
                ...journey.initialTactics!.map((name) => {
                  const entry = make('section');
                  entry.append(
                    make('h4', '', name),
                    make('p', '', plain(tacticDescriptions.get(name) ?? '暂无战法说明。')),
                  );
                  return entry;
                }),
              );
              tacticDialog.showModal();
              closeTactics.focus({ preventScroll: true });
            };
          } else chip.append(make('strong', '', label), make('span', '', value));
          if (label === '开局流派' && pack) chip.append(make('small', '', pack.description));
          return chip;
        }),
      );
      const candidates = new Map<string, Choice[]>();
      for (const action of journey.actions) {
        if (action.kind !== 'hero') continue;
        const key = action.general ?? action.id;
        const current = candidates.get(key);
        if (current) current.push(action);
        else candidates.set(key, [action]);
      }
      buttons = [...candidates.values()].map((actions) => {
        const action = actions[0]!;
        const card = button('', 'hd-card');
        if (action.general) card.dataset.general = action.general;
        if (actions.length === 1) card.dataset.actionId = action.id;
        card.setAttribute('aria-pressed', 'false');
        const portrait = make('span', 'hd-portrait');
        if (action.portrait) {
          const image = make('img');
          image.alt = '';
          image.src = action.portrait;
          portrait.append(image);
        }
        card.append(
          portrait,
          heroMeta(action, actions.length > 1),
          make('strong', 'hd-card-name', action.label),
        );
        if (actions.length > 1) card.append(make('span', 'hd-card-mark', '可选势力'));
        card.onclick = () => {
          inspect(actions);
          factions.replaceChildren();
          factions.hidden = actions.length === 1;
          if (actions.length > 1) {
            for (const option of actions) {
              const faction = button(
                draftFactions[option.group ?? ''] ?? option.group ?? '',
                'hd-button',
              );
              faction.dataset.actionId = option.id;
              faction.setAttribute('aria-pressed', 'false');
              faction.onclick = () => {
                hero.replaceChildren(option.label, heroMeta(option));
                choose(option.id);
              };
              factions.append(faction);
            }
          }
          explicitlyFocused = true;
          choose(actions.length === 1 ? action.id : undefined);
        };
        return { card, actions };
      });
      grid.style.setProperty('--hd-columns', String(Math.min(5, Math.max(3, buttons.length))));
      grid.replaceChildren(...buttons.map(({ card }) => card));
      feedback.append(status);
      operations.append(end, confirm);
      end.className = 'hd-button';
      confirm.className = 'hd-button hd-primary';
      root.hidden = false;
      root.classList.remove('detail-open');
      showSkills.setAttribute('aria-expanded', 'false');
      factions.replaceChildren();
      factions.hidden = true;
      explicitlyFocused = false;
      if (buttons.length) inspect(buttons[0]!.actions);
      title.focus({ preventScroll: true });
    },
    sync(selected: Choice | undefined, canChoose: boolean, busy: boolean) {
      for (const { card, actions } of buttons) {
        card.disabled = !canChoose;
        card.setAttribute('aria-pressed', String(explicitlyFocused && active === actions));
      }
      for (const control of factions.querySelectorAll<HTMLButtonElement>('button')) {
        control.disabled = !canChoose;
        control.setAttribute('aria-pressed', String(control.dataset.actionId === selected?.id));
      }
      selectionText.textContent = selected ? `待确认：${selected.label}` : '未预选';
      showSkills.disabled = !buttons.length;
      confirm.disabled = !canChoose || !selected;
      confirm.textContent = busy
        ? '正在同步…'
        : selected
          ? `确认出战：${selected.label}`
          : '确认出战';
      hint.textContent =
        !factions.hidden && !selected
          ? '请选择势力，再确认出战。'
          : '点选武将比较技能，确认后出征。';
    },
    clear() {
      if (tacticDialog.open) tacticDialog.close();
      root.hidden = true;
      root.classList.remove('detail-open');
      grid.replaceChildren();
      buttons = [];
      active = undefined;
    },
  };
}
