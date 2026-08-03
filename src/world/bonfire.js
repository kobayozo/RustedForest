import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getHeightAt } from './terrain.js';

const CAMPFIRE_PATH = '/models/props/bonfire/campfire.glb';
const TARGET_HEIGHT = 1.15;

let prototypePromise = null;

async function loadCampfirePrototype() {
  if (!prototypePromise) {
    prototypePromise = new GLTFLoader().loadAsync(CAMPFIRE_PATH).then((gltf) => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 1e-3) model.scale.setScalar(TARGET_HEIGHT / size.y);
      model.updateMatrixWorld(true);
      const grounded = new THREE.Box3().setFromObject(model);
      model.position.y -= grounded.min.y;
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) continue;
          // 炎メッシュは発光を強める
          const n = `${mat.name || ''} ${obj.name || ''}`.toLowerCase();
          if (n.includes('fire') || n.includes('flame') || n.includes('glow')) {
            mat.emissive = new THREE.Color(0xff5500);
            mat.emissiveIntensity = 1.6;
            mat.transparent = true;
            mat.depthWrite = false;
          }
        }
      });
      return model;
    });
  }
  return prototypePromise;
}

function makeFallbackPit() {
  const g = new THREE.Group();
  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.25, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.95 }),
  );
  pit.position.y = 0.12;
  pit.receiveShadow = true;
  g.add(pit);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.85, 7),
    new THREE.MeshStandardMaterial({
      color: 0xff6a20,
      emissive: 0xff4400,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.9,
    }),
  );
  flame.position.y = 0.75;
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

/**
 * かがり火（休息ポイント）。Quaternius系キャンプファイアGLBを使用。
 */
export async function createBonfires(positions) {
  const group = new THREE.Group();
  group.name = 'bonfires';
  const sites = [];

  let proto = null;
  try {
    proto = await loadCampfirePrototype();
  } catch (err) {
    console.warn('[bonfire] campfire.glb load failed, using fallback', err);
  }

  for (const pos of positions) {
    const site = new THREE.Group();
    site.name = 'bonfire';
    const y = getHeightAt(pos.x, pos.z);

    if (proto) {
      const model = SkeletonUtils.clone(proto);
      site.add(model);
      site.userData.model = model;

      // GLBに炎パーツが無い場合もあるので、揺らめく炎コーンを重ねる
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.7, 6),
        new THREE.MeshStandardMaterial({
          color: 0xff6a20,
          emissive: 0xff4400,
          emissiveIntensity: 1.8,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      );
      flame.position.set(0, 0.85, 0);
      site.add(flame);
      site.userData.flame = flame;
    } else {
      const fallback = makeFallbackPit();
      site.add(fallback);
      site.userData.flame = fallback.userData.flame;
    }

    const light = new THREE.PointLight(0xff8833, 1.6, 12, 2);
    light.position.set(0, 1.35, 0);
    site.add(light);
    site.userData.light = light;

    site.position.set(pos.x, y, pos.z);
    site.userData.restRadius = 2.2;
    group.add(site);
    sites.push(site);
  }

  group.userData.sites = sites;
  group.userData.update = (t) => {
    for (const site of sites) {
      const flame = site.userData.flame;
      const light = site.userData.light;
      const flicker = 1 + Math.sin(t * 9 + site.position.x) * 0.12;
      if (flame) {
        flame.scale.set(flicker, 1 + Math.sin(t * 11) * 0.14, flicker);
      }
      if (light) {
        light.intensity = 1.35 + Math.sin(t * 13 + site.position.z) * 0.35;
      }
    }
  };

  return group;
}

export function findNearbyBonfire(bonfires, position, maxDist = 2.2) {
  if (!bonfires?.userData?.sites) return null;
  let best = null;
  let bestD = maxDist;
  for (const site of bonfires.userData.sites) {
    const d = site.position.distanceTo(position);
    if (d < bestD) {
      bestD = d;
      best = site;
    }
  }
  return best;
}
