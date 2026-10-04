import { api, connection } from './ui.js';

/** Local-only job discovery grants no player or room-owner capability. */
export function startEngineSupervisor(): void {
  const frames = new Map<string, HTMLIFrameElement>();
  let running = false;
  async function refresh() {
    if (running) return;
    running = true;
    try {
      const { jobs } = await api<{ jobs: { id: string; roomCode: string }[] }>('/engine/jobs');
      const active = new Set(jobs.map((job) => job.id));
      for (const [id, frame] of frames)
        if (!active.has(id)) {
          frame.remove();
          frames.delete(id);
        }
      for (const job of jobs) {
        if (frames.has(job.id)) continue;
        const frame = document.createElement('iframe');
        frame.className = 'engine-worker';
        frame.title = `房间 ${job.roomCode} 的对局服务`;
        frame.src = `/engine/worker/${job.id}`;
        frame.setAttribute('aria-hidden', 'true');
        document.body.append(frame);
        frames.set(job.id, frame);
      }
      connection(true, '对局服务在线');
    } catch {
      /* A prototype-only test server has no engine supervisor. */
    } finally {
      running = false;
    }
  }
  void refresh();
  const timer = setInterval(() => void refresh(), 2000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}
