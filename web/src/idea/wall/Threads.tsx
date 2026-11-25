import { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { QuadraticBezierCurve3, TubeGeometry, Vector3 } from 'three';
import type { Link, Note } from '@idea-office/shared';
import { anchorOf, sagOf, threadControl } from './linkGeometry';
import type { P2 } from './linkGeometry';
import { noteZ } from './NoteMesh';

const RED = '#b3261e', HOT = '#ff5a4a', PICK = '#ffd166';

export interface PendingLink { from: string; x: number; y: number; target: string | null }

function Thread({ a, b, z, color, opacity, radius, label }: { a: P2; b: P2; z: number; color: string; opacity: number; radius: number; label?: string }) {
  const geo = useMemo(() => {
    const c = threadControl(a, b);
    const curve = new QuadraticBezierCurve3(new Vector3(a.x, a.y, z), new Vector3(c.x, c.y, z + 0.04), new Vector3(b.x, b.y, z));
    return new TubeGeometry(curve, 28, radius, 5, false);
  }, [a.x, a.y, b.x, b.y, z, radius]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo.dispose(), [geo]);
  const faded = opacity < 1;
  return (
    <>
      <mesh geometry={geo} renderOrder={1000}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.8} transparent={faded} opacity={opacity} depthWrite={!faded} />
      </mesh>
      {label ? (
        <Html position={[(a.x + b.x) / 2, (a.y + b.y) / 2 - sagOf(a, b), z + 0.05]} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
          <div className="io-threadlabel">{label}</div>
        </Html>
      ) : null}
    </>
  );
}

interface Props {
  notes: Note[];
  links: Link[];
  selectedNoteId: string | null;
  selectedLinkId: string | null;
  dimmedIds: ReadonlySet<string>;
  pending: PendingLink | null;
}

// Red string between the pins of linked notes. Selecting a note brightens its threads and fades the rest; a thread being dragged out
// of a pin follows the cursor. Threads hang in front of every note so they are never hidden by the papers they cross.
export default function Threads({ notes, links, selectedNoteId, selectedLinkId, dimmedIds, pending }: Props) {
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const z = noteZ(notes.length) + 0.02;
  return (
    <>
      {links.map((l) => {
        const na = byId.get(l.from), nb = byId.get(l.to);
        if (!na || !nb) return null;
        const incident = selectedNoteId !== null && (l.from === selectedNoteId || l.to === selectedNoteId);
        const picked = l.id === selectedLinkId;
        const dim = dimmedIds.has(l.from) || dimmedIds.has(l.to);
        const faded = (selectedNoteId !== null && !incident) || dim;
        return (
          <Thread key={l.id} a={anchorOf(na)} b={anchorOf(nb)} z={z}
            color={picked ? PICK : incident ? HOT : RED} radius={picked || incident ? 0.011 : 0.0075}
            opacity={faded ? 0.25 : 1} label={(incident || picked) && l.label ? l.label : undefined} />
        );
      })}
      {pending && byId.get(pending.from) && (
        <Thread a={anchorOf(byId.get(pending.from)!)} b={{ x: pending.x, y: pending.y }} z={z} color={pending.target ? '#2fbf71' : HOT} radius={0.009} opacity={0.9} />
      )}
    </>
  );
}
