/** Seat-local playback, without importing any engine module. */
export function createTableAudio(
  assetBase: string,
  report: (enabled: boolean, muted: boolean) => void,
) {
  let context: AudioContext | undefined;
  let muted = localStorage.getItem('party_sound_muted') === 'true';
  let generation = 0;
  const buffers = new Map<string, Promise<AudioBuffer>>();
  const sources = new Set<AudioBufferSourceNode>();
  const state = () => report(!muted && context?.state === 'running', muted);
  async function unlock() {
    if (muted) return;
    try {
      context ??= new AudioContext();
      await context.resume();
      state();
    } catch {
      state();
    }
  }
  async function setEnabled(enabled: boolean) {
    muted = !enabled;
    localStorage.setItem('party_sound_muted', String(muted));
    generation++;
    for (const source of sources) source.stop();
    if (enabled) await unlock();
    state();
  }
  function play(path: string, age = 0) {
    if (
      muted ||
      context?.state !== 'running' ||
      document.hidden ||
      age > 1500 ||
      sources.size >= 2 ||
      !/^[\w/-]+\.(mp3|ogg)$/.test(path)
    )
      return;
    const started = performance.now(),
      current = generation,
      audioContext = context;
    let pending = buffers.get(path);
    if (!pending) {
      pending = fetch(`${assetBase}audio/${path}`).then(async (response) => {
        if (!response.ok) throw new Error();
        return audioContext.decodeAudioData(await response.arrayBuffer());
      });
      buffers.set(path, pending);
      if (buffers.size > 48) buffers.delete(buffers.keys().next().value!);
    }
    void pending
      .then((buffer) => {
        if (
          muted ||
          current !== generation ||
          document.hidden ||
          performance.now() - started + age > 1500 ||
          sources.size >= 2
        )
          return;
        const source = audioContext.createBufferSource(),
          gain = audioContext.createGain();
        source.buffer = buffer;
        gain.gain.value = 0.75;
        source.connect(gain).connect(audioContext.destination);
        source.onended = () => {
          sources.delete(source);
          gain.disconnect();
        };
        sources.add(source);
        source.start();
      })
      .catch(() => buffers.delete(path));
  }
  document.addEventListener('pointerdown', () => void unlock(), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      generation++;
      for (const source of sources) source.stop();
    }
  });
  state();
  return { play, setEnabled, toggle: () => setEnabled(muted) };
}
