import * as THREE from 'three';
import { instantiate } from './assetLoader.js';
import { CASTLE_ANCHOR } from './terrain.js';
import { loadCastleTextures } from '../render/textures.js';
import { createTriplanarMaterial } from '../render/triplanar.js';

const RING_HALF = 4; // 中心から壁までの距離(モジュール単位)。8x8の正方形リングになる

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

export async function createCastle() {
  const group = new THREE.Group();
  group.name = 'castle';
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

  const corners = [
    { x: -RING_HALF, z: -RING_HALF, rot: 0 },
    { x: RING_HALF, z: -RING_HALF, rot: -Math.PI / 2 },
    { x: RING_HALF, z: RING_HALF, rot: Math.PI },
    { x: -RING_HALF, z: RING_HALF, rot: Math.PI / 2 },
  ];
  for (const c of corners) {
    const corner = await instantiate('/models/castle/wall-corner.glb');
    applyStoneTexture(corner, stoneMaterial);
    corner.position.set(cx + c.x, baseY, cz + c.z);
    corner.rotation.y = c.rot;
    group.add(corner);
  }

  // 辺の壁。南側(z = +RING_HALF)は中央1マスを空けて入口にする
  for (let i = -RING_HALF + 1; i <= RING_HALF - 1; i++) {
    const north = await instantiate('/models/castle/wall.glb');
    applyStoneTexture(north, stoneMaterial);
    north.position.set(cx + i, baseY, cz - RING_HALF);
    group.add(north);

    if (i !== 0) {
      const south = await instantiate('/models/castle/wall.glb');
      applyStoneTexture(south, stoneMaterial);
      south.position.set(cx + i, baseY, cz + RING_HALF);
      group.add(south);
    }

    const west = await instantiate('/models/castle/wall.glb');
    applyStoneTexture(west, stoneMaterial);
    west.position.set(cx - RING_HALF, baseY, cz + i);
    west.rotation.y = Math.PI / 2;
    group.add(west);

    const east = await instantiate('/models/castle/wall.glb');
    applyStoneTexture(east, stoneMaterial);
    east.position.set(cx + RING_HALF, baseY, cz + i);
    east.rotation.y = Math.PI / 2;
    group.add(east);
  }

  const doorway = await instantiate('/models/castle/door.glb');
  applyStoneTexture(doorway, stoneMaterial);
  doorway.position.set(cx, baseY, cz + RING_HALF);
  group.add(doorway);

  return group;
}
