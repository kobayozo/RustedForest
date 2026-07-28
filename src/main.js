import * as THREE from 'three';
import { createRenderer, createScene, createCamera, setupResize } from './render/renderer.js';
import { createLighting } from './world/lighting.js';
import { createTerrain } from './world/terrain.js';
import { createRocks } from './world/groundDetail.js';
import { createCastle } from './world/castle.js';
import { createForest } from './world/forest.js';
import { createPond } from './world/pond.js';
import { loadCharacterModel } from './player/characterModel.js';
import { CharacterAnimator } from './player/characterAnimator.js';
import { PlayerController } from './player/playerController.js';
import { ThirdPersonCamera } from './player/thirdPersonCamera.js';
import {
  loadEnemyAnimationLibrary,
  loadEnemyMesh,
  createEnemyMixer,
  WARRIOR_CLIP_MAP,
  MINION_CLIP_MAP,
} from './enemy/enemyModel.js';
import { EnemyAnimator } from './enemy/enemyAnimator.js';
import { EnemyAI } from './enemy/enemyAI.js';
import { getHeightAt, CASTLE_ANCHOR } from './world/terrain.js';
import { InputState } from './core/input.js';
import { Engine } from './core/engine.js';
import { createStaminaBar, createHealthBar, createEnemyHealthBar } from './ui/hud.js';
import { AudioManager } from './audio/audioManager.js';
import { FootstepPlayer } from './audio/footsteps.js';

const FOOTSTEP_SOUNDS = ['footstep0', 'footstep1', 'footstep2', 'footstep3', 'footstep4'];
const SWORD_SWING_SOUNDS = ['swordSwing0', 'swordSwing1'];
const ROLL_SOUNDS = ['cloth0', 'cloth1'];
// 命中音は「甲高い金属の一撃(クラング)」+「低くこもった衝撃(ドスン)」の2層を
// 同時に鳴らして重厚感を出す(ゲーム音響の定番手法)。それぞれ単体だと軽く安っぽく
// 聞こえるが、重ねることで一撃の重みが出る
const HIT_ENEMY_CLANG_SOUNDS = ['hitEnemyClang0', 'hitEnemyClang1', 'hitEnemyClang2'];
const HIT_ENEMY_THUD_SOUNDS = ['hitEnemyThud0', 'hitEnemyThud1', 'hitEnemyThud2'];
const HIT_PLAYER_PUNCH_SOUNDS = ['hitPlayerPunch0', 'hitPlayerPunch1', 'hitPlayerPunch2'];
const HIT_PLAYER_THUD_SOUNDS = ['hitPlayer0', 'hitPlayer1', 'hitPlayer2'];

// プレイヤーの攻撃が敵に届いたかどうかの簡易判定(距離+前方コーン)。
// 精密な武器ヒットボックスではなく、アクションゲームでよく使われる簡略化した近接判定
const ATTACK_HIT_RANGE = 1.9;
const ATTACK_HIT_ANGLE_COS = Math.cos(THREE.MathUtils.degToRad(45));
const LIGHT_ATTACK_DAMAGE = 14;
const HEAVY_ATTACK_DAMAGE = 32;

async function main() {
  const canvas = document.getElementById('app');
  const hud = document.getElementById('hud');
  hud.textContent = 'Loading...';

  const renderer = createRenderer(canvas);
  const scene = createScene();
  const camera = createCamera();
  setupResize(renderer, camera);
  createLighting(scene);

  const terrain = createTerrain();
  scene.add(terrain);
  scene.add(createRocks());

  const [castle, forest, pond, character, enemyClipLib, warriorMesh, minionMesh] = await Promise.all([
    createCastle(),
    createForest(),
    createPond(),
    loadCharacterModel(),
    loadEnemyAnimationLibrary(),
    loadEnemyMesh(true),
    loadEnemyMesh(false),
  ]);
  scene.add(castle);
  scene.add(forest);
  scene.add(pond.group);

  const { root: characterRoot, mixers, clips } = character;
  scene.add(characterRoot);
  const animator = new CharacterAnimator(mixers, clips);

  const controller = new PlayerController(characterRoot, animator);
  const input = new InputState(canvas);
  // カメラの障害物回避は地形と城壁を対象にする(木・池は小さく気にならないため除外)
  const thirdPersonCamera = new ThirdPersonCamera(camera, [terrain, castle]);

  // メッシュとクリップマップからEnemyAIインスタンスを1体組み立てるヘルパー。
  // アニメーションライブラリ(clips)は全敵共通で1回だけ読み込んだものを使い回す
  function spawnEnemy(meshScene, clipMap, spawnPos) {
    scene.add(meshScene);
    const mixer = createEnemyMixer(meshScene);
    const enemyAnimator = new EnemyAnimator(mixer, enemyClipLib, clipMap);
    return new EnemyAI(meshScene, enemyAnimator, spawnPos);
  }

  // 剣を持つ警備兵は城の正門前に、素手の雑魚はその少し西側に配置する
  const warriorSpawn = new THREE.Vector3(
    CASTLE_ANCHOR.x,
    0,
    CASTLE_ANCHOR.z + CASTLE_ANCHOR.radius + 5
  );
  warriorSpawn.y = getHeightAt(warriorSpawn.x, warriorSpawn.z);
  const warriorAI = spawnEnemy(warriorMesh, WARRIOR_CLIP_MAP, warriorSpawn);
  warriorAI.name = '衛兵';

  const minionSpawn = new THREE.Vector3(
    CASTLE_ANCHOR.x - 9,
    0,
    CASTLE_ANCHOR.z + CASTLE_ANCHOR.radius + 7
  );
  minionSpawn.y = getHeightAt(minionSpawn.x, minionSpawn.z);
  const minionAI = spawnEnemy(minionMesh, MINION_CLIP_MAP, minionSpawn);
  minionAI.name = '野盗';

  const enemies = [warriorAI, minionAI];

  hud.textContent = '';
  const staminaBar = createStaminaBar(hud);
  const healthBar = createHealthBar(hud);
  const enemyHealthBar = createEnemyHealthBar(hud);

  const audio = new AudioManager();
  audio.init();
  await audio.loadAll({
    footstep0: '/audio/footstep_grass_000.ogg',
    footstep1: '/audio/footstep_grass_001.ogg',
    footstep2: '/audio/footstep_grass_002.ogg',
    footstep3: '/audio/footstep_grass_003.ogg',
    footstep4: '/audio/footstep_grass_004.ogg',
    swordSwing0: '/audio/knifeSlice.ogg',
    swordSwing1: '/audio/knifeSlice2.ogg',
    cloth0: '/audio/cloth2.ogg',
    cloth1: '/audio/cloth3.ogg',
    hitEnemyClang0: '/audio/hitEnemyClang0.ogg',
    hitEnemyClang1: '/audio/hitEnemyClang1.ogg',
    hitEnemyClang2: '/audio/hitEnemyClang2.ogg',
    hitEnemyThud0: '/audio/hitEnemyThud0.ogg',
    hitEnemyThud1: '/audio/hitEnemyThud1.ogg',
    hitEnemyThud2: '/audio/hitEnemyThud2.ogg',
    hitPlayerPunch0: '/audio/hitPlayerPunch0.ogg',
    hitPlayerPunch1: '/audio/hitPlayerPunch1.ogg',
    hitPlayerPunch2: '/audio/hitPlayerPunch2.ogg',
    hitPlayer0: '/audio/hitPlayer0.ogg',
    hitPlayer1: '/audio/hitPlayer1.ogg',
    hitPlayer2: '/audio/hitPlayer2.ogg',
  });
  const footsteps = new FootstepPlayer(audio, FOOTSTEP_SOUNDS);
  let previousControllerState = controller.state;
  let previousAttackTriggerId = controller.attackTriggerId;
  // 1つのattackTriggerIdにつき一度だけ命中判定を行うためのトラッキング
  let hitCheckedTriggerId = -1;

  // 攻撃範囲内かつ前方コーン内にいる、最も近い生存中の敵1体だけを狙う
  // (剣が複数の敵を同時になぎ払うことはない、という単純化した近接判定)
  function tryHitEnemy() {
    let target = null;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const toEnemy = new THREE.Vector3().subVectors(enemy.position, controller.position);
      toEnemy.y = 0;
      const dist = toEnemy.length();
      if (dist > ATTACK_HIT_RANGE) continue;
      let facing = 1;
      if (dist > 0.0001) {
        const dir = toEnemy.clone().normalize();
        const forward = new THREE.Vector3(-Math.sin(controller.yaw), 0, -Math.cos(controller.yaw));
        facing = forward.dot(dir);
      }
      if (facing < ATTACK_HIT_ANGLE_COS) continue;
      if (dist < bestDist) {
        bestDist = dist;
        target = enemy;
      }
    }
    if (!target) return;
    const damage = controller.attackKind === 'heavy' ? HEAVY_ATTACK_DAMAGE : LIGHT_ATTACK_DAMAGE;
    target.takeDamage(damage);
    audio.playRandom(HIT_ENEMY_CLANG_SOUNDS, { volume: 1.3, pitch: 0.85, pitchVariance: 0.08 });
    audio.playRandom(HIT_ENEMY_THUD_SOUNDS, { volume: 1.1, pitch: 0.8, pitchVariance: 0.08 });
  }

  // HPバーに表示する敵は、生存中でプレイヤーに最も近い1体を毎フレーム選び直す
  // (ボスバー風のUIを複数体で使い回すシンプルな方式)
  function pickDisplayEnemy() {
    let best = null;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dist = enemy.position.distanceTo(controller.position);
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }
    return best;
  }

  // capture.mjs等のテストツールがマウス操作なしでカメラを検証するためのフック
  window.__debug = {
    setCameraYaw: (y) => { thirdPersonCamera.yaw = y; },
    setCameraPitch: (p) => { thirdPersonCamera.pitch = p; },
    teleport: (x, z) => { controller.position.set(x, 0, z); },
    controller,
    enemyAI: warriorAI,
    minionAI,
    enemies,
    camera,
    thirdPersonCamera,
    characterRoot,
  };

  function update(dt) {
    const { dx, dy } = input.consumeMouseDelta();
    thirdPersonCamera.handleMouseDelta(dx, dy);
    controller.update(dt, input, thirdPersonCamera.yaw);
    thirdPersonCamera.update(dt, controller.position);
    const hpBeforeEnemyTurn = controller.hp;
    for (const enemy of enemies) {
      enemy.update(dt, controller.position, (damage) => controller.takeDamage(damage));
    }
    if (controller.hp < hpBeforeEnemyTurn) {
      audio.playRandom(HIT_PLAYER_PUNCH_SOUNDS, { volume: 1.3, pitch: 0.85, pitchVariance: 0.08 });
      audio.playRandom(HIT_PLAYER_THUD_SOUNDS, { volume: 1.2, pitch: 0.75, pitchVariance: 0.08 });
    }
    staminaBar.update(controller.stamina);
    healthBar.update(controller.hp);
    const displayEnemy = pickDisplayEnemy();
    enemyHealthBar.update(displayEnemy ? displayEnemy.hp : 0, !!displayEnemy, displayEnemy ? displayEnemy.name : null);

    footsteps.update(dt, controller.state);
    if (controller.state === 'roll' && previousControllerState !== 'roll') {
      audio.playRandom(ROLL_SOUNDS, { volume: 0.5, pitchVariance: 0.1 });
    }
    previousControllerState = controller.state;

    // attackTriggerIdはコンボの1発ごとに増えるので、state自体は'attack'のまま
    // 変化しなくても新しい一撃を検知できる(2撃目以降も剣を振る音を鳴らすため)
    if (controller.attackTriggerId !== previousAttackTriggerId) {
      const isHeavy = controller.attackKind === 'heavy';
      audio.playRandom(SWORD_SWING_SOUNDS, {
        volume: isHeavy ? 0.85 : 0.6,
        pitch: isHeavy ? 0.8 : 1,
        pitchVariance: isHeavy ? 0.05 : 0.1,
      });
      previousAttackTriggerId = controller.attackTriggerId;
    }

    // 攻撃1回(=1トリガー)につき、クリップの命中タイミング(t)を過ぎた最初のフレームで
    // 一度だけ判定する。連続ヒットや空振りでの誤爆連発を防ぐ
    if (controller.action === 'attack' && controller.attackTriggerId !== hitCheckedTriggerId) {
      const impactT = controller.attackKind === 'heavy' ? 0.5 : 0.4;
      const t = controller.actionTimer / controller.attackDuration;
      if (t >= impactT) {
        hitCheckedTriggerId = controller.attackTriggerId;
        tryHitEnemy();
      }
    }

    window.__debugState = {
      position: {
        x: Number(controller.position.x.toFixed(2)),
        y: Number(controller.position.y.toFixed(2)),
        z: Number(controller.position.z.toFixed(2)),
      },
      yaw: Number(controller.yaw.toFixed(2)),
      state: controller.state,
      speed: Number(controller.speed.toFixed(2)),
      stamina: Number(controller.stamina.toFixed(1)),
      invincible: controller.invincible,
      cameraYaw: Number(thirdPersonCamera.yaw.toFixed(2)),
      cameraPitch: Number(thirdPersonCamera.pitch.toFixed(2)),
      comboStage: controller.comboStage,
      attackTriggerId: controller.attackTriggerId,
      attackKind: controller.attackKind,
      hp: Number(controller.hp.toFixed(1)),
      action: controller.action,
      // enemyは互換用に警備兵(1体目)を指す。全体はenemiesを参照する
      enemy: {
        hp: Number(warriorAI.hp.toFixed(1)),
        alive: warriorAI.alive,
        action: warriorAI.action,
        position: {
          x: Number(warriorAI.position.x.toFixed(2)),
          z: Number(warriorAI.position.z.toFixed(2)),
        },
      },
      enemies: enemies.map((enemy) => ({
        hp: Number(enemy.hp.toFixed(1)),
        alive: enemy.alive,
        action: enemy.action,
        position: {
          x: Number(enemy.position.x.toFixed(2)),
          z: Number(enemy.position.z.toFixed(2)),
        },
      })),
    };
  }

  function render() {
    renderer.render(scene, camera);
  }

  const engine = new Engine({ update, render });
  engine.start();

  window.__ready = true;
}

main().catch((err) => {
  console.error(err);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to load: ${err.message}`;
});
