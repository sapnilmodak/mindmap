import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Link, Note } from '@idea-office/shared';
import { IDEA_WALL } from '../ideaLayout';
import { BOARD, clampToBoard, hitTest, noteSize } from './wallGeometry';
import { PIN_RADIUS, hitLink, hitPin } from './linkGeometry';
import { wallView } from './wallView';

const MIN_DIST = 1.3;
const DRAG_PX = 4;

export interface WallControllerProps {
  active: boolean;
  maximized?: boolean;                                     // the board fills the whole screen (tight fit)
  reduced?: boolean;                                       // snap the camera instead of gliding
  notes: Note[];
  links: Link[];
  onSelect: (id: string | null) => void;
  onSelectLink: (id: string) => void;
  onLinkDrag: (s: { from: string; x: number; y: number; target: string | null } | null) => void;   // a thread is being pulled out of a pin
  onLinkCreate: (from: string, to: string) => void;
  onDragStart: (id: string) => void;                       // lets the owner bring the note to the front
  onDrag: (id: string, x: number, y: number) => void;
  onDrop: (id: string, x: number, y: number) => void;
  focus: { x: number; y: number; n: number } | null;       // a new `n` pans and zooms to that spot
}

// Close-up mode: the camera faces the board flat-on. Drag a note to move it, drag the bare wall to pan, scroll to zoom.
// Points on the wall come from casting the pointer ray onto the wall plane, so no 3D picking is needed.
export default function WallController(props: WallControllerProps) {
  const { camera, gl } = useThree();
  const live = useRef(props); live.current = props;
  const view = useRef({ px: BOARD.cx, py: BOARD.cy, dist: 4.4, maxDist: 4.4, look: new Vector3(), entering: false });

  const fitDistance = () => {
    const cam = camera as PerspectiveCamera, pad = live.current.maximized ? 0.12 : 0.5;
    const t = Math.tan((cam.fov * Math.PI) / 360);
    return Math.max((BOARD.h + pad) / (2 * t), (BOARD.w + pad) / (2 * t * Math.max(0.5, cam.aspect)));
  };

  useEffect(() => {
    const v = view.current;
    if (!props.active) return;
    const cam = camera as PerspectiveCamera;
    v.maxDist = fitDistance(); v.dist = v.maxDist; v.px = BOARD.cx; v.py = BOARD.cy;
    v.look.copy(cam.position).add(cam.getWorldDirection(new Vector3()).multiplyScalar(4));   // start looking where the player was looking
    v.entering = true;
  }, [props.active]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Maximize / minimize, and window resizes: refit. If the board was fully in view it stays fully in view.
  const refit = () => {
    const v = view.current, wasFit = v.dist >= v.maxDist - 0.02;
    v.maxDist = fitDistance();
    if (wasFit || v.dist > v.maxDist) { v.dist = v.maxDist; v.px = BOARD.cx; v.py = BOARD.cy; }
  };
  useEffect(() => {
    if (!props.active) return;
    const v = view.current; v.maxDist = fitDistance(); v.dist = v.maxDist; v.px = BOARD.cx; v.py = BOARD.cy;   // the button always shows the whole board
  }, [props.maximized]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!props.active) return;
    const on = () => refit();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [props.active]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Dev only: lets the browser tests find where a wall point is on screen.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __wallProject?: (x: number, y: number) => { x: number; y: number } }).__wallProject = (x, y) => {
      const v = new Vector3(x, y, IDEA_WALL.z + 0.01).project(camera), r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
  }, [camera, gl]);

  useEffect(() => {
    if (props.active && props.focus) { const v = view.current; v.px = props.focus.x; v.py = props.focus.y; v.dist = Math.max(MIN_DIST, Math.min(v.maxDist, 2.1)); }
  }, [props.focus?.n]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!props.active) return;
    const el = gl.domElement, v = view.current;
    const plane = new Plane(new Vector3(0, 0, 1), -(IDEA_WALL.z + 0.01));
    const ray = new Raycaster(), ndc = new Vector2(), hitP = new Vector3();
    const wallPoint = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hitP) ? { x: hitP.x, y: hitP.y } : null;
    };
    let drag: { id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean; x: number; y: number } | null = null;
    let pan: { lx: number; ly: number; sx: number; sy: number; moved: boolean; linkId: string | null } | null = null;
    let pull: { from: string; sx: number; sy: number; moved: boolean; target: string | null } | null = null;

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = wallPoint(e); if (!p) return;
      const id = hitTest(live.current.notes, p);
      el.setPointerCapture(e.pointerId);
      const pin = hitPin(live.current.notes, p, PIN_RADIUS);
      if (pin) {                                              // a pin starts a thread, not a move
        pull = { from: pin, sx: e.clientX, sy: e.clientY, moved: false, target: null };
        el.style.cursor = 'crosshair';
      } else if (id) {
        const n = live.current.notes.find((x) => x.id === id)!;
        drag = { id, ox: p.x - n.x, oy: p.y - n.y, sx: e.clientX, sy: e.clientY, moved: false, x: n.x, y: n.y };
        live.current.onSelect(id);
        el.style.cursor = 'grabbing';
      } else {
        const byId = new Map(live.current.notes.map((n) => [n.id, n]));
        pan = { lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, linkId: hitLink(live.current.links, byId, p, 0.05) };
        el.style.cursor = 'grabbing';
      }
    };
    const move = (e: PointerEvent) => {
      if (pull) {
        const p = wallPoint(e); if (!p) return;
        if (Math.hypot(e.clientX - pull.sx, e.clientY - pull.sy) >= DRAG_PX) pull.moved = true;
        const over = hitTest(live.current.notes, p);
        pull.target = over && over !== pull.from ? over : null;
        if (pull.moved) live.current.onLinkDrag({ from: pull.from, x: p.x, y: p.y, target: pull.target });
      } else if (drag) {
        const p = wallPoint(e); if (!p) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_PX) return;
        if (!drag.moved) live.current.onDragStart(drag.id);
        drag.moved = true;
        const c = clampToBoard(p.x - drag.ox, p.y - drag.oy, noteSize(drag.id));
        drag.x = c.x; drag.y = c.y;
        live.current.onDrag(drag.id, c.x, c.y);
      } else if (pan) {
        const cam = camera as PerspectiveCamera;
        const wpp = (2 * v.dist * Math.tan((cam.fov * Math.PI) / 360)) / el.clientHeight;
        v.px -= (e.clientX - pan.lx) * wpp; v.py += (e.clientY - pan.ly) * wpp;
        v.px = Math.max(BOARD.cx - BOARD.w / 2, Math.min(BOARD.cx + BOARD.w / 2, v.px));
        v.py = Math.max(BOARD.cy - BOARD.h / 2, Math.min(BOARD.cy + BOARD.h / 2, v.py));
        pan.lx = e.clientX; pan.ly = e.clientY;
        if (Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy) >= DRAG_PX) pan.moved = true;
      } else {
        const p = wallPoint(e);
        el.style.cursor = !p ? 'default' : hitPin(live.current.notes, p, PIN_RADIUS) ? 'crosshair' : hitTest(live.current.notes, p) ? 'grab' : 'default';
      }
    };
    const up = (e: PointerEvent) => {
      if (pull) {
        if (pull.moved && pull.target) live.current.onLinkCreate(pull.from, pull.target);
        else if (!pull.moved) live.current.onSelect(pull.from);             // a plain click on a pin just selects the note
        live.current.onLinkDrag(null);
      }
      if (drag?.moved) live.current.onDrop(drag.id, drag.x, drag.y);
      if (pan && !pan.moved) { if (pan.linkId) live.current.onSelectLink(pan.linkId); else live.current.onSelect(null); }   // click: a thread, else bare wall deselects
      drag = null; pan = null; pull = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = 'default';
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      v.dist = Math.max(MIN_DIST, Math.min(v.maxDist, v.dist * Math.exp(e.deltaY * 0.0012)));
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel); el.style.cursor = 'default';
    };
  }, [props.active, camera, gl]);

  useFrame((_, dtRaw) => {
    if (!live.current.active) { wallView.active = false; return; }
    const v = view.current, dt = Math.min(dtRaw, 0.1), k = live.current.reduced ? 1 : Math.min(1, dt * 6);
    camera.position.x += (v.px - camera.position.x) * k;
    camera.position.y += (v.py - camera.position.y) * k;
    camera.position.z += (IDEA_WALL.z + v.dist - camera.position.z) * k;
    v.look.x += (v.px - v.look.x) * k; v.look.y += (v.py - v.look.y) * k; v.look.z += (IDEA_WALL.z - v.look.z) * k;
    camera.lookAt(v.look);

    // tell the notes what is in view, so only the big ones on screen draw sharp textures
    const cam = camera as PerspectiveCamera, d = Math.max(0.3, camera.position.z - IDEA_WALL.z), halfH = d * Math.tan((cam.fov * Math.PI) / 360);
    wallView.active = true; wallView.px = camera.position.x; wallView.py = camera.position.y;
    wallView.halfH = halfH; wallView.halfW = halfH * cam.aspect;
    wallView.ppm = (gl.domElement.clientHeight * Math.min(window.devicePixelRatio || 1, 1.75)) / (2 * halfH);   // the canvas draws at most 1.75x
  });

  return null;
}
