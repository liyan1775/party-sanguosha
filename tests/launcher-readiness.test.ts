import test from 'node:test';
import assert from 'node:assert/strict';

const { waitForStartup, STARTUP_TIMEOUT_MS, LAUNCH_LOCK_TIMEOUT_MS } = await import(
  new URL('../scripts/launcher-readiness.mjs', import.meta.url).href
);

test('首次资源校验40秒才就绪：持续等待并返回同一会话，不在旧20秒窗口误报', async () => {
  let elapsed = 0;
  const progress: number[] = [];
  const session = { app: 'party-sanguosha', instanceId: 'this-launch' };
  const result = await waitForStartup({
    check: async () => (elapsed >= 40000 ? session : null),
    assertAlive: () => {},
    onProgress: (seconds: number) => progress.push(seconds),
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
  });
  assert.equal(result, session);
  assert.equal(elapsed, 40000);
  assert(progress.includes(20) && progress.includes(35));
  assert(LAUNCH_LOCK_TIMEOUT_MS > STARTUP_TIMEOUT_MS);
});

test('就绪立即返回；不会为已有实例产生等待提示', async () => {
  const session = { instanceId: 'existing' };
  assert.equal(
    await waitForStartup({
      check: async () => session,
      assertAlive: () => {},
      onProgress: () => assert.fail('unexpected waiting'),
    }),
    session,
  );
});

test('真实耗时达到120秒即报超时；慢健康检查不能把期限扩成尝试次数', async () => {
  let elapsed = 0;
  await assert.rejects(
    waitForStartup({
      check: async () => {
        elapsed += 1000;
        return null;
      },
      assertAlive: () => {},
      now: () => elapsed,
      sleep: async (ms: number) => {
        elapsed += ms;
      },
    }),
    /超过120秒.*server\.log.*server-error\.log/,
  );
  assert(elapsed >= STARTUP_TIMEOUT_MS && elapsed < STARTUP_TIMEOUT_MS + 1000);
});

test('新建子进程退出立即中止，保留原错误，不等待全部启动期限', async () => {
  const error = new Error('only this child exited');
  await assert.rejects(
    waitForStartup({
      check: () => assert.fail('must not probe after child exit'),
      assertAlive: () => {
        throw error;
      },
      sleep: () => assert.fail('must not sleep after child exit'),
    }),
    error,
  );
});
