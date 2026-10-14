import { randomBytes } from 'node:crypto';
import type { EngineAdapter } from '../../../packages/noname-adapter/src/index.js';
import type {
  ExtensionInfo,
  RoomSummary,
  SessionView,
} from '../../../packages/shared/src/contracts.js';
import { AppError } from './errors.js';
import { normalizeNickname, RoomStore } from './room.js';

/** 电脑只提供服务；房间由玩家创建，房主权限来自该房间的真人席位。 */
export class LobbyStore {
  private readonly rooms = new Map<string, RoomStore>();
  private readonly listeners = new Set<(rooms: RoomSummary[]) => void>();
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly engine: EngineAdapter,
    private readonly catalog: ExtensionInfo[] = [],
  ) {}

  list(): RoomSummary[] {
    return [...this.rooms.values()].map((store) => {
      const room = store.snapshot();
      return {
        code: room.code,
        ownerNickname: room.players.find((player) => player.id === room.ownerId)?.nickname ?? '',
        mode: room.settings.mode,
        playerCount: room.settings.playerCount,
        humanCount: room.players.filter((player) => player.kind === 'human').length,
        botCount: room.players.filter((player) => player.kind === 'bot').length,
        phase: room.phase,
      };
    });
  }

  get(code: string): RoomStore {
    const room = this.rooms.get(code);
    if (!room)
      throw new AppError(404, 'ROOM_NOT_FOUND', '这个房间已关闭，请返回主页或让朋友重新分享邀请。');
    return room;
  }

  session(token?: string): SessionView {
    for (const room of this.rooms.values()) {
      const player = room.session(token);
      if (player) return { roomCode: room.code, playerId: player.id };
    }
    return { roomCode: null, playerId: null };
  }

  /** Browser identity exists before seating, so concurrent requests share one membership. */
  identify(token?: string, now = Date.now()): string {
    if (!token || ((this.sessions.get(token) ?? 0) <= now && !this.session(token).roomCode))
      token = randomBytes(24).toString('base64url');
    this.sessions.set(token, now + 86400000);
    return token;
  }

  expireSessions(now = Date.now()): void {
    for (const [token, expiry] of this.sessions)
      if (expiry <= now && !this.session(token).roomCode) this.sessions.delete(token);
  }

  sweep(now = Date.now()): void {
    for (const room of [...this.rooms.values()]) {
      room.expirePolls(now);
      room.reapIfIdle(now);
    }
    this.expireSessions(now);
  }

  create(nickname: unknown, token?: string) {
    nickname = normalizeNickname(nickname);
    token = this.identify(token);
    this.assertAvailable(token);
    let room = new RoomStore(this.engine, this.catalog);
    while (this.rooms.has(room.code)) room = new RoomStore(this.engine, this.catalog);
    const player = room.join(nickname, token);
    this.rooms.set(room.code, room);
    const unsubscribe = room.subscribe((snapshot) => {
      if (snapshot.phase === 'closed') {
        this.rooms.delete(room.code);
        unsubscribe();
      }
      this.changed();
    });
    this.changed();
    return { room, ...player };
  }

  join(code: string, nickname: unknown, token?: string) {
    const room = this.get(code);
    nickname = normalizeNickname(nickname);
    token = this.identify(token);
    this.assertAvailable(token, code);
    return { room, ...room.join(nickname, token) };
  }

  subscribe(listener: (rooms: RoomSummary[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private assertAvailable(token?: string, targetCode?: string): void {
    const current = this.session(token);
    if (current.roomCode && current.roomCode !== targetCode)
      throw new AppError(
        409,
        'ALREADY_IN_ROOM',
        `你已经在房间 ${current.roomCode}，请先离开再加入另一间。`,
      );
  }

  private changed(): void {
    const rooms = this.list();
    for (const listener of this.listeners) listener(rooms);
  }
}
