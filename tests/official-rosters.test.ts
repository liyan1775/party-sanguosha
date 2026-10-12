import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GENERAL_PRESETS } from '../packages/shared/src/contracts.js';
const read = async (path: string) =>
  JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const official = await read('config/official-rosters.json');
const presets = (await read('config/roster-presets.json')).presets;
const catalog = (await read('config/general-catalog.json')).characters;
const inventory = (await read('config/native-character-inventory.json')).characters;
const candidate = await read('config/noname-candidate.json');
const audio = await read('config/noname-lab-assets.json');

test('官方公告全部逐项保留，缺项不进白名单；前后端、图鉴、固定引擎来源一致', () => {
  assert.equal(official.engine.commit, candidate.commit);
  assert.equal(official.engine.tag, candidate.tag);
  assert.equal(official.rosters.length, 10);
  assert.equal(presets.length, GENERAL_PRESETS.length);
  const counts: Record<string, [number, number]> = {
    'ol-doudizhu-s15': [92, 92],
    'mobile-college-2026': [63, 66],
    'mobile-qunxiong-2026-09': [83, 88],
    'decade-quanmin-s19': [90, 90],
    'mobile-qunxiong-12': [120, 120],
    'mobile-qunxiong-16': [119, 120],
    'ol-ranked-2026-10-basic': [147, 151],
    'ol-ranked-2026-10-full': [284, 288],
    'ol-sgl-2026-stage1': [83, 83],
    'mobile-time-field-2026-10': [258, 326],
  };
  for (const roster of official.rosters) {
    const native = presets.find((preset: any) => preset.id === roster.id);
    const publicInfo = GENERAL_PRESETS.find((preset) => preset.id === roster.id)!;
    const mapped = roster.entries.filter((entry: any) => entry.nativeId);
    const missing = roster.entries.filter((entry: any) => !entry.nativeId);
    assert.deepEqual([mapped.length, roster.entries.length], counts[roster.id]);
    assert.equal(roster.entries.length, roster.announcedCount);
    assert.equal(new Set(native.characters).size, mapped.length);
    assert.deepEqual(
      native.characters,
      mapped.map((entry: any) => entry.nativeId),
    );
    assert.deepEqual(
      catalog.filter((entry: any) => entry.preset === roster.id).map((entry: any) => entry.id),
      native.characters,
    );
    assert.equal(native.characterOverrides, undefined);
    assert.deepEqual(native.completePacks, []);
    assert.equal(publicInfo.characterCount, mapped.length);
    assert.equal(publicInfo.official?.announcedCount, roster.announcedCount);
    assert.equal(publicInfo.official?.url, roster.source.url);
    assert.equal(new URL(roster.source.url).protocol, 'https:');
    assert.deepEqual(
      publicInfo.official?.missingGenerals,
      missing.map((entry: any) => entry.officialName),
    );
    for (const entry of missing) {
      assert(entry.reason && entry.source && Array.isArray(entry.rejectedIds));
      if (!entry.rejectedIds.length) {
        assert.match(entry.reason, /未收录|没有/);
        assert(
          !inventory.some(
            (item: any) => item.name.replace(/^(?:OL|界|谋)/g, '') === entry.officialName,
          ),
        );
      }
      assert(
        entry.rejectedIds.every((id: string) => inventory.some((item: any) => item.id === id)),
      );
    }
    for (const entry of mapped) {
      const character = inventory.find((item: any) => item.id === entry.nativeId);
      assert.equal(character.pack, entry.nativePack);
      assert.equal(character.name, entry.nativeName);
      assert.deepEqual(
        character.skills.map((skill: any) => skill.id),
        entry.nativeSkills,
      );
      assert(native.enabledPacks.includes(entry.nativePack));
      assert(native.definitionPacks.characters.includes(entry.nativePack));
    }
  }
  const equip = catalog
    .find((entry: any) => entry.preset === 'ol-doudizhu-s15' && entry.id === 'shen_dianwei')
    .skills.find((skill: any) => skill.id === 'qiexie');
  assert.match(equip.description, /不具有花色和点数/);
  assert.match(equip.description, /攻击范围等于/);
  assert.match(equip.description, /放回武将牌堆/);
  const decadeGuide = catalog.filter((entry: any) => entry.preset === 'decade-quanmin-s19');
  assert.equal(decadeGuide.find((entry: any) => entry.id === 'zhanghuai').skills[0].name, '劳燕');
  const book = decadeGuide.find((entry: any) => entry.id === 're_nanhualaoxian');
  assert(book.skills.some((skill: any) => skill.name === '阴兵（关联技能）'));
  assert(!JSON.stringify(catalog).includes('【skill:'));
  assert.deepEqual(audio.portraitVariants.ol_sb_dongzhuo, [
    'ol_sb_dongzhuo_shadow1',
    'ol_sb_dongzhuo_shadow2',
  ]);
  for (const variants of Object.values(audio.portraitVariants) as string[][])
    assert(
      variants.every((id) =>
        audio.assets.some((asset: any) => asset.path === `image/character/${id}.jpg`),
      ),
    );
  for (const preset of presets) {
    const files: string[] = audio.audioFilesByPreset[preset.id];
    assert(files.length && new Set(files).size === files.length);
    assert(
      files.every((file) => audio.assets.some((asset: any) => asset.path === `audio/${file}`)),
    );
  }
});

test('10月完整池严格包含基础池，公告重复名去重，SGL两张原图均保留', () => {
  const basic = official.rosters.find((roster: any) => roster.id === 'ol-ranked-2026-10-basic');
  const full = official.rosters.find((roster: any) => roster.id === 'ol-ranked-2026-10-full');
  assert.equal(basic.entries.filter((entry: any) => entry.officialName === '许褚').length, 1);
  assert.match(basic.note, /许褚.*重复|重复.*许褚/);
  assert.equal(full.entries.length - basic.entries.length, 137);
  for (const entry of basic.entries)
    assert.deepEqual(
      full.entries.find((item: any) => item.officialName === entry.officialName),
      entry,
    );
  const sgl = official.rosters.find((roster: any) => roster.id === 'ol-sgl-2026-stage1');
  assert.equal(sgl.source.rosterImages.length, 2);
  assert(sgl.source.rosterImages.every((url: string) => new URL(url).protocol === 'https:'));
  for (const roster of [basic, full, sgl]) {
    const preset = presets.find((item: any) => item.id === roster.id);
    assert.equal(preset.cardPile.cardCount, 160);
    assert.deepEqual(preset.cardPile.excludedCards, ['muniu']);
    const zhangxiu = roster.entries.find((entry: any) => entry.officialName === '张绣');
    assert.equal(zhangxiu.nativeId, 'zhangxiu');
    assert.match(zhangxiu.versionNote, /踞襄/);
  }
});

test('同名的平台版本分别固定，OL谋将、马良、羊祜与移动版版本不能串用', () => {
  const id = (preset: string, name: string) =>
    official.rosters
      .find((r: any) => r.id === preset)
      .entries.find((e: any) => e.officialName === name)?.nativeId;
  assert.equal(id('ol-doudizhu-s15', '谋关羽'), 'ol_sb_guanyu');
  assert.equal(id('ol-doudizhu-s15', '刘焉'), 'liuyan');
  assert.equal(id('ol-doudizhu-s15', '界徐盛'), 're_xusheng');
  assert.equal(id('ol-doudizhu-s15', '张绣'), 'zhangxiu');
  const zhangxiu = catalog.find(
    (entry: any) => entry.preset === 'ol-doudizhu-s15' && entry.id === 'zhangxiu',
  );
  assert.deepEqual(
    zhangxiu.skills.map((skill: any) => skill.id),
    ['drlt_xiongluan', 'drlt_congjian', 'twjuxiang'],
  );
  assert.match(zhangxiu.skills[2].description, /主公技/);
  const olPreset = presets.find((preset: any) => preset.id === 'ol-doudizhu-s15');
  assert(olPreset.definitionPacks.characters.includes('tw'));
  assert(!olPreset.enabledPacks.includes('tw'));
  assert.match(
    GENERAL_PRESETS.find((preset) => preset.id === 'ol-doudizhu-s15')!.official.versionNotes.find(
      (note) => note.includes('张绣'),
    )!,
    /张绣.*踞襄/,
  );
  const xusheng = catalog.find(
    (entry: any) => entry.preset === 'ol-doudizhu-s15' && entry.id === 're_xusheng',
  );
  assert.deepEqual(
    xusheng.skills.map((skill: any) => skill.id),
    ['repojun'],
  );
  assert.match(xusheng.skills[0].description, /当前回合结束时获得这些牌/);
  assert.match(xusheng.skills[0].description, /手牌数和装备区内的牌数均不大于你/);
  assert.match(xusheng.skills[0].description, /此伤害\+1/);
  assert.equal(id('ol-doudizhu-s15', '谋卢植'), 'ol_sb_yl_luzhi');
  assert.equal(id('mobile-qunxiong-12', '谋卢植'), 'sb_yl_luzhi');
  assert.equal(id('ol-doudizhu-s15', '马良'), 'ol_maliang');
  assert.equal(id('mobile-college-2026', '马良'), 'maliang');
  assert.equal(id('ol-doudizhu-s15', '羊祜'), 'jin_yanghu');
  assert.equal(id('mobile-qunxiong-16', '羊祜'), 'sp_yanghu');
  assert.equal(id('mobile-qunxiong-16', '文钦'), 'mb_wenqin');
  assert.equal(id('decade-quanmin-s19', '谋吕蒙'), 'dc_sb_lvmeng');
  assert.equal(id('mobile-qunxiong-12', '谋吕蒙'), 'sb_lvmeng');
  assert.equal(id('ol-doudizhu-s15', '界于禁'), undefined);
  assert.equal(id('mobile-college-2026', '界于禁'), 'ol_yujin');
  assert.equal(id('decade-quanmin-s19', '界于禁'), 'yujin_yujin');
  assert.equal(id('decade-quanmin-s19', '淳于琼'), 're_chunyuqiong');
  for (const roster of official.rosters) {
    const ids = roster.entries.filter((e: any) => e.nativeId).map((e: any) => e.nativeId);
    if (roster.platform === 'ol')
      assert(!ids.includes('sb_guanyu') && !ids.includes('dc_sb_guanyu'));
    if (roster.entries.some((entry: any) => entry.officialName === '刘协'))
      assert(ids.includes('liuxie'));
    if (roster.entries.some((entry: any) => entry.officialName === '张绣'))
      assert(ids.includes('zhangxiu'));
    assert(
      !ids.includes('tw_wangchang') && !ids.includes('jsrg_yangqiu') && !ids.includes('dc_yuejiu'),
    );
    assert(
      !ids.includes('friend_xushu') &&
        !ids.includes('hefei_zhangliao') &&
        !ids.includes('hefei_lidian') &&
        !ids.includes('pot_chendao'),
    );
  }
});

test('名称及额外主公技不阻止相同非主公技能入池，时光场保留固定目录及差异原因', async () => {
  for (const roster of official.rosters.filter((r: any) => r.platform === 'ol')) {
    const huangzhong = roster.entries.find((e: any) => e.officialName === '界黄忠');
    if (huangzhong) {
      assert.equal(huangzhong.nativeId, 're_huangzhong');
      assert.equal(huangzhong.nativeName, '黄忠');
      assert.deepEqual(huangzhong.nativeSkills, ['xinliegong']);
    }
    const sunjian = roster.entries.find((e: any) => e.officialName === '界孙坚');
    if (sunjian) assert.deepEqual(sunjian.nativeSkills, ['gzyinghun', 'wulie', 'twpolu']);
  }
  const roster = official.rosters.find((r: any) => r.id === 'mobile-time-field-2026-10');
  const research = await read('config/research/mobile-time-field-2026-10.json');
  assert.equal(research.runtimeRoster, roster.id);
  assert.equal(roster.source.kind, 'public-client-directory');
  assert.equal(roster.source.packedConfigVersion, research.source.packedConfigVersion);
  assert.deepEqual(
    roster.entries.map((e: any) => e.officialId),
    research.entries.map((e: any) => e.officialId),
  );
  const byName = (name: string) => roster.entries.find((e: any) => e.officialName === name);
  assert.equal(byName('蒯越蒯良').nativeId, 'kuailiangkuaiyue');
  assert.equal(byName('伏皇后').nativeId, 'fuhuanghou');
  assert.equal(byName('界黄忠').nativeId, 're_huangzhong');
  assert.equal(byName('黄忠').nativeId, 'huangzhong');
  assert.equal(byName('左慈').nativeId, 'zuoci');
  assert(!byName('界吕蒙').nativeId);
  assert.match(byName('界吕蒙').reason, /非主公技/);
  assert(!byName('凌操').nativeId);
  assert.match(byName('凌操').reason, /取整/);
  assert(
    !byName('刘繇').nativeId,
    'an additional lord skill cannot excuse a different non-lord skill',
  );
});
