// SPDX-License-Identifier: GPL-3.0-only
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import presets from '../config/roster-presets.json' with { type: 'json' };
import candidate from '../config/noname-candidate.json' with { type: 'json' };
import { NativeNonameService } from '../packages/noname-adapter/src/service.js';
import { customRosterDigest } from '../packages/noname-adapter/src/custom-roster-policy.js';
import { DoudizhuPreparation } from '../packages/noname-adapter/src/doudizhu-preparation.js';
import type { MatchSetup } from '../packages/noname-adapter/src/index.js';
import type { ResolvedCustomRoster } from '../packages/shared/src/contracts.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
function roster(characters = ['caocao', 're_zhangliao']): ResolvedCustomRoster {
  const value = {
    summary: {
      id: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      name: '混合原生池',
      basePreset: 'beginner' as const,
      characterCount: characters.length,
      archived: false,
    },
    characters,
    definitionPacks: {
      characters: ['standard', 'refresh', 'sp', 'old', 'shenhua', 'extra', 'yijiang', 'tw'],
      cards: ['standard', 'extra', 'zhulu'],
    },
    enabledPacks: ['standard', 'refresh'],
    engineCommit: candidate.commit,
  };
  return { ...value, digest: customRosterDigest(value) };
}
function setup(customRoster = roster()): MatchSetup {
  return {
    roomCode: 'ABCDEF',
    ownerPlayerId: 'owner',
    settings: {
      mode: 'duel',
      playerCount: 2,
      generalPreset: 'beginner',
      customRoster: { id: customRoster.summary.id, revision: customRoster.summary.revision },
      allowGeneralSelection: true,
      extensions: [],
    },
    customRoster,
    seats: [
      { id: 'owner', nickname: '房主', kind: 'human' },
      { id: 'bot', nickname: 'AI', kind: 'bot' },
    ],
    aiPolicy: 'strongest-native',
    generalSelections: { owner: customRoster.characters[0]! },
  };
}
async function fixture(t: TestContext) {
  const parent = resolve(projectRoot, '.runtime');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, 'custom-engine-'));
  for (const directory of ['config', 'dist/engine', '.local/noname/v1.11.6/game'])
    await mkdir(resolve(root, directory), { recursive: true });
  const bundle = 'export {};';
  await Promise.all([
    writeFile(resolve(root, 'config/noname-candidate.json'), JSON.stringify(candidate)),
    writeFile(resolve(root, 'config/roster-presets.json'), JSON.stringify(presets)),
    writeFile(
      resolve(root, 'config/noname-lab-assets.json'),
      JSON.stringify({
        commit: candidate.commit,
        assets: [],
        portraitAliases: {},
        audioFilesByPreset: {
          beginner: ['skill/caocao.mp3'],
          advanced: ['skill/re_zhangliao.mp3'],
        },
      }),
    ),
    writeFile(
      resolve(root, '.local/noname/v1.11.6/game/build-info.json'),
      JSON.stringify({ commit: candidate.commit }),
    ),
    writeFile(resolve(root, '.local/noname/v1.11.6/game/config.json'), '{}'),
    writeFile(resolve(root, 'dist/engine/noname.js'), bundle),
    writeFile(
      resolve(root, 'dist/engine/manifest.json'),
      JSON.stringify({
        commit: candidate.commit,
        hash: createHash('sha256').update(bundle).digest('hex'),
      }),
    ),
  ]);
  const engine = new NativeNonameService(root);
  const server = createServer((request, response) => {
    void engine.handle(request, response).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const jobs = await fetch(`${base}/engine/jobs`);
  const cookie = jobs.headers.get('set-cookie')!.split(';')[0]!;
  t.after(async () => {
    engine.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    assert(root.startsWith(resolve(parent, 'custom-engine-')));
    await rm(root, { recursive: true, force: true });
  });
  return { engine, base, cookie, root };
}

test('自定义将池使用原牌堆及legacy结构，深复制冻结且重连沿用同一候选白名单', async (t) => {
  const f = await fixture(t);
  const input = setup();
  const registered = structuredClone(input.customRoster!);
  f.engine.setRosterResolver(() => structuredClone(registered));
  void f.engine.start(input).catch(() => {});
  const id = f.engine.matchId(input.roomCode)!;
  const url = `${f.base}/engine/setup/${id}?role=worker`;
  const first = await (await fetch(url, { headers: { Cookie: f.cookie } })).json();
  assert.deepEqual(first.preset.characters, registered.characters);
  assert.deepEqual(first.preset.definitionPacks, registered.definitionPacks);
  assert.deepEqual(first.preset.enabledPacks, registered.enabledPacks);
  assert.deepEqual(first.preset.cardPile, presets.presets[0]!.cardPile);
  assert.deepEqual(first.preset.completePacks, presets.presets[0]!.completePacks);
  assert.deepEqual(first.preset.packGroups, {});
  assert.deepEqual(first.preset.additionalCharacters, []);
  assert(first.audioFiles.includes('skill/caocao.mp3'));
  assert(first.audioFiles.includes('skill/re_zhangliao.mp3'));
  input.customRoster!.characters[0] = 'sunquan';
  input.customRoster!.definitionPacks.characters.length = 0;
  input.generalSelections!.owner = 'sunquan';
  assert.deepEqual(await (await fetch(url, { headers: { Cookie: f.cookie } })).json(), first);
  const frozen = (
    f.engine as unknown as {
      matches: Map<string, { preset: { characters: string[] }; setup: MatchSetup }>;
    }
  ).matches.get(id)!;
  assert(Object.isFrozen(frozen.preset));
  assert(Object.isFrozen(frozen.preset.characters));
  assert(Object.isFrozen(frozen.setup.customRoster!.definitionPacks.characters));
  assert.deepEqual(presets.presets[0]!.characters.slice(0, 2), ['caocao', 'simayi']);
});

test('错commit、digest、引用、未接入ID、额外字段和池外点将不能替换已有局', async (t) => {
  const f = await fixture(t);
  void f.engine.start(setup()).catch(() => {});
  const id = f.engine.matchId('ABCDEF');
  for (const mutate of [
    (s: MatchSetup) => {
      s.customRoster!.engineCommit = '0'.repeat(40);
    },
    (s: MatchSetup) => {
      s.customRoster!.digest = '0'.repeat(64);
    },
    (s: MatchSetup) => {
      s.customRoster!.definitionPacks.characters = ['standard', 'refresh'];
      s.customRoster!.digest = customRosterDigest(s.customRoster!);
    },
    (s: MatchSetup) => {
      s.customRoster!.enabledPacks = ['standard'];
      s.customRoster!.digest = customRosterDigest(s.customRoster!);
    },
    (s: MatchSetup) => {
      s.settings.customRoster!.revision++;
    },
    (s: MatchSetup) => {
      s.customRoster!.characters[0] = 'unknown';
      s.customRoster!.digest = customRosterDigest(s.customRoster!);
    },
    (s: MatchSetup) => {
      Reflect.set(s.customRoster!, 'ownerHash', 'forbidden');
    },
    (s: MatchSetup) => {
      s.generalSelections!.owner = 'sunquan';
    },
    (s: MatchSetup) => {
      s.customRoster!.summary.basePreset = 'advanced';
      s.customRoster!.digest = customRosterDigest(s.customRoster!);
    },
    (s: MatchSetup) => {
      s.settings.mode = 'college';
    },
  ]) {
    const input = setup();
    mutate(input);
    await assert.rejects(f.engine.start(input));
    assert.equal(f.engine.matchId('ABCDEF'), id);
  }
  const changed = roster(['caocao', 'sunquan']);
  f.engine.setRosterResolver(() => changed);
  await assert.rejects(f.engine.start(setup()), /快照/);
  assert.equal(f.engine.matchId('ABCDEF'), id);
});

test('preload无需重启即可解析登记池并加载跨池依赖，拒绝引用、参数和继承档不匹配', async (t) => {
  const f = await fixture(t);
  let saved: ResolvedCustomRoster | undefined;
  f.engine.setRosterResolver((id, revision) => {
    if (!saved || saved.summary.id !== id || saved.summary.revision !== revision)
      throw new Error('missing');
    return structuredClone(saved);
  });
  const query = `roster=${roster().summary.id}&revision=1`;
  assert.equal((await fetch(`${f.base}/engine/preload?preset=beginner&${query}`)).status, 400);
  saved = roster();
  const response = await fetch(`${f.base}/engine/preload?preset=beginner&mode=duel&${query}`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert(manifest.assets.some((path: string) => path.endsWith('/character/tw.js')));
  assert(manifest.assets.some((path: string) => path.endsWith('/card/zhulu.js')));
  assert(manifest.assets.some((path: string) => path.endsWith('/audio/skill/re_zhangliao.mp3')));
  for (const suffix of [
    `preset=advanced&${query}`,
    `preset=beginner&mode=college&${query}`,
    `roster=${saved.summary.id}`,
    'revision=1',
    `${query}&revision=2`,
    query.replace('revision=1', 'revision=1.0'),
    query.replace('revision=1', 'revision=9007199254740992'),
  ])
    assert.equal((await fetch(`${f.base}/engine/preload?${suffix}`)).status, 400);
  saved.summary.archived = true;
  assert.equal((await fetch(`${f.base}/engine/preload?${query}`)).status, 400);
});

test('斗地主准备候选和点将只来自自定义池，并预留22名原有候选；高校拒绝自定义池', async () => {
  const characters = presets.presets[0]!.characters.slice(0, 22);
  const input = setup(roster(characters));
  input.settings.mode = 'doudizhu';
  input.settings.playerCount = 3;
  input.seats.push({ id: 'bot2', nickname: 'AI2', kind: 'bot' });
  const preparation = new DoudizhuPreparation(input, 0, () => {});
  void preparation.result.catch(() => {});
  const initial = preparation.privateState('owner');
  assert.equal(initial.seats[0]!.candidates.length, 6);
  assert(initial.seats[0]!.candidates.includes('caocao'));
  assert(initial.seats[0]!.candidates.every((id) => characters.includes(id)));
  preparation.action('owner', {
    id: preparation.id,
    phaseId: initial.preparation.phaseId,
    seatId: 'owner',
    revision: 0,
    action: 'bid',
    bid: 3,
  });
  assert.equal(preparation.privateState('owner').seats[0]!.candidates.length, 10);
  preparation.cancel();
  assert.throws(
    () =>
      new DoudizhuPreparation(
        { ...input, customRoster: roster(characters.slice(0, 21)) },
        0,
        () => {},
      ),
    /不足/,
  );
  assert.throws(
    () =>
      new DoudizhuPreparation(
        { ...input, settings: { ...input.settings, mode: 'college' } },
        0,
        () => {},
      ),
    /固定高校将池/,
  );
});

test('单挑2将、2v2共享20将仍沿用原候选规则；身份全主公池给出可操作失败信息', async (t) => {
  const descriptors = [
    Object.getOwnPropertyDescriptor(globalThis, 'customChoiceFixture'),
    Object.getOwnPropertyDescriptor(Array.prototype, 'randomRemove'),
  ];
  const players = Array.from({ length: 5 }, (_, i) => ({
    playerid: `p${i}`,
    side: i === 0 || i === 3,
  }));
  const pool = presets.presets[0]!.characters.slice(0, 20);
  const lib = {
    character: Object.fromEntries(pool.map((name) => [name, { isZhugong: true }])),
    sort: { character: (a: string, b: string) => a.localeCompare(b) },
  };
  Reflect.set(globalThis, 'customChoiceFixture', {
    lib,
    game: { players, zhu: players[0] },
    get: {},
    _status: {},
  });
  Object.defineProperty(Array.prototype, 'randomRemove', {
    configurable: true,
    value(this: unknown[], count: number) {
      return this.splice(0, count);
    },
  });
  t.after(() => {
    for (const [index, [object, key]] of (
      [
        [globalThis, 'customChoiceFixture'],
        [Array.prototype, 'randomRemove'],
      ] as const
    ).entries()) {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    }
  });
  const source = (
    await readFile(new URL('../packages/noname-adapter/runtime/mode.js', import.meta.url), 'utf8')
  )
    .replace(
      "import { lib, game, ui, get, _status } from 'noname';",
      'const { lib, game, get, _status } = globalThis.customChoiceFixture;',
    )
    .replace("import { connectRuleHost } from './relay.js';", '')
    .replace(
      "import { broadcastCharacterInit } from './privacy.js';",
      'const broadcastCharacterInit = () => {};',
    );
  const runtime = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#custom`
  );
  const input = { ...setup(roster(pool)), generalSelections: {} };
  input.settings.mode = 'duel';
  assert.deepEqual(
    runtime
      .generalChoices(input, pool.slice(0, 2), players.slice(0, 2))
      .map((choice: unknown[]) => (choice[1] as unknown[][])[1]![0]),
    [[pool[0]], [pool[1]]],
  );
  input.settings.mode = 'versus';
  const shared = runtime.generalChoices(input, [...pool], players.slice(0, 4));
  assert.equal(shared[0][1].createDialog[1][0].length, 10);
  assert.deepEqual(shared[0][1].createDialog[1][0], shared[3][1].createDialog[1][0]);
  assert.throws(
    () => runtime.generalChoices(input, pool.slice(0, 19), players.slice(0, 4)),
    /候选不足/,
  );
  input.settings.mode = 'identity';
  assert.throws(() => runtime.generalChoices(input, [...pool], [players[0]]), /增加无主公标记/);
});
