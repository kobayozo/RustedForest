import * as THREE from 'three';
import { getGroundHeight, resolveCircleColliders } from '../physics/collision.js';
import { damp, dampAngle, lerp } from '../utils/math.js';
import { SoulsMeleeBrain } from './soulsCombat.js';
import { clampMove } from '../utils/animation.js';
import { createFireBreath } from '../combat/fireBreath.js';
import { CASTLE_ANCHOR, DRAGON_FIELD_ARENA } from '../world/terrain.js';

// ドラゴン基本パラメータ
const DETECT_RADIUS = 22;
const LOSE_RADIUS = 30;
const WANDER_RADIUS = 5;
const BODY_RADIUS = 2.2;

// エンカウント演出: 初回発見時に城の外へ飛び立ち、外周を旋回してから
// 野外アリーナ(DRAGON_FIELD_ARENA)付近へ降り立つ
const FLY_INTRO_DURATION = 7.5;
const FLY_TAKEOFF_FRAC = 0.16;
const FLY_ARC_END_FRAC = 0.78;
const FLY_RADIUS_MARGIN = 14; // 城壁(CASTLE_ANCHOR.radius)からどれだけ外を飛ぶか
const FLY_ALTITUDE = 16;
const FLY_TURN_LAMBDA = 3.2;
// ルート回転のピン留め(pinRootRotation)が骨ごとの対応表を使うよう修正されたことで
// 追加補正が不要になった(実測で内積0.97、旧+90°補正を残すと横向きになるため撤去)
const FLY_YAW_CORRECTION = 0;

const WALK_SPEED = 2.8;
const CHASE_SPEED = 5.0;
const CHASE_SPEED_P2 = 6.8;
const TURN_LAMBDA = 3.5;
const ACCEL_LAMBDA = 5;
const IDLE_PAUSE_RANGE = [1.5, 3.0];

// walk/run は同一クリップ(dragon_walk)の使い回しのため、実速度に応じてtimeScaleを
// 連続的に変える(WALK_SPEEDで再生倍率1.1になるよう校正)。固定倍率だと実移動量と
// 歩行サイクルがズレて足が滑って見える
const WALK_ANIM_REF_SPEED = WALK_SPEED;
const WALK_ANIM_REF_TIMESCALE = 1.1;

const ENEMY_MAX_HP = 280;

// ---- 攻撃パラメータ ----
// 薙ぎ(skill05)／旧skill08 は使わず、噛みつき／爪／叩きつけ／前足接地の吠えブレス／尻尾なぎ払い

const BITE_DAMAGE = 28;
const BITE_RANGE = 5.5;
const BITE_COOLDOWN = 2.2;
// 実測(ボーン距離トレース)で右腕の爪が伸び切るのは t=0.42〜0.76。
// 左腕は判定に使わない(右前足のみに統一)ため、右腕の窓に合わせる
const BITE_IMPACT_T = 0.42;
const BITE_IMPACT_END = 0.76;
const BITE_RADIUS = 1.5;

const CLAW_DAMAGE = 24;
const CLAW_RANGE = 6.2;
const CLAW_COOLDOWN = 2.8;
// 実測(ボーン距離トレース)では、旧窓(0.25〜0.65)の前半(〜0.41)は腕がまだ
// 引き戻っている途中で実際にはプレイヤーから離れていた。右腕が本当に伸び切って
// 掴みかかるのは t=0.44〜0.76 のみだったため、その窓に絞る
const CLAW_IMPACT_T = 0.44;
const CLAW_IMPACT_END = 0.76;
const CLAW_ARM_RADIUS = 1.4;

const SLAM_DAMAGE = 45;
const SLAM_RANGE = 5.5;
const SLAM_COOLDOWN = 5.5;
const SLAM_IMPACT_T = 0.78;
const SLAM_IMPACT_END = 0.96;
const SLAM_ARM_RADIUS = 2.5;
const SLAM_MAX_HAND_Y = 2.6;

const ROAR_DAMAGE = 22;
const ROAR_RANGE = 10.0;
const ROAR_COOLDOWN = 6.5;
// クリップは前足接地のまま口が開ききる直前までに短縮済み(dragonModel.js参照)。
// 開ききった終盤だけを着弾窓にする
const ROAR_IMPACT_T = 0.55;
const ROAR_IMPACT_END = 1.0;
const ROAR_CONE_LENGTH = 11.0;
const ROAR_CONE_HALF = 0.55;
// クリップ自体は一瞬で終わるため、ゆっくり再生してモーションを見せてから
// clampWhenFinishedで最後のポーズ(前足接地・口全開)を保持したままブレスを継続する
const ROAR_SCALE = 0.8;

// 第2の吠えブレス攻撃(旧: 尻尾なぎ払い)。skill09は尻尾を振るモーションではなく、
// 再生後半で浮遊して見える不自然な演出だったため、enrageと同じ前足接地の
// skill02(の後半だけを切り出したクリップ)を使う。roarとはクールダウン・射程を変える
const TAIL_DAMAGE = 32;
const TAIL_RANGE = 7.2;
const TAIL_COOLDOWN = 6.0;
const TAIL_IMPACT_T = 0.55;
const TAIL_IMPACT_END = 1.0;
const TAIL_SCALE = 0.75;

// 尻尾なぎ払い攻撃。専用クリップが無く、skill05は途中で前脚が浮くため使わない。
// idle 接地ポーズのまま尻尾ボーンだけをコードで振ってなぎ払いを作る
const TAILSWING_DAMAGE = 26;
const TAILSWING_RANGE = 6.5;
const TAILSWING_COOLDOWN = 5.0;
const TAILSWING_IMPACT_T = 0.28;
const TAILSWING_IMPACT_END = 0.8;
const TAILSWING_RADIUS = 3.2;
const TAILSWING_SWEEP = Math.PI * 0.7; // 尻尾先端の振り角

// フェーズ2移行演出: HPが半分を切った瞬間に一度だけ、前足接地のまま
// 頭を大きく反らして吠える(未使用だったskill02)。怯まず割り込む
const ENRAGE_DAMAGE = 30;
const ENRAGE_RANGE = 9.0;
const ENRAGE_CONE_HALF = 0.6;
const ENRAGE_IMPACT_T = 0.72;
const ENRAGE_IMPACT_END = 1.0;
const ENRAGE_SCALE = 0.75;

// 攻撃を出すにはこれ以上プレイヤー方向を向いていないといけない(理不尽な瞬間
// 振り向きを防ぎ、背後・側面に回られたら旋回で向き直ってから攻撃させる)
const FACING_ATTACK_MIN_DOT = 0.82; // 約35度以内
const FACE_TURN_LAMBDA = 4.2;

const MAX_MOVE_SPEED = 8.0;

const ATTACK_TIME_SCALE = 1.8;
const HIT_STUN_DURATION = 0.7;
const PLAYER_HURTBOX_HEIGHT = 1.0;
const PLAYER_HURTBOX_RADIUS = 0.4;
const STOMP_INTERVAL = 0.52;

/** 攻撃タイプ → 再生するアニメートステート */
const ATTACK_ANIM = {
  bite: 'attack',
  claw: 'attack2',
  slam: 'attackSlam',
  roar: 'attackRoar',
  tailSwipe: 'attackTail',
  // skill05(attackSwipe)は途中で前脚が浮くため使わず、idle上で尻尾だけ手続き的に振る
  tailSwing: 'idle',
};
const TAILSWING_ANIM_DURATION = 1.15;

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

function findBoneByIncludes(root, needles) {
  let found = null;
  root.traverse((obj) => {
    if (found || !obj.isBone) return;
    const n = obj.name || '';
    if (needles.some((s) => n.includes(s))) found = obj;
  });
  return found;
}

function collectBonesByIncludes(root, needles) {
  const out = [];
  root.traverse((obj) => {
    if (!obj.isBone) return;
    const n = obj.name || '';
    if (needles.some((s) => n.includes(s))) out.push(obj);
  });
  return out;
}

/** 点と線分の最短距離 */
function distPointToSegment(p, a, b, tmp = new THREE.Vector3()) {
  tmp.subVectors(b, a);
  const lenSq = tmp.lengthSq();
  if (lenSq < 1e-8) return p.distanceTo(a);
  let t = ((p.x - a.x) * tmp.x + (p.y - a.y) * tmp.y + (p.z - a.z) * tmp.z) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + tmp.x * t;
  const cy = a.y + tmp.y * t;
  const cz = a.z + tmp.z * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export const MODEL_YAW_OFFSET = Math.PI;

// ドラゴンAI。フェーズ移行・複数攻撃パターン・突進を持つ
export class DragonAI {
  constructor(root, animator, homePosition) {
    this.root = root;
    this.animator = animator;
    this.home = homePosition.clone();
    this.position = homePosition.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.state = 'idle';

    this.wanderTarget = null;
    this.idleTimer = randRange(IDLE_PAUSE_RANGE);

    this.hp = ENEMY_MAX_HP;
    this.maxHp = ENEMY_MAX_HP;
    this.alive = true;
    this.name = 'ドラゴン';
    this.bodyRadius = BODY_RADIUS;

    // 頭・両腕チェーン（指先まで）・尻尾チェーン
    this.headBone = findBoneByIncludes(root, ['Head_011', 'Head']);
    this.leftArmBones = collectBonesByIncludes(root, [
      'L-UpperArm',
      'L-Forearm',
      'L-Hand',
      'L-Finger',
      'L-Thumb',
    ]);
    this.rightArmBones = collectBonesByIncludes(root, [
      'R-UpperArm',
      'R-Forearm',
      'R-Hand',
      'R-Finger',
      'R-Thumb',
      'R-Wing',
      'R_Wing',
    ]);
    if (this.leftArmBones.length === 0) {
      this.leftArmBones = [
        findBoneByIncludes(root, ['L-UpperArm_038', 'L-UpperArm']),
        findBoneByIncludes(root, ['L-Forearm_039', 'L-Forearm']),
        findBoneByIncludes(root, ['L-Hand_040', 'L-Hand']),
      ].filter(Boolean);
    }
    if (this.rightArmBones.length === 0) {
      this.rightArmBones = [
        findBoneByIncludes(root, ['R-UpperArm_053', 'R-UpperArm']),
        findBoneByIncludes(root, ['R-Forearm_054', 'R-Forearm']),
        findBoneByIncludes(root, ['R-Hand_055', 'R-Hand']),
      ].filter(Boolean);
    }
    this.armBones = [...this.leftArmBones, ...this.rightArmBones];
    // 噛みつき/爪(前足の掴みかかり)は手〜指先だけを判定に使う(上腕・前腕は
    // ほとんど動かず、含めると当たり判定が実際の爪より広く/長く残ってしまう)
    this._clawTipBonesL = this.leftArmBones.slice(2, 5);
    if (this._clawTipBonesL.length === 0) this._clawTipBonesL = this.leftArmBones.slice(-2);
    this._clawTipBonesR = this.rightArmBones.slice(2, 5);
    if (this._clawTipBonesR.length === 0) this._clawTipBonesR = this.rightArmBones.slice(-2);
    this.tailBones = collectBonesByIncludes(root, [
      'Bone001_0147',
      'Bone002_0148',
      'Bone003_0149',
      'Bone004_0150',
      'Bone005_0151',
      'Bone006_0152',
      'Bone007_0153',
      'Bone008_0154',
    ]);
    if (this.tailBones.length === 0) {
      const tip = findBoneByIncludes(root, ['Bone008_0154', 'Bone008']);
      if (tip) this.tailBones = [tip];
    }

    this._bonePos = new THREE.Vector3();
    this._bonePosB = new THREE.Vector3();
    this._playerCenter = new THREE.Vector3();

    this.action = null;
    this.attackType = null;
    this._attackAnimKey = 'attack';
    this._hitApplied = false;
    this._savedPlayerPos = new THREE.Vector3();

    this._cooldowns = {
      bite: 0,
      claw: 1.2,
      slam: 3.5,
      roar: 4.0,
      tailSwipe: 2.5,
      tailSwing: 1.8,
    };
    this._tailSwingSign = 1;

    this.knockback = new THREE.Vector3();
    this.deathTimer = 0;
    this.deathDuration = 7.0;

    // ソウル系: 間合い・溜め・ロール狩り・攻撃後隙
    this._patience = 0;
    this._strafeSign = Math.random() < 0.5 ? 1 : -1;
    this._strafeTimer = 0;
    this._recoverTimer = 0;
    this._comboLeft = 0;
    this._preferType = null;
    this._hitLanded = false;
    this._trackLock = false;
    this._maxKnock = 4.0;
    this._breath = null;
    this._sfx = null;
    this._stompTimer = 0;
    this._slamStompPlayed = false;
    this._aggroGrowled = false;

    // エンカウント時の飛行演出
    this._hasFlownIntro = false;
    this._flyElapsed = 0;
    this._flyDuration = FLY_INTRO_DURATION;
    this._hasEnraged = false;
    this._enrageClipDuration = 1;
    this._flyStartAngle = 0;
    this._flySweep = 0;
    this._flyRadius = 0;
    this._flyAltitude = 0;
    this._flyStart = new THREE.Vector3();
    this._flyCenter = new THREE.Vector3();
    this._flyLandPos = new THREE.Vector3();
    this._flyTmp = new THREE.Vector3();

    this.brain = new SoulsMeleeBrain({
      preferredRange: 5.2,
      attackRange: 6.0,
      closeRange: 3.2,
      engageRange: 14,
      aggression: 0.95,
      patienceMin: 0,
      patienceMax: 0,
      poiseMax: 120,
      rollCatchChance: 0.85,
      punishChance: 0.75,
      delayedChance: 0.2,
      recoverTime: [0.05, 0.15],
      repositionChance: 0.15,
      facingYawOffset: Math.PI,
    });
  }

  setSfxHandler(fn) {
    this._sfx = fn;
  }

  _playSfx(kind) {
    this._sfx?.(kind);
  }

  get phase() {
    return this.hp / this.maxHp < 0.5 ? 2 : 1;
  }

  update(dt, playerPosition, onPlayerHit, playerCtx = null) {
    if (this.action === 'dead') {
      this._updateDeath(dt);
      return;
    }
    if (this.action === 'fly') {
      this._updateFlyIntro(dt, playerPosition);
      return;
    }
    if (this.action === 'enrage') {
      this._updateEnrage(dt, playerPosition, onPlayerHit);
      return;
    }

    for (const k of Object.keys(this._cooldowns)) {
      if (this._cooldowns[k] > 0) this._cooldowns[k] -= dt;
    }
    if (this._recoverTimer > 0) this._recoverTimer -= dt;
    if (this._patience > 0) this._patience -= dt;

    if (this.knockback.lengthSq() > 1e-4) {
      if (this.knockback.length() > this._maxKnock) this.knockback.setLength(this._maxKnock);
      const step = this.knockback.clone().multiplyScalar(dt);
      const capped = clampMove(step.x, step.z, MAX_MOVE_SPEED * dt);
      this.position.x += capped.dx;
      this.position.z += capped.dz;
      this.knockback.multiplyScalar(Math.max(0, 1 - 8 * dt));
    }

    this._updateBreath(dt);

    if (this.action === 'attack') {
      this.animator.update(dt);
      this._syncRoot();
      this.root.updateMatrixWorld(true);
      this._updateAttack(dt, playerPosition, onPlayerHit, playerCtx);
      this.position.y = getGroundHeight(this.position.x, this.position.z);
      const resolved = resolveCircleColliders(this.position.x, this.position.z, BODY_RADIUS);
      this.position.x = resolved.x;
      this.position.z = resolved.z;
      this._syncRoot();
      return;
    } else if (this.action === 'hit') {
      this._updateHit();
    } else {
      this._updateMove(dt, playerPosition, playerCtx);
      this._updateMoveSfx(dt);
    }

    // _updateMove内でこのフレーム中に飛行演出が始まった場合、地面/コライダー
    // 拘束をかけると離陸できないためスキップする(次フレームは冒頭のfly分岐で処理)
    if (this.action !== 'fly') {
      this.position.y = getGroundHeight(this.position.x, this.position.z);
      const resolved = resolveCircleColliders(this.position.x, this.position.z, BODY_RADIUS);
      this.position.x = resolved.x;
      this.position.z = resolved.z;
    }
    this.animator.update(dt);
    this._syncRoot();
  }

  _updateMove(dt, playerPosition, playerCtx = null) {
    const dist = this.position.distanceTo(playerPosition);

    if (this.state === 'chase') {
      if (dist > LOSE_RADIUS) {
        this.state = 'idle';
        this.idleTimer = randRange(IDLE_PAUSE_RANGE);
        this.brain.resetCombat();
        this._aggroGrowled = false;
      }
    } else if (dist < DETECT_RADIUS) {
      this.state = 'chase';
      this.brain.resetCombat();
      this._patience = 0;
      if (!this._aggroGrowled) {
        this._aggroGrowled = true;
        this._playSfx('growl');
        // 初回エンカウントのみ、地上戦の前に城の外を飛んで野外アリーナへ移動する
        if (!this._hasFlownIntro) {
          this._startFlyIntro(playerPosition);
          return;
        }
      }
    }

    if (this.state === 'chase') {
      this._updateChase(dt, playerPosition, dist, playerCtx);
      return;
    }

    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      this.animator.setState('idle');
      if (this.idleTimer <= 0) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * WANDER_RADIUS;
        this.wanderTarget = new THREE.Vector3(
          this.home.x + Math.cos(ang) * r,
          0,
          this.home.z + Math.sin(ang) * r,
        );
      }
      return;
    }

    if (!this.wanderTarget) {
      this.idleTimer = randRange(IDLE_PAUSE_RANGE);
      return;
    }

    const toTarget = new THREE.Vector3().subVectors(this.wanderTarget, this.position);
    toTarget.y = 0;
    if (toTarget.length() < 0.6) {
      this.wanderTarget = null;
      this.idleTimer = randRange(IDLE_PAUSE_RANGE);
      this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      this.animator.setState('idle');
      return;
    }
    toTarget.normalize();
    this._moveTowards(toTarget, WALK_SPEED, dt);
    this._setLocomotionAnim('walk');
  }

  /** 実速度に合わせて歩行/走行アニメの再生速度を連続的に追随させる(足の滑り防止) */
  _setLocomotionAnim(state) {
    const ratio = (this.speed / WALK_ANIM_REF_SPEED) * WALK_ANIM_REF_TIMESCALE;
    this.animator.setLocomotionSpeed(state, ratio);
  }

  _updateChase(dt, playerPosition, dist, playerCtx = null) {
    const chaseSpeed = this.phase === 2 ? CHASE_SPEED_P2 : CHASE_SPEED;
    const ctx = playerCtx || { position: playerPosition };

    // ロール着地 / 攻撃後隙を見て優先攻撃をキュー
    this._considerPlayerReads(ctx, dist);

    if (this._recoverTimer > 0) {
      // 攻撃後は回り込みで間合いを取り直す
      this._strafeAround(dt, playerPosition, WALK_SPEED * 0.9);
      this._setLocomotionAnim('walk');
      return;
    }

    // 攻撃を出したいのに正面を向けていない場合、瞬間振り向きはせずその場で
    // 旋回してから改めてコミットする(背後を取られても即座に反撃してくる理不尽を防ぐ)。
    // ただし尻尾は体の後方に生えているため、側面〜背後に回られている間だけは
    // 旋回の代わりに尻尾なぎ払いで狩れるようにする(旋回でしか狩れないと逆に理不尽)
    const wantsCombo = this._comboLeft > 0 && dist <= CLAW_RANGE + 0.5;
    const inThreat = dist <= CLAW_RANGE + 0.8;
    const wantsAttack = wantsCombo || (inThreat && (this._patience <= 0 || this._preferType));
    if (wantsAttack && this._facingDot(playerPosition) < FACING_ATTACK_MIN_DOT) {
      if (dist <= TAILSWING_RANGE && this._cooldowns.tailSwing <= 0 && this._preferType !== 'tailSwing') {
        this._startAttack(playerPosition, 'tailSwing');
        return;
      }
      this._turnToFace(playerPosition, dt);
      this.animator.setState('idle');
      return;
    }

    // コンボ継続
    if (wantsCombo) {
      if (this._tryPickAttack(playerPosition, dist, true)) return;
    }

    // 間合い内でもすぐ殴らず、溜めてからコミット（FromSoft的な溜め）
    if (inThreat && (this._patience <= 0 || this._preferType)) {
      if (this._tryPickAttack(playerPosition, dist, false)) return;
    }

    if (dist > BITE_RANGE + 1.2) {
      const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
      dir.y = 0;
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        this._moveTowards(dir, chaseSpeed, dt);
      }
      this._setLocomotionAnim('run');
      return;
    }

    // 好みの間合いでストレイフ
    this._strafeAround(dt, playerPosition, WALK_SPEED * 1.15);
    this._setLocomotionAnim('walk');
  }

  /** 初回エンカウント演出: 離陸→城の外周を旋回→野外アリーナ付近へ着地 */
  _startFlyIntro(playerPosition) {
    this.action = 'fly';
    this._hasFlownIntro = true;
    this._flyElapsed = 0;
    this.speed = 0;

    this._flyStart.set(this.position.x, 0, this.position.z);
    this._flyCenter.set(CASTLE_ANCHOR.x, 0, CASTLE_ANCHOR.z);
    const toStart = this._flyTmp.subVectors(this._flyStart, this._flyCenter);
    this._flyStartAngle = Math.atan2(toStart.z, toStart.x);
    this._flySweep = (Math.PI * (1.1 + Math.random() * 0.5)) * (Math.random() < 0.5 ? 1 : -1);
    this._flyRadius = CASTLE_ANCHOR.radius + FLY_RADIUS_MARGIN;
    this._flyAltitude = getGroundHeight(this.position.x, this.position.z) + FLY_ALTITUDE;

    // 着地目標はアリーナ範囲内に収める(城内やアリーナ外にプレイヤーがいても
    // 城壁の中に降りてしまわないようにする)
    this._pickLandingSpot(playerPosition);

    this.animator.trigger('fly');
    this._playSfx('roar');
  }

  /** アリーナ範囲内でプレイヤー方向に一番近い地点を着地目標にする */
  _pickLandingSpot(playerPosition) {
    const ax = DRAGON_FIELD_ARENA.x;
    const az = DRAGON_FIELD_ARENA.z;
    const dx = playerPosition.x - ax;
    const dz = playerPosition.z - az;
    const dist = Math.hypot(dx, dz);
    if (dist <= DRAGON_FIELD_ARENA.radius || dist < 1e-4) {
      this._flyLandPos.set(playerPosition.x, 0, playerPosition.z);
    } else {
      const s = DRAGON_FIELD_ARENA.radius / dist;
      this._flyLandPos.set(ax + dx * s, 0, az + dz * s);
    }
  }

  _updateFlyIntro(dt, playerPosition) {
    this._flyElapsed += dt;
    const u = Math.min(1, this._flyElapsed / this._flyDuration);

    // 着地間際まではプレイヤーの動きを追って着地目標を更新し続ける
    if (u < FLY_ARC_END_FRAC) {
      this._pickLandingSpot(playerPosition);
    }

    const prevX = this.position.x;
    const prevZ = this.position.z;

    if (u < FLY_TAKEOFF_FRAC) {
      // 離陸: その場から上昇しつつ旋回開始地点(城の外周上空)へ移動する
      const p = u / FLY_TAKEOFF_FRAC;
      const ease = p * p * (3 - 2 * p);
      const arcX = this._flyCenter.x + Math.cos(this._flyStartAngle) * this._flyRadius;
      const arcZ = this._flyCenter.z + Math.sin(this._flyStartAngle) * this._flyRadius;
      const startGroundY = getGroundHeight(this._flyStart.x, this._flyStart.z);
      this.position.x = lerp(this._flyStart.x, arcX, ease);
      this.position.z = lerp(this._flyStart.z, arcZ, ease);
      this.position.y = lerp(startGroundY, this._flyAltitude, ease);
    } else if (u < FLY_ARC_END_FRAC) {
      // 城の外周を大きく旋回する
      const p = (u - FLY_TAKEOFF_FRAC) / (FLY_ARC_END_FRAC - FLY_TAKEOFF_FRAC);
      const ang = this._flyStartAngle + this._flySweep * p;
      this.position.x = this._flyCenter.x + Math.cos(ang) * this._flyRadius;
      this.position.z = this._flyCenter.z + Math.sin(ang) * this._flyRadius;
      this.position.y = this._flyAltitude + Math.sin(p * Math.PI * 3) * 0.8;
    } else {
      // 着地: 旋回終了地点からアリーナの着地目標へ降下する
      const p = (u - FLY_ARC_END_FRAC) / (1 - FLY_ARC_END_FRAC);
      const ease = p * p * (3 - 2 * p);
      const endAngle = this._flyStartAngle + this._flySweep;
      const arcX = this._flyCenter.x + Math.cos(endAngle) * this._flyRadius;
      const arcZ = this._flyCenter.z + Math.sin(endAngle) * this._flyRadius;
      const landGroundY = getGroundHeight(this._flyLandPos.x, this._flyLandPos.z);
      this.position.x = lerp(arcX, this._flyLandPos.x, ease);
      this.position.z = lerp(arcZ, this._flyLandPos.z, ease);
      this.position.y = lerp(this._flyAltitude, landGroundY, ease);
    }

    const dx = this.position.x - prevX;
    const dz = this.position.z - prevZ;
    if (dx * dx + dz * dz > 1e-6) {
      const targetYaw = Math.atan2(-dx, -dz);
      this.yaw = dampAngle(this.yaw, targetYaw, FLY_TURN_LAMBDA, dt);
    }

    this.animator.update(dt);
    this._syncRoot();

    if (u >= 1) this._finishFlyIntro();
  }

  _finishFlyIntro() {
    this.action = null;
    this.position.y = getGroundHeight(this.position.x, this.position.z);
    const resolved = resolveCircleColliders(this.position.x, this.position.z, BODY_RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.z;
    this._playSfx('stomp');
    this.state = 'chase';
    this.brain.resetCombat();
    this._patience = 0;
  }

  /** フェーズ2移行: HP半分を切った瞬間に一度だけ、怯まず咆哮して奮起する */
  _startEnrage() {
    this.action = 'enrage';
    this._hasEnraged = true;
    this._hitApplied = false;
    this.speed = 0;
    this.knockback.set(0, 0, 0);
    this._stopBreath();
    this._comboLeft = 0;
    this.brain.resetCombat();

    const dur = this.animator.getClipDuration('enrage');
    this._enrageClipDuration = dur > 0.05 ? dur : 1.0;
    this.animator.trigger('enrage');
    const a = this.animator.actions.enrage;
    if (a) a.timeScale = ENRAGE_SCALE;
    // _startBreathの継続時間計算(attackDuration基準)に合わせるための代用値
    this.attackDuration = this._enrageClipDuration / ENRAGE_SCALE;
    this._startBreath('cone');
    this._playSfx('roar');
  }

  _updateEnrage(dt, playerPosition, onPlayerHit) {
    // update()の'enrage'分岐は_updateBreath(dt)の手前でreturnするため、ここで呼ぶ
    this._updateBreath(dt);
    const action = this.animator.actions.enrage;
    const clipDur = this._enrageClipDuration || 1;
    const t = action ? Math.min(action.time / clipDur, 1.5) : 1;

    this._playerCenter.set(
      playerPosition.x,
      playerPosition.y + PLAYER_HURTBOX_HEIGHT,
      playerPosition.z,
    );

    if (!this._hitApplied && t >= ENRAGE_IMPACT_T && t <= ENRAGE_IMPACT_END) {
      if (this._enrageConeHitsPlayer()) {
        this._hitApplied = true;
        onPlayerHit?.(ENRAGE_DAMAGE);
      }
    }

    this.position.y = getGroundHeight(this.position.x, this.position.z);
    const resolved = resolveCircleColliders(this.position.x, this.position.z, BODY_RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.z;
    this.animator.update(dt);
    this._syncRoot();

    if (t >= 1) {
      if (action) action.timeScale = 1;
      this.action = null;
      this.state = 'chase';
      this.brain.resetCombat();
      this._patience = 0;
      // 直後に同じ咆哮を連発しないよう、通常roarにも少しクールダウンを掛ける
      this._cooldowns.roar = Math.max(this._cooldowns.roar, 1.5);
    }
  }

  /** 奮起の咆哮の円錐判定(通常roarと同じ考え方、射程だけ広め) */
  _enrageConeHitsPlayer() {
    const origin = this._bonePos;
    if (this.headBone) {
      this.headBone.getWorldPosition(origin);
    } else {
      origin.set(this.position.x, this.position.y + 2.8, this.position.z);
    }
    const dx = this._playerCenter.x - origin.x;
    const dy = this._playerCenter.y - origin.y;
    const dz = this._playerCenter.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > ENRAGE_RANGE) return false;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const lenXZ = Math.hypot(dx, dz) || 1;
    const dot = (fx * dx + fz * dz) / lenXZ;
    return dot >= Math.cos(ENRAGE_CONE_HALF) && Math.abs(dy) < 4.0;
  }

  _updateMoveSfx(dt) {
    if (this.state !== 'chase' && this.speed < 0.8) {
      this._stompTimer = 0;
      return;
    }
    if (this.speed < 0.6) return;
    this._stompTimer -= dt;
    if (this._stompTimer <= 0) {
      this._playSfx('stomp');
      this._stompTimer = this.speed > 4 ? STOMP_INTERVAL * 0.75 : STOMP_INTERVAL;
    }
  }

  _strafeAround(dt, playerPosition, speed) {
    this._strafeTimer -= dt;
    if (this._strafeTimer <= 0) {
      this._strafeSign *= -1;
      this._strafeTimer = 0.8 + Math.random() * 1.2;
    }
    const toPlayer = new THREE.Vector3().subVectors(playerPosition, this.position);
    toPlayer.y = 0;
    if (toPlayer.lengthSq() < 1e-4) return;
    toPlayer.normalize();
    const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(this._strafeSign);
    const dist = this.position.distanceTo(playerPosition);
    const radial = dist > 5.5 ? 0.4 : dist < 4.0 ? -0.5 : 0.05;
    const move = toPlayer.multiplyScalar(radial).add(side);
    if (move.lengthSq() > 1e-4) move.normalize();
    this._moveTowards(move, speed, dt);
  }

  /** 正面方向とプレイヤー方向の内積(1=正面, 0=真横, -1=真後ろ) */
  _facingDot(playerPosition) {
    const dx = playerPosition.x - this.position.x;
    const dz = playerPosition.z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    return (fx * dx + fz * dz) / len;
  }

  /** その場で旋回してプレイヤー方向へ向き直る(攻撃の瞬間振り向きを禁止するため) */
  _turnToFace(playerPosition, dt, lambda = FACE_TURN_LAMBDA) {
    const dx = playerPosition.x - this.position.x;
    const dz = playerPosition.z - this.position.z;
    if (dx * dx + dz * dz > 1e-6) {
      const targetYaw = Math.atan2(-dx, -dz);
      this.yaw = dampAngle(this.yaw, targetYaw, lambda, dt);
    }
    this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
  }

  _considerPlayerReads(playerCtx, dist) {
    if (!playerCtx || this._preferType) return;
    if (playerCtx.rollEndedAgo < 0.7 && dist <= CLAW_RANGE + 1.5 && Math.random() < 0.14) {
      this._preferType = Math.random() < 0.55 ? 'claw' : 'bite';
      this._patience = 0;
      return;
    }
    if (playerCtx.attackEndedAgo < 0.55 && dist <= BITE_RANGE + 1 && Math.random() < 0.12) {
      this._preferType = 'bite';
      this._patience = 0;
      return;
    }
    if (playerCtx.blocking && dist <= SLAM_RANGE && this._cooldowns.slam <= 0 && Math.random() < 0.06) {
      this._preferType = this.phase === 2 ? 'slam' : 'claw';
      this._patience = 0;
    }
  }

  _tryPickAttack(playerPosition, dist, forceCombo = false) {
    const prefer = this._preferType;
    this._preferType = null;

    if (prefer && this._cooldowns[prefer] <= 0) {
      this._startAttack(playerPosition, prefer);
      return true;
    }

    if (forceCombo) {
      const chain = ['claw', 'bite', 'slam'].find((t) => this._cooldowns[t] <= 0);
      if (chain) {
        this._startAttack(playerPosition, chain);
        return true;
      }
    }

    // tailSwingは正面を向いた状態からは選ばない(尻尾は背面にあり届かないため。
    // _updateChase側の旋回ゲートで、側面/背後にいるときだけ例外的に発動する)
    if (dist <= TAIL_RANGE && this._cooldowns.tailSwipe <= 0 && Math.random() < 0.3) {
      this._startAttack(playerPosition, 'tailSwipe');
      return true;
    }
    if (dist <= ROAR_RANGE && this._cooldowns.roar <= 0 && Math.random() < (this.phase === 2 ? 0.48 : 0.3)) {
      this._startAttack(playerPosition, 'roar');
      return true;
    }
    if (this.phase === 2 && dist <= SLAM_RANGE && this._cooldowns.slam <= 0 && Math.random() < 0.5) {
      this._startAttack(playerPosition, 'slam');
      return true;
    }
    if (dist <= CLAW_RANGE && this._cooldowns.claw <= 0 && Math.random() < 0.42) {
      this._startAttack(playerPosition, 'claw');
      return true;
    }
    if (dist <= BITE_RANGE && this._cooldowns.bite <= 0) {
      this._startAttack(playerPosition, 'bite');
      return true;
    }
    if (dist <= SLAM_RANGE && this._cooldowns.slam <= 0 && Math.random() < 0.25) {
      this._startAttack(playerPosition, 'slam');
      return true;
    }
    this._patience = 0;
    return false;
  }

  _moveTowards(dir, targetSpeed, dt) {
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
    const speed = Math.min(targetSpeed, MAX_MOVE_SPEED);
    this.speed = damp(this.speed, speed, ACCEL_LAMBDA, dt);
    const step = this.speed * dt;
    const capped = clampMove(dir.x * step, dir.z * step, MAX_MOVE_SPEED * dt);
    this.position.x += capped.dx;
    this.position.z += capped.dz;
  }

  _startAttack(playerPosition, type, playerCtx = null) {
    this.action = 'attack';
    this.attackType = type;
    this.actionStartedAt = performance.now();
    this._hitApplied = false;
    this._hitLanded = false;
    this._trackLock = false;
    this._slamStompPlayed = false;
    this.speed = 0;
    this._savedPlayerPos.copy(playerPosition);
    this.brain.beginAttack('normal');

    // ここで瞬間的に正面を向き直すことはしない(_updateChase側で既にほぼ
    // 正面(FACING_ATTACK_MIN_DOT以内)を確認済み。以降は_updateAttackの
    // 追尾フェーズで微調整するだけにとどめ、不自然な瞬間振り向きを避ける)

    const animKey = ATTACK_ANIM[type] || 'attack';
    this._attackAnimKey = animKey;

    // 溜め攻撃: 出だしを遅らせてから着弾窓で加速する(緩急のあるテレグラフ)。
    // t はミキサーの実再生時間から算出するため、ここで timeScale を動的に変えても
    // 当たり判定のタイミングは常に見た目のポーズと一致する(_updateAttack参照)
    const delayed = type === 'claw' || type === 'slam';
    const scale =
      type === 'roar'
        ? ROAR_SCALE
        : type === 'tailSwipe'
          ? TAIL_SCALE
          : type === 'tailSwing'
            ? 1.1
            : delayed
              ? ATTACK_TIME_SCALE * 0.75
              : ATTACK_TIME_SCALE;
    this._telegraphType = delayed ? type : null;
    this._baseAttackScale = scale;
    if (type === 'tailSwing') this._tailSwingSign = Math.random() < 0.5 ? 1 : -1;

    const dur =
      type === 'tailSwing'
        ? TAILSWING_ANIM_DURATION
        : this.animator.getClipDuration(animKey);
    this._attackClipDuration = dur > 0.05 ? dur : this.animator.getClipDuration('attack');
    this.attackDuration = this._attackClipDuration / scale;
    // tailSwing は idle 接地ポーズ上で尻尾だけ振る。LoopOnceにすると終了後に
    // idle が固まるため、ループのまま短時間だけ使う
    this.animator.trigger(
      animKey,
      type === 'tailSwing' ? { loopOnce: false } : undefined,
    );
    const a = this.animator.actions[animKey];
    if (a) a.timeScale = scale;

    // ハイパーアーマー窓は各攻撃の実際の着弾フレームに合わせて動的に設定する。
    // 固定窓のままだとslam/roarのような大振りの着弾直前〜最中に怯み判定が解けてしまう
    const window = this._impactWindow(type);
    this._hyperArmorUntilT = Math.max(0.04, window.start - 0.12);
    this._hyperArmorEndT = Math.min(1.0, window.end + 0.06);

    if (type === 'roar') {
      this._startBreath('cone');
      this._playSfx('roar');
    } else if (type === 'tailSwipe') {
      // 身体周囲の炎は予備動作(構え)なしにいきなり出ると不自然なので、
      // 咆哮音だけ先に鳴らして溜めを見せ、炎自体はTAIL_IMPACT_Tまで遅らせる
      // (_updateAttackでt>=TAIL_IMPACT_T到達時に着火する)
      this._playSfx('roar');
    } else if (type === 'slam') {
      this._playSfx('roar');
    } else {
      this._playSfx('growl');
    }
  }

  _updateAttack(dt, playerPosition, onPlayerHit, playerCtx = null) {
    const action = this.animator.actions[this._attackAnimKey];
    const clipDur = this._attackClipDuration || this.attackDuration || 1;
    // ヒットストップ/スローモーション中も見た目とズレないよう、実際に再生されている
    // ミキサー時間を基準にtを算出する(wall-clockだと演出中の一瞬で判定が先行してしまう)
    const t = action
      ? Math.min(action.time / clipDur, 1.5)
      : Math.min((performance.now() - this.actionStartedAt) / 1000 / this.attackDuration, 1.5);
    this._lastAttackT = t;
    const ctx = playerCtx || { position: playerPosition };

    // 溜め攻撃のテレグラフ: 着弾窓に入るまでは遅く、窓内〜直後は加速して力強く見せる
    if (action && this._telegraphType === this.attackType) {
      const w = this._impactWindow(this.attackType);
      if (t < w.start) action.timeScale = this._baseAttackScale * 0.55;
      else if (t <= w.end) action.timeScale = this._baseAttackScale * 1.3;
      else action.timeScale = this._baseAttackScale;
    }

    // 尻尾なぎ払い: 専用モーションが無いため、尻尾ボーンをコードで直接振って
    // なぎ払いを作る(根本ほど小さく・先端ほど大きく振れるよう重み付け)
    if (this.attackType === 'tailSwing' && this.tailBones.length > 0) {
      const swingT = Math.min(Math.max(t, 0), 1);
      const angle = Math.sin(swingT * Math.PI) * TAILSWING_SWEEP * this._tailSwingSign;
      for (let i = 0; i < this.tailBones.length; i++) {
        const w = (i + 1) / this.tailBones.length;
        this.tailBones[i].rotation.y = angle * w;
      }
      this.root.updateMatrixWorld(true);
    }

    this._playerCenter.set(
      playerPosition.x,
      playerPosition.y + PLAYER_HURTBOX_HEIGHT,
      playerPosition.z,
    );

    // 出始めだけ軽く追尾、その後ロック（移動はしない）
    if (!this._trackLock && t < 0.22) {
      const targetYaw = Math.atan2(
        -(ctx.position.x - this.position.x),
        -(ctx.position.z - this.position.z),
      );
      this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA * 1.5, dt);
    } else if (t >= 0.22) {
      this._trackLock = true;
    }

    // slam 着地の地響き
    if (this.attackType === 'slam' && !this._slamStompPlayed && t >= SLAM_IMPACT_T) {
      this._slamStompPlayed = true;
      this._playSfx('stomp');
    }

    if (this.attackType === 'tailSwipe' && !this._breath && t >= TAIL_IMPACT_T) {
      this._startBreath('radial');
    }

    if (!this._hitApplied) {
      if (this.attackType === 'tailSwipe') {
        // 口からではなく炎の演出そのものに判定を紐付ける(演出が出ている間だけ当たる)
        if (this._breath && this._checkAttackBones(onPlayerHit)) {
          this._hitApplied = true;
        }
      } else {
        const window = this._impactWindow(this.attackType);
        if (t >= window.start && t <= window.end && this._checkAttackBones(onPlayerHit)) {
          this._hitApplied = true;
        }
      }
    }

    if (t >= 1) {
      if (action) action.timeScale = 1;
      // 咆哮系(roar/tailSwipe)は短いクリップを再生し終えたあとも炎が消えるまで
      // 攻撃を継続する。他の攻撃はクリップの終了=攻撃終了でよい
      if (this.attackType === 'roar' || this.attackType === 'tailSwipe') {
        if (!this._breath) this._finishAttack(this.attackType);
      } else {
        this._finishAttack(this.attackType);
      }
    }
  }

  _impactWindow(type) {
    switch (type) {
      case 'slam':
        return { start: SLAM_IMPACT_T, end: SLAM_IMPACT_END };
      case 'claw':
        return { start: CLAW_IMPACT_T, end: CLAW_IMPACT_END };
      case 'roar':
        return { start: ROAR_IMPACT_T, end: ROAR_IMPACT_END };
      case 'tailSwipe':
        return { start: TAIL_IMPACT_T, end: TAIL_IMPACT_END };
      case 'tailSwing':
        return { start: TAILSWING_IMPACT_T, end: TAILSWING_IMPACT_END };
      default:
        return { start: BITE_IMPACT_T, end: BITE_IMPACT_END };
    }
  }

  _boneHitsPlayer(bone, radius) {
    if (!bone) return false;
    bone.getWorldPosition(this._bonePos);
    return this._bonePos.distanceTo(this._playerCenter) <= radius + PLAYER_HURTBOX_RADIUS;
  }

  /** ボーン鎖に沿ったカプセル判定（上腕〜前腕〜手全体をカバー） */
  _chainHitsPlayer(bones, radius) {
    if (!bones || bones.length === 0) return false;
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      bone.getWorldPosition(this._bonePos);
      if (this._bonePos.distanceTo(this._playerCenter) <= radius + PLAYER_HURTBOX_RADIUS) {
        return true;
      }
      if (i + 1 < bones.length) {
        bones[i + 1].getWorldPosition(this._bonePosB);
        const d = distPointToSegment(this._playerCenter, this._bonePos, this._bonePosB);
        if (d <= radius + PLAYER_HURTBOX_RADIUS) return true;
      }
    }
    return false;
  }

  _checkAttackBones(onPlayerHit) {
    const type = this.attackType;
    const land = (dmg) => {
      this._hitLanded = true;
      onPlayerHit?.(dmg);
      return true;
    };
    if (type === 'bite') {
      // 実クリップ(attack01)は頭でなく右腕を伸ばして掴みかかる動きのため、
      // 頭ボーンでなく右手〜指先のみで判定する(モデル確認済み。左腕はこの窓では
      // 動いておらず、上腕/前腕を含めると実際の爪より広い判定になる)
      if (this._chainHitsPlayer(this._clawTipBonesR, BITE_RADIUS)) {
        return land(BITE_DAMAGE);
      }
    } else if (type === 'claw') {
      // こちらも実測で右腕だけが伸び切ることを確認済み。手〜指先のみ・実際に
      // 伸び切る窓(CLAW_IMPACT_T〜END)だけで判定する
      if (this._chainHitsPlayer(this._clawTipBonesR, CLAW_ARM_RADIUS)) {
        return land(CLAW_DAMAGE);
      }
    } else if (type === 'slam') {
      // 胴体中心からの距離だけで判定すると腕が届いていない前方まで広く当たってしまうため、
      // 実際に振り下ろされている腕ボーン鎖への近接のみで判定する
      if (
        this._slamHandsLow() &&
        (this._chainHitsPlayer(this.leftArmBones, SLAM_ARM_RADIUS) ||
          this._chainHitsPlayer(this.rightArmBones, SLAM_ARM_RADIUS))
      ) {
        return land(SLAM_DAMAGE);
      }
    } else if (type === 'roar') {
      if (this._breathConeHitsPlayer()) return land(ROAR_DAMAGE);
    } else if (type === 'tailSwipe') {
      // 口からの指向性ブレスではなく身体周囲からのバーストなので、向きに関係なく
      // 距離だけで判定する(炎の演出が出ている間だけ_updateAttack側でチェックされる)
      if (this._breathRadialHitsPlayer(TAIL_RANGE)) return land(TAIL_DAMAGE);
    } else if (type === 'tailSwing') {
      if (this._chainHitsPlayer(this.tailBones, TAILSWING_RADIUS)) return land(TAILSWING_DAMAGE);
    }
    return false;
  }

  /** 振り下ろし時だけ手が低い */
  _slamHandsLow() {
    const hands = [];
    if (this.leftArmBones.length) hands.push(this.leftArmBones[this.leftArmBones.length - 1]);
    if (this.rightArmBones.length) hands.push(this.rightArmBones[this.rightArmBones.length - 1]);
    if (hands.length === 0) return true;
    let low = false;
    for (const h of hands) {
      h.getWorldPosition(this._bonePos);
      if (this._bonePos.y <= this.position.y + SLAM_MAX_HAND_Y) low = true;
    }
    return low;
  }

  /** 身体周囲からの炎バーストの判定(向きを問わず距離のみ) */
  _breathRadialHitsPlayer(range) {
    const origin = this._bonePos;
    this.root.getWorldPosition(origin);
    origin.y += 2.6;
    const dist = Math.hypot(
      this._playerCenter.x - origin.x,
      this._playerCenter.y - origin.y,
      this._playerCenter.z - origin.z,
    );
    return dist <= range;
  }

  /** 前方吠えブレスの円錐判定 */
  _breathConeHitsPlayer() {
    const origin = this._bonePos;
    if (this.headBone) {
      this.headBone.getWorldPosition(origin);
    } else {
      origin.set(this.position.x, this.position.y + 2.8, this.position.z);
    }
    const dx = this._playerCenter.x - origin.x;
    const dy = this._playerCenter.y - origin.y;
    const dz = this._playerCenter.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > ROAR_CONE_LENGTH) return false;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const lenXZ = Math.hypot(dx, dz) || 1;
    const dot = (fx * dx + fz * dz) / lenXZ;
    return dot >= Math.cos(ROAR_CONE_HALF) && Math.abs(dy) < 3.2;
  }

  _finishAttack(type) {
    this.action = null;
    this.brain.endAttack(this._hitLanded);
    const cd = {
      bite: BITE_COOLDOWN,
      claw: CLAW_COOLDOWN,
      slam: SLAM_COOLDOWN,
      roar: ROAR_COOLDOWN,
      tailSwipe: TAIL_COOLDOWN,
      tailSwing: TAILSWING_COOLDOWN,
    };
    this._cooldowns[type] = cd[type] ?? 3.0;
    this._recoverTimer = 0.08 + Math.random() * 0.1;
    this._patience = 0;
    this._slamStompPlayed = false;
    this._stopBreath();
    if (type === 'tailSwing') {
      // 振り終わったら尻尾をコード制御前の姿勢(y回転のみ)へ戻す
      for (const b of this.tailBones) b.rotation.y = 0;
    }

    if (this._hitLanded && Math.random() < (this.phase === 2 ? 0.55 : 0.35)) {
      this._comboLeft = 1 + (Math.random() < 0.4 ? 1 : 0);
      this._recoverTimer = 0.05;
      this._patience = 0;
    } else {
      this._comboLeft = 0;
    }
  }

  _updateHit() {
    const t = (performance.now() - this.actionStartedAt) / 1000 / HIT_STUN_DURATION;
    if (t >= 1) this.action = null;
  }

  takeDamage(amount, { stagger = true, forceStagger = false, knockback = null } = {}) {
    if (!this.alive || this.action === 'dead') return;
    this.hp = Math.max(0, this.hp - amount);
    if (knockback) {
      this.knockback.copy(knockback);
      if (this.knockback.length() > this._maxKnock) this.knockback.setLength(this._maxKnock);
    }
    if (this.hp <= 0) {
      this._startDeath();
      return;
    }
    // HPが半分を切った瞬間、一度だけ怯まずに咆哮して奮起する(フェーズ移行演出)
    if (!this._hasEnraged && this.hp / this.maxHp <= 0.5) {
      this._startEnrage();
      return;
    }
    if (!stagger && !forceStagger) return;
    // 攻撃中・奮起中はハイパーアーマー（強攻撃のみ崩せる）
    if ((this.action === 'attack' || this.action === 'enrage') && !forceStagger) return;
    if (this.brain.absorbHit(amount, { forceStagger })) {
      this.action = 'hit';
      this.actionStartedAt = performance.now();
      this.speed = 0;
      this._comboLeft = 0;
    }
  }

  _startDeath() {
    this.alive = false;
    this.action = 'dead';
    this.speed = 0;
    this.deathTimer = 0;
    this._stopBreath();
    this.animator.trigger('death');
  }

  _updateDeath(dt) {
    this.deathTimer += dt;
    this.animator.update(dt);
    this._syncRoot();

    const fadeStart = this.deathDuration * 0.6;
    if (this.deathTimer >= fadeStart) {
      const u = Math.min(1, (this.deathTimer - fadeStart) / (this.deathDuration - fadeStart));
      this.root.traverse((obj) => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.transparent = true;
          mat.opacity = 1 - u;
          mat.depthWrite = u < 0.8;
          mat.needsUpdate = true;
        }
      });
    }
    if (this.deathTimer >= this.deathDuration) {
      this.root.visible = false;
      if (this.root.parent) this.root.parent.remove(this.root);
    }
  }

  _syncRoot() {
    this.root.position.copy(this.position);
    const extra = this.action === 'fly' ? FLY_YAW_CORRECTION : 0;
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET + extra;
  }

  /** デバッグ用: 現在の攻撃ヒットボリューム */
  getDebugHitVolumes() {
    if (this.action !== 'attack' || !this.attackType) return [];
    const t = this._lastAttackT ?? 0;
    // tailSwipeは炎の演出そのものが判定タイミングなので、窓ではなく_breathの有無で見せる
    const active =
      this.attackType === 'tailSwipe'
        ? !!this._breath
        : (() => {
            const window = this._impactWindow(this.attackType);
            return t >= window.start && t <= window.end;
          })();
    const out = [];

    const pushChain = (bones, radius) => {
      if (!bones?.length) return;
      const pts = bones.map((b) => {
        const p = new THREE.Vector3();
        b.getWorldPosition(p);
        return p;
      });
      for (let i = 0; i < pts.length; i++) {
        if (i + 1 < pts.length) {
          out.push({
            kind: 'capsule',
            a: pts[i],
            b: pts[i + 1],
            radius,
            team: 'enemy',
            active,
          });
        } else if (pts.length === 1) {
          out.push({ kind: 'sphere', center: pts[0], radius, team: 'enemy', active });
        }
      }
    };

    const type = this.attackType;
    if (type === 'bite') {
      // 右前足のみで判定(モデル確認済み)
      pushChain(this._clawTipBonesR, BITE_RADIUS);
    } else if (type === 'claw') {
      pushChain(this._clawTipBonesR, CLAW_ARM_RADIUS);
    } else if (type === 'slam') {
      pushChain(this.leftArmBones, SLAM_ARM_RADIUS);
      pushChain(this.rightArmBones, SLAM_ARM_RADIUS);
    } else if (type === 'tailSwing') {
      pushChain(this.tailBones, TAILSWING_RADIUS);
    } else if (type === 'roar') {
      const origin = new THREE.Vector3();
      if (this.headBone) this.headBone.getWorldPosition(origin);
      else origin.set(this.position.x, this.position.y + 2.8, this.position.z);
      out.push({
        kind: 'cone',
        origin,
        dir: new THREE.Vector3(-Math.sin(this.yaw), -0.22, -Math.cos(this.yaw)),
        length: ROAR_CONE_LENGTH,
        halfAngle: ROAR_CONE_HALF,
        team: 'enemy',
        active,
      });
    } else if (type === 'tailSwipe') {
      const origin = new THREE.Vector3();
      this.root.getWorldPosition(origin);
      origin.y += 2.6;
      out.push({ kind: 'sphere', center: origin, radius: TAIL_RANGE, team: 'enemy', active });
    }
    return out;
  }

  /**
   * mode='cone' は口(頭ボーン)から前方へ吐く指向性ブレス。
   * mode='radial' は身体中心から周囲へ広がるバースト(尻尾なぎ払い改め炎バースト用)
   */
  _startBreath(mode = 'cone') {
    this._stopBreath();
    const radial = mode === 'radial';
    const originRef = radial
      ? {
          getWorldPosition: (out) => {
            this.root.getWorldPosition(out);
            out.y += 2.6; // 胴体中央あたりの高さ
            return out;
          },
        }
      : this.headBone;
    this._breath = createFireBreath(this.root, originRef, {
      duration: Math.max(1.25, this.attackDuration * 0.9),
      intensity: this.phase === 2 ? 1.5 : 1.2,
      mode,
      // 地面へ向けて吐き下ろすよう、やや下向きにする(以前はほぼ水平〜わずかに上向きだった)
      getForward: () =>
        new THREE.Vector3(-Math.sin(this.yaw), -0.22, -Math.cos(this.yaw)).normalize(),
    });
  }

  _updateBreath(dt) {
    if (!this._breath) return;
    this._breath.update(dt);
    if (!this._breath.alive) this._breath = null;
  }

  _stopBreath() {
    if (!this._breath) return;
    this._breath.dispose();
    this._breath = null;
  }
}
