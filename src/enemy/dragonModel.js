import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getRootMotionRef, pinRootMotion, getRootRotationMap, pinRootRotation } from '../utils/animation.js';

// downloads の Tarisland Dragon (高ポリGLB)。アニメは絶対時刻レンジ付きのため subclip する。

export const DRAGON_CLIP_MAP = {
  idle: 'dragon_idle',
  walk: 'dragon_walk',
  run: 'dragon_walk',
  attack: 'dragon_attack',
  attack2: 'dragon_attack2',
  attackSwipe: 'dragon_skill_swipe',
  attackSlam: 'dragon_skill_slam',
  attackTail: 'dragon_tail_breath',
  attackRoar: 'dragon_skill_roar',
  hit: 'dragon_hit',
  death: 'dragon_death',
  fly: 'dragon_fly',
  enrage: 'dragon_enrage',
};

const DRAGON_PATH = '/models/enemy/dragon/dragon.glb';
const TEX_BASE = '/models/enemy/dragon';
const TARGET_HEIGHT = 6.5;

// 各ソースクリップはフルタイムラインを持ち、実際のアクションは末尾付近にある
const CLIP_RANGES = {
  dragon_attack: { source: 'Qishilong_attack01', start: 0, end: 6.4 },
  dragon_attack2: { source: 'Qishilong_attack02', start: 6.4, end: 12.933 },
  // skill05は途中(80.2s〜)で前脚が浮くため tailSwing では使わない。
  // クリップ自体は残すが再生しない(他用途向けの切り出しのみ)。
  dragon_skill_swipe: { source: 'Qishilong_skill05', start: 79.033, end: 80.0 },
  // フェーズ2移行の咆哮。前足接地のまま頭を反らして口を全開にする(skill06系列とは別枝)
  dragon_enrage: { source: 'Qishilong_skill02', start: 73.3, end: 79.033 },
  dragon_skill_slam: { source: 'Qishilong_skill06', start: 81.9, end: 87.533 },
  // skill07の全体(93.167-96.333)は後半で後ろ足二本立ちに変化してしまうため、
  // 前足が接地したまま口を開く冒頭部分だけを切り出す(スクリーンショットで確認済み)
  dragon_skill_roar: { source: 'Qishilong_skill07', start: 93.167, end: 93.75 },
  // skill09(旧: 尻尾攻撃用に転用していたクリップ)は再生後半で浮遊するように見えるため、
  // 代わりにenrageと同じskill02(前足接地のまま頭を反らす咆哮)の後半だけを短く切り出す。
  // enrage(73.3-79.033の全体)より短く、頭を反らし始めた辺りから使うことで演出に差をつける
  dragon_tail_breath: { source: 'Qishilong_skill02', start: 76.0, end: 79.033 },
  dragon_hit: { source: 'Qishilong_down', start: 26.1, end: 27.9 },
  dragon_death: { source: 'Qishilong_die', start: 18.67, end: 26.07 },
  dragon_idle: { source: 'Qishilong_stand', start: 118.03, end: 121.37 },
  dragon_walk: { source: 'Qishilong_walk', start: 134.1, end: 135.83 },
  // エンカウント演出用の飛行ループ(未使用だった長尺クリップ)
  dragon_fly: { source: 'Qishilong_fly2', start: 31.567, end: 68.233 },
};

let sourcePromise = null;

function loadDragonSource() {
  if (!sourcePromise) {
    sourcePromise = new GLTFLoader().loadAsync(DRAGON_PATH);
  }
  return sourcePromise;
}

function loadTexture(url, colorSpace = null) {
  const tex = new THREE.TextureLoader().load(url);
  if (colorSpace) tex.colorSpace = colorSpace;
  tex.flipY = false;
  return tex;
}

function applyDragonTextures(root) {
  const body01Map = loadTexture(`${TEX_BASE}/T_M_B_44_Qishilong_body01_B.png`, THREE.SRGBColorSpace);
  const body01Normal = loadTexture(`${TEX_BASE}/T_M_B_44_Qishilong_body01_N.png`);
  const body02Map = loadTexture(`${TEX_BASE}/T_M_B_44_Qishilong_body02_B.png`, THREE.SRGBColorSpace);
  const body02Normal = loadTexture(`${TEX_BASE}/T_M_B_44_Qishilong_body02_N.png`);

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      const name = `${mat.name || ''} ${obj.name || ''}`.toLowerCase();
      const use01 = name.includes('body01');
      mat.map = use01 ? body01Map : body02Map;
      mat.normalMap = use01 ? body01Normal : body02Normal;
      mat.color.set(0xffffff);
      mat.metalness = 0.15;
      mat.roughness = 0.7;
      mat.envMapIntensity = 0.6;
      mat.needsUpdate = true;
    }
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

function trimClips(gltf) {
  const byName = {};
  for (const clip of gltf.animations) byName[clip.name] = clip;
  const clips = {};

  // まず idle を切り出してルート位置の基準にする（咆哮など別テイクの絶対座標差で瞬間移動しない）
  let rootRef = null;
  let rootRotMap = null;
  const idleRange = CLIP_RANGES.dragon_idle;
  if (idleRange && byName[idleRange.source]) {
    const idle = THREE.AnimationUtils.subclip(
      byName[idleRange.source],
      'dragon_idle',
      Math.round(idleRange.start * 30),
      Math.round(idleRange.end * 30),
      30,
    );
    rootRef = getRootMotionRef(idle);
    rootRotMap = getRootRotationMap(idle);
    pinRootMotion(idle, rootRef);
    clips.dragon_idle = idle;
  }

  for (const [outName, range] of Object.entries(CLIP_RANGES)) {
    if (clips[outName]) continue;
    const src = byName[range.source];
    if (!src) continue;
    const sub = THREE.AnimationUtils.subclip(
      src,
      outName,
      Math.round(range.start * 30),
      Math.round(range.end * 30),
      30,
    );
    pinRootMotion(sub, rootRef);
    // fly2はルートが旋回・バンクする長尺演技。コード側yawと二重回転しないよう
    // ルート回転を固定する。idleに無い骨(root_02等)は各トラック先頭(=バインド相当)を使う。
    // 以前はidleの別骨クォータニオンを全骨に流し込み上下逆になっていた。
    if (outName === 'dragon_fly') {
      pinRootRotation(sub, rootRotMap);
    }
    clips[outName] = sub;
  }
  return clips;
}

export async function loadDragonAnimationLibrary() {
  const gltf = await loadDragonSource();
  return trimClips(gltf);
}

export async function loadDragonMesh() {
  const gltf = await loadDragonSource();
  const model = SkeletonUtils.clone(gltf.scene);
  applyDragonTextures(model);
  scaleToHeight(model, TARGET_HEIGHT);

  const wrapper = new THREE.Group();
  wrapper.name = 'dragonRoot';
  wrapper.add(model);
  return wrapper;
}

export function createDragonMixer(meshScene) {
  return new THREE.AnimationMixer(meshScene);
}
