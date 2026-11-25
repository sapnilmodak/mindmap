import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { moveWithCollision } from './collision';
import type { Obstacle } from './collision';
import { OBSTACLES, PLAYER_RADIUS, PLAYER_START, WALK_BOUNDS, zoneAt } from './ideaLayout';
import type { ZoneId } from './ideaLayout';

const EYE = 1.65, FOV = 66;
const WALK = 2.5, RUN = 4.2, ACCEL = 14;
const MAX_PITCH = 1.1;                    // radians up or down
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const head = new Vector3();


export interface PlayerProps {
  enabled: boolean;                       // false while a wall / pad overlay is open: no walking, camera holds
  onZone: (z: ZoneId | null) => void;     // called only when the zone the player stands in changes
  onInteract: (z: ZoneId) => void;        // E pressed inside a zone
  reduced: boolean;
  extraObstacles?: () => Obstacle[];      // things that move (the colleagues), asked for every frame
  cameraControl?: boolean;                // false while the wall close-up owns the camera
}

// The founder, seen through their own eyes (no avatar is drawn): WASD / arrows to walk (Shift to run),
// drag to look around, E to interact. Movement is relative to where you look.
export default function Player({ enabled, onZone, onInteract, reduced, cameraControl = true, extraObstacles }: PlayerProps) {
  const { camera, gl } = useThree();

  const s = useRef({
    x: PLAYER_START.x, z: PLAYER_START.z, camYaw: 0, camPitch: 0, speed: 0,       // pitch: positive looks down
    keys: new Set<string>(), zone: null as ZoneId | null,
    blend: 1, hadCamera: true,                                                   // glide back to the head after the wall view
  });
  const live = useRef({ enabled, onZone, onInteract, cameraControl, extraObstacles });
  live.current = { enabled, onZone, onInteract, cameraControl, extraObstacles };

  useEffect(() => {
    const el = gl.domElement, st = s.current;
    const cam = camera as PerspectiveCamera;
    cam.fov = FOV; cam.near = 0.1; cam.updateProjectionMatrix();
    let last: { x: number; y: number } | null = null;
    const typing = (e: Event) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable); };
    const down = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!last || !(e.buttons & 1) || !live.current.enabled) { last = null; return; }
      st.camYaw -= (e.clientX - last.x) * 0.005;
      st.camPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, st.camPitch + (e.clientY - last.y) * 0.004));
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => { last = null; };
    const kd = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.includes(k)) { e.preventDefault(); st.keys.add(k); }
      else if (k === 'shift') st.keys.add('shift');
      else if (k === 'e' && !e.repeat && live.current.enabled && st.zone) live.current.onInteract(st.zone);
    };
    const ku = (e: KeyboardEvent) => { st.keys.delete(e.key.toLowerCase()); };
    const blur = () => st.keys.clear();
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
    return () => {
      el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
    };
  }, [camera, gl]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1), st = s.current, k = st.keys;
    // Input in camera space: forward is the way the camera looks.
    const fwd = live.current.enabled ? (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) : 0;
    const str = live.current.enabled ? (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) : 0;
    const len = Math.hypot(fwd, str);
    const top = k.has('shift') ? RUN : WALK;
    st.speed += ((len > 0 ? top : 0) - st.speed) * Math.min(1, dt * ACCEL);
    if (len > 0) {
      const wx = (-Math.sin(st.camYaw) * fwd + Math.cos(st.camYaw) * str) / len;
      const wz = (-Math.cos(st.camYaw) * fwd - Math.sin(st.camYaw) * str) / len;
      const p = moveWithCollision({ x: st.x, z: st.z }, wx * st.speed * dt, wz * st.speed * dt, PLAYER_RADIUS, live.current.extraObstacles ? [...OBSTACLES, ...live.current.extraObstacles()] : OBSTACLES, WALK_BOUNDS);
      st.x = p.x; st.z = p.z;
    }
    // Which interactable zone is the player in (reported only on change, so React does not re-render every frame).
    const zone = zoneAt({ x: st.x, z: st.z });
    if (zone !== st.zone) { st.zone = zone; live.current.onZone(zone); }

    // The camera is the founder's head.
    if (!live.current.cameraControl) { st.hadCamera = false; return; }
    if (!st.hadCamera) { st.hadCamera = true; st.blend = 0; }
    st.blend = reduced ? 1 : Math.min(1, st.blend + dt * 2);
    const follow = st.blend >= 1 ? 1 : Math.min(1, dt * 7);
    camera.position.lerp(head.set(st.x, EYE, st.z), follow);
    const flat = Math.cos(st.camPitch);
    camera.lookAt(camera.position.x - Math.sin(st.camYaw) * flat, camera.position.y - Math.sin(st.camPitch), camera.position.z - Math.cos(st.camYaw) * flat);
  });

  return null;
}
