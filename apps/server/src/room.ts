import { randomBytes, randomUUID } from 'node:crypto';
import type { EngineAdapter } from '../../../packages/noname-adapter/src/index.js';
import {
  findMode,
  GENERAL_PRESETS,
  type ExtensionInfo,
  type GeneralPresetId,
  type PlayerView,
  type RoomSettings,
  type RoomView,
} from '../../../packages/shared/src/contracts.js';
import { AppError } from './errors.js';

type Human = PlayerView & { kind: 'human'; token: string; connections: number };
type Bot = PlayerView & { kind: 'bot' };
type Seat = Human | Bot;

export class RoomStore {
  readonly code = randomBytes(3).toString('hex').toUpperCase();
  private revision = 0;
  private phase: RoomView['phase'] = 'waiting';
  private settings: RoomSettings = {
    mode: 'identity',
    playerCount: 5,
    generalPreset: 'beginner',
    extensions: [],
  };
  private ownerId: string | null = null;
  private botSequence = 0;
  private readonly players = new Map<string, Seat>();
  private readonly listeners = new Set<(room: RoomView) => void>();

  constructor(
    private readonly engine: EngineAdapter,
    private readonly catalog: ExtensionInfo[] = [],
  ) {
    const unsubscribe = engine.subscribe?.((event) => {
      if (event.type === 'status') this.changed();
      else if (event.roomCode === this.code && ['starting', 'playing'].includes(this.phase)) {
        this.phase = event.type === 'ended' ? 'finished' : 'waiting';
        if (event.type === 'failed') this.resetReady();
        this.changed();
      }
    });
    this.subscribe((room) => {
      if (room.phase === 'closed') unsubscribe?.();
    });
  }

  snapshot(): RoomView {
    return {
      code: this.code,
      revision: this.revision,
      phase: this.phase,
      matchId: this.engine.matchId?.(this.code) ?? null,
      settings: { ...this.settings, extensions: [...this.settings.extensions] },
      players: [...this.players.values()].map((player) => this.publicPlayer(player)),
      ownerId: this.ownerId,
      engine: this.engine.status(),
    };
  }

  subscribe(listener: (room: RoomView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  session(token?: string): PlayerView | undefined {
    const player = this.human(token);
    return player && this.publicPlayer(player);
  }

  join(nickname: unknown, token?: string): { token: string; playerId: string } {
    this.assertWaiting();
    if (typeof nickname !== 'string') throw new AppError(400, 'INVALID_NICKNAME', '请填写昵称。');
    const cleanName = nickname.normalize('NFC').trim();
    if (!cleanName || [...cleanName].length > 16 || /[\p{Cc}\p{Cf}]/u.test(cleanName))
      throw new AppError(400, 'INVALID_NICKNAME', '昵称需要 1–16 个字，不能包含控制字符。');
    const existing = this.human(token);
    if (existing) {
      existing.nickname = cleanName;
      this.changed();
      return { token: existing.token, playerId: existing.id };
    }
    if (this.players.size >= this.settings.playerCount)
      throw new AppError(409, 'ROOM_FULL', '房间已满，请联系房主调整人数或移除一个 AI。');
    const player: Human = {
      id: randomUUID(),
      token: randomBytes(24).toString('base64url'),
      kind: 'human',
      nickname: cleanName,
      ready: false,
      online: false,
      connections: 0,
    };
    this.players.set(player.id, player);
    this.ownerId ??= player.id;
    this.resetReady();
    this.changed();
    return { token: player.token, playerId: player.id };
  }

  leave(token?: string): void {
    this.assertWaiting();
    const player = this.human(token);
    if (!player) throw new AppError(401, 'PLAYER_REQUIRED', '请先加入房间。');
    this.players.delete(player.id);
    if (player.id === this.ownerId) {
      // 显式离开才交接房主；短暂断线或刷新保留原房主身份。
      const successor = [...this.players.values()].find((seat) => seat.kind === 'human');
      this.ownerId = successor?.id ?? null;
      if (!successor) {
        this.players.clear();
        this.phase = 'closed';
        this.engine.release?.(this.code);
      }
    }
    this.resetReady();
    this.changed();
  }

  removePlayer(id: string, ownerToken?: string): void {
    this.requireOwner(ownerToken);
    this.assertWaiting();
    if (id === this.ownerId)
      throw new AppError(400, 'OWNER_CANNOT_KICK_SELF', '请使用离开房间，房主会交接给下一位玩家。');
    if (!this.players.delete(id)) throw new AppError(404, 'PLAYER_NOT_FOUND', '这个座位已移除。');
    this.resetReady();
    this.changed();
  }

  addBots(count: unknown, ownerToken?: string): void {
    this.requireOwner(ownerToken);
    this.assertWaiting();
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 7)
      throw new AppError(400, 'INVALID_BOT_COUNT', '请选择要添加的 AI 数量。');
    if (this.players.size + (count as number) > this.settings.playerCount)
      throw new AppError(409, 'ROOM_FULL', '空位不足，请减少 AI 数量或调整总人数。');
    for (let index = 0; index < (count as number); index++) {
      const bot: Bot = {
        id: randomUUID(),
        nickname: `AI ${String(++this.botSequence).padStart(2, '0')}`,
        kind: 'bot',
        ready: true,
        online: true,
      };
      this.players.set(bot.id, bot);
    }
    this.resetReady();
    this.changed();
  }

  setReady(token: string | undefined, ready: unknown): void {
    this.assertWaiting();
    const player = this.human(token);
    if (!player) throw new AppError(401, 'PLAYER_REQUIRED', '请先加入房间。');
    if (typeof ready !== 'boolean') throw new AppError(400, 'INVALID_READY', '准备状态无效。');
    if (!player.online) throw new AppError(409, 'PLAYER_OFFLINE', '连接还未恢复，请稍后再试。');
    player.ready = ready;
    this.changed();
  }

  updateSettings(input: unknown, ownerToken?: string): void {
    this.requireOwner(ownerToken);
    this.assertWaiting();
    if (!input || typeof input !== 'object')
      throw new AppError(400, 'INVALID_SETTINGS', '房间设置无效。');
    const body = input as Record<string, unknown>;
    const mode = findMode(body.mode);
    if (
      !mode ||
      !Number.isInteger(body.playerCount) ||
      (body.playerCount as number) < mode.minPlayers ||
      (body.playerCount as number) > mode.maxPlayers
    )
      throw new AppError(400, 'INVALID_MODE', '模式或人数不符合要求。');
    if (!Array.isArray(body.extensions) || body.extensions.some((id) => typeof id !== 'string'))
      throw new AppError(400, 'INVALID_EXTENSIONS', '扩展包设置无效。');
    const extensions = [...new Set(body.extensions as string[])];
    if (!GENERAL_PRESETS.some((preset) => preset.id === body.generalPreset))
      throw new AppError(400, 'INVALID_PRESET', '请选择新手档或进阶档。');
    if (
      extensions.some(
        (id) =>
          !this.catalog.some((pack) => pack.id === id && pack.supportedModes.includes(mode.id)),
      )
    )
      throw new AppError(400, 'UNSUPPORTED_EXTENSION', '存在尚未验证或不支持当前模式的扩展包。');
    const humans = [...this.players.values()].filter((player) => player.kind === 'human');
    if (humans.length > (body.playerCount as number))
      throw new AppError(409, 'TOO_MANY_PLAYERS', '请先移出多余真人玩家，再减少人数。');
    const next: RoomSettings = {
      mode: mode.id,
      playerCount: body.playerCount as number,
      generalPreset: body.generalPreset as GeneralPresetId,
      extensions,
    };
    if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
    this.settings = next;
    // 缩小房间只裁掉多余 AI，绝不自动移出真人。
    for (const bot of [...this.players.values()].reverse()) {
      if (this.players.size <= next.playerCount) break;
      if (bot.kind === 'bot') this.players.delete(bot.id);
    }
    this.resetReady();
    this.changed();
  }

  async start(ownerToken?: string): Promise<void> {
    this.requireOwner(ownerToken);
    this.assertWaiting();
    if (!this.engine.status().ready)
      throw new AppError(503, 'ENGINE_NOT_READY', this.engine.status().message);
    if (
      this.players.size !== this.settings.playerCount ||
      [...this.players.values()].some((player) => !player.online || !player.ready)
    )
      throw new AppError(409, 'PLAYERS_NOT_READY', '需要人数齐全且所有真人在线、已准备。');
    this.phase = 'starting';
    try {
      const starting = this.engine.start({
        roomCode: this.code,
        ownerPlayerId: this.ownerId!,
        settings: structuredClone(this.settings),
        seats: [...this.players.values()].map(({ id, nickname, kind }) => ({ id, nickname, kind })),
        aiPolicy: 'strongest-native',
      });
      this.changed();
      await starting;
      if (this.phase === 'starting') this.phase = 'playing';
      this.changed();
    } catch {
      this.phase = 'waiting';
      this.changed();
      throw new AppError(
        503,
        'ENGINE_START_FAILED',
        '对局启动失败，房间已恢复，请查看电脑服务状态。',
      );
    }
  }

  returnToWaiting(ownerToken?: string): void {
    this.requireOwner(ownerToken);
    if (this.phase !== 'finished')
      throw new AppError(409, 'MATCH_NOT_FINISHED', '请等这一局结束后再返回房间。');
    this.engine.release?.(this.code);
    this.phase = 'waiting';
    this.resetReady();
    this.changed();
  }

  connect(token?: string): () => void {
    let closed = false;
    const player = this.human(token);
    if (player) {
      player.connections++;
      player.online = true;
      this.changed();
    }
    return () => {
      if (closed) return;
      closed = true;
      if (!player || this.players.get(player.id) !== player) return;
      player.connections = Math.max(0, player.connections - 1);
      player.online = player.connections > 0;
      if (!player.online) player.ready = false;
      this.changed();
    };
  }

  private human(token?: string): Human | undefined {
    return token
      ? [...this.players.values()].find(
          (seat): seat is Human => seat.kind === 'human' && seat.token === token,
        )
      : undefined;
  }

  private publicPlayer({ id, nickname, kind, ready, online }: Seat): PlayerView {
    return { id, nickname, kind, ready, online };
  }

  private requireOwner(token?: string): void {
    if (!this.ownerId || this.human(token)?.id !== this.ownerId)
      throw new AppError(403, 'OWNER_REQUIRED', '只有本房间的玩家房主可以进行这项操作。');
  }

  private resetReady(): void {
    for (const player of this.players.values()) player.ready = player.kind === 'bot';
  }

  private assertWaiting(): void {
    if (this.phase !== 'waiting')
      throw new AppError(409, 'ROOM_LOCKED', '房间已关闭或对局正在启动，暂时不能修改。');
  }

  private changed(): void {
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
