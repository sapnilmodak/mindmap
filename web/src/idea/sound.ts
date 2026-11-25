// Small synthesised sound effects (no audio files to ship): paper rustle, pin click, thread pluck, soft chime, optional office hush.
// Browsers only allow audio after a click or key press, so nothing plays until unlockAudio() has run once. Everything is wrapped so a
// missing or failing audio system can never break the app.
export interface SoundPrefs { sfx: boolean; ambience: boolean }

let prefs: SoundPrefs = { sfx: true, ambience: false };
let ctx: AudioContext | null = null;
let stopAmbience: (() => void) | null = null;

const Ctor = (): (new () => AudioContext) | undefined => (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;

export function setSoundPrefs(p: Partial<SoundPrefs>) { prefs = { ...prefs, ...p }; syncAmbience(); }

// Call from a user gesture (first pointer press or key press).
export function unlockAudio() {
  try {
    if (!ctx) { const C = Ctor(); if (!C) return; ctx = new C(); }
    if (ctx.state === 'suspended') void ctx.resume?.();
    syncAmbience();
  } catch { ctx = null; }
}

const live = (): AudioContext | null => (prefs.sfx && ctx && ctx.state !== 'closed' ? ctx : null);

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function envelope(c: AudioContext, at: number, dur: number, peak: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + Math.min(0.012, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(c.destination);
  return g;
}
// a short burst of filtered noise: the building block of the paper and click sounds
function burst(c: AudioContext, at: number, dur: number, freq: number, q: number, peak: number) {
  const src = c.createBufferSource(); src.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  src.connect(f); f.connect(envelope(c, at, dur, peak));
  src.start(at); src.stop(at + dur);
}
function tone(c: AudioContext, at: number, dur: number, freq: number, type: OscillatorType, peak: number) {
  const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
  o.connect(envelope(c, at, dur, peak));
  o.start(at); o.stop(at + dur);
}
const safe = (fn: (c: AudioContext, t: number) => void) => () => { const c = live(); if (!c) return; try { fn(c, c.currentTime); } catch { /* sound is optional */ } };

export const sfx = {
  rustle: safe((c, t) => { burst(c, t, 0.09, 3200, 0.8, 0.2); burst(c, t + 0.1, 0.13, 2300, 0.7, 0.16); burst(c, t + 0.27, 0.07, 4300, 0.9, 0.12); }),
  pin: safe((c, t) => { tone(c, t, 0.05, 1100, 'square', 0.04); burst(c, t, 0.04, 5000, 1.5, 0.12); }),
  thread: safe((c, t) => { tone(c, t, 0.2, 330, 'triangle', 0.09); tone(c, t, 0.12, 660, 'sine', 0.03); }),
  chime: safe((c, t) => { tone(c, t, 0.55, 660, 'sine', 0.06); tone(c, t + 0.13, 0.7, 880, 'sine', 0.05); }),
};

// A very quiet looping hush, like a room with air conditioning. Off unless asked for.
function syncAmbience() {
  const want = prefs.ambience && !!ctx && ctx.state !== 'closed';
  if (!want) { stopAmbience?.(); stopAmbience = null; return; }
  if (stopAmbience || !ctx) return;
  try {
    const c = ctx;
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 4); src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.022;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
    stopAmbience = () => { try { src.stop(); } catch { /* already stopped */ } };
  } catch { stopAmbience = null; }
}
