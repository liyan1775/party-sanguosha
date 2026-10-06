export const APP_ID = 'party-sanguosha';
export const APP_VERSION = '0.6.3';

export const MODES = [
  {
    id: 'identity',
    name: '经典身份局',
    minPlayers: 5,
    maxPlayers: 8,
    description: '主公、忠臣、反贼、内奸，5–8 人',
  },
  {
    id: 'doudizhu',
    name: '斗地主',
    minPlayers: 3,
    maxPlayers: 3,
    description: '一名地主，两名农民，3 人',
  },
  {
    id: 'versus',
    name: '2v2',
    minPlayers: 4,
    maxPlayers: 4,
    description: '两人一队，默契配合，4 人',
  },
  {
    id: 'duel',
    name: '单挑',
    minPlayers: 2,
    maxPlayers: 2,
    description: '两位玩家，面对面对决，2 人',
  },
] as const;

export type ModeId = (typeof MODES)[number]['id'];

export const GENERAL_PRESETS = [
  { id: 'beginner', name: '新手档', description: '标准包，适合一起熟悉规则' },
  { id: 'advanced', name: '进阶档', description: '界限突破 + 阴 + 雷 + 神话再临 12 神将' },
] as const;

export type GeneralPresetId = (typeof GENERAL_PRESETS)[number]['id'];

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  supportedModes: ModeId[];
}

export interface RoomSettings {
  mode: ModeId;
  playerCount: number;
  generalPreset: GeneralPresetId;
  extensions: string[];
}

export interface PlayerView {
  id: string;
  nickname: string;
  kind: 'human' | 'bot';
  ready: boolean;
  online: boolean;
}

export interface EngineStatus {
  id: 'noname';
  ready: boolean;
  message: string;
  preload?: boolean;
  lightweight?: boolean;
}

export interface RoomView {
  code: string;
  revision: number;
  phase: 'waiting' | 'starting' | 'playing' | 'finished' | 'closed';
  matchId: string | null;
  settings: RoomSettings;
  players: PlayerView[];
  ownerId: string | null;
  engine: EngineStatus;
}

export interface RoomSummary {
  code: string;
  ownerNickname: string;
  mode: ModeId;
  playerCount: number;
  humanCount: number;
  botCount: number;
  phase: RoomView['phase'];
}

export interface ServerInfo {
  version: string;
  homeUrls: string[];
  rooms: RoomSummary[];
  extensions: ExtensionInfo[];
  engine: EngineStatus;
  entry: EntryInfo;
}

export interface EntryInfo {
  mode: 'lan' | 'internet';
  /** Route used to reach this response, independent of public tunnel health. */
  access?: 'lan' | 'internet';
  status: 'starting' | 'ready' | 'unavailable';
  message: string;
}

export interface RoomInfo {
  room: RoomView;
  joinUrls: string[];
  entry: EntryInfo;
}

export interface SessionView {
  playerId: string | null;
  roomCode: string | null;
}

export interface MembershipResult extends RoomInfo {
  playerId: string;
}

export interface ApiError {
  error: { code: string; message: string };
}

/** Explicit public projection for the local observer; never native serialized state. */
export interface ObserverState {
  updatedAt: number;
  round: number;
  currentPlayerId: string | null;
  ended: boolean;
  players: {
    id: string;
    nickname: string;
    general: string;
    identity: string;
    hp: number;
    maxHp: number;
    armor: number;
    handCount: number;
    dead: boolean;
    linked: boolean;
    turnedOver: boolean;
    controller?: 'human' | 'auto' | 'offline' | 'bot';
    equipment: string[];
    judgments: string[];
  }[];
  recent: string[];
  /** Sequence of recent[0], plus total public log count (new rule workers). */
  logStart?: number;
  logTotal?: number;
  logFirst?: number;
}

export interface ObserverLogPage {
  matchId: string;
  total: number;
  first: number;
  entries: { sequence: number; text: string }[];
}

export interface PlayerNetwork {
  playerId: string;
  route: 'local' | 'lan' | 'direct' | 'internet';
  transport: 'websocket' | 'http' | 'rtc';
  rtt: number | null;
  unstable: boolean;
  updatedAt: number;
}

export interface ConsoleRoom {
  room: RoomView;
  observer: ObserverState | null;
  networks: PlayerNetwork[];
}

export interface ConsoleInfo {
  rooms: ConsoleRoom[];
}

export function findMode(id: unknown) {
  return MODES.find((mode) => mode.id === id);
}
