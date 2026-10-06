import type { ServerResponse } from 'node:http';

export interface PollFrame {
  messages: { sequence: number; data: string; sentAt: number }[];
  serverTime: number;
  closed: boolean;
  code: number;
  reason: string;
}

/** Private, bounded message queue. Callers must authenticate the seat on every request. */
export class PollChannel {
  readonly id: string;
  readonly playerId: string;
  readyState = 1;
  expiresAt = Date.now() + 45000;
  incoming = 0;
  private sequence = 0;
  private bytes = 0;
  private code = 1000;
  private reason = '';
  private messages: { sequence: number; data: string; sentAt: number }[] = [];
  private pending?: () => void;
  private flush: NodeJS.Timeout | undefined;
  private subscriber?: (frame: PollFrame) => void;
  private streamed = 0;
  constructor(
    id: string,
    playerId: string,
    private readonly disconnected: () => void,
    readonly lightweight = false,
  ) {
    this.id = id;
    this.playerId = playerId;
  }
  touch() {
    this.expiresAt = Date.now() + 45000;
  }
  send(data: string) {
    if (this.readyState !== 1) return;
    this.bytes += Buffer.byteLength(data);
    if (this.bytes > 4 * 1024 * 1024 || this.messages.length >= 512) {
      this.close(1011, '连接过慢，正在恢复原座位');
      return;
    }
    this.messages.push({ sequence: ++this.sequence, data, sentAt: Date.now() });
    // Native actions emit several frames in adjacent tasks. One small window
    // avoids paying a public-network round trip for each of those frames.
    if ((this.pending || this.subscriber) && !this.flush)
      this.flush = setTimeout(
        () => {
          this.flush = undefined;
          this.pending?.();
          this.push();
        },
        this.subscriber ? 0 : 12,
      );
  }
  close(code = 1000, reason = '') {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.code = code;
    this.reason = reason;
    clearTimeout(this.flush);
    this.flush = undefined;
    this.disconnected();
    this.pending?.();
    this.push();
  }
  acknowledge(after: number): boolean {
    if (!Number.isSafeInteger(after) || after < 0 || after > this.sequence) return false;
    this.touch();
    while (this.messages[0] && this.messages[0].sequence <= after)
      this.bytes -= Buffer.byteLength(this.messages.shift()!.data);
    return true;
  }
  private frame(messages = this.messages): PollFrame {
    return {
      messages,
      serverTime: Date.now(),
      closed: this.readyState !== 1,
      code: this.code,
      reason: this.reason,
    };
  }
  private push() {
    if (!this.subscriber) return;
    const messages = this.messages.filter((message) => message.sequence > this.streamed);
    if (!messages.length && this.readyState === 1) return;
    this.streamed = messages.at(-1)?.sequence ?? this.streamed;
    this.subscriber(this.frame(messages));
  }
  listen(after: number, subscriber: (frame: PollFrame) => void): (() => void) | undefined {
    if (!this.acknowledge(after)) return undefined;
    this.subscriber = subscriber;
    this.streamed = after;
    this.push();
    return () => {
      if (this.subscriber === subscriber) delete this.subscriber;
    };
  }
  read(after: number, response: ServerResponse) {
    this.touch();
    if (!this.acknowledge(after)) {
      response.writeHead(400);
      response.end();
      return;
    }
    this.pending?.();
    const finish = () => {
      clearTimeout(timer);
      clearTimeout(this.flush);
      this.flush = undefined;
      if (this.pending === finish) delete this.pending;
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(this.frame()));
    };
    const timer = setTimeout(finish, 10000);
    this.pending = finish;
    response.once('close', () => {
      clearTimeout(timer);
      if (this.pending === finish) delete this.pending;
    });
    if (this.messages.length || this.readyState !== 1) finish();
  }
}
