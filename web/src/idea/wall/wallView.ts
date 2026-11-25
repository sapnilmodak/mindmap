// What the wall close-up camera is looking at right now. A plain shared object that the controller writes every frame and the notes read,
// so each note can decide cheaply whether it is big and close enough on screen to deserve its sharp texture.
export const wallView = {
  active: false,        // false while walking around the office
  px: 0, py: 1.75,      // wall point at the centre of the view (metres)
  halfW: 4.4, halfH: 2.5,   // half the visible width and height at the wall (metres)
  ppm: 0,               // device pixels per metre at the wall
};

// Sharp texture (2x) only for a note that is large on screen and in view; the normal one (1x) otherwise.
// Two thresholds, so a note sitting right at the edge does not flip back and forth as you zoom.
export const NOTE_WIDTH_M = 0.74;
export const WANT_SHARP_PX = 200, DROP_SHARP_PX = 150, VIEW_MARGIN_M = 0.25;
export function wantSharp(wasSharp: boolean, x: number, y: number, v = wallView, noteWidthM = NOTE_WIDTH_M): boolean {
  if (!v.active || v.ppm <= 0) return false;
  const inView = Math.abs(x - v.px) < v.halfW + VIEW_MARGIN_M && Math.abs(y - v.py) < v.halfH + VIEW_MARGIN_M;
  if (!inView) return false;
  const px = noteWidthM * v.ppm;
  return wasSharp ? px >= DROP_SHARP_PX : px >= WANT_SHARP_PX;
}
