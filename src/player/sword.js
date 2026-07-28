import * as THREE from 'three';
import { loadLeatherTextures } from '../render/textures.js';

// 平らな板ではなく、鍔元から切っ先に向けてすぼまる刀身形状(菱形断面の簡易表現)を
// Shape + ExtrudeGeometryで作る。テクスチャ画像は使わず、PBRの金属反射(高metalness/
// 低roughness)だけで「磨かれた鋼」の質感を出す
function createBladeGeometry(length, width, thickness) {
  const halfW = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(-halfW * 0.6, length * 0.82);
  shape.lineTo(0, length);
  shape.lineTo(halfW * 0.6, length * 0.82);
  shape.lineTo(halfW, 0);
  shape.lineTo(-halfW, 0);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: width * 0.12,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

export function createSword() {
  const sword = new THREE.Group();
  sword.name = 'sword';

  const leather = loadLeatherTextures();
  const gripMat = new THREE.MeshStandardMaterial({
    map: leather.map,
    normalMap: leather.normalMap,
    roughnessMap: leather.roughnessMap,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xc7ccd1,
    metalness: 0.95,
    roughness: 0.22,
  });
  const bronzeMat = new THREE.MeshStandardMaterial({
    color: 0x6b5636,
    metalness: 0.85,
    roughness: 0.35,
  });

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.14, 10), gripMat);
  grip.position.y = 0.07;

  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), bronzeMat);
  pommel.position.y = -0.005;

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.026), bronzeMat);
  guard.position.y = 0.145;

  const blade = new THREE.Mesh(createBladeGeometry(0.62, 0.038, 0.009), steelMat);
  blade.position.y = 0.145;

  sword.add(pommel, grip, guard, blade);
  sword.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
    }
  });
  return sword;
}
