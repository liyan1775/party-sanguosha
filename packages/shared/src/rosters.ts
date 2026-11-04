import type { GeneralPresetId } from './general-presets.js';

export interface CustomRosterRef {
  id: string;
  revision: number;
}

export interface CustomRosterSummary extends CustomRosterRef {
  name: string;
  basePreset: GeneralPresetId;
  characterCount: number;
  archived: boolean;
}

export interface ResolvedCustomRoster {
  summary: CustomRosterSummary;
  characters: string[];
  definitionPacks: { characters: string[]; cards: string[] };
  enabledPacks: string[];
  engineCommit: string;
  digest: string;
}

export interface CustomRosterGeneral {
  id: string;
  name: string;
  faction: string;
  hp: string;
  armor?: number;
  portrait: string;
  skills: { id: string; name: string; description: string }[];
  pack: string;
  officialNames: string[];
  sourcePresets: GeneralPresetId[];
}
