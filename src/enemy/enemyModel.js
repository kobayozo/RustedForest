import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSword } from '../player/sword.js';

// KayKitのスケルトンはヘルメット等が別メッシュ(頭ボーンに追従しない)で、頭身を
// 縮める加工をすると頭とヘルメットが分離して見えるため断念。代わりにプレイヤーと
// 同じQuaternius素体(Superhero Male、リアル頭身)+Universal Animation Libraryを
// 敵にも使い回し、武器の有無とモーションだけで見た目を差別化する

export const WARRIOR_CLIP_MAP = {
  idle: 'Sword_Idle',
  walk: 'Walk_Loop',
  run: 'Sprint_Loop',
  attack: 'Sword_Attack',
  hit: 'Hit_Chest',
  death: 'Death01',
};

// 素手の雑魚。Punch_Crossは大きく振りかぶるため攻撃の予備動作が分かりやすい
export const MINION_CLIP_MAP = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  run: 'Sprint_Loop',
  attack: 'Punch_Cross',
  hit: 'Hit_Chest',
  death: 'Death01',
};

function findBone(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isBone && obj.name === name) found = obj;
  });
  return found;
}

export async function loadEnemyAnimationLibrary() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('/models/character/UAL1_Standard.glb');
  const clips = {};
  for (const clip of gltf.animations) clips[clip.name] = clip;
  return clips;
}

// armed=trueの場合、プレイヤーと同じ剣(createSword)をhand_rに装着する(警備兵用)
export async function loadEnemyMesh(armed) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('/models/character/Superhero_Male_FullBody.gltf');
  gltf.scene.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;
    }
  });

  if (armed) {
    const sword = createSword();
    // 実測し直し、回転なしで握りが手の中に自然に収まることを確認した
    sword.rotation.set(0, 0, 0);
    sword.position.set(0, -0.03, 0.06);
    const handR = findBone(gltf.scene, 'hand_r');
    if (handR) handR.add(sword);
  }

  return gltf.scene;
}

export function createEnemyMixer(meshScene) {
  return new THREE.AnimationMixer(meshScene);
}
