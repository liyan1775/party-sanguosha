// SPDX-License-Identifier: GPL-3.0-only
import type { ShanhetuCampaignView } from '../../../packages/shared/src/shanhetu.js';
import { staticAsset } from './static-assets.js';

const difficultyTiers = ['普通', '中等', '困难', '噩梦', '炼狱'];

export function journeyHighlight(journey: ShanhetuCampaignView, nickname: string) {
  const difficulty = difficultyTiers[Math.floor((journey.difficulty - 1) / 5)];
  const battle = journey.highlight?.battle;
  const unlocked =
    journey.bookAward && !('pending' in journey.bookAward) ? journey.bookAward.unlocked : [];
  const lines: [string, string][] = [
    ['出征者', `${nickname} · ${journey.heroName ?? '征战者'}`],
    [
      '战绩',
      [
        difficulty ? `${difficulty}${((journey.difficulty - 1) % 5) + 1}` : '',
        `${journey.victories} 场战斗胜利`,
        `通过 ${journey.completedNodes} 处地点`,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    ['本局构筑', journey.highlight?.build.join('、') || journey.openingPackage || '未取得构筑奖励'],
    [
      '高光战斗',
      battle
        ? `${battle.name} · ${battle.victory ? '取胜' : '败北'} · 击退 ${battle.defeatedEnemies} 名敌人 · 余 ${battle.remainingHp} 点体力`
        : '本趟暂无战斗记录',
    ],
    [
      '山河册新解锁',
      unlocked.join('、') ||
        (journey.bookAward && 'pending' in journey.bookAward ? '待保存' : '本趟暂无'),
    ],
  ];
  return {
    scenario: journey.scenario,
    title: journey.finalReport?.title ?? (journey.phase === 'won' ? '征程告捷' : '兵败退军'),
    lines,
  };
}

function loadCover(): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = staticAsset('/assets/shanhetu-pass.webp');
  });
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const rows: string[] = [];
  let row = '';
  for (const char of text) {
    if (row && context.measureText(row + char).width > width) {
      rows.push(row);
      row = '';
    }
    row += char;
  }
  if (row) rows.push(row);
  return rows;
}

export async function saveJourneyHighlight(highlight: ReturnType<typeof journeyHighlight>) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const cover = await loadCover();
  const night = document.documentElement.dataset.theme === 'night';
  const palette = night
    ? { paper: '#101e1c', text: '#f7ead5', accent: '#e1bc80', rule: '#796d57' }
    : { paper: '#f3e8d3', text: '#29261e', accent: '#923c32', rule: '#b89a65' };
  const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
  const bodyFont = `32px ${font}`;
  context.font = bodyFont;
  const groups = highlight.lines.map(([label, value]) => ({
    label,
    rows: wrap(context, value, 856),
  }));
  canvas.width = 1080;
  canvas.height = 372 + groups.reduce((height, group) => height + 62 + group.rows.length * 47, 0);
  context.textBaseline = 'top';
  context.fillStyle = palette.paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (cover) {
    const scale = Math.max(1080 / cover.width, 268 / cover.height);
    const width = cover.width * scale;
    const height = cover.height * scale;
    context.save();
    context.beginPath();
    context.rect(0, 0, 1080, 268);
    context.clip();
    context.drawImage(cover, (1080 - width) / 2, (268 - height) / 2, width, height);
    context.restore();
  }
  context.fillStyle = cover ? '#0d1716bd' : '#131f1d';
  context.fillRect(0, 0, 1080, 268);
  context.strokeStyle = palette.rule;
  context.lineWidth = 2;
  context.strokeRect(22, 22, 1036, canvas.height - 44);
  context.fillStyle = '#e9cf9d';
  context.font = `27px ${font}`;
  context.fillText(`山河图 · ${highlight.scenario}`, 106, 65, 860);
  context.fillStyle = '#fff0d9';
  context.font = 'bold 65px "Songti SC", SimSun, serif';
  context.fillText(highlight.title, 103, 132, 862);

  let top = 323;
  for (const group of groups) {
    context.fillStyle = palette.accent;
    context.font = `bold 25px ${font}`;
    context.fillText(group.label, 108, top);
    top += 39;
    context.fillStyle = palette.text;
    context.font = bodyFont;
    for (const row of group.rows) {
      context.fillText(row, 108, top);
      top += 47;
    }
    top += 23;
  }

  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('PNG unavailable');
  const url = URL.createObjectURL(png);
  const save = document.createElement('a');
  save.href = url;
  save.download = '山河图-征程高光.png';
  document.body.append(save);
  save.click();
  save.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
