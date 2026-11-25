// Where the two colleagues stand. Pure, so it is tested without a renderer.
import { BREAK_SPOTS } from '../../components/office/gaming/gamingLayout';
import type { V2 } from '../../components/office/gaming/gamingLayout';
import { WORKER_SPOTS, WORKER_SPOTS_WALL } from '../ideaLayout';

export const FLANK_SEP = 0.85;      // each colleague stands this far to a side of the note they are discussing
export const FLANK_Z = WORKER_SPOTS.claude.z;
const LIMIT = Math.abs(WORKER_SPOTS_WALL.gpt.x);

// Either side of the note, on the floor in front of the wall. Kept inside the walkable strip so a note at the very edge does not push anyone into a desk.
export function flankSpots(noteX: number): { claude: V2; gpt: V2 } {
  const cx = Math.max(-LIMIT + FLANK_SEP, Math.min(LIMIT - FLANK_SEP, noteX));
  return { claude: { x: cx - FLANK_SEP, z: FLANK_Z }, gpt: { x: cx + FLANK_SEP, z: FLANK_Z } };
}

export interface StageInput {
  mode: 'walk' | 'wall';
  staging: boolean;                                   // a debate is on stage (running, or finished with its panel still open)
  noteX: number | null;                               // where the debated note hangs
  failed: 'claude' | 'gpt' | 'system' | null;         // who stepped out, if the debate failed
}
// Idle: beside the writing desk. Debating: next to the note (or at the ends of the board while the wall close-up is open, so they
// never stand in front of the notes). A colleague whose model failed walks off to the coffee corner.
export function workerSpots(i: StageInput): { claude: V2; gpt: V2 } {
  const base = i.staging && i.mode === 'walk' && i.noteX !== null ? flankSpots(i.noteX) : i.mode === 'wall' ? { ...WORKER_SPOTS_WALL } : { ...WORKER_SPOTS };
  if (i.failed === 'claude') base.claude = BREAK_SPOTS[0];
  if (i.failed === 'gpt') base.gpt = BREAK_SPOTS[0];
  return base;
}
