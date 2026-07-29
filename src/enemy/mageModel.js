import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Quaternius Ultimate Animated Character Pack - Wizard (CC0).
// FBXLoader is not safe under heavy parallel loads, so main.js loads this pack
// after the other assets finish.

export const MAGE_CLIP_MAP = {
  idle: 'CharacterArmature|Idle',
  walk: 'CharacterArmature|Walk',
  run: 'CharacterArmature|Walk',
  attack: 'CharacterArmature|Shoot_OneHanded',
  hit: 'CharacterArmature|RecieveHit',
  death: 'CharacterArmature|Defeat',
};

const WIZARD_PATH = '/models/enemy/wizard/Wizard.fbx';
const TARGET_HEIGHT = 2.05;

let preparePromise = null;

function rebuildOpaqueMaterials(root) {
  // FBX 経由の Phong は opacity=0 や極端に暗い Kd になりやすいので、
  // 不透明な Standard マテリアルへ差し替えて確実に見えるようにする。
  const palette = {
    skin: 0xc48a6a,
    face: 0xf0c8a8,
    clothes: 0x3a6aad,
    belt: 0x6a3d18,
    gold: 0xd4a24a,
    hat: 0x243a58,
    hair: 0xb0b0b0,
  };

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;
    if (obj.isSkinnedMesh) obj.bindMode = 'attached';

    const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = srcMats.map((src) => {
      const key = Object.keys(palette).find((k) => (src?.name || '').toLowerCase().includes(k));
      const color = key ? palette[key] : (src?.color ? src.color.getHex() : 0x888888);
      return new THREE.MeshStandardMaterial({
        name: src?.name || 'wizard',
        color,
        roughness: 0.7,
        metalness: key === 'gold' ? 0.55 : 0.05,
      });
    });
    obj.material = next.length === 1 ? next[0] : next;
  });
}

function prepareVisual(model) {
  rebuildOpaqueMaterials(model);

  // スキン済みFBX自体を scale すると形状が壊れるため、親グループでだけ縮尺する
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 1e-3 ? TARGET_HEIGHT / size.y : 1;

  const inner = new THREE.Group();
  inner.name = 'wizardScaled';
  inner.add(model);
  inner.scale.setScalar(s);
  inner.position.y = -box.min.y * s;

  const wrapper = new THREE.Group();
  wrapper.name = 'wizardRoot';
  wrapper.add(inner);
  return wrapper;
}

function ensurePrepared() {
  if (!preparePromise) {
    preparePromise = (async () => {
      const fbx = await new FBXLoader().loadAsync(WIZARD_PATH);
      const clips = {};
      for (const clip of fbx.animations) clips[clip.name] = clip;
      const mesh = prepareVisual(fbx);
      return { mesh, clips };
    })();
  }
  return preparePromise;
}

export async function loadMageAnimationLibrary() {
  const { clips } = await ensurePrepared();
  return clips;
}

export async function loadMageMesh() {
  const { mesh } = await ensurePrepared();
  return mesh;
}

export function createMageMixer(meshScene) {
  return new THREE.AnimationMixer(meshScene);
}
