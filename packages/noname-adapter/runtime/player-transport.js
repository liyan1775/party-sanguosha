// SPDX-License-Identifier: GPL-3.0-only
const NativeWebSocket = globalThis.WebSocket;
function nextBrowserTask() {
  // Unlike nested setTimeout(0), MessageChannel has no four-millisecond clamp.
  // It still gives native promises and DOM observers a task boundary per frame.
  const channel = new MessageChannel();
  return new Promise((resolve) => {
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
function requestDeadline(parent, milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
    },
  };
}
function connectionId() {
  // randomUUID requires a secure context; LAN HTTP still has getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Preserves the native socket API while providing authenticated HTTP fallback. */
export class PlayerTransport extends EventTarget {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  abort = new AbortController();
  sequence = 0;
  received = 0;
  sending = Promise.resolve();
  channel = connectionId();
  samples = [];
  constructor(url) {
    super();
    this.url = url;
    this.path = new URL(url).pathname.replace('/socket/', '/poll/').replace(/\/player$/, '');
    this.key = 'party_http_transport';
    this.route = globalThis.partyEngine?.setup?.playerNetwork === 'internet' ? 'internet' : 'local';
    if (this.route === 'internet')
      window.parent.addEventListener('party-lan-ready', () => this.currentRead?.abort(), {
        signal: this.abort.signal,
      });
    queueMicrotask(() => this.start());
    window.addEventListener('pagehide', () => this.close(), { once: true });
  }
  emit(type, event) {
    this[`on${type}`]?.call(this, event);
    this.dispatchEvent(event);
  }
  async request(method, body, query = '', retry = true) {
    let failure;
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
      const deadline = requestDeadline(this.abort.signal, 20000);
      try {
        const local = window.parent?.partyLan;
        if (this.route !== 'local' && local?.connected) {
          this.setRoute('lan');
          const response = await local.request(method, `${this.path}${query}`, body);
          if (response.status >= 400 && response.status < 500) {
            this.finish(response.status === 403 ? 1008 : 1011, '对局连接已失效');
            throw new Error('Game connection rejected');
          }
          if (response.status !== 200) throw new Error('Local connection unavailable');
          return response.body;
        }
        if (this.route === 'lan') this.setRoute('internet');
        if (method === 'GET') this.currentRead = deadline;
        const response = await fetch(`${this.path}${query}`, {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: deadline.signal,
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.status >= 400 && response.status < 500) {
          this.finish(response.status === 403 ? 1008 : 1011, '对局连接已失效');
          throw new Error('Game connection rejected');
        }
        if (!response.ok) throw new Error('Game connection unavailable');
        return await response.json();
      } catch (error) {
        failure = error;
        if (this.abort.signal.aborted) throw error;
        if (method === 'GET' && deadline.signal.aborted && window.parent?.partyLan?.connected)
          continue;
        await new Promise((done) => setTimeout(done, 700 * (attempt + 1)));
      } finally {
        deadline.clear();
        if (this.currentRead === deadline) this.currentRead = null;
      }
    }
    throw failure;
  }
  start() {
    if (this.readyState !== 0) return;
    // Public HTTP and LAN RTC share one acknowledged polling channel. Switching
    // paths cannot rejoin the seat or submit the same native decision twice.
    if (this.route === 'internet' || sessionStorage.getItem(this.key) === '1') {
      void this.startPolling();
      return;
    }
    const socket = new NativeWebSocket(this.url);
    this.socket = socket;
    let timer;
    const fallback = () => {
      if (this.readyState !== 0 || this.fallingBack) return;
      this.fallingBack = true;
      clearTimeout(timer);
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close();
      this.socket = null;
      sessionStorage.setItem(this.key, '1');
      void this.startPolling();
    };
    timer = setTimeout(fallback, 8000);
    socket.onopen = () => {
      clearTimeout(timer);
      this.readyState = 1;
      this.startNetworkMonitor();
      this.emit('open', new Event('open'));
    };
    socket.onmessage = (event) => {
      this.emit('message', new MessageEvent('message', { data: event.data }));
      window.dispatchEvent(new Event('party-table-update'));
    };
    socket.onerror = () => {
      if (this.readyState === 0) fallback();
    };
    socket.onclose = (event) => {
      clearTimeout(timer);
      if (this.readyState === 0) fallback();
      else {
        if (event.code !== 1000 && event.code !== 1008) sessionStorage.setItem(this.key, '1');
        this.finish(event.code, event.reason);
      }
    };
  }
  async startPolling() {
    try {
      const opened = await this.request('POST', { open: true, channel: this.channel });
      if (this.abort.signal.aborted) return;
      if (opened.closed) throw new Error('Connection closed');
      this.polling = true;
      this.readyState = 1;
      this.startNetworkMonitor();
      this.emit('open', new Event('open'));
      while (this.readyState === 1) {
        const result = await this.request(
          'GET',
          undefined,
          `?channel=${this.channel}&after=${this.received}`,
        );
        const arrivedAt = performance.now();
        for (const message of result.messages) {
          if (this.readyState !== 1) return;
          if (message.sequence <= this.received) continue;
          if (message.sequence !== this.received + 1) throw new Error('Message sequence mismatch');
          this.received = message.sequence;
          const engine = globalThis.partyEngine;
          if (engine)
            engine.deliveryAge =
              Math.max(0, (result.serverTime ?? 0) - (message.sentAt ?? 0)) +
              performance.now() -
              arrivedAt;
          try {
            this.emit('message', new MessageEvent('message', { data: message.data }));
            window.dispatchEvent(new Event('party-table-update'));
            // Keep delivery age available through native promise callbacks too.
            await nextBrowserTask();
          } finally {
            if (engine) engine.deliveryAge = 0;
          }
        }
        if (result.closed) this.finish(result.code, result.reason);
      }
    } catch {
      if (this.readyState !== 3) this.finish(1011, '连接中断，正在恢复原座位');
    }
  }
  send(data) {
    if (this.readyState !== 1) return;
    if (!this.polling) {
      this.socket.send(data);
      return;
    }
    const sequence = ++this.sequence;
    this.sending = this.sending
      .then(async () => {
        const began = performance.now();
        const route = this.route;
        await this.request('POST', { sequence, data }, `?channel=${this.channel}`);
        if (route === this.route) this.reportNetwork(performance.now() - began);
        window.dispatchEvent(new Event('party-action-ack'));
      })
      .catch(() => this.finish(1011, '连接中断，正在恢复原座位'));
  }
  reportNetwork(rtt, unstable = false) {
    if (Number.isFinite(rtt)) {
      this.samples.push(Math.round(rtt));
      if (this.samples.length > 3) this.samples.shift();
    }
    const measured = this.samples.length
      ? [...this.samples].sort((a, b) => a - b)[Math.floor(this.samples.length / 2)]
      : null;
    window.parent?.postMessage(
      {
        type: 'party-network',
        matchId: globalThis.partyEngine?.setup?.id,
        route: this.route,
        rtt: measured,
        unstable,
      },
      location.origin,
    );
  }
  setRoute(route) {
    if (this.route !== route) this.samples = [];
    this.route = route;
  }
  startNetworkMonitor() {
    if (this.networkTimer) return;
    let running = false;
    const measure = async () => {
      if (running || document.hidden || this.readyState !== 1) return;
      running = true;
      const began = performance.now();
      const deadline = requestDeadline(this.abort.signal, 8000);
      let route = this.route;
      try {
        const local = window.parent?.partyLan;
        if (this.polling && this.route !== 'local' && local?.connected) {
          const result = await local.request('GET', '/ping');
          if (result.status !== 200) throw new Error('Local connection unavailable');
          this.setRoute('lan');
          route = 'lan';
        } else {
          if (this.route === 'lan') this.setRoute('internet');
          route = this.route;
          const response = await fetch('/api/health', {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: deadline.signal,
          });
          if (!response.ok) throw new Error('Connection unavailable');
          await response.arrayBuffer();
        }
        if (route === this.route) this.reportNetwork(performance.now() - began);
      } catch {
        if (!this.abort.signal.aborted) this.reportNetwork(undefined, true);
      } finally {
        deadline.clear();
        running = false;
      }
    };
    this.networkTimer = setInterval(measure, 8000);
    window.addEventListener('online', measure, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', measure, { signal: this.abort.signal });
    void measure();
  }
  finish(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearInterval(this.networkTimer);
    this.abort.abort();
    this.emit('close', new CloseEvent('close', { code, reason }));
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    if (this.socket) this.socket.close(code, reason);
    if (this.polling && window.parent?.partyLan?.connected && this.route !== 'local')
      void window.parent.partyLan
        .request('DELETE', `${this.path}?channel=${this.channel}`)
        .catch(() => {});
    else if (this.polling)
      void fetch(`${this.path}?channel=${this.channel}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {});
    this.finish(code, reason);
  }
}

export function connectPlayer(game, url) {
  // Native connect also installs the upstream sandbox and handlers. The
  // constructor override is synchronous and confined to this player iframe.
  globalThis.WebSocket = PlayerTransport;
  try {
    game.connect(url);
  } finally {
    globalThis.WebSocket = NativeWebSocket;
  }
}
