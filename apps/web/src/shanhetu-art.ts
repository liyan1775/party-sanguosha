// SPDX-License-Identifier: GPL-3.0-only
import art from '../../../config/client-art.json' with { type: 'json' };
import atlas from './assets/shanhetu/shanhetu-icons-atlas.json' with { type: 'json' };
import { staticAsset } from './static-assets.js';

export function shanhetuIcon(kind: string) {
  const key = Object.prototype.hasOwnProperty.call(atlas.icons, kind)
    ? (kind as keyof typeof atlas.icons)
    : 'event';
  const { x, y } = atlas.icons[key];
  const icon = document.createElement('span');
  icon.className = 'shanhetu-icon';
  icon.dataset.icon = key;
  icon.setAttribute('aria-hidden', 'true');
  icon.style.backgroundSize = `${atlas.columns * 100}% ${atlas.rows * 100}%`;
  icon.style.backgroundPosition = `${(x * 100) / (atlas.tileSize * (atlas.columns - 1))}% ${(y * 100) / (atlas.tileSize * (atlas.rows - 1))}%`;
  return icon;
}

export function labelWithIcon(control: HTMLElement, label: string, icon: string) {
  control.replaceChildren(shanhetuIcon(icon), label);
}

export function cityScene(regionId?: string) {
  const id = regionId?.replace(/^region-/, '');
  return (id && art.cityScenes[id as keyof typeof art.cityScenes]) || 'luoyang';
}

export function bindCityScene(host: HTMLElement) {
  let loadGeneration = 0;
  let requested: string | undefined;
  let painting: HTMLImageElement | undefined;
  let pending: HTMLImageElement | undefined;
  return (scene?: string) => {
    if (scene === requested) return;
    requested = scene;
    const generation = ++loadGeneration;
    painting?.remove();
    pending?.removeAttribute('src');
    painting = undefined;
    pending = undefined;
    delete host.dataset.painting;
    if (!scene) return;
    const image = new Image();
    image.className = 'shanhetu-painting';
    image.alt = '';
    pending = image;
    image.src = staticAsset(`/assets/shanhetu/scenes/scene-${scene}.webp`);
    void image.decode().then(
      () => {
        if (generation !== loadGeneration) return;
        pending = undefined;
        painting = image;
        host.prepend(image);
        host.dataset.painting = scene;
      },
      () => {
        if (generation === loadGeneration) {
          requested = undefined;
          pending = undefined;
        }
      },
    );
  };
}
