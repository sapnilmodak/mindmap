// Walking collision for the player: circle (the avatar) against boxes and circles (furniture), on the floor plan.
// Pure maths, no renderer, so it is unit-tested. Not a physics engine: moves are tried whole, then per axis, which makes the
// avatar slide along walls and desks instead of sticking to them.
import type { V2 } from '../components/office/gaming/gamingLayout';

export type Obstacle =
  | { kind: 'box'; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: 'circle'; x: number; z: number; r: number };

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export const box = (cx: number, cz: number, w: number, d: number): Obstacle =>
  ({ kind: 'box', minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
export const boxRange = (minX: number, maxX: number, minZ: number, maxZ: number): Obstacle => ({ kind: 'box', minX, maxX, minZ, maxZ });
export const circle = (x: number, z: number, r: number): Obstacle => ({ kind: 'circle', x, z, r });

export function hits(p: V2, r: number, o: Obstacle): boolean {
  if (o.kind === 'circle') return Math.hypot(p.x - o.x, p.z - o.z) < r + o.r;
  const cx = Math.max(o.minX, Math.min(p.x, o.maxX));
  const cz = Math.max(o.minZ, Math.min(p.z, o.maxZ));
  return Math.hypot(p.x - cx, p.z - cz) < r;
}

export const blocked = (p: V2, r: number, obs: Obstacle[], b: Bounds): boolean =>
  p.x < b.minX + r || p.x > b.maxX - r || p.z < b.minZ + r || p.z > b.maxZ - r || obs.some((o) => hits(p, r, o));

// Move from `from` by (dx, dz). Returns the new position. If the start is already blocked (e.g. something walked onto the
// player) any move is allowed so the player can never be trapped.
export function moveWithCollision(from: V2, dx: number, dz: number, r: number, obs: Obstacle[], b: Bounds): V2 {
  // Long moves (a lag spike) are cut into small steps so the avatar can never tunnel through a thin obstacle.
  const n = Math.ceil(Math.hypot(dx, dz) / 0.1);
  if (n > 1) {
    let p = from;
    for (let i = 0; i < n; i++) p = stepWithCollision(p, dx / n, dz / n, r, obs, b);
    return p;
  }
  return stepWithCollision(from, dx, dz, r, obs, b);
}

function stepWithCollision(from: V2, dx: number, dz: number, r: number, obs: Obstacle[], b: Bounds): V2 {
  if (blocked(from, r, obs, b)) return { x: from.x + dx, z: from.z + dz };
  const full = { x: from.x + dx, z: from.z + dz };
  if (!blocked(full, r, obs, b)) return full;
  const ax = { x: from.x + dx, z: from.z };
  if (dx !== 0 && !blocked(ax, r, obs, b)) return ax;
  const az = { x: from.x, z: from.z + dz };
  if (dz !== 0 && !blocked(az, r, obs, b)) return az;
  return from;
}
