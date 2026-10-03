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

interface Player extends PlayerView {
  token: string;
  connections: number;
}

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
  private readonly players = new Map<string, Player>();
  private hostConnections = 0;
  private readonly listeners = new Set<(room: RoomView) => void>();

  constructor(
    private readonly engine: EngineAdapter,
    private readonly catalog: ExtensionInfo[] = [],
  ) {}

  snapshot(): RoomView {
    return {
      code: this.code,
      revision: this.revision,
      phase: this.phase,
      settings: { ...this.settings, extensions: [...this.settings.extensions] },
      players: [...this.players.values()].map(({ id, nickname, ready, online }) => ({
        id,
        nickname,
        ready,
        online,
      })),
      hostOnline: this.hostConnections > 0,
      engine: this.engine.status(),
    };
  }

  subscribe(listener: (room: RoomView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  session(token?: string): PlayerView | undefined {
    const player = token ? this.players.get(token) : undefined;
    return (
      player && {
        id: player.id,
        nickname: player.nickname,
        ready: player.ready,
        online: player.online,
      }
    );
  }

  join(code: unknown, nickname: unknown, token?: string): { token: string; playerId: string } {
    this.checkCode(code);
    this.assertWaiting();
    if (typeof nickname !== 'string') throw new AppError(400, 'INVALID_NICKNAME', '请填写昵称。');
    const cleanName = nickname.normalize('NFC').trim();
    if (!cleanName || [...cleanName].length > 16 || /[\p{Cc}\p{Cf}]/u.test(cleanName)) {
      throw new AppError(400, 'INVALID_NICKNAME', '昵称需要 1–16 个字，不能包含控制字符。');
    }
    const existing = token && this.players.get(token);
    if (existing) {
      existing.nickname = cleanName;
      this.changed();
      return { token: existing.token, playerId: existing.id };
    }
    if (this.players.size >= this.settings.playerCount)
      throw new AppError(409, 'ROOM_FULL', '房间已满，请联系房主调整人数。');
    const newToken = randomBytes(24).toString('base64url');
    const player: Player = {
      id: randomUUID(),
      token: newToken,
      nickname: cleanName,
      ready: false,
      online: false,
      connections: 0,
    };
    this.players.set(newToken, player);
    this.changed();
    return { token: newToken, playerId: player.id };
  }

  leave(token?: string): void {
    this.assertWaiting();
    if (!token || !this.players.delete(token))
      throw new AppError(401, 'PLAYER_REQUIRED', '请先加入房间。');
    this.changed();
  }

  removePlayer(id: string): void {
    this.assertWaiting();
    const player = [...this.players.values()].find((entry) => entry.id === id);
    if (!player) throw new AppError(404, 'PLAYER_NOT_FOUND', '这位玩家已离开。');
    this.players.delete(player.token);
    this.changed();
  }

  setReady(token: string | undefined, ready: unknown): void {
    this.assertWaiting();
    const player = token && this.players.get(token);
    if (!player) throw new AppError(401, 'PLAYER_REQUIRED', '请先加入房间。');
    if (typeof ready !== 'boolean') throw new AppError(400, 'INVALID_READY', '准备状态无效。');
    if (!player.online) throw new AppError(409, 'PLAYER_OFFLINE', '连接还未恢复，请稍后再试。');
    player.ready = ready;
    this.changed();
  }

  updateSettings(input: unknown): void {
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
    ) {
      throw new AppError(400, 'INVALID_MODE', '模式或人数不符合要求。');
    }
    if (!Array.isArray(body.extensions) || body.extensions.some((id) => typeof id !== 'string')) {
      throw new AppError(400, 'INVALID_EXTENSIONS', '扩展包设置无效。');
    }
    const extensions = [...new Set(body.extensions as string[])];
    if (!GENERAL_PRESETS.some((preset) => preset.id === body.generalPreset))
      throw new AppError(400, 'INVALID_PRESET', '请选择新手档或进阶档。');
    if (
      extensions.some(
        (id) =>
          !this.catalog.some((pack) => pack.id === id && pack.supportedModes.includes(mode.id)),
      )
    ) {
      throw new AppError(400, 'UNSUPPORTED_EXTENSION', '存在尚未验证或不支持当前模式的扩展包。');
    }
    if (this.players.size > (body.playerCount as number))
      throw new AppError(409, 'TOO_MANY_PLAYERS', '请先移出多余玩家，再减少人数。');
    const next: RoomSettings = {
      mode: mode.id,
      playerCount: body.playerCount as number,
      generalPreset: body.generalPreset as GeneralPresetId,
      extensions,
    };
    if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
    this.settings = next;
    for (const player of this.players.values()) player.ready = false;
    this.changed();
  }

  async start(): Promise<void> {
    this.assertWaiting();
    if (!this.engine.status().ready)
      throw new AppError(503, 'ENGINE_NOT_READY', this.engine.status().message);
    if (this.hostConnections === 0)
      throw new AppError(409, 'HOST_OFFLINE', '请保持电脑主控页面开启。');
    if (
      this.players.size !== this.settings.playerCount ||
      [...this.players.values()].some((player) => !player.online || !player.ready)
    ) {
      throw new AppError(409, 'PLAYERS_NOT_READY', '需要人数齐全且所有玩家在线、已准备。');
    }
    this.phase = 'starting';
    this.changed();
    try {
      await this.engine.start({
        roomCode: this.code,
        settings: structuredClone(this.settings),
        playerIds: [...this.players.values()].map((player) => player.id),
      });
      this.phase = 'playing';
      this.changed();
    } catch {
      this.phase = 'waiting';
      this.changed();
      throw new AppError(503, 'ENGINE_START_FAILED', '对局启动失败，房间已恢复，请检查电脑主控。');
    }
  }

  connect(token?: string, host = false): () => void {
    let closed = false;
    const player = token && this.players.get(token);
    if (player) {
      player.connections++;
      player.online = true;
    }
    if (host) this.hostConnections++;
    if (player || host) this.changed();
    return () => {
      if (closed) return;
      closed = true;
      if (player) {
        player.connections = Math.max(0, player.connections - 1);
        player.online = player.connections > 0;
        if (!player.online) player.ready = false;
      }
      if (host) this.hostConnections = Math.max(0, this.hostConnections - 1);
      if (player || host) this.changed();
    };
  }

  checkCode(code: unknown): void {
    if (code !== this.code)
      throw new AppError(404, 'ROOM_NOT_FOUND', '邀请已失效，请扫描电脑上的新二维码。');
  }

  private assertWaiting(): void {
    if (this.phase !== 'waiting')
      throw new AppError(409, 'ROOM_LOCKED', '对局已开始启动，暂时不能修改房间。');
  }

  private changed(): void {
    this.revision++;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
