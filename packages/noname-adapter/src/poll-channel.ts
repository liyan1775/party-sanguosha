import type { ServerResponse } from 'node:http';

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
  constructor(
    id: string,
    playerId: string,
    private readonly disconnected: () => void,
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
    if (this.pending && !this.flush)
      this.flush = setTimeout(() => {
        this.flush = undefined;
        this.pending?.();
      }, 12);
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
  }
  read(after: number, response: ServerResponse) {
    this.touch();
    if (!Number.isSafeInteger(after) || after < 0 || after > this.sequence) {
      response.writeHead(400);
      response.end();
      return;
    }
    while (this.messages[0] && this.messages[0].sequence <= after) {
      this.bytes -= Buffer.byteLength(this.messages.shift()!.data);
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
      response.end(
        JSON.stringify({
          messages: this.messages,
          serverTime: Date.now(),
          closed: this.readyState !== 1,
          code: this.code,
          reason: this.reason,
        }),
      );
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
