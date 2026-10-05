import { element, message, perform } from './ui.js';
import type { EntryInfo } from '../../../packages/shared/src/contracts.js';

export function isInternetInvite(url: string): boolean {
  return new URL(url).hostname.endsWith('.trycloudflare.com');
}

export function qrMarkup(alt: string, caption: string, prefix = ''): string {
  return `<div class="qr-frame"><img id="${prefix}qr" alt="${alt}" hidden /><p id="${prefix}qr-placeholder">正在确认邀请入口…</p></div>
    <p class="qr-caption">${caption}</p>
    <label id="${prefix}network-label" class="field-label" for="${prefix}network-address">与手机同一个 Wi-Fi 的地址</label><select id="${prefix}network-address" aria-label="选择邀请地址"></select>
    <div class="copy-row"><input id="${prefix}join-url" aria-label="邀请链接" readonly /><button id="${prefix}copy-link" class="button subtle" type="button">复制</button></div>
    <a id="${prefix}save-qr" class="button secondary full-width" download="聚会三国杀二维码.png" hidden>保存二维码</a><p id="${prefix}qr-hint" class="hint"></p>`;
}

export function bindQr(urls: string[], roomCode?: string, entry?: EntryInfo, prefix = ''): void {
  const select = <T extends HTMLElement = HTMLElement>(id: string) => element<T>(`#${prefix}${id}`);
  const publicOnly = urls.length ? urls.every(isInternetInvite) : entry?.mode === 'internet';
  const mixed = urls.some(isInternetInvite) && !publicOnly;
  const network = select<HTMLSelectElement>('network-address');
  const previous = network.value;
  network.replaceChildren();
  for (const url of urls)
    network.add(
      new Option(
        `${mixed ? (isInternetInvite(url) ? '跨网络 · ' : '局域网 · ') : ''}${new URL(url).host}`,
        url,
      ),
    );
  const local = urls.find((url) => new URL(url).host === location.host);
  if (urls.includes(previous)) network.value = previous;
  else if (local) network.value = local;
  network.hidden = Boolean(publicOnly);
  select('network-label').hidden = Boolean(publicOnly);
  select('network-label').textContent = mixed ? '选择分享入口' : '与手机同一个 Wi-Fi 的地址';
  const update = () => {
    const url = network.value;
    const internet = url ? isInternetInvite(url) : publicOnly;
    select('qr-hint').textContent = internet
      ? !url
        ? '公网码在首次验证通过后显示。同 Wi-Fi 的朋友可立即使用局域网码。'
        : entry?.status === 'ready'
          ? '不同 Wi-Fi 或手机流量的朋友使用此码。电脑需要保持开机联网，重启后请分享新码。'
          : '公网暂时不可用，原码保留，恢复后可继续扫码。同 Wi-Fi 的朋友请使用局域网码。'
      : '同 Wi-Fi 或电脑热点的朋友使用此码，直接连接电脑。公网中断不影响局域网入口和牌桌。';
    const image = select<HTMLImageElement>('qr');
    select<HTMLInputElement>('join-url').value = url;
    image.hidden = !url;
    if (url) {
      const src = `/api/qr.svg?url=${encodeURIComponent(url)}${roomCode ? `&room=${roomCode}` : ''}`;
      if (image.getAttribute('src') !== src) image.src = src;
    } else image.removeAttribute('src');
    select('qr-placeholder').hidden = Boolean(url);
    if (!url)
      select('qr-placeholder').textContent =
        internet || entry?.status === 'unavailable'
          ? (entry?.message ?? '正在准备跨网络入口…')
          : '暂未检测到局域网，请让电脑连接 Wi-Fi 或开启热点。';
    select<HTMLButtonElement>('copy-link').disabled = !url;
    const save = select<HTMLAnchorElement>('save-qr');
    save.hidden = !url;
    if (url)
      save.href = `/api/qr.png?url=${encodeURIComponent(url)}${roomCode ? `&room=${roomCode}` : ''}`;
    else save.removeAttribute('href');
  };
  network.onchange = update;
  update();
  // 重进/刷新地址时替换旧监听，防止一键复制重复执行。
  const copy = select<HTMLButtonElement>('copy-link');
  copy.onclick = () => {
    void perform(copy, async () => {
      const input = select<HTMLInputElement>('join-url');
      if (!input.value) throw new Error('暂时没有可用的邀请入口。');
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(input.value);
          message('邀请链接已复制。', true);
          return;
        } catch {
          /* 微信或局域网 HTTP 可能不支持剪贴板，保留手动复制入口。 */
        }
      }
      input.focus();
      input.select();
      message('链接已选中，请长按或使用复制操作。', true);
    });
  };
}
