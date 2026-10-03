import { lib, game, get, ui, ai, _status } from 'noname';
import browserReady from '/noname/init/browser.js';
import { boot } from '/noname/init/index.js';
import { device } from '/noname/util/index.js';
import { loadBuildInfo } from '/noname/util/meta.js';

// The release already contains compiled JavaScript. LAN HTTP must not run the
// upstream entry's optional TypeScript / Service Worker capability check.
// Noname v1.11.6 is GPL-3.0-only. Source / notices are retained separately.
const proof = { booted: false, ended: false, errors: [] };
const setup = await fetch('/api/lab-setup').then((response) => response.json());
setup.role = new URLSearchParams(location.search).get('role') ?? 'rule-host';
globalThis.partyEngineLab = { lib, game, get, ui, ai, _status, proof, setup };
window.addEventListener('error', (event) => proof.errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => proof.errors.push(String(event.reason)));

try {
  lib.device = device;
  // Keep experimental settings separate from the product / stock engine database.
  lib.configprefix = 'party_lab_v1116_';
  await browserReady({ lib, game, get, ui, ai, _status });
  lib.buildInfo = await loadBuildInfo();
  lib.onover.push(() => {
    proof.ended = true;
    proof.winners = game.players
      .filter((player) => player.isAlive())
      .map((player) => player.playerid);
  });
  _status.auto = setup.role === 'rule-host';
  await boot();
  proof.booted = true;
} catch (error) {
  proof.errors.push(String(error.stack ?? error));
  console.error(error);
}
