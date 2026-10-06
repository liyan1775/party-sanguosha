/** Private seat view. Never include this model in room snapshots or public logs. */
export interface TableItem {
  key: string;
  action: string;
  kind: 'card' | 'general' | 'control' | 'text';
  label: string;
  detail: string;
  image: string;
  suit: string;
  number: string;
  selected: boolean;
  enabled: boolean;
}

export interface TablePlayer {
  id: string;
  nickname: string;
  general: string;
  image: string;
  identity: string;
  hp: number;
  maxHp: number;
  armor: number;
  handCount: number;
  dead: boolean;
  linked: boolean;
  turned: boolean;
  current: boolean;
  selected: boolean;
  action: string;
  equipment: TableItem[];
  judgments: TableItem[];
  marks: { label: string; detail: string }[];
  abilities: { label: string; detail: string }[];
}

export interface TableDialog {
  key: string;
  text: string;
  items: TableItem[];
  /** Separate native card pools, e.g. 魄袭's own and target hands. */
  groups?: { label: string; items: TableItem[] }[];
  zones: { label: string; action: string; items: TableItem[] }[];
}

export interface TableState {
  epoch: string;
  revision: number;
  choice: number;
  playerId: string;
  round: number;
  phase: string;
  prompt: string;
  choosing: boolean;
  auto: boolean;
  over: boolean;
  result: string;
  players: TablePlayer[];
  hand: TableItem[];
  controls: TableItem[];
  skills: TableItem[];
  dialogs: TableDialog[];
  played: TableItem[];
  abilities: { label: string; detail: string }[];
  autoAction: string;
  events?: TablePresentation[];
  presentedAt?: number;
}

/** Already authorized for this seat; no physical IDs or native objects. */
export interface TablePresentation {
  id: number;
  at: number;
  kind:
    | 'draw'
    | 'throw'
    | 'use'
    | 'respond'
    | 'damage'
    | 'health'
    | 'popup'
    | 'skill'
    | 'turn'
    | 'death';
  source: string;
  targets: string[];
  cards: { label: string; image: string; suit: string; number: string; nature: string }[];
  count: number;
  label: string;
  amount: number;
  nature: string;
}
