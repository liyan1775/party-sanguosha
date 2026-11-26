import type { CustomRosterRef } from '../../../packages/shared/src/contracts.js';

type PreloadPlan = {
  key: string;
  manifest: string;
  assets?: string[];
  cursor: number;
  ready: number;
  unavailable: boolean;
  manifestFailed: boolean;
};

function publicAsset(url: unknown, lightweight: boolean): url is string {
  if (typeof url !== 'string') return false;
  if (lightweight) return /^\/assets\/table\.(?:js|css)(?:\?v=[a-f0-9]{8,64})?$/.test(url);
  return (
    /^\/engine\/(?:bundle\/noname-[a-f0-9]{64}\.js|core\/[a-f0-9]{40}\/[\w/.-]+|portraits\/[a-f0-9]{64}\/[\w-]+\.webp)$/.test(
      url,
    ) && new URL(url, location.origin).pathname === url
  );
}

async function preload<T>(
  url: string,
  parent: AbortSignal,
  cache: RequestCache,
  timeout: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const deadline = setTimeout(abort, timeout);
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();
  try {
    const options: RequestInit & { priority: string } = {
      cache,
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
      priority: 'low',
    };
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Preload unavailable');
    return await consume(response);
  } finally {
    clearTimeout(deadline);
    parent.removeEventListener('abort', abort);
  }
}

async function drain(response: Response): Promise<void> {
  if (!response.body) throw new Error('Resource has no body');
  const reader = response.body.getReader();
  try {
    while (!(await reader.read()).done) {}
  } finally {
    reader.releaseLock();
  }
}

/** Cache public, versioned assets while players read skills and wait in the lobby. */
export function createAssetPreloader(status: HTMLElement, lightweight = false) {
  const completed = new Set<string>();
  let plan: PreloadPlan | undefined;
  let current: AbortController | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;

  function progress() {
    status.hidden = !plan;
    if (!plan) return;
    const total = plan.assets?.length ?? 0;
    const text = plan.manifestFailed
      ? '游戏素材会在开局时载入。'
      : plan.unavailable
        ? `已准备 ${plan.ready} 项素材，其余会在开局时继续载入。`
        : !total
          ? '正在空闲时准备游戏素材…'
          : plan.ready === total
            ? '本局通用素材已准备好，开局时直接复用。'
            : `正在空闲时准备游戏素材 · ${plan.ready} / ${total} 项完成`;
    if (status.textContent !== text) status.textContent = text;
  }

  async function run() {
    if (!plan || current || document.hidden || plan.manifestFailed) return;
    const pending = plan;
    const controller = new AbortController();
    current = controller;
    const { signal } = controller;
    try {
      if (!pending.assets) {
        try {
          const data = await preload<{ assets?: unknown }>(
            pending.manifest,
            signal,
            'no-store',
            12000,
            (response) => response.json(),
          );
          if (signal.aborted) return;
          if (!Array.isArray(data.assets)) throw new Error('Invalid preload manifest');
          pending.assets = [...new Set(data.assets.filter((url) => publicAsset(url, lightweight)))];
          if (!pending.assets.length) throw new Error('No public assets to preload');
          progress();
        } catch {
          if (!signal.aborted) {
            pending.manifestFailed = true;
            progress();
          }
          return;
        }
      }
      const assets = pending.assets;
      while (pending.cursor < assets.length && !signal.aborted) {
        const url = assets[pending.cursor]!;
        try {
          if (!completed.has(url)) await preload(url, signal, 'force-cache', 120000, drain);
          if (signal.aborted) return;
          completed.add(url);
          pending.ready++;
        } catch {
          if (signal.aborted) return;
          pending.unavailable = true;
        }
        pending.cursor++;
        progress();
      }
    } finally {
      if (current === controller) current = undefined;
    }
  }

  function pause() {
    clearTimeout(startTimer);
    startTimer = undefined;
    current?.abort();
    current = undefined;
  }

  function update(
    active: boolean,
    preset = 'beginner',
    mode = 'identity',
    roster?: CustomRosterRef,
  ) {
    if (!active) {
      pause();
      plan = undefined;
      progress();
      return;
    }
    const params = new URLSearchParams({ preset, mode });
    if (roster) {
      params.set('roster', roster.id);
      params.set('revision', String(roster.revision));
    }
    if (lightweight) params.set('client', 'light');
    const key = String(params);
    if (plan?.key === key) return;
    pause();
    plan = {
      key,
      manifest: `/engine/preload?${key}`,
      cursor: 0,
      ready: 0,
      unavailable: false,
      manifestFailed: false,
    };
    startTimer = setTimeout(() => {
      startTimer = undefined;
      void run();
    }, 1000);
    progress();
  }

  function visibilityChanged() {
    if (document.hidden) pause();
    else if (startTimer === undefined) void run();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener(
    'pagehide',
    () => {
      plan = undefined;
      pause();
      document.removeEventListener('visibilitychange', visibilityChanged);
    },
    { once: true },
  );
  return { update };
}
