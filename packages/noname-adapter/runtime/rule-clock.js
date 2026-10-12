// SPDX-License-Identifier: GPL-3.0-only

/** Keep native callbacks in this room; the local service only returns timer IDs. */
export function installRuleClock(socket, target = globalThis, recovery = false) {
  const original = {
    setTimeout: target.setTimeout,
    setInterval: target.setInterval,
    clearTimeout: target.clearTimeout,
    clearInterval: target.clearInterval,
  };
  const pending = new Map();
  let nextId = 0;
  let closed = false;
  const proof = { source: 'local-service', scheduled: 0, fired: 0 };
  const send = (packet) => socket.send(JSON.stringify(packet));
  function schedule(handler, delay, args, repeat) {
    if (closed) return;
    // Negative IDs cannot collide with browser timers made before installation.
    const id = --nextId;
    const callback = typeof handler === 'function' ? handler : target.Function(String(handler));
    pending.set(id, { callback, args, repeat });
    try {
      send({ type: 'schedule', id, delay: Math.max(0, Number(delay) | 0), repeat });
    } catch (error) {
      pending.delete(id);
      throw error;
    }
    proof.scheduled++;
    return id;
  }
  const timeout = (handler, delay = 0, ...args) => schedule(handler, delay, args, false);
  const interval = (handler, delay = 0, ...args) => schedule(handler, delay, args, true);
  function clear(id) {
    id = Number(id);
    if (id >= 0) {
      original.clearTimeout.call(target, id);
      original.clearInterval.call(target, id);
    } else if (pending.delete(id) && !closed) send({ type: 'cancel', id });
  }
  function receive({ data }) {
    const message = JSON.parse(data);
    if (message.type !== 'clock') return;
    if (recovery && !closed) send({ type: 'ack', id: message.id });
    const timer = pending.get(message.id);
    if (!timer || closed) return;
    if (!timer.repeat) pending.delete(message.id);
    proof.fired++;
    timer.callback.apply(target, timer.args);
  }
  function close() {
    if (closed) return;
    closed = true;
    pending.clear();
    socket.removeEventListener('message', receive);
    if (target.setTimeout === timeout) target.setTimeout = original.setTimeout;
    if (target.setInterval === interval) target.setInterval = original.setInterval;
    if (target.clearTimeout === clear) target.clearTimeout = original.clearTimeout;
    if (target.clearInterval === clear) target.clearInterval = original.clearInterval;
  }
  target.setTimeout = timeout;
  target.setInterval = interval;
  target.clearTimeout = target.clearInterval = clear;
  socket.addEventListener('message', receive);
  socket.addEventListener('close', close, { once: true });
  return { proof, close };
}

export async function connectRuleClock(id, recovery = false) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${location.host}/engine/socket/${id}/clock`;
  const socket = recovery
    ? new (await import('./rule-socket.js')).RecoverableRuleSocket(url)
    : new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('close', () => reject(new Error('电脑规则计时连接未能建立')), {
      once: true,
    });
  });
  const clock = installRuleClock(socket, globalThis, recovery);
  window.addEventListener('pagehide', () => socket.close(), { once: true });
  return { ...clock, socket };
}
