import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import presets from '../../../config/roster-presets.json' with { type: 'json' };
import guide from '../../../config/general-catalog.json' with { type: 'json' };
import inventory from '../../../config/native-character-inventory.json' with { type: 'json' };
import type {
  CustomRosterGeneral,
  GeneralPresetId,
  ResolvedCustomRoster,
} from '../../../packages/shared/src/contracts.js';
import { AppError } from './errors.js';
import { customRosterDigest } from '../../../packages/noname-adapter/src/custom-roster-policy.js';

type Revision = {
  revision: number;
  name: string;
  basePreset: GeneralPresetId;
  characters: string[];
  archived: boolean;
};
type Entry = { id: string; ownerHash: string; revisions: Revision[] };
const commit = guide.source.commit;
const maxLibraryBytes = 16 * 1024 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () =>
  new AppError(400, 'INVALID_ROSTER', '自定义将池无效，请选择已接入的武将和原有规则档。');

/** Only reviewed playable IDs enter this catalog; the larger inventory supplies labels only. */
export class RosterLibrary {
  private entries = new Map<string, Entry>();
  private readonly generals = new Map<string, CustomRosterGeneral>();
  private readonly file: string | undefined;

  constructor(directory?: string) {
    const native = new Map(inventory.characters.map((item) => [item.id, item]));
    for (const item of guide.characters) {
      const preset = presets.presets.find(
        (p) => p.id === item.preset && p.characters.includes(item.id),
      );
      const definition = native.get(item.id);
      if (!preset || !definition) throw new Error('将池图鉴与固定原生目录不一致');
      const previous = this.generals.get(item.id);
      const official = 'officialName' in item ? String(item.officialName) : item.name;
      if (previous) {
        if (!previous.sourcePresets.includes(item.preset as GeneralPresetId))
          previous.sourcePresets.push(item.preset as GeneralPresetId);
        if (!previous.officialNames.includes(official)) previous.officialNames.push(official);
      } else
        this.generals.set(item.id, {
          id: item.id,
          name: item.name,
          faction: item.faction,
          hp: item.hp,
          ...('armor' in item ? { armor: Number(item.armor) } : {}),
          portrait: item.portrait,
          skills: structuredClone(item.skills),
          pack: definition.pack,
          officialNames: [official],
          sourcePresets: [item.preset as GeneralPresetId],
        });
    }
    this.file = directory ? join(directory, 'library.json') : undefined;
    if (this.file && !existsSync(this.file) && existsSync(`${this.file}.bak`))
      throw new Error(
        '自定义将池库主文件缺失，备份已保留；请恢复 data/rosters/library.json.bak 后重试。',
      );
    if (this.file && existsSync(this.file)) {
      if (statSync(this.file).size > maxLibraryBytes)
        throw new Error('自定义将池库超过16 MiB上限；原文件和备份已保留，请整理后重试。');
      try {
        const data = JSON.parse(readFileSync(this.file, 'utf8'));
        if (
          data.schemaVersion !== 1 ||
          data.engineCommit !== commit ||
          !Array.isArray(data.entries) ||
          data.entries.length > 100
        )
          throw new Error('schema');
        for (const entry of data.entries) {
          if (
            !entry ||
            typeof entry.id !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(entry.id) ||
            typeof entry.ownerHash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(entry.ownerHash) ||
            this.entries.has(entry.id) ||
            !Array.isArray(entry.revisions) ||
            !entry.revisions.length ||
            entry.revisions.length > 1000
          )
            throw new Error('entry');
          for (const [index, revision] of entry.revisions.entries()) {
            if (revision.revision !== index + 1 || typeof revision.archived !== 'boolean')
              throw new Error('revision');
            this.validate(revision);
          }
          this.entries.set(entry.id, structuredClone(entry));
        }
      } catch {
        throw new Error(
          '自定义将池库损坏或引擎版本不匹配；已保留原文件和备份，请恢复 data/rosters/library.json.bak 后重试。',
        );
      }
    }
  }

  catalog(): CustomRosterGeneral[] {
    return structuredClone([...this.generals.values()]);
  }
  builtins() {
    return presets.presets.map(({ id, name, characters }) => ({
      id,
      name,
      characters: [...characters],
    }));
  }
  list(editor?: string) {
    return [...this.entries.values()].map((entry) => ({
      ...this.resolve(entry.id, entry.revisions.length).summary,
      editable: !!editor && entry.ownerHash === hash(editor),
    }));
  }
  resolve(id: string, revision: number): ResolvedCustomRoster {
    const stored = this.entries.get(id)?.revisions.find((item) => item.revision === revision);
    if (!stored) throw new AppError(404, 'ROSTER_NOT_FOUND', '这个将池版本不存在。');
    const base = presets.presets.find((p) => p.id === stored.basePreset)!;
    const sources = new Set([base.id]);
    for (const id of stored.characters) {
      const general = this.generals.get(id)!;
      sources.add(
        general.sourcePresets.includes(stored.basePreset)
          ? stored.basePreset
          : general.sourcePresets[0]!,
      );
    }
    const dependencies = presets.presets.filter((p) => sources.has(p.id));
    const resolved = {
      summary: {
        id,
        revision,
        name: stored.name,
        basePreset: stored.basePreset,
        characterCount: stored.characters.length,
        archived: stored.archived,
      },
      characters: [...stored.characters],
      definitionPacks: {
        characters: [...new Set(dependencies.flatMap((p) => p.definitionPacks.characters))],
        cards: [...new Set(dependencies.flatMap((p) => p.definitionPacks.cards))],
      },
      enabledPacks: [...new Set(stored.characters.map((id) => this.generals.get(id)!.pack))],
      engineCommit: commit,
    };
    return { ...resolved, digest: customRosterDigest(resolved) };
  }
  select(id: string, revision: number): ResolvedCustomRoster {
    if (this.entries.get(id)?.revisions.at(-1)?.archived)
      throw new AppError(409, 'ROSTER_ARCHIVED', '这个将池已归档，请复制后使用。');
    return this.resolve(id, revision);
  }

  private validate(input: unknown): Omit<Revision, 'revision' | 'archived'> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
    const body = input as Record<string, unknown>;
    if (
      typeof body.name !== 'string' ||
      typeof body.basePreset !== 'string' ||
      !presets.presets.some((p) => p.id === body.basePreset) ||
      !Array.isArray(body.characters)
    )
      throw invalid();
    const name = body.name.normalize('NFC').trim();
    if (
      !name ||
      [...name].length > 48 ||
      /[\p{Cc}\p{Cf}]/u.test(name) ||
      body.characters.length < 1 ||
      body.characters.length > this.generals.size ||
      new Set(body.characters).size !== body.characters.length ||
      body.characters.some((id) => typeof id !== 'string' || !this.generals.has(id))
    )
      throw invalid();
    return {
      name,
      basePreset: body.basePreset as GeneralPresetId,
      characters: [...body.characters] as string[],
    };
  }

  save(input: unknown, editor: string, id?: string) {
    const value = this.validate(input);
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !['name', 'basePreset', 'characters', 'expectedRevision'].includes(key),
      )
    )
      throw invalid();
    const previous = id ? this.editable(id, body.expectedRevision, editor) : undefined;
    if (!previous && this.entries.size >= 100)
      throw new AppError(409, 'ROSTER_LIMIT', '本机最多保存100个自定义将池。');
    const entry: Entry = previous
      ? structuredClone(previous)
      : { id: randomUUID(), ownerHash: hash(editor), revisions: [] };
    if (entry.revisions.length >= 1000)
      throw new AppError(409, 'ROSTER_LIMIT', '版本过多，请复制为新将池。');
    entry.revisions.push({ ...value, revision: entry.revisions.length + 1, archived: false });
    this.commit(entry);
    return this.resolve(entry.id, entry.revisions.length).summary;
  }
  archive(id: string, expectedRevision: unknown, editor: string) {
    const entry = structuredClone(this.editable(id, expectedRevision, editor));
    if (entry.revisions.length >= 1000)
      throw new AppError(409, 'ROSTER_LIMIT', '版本过多，无法追加归档版本。');
    entry.revisions.push({
      ...structuredClone(entry.revisions.at(-1)!),
      revision: entry.revisions.length + 1,
      archived: true,
    });
    this.commit(entry);
  }
  private editable(id: string, expectedRevision: unknown, editor: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new AppError(404, 'ROSTER_NOT_FOUND', '这个将池不存在。');
    if (entry.ownerHash !== hash(editor))
      throw new AppError(
        403,
        'ROSTER_EDITOR_REQUIRED',
        '只能修改自己保存的将池；其他将池可以复制。',
      );
    if (expectedRevision !== entry.revisions.length)
      throw new AppError(409, 'ROSTER_REVISION_CONFLICT', '将池已更新，请重新载入后保存。');
    return entry;
  }
  private commit(entry: Entry) {
    const next = new Map(this.entries);
    next.set(entry.id, entry);
    if (this.file) {
      const temporary = `${this.file}.tmp`;
      const serialized = JSON.stringify({
        schemaVersion: 1,
        engineCommit: commit,
        entries: [...next.values()],
      });
      if (Buffer.byteLength(serialized) > maxLibraryBytes)
        throw new AppError(409, 'ROSTER_LIMIT', '本机将池库已达到16 MiB上限，无法再保存新版本。');
      mkdirSync(join(this.file, '..'), { recursive: true });
      writeFileSync(temporary, serialized, { mode: 0o600 });
      if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
      renameSync(temporary, this.file);
    }
    this.entries = next;
  }
}
