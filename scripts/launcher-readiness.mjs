import { setTimeout as delay } from 'node:timers/promises';

export const STARTUP_TIMEOUT_MS = 120000;
export const LAUNCH_LOCK_TIMEOUT_MS = STARTUP_TIMEOUT_MS + 60000;

/** Wait for the launcher's authenticated session, using elapsed wall time. */
export async function waitForStartup({
  check,
  assertAlive,
  onProgress,
  now = Date.now,
  sleep = delay,
  timeoutMs = STARTUP_TIMEOUT_MS,
}) {
  const started = now();
  let nextProgress = 5000;
  while (now() - started < timeoutMs) {
    assertAlive();
    const session = await check();
    if (session) return session;
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) break;
    if (elapsed >= nextProgress) {
      onProgress?.(Math.floor(elapsed / 1000));
      nextProgress = elapsed + 5000;
    }
    await sleep(Math.min(200, timeoutMs - elapsed));
  }
  throw new Error(
    `等待本机服务启动超过${Math.ceil(timeoutMs / 1000)}秒，请查看 .runtime/server.log 和 server-error.log 后再试。`,
  );
}
