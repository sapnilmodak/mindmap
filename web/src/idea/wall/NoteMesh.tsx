import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { Note } from '@idea-office/shared';
import { IDEA_WALL } from '../ideaLayout';
import { MARGIN_PX, PAPER_PX, noteSize } from './wallGeometry';
import { PIN_DROP } from './linkGeometry';
import { drawNote, releaseTexture } from './noteTexture';
import { wantSharp } from './wallView';

const Z_STEP = 0.0006;      // each newer note sits a hair in front of the one below it, so overlapping papers never flicker
export const noteZ = (rank: number) => IDEA_WALL.z + 0.01 + Math.min(rank, 400) * Z_STEP;
export type Outline = 'selected' | 'neighbor' | 'target' | 'debating' | null;
const OUTLINE_COLOR = { selected: '#ffd166', neighbor: '#ff8a7a', target: '#2fbf71', debating: '#8e6bff' } as const;
const FLIGHT_S = 0.8;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

interface Props { note: Note; rank: number; dim: boolean; outline: Outline; landing: boolean; fontsReady: boolean; reduced: boolean }

// One paper note on the wall. `landing` plays the "stick it on" flight once, from the front of the room onto its spot.
export const NoteMesh = memo(function NoteMesh({ note, rank, dim, outline, landing, fontsReady, reduced }: Props) {
  const size = noteSize(note.id);
  const kw = (PAPER_PX.w + MARGIN_PX * 2) / PAPER_PX.w, kh = (PAPER_PX.h + MARGIN_PX * 2) / PAPER_PX.h;
  // Everyday notes use a small texture; only a note that is large on screen in the wall close-up gets the sharp one.
  const [sharp, setSharp] = useState(false);
  const sharpRef = useRef(false);
  const tex = useMemo(() => drawNote(note, sharp ? 2 : 1), [note.id, note.type, note.title, note.body, fontsReady, sharp]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { tex.dispose(); releaseTexture(tex); }, [tex]);

  const g = useRef<Group>(null);
  const t0 = useRef<number | null>(landing && !reduced ? 0 : null);       // reduced motion: no flying paper, it is simply there
  const z = noteZ(rank);
  const rot = (note.rotation * Math.PI) / 180;

  useFrame((_, dt) => {
    const want = wantSharp(sharpRef.current, note.x, note.y);
    if (want !== sharpRef.current) { sharpRef.current = want; setSharp(want); }
    const grp = g.current; if (!grp) return;
    if (t0.current === null) { grp.position.set(note.x, note.y, z); grp.rotation.z = rot; grp.scale.setScalar(1); return; }
    t0.current += dt;
    const p = Math.min(1, t0.current / FLIGHT_S);
    const move = easeOutCubic(p);
    grp.position.set(
      note.x * (0.35 + 0.65 * move),
      note.y - (1 - move) * 0.9 + Math.sin(move * Math.PI) * 0.35,
      z + (1 - move) * 2.6,
    );
    grp.rotation.z = rot + (1 - move) * 0.5;
    grp.scale.setScalar(1 + (1 - easeOutBack(p)) * 0.9);     // starts 1.9x (close to the viewer), overshoots slightly under 1 as it hits the wall
    if (p >= 1) t0.current = null;
  });

  return (
    <group ref={g} position={[note.x, note.y, z]} rotation={[0, 0, rot]} renderOrder={rank}>
      {outline && (
        <mesh position={[0, 0, -0.0003]} renderOrder={rank}>
          <planeGeometry args={[size.w + 0.06, size.h + 0.06]} />
          <meshBasicMaterial color={OUTLINE_COLOR[outline]} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      )}
      <mesh renderOrder={rank}>
        <planeGeometry args={[size.w * kw, size.h * kh]} />
        <meshStandardMaterial map={tex} transparent opacity={dim ? 0.22 : 1} roughness={1} metalness={0} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.28} />
      </mesh>
      {/* the link pin: drag a thread out of it */}
      <mesh position={[0, size.h / 2 - PIN_DROP, 0.007]} scale={[1, 1, 0.55]} renderOrder={rank}>
        <sphereGeometry args={[0.03, 14, 10]} />
        <meshStandardMaterial color="#c0392b" roughness={0.35} metalness={0.25} transparent opacity={dim ? 0.3 : 1} />
      </mesh>
    </group>
  );
});
