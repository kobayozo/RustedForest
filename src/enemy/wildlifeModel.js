import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// Quaternius "Ultimate Animated Animal Pack" (CC0, poly.pizzaミラー経由で取得)。
// Gobkitの簡易チビキャラ動物と違い、種ごとに1 GLBへ全モーションが名前付きクリップとして
// 入っている(Idle/Walk/Gallop/Attack系/Death等)。フレーム範囲の切り出しは不要で、
// クリップ名をそのまま拾えばよい。犬科(Attack)と有蹄類(Attack_Headbutt/Attack_Kick)で
// 攻撃クリップ名が違うため、presetごとに実クリップ名を渡してAnimalAI共通の
// 状態キー(idle/walk/run/attack/death)へ詰め替える
export const WILDLIFE_CLIP_MAP = {
  idle: 'idle',
  walk: 'walk',
  run: 'run',
  attack: 'attack',
  death: 'death',
};

const cache = new Map();

function loadSource(path) {
  if (!cache.has(path)) {
    cache.set(path, new GLTFLoader().loadAsync(path));
  }
  return cache.get(path);
}

// 素のクリップ名("Walk"等)と骨パス付き重複("AnimalArmature|Walk")の両方が
// 入っているため、パイプを含まない方を採用する
function pickClip(gltf, name) {
  return gltf.animations.find((c) => c.name === name && !c.name.includes('|')) || null;
}

export async function loadWildlifeAnimationLibrary(path, attackClipName = 'Attack') {
  const gltf = await loadSource(path);
  const src = {
    idle: pickClip(gltf, 'Idle'),
    walk: pickClip(gltf, 'Walk'),
    run: pickClip(gltf, 'Gallop'),
    attack: pickClip(gltf, attackClipName),
    death: pickClip(gltf, 'Death'),
  };
  const clips = {};
  for (const [state, clip] of Object.entries(src)) {
    if (clip) clips[state] = clip;
  }
  return clips;
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

export async function loadWildlifeMesh(path, targetHeight = 1.2) {
  const gltf = await loadSource(path);
  const model = SkeletonUtils.clone(gltf.scene);
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;
  });
  scaleToHeight(model, targetHeight);

  const wrapper = new THREE.Group();
  wrapper.name = 'wildlifeRoot';
  wrapper.add(model);
  return wrapper;
}

export function createWildlifeMixer(meshScene) {
  return new THREE.AnimationMixer(meshScene);
}
