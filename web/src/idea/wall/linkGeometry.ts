// Pure maths for links: where a note's pin is, the shape of the thread between two pins, and what a click on a pin or thread hits.
// Same wall coordinates as wallGeometry.ts (metres; y is height; a note's x,y is its centre; rotation in degrees).
import type { Link, Note } from '@idea-office/shared';
import { hitTest, noteSize } from './wallGeometry';

export const PIN_DROP = 0.075;     // the pin sits this far below the top edge of the paper
export const PIN_RADIUS = 0.09;    // how close a click must be to grab the pin
export interface P2 { x: number; y: number }
type Pos = Pick<Note, 'id' | 'x' | 'y' | 'rotation'>;

// The pin turns with the note, so rotate the "top centre" offset by the note's angle.
export function anchorOf(n: Pos): P2 {
  const d = noteSize(n.id).h / 2 - PIN_DROP, a = (n.rotation * Math.PI) / 180;
  return { x: n.x - Math.sin(a) * d, y: n.y + Math.cos(a) * d };
}

// A thread hangs under its own weight: a quadratic curve whose middle sags below the straight line.
export const sagOf = (a: P2, b: P2) => Math.min(0.45, Math.hypot(a.x - b.x, a.y - b.y) * 0.2);
export const threadControl = (a: P2, b: P2): P2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - sagOf(a, b) * 2 });   // control point is twice the visible sag
export function threadPoint(a: P2, b: P2, t: number): P2 {
  const c = threadControl(a, b), u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}
export const sampleThread = (a: P2, b: P2, n = 24): P2[] => Array.from({ length: n + 1 }, (_, i) => threadPoint(a, b, i / n));

export function distToPolyline(p: P2, pts: P2[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

// The note whose pin is under the point. A pin buried under a newer note cannot be grabbed: the note must be the topmost thing there.
export function hitPin(notes: (Pos & Pick<Note, 'z'>)[], p: P2, r = PIN_RADIUS): string | null {
  for (const n of [...notes].sort((a, b) => b.z - a.z)) {
    const a = anchorOf(n);
    if (Math.hypot(p.x - a.x, p.y - a.y) <= r && hitTest(notes, a) === n.id) return n.id;
  }
  return null;
}

// The link whose thread passes within `tol` of the point (nearest wins).
export function hitLink(links: Link[], notes: Map<string, Pos>, p: P2, tol = 0.05): string | null {
  let best: { id: string; d: number } | null = null;
  for (const l of links) {
    const a = notes.get(l.from), b = notes.get(l.to);
    if (!a || !b) continue;
    const d = distToPolyline(p, sampleThread(anchorOf(a), anchorOf(b)));
    if (d <= tol && (!best || d < best.d)) best = { id: l.id, d };
  }
  return best?.id ?? null;
}

export const canLink = (links: Link[], a: string, b: string): boolean =>
  a !== b && !links.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));

// Links touching a note, each with the note at the other end.
export function linksOf(links: Link[], id: string): { link: Link; otherId: string }[] {
  return links.filter((l) => l.from === id || l.to === id).map((link) => ({ link, otherId: link.from === id ? link.to : link.from }));
}
