// SPDX-License-Identifier: GPL-3.0-only

const [, , role, id] = location.pathname.split('/');
const proof = { booted: false, started: false, ended: false, errors: [], loading: [] };
const loading = document.querySelector('#engine-loading');
const status = document.querySelector('#loading-status');
const detail = document.querySelector('#loading-detail');
const retry = document.querySelector('#loading-retry');
const beganAt = performance.now();
let failed = false;
function progress(stage, message) {
  proof.loading.push({ stage, elapsedMs: Math.round(performance.now() - beganAt) });
  if (!failed) status.textContent = message;
}
const fail = (error) => {
  if (proof.errors.length < 10) proof.errors.push(String(error?.stack ?? error));
  if (failed) return;
  failed = true;
  clearTimeout(deadline);
  loading.hidden = false;
  loading.dataset.state = 'failed';
  status.textContent = '对局未能载入';
  detail.textContent = `${error?.message ?? String(error)}\n重试会保留房间和座位。`;
  retry.hidden = false;
  globalThis.partyEngine?.signal?.('failed');
};
retry.addEventListener('click', () => location.reload());
// LAN startup includes module download, parsing and IndexedDB. Never clear a
// player's storage or reload automatically because a phone exceeded ten seconds.
const deadline = setTimeout(
  () => fail(new Error('载入超过两分钟，请检查 Wi-Fi 和电脑服务页后重试。')),
  120000,
);
window.addEventListener('pagehide', () => clearTimeout(deadline), { once: true });
window.addEventListener('error', (event) => fail(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => fail(event.reason));

try {
  progress('setup', '正在读取房间设置…');
  const response = await fetch(`/engine/setup/${id}?role=${role}`);
  if (!response.ok) throw new Error('你的对局座位已失效，请返回房间。');
  const setup = await response.json();
  progress('modules', '正在载入游戏引擎，首次进入可能需要稍等…');
  // Dynamic imports keep the initial status and retry UI alive even when the
  // module graph fails to download or the browser lacks required features.
  const { lib, game, get, ui, ai, _status } = await import('noname');
  globalThis.partyEngine = { lib, game, get, ui, ai, _status, setup, proof };
  const [
    { default: browserReady },
    { boot },
    { device },
    { loadBuildInfo },
    { installPrivacy },
    { installControls },
  ] = await Promise.all([
    import('/engine/core/noname/init/browser.js'),
    import('/engine/core/noname/init/index.js'),
    import('/engine/core/noname/util/index.js'),
    import('/engine/core/noname/util/meta.js'),
    import('./privacy.js'),
    import('./controls.js'),
  ]);
  if (failed) throw new Error('载入已中断，请重试。');
  lib.assetURL = '/engine/core/';
  lib.device = device;
  lib.configprefix = `party_match_${id}_`;
  localStorage.setItem(`${lib.configprefix}directstart`, 'true');
  localStorage.setItem(`${lib.configprefix}loadtime`, '120000');
  lib.init.reset = () => fail(new Error('引擎载入超时，请检查 Wi-Fi 和电脑服务页后重试。'));
  const config = setup.config;
  const packs = [
    ...new Set([
      ...setup.preset.completePacks,
      ...Object.keys(setup.preset.packGroups),
      ...(setup.preset.additionalCharacters.length ? ['extra'] : []),
    ]),
  ];
  const mode = setup.settings.mode === 'duel' ? 'single' : setup.settings.mode;
  const definitions = setup.preset.definitionPacks ?? { characters: packs, cards: ['standard'] };
  Object.assign(config, {
    mode,
    characters: packs,
    cards: ['standard'],
    extensions: [],
    extension_auto_import: false,
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
  // Upstream imports every entry in game/package.js even when config.characters
  // enables only one pack. Narrow discovery before boot builds its import list.
  const readScript = lib.init.promises.js;
  lib.init.promises.js = async function (url, name, ...args) {
    const result = await readScript.call(this, url, name, ...args);
    if (name === 'package' && String(url).replace(/\/$/, '').endsWith('game')) {
      const catalog = window.noname_package;
      for (const pack of definitions.characters)
        if (!catalog.character[pack]) throw new Error(`缺少房间所需武将包：${pack}`);
      catalog.character = Object.fromEntries(
        definitions.characters.map((pack) => [pack, catalog.character[pack]]),
      );
      catalog.card = Object.fromEntries(
        definitions.cards.map((pack) => [pack, catalog.card[pack]]),
      );
      catalog.mode = { [mode]: catalog.mode[mode] };
      catalog.play = {};
      catalog.submode = { [mode]: catalog.submode[mode] ?? {} };
      progress('packs', '正在准备本房间的武将和卡牌…');
    }
    return result;
  };
  progress('filesystem', '正在检查本地游戏资源…');
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
  progress('boot', '正在初始化对局…');
  await boot();
  if (failed) throw new Error('载入已中断，请重试。');
  proof.booted = true;
  progress('ready', '对局已载入');
  clearTimeout(deadline);
  clearTimeout(window.resetGameTimeout);
  loading.hidden = true;
  if (role === 'player')
    parent.postMessage({ type: 'party-connected', matchId: id }, location.origin);
} catch (error) {
  fail(error);
  console.error(error);
}
