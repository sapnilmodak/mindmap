import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from './prefs';

const memory = (initial?: string) => { let v = initial ?? null; return { getItem: () => v, setItem: (_k: string, x: string) => { v = x; }, get: () => v }; };

describe('local preferences', () => {
  it('start from sensible defaults: effects on, ambience off, motion on', () => {
    expect(loadPrefs(memory())).toEqual({ reducedMotion: false, sfx: true, ambience: false });
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
  });
  it('round-trip through storage', () => {
    const m = memory();
    savePrefs({ reducedMotion: true, sfx: false, ambience: true }, m);
    expect(loadPrefs(m)).toEqual({ reducedMotion: true, sfx: false, ambience: true });
  });
  it('ignore broken JSON and wrong types, field by field', () => {
    expect(loadPrefs(memory('{ nope'))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memory('"a string"'))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memory(JSON.stringify({ reducedMotion: 'yes', sfx: false, ambience: 1 })))).toEqual({ reducedMotion: false, sfx: false, ambience: false });
  });
  it('survive storage that throws (private mode, blocked cookies)', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadPrefs(bad)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(DEFAULT_PREFS, bad)).not.toThrow();
  });
});
