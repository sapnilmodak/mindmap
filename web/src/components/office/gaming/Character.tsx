import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { AnimationAction, AnimationMixer, Box3, Euler, Group, LoopRepeat, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { OfficeStatus } from '../../../lib/officeModel';
import { ASSET_BASE } from './Prop';
import { SEAT_Y, yawToward } from './gamingLayout';
import type { Intent, V2 } from './gamingLayout';
import { intentPoint, pathBetween } from './gamingLayout';
import { POSE_SIT, POSE_TYPE } from './gamingPose';
import type { Delta } from './gamingPose';

export const characterUrl = (n: string) => `${ASSET_BASE}/characters/${n}.glb`;
export const CLIP_SOURCE = 'Suit';   // the one file that carries the animation clips; every character shares the same skeleton
const HEIGHT = 1.72;
const WALK_SPEED = 1.45;

type Clip = 'Idle_Neutral' | 'Walk' | 'Wave' | 'Interact';

export interface CharacterProps {
  id: string;
  model: string;
  intent: Intent;
  status: OfficeStatus | 'handoff';
  isHub?: boolean;
  focus?: V2;                 // where a standing worker looks
  gesture?: 'talk' | null;    // 'talk' plays the speaking gesture while standing
  positions: React.MutableRefObject<Map<string, V2>>;
  label: { title: string; sub: string; ring: string };
  selected: boolean;
  compact?: boolean;          // show only the status dot, so a crowd does not hide itself under its own name tags
  onSelect: () => void;
  reduced: boolean;
}

const sanitize = (n: string) => n.replace(/\./g, '');
const findBone = (root: Object3D, name: string) => root.getObjectByName(sanitize(name)) ?? root.getObjectByName(name) ?? null;
const shortest = (a: number, b: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// A digital worker as a low-poly person. Where they stand and what they do come
// from the real run: working means sitting at the desk and typing, waiting for
// an answer means standing up and waving, done means a walk to the break area.
export default function Character3D(p: CharacterProps) {
  const base = useGLTF(characterUrl(p.model));
  const clips = useGLTF(characterUrl(CLIP_SOURCE)).animations;
  const group = useRef<Group>(null);
  const tag = useRef<HTMLDivElement>(null);
  const inner = useRef<Group>(null);

  const rig = useMemo(() => {
    const root = SkeletonUtils.clone(base.scene) as Group;
    root.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; (o as Mesh).frustumCulled = false; } });
    const box = new Box3().setFromObject(root);
    const k = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    root.scale.setScalar(k);
    root.position.y = -box.min.y * k;
    const holder = new Group(); holder.add(root);
    // Rest orientation of each posed bone in the character's own space. The seated pose is written as
    // rotations in that space (thigh forward, forearm out), which is far easier to reason about than
    // each bone's local axes.
    holder.updateMatrixWorld(true);
    const bones: Record<string, { bone: Object3D; rest: Quaternion }> = {};
    for (const n of Object.keys(POSE_SIT)) {
      const bone = findBone(root, n);
      if (bone) bones[n] = { bone, rest: bone.getWorldQuaternion(new Quaternion()) };
    }
    const pistol = root.getObjectByName('Pistol'); if (pistol) pistol.visible = false;
    const mixer = new AnimationMixer(root);
    const actions = {} as Record<Clip, AnimationAction>;
    for (const n of ['Idle_Neutral', 'Walk', 'Wave', 'Interact'] as Clip[]) {
      const c = clips.find((x) => x.name === n);
      if (c) { const a = mixer.clipAction(c); a.setLoop(LoopRepeat, Infinity); actions[n] = a; }
    }
    return { holder, bones, mixer, actions };
  }, [base.scene, clips]);

  const st = useRef({
    init: false, x: 0, z: 0, yaw: 0, key: '', path: [] as V2[], seat: 0, wantSeat: false,
    clip: '' as Clip | '', t: Math.random() * 10, face: 0,
  });

  useEffect(() => () => { rig.mixer.stopAllAction(); p.positions.current.delete(p.id); }, [rig, p.id, p.positions]);

  const play = (c: Clip) => {
    const s = st.current;
    if (s.clip === c) return;
    const next = rig.actions[c]; const prev = s.clip ? rig.actions[s.clip] : null;
    if (next) { next.reset().setEffectiveWeight(1).fadeIn(0.25).play(); if (c === 'Walk') next.timeScale = 1.05; }
    if (prev && prev !== next) prev.fadeOut(0.25);
    s.clip = c;
  };

  const tmpQ = useMemo(() => new Quaternion(), []);
  const tmpE = useMemo(() => new Euler(), []);

  useFrame(({ camera }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const s = st.current; const g = group.current; if (!g) return;
    const goal = intentPoint(p.intent);
    const key = `${p.intent.kind}:${goal.x.toFixed(2)},${goal.z.toFixed(2)}`;
    if (!s.init) {
      s.init = true; s.x = goal.x; s.z = goal.z; s.key = key; s.wantSeat = p.intent.kind === 'seat'; s.seat = s.wantSeat ? 1 : 0;
      s.yaw = s.wantSeat ? Math.PI : -Math.PI / 2;
    } else if (key !== s.key) {
      s.key = key; s.wantSeat = p.intent.kind === 'seat';
      s.path = pathBetween({ x: s.x, z: s.z }, goal);
    }
    s.t += dt;

    // Standing up / sitting down.
    const leaving = s.path.length > 0;
    if (leaving && s.seat > 0) s.seat = Math.max(0, s.seat - dt / 0.55);
    else if (!leaving && s.wantSeat) s.seat = Math.min(1, s.seat + dt / 0.65);

    let moving = false;
    if (leaving && s.seat === 0) {
      const target = s.path[0];
      const dx = target.x - s.x, dz = target.z - s.z, d = Math.hypot(dx, dz);
      const step = WALK_SPEED * dt;
      if (d <= step) { s.x = target.x; s.z = target.z; s.path.shift(); }
      else { s.x += (dx / d) * step; s.z += (dz / d) * step; s.face = Math.atan2(dx, dz); moving = true; }
      if (moving) s.yaw += shortest(s.yaw, s.face) * Math.min(1, dt * 9);
    } else if (!leaving) {
      let want = s.yaw;
      if (p.intent.kind === 'seat') want = Math.PI;
      else if (p.intent.kind === 'desk-stand') want = -Math.PI / 2;
      else if (p.focus) want = yawToward({ x: s.x, z: s.z }, p.focus);
      s.yaw += shortest(s.yaw, want) * Math.min(1, dt * 7);
    }

    // Which clip.
    const seated = s.seat > 0.02;
    if (moving) play('Walk');
    else if (!seated && p.gesture === 'talk') play('Interact');
    else if (!seated && p.status === 'blocked') play('Wave');
    else if (!seated && (p.intent.kind === 'hub') && p.status === 'handoff') play('Interact');
    else play('Idle_Neutral');
    rig.mixer.update(p.reduced ? 0 : dt);

    // Seated pose and typing on top of the animation.
    if (s.seat > 0.001) {
      const e = s.seat * s.seat * (3 - 2 * s.seat);
      const typing = p.status === 'working' || p.status === 'handoff';
      const holderInv = rig.holder.getWorldQuaternion(new Quaternion()).invert();
      for (const name of Object.keys(POSE_SIT)) {   // parents come before children in POSE_SIT
        const b = rig.bones[name]; if (!b) continue;
        const pose = (import.meta.env.DEV && (window as unknown as { __pose?: Record<string, Delta> }).__pose?.[name]) || POSE_SIT[name];
        const ty = typing ? POSE_TYPE[name] : undefined;
        const wob = ty && !p.reduced ? Math.sin(s.t * ty.hz * Math.PI * 2 + ty.phase) * ty.amp : 0;
        tmpE.set(pose[0] + (ty ? ty.bias[0] : 0) + wob, pose[1] + (ty ? ty.bias[1] : 0), pose[2] + (ty ? ty.bias[2] : 0));
        const parentW = b.bone.parent!.getWorldQuaternion(new Quaternion()).premultiply(holderInv);   // in the character's own space, whichever way it is facing
        tmpQ.setFromEuler(tmpE).multiply(b.rest);                 // target orientation in character space
        tmpQ.premultiply(parentW.invert());                      // back to the bone's local space
        b.bone.quaternion.slerp(tmpQ, e);
        b.bone.updateMatrixWorld(true);
      }
    }

    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.yaw;
    // Name tags keep a readable size: smaller far away, never huge up close.
    if (tag.current) {
      const dist = camera.position.distanceTo(g.position);
      tag.current.style.transform = `translateY(-4px) scale(${Math.max(0.55, Math.min(1.05, 17 / dist)).toFixed(3)})`;
    }
    if (inner.current) inner.current.position.y = -SEAT_Y * s.seat * s.seat * (3 - 2 * s.seat);
    p.positions.current.set(p.id, { x: s.x, z: s.z });
  });

  const showQuestion = p.status === 'blocked';
  return (
    <group ref={group}>
      <group ref={inner}><primitive object={rig.holder} /></group>
      <mesh visible={false} position={[0, 0.9, 0]} onClick={(e) => { e.stopPropagation(); if (e.delta < 6) p.onSelect(); }}>
        <capsuleGeometry args={[0.4, 1.2, 4, 8]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.52, 0.62, 40]} />
        <meshBasicMaterial color={p.label.ring} transparent opacity={p.selected ? 0.95 : 0.55} depthWrite={false} />
      </mesh>
      <Html position={[0, 2.15, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={tag} className={`gw-tag is-${p.status} ${p.selected ? 'is-selected' : ''} ${p.compact ? 'is-compact' : ''}`} style={{ ['--ring' as string]: p.label.ring }}>
          {showQuestion && <span className="gw-ask" aria-hidden>?</span>}
          <button type="button" onClick={p.onSelect} aria-pressed={p.selected} aria-label={`${p.label.title}, ${p.label.sub}`}>
            <i className="gw-dot" />
            <span><b>{p.label.title}</b><em>{p.label.sub}</em></span>
          </button>
        </div>
      </Html>
    </group>
  );
}

export function preloadCharacters(models: string[]) {
  useGLTF.preload(characterUrl(CLIP_SOURCE));
  models.forEach((m) => useGLTF.preload(characterUrl(m)));
}
export { Vector3 };
