import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RosterLibrary } from '../apps/server/src/roster-library.js';
import { RoomStore } from '../apps/server/src/room.js';
import { AppError } from '../apps/server/src/errors.js';
import { createPartyServer } from '../apps/server/src/server.js';
import type { EngineAdapter, MatchSetup } from '../packages/noname-adapter/src/index.js';

const editor = 'an-editor-capability-not-returned-in-json';
const errorCode = (code: string) => (error: unknown) =>
  error instanceof AppError && error.code === code;
const body = (name = '十一月自选') => ({
  name,
  basePreset: 'beginner',
  characters: ['caocao', 'simayi'],
});

test('自定义库仅接受已接入ID；修订不可变、并发冲突与归档保留旧版本', () => {
  const library = new RosterLibrary();
  assert.equal(library.catalog().length, 666);
  const created = library.save(body(), editor);
  const first = library.resolve(created.id, 1);
  assert.throws(
    () => library.save({ ...body(), characters: ['not_native'] }, editor),
    errorCode('INVALID_ROSTER'),
  );
  assert.throws(
    () => library.save({ ...body(), characters: ['caocao', 'caocao'] }, editor),
    errorCode('INVALID_ROSTER'),
  );
  assert.throws(
    () => library.save({ ...body(), definitionPacks: {} }, editor),
    errorCode('INVALID_ROSTER'),
  );
  assert.equal(
    library.save({ ...body(), characters: ['caocao'] }, editor).characterCount,
    1,
    '不完整草稿可以保存',
  );
  assert.throws(
    () => library.save({ ...body(), expectedRevision: 1 }, 'someone-else', created.id),
    errorCode('ROSTER_EDITOR_REQUIRED'),
  );
  library.save(
    { ...body('新版本'), characters: ['caocao', 're_xuzhu'], expectedRevision: 1 },
    editor,
    created.id,
  );
  assert.throws(
    () => library.save({ ...body(), expectedRevision: 1 }, editor, created.id),
    errorCode('ROSTER_REVISION_CONFLICT'),
  );
  library.archive(created.id, 2, editor);
  assert.deepEqual(library.resolve(created.id, 1), first);
  assert.throws(() => library.select(created.id, 1), errorCode('ROSTER_ARCHIVED'));
  assert.equal(library.list(editor)[0]!.archived, true);
  assert.equal(library.list('someone-else')[0]!.editable, false);
  first.characters.length = 0;
  assert.equal(library.resolve(created.id, 1).characters.length, 2, '读者不能改写库');
});

test('持久库重启保留及只写能力摘要；损坏明确失败且不覆盖原文/备份', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'party-rosters-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const library = new RosterLibrary(directory);
  const roster = library.save(body(), editor);
  library.save({ ...body('第二版'), expectedRevision: 1 }, editor, roster.id);
  const restored = new RosterLibrary(directory);
  assert.equal(restored.list(editor)[0]!.revision, 2);
  assert.equal(restored.list(editor)[0]!.editable, true);
  assert(!readFileSync(join(directory, 'library.json'), 'utf8').includes(editor));
  const backup = readFileSync(join(directory, 'library.json.bak'), 'utf8');
  writeFileSync(join(directory, 'library.json'), '{broken');
  assert.throws(() => new RosterLibrary(directory), /损坏/);
  assert.equal(readFileSync(join(directory, 'library.json'), 'utf8'), '{broken');
  assert.equal(readFileSync(join(directory, 'library.json.bak'), 'utf8'), backup);
});

test('库加载前拒绝超限文件，主文件丢失但有备份时不初始化空库', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'party-rosters-limit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'library.json');
  writeFileSync(file, Buffer.alloc(16 * 1024 * 1024 + 1, 32));
  assert.throws(() => new RosterLibrary(directory), /16 MiB/);
  rmSync(file);
  writeFileSync(`${file}.bak`, 'backup remains');
  assert.throws(() => new RosterLibrary(directory), /主文件缺失/);
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), 'backup remains');
});

test('归档后重启仍能读取旧修订及摘要，禁止新的房间应用', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'party-rosters-archive-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const library = new RosterLibrary(directory);
  const saved = library.save(body(), editor);
  const original = library.resolve(saved.id, 1);
  library.archive(saved.id, 1, editor);
  const restored = new RosterLibrary(directory);
  assert.deepEqual(restored.resolve(saved.id, 1), original);
  assert.throws(() => restored.select(saved.id, 1), errorCode('ROSTER_ARCHIVED'));
  assert(!JSON.stringify(restored.list(editor)).includes('ownerHash'));
});

test('房间应用固定修订，点将仅有效池，库更新/归档不改变旧房及开局快照', async () => {
  const library = new RosterLibrary();
  const roster = library.save(body(), editor);
  let started: MatchSetup | undefined;
  const engine: EngineAdapter = {
    status: () => ({ id: 'noname', ready: true, message: 'fixture' }),
    start: async (setup) => {
      started = setup;
    },
  };
  const room = new RoomStore(engine, [], (id, revision) => library.select(id, revision));
  const owner = room.join('房主');
  const settings = {
    mode: 'duel',
    playerCount: 2,
    generalPreset: 'beginner',
    allowGeneralSelection: true,
    extensions: [],
    customRoster: { id: roster.id, revision: 1 },
  };
  room.updateSettings(settings, owner.token);
  assert.deepEqual(room.generalChoice(owner.token).available, ['caocao', 'simayi']);
  assert.throws(() => room.setGeneralChoice(owner.token, 'liubei'), errorCode('INVALID_GENERAL'));
  room.setGeneralChoice(owner.token, 'caocao');
  library.save(
    { ...body('改库'), characters: ['liubei', 'guanyu'], expectedRevision: 1 },
    editor,
    roster.id,
  );
  library.archive(roster.id, 2, editor);
  room.updateSettings({ ...settings, customRoster: undefined }, owner.token);
  assert.equal(room.snapshot().roster!.revision, 1);
  const detached = room.snapshot();
  detached.settings.customRoster!.revision = 99;
  assert.equal(room.snapshot().settings.customRoster!.revision, 1);
  room.addBots(1, owner.token);
  room.connect(owner.token);
  room.setReady(owner.token, true);
  await room.start(owner.token);
  assert.deepEqual(started!.customRoster!.characters, ['caocao', 'simayi']);
  assert.equal(started!.customRoster!.summary.revision, 1);
});

test('自定义池容量沿既有玩法；小草稿可存，应用前拒绝不足池，高校及基础档错配拒绝', () => {
  const library = new RosterLibrary();
  const created = library.save(body(), editor);
  const room = new RoomStore(
    { status: () => ({ id: 'noname', ready: true, message: 'fixture' }), start: async () => {} },
    [],
    (id, revision) => library.select(id, revision),
  );
  const owner = room.join('房主');
  const settings = {
    mode: 'duel',
    playerCount: 2,
    generalPreset: 'beginner',
    allowGeneralSelection: true,
    extensions: [],
    customRoster: { id: created.id, revision: 1 },
  };
  room.updateSettings(settings, owner.token);
  for (const [mode, playerCount] of [
    ['versus', 4],
    ['doudizhu', 3],
    ['identity', 8],
  ] as const)
    assert.throws(
      () => room.updateSettings({ ...settings, mode, playerCount }, owner.token),
      errorCode('ROSTER_TOO_SMALL'),
    );
  assert.throws(
    () => room.updateSettings({ ...settings, generalPreset: 'advanced' }, owner.token),
    errorCode('ROSTER_BASE_MISMATCH'),
  );
  assert.throws(
    () => room.updateSettings({ ...settings, mode: 'college', playerCount: 4 }, owner.token),
    errorCode('CUSTOM_ROSTER_UNSUPPORTED'),
  );
  room.updateSettings({ ...settings, customRoster: null }, owner.token);
  assert.equal(room.snapshot().roster, undefined);
  assert.equal(room.snapshot().settings.customRoster, undefined);
  assert.equal(room.generalChoice(owner.token).available.length, 27);
});

test('切回内置池清除已不在池内的点将；不同房间可独立使用两个不可变版本', () => {
  const library = new RosterLibrary();
  const created = library.save({ ...body(), characters: ['re_xuzhu', 'simayi'] }, editor);
  const engine: EngineAdapter = {
    status: () => ({ id: 'noname', ready: true, message: 'fixture' }),
    start: async () => {},
  };
  const first = new RoomStore(engine, [], (id, revision) => library.select(id, revision));
  const second = new RoomStore(engine, [], (id, revision) => library.select(id, revision));
  const owner = first.join('第一桌');
  const other = second.join('第二桌');
  const settings = {
    mode: 'duel',
    playerCount: 2,
    generalPreset: 'beginner',
    allowGeneralSelection: true,
    extensions: [],
    customRoster: { id: created.id, revision: 1 },
  };
  first.updateSettings(settings, owner.token);
  first.setGeneralChoice(owner.token, 're_xuzhu');
  library.save({ ...body('第二版本'), expectedRevision: 1 }, editor, created.id);
  second.updateSettings(
    { ...settings, customRoster: { id: created.id, revision: 2 } },
    other.token,
  );
  assert.equal(first.snapshot().roster!.revision, 1);
  assert.equal(second.snapshot().roster!.revision, 2);
  first.updateSettings({ ...settings, customRoster: null }, owner.token);
  assert.equal(first.generalChoice(owner.token).selected, null);
  assert.deepEqual(second.generalChoice(other.token).available, ['caocao', 'simayi']);
});

test('身份小池按当前点将预留拒绝可能无法分配的随机主公，不提前改候选规则', async () => {
  const library = new RosterLibrary();
  const saved = library.save(
    { ...body(), characters: ['caocao', 'simayi', 'guanyu', 'zhangfei', 'zhaoyun'] },
    editor,
  );
  let invoked = false;
  const room = new RoomStore(
    {
      status: () => ({ id: 'noname', ready: true, message: 'fixture' }),
      start: async () => {
        invoked = true;
      },
    },
    [],
    (id, revision) => library.select(id, revision),
  );
  const owner = room.join('点将玩家');
  room.updateSettings(
    {
      mode: 'identity',
      playerCount: 5,
      generalPreset: 'beginner',
      allowGeneralSelection: true,
      extensions: [],
      customRoster: { id: saved.id, revision: 1 },
    },
    owner.token,
  );
  room.setGeneralChoice(owner.token, 'caocao');
  room.addBots(4, owner.token);
  room.connect(owner.token);
  room.setReady(owner.token, true);
  await assert.rejects(
    room.start(owner.token),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'ROSTER_TOO_SMALL' &&
      error.message.includes('随机主公'),
  );
  assert.equal(invoked, false);
  assert.equal(room.snapshot().phase, 'waiting');
});

test('HTTP库写入要求本房房主、编辑能力及当前席位；名单大正文不放宽普通API', async (t) => {
  const party = createPartyServer({ port: 0, webRoot: '/unused' });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    party.closeStreams();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  });
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (url: string, method = 'GET', data?: unknown, cookie = '', seat?: string) =>
    fetch(base + url, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(seat ? { 'X-Party-Player': seat } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const ownerResponse = await request('/api/rooms', 'POST', { nickname: '房主' });
  const ownerCookie = ownerResponse.headers.get('set-cookie')!.split(';')[0]!;
  const owner = await ownerResponse.json();
  const path = `/api/rooms/${owner.room.code}/rosters`;
  const catalog = await request('/api/rosters');
  const editCookie = catalog.headers.get('set-cookie')!.split(';')[0]!;
  assert.match(catalog.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  const cookies = `${ownerCookie}; ${editCookie}`;
  assert.equal((await request(path, 'POST', body(), editCookie)).status, 403);
  assert.equal((await request(path, 'POST', body(), cookies, 'stale-seat')).status, 409);
  const created = await request(path, 'POST', body(), cookies, owner.playerId);
  assert.equal(created.status, 201);
  const saved = (await created.json()).roster;
  assert.equal(
    (await request(`${path}/${saved.id}`, 'PUT', { ...body(), expectedRevision: 1 }, ownerCookie))
      .status,
    403,
  );
  assert.equal(
    (await request(`${path}/${saved.id}`, 'PUT', { ...body(), expectedRevision: 1 }, cookies))
      .status,
    200,
  );
  const publicData = JSON.stringify(await (await request(`/api/rosters/${saved.id}/1`)).json());
  assert(!publicData.includes('ownerHash'));
  assert(!publicData.includes(editCookie.split('=')[1]!));
  const tooLargeForNormal = { nickname: 'x'.repeat(5000) };
  assert.equal((await request('/api/rooms', 'POST', tooLargeForNormal)).status, 413);
  const largeRoster = { ...body(), name: 'x'.repeat(5000) };
  assert.equal(
    (await request(path, 'POST', largeRoster, cookies)).status,
    400,
    '将池请求通过正文大小检查后由schema拒绝',
  );
  assert.equal(
    (await request(path, 'POST', { ...body(), name: 'x'.repeat(66000) }, cookies)).status,
    413,
  );
});
