import type { ServerInfo } from '../../../packages/shared/src/contracts.js';
import { patchHidden, patchText } from './console-dom.js';
import { isInternetInvite, qrImageSource } from './qr.js';
import type { StageShell } from './stage-shell.js';
import { element } from './ui.js';

function inviteCard(prefix: string, name: string, caption: string): string {
  return `<section class="return-console-invite" aria-labelledby="${prefix}invite-title">
    <div class="return-console-invite-heading">
      <h3 id="${prefix}invite-title">${name}</h3>
      <p>${caption}</p>
    </div>
    <div class="qr-frame return-console-qr">
      <img id="${prefix}qr" alt="${name}玩家主页二维码" hidden />
      <p id="${prefix}qr-placeholder"></p>
    </div>
    <p id="${prefix}qr-hint" class="return-console-qr-caption"></p>
    <div class="return-console-copy">
      <button id="${prefix}copy-link" class="button secondary" type="button" aria-label="复制玩家链接 · ${name}" disabled>复制玩家链接</button>
      <input id="${prefix}join-url" aria-label="${name}玩家链接" readonly hidden />
    </div>
  </section>`;
}

export const consoleInvitesMarkup = `<div class="return-console-invites">
  ${inviteCard('', '局域网', '同一 Wi-Fi')}
  ${inviteCard('internet-', '公网', '其他 Wi-Fi 或手机流量')}
</div>`;

export const consoleNetworkMarkup = `<div class="return-console-network">
  <p class="hint" id="entry-status" role="status"></p>
  <details id="console-network">
    <summary id="console-network-toggle">网络诊断与地址切换</summary>
    <div class="return-console-network-fields">
      <label class="field-label" for="network-address">局域网邀请地址</label>
      <select id="network-address"></select>
      <button id="refresh-address" class="button secondary" type="button">刷新连接状态</button>
    </div>
  </details>
</div>`;

function bindInvite(prefix: string, stage: StageShell) {
  const image = element<HTMLImageElement>(`#${prefix}qr`);
  const placeholder = element(`#${prefix}qr-placeholder`);
  const hint = element(`#${prefix}qr-hint`);
  const input = element<HTMLInputElement>(`#${prefix}join-url`);
  const copy = element<HTMLButtonElement>(`#${prefix}copy-link`);
  let copying = false;
  copy.addEventListener('click', () => {
    if (!input.value || copying) return;
    const playerUrl = input.value;
    stage.sound.play('click');
    copying = true;
    copy.setAttribute('aria-busy', 'true');
    void (async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('剪贴板不可用');
        await navigator.clipboard.writeText(playerUrl);
        input.hidden = true;
        stage.toast('已复制玩家链接', true);
        stage.sound.play('success');
      } catch {
        input.hidden = false;
        input.focus({ preventScroll: true });
        input.select();
        stage.toast('请手动复制已选中的玩家链接');
      } finally {
        copying = false;
        copy.removeAttribute('aria-busy');
      }
    })();
  });

  return (url: string, empty: string, status: string) => {
    if (input.value !== url) {
      input.value = url;
      if (!url) input.hidden = true;
    }
    if (url) {
      const src = qrImageSource(url);
      if (image.getAttribute('src') !== src) image.src = src;
    } else if (image.hasAttribute('src')) image.removeAttribute('src');
    patchHidden(image, !url);
    patchHidden(placeholder, Boolean(url));
    patchText(placeholder, empty);
    patchText(hint, status);
    if (copy.disabled !== !url) copy.disabled = !url;
  };
}

export function createConsoleInvites(stage: StageShell) {
  const local = bindInvite('', stage);
  const internet = bindInvite('internet-', stage);
  const network = element<HTMLSelectElement>('#network-address');
  const status = element('#entry-status');
  let choices: string[] = [];
  let publicUrl = '';
  let online = true;

  function patchLocal() {
    local(network.value, '等待电脑连接 Wi-Fi 或热点', online ? '' : '电脑连接中断，原码保留');
  }
  network.addEventListener('change', patchLocal);

  return {
    patch(info: ServerInfo) {
      online = true;
      const lan = info.homeUrls.filter((url) => !isInternetInvite(url));
      if (lan.length !== choices.length || lan.some((url, index) => url !== choices[index])) {
        const previous = network.value;
        choices = lan;
        network.replaceChildren(...lan.map((url) => new Option(new URL(url).host, url)));
        const preferred = lan.find((url) => new URL(url).host === location.host);
        if (lan.includes(previous)) network.value = previous;
        else if (preferred) network.value = preferred;
      }
      if (network.disabled !== !lan.length) network.disabled = !lan.length;
      patchLocal();

      const entry = info.entry;
      const published = info.homeUrls.find(isInternetInvite);
      if (published) publicUrl = published;
      else if (entry.mode === 'lan') publicUrl = '';
      const disabled = entry.mode === 'lan' && !publicUrl;
      internet(
        publicUrl,
        disabled ? '未开启公网' : entry.status === 'starting' ? '公网准备中' : '公网暂未就绪',
        disabled
          ? '同 Wi-Fi 请扫局域网码'
          : !publicUrl
            ? '首次验证通过后显示'
            : entry.status === 'ready'
              ? ''
              : '公网暂不可用 · 原码保留',
      );
      patchText(
        status,
        entry.mode === 'internet' && entry.status === 'ready' && publicUrl && network.value
          ? '两码可用'
          : entry.message,
      );
    },
    unavailable() {
      online = false;
      patchLocal();
      internet(publicUrl, '公网暂未就绪', publicUrl ? '电脑连接中断 · 原码保留' : '等待电脑恢复');
      patchText(status, '暂时无法连接电脑服务，原二维码保留。');
    },
  };
}
