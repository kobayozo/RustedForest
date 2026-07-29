import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSword } from './sword.js';
import { createRollClip, ROLL_CLIP_NAME } from './proceduralAnimations.js';

// CGTrader「Solus - The Knight」(Royalty Free、商用利用可)。リアル頭身のゴシック
// プレートアーマー一式で、指1本ずつ・表情筋まで含む精密なリグと21種のアニメーションを
// 内蔵する。武器は同梱されていないため、既存の自作剣(createSword)を装着する。
// ロール専用のモーションは収録されていないため、Rig_Hipsを軸に前転する自作モーション
// (proceduralAnimations.js)を生成して補う

export const CHARACTER_CLIPS = {
  idle: 'knight_idle',
  walk: 'knight_walk_in_place',
  run: 'knight_run_heavy_weapon_in_place',
  roll: ROLL_CLIP_NAME,
  attack: 'knight_shield_attack',
  hit: 'knight_hurt_left',
  dead: 'knight_front_attacked_fall',
};

const ROLL_DURATION = 0.8; // playerController.jsのROLL_RECOVERY_CUTと合わせて調整

const MODEL_PATH = '/models/knight/Solus_Knight.gltf';

// 素材の金/褐色トーンを鼠色(グレー)系に染め直す。テクスチャの明暗パターン
// (彫刻等)自体はcolor(乗算ティント)を変えるだけでは消えないため活かしつつ、
// 色味だけをニュートラルなグレーに寄せる
const ARMOR_TINT = new THREE.Color(0xc4c4c8);
const LEATHER_TINT = new THREE.Color(0x8d8d90);

// 剣を「腰の鞘」と「右手」のどちらに装着するかで、それぞれ別のローカル座標を使う。
// hand_rは待機/歩行/走行/攻撃で手首の向きが大きく変わるため、固定オフセットで
// 追従させると走行中などに剣が体の中に埋まったり、カメラから見て消えたりする
// (実際にスクリーンショットで確認した不具合)。Rig_Hipsはほぼ姿勢が変わらないため、
// 移動中は鞘に収めて安定させ、攻撃の瞬間だけ手に持たせる方式にした
const SHEATH_TRANSFORM = {
  // 剣先が膝まではみ出ていた(-0.35の位置+角度が浅く長く垂れ下がって見えた)ため、
  // 位置を上げつつ角度も付けて、剣先が太もも中程で収まるよう再調整した
  position: new THREE.Vector3(0.2, -0.18, -0.15),
  rotation: new THREE.Euler(Math.PI / 2, Math.PI / 8, Math.PI / 3),
};
const HAND_TRANSFORM = {
  position: new THREE.Vector3(-0.03, -0.03, 0.06),
  rotation: new THREE.Euler(0, 0, 0),
};

function fixMaterials(root) {
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;

      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        if (!material || !material.color) continue;
        if (material.map) {
          material.color.copy(ARMOR_TINT);
        } else if (material.metalness > 0.5) {
          material.color.copy(LEATHER_TINT);
        }
      }
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

export async function loadCharacterModel() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MODEL_PATH);
  fixMaterials(gltf.scene);

  const root = new THREE.Group();
  root.name = 'character';
  root.add(gltf.scene);
  const mixers = [new THREE.AnimationMixer(gltf.scene)];

  const clipByName = {};
  for (const clip of gltf.animations) {
    clipByName[clip.name] = clip;
  }

  const sword = createSword();
  const handBone = findBone(gltf.scene, 'Rig_hand_R');
  const hipBone = findBone(gltf.scene, 'Rig_Hips');

  // 既定は鞘(腰)に収めた状態。CharacterAnimatorが攻撃開始/終了に合わせて
  // hand/sheath間で付け替える
  if (hipBone) {
    sword.position.copy(SHEATH_TRANSFORM.position);
    sword.rotation.copy(SHEATH_TRANSFORM.rotation);
    hipBone.add(sword);
  }

  if (hipBone) {
    const rollClip = createRollClip(hipBone, ROLL_DURATION);
    clipByName[rollClip.name] = rollClip;
  }

  const swordRig = {
    sword,
    hipBone,
    handBone,
    sheathTransform: SHEATH_TRANSFORM,
    handTransform: HAND_TRANSFORM,
  };

  return { root, mixers, clips: clipByName, swordRig };
}
