import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { stripRootMotion } from '../utils/animation.js';

// Pro Magic Pack … Mixamo 魔法モーション(idle/walk/詠唱/範囲など)
// RITUAL+WOMEN+500k.fbx … 調査の結果スケルトン無しの静的メッシュ(Deformer=0)。
//   自動スキニングは破綻するため public に配置のみ。素体は Mixamo 騎士 + 儀式風マテリアル。

export const MAGE_CLIP_MAP = {
  idle: 'mage_idle',
  walk: 'mage_walk',
  run: 'mage_run',
  attack: 'mage_attack',
  attack2: 'mage_attack2',
  cast: 'mage_cast',
  areaAttack: 'mage_area',
  hit: 'mage_hit',
  death: 'mage_death',
};

const MODEL_BASE = '/models/enemy/ritual-mage';
const BODY_PATH = '/models/medieval-knight/knight.fbx';
const TARGET_HEIGHT = 1.92;

const ANIM_PATHS = {
  mage_idle: `${MODEL_BASE}/anims/idle.fbx`,
  mage_walk: `${MODEL_BASE}/anims/walk.fbx`,
  mage_run: `${MODEL_BASE}/anims/run.fbx`,
  mage_attack: `${MODEL_BASE}/anims/attack1.fbx`,
  mage_attack2: `${MODEL_BASE}/anims/attack2.fbx`,
  mage_cast: `${MODEL_BASE}/anims/cast.fbx`,
  mage_area: `${MODEL_BASE}/anims/areaAttack.fbx`,
  mage_hit: `${MODEL_BASE}/anims/hit.fbx`,
  mage_death: `${MODEL_BASE}/anims/death.fbx`,
};

let preparePromise = null;

function findBone(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isBone && obj.name === name) found = obj;
  });
  return found;
}

function collectCanonicalBones(model) {
  const hips = model.children.find((c) => c.isBone && c.name === 'mixamorigHips')
    || findBone(model, 'mixamorigHips');
  if (!hips) return null;
  const boneMap = new Map();
  hips.traverse((obj) => {
    if (obj.isBone) boneMap.set(obj.name, obj);
  });
  return { hips, boneMap };
}

function rebindSkinnedMeshes(model, boneMap) {
  model.traverse((obj) => {
    if (!obj.isSkinnedMesh || !obj.skeleton) return;
    const bones = obj.skeleton.bones.map((b) => boneMap.get(b.name) || b);
    obj.bind(new THREE.Skeleton(bones, obj.skeleton.boneInverses));
    obj.bindMode = 'attached';
  });
}

function scaleModelToHeight(model, targetHeight) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 1e-3 ? targetHeight / size.y : 1;
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;
  return s;
}

function applyWitchMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;
    const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = srcMats.map((src) => {
      const name = (src?.name || obj.name || '').toLowerCase();
      const isSkin = /skin|face|body|head|eye/i.test(name);
      const isMetal = /armor|metal|iron|steel|helmet|plate/i.test(name);
      const mat = new THREE.MeshStandardMaterial({
        name: src?.name || 'witch',
        color: isSkin ? 0xd4a888 : isMetal ? 0x2c1f42 : 0x5c3d7a,
        map: null,
        roughness: isMetal ? 0.4 : isSkin ? 0.55 : 0.72,
        metalness: isMetal ? 0.7 : 0.05,
        emissive: new THREE.Color(isSkin ? 0x000000 : 0x3a1860),
        emissiveIntensity: isSkin ? 0 : 0.35,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        side: THREE.FrontSide,
      });
      if (!isSkin && !isMetal) {
        mat.color.set(0x6b3f96);
        mat.emissive.set(0x4a2080);
        mat.emissiveIntensity = 0.4;
      }
      return mat;
    });
    obj.material = next.length === 1 ? next[0] : next;
  });
}

async function loadClips(loader) {
  const clips = {};
  for (const [name, url] of Object.entries(ANIM_PATHS)) {
    const fbx = await loader.loadAsync(url);
    const src = fbx.animations.find((c) => c.tracks.length > 0) || fbx.animations[0];
    if (!src) continue;
    const clip = src.clone();
    clip.name = name;
    stripRootMotion(clip);
    clips[name] = clip;
  }
  return clips;
}

async function buildMage(loader) {
  const body = await loader.loadAsync(BODY_PATH);

  const canonical = collectCanonicalBones(body);
  if (canonical) rebindSkinnedMeshes(body, canonical.boneMap);
  // RitualWoman.fbx はスケルトン無しのため素体は Mixamo 騎士。儀式風の紫マテリアルを適用。
  // テクスチャ流用は UV 非互換のため行わない(アセットは public/models/enemy/ritual-mage/ に配置済み)
  applyWitchMaterials(body, null);
  scaleModelToHeight(body, TARGET_HEIGHT);

  const wrapper = new THREE.Group();
  wrapper.name = 'mageRoot';
  wrapper.add(body);
  return wrapper;
}

function ensurePrepared() {
  if (!preparePromise) {
    preparePromise = (async () => {
      const loader = new FBXLoader();
      const mesh = await buildMage(loader);
      const clips = await loadClips(loader);
      return { mesh, clips };
    })().catch((err) => {
      preparePromise = null;
      throw err;
    });
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
  // wrapper 直下の FBX ルートにミキサーを付け、Mixamo 骨へのバインドを確実にする
  const body = meshScene.children[0] || meshScene;
  return new THREE.AnimationMixer(body);
}
