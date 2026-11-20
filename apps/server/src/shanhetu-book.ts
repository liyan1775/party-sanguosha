// SPDX-License-Identifier: GPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import rules from '../../../config/shanhetu-book.json' with { type: 'json' };
import growth from '../../../config/shanhetu-growth.json' with { type: 'json' };
import scenario from '../../../config/shanhetu-scenario.json' with { type: 'json' };
import { shanhetuDifficulty } from '../../../packages/noname-adapter/src/shanhetu.js';
import type {
  ShanhetuBookView,
  ShanhetuExpeditionAward,
} from '../../../packages/shared/src/shanhetu.js';
import { AppError } from './errors.js';

type Receipt = ShanhetuBookView['recent'][number] & {
  runId: string;
  unlocked: number[];
};
type Profile = {
  revision: number;
  legacySkills: number[];
  receipts: Receipt[];
};

const skills = new Map(growth.skills.map((skill) => [skill.id, skill]));
const maxReceipts = 10000;
const empty = (): Profile => ({ revision: 0, legacySkills: [], receipts: [] });
const totalVictories = (profile: Profile) =>
  profile.receipts.reduce((total, receipt) => total + receipt.victories, 0);
const unlockedSkills = (profile: Profile): Set<number> => {
  const victories = totalVictories(profile);
  return new Set([
    ...profile.legacySkills,
    ...rules.unlockMilestones
      .filter((milestone) => milestone.victories <= victories)
      .flatMap((milestone) => milestone.skills),
  ]);
};
const award = (receipt: Receipt): ShanhetuExpeditionAward => ({
  victories: receipt.victories,
  unlocked: receipt.unlocked.map((id) => skills.get(id)!.name),
});
const hasCleared = (profile: Profile, prerequisite: number | null) =>
  prerequisite === null ||
  profile.receipts.some(
    (receipt) => receipt.difficulty === prerequisite && receipt.outcome === 'victory',
  );

function validReceipt(receipt: Receipt): boolean {
  return (
    typeof receipt.runId === 'string' &&
    /^[\w-]{1,80}$/.test(receipt.runId) &&
    typeof receipt.hero === 'string' &&
    receipt.hero.length <= 80 &&
    Number.isSafeInteger(receipt.finishedAt) &&
    ['victory', 'defeat', 'retreat'].includes(receipt.outcome) &&
    Boolean(shanhetuDifficulty(receipt.difficulty)) &&
    Number.isSafeInteger(receipt.victories) &&
    receipt.victories >= (receipt.outcome === 'victory' ? 3 : 0) &&
    receipt.victories <= 1000 &&
    (receipt.historic === undefined || receipt.historic === true) &&
    (receipt.ending === undefined ||
      (receipt.outcome !== 'retreat' &&
        typeof receipt.ending === 'string' &&
        receipt.ending.length > 0 &&
        receipt.ending.length <= 24)) &&
    Array.isArray(receipt.unlocked) &&
    receipt.unlocked.every((id) => skills.has(id))
  );
}

function migrate(profile: {
  revision: number;
  learned: number[];
  receipts: (Omit<Receipt, 'difficulty' | 'victories' | 'unlocked'> & {
    difficulty?: number;
    albums: number;
  })[];
}): Profile {
  const legacySkills = profile.learned
    .map((id) => {
      const node = rules.nodes.find((node) => node.id === id);
      if (!node) throw new Error('legacy study');
      return node.plot;
    })
    .filter((id) => skills.has(id));
  const receipts = profile.receipts.map(({ albums, difficulty = 1, ...receipt }) => {
    const rule = shanhetuDifficulty(difficulty);
    if (
      !rule ||
      !['victory', 'defeat'].includes(receipt.outcome) ||
      albums !== (receipt.outcome === 'victory' ? rule.albums : 0)
    )
      throw new Error('legacy receipt');
    // A legacy clear confirms each of the three bosses. Other wins were not stored.
    return {
      ...receipt,
      difficulty,
      victories: receipt.outcome === 'victory' ? 3 : 0,
      historic: true as const,
      unlocked: [],
    };
  });
  return { revision: profile.revision, legacySkills, receipts };
}

/** The browser profile stores a ledger of resolved runs and their earned content only. */
export class ShanhetuBook {
  private readonly memory = new Map<string, Profile>();

  constructor(private readonly directory?: string) {}

  static profileKey(cookie: string): string {
    return createHash('sha256').update('shanhetu-s5\0').update(cookie).digest('hex');
  }

  view(key: string): ShanhetuBookView {
    const profile = this.read(key);
    const unlocked = unlockedSkills(profile);
    return {
      revision: profile.revision,
      victories: totalVictories(profile),
      difficulties: scenario.difficulties.map((rule) => {
        const bonuses = [
          rule.enemyHp ? `体力+${rule.enemyHp}` : '',
          rule.enemyCards ? `初始手牌+${rule.enemyCards}` : '',
          rule.enemyDraw ? `摸牌阶段摸牌+${rule.enemyDraw}` : '',
          rule.enemyExtraSha ? `出【杀】次数+${rule.enemyExtraSha}` : '',
          rule.enemyArmor ? `初始护甲+${rule.enemyArmor}` : '',
        ].filter(Boolean);
        return {
          id: rule.id,
          name: rule.name,
          description: [
            rule.preserveHp ? '战后保留当前体力。' : '',
            rule.tier === 2 ? '开放伊阙关、小平津。' : '',
            rule.tier >= 3
              ? '开放通往河内与酸枣的新路线。地形影响全场，第三章敌军获得护甲回复。'
              : '',
            bonuses.length ? `单名敌军${bonuses.join('，')}。` : '',
            rule.id >= 3 ? '部分首领有第二形态。' : '',
          ].join(''),
          unlockText: rule.unlockText,
          unlocked: hasCleared(profile, rule.prerequisite),
        };
      }),
      milestones: rules.unlockMilestones.map((milestone) => ({
        victories: milestone.victories,
        lesson: milestone.lesson,
        skills: milestone.skills.map((id) => {
          const { name, description } = skills.get(id)!;
          return { id, name, description, unlocked: unlocked.has(id) };
        }),
      })),
      recent: profile.receipts
        .slice(-10)
        .reverse()
        .map(({ hero, difficulty, outcome, victories, historic, ending, finishedAt }) => ({
          hero,
          difficulty,
          outcome,
          victories,
          ...(historic ? { historic } : {}),
          ...(ending ? { ending } : {}),
          finishedAt,
        })),
    };
  }

  unlockedForRun(key: string, difficulty: number): ReadonlySet<number> {
    const profile = this.read(key);
    const rule = shanhetuDifficulty(difficulty);
    if (!rule) throw new AppError(400, 'INVALID_DIFFICULTY', '请选择已接入的山河图难度。');
    if (!hasCleared(profile, rule.prerequisite))
      throw new AppError(409, 'DIFFICULTY_LOCKED', rule.unlockText);
    return unlockedSkills(profile);
  }

  record(
    key: string,
    result: Omit<Receipt, 'unlocked' | 'finishedAt' | 'historic'>,
  ): ShanhetuExpeditionAward {
    const profile = this.read(key);
    const previous = profile.receipts.find((receipt) => receipt.runId === result.runId);
    if (previous) return award(previous);
    if (profile.receipts.length >= maxReceipts)
      throw new AppError(409, 'BOOK_FULL', '本机山河册征程记录已满。');
    const before = unlockedSkills(profile);
    const receipt: Receipt = { ...result, finishedAt: Date.now(), unlocked: [] };
    if (!validReceipt(receipt)) throw new Error('无效的原生征程结算');
    profile.receipts.push(receipt);
    receipt.unlocked = [...unlockedSkills(profile)].filter((id) => !before.has(id));
    profile.revision++;
    this.write(key, profile);
    return award(receipt);
  }

  private file(key: string): string | undefined {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('无效的本机山河册凭据摘要');
    return this.directory ? join(this.directory, `${key}.json`) : undefined;
  }

  private read(key: string): Profile {
    const file = this.file(key);
    if (!file) return structuredClone(this.memory.get(key) ?? empty());
    if (!existsSync(file)) return empty();
    try {
      if (statSync(file).size > 4 * 1024 * 1024) throw new Error('size');
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored.scenarioId !== rules.scenarioId || ![1, 2].includes(stored.schemaVersion))
        throw new Error('version');
      const profile: Profile =
        stored.schemaVersion === 1 ? migrate(stored.profile) : stored.profile;
      if (
        !Number.isSafeInteger(profile.revision) ||
        profile.revision < 0 ||
        !Array.isArray(profile.legacySkills) ||
        profile.legacySkills.some((id) => !skills.has(id)) ||
        !Array.isArray(profile.receipts) ||
        profile.receipts.length > maxReceipts ||
        new Set(profile.receipts.map((receipt) => receipt.runId)).size !==
          profile.receipts.length ||
        profile.receipts.some((receipt) => !validReceipt(receipt))
      )
        throw new Error('schema');
      return profile;
    } catch {
      throw new AppError(
        503,
        'BOOK_READ_FAILED',
        '电脑上的山河册资料无法读取。请保留原文件后检查。',
      );
    }
  }

  private write(key: string, profile: Profile): void {
    const file = this.file(key);
    if (!file) {
      this.memory.set(key, profile);
      return;
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(this.directory!, { recursive: true });
      writeFileSync(
        temporary,
        JSON.stringify({ schemaVersion: 2, scenarioId: rules.scenarioId, profile }),
        { flag: 'wx', flush: true },
      );
      renameSync(temporary, file);
    } catch {
      if (existsSync(temporary)) {
        try {
          unlinkSync(temporary);
        } catch {
          /* A partial file is never read as a profile. */
        }
      }
      throw new AppError(503, 'BOOK_WRITE_FAILED', '电脑暂时无法保存山河册，请重试。');
    }
  }
}
