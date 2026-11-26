import { randomBytes } from 'node:crypto';
import type { EngineAdapter } from '../../../packages/noname-adapter/src/index.js';
import type {
  ExtensionInfo,
  RoomSummary,
  SessionView,
  ResolvedCustomRoster,
} from '../../../packages/shared/src/contracts.js';
import {
  QUICK_PLAY_PRESETS,
  type QuickPlayPresetId,
} from '../../../packages/shared/src/contracts.js';
import { AppError } from './errors.js';
import { normalizeNickname, RoomStore } from './room.js';

export class PresetRoomConflict extends AppError {
  constructor(readonly roomCode: string) {
    super(409, 'ALREADY_IN_ROOM', `请先返回房间 ${roomCode}，结束当前活动或离开房间后再切换场景。`);
  }
}

/** 电脑只提供服务；房间由玩家创建，房主权限来自该房间的真人席位。 */
export class LobbyStore {
  private readonly rooms = new Map<string, RoomStore>();
  private readonly listeners = new Set<(rooms: RoomSummary[]) => void>();
  private readonly sessions = new Map<string, number>();
  private readonly presetRequests = new Map<string, Map<string, string>>();

  constructor(
    private readonly engine: EngineAdapter,
    private readonly catalog: ExtensionInfo[] = [],
    private readonly resolveRoster?: (id: string, revision: number) => ResolvedCustomRoster,
  ) {}

  shutdownBlocker(): string | undefined {
    for (const room of this.rooms.values()) {
      const reason = room.shutdownBlocker();
      if (reason) return reason;
    }
    return undefined;
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].map((store) => {
      const room = store.snapshot();
      return {
        code: room.code,
        ownerNickname: room.players.find((player) => player.id === room.ownerId)?.nickname ?? '',
        mode: room.settings.mode,
        generalPreset: room.settings.generalPreset,
        ...(room.roster ? { rosterName: room.roster.name } : {}),
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
      if (expiry <= now && !this.session(token).roomCode) {
        this.sessions.delete(token);
        this.presetRequests.delete(token);
      }
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
    const room = this.newRoom();
    const player = room.join(nickname, token);
    this.register(room);
    return { room, ...player };
  }

  createPreset(body: Record<string, unknown>, token?: string) {
    const { presetId, fillBots = false, requestId, requireUnseated = false } = body;
    if (typeof presetId !== 'string' || !Object.hasOwn(QUICK_PLAY_PRESETS, presetId))
      throw new AppError(400, 'INVALID_QUICK_PRESET', '请选择可用的快捷场景。');
    if (typeof fillBots !== 'boolean')
      throw new AppError(400, 'INVALID_FILL_BOTS', '请选择是否用 AI 补齐空位。');
    if (typeof requireUnseated !== 'boolean')
      throw new AppError(400, 'INVALID_SEAT_REQUIREMENT', '开桌的座位条件无效。');
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' || !/^[\w-]{1,128}$/.test(requestId))
    )
      throw new AppError(400, 'INVALID_REQUEST_ID', '快捷开桌请求编号无效。');
    const nickname = normalizeNickname(body.nickname);
    token = this.identify(token);
    const requests = this.presetRequests.get(token) ?? new Map<string, string>();
    const previousCode = requestId === undefined ? undefined : requests.get(requestId);
    if (previousCode) {
      const previous = this.rooms.get(previousCode);
      const player = previous?.session(token);
      if (!player || !previous) throw new PresetRoomConflict(previousCode);
      return { room: previous, token, playerId: player.id, reused: true };
    }
    const current = this.session(token);
    const room = current.roomCode ? this.get(current.roomCode) : this.newRoom();
    if (current.roomCode && (requireUnseated || !room.canSwitchPreset(token)))
      throw new PresetRoomConflict(current.roomCode);
    const playerId = current.playerId ?? room.join(nickname, token).playerId;
    room.applyPreset(QUICK_PLAY_PRESETS[presetId as QuickPlayPresetId], nickname, fillBots, token);
    if (requestId !== undefined) {
      requests.set(requestId, room.code);
      this.presetRequests.set(token, requests);
    }
    if (!current.roomCode) this.register(room);
    return { room, token, playerId, reused: !!current.roomCode };
  }

  private newRoom(): RoomStore {
    let room = new RoomStore(this.engine, this.catalog, this.resolveRoster);
    while (this.rooms.has(room.code))
      room = new RoomStore(this.engine, this.catalog, this.resolveRoster);
    return room;
  }

  private register(room: RoomStore): void {
    this.rooms.set(room.code, room);
    const unsubscribe = room.subscribe((snapshot) => {
      if (snapshot.phase === 'closed') {
        this.rooms.delete(room.code);
        unsubscribe();
      }
      this.changed();
    });
    this.changed();
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
