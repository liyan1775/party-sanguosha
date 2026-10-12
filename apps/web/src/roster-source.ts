import { GENERAL_PRESETS } from '../../../packages/shared/src/contracts.js';

/** Show the reviewed edition and omissions beside the selected roster. */
export function renderRosterSource(container: HTMLElement, presetId: string): void {
  if (container.dataset.preset === presetId) return;
  container.dataset.preset = presetId;
  container.replaceChildren();
  const preset = GENERAL_PRESETS.find((entry) => entry.id === presetId);
  container.hidden = !preset?.official;
  if (!preset?.official) return;
  const source = preset.official;
  const line = document.createElement('p');
  line.className = 'hint';
  line.append(
    `${source.platform} · ${source.sourceKind === 'public-client-directory' ? '目录读取' : '公告'} ${source.publishedAt} · 已导入 ${preset.characterCount}/${source.announcedCount} 将 · `,
  );
  const link = document.createElement('a');
  link.textContent = source.sourceKind === 'public-client-directory' ? '目录来源' : '官方名单';
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  line.append(link);
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = `${source.versionNotes.join('')}使用本项目四种玩法和军争160张牌；只导入将池。`;
  container.append(line, note);
  if (source.missingGenerals.length) {
    const details = document.createElement('details');
    details.className = 'hint';
    const summary = document.createElement('summary');
    summary.textContent = `查看缺少的 ${source.missingGenerals.length} 名武将`;
    const names = document.createElement('p');
    names.textContent = source.missingGenerals.join('、');
    details.append(summary, names);
    container.append(details);
  }
}
