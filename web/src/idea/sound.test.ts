import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A recording stand-in for the browser's audio system: counts what was created and started.
function installFakeAudio(state: 'running' | 'suspended' = 'running') {
  const log = { sources: 0, oscillators: 0, started: 0, stopped: 0, resumed: 0, looped: 0 };
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn() });
  class FakeCtx {
    state = state; currentTime = 1; sampleRate = 8000; destination = {};
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve(); }
    createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { log.sources++; const s: any = { ...node(), buffer: null, loop: false, start: () => { log.started++; if (s.loop) log.looped++; }, stop: () => { log.stopped++; } }; return s; }
    createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
    createGain() { return { ...node(), gain: param() }; }
    createOscillator() { log.oscillators++; return { ...node(), type: '', frequency: param(), start: () => { log.started++; }, stop: () => { log.stopped++; } }; }
  }
  (globalThis as any).AudioContext = FakeCtx;
  return log;
}

beforeEach(() => { vi.resetModules(); delete (globalThis as any).AudioContext; });
afterEach(() => { delete (globalThis as any).AudioContext; });

describe('sound', () => {
  it('stays silent until audio is unlocked by a user gesture', async () => {
    const log = installFakeAudio();
    const s = await import('./sound');
    s.sfx.rustle(); s.sfx.pin();
    expect(log.sources + log.oscillators).toBe(0);
    s.unlockAudio();
    s.sfx.rustle();
    expect(log.sources).toBe(3);                 // three noise bursts make the rustle
    expect(log.started).toBe(log.stopped);       // every sound that starts is also scheduled to stop
  });
  it('makes tones for the pin, thread and chime effects', async () => {
    const log = installFakeAudio();
    const s = await import('./sound');
    s.unlockAudio();
    s.sfx.pin(); s.sfx.thread(); s.sfx.chime();
    expect(log.oscillators).toBe(1 + 2 + 2);
    expect(log.sources).toBe(1);                 // the pin's click
  });
  it('plays nothing when sound effects are switched off', async () => {
    const log = installFakeAudio();
    const s = await import('./sound');
    s.unlockAudio(); s.setSoundPrefs({ sfx: false });
    s.sfx.rustle(); s.sfx.chime();
    expect(log.sources + log.oscillators).toBe(0);
    s.setSoundPrefs({ sfx: true });
    s.sfx.rustle();
    expect(log.sources).toBe(3);
  });
  it('resumes a suspended audio context when unlocked', async () => {
    const log = installFakeAudio('suspended');
    const s = await import('./sound');
    s.unlockAudio();
    expect(log.resumed).toBe(1);
  });
  it('office hush loops while on, and stops when switched off', async () => {
    const log = installFakeAudio();
    const s = await import('./sound');
    s.unlockAudio();
    s.setSoundPrefs({ ambience: true });
    expect(log.looped).toBe(1);
    s.setSoundPrefs({ ambience: true });         // asking again does not start a second one
    expect(log.looped).toBe(1);
    s.setSoundPrefs({ ambience: false });
    expect(log.stopped).toBe(1);
  });
  it('never throws where there is no audio system, or when it fails', async () => {
    const s = await import('./sound');           // no AudioContext at all
    expect(() => { s.unlockAudio(); s.sfx.rustle(); s.sfx.pin(); s.sfx.thread(); s.sfx.chime(); s.setSoundPrefs({ ambience: true }); }).not.toThrow();
    vi.resetModules();
    (globalThis as any).AudioContext = class { constructor() { throw new Error('blocked'); } };
    const s2 = await import('./sound');
    expect(() => { s2.unlockAudio(); s2.sfx.rustle(); }).not.toThrow();
  });
});
