import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// downloads: gwyn-lord-of-cinder (Gwyn.fbx + PBR PNG)

export const GWYN_CLIP_MAP = {
  idle: 'gwyn_action',
  walk: 'gwyn_action',
  run: 'gwyn_action',
  attack: 'gwyn_action',
  hit: 'gwyn_action',
  death: 'gwyn_action',
};

const GWYN_PATH = '/models/enemy/gwyn/Gwyn.fbx';
const TEX_BASE = '/models/enemy/gwyn/textures';
const TARGET_HEIGHT = 2.35;

function loadTex(url, colorSpace = null) {
  const tex = new THREE.TextureLoader().load(url);
  if (colorSpace) tex.colorSpace = colorSpace;
  tex.flipY = true; // FBX由来
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function pickMaps(key) {
  const base = `${TEX_BASE}/${key}`;
  return {
    map: loadTex(`${base}.png`, THREE.SRGBColorSpace),
    normalMap: loadTex(`${base}_n.png`),
    // _s はスペキュラ寄りなので roughness の目安に使う場合もあるが、まずは albedo/normal のみ
  };
}

function applyGwynTextures(root) {
  const skin = pickMaps('Skin');
  const hair = pickMaps('Hair');
  const crown = pickMaps('Crown');
  const sword = pickMaps('Sword');
  const accessories = pickMaps('Accessories');
  const clothing = pickMaps('Clothing');
  const clothingB = pickMaps('ClothingB');
  const clothingC = pickMaps('ClothingC');

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;
    if (obj.isSkinnedMesh) obj.bindMode = 'attached';

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((src) => {
      const n = `${src?.name || ''} ${obj.name || ''}`.toLowerCase();
      let maps = clothing;
      if (n.includes('skin')) maps = skin;
      else if (n.includes('hair')) maps = hair;
      else if (n.includes('crown')) maps = crown;
      else if (n.includes('sword') || n.includes('blade') || n.includes('handle')) maps = sword;
      else if (n.includes('access') || n.includes('anklet') || n.includes('armlet')) maps = accessories;
      else if (n.includes('robes_b') || n.includes('robes_c') || n.includes('clothingb')) maps = clothingB;
      else if (n.includes('robes_d') || n.includes('clothingc') || n.includes('feather')) maps = clothingC;
      else if (n.includes('armor') || n.includes('robe') || n.includes('sleeve') || n.includes('leg')) maps = clothing;

      return new THREE.MeshStandardMaterial({
        name: src?.name || obj.name || 'gwyn',
        map: maps.map,
        normalMap: maps.normalMap,
        color: 0xffffff,
        metalness: n.includes('sword') || n.includes('blade') || n.includes('armor') ? 0.55 : 0.08,
        roughness: n.includes('sword') || n.includes('blade') ? 0.35 : 0.75,
        envMapIntensity: 0.7,
        side: THREE.DoubleSide,
      });
    });
    obj.material = next.length === 1 ? next[0] : next;
  });
}

function scaleToHeight(model, targetHeight) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 1e-3) return;
  model.scale.setScalar(targetHeight / size.y);
  model.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(model);
  model.position.y -= grounded.min.y;
}

export async function loadGwynAnimationLibrary() {
  const fbx = await new FBXLoader().loadAsync(GWYN_PATH);
  const src = fbx.animations.find((c) => c.tracks.length > 0) || fbx.animations[0];
  if (!src) return {};
  const clip = src.clone();
  clip.name = 'gwyn_action';
  return { gwyn_action: clip };
}

export async function loadGwynMesh() {
  const fbx = await new FBXLoader().loadAsync(GWYN_PATH);
  applyGwynTextures(fbx);
  scaleToHeight(fbx, TARGET_HEIGHT);

  const wrapper = new THREE.Group();
  wrapper.name = 'gwynRoot';
  wrapper.add(fbx);
  return wrapper;
}

export function createGwynMixer(meshScene) {
  return new THREE.AnimationMixer(meshScene);
}
