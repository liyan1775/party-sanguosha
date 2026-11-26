import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createBuildSnapshot,
  readBuildManifest,
  verifyBuildManifest,
  sourceFingerprint,
  writeBuildManifest,
} from '../scripts/build-manifest.mjs';
import {
  isCurrentBuild,
  prepareReplacement,
  requestUpgradeShutdown,
  waitForProcessExit,
} from '../scripts/launcher-upgrade.mjs';

test('构建指纹按内容确定，三处构建产物及源码变化可分别识别', async (t) => {
  await mkdir('.runtime', { recursive: true });
  const workspace = await mkdtemp(path.join('.runtime', 'build-manifest-test-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const files = [
    'apps/server/src/main.ts',
    'apps/web/src/main.ts',
    'packages/shared/src/contracts.ts',
    'packages/noname-adapter/src/service.ts',
    'packages/noname-adapter/runtime/mode.js',
    'config/general-catalog.json',
    'package.json',
    'package-lock.json',
    'scripts/build.mjs',
    'scripts/build-manifest.mjs',
    'scripts/build-native-engine.mjs',
    'scripts/build-native-portraits.mjs',
    'scripts/client-art.mjs',
    'dist/server/main.js',
    'dist/web/app.js',
    'dist/runtime/index.html',
    'dist/runtime/mode.js',
    'dist/engine/noname.js',
  ];
  for (const relative of files) {
    const absolute = path.join(workspace, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, relative);
  }
  const sourceId = await sourceFingerprint(workspace);
  await writeBuildManifest(workspace, sourceId);
  const expected = (await readBuildManifest(workspace))!;
  await writeBuildManifest(workspace, sourceId);
  assert.deepEqual(await readBuildManifest(workspace), expected);
  const health = { version: '1.0.0', buildId: expected.buildId };
  assert.equal(isCurrentBuild(health, '1.0.0', expected, sourceId), true);
  assert.equal(isCurrentBuild({ version: '1.0.0' }, '1.0.0', expected), false);
  assert.equal(isCurrentBuild(health, '1.0.1', expected), false);
  await writeFile(path.join(workspace, 'apps/web/src/main.ts'), 'changed source');
  assert.equal(
    isCurrentBuild(health, '1.0.0', expected, await sourceFingerprint(workspace)),
    false,
  );
  for (const file of [
    'dist/server/main.js',
    'dist/web/app.js',
    'dist/runtime/mode.js',
    'dist/engine/noname.js',
  ]) {
    await writeFile(path.join(workspace, file), 'changed artifact');
    await writeBuildManifest(workspace, sourceId);
    assert.notEqual((await readBuildManifest(workspace))?.buildId, expected.buildId);
    await writeFile(path.join(workspace, file), file);
  }
  await writeBuildManifest(workspace, sourceId);
  const snapshot = await createBuildSnapshot(workspace);
  assert.deepEqual(await verifyBuildManifest(workspace, snapshot), expected);
  await writeFile(path.join(workspace, 'dist/runtime/index.html'), 'broken newer entry');
  assert.equal(await verifyBuildManifest(workspace), null);
  await assert.rejects(createBuildSnapshot(workspace), /校验|不完整/);
  assert.deepEqual(await verifyBuildManifest(workspace, snapshot), expected);
  assert.equal(
    await readFile(path.join(snapshot, 'runtime/index.html'), 'utf8'),
    'dist/runtime/index.html',
  );
});

const session = {
  serverUrl: 'http://127.0.0.1:3000/server',
  pid: 322,
  controlToken: 'fixture-control',
  health: { conditionalShutdown: true, shutdownPolicy: 2 },
};

test('新版条件停机只向原子接口发请求，忙碌有提示，接受后响应体断开不变成拒绝', async () => {
  const responses = [
    Response.json({ error: { message: '山河图征程尚未结束。' } }, { status: 409 }),
    Response.json({ ok: true }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('shutdown closed response body'));
        },
      }),
      { status: 200 },
    ),
  ];
  const calls: string[] = [];
  const request: typeof fetch = async (input, options) => {
    calls.push(new URL(String(input)).pathname);
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options.headers).get('X-Party-Control'), session.controlToken);
    return responses.shift()!;
  };
  assert.deepEqual(await requestUpgradeShutdown(session, request), {
    status: 'busy',
    message: '山河图征程尚未结束。',
  });
  assert.deepEqual(await requestUpgradeShutdown(session, request), { status: 'accepted' });
  assert.deepEqual(await requestUpgradeShutdown(session, request), { status: 'accepted' });
  assert.deepEqual(calls, Array(3).fill('/api/shutdown-if-idle'));
});

test('遗留服务不再读取房间再强停，未完整宣告支持时提示手动停启且不发请求', async () => {
  const noRequest: typeof fetch = async () => assert.fail('旧服务不应收到任何停机探测');
  for (const health of [{}, { conditionalShutdown: true }, { shutdownPolicy: 2 }]) {
    const legacy = { ...session, health };
    const result = await requestUpgradeShutdown(legacy, noRequest);
    assert.equal(result.status, 'manual');
    assert('message' in result);
    assert.match(result.message, /原服务继续运行.*停止聚会三国杀.*再双击启动/);
    assert.deepEqual(
      await prepareReplacement(legacy, { stage: async () => assert.fail('不需准备旧式升级') }),
      result,
    );
  }
});

test('先准备并校验新版，再请求旧实例停机；接受退出与忙碌拒绝不走同一路径', async () => {
  const calls: string[] = [];
  const staged = { id: 'verified-build' };
  let result: 'accepted' | 'busy' = 'accepted';
  let stageFails = false;
  const lifecycle = {
    stage: async () => {
      calls.push('verify');
      if (stageFails) throw new Error('磁盘文件校验不通过');
      return staged;
    },
    request: async () => {
      calls.push('conditional');
      return result === 'accepted'
        ? ({ status: 'accepted' } as const)
        : ({ status: 'busy', message: '正在选将' } as const);
    },
    onAccepted: () => {
      calls.push('accepted');
    },
    wait: async (pid: number) => {
      assert.equal(pid, session.pid);
      let probes = 0;
      await waitForProcessExit(pid, {
        alive: () => probes++ < 3,
        sleep: async () => {
          calls.push('waiting');
        },
      });
      calls.push('exited');
    },
  };
  assert.deepEqual(await prepareReplacement(session, lifecycle), {
    status: 'ready',
    candidate: staged,
  });
  assert.deepEqual(calls, [
    'verify',
    'conditional',
    'accepted',
    'waiting',
    'waiting',
    'waiting',
    'exited',
  ]);
  calls.length = 0;
  result = 'busy';
  assert.deepEqual(await prepareReplacement(session, lifecycle), {
    status: 'busy',
    message: '正在选将',
  });
  assert.deepEqual(calls, ['verify', 'conditional']);
  calls.length = 0;
  stageFails = true;
  await assert.rejects(prepareReplacement(session, lifecycle), /校验不通过/);
  assert.deepEqual(calls, ['verify']);
});

test('已开始退出或停机响应不明时不误判为可复用旧服务', async () => {
  const draining = { ...session, health: { ...session.health, stopping: true } };
  await assert.rejects(
    prepareReplacement(draining, {
      stage: async () => 'verified',
      request: async () => assert.fail('旧进程已接受停机'),
      wait: (pid) =>
        waitForProcessExit(pid, {
          attempts: 2,
          alive: () => true,
          sleep: async () => {},
        }),
    }),
    /不要打开旧联机页/,
  );
  await assert.rejects(
    prepareReplacement(session, {
      stage: async () => 'verified',
      request: async () => {
        throw new Error('connection reset');
      },
      wait: async () => assert.fail('不能假定停机已经被接受'),
    }),
    /无法确认旧服务是否已开始退出。未打开旧联机页/,
  );
});
