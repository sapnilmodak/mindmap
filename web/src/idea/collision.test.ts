import { describe, expect, it } from 'vitest';
import { box, circle, moveWithCollision, blocked } from './collision';
import { OBSTACLES, PLAYER_RADIUS, PLAYER_START, WALK_BOUNDS, zoneAt } from './ideaLayout';
import { MEET_TABLE, ROOM } from '../components/office/gaming/gamingLayout';

const B = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

describe('moveWithCollision', () => {
  it('moves freely in open space', () => {
    const p = moveWithCollision({ x: 0, z: 0 }, 1, 1, 0.4, [], B);
    expect(p.x).toBeCloseTo(1, 9); expect(p.z).toBeCloseTo(1, 9);
  });
  it('stops at a box, even when one move is long enough to jump over it', () => {
    const p = moveWithCollision({ x: -3, z: 0 }, 5, 0, 0.4, [box(0, 0, 2, 2)], B);
    expect(p.x).toBeLessThanOrEqual(-1.4 + 1e-9);     // never inside or past the box (face at -1, radius 0.4)
    expect(p.x).toBeGreaterThan(-1.55);               // and it did walk up to it
  });
  it('slides along a box when moving diagonally', () => {
    const p = moveWithCollision({ x: -1.45, z: 0 }, 0.5, 1, 0.4, [box(0, 0, 2, 2)], B);
    expect(p.z).toBeCloseTo(1, 5);                    // z advanced along the face
    expect(p.x).toBeLessThanOrEqual(-1.4 + 1e-9);     // x held back by the face
  });
  it('is blocked by circles and by the bounds', () => {
    expect(blocked({ x: 0.5, z: 0 }, 0.4, [circle(0, 0, 0.5)], B)).toBe(true);
    expect(blocked({ x: 9.7, z: 0 }, 0.4, [], B)).toBe(true);
    expect(blocked({ x: 9.5, z: 0 }, 0.4, [], B)).toBe(false);
  });
  it('never traps a player who starts inside an obstacle', () => {
    const p = moveWithCollision({ x: 0, z: 0 }, 1, 0, 0.4, [box(0, 0, 4, 4)], B);
    expect(p.x).toBeCloseTo(1, 9); expect(p.z).toBeCloseTo(0, 9);
  });
});

describe('the idea office floor plan', () => {
  it('spawns the player in open floor', () => {
    expect(blocked(PLAYER_START, PLAYER_RADIUS, OBSTACLES, WALK_BOUNDS)).toBe(false);
  });
  it('keeps the walk area inside the room', () => {
    expect(WALK_BOUNDS.minX).toBeGreaterThanOrEqual(ROOM.minX);
    expect(WALK_BOUNDS.maxZ).toBeLessThanOrEqual(ROOM.maxZ);
  });
  it('cannot walk straight through the writing desk', () => {
    let p = { x: 0, z: -4.2 };
    for (let i = 0; i < 100; i++) p = moveWithCollision(p, 0, -0.1, PLAYER_RADIUS, OBSTACLES, WALK_BOUNDS);
    expect(p.z).toBeGreaterThan(-6.4);                // stopped in front of the desk, not behind it
  });
  it('every important spot can be reached on foot from the spawn point (flood fill on a 0.15 m grid)', () => {
    const S = 0.15;
    const key = (i: number, j: number) => `${i},${j}`;
    const seen = new Set<string>([key(Math.round(PLAYER_START.x / S), Math.round(PLAYER_START.z / S))]);
    const queue: [number, number][] = [[Math.round(PLAYER_START.x / S), Math.round(PLAYER_START.z / S)]];
    while (queue.length) {
      const [i, j] = queue.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, k = key(ni, nj);
        if (seen.has(k) || blocked({ x: ni * S, z: nj * S }, PLAYER_RADIUS, OBSTACLES, WALK_BOUNDS)) continue;
        seen.add(k); queue.push([ni, nj]);
      }
    }
    const canReach = (x: number, z: number) => seen.has(key(Math.round(x / S), Math.round(z / S)));
    expect({
      rightOfWorkers: canReach(3.8, -5.2),
      betweenWorkers: canReach(0, -4.9),
      leftOfWorkers: canReach(-3.8, -5.2),
      insideCoffeeCounter: canReach(10.9, 3.4),
      frontOfCoffeeCounter: canReach(9.3, 3.4),
      lounge: canReach(-8.4, 4.4),
      meetingCorner: canReach(MEET_TABLE.x, MEET_TABLE.z + 2),
      spawn: canReach(PLAYER_START.x, PLAYER_START.z),
    }).toEqual({ rightOfWorkers: true, betweenWorkers: true, leftOfWorkers: true, insideCoffeeCounter: false, frontOfCoffeeCounter: true, lounge: true, meetingCorner: true, spawn: true });
  });
});

describe('zoneAt', () => {
  it('detects the wall zone and nothing elsewhere', () => {
    expect(zoneAt({ x: 1, z: -5.2 })).toBe('wall');
    expect(zoneAt({ x: 0, z: 5 })).toBeNull();
    expect(zoneAt({ x: 9, z: -5.2 })).toBeNull();
  });
});
