import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from '@playwright/test';

/** Inspect from Node: requestAnimationFrame correctly stops in a hidden page. */
export function observeBackgroundPage(page) {
  function instrument(frame) {
    frame.waitForFunction = async (predicate, argument, options = {}) => {
      const deadline = options.timeout === 0 ? Infinity : Date.now() + (options.timeout ?? 30000);
      while (Date.now() < deadline) {
        const handle = await frame.evaluateHandle(predicate, argument);
        if (await handle.evaluate((value) => Boolean(value))) return handle;
        await handle.dispose();
        await wait(100);
      }
      const error = new Error('Background condition did not become true before the deadline');
      error.name = 'TimeoutError';
      throw error;
    };
  }
  // Only test observers change. Browser timers, visibility and native code stay
  // untouched, so QA cannot make a throttled rule executor run by accident.
  page.waitForFunction = (...args) => page.mainFrame().waitForFunction(...args);
  for (const frame of page.frames()) instrument(frame);
  page.on('frameattached', instrument);
}

/** A separate test browser with genuine tab visibility and normal timer policy. */
export async function launchBackgroundBrowser(root) {
  assert.equal(process.platform, 'win32', 'Background verification currently uses Windows Edge');
  const executable = resolve(
    process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
    'Microsoft/Edge/Application/msedge.exe',
  );
  await access(executable);
  const parent = resolve(root, '.runtime');
  await mkdir(parent, { recursive: true });
  const profile = await mkdtemp(resolve(parent, 'background-browser-'));
  const child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-component-update',
      // The documented test switch reduces the hidden-tab grace period from
      // five minutes to ten seconds. No timer/focus exemptions are enabled.
      '--enable-features=IntensiveWakeUpThrottling:grace_period_seconds/10,OptOutZeroTimeoutTimersFromThrottling,AllowAggressiveThrottlingWithWebSocket',
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    let port;
    for (let attempts = 0; attempts < 120; attempts++) {
      port = await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
      if (port) break;
      if (child.exitCode !== null) throw new Error('Isolated background browser exited');
      await wait(250);
    }
    assert(port, 'Isolated background browser must expose its test endpoint');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port.split('\n')[0]}`, {
      noDefaults: true,
    });
    return {
      browser,
      profile,
      close: async () => {
        await browser.close();
        if (child.exitCode === null) child.kill();
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    throw error;
  }
}
