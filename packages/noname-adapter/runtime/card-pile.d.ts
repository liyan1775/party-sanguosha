export interface CardPile {
  id: string;
  name: string;
  packs: string[];
  excludedCards: string[];
  cardCount: number;
}
export function validateCardPile(preset: unknown): CardPile;
export function prepareCardPile(lib: unknown, preset: unknown): void;
