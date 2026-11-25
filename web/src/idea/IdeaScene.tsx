import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { Desk, Furniture, Lights, Room, SkyBackground, useTextures } from '../components/office/gaming/GamingScene';
import Character3D, { preloadCharacters } from '../components/office/gaming/Character';
import { Prop, preloadFurniture } from '../components/office/gaming/Prop';
import type { V2 } from '../components/office/gaming/gamingLayout';
import { IDEA_WALL, OFFICE_DESKS, WORKER_FOCUS, WORKER_SPOTS, WRITING_DESK } from './ideaLayout';
import { circle } from './collision';
import type { ZoneId } from './ideaLayout';
import Player from './Player';
import type { Link, Note } from '@idea-office/shared';
import { NoteMesh } from './wall/NoteMesh';
import type { Outline } from './wall/NoteMesh';
import Threads from './wall/Threads';
import type { PendingLink } from './wall/Threads';
import WallController from './wall/WallController';

export const CLAUDE_LOOK = { model: 'Suit', title: 'Claude', sub: 'Business analyst', ring: '#D97757' };
export const GPT_LOOK = { model: 'Casual_Hoodie', title: 'GPT', sub: 'Sceptic', ring: '#10A37F' };
const PLAYER_MODEL = 'Worker';

function corkTexture(): CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#b98a5b'; c.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 5200; i++) {
    const dark = Math.random() < 0.5;
    c.fillStyle = dark ? `rgba(80,48,20,${0.1 + Math.random() * 0.18})` : `rgba(235,200,150,${0.1 + Math.random() * 0.2})`;
    c.beginPath(); c.arc(Math.random() * 512, Math.random() * 256, 0.8 + Math.random() * 2.1, 0, Math.PI * 2); c.fill();
  }
  const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// The Idea Wall: a big cork board in a wooden frame on the back wall. Phase 2 puts the notes on it.
function IdeaWallBoard() {
  const cork = useMemo(corkTexture, []);
  const { cx, cy, w, h, z } = IDEA_WALL;
  const fr = 0.12;
  return (
    <group position={[cx, cy, z]}>
      <mesh receiveShadow><planeGeometry args={[w, h]} /><meshStandardMaterial map={cork} roughness={1} /></mesh>
      {[[0, h / 2 + fr / 2, w + fr * 2, fr], [0, -h / 2 - fr / 2, w + fr * 2, fr], [-w / 2 - fr / 2, 0, fr, h], [w / 2 + fr / 2, 0, fr, h]].map(([x, y, bw, bh], i) => (
        <mesh key={i} position={[x, y, 0.03]} castShadow><boxGeometry args={[bw, bh, 0.08]} /><meshStandardMaterial color="#5b3d24" roughness={0.7} /></mesh>
      ))}
      <pointLight position={[-w / 4, h / 2 + 0.6, 1.4]} intensity={7} distance={7} color="#fff1d6" />
      <pointLight position={[w / 4, h / 2 + 0.6, 1.4]} intensity={7} distance={7} color="#fff1d6" />
    </group>
  );
}

function WritingDesk({ visible }: { visible: boolean }) {
  return (
    <group position={[WRITING_DESK.x, 0, WRITING_DESK.z]} visible={visible}>
      <Prop name="desk" scale={1.25} />
      <Prop name="books" pos={[-0.55, 0.94, 0.05]} />
      <Prop name="lampSquareTable" pos={[0.72, 0.94, -0.3]} />
      <mesh position={[0.05, 0.955, 0.12]} rotation={[0, 0.08, 0]} castShadow><boxGeometry args={[0.42, 0.012, 0.3]} /><meshStandardMaterial color="#fbf3dc" roughness={0.9} /></mesh>
    </group>
  );
}

type WorkerId = 'claude' | 'gpt';
export interface StageProps {
  spots: Record<WorkerId, V2>;                                          // where each colleague should be standing
  debating: boolean;                                                    // they face each other and the bubbles show
  speaker: 'claude' | 'gpt' | 'user' | null;
  bubbles: Record<WorkerId, { text: string; speaking: boolean }>;
  onArrive: (arrived: boolean) => void;                                 // both colleagues are standing on their spots
}

// A speech bubble that rides above a colleague's head wherever they walk.
function WorkerBubble({ id, positions, text, speaking, show }: { id: WorkerId; positions: React.MutableRefObject<Map<string, V2>>; text: string; speaking: boolean; show: boolean }) {
  const g = useRef<Group>(null);
  useFrame(() => { const p = positions.current.get(id); if (p && g.current) g.current.position.set(p.x, 0, p.z); });
  if (!show || !text) return <group ref={g} />;
  return (
    <group ref={g}>
      <Html position={[0, 2.95, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`io-bubble ${id}${speaking ? ' on' : ''}`}>{text}</div>
      </Html>
    </group>
  );
}

// Reports when both colleagues have walked to their spots (so words only appear once they are in place).
function Arrival({ positions, spots, onArrive }: { positions: React.MutableRefObject<Map<string, V2>>; spots: Record<WorkerId, V2>; onArrive: (a: boolean) => void }) {
  const last = useRef<boolean | null>(null);
  useFrame(() => {
    const near = (id: WorkerId) => { const p = positions.current.get(id); return !!p && Math.hypot(p.x - spots[id].x, p.z - spots[id].z) < 0.45; };
    const now = near('claude') && near('gpt');
    if (now !== last.current) { last.current = now; onArrive(now); }
  });
  return null;
}

export interface IdeaSceneProps {
  stage: StageProps;
  mode: 'walk' | 'wall';
  reduced: boolean;
  maximized: boolean;
  onZone: (z: ZoneId | null) => void;
  onInteract: (z: ZoneId) => void;
  notes: Note[];
  links: Link[];
  dimmedIds: ReadonlySet<string>;
  selectedId: string | null;
  selectedLinkId: string | null;
  outlines: ReadonlyMap<string, Outline>;
  pending: PendingLink | null;
  landingId: string | null;
  fontsReady: boolean;
  focus: { x: number; y: number; n: number } | null;
  onSelect: (id: string | null) => void;
  onSelectLink: (id: string) => void;
  onLinkDrag: (s: PendingLink | null) => void;
  onLinkCreate: (from: string, to: string) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, x: number, y: number) => void;
  onDrop: (id: string, x: number, y: number) => void;
  onGraphicsLost: (lost: boolean) => void;       // the browser took the graphics card away (and may give it back)
}

export default function IdeaScene({ stage, mode, reduced, maximized, onZone, onInteract, notes, links, dimmedIds, selectedId, selectedLinkId, outlines, pending, landingId, fontsReady, focus, onSelect, onSelectLink, onLinkDrag, onLinkCreate, onDragStart, onDrag, onDrop, onGraphicsLost }: IdeaSceneProps) {
  const ranked = useMemo(() => [...notes].sort((a, b) => a.z - b.z), [notes]);
  const tex = useTextures();
  const positions = useRef(new Map<string, V2>());
  useEffect(() => { preloadFurniture(); preloadCharacters([PLAYER_MODEL, CLAUDE_LOOK.model, GPT_LOOK.model]); }, []);
  const noop = () => undefined;
  const workerObstacles = () => (['claude', 'gpt'] as const).flatMap((id) => { const p = positions.current.get(id); return p ? [circle(p.x, p.z, 0.4)] : []; });
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 58, near: 0.1, far: 200, position: [0, 3, 8] }} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ background: '#cfe0f3' }}
      onCreated={({ gl }) => {
        const el = gl.domElement;
        if (import.meta.env.DEV) (window as unknown as { __gl?: unknown }).__gl = gl;     // dev only: lets the browser tests read draw-call counts
        el.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onGraphicsLost(true); });     // preventDefault lets the browser restore it
        el.addEventListener('webglcontextrestored', () => onGraphicsLost(false));
      }}>
      <SkyBackground />
      <Lights />
      <Suspense fallback={null}>
        <Room />
        <Furniture />
        {OFFICE_DESKS.map((i) => <Desk key={`d${i}`} i={i} status="idle" code={tex.code} reduced={reduced} />)}
        <IdeaWallBoard />
        <WritingDesk visible={mode === 'walk'} />
        {([[CLAUDE_LOOK, 'claude', 'gpt'], [GPT_LOOK, 'gpt', 'claude']] as const).map(([look, id, other]) => (
          <Character3D key={id} id={id} model={look.model} intent={{ kind: 'break', spot: stage.spots[id] }} status="idle"
            focus={stage.debating ? stage.spots[other] : WORKER_FOCUS} gesture={stage.debating && stage.speaker === id ? 'talk' : null}
            positions={positions} reduced={reduced} label={{ title: look.title, sub: look.sub, ring: look.ring }} selected={false} onSelect={noop} />
        ))}
        <Arrival positions={positions} spots={stage.spots} onArrive={stage.onArrive} />
        {(['claude', 'gpt'] as const).map((id) => <WorkerBubble key={id} id={id} positions={positions} show={stage.debating} text={stage.bubbles[id].text} speaking={stage.bubbles[id].speaking} />)}
        {ranked.map((n, i) => (
          <NoteMesh key={n.id} note={n} rank={i} dim={dimmedIds.has(n.id)} outline={outlines.get(n.id) ?? null} landing={n.id === landingId} fontsReady={fontsReady} reduced={reduced} />
        ))}
        <Threads notes={notes} links={links} selectedNoteId={selectedId} selectedLinkId={selectedLinkId} dimmedIds={dimmedIds} pending={pending} />
        <WallController active={mode === 'wall'} maximized={maximized} reduced={reduced} notes={notes} links={links} onSelect={onSelect} onSelectLink={onSelectLink} onLinkDrag={onLinkDrag} onLinkCreate={onLinkCreate} onDragStart={onDragStart} onDrag={onDrag} onDrop={onDrop} focus={focus} />
        <Player extraObstacles={workerObstacles} model={PLAYER_MODEL} enabled={mode === 'walk'} cameraControl={mode === 'walk'} hidden={mode === 'wall'} reduced={reduced} onZone={onZone} onInteract={onInteract} />
      </Suspense>
    </Canvas>
  );
}
