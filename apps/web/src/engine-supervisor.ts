import { api, connection } from './ui.js';
import { createLanHost } from './lan-host.js';
import type { LanOffer } from './lan-peer.js';

/** Local-only job discovery grants no player or room-owner capability. */
export function startEngineSupervisor(): void {
  if (navigator.locks) {
    const abort = new AbortController();
    let release = () => {};
    window.addEventListener(
      'pagehide',
      () => {
        abort.abort();
        release();
      },
      { once: true },
    );
    connection(true, '已打开的电脑页面提供对局服务');
    void navigator.locks
      .request('party-engine-supervisor', { signal: abort.signal }, async () => {
        runSupervisor();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {});
  } else runSupervisor();
}
function runSupervisor(): void {
  const lan = createLanHost();
  const frames = new Map<string, HTMLIFrameElement>();
  const retryAt = new Map<string, number>();
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'party-view-failed') return;
    for (const [key, frame] of frames) {
      if (
        !frame.classList.contains('engine-seat-view') ||
        event.source !== frame.contentWindow ||
        !key.startsWith(`${event.data.matchId}/`)
      )
        continue;
      if (Date.now() - (retryAt.get(key) ?? 0) < 5000) return;
      retryAt.set(key, Date.now());
      setTimeout(() => {
        if (frames.get(key) === frame) frame.src = frame.src;
      }, 1000);
    }
  });
  let running = false;
  function render(jobs: { id: string; roomCode: string; views?: string[] }[]): void {
    const active = new Set(
      jobs.flatMap((job) => [job.id, ...(job.views ?? []).map((seat) => `${job.id}/${seat}`)]),
    );
    for (const [id, frame] of frames)
      if (!active.has(id)) {
        frame.remove();
        frames.delete(id);
      }
    for (const job of jobs) {
      for (const seat of [null, ...(job.views ?? [])]) {
        const key = seat ? `${job.id}/${seat}` : job.id;
        if (frames.has(key)) continue;
        const frame = document.createElement('iframe');
        frame.className = seat ? 'engine-worker engine-seat-view' : 'engine-worker';
        frame.title = `房间 ${job.roomCode} 的${seat ? '玩家视图' : '对局服务'}`;
        frame.src = seat
          ? `/engine/view/${job.id}?seat=${encodeURIComponent(seat)}`
          : `/engine/worker/${job.id}`;
        frame.setAttribute('aria-hidden', 'true');
        document.body.append(frame);
        frames.set(key, frame);
      }
    }
    connection(true, '对局服务在线');
  }
  async function refresh() {
    if (running) return;
    running = true;
    try {
      const { jobs, lanOffers } = await api<{
        jobs: { id: string; roomCode: string; views?: string[] }[];
        lanOffers?: LanOffer[];
      }>('/engine/jobs');
      render(jobs);
      lan.update(lanOffers ?? []);
    } catch {
      /* A prototype-only test server has no engine supervisor. */
    } finally {
      running = false;
    }
  }
  // This stream is local only; server heartbeats keep the rule page online
  // without relying on timers in a background browser tab.
  const events = new EventSource('/engine/jobs?transport=events');
  let timer: ReturnType<typeof setInterval> | undefined;
  events.addEventListener('jobs', (event) => {
    const { jobs, lanOffers } = JSON.parse((event as MessageEvent).data);
    render(jobs);
    lan.update(lanOffers ?? []);
  });
  events.addEventListener('error', () => {
    if (events.readyState !== EventSource.CLOSED || timer) return;
    // Existing older instances and lobby-only tests still use JSON polling.
    events.close();
    void refresh();
    timer = setInterval(() => void refresh(), 2000);
  });
  window.addEventListener(
    'pagehide',
    () => {
      events.close();
      clearInterval(timer);
      lan.close();
    },
    { once: true },
  );
}
