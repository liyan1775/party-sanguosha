import art from '../config/client-art.json' with { type: 'json' };

export const clientArt = [
  ...art.emblems.map((mode) => `emblems/emblem-${mode}.webp`),
  'shanhetu/shanhetu-icons-atlas.webp',
  ...new Set(Object.values(art.cityScenes).map((scene) => `shanhetu/scenes/scene-${scene}.webp`)),
];
