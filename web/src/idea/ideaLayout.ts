// Floor plan of the Idea Office: where the wall, the writing desk and the two workers are, and what blocks walking.
// Positions are metres on the same grid as gamingLayout.ts (x left-right, z back(-) to front(+)).
import { DESK_POS, MEET_TABLE, ROOM } from '../components/office/gaming/gamingLayout';
import type { V2 } from '../components/office/gaming/gamingLayout';
import { box, boxRange, circle } from './collision';
import type { Bounds, Obstacle } from './collision';

export const WALL_Z = ROOM.minZ;                       // the Idea Wall hangs on the back wall
export const IDEA_WALL = { cx: 0, cy: 1.75, w: 8.4, h: 2.9, z: WALL_Z + 0.22 };   // wall tiles are 0.17 m thick (window frames stick out), so the board hangs in front of them
export const WRITING_DESK: V2 = { x: 0, z: -6.45 };

// Desk 1 (back centre) is removed: the Idea Wall and its writing desk take that spot.
export const OFFICE_DESKS = DESK_POS.map((_, i) => i).filter((i) => i !== 1);

// The two colleagues stand either side of the writing desk, facing the wall.
export const WORKER_SPOTS = { claude: { x: -2.6, z: -5.3 } as V2, gpt: { x: 2.6, z: -5.3 } as V2 };
// While the wall close-up is open they step to the ends of the board so they do not stand in front of the notes.
export const WORKER_SPOTS_WALL = { claude: { x: -4.85, z: -5.3 } as V2, gpt: { x: 4.85, z: -5.3 } as V2 };
export const WORKER_FOCUS: V2 = { x: 0, z: WALL_Z };

export const PLAYER_RADIUS = 0.42;
export const PLAYER_START: V2 = { x: 0, z: 3.2 };
export const WALK_BOUNDS: Bounds = { minX: ROOM.minX + 0.25, maxX: ROOM.maxX - 0.25, minZ: ROOM.minZ + 0.25, maxZ: ROOM.maxZ - 0.25 };

// Footprints measured from the furniture models (size = model size x TILE), see Furniture() in GamingScene.tsx.
export const OBSTACLES: Obstacle[] = [
  ...OFFICE_DESKS.map((i) => box(DESK_POS[i].x, DESK_POS[i].z, 1.43, 1.08)),
  ...OFFICE_DESKS.map((i) => circle(DESK_POS[i].x, DESK_POS[i].z + 0.72, 0.3)),     // the chair behind each desk
  box(WRITING_DESK.x, WRITING_DESK.z, 1.8, 1.35),     // writing desk (desk model at scale 1.25)
  circle(MEET_TABLE.x, MEET_TABLE.z, 1.1),                                          // meeting table (chairs around it are walk-through)
  boxRange(ROOM.maxX - 1.0, ROOM.maxX, 1.15, 5.65),                                 // coffee counter
  circle(ROOM.maxX - 0.5, 6.6, 0.45), circle(7.3, 6.6, 0.3), circle(8.1, 7.0, 0.3), // bin and stools
  boxRange(ROOM.minX, ROOM.minX + 0.9, -7.6, -4.5),                                 // bookcases
  boxRange(ROOM.minX, ROOM.minX + 0.95, 4.0, 5.6),                                  // TV cabinet
  boxRange(-10.6, -8.6, 6.05, 7.75),                                                // sofa
  box(-8.4, 5.4, 1.3, 0.8), circle(-6.4, 5.8, 0.5),                                 // coffee table, armchair
  circle(-10.8, -2.6, 0.35), circle(11, -7.1, 0.35), circle(3.3, -2.2, 0.35), circle(-3.3, 2.3, 0.35), circle(11, 0.6, 0.35),   // plants
  circle(-10.8, -1.2, 0.3), circle(-10.8, 0.5, 0.2), circle(-11, 7.0, 0.2),         // coat rack, lamps
];

export type ZoneId = 'wall';

// What the player can interact with from where they stand. Phase 1 only has the wall; the writing desk shares its zone.
export function zoneAt(p: V2): ZoneId | null {
  return p.z < WALL_Z + 3.6 && Math.abs(p.x) < IDEA_WALL.w / 2 + 0.2 ? 'wall' : null;
}
