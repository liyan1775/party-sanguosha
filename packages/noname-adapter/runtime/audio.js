// SPDX-License-Identifier: GPL-3.0-only
import { lib, game } from 'noname';

/** Use one unlocked Web Audio context so iOS/WeChat can play later AI sounds. */
export function installAudio() {
  const { setup, proof } = globalThis.partyEngine;
  const available = new Set(setup.audioFiles);
  if (setup.tableView) {
    game.playAudio = function (...args) {
      const options =
        args.length === 1 && typeof args[0] === 'object'
          ? args[0]
          : {
              path: args
                .filter((arg) => typeof arg === 'string' || typeof arg === 'number')
                .join('/'),
            };
      const path = /\.(mp3|ogg)$/.test(options.path ?? '') ? options.path : `${options.path}.mp3`;
      if (proof.booted && game.ws?.readyState === 1 && available.has(path))
        game.ws.send(JSON.stringify(['tableAudio', path]));
      return document.createElement('audio');
    };
    return;
  }
  proof.audio = { decoded: 0, played: 0, failures: 0, dropped: 0 };
  const buffers = new Map();
  const encoded = new Map();
  const sources = new Set();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let context;
  let muted = localStorage.getItem('party_sound_muted') === 'true';
  let generation = 0;
  let activeReads = 0;
  const waitingReads = [];
  const maxVoiceAge = 1500;
  function readSlot() {
    if (activeReads < 2) {
      activeReads++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waitingReads.push(resolve));
  }
  function releaseSlot() {
    const next = waitingReads.shift();
    if (next) next();
    else activeReads--;
  }
  function readAudio(path) {
    let pending = encoded.get(path);
    if (!pending) {
      pending = readSlot()
        .then(() => fetch(`${lib.assetURL}audio/${path}`, { priority: 'low' }))
        .then(async (response) => {
          if (!response.ok) throw new Error('音效暂时无法载入');
          return response.arrayBuffer();
        })
        .catch((error) => {
          encoded.delete(path);
          throw error;
        })
        .finally(releaseSlot);
      encoded.set(path, pending);
      if (encoded.size > 48) encoded.delete(encoded.keys().next().value);
    }
    return pending;
  }
  function warm() {
    if (setup.role !== 'player') return;
    // Start after boot so even browsers ignoring fetch priority leave their
    // connection slots and bandwidth for the engine and first portraits.
    const basic = ['male', 'female']
      .flatMap((sex) => ['sha', 'shan', 'jiu'].map((name) => `card/${sex}/${name}.mp3`))
      .filter((path) => available.has(path));
    let next = 0;
    for (let lane = 0; lane < 2; lane++)
      void (async () => {
        while (next < basic.length) await readAudio(basic[next++]).catch(() => {});
      })();
  }
  function discardPending() {
    generation++;
    for (const source of sources) source.stop();
  }
  function state() {
    if (setup.role === 'player')
      parent.postMessage(
        {
          type: 'party-audio',
          matchId: setup.id,
          enabled: !muted && context?.state === 'running',
          muted,
        },
        location.origin,
      );
  }
  async function unlock() {
    if (setup.role !== 'player' || muted || !AudioContext) {
      state();
      return;
    }
    context ??= new AudioContext();
    context.onstatechange = state;
    if (context.state === 'running') {
      state();
      return;
    }
    try {
      // resume() is called synchronously in the trusted tap stack.
      await context.resume();
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.connect(context.destination);
      source.start();
    } catch {
      /* The visible sound button permits another trusted tap. */
    }
    state();
  }
  globalThis.partyEngine.audio = {
    async setEnabled(enabled) {
      muted = !enabled;
      localStorage.setItem('party_sound_muted', String(muted));
      if (muted) discardPending();
      else await unlock();
      state();
    },
    async toggle() {
      muted = context?.state === 'running' && !muted;
      localStorage.setItem('party_sound_muted', String(muted));
      if (muted) discardPending();
      else await unlock();
      state();
    },
    unlock,
    warm,
  };
  document.addEventListener(
    'pointerdown',
    () => {
      void unlock();
    },
    { passive: true },
  );
  document.addEventListener(
    'touchstart',
    () => {
      void unlock();
    },
    { passive: true },
  );
  // Decode on demand; audio never delays the engine's loading progress.
  game.playAudio = function (...args) {
    const options =
      args.length === 1 && typeof args[0] === 'object'
        ? args[0]
        : {
            path: args
              .filter((arg) => typeof arg === 'string' || typeof arg === 'number')
              .join('/'),
            onError: args.find((arg) => typeof arg === 'function'),
          };
    const path = /\.(mp3|ogg)$/.test(options.path ?? '') ? options.path : `${options.path}.mp3`;
    const handle = document.createElement('audio');
    if (setup.role !== 'player' || muted || context?.state !== 'running' || !available.has(path))
      return handle;
    if (
      !proof.booted ||
      document.hidden ||
      (globalThis.partyEngine.deliveryAge ?? 0) > maxVoiceAge
    ) {
      proof.audio.dropped++;
      return handle;
    }
    const requestedAt = performance.now();
    const requestedGeneration = generation;
    let stopped = false;
    let source;
    handle.pause = () => {
      stopped = true;
      source?.stop();
    };
    let buffer = buffers.get(path);
    if (!buffer) {
      buffer = readAudio(path)
        .then(async (bytes) => {
          const result = await context.decodeAudioData(bytes.slice(0));
          proof.audio.decoded++;
          return result;
        })
        .catch((error) => {
          buffers.delete(path);
          throw error;
        });
      buffers.set(path, buffer);
      // Bound retained decoded sounds on long mobile games.
      if (buffers.size > 48) buffers.delete(buffers.keys().next().value);
    }
    void buffer
      .then((decoded) => {
        if (
          muted ||
          stopped ||
          document.hidden ||
          context.state !== 'running' ||
          requestedGeneration !== generation ||
          performance.now() - requestedAt > maxVoiceAge ||
          sources.size >= 2
        ) {
          proof.audio.dropped++;
          return;
        }
        source = context.createBufferSource();
        source.buffer = decoded;
        const volume = context.createGain();
        volume.gain.value = (lib.config.volumn_audio ?? 6) / 8;
        source.connect(volume).connect(context.destination);
        sources.add(source);
        source.onended = () => {
          sources.delete(source);
          volume.disconnect();
          options.onEnded?.(new Event('ended'));
        };
        options.onCanPlay?.(new Event('canplay'));
        source.start();
        proof.audio.played++;
        options.onPlay?.(new Event('play'));
      })
      .catch(() => {
        proof.audio.failures++;
        options.onError?.(new Event('error'));
      });
    return handle;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) discardPending();
  });
  window.addEventListener(
    'pagehide',
    () => {
      discardPending();
      void context?.close();
    },
    { once: true },
  );
  state();
}
