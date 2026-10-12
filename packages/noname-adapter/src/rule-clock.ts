import { WebSocket } from 'ws';

/** Only authenticated local rule executors use this clock. No game data crosses it. */
export class RuleClock {
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly due = new Set<number>();
  private socket: WebSocket | undefined;
  constructor(
    socket: WebSocket,
    private readonly retainOnDisconnect = false,
  ) {
    this.bind(socket);
  }
  bind(socket: WebSocket): void {
    this.socket = socket;
    for (const id of this.due) socket.send(JSON.stringify({ type: 'clock', id }));
    if (!this.retainOnDisconnect) this.due.clear();
    socket.on('message', (bytes) => {
      if (this.socket !== socket) return;
      try {
        const packet = JSON.parse(bytes.toString());
        if (
          !packet ||
          !Number.isSafeInteger(packet.id) ||
          packet.id >= 0 ||
          !['schedule', 'cancel', ...(this.retainOnDisconnect ? ['ack'] : [])].includes(packet.type)
        )
          throw new Error('Invalid clock request');
        if (packet.type === 'ack') {
          this.due.delete(packet.id);
          return;
        }
        if (packet.type === 'cancel') {
          clearTimeout(this.timers.get(packet.id));
          this.timers.delete(packet.id);
          this.due.delete(packet.id);
          return;
        }
        if (
          !Number.isInteger(packet.delay) ||
          packet.delay < 0 ||
          packet.delay > 2147483647 ||
          typeof packet.repeat !== 'boolean' ||
          this.timers.has(packet.id) ||
          this.due.has(packet.id) ||
          this.timers.size + this.due.size >= 8192
        )
          throw new Error('Invalid clock timer');
        const fire = () => {
          if (!packet.repeat) this.timers.delete(packet.id);
          // Retain delivery until its ID is acknowledged, including a frame
          // lost in flight just before a socket reports its disconnection.
          if (this.retainOnDisconnect) this.due.add(packet.id);
          if (this.socket?.readyState === WebSocket.OPEN)
            this.socket.send(JSON.stringify({ type: 'clock', id: packet.id }));
        };
        const timer = packet.repeat
          ? setInterval(fire, Math.max(1, packet.delay))
          : setTimeout(fire, Math.max(1, packet.delay));
        timer.unref();
        this.timers.set(packet.id, timer);
      } catch {
        socket.close(1008, '无效规则计时请求');
      }
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (!this.retainOnDisconnect) this.close();
    });
  }
  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.due.clear();
    this.socket = undefined;
  }
}
