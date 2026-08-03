import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// downloadsフォルダのアセットを組み合わせた騎士プレイヤー:
// - medieval-knight-sculpture-game-ready … Mixamoリグ済みメッシュ+PBR
// - Sword and Shield Pack … 移動/攻撃/回避(jump)アニメ
// - sword.zip … 片手剣 glTF
// FBXはパーツごとにスケルトンが複製されるため、正規のmixamorig階層へ再バインドする

export const CHARACTER_CLIPS = {
  idle: 'knight_idle',
  walk: 'knight_walk',
  run: 'knight_run',
  roll: 'knight_roll',
  attack: 'knight_attack',
  attack2: 'knight_attack2',
  attack3: 'knight_attack3',
  heavyAttack: 'knight_heavy_attack',
  jumpAttack: 'knight_jump_attack',
  kick: 'knight_kick',
  hit: 'knight_hit',
  dead: 'knight_dead',
  guardIdle: 'knight_guard_idle',
  guardWalk: 'knight_guard_walk',
  flask: 'knight_flask',
};

const TARGET_HEIGHT = 1.85;
const GROUND_Y_BIAS = 0;
const MODEL_BASE = '/models/medieval-knight';
const KNIGHT_PATH = `${MODEL_BASE}/knight.fbx`;
const SWORD_PATH = `${MODEL_BASE}/weapons/sword/scene.gltf`;
const SHIELD_PATH = `${MODEL_BASE}/weapons/shield/scene.gltf`;
const SWORD_WORLD_LENGTH = 0.95;
const SWORD_THICKNESS_SCALE = 1.3;
const SWORD_GRIP_CENTER_FROM_POMMEL = 0.1; // 柄中央付近を持つ(柄端=ポンメルから刃方向へ)
const SHIELD_WORLD_HEIGHT = 0.75;

const ANIM_PATHS = {
  // downloads: sword and shield idle — 剣を見て回す動作が少ない基本idle
  knight_idle: `${MODEL_BASE}/anims/idle.fbx`,
  knight_walk: `${MODEL_BASE}/anims/walk.fbx`,
  knight_run: `${MODEL_BASE}/anims/run.fbx`,
  // downloads: Sprinting Forward Roll.fbx
  knight_roll: `${MODEL_BASE}/anims/roll.fbx`,
  knight_attack: `${MODEL_BASE}/anims/attack.fbx`,
  // Mixamo: slash (5) — 2段目のしゃがみ切り
  knight_attack2: `${MODEL_BASE}/anims/attack2.fbx`,
  // Mixamo: slash (4) — 3段目
  knight_attack3: `${MODEL_BASE}/anims/attack3.fbx`,
  // Mixamo: sword and shield attack (3)
  knight_heavy_attack: `${MODEL_BASE}/anims/heavy_attack.fbx`,
  // Mixamo: sword and shield attack (4) — ダッシュジャンプ切り
  knight_jump_attack: `${MODEL_BASE}/anims/jump_attack.fbx`,
  // Mixamo: kick — L2キック
  knight_kick: `${MODEL_BASE}/anims/kick.fbx`,
  // Mixamo: casting — 聖杯瓶を飲む動作
  knight_flask: `${MODEL_BASE}/anims/flask.fbx`,
  // Mixamo: impact (2) — のけぞり
  knight_hit: `${MODEL_BASE}/anims/hit.fbx`,
  // Mixamo: death (2) — 前方へ倒れ込み
  knight_dead: `${MODEL_BASE}/anims/dead.fbx`,
  knight_guard_idle: `${MODEL_BASE}/anims/guard_idle.fbx`,
  knight_guard_walk: `${MODEL_BASE}/anims/guard_walk.fbx`,
};

const MATERIAL_TEXTURE_ID = {
  blinn1: '01',
  blinn2: '02',
  blinn3: '03',
};

function findBone(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isBone && obj.name === name) found = obj;
  });
  return found;
}

function collectCanonicalBones(model) {
  const hips = model.children.find((c) => c.isBone && c.name === 'mixamorigHips');
  if (!hips) return null;
  const boneMap = new Map();
  const walk = (bone) => {
    if (boneMap.has(bone.name)) return;
    boneMap.set(bone.name, bone);
    for (const child of bone.children) {
      if (child.isBone) walk(child);
    }
  };
  walk(hips);
  return { hips, boneMap };
}

function rebindSkinnedMeshes(model, boneMap) {
  model.traverse((obj) => {
    if (!obj.isSkinnedMesh || !obj.skeleton) return;
    const bones = obj.skeleton.bones.map((b) => boneMap.get(b.name) || b);
    const inverses = obj.skeleton.boneInverses.map((m) => m.clone());
    obj.bind(new THREE.Skeleton(bones, inverses), obj.bindMatrix);
  });
}

function loadTexture(loader, url, { color = false, flipY = true } = {}) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.flipY = flipY;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        if (color) tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

async function buildMaterialSets(textureLoader) {
  const sets = {};
  for (const id of ['01', '02', '03']) {
    const base = `${MODEL_BASE}/textures/ID${id}`;
    const [map, metalnessMap, roughnessMap, normalMap, aoMap, alphaMap] = await Promise.all([
      loadTexture(textureLoader, `${base}_Base_color.png`, { color: true }),
      loadTexture(textureLoader, `${base}_Metallic.png`),
      loadTexture(textureLoader, `${base}_Roughness.png`),
      loadTexture(textureLoader, `${base}_Normal_DirectX.png`),
      loadTexture(textureLoader, `${base}_Mixed_AO.png`),
      id === '01'
        ? Promise.resolve(null)
        : loadTexture(textureLoader, `${base}_alpha.png`).catch(() => null),
    ]);
    sets[id] = { map, metalnessMap, roughnessMap, normalMap, aoMap, alphaMap };
  }
  return sets;
}

function applyKnightMaterials(model, materialSets) {
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    // 左手に別モデルの盾を付けるため、騎士FBX同梱の盾メッシュは隠す
    if (/bouclier/i.test(obj.name)) {
      obj.visible = false;
      return;
    }
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;

    const oldMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const nextMats = oldMats.map((oldMat) => {
      const id = MATERIAL_TEXTURE_ID[oldMat?.name] || '01';
      const maps = materialSets[id];
      const mat = new THREE.MeshStandardMaterial({
        name: oldMat?.name || `knight_${id}`,
        map: maps.map,
        metalnessMap: maps.metalnessMap,
        roughnessMap: maps.roughnessMap,
        normalMap: maps.normalMap,
        normalScale: new THREE.Vector2(1, -1),
        aoMap: maps.aoMap,
        metalness: 1,
        roughness: 1,
        color: new THREE.Color(1.25, 1.25, 1.25),
        envMapIntensity: 0.85,
        // 鎧の隙間から裏面が見えると空洞に見えるため両面表示
        side: THREE.DoubleSide,
      });
      if (maps.aoMap && obj.geometry && !obj.geometry.attributes.uv2 && obj.geometry.attributes.uv) {
        obj.geometry.setAttribute('uv2', obj.geometry.attributes.uv);
      }
      if (maps.alphaMap) {
        mat.alphaMap = maps.alphaMap;
        mat.transparent = true;
        mat.alphaTest = 0.4;
        mat.depthWrite = true;
      }
      return mat;
    });
    obj.material = nextMats.length === 1 ? nextMats[0] : nextMats;
  });
}

function scaleModelToHeight(model, targetHeight) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (size.y < 1e-3) return 1;
  model.scale.setScalar(targetHeight / size.y);
  model.position.y = 0;
  return model.scale.x;
}

// 正規骨格の足ボーン世界Yを測り、ルート高さから引くオフセットを返す。
// model.position.y は触らない(ルートの groundY と二重補正になるため)
function measureFootGroundOffset(model, boneMap) {
  model.updateMatrixWorld(true);
  const footNames = [
    'mixamorigLeftToeBase',
    'mixamorigRightToeBase',
    'mixamorigLeftFoot',
    'mixamorigRightFoot',
  ];
  let minY = Infinity;
  const pos = new THREE.Vector3();
  for (const name of footNames) {
    const bone = boneMap?.get(name) || findBone(model, name);
    if (!bone) continue;
    bone.getWorldPosition(pos);
    if (pos.y < minY) minY = pos.y;
  }
  return minY < Infinity ? -minY : 0;
}

// Mixamoの腰XZルートモーションがコントローラ移動と喧嘩して途切れ途切れに見えるため、
// XZだけ基準フレームに固定する。Yは歩行の上下を残す
function stripRootMotion(clip) {
  for (const track of clip.tracks) {
    if (track.name !== 'mixamorigHips.position') continue;
    const values = track.values;
    if (!values || values.length < 3) continue;
    const x0 = values[0];
    const z0 = values[2];
    for (let i = 0; i < values.length; i += 3) {
      values[i] = x0;
      values[i + 2] = z0;
    }
  }
}

// flask.fbx は後半(約1.3s〜)で腰を落として地面に瓶を立てる。
// 掲げる〜口元へ運ぶ冒頭だけ使い、その手前で切る。
const FLASK_RAISE_END_SEC = 1.15;

async function loadNamedClips(loader) {
  const clips = {};
  await Promise.all(
    Object.entries(ANIM_PATHS).map(async ([clipName, url]) => {
      const fbx = await loader.loadAsync(url);
      const src = fbx.animations.find((c) => c.tracks.length > 0) || fbx.animations[0];
      if (!src) return;
      let clip = src.clone();
      clip.name = clipName;
      stripRootMotion(clip);
      if (clipName === 'knight_flask') {
        clip = THREE.AnimationUtils.subclip(
          clip,
          clipName,
          0,
          Math.round(FLASK_RAISE_END_SEC * 30),
          30,
        );
      }
      clips[clipName] = clip;
    })
  );
  return clips;
}

async function loadDownloadSword(modelScale) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(SWORD_PATH);
  const source = gltf.scene;

  source.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.frustumCulled = false;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.metalness = mat.metalness ?? 1;
      mat.roughness = mat.roughness ?? 1;
      mat.envMapIntensity = 0.9;
      mat.needsUpdate = true;
    }
  });

  // 長辺を+Y(刃上向き)に揃え、柄側を原点へ。ボーン空間は 1/modelScale で世界長に合わせる
  source.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(source);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  if (rawSize.x >= rawSize.y && rawSize.x >= rawSize.z) {
    source.rotation.z = -Math.PI / 2;
  } else if (rawSize.z >= rawSize.y && rawSize.z >= rawSize.x) {
    source.rotation.x = Math.PI / 2;
  }
  source.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const localLen = SWORD_WORLD_LENGTH / modelScale;
  const uniform = localLen / longest;
  // 長さ方向(+Y)はそのまま、断面を太くする
  source.scale.set(uniform * SWORD_THICKNESS_SCALE, uniform, uniform * SWORD_THICKNESS_SCALE);
  source.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(source);
  const center = box2.getCenter(new THREE.Vector3());
  // ポンメルを原点にしたあと、柄中央が手ボーン原点に来るよう刃方向へずらす
  const gripHold = SWORD_GRIP_CENTER_FROM_POMMEL / modelScale;
  source.position.set(-center.x, -box2.min.y - gripHold, -center.z);

  const group = new THREE.Group();
  group.name = 'sword';
  group.add(source);
  return group;
}

/** 聖杯瓶（エストゥス風）。飲むモーション中だけ右手に表示する */
function createFlaskProp(modelScale) {
  const g = new THREE.Group();
  g.name = 'flask';
  const s = 1 / Math.max(modelScale, 1e-6);
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035 * s, 0.045 * s, 0.14 * s, 10),
    new THREE.MeshStandardMaterial({
      color: 0xc45a18,
      emissive: 0xff6a20,
      emissiveIntensity: 0.55,
      metalness: 0.15,
      roughness: 0.35,
      transparent: true,
      opacity: 0.92,
    }),
  );
  glass.position.y = 0.07 * s;
  g.add(glass);
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018 * s, 0.028 * s, 0.05 * s, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a4a20, metalness: 0.2, roughness: 0.5 }),
  );
  neck.position.y = 0.16 * s;
  g.add(neck);
  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.025 * s, 8),
    new THREE.MeshStandardMaterial({ color: 0x5c3a1a, roughness: 0.9 }),
  );
  cork.position.y = 0.2 * s;
  g.add(cork);
  const glow = new THREE.PointLight(0xff7722, 0.65, 1.2, 2);
  glow.position.y = 0.08 * s;
  g.add(glow);
  return g;
}

async function loadDownloadShield(modelScale) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(SHIELD_PATH);
  const source = gltf.scene;

  source.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.frustumCulled = false;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.metalness = mat.metalnessMap ? 1 : (mat.metalness ?? 0.3);
      mat.roughness = mat.roughnessMap ? 1 : (mat.roughness ?? 0.55);
      mat.envMapIntensity = 0.85;
      mat.needsUpdate = true;
    }
  });

  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const tallest = Math.max(size.x, size.y, size.z) || 1;
  const localH = SHIELD_WORLD_HEIGHT / modelScale;
  source.scale.setScalar(localH / tallest);
  // 元モデルが上下逆向きのため、面を立て直す
  source.rotation.z = Math.PI;
  source.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(source);
  const center = box2.getCenter(new THREE.Vector3());
  // 裏面中心を原点に。前腕ボーンで面が前方を向くよう後で回転する
  source.position.set(-center.x, -center.y, -box2.min.z);

  const group = new THREE.Group();
  group.name = 'shield';
  group.add(source);
  return group;
}

function makeHandTransform(modelScale) {
  // 手先(指側)寄り。柄中央オフセットと合わせて握る位置にする
  return {
    position: new THREE.Vector3(0.02 / modelScale, 0.1 / modelScale, 0.02 / modelScale),
    rotation: new THREE.Euler(Math.PI, 0, -Math.PI / 2),
  };
}

function makeShieldForearmTransform(modelScale) {
  // Mixamo LeftForeArm: +Yが肘→手首。密着しすぎたのでわずかに離す
  return {
    position: new THREE.Vector3(-0.03 / modelScale, 0.06 / modelScale, 0.07 / modelScale),
    rotation: new THREE.Euler(0, Math.PI, Math.PI / 2),
  };
}

export async function loadCharacterModel() {
  const loader = new FBXLoader();
  const textureLoader = new THREE.TextureLoader();

  const [model, materialSets] = await Promise.all([
    loader.loadAsync(KNIGHT_PATH),
    buildMaterialSets(textureLoader),
  ]);

  const canonical = collectCanonicalBones(model);
  if (canonical) rebindSkinnedMeshes(model, canonical.boneMap);
  applyKnightMaterials(model, materialSets);

  const modelScale = scaleModelToHeight(model, TARGET_HEIGHT);

  const root = new THREE.Group();
  root.name = 'character';
  root.add(model);

  const clipByName = await loadNamedClips(loader);
  const mixers = [new THREE.AnimationMixer(model)];

  // idle姿勢での足ボーン高さから、ルート接地オフセットを算出
  let footBias = 0;
  const idleClip = clipByName.knight_idle;
  if (idleClip) {
    const boot = mixers[0].clipAction(idleClip);
    boot.play();
    mixers[0].update(0);
    footBias = measureFootGroundOffset(model, canonical?.boneMap);
    boot.stop();
    mixers[0].setTime(0);
  }

  const hipBone = canonical?.hips || findBone(model, 'mixamorigHips');
  const handBone = canonical?.boneMap?.get('mixamorigRightHand') || findBone(model, 'mixamorigRightHand');
  const rightForearmBone =
    canonical?.boneMap?.get('mixamorigRightForeArm') || findBone(model, 'mixamorigRightForeArm');
  const leftForearmBone =
    canonical?.boneMap?.get('mixamorigLeftForeArm') || findBone(model, 'mixamorigLeftForeArm');

  const [sword, shield] = await Promise.all([
    loadDownloadSword(modelScale),
    loadDownloadShield(modelScale),
  ]);
  const handTransform = makeHandTransform(modelScale);
  const shieldTransform = makeShieldForearmTransform(modelScale);
  if (handBone) {
    sword.position.copy(handTransform.position);
    sword.rotation.copy(handTransform.rotation);
    handBone.add(sword);
  }
  if (leftForearmBone) {
    shield.position.copy(shieldTransform.position);
    shield.rotation.copy(shieldTransform.rotation);
    leftForearmBone.add(shield);
  }

  // 聖杯瓶（飲むときだけ表示）。剣と同じ「柄=+Y」系の持ち方に合わせて
  // handTransformと同じ位置・回転を使うことで、正しく直立した状態で握らせる
  // (以前は position が modelScale を掛け違えていてほぼ原点にめり込み、
  // 回転も剣と無関係な値だったため逆さ・横向きに持っているように見えていた)
  const flask = createFlaskProp(modelScale);
  flask.visible = false;
  if (handBone) {
    flask.position.copy(handTransform.position);
    flask.rotation.copy(handTransform.rotation);
    handBone.add(flask);
  }
  const flaskRestRotation = flask.rotation.clone();

  const swordRig = {
    sword,
    shield,
    flask,
    flaskRestRotation,
    hipBone,
    handBone,
    rightForearmBone, // 攻撃当たり判定で前腕ボーン位置を使うため
    leftForearmBone,
    sheathTransform: handTransform,
    handTransform,
    shieldTransform,
    alwaysInHand: true,
  };

  return {
    root,
    mixers,
    clips: clipByName,
    swordRig,
    visualModel: model,
    // 足ボーンは靴底より少し上なので、わずかに沈めて接地させる
    groundYBias: GROUND_Y_BIAS + footBias - 0.1,
  };
}
