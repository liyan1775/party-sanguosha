import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const presets = JSON.parse(
  await readFile(new URL('config/roster-presets.json', root), 'utf8'),
).presets;
const catalog = JSON.parse(
  await readFile(new URL('config/general-catalog.json', root), 'utf8'),
).characters;
const inventory = JSON.parse(
  await readFile(new URL('config/native-character-inventory.json', root), 'utf8'),
).characters;
const source = await readFile(
  new URL('packages/noname-adapter/runtime/roster-policy.js', root),
  'utf8',
);
const { validateNativeRoster } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('两档原生白名单与图鉴一致，经典进阶96将完整保留原72个版本和顺序', () => {
  const beginner = presets.find((p: any) => p.id === 'beginner');
  const advanced = presets.find((p: any) => p.id === 'advanced');
  assert.equal(beginner.name, '标准包27将');
  assert.equal(advanced.name, '经典进阶96将');
  for (const [preset, size] of [
    [beginner, 27],
    [advanced, 96],
  ] as const) {
    assert.equal(new Set(preset.characters).size, size);
    assert.deepEqual(
      catalog.filter((c: any) => c.preset === preset.id).map((c: any) => c.id),
      preset.characters,
    );
    assert.equal(preset.characterOverrides, undefined);
  }
  // These historical IDs and their order are the user's preservation contract.
  // A same-name upgrade or regenerated pack ordering must not replace them.
  const preserved72 = [
    // The original 48.
    're_zhangliao',
    're_xuzhu',
    're_xiahoudun',
    're_zhenji',
    're_caozhang',
    're_guohuai',
    'caoren',
    'ol_xuhuang',
    're_caochong',
    're_caoxiu',
    're_wangyi',
    'caoang',
    'ol_dianwei',
    're_caopi',
    're_zhaoyun',
    're_guanyu',
    're_zhangfei',
    're_liubei',
    're_huangyueying',
    're_zhugeliang',
    'ol_weiyan',
    're_xushu',
    're_madai',
    're_guanping',
    'wangping',
    're_huangzhong',
    'yanyan',
    're_sunquan',
    're_zhouyu',
    're_luxun',
    're_daqiao',
    're_sunshangxiang',
    're_taishici',
    'xin_handang',
    'zhoutai',
    're_sunce',
    'ol_xiaoqiao',
    'ol_sunjian',
    'dingfeng',
    're_quancong',
    're_huatuo',
    're_diaochan',
    're_huaxiong',
    'ol_pangde',
    're_gongsunzan',
    're_jiaxu',
    're_jushou',
    'yanwen',
    // The first expansion, 48 to 72.
    're_xiahouyuan',
    'xunyu',
    're_zhangchunhua',
    'xunyou',
    'dengai',
    'zhonghui',
    'caorui',
    'yuejin',
    'jiangwei',
    'liushan',
    'guanzhang',
    'liufeng',
    'mayunlu',
    'mizhu',
    'xin_wuguotai',
    'bulianshi',
    'zhuran',
    'guyong',
    're_chengpu',
    'caiwenji',
    'chengong',
    'gaoshun',
    'liubiao',
    'hetaihou',
  ];
  assert.equal(preserved72.length, 72);
  assert.deepEqual(advanced.characters.slice(0, 72), preserved72);
  assert.deepEqual(advanced.characters.slice(72), [
    'dc_caozhi',
    'zhongyao',
    'chenqun',
    'haozhao',
    'simalang',
    'wangji',
    'menghuo',
    'ol_zhurong',
    'xin_fazheng',
    're_jianyong',
    're_zhoucang',
    'zhangsong',
    'xiahoushi',
    'guanyinping',
    'xin_xusheng',
    'zhuhuan',
    'yufan',
    'zhuzhi',
    'buzhi',
    'sp_zhangjiao',
    'xin_liru',
    'dongbai',
    'quyi',
    'sp_dongzhuo',
  ]);
  const names = new Set();
  for (const id of advanced.characters) {
    const native = inventory.find((item: any) => item.id === id);
    assert(native, id);
    assert(['B−', 'B'].includes(native.nativeRank), `${id}: strength screening boundary`);
    const name = native.name.replace(/^(?:界|OL|SP|新杀|手杀|旧|新|谋)+/, '');
    assert(!names.has(name), `${id}: duplicate person`);
    names.add(name);
  }
  for (const id of [
    'std_yuejin',
    'old_re_lidian',
    'ganfuren',
    'std_panfeng',
    'gongsunzan',
    'xf_yiji',
    're_yuanshu',
  ])
    assert(!beginner.characters.includes(id));
  assert(beginner.characters.includes('huaxiong') && beginner.characters.includes('ol_yuanshu'));
  for (const id of [
    'caoang',
    'dingfeng',
    'wangping',
    'yanyan',
    'yanwen',
    're_huangzhong',
    're_xiahouyuan',
    'xunyu',
    're_zhangchunhua',
    'xunyou',
    'dengai',
    'zhonghui',
    'caorui',
    'yuejin',
    'jiangwei',
    'liushan',
    'guanzhang',
    'liufeng',
    'mayunlu',
    'mizhu',
    'xin_wuguotai',
    'bulianshi',
    'zhuran',
    'guyong',
    're_chengpu',
    'caiwenji',
    'chengong',
    'gaoshun',
    'liubiao',
    'hetaihou',
  ])
    assert(advanced.characters.includes(id));
  for (const id of ['ol_huangzhong', 'ol_yanwen', 'dc_gongsunzan', 're_lvmeng'])
    assert(!advanced.characters.includes(id));
  assert.equal(
    advanced.characters.some((id: string) => id.startsWith('shen_')),
    false,
  );
  const yuan = catalog.find((c: any) => c.preset === 'beginner' && c.id === 'ol_yuanshu');
  assert.equal(yuan.name, '旧袁术');
  assert.deepEqual(
    yuan.skills.map((s: any) => s.id),
    ['wangzun', 'tongji'],
  );
});

test('原生将池检查保留武将、技能和素材对象，不复制或覆盖规则', () => {
  const skills = Object.freeze(['wangzun', 'tongji']);
  const character = Object.freeze({ hp: 4, skills, img: 'native-portrait' });
  const nativeSkills = Object.freeze({
    wangzun: Object.freeze({ native: true }),
    tongji: Object.freeze({ native: true }),
  });
  const lib = Object.freeze({
    character: Object.freeze({ ol_yuanshu: character }),
    skill: nativeSkills,
  });
  validateNativeRoster(lib, { characters: ['ol_yuanshu'] });
  assert.equal(lib.character.ol_yuanshu, character);
  assert.equal(character.skills, skills);
  assert.equal(lib.skill, nativeSkills);
});

test('不允许通过将池配置改技能；重复、缺失武将或缺失技能拒绝开局', () => {
  const lib = { character: { caocao: { skills: ['jianxiong'] } }, skill: { jianxiong: {} } };
  assert.throws(
    () => validateNativeRoster(lib, { characters: ['caocao'], characterOverrides: {} }),
    /不允许覆盖/,
  );
  assert.throws(() => validateNativeRoster(lib, { characters: ['caocao', 'caocao'] }), /重复/);
  assert.throws(() => validateNativeRoster(lib, { characters: ['missing'] }), /未启用/);
  assert.throws(
    () => validateNativeRoster({ ...lib, skill: {} }, { characters: ['caocao'] }),
    /缺少原生技能/,
  );
});
