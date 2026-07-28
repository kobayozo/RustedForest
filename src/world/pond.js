import * as THREE from 'three';
import { instantiate } from './assetLoader.js';
import { POND_ANCHOR } from './terrain.js';

function createRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export async function createPond() {
  const group = new THREE.Group();
  group.name = 'pond';

  const { x: cx, z: cz, radius, height } = POND_ANCHOR;
  const waterRadius = radius * 0.6;

  const waterGeo = new THREE.CircleGeometry(waterRadius, 48);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2f5f6b,
    transparent: true,
    opacity: 0.85,
    roughness: 0.12,
    metalness: 0.05,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.set(cx, height + 0.05, cz);
  water.name = 'pondWater';
  group.add(water);

  const rand = createRng(555);
  const lilyModels = ['/models/nature/lily_large.glb', '/models/nature/lily_small.glb'];
  for (let i = 0; i < 10; i++) {
    const angle = rand() * Math.PI * 2;
    const r = waterRadius * (0.25 + rand() * 0.65);
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    // eslint-disable-next-line no-await-in-loop
    const lily = await instantiate(lilyModels[Math.floor(rand() * lilyModels.length)]);
    lily.position.set(x, height + 0.06, z);
    lily.rotation.y = rand() * Math.PI * 2;
    group.add(lily);
  }

  return { group, water };
}
