import * as THREE from 'three';
import { getHeightAt, TERRAIN_SIZE } from './terrain.js';
import { loadRockTextures } from '../render/textures.js';

// 決定論的な疑似乱数(同じシードなら毎回同じ配置になる)
function createRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function createRocks(clusterCount = 9, perClusterRange = [2, 4]) {
  const geometry = new THREE.IcosahedronGeometry(0.25, 1);
  const { map, normalMap, roughnessMap } = loadRockTextures();
  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    flatShading: true,
  });

  const rand = createRng(4242);
  const half = TERRAIN_SIZE / 2 - 3;

  // 先にクラスタごとの個数を決めて総数を確定させる
  const layout = [];
  for (let c = 0; c < clusterCount; c++) {
    const cx = (rand() * 2 - 1) * half;
    const cz = (rand() * 2 - 1) * half;
    const n = perClusterRange[0] + Math.floor(rand() * (perClusterRange[1] - perClusterRange[0] + 1));
    for (let i = 0; i < n; i++) {
      layout.push({
        x: cx + (rand() * 2 - 1) * 1.2,
        z: cz + (rand() * 2 - 1) * 1.2,
      });
    }
  }

  const mesh = new THREE.InstancedMesh(geometry, material, layout.length);
  mesh.name = 'rocks';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  layout.forEach((p, i) => {
    dummy.position.set(p.x, getHeightAt(p.x, p.z), p.z);
    dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    const scale = 0.4 + rand() * 1.4;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const shade = 0.8 + rand() * 0.35;
    color.setRGB(shade, shade * 0.97, shade * 0.93);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
