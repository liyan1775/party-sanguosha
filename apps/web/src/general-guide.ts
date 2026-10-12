import { api, app, element, action, message } from './ui.js';
import type { GeneralChoiceView } from '../../../packages/shared/src/contracts.js';
import { GENERAL_PRESETS } from '../../../packages/shared/src/contracts.js';
import { renderRosterSource } from './roster-source.js';

type General = {
  id: string;
  preset: string;
  name: string;
  officialName?: string;
  versionNote?: string;
  faction: string;
  hp: string;
  armor?: number;
  portrait: string;
  skills: { id: string; name: string; description: string }[];
};
type Catalog = { characters: General[] };
const factions: Record<string, string> = {
  wei: '魏',
  shu: '蜀',
  wu: '吴',
  qun: '群',
  shen: '神',
  jin: '晋',
};
type Selection = {
  enabled(): boolean;
  sharedTeamPool?(): boolean;
  read(): Promise<GeneralChoiceView>;
  choose(general: string | null): Promise<GeneralChoiceView>;
};
export const guideButton =
  '<button id="general-guide" class="button secondary full-width" type="button">武将图鉴 · 查看技能</button>';

/** A lobby dialog keeps the member's SSE/session alive while browsing skills. */
export function bindGeneralGuide(preset: () => string = () => 'beginner', selection?: Selection) {
  const dialog = document.createElement('dialog');
  dialog.id = 'general-guide-dialog';
  dialog.className = 'general-guide';
  dialog.setAttribute('aria-labelledby', 'guide-title');
  dialog.innerHTML = `<div class="panel-heading"><div><h2 id="guide-title">武将图鉴</h2><p class="hint">上桌前看看，点开武将了解技能。</p></div><button id="guide-close" class="close-dialog" type="button" aria-label="关闭武将图鉴">×</button></div><div class="guide-filters"><label>武将档位<select id="guide-preset" aria-label="武将档位">${GENERAL_PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('')}</select></label><label>势力<select id="guide-faction" aria-label="势力"><option value="">全部势力</option><option value="wei">魏</option><option value="shu">蜀</option><option value="wu">吴</option><option value="qun">群</option><option value="shen">神</option></select></label><label class="guide-search">查找武将或技能<input id="guide-search" type="search" placeholder="如：赵云、龙胆" autocomplete="off" /></label></div><p id="guide-count" class="hint" role="status"></p><div id="guide-list" class="guide-list"></div><button id="guide-retry" class="button secondary" type="button" hidden>重新载入图鉴</button><p class="hint">选用无名杀自带武将与技能。标准档袁术采用“旧袁术”；关联技能会一并列出。</p>`;
  app.append(dialog);
  const source = document.createElement('div');
  source.id = 'guide-source';
  element('#guide-count').before(source);
  element<HTMLSelectElement>('#guide-faction').add(new Option('晋', 'jin'));
  const selectionStatus = document.createElement('p');
  selectionStatus.className = 'hint';
  selectionStatus.id = 'guide-selection-status';
  selectionStatus.setAttribute('role', 'status');
  const cancelSelection = document.createElement('button');
  cancelSelection.id = 'guide-cancel-selection';
  cancelSelection.type = 'button';
  cancelSelection.className = 'button secondary';
  cancelSelection.textContent = '取消点将，使用随机候选';
  const toolbar = document.createElement('div');
  toolbar.hidden = true;
  toolbar.append(selectionStatus, cancelSelection);
  element('#guide-count').before(toolbar);
  const catalogs = new Map<string, Catalog>();
  const pendingCatalogs = new Map<string, Promise<Catalog>>();
  const currentCatalog = () => catalogs.get(element<HTMLSelectElement>('#guide-preset').value);
  let picking = false;
  let choice: GeneralChoiceView | undefined;
  let saving = false;
  let requestedRevision = -1;
  let completedRevision = -1;
  let choiceLoading = false;
  let generation = 0;
  function renderChoice(): void {
    if (!selection) return;
    const name = catalogs
      .get(preset())
      ?.characters.find((general) => general.id === choice?.selected)?.name;
    const text = choice?.selected
      ? `已点将：${name ?? choice.selected} · 第1个候选`
      : '未点将，使用随机候选。';
    element('#general-pick-state').textContent = text;
    selectionStatus.textContent = text;
    cancelSelection.hidden = !choice?.selected;
    cancelSelection.disabled = saving;
  }
  function render(): void {
    const catalog = currentCatalog();
    if (!catalog) return;
    const selected = element<HTMLSelectElement>('#guide-preset').value;
    renderRosterSource(element('#guide-source'), selected);
    const faction = element<HTMLSelectElement>('#guide-faction').value;
    const query = element<HTMLInputElement>('#guide-search').value.trim().toLowerCase();
    const roster = catalog.characters.filter((general) => general.preset === selected);
    const results = roster.filter(
      (general) =>
        (!faction || general.faction === faction) &&
        `${general.name} ${general.officialName ?? ''} ${general.skills.map((skill) => skill.name).join(' ')}`
          .toLowerCase()
          .includes(query),
    );
    element('#guide-count').textContent = results.length
      ? `显示 ${results.length} / ${roster.length} 位武将`
      : '没有找到，换个武将名或技能名试试。';
    const list = element('#guide-list');
    list.replaceChildren();
    for (const general of results) {
      const entry = document.createElement('details');
      entry.className = 'guide-entry';
      const summary = document.createElement('summary');
      const portrait = document.createElement('img');
      portrait.src = general.portrait;
      portrait.alt = '';
      portrait.loading = 'lazy';
      portrait.width = 60;
      portrait.height = 80;
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = general.name;
      const stats = document.createElement('small');
      stats.textContent = `${factions[general.faction] ?? general.faction} · 体力 ${general.hp}${general.armor ? ` · 护甲 ${general.armor}` : ''}`;
      const skills = document.createElement('span');
      skills.textContent = general.skills
        .filter((skill) => !skill.name.includes('关联技能'))
        .map((skill) => skill.name)
        .join(' · ');
      info.append(name, stats, skills);
      summary.append(portrait, info);
      const descriptions = document.createElement('dl');
      for (const skill of general.skills) {
        const title = document.createElement('dt');
        title.textContent = skill.name;
        const description = document.createElement('dd');
        description.textContent = skill.description;
        descriptions.append(title, description);
      }
      entry.append(summary);
      if (general.versionNote) {
        const note = document.createElement('p');
        note.className = 'hint guide-version-note';
        note.textContent = general.versionNote;
        entry.append(note);
      }
      if (picking && selection) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button secondary guide-pick';
        button.dataset.general = general.id;
        button.textContent =
          choice?.selected === general.id
            ? '已点将'
            : choice?.available.includes(general.id)
              ? '点这名武将'
              : '已被点将';
        button.disabled =
          saving || !choice?.available.includes(general.id) || choice.selected === general.id;
        action(button, () => choose(general.id), render);
        // The choice remains visible while skill descriptions are collapsed.
        summary.append(button);
        button.addEventListener('click', (event) => event.preventDefault());
      }
      entry.append(descriptions);
      list.append(entry);
    }
  }
  async function load(selected = element<HTMLSelectElement>('#guide-preset').value): Promise<void> {
    if (catalogs.has(selected)) {
      render();
      return;
    }
    if (element<HTMLSelectElement>('#guide-preset').value === selected) {
      renderRosterSource(element('#guide-source'), selected);
      element('#guide-list').replaceChildren();
      element('#guide-count').textContent = '正在载入武将和技能…';
      element('#guide-retry').hidden = true;
    }
    try {
      let pending = pendingCatalogs.get(selected);
      if (!pending) {
        pending = api<Catalog>(`/assets/generals-${selected}.json`);
        pendingCatalogs.set(selected, pending);
      }
      catalogs.set(selected, await pending);
      if (element<HTMLSelectElement>('#guide-preset').value === selected) render();
    } catch {
      if (element<HTMLSelectElement>('#guide-preset').value !== selected) return;
      element('#guide-count').textContent = '图鉴暂时未能载入，请检查 Wi-Fi 后重试。';
      element('#guide-retry').hidden = false;
    } finally {
      pendingCatalogs.delete(selected);
    }
  }
  async function refreshChoice(): Promise<void> {
    if (!selection?.enabled() || choiceLoading) return;
    choiceLoading = true;
    const revision = requestedRevision;
    const currentGeneration = generation;
    const currentPreset = preset();
    try {
      const [result] = await Promise.all([selection.read(), load(currentPreset)]);
      if (!selection.enabled() || generation !== currentGeneration || preset() !== currentPreset)
        return;
      choice = result;
      completedRevision = revision;
      renderChoice();
      if (picking) {
        element<HTMLSelectElement>('#guide-preset').value = preset();
        render();
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : '点将暂时无法读取，请重试。';
      element('#general-pick-state').textContent = text;
      selectionStatus.textContent = text;
    } finally {
      choiceLoading = false;
      if (requestedRevision !== revision && selection?.enabled()) void refreshChoice();
    }
  }
  async function choose(general: string | null): Promise<void> {
    if (!selection?.enabled() || saving) return;
    saving = true;
    generation++;
    render();
    try {
      choice = await selection.choose(general);
      renderChoice();
      message('点将已保存，请真人玩家重新准备。', true);
    } catch (error) {
      selectionStatus.textContent =
        error instanceof Error ? error.message : '点将保存失败，请重试。';
      void refreshChoice();
      throw error;
    } finally {
      saving = false;
      render();
      cancelSelection.disabled = false;
    }
  }
  function open(pick: boolean): void {
    picking = pick;
    toolbar.hidden = !pick;
    element('#guide-title').textContent = pick ? '大厅点将' : '武将图鉴';
    element('#guide-title + p').textContent = pick
      ? selection?.sharedTeamPool?.()
        ? '点的武将加入本队共享的 10 将池，并排在本人第1个候选；队友也可选择，开局后两人各确认一名。'
        : '点的武将放在第1个候选，其余仍随机；开局后可选择任一候选。身份局主公先选并展示。'
      : '上桌前看看，点开武将了解技能。';
    const presetSelect = element<HTMLSelectElement>('#guide-preset');
    presetSelect.value = preset();
    presetSelect.disabled = pick;
    dialog.showModal();
    void load();
    if (pick) void refreshChoice();
  }
  element('#general-guide').addEventListener('click', () => {
    open(false);
  });
  if (selection) element('#general-pick').addEventListener('click', () => open(true));
  action(cancelSelection, () => choose(null));
  element('#guide-close').addEventListener('click', () => dialog.close());
  element('#guide-retry').addEventListener('click', () => {
    void load();
  });
  element('#guide-preset').addEventListener('change', () => {
    void load();
  });
  element('#guide-faction').addEventListener('change', render);
  element('#guide-search').addEventListener('input', render);
  return {
    refreshSelection(revision: number): void {
      if (!selection) return;
      requestedRevision = revision;
      if (!selection.enabled()) {
        generation++;
        choice = undefined;
        completedRevision = -1;
        if (picking && dialog.open) dialog.close();
        return;
      }
      if (completedRevision !== revision) void refreshChoice();
    },
  };
}
