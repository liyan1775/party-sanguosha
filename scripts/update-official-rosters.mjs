import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = async (path) => JSON.parse(await readFile(`${root}/${path}`, 'utf8'));
const official = await read('config/official-rosters.json');
const candidate = await read('config/noname-candidate.json');
const inventory = (await read('config/native-character-inventory.json')).characters;
const settings = await read('config/roster-presets.json');
assert.equal(official.engine.commit, candidate.commit);
assert.equal(official.engine.tag, candidate.tag);
const base = settings.presets.filter((preset) => ['beginner', 'advanced'].includes(preset.id));
assert.equal(base.length, 2);
const military = base.find((preset) => preset.id === 'advanced').cardPile;
const advanced = base.find((preset) => preset.id === 'advanced');
const metadata = [
  {
    id: 'beginner',
    name: '标准包27将',
    description: '经典25将 + 华雄 + 原生旧袁术，保留无名杀自带技能',
    cardPile: '标准108张',
    characterCount: 27,
    official: null,
  },
  {
    id: 'advanced',
    name: advanced.name,
    description: `熟悉的界武将与经典扩展，共${advanced.characters.length}将，保留无名杀自带技能`,
    cardPile: '军争160张（去木牛流马），加入火/雷杀、酒、火攻、铁索、兵粮等',
    characterCount: advanced.characters.length,
    official: null,
  },
];
const presets = [...base];
const summary = [];
const sections = [];
for (const roster of official.rosters) {
  assert.equal(roster.entries.length, roster.announcedCount, `${roster.id}: announcement count`);
  assert.equal(
    new Set(roster.entries.map((entry) => entry.officialName)).size,
    roster.entries.length,
  );
  const present = roster.entries.filter((entry) => entry.nativeId);
  const missing = roster.entries.filter((entry) => !entry.nativeId);
  const characters = present.map((entry) => entry.nativeId);
  assert.equal(new Set(characters).size, characters.length, `${roster.id}: native duplicates`);
  for (const entry of present) {
    const native = inventory.find((character) => character.id === entry.nativeId);
    assert(native, `${roster.id}: missing native ${entry.nativeId}`);
    assert.equal(native.pack, entry.nativePack);
    assert.equal(native.name, entry.nativeName);
    assert.deepEqual(
      native.skills.map((skill) => skill.id),
      entry.nativeSkills,
    );
  }
  for (const entry of missing) assert(entry.reason && entry.rejectedIds && entry.source);
  const enabledPacks = [...new Set(present.map((entry) => entry.nativePack))];
  // Preserve reviewed dependency-only packs when regenerating the whitelist.
  const existing = settings.presets.find((preset) => preset.id === roster.id);
  const definitionPacks = {
    characters: [
      ...new Set(['standard', ...enabledPacks, ...(existing?.definitionPacks.characters ?? [])]),
    ],
    cards: existing?.definitionPacks.cards ?? ['standard', 'extra', 'zhulu'],
  };
  presets.push({
    id: roster.id,
    name: roster.name,
    officialRoster: roster.id,
    cardPile: structuredClone(military),
    completePacks: [],
    packGroups: {},
    additionalCharacters: [],
    enabledPacks,
    definitionPacks,
    characters,
  });
  metadata.push({
    id: roster.id,
    name: roster.name,
    description: `${roster.platformName}${roster.source.kind === 'public-client-directory' ? '公开客户端固定目录' : '官方活动将池'}，已导入 ${present.length}/${roster.announcedCount} 将${missing.length ? `；缺少：${missing.map((entry) => entry.officialName).join('、')}` : ''}。沿用本项目四种玩法。`,
    cardPile: military.name,
    characterCount: present.length,
    official: {
      platform: roster.platformName,
      sourceKind: roster.source.kind ?? 'announcement',
      eventMode: roster.eventMode,
      publishedAt: roster.source.publishedAt,
      url: roster.source.url,
      announcedCount: roster.announcedCount,
      missingGenerals: missing.map((entry) => entry.officialName),
      versionNotes:
        roster.versionNotes ??
        present.filter((entry) => entry.versionNote).map((entry) => entry.versionNote),
    },
  });
  summary.push(
    `| [${roster.name}](${roster.source.url}) | ${roster.source.publishedAt} | ${present.length}/${roster.announcedCount} | ${missing.map((entry) => entry.officialName).join('、') || '无'} |`,
  );
  const rows = roster.entries.map((entry) =>
    entry.nativeId
      ? `| ${entry.officialName.replace(/;/g, '')} | \`${entry.nativeId}\` | ${entry.nativePack} | ${inventory
          .find((c) => c.id === entry.nativeId)
          .skills.map((skill) => skill.name)
          .join(' / ')} |`
      : `| ${entry.officialName} | **缺项** | — | ${entry.reason} |`,
  );
  const notes = present
    .filter((entry) => entry.note)
    .map(
      (entry) =>
        `- ${entry.officialName} → \`${entry.nativeId}\`：${entry.note}${entry.source ? ` [版本依据](${entry.source})` : ''}`,
    );
  const gaps = missing.map(
    (entry) =>
      `- ${entry.officialName}：[平台技能依据](${entry.source})；${entry.rejectedIds.length ? `排除 \`${entry.rejectedIds.join('`、`')}\`` : '固定引擎无同名原生候选'}。`,
  );
  const rosterImages =
    roster.source.rosterImages ?? (roster.source.rosterImage ? [roster.source.rosterImage] : []);
  const imageLinks = rosterImages
    .map((url, index) => ` · [公告将池原图${rosterImages.length > 1 ? index + 1 : ''}](${url})`)
    .join('');
  sections.push(
    `## ${roster.name}\n\n[${roster.source.kind === 'public-client-directory' ? '公开客户端目录来源' : '官方公告'}](${roster.source.url})${imageLinks}；${roster.source.kind === 'public-client-directory' ? '读取于' : '发布于'} ${roster.source.publishedAt}。对应原活动${roster.eventMode === 'doudizhu' ? '斗地主' : '2v2'}，本项目可用于现有四模式。${roster.note ? `\n\n${roster.note}` : ''}\n\n| 公告／目录武将 | 原生ID | 定义包 | 原生技能 / 缺项原因 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n${notes.length || gaps.length ? `\n${[...notes, ...gaps].join('\n')}\n` : ''}`,
  );
}
await writeFile(
  `${root}/config/roster-presets.json`,
  JSON.stringify({ ...settings, presets }, null, 2) + '\n',
);
await writeFile(
  `${root}/packages/shared/src/general-presets.ts`,
  `// Generated by scripts/update-official-rosters.mjs from reviewed official IDs.\n// Shared metadata contains no Node imports or native rule definitions.\nexport const GENERAL_PRESETS = ${JSON.stringify(metadata, null, 2)} as const;\n\nexport type GeneralPresetId = (typeof GENERAL_PRESETS)[number]['id'];\n`,
);
await writeFile(
  `${root}/docs/official-rosters.md`,
  `# 官方活动将池核对\n\n核对日期：${official.reviewedAt}。固定无名杀 ${candidate.tag}，commit \`${candidate.commit}\`。\n\n按官方完整公告的名单导入已有原生角色，保留活动、平台、届次和年份。游戏平台版本必须对应：OL谋关羽使用 \`ol_sb_guanyu\`，不用手杀 \`sb_guanyu\` 或新杀 \`dc_sb_guanyu\`。别名、界字和原生ID前缀不能代替技能核对。无法对应的角色保留在公告清单中，但从可选白名单排除；不替换、不删技能、不自行实现角色，也不为此升级引擎。用户2026-10-12确认按非主公技能核对，名称可以不同，允许原生多出主公技；保留完整原生技能及主公标记。例如张绣保留踞襄，OL界孙坚保留破虏，OL界黄忠对应原生黄忠 \`re_huangzhong\`。大厅与图鉴显示具体版本提示。关联技能也参与核对，非主公机制不同仍列为缺项。\n\n只导入将池。本项目仍采用现有身份、斗地主、OL常规2v2和单武将单挑规则，新增档位使用军争160张（去木牛流马），不复刻赛事BP、报名、计分、换将道具或赛事专用牌堆。图鉴技能取固定引擎同版本文本，不能将本表理解为商业客户端所有历次技能修订的复刻。\n\n| 官方将池 | 公告日期 | 已导入 / 公告 | 缺项 |\n| --- | --- | --- | --- |\n${summary.join('\n')}\n\n持久依据为 [official-rosters.json](../config/official-rosters.json)，运行白名单为 [roster-presets.json](../config/roster-presets.json)。运行 \`npm run engine:update-official-rosters\` 可从已审查映射重建白名单、跨端说明和本文；原始下载页和图片仅在忽略的.local中保留过程副本，官方链接可重新获取。该生成器不会凭同名自动匹配武将。\n\n${sections.join('\n')}`,
);
console.log(
  `Official rosters: ${official.rosters.length} presets; ${metadata.reduce((sum, preset) => sum + preset.characterCount, 0)} guide entries.`,
);
