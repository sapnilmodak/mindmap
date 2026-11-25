import { describe, expect, it } from 'vitest';
import { AISLES, BREAK_SPOTS, DESK_POS, HUB_STAND, intentFor, intentPoint, pathBetween, seatOf } from './gamingLayout';

const base = { isHub: false, desk: 2, status: 'idle' as const, step: 1, doneIndex: 0, doneCount: 0, total: 10 };

describe('intentFor', () => {
  it('seats a working worker at their own desk', () => {
    expect(intentFor({ ...base, status: 'working' })).toEqual({ kind: 'seat', desk: 2 });
  });
  it('stands a blocked worker beside the desk so they can wave', () => {
    expect(intentFor({ ...base, status: 'blocked' }).kind).toBe('desk-stand');
  });
  it('sends a finished worker on a break, and to the meeting once everyone is done', () => {
    expect(intentFor({ ...base, status: 'done' }).kind).toBe('break');
    expect(intentFor({ ...base, status: 'done', step: 4 }).kind).toBe('meet');
  });
  it('keeps the orchestrator at the hub whatever the status', () => {
    expect(intentFor({ ...base, isHub: true, status: 'working' })).toEqual({ kind: 'hub' });
  });
  it('gives every finished worker a different break spot until they run out', () => {
    const seen = new Set(BREAK_SPOTS.map((_, i) => JSON.stringify(intentPoint(intentFor({ ...base, status: 'done', doneIndex: i })))));
    expect(seen.size).toBe(BREAK_SPOTS.length);
  });
});

describe('pathBetween', () => {
  it('is empty when already there', () => {
    expect(pathBetween(HUB_STAND, HUB_STAND)).toEqual([]);
  });
  it('ends at the destination', () => {
    const to = BREAK_SPOTS[0];
    const p = pathBetween(seatOf(0), to);
    expect(p[p.length - 1]).toEqual(to);
  });
  it('never walks across a desk: every leg is along a lane or an aisle', () => {
    const p = pathBetween(seatOf(0), BREAK_SPOTS[5]);
    const start = seatOf(0);
    let prev = start;
    for (const q of p.slice(0, -1)) {
      expect(q.x === prev.x || q.z === prev.z).toBe(true);
      prev = q;
    }
    for (const q of p.slice(0, -2)) expect(AISLES.includes(q.x) || q.x === DESK_POS[0].x).toBe(true);
  });
});
