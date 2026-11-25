import { describe, expect, it } from 'vitest';
import type { Link } from '@idea-office/shared';
import { PIN_DROP, anchorOf, canLink, distToPolyline, hitLink, hitPin, linksOf, sagOf, sampleThread, threadPoint } from './linkGeometry';
import { noteSize } from './wallGeometry';

const n = (id: string, x: number, y: number, rotation = 0, z = 1) => ({ id, x, y, rotation, z });
const link = (id: string, from: string, to: string): Link => ({ id, from, to, label: '', createdBy: 'user', createdAt: '' });

describe('anchorOf', () => {
  it('is the top centre of an upright note, a little below its edge', () => {
    const a = anchorOf(n('a', 1, 1.5));
    expect(a.x).toBeCloseTo(1, 9);
    expect(a.y).toBeCloseTo(1.5 + noteSize('a').h / 2 - PIN_DROP, 9);
  });
  it('turns with the note', () => {
    const d = noteSize('a').h / 2 - PIN_DROP;
    const a = anchorOf(n('a', 1, 1.5, 90));      // turned a quarter-turn anticlockwise: the top now faces left
    expect(a.x).toBeCloseTo(1 - d, 9);
    expect(a.y).toBeCloseTo(1.5, 9);
  });
});

describe('thread shape', () => {
  const a = { x: 0, y: 2 }, b = { x: 2, y: 2 };
  it('starts and ends exactly on the pins and sags between them', () => {
    const pts = sampleThread(a, b);
    expect(pts[0]).toEqual(a);
    expect(pts[pts.length - 1].x).toBeCloseTo(2, 9);
    expect(pts[pts.length - 1].y).toBeCloseTo(2, 9);
    const mid = threadPoint(a, b, 0.5);
    expect(mid.y).toBeCloseTo(2 - sagOf(a, b), 9);        // visible sag equals sagOf
    expect(mid.x).toBeCloseTo(1, 9);
  });
  it('sags more for longer threads but never more than the cap', () => {
    expect(sagOf(a, { x: 1, y: 2 })).toBeLessThan(sagOf(a, b));
    expect(sagOf(a, { x: 50, y: 2 })).toBe(0.45);
    expect(sagOf(a, a)).toBe(0);                         // zero length does not blow up
  });
});

describe('distToPolyline', () => {
  it('measures to the nearest segment, including its ends', () => {
    const pts = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
    expect(distToPolyline({ x: 1, y: 1 }, pts)).toBeCloseTo(1, 9);
    expect(distToPolyline({ x: 3, y: 0 }, pts)).toBeCloseTo(1, 9);
  });
});

describe('hitPin', () => {
  it('grabs the pin of the note under the cursor', () => {
    const notes = [n('a', 0, 1.5)];
    const a = anchorOf(notes[0]);
    expect(hitPin(notes, { x: a.x + 0.03, y: a.y })).toBe('a');
    expect(hitPin(notes, { x: a.x + 0.5, y: a.y })).toBeNull();
  });
  it('cannot grab a pin that is covered by a newer note', () => {
    const under = n('a', 0, 1.5, 0, 1);
    const over = n('b', 0, 1.75, 0, 2);                  // sits on top of a's pin
    const pin = anchorOf(under);
    // make sure the setup really covers the pin
    expect(Math.abs(pin.y - over.y)).toBeLessThan(noteSize('b').h / 2);
    expect(hitPin([under, over], pin)).toBeNull();
  });
});

describe('hitLink', () => {
  const notes = new Map([['a', n('a', 0, 1.5)], ['b', n('b', 2, 1.5)]]);
  const links = [link('l1', 'a', 'b')];
  it('hits near the thread and misses far from it', () => {
    const mid = threadPoint(anchorOf(notes.get('a')!), anchorOf(notes.get('b')!), 0.5);
    expect(hitLink(links, notes, mid)).toBe('l1');
    expect(hitLink(links, notes, { x: mid.x, y: mid.y + 0.5 })).toBeNull();
  });
  it('ignores links whose note is gone', () => {
    expect(hitLink([link('l2', 'a', 'missing')], notes, { x: 1, y: 1.5 })).toBeNull();
  });
});

describe('canLink / linksOf', () => {
  const links = [link('l1', 'a', 'b'), link('l2', 'c', 'a')];
  it('rejects self and duplicates in either direction', () => {
    expect(canLink(links, 'a', 'a')).toBe(false);
    expect(canLink(links, 'b', 'a')).toBe(false);
    expect(canLink(links, 'b', 'c')).toBe(true);
  });
  it('lists a note\'s links with the note at the other end', () => {
    expect(linksOf(links, 'a').map((x) => [x.link.id, x.otherId])).toEqual([['l1', 'b'], ['l2', 'c']]);
    expect(linksOf(links, 'z')).toEqual([]);
  });
});
