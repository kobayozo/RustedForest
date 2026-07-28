import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSword } from './sword.js';

// Quaternius製CC0アセット(Universal Base Characters: Superhero Male、リアル頭身+PBR
// テクスチャ)の素体のみを使用する。衣装パーツ(Peasant/Ranger)は体型が完全一致せず
// クリッピングが残る上、装備ごとに別スケルトンとなり武器の装着位置もずれるため、
// 素体1体構成(裸)に統一した。アニメーションはUniversal Animation Libraryを使い回す

export const CHARACTER_CLIPS = {
  idle: 'Sword_Idle',
  walk: 'Walk_Loop',
  run: 'Sprint_Loop',
  roll: 'Roll',
  attack: 'Sword_Attack',
  hit: 'Hit_Chest',
  dead: 'Death01',
};

const PART_PATHS = {
  base: '/models/character/Superhero_Male_FullBody.gltf',
};

function fixMaterials(root) {
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;
    }
  });
}

function findBone(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isBone && obj.name === name) found = obj;
  });
  return found;
}

async function loadPart(loader, path) {
  const gltf = await loader.loadAsync(path);
  fixMaterials(gltf.scene);
  return gltf;
}

export async function loadCharacterModel() {
  const loader = new GLTFLoader();

  const entries = Object.entries(PART_PATHS);
  const [parts, animLib] = await Promise.all([
    Promise.all(entries.map(([, path]) => loadPart(loader, path))),
    loader.loadAsync('/models/character/UAL1_Standard.glb'),
  ]);

  const partsByName = {};
  entries.forEach(([key], i) => {
    partsByName[key] = parts[i];
  });

  const root = new THREE.Group();
  root.name = 'character';
  const mixers = [];
  for (const gltf of parts) {
    root.add(gltf.scene);
    mixers.push(new THREE.AnimationMixer(gltf.scene));
  }

  const clipByName = {};
  for (const clip of animLib.animations) {
    clipByName[clip.name] = clip;
  }

  const sword = createSword();
  // 素体化(base単体)にしたことでhand_rが1つのスケルトンに一本化されたため、
  // 改めて複数姿勢(待機/歩行/走行/攻撃)でスクリーンショット比較して調整した。
  // 剣先を体に沿わせず前方へ傾けて構える角度にしている
  sword.rotation.set(-Math.PI / 4, 0, -Math.PI / 2);
  sword.position.set(0, -0.03, 0.06);
  const handR = findBone(partsByName.base.scene, 'hand_r');
  if (handR) handR.add(sword);

  return { root, mixers, clips: clipByName };
}
