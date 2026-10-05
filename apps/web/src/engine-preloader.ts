/** Cache public, versioned assets while players read skills and wait in the lobby. */
export function createAssetPreloader(status: HTMLElement) {
  const completed = new Set<string>();
  const failed = new Set<string>();
  let plan: string[] = [];
  let variant = '';
  let enabled = false;
  let running = false;
  let disposed = false;
  let generation = 0;
  let current: AbortController | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;

  function progress() {
    status.hidden = !enabled;
    const count = plan.filter((url) => completed.has(url)).length;
    status.textContent = !plan.length
      ? '正在空闲时准备游戏素材…'
      : count === plan.length
        ? '本局通用素材已准备好，开局时直接复用。'
        : `正在空闲时准备游戏素材 · ${count} / ${plan.length} 项完成`;
    if (plan.some((url) => failed.has(url)))
      status.textContent = `已准备 ${count} 项素材，其余会在开局时继续载入。`;
  }
  async function run() {
    if (running || disposed || !enabled || document.hidden) return;
    running = true;
    try {
      // A single background request leaves slots for lobby actions and the guide.
      while (enabled && !disposed && !document.hidden) {
        const url = plan.find((item) => !completed.has(item) && !failed.has(item));
        if (!url) break;
        current = new AbortController();
        const deadline = setTimeout(() => current?.abort(), 120000);
        try {
          const options: RequestInit & { priority: string } = {
            cache: 'force-cache',
            credentials: 'same-origin',
            signal: current.signal,
            priority: 'low',
          };
          const response = await fetch(url, options);
          if (!response.ok) throw new Error('Resource unavailable');
          // Reading to completion is required for the browser's HTTP cache.
          await response.arrayBuffer();
          completed.add(url);
        } catch {
          if (!document.hidden && !disposed) failed.add(url);
          if (document.hidden || disposed) break;
        } finally {
          clearTimeout(deadline);
        }
        progress();
      }
    } finally {
      running = false;
      current = undefined;
    }
  }
  async function load(preset: string, mode: string, ticket: number) {
    try {
      const response = await fetch(
        `/engine/preload?preset=${encodeURIComponent(preset)}&mode=${encodeURIComponent(mode)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Preload unavailable');
      const data: { assets: string[] } = await response.json();
      if (disposed || ticket !== generation) return;
      // Only fixed static paths on this origin may be warmed. This list cannot
      // request match setup, cookies, private queues or a third-party host.
      plan = data.assets.filter(
        (url) =>
          /^\/engine\/(bundle\/noname-[a-f0-9]{64}\.js|core\/[a-f0-9]{40}\/[\w/.-]+)$/.test(url) &&
          new URL(url, location.origin).pathname === url,
      );
      progress();
      void run();
    } catch {
      if (ticket === generation && enabled) status.textContent = '游戏素材会在开局时载入。';
    }
  }
  function update(active: boolean, preset = 'beginner', mode = 'identity') {
    enabled = active;
    status.hidden = !enabled;
    if (!enabled || disposed) return;
    const next = `${preset}:${mode}`;
    if (next !== variant) {
      variant = next;
      const ticket = ++generation;
      clearTimeout(startTimer);
      // Give the nickname form/room layout and guide their first paint.
      startTimer = setTimeout(() => {
        void load(preset, mode, ticket);
      }, 1000);
    } else void run();
    progress();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) current?.abort();
    else void run();
  });
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      current?.abort();
      clearTimeout(startTimer);
    },
    { once: true },
  );
  return { update };
}
