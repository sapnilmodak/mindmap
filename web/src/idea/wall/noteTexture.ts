// Draws one note as a paper on a canvas: shadow, uneven edges, speckle, a coloured type band, handwriting, tape or pins and a curled corner.
// Everything random comes from noteLook(id), so a note looks the same every time. Not unit-tested (needs a DOM canvas); the maths it uses is.
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Note } from '@idea-office/shared';
import { MARGIN_PX, PAPER_PX, TYPE_COLOR, TYPE_LABEL, noteLook, rand01, hash, wrapText } from './wallGeometry';

export const FONT = "'Kalam', 'Segoe Print', 'Noto Sans Devanagari', 'Nirmala UI', cursive";   // Kalam covers Latin and Devanagari

// Live texture bookkeeping (dev only reads it): how many note textures exist and roughly how much graphics memory they hold.
const live = new Map<CanvasTexture, number>();
const bytesOf = (w: number, h: number) => w * h * 4 * 1.33;                // RGBA plus mipmaps
export const releaseTexture = (t: CanvasTexture) => { live.delete(t); };
if (import.meta.env.DEV) (window as unknown as { __texStats?: () => unknown }).__texStats = () => ({ count: live.size, mb: +([...live.values()].reduce((a, b) => a + b, 0) / 1048576).toFixed(1) });

// S = texture pixels per layout pixel: 1 for the everyday look (a quarter of the memory), 2 for a note you are zoomed in on.
export function drawNote(note: Pick<Note, 'id' | 'type' | 'title' | 'body'>, S = 2): CanvasTexture {
  const look = noteLook(note.id), h = hash(note.id);
  const cv = document.createElement('canvas'); cv.width = (PAPER_PX.w + MARGIN_PX * 2) * S; cv.height = (PAPER_PX.h + MARGIN_PX * 2) * S;
  const c = cv.getContext('2d')!;
  c.scale(S, S);
  const m = MARGIN_PX, pw = PAPER_PX.w, ph = PAPER_PX.h;
  const j = look.jitter;

  // paper outline with slightly uneven corners
  const path = () => {
    c.beginPath();
    c.moveTo(m + j[0], m + j[1]); c.lineTo(m + pw + j[2], m + j[3]);
    c.lineTo(m + pw + j[4], m + ph + j[5]); c.lineTo(m + j[6], m + ph + j[7]); c.closePath();
  };
  c.save(); c.shadowColor = 'rgba(0,0,0,.38)'; c.shadowBlur = 9; c.shadowOffsetY = 4; c.fillStyle = look.paper; path(); c.fill(); c.restore();

  c.save(); path(); c.clip();
  const g = c.createLinearGradient(m, m, m + pw, m + ph);
  g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(120,90,40,.12)');
  c.fillStyle = g; c.fillRect(m, m, pw, ph);
  for (let i = 0; i < 160; i++) {                                      // paper grain
    c.fillStyle = `rgba(90,70,40,${rand01(h, 100 + i) * 0.07})`;
    c.fillRect(m + rand01(h, 300 + i) * pw, m + rand01(h, 500 + i) * ph, 1.5, 1.5);
  }
  // type band
  c.fillStyle = TYPE_COLOR[note.type]; c.fillRect(m, m + 12, pw, 7);
  c.globalAlpha = 0.9; c.font = `700 11px ${FONT}`; c.fillStyle = TYPE_COLOR[note.type]; c.textBaseline = 'alphabetic';
  c.fillText(TYPE_LABEL[note.type].toUpperCase(), m + 12, m + 36); c.globalAlpha = 1;

  // handwriting
  const x0 = m + 14, maxW = pw - 28;
  c.fillStyle = '#26303f';
  c.font = `700 22px ${FONT}`;
  const title = wrapText((s) => c.measureText(s).width, note.title, maxW).slice(0, 3);
  let y = m + 62;
  for (const line of title) { c.fillText(line, x0, y); y += 25; }
  y += 3;
  c.font = `400 16px ${FONT}`; c.fillStyle = '#3a4252';
  const body = wrapText((s) => c.measureText(s).width, note.body, maxW);
  const room = Math.max(0, Math.floor((m + ph - 16 - y) / 19));
  const shown = body.length > room ? [...body.slice(0, Math.max(0, room - 1)), (body[room - 1] ?? '').slice(0, 24) + '…'] : body;
  for (const line of shown) { c.fillText(line, x0, y); y += 19; }

  // curled corner
  if (look.fold) {
    const fx = look.foldRight ? m + pw : m, fy = m + ph, d = 34, dir = look.foldRight ? -1 : 1;
    c.fillStyle = 'rgba(0,0,0,.10)'; c.beginPath(); c.moveTo(fx, fy - d); c.lineTo(fx, fy); c.lineTo(fx + dir * d, fy); c.closePath(); c.fill();
    c.fillStyle = look.paper; c.beginPath(); c.moveTo(fx, fy - d); c.lineTo(fx + dir * d, fy); c.lineTo(fx + dir * d, fy - d * 0.55); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 1; c.beginPath(); c.moveTo(fx, fy - d); c.lineTo(fx + dir * d, fy); c.stroke();
  }
  c.restore();

  // tape or pins
  const cx = m + pw / 2;
  const pin = (px: number, py: number) => {
    c.save(); c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 3; c.shadowOffsetY = 2;
    c.fillStyle = '#c93a3a'; c.beginPath(); c.arc(px, py, 6.5, 0, Math.PI * 2); c.fill(); c.restore();
    c.fillStyle = 'rgba(255,255,255,.6)'; c.beginPath(); c.arc(px - 2, py - 2, 2, 0, Math.PI * 2); c.fill();
  };
  if (look.tape === 'tape') {
    c.save(); c.translate(cx, m + 4); c.rotate(look.tapeTilt);
    c.fillStyle = 'rgba(232,214,160,.78)'; c.strokeStyle = 'rgba(150,130,80,.35)'; c.lineWidth = 1;
    c.fillRect(-30, -9, 60, 20); c.strokeRect(-30, -9, 60, 20); c.restore();
  } else if (look.tape === 'pin') pin(cx, m + 9);
  else { pin(m + 20, m + 9); pin(m + pw - 20, m + 9); }

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace; tex.anisotropy = 8;
  live.set(tex, bytesOf(cv.width, cv.height));
  return tex;
}
