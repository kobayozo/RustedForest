import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

function loadScene(path) {
  if (!cache.has(path)) {
    cache.set(path, loader.loadAsync(path).then((gltf) => gltf.scene));
  }
  return cache.get(path);
}

// 同じモデルを複数配置するため、ロード済みシーンをクローンして使う
export async function instantiate(path) {
  const original = await loadScene(path);
  const clone = original.clone(true);
  clone.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return clone;
}
