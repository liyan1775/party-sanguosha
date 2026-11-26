import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';

export function isCurrentBuild(health, version, manifest, sourceId) {
  return (
    health.version === version &&
    manifest !== null &&
    health.buildId === manifest.buildId &&
    (sourceId === undefined || sourceId === manifest.sourceId)
  );
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function readRunningSession(file) {
  let session;
  let url;
  try {
    session = JSON.parse(await readFile(file, 'utf8'));
    url = new URL(session.serverUrl);
    if (
      session.app !== 'party-sanguosha' ||
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/server' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !Number.isInteger(session.pid) ||
      session.pid <= 0
    )
      return null;
  } catch {
    return null;
  }
  try {
    const response = await fetch(`${url.origin}/api/health`, {
      signal: AbortSignal.timeout(1000),
      redirect: 'error',
    });
    const health = await response.json();
    if (
      response.ok &&
      health.app === session.app &&
      health.instanceId === session.instanceId &&
      health.ok
    )
      return { ...session, health };
  } catch {
    // The session may be stale, but an unresolved live PID must not be overwritten.
  }
  if (processAlive(session.pid))
    throw new Error('现有服务进程仍在运行，但无法确认状态。请稍后再试或检查现有联机页。');
  return null;
}

export async function waitForProcessExit(
  pid,
  { alive = processAlive, sleep = delay, attempts = 50 } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!alive(pid)) return;
    await sleep(200);
  }
  if (alive(pid)) throw new Error('原服务仍在结束连接。请稍候再次双击启动，不要打开旧联机页。');
}

const manualUpgrade = {
  status: 'manual',
  message:
    '旧服务不支持完整的原子空闲停机，原服务继续运行。牌桌活动结束后，请双击「停止聚会三国杀」，再双击启动。',
};

export function supportsSafeUpgrade(health) {
  return health.conditionalShutdown === true && health.shutdownPolicy === 2;
}

export async function requestUpgradeShutdown(session, request = fetch) {
  if (!supportsSafeUpgrade(session.health)) return manualUpgrade;
  const origin = new URL(session.serverUrl).origin;
  const response = await request(origin + '/api/shutdown-if-idle', {
    method: 'POST',
    headers: { 'X-Party-Control': session.controlToken },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    return {
      status: 'busy',
      message: body?.error?.message || '现有服务有活动进行中，请在结束后再次双击启动。',
    };
  }
  if (!response.ok) throw new Error(`停机接口返回 ${response.status}。`);
  // The server has already locked matchmaking when it writes the headers.
  // A body disconnect after this point is not a refusal.
  await response.arrayBuffer().catch(() => {});
  return { status: 'accepted' };
}

export async function prepareReplacement(
  session,
  { stage, request = requestUpgradeShutdown, onAccepted, wait = waitForProcessExit },
) {
  if (session && !session.health.stopping && !supportsSafeUpgrade(session.health))
    return manualUpgrade;
  const candidate = await stage();
  if (!session) return { status: 'ready', candidate };
  if (!session.health.stopping) {
    let decision;
    try {
      decision = await request(session);
    } catch (error) {
      throw new Error('无法确认旧服务是否已开始退出。未打开旧联机页，请稍候再次双击启动。', {
        cause: error,
      });
    }
    if (decision.status !== 'accepted') return decision;
  }
  onAccepted?.();
  await wait(session.pid);
  return { status: 'ready', candidate };
}
