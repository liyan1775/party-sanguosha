import { APP_VERSION, type ApiError } from '../../../packages/shared/src/contracts.js';

export const app = document.querySelector<HTMLElement>('#app')!;

export function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = app.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: T | ApiError = await response.json();
  if (!response.ok) throw new Error((data as ApiError).error?.message ?? '连接失败，请稍后再试。');
  return data as T;
}

export function frame(
  layout: string,
  eyebrow: string,
  title: string,
  subtitle: string,
  body: string,
): void {
  app.className = layout;
  app.innerHTML = `
    <header class="masthead"><a class="brand" href="/" aria-label="聚会三国杀首页"><span class="seal">杀</span><span>聚会三国杀<small>一桌朋友，一场好戏</small></span></a><span id="connection" class="connection">正在连接</span></header>
    <section class="intro"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${subtitle}</p></section>
    <div id="message" class="message" role="alert" hidden></div>
    ${body}
    <footer>大厅原型 v${APP_VERSION} · 可建房、邀请与设置 AI 席位，真实对局及 AI 出牌尚未开放</footer>`;
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
  button.disabled = true;
  message('');
  try {
    await callback();
  } catch (error) {
    message(error instanceof Error ? error.message : '操作失败，请重试。');
  } finally {
    delete button.dataset.busy;
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
): EventSource {
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
