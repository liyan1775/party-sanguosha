// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, get, ui, ai, _status } from 'noname';
import browserReady from '/engine/core/noname/init/browser.js';
import { boot } from '/engine/core/noname/init/index.js';
import { device } from '/engine/core/noname/util/index.js';
import { loadBuildInfo } from '/engine/core/noname/util/meta.js';
import { installPrivacy } from './privacy.js';
import { installControls } from './controls.js';

const [, , role, id] = location.pathname.split('/');
const response = await fetch(`/engine/setup/${id}?role=${role}`).catch((error) => {
  if (role === 'player')
    parent.postMessage({ type: 'party-disconnected', matchId: id }, location.origin);
  throw error;
});
if (!response.ok) throw new Error('你的对局座位已失效，请返回房间。');
const setup = await response.json();
const proof = { booted: false, started: false, ended: false, errors: [] };
globalThis.partyEngine = { lib, game, get, ui, ai, _status, setup, proof };
const fail = (error) => {
  proof.errors.push(String(error?.stack ?? error));
  globalThis.partyEngine.signal?.('failed');
};
window.addEventListener('error', (event) => fail(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => fail(event.reason));

try {
  lib.assetURL = '/engine/core/';
  lib.device = device;
  lib.configprefix = `party_match_${id}_`;
  localStorage.setItem(`${lib.configprefix}directstart`, 'true');
  const config = setup.config;
  const packs = [
    ...new Set([
      ...setup.preset.completePacks,
      ...Object.keys(setup.preset.packGroups),
      ...(setup.preset.additionalCharacters.length ? ['extra'] : []),
    ]),
  ];
  const mode = setup.settings.mode === 'duel' ? 'single' : setup.settings.mode;
  Object.assign(config, {
    mode,
    characters: packs,
    cards: ['standard'],
    extensions: [],
    plays: [],
    show_splash: 'off',
    totouched: true,
    touchscreen: true,
    phonelayout: true,
    compatible: false,
    background_music: 'music_off',
    background_audio: false,
    background_speak: false,
    animation: false,
    low_performance: true,
    game_speed: 'fast',
    sync_speed: false,
    show_disclaimer: false,
    new_tutorial: true,
    video: '0',
    card_style: 'default',
    version: '1.11.6',
    auto_confirm: true,
    identity_mode: 'normal',
    doudizhu_mode: 'normal',
    versus_mode: '2v2',
    single_mode: 'dianjiang',
    show_config: false,
  });
  Object.assign(config.mode_config.global, {
    player_number: setup.settings.playerCount,
    free_choose: false,
    change_identity: false,
    swap: false,
    save_progress: false,
    choose_group: true,
  });
  config.mode_config.single = { single_mode: 'dianjiang', change_card: false };
  config.mode_config.identity = {
    ...config.mode_config.identity,
    identity_mode: 'normal',
    double_character: false,
  };
  config.mode_config.doudizhu = {
    ...config.mode_config.doudizhu,
    doudizhu_mode: 'normal',
    feiyang_version: 'online',
    enhance_dizhu: 'none',
    enhance_nongmin: 'default',
  };
  config.mode_config.versus = {
    ...config.mode_config.versus,
    versus_mode: '2v2',
    replacetwo: false,
  };
  const readJson = lib.init.promises.json;
  lib.init.promises.json = function (url, ...args) {
    if (String(url).endsWith('/game/config.json')) return Promise.resolve(structuredClone(config));
    return readJson.call(this, url, ...args);
  };
  await browserReady({ lib, game, get, ui, ai, _status });
  lib.buildInfo = await loadBuildInfo();
  installPrivacy();
  installControls();
  // A rule worker has no participating viewpoint, and always uses native AI
  // for AI seats. Human clients make their choices in the upstream interface.
  _status.auto = role === 'worker';
  if (role === 'player') game.onlineID = setup.playerId;
  lib.onover.push(() => {
    proof.ended = true;
    globalThis.partyEngine.signal?.('ended');
  });
  await boot();
  proof.booted = true;
  if (role === 'player')
    parent.postMessage({ type: 'party-connected', matchId: id }, location.origin);
} catch (error) {
  fail(error);
  console.error(error);
}
