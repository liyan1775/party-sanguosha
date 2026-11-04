import type {
  EngineStatus,
  MatchFailureCode,
  ResolvedCustomRoster,
  RoomSettings,
} from '../../shared/src/contracts.js';

export interface MatchSetup {
  roomCode: string;
  ownerPlayerId: string;
  settings: RoomSettings;
  /** Immutable, server-resolved whitelist; the inherited preset still controls rules and deck. */
  customRoster?: ResolvedCustomRoster;
  seats: { id: string; nickname: string; kind: 'human' | 'bot'; controllerId?: string }[];
  /** 复用上游完整原生 AI 决策；不是玩家可调的难度或对人类仇视程度。 */
  aiPolicy: 'strongest-native';
  /** Private lobby preferences; only the rule worker receives the complete map. */
  generalSelections?: Record<string, string>;
  doudizhu?: {
    preparationId: string;
    landlordId: string;
    multiplier: number;
    candidates: Record<string, string[]>;
    selectedGenerals: Record<string, string>;
    members: { id: string; nickname: string; kind: 'human' | 'bot' }[];
  };
}

/** 只有适配器收到真实引擎的确认后，房间才能进入 playing。 */
export interface EngineAdapter {
  status(): EngineStatus;
  start(setup: MatchSetup): Promise<void>;
  matchId?(roomCode: string): string | null;
  subscribe?(listener: (event: EngineEvent) => void): () => void;
  release?(roomCode: string): void;
}

export type EngineEvent =
  | { type: 'status' }
  | { type: 'ended'; roomCode: string; matchId?: string; winner?: 'landlord' | 'farmers' | null }
  | { type: 'recovered'; roomCode: string }
  | { type: 'failed'; roomCode: string; code?: MatchFailureCode }
  | { type: 'recovering'; roomCode: string; deadline: number };

export class NonameAdapter implements EngineAdapter {
  status(): EngineStatus {
    return {
      id: 'noname',
      ready: false,
      message: '无名杀对局与 AI 出牌尚未接入，目前可以测试建房、邀请、AI 席位和准备。',
    };
  }

  async start(_setup: MatchSetup): Promise<void> {
    throw new Error('Noname adapter is not configured');
  }
}
