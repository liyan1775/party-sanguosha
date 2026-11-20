// SPDX-License-Identifier: GPL-3.0-only
import type { ShanhetuBookView } from '../../../packages/shared/src/shanhetu.js';
import rules from '../../../config/shanhetu-book.json' with { type: 'json' };
import { app, element } from './ui.js';
import { make, button, plain } from './shanhetu-ui.js';

const openings = [
  { id: null, name: '自行出征', description: '从选将与第一场遭遇开始。' },
  ...rules.tactics,
];
const outcomes = { victory: '通关', defeat: '败北', retreat: '撤军' };

export function bindShanhetuLaunch(request: () => Promise<ShanhetuBookView>) {
  const lobby = element('.room-grid');
  const start = element<HTMLButtonElement>('#start-button');
  const startAnchor = document.createComment('room-start');
  start.before(startAnchor);
  const launch = make('section', 'shanhetu-launch shanhetu-theme');
  launch.id = 'shanhetu-launch';
  launch.hidden = true;
  const hero = make('header', 'shanhetu-launch-cover');
  const title = make('h2', '', '山河图');
  const scene = make('p', 'shanhetu-kicker', '诸侯伐董');
  const navigation = make('div', 'shanhetu-launch-nav');
  const showRoom = button('房间设置', 'shanhetu-quiet');
  const showBook = button('山河册', 'shanhetu-quiet');
  navigation.append(showRoom, showBook);
  hero.append(navigation, scene, title);
  const body = make('div', 'shanhetu-launch-body');
  const operations = make('div', 'shanhetu-launch-actions');
  const challenges = make('div', 'shanhetu-launch-challenge');
  const label = make('label', '', '征程难度');
  const difficulty = make('select');
  difficulty.id = 'shanhetu-difficulty';
  label.htmlFor = difficulty.id;
  const hint = make('p', 'shanhetu-muted');
  hint.id = 'shanhetu-difficulty-hint';
  difficulty.setAttribute('aria-describedby', hint.id);
  challenges.append(label, difficulty, hint);
  const choices = make('div', 'shanhetu-opening');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', '初始战法');
  body.append(challenges, make('h3', '', '初始战法'), choices, operations);
  launch.append(hero, body);
  lobby.before(launch);

  const resume = button('返回出征', 'button secondary');
  resume.hidden = true;
  lobby.before(resume);

  const book = make('dialog', 'shanhetu-theme shanhetu-dialog');
  book.id = 'shanhetu-book';
  book.setAttribute('aria-labelledby', 'shanhetu-book-title');
  const heading = make('header', 'shanhetu-book-heading');
  const bookTitle = make('h2', '', '山河册');
  bookTitle.id = 'shanhetu-book-title';
  const close = button('关闭', 'shanhetu-quiet');
  heading.append(bookTitle, close);
  const ledger = make('div');
  const status = make('p', 'shanhetu-status');
  status.setAttribute('role', 'status');
  book.append(heading, status, ledger);
  launch.after(book);

  let visible = false;
  let settings = false;
  let generation = 0;
  let view: ShanhetuBookView | undefined;
  let loading = false;
  let selectedOpening: number | null = null;

  function layout() {
    const showing = visible && !settings;
    app.classList.toggle('shanhetu-launch-active', showing);
    launch.hidden = !showing;
    lobby.hidden = showing;
    resume.hidden = !visible || !settings;
    if (visible) operations.append(start);
    else startAnchor.after(start);
  }

  function difficultyHint() {
    const current = view?.difficulties.find((rule) => String(rule.id) === difficulty.value);
    hint.textContent =
      current?.description ||
      (loading
        ? '正在读取山河册…'
        : view?.difficulties.find((rule) => !rule.unlocked)?.unlockText) ||
      '';
  }

  function render() {
    const previous = difficulty.value;
    const available = view?.difficulties ?? [{ id: 1, name: '普通1', unlocked: true }];
    difficulty.replaceChildren(
      ...available.map((rule) => {
        const option = new Option(
          rule.unlocked ? rule.name : `${rule.name} · 未解锁`,
          String(rule.id),
        );
        option.disabled = !rule.unlocked;
        return option;
      }),
    );
    if (available.some((rule) => rule.unlocked && String(rule.id) === previous))
      difficulty.value = previous;
    difficultyHint();
    ledger.replaceChildren();
    if (!view) return;
    const next = view.milestones.find((step) => step.skills.some((skill) => !skill.unlocked));
    const progress = make('p', 'shanhetu-book-score');
    progress.append(make('strong', '', String(view.victories)), make('span', '', '场战斗胜利'));
    ledger.append(progress);
    if (next) {
      const meter = make('progress');
      meter.max = next.victories;
      meter.value = view.victories;
      meter.setAttribute('aria-label', '下一项解锁进度');
      ledger.append(
        meter,
        make(
          'p',
          'shanhetu-muted',
          `再胜 ${next.victories - view.victories} 场，${next.skills
            .filter((skill) => !skill.unlocked)
            .map((skill) => skill.name)
            .join('、')}加入奖励池。`,
        ),
      );
    } else ledger.append(make('p', 'shanhetu-muted', '进阶技能已全部加入奖励池。'));
    const trail = make('ol', 'shanhetu-milestones');
    for (const step of view.milestones) {
      const milestone = make('li');
      const goal = make('div', 'shanhetu-milestone-goal');
      goal.append(make('span', '', String(step.victories)), make('span', '', '胜'));
      const content = make('div');
      content.append(make('p', 'shanhetu-muted', step.lesson));
      for (const skill of step.skills) {
        const skillLine = make('details', 'shanhetu-book-skill');
        const summary = make('summary');
        summary.append(
          make('strong', '', skill.name),
          make('span', '', skill.unlocked ? '已加入' : '待解锁'),
        );
        skillLine.append(summary, make('p', '', plain(skill.description)));
        content.append(skillLine);
      }
      milestone.append(goal, content);
      trail.append(milestone);
    }
    ledger.append(trail);
    if (view.recent.length) {
      const history = make('details', 'shanhetu-history');
      history.append(make('summary', '', '征程履历'));
      for (const item of view.recent)
        history.append(
          make(
            'p',
            '',
            `${item.hero} · ${view.difficulties.find((rule) => rule.id === item.difficulty)?.name ?? '诸侯伐董'} · ${item.ending ?? outcomes[item.outcome]}${item.historic ? ' · 旧版记录' : ` · ${item.victories}胜`}`,
          ),
        );
      ledger.append(history);
    }
  }

  async function refresh() {
    if (loading || !visible) return;
    const current = generation;
    loading = true;
    status.textContent = '正在读取山河册…';
    difficultyHint();
    try {
      const next = await request();
      if (current !== generation) return;
      view = next;
      status.textContent = '';
    } catch (error) {
      if (current !== generation) return;
      status.textContent = error instanceof Error ? error.message : '山河册暂时无法读取。';
    } finally {
      if (current === generation) {
        loading = false;
        render();
      }
    }
  }

  for (const opening of openings) {
    const tile = button('', 'shanhetu-opening-choice');
    tile.dataset.openingTactic = String(opening.id ?? '');
    tile.setAttribute('aria-pressed', String(opening.id === selectedOpening));
    tile.append(make('strong', '', opening.name), make('span', '', opening.description));
    tile.onclick = () => {
      selectedOpening = opening.id;
      for (const child of choices.children)
        child.setAttribute('aria-pressed', String(child === tile));
    };
    choices.append(tile);
  }

  close.onclick = () => book.close();
  difficulty.onchange = difficultyHint;
  showBook.onclick = () => {
    book.showModal();
    void refresh();
  };
  showRoom.onclick = () => {
    settings = true;
    layout();
    element<HTMLDetailsElement>('#settings-panel').open = true;
    element<HTMLElement>('#settings-panel > summary').focus();
  };
  resume.onclick = () => {
    settings = false;
    layout();
    showRoom.focus();
  };

  return {
    context(next: boolean) {
      if (visible === next) return;
      generation++;
      loading = false;
      visible = next;
      settings = false;
      layout();
      if (visible) {
        render();
        void refresh();
      } else if (book.open) book.close();
    },
    startOptions() {
      return { difficulty: Number(difficulty.value) || 1, openingTactic: selectedOpening };
    },
  };
}
