import * as THREE from 'three';
import { instantiate } from './assetLoader.js';
import { getHeightAt, TERRAIN_SIZE, CASTLE_ANCHOR, POND_ANCHOR } from './terrain.js';

function createRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Poly Havenの実写スキャン木(CC0)のみを使う。フォトグラメトリ品質の木は
// 1本が数百万ポリゴンあるため、低ポリのスタイライズ木とは混在させず、
// 本数を絞って(1本あたり約40万ポリゴン)配置する
const REALISTIC_TREE_MODEL = '/models/nature/pine_sapling_small/pine_sapling_small_1k.gltf';

function tooCloseToAnchor(x, z) {
  const dCastle = Math.hypot(x - CASTLE_ANCHOR.x, z - CASTLE_ANCHOR.z);
  const dPond = Math.hypot(x - POND_ANCHOR.x, z - POND_ANCHOR.z);
  return dCastle < CASTLE_ANCHOR.radius + 3 || dPond < POND_ANCHOR.radius + 3;
}

export async function createForest(count = 4) {
  const group = new THREE.Group();
  group.name = 'forest';

  const rand = createRng(9001);
  const half = TERRAIN_SIZE / 2 - 4;

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 10) {
    attempts++;
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    if (Math.hypot(x, z) < 6) continue; // スポーン地点付近は開けておく
    if (tooCloseToAnchor(x, z)) continue;

    // eslint-disable-next-line no-await-in-loop
    const tree = await instantiate(REALISTIC_TREE_MODEL);
    tree.position.set(x, getHeightAt(x, z), z);
    tree.rotation.y = rand() * Math.PI * 2;
    const scale = 1.2 + rand() * 0.7;
    tree.scale.setScalar(scale);
    // 1本あたり約40万ポリゴンあり、影生成コストが非常に高い
    // (ライトのシャドウ範囲が地形全体をカバーするため画面外でも毎フレーム計算される)。
    // 本数を絞った上で影も落とさないようにして負荷を抑える
    tree.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    group.add(tree);
    placed++;
  }

  return group;
}
