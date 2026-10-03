import type { EngineStatus, RoomSettings } from '../../shared/src/contracts.js';

export interface MatchSetup {
  roomCode: string;
  settings: RoomSettings;
  playerIds: string[];
}

/** 只有适配器收到真实引擎的确认后，房间才能进入 playing。 */
export interface EngineAdapter {
  status(): EngineStatus;
  start(setup: MatchSetup): Promise<void>;
}

export class NonameAdapter implements EngineAdapter {
  status(): EngineStatus {
    return {
      id: 'noname',
      ready: false,
      message: '无名杀对局接入尚未完成，目前可以测试扫码、入座和准备。',
    };
  }

  async start(_setup: MatchSetup): Promise<void> {
    throw new Error('Noname adapter is not configured');
  }
}
