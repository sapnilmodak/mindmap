// Where everything stands in the 3D office, in metres. x runs left to right,
// z runs back (negative) to front (positive), y is up. Pure data and maths, so
// it can be tested without a renderer.
import type { OfficeStatus } from '../../../lib/officeModel';

export interface V2 { x: number; z: number }

export const TILE = 1.95;                    // one Kenney furniture unit in metres: the kit is drawn at 1 = 0.51 m, so this makes a desk 0.74 m high
export const WALL_H = 3.3;                   // wall tiles are stretched up from the kit's 2.5 m so the room has a proper ceiling
export const ROOM = { minX: -11.7, maxX: 11.7, minZ: -7.8, maxZ: 7.8 };

// Same order as PREFERRED_DESK in lib/officeModel.ts: three desks at the back,
// four in the middle, two at the front.
export const DESK_POS: V2[] = [
  { x: -6, z: -5 }, { x: 0, z: -5 }, { x: 6, z: -5 },
  { x: -8.25, z: -0.5 }, { x: -2.75, z: -0.5 }, { x: 2.75, z: -0.5 }, { x: 8.25, z: -0.5 },
  { x: -3, z: 4 }, { x: 3, z: 4 },
];
export const DESK_ROW = [0, 0, 0, 1, 1, 1, 1, 2, 2];
export const CHAIR_OFFSET = 0.72;            // the worker sits this far in front of the desk (toward the camera) and faces the back wall
export const SEAT_Y = 0.46;                  // how far a seated worker is lowered

export const HUB_TABLE: V2 = { x: 0, z: -2.1 };
export const HUB_STAND: V2 = { x: 0, z: -2.95 };

// Walking lanes (z) in front of each row of desks, and the north-south aisles (x).
export const LANES = [-3.3, 2.2, 6.2];
export const AISLES = [-5.5, 0, 5.5];

export const MEET_TABLE: V2 = { x: 9.2, z: -4.6 };
export const BREAK_SPOTS: V2[] = [   // along the coffee counter (front right), then the lounge (front left)
  { x: 9.7, z: 3.0 }, { x: 9.7, z: 4.3 }, { x: 8.4, z: 3.7 }, { x: 8.2, z: 5.3 }, { x: 9.9, z: 5.6 },
  { x: -9.4, z: 4.0 }, { x: -7.3, z: 4.0 }, { x: -10.3, z: 5.2 }, { x: -6.3, z: 6.2 },
];

export const seatOf = (desk: number): V2 => ({ x: DESK_POS[desk].x, z: DESK_POS[desk].z + CHAIR_OFFSET });
export const standBesideDesk = (desk: number): V2 => ({ x: DESK_POS[desk].x + 1.25, z: DESK_POS[desk].z + CHAIR_OFFSET });

// Standing places around the meeting table: the front and both sides, never the wall side.
export function meetSpot(i: number, n: number): V2 {
  const a = -Math.PI * 0.25 + (i / Math.max(1, n - 1)) * Math.PI * 1.5;
  return { x: MEET_TABLE.x + Math.cos(a) * 2.1, z: MEET_TABLE.z + Math.sin(a) * 1.9 };
}

export type Intent =
  | { kind: 'seat'; desk: number }
  | { kind: 'desk-stand'; desk: number }
  | { kind: 'break'; spot: V2 }
  | { kind: 'meet'; spot: V2 }
  | { kind: 'hub' };

export interface IntentInput {
  isHub: boolean;
  desk: number;                 // -1 when the worker has no desk
  status: OfficeStatus;
  step: number;
  doneIndex: number;            // order in which this worker finished, 0 based
  doneCount: number;
  total: number;
}

// What a worker is doing for a given point in the run. Derived from the real
// state only: working means at the desk, done means on a break, and once every
// worker is done the team gathers at the meeting table.
export function intentFor(i: IntentInput): Intent {
  if (i.isHub) return { kind: 'hub' };
  if (i.desk < 0) return { kind: 'break', spot: BREAK_SPOTS[i.doneIndex % BREAK_SPOTS.length] };
  if (i.status === 'working') return { kind: 'seat', desk: i.desk };
  if (i.status === 'blocked') return { kind: 'desk-stand', desk: i.desk };
  if (i.status === 'done') {
    if (i.step >= 4) return { kind: 'meet', spot: meetSpot(i.doneIndex, i.total) };
    return { kind: 'break', spot: BREAK_SPOTS[i.doneIndex % BREAK_SPOTS.length] };
  }
  return { kind: 'desk-stand', desk: i.desk };
}

export function intentPoint(it: Intent): V2 {
  switch (it.kind) {
    case 'seat': return seatOf(it.desk);
    case 'desk-stand': return standBesideDesk(it.desk);
    case 'break': case 'meet': return it.spot;
    case 'hub': return HUB_STAND;
  }
}

const nearest = (xs: number[], x: number) => xs.reduce((b, v) => (Math.abs(v - x) < Math.abs(b - x) ? v : b), xs[0]);
const laneBefore = (z: number) => LANES.find((l) => l > z) ?? LANES[LANES.length - 1];

// Waypoints from one place to another that stay in the aisles: step out into
// the lane in front of the desk row, walk to an aisle, go along it, then in.
export function pathBetween(a: V2, b: V2): V2[] {
  if (Math.hypot(a.x - b.x, a.z - b.z) < 0.05) return [];
  const direct = Math.abs(a.x - b.x) < 2.2 && Math.abs(a.z - b.z) < 2.2;
  if (direct) return [b];
  const laneA = laneBefore(a.z - 0.3);
  const laneB = laneBefore(b.z - 0.3);
  const ax = nearest(AISLES, (a.x + b.x) / 2);
  const pts: V2[] = [{ x: a.x, z: laneA }];
  if (laneA !== laneB) {
    pts.push({ x: ax, z: laneA }, { x: ax, z: laneB });
  }
  pts.push({ x: b.x, z: laneB }, b);
  // Drop zero-length steps.
  return pts.filter((p, i) => Math.hypot(p.x - (i ? pts[i - 1].x : a.x), p.z - (i ? pts[i - 1].z : a.z)) > 0.05);
}

export const yawToward = (from: V2, to: V2): number => Math.atan2(to.x - from.x, to.z - from.z);
