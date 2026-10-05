import { api, app, element } from './ui.js';

type General = {
  id: string;
  preset: string;
  name: string;
  faction: string;
  hp: string;
  portrait: string;
  skills: { id: string; name: string; description: string }[];
};
type Catalog = { characters: General[] };
const factions: Record<string, string> = { wei: '魏', shu: '蜀', wu: '吴', qun: '群', shen: '神' };
export const guideButton =
  '<button id="general-guide" class="button secondary full-width" type="button">武将图鉴 · 查看技能</button>';

/** A lobby dialog keeps the member's SSE/session alive while browsing skills. */
export function bindGeneralGuide(preset: () => string = () => 'beginner'): void {
  const dialog = document.createElement('dialog');
  dialog.id = 'general-guide-dialog';
  dialog.className = 'general-guide';
  dialog.setAttribute('aria-labelledby', 'guide-title');
  dialog.innerHTML = `<div class="panel-heading"><div><h2 id="guide-title">武将图鉴</h2><p class="hint">上桌前看看，点开武将了解技能。</p></div><button id="guide-close" class="close-dialog" type="button" aria-label="关闭武将图鉴">×</button></div><div class="guide-filters"><label>武将档位<select id="guide-preset" aria-label="武将档位"><option value="beginner">新手档 · 标准包</option><option value="advanced">进阶档 · 界限突破、阴、雷、神</option></select></label><label>势力<select id="guide-faction" aria-label="势力"><option value="">全部势力</option><option value="wei">魏</option><option value="shu">蜀</option><option value="wu">吴</option><option value="qun">群</option><option value="shen">神</option></select></label><label class="guide-search">查找武将或技能<input id="guide-search" type="search" placeholder="如：赵云、龙胆" autocomplete="off" /></label></div><p id="guide-count" class="hint" role="status"></p><div id="guide-list" class="guide-list"></div><button id="guide-retry" class="button secondary" type="button" hidden>重新载入图鉴</button><p class="hint">技能说明来自当前房间使用的无名杀 v1.11.6。关联技能会一并列出。</p>`;
  app.append(dialog);
  let catalog: Catalog | undefined;
  let loading = false;
  function render(): void {
    if (!catalog) return;
    const selected = element<HTMLSelectElement>('#guide-preset').value;
    const faction = element<HTMLSelectElement>('#guide-faction').value;
    const query = element<HTMLInputElement>('#guide-search').value.trim().toLowerCase();
    const roster = catalog.characters.filter((general) => general.preset === selected);
    const results = roster.filter(
      (general) =>
        (!faction || general.faction === faction) &&
        `${general.name} ${general.skills.map((skill) => skill.name).join(' ')}`
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
      stats.textContent = `${factions[general.faction] ?? general.faction} · 体力 ${general.hp}`;
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
      entry.append(summary, descriptions);
      list.append(entry);
    }
  }
  async function load(): Promise<void> {
    if (loading) return;
    if (catalog) {
      render();
      return;
    }
    loading = true;
    element('#guide-count').textContent = '正在载入武将和技能…';
    element('#guide-retry').hidden = true;
    try {
      catalog = await api<Catalog>('/assets/generals.json');
      render();
    } catch {
      element('#guide-count').textContent = '图鉴暂时未能载入，请检查 Wi-Fi 后重试。';
      element('#guide-retry').hidden = false;
    } finally {
      loading = false;
    }
  }
  element('#general-guide').addEventListener('click', () => {
    element<HTMLSelectElement>('#guide-preset').value = preset();
    dialog.showModal();
    void load();
  });
  element('#guide-close').addEventListener('click', () => dialog.close());
  element('#guide-retry').addEventListener('click', () => {
    void load();
  });
  element('#guide-preset').addEventListener('change', render);
  element('#guide-faction').addEventListener('change', render);
  element('#guide-search').addEventListener('input', render);
}
