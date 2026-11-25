import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, Line as ThreeLine, LineBasicMaterial,
  Mesh, MeshBasicMaterial, PerspectiveCamera, QuadraticBezierCurve3, RepeatWrapping, SRGBColorSpace, Vector3,
} from 'three';
import type { LineEvent, LineKind, OfficeState, OfficeStatus } from '../../../lib/officeModel';
import { HUB, HUB_WORKER, workerName } from '../../../lib/officeModel';
import { workerTitle } from '../../../lib/workerPersonas';
import { OFFICE_TEXT as T } from '../officeText';
import Character3D, { preloadCharacters } from './Character';
import { Prop, preloadFurniture } from './Prop';
import {
  BREAK_SPOTS, CHAIR_OFFSET, DESK_POS, HUB_STAND, HUB_TABLE, MEET_TABLE, ROOM, TILE, WALL_H, intentFor, intentPoint,
} from './gamingLayout';
import type { V2 } from './gamingLayout';

const PEOPLE = ['Casual_Hoodie', 'Casual_2', 'Worker', 'Farmer', 'Punk', 'Adventurer', 'King', 'Beach', 'Swat'];
const HUB_MODEL = 'Suit';
const LINE_COLOR: Record<LineKind, string> = { assign: '#3DDC84', handoff: '#4C8DFF', result: '#5ED8C8', ask: '#FF6B6B' };
const RING: Record<OfficeStatus | 'handoff', string> = { idle: '#9AA3B2', waiting: '#F5A524', working: '#3DDC84', handoff: '#4C8DFF', blocked: '#FF6B6B', done: '#5ED8C8' };
const STATUS_TEXT: Record<OfficeStatus | 'handoff', string> = { idle: T.status.idle, waiting: T.status.waiting, working: T.status.working, handoff: T.status.handoff, blocked: T.status.blocked, done: T.status.done };
const GROW_MS = 700;
const FADE_MS = 12000;
const PACKET_MS = 1500;

// ---- textures, drawn once -------------------------------------------------
function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

export function useTextures() {
  return useMemo(() => {
    const carpet = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#8c97a8'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) { c.fillStyle = `rgba(${i % 2 ? '255,255,255' : '40,50,70'},${Math.random() * 0.06})`; c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
      c.strokeStyle = 'rgba(40,52,76,.35)'; c.lineWidth = 2; c.strokeRect(1, 1, 254, 254);
    }, [ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ]);
    carpet.repeat.set((ROOM.maxX - ROOM.minX) / 2, (ROOM.maxZ - ROOM.minZ) / 2);
    const wood = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#b98b5e'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? 'rgba(90,50,20,.10)' : 'rgba(255,230,190,.08)'; c.fillRect(0, i * 32, 256, 32); c.fillStyle = 'rgba(60,30,10,.35)'; c.fillRect(0, i * 32, 256, 2); }
      for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(60,30,10,.12)'; c.fillRect((i * 67) % 256, ((i * 31) % 8) * 32, 1.5, 32); }
    }, [3, 3]);
    const code = canvasTexture(128, 256, (c) => {
      c.fillStyle = '#0c1a2c'; c.fillRect(0, 0, 128, 256);
      const cols = ['#5fd0ff', '#7ee787', '#d2a8ff', '#ffa657', '#8b949e'];
      for (let y = 6; y < 256; y += 9) {
        let x = 8 + ((y * 7) % 3) * 10;
        for (let k = 0; k < 3 + (y % 4); k++) { const w = 10 + ((y * 13 + k * 17) % 34); c.fillStyle = cols[(y + k) % cols.length]; c.fillRect(x, y, w, 4); x += w + 5; if (x > 116) break; }
      }
    });
    code.wrapS = code.wrapT = RepeatWrapping;
    const sky = canvasTexture(1024, 256, (c) => {
      const g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#6aa7e8'); g.addColorStop(0.65, '#bcd8f2'); g.addColorStop(1, '#f1e6d0');
      c.fillStyle = g; c.fillRect(0, 0, 1024, 256);
      for (let i = 0; i < 52; i++) {
        const w = 22 + ((i * 37) % 40), h = 50 + ((i * 53) % 130), x = (i * 20) % 1024;
        c.fillStyle = i % 3 ? '#8aa0bd' : '#74899f'; c.fillRect(x, 256 - h, w, h);
        c.fillStyle = 'rgba(255,255,255,.55)';
        for (let yy = 256 - h + 6; yy < 250; yy += 10) for (let xx = x + 3; xx < x + w - 4; xx += 8) if ((xx * 7 + yy * 3) % 5 < 2) c.fillRect(xx, yy, 3, 4);
      }
    });
    return { carpet, wood, code, sky };
  }, []);
}

// ---- the room ---------------------------------------------------------------
// A real enclosed office: four walls, a ceiling, a street outside the windows.
// Seen from outside (Overview) the walls and ceiling nearest the camera step
// aside so you can still look in; from inside (the default) all of them are there.
const BACK_WALL = ['wallWindow', 'wallWindow', 'wall', 'wallWindow', 'wallWindow', 'wallDoorway', 'wallWindow', 'wallWindow', 'wall', 'wallWindow', 'wallWindow', 'wallWindow'];
const SIDE_WALL = ['wallWindow', 'wall', 'wallWindow', 'wallWindow', 'wall', 'wallWindow', 'wallWindow', 'wall'];
const FRONT_WALL = ['wallWindow', 'wallWindow', 'wall', 'wallWindow', 'wallWindow', 'wallDoorway', 'wallWindow', 'wallWindow', 'wallWindow', 'wall', 'wallWindow', 'wallWindow'];
const ACCENT = { wood: '#eef1f5', metalDark: '#8196b0', _defaultMat: '#cdd9ec' };   // the wall behind the desks is a soft blue

function drawBoard(c: CanvasRenderingContext2D) {
  c.fillStyle = '#fbfcfe'; c.fillRect(0, 0, 300, 200);
  c.strokeStyle = '#3a74e8'; c.fillStyle = '#e8f0ff'; c.lineWidth = 3;
  const box = (x: number, y: number, w: number, h: number) => { c.fillRect(x, y, w, h); c.strokeRect(x, y, w, h); };
  box(110, 20, 80, 36); box(20, 110, 70, 36); box(115, 110, 70, 36); box(210, 110, 70, 36);
  c.strokeStyle = '#5ed8c8';
  for (const [x1, x2] of [[150, 55], [150, 150], [150, 245]]) { c.beginPath(); c.moveTo(150, 56); c.lineTo(x2, 110); c.stroke(); void x1; }
  c.fillStyle = '#3d4a63'; for (let i = 0; i < 5; i++) c.fillRect(24, 160 + i * 6, 120 - i * 14, 3);
}

type WallRefs = { front: Group | null; right: Group | null; left: Group | null; back: Group | null; ceiling: Group | null };

export function Room() {
  const tex = useTextures();
  const refs = useRef<WallRefs>({ front: null, right: null, left: null, back: null, ceiling: null });
  const { camera } = useThree();
  const w = ROOM.maxX - ROOM.minX, d = ROOM.maxZ - ROOM.minZ;
  const tilesX = Math.round(w / TILE), tilesZ = Math.round(d / TILE);
  const board = useMemo(() => canvasTexture(300, 200, drawBoard), []);
  const ceilingTex = useMemo(() => canvasTexture(128, 128, (c) => {
    c.fillStyle = '#f4f6fa'; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(120,135,160,.45)'; c.lineWidth = 2; c.strokeRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(110,120,140,${Math.random() * 0.07})`; c.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  }, [w / 2, d / 2]), [w, d]);

  // Walls and ceiling step aside when the camera is outside them.
  useFrame(() => {
    const r = refs.current, p = camera.position, m = 0.3;
    if (r.front) r.front.visible = p.z < ROOM.maxZ + m;
    if (r.back) r.back.visible = p.z > ROOM.minZ - m;
    if (r.right) r.right.visible = p.x < ROOM.maxX + m;
    if (r.left) r.left.visible = p.x > ROOM.minX - m;
    if (r.ceiling) r.ceiling.visible = p.y < WALL_H + 0.2;
  });

  const lights: [number, number][] = [];
  for (let x = -8; x <= 8; x += 4) for (let z = -5; z <= 5; z += 5) lights.push([x, z]);
  const sky = (x: number, z: number, ry: number, key: string) => (
    <mesh key={key} position={[x, 3.2, z]} rotation={[0, ry, 0]}><planeGeometry args={[110, 18]} /><meshBasicMaterial map={tex.sky} toneMapped={false} /></mesh>
  );
  return (
    <group>
      {/* outside: a street around the building and the city beyond it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow><planeGeometry args={[130, 130]} /><meshStandardMaterial color="#7d8a9b" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow><planeGeometry args={[w + 5, d + 5]} /><meshStandardMaterial color="#a9b4c3" roughness={1} /></mesh>
      {sky(0, ROOM.minZ - 30, 0, 'sk-b')}
      {sky(0, ROOM.maxZ + 30, Math.PI, 'sk-f')}
      {sky(ROOM.minX - 30, 0, Math.PI / 2, 'sk-l')}
      {sky(ROOM.maxX + 30, 0, -Math.PI / 2, 'sk-r')}

      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex.carpet} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[8.5, 0.012, 5.1]} receiveShadow><planeGeometry args={[6.4, 5.4]} /><meshStandardMaterial map={tex.wood} roughness={0.7} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-8.3, 0.012, 5.0]} receiveShadow><planeGeometry args={[6.8, 5.6]} /><meshStandardMaterial map={tex.wood} roughness={0.7} /></mesh>

      {/* walls */}
      <group ref={(g) => { refs.current.back = g; }}>
        {Array.from({ length: tilesX }, (_, i) => (
          <Prop key={`b${i}`} name={BACK_WALL[i % BACK_WALL.length]} scaleY={WALL_H / 2.5} cast={false} recolor={ACCENT} pos={[ROOM.minX + TILE * (i + 0.5), 0, ROOM.minZ]} anchor="back" />
        ))}
        <mesh position={[ROOM.minX + TILE * 2.5, 1.75, ROOM.minZ + 0.06]}><planeGeometry args={[1.6, 1.07]} /><meshStandardMaterial map={board} roughness={0.5} /></mesh>
        <mesh position={[ROOM.minX + TILE * 8.5, 1.75, ROOM.minZ + 0.06]}><planeGeometry args={[1.6, 1.07]} /><meshStandardMaterial map={board} roughness={0.5} /></mesh>
      </group>
      <group ref={(g) => { refs.current.left = g; }}>
        {Array.from({ length: tilesZ }, (_, i) => (
          <Prop key={`l${i}`} name={SIDE_WALL[i % SIDE_WALL.length]} scaleY={WALL_H / 2.5} cast={false} pos={[ROOM.minX, 0, ROOM.minZ + TILE * (i + 0.5)]} rot={Math.PI / 2} anchor="back" />
        ))}
      </group>
      <group ref={(g) => { refs.current.right = g; }}>
        {Array.from({ length: tilesZ }, (_, i) => (
          <Prop key={`r${i}`} name={SIDE_WALL[(i + 3) % SIDE_WALL.length]} scaleY={WALL_H / 2.5} cast={false} pos={[ROOM.maxX, 0, ROOM.minZ + TILE * (i + 0.5)]} rot={-Math.PI / 2} anchor="back" />
        ))}
      </group>
      <group ref={(g) => { refs.current.front = g; }}>
        {Array.from({ length: tilesX }, (_, i) => (
          <Prop key={`f${i}`} name={FRONT_WALL[i % FRONT_WALL.length]} scaleY={WALL_H / 2.5} cast={false} pos={[ROOM.minX + TILE * (i + 0.5), 0, ROOM.maxZ]} rot={Math.PI} anchor="back" />
        ))}
      </group>
      {/* skirting along the foot of every wall */}
      {[[0, ROOM.minZ + 0.03, w, 0.06], [0, ROOM.maxZ - 0.03, w, 0.06]].map(([x, z, ww, dd], i) => (
        <mesh key={`sk${i}`} position={[x, 0.09, z]}><boxGeometry args={[ww, 0.18, dd]} /><meshStandardMaterial color="#8196b0" /></mesh>
      ))}
      {[ROOM.minX + 0.03, ROOM.maxX - 0.03].map((x, i) => (
        <mesh key={`sks${i}`} position={[x, 0.09, 0]}><boxGeometry args={[0.06, 0.18, d]} /><meshStandardMaterial color="#8196b0" /></mesh>
      ))}

      {/* ceiling with light panels: one-sided, so it only shows from inside */}
      <group ref={(g) => { refs.current.ceiling = g; }}>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_H, 0]}><planeGeometry args={[w, d]} /><meshStandardMaterial map={ceilingTex} roughness={1} /></mesh>
        {lights.map(([x, z]) => (
          <mesh key={`lp${x}_${z}`} rotation={[Math.PI / 2, 0, 0]} position={[x, WALL_H - 0.02, z]}><planeGeometry args={[2.2, 0.7]} /><meshBasicMaterial color="#fffdf5" toneMapped={false} /></mesh>
        ))}
      </group>
    </group>
  );
}

export function SkyBackground() {
  const { scene } = useThree();
  useEffect(() => {
    const t = canvasTexture(8, 256, (c) => { const g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#7fb0e8'); g.addColorStop(0.6, '#cfe2f4'); g.addColorStop(1, '#f3e9d6'); c.fillStyle = g; c.fillRect(0, 0, 8, 256); });
    scene.background = t;
    return () => { scene.background = null; t.dispose(); };
  }, [scene]);
  return null;
}

export function Lights() {
  return (
    <>
      <hemisphereLight args={['#eef4ff', '#8a7a68', 1.25]} />
      <ambientLight intensity={0.75} />
      <directionalLight
        position={[-9, 16, 12]} intensity={1.7} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-17} shadow-camera-right={17} shadow-camera-top={13} shadow-camera-bottom={-13} shadow-camera-near={1} shadow-camera-far={45}
        shadow-bias={-0.0004} shadow-normalBias={0.03}
      />
      <pointLight position={[0, 3.0, -2.2]} intensity={14} distance={9} color="#9ec4ff" />
    </>
  );
}

// ---- desks ------------------------------------------------------------------
function Monitor({ x, status, code, reduced }: { x: number; status: OfficeStatus | 'handoff'; code: CanvasTexture; reduced: boolean }) {
  const mat = useRef<MeshBasicMaterial>(null);
  const tex = useMemo(() => { const t = code.clone(); t.needsUpdate = true; t.repeat.set(1, 0.6); t.offset.y = Math.random(); return t; }, [code]);
  useFrame((_, dt) => {
    const m = mat.current; if (!m) return;
    const live = status === 'working' || status === 'handoff';
    if (live && !reduced) tex.offset.y = (tex.offset.y + dt * 0.18) % 1;
    const target = new Color(live ? '#ffffff' : status === 'blocked' ? '#ff5d5d' : status === 'done' ? '#7dffc9' : status === 'waiting' ? '#6b5a2a' : '#10151f');
    m.color.lerp(target, Math.min(1, dt * 6));
    m.map = status === 'blocked' || status === 'done' ? null : tex;
    m.needsUpdate = true;
  });
  return (
    <group position={[x, 0.74, -0.18]}>
      <mesh position={[0, 0.02, 0.0]} castShadow><cylinderGeometry args={[0.1, 0.12, 0.03, 16]} /><meshStandardMaterial color="#20242c" /></mesh>
      <mesh position={[0, 0.17, -0.02]} castShadow><boxGeometry args={[0.04, 0.3, 0.03]} /><meshStandardMaterial color="#20242c" /></mesh>
      <mesh position={[0, 0.42, 0]} castShadow><boxGeometry args={[0.62, 0.37, 0.035]} /><meshStandardMaterial color="#14171d" roughness={0.4} /></mesh>
      <mesh position={[0, 0.42, 0.019]}><planeGeometry args={[0.57, 0.32]} /><meshBasicMaterial ref={mat} color="#10151f" toneMapped={false} /></mesh>
    </group>
  );
}

export function Desk({ i, status, code, reduced }: { i: number; status: OfficeStatus | 'handoff'; code: CanvasTexture; reduced: boolean }) {
  const p = DESK_POS[i];
  return (
    <group position={[p.x, 0, p.z]}>
      <Prop name="desk" scale={1} rot={0} />
      <Monitor x={-0.36} status={status} code={code} reduced={reduced} />
      <Monitor x={0.36} status={status} code={code} reduced={reduced} />
      <Prop name="computerKeyboard" pos={[0, 0.74, 0.22]} scale={0.9} />
      <Prop name="computerMouse" pos={[0.5, 0.74, 0.24]} scale={0.9} />
      <Prop name="chairDesk" pos={[0, 0, CHAIR_OFFSET]} rot={Math.PI} />
      {status === 'working' && <pointLight position={[0, 1.1, 0.3]} intensity={1.4} distance={2.4} color="#6fb4ff" />}
    </group>
  );
}

// ---- break areas, decor -----------------------------------------------------
export function Furniture() {
  return (
    <group>
      {/* coffee corner, front right: a counter along the wall */}
      <Prop name="kitchenFridge" pos={[ROOM.maxX - 0.5, 0, 1.6]} rot={-Math.PI / 2} />
      <Prop name="kitchenCabinet" pos={[ROOM.maxX - 0.5, 0, 2.5]} rot={-Math.PI / 2} />
      <Prop name="kitchenSink" pos={[ROOM.maxX - 0.5, 0, 3.4]} rot={-Math.PI / 2} />
      <Prop name="kitchenCabinet" pos={[ROOM.maxX - 0.5, 0, 4.3]} rot={-Math.PI / 2} />
      <Prop name="kitchenCoffeeMachine" pos={[ROOM.maxX - 0.5, 0.9, 4.3]} rot={-Math.PI / 2} />
      <Prop name="kitchenCabinet" pos={[ROOM.maxX - 0.5, 0, 5.2]} rot={-Math.PI / 2} />
      <Prop name="stoolBar" pos={[7.3, 0, 6.6]} /><Prop name="stoolBar" pos={[8.1, 0, 7.0]} />
      <Prop name="trashcan" pos={[ROOM.maxX - 0.5, 0, 6.6]} />
      {/* lounge, front left */}
      <Prop name="rugRectangle" pos={[-8.4, 0.02, 5.2]} scale={1.4} />
      <Prop name="loungeSofaLong" pos={[-9.6, 0, 6.9]} rot={Math.PI} scale={1.05} />
      <Prop name="loungeChair" pos={[-6.4, 0, 5.8]} rot={Math.PI * 0.75} />
      <Prop name="tableCoffee" pos={[-8.4, 0, 5.4]} />
      <Prop name="televisionModern" pos={[ROOM.minX + 0.35, 1.2, 4.8]} rot={Math.PI / 2} scale={1.3} />
      <Prop name="cabinetTelevision" pos={[ROOM.minX + 0.45, 0, 4.8]} rot={Math.PI / 2} />
      <Prop name="lampSquareFloor" pos={[-11, 0, 7.0]} />
      {/* meeting corner, back right */}
      <Prop name="table" pos={[MEET_TABLE.x, 0, MEET_TABLE.z]} scale={1.5} />
      {[0, 1, 2, 3, 4, 5].map((k) => {
        const a = (k / 6) * Math.PI * 2;
        return <Prop key={`mc${k}`} name="chair" pos={[MEET_TABLE.x + Math.cos(a) * 1.7, 0, MEET_TABLE.z + Math.sin(a) * 1.4]} rot={-a - Math.PI / 2} />;
      })}
      {/* storage along the back wall, plants everywhere */}
      <Prop name="bookcaseClosedWide" pos={[-11.1, 0, -6.8]} rot={Math.PI / 2} />
      <Prop name="bookcaseOpen" pos={[-11.1, 0, -4.9]} rot={Math.PI / 2} />
      <Prop name="pottedPlant" pos={[-10.8, 0, -2.6]} scale={1.3} />
      <Prop name="pottedPlant" pos={[11, 0, -7.1]} scale={1.3} />
      <Prop name="pottedPlant" pos={[3.3, 0, -2.2]} scale={1.2} />
      <Prop name="pottedPlant" pos={[-3.3, 0, 2.3]} scale={1.2} />
      <Prop name="pottedPlant" pos={[11, 0, 0.6]} scale={1.2} />
      <Prop name="plantSmall1" pos={[-4.2, 0.74, -5.3]} />
      <Prop name="lampSquareFloor" pos={[-10.8, 0, 0.5]} />
      <Prop name="coatRackStanding" pos={[-10.8, 0, -1.2]} />
      <Prop name="rugRound" pos={[0, 0.02, -2.1]} scale={1.1} />
    </group>
  );
}

// ---- hub (orchestration) ----------------------------------------------------
function HubTable({ status, total, active, done }: { status: OfficeStatus; total: number; active: number; done: number }) {
  const ring = useRef<Mesh>(null);
  const col = RING[status === 'idle' ? 'working' : status];
  useFrame((_, dt) => { if (ring.current) ring.current.rotation.z += dt * 0.8; });
  return (
    <group position={[HUB_TABLE.x, 0, HUB_TABLE.z]}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow><cylinderGeometry args={[0.85, 0.85, 0.9, 40]} /><meshStandardMaterial color="#1b2436" roughness={0.5} metalness={0.3} /></mesh>
      <mesh position={[0, 0.92, 0]}><cylinderGeometry args={[0.8, 0.8, 0.03, 40]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
      <mesh ref={ring} position={[0, 1.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.55, 0.018, 8, 60]} /><meshBasicMaterial color={col} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 1.15, 0]}><sphereGeometry args={[0.18, 20, 16]} /><meshBasicMaterial color={col} toneMapped={false} transparent opacity={0.75} blending={AdditiveBlending} /></mesh>
      <pointLight position={[0, 1.5, 0]} intensity={6} distance={5} color={col} />
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.0, 1.08, 48]} /><meshBasicMaterial color={col} transparent opacity={0.6} /></mesh>
      <group visible={false}>{total + active + done}</group>
    </group>
  );
}

// ---- links between workers --------------------------------------------------
interface Link { key: string; ev: LineEvent; born: number }

function LinkArc({ link, positions }: { link: Link; positions: React.MutableRefObject<Map<string, V2>> }) {
  const lineRef = useRef<ThreeLine>(null);
  const packet = useRef<Mesh>(null);
  const curve = useMemo(() => new QuadraticBezierCurve3(new Vector3(), new Vector3(), new Vector3()), []);
  const geom = useMemo(() => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(new Float32Array(40 * 3), 3)); return g; }, []);
  const color = LINE_COLOR[link.ev.kind];
  const point = (id: string): V2 | undefined => (id === HUB ? positions.current.get(HUB_WORKER) ?? HUB_STAND : positions.current.get(id));
  useFrame(() => {
    const a = point(link.ev.from), b = point(link.ev.to); const line = lineRef.current; if (!a || !b || !line) return;
    const now = performance.now();
    const t = Math.min(1, Math.max(0, (now - link.born) / GROW_MS));
    const age = Math.min(1, Math.max(0, (now - link.born - GROW_MS) / FADE_MS));
    curve.v0.set(a.x, 2.1, a.z); curve.v2.set(b.x, 2.1, b.z);
    const mid = curve.v0.clone().add(curve.v2).multiplyScalar(0.5); mid.y += 1.2 + curve.v0.distanceTo(curve.v2) * 0.12; curve.v1.copy(mid);
    const pos = geom.getAttribute('position');
    const n = Math.max(2, Math.round(40 * t));
    for (let i = 0; i < 40; i++) { const u = Math.min(i, n - 1) / 39 * t; const p = curve.getPoint(u); pos.setXYZ(i, p.x, p.y, p.z); }
    pos.needsUpdate = true;
    (line.material as LineBasicMaterial).opacity = 0.95 - 0.7 * age;
    const pk = packet.current;
    if (pk) {
      const q = (now - link.born) / PACKET_MS;
      pk.visible = q >= 0 && q <= 1 && link.ev.kind !== 'assign';
      if (pk.visible) { const p = curve.getPoint(q); pk.position.copy(p); pk.rotation.y += 0.1; pk.scale.setScalar(0.8 + Math.sin(q * Math.PI) * 0.6); }
    }
  });
  return (
    <group>
      <primitive object={useMemo(() => { const l = new ThreeLine(geom, new LineBasicMaterial({ color, transparent: true, linewidth: 2, toneMapped: false })); return l; }, [geom, color])} ref={lineRef} />
      <mesh ref={packet} visible={false}>
        <boxGeometry args={[0.28, 0.18, 0.04]} /><meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Links({ lines, positions }: { lines: LineEvent[]; positions: React.MutableRefObject<Map<string, V2>> }) {
  const born = useRef(new Map<number, number>());
  const first = useRef(true);
  const links = useMemo<Link[]>(() => {
    const now = performance.now();
    if (lines.length < born.current.size) born.current.clear();
    for (const l of lines) if (!born.current.has(l.idx)) born.current.set(l.idx, first.current ? -1e9 : now);
    first.current = false;
    const latest = new Map<string, LineEvent>();
    for (const l of lines) if (!(l.from === HUB && l.to === HUB)) latest.set(`${l.from}|${l.to}|${l.kind}`, l);
    return Array.from(latest.entries()).map(([key, ev]) => ({ key: `${key}|${ev.idx}`, ev, born: born.current.get(ev.idx)! }));
  }, [lines]);
  return <>{links.map((l) => <LinkArc key={l.key} link={l} positions={positions} />)}</>;
}

// ---- the whole scene --------------------------------------------------------
export interface SceneProps {
  state: OfficeState;
  desks: (string | null)[];
  statusOf: (id: string) => OfficeStatus | 'handoff';
  selected: string | null;
  onSelect: (id: string | null) => void;
  reduced: boolean;
  view: View;
}

function Workers({ state, desks, statusOf, selected, onSelect, reduced }: SceneProps) {
  const positions = useRef(new Map<string, V2>());
  const tex = useTextures();
  const order = useMemo(() => {
    // The order in which workers finished, from the event feed, so the first to finish takes the first break spot.
    const done: string[] = [];
    for (const f of state.feed) if (state.workers[f.worker]?.status === 'done' && !done.includes(f.worker) && /finished/.test(f.text)) done.push(f.worker);
    for (const id of Object.keys(state.workers)) if (state.workers[id].status === 'done' && !done.includes(id)) done.push(id);
    return done;
  }, [state.feed, state.workers]);
  const hubStatus: OfficeStatus = state.total === 0 ? 'idle' : state.done === state.total ? 'done' : state.blocked > 0 ? 'blocked' : state.active > 0 ? 'working' : 'waiting';
  const ids = state.roster.filter((id) => id !== HUB_WORKER);
  const deskOf = (id: string) => desks.indexOf(id);
  let overflowN = 0;
  return (
    <>
      {desks.map((id, i) => <Desk key={`desk${i}`} i={i} status={id ? statusOf(id) : 'idle'} code={tex.code} reduced={reduced} />)}
      <HubTable status={hubStatus} total={state.total} active={state.active} done={state.done} />
      <Links lines={state.lines} positions={positions} />
      {ids.map((id) => {
        const desk = deskOf(id);
        const st = statusOf(id);
        const w = state.workers[id];
        const doneIndex = Math.max(0, order.indexOf(id));
        const model = PEOPLE[(desk >= 0 ? desk : 9 + overflowN++) % PEOPLE.length];
        const intent = intentFor({ isHub: false, desk, status: w?.status ?? 'idle', step: state.step, doneIndex, doneCount: state.done, total: state.total });
        return (
          <Character3D
            key={id} id={id} model={model} intent={intent} status={st} positions={positions} reduced={reduced}
            focus={intent.kind === 'break' ? { x: intentPoint(intent).x + 1, z: intentPoint(intent).z - 2 } : intent.kind === 'meet' ? MEET_TABLE : undefined}
            label={{ title: w?.task ?? workerTitle(id), sub: `${workerName(id)} · ${STATUS_TEXT[st]}${w?.status === 'done' && typeof w.confidence === 'number' ? ` · ${Math.round(w.confidence * 100)}%` : ''}`, ring: RING[st] }}
            selected={selected === id}
            compact={intent.kind === 'meet' || (intent.kind === 'break' && state.done >= 4)}
            onSelect={() => onSelect(selected === id ? null : id)}
          />
        );
      })}
      {state.roster.includes(HUB_WORKER) && (
        <Character3D
          id={HUB_WORKER} model={HUB_MODEL} intent={{ kind: 'hub' }} status={hubStatus === 'working' ? 'handoff' : hubStatus} isHub positions={positions} reduced={reduced}
          focus={HUB_TABLE}
          label={{ title: T.hub.title, sub: state.total === 0 ? T.hub.waiting : hubStatus === 'done' ? T.hub.done : `${state.active} ${T.hub.working} · ${state.done}/${state.total} ${T.header.done}`, ring: '#4C8DFF' }}
          selected={selected === HUB_WORKER} onSelect={() => onSelect(selected === HUB_WORKER ? null : HUB_WORKER)}
        />
      )}
    </>
  );
}

export type View = 'inside' | 'overview';
const EYE = 2.3;
const START = { x: 7.8, z: 6.4, yaw: 0.82, pitch: -0.3 };

// Standing in the office: drag to look around, scroll or W A S D / arrow keys to walk.
function InsideControls() {
  const { camera, gl } = useThree();
  const st = useRef({ x: START.x, z: START.z, yaw: START.yaw, pitch: START.pitch, keys: new Set<string>(), hover: false });
  useEffect(() => {
    const el = gl.domElement, s = st.current;
    const cam = camera as PerspectiveCamera;
    cam.fov = 62; cam.near = 0.1; cam.updateProjectionMatrix(); cam.rotation.order = 'YXZ';
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!last || !(e.buttons & 1)) { last = null; return; }
      s.yaw += (e.clientX - last.x) * 0.0042; s.pitch = Math.max(-1.0, Math.min(0.6, s.pitch + (e.clientY - last.y) * 0.003));
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => { last = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = -e.deltaY * 0.012;
      s.x += -Math.sin(s.yaw) * d; s.z += -Math.cos(s.yaw) * d;
    };
    const enter = () => { s.hover = true; }; const leave = () => { s.hover = false; s.keys.clear(); };
    const key = (down_: boolean) => (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!s.hover || (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT'))) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); if (down_) s.keys.add(k); else s.keys.delete(k); }
    };
    const kd = key(true), ku = key(false);
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel); el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
    };
  }, [camera, gl]);
  useFrame((_, dtRaw) => {
    const s = st.current, dt = Math.min(dtRaw, 0.1), k = s.keys, sp = 4.2 * dt;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const str = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    s.x += (-Math.sin(s.yaw) * fwd + Math.cos(s.yaw) * str) * sp;
    s.z += (-Math.cos(s.yaw) * fwd - Math.sin(s.yaw) * str) * sp;
    s.x = Math.max(ROOM.minX + 0.9, Math.min(ROOM.maxX - 0.9, s.x));
    s.z = Math.max(ROOM.minZ + 0.9, Math.min(ROOM.maxZ - 0.9, s.z));
    camera.position.set(s.x, EYE, s.z);
    camera.rotation.set(s.pitch, s.yaw, 0);
  });
  return null;
}

// From outside the building, turning around it.
function OverviewControls() {
  const { camera } = useThree();
  const target: [number, number, number] = [0, 0, 1.0];
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    cam.fov = 34; cam.near = 0.5; cam.updateProjectionMatrix();
    cam.rotation.order = 'XYZ';
    cam.position.set(5, 19.5, 25.5); cam.lookAt(...target);
  }, [camera]);
  return <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} target={target}
    minDistance={14} maxDistance={60} minPolarAngle={0.35} maxPolarAngle={1.3} />;
}

export default function GamingScene(props: SceneProps) {
  useEffect(() => { preloadFurniture(); preloadCharacters([...PEOPLE, HUB_MODEL]); }, []);
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 62, near: 0.1, far: 200 }} gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => props.onSelect(null)} style={{ background: '#cfe0f3' }}>
      <SkyBackground />
      <Lights />
      {props.view === 'inside' ? <InsideControls /> : <OverviewControls />}
      <Suspense fallback={null}>
        <Room />
        <Furniture />
        <Workers {...props} />
        <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={30} blur={2.4} far={3} frames={1} />
      </Suspense>
    </Canvas>
  );
}
export { BREAK_SPOTS, DoubleSide, Group };
