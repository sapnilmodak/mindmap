import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Group, Material, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { TILE } from './gamingLayout';

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/office/gaming`;
export const furnitureUrl = (name: string) => `${ASSET_BASE}/furniture/${name}.glb`;

interface PropProps {
  name: string;
  pos?: [number, number, number];
  rot?: number;                  // yaw in radians
  scale?: number;                // 1 = the kit's own size (see TILE)
  scaleY?: number;               // extra stretch upward only, for walls
  cast?: boolean;                // casts a shadow (default true)
  anchor?: 'center' | 'back';    // 'back' pins the model's back edge to pos, for things that stand against a wall
  receive?: boolean;
  recolor?: Record<string, string>;   // material name in the kit to a colour, so the office has its own palette
}

const recolored = new Map<string, Material>();
const glasses = new Map<string, Material>();
function glassOf(m: Material): Material {
  let c = glasses.get(m.uuid);
  if (!c) { c = m.clone(); c.transparent = true; c.opacity = 0.18; c.depthWrite = false; (c as MeshStandardMaterial).color.set('#cfe8ff'); glasses.set(m.uuid, c); }
  return c;
}
function tinted(m: Material, color: string): Material {
  const key = `${m.uuid}|${color}`;
  let c = recolored.get(key);
  if (!c) { c = m.clone(); (c as MeshStandardMaterial).color.set(color); recolored.set(key, c); }
  return c;
}

// The office palette: the kit ships in candy colours, these bring it to a calm office.
const WALL = { wood: '#eef1f5', metalDark: '#8196b0' };
export const PALETTE: Record<string, Record<string, string>> = {
  wall: WALL, wallWindow: WALL, wallDoorway: WALL,
  desk: { wood: '#e3c9a2', metal: '#cfd8e1' },
  chairDesk: { carpet: '#2f405e' },
  stoolBar: { carpet: '#2f405e' },
  rugRectangle: { carpet: '#566c96', carpetDarker: '#43557a' },
  rugRound: { carpet: '#4d6a9e', carpetDarker: '#3a5280' },
  loungeSofaLong: { carpet: '#2f8a8f' },
  loungeSofa: { carpet: '#2f8a8f' },
  loungeChair: { carpet: '#e0a53a' },
};

// One piece of the Kenney furniture kit. Models are re-centred on the floor so
// pos is where the piece stands, whatever the kit's own origin is.
export function Prop({ name, pos = [0, 0, 0], rot = 0, scale = 1, scaleY = 1, cast = true, anchor = 'center', receive = true, recolor }: PropProps) {
  const colors = recolor ?? PALETTE[name];
  const { scene } = useGLTF(furnitureUrl(name));
  const obj = useMemo(() => {
    const inner = scene.clone(true);
    inner.updateMatrixWorld(true);
    const box = new Box3().setFromObject(inner);
    const c = box.getCenter(new Vector3());
    const k = TILE * scale;
    inner.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      o.castShadow = cast; o.receiveShadow = receive;
      const mat = m.material as Material;
      if (mat.name === 'glass') { m.material = glassOf(mat); m.castShadow = false; return; }
      if (colors && !Array.isArray(mat) && colors[mat.name]) m.material = tinted(mat, colors[mat.name]);
    });
    inner.scale.set(k, k * scaleY, k);
    inner.position.set(-c.x * k, -box.min.y * k * scaleY, (anchor === 'back' ? -box.min.z : -c.z) * k);
    const g = new Group();
    g.add(inner);
    return g;
  }, [scene, scale, scaleY, cast, anchor, receive, colors]);
  return <group position={pos} rotation={[0, rot, 0]}><primitive object={obj} /></group>;
}

export const FURNITURE = [
  'desk', 'deskCorner', 'chairDesk', 'computerKeyboard', 'computerMouse', 'laptop', 'kitchenCoffeeMachine', 'kitchenFridge', 'kitchenFridgeSmall',
  'kitchenCabinet', 'kitchenSink', 'kitchenCabinetUpper', 'tableRound', 'loungeSofa', 'loungeSofaLong', 'loungeChair', 'loungeDesignSofa', 'bookcaseOpen', 'bookcaseClosedWide',
  'pottedPlant', 'plantSmall1', 'plantSmall2', 'rugRectangle', 'rugRound', 'lampSquareFloor', 'lampRoundFloor', 'wall', 'wallWindow', 'wallDoorway', 'wallCorner',
  'floorFull', 'trashcan', 'televisionModern', 'tableCoffee', 'books', 'coatRackStanding', 'chair', 'stoolBar', 'cabinetTelevision', 'radio', 'table', 'tableGlass', 'lampSquareTable', 'pillow',
];
export const preloadFurniture = () => FURNITURE.forEach((n) => useGLTF.preload(furnitureUrl(n)));
