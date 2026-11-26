type StageTone = 'click' | 'success' | 'seat';

const MUTE_KEY = 'party_stage_muted';
const tones = {
  click: [[930, 0, 0.035, 0.045]],
  success: [
    [660, 0, 0.075, 0.055],
    [990, 0.07, 0.13, 0.05],
  ],
  seat: [
    [740, 0, 0.09, 0.05],
    [1110, 0.075, 0.16, 0.042],
  ],
} as const;

export function createStageSound() {
  let muted = localStorage.getItem(MUTE_KEY) === 'true';
  let audio: AudioContext | undefined;
  let lastSeat = -Infinity;
  function unlock(event: Event) {
    if (!event.isTrusted || muted || !window.AudioContext) return;
    try {
      audio ??= new AudioContext();
      if (audio.state !== 'running') void audio.resume().catch(() => {});
    } catch {
      audio = undefined;
    }
  }
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
  window.addEventListener('click', unlock, { capture: true });
  return {
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      localStorage.setItem(MUTE_KEY, String(muted));
    },
    play(tone: StageTone) {
      if (muted || audio?.state !== 'running' || document.hidden) return;
      const now = audio.currentTime;
      if (tone === 'seat') {
        if (now - lastSeat < 0.24) return;
        lastSeat = now;
      }
      for (const [frequency, delay, length, volume] of tones[tone]) {
        const start = now + delay;
        const oscillator = audio.createOscillator();
        const envelope = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        envelope.gain.setValueAtTime(0.001, start);
        envelope.gain.exponentialRampToValueAtTime(volume, start + 0.009);
        envelope.gain.exponentialRampToValueAtTime(0.001, start + length);
        oscillator.connect(envelope).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.01);
      }
    },
  };
}
