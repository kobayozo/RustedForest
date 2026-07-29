import * as THREE from 'three';
import { instantiate } from './assetLoader.js';
import { CASTLE_ANCHOR } from './terrain.js';
import { loadCastleTextures } from '../render/textures.js';
import { createTriplanarMaterial } from '../render/triplanar.js';

const RING_HALF = 11; // 城の範囲を広く
const MODULE = 1;
const WALL_THICKNESS = 0.55;
const WALL_HEIGHT = 1.3; // wall.glb の高さ目安
const WALL_LEVELS = 3; // 上まで囲う（壁を積み上げ）
const GATE_HALF_WIDTH = 1; // 入口を大きく（中央と左右1マスを空ける → 幅3）

// Kenneyのモデルはトリムシート用の細長いUVのため、通常のmap貼り付けだと
// テクスチャが縞状に歪む。ワールド座標から投影するトライプラナーマテリアル
// (1つ生成して共有)に差し替える。旗(布)だけは対象外にする
function applyStoneTexture(obj, stoneMaterial) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (/flag/i.test(o.name)) return;
    o.material = stoneMaterial;
  });
}

function addBoxCollider(colliders, cx, cz, halfX, halfZ) {
  colliders.push({
    minX: cx - halfX,
    maxX: cx + halfX,
    minZ: cz - halfZ,
    maxZ: cz + halfZ,
  });
}

// rotY=0 は東西に長い壁(南北辺)、rotY=±PI/2 は南北に長い壁(東西辺)
function addWallCollider(colliders, x, z, rotY) {
  const alongX = Math.abs(Math.sin(rotY)) < 0.1;
  if (alongX) {
    addBoxCollider(colliders, x, z, MODULE * 0.5, WALL_THICKNESS * 0.5);
  } else {
    addBoxCollider(colliders, x, z, WALL_THICKNESS * 0.5, MODULE * 0.5);
  }
}

function isGateSlot(i) {
  return Math.abs(i) <= GATE_HALF_WIDTH;
}

export async function createCastle() {
  const group = new THREE.Group();
  group.name = 'castle';
  const colliders = [];
  const castleTextures = loadCastleTextures();
  const stoneMaterial = createTriplanarMaterial({
    map: castleTextures.map,
    roughnessMap: castleTextures.roughnessMap,
    scale: 0.5,
  });

  const baseY = CASTLE_ANCHOR.height;
  const { x: cx, z: cz } = CASTLE_ANCHOR;

  const [base, mid, roof, flag] = await Promise.all([
    instantiate('/models/castle/tower-square-base.glb'),
    instantiate('/models/castle/tower-square-mid.glb'),
    instantiate('/models/castle/tower-square-top-roof.glb'),
    instantiate('/models/castle/flag-banner-long.glb'),
  ]);
  [base, mid, roof, flag].forEach((o) => applyStoneTexture(o, stoneMaterial));
  base.position.set(cx, baseY, cz);
  mid.position.set(cx, baseY + 1.0, cz);
  roof.position.set(cx, baseY + 2.0, cz);
  flag.position.set(cx, baseY + 3.0, cz);
  group.add(base, mid, roof, flag);
  // 中央塔の簡易コリジョン
  addBoxCollider(colliders, cx, cz, 0.7, 0.7);

  const corners = [
    { x: -RING_HALF, z: -RING_HALF, rot: 0 },
    { x: RING_HALF, z: -RING_HALF, rot: -Math.PI / 2 },
    { x: RING_HALF, z: RING_HALF, rot: Math.PI },
    { x: -RING_HALF, z: RING_HALF, rot: Math.PI / 2 },
  ];
  for (let level = 0; level < WALL_LEVELS; level++) {
    const y = baseY + level * WALL_HEIGHT;
    for (const c of corners) {
      const corner = await instantiate('/models/castle/wall-corner.glb');
      applyStoneTexture(corner, stoneMaterial);
      corner.position.set(cx + c.x, y, cz + c.z);
      corner.rotation.y = c.rot;
      group.add(corner);
      if (level === 0) {
        addBoxCollider(colliders, cx + c.x, cz + c.z, MODULE * 0.55, MODULE * 0.55);
      }
    }
  }

  // 辺の壁を積み上げて上まで囲う。南側中央は大きく空けて門を置く
  for (let level = 0; level < WALL_LEVELS; level++) {
    const y = baseY + level * WALL_HEIGHT;
    for (let i = -RING_HALF + 1; i <= RING_HALF - 1; i++) {
      const north = await instantiate('/models/castle/wall.glb');
      applyStoneTexture(north, stoneMaterial);
      north.position.set(cx + i, y, cz - RING_HALF);
      group.add(north);
      if (level === 0) addWallCollider(colliders, cx + i, cz - RING_HALF, 0);

      if (!isGateSlot(i)) {
        const south = await instantiate('/models/castle/wall.glb');
        applyStoneTexture(south, stoneMaterial);
        south.position.set(cx + i, y, cz + RING_HALF);
        group.add(south);
        if (level === 0) addWallCollider(colliders, cx + i, cz + RING_HALF, 0);
      }

      const west = await instantiate('/models/castle/wall.glb');
      applyStoneTexture(west, stoneMaterial);
      west.position.set(cx - RING_HALF, y, cz + i);
      west.rotation.y = Math.PI / 2;
      group.add(west);
      if (level === 0) addWallCollider(colliders, cx - RING_HALF, cz + i, Math.PI / 2);

      const east = await instantiate('/models/castle/wall.glb');
      applyStoneTexture(east, stoneMaterial);
      east.position.set(cx + RING_HALF, y, cz + i);
      east.rotation.y = Math.PI / 2;
      group.add(east);
      if (level === 0) addWallCollider(colliders, cx + RING_HALF, cz + i, Math.PI / 2);
    }
  }

  // 大きな門（横に広げて入口を強調）
  const gate = await instantiate('/models/castle/gate.glb');
  applyStoneTexture(gate, stoneMaterial);
  gate.position.set(cx, baseY, cz + RING_HALF);
  gate.scale.set(GATE_HALF_WIDTH * 2 + 1, 1.8, 1);
  group.add(gate);

  return { group, colliders };
}
