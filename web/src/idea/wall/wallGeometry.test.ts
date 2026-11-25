import { describe, expect, it } from 'vitest';
import { BOARD, PAPERS, clampToBoard, hitTest, matchNote, noteLook, noteSize, placeNote, wrapText } from './wallGeometry';

const note = (id: string, x: number, y: number, rotation = 0, z = 1) => ({ id, x, y, rotation, z });
const ov = (a: { x: number; y: number; id: string }, b: { x: number; y: number; id: string }) => {
  const sa = noteSize(a.id), sb = noteSize(b.id);
  return Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2;
};

describe('noteLook', () => {
  it('is deterministic, so a note always looks the same', () => {
    expect(noteLook('abc')).toEqual(noteLook('abc'));
    expect(noteLook('abc')).not.toEqual(noteLook('abd'));
  });
  it('varies size and paper across many notes (a mixed wall, not a uniform one)', () => {
    const looks = Array.from({ length: 80 }, (_, i) => noteLook(`n${i}`));
    expect(new Set(looks.map((l) => l.paper)).size).toBeGreaterThanOrEqual(4);
    expect(looks.every((l) => PAPERS.includes(l.paper))).toBe(true);
    expect(Math.max(...looks.map((l) => l.scale)) - Math.min(...looks.map((l) => l.scale))).toBeGreaterThan(0.15);
    expect(new Set(looks.map((l) => l.tape)).size).toBe(3);
  });
});

describe('placeNote', () => {
  it('puts the first note near the middle of the board', () => {
    const p = placeNote([], 'first');
    expect(Math.abs(p.x - BOARD.cx)).toBeLessThan(0.5);
    expect(Math.abs(p.y - BOARD.cy)).toBeLessThan(0.5);
  });
  it('never overlaps while there is free room, and stays on the board', () => {
    const notes: { id: string; x: number; y: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const p = placeNote(notes, `p${i}`, i);
      const n = { id: `p${i}`, ...p };
      expect(notes.some((o) => ov(o, n))).toBe(false);
      expect(Math.abs(p.x - BOARD.cx)).toBeLessThanOrEqual(BOARD.w / 2);
      expect(p.y).toBeGreaterThan(BOARD.cy - BOARD.h / 2);
      expect(p.y).toBeLessThan(BOARD.cy + BOARD.h / 2);
      notes.push(n);
    }
  });
  it('still places a note when the wall is completely full (overlapping the least)', () => {
    const notes = Array.from({ length: 150 }, (_, i) => ({ id: `f${i}`, ...placeNote([], `f${i}`, i + 1000) }));
    const p = placeNote(notes, 'extra', 7);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('clampToBoard', () => {
  it('keeps the whole paper on the board', () => {
    const s = { w: 0.6, h: 0.7 };
    const c = clampToBoard(99, -99, s);
    expect(c.x + s.w / 2).toBeLessThanOrEqual(BOARD.cx + BOARD.w / 2);
    expect(c.y - s.h / 2).toBeGreaterThanOrEqual(BOARD.cy - BOARD.h / 2);
  });
});

describe('hitTest', () => {
  it('picks the topmost of overlapping notes', () => {
    const notes = [note('a', 0, 1.5, 0, 1), note('b', 0.1, 1.5, 0, 2)];
    expect(hitTest(notes, { x: 0.05, y: 1.5 })).toBe('b');
  });
  it('misses empty wall and respects rotation', () => {
    const s = noteSize('r');
    expect(hitTest([note('r', 0, 1.5)], { x: 2, y: 1.5 })).toBeNull();
    // A tall note turned 90 degrees is now wide: a point beside it (inside the old width, outside the new) must miss.
    const rotated = [note('r', 0, 1.5, 90)];
    expect(hitTest(rotated, { x: 0, y: 1.5 + s.w / 2 - 0.01 })).toBe('r');       // along the new vertical extent (= old width)
    expect(hitTest(rotated, { x: s.h / 2 - 0.01, y: 1.5 })).toBe('r');           // along the new horizontal extent (= old height)
    expect(hitTest(rotated, { x: 0, y: 1.5 + s.h / 2 - 0.01 })).toBeNull();      // old height direction is now narrow
  });
});

describe('wrapText', () => {
  const m = (s: string) => Array.from(s).length * 10;      // every character is 10px wide
  it('wraps on spaces and keeps the founder\'s line breaks', () => {
    expect(wrapText(m, 'aaa bbb ccc', 70)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText(m, 'one\ntwo', 200)).toEqual(['one', 'two']);
  });
  it('breaks one over-long word by characters instead of overflowing', () => {
    const lines = wrapText(m, 'abcdefghij', 40);
    expect(lines).toEqual(['abcd', 'efgh', 'ij']);
    expect(lines.every((l) => m(l) <= 40)).toBe(true);
  });
  it('never splits a Hindi letter from its vowel sign or conjunct when it must break a long word', () => {
    const word = 'विद्यार्थियों';                                    // 13 code points but only 4 written units: वि द्या र्थि यों
    const m = (s: string) => Array.from(s).length * 10;
    const lines = wrapText(m, word, 70);                            // room for 7 code points: a code-point split would cut inside a unit
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(word);                              // nothing lost or reordered
    const combining = /^[ऀ-ःऺ-ॏ॑-ॗॢॣ]/;     // a line may never start with a vowel sign, virama or nasal mark
    for (const l of lines) expect(combining.test(l)).toBe(false);
    // Latin still breaks by letter, and emoji (several code points) stay whole
    expect(wrapText(m, 'abcdefghij', 40)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText((s) => Array.from(s).length * 10, '👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', 40).every((l) => !l.startsWith('‍'))).toBe(true);
  });
  it('handles Hindi text and empty input', () => {
    expect(wrapText(m, 'नमस्ते दुनिया', 1000)).toEqual(['नमस्ते दुनिया']);
    expect(wrapText(m, '', 100)).toEqual(['']);
  });
});

describe('matchNote', () => {
  const n = { type: 'problem' as const, title: 'Parking in Pune', body: 'Nobody can find a spot' };
  it('matches title or body, ignoring case, and filters by type', () => {
    expect(matchNote(n, 'pune', null)).toBe(true);
    expect(matchNote(n, 'SPOT', null)).toBe(true);
    expect(matchNote(n, 'zomato', null)).toBe(false);
    expect(matchNote(n, '', new Set(['problem']))).toBe(true);
    expect(matchNote(n, '', new Set(['pattern']))).toBe(false);
    expect(matchNote(n, '', new Set())).toBe(true);        // empty filter = no filter
  });
});
