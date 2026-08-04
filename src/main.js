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
  MINION_CLIP_MAP,
} from './enemy/enemyModel.js';
import { loadDragonAnimationLibrary, loadDragonMesh, createDragonMixer, DRAGON_CLIP_MAP } from './enemy/dragonModel.js';
import { loadMageAnimationLibrary, loadMageMesh, createMageMixer, MAGE_CLIP_MAP } from './enemy/mageModel.js';
import { loadWildlifeAnimationLibrary, loadWildlifeMesh, createWildlifeMixer, WILDLIFE_CLIP_MAP } from './enemy/wildlifeModel.js';
import { EnemyAnimator } from './enemy/enemyAnimator.js';
import { EnemyAI } from './enemy/enemyAI.js';
import { DragonAI } from './enemy/dragonAI.js';
import { MageAI } from './enemy/mageAI.js';
import { AnimalAI, ANIMAL_PRESETS } from './enemy/animalAI.js';
import { getHeightAt, CASTLE_ANCHOR } from './world/terrain.js';
import { setCastleColliders, resolveCircleColliders, separateCircles, getGroundHeight } from './physics/collision.js';
import { InputState } from './core/input.js';
import { Engine } from './core/engine.js';
import { createPlayerVitals, createEnemyHealthBar, createGameOverScreen, createBossFelledScreen, createLockOnMarker } from './ui/hud.js';
import { AudioManager } from './audio/audioManager.js';
import { FootstepPlayer } from './audio/footsteps.js';
import { HitFlash, spawnHitSpark, updateHitSparks } from './combat/hitEffects.js';
import { HitboxDebug } from './combat/hitboxDebug.js';
import { findLockTarget, getLockFocusPosition, shouldBreakLock } from './combat/lockOn.js';
import { createPlayerCombatContext, syncPlayerCombatContext } from './enemy/soulsCombat.js';
import {
  HitStop,
  stanceDamageForAttack,
  initEnemyStance,
  updateEnemyStance,
  applyStanceDamage,
  inHyperArmorWindow,
  shareAggro,
} from './combat/eldenSystems.js';

const FOOTSTEP_SOUNDS = ['footstep0', 'footstep1', 'footstep2', 'footstep3', 'footstep4'];
const HIT_PLAYER_PUNCH_SOUNDS = ['hitPlayerPunch0', 'hitPlayerPunch1', 'hitPlayerPunch2'];
const HIT_PLAYER_THUD_SOUNDS = ['hitPlayer0', 'hitPlayer1', 'hitPlayer2'];

// 攻撃判定: 振っている腕(前腕→手首→刃先)の2線分と敵胴体球の距離で判定。
// ひとつ目の線分(前腕→手首)は腕の長さを、ふたつ目(手首→刃先)は刃を表す
const WEAPON_HIT_RADIUS = 0.55; // 細くして精度を上げる
const SWORD_BLADE_LENGTH = 0.95; // characterModel の SWORD_WORLD_LENGTH と揃える
const ATTACK3_BLADE_EXTRA = 0.85; // 3段目は前方長め
const ATTACK3_HIT_RADIUS_BONUS = 0.25;
const ENEMY_HURTBOX_HEIGHT = 1.0;
const ENEMY_HURTBOX_RADIUS_DEFAULT = 0.55;
const LIGHT_ATTACK_DAMAGE = 14;
const HEAVY_ATTACK_DAMAGE = 32;
const JUMP_ATTACK_DAMAGE = 22;
const KICK_DAMAGE = 12;
const HIT_SPARK_HEIGHT = 1.0;
// 重攻撃モーションは 前振りかぶり(後方)→本振り(前方)→フォロースルー(再び後方) と
// 剣先が前後に往復するため、窓を広く取ると振りかぶり/フォロースルー中の「後方」判定まで
// 拾ってしまい後ろの敵にも当たる。剣先が実際に前方へ伸びる区間だけに絞る
// (実測: t=0.40-0.49 のみ剣先/柄/前腕の全てが前方に位置する)
const HEAVY_HIT_WINDOW_START = 0.4;
const HEAVY_HIT_WINDOW_END = 0.49;
const HEAVY_WHIFF_SFX_T = 0.5;
const LIGHT_HIT_IMPACT_T = 0.4;
const JUMP_HIT_IMPACT_T = 0.35;
const KICK_HIT_IMPACT_T = 0.4;
const KICK_REACH = 1.35;
const KICK_HIT_RADIUS = 0.7;
const LIGHT_KNOCKBACK = 5.5; // 2発目からノックバック
const FINISHER_KNOCKBACK = 7.5;
const HEAVY_KNOCKBACK = 9;
const JUMP_KNOCKBACK = 8;
const KICK_KNOCKBACK = 6.5;
const CRITICAL_DAMAGE = 58;
const HITSTOP_LIGHT = 0.045;
const HITSTOP_HEAVY = 0.085;
// マップ全域に散らばる野生動物は、非戦闘かつこの距離より遠ければAI/アニメ更新を省略する
const WILDLIFE_SIM_RADIUS = 45;
const WILDLIFE_SIM_RADIUS_SQ = WILDLIFE_SIM_RADIUS * WILDLIFE_SIM_RADIUS;

// 拡大マップ内の草原寄りにスポーン（旧 -28,42 は地形外だった）
const PLAYER_SPAWN = new THREE.Vector3(-18, 0, 28);
// 死亡クリップのこの割合まで再生してから YOU DIED を出す(ほぼ倒れきった後)
const GAME_OVER_DEATH_PROGRESS = 0.92;

async function main() {
  const canvas = document.getElementById('app');
  const hud = document.getElementById('hud');
  hud.textContent = 'Loading...';

  const renderer = createRenderer(canvas);
  const scene = createScene();
  const camera = createCamera();
  setupResize(renderer, camera);
  createLighting(scene, renderer);

  const terrain = createTerrain();
  scene.add(terrain);
  scene.add(createRocks());

  // Wizard/Ritual FBX は他FBXと並列だと FBXLoader が壊れることがあるため、騎士ロード後に単独取得する
  const animalKeys = Object.keys(ANIMAL_PRESETS);
  const [castleResult, forest, pond, character, enemyClipLib, minionMesh, dragonPack, ...animalPacks] =
    await Promise.all([
      createCastle(),
      createForest(),
      createPond(),
      loadCharacterModel(),
      loadEnemyAnimationLibrary(),
      loadEnemyMesh(false),
      Promise.all([loadDragonMesh(), loadDragonAnimationLibrary()]),
      ...animalKeys.map((key) => {
        const preset = ANIMAL_PRESETS[key];
        return Promise.all([
          loadWildlifeMesh(preset.path, preset.height),
          loadWildlifeAnimationLibrary(preset.path, preset.attackClip),
        ]);
      }),
    ]);
  const [dragonMesh, dragonClipLib] = dragonPack;
  const animalMeshByKey = {};
  const animalClipLibByKey = {};
  animalKeys.forEach((key, i) => {
    animalMeshByKey[key] = animalPacks[i][0];
    animalClipLibByKey[key] = animalPacks[i][1];
  });
  // RitualWoman(65MB) + Magic Pack は重いので他のあとで直列ロード
  hud.textContent = 'Loading mage...';
  const [mageMesh, mageClipLib] = await Promise.all([loadMageMesh(), loadMageAnimationLibrary()]);
  const castle = castleResult.group;
  setCastleColliders(castleResult.colliders);
  scene.add(castle);
  scene.add(forest);
  scene.add(pond.group);

  const { root: characterRoot, mixers, clips, swordRig, visualModel, groundYBias } = character;
  scene.add(characterRoot);
  const animator = new CharacterAnimator(mixers, clips, swordRig);
  const playerHitFlash = new HitFlash(characterRoot);
  const hitboxDebug = new HitboxDebug(scene);

    PLAYER_SPAWN.y = getHeightAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
  const controller = new PlayerController(characterRoot, animator, visualModel, groundYBias ?? 0);
  controller.position.copy(PLAYER_SPAWN);
  const input = new InputState(canvas);
  // カメラの障害物回避は地形と城壁を対象にする(木・池は小さく気にならないため除外)
  const thirdPersonCamera = new ThirdPersonCamera(camera, [terrain, castle]);

  // メッシュとクリップマップからEnemyAIインスタンスを1体組み立てるヘルパー。
  // アニメーションライブラリ(clips)は全敵共通で1回だけ読み込んだものを使い回す
  function spawnEnemy(meshScene, clipMap, spawnPos, clipLib = enemyClipLib) {
    scene.add(meshScene);
    const mixer = createEnemyMixer(meshScene);
    const enemyAnimator = new EnemyAnimator(mixer, clipLib, clipMap);
    const enemy = new EnemyAI(meshScene, enemyAnimator, spawnPos);
    enemy.hitFlash = new HitFlash(meshScene);
    initEnemyStance(enemy, 70);
    return enemy;
  }

  function spawnDragon(meshScene, spawnPos) {
    scene.add(meshScene);
    const mixer = createDragonMixer(meshScene);
    const enemyAnimator = new EnemyAnimator(mixer, dragonClipLib, DRAGON_CLIP_MAP, {
      fadeTime: 0.35,
    });
    const enemy = new DragonAI(meshScene, enemyAnimator, spawnPos);
    enemy.hitFlash = new HitFlash(meshScene);
    enemy.hurtboxRadius = 2.4;
    enemy.hurtboxHeight = 2.2;
    initEnemyStance(enemy, 160);
    return enemy;
  }

  function spawnMage(meshScene, spawnPos) {
    scene.add(meshScene);
    const mixer = createMageMixer(meshScene);
    const enemyAnimator = new EnemyAnimator(mixer, mageClipLib, MAGE_CLIP_MAP, {
      fadeTime: 0.22,
    });
    const enemy = new MageAI(meshScene, enemyAnimator, spawnPos, scene);
    enemy.hitFlash = new HitFlash(meshScene);
    enemy.hurtboxRadius = 0.5;
    enemy.hurtboxHeight = 1.1;
    initEnemyStance(enemy, 55);
    return enemy;
  }

  // 野生動物(Quaternius Ultimate Animated Animal Pack, CC0)。既存の汎用AnimalAI+
  // ソウル系間合いブレインをそのまま使い回せるので、モデル/クリップだけpreset単位でロードする
  function spawnAnimal(key, spawnPos) {
    const preset = ANIMAL_PRESETS[key];
    const meshScene = animalMeshByKey[key];
    scene.add(meshScene);
    const mixer = createWildlifeMixer(meshScene);
    const enemyAnimator = new EnemyAnimator(mixer, animalClipLibByKey[key], WILDLIFE_CLIP_MAP, {
      fadeTime: 0.25,
    });
    const enemy = new AnimalAI(meshScene, enemyAnimator, spawnPos, preset);
    enemy.hitFlash = new HitFlash(meshScene);
    initEnemyStance(enemy, preset.poiseMax ?? 40);
    // 非戦闘時は遠距離シミュレーション省略の対象にする(WILDLIFE_SIM_RADIUS参照)
    enemy.isWildlife = true;
    return enemy;
  }

  const minionSpawn = new THREE.Vector3(
    CASTLE_ANCHOR.x - 9,
    0,
    CASTLE_ANCHOR.z + CASTLE_ANCHOR.radius + 7
  );
  minionSpawn.y = getHeightAt(minionSpawn.x, minionSpawn.z);
  const minionAI = spawnEnemy(minionMesh, MINION_CLIP_MAP, minionSpawn);
  minionAI.name = '野盗';

  const mageSpawn = new THREE.Vector3(
    CASTLE_ANCHOR.x + 11,
    0,
    CASTLE_ANCHOR.z + CASTLE_ANCHOR.radius + 5,
  );
  mageSpawn.y = getHeightAt(mageSpawn.x, mageSpawn.z);
  const mageAI = spawnMage(mageMesh, mageSpawn);

  const dragonSpawn = new THREE.Vector3(CASTLE_ANCHOR.x, 0, CASTLE_ANCHOR.z);
  dragonSpawn.y = getHeightAt(dragonSpawn.x, dragonSpawn.z);
  const dragonAI = spawnDragon(dragonMesh, dragonSpawn);
  dragonAI.name = 'ドラゴン';

  // 野生動物: 城/ドラゴンアリーナ/池から離れた草原各所に配置し、探索中の小規模な
  // 戦闘の起伏を作る(いずれも既存AnimalAIのpresetをそのまま使用)
  const ANIMAL_SPAWN_POS = {
    wolf: new THREE.Vector3(15, 0, 45),
    fox: new THREE.Vector3(-40, 0, 40),
    husky: new THREE.Vector3(5, 0, 15),
    bull: new THREE.Vector3(-45, 0, -5),
    cow: new THREE.Vector3(50, 0, 20),
    stag: new THREE.Vector3(-15, 0, 24),
    donkey: new THREE.Vector3(-30, 0, 20),
  };
  const animalAIs = animalKeys.map((key) => {
    const pos = ANIMAL_SPAWN_POS[key] ?? new THREE.Vector3();
    pos.y = getHeightAt(pos.x, pos.z);
    const animal = spawnAnimal(key, pos);
    animal.name = ANIMAL_PRESETS[key].name;
    return animal;
  });

  const enemies = [minionAI, mageAI, dragonAI, ...animalAIs];

  hud.textContent = '';
  const playerVitals = createPlayerVitals(hud);
  const enemyHealthBar = createEnemyHealthBar(hud);
  const lockOnMarker = createLockOnMarker(hud);
  const gameOverScreen = createGameOverScreen(hud);
  const bossFelledScreen = createBossFelledScreen(hud);
  let deathTimer = 0;
  let gameOverShown = false;
  let bossFelledPlayed = false;
  let bossFelledSlowmo = 0;
  let bossFelledReturnMusicAt = 0;
  const playerCombatCtx = createPlayerCombatContext();
  syncPlayerCombatContext(playerCombatCtx, controller, 0);
  const hitStop = new HitStop();

  const audio = new AudioManager();
  audio.init();
  await audio.loadAll({
    footstep0: '/audio/footstep_grass_000.ogg',
    footstep1: '/audio/footstep_grass_001.ogg',
    footstep2: '/audio/footstep_grass_002.ogg',
    footstep3: '/audio/footstep_grass_003.ogg',
    footstep4: '/audio/footstep_grass_004.ogg',
    kickCloth1: '/audio/kick_cloth1.mp3',
    cloth2: '/audio/cloth2.ogg',
    cloth3: '/audio/cloth3.ogg',
    hitPlayerPunch0: '/audio/hitPlayerPunch0.ogg',
    hitPlayerPunch1: '/audio/hitPlayerPunch1.ogg',
    hitPlayerPunch2: '/audio/hitPlayerPunch2.ogg',
    hitPlayer0: '/audio/hitPlayer0.ogg',
    hitPlayer1: '/audio/hitPlayer1.ogg',
    hitPlayer2: '/audio/hitPlayer2.ogg',
    slashHit7: '/audio/slash_hit7.mp3',
    bokutoSwing: '/audio/bokuto_swing.mp3',
    yodguard: '/audio/yodguard.mp3',
    exploreBgm: '/audio/explore_theme.mp3', // フォールバック
    // 通常時: 壮大なオーケストラ系を複数ロードし、入場時にランダム選曲
    exploreJourney: '/audio/explore/explore_journey.mp3',
    exploreFantasy: '/audio/explore/explore_fantasy.mp3',
    exploreArcana: '/audio/explore/explore_arcana.mp3',
    exploreAdventure: '/audio/explore/explore_adventure.mp3',
    exploreEternal: '/audio/explore/explore_eternal.mp3',
    exploreLegend: '/audio/explore/explore_legend.mp3',
    battleNormalBgm: '/audio/battle_normal.mp3', // DQ5「戦闘のテーマ」(Monsters)
    bossBgm: '/audio/battle_bgm.mp3', // ドラゴン専用
    youDied: '/audio/you_died.mp3', // デモンズソウル系 YOU DIED
    // ドラゴン鳴き声: OpenGameArt troll-roars (CC0) + Mixkit creature/dino roar
    dragonRoar: '/audio/dragon_roar.mp3',
    dragonGrowl: '/audio/dragon_growl.ogg',
    dragonSnarl: '/audio/dragon_snarl.mp3',
  });
  // 探索BGMは最初の入力で AudioContext が resume されたあとから鳴る
  audio.setCombatMusic('explore');
  dragonAI.setSfxHandler((kind) => {
    if (kind === 'roar') audio.playDragonRoar();
    else if (kind === 'stomp') audio.playDragonStomp();
    else if (kind === 'growl') audio.playDragonGrowl();
  });
  const footsteps = new FootstepPlayer(audio, FOOTSTEP_SOUNDS);
  let previousControllerState = controller.state;
  // 軽攻撃は1トリガー1判定。重攻撃は踏み込み中に剣線分で連続判定し、敵ごとに1回まで
  let hitCheckedTriggerId = -1;
  let heavyHitEnemies = new Set();
  let heavySwingHadHit = false;
  let heavySwingPlayedWhiff = false;
  let lockTarget = null;
  const lockFocusPos = new THREE.Vector3();
  const _swordGrip = new THREE.Vector3();
  const _swordTip = new THREE.Vector3();
  const _elbowPos = new THREE.Vector3(); // 前腕ボーンのワールド位置
  const _swordDir = new THREE.Vector3();
  const _enemyCenter = new THREE.Vector3();
  const _seg = new THREE.Vector3();
  const _closest = new THREE.Vector3();

  function distancePointToSegment(point, a, b) {
    _seg.subVectors(b, a);
    const lenSq = _seg.lengthSq();
    if (lenSq < 1e-8) return point.distanceTo(a);
    const t = Math.max(0, Math.min(1, _closest.subVectors(point, a).dot(_seg) / lenSq));
    _closest.copy(a).addScaledVector(_seg, t);
    return point.distanceTo(_closest);
  }

  /** 前腕→手首→刃先 の2線分を返す。どちらかに点が近ければヒット */
  function distancePointToArm(point, elbow, grip, tip) {
    const d1 = distancePointToSegment(point, elbow, grip);
    const d2 = distancePointToSegment(point, grip, tip);
    return Math.min(d1, d2);
  }

  function getSwordSegment(gripOut, tipOut, elbowOut) {
    const blade = swordRig.sword.children[0] || swordRig.sword;
    blade.updateWorldMatrix(true, false);
    _swordDir.set(0, 1, 0).transformDirection(blade.matrixWorld).normalize();
    swordRig.sword.getWorldPosition(gripOut);
    let bladeLen = SWORD_BLADE_LENGTH;
    if (controller.attackKind === 'light' && controller.comboStage >= 2) {
      bladeLen += ATTACK3_BLADE_EXTRA;
      // 踏み込み分さらに前方へ延長
      const fwd = new THREE.Vector3(-Math.sin(controller.yaw), 0, -Math.cos(controller.yaw));
      tipOut.copy(gripOut).addScaledVector(_swordDir, bladeLen).addScaledVector(fwd, 0.55);
    } else {
      tipOut.copy(gripOut).addScaledVector(_swordDir, bladeLen);
    }

    if (swordRig.rightForearmBone) {
      swordRig.rightForearmBone.getWorldPosition(elbowOut);
    } else if (swordRig.handBone) {
      swordRig.handBone.getWorldPosition(elbowOut);
      elbowOut.addScaledVector(_swordDir, -0.35);
    } else {
      elbowOut.copy(gripOut);
    }
  }

  // 攻撃中は前腕→手首→刃先の2線分と敵胴体球の距離で判定する(振っている腕全体を使う)
  function attackDamageForKind(kind) {
    if (kind === 'critical') return CRITICAL_DAMAGE;
    if (kind === 'heavy') return HEAVY_ATTACK_DAMAGE;
    if (kind === 'jump') return JUMP_ATTACK_DAMAGE;
    if (kind === 'kick') return KICK_DAMAGE;
    return LIGHT_ATTACK_DAMAGE;
  }

  function buildHitOptions() {
    const kind = controller.attackKind;
    const forward = new THREE.Vector3(-Math.sin(controller.yaw), 0, -Math.cos(controller.yaw));
    // 軽攻撃1発目のみノックバックなし。2発目以降は弾く
    if (kind === 'light' && controller.comboStage < 1) {
      return { stagger: false, knockback: null, stanceDmg: stanceDamageForAttack(kind, controller.comboStage) };
    }
    let force = FINISHER_KNOCKBACK;
    if (kind === 'heavy' || kind === 'critical') force = HEAVY_KNOCKBACK;
    else if (kind === 'jump') force = JUMP_KNOCKBACK;
    else if (kind === 'kick') force = KICK_KNOCKBACK;
    else if (kind === 'light') force = controller.comboStage >= 2 ? FINISHER_KNOCKBACK : LIGHT_KNOCKBACK;
    return {
      stagger: true,
      forceStagger: kind === 'kick' || kind === 'jump' || kind === 'heavy' || kind === 'critical',
      knockback: forward.multiplyScalar(force),
      stanceDmg: stanceDamageForAttack(kind, controller.comboStage),
    };
  }

  function applyDamageToEnemy(target, damage, opts) {
    const stanceDmg = opts.stanceDmg ?? stanceDamageForAttack(controller.attackKind, controller.comboStage);
    const broken = applyStanceDamage(target, stanceDmg, {
      forceBreak: opts.forceStagger && controller.attackKind === 'kick',
    });

    let hitOpts = { ...opts };
    if (target.action === 'attack' && !hitOpts.forceStagger) {
      // ミキサーの実再生時間から算出したtがあればそちらを優先する(見た目のポーズと一致する)
      let t = target._lastAttackT;
      if (t == null) {
        const elapsed = target.actionStartedAt
          ? (performance.now() - target.actionStartedAt) / 1000
          : 0;
        const dur = target.attackDuration || 1;
        t = elapsed / dur;
      }
      if (inHyperArmorWindow(target, t)) {
        hitOpts.stagger = false;
      }
    }
    if (broken) {
      hitOpts.forceStagger = true;
      hitOpts.stagger = true;
    }

    const beforeHp = target.hp;
    target.takeDamage(damage, hitOpts);
    if (controller.attackKind === 'critical' || (broken && target.openForCritical === false)) {
      target.openForCritical = false;
    }
    if (broken) {
      target.openForCritical = true;
      target.stanceBroken = true;
      if (target.action !== 'dead') {
        target.action = 'hit';
        target.actionStartedAt = performance.now();
        target.speed = 0;
        target.animator?.trigger?.('hit');
      }
    }
    shareAggro(enemies, target, controller.position);
    if (target.hp < beforeHp) {
      hitStop.trigger(
        controller.attackKind === 'heavy' || controller.attackKind === 'critical'
          ? HITSTOP_HEAVY
          : HITSTOP_LIGHT,
      );
      return true;
    }
    return target.hp < beforeHp || broken;
  }

  function tryHitEnemy({ oncePerEnemy = false } = {}) {
    getSwordSegment(_swordGrip, _swordTip, _elbowPos);

    let target = null;
    let bestDist = Infinity;
    const candidates = lockTarget?.alive ? [lockTarget, ...enemies] : enemies;
    for (const enemy of candidates) {
      if (!enemy.alive || enemy.action === 'fly') continue;
      if (oncePerEnemy && heavyHitEnemies.has(enemy)) continue;
      const hurtH = enemy.hurtboxHeight ?? ENEMY_HURTBOX_HEIGHT;
      const hurtR = enemy.hurtboxRadius ?? ENEMY_HURTBOX_RADIUS_DEFAULT;
      _enemyCenter.set(enemy.position.x, enemy.position.y + hurtH, enemy.position.z);
      const dist = distancePointToArm(_enemyCenter, _elbowPos, _swordGrip, _swordTip);
      let hitR = WEAPON_HIT_RADIUS + hurtR;
      if (controller.attackKind === 'light' && controller.comboStage >= 2) {
        hitR += ATTACK3_HIT_RADIUS_BONUS;
      }
      if (dist > hitR) continue;
      if (lockTarget && enemy === lockTarget) {
        target = enemy;
        break;
      }
      if (dist < bestDist) {
        bestDist = dist;
        target = enemy;
      }
    }
    if (!target) return false;
    if (oncePerEnemy) heavyHitEnemies.add(target);
    let damage = attackDamageForKind(controller.attackKind);
    if (controller.attackKind === 'critical' || target.openForCritical) {
      damage = Math.max(damage, CRITICAL_DAMAGE);
      target.openForCritical = false;
      target.stanceBroken = false;
      target.stance = 0;
    }
    applyDamageToEnemy(target, damage, buildHitOptions());
    audio.play('slashHit7', {
      volume: controller.attackKind === 'heavy' || controller.attackKind === 'critical' ? 1.0 : 0.85,
      pitch: controller.attackKind === 'heavy' ? 0.92 : 1,
      pitchVariance: 0.06,
    });
    target.hitFlash?.trigger();
    const sparkH = target.hurtboxHeight ?? HIT_SPARK_HEIGHT;
    spawnHitSpark(scene, new THREE.Vector3(target.position.x, target.position.y + sparkH, target.position.z));
    return true;
  }

  function drawVolume(v) {
    if (v.kind === 'sphere') {
      hitboxDebug.sphere(v.center, v.radius, { team: v.team, active: v.active, hurt: v.hurt });
    } else if (v.kind === 'capsule') {
      hitboxDebug.capsule(v.a, v.b, v.radius, { team: v.team, active: v.active });
    } else if (v.kind === 'cone') {
      hitboxDebug.cone(v.origin, v.dir, v.length, v.halfAngle, { team: v.team, active: v.active });
    }
  }

  function playerAttackActive(t) {
    if (controller.attackKind === 'heavy') {
      return t >= HEAVY_HIT_WINDOW_START && t <= HEAVY_HIT_WINDOW_END;
    }
    if (controller.attackKind === 'kick') return t >= KICK_HIT_IMPACT_T && t <= KICK_HIT_IMPACT_T + 0.2;
    if (controller.attackKind === 'jump') return t >= JUMP_HIT_IMPACT_T && t <= JUMP_HIT_IMPACT_T + 0.2;
    return t >= LIGHT_HIT_IMPACT_T && t <= LIGHT_HIT_IMPACT_T + 0.2;
  }

  /** 敵味方の攻撃判定＋受け側hurtboxを色分け表示 */
  function updateHitboxDebug() {
    // 無効時はVector3生成や全敵ループそのものを省略する(既定で無効)
    if (!hitboxDebug.enabled) return;
    hitboxDebug.begin();

    // プレイヤー受け側
    hitboxDebug.sphere(
      new THREE.Vector3(
        controller.position.x,
        controller.position.y + 1.0,
        controller.position.z,
      ),
      0.4,
      { hurt: true, active: true },
    );

    // 敵受け側
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const hurtH = enemy.hurtboxHeight ?? ENEMY_HURTBOX_HEIGHT;
      const hurtR = enemy.hurtboxRadius ?? ENEMY_HURTBOX_RADIUS_DEFAULT;
      hitboxDebug.sphere(
        new THREE.Vector3(enemy.position.x, enemy.position.y + hurtH, enemy.position.z),
        hurtR,
        { hurt: true, active: true },
      );
    }

    // プレイヤー攻撃
    if (controller.action === 'attack') {
      const t = controller.actionTimer / controller.attackDuration;
      const active = playerAttackActive(t);
      if (controller.attackKind === 'kick') {
        const forward = new THREE.Vector3(-Math.sin(controller.yaw), 0, -Math.cos(controller.yaw));
        const kickPos = controller.position.clone().addScaledVector(forward, KICK_REACH);
        kickPos.y += 0.55;
        hitboxDebug.sphere(kickPos, KICK_HIT_RADIUS, { team: 'player', active });
      } else {
        getSwordSegment(_swordGrip, _swordTip, _elbowPos);
        let hitR = WEAPON_HIT_RADIUS;
        if (controller.attackKind === 'light' && controller.comboStage >= 2) {
          hitR += ATTACK3_HIT_RADIUS_BONUS;
        }
        hitboxDebug.capsule(_elbowPos, _swordGrip, hitR, { team: 'player', active });
        hitboxDebug.capsule(_swordGrip, _swordTip, hitR, { team: 'player', active });
      }
    }

    // 敵攻撃
    for (const enemy of enemies) {
      if (!enemy.alive || !enemy.getDebugHitVolumes) continue;
      for (const v of enemy.getDebugHitVolumes()) drawVolume(v);
    }

    hitboxDebug.end();
  }

  // キック: 前方の脚位置で判定。必ずのけぞり＋ノックバック
  function tryKickEnemy() {
    const forward = new THREE.Vector3(-Math.sin(controller.yaw), 0, -Math.cos(controller.yaw));
    const kickPos = controller.position.clone().addScaledVector(forward, KICK_REACH);
    kickPos.y += 0.55;

    let target = null;
    let bestDist = Infinity;
    const candidates = lockTarget?.alive ? [lockTarget, ...enemies] : enemies;
    for (const enemy of candidates) {
      if (!enemy.alive || enemy.action === 'fly') continue;
      const hurtH = enemy.hurtboxHeight ?? ENEMY_HURTBOX_HEIGHT;
      const hurtR = enemy.hurtboxRadius ?? ENEMY_HURTBOX_RADIUS_DEFAULT;
      _enemyCenter.set(enemy.position.x, enemy.position.y + hurtH * 0.55, enemy.position.z);
      const dist = kickPos.distanceTo(_enemyCenter);
      if (dist > KICK_HIT_RADIUS + hurtR) continue;
      if (lockTarget && enemy === lockTarget) {
        target = enemy;
        break;
      }
      if (dist < bestDist) {
        bestDist = dist;
        target = enemy;
      }
    }
    if (!target) return false;
    applyDamageToEnemy(target, KICK_DAMAGE, {
      stagger: true,
      forceStagger: true,
      knockback: forward.clone().multiplyScalar(KICK_KNOCKBACK),
      stanceDmg: stanceDamageForAttack('kick'),
    });
    audio.play('kickCloth1', { volume: 0.95, pitchVariance: 0.05 });
    target.hitFlash?.trigger();
    spawnHitSpark(scene, new THREE.Vector3(target.position.x, target.position.y + 0.7, target.position.z));
    return true;
  }

  // HPバーに表示する敵は、ロック中 or 索敵中(chase)のみ
  function isEnemyEngaged(enemy) {
    return (
      enemy.state === 'chase' ||
      enemy.action === 'attack' ||
      enemy.action === 'windup' ||
      enemy.action === 'hit'
    );
  }

  function pickDisplayEnemy() {
    if (lockTarget?.alive) return lockTarget;
    let best = null;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (enemy.state !== 'chase' && enemy.action !== 'attack' && enemy.action !== 'windup' && !enemy.stanceBroken) continue;
      const dist = enemy.position.distanceTo(controller.position);
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }
    return best;
  }

  // プレイヤー⇔敵、敵⇔敵の円押し出し。大きめの敵ほど動きにくい
  function resolveBodyCollisions(player, enemyList) {
    const pR = player.bodyRadius ?? 0.38;
    for (const enemy of enemyList) {
      if (!enemy.alive || enemy.action === 'dead' || enemy.action === 'fly') continue;
      const eR = enemy.bodyRadius ?? 0.4;
      // 大きい敵ほど動かず、プレイヤー側が押し出される
      const sep = separateCircles(
        player.position.x, player.position.z, pR,
        enemy.position.x, enemy.position.z, eR,
        eR, pR,
      );
      if (!sep.separated) continue;
      player.position.x = sep.ax;
      player.position.z = sep.az;
      enemy.position.x = sep.bx;
      enemy.position.z = sep.bz;
    }

    // 敵同士も軽く押し出す
    for (let i = 0; i < enemyList.length; i++) {
      const a = enemyList[i];
      if (!a.alive || a.action === 'dead' || a.action === 'fly') continue;
      for (let j = i + 1; j < enemyList.length; j++) {
        const b = enemyList[j];
        if (!b.alive || b.action === 'dead' || b.action === 'fly') continue;
        const aR = a.bodyRadius ?? 0.4;
        const bR = b.bodyRadius ?? 0.4;
        const sep = separateCircles(
          a.position.x, a.position.z, aR,
          b.position.x, b.position.z, bR,
          bR, aR,
        );
        if (!sep.separated) continue;
        a.position.x = sep.ax;
        a.position.z = sep.az;
        b.position.x = sep.bx;
        b.position.z = sep.bz;
      }
    }

    // 城壁・地面に再解決してルートを同期
    const pResolved = resolveCircleColliders(player.position.x, player.position.z, pR);
    player.position.x = pResolved.x;
    player.position.z = pResolved.z;
    player.position.y = getGroundHeight(player.position.x, player.position.z) + (player.groundYBias || 0);
    player.root.position.copy(player.position);

    for (const enemy of enemyList) {
      if (!enemy.alive) continue;
      // 飛行中は地形コライダーや地面高さの拘束を受けない(ドラゴンの飛行演出用)
      if (enemy.action === 'fly') {
        enemy.root.position.copy(enemy.position);
        continue;
      }
      const eR = enemy.bodyRadius ?? 0.4;
      const resolved = resolveCircleColliders(enemy.position.x, enemy.position.z, eR);
      enemy.position.x = resolved.x;
      enemy.position.z = resolved.z;
      enemy.position.y = getGroundHeight(enemy.position.x, enemy.position.z);
      enemy.root.position.copy(enemy.position);
    }
  }

  // capture.mjs等のテストツールがマウス操作なしでカメラを検証するためのフック
  window.__debug = {
    setCameraYaw: (y) => { thirdPersonCamera.yaw = y; },
    setCameraPitch: (p) => { thirdPersonCamera.pitch = p; },
    teleport: (x, z) => { controller.position.set(x, 0, z); },
    controller,
    enemyAI: minionAI,
    minionAI,
    dragonAI,
    enemies,
    camera,
    thirdPersonCamera,
    characterRoot,
    hitboxDebug,
    getSwordSegment: () => {
      const g = new THREE.Vector3();
      const tp = new THREE.Vector3();
      const e = new THREE.Vector3();
      getSwordSegment(g, tp, e);
      return { grip: g.toArray(), tip: tp.toArray(), elbow: e.toArray() };
    },
    setHitboxDebug: (on) => {
      hitboxDebug.enabled = !!on;
      if (!hitboxDebug.enabled) {
        hitboxDebug.begin();
        hitboxDebug.end();
      }
    },
    stepFrame: (dt) => update(dt),
  };

  function update(rawDt) {
    // ボス撃破時はスローモーション
    if (bossFelledSlowmo > 0) bossFelledSlowmo -= rawDt;
    let dt = bossFelledSlowmo > 0 ? rawDt * 0.28 : rawDt;
    dt = hitStop.scaleDt(dt);

    input.pollGamepad(dt);
    const { dx, dy } = input.consumeMouseDelta();
    thirdPersonCamera.handleMouseDelta(dx, dy);

    // 死亡後は毎フレーム消費して、GAME OVER表示前の暴発を防ぐ(既存の
    // ロール/攻撃入力と同じく「busy中も必ず消費する」方針に合わせる)
    const respawnPressed = input.consumeJustPressed('KeyR');
    const lockPressed = input.consumeJustPressed('KeyF');
    if (gameOverShown) {
      lockTarget = null;
      thirdPersonCamera.setLockFocus(null);
      if (respawnPressed) {
        controller.respawn(PLAYER_SPAWN);
        gameOverScreen.hide();
        gameOverShown = false;
        deathTimer = 0;
        audio.setCombatMusic('explore');
      }
    } else {
      if (lockPressed) {
        if (lockTarget) {
          lockTarget = null;
        } else {
          lockTarget = findLockTarget(controller.position, thirdPersonCamera.yaw, enemies);
        }
      }
      if (shouldBreakLock(controller.position, lockTarget)) {
        lockTarget = null;
      }

      const lockPos = lockTarget ? getLockFocusPosition(lockTarget, lockFocusPos) : null;
      thirdPersonCamera.setLockFocus(lockPos);
      controller.criticalTarget = lockTarget;
      controller.update(dt, input, thirdPersonCamera.yaw, lockPos);

      if (controller.action === 'dead') {
        lockTarget = null;
        thirdPersonCamera.setLockFocus(null);
        deathTimer += dt;
        // 倒れきってから YOU DIED を出す
        if (deathTimer >= controller.deathDuration * GAME_OVER_DEATH_PROGRESS) {
          if (!gameOverShown) {
            gameOverScreen.show();
            gameOverShown = true;
            audio.stopBgm({ fade: 0.4 });
            audio.play('youDied', { volume: 1.0 });
          }
        }
      } else {
        deathTimer = 0;
      }
    }
    const hpBeforeEnemyTurn = controller.hp;
    const stamBeforeEnemyTurn = controller.stamina;
    syncPlayerCombatContext(playerCombatCtx, controller, dt);
    for (const enemy of enemies) {
      // 非戦闘中で十分に離れている野生動物はAI/アニメ更新そのものを省略し、
      // マップ全域に多数配置しても負荷が増えないようにする(見えない距離なので体感差はない)
      if (enemy.isWildlife && enemy.alive && !isEnemyEngaged(enemy)) {
        const dx = enemy.position.x - controller.position.x;
        const dz = enemy.position.z - controller.position.z;
        if (dx * dx + dz * dz > WILDLIFE_SIM_RADIUS_SQ) continue;
      }
      updateEnemyStance(enemy, dt);
      // 回復中は敵が強く狙い、ロール狩りしやすくする
      if (controller.healing) playerCombatCtx.staminaRatio = Math.min(playerCombatCtx.staminaRatio, 0.15);
      enemy.update(
        dt,
        controller.position,
        (damage) => controller.takeDamage(damage, enemy.position, { chipMult: 0.6 }),
        playerCombatCtx,
      );
    }
    // プレイヤーと敵が貫通しないよう体当たりで押し出す
    resolveBodyCollisions(controller, enemies);
    thirdPersonCamera.update(dt, controller.position);
    const tookHp = controller.hp < hpBeforeEnemyTurn;
    const tookStamina = controller.stamina < stamBeforeEnemyTurn - 0.01;
    if (tookHp || (tookStamina && controller.lastHitWasBlocked)) {
      if (controller.lastHitWasBlocked) {
        audio.play('yodguard', { volume: 0.85, pitchVariance: 0.04 });
      } else {
        audio.playRandom(HIT_PLAYER_PUNCH_SOUNDS, { volume: 0.9, pitch: 0.85, pitchVariance: 0.08 });
        audio.playRandom(HIT_PLAYER_THUD_SOUNDS, { volume: 0.8, pitch: 0.75, pitchVariance: 0.08 });
        playerHitFlash.trigger();
      }
      spawnHitSpark(scene, new THREE.Vector3(controller.position.x, controller.position.y + HIT_SPARK_HEIGHT, controller.position.z));
    }
    playerHitFlash.update(dt);
    for (const enemy of enemies) enemy.hitFlash?.update(dt);
    updateHitSparks(dt);
    playerVitals.update(controller.hp, controller.stamina, controller.flasks, controller.maxFlasks);
    const displayEnemy = pickDisplayEnemy();
    enemyHealthBar.update(
      displayEnemy ? displayEnemy.hp : 0,
      !!displayEnemy,
      displayEnemy ? displayEnemy.name : null,
      displayEnemy ? displayEnemy.maxHp : undefined,
      displayEnemy?.stance,
      displayEnemy?.maxStance,
    );

    // 索敵中の敵でBGM分岐: ドラゴン戦闘=ボス曲、その他戦闘=DQ5戦闘曲
    const dragonFighting =
      dragonAI.alive &&
      (dragonAI.state === 'chase' ||
        dragonAI.action === 'attack' ||
        dragonAI.action === 'windup' ||
        dragonAI.action === 'hit');
    const normalFighting = enemies.some(
      (e) =>
        e !== dragonAI &&
        e.alive &&
        (e.state === 'chase' ||
          e.action === 'attack' ||
          e.action === 'windup' ||
          e.action === 'hit'),
    );

    // ドラゴン撃破演出(初回のみ)
    if (!dragonAI.alive && dragonAI.action === 'dead' && !bossFelledPlayed) {
      bossFelledPlayed = true;
      bossFelledSlowmo = 2.8;
      bossFelledReturnMusicAt = performance.now() + 4800;
      audio.stopBgm({ fade: 0.6 });
      audio.playBossVictoryFanfare();
      bossFelledScreen.show(dragonAI.name || 'ドラゴン');
      // 撃破地点に金色の火花を複数出す
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        spawnHitSpark(
          scene,
          new THREE.Vector3(
            dragonAI.position.x + Math.cos(ang) * 1.8,
            dragonAI.position.y + 1.5 + (i % 3) * 0.4,
            dragonAI.position.z + Math.sin(ang) * 1.8,
          ),
        );
      }
      lockTarget = null;
      thirdPersonCamera.setLockFocus(
        new THREE.Vector3(dragonAI.position.x, dragonAI.position.y + 2.2, dragonAI.position.z),
      );
    }

    if (bossFelledReturnMusicAt && performance.now() >= bossFelledReturnMusicAt) {
      bossFelledReturnMusicAt = 0;
      thirdPersonCamera.setLockFocus(null);
      audio.setCombatMusic('explore');
    } else if (!bossFelledReturnMusicAt && !gameOverShown) {
      if (dragonFighting) audio.setCombatMusic('boss');
      else if (normalFighting) audio.setCombatMusic('normal');
      else audio.setCombatMusic('explore');
    }
    if (lockTarget?.alive) {
      getLockFocusPosition(lockTarget, lockFocusPos);
      lockOnMarker.update(camera, lockFocusPos);
    } else {
      lockOnMarker.hide();
    }

    footsteps.update(dt, controller.state);
    if (controller.state === 'roll' && previousControllerState !== 'roll') {
      audio.playEldenRoll();
    }
    if (controller.flaskHealSfxPending) {
      controller.flaskHealSfxPending = false;
      audio.playFlaskHeal();
    }
    previousControllerState = controller.state;

    updateHitboxDebug();

    // 軽攻撃: 命中タイミングで1回。重攻撃: 踏み込み〜振りのウィンドウ中、剣線分で連続判定
    if (controller.action === 'attack') {
      const t = controller.actionTimer / controller.attackDuration;
      if (controller.attackKind === 'heavy') {
        if (controller.attackTriggerId !== hitCheckedTriggerId) {
          hitCheckedTriggerId = controller.attackTriggerId;
          heavyHitEnemies = new Set();
          heavySwingHadHit = false;
          heavySwingPlayedWhiff = false;
        }
        if (t >= HEAVY_HIT_WINDOW_START && t <= HEAVY_HIT_WINDOW_END) {
          if (tryHitEnemy({ oncePerEnemy: true })) heavySwingHadHit = true;
        }
        if (t >= HEAVY_WHIFF_SFX_T && !heavySwingHadHit && !heavySwingPlayedWhiff) {
          heavySwingPlayedWhiff = true;
          audio.play('bokutoSwing', {
            volume: 0.9,
            pitch: 0.9,
            pitchVariance: 0.05,
          });
        }
      } else if (controller.attackKind === 'kick') {
        if (controller.attackTriggerId !== hitCheckedTriggerId && t >= KICK_HIT_IMPACT_T) {
          hitCheckedTriggerId = controller.attackTriggerId;
          if (!tryKickEnemy()) {
            audio.play('kickCloth1', { volume: 0.55, pitch: 1.05, pitchVariance: 0.04 });
          }
        }
      } else if (controller.attackKind === 'jump') {
        if (controller.attackTriggerId !== hitCheckedTriggerId && t >= JUMP_HIT_IMPACT_T) {
          hitCheckedTriggerId = controller.attackTriggerId;
          const hit = tryHitEnemy();
          if (!hit) {
            audio.play('bokutoSwing', { volume: 0.85, pitch: 0.95, pitchVariance: 0.05 });
          }
        }
      } else if (controller.attackTriggerId !== hitCheckedTriggerId && t >= LIGHT_HIT_IMPACT_T) {
        hitCheckedTriggerId = controller.attackTriggerId;
        const hit = tryHitEnemy();
        if (!hit) {
          audio.play('bokutoSwing', {
            volume: 0.75,
            pitch: 1,
            pitchVariance: 0.05,
          });
        }
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
      blocking: controller.blocking,
      lockOn: !!lockTarget,
      hp: Number(controller.hp.toFixed(1)),
      action: controller.action,
      // enemyは互換用に野盗を指す。全体はenemiesを参照する
      enemy: {
        hp: Number(minionAI.hp.toFixed(1)),
        alive: minionAI.alive,
        action: minionAI.action,
        position: {
          x: Number(minionAI.position.x.toFixed(2)),
          z: Number(minionAI.position.z.toFixed(2)),
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
