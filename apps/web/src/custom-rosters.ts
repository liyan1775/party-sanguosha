import {
  GENERAL_PRESETS,
  type CustomRosterGeneral,
  type CustomRosterRef,
  type CustomRosterSummary,
  type GeneralPresetId,
  type ResolvedCustomRoster,
  type RoomView,
} from '../../../packages/shared/src/contracts.js';
import { api, app } from './ui.js';

export type RosterIndex = {
  rosters: (CustomRosterSummary & { editable: boolean })[];
  presets: { id: GeneralPresetId; name: string; characters: string[] }[];
};
let catalogRequest: Promise<CustomRosterGeneral[]> | undefined;
const resolved = new Map<string, Promise<ResolvedCustomRoster>>();
export const rosterKey = (ref: CustomRosterRef) => `custom:${ref.id}:${ref.revision}`;
export function loadRosterCatalog(): Promise<CustomRosterGeneral[]> {
  catalogRequest ??= api<{ characters: CustomRosterGeneral[] }>('/api/rosters/catalog')
    .then((data) => data.characters)
    .catch((error) => {
      catalogRequest = undefined;
      throw error;
    });
  return catalogRequest;
}
export function loadCustomRoster(ref: CustomRosterRef): Promise<ResolvedCustomRoster> {
  const key = rosterKey(ref);
  if (!resolved.has(key))
    resolved.set(
      key,
      api<ResolvedCustomRoster>(`/api/rosters/${encodeURIComponent(ref.id)}/${ref.revision}`).catch(
        (error) => {
          resolved.delete(key);
          throw error;
        },
      ),
    );
  return resolved.get(key)!;
}

const factionNames: Record<string, string> = {
  wei: '魏',
  shu: '蜀',
  wu: '吴',
  qun: '群',
  jin: '晋',
  shen: '神',
  devil: '魔',
};
const packNames: Record<string, string> = {
  bingshi: '兵势篇',
  collab: '联动卡',
  diy: '自制武将（DIY）',
  huicui: '群英荟萃',
  jsrg: '江山如故',
  key: 'Key联动',
  newjiang: '新一将成名',
  offline: '线下武将',
  sb: '谋攻篇',
  sixiang: '四象封印',
  standard: '标准',
  refresh: '界限突破',
  shenhua: '神话再临',
  yijiang: '一将成名',
  onlyOL: 'OL专属',
  sp: '璀璨星河',
  sp2: '武将列传',
  mobile: '移动版',
  xianding: '新杀限定',
  sxrm: '蚀心入魔',
  extra: '神将',
  yingbian: '应变篇',
  tw: '海外服',
  clan: '门阀士族',
  shiji: '始计篇',
  old: '旧版',
};
export const rosterPackName = (pack: string) => packNames[pack] ?? pack;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const target = document.createElement(tag);
  target.textContent = text;
  target.className = className;
  return target;
}

/** Public character definitions only; never store cards, sessions or roster drafts in localStorage. */
export function bindCustomRosters(options: {
  anchor: HTMLElement;
  room(): RoomView;
  writable(): boolean;
  flush(): Promise<void>;
  request<T>(path: string, method?: string, body?: unknown): Promise<T>;
  apply(roster: CustomRosterSummary): Promise<void>;
}) {
  const entry = node('button', '自定义将池', 'button secondary full-width');
  entry.id = 'custom-rosters-open';
  entry.type = 'button';
  entry.hidden = true;
  options.anchor.after(entry);
  const dialog = node('dialog', '', 'custom-rosters');
  dialog.id = 'custom-rosters-dialog';
  dialog.setAttribute('aria-labelledby', 'custom-rosters-title');
  dialog.innerHTML = `<div class="custom-rosters-heading"><div><h2 id="custom-rosters-title">自定义将池</h2><p class="hint">自己挑武将，玩法沿用原有规则。</p></div><button id="custom-rosters-close" class="close-dialog" type="button" aria-label="关闭自定义将池">×</button></div><p id="custom-rosters-status" class="hint" role="status" aria-live="polite"></p><section id="custom-rosters-library"><p class="hint">名单保存在电脑；原浏览器和入口保留编辑权，换入口可复制继续编辑。</p><div class="custom-rosters-actions"><button id="custom-rosters-new" class="button primary" type="button">新建将池</button><label class="custom-rosters-check"><input id="custom-rosters-archived" type="checkbox">显示已归档</label></div><label>复制已有内置将池<select id="custom-rosters-copy-preset"></select></label><button id="custom-rosters-copy-built-in" class="button secondary" type="button">复制这份内置名单</button><div id="custom-rosters-list" class="custom-rosters-list"></div></section><section id="custom-rosters-editor" hidden><button id="custom-rosters-back" class="button text-button" type="button">← 返回将池列表</button><label>将池名称<input id="custom-rosters-name" maxlength="40" autocomplete="off" placeholder="例如：朋友常用将"></label><p id="custom-rosters-rules" class="hint"></p><div class="custom-rosters-filters"><label>搜索姓名、技能或原生版本<input id="custom-rosters-query" type="search" placeholder="如：赵云、龙胆、OL" autocomplete="off"></label><label>势力<select id="custom-rosters-faction"><option value="">全部势力</option>${Object.entries(
    factionNames,
  )
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join(
      '',
    )}</select></label><label class="custom-rosters-check"><input id="custom-rosters-selected" type="checkbox">仅看已选</label></div><details class="custom-rosters-batch"><summary>批量加入或移除</summary><label>从已有名单操作<select id="custom-rosters-batch-source"></select></label><div class="custom-rosters-actions"><button id="custom-rosters-batch-add" class="button secondary" type="button">加入这份名单</button><button id="custom-rosters-batch-remove" class="button secondary" type="button">移除这份名单</button></div><p class="hint">只更改勾选名单，不替换同名的其他原生版本。</p></details><div class="custom-rosters-actions"><button id="custom-rosters-select-results" class="button secondary" type="button">全选搜索结果</button><button id="custom-rosters-remove-results" class="button secondary" type="button">移除搜索结果</button><span id="custom-rosters-count" role="status"></span></div><div id="custom-rosters-generals" class="custom-rosters-generals"></div><div class="custom-rosters-footer"><p id="custom-rosters-draft" class="hint"></p><button id="custom-rosters-save" class="button secondary" type="button">保存名单</button><button id="custom-rosters-save-use" class="button primary" type="button">保存并用于本房间</button></div></section>`;
  app.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) =>
    dialog.querySelector<T>(`#${id}`)!;
  let index: RosterIndex = { rosters: [], presets: [] };
  let catalog: CustomRosterGeneral[] = [];
  let supported = false;
  let busy = false;
  let editor = false;
  let dirty = false;
  let permissionEpoch = 0;
  let previousWritable = options.writable();
  let current: CustomRosterSummary | undefined;
  let basePreset: GeneralPresetId = options.room().settings.generalPreset;
  let selected = new Set<string>();
  let saveState = '尚未保存';
  let visibleLimit = 48;
  const status = (text: string) => {
    el('custom-rosters-status').textContent = text;
  };
  const editable = () => options.writable() && !busy;
  function requireWritable(epoch = permissionEpoch) {
    if (!options.writable() || epoch !== permissionEpoch)
      throw new Error('房间状态或房主已变化。草稿仍保留，当前不能保存或应用。');
  }
  function syncControls() {
    entry.disabled = !options.writable();
    dialog
      .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
        'button, input, select',
      )
      .forEach((control) => {
        if (['custom-rosters-close', 'custom-rosters-back'].includes(control.id)) return;
        control.disabled = !editable();
      });
    if (editor) {
      el<HTMLButtonElement>('custom-rosters-save').disabled = !editable() || !dirty;
      el<HTMLButtonElement>('custom-rosters-save-use').disabled = !editable();
    }
    if (dialog.open && !options.writable())
      status('房间状态或房主已变化，暂不能修改；当前草稿仍保留。');
  }
  async function task(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    syncControls();
    status('正在处理…');
    try {
      await work();
    } catch (error) {
      status(error instanceof Error ? error.message : '未能完成操作，请重试；草稿仍保留。');
    } finally {
      busy = false;
      syncControls();
    }
  }
  async function readIndex() {
    index = await api<RosterIndex>('/api/rosters');
    renderLibrary();
  }
  function sourceOptions(select: HTMLSelectElement) {
    const value = select.value;
    select.replaceChildren();
    for (const preset of index.presets) select.add(new Option(preset.name, `preset:${preset.id}`));
    for (const roster of index.rosters.filter((item) => !item.archived))
      select.add(new Option(`${roster.name} · ${roster.characterCount}将`, rosterKey(roster)));
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }
  async function source(
    value: string,
  ): Promise<{ name: string; basePreset: GeneralPresetId; characters: string[] }> {
    if (value.startsWith('preset:')) {
      const preset = index.presets.find((item) => item.id === value.slice(7));
      if (!preset) throw new Error('这份内置名单当前不可用。');
      return { ...preset, basePreset: preset.id };
    }
    const roster = index.rosters.find((item) => rosterKey(item) === value);
    if (!roster) throw new Error('这份将池当前不可用，请重新打开列表。');
    const data = await loadCustomRoster(roster);
    return { name: roster.name, basePreset: roster.basePreset, characters: data.characters };
  }
  function renderLibrary() {
    const list = el('custom-rosters-list');
    list.replaceChildren();
    const includeArchived = el<HTMLInputElement>('custom-rosters-archived').checked;
    const rosters = index.rosters.filter((item) => !item.archived || includeArchived);
    if (!rosters.length)
      list.append(node('p', '还没有自定义将池。新建一份，或复制内置名单开始。', 'hint'));
    for (const roster of rosters) {
      const card = node('article', '', 'custom-roster-card');
      card.append(
        node('strong', roster.name),
        node(
          'p',
          `${roster.characterCount} 将 · 第 ${roster.revision} 版 · ${roster.editable ? '我的将池' : '当前入口只能复制'}${roster.archived ? ' · 已归档' : ''}`,
          'hint',
        ),
      );
      const bound = options.room().settings.customRoster;
      if (bound?.id === roster.id)
        card.append(
          node(
            'p',
            `本房间正在使用第 ${bound.revision} 版${bound.revision !== roster.revision ? `；最新保存为第 ${roster.revision} 版，需明确用于本房间才会切换。` : '。'}`,
            'hint',
          ),
        );
      const actions = node('div', '', 'custom-rosters-actions');
      function button(text: string, work: () => Promise<void>) {
        const button = node('button', text, 'button secondary');
        button.type = 'button';
        button.onclick = () => void task(work);
        actions.append(button);
      }
      button('复制', async () => {
        requireWritable();
        const data = await loadCustomRoster(roster);
        begin(`${roster.name}（副本）`, roster.basePreset, data.characters);
      });
      if (!roster.archived && roster.editable) {
        button('用于本房间', async () => {
          requireWritable();
          await options.apply(roster);
          status('已用于本房间。');
          dialog.close();
        });
        if (roster.editable) {
          button('编辑', async () => {
            requireWritable();
            const data = await loadCustomRoster(roster);
            begin(roster.name, roster.basePreset, data.characters, roster);
          });
          button('归档', async () => {
            requireWritable();
            if (!confirm('归档这份将池？已开局和已选用的旧版本会保留。')) return;
            await options.request(
              `/api/rooms/${options.room().code}/rosters/${encodeURIComponent(roster.id)}`,
              'DELETE',
              { expectedRevision: roster.revision },
            );
            await readIndex();
            status('已归档，旧版仍可供已绑定的房间使用。');
          });
        }
      }
      card.append(actions);
      list.append(card);
    }
    const copySelect = el<HTMLSelectElement>('custom-rosters-copy-preset');
    const before = copySelect.value;
    copySelect.replaceChildren(
      ...index.presets.map((preset) => new Option(preset.name, `preset:${preset.id}`)),
    );
    copySelect.value = before || `preset:${options.room().settings.generalPreset}`;
    sourceOptions(el('custom-rosters-batch-source'));
    syncControls();
  }
  function changed() {
    dirty = true;
    saveState = '有未保存修改';
    el('custom-rosters-draft').textContent = saveState;
    syncControls();
  }
  function matches() {
    const query = el<HTMLInputElement>('custom-rosters-query').value.trim().toLowerCase();
    const faction = el<HTMLSelectElement>('custom-rosters-faction').value;
    const onlySelected = el<HTMLInputElement>('custom-rosters-selected').checked;
    return catalog.filter(
      (general) =>
        (!faction || general.faction === faction) &&
        (!onlySelected || selected.has(general.id)) &&
        `${general.name} ${general.officialNames.join(' ')} ${general.id} ${general.pack} ${rosterPackName(general.pack)} ${general.skills.map((skill) => `${skill.id} ${skill.name} ${skill.description}`).join(' ')}`
          .toLowerCase()
          .includes(query),
    );
  }
  function renderGenerals() {
    const results = matches();
    el('custom-rosters-count').textContent =
      `已选 ${selected.size} 将 · 当前结果 ${results.length} 将`;
    const list = el('custom-rosters-generals');
    list.replaceChildren();
    if (!results.length)
      list.append(node('p', '没有符合条件的武将，换个关键词或取消筛选试试。', 'hint'));
    for (const general of results.slice(0, visibleLimit)) {
      const card = node('article', '', 'custom-roster-general');
      card.dataset.general = general.id;
      const label = node('label', '', 'custom-roster-choice');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = selected.has(general.id);
      check.setAttribute('aria-label', `选择${general.name}（${rosterPackName(general.pack)}）`);
      check.onchange = () => {
        if (!editable()) {
          check.checked = selected.has(general.id);
          return;
        }
        if (check.checked) selected.add(general.id);
        else selected.delete(general.id);
        changed();
        el('custom-rosters-count').textContent =
          `已选 ${selected.size} 将 · 当前结果 ${matches().length} 将`;
        if (el<HTMLInputElement>('custom-rosters-selected').checked) renderGenerals();
      };
      const portrait = document.createElement('img');
      portrait.src = general.portrait;
      portrait.alt = '';
      portrait.loading = 'lazy';
      const info = node('span');
      info.append(
        node('strong', general.name),
        node(
          'small',
          `${factionNames[general.faction] ?? general.faction} · ${rosterPackName(general.pack)} · 体力 ${general.hp}`,
        ),
        node('small', general.skills.map((skill) => skill.name).join(' · ')),
      );
      label.append(check, portrait, info);
      const details = node('details');
      details.append(node('summary', '查看完整技能与原生版本'));
      const version = node(
        'p',
        `原生版本：${rosterPackName(general.pack)} · ${general.id}`,
        'hint',
      );
      const dl = node('dl');
      for (const skill of general.skills)
        dl.append(node('dt', skill.name), node('dd', skill.description));
      details.append(version, dl);
      card.append(label, details);
      list.append(card);
    }
    if (results.length > visibleLimit) {
      const more = node(
        'button',
        `继续显示（还有 ${results.length - visibleLimit} 将）`,
        'button secondary',
      );
      more.type = 'button';
      more.id = 'custom-rosters-more';
      more.onclick = () => {
        visibleLimit += 48;
        renderGenerals();
      };
      list.append(more);
    }
    el('custom-rosters-draft').textContent = saveState;
    syncControls();
  }
  function begin(
    name: string,
    base: GeneralPresetId,
    characters: string[],
    existing?: CustomRosterSummary,
  ) {
    current = existing;
    visibleLimit = 48;
    basePreset = base;
    selected = new Set(characters);
    editor = true;
    dirty = !existing;
    saveState = existing
      ? `已保存第 ${existing.revision} 版；修改不会更换本房间绑定的旧版。`
      : '尚未保存';
    el<HTMLInputElement>('custom-rosters-name').value = name;
    el<HTMLInputElement>('custom-rosters-query').value = '';
    el<HTMLSelectElement>('custom-rosters-faction').value = '';
    el<HTMLInputElement>('custom-rosters-selected').checked = false;
    const preset = GENERAL_PRESETS.find((item) => item.id === base);
    el('custom-rosters-rules').textContent =
      `规则继承：${preset?.name ?? base} · ${preset?.cardPile ?? ''}。只修改可选武将，保留完整原生技能和AI；玩法、候选分配和牌堆沿用原档位。`;
    el('custom-rosters-library').hidden = true;
    el('custom-rosters-editor').hidden = false;
    status('同名武将可能有不同原生版本，请查看技能后勾选；不会自动替换。');
    renderGenerals();
    el<HTMLInputElement>('custom-rosters-name').focus();
  }
  async function save(use: boolean) {
    const epoch = permissionEpoch;
    requireWritable(epoch);
    const name = el<HTMLInputElement>('custom-rosters-name').value.trim();
    if (!name) throw new Error('请先填写将池名称，当前草稿仍保留。');
    if (!selected.size) throw new Error('至少选择一名武将才能保存。');
    let summary = current;
    if (dirty || !summary) {
      const result = await options.request<{ roster: CustomRosterSummary }>(
        `/api/rooms/${options.room().code}/rosters${summary ? `/${encodeURIComponent(summary.id)}` : ''}`,
        summary ? 'PUT' : 'POST',
        {
          name,
          basePreset,
          characters: [...selected],
          ...(summary ? { expectedRevision: summary.revision } : {}),
        },
      );
      summary = result.roster;
      current = summary;
      dirty = false;
      saveState = `已保存第 ${summary.revision} 版；点击“用于本房间”才会更换当前名单。`;
      el('custom-rosters-draft').textContent = saveState;
      await readIndex();
    }
    requireWritable(epoch);
    if (use) {
      await options.apply(summary);
      dialog.close();
    } else status('名单已保存。房间仍使用原来选定的版本。');
  }
  entry.onclick = () => {
    if (!dialog.open) dialog.showModal();
    void task(async () => {
      await options.flush();
      requireWritable();
      if (!dialog.open) dialog.showModal();
      await readIndex();
      catalog = await loadRosterCatalog();
      if (editor) renderGenerals();
      status(editor ? '保留上次未完成的草稿。' : '复制内置或他人的名单，也可以从空白新建。');
    });
  };
  el('custom-rosters-close').onclick = () => dialog.close();
  el('custom-rosters-back').onclick = () => {
    if (dirty && !confirm('返回列表会放弃这份未保存修改，确定返回？')) return;
    editor = false;
    dirty = false;
    el('custom-rosters-editor').hidden = true;
    el('custom-rosters-library').hidden = false;
    status('选择一份将池，或新建自己的名单。');
    renderLibrary();
  };
  el('custom-rosters-new').onclick = () => begin('', options.room().settings.generalPreset, []);
  el('custom-rosters-copy-built-in').onclick = () =>
    void task(async () => {
      requireWritable();
      const data = await source(el<HTMLSelectElement>('custom-rosters-copy-preset').value);
      begin(`${data.name}（副本）`, data.basePreset, data.characters);
    });
  el('custom-rosters-archived').onchange = renderLibrary;
  el('custom-rosters-name').oninput = changed;
  const filterChanged = () => {
    visibleLimit = 48;
    renderGenerals();
  };
  el('custom-rosters-query').oninput = filterChanged;
  el('custom-rosters-faction').onchange = filterChanged;
  el('custom-rosters-selected').onchange = filterChanged;
  for (const [id, add] of [
    ['custom-rosters-select-results', true],
    ['custom-rosters-remove-results', false],
  ] as const)
    el(id).onclick = () => {
      if (!editable()) return;
      const results = matches();
      if (!confirm(`${add ? '加入' : '移除'}当前搜索结果的 ${results.length} 个原生版本？`)) return;
      for (const general of results)
        if (add) selected.add(general.id);
        else selected.delete(general.id);
      changed();
      renderGenerals();
    };
  for (const [id, add] of [
    ['custom-rosters-batch-add', true],
    ['custom-rosters-batch-remove', false],
  ] as const)
    el(id).onclick = () =>
      void task(async () => {
        const epoch = permissionEpoch;
        requireWritable(epoch);
        const data = await source(el<HTMLSelectElement>('custom-rosters-batch-source').value);
        requireWritable(epoch);
        if (
          !confirm(
            `${add ? '加入' : '移除'}“${data.name}”的 ${data.characters.length} 个原生版本？规则继承档位不变。`,
          )
        )
          return;
        for (const id of data.characters)
          if (add) selected.add(id);
          else selected.delete(id);
        changed();
        renderGenerals();
        status('名单已修改，请保存。');
      });
  el('custom-rosters-save').onclick = () => void task(() => save(false));
  el('custom-rosters-save-use').onclick = () => void task(() => save(true));
  // Capability detection keeps old services usable while newer assets are built.
  void fetch('/api/rosters', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return;
      index = (await response.json()) as RosterIndex;
      supported = true;
      entry.hidden = false;
      syncControls();
    })
    .catch(() => {});
  return {
    update() {
      if (previousWritable !== options.writable()) permissionEpoch++;
      previousWritable = options.writable();
      entry.hidden = !supported;
      syncControls();
    },
  };
}
