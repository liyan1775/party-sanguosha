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
    abort: () => controller.abort(),
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
  outgoing = [];
  outgoingBytes = 0;
  channel = connectionId();
  samples = [];
  streamQueue = [];
  streamPending = new Map();
  pingId = 0;
  constructor(url) {
    super();
    this.url = url;
    this.lightweight = new URL(url).searchParams.get('client') === 'light';
    this.path = new URL(url).pathname.replace('/socket/', '/poll/').replace(/\/player$/, '');
    this.key = 'party_http_transport';
    this.route = globalThis.partyEngine?.setup?.playerNetwork === 'internet' ? 'internet' : 'local';
    if (this.route === 'internet')
      window.parent.addEventListener(
        'party-lan-ready',
        () => {
          this.currentRead?.abort();
          this.stopStream();
        },
        {
          signal: this.abort.signal,
        },
      );
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
          this.setRoute(local.route ?? 'lan');
          const response = await local.request(method, `${this.path}${query}`, body);
          if (response.status >= 400 && response.status < 500) {
            this.finish(response.status === 403 ? 1008 : 1011, '对局连接已失效');
            throw new Error('Game connection rejected');
          }
          if (response.status !== 200) throw new Error('Local connection unavailable');
          return response.body;
        }
        if (['lan', 'direct'].includes(this.route)) this.setRoute('internet');
        if (this.route === 'internet' && this.polling && !this.streamOpen) this.startStream();
        if (this.streamOpen) {
          if (method === 'GET') return await this.readStream();
          if (method === 'POST' && Number.isSafeInteger(body?.sequence))
            return await this.streamRequest(`action-${body.sequence}`, { type: 'action', ...body });
        }
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
        if (window.parent?.partyLan?.connected || (method === 'GET' && this.streamOpen)) continue;
        if (attempt + 1 < (retry ? 3 : 1))
          await new Promise((done) => setTimeout(done, 200 * (attempt + 1)));
      } finally {
        deadline.clear();
        if (this.currentRead === deadline) this.currentRead = null;
      }
    }
    throw failure;
  }
  startStream() {
    if (
      !globalThis.partyEngine?.setup?.playerStreaming ||
      sessionStorage.getItem(this.key) === '1' ||
      window.parent?.partyLan?.connected ||
      this.streamSocket ||
      Date.now() - (this.streamTriedAt ?? 0) < 30000
    )
      return;
    this.streamTriedAt = Date.now();
    const socket = new NativeWebSocket(
      `${this.url}${this.url.includes('?') ? '&' : '?'}transport=stream&channel=${this.channel}&after=${this.received}`,
    );
    this.streamSocket = socket;
    const timeout = setTimeout(() => this.stopStream(), 8000);
    socket.onmessage = ({ data }) => {
      try {
        const packet = JSON.parse(data);
        if (packet.type === 'opened') {
          clearTimeout(timeout);
          this.streamOpen = true;
          this.samples = [];
          this.currentRead?.abort();
          void this.measureNetwork?.();
          return;
        }
        if (packet.type === 'frames') {
          this.streamQueue.push(packet);
          if (this.streamQueue.length > 512) throw new Error('Stream congested');
          this.streamReader?.resolve(this.streamQueue.shift());
          this.streamReader = null;
        } else if (packet.type === 'ack' || packet.type === 'pong') {
          const key = packet.type === 'ack' ? `action-${packet.sequence}` : `ping-${packet.id}`;
          const entry = this.streamPending.get(key);
          if (!entry) return;
          clearTimeout(entry.timer);
          this.streamPending.delete(key);
          if (packet.status && packet.status !== 200)
            entry.reject(new Error('Game connection rejected'));
          else entry.resolve(packet);
        }
      } catch (error) {
        this.streamFailure = `帧处理失败：${error.message}`;
        this.stopStream();
      }
    };
    socket.onerror = () => {
      this.streamFailure = 'WebSocket 连接失败';
      this.stopStream();
    };
    socket.onclose = (event) => {
      this.streamFailure = `${event.code} ${event.reason}`;
      this.stopStream();
      if (event.code === 1008) this.finish(1008, event.reason || '对局连接已失效');
    };
    this.streamTimeout = timeout;
  }
  stopStream() {
    this.streamOpen = false;
    clearTimeout(this.streamTimeout);
    const socket = this.streamSocket;
    this.streamSocket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
    this.streamQueue = [];
    this.streamReader?.reject(new Error('Stream closed'));
    this.streamReader = null;
    for (const entry of this.streamPending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Stream closed'));
    }
    this.streamPending.clear();
  }
  readStream() {
    this.streamSocket.send(JSON.stringify({ type: 'ack', after: this.received }));
    if (this.streamQueue.length) return Promise.resolve(this.streamQueue.shift());
    return new Promise((resolve, reject) => {
      this.streamReader = { resolve, reject };
    });
  }
  streamRequest(key, packet) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stopStream(), 8000);
      this.streamPending.set(key, { resolve, reject, timer });
      try {
        this.streamSocket.send(JSON.stringify(packet));
      } catch {
        this.stopStream();
      }
    });
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
      const opened = await this.request('POST', {
        open: true,
        channel: this.channel,
        ...(this.lightweight ? { client: 'light' } : {}),
      });
      if (this.abort.signal.aborted) return;
      if (opened.closed) throw new Error('Connection closed');
      this.polling = true;
      this.readyState = 1;
      if (this.route === 'internet') this.startStream();
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
    const bytes = new TextEncoder().encode(data).byteLength;
    this.outgoingBytes += bytes;
    if (this.outgoing.length >= 512 || this.outgoingBytes > 4 * 1024 * 1024) {
      this.finish(1011, '连接过慢，正在恢复原座位');
      return;
    }
    const action = { sequence, data, bytes };
    this.outgoing.push(action);
    // A WebSocket preserves order itself. Adjacent native packets can travel
    // together instead of each waiting one public RTT for the preceding ACK.
    if (this.streamingActions && this.streamOpen && !window.parent?.partyLan?.connected)
      this.sendStreamAction(action);
    this.startActionDrain();
  }
  startActionDrain() {
    if (this.drainingActions) return;
    this.drainingActions = true;
    this.sending = Promise.resolve()
      .then(() => this.drainActions())
      .catch(() => this.finish(1011, '连接中断，正在恢复原座位'))
      .finally(() => {
        this.drainingActions = false;
        if (this.readyState === 1 && this.outgoing.length) this.startActionDrain();
      });
  }
  sendStreamAction(action) {
    if (action.pending) return;
    action.began = performance.now();
    action.route = this.route;
    action.transport = this.networkTransport();
    action.pending = this.streamRequest(`action-${action.sequence}`, {
      type: 'action',
      sequence: action.sequence,
      data: action.data,
    }).then(
      () => true,
      () => false,
    );
  }
  async drainActions() {
    while (this.readyState === 1 && this.outgoing.length) {
      const action = this.outgoing[0];
      if (this.streamOpen && !window.parent?.partyLan?.connected) {
        this.streamingActions = true;
        for (const queued of this.outgoing) this.sendStreamAction(queued);
        if (!(await action.pending)) {
          this.streamingActions = false;
          this.stopStream();
          // The last ACK may have been lost. Replay in order on the same
          // channel; the server deduplicates packets already applied.
          for (const queued of this.outgoing) delete queued.pending;
          continue;
        }
      } else {
        this.streamingActions = false;
        action.began = performance.now();
        action.route = this.route;
        action.transport = this.networkTransport();
        await this.request(
          'POST',
          { sequence: action.sequence, data: action.data },
          `?channel=${this.channel}`,
        );
      }
      if (this.readyState !== 1) return;
      this.outgoing.shift();
      this.outgoingBytes -= action.bytes;
      if (action.route === this.route && action.transport === this.networkTransport())
        this.reportNetwork(performance.now() - action.began);
      window.dispatchEvent(new Event('party-action-ack'));
    }
    this.streamingActions = false;
  }
  reportNetwork(rtt, unstable = false) {
    if (Number.isFinite(rtt)) {
      this.samples.push(Math.round(rtt));
      if (this.samples.length > 3) this.samples.shift();
    }
    const measured = this.samples.length
      ? [...this.samples].sort((a, b) => a - b)[Math.floor(this.samples.length / 2)]
      : null;
    const network = {
      type: 'party-network',
      matchId: globalThis.partyEngine?.setup?.id,
      route: this.route,
      rtt: measured,
      unstable,
      transport: this.networkTransport(),
    };
    window.parent?.postMessage(network, location.origin);
    const reportKey = `${network.route}:${network.transport}:${network.unstable}`;
    if (
      globalThis.partyEngine?.setup?.playerStreaming &&
      !this.networkReporting &&
      (reportKey !== this.networkReportKey || Date.now() - (this.networkReportedAt ?? 0) >= 8000)
    ) {
      this.networkReporting = true;
      this.networkReportKey = reportKey;
      this.networkReportedAt = Date.now();
      const deadline = requestDeadline(this.abort.signal, 8000);
      void fetch(`/engine/network/${network.matchId}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(network),
        signal: deadline.signal,
      })
        .catch(() => {})
        .finally(() => {
          deadline.clear();
          this.networkReporting = false;
        });
    }
  }
  networkTransport() {
    return ['lan', 'direct'].includes(this.route)
      ? 'rtc'
      : this.streamOpen || !this.polling
        ? 'websocket'
        : 'http';
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
      let transport = this.networkTransport();
      try {
        const local = window.parent?.partyLan;
        if (this.polling && this.route !== 'local' && local?.connected) {
          const result = await local.request('GET', '/ping');
          if (result.status !== 200) throw new Error('Local connection unavailable');
          this.setRoute(local.route ?? 'lan');
          route = this.route;
          transport = 'rtc';
        } else {
          if (['lan', 'direct'].includes(this.route)) this.setRoute('internet');
          route = this.route;
          if (this.streamOpen) {
            const id = ++this.pingId;
            await this.streamRequest(`ping-${id}`, { type: 'ping', id });
          } else {
            const response = await fetch('/api/health', {
              cache: 'no-store',
              credentials: 'same-origin',
              signal: deadline.signal,
            });
            if (!response.ok) throw new Error('Connection unavailable');
            await response.arrayBuffer();
          }
        }
        if (route === this.route && transport === this.networkTransport())
          this.reportNetwork(performance.now() - began);
      } catch {
        if (!this.abort.signal.aborted) this.reportNetwork(undefined, true);
      } finally {
        deadline.clear();
        running = false;
      }
    };
    this.networkTimer = setInterval(measure, 8000);
    this.measureNetwork = measure;
    window.addEventListener('online', measure, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', measure, { signal: this.abort.signal });
    void measure();
  }
  finish(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearInterval(this.networkTimer);
    this.abort.abort();
    this.stopStream();
    this.outgoing = [];
    this.outgoingBytes = 0;
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
