// SPDX-License-Identifier: GPL-3.0-only
import { findMode, type PublicMatchSummary } from '../../../packages/shared/src/contracts.js';
import { getZibaiTheme } from './zibai-theme.js';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines) break;
    } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/**
 * Pure client-side canvas rendering of a public party MVP poster.
 * Uses only public match summary stats and text; never includes invite URLs,
 * hidden identities, or private hand cards.
 */
export function renderMatchPosterDataUrl(summary: PublicMatchSummary, roomCode: string): string {
  const width = 960;
  const height = 1240;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持导出海报。');

  const night = getZibaiTheme() === 'night';
  const palette = night
    ? {
        bgTop: '#0a141d',
        bgBot: '#132531',
        card: '#11212c',
        cardSoft: '#172c38',
        ink: '#f1f6f7',
        ink2: '#adc3cf',
        gold: '#e0c078',
        goldLine: 'rgba(224,192,120,0.52)',
        jade: '#5ec9bc',
        cinnabar: '#de4f43',
      }
    : {
        bgTop: '#f5f8f7',
        bgBot: '#e3eeec',
        card: '#fffefb',
        cardSoft: '#eef5f3',
        ink: '#132430',
        ink2: '#465e6d',
        gold: '#b48732',
        goldLine: 'rgba(180,135,50,0.48)',
        jade: '#1d7d72',
        cinnabar: '#c73c32',
      };

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, palette.bgTop);
  grad.addColorStop(1, palette.bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Decorative celestial rings
  ctx.save();
  ctx.strokeStyle = palette.goldLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(width - 140, 150, 210, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(width - 140, 150, 168, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Outer octagonal jade-gold frame
  drawRoundedRect(ctx, 36, 36, width - 72, height - 72, 22);
  ctx.strokeStyle = palette.gold;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawRoundedRect(ctx, 46, 46, width - 92, height - 92, 16);
  ctx.strokeStyle = palette.goldLine;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header & Seal
  ctx.fillStyle = palette.cinnabar;
  ctx.fillRect(80, 82, 54, 54);
  ctx.strokeStyle = 'rgba(255,240,210,0.75)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(85, 87, 44, 44);
  ctx.fillStyle = '#fff8ec';
  ctx.font = '900 32px "Songti SC", STSong, SimSun, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('杀', 107, 111);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.jade;
  ctx.font = '700 18px "Microsoft YaHei UI", sans-serif';
  ctx.fillText(`聚会三国杀 · 牌桌 ${roomCode} 公开战报`, 152, 102);

  ctx.fillStyle = palette.ink;
  ctx.font = '900 42px "Songti SC", STSong, SimSun, serif';
  ctx.fillText(summary.winnerLabel || '本局战罢', 152, 146);

  const modeName = findMode(summary.mode)?.name ?? summary.mode;
  const finishTime = new Date(summary.finishedAt || Date.now()).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  ctx.fillStyle = palette.ink2;
  ctx.font = '500 20px "Microsoft YaHei UI", sans-serif';
  ctx.fillText(`${modeName} · 共 ${summary.rounds} 轮 · 结于 ${finishTime}`, 80, 196);

  // Awards section
  let cursorY = 232;
  ctx.fillStyle = palette.gold;
  ctx.font = '700 20px "Songti SC", STSong, serif';
  ctx.fillText('✦ 聚会名场面 · 本局趣味称号', 80, cursorY);
  cursorY += 20;

  const awards = (summary.awards ?? []).slice(0, 4);
  const colW = 390;
  const rowH = 128;
  awards.forEach((award, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 80 + col * (colW + 20);
    const y = cursorY + row * (rowH + 16);
    drawRoundedRect(ctx, x, y, colW, rowH, 12);
    ctx.fillStyle = palette.card;
    ctx.fill();
    ctx.strokeStyle = palette.goldLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = palette.cinnabar;
    ctx.fillRect(x, y + 20, 5, 36);

    ctx.fillStyle = palette.gold;
    ctx.font = '800 22px "Songti SC", STSong, serif';
    ctx.fillText(award.title.slice(0, 14), x + 22, y + 40);

    ctx.fillStyle = palette.ink;
    ctx.font = '700 20px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(
      `${award.holderNickname}（${award.generalName || '武将'}）`.slice(0, 22),
      x + 22,
      y + 74,
    );

    ctx.fillStyle = palette.ink2;
    ctx.font = '400 16px "Microsoft YaHei UI", sans-serif';
    const lines = wrapText(ctx, award.detail, colW - 44, 1);
    ctx.fillText(lines[0] ?? '', x + 22, y + 104);
  });

  cursorY += Math.max(1, Math.ceil(awards.length / 2)) * (rowH + 16) + 24;

  // Public player stats table
  ctx.fillStyle = palette.gold;
  ctx.font = '700 20px "Songti SC", STSong, serif';
  ctx.fillText('✦ 全桌公开战绩', 80, cursorY);
  cursorY += 18;

  const players = (summary.players ?? []).slice(0, 8);
  const tableH = 44 + players.length * 46;
  drawRoundedRect(ctx, 80, cursorY, width - 160, tableH, 12);
  ctx.fillStyle = palette.card;
  ctx.fill();
  ctx.strokeStyle = palette.goldLine;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = palette.ink2;
  ctx.font = '700 16px "Microsoft YaHei UI", sans-serif';
  ctx.fillText('玩家 / 武将', 104, cursorY + 30);
  ctx.fillText('身份', 410, cursorY + 30);
  ctx.fillText('伤害', 520, cursorY + 30);
  ctx.fillText('击败', 610, cursorY + 30);
  ctx.fillText('出牌', 700, cursorY + 30);
  ctx.fillText('状态', 785, cursorY + 30);

  players.forEach((p, index) => {
    const ry = cursorY + 44 + index * 46;
    if (index % 2 === 1) {
      ctx.fillStyle = palette.cardSoft;
      ctx.fillRect(88, ry - 4, width - 176, 44);
    }
    ctx.fillStyle = palette.ink;
    ctx.font = '700 18px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(`${p.nickname} · ${p.generalName || '未亮将'}`.slice(0, 18), 104, ry + 24);
    ctx.fillStyle = palette.ink2;
    ctx.font = '500 17px "Microsoft YaHei UI", sans-serif';
    ctx.fillText((p.identityLabel || '公开').slice(0, 6), 410, ry + 24);
    ctx.fillStyle = palette.jade;
    ctx.font = '700 18px ui-monospace, Consolas, monospace';
    ctx.fillText(String(p.damageDealt), 526, ry + 24);
    ctx.fillText(String(p.kills), 618, ry + 24);
    ctx.fillText(String(p.cardsUsed), 708, ry + 24);
    ctx.fillStyle = p.alive ? palette.jade : palette.ink2;
    ctx.font = '600 16px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(p.alive ? '存活' : '阵亡', 785, ry + 24);
  });

  cursorY += tableH + 34;

  // Highlights
  const highlights = summary.highlights ?? [];
  if (highlights.length > 0 && cursorY < height - 140) {
    ctx.fillStyle = palette.gold;
    ctx.font = '700 20px "Songti SC", STSong, serif';
    ctx.fillText('✦ 高光名场面', 80, cursorY);
    cursorY += 26;
    ctx.fillStyle = palette.ink2;
    ctx.font = '500 17px "Microsoft YaHei UI", sans-serif';
    for (const item of highlights.slice(0, 3)) {
      if (cursorY > height - 92) break;
      const wrapped = wrapText(ctx, `· ${item}`, width - 176, 1);
      ctx.fillText(wrapped[0] ?? '', 88, cursorY);
      cursorY += 30;
    }
  }

  // Footer
  ctx.fillStyle = palette.ink2;
  ctx.font = '500 16px "Microsoft YaHei UI", sans-serif';
  ctx.fillText('聚会三国杀 · 一码入席 · 本海报仅含公开战绩，不含暗手牌与邀请地址', 80, height - 64);

  return canvas.toDataURL('image/png');
}

export function openPosterDialog(summary: PublicMatchSummary, roomCode: string): void {
  const dataUrl = renderMatchPosterDataUrl(summary, roomCode);
  let dialog = document.querySelector<HTMLDialogElement>('#party-poster-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'party-poster-dialog';
    dialog.className = 'party-poster-dialog';
    dialog.innerHTML =
      '<div class="panel-heading"><h2>聚会战绩海报</h2><button class="close-dialog" type="button" aria-label="关闭海报预览">×</button></div><p class="hint">手机微信可长按下方图片保存发群；电脑可点击按钮直接下载 PNG。本海报仅含公开战绩。</p><div class="poster-preview-wrap"><img id="party-poster-img" alt="聚会战绩海报" /></div><div class="poster-actions"><a id="party-poster-download" class="button primary" download="聚会三国杀-战绩海报.png">下载高清 PNG</a><button type="button" class="button secondary close-poster">关闭</button></div>';
    document.body.append(dialog);
    const close = () => dialog?.close();
    dialog.querySelector('.close-dialog')?.addEventListener('click', close);
    dialog.querySelector('.close-poster')?.addEventListener('click', close);
  }
  const img = dialog.querySelector<HTMLImageElement>('#party-poster-img')!;
  const link = dialog.querySelector<HTMLAnchorElement>('#party-poster-download')!;
  img.src = dataUrl;
  link.href = dataUrl;
  link.download = `聚会三国杀-${roomCode}-战绩海报.png`;
  if (!dialog.open) dialog.showModal();
}
