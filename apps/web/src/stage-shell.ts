import { app } from './ui.js';
import { createStageSound } from './stage-sound.js';
import { staticAsset } from './static-assets.js';
import {
  ZIBAI_ICONS,
  getZibaiTheme,
  onZibaiPreferenceChange,
  toggleZibaiMotion,
  toggleZibaiTheme,
  type ZibaiTheme,
} from './zibai-theme.js';

export function stagePreferences(): string {
  return `<div class="z-stage-prefs" role="group" aria-label="显示与声音">
    <button id="theme-toggle" class="pref-token" type="button" aria-label="切换日间或夜间"></button>
    <button id="motion-toggle" class="pref-token" type="button" aria-label="精简动效"></button>
    <button id="stage-mute" class="pref-token" type="button" aria-label="静音"></button>
  </div>`;
}

export type StageShell = ReturnType<typeof stageShell>;

export function bindStageBackdrop(backdrop: HTMLElement): void {
  const veil = backdrop.querySelector('.zibai-backdrop-veil')!;
  let theme = getZibaiTheme();
  let current = makeArt(theme);
  let requested = theme;
  let animation: Animation | undefined;
  backdrop.replaceChildren(current, veil);

  function makeArt(nextTheme: ZibaiTheme): HTMLImageElement {
    const image = new Image();
    image.className = 'zibai-backdrop-art';
    image.alt = '';
    image.decoding = 'async';
    image.src =
      nextTheme === 'day'
        ? staticAsset('/assets/zibai-day.webp')
        : staticAsset('/assets/zibai-night.webp');
    return image;
  }

  let generation = 0;
  const unsubscribe = onZibaiPreferenceChange(({ theme: nextTheme }) => {
    if (requested === nextTheme) return;
    requested = nextTheme;
    const ticket = ++generation;
    if (theme === nextTheme) return;
    const next = makeArt(nextTheme);
    void next.decode().then(
      () => {
        if (ticket !== generation || !backdrop.isConnected) return;
        animation?.finish();
        const previous = current;
        current = next;
        theme = nextTheme;
        veil.before(current);
        if (
          document.documentElement.dataset.motion !== 'reduced' &&
          typeof current.animate === 'function'
        ) {
          animation = current.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 420,
            easing: 'ease',
          });
          void animation.finished.then(
            () => previous.remove(),
            () => previous.remove(),
          );
        } else previous.remove();
      },
      () => {
        if (ticket === generation) requested = theme;
      },
    );
  });
  window.addEventListener('pagehide', unsubscribe, { once: true });
}

export function stageShell(kind: 'home' | 'console', title: string, markup: string) {
  document.title = title;
  app.className = `z-stage-root z-stage-${kind}`;
  app.innerHTML = `
    <div class="zibai-backdrop" aria-hidden="true">
      <div class="zibai-backdrop-veil"></div>
    </div>
    <div class="z-stage-scene">${markup}</div>
    <div id="message" class="message" role="alert" hidden></div>
    <div class="z-stage-toast" data-tone="" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="z-stage-leaving" hidden role="status" tabindex="-1"><span class="seal" aria-hidden="true">杀</span><strong></strong></div>`;

  bindStageBackdrop(app.querySelector<HTMLElement>('.zibai-backdrop')!);
  const scene = app.querySelector<HTMLElement>('.z-stage-scene')!;
  const leaving = app.querySelector<HTMLElement>('.z-stage-leaving')!;
  const toast = app.querySelector<HTMLElement>('.z-stage-toast')!;
  const themeButton = app.querySelector<HTMLButtonElement>('#theme-toggle');
  const motionButton = app.querySelector<HTMLButtonElement>('#motion-toggle');
  const muteButton = app.querySelector<HTMLButtonElement>('#stage-mute');
  const sound = createStageSound();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function paintPreferences() {
    const night = getZibaiTheme() === 'night';
    if (themeButton) {
      themeButton.innerHTML = `${night ? ZIBAI_ICONS.moon : ZIBAI_ICONS.sun}<span>${night ? '夜间' : '日间'}</span>`;
      themeButton.setAttribute('aria-pressed', String(night));
    }
    if (motionButton) {
      const compact = document.documentElement.dataset.motion === 'reduced';
      motionButton.textContent = compact ? '精简' : '动效';
      motionButton.setAttribute('aria-pressed', String(compact));
    }
    if (muteButton) {
      muteButton.textContent = sound.muted ? '静音' : '声音';
      muteButton.setAttribute('aria-pressed', String(sound.muted));
      muteButton.setAttribute('aria-label', sound.muted ? '开启声音' : '关闭声音');
    }
  }
  paintPreferences();
  const unsubscribe = onZibaiPreferenceChange(paintPreferences);
  window.addEventListener('pagehide', unsubscribe, { once: true });
  themeButton?.addEventListener('click', () => {
    toggleZibaiTheme();
    sound.play('click');
  });
  motionButton?.addEventListener('click', toggleZibaiMotion);
  muteButton?.addEventListener('click', () => {
    sound.toggle();
    paintPreferences();
    sound.play('click');
  });

  return {
    sound,
    toast(text: string, success = false) {
      clearTimeout(toastTimer);
      toast.dataset.tone = success ? 'success' : 'notice';
      toast.textContent = text;
      toastTimer = setTimeout(() => (toast.textContent = ''), 4500);
    },
    leaving(text: string) {
      leaving.querySelector('strong')!.textContent = text;
      leaving.hidden = false;
      scene.inert = true;
      leaving.focus({ preventScroll: true });
    },
  };
}
