import { APP_VERSION, type ApiError } from '../../../packages/shared/src/contracts.js';
import {
  ZIBAI_ICONS,
  getZibaiMotion,
  getZibaiTheme,
  initZibaiTheme,
  onZibaiPreferenceChange,
  toggleZibaiMotion,
  toggleZibaiTheme,
} from './zibai-theme.js';

export const app = document.querySelector<HTMLElement>('#app')!;
initZibaiTheme();

const nicknameKey = 'party_last_nickname';

export function savedNickname(): string {
  try {
    return localStorage.getItem(nicknameKey) ?? '';
  } catch {
    return '';
  }
}

export function rememberNickname(nickname: string): void {
  try {
    localStorage.setItem(nicknameKey, nickname.trim());
  } catch {}
}

function requestDeadline(parent: AbortSignal | undefined, milliseconds: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

export function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = app.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  timeoutMs = path.endsWith('/start') ? 190000 : 20000,
): Promise<T> {
  const deadline = requestDeadline(undefined, timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal: deadline.signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: T | ApiError = await response.json();
    if (!response.ok)
      throw new Error((data as ApiError).error?.message ?? '连接失败，请稍后再试。');
    return data as T;
  } catch (error) {
    if (deadline.signal.aborted) throw new Error('请求超时，请检查连接后重试。');
    throw error;
  } finally {
    deadline.clear();
  }
}

let unsubscribeTheme: (() => void) | null = null;

export function frame(
  layout: string,
  eyebrow: string,
  title: string,
  subtitle: string,
  body: string,
  artwork = '',
): void {
  unsubscribeTheme?.();
  app.className = layout;
  app.innerHTML = `
    <div class="zibai-backdrop" aria-hidden="true"><div class="zibai-backdrop-art day"></div><div class="zibai-backdrop-art night"></div><div class="zibai-backdrop-veil"></div></div>
    <a class="skip-link" href="#lobby-content">跳到主要内容</a>
    <header class="masthead"><a class="brand" href="/" aria-label="聚会三国杀首页"><span class="seal">杀</span><span>聚会三国杀</span></a><nav class="masthead-nav" aria-label="大厅导航"><a href="/" ${layout.includes('home-layout') ? 'aria-current="page"' : ''}>返回大厅</a></nav><div class="masthead-prefs" role="group" aria-label="显示偏好"><button id="theme-toggle" class="pref-token" type="button" title="切换日间或夜间"></button><button id="motion-toggle" class="pref-token" type="button" title="切换动效"></button></div><span id="connection" class="connection" role="status">正在连接</span></header>
    <section class="page-hero"><div class="intro"><p class="eyebrow">${ZIBAI_ICONS.star}<span>${eyebrow}</span></p><h1>${title}</h1><p>${subtitle}</p></div>${artwork}</section>
    <div id="lobby-content" tabindex="-1">
    <div id="message" class="message" role="alert" hidden></div>
    ${body}
    </div>
    <footer><span>一桌朋友，一场好戏。</span><span>聚会三国杀 v${APP_VERSION} · 扫码开房 · AI 补位 · 手机对局</span></footer>`;
  const themeBtn = element<HTMLButtonElement>('#theme-toggle');
  const motionBtn = element<HTMLButtonElement>('#motion-toggle');
  const paintPrefs = (theme = getZibaiTheme(), motion = getZibaiMotion()) => {
    themeBtn.innerHTML = `${theme === 'day' ? ZIBAI_ICONS.sun : ZIBAI_ICONS.moon}<span>${theme === 'day' ? '日间' : '夜间'}</span>`;
    themeBtn.setAttribute('aria-pressed', String(theme === 'night'));
    motionBtn.innerHTML = `${ZIBAI_ICONS.spark}<span>${motion === 'full' ? '动效' : '精简'}</span>`;
    motionBtn.setAttribute('aria-pressed', String(motion === 'reduced'));
  };
  paintPrefs();
  themeBtn.addEventListener('click', () => {
    toggleZibaiTheme();
  });
  motionBtn.addEventListener('click', () => {
    toggleZibaiMotion();
  });
  unsubscribeTheme = onZibaiPreferenceChange(({ theme, motion }) => paintPrefs(theme, motion));
}

export function message(text: string, success = false): void {
  const target = element('#message');
  target.textContent = text;
  target.classList.toggle('success', success);
  target.hidden = !text;
}

export function disable(button: HTMLButtonElement, disabled: boolean): void {
  button.disabled = disabled || button.dataset.busy === 'true';
}

export async function perform(
  button: HTMLButtonElement,
  callback: () => Promise<void>,
  render: () => void = () => {},
): Promise<void> {
  button.dataset.busy = 'true';
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  message('');
  try {
    await callback();
  } catch (error) {
    message(error instanceof Error ? error.message : '操作失败，请重试。');
  } finally {
    delete button.dataset.busy;
    button.removeAttribute('aria-busy');
    button.disabled = false;
    render();
  }
}

export function action(
  button: HTMLButtonElement,
  callback: () => Promise<void>,
  render?: () => void,
): void {
  button.addEventListener('click', () => {
    void perform(button, callback, render);
  });
}

export function connection(online: boolean, text: string): void {
  const target = element('#connection');
  target.textContent = text;
  target.classList.toggle('online', online);
}

export function watchEvents(
  url: string,
  name: string,
  update: (data: unknown) => void,
  poll = false,
): { close(): void } {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  if (poll) {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: unknown;
    const close = () => {
      abort.abort();
      clearTimeout(timer);
    };
    async function refresh() {
      const deadline = requestDeadline(abort.signal, 12000);
      try {
        const response = await fetch(`${url}?transport=poll`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: deadline.signal,
        });
        if (response.status === 404 && name === 'room') {
          if (last) update({ ...last, phase: 'closed', revision: Number.MAX_SAFE_INTEGER });
          connection(false, '房间已关闭');
          close();
          return;
        }
        if (!response.ok) throw new Error('Connection unavailable');
        last = await response.json();
        if (abort.signal.aborted) return;
        update(last);
        connection(true, name === 'room' ? '已连接牌桌' : '服务在线');
      } catch {
        if (!abort.signal.aborted) connection(false, '连接断开，正在重连');
      } finally {
        deadline.clear();
        if (!abort.signal.aborted) timer = setTimeout(refresh, 1200);
      }
    }
    void refresh();
    window.addEventListener('pagehide', close, { once: true });
    return { close };
  }
  const events = new EventSource(url);
  events.addEventListener('open', () =>
    connection(true, name === 'room' ? '已连接牌桌' : '服务在线'),
  );
  events.addEventListener(name, (event) =>
    update(JSON.parse((event as MessageEvent<string>).data)),
  );
  events.addEventListener('error', () => connection(false, '连接断开，正在重连'));
  window.addEventListener('pagehide', () => events.close(), { once: true });
  return events;
}
