import { describe, expect, it } from 'vitest';
import { DROP_SHARP_PX, NOTE_WIDTH_M, WANT_SHARP_PX, wantSharp } from './wallView';

const view = (ppm: number, over: Partial<{ active: boolean; px: number; py: number; halfW: number; halfH: number }> = {}) =>
  ({ active: true, px: 0, py: 1.75, halfW: 2, halfH: 1.1, ppm, ...over });
const ppmFor = (notePx: number) => notePx / NOTE_WIDTH_M;

describe('wantSharp', () => {
  it('is never sharp while walking around the office', () => {
    expect(wantSharp(false, 0, 1.75, view(ppmFor(500), { active: false }))).toBe(false);
  });
  it('is sharp only once the note is big on screen', () => {
    expect(wantSharp(false, 0, 1.75, view(ppmFor(WANT_SHARP_PX - 1)))).toBe(false);
    expect(wantSharp(false, 0, 1.75, view(ppmFor(WANT_SHARP_PX + 1)))).toBe(true);
  });
  it('has hysteresis: a sharp note stays sharp until it clearly shrinks, so zooming does not flicker', () => {
    const between = (WANT_SHARP_PX + DROP_SHARP_PX) / 2;
    expect(wantSharp(true, 0, 1.75, view(ppmFor(between)))).toBe(true);        // already sharp: keep
    expect(wantSharp(false, 0, 1.75, view(ppmFor(between)))).toBe(false);      // not yet sharp: stay normal
    expect(wantSharp(true, 0, 1.75, view(ppmFor(DROP_SHARP_PX - 1)))).toBe(false);
  });
  it('drops notes that are off screen, with a margin so the edge ones are ready before they scroll in', () => {
    const v = view(ppmFor(400));
    expect(wantSharp(false, 2.2, 1.75, v)).toBe(true);        // just outside the visible half-width (2.0), inside the margin
    expect(wantSharp(true, 2.5, 1.75, v)).toBe(false);        // well outside
    expect(wantSharp(true, 0, 3.5, v)).toBe(false);
  });
  it('is false when the view is not measured yet', () => {
    expect(wantSharp(false, 0, 1.75, view(0))).toBe(false);
  });
});
