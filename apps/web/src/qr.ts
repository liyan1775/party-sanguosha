import { element, message, perform } from './ui.js';
import type { EntryInfo } from '../../../packages/shared/src/contracts.js';

export function qrMarkup(alt: string, caption: string): string {
  return `<div class="qr-frame"><img id="qr" alt="${alt}" hidden /><p id="qr-placeholder">正在确认邀请入口…</p></div>
    <p class="qr-caption">${caption}</p>
    <label id="network-label" class="field-label" for="network-address">与手机同一个 Wi-Fi 的地址</label><select id="network-address" aria-label="选择局域网地址"></select>
    <div class="copy-row"><input id="join-url" aria-label="邀请链接" readonly /><button id="copy-link" class="button subtle" type="button">复制</button></div>
    <a id="save-qr" class="button secondary full-width" download="聚会三国杀二维码.png" hidden>保存二维码</a><p id="qr-hint" class="hint"></p>`;
}

export function bindQr(urls: string[], roomCode?: string, entry?: EntryInfo): void {
  const internet = entry?.mode === 'internet';
  const network = element<HTMLSelectElement>('#network-address');
  const previous = network.value;
  network.replaceChildren();
  for (const url of urls) network.add(new Option(new URL(url).host, url));
  const local = urls.find((url) => new URL(url).host === location.host);
  if (urls.includes(previous)) network.value = previous;
  else if (local) network.value = local;
  network.hidden = internet;
  element('#network-label').hidden = internet;
  element('#qr-hint').textContent = internet
    ? 'Wi-Fi 或手机流量都能扫码。电脑需要保持开机联网，重启后请分享新码。微信中可长按二维码保存。'
    : '朋友需要连接同一个 Wi-Fi 或电脑热点。扫码打不开时可复制链接到系统浏览器。';
  const update = () => {
    const url = network.value;
    const image = element<HTMLImageElement>('#qr');
    element<HTMLInputElement>('#join-url').value = url;
    image.hidden = !url;
    image.removeAttribute('src');
    if (url)
      image.src = `/api/qr.svg?url=${encodeURIComponent(url)}${roomCode ? `&room=${roomCode}` : ''}`;
    element('#qr-placeholder').hidden = Boolean(url);
    if (!url)
      element('#qr-placeholder').textContent = internet
        ? entry.message
        : '暂未检测到局域网，请让电脑连接 Wi-Fi 或开启热点。';
    element<HTMLButtonElement>('#copy-link').disabled = !url;
    const save = element<HTMLAnchorElement>('#save-qr');
    save.hidden = !url;
    if (url)
      save.href = `/api/qr.png?url=${encodeURIComponent(url)}${roomCode ? `&room=${roomCode}` : ''}`;
    else save.removeAttribute('href');
  };
  network.onchange = update;
  update();
  // 重进/刷新地址时替换旧监听，防止一键复制重复执行。
  const copy = element<HTMLButtonElement>('#copy-link');
  copy.onclick = () => {
    void perform(copy, async () => {
      const input = element<HTMLInputElement>('#join-url');
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
