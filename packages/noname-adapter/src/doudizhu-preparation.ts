// SPDX-License-Identifier: GPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto';
import inventory from '../../../config/native-character-inventory.json' with { type: 'json' };
import rosters from '../../../config/roster-presets.json' with { type: 'json' };
import type { DoudizhuPrivateState, DoudizhuPublicState } from '../../shared/src/contracts.js';
import type { MatchSetup } from './index.js';

export class PreparationError extends Error {}
type Seat = MatchSetup['seats'][number] & {
  candidates: string[];
  revision: number;
  replacementsLeft: number;
  selected: string | null;
  locked: boolean;
};
const rankNames = ['D', 'C', 'B−', 'B', 'B+', 'A−', 'A', 'A+', 'S'];
const ranks = new Map(
  inventory.characters.map((c) => [c.id, rankNames.indexOf(c.nativeRank ?? '') + 1]),
);
const rank = (id: string) => ranks.get(id) || 4;

/** Four registration slots exist before a college game's three native players. */
export class DoudizhuPreparation {
  readonly id = randomUUID();
  readonly result: Promise<MatchSetup>;
  private resolve!: (setup: MatchSetup) => void;
  private reject!: (error: Error) => void;
  private phase: DoudizhuPublicState['phase'] = 'bidding';
  private phaseId = randomUUID();
  private deadline = 0;
  private timer?: NodeJS.Timeout;
  private highestBid = 0;
  private bids: DoudizhuPublicState['bids'] = [];
  private landlordId: string | null = null;
  private active: Seat[] = [];
  private completed = false;
  private pool: string[];
  private readonly seats: Seat[];
  private readonly college: boolean;
  private readonly maxBid: number;
  readonly firstBidIndex: number;

  constructor(
    private readonly setup: MatchSetup,
    firstBidIndex: number | undefined,
    private readonly changed: () => void,
    private readonly durationMs = 60000,
  ) {
    this.college = setup.settings.mode === 'college';
    if (this.college && setup.customRoster) throw new PreparationError('高校练习使用固定高校将池');
    this.maxBid = this.college ? 4 : 3;
    if (setup.seats.length !== (this.college ? 4 : 3)) throw new PreparationError('报名人数不符');
    const preset = rosters.presets.find((p) => p.id === setup.settings.generalPreset);
    if (!preset) throw new PreparationError('缺少本局武将名单');
    this.pool = [...(setup.customRoster?.characters ?? preset.characters)];
    // Ordinary bidding needs 18 disjoint initial choices plus four landlord additions.
    // College also consumes up to two fresh replacements for each active seat.
    if (new Set(this.pool).size !== this.pool.length || this.pool.length < 22)
      throw new PreparationError('本局武将不足以保留既有候选和换将额度');
    this.firstBidIndex = firstBidIndex ?? randomInt(setup.seats.length);
    if (
      !Number.isInteger(this.firstBidIndex) ||
      this.firstBidIndex < 0 ||
      this.firstBidIndex >= setup.seats.length
    )
      throw new PreparationError('先叫位无效');
    const preferences = this.college ? {} : (setup.generalSelections ?? {});
    const reserved = new Set(Object.values(preferences));
    if (
      reserved.size !== Object.values(preferences).length ||
      [...reserved].some((id) => !this.pool.includes(id))
    )
      throw new PreparationError('点将意向无效');
    this.pool = this.pool.filter((id) => !reserved.has(id));
    this.seats = setup.seats.map((seat) => ({
      ...seat,
      candidates: preferences[seat.id] ? [preferences[seat.id]!] : [],
      revision: 0,
      replacementsLeft: this.college ? 2 : 0,
      selected: null,
      locked: false,
    }));
    for (const seat of this.seats)
      while (seat.candidates.length < (this.college ? 4 : 6)) seat.candidates.push(this.draw());
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.beginBid();
  }

  private draw(): string {
    if (!this.pool.length) throw new PreparationError('本局剩余武将不足');
    return this.pool.splice(randomInt(this.pool.length), 1)[0]!;
  }
  private teammate(seat: Seat): Seat | undefined {
    return this.college ? this.seats[(this.seats.indexOf(seat) + 2) % 4] : undefined;
  }
  private controller(seat: Seat): string | null {
    if (seat.kind === 'human') return seat.id;
    const mate = this.teammate(seat);
    return mate?.kind === 'human' ? mate.id : null;
  }
  private bidder(): Seat | undefined {
    return this.phase === 'bidding'
      ? this.seats[(this.firstBidIndex + this.bids.length) % this.seats.length]
      : undefined;
  }
  publicState(): DoudizhuPublicState {
    return {
      id: this.id,
      phase: this.phase,
      phaseId: this.phaseId,
      deadline: this.deadline,
      bidSeatId: this.bidder()?.id ?? null,
      highestBid: this.highestBid,
      bids: this.bids.map((b) => ({ ...b })),
      landlordId: this.landlordId,
      activeSeatIds: this.active.map((s) => s.id),
      controllers: Object.fromEntries(
        this.active.flatMap((s) => {
          const controller =
            s.id === this.landlordId ? this.controller(s) : s.kind === 'human' ? s.id : null;
          return controller ? [[s.id, controller]] : [];
        }),
      ),
    };
  }
  privateState(playerId: string): DoudizhuPrivateState {
    const visible = this.phase === 'bidding' ? this.seats : this.active;
    const viewer = this.seats.find((s) => s.id === playerId && s.kind === 'human');
    const mate = viewer && this.teammate(viewer);
    const describe = (s: Seat): DoudizhuPrivateState['seats'][number] => ({
      id: s.id,
      nickname: s.nickname,
      revision: s.revision,
      candidates: [...s.candidates],
      replacementsLeft: s.replacementsLeft,
      selected: s.selected,
      locked: s.locked,
      role:
        this.phase === 'bidding' ? 'candidate' : s.id === this.landlordId ? 'landlord' : 'farmer',
    });
    return {
      preparation: this.publicState(),
      maxBid: this.maxBid,
      seats: visible.filter((s) => this.controller(s) === playerId).map(describe),
      teammates:
        mate && visible.includes(mate) && this.controller(mate) !== playerId
          ? [describe(mate)]
          : [],
    };
  }
  action(playerId: string, input: unknown): void {
    if (!input || typeof input !== 'object') throw new PreparationError('无效赛前操作');
    const body = input as Record<string, unknown>;
    if (
      this.completed ||
      body.id !== this.id ||
      body.phaseId !== this.phaseId ||
      Date.now() >= this.deadline
    )
      throw new PreparationError('阶段已变化或超时，请同步当前选择');
    const seat = this.seats.find((s) => s.id === body.seatId);
    if (!seat || this.controller(seat) !== playerId || body.revision !== seat.revision)
      throw new PreparationError('无权操作这个席位，或结果已更新');
    if (body.action === 'bid' && this.phase === 'bidding' && this.bidder() === seat) {
      this.bid(seat, body.bid);
    } else if (this.phase === 'choosing' && this.active.includes(seat) && !seat.locked) {
      if (body.action === 'replace' && typeof body.general === 'string')
        this.replace(seat, body.general);
      else if (
        body.action === 'choose' &&
        typeof body.general === 'string' &&
        seat.candidates.includes(body.general)
      ) {
        seat.selected = body.general;
        seat.locked = true;
        seat.revision++;
      } else throw new PreparationError('请选择本席候选中的武将');
      this.changed();
      this.maybeFinish();
    } else throw new PreparationError('现在不能进行这项操作');
  }
  private beginBid(): void {
    clearTimeout(this.timer);
    const seat = this.bidder()!;
    this.deadline = Date.now() + this.durationMs;
    this.timer = setTimeout(() => this.bid(seat, 0), this.controller(seat) ? this.durationMs : 0);
    if (!this.controller(seat)) {
      clearTimeout(this.timer);
      const best = Math.max(...seat.candidates.map(rank));
      const ceiling = Math.min(this.maxBid, Math.max(0, best - 5));
      this.timer = setTimeout(() => this.bid(seat, ceiling > this.highestBid ? ceiling : 0), 0);
    }
    this.timer.unref();
  }
  private bid(seat: Seat, value: unknown): void {
    if (this.completed || this.bidder() !== seat) return;
    if (
      !Number.isInteger(value) ||
      (value !== 0 && ((value as number) <= this.highestBid || (value as number) > this.maxBid))
    )
      throw new PreparationError('只能不叫，或叫更高的有效倍数');
    clearTimeout(this.timer);
    const bid = value as number;
    this.bids.push({ seatId: seat.id, bid });
    seat.revision++;
    if (bid > this.highestBid) {
      this.highestBid = bid;
      this.landlordId = seat.id;
    }
    if (bid === this.maxBid || this.bids.length === this.seats.length) this.beginChoices();
    else this.beginBid();
    this.changed();
  }
  private beginChoices(): void {
    this.highestBid ||= 1;
    this.landlordId ??= this.seats[this.firstBidIndex]!.id;
    const lord = this.seats.find((s) => s.id === this.landlordId)!;
    const mate = this.teammate(lord);
    if (mate) {
      const choices = [...mate.candidates];
      for (let i = 0; i < 2; i++)
        lord.candidates.push(choices.splice(randomInt(choices.length), 1)[0]!);
    } else for (let i = 0; i < 4; i++) lord.candidates.push(this.draw());
    const start = this.seats.indexOf(lord);
    this.active = [
      lord,
      ...Array.from(
        { length: this.seats.length - 1 },
        (_, i) => this.seats[(start + i + 1) % this.seats.length]!,
      ).filter((s) => s !== mate),
    ];
    this.phase = 'choosing';
    this.phaseId = randomUUID();
    this.deadline = Date.now() + this.durationMs;
    for (const seat of this.active) {
      if (!this.controller(seat)) {
        while (seat.replacementsLeft > 0 && Math.min(...seat.candidates.map(rank)) < 6)
          this.replace(seat, [...seat.candidates].sort((a, b) => rank(a) - rank(b))[0]!);
        seat.locked = true; // The native engine selects within this legal pool.
      }
    }
    this.timer = setTimeout(() => {
      for (const seat of this.active) seat.locked = true;
      this.maybeFinish();
    }, this.durationMs);
    this.timer.unref();
    this.maybeFinish();
  }
  private replace(seat: Seat, general: string): void {
    const index = seat.candidates.indexOf(general);
    if (seat.replacementsLeft <= 0 || index < 0)
      throw new PreparationError('本席换将额度不足或候选已变化');
    seat.candidates[index] = this.draw();
    seat.replacementsLeft--;
    seat.revision++;
  }
  private maybeFinish(): void {
    if (this.completed || !this.active.every((s) => s.locked)) return;
    clearTimeout(this.timer);
    this.completed = true;
    this.phase = 'ready';
    const seats = this.active.map((seat) => {
      const controllerId =
        seat.id === this.landlordId
          ? this.controller(seat)
          : seat.kind === 'human'
            ? seat.id
            : null;
      return {
        id: seat.id,
        nickname: seat.nickname,
        kind: controllerId ? ('human' as const) : ('bot' as const),
        ...(controllerId && controllerId !== seat.id ? { controllerId } : {}),
      };
    });
    this.resolve({
      ...this.setup,
      seats,
      doudizhu: {
        preparationId: this.id,
        landlordId: this.landlordId!,
        multiplier: this.highestBid,
        candidates: Object.fromEntries(this.active.map((s) => [s.id, [...s.candidates]])),
        selectedGenerals: Object.fromEntries(
          this.active.flatMap((s) => (s.selected ? [[s.id, s.selected]] : [])),
        ),
        members: this.setup.seats.map(({ id, nickname, kind }) => ({ id, nickname, kind })),
      },
    });
    this.changed();
  }
  cancel(): void {
    clearTimeout(this.timer);
    if (!this.completed) {
      this.completed = true;
      this.reject(new PreparationError('赛前流程已结束'));
    }
  }
}
