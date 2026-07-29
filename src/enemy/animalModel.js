import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// Gobkit Free Animal Pack (CC0)。1本のマスタータイムラインをフレーム範囲で切り出す。
export const ANIMAL_CLIP_MAP = {
  idle: 'animal_idle',
  walk: 'animal_walk',
  run: 'animal_walk',
  attack: 'animal_attack',
  death: 'animal_death',
};

const FPS = 24;
const FRAME_RANGES = {
  animal_idle: { from: 0, to: 29 },
  animal_attack: { from: 30, to: 59 },
  animal_death: { from: 60, to: 89 },
  animal_walk: { from: 90, to: 119 },
};

const cache = new Map();

function loadSource(path) {
  if (!cache.has(path)) {
    cache.set(path, new GLTFLoader().loadAsync(path));
  }
  return cache.get(path);
}

function trimClips(gltf) {
  const master = gltf.animations[0];
  if (!master) return {};
  const clips = {};
  for (const [name, range] of Object.entries(FRAME_RANGES)) {
    clips[name] = THREE.AnimationUtils.subclip(
      master,
      name,
      range.from,
      range.to + 1,
      FPS,
    );
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

export async function loadAnimalAnimationLibrary(path) {
  const gltf = await loadSource(path);
  return trimClips(gltf);
}

export async function loadAnimalMesh(path, targetHeight = 1.4) {
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
  wrapper.name = 'animalRoot';
  wrapper.add(model);
  return wrapper;
}

export function createAnimalMixer(meshScene) {
  return new THREE.AnimationMixer(meshScene);
}
