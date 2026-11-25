import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { AnimationAction, AnimationMixer, Box3, Group, LoopRepeat, Mesh, PerspectiveCamera } from 'three';
import { CLIP_SOURCE, characterUrl } from '../components/office/gaming/Character';
import { ROOM, WALL_H } from '../components/office/gaming/gamingLayout';
import { moveWithCollision } from './collision';
import type { Obstacle } from './collision';
import { OBSTACLES, PLAYER_RADIUS, PLAYER_START, WALK_BOUNDS, zoneAt } from './ideaLayout';
import type { ZoneId } from './ideaLayout';

const HEIGHT = 1.72;
const WALK = 2.5, RUN = 4.2, ACCEL = 14;
const CAM = { dist: 4.6, look: 1.25, minPitch: 0.12, maxPitch: 0.75 };
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

const shortest = (a: number, b: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export interface PlayerProps {
  model?: string;
  enabled: boolean;                       // false while a wall / pad overlay is open: no walking, camera holds
  onZone: (z: ZoneId | null) => void;     // called only when the zone the player stands in changes
  onInteract: (z: ZoneId) => void;        // E pressed inside a zone
  reduced: boolean;
  extraObstacles?: () => Obstacle[];      // things that move (the colleagues), asked for every frame
  cameraControl?: boolean;                // false while the wall close-up owns the camera
  hidden?: boolean;                       // the avatar is not drawn in the wall close-up (it would stand in front of the notes)
}

// The founder's avatar: WASD / arrows to walk (Shift to run), drag to turn the camera, E to interact.
// Movement is relative to the camera, the avatar turns to face where it walks, and the camera follows from behind.
export default function Player({ model = 'Worker', enabled, onZone, onInteract, reduced, cameraControl = true, hidden = false, extraObstacles }: PlayerProps) {
  const base = useGLTF(characterUrl(model));
  const clips = useGLTF(characterUrl(CLIP_SOURCE)).animations;
  const { camera, gl } = useThree();
  const group = useRef<Group>(null);

  const rig = useMemo(() => {
    const root = SkeletonUtils.clone(base.scene) as Group;
    root.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; (o as Mesh).frustumCulled = false; } });
    const box = new Box3().setFromObject(root);
    const k = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    root.scale.setScalar(k); root.position.y = -box.min.y * k;
    const pistol = root.getObjectByName('Pistol'); if (pistol) pistol.visible = false;
    const holder = new Group(); holder.add(root);
    const mixer = new AnimationMixer(root);
    const actions: Record<string, AnimationAction> = {};
    for (const n of ['Idle_Neutral', 'Walk']) {
      const c = clips.find((x) => x.name === n);
      if (c) { const a = mixer.clipAction(c); a.setLoop(LoopRepeat, Infinity); actions[n] = a; }
    }
    return { holder, mixer, actions };
  }, [base.scene, clips]);

  const s = useRef({
    x: PLAYER_START.x, z: PLAYER_START.z, yaw: 0, camYaw: 0, camPitch: 0.38, speed: 0,
    keys: new Set<string>(), clip: '', zone: null as ZoneId | null, camReady: false,
  });
  const live = useRef({ enabled, onZone, onInteract, cameraControl, extraObstacles });
  live.current = { enabled, onZone, onInteract, cameraControl, extraObstacles };

  useEffect(() => {
    const el = gl.domElement, st = s.current;
    const cam = camera as PerspectiveCamera;
    cam.fov = 58; cam.near = 0.1; cam.updateProjectionMatrix();
    let last: { x: number; y: number } | null = null;
    const typing = (e: Event) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable); };
    const down = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!last || !(e.buttons & 1) || !live.current.enabled) { last = null; return; }
      st.camYaw += (e.clientX - last.x) * 0.005;
      st.camPitch = Math.max(CAM.minPitch, Math.min(CAM.maxPitch, st.camPitch + (e.clientY - last.y) * 0.004));
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

  useEffect(() => () => { rig.mixer.stopAllAction(); }, [rig]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1), st = s.current, k = st.keys, g = group.current; if (!g) return;
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
      st.yaw += shortest(st.yaw, Math.atan2(wx, wz)) * Math.min(1, dt * 12);
    }
    g.position.set(st.x, 0, st.z); g.rotation.y = st.yaw;

    // Animation: walk speed follows real speed so the feet do not slide.
    const want = st.speed > 0.15 ? 'Walk' : 'Idle_Neutral';
    if (want !== st.clip) {
      const next = rig.actions[want], prev = st.clip ? rig.actions[st.clip] : null;
      if (next) next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
      if (prev && prev !== next) prev.fadeOut(0.2);
      st.clip = want;
    }
    if (want === 'Walk' && rig.actions.Walk) rig.actions.Walk.timeScale = Math.max(0.6, st.speed / 1.45);
    rig.mixer.update(reduced ? 0 : dt);

    // Which interactable zone is the player in (reported only on change, so React does not re-render every frame).
    const zone = zoneAt({ x: st.x, z: st.z });
    if (zone !== st.zone) { st.zone = zone; live.current.onZone(zone); }

    // Third-person camera behind the avatar, kept inside the room so it never pokes through a wall.
    if (!live.current.cameraControl) return;
    const flat = Math.cos(st.camPitch) * CAM.dist;
    let cx = st.x + Math.sin(st.camYaw) * flat, cz = st.z + Math.cos(st.camYaw) * flat;
    const cy = Math.min(WALL_H - 0.3, 1.0 + Math.sin(st.camPitch) * CAM.dist);
    cx = Math.max(ROOM.minX + 0.4, Math.min(ROOM.maxX - 0.4, cx));
    cz = Math.max(ROOM.minZ + 0.4, Math.min(ROOM.maxZ - 0.4, cz));
    const follow = st.camReady && !reduced ? Math.min(1, dt * 7) : 1;
    camera.position.x += (cx - camera.position.x) * follow;
    camera.position.y += (cy - camera.position.y) * follow;
    camera.position.z += (cz - camera.position.z) * follow;
    st.camReady = true;
    camera.lookAt(st.x, CAM.look, st.z);
  });

  return (
    <group ref={group} visible={!hidden}>
      <primitive object={rig.holder} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.5, 0.6, 40]} /><meshBasicMaterial color="#ffd166" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      {!hidden && (
        <Html position={[0, 2.1, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="io-tag io-you">You</div>
        </Html>
      )}
    </group>
  );
}
