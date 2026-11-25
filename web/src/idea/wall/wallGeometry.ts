// Pure maths for the Idea Wall: where notes go, how big and how messy each one looks, what a click hits, what a search matches.
// Wall coordinates are metres: x across the board from its centre, y is height above the floor. A note's (x, y) is its centre.
import type { Note, NoteType } from '@idea-office/shared';

export const BOARD = { cx: 0, cy: 1.75, w: 8.4, h: 2.9 };            // matches IDEA_WALL in ideaLayout.ts
export const NOTE_BASE = { w: 0.74, h: 0.91 };
export const PAPER_PX = { w: 240, h: 296 };                          // the paper itself in the texture; the shadow margin is added around it
export const MARGIN_PX = 16;

// White, cream, kraft brown, off-white, pale yellow: the mix of papers in the reference photo.
export const PAPERS = ['#fcfbf6', '#f4edd9', '#e6d3ac', '#efe9dc', '#f7f1c9'];
const PAPER_WEIGHTS = [3, 3, 2, 2, 1];

export const NOTE_TYPES: NoteType[] = ['pattern', 'problem', 'business', 'question'];
export const TYPE_LABEL: Record<NoteType, string> = { pattern: 'Pattern', problem: 'Problem', business: 'Business idea', question: 'Question' };
export const TYPE_COLOR: Record<NoteType, string> = { pattern: '#4c7bd9', problem: '#d9534f', business: '#3aa76d', question: '#e0a21b' };

export function hash(s: string): number {                              // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export const rand01 = (seed: number, k: number): number => hash(`${seed}:${k}`) / 4294967296;

export interface NoteLook {
  paper: string; tape: 'tape' | 'pin' | 'two-pins'; tapeTilt: number; scale: number; fold: boolean; foldRight: boolean; jitter: number[];
}
// Everything about how a note looks that is not stored: derived from its id, so the same note always looks the same.
export function noteLook(id: string): NoteLook {
  const h = hash(id);
  const total = PAPER_WEIGHTS.reduce((a, b) => a + b, 0);
  let pick = Math.floor(rand01(h, 1) * total), paper = PAPERS[0];
  for (let i = 0; i < PAPERS.length; i++) { if (pick < PAPER_WEIGHTS[i]) { paper = PAPERS[i]; break; } pick -= PAPER_WEIGHTS[i]; }
  const t = rand01(h, 2);
  return {
    paper,
    tape: t < 0.4 ? 'tape' : t < 0.85 ? 'pin' : 'two-pins',
    tapeTilt: (rand01(h, 3) - 0.5) * 0.5,
    scale: 0.9 + rand01(h, 4) * 0.26,
    fold: rand01(h, 5) < 0.45,
    foldRight: rand01(h, 6) < 0.6,
    jitter: Array.from({ length: 8 }, (_, i) => (rand01(h, 10 + i) - 0.5) * 3),
  };
}
export const noteSize = (id: string) => { const s = noteLook(id).scale; return { w: NOTE_BASE.w * s, h: NOTE_BASE.h * s }; };

// Keep a note's centre so that the whole paper stays on the board.
export function clampToBoard(x: number, y: number, size: { w: number; h: number }) {
  const hx = BOARD.w / 2 - size.w / 2 - 0.03, hy = BOARD.h / 2 - size.h / 2 - 0.03;
  return {
    x: Math.max(BOARD.cx - hx, Math.min(BOARD.cx + hx, x)),
    y: Math.max(BOARD.cy - hy, Math.min(BOARD.cy + hy, y)),
  };
}

type Pos = Pick<Note, 'id' | 'x' | 'y'>;
const overlap = (ax: number, ay: number, a: { w: number; h: number }, bx: number, by: number, b: { w: number; h: number }) =>
  Math.max(0, Math.min(ax + a.w / 2, bx + b.w / 2) - Math.max(ax - a.w / 2, bx - b.w / 2)) *
  Math.max(0, Math.min(ay + a.h / 2, by + b.h / 2) - Math.max(ay - a.h / 2, by - b.h / 2));

// Where a new note should land: the free spot nearest the middle of the wall; once the wall is full, wherever it covers least.
// A little deterministic jitter (from `seed`) keeps the layout from looking like a grid.
// `id` is the new note's own id (the client makes it before saving), because its size is derived from it.
export function placeNote(existing: Pos[], id: string, seed = existing.length): { x: number; y: number } {
  const size = noteSize(id), GAP = 0.07;
  const grown = { w: size.w + GAP, h: size.h + GAP };
  const step = 0.2;
  const others = existing.map((n) => { const o = noteSize(n.id); return { x: n.x, y: n.y, s: { w: o.w + GAP, h: o.h + GAP } }; });
  let best = { x: BOARD.cx, y: BOARD.cy }, bestScore = Infinity;
  const hx = BOARD.w / 2 - size.w / 2 - 0.05, hy = BOARD.h / 2 - size.h / 2 - 0.05;
  for (let x = -hx; x <= hx + 1e-9; x += step) {
    for (let y = -hy; y <= hy + 1e-9; y += step) {
      const cx = BOARD.cx + x, cy = BOARD.cy + y;
      let cover = 0;
      for (const o of others) cover += overlap(cx, cy, grown, o.x, o.y, o.s);
      const score = cover * 100 + Math.hypot(x * 0.6, y) * 0.05;
      if (score < bestScore) { bestScore = score; best = { x: cx, y: cy }; }
    }
  }
  return clampToBoard(best.x + (rand01(seed, 1) - 0.5) * 0.06, best.y + (rand01(seed, 2) - 0.5) * 0.06, size);
}

// The topmost note under a point on the wall (notes are rotated, so the point is turned into each note's own frame).
export function hitTest(notes: Pick<Note, 'id' | 'x' | 'y' | 'rotation' | 'z'>[], p: { x: number; y: number }): string | null {
  const byTop = [...notes].sort((a, b) => b.z - a.z);
  for (const n of byTop) {
    const s = noteSize(n.id), a = (n.rotation * Math.PI) / 180;
    const dx = p.x - n.x, dy = p.y - n.y;
    const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= s.w / 2 && Math.abs(ly) <= s.h / 2) return n.id;
  }
  return null;
}

// Written units, not code points: in Devanagari a vowel sign or a conjunct belongs to its letter, and an emoji can be many code points.
// Breaking between code points would draw a vowel sign on its own. Falls back to code points where Intl.Segmenter does not exist.
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const graphemes = (s: string): string[] => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

// Splits text into lines no wider than maxW. `measure` is the pixel width of a string (ctx.measureText in the browser).
// Keeps the founder's own line breaks, and breaks a single over-long word by characters.
export function wrapText(measure: (s: string) => number, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine) <= maxW) { line = tryLine; continue; }
      if (line) { lines.push(line); line = ''; }
      let chunk = '';
      for (const ch of graphemes(word)) {
        if (measure(chunk + ch) > maxW && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

export function matchNote(n: Pick<Note, 'type' | 'title' | 'body'>, query: string, types: ReadonlySet<NoteType> | null): boolean {
  if (types && types.size && !types.has(n.type)) return false;
  const q = query.trim().toLowerCase();
  return !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);
}
