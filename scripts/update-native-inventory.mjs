// Inventory the pinned core without executing third-party character/skill code.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import { readNativeData, literal } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { candidate, packs } = await readNativeData(root, { allPacks: true });
const engine = resolve(root, `.local/noname/${candidate.tag}`);
async function assignedObject(path, name) {
  const ast = ts.createSourceFile(
    path,
    await readFile(resolve(engine, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  for (const statement of ast.statements)
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.left.getText() === name &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      return literal(statement.expression.right);
  throw new Error(`Missing pinned assignment ${name}`);
}
const packageNames = (await assignedObject('game/package.js', 'window.noname_package')).character;
const nativeRank = await assignedObject('character/rank.js', 'window.noname_character_rank');
const rank = new Map();
for (const [tier, ids] of Object.entries(nativeRank))
  if (Array.isArray(ids))
    for (const id of ids)
      if (!rank.has(id)) rank.set(id, tier.toUpperCase().replace('P', '+').replace('M', '−'));
const plain = (text) =>
  String(text ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
const factions = { wei: '魏', shu: '蜀', wu: '吴', qun: '群', jin: '晋', shen: '神', key: 'Key' };
const characters = [];
const summaries = [];
const sharedTranslations = Object.assign(
  {},
  ...[...packs.values()].map((data) => data.translates?.values ?? {}),
);
for (const [pack, data] of packs) {
  const translations = { ...sharedTranslations, ...data.translates?.values };
  const grouped = new Map();
  for (const [id, group] of Object.entries(data.characterSort?.values ?? {}))
    if (Array.isArray(group))
      for (const character of group) {
        if (!grouped.has(character)) grouped.set(character, []);
        grouped.get(character).push({ id, name: data.characterSortTranslate?.values[id] ?? id });
      }
  const entries = Object.entries(data.characters?.values ?? {});
  summaries.push({ id: pack, name: packageNames[pack] ?? pack, count: entries.length });
  for (const [id, character] of entries) {
    if (!character || (character.skills !== undefined && !Array.isArray(character.skills)))
      throw new Error(`Nonliteral character ${pack}/${id}`);
    const hp =
      character.hp === (character.maxHp ?? character.hp)
        ? String(character.hp)
        : `${character.hp}/${character.maxHp}`;
    characters.push({
      id,
      name: plain(translations[id] ?? id),
      pack,
      group: character.group,
      hp,
      ...(character.hujia ? { armor: character.hujia } : {}),
      groups: grouped.get(id) ?? [],
      skills: (character.skills ?? []).map((skill) => ({
        id: skill,
        name: plain(translations[skill] ?? skill),
      })),
      ...(character.isUnseen ? { isUnseen: true } : {}),
      nativeRank: rank.get(id) ?? null,
      source: `character/${pack}.js`,
    });
  }
}
const unique = new Set(characters.map((c) => c.id)).size;
const inventory = {
  source: {
    repository: candidate.repository,
    tag: candidate.tag,
    commit: candidate.commit,
    license: 'GPL-3.0-only',
  },
  scope: '普通武将包；不同版本按原生ID分别计数，不含模式专用角色或用户扩展',
  nativeRankNote: '上游rank.js的一般强度标记，只是辅助参考，不是四模式胜率或本项目分档结论',
  packCount: summaries.length,
  entryCount: characters.length,
  uniqueIdCount: unique,
  packs: summaries,
  characters,
};
await writeFile(
  resolve(root, 'config/native-character-inventory.json'),
  JSON.stringify(inventory, null, 2) + '\n',
);
const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  '# 无名杀原生武将清单',
  '',
  `本项目固定 ${candidate.tag}，commit \`${candidate.commit}\`。按固定核心的 \`character/*.js\` 静态提取，共 **${summaries.length} 个普通武将包、${characters.length} 个版本条目、${unique} 个不同原生 ID**。同一人物的标准、界、OL、移动、新杀、旧版等分别列出。`,
  '',
  '这里只列无名杀已经提供的武将，不修改技能，也不启用新的产品将池。含包内隐藏/变身形态，不能把每个条目都视作普通可选武将。挑战、国战等模式专用角色及外装扩展不在本清单内；本项目后续分池先从这些普通包选择。技能名称与包名直接读取上游，名称缺项时保留原生技能 ID。',
  '',
  '上游参考强度来自同一 commit 的 `character/rank.js`，依次为 S、A+、A、A−、B+、B、B−、C、D；“未标”表示未收录。它不是四种模式的实测胜率，也不是本项目已经决定的分档。下一轮仍需分别比较身份、斗地主、2v2、单挑，任何按强弱移除的武将先由用户判断。',
  '',
  '来源：[固定上游源码](https://github.com/libnoname/noname/tree/' +
    candidate.commit +
    '/apps/core/character)。复现：`npm run engine:update-inventory`。结构化数据在 `config/native-character-inventory.json`；列表存在不代表素材、隐私和四模式已经验收。',
  '',
  '## 武将包总览',
  '',
  '| 原生武将包 | 包 ID | 版本数 |',
  '| --- | --- | ---: |',
  ...summaries.map((p) => `| [${p.name}](#包-${p.id.toLowerCase()}) | ${p.id} | ${p.count} |`),
  '',
];
for (const pack of summaries) {
  lines.push(
    `<a id="包-${pack.id.toLowerCase()}"></a>`,
    '',
    `## ${pack.name}（${pack.id}，${pack.count} 个版本）`,
    '',
    '| 武将名称 | 原生 ID | 势力 | 体力 / 上限 | 原生技能 | 上游参考强度 |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const c of characters.filter((c) => c.pack === pack.id))
    lines.push(
      `| ${escape(c.name)}${c.isUnseen ? '（隐藏形态）' : ''} | ${c.id} | ${factions[c.group] ?? c.group} | ${c.hp}${c.armor ? `，${c.armor}护甲` : ''} | ${escape(c.skills.map((s) => s.name).join('、')) || '无'} | ${c.nativeRank ?? '未标'} |`,
    );
  lines.push('');
}
await writeFile(resolve(root, 'docs/noname-characters.md'), lines.join('\n'));
console.log(
  `Native inventory: ${summaries.length} packs, ${characters.length} entries, ${unique} unique IDs.`,
);
