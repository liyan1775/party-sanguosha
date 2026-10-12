// SPDX-License-Identifier: GPL-3.0-only

// Loaded before the rule clock replaces browser timers. The nonce lives only in
// this iframe: another/reloaded executor cannot resume this in-memory match.
const executionId = crypto.randomUUID();
const later = globalThis.setTimeout.bind(globalThis);
const cancel = globalThis.clearTimeout.bind(globalThis);

export class RecoverableRuleSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = `${url}?execution=${executionId}`;
    this.queue = [];
    this.bytes = 0;
    this.opened = false;
    this.closed = false;
    this.interruptedAt = 0;
    this.connect();
  }
  // After initial open, native sends may be buffered through a short outage.
  get readyState() {
    return this.closed ? WebSocket.CLOSED : this.opened ? WebSocket.OPEN : WebSocket.CONNECTING;
  }
  connect() {
    if (this.closed) return;
    const socket = (this.socket = new WebSocket(this.url));
    socket.addEventListener('open', () => {
      if (this.closed || socket !== this.socket) return socket.close();
      cancel(this.retry);
      cancel(this.deadline);
      this.interruptedAt = 0;
      const first = !this.opened;
      this.opened = true;
      for (const data of this.queue) socket.send(data);
      this.queue = [];
      this.bytes = 0;
      this.dispatchEvent(new Event(first ? 'open' : 'resume'));
    });
    socket.addEventListener('message', ({ data }) => {
      if (!this.closed && socket === this.socket)
        this.dispatchEvent(new MessageEvent('message', { data }));
    });
    socket.addEventListener('error', () => {});
    socket.addEventListener('close', ({ code }) => {
      if (this.closed || socket !== this.socket) return;
      // Policy rejection, explicit shutdown and lost execution ownership are
      // terminal. Never compete with another worker or start a fresh match.
      if ([1000, 1008, 4000].includes(code)) return this.close();
      if (!this.interruptedAt) {
        this.interruptedAt = Date.now();
        this.dispatchEvent(new Event('suspend'));
        this.deadline = later(() => this.close(), 20000);
        this.connect();
      } else {
        this.retry = later(() => this.connect(), 500);
      }
    });
  }
  send(data) {
    if (this.closed) return;
    if (this.socket.readyState === WebSocket.OPEN) return this.socket.send(data);
    const size = new TextEncoder().encode(data).byteLength;
    if (this.queue.length >= 512 || this.bytes + size > 4 * 1024 * 1024) {
      this.close();
      return;
    }
    this.queue.push(data);
    this.bytes += size;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    cancel(this.retry);
    cancel(this.deadline);
    this.queue = [];
    this.bytes = 0;
    this.socket.close(4000);
    this.dispatchEvent(new Event('close'));
  }
}
