import * as THREE from 'three';
import { getGroundHeight, resolveCircleColliders } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';
import { SoulsMeleeBrain } from './soulsCombat.js';

// ドラゴン基本パラメータ
const DETECT_RADIUS = 22;
const LOSE_RADIUS = 30;
const WANDER_RADIUS = 5;
const BODY_RADIUS = 2.2;

const WALK_SPEED = 2.8;
const CHASE_SPEED = 5.0;
const CHASE_SPEED_P2 = 6.8;
const TURN_LAMBDA = 3.5;
const ACCEL_LAMBDA = 5;
const IDLE_PAUSE_RANGE = [1.5, 3.0];

const ENEMY_MAX_HP = 280;

// ---- 攻撃パラメータ ----
const BITE_DAMAGE = 28;
const BITE_RANGE = 5.5;
const BITE_COOLDOWN = 2.2;
const BITE_IMPACT_T = 0.28;
const BITE_IMPACT_END = 0.55;
const BITE_RADIUS = 2.0;

const CLAW_DAMAGE = 24;
const CLAW_RANGE = 6.0;
const CLAW_COOLDOWN = 2.8;
const CLAW_IMPACT_T = 0.25;
const CLAW_IMPACT_END = 0.65;
const CLAW_ARM_RADIUS = 2.4;

const SWIPE_DAMAGE = 22;
const SWIPE_RANGE = 6.5;
const SWIPE_COOLDOWN = 3.2;
const SWIPE_IMPACT_T = 0.2;
const SWIPE_IMPACT_END = 0.75;
const SWIPE_ARM_RADIUS = 2.6;

const TAIL_DAMAGE = 18;
const TAIL_RANGE = 6.5;
const TAIL_COOLDOWN = 4.0;
const TAIL_IMPACT_T = 0.35;
const TAIL_IMPACT_END = 0.8;
const TAIL_RADIUS = 2.2;

const CHARGE_DAMAGE = 38;
const CHARGE_TRIGGER_DIST = 12;
const CHARGE_COOLDOWN = 6.0;
const CHARGE_SPEED = 14.0;
const CHARGE_DURATION = 0.7;
const CHARGE_HIT_RADIUS = 2.4;

const SLAM_DAMAGE = 45;
const SLAM_RANGE = 5.0;
const SLAM_COOLDOWN = 5.5;
const SLAM_IMPACT_T = 0.35;
const SLAM_IMPACT_END = 0.75;
const SLAM_ARM_RADIUS = 2.8;

const ROAR_DAMAGE = 16;
const ROAR_RANGE = 7.5;
const ROAR_COOLDOWN = 7.0;
const ROAR_IMPACT_T = 0.3;
const ROAR_IMPACT_END = 0.85;
const ROAR_RADIUS = 3.5;

const ATTACK_TIME_SCALE = 1.8;
const HIT_STUN_DURATION = 0.7;
const PLAYER_HURTBOX_HEIGHT = 1.0;
const PLAYER_HURTBOX_RADIUS = 0.4;

/** 攻撃タイプ → 再生するアニメートステート */
const ATTACK_ANIM = {
  bite: 'attack',
  claw: 'attack2',
  swipe: 'attackSwipe',
  slam: 'attackSlam',
  tail: 'attackTail',
  roar: 'attackRoar',
  charge: 'attack',
};

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

    // 頭・両腕チェーン・尻尾チェーン
    this.headBone = findBoneByIncludes(root, ['Head_011', 'Head']);
    this.leftArmBones = [
      findBoneByIncludes(root, ['L-UpperArm_038', 'L-UpperArm']),
      findBoneByIncludes(root, ['L-Forearm_039', 'L-Forearm']),
      findBoneByIncludes(root, ['L-Hand_040', 'L-Hand']),
    ].filter(Boolean);
    this.rightArmBones = [
      findBoneByIncludes(root, ['R-UpperArm_053', 'R-UpperArm']),
      findBoneByIncludes(root, ['R-Forearm_054', 'R-Forearm']),
      findBoneByIncludes(root, ['R-Hand_055', 'R-Hand']),
    ].filter(Boolean);
    this.armBones = [...this.leftArmBones, ...this.rightArmBones];
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
    this._isCharging = false;
    this._chargeTimer = 0;
    this._chargeDir = new THREE.Vector3();
    this._savedPlayerPos = new THREE.Vector3();

    this._cooldowns = {
      bite: 0,
      claw: 1.2,
      swipe: 2.0,
      tail: 2.5,
      charge: 4,
      slam: 4,
      roar: 5,
    };

    this.knockback = new THREE.Vector3();
    this.deathTimer = 0;
    this.deathDuration = 7.0;

    // ソウル系: 間合い・溜め・ロール狩り・攻撃後隙
    this._patience = 0.6;
    this._strafeSign = Math.random() < 0.5 ? 1 : -1;
    this._strafeTimer = 0;
    this._recoverTimer = 0;
    this._comboLeft = 0;
    this._preferType = null;
    this._hitLanded = false;
    this._trackLock = false;
    this.brain = new SoulsMeleeBrain({
      preferredRange: 5.2,
      attackRange: 6.0,
      closeRange: 3.2,
      engageRange: 14,
      aggression: 0.55,
      poiseMax: 120,
      rollCatchChance: 0.85,
      punishChance: 0.75,
      delayedChance: 0.35,
      facingYawOffset: Math.PI,
    });
  }

  get phase() {
    return this.hp / this.maxHp < 0.5 ? 2 : 1;
  }

  update(dt, playerPosition, onPlayerHit, playerCtx = null) {
    if (this.action === 'dead') {
      this._updateDeath(dt);
      return;
    }

    for (const k of Object.keys(this._cooldowns)) {
      if (this._cooldowns[k] > 0) this._cooldowns[k] -= dt;
    }
    if (this._recoverTimer > 0) this._recoverTimer -= dt;
    if (this._patience > 0) this._patience -= dt;

    if (this.knockback.lengthSq() > 1e-4) {
      this.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.max(0, 1 - 5 * dt));
    }

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
    }

    this.position.y = getGroundHeight(this.position.x, this.position.z);
    const resolved = resolveCircleColliders(this.position.x, this.position.z, BODY_RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.z;
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
      }
    } else if (dist < DETECT_RADIUS) {
      this.state = 'chase';
      this.brain.resetCombat();
      this._patience = 0.5 + Math.random() * 0.7;
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
    this.animator.setState('walk');
  }

  _updateChase(dt, playerPosition, dist, playerCtx = null) {
    const chaseSpeed = this.phase === 2 ? CHASE_SPEED_P2 : CHASE_SPEED;
    const ctx = playerCtx || { position: playerPosition };

    // ロール着地 / 攻撃後隙を見て優先攻撃をキュー
    this._considerPlayerReads(ctx, dist);

    if (this._recoverTimer > 0) {
      // 攻撃後は回り込みで間合いを取り直す
      this._strafeAround(dt, playerPosition, WALK_SPEED * 0.9);
      this.animator.setState('walk');
      return;
    }

    // コンボ継続
    if (this._comboLeft > 0 && dist <= CLAW_RANGE + 0.5) {
      if (this._tryPickAttack(playerPosition, dist, true)) return;
    }

    if (this.phase === 2 && dist > CHARGE_TRIGGER_DIST && this._cooldowns.charge <= 0) {
      this._startAttack(playerPosition, 'charge', ctx);
      return;
    }

    // 間合い内でもすぐ殴らず、溜めてからコミット（FromSoft的な溜め）
    const inThreat = dist <= SWIPE_RANGE;
    if (inThreat && (this._patience <= 0 || this._preferType)) {
      if (this._tryPickAttack(playerPosition, dist, false)) return;
    }

    if (dist > BITE_RANGE + 1.5) {
      const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
      dir.y = 0;
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        this._moveTowards(dir, chaseSpeed, dt);
      }
      this.animator.setState('run');
      return;
    }

    // 好みの間合いでストレイフ
    this._strafeAround(dt, playerPosition, WALK_SPEED * 1.15);
    this.animator.setState('walk');
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

  _considerPlayerReads(playerCtx, dist) {
    if (!playerCtx || this._preferType) return;
    if (playerCtx.rollEndedAgo < 0.7 && dist <= CLAW_RANGE + 1.5 && Math.random() < 0.12) {
      // ロール狩り: 遅延爪 or 薙ぎ
      this._preferType = Math.random() < 0.5 ? 'claw' : 'swipe';
      this._patience = 0;
      return;
    }
    if (playerCtx.attackEndedAgo < 0.55 && dist <= BITE_RANGE + 1 && Math.random() < 0.1) {
      this._preferType = 'bite';
      this._patience = 0;
      return;
    }
    if (playerCtx.blocking && dist <= SLAM_RANGE && this._cooldowns.slam <= 0 && Math.random() < 0.04) {
      this._preferType = this.phase === 2 ? 'slam' : 'swipe';
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
      const chain = ['claw', 'swipe', 'bite', 'tail'].find((t) => this._cooldowns[t] <= 0);
      if (chain) {
        this._startAttack(playerPosition, chain);
        return true;
      }
    }

    if (this.phase === 2 && dist <= SLAM_RANGE && this._cooldowns.slam <= 0 && Math.random() < 0.55) {
      this._startAttack(playerPosition, 'slam');
      return true;
    }
    if (this.phase === 2 && dist <= ROAR_RANGE && this._cooldowns.roar <= 0 && Math.random() < 0.3) {
      this._startAttack(playerPosition, 'roar');
      return true;
    }
    if (dist <= CLAW_RANGE && this._cooldowns.claw <= 0 && Math.random() < 0.4) {
      this._startAttack(playerPosition, 'claw');
      return true;
    }
    if (dist <= SWIPE_RANGE && this._cooldowns.swipe <= 0 && Math.random() < 0.35) {
      this._startAttack(playerPosition, 'swipe');
      return true;
    }
    if (dist <= BITE_RANGE && this._cooldowns.bite <= 0) {
      this._startAttack(playerPosition, 'bite');
      return true;
    }
    if (dist <= TAIL_RANGE && this._cooldowns.tail <= 0 && Math.random() < 0.5) {
      this._startAttack(playerPosition, 'tail');
      return true;
    }
    // 攻撃を見送ったら再び溜める
    this._patience = 0.35 + Math.random() * 0.8;
    return false;
  }

  _moveTowards(dir, targetSpeed, dt) {
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
    this.speed = damp(this.speed, targetSpeed, ACCEL_LAMBDA, dt);
    this.position.addScaledVector(dir, this.speed * dt);
  }

  _startAttack(playerPosition, type, playerCtx = null) {
    this.action = 'attack';
    this.attackType = type;
    this.actionStartedAt = performance.now();
    this._hitApplied = false;
    this._hitLanded = false;
    this._trackLock = false;
    this.speed = 0;
    this._savedPlayerPos.copy(playerPosition);
    this.brain.beginAttack(type === 'charge' ? 'gap' : 'normal');

    const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
    dir.y = 0;
    if (dir.lengthSq() > 1e-4) {
      dir.normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
    }

    const animKey = ATTACK_ANIM[type] || 'attack';
    this._attackAnimKey = animKey;

    // 溜め攻撃: 出だしを遅らせてから加速（見た目の溜め）
    const delayed = type === 'claw' || type === 'swipe' || type === 'slam';
    const scale = delayed ? ATTACK_TIME_SCALE * 0.75 : ATTACK_TIME_SCALE;

    if (type === 'charge') {
      this._isCharging = true;
      this._chargeTimer = CHARGE_DURATION;
      this._chargeDir.copy(dir);
      this.attackDuration = CHARGE_DURATION;
      this.animator.trigger(animKey);
    } else {
      this._isCharging = false;
      const dur = this.animator.getClipDuration(animKey);
      this.attackDuration = (dur > 0.05 ? dur : this.animator.getClipDuration('attack')) / scale;
      this.animator.trigger(animKey);
      const a = this.animator.actions[animKey];
      if (a) a.timeScale = scale;
    }
  }

  _updateAttack(dt, playerPosition, onPlayerHit, playerCtx = null) {
    const elapsed = (performance.now() - this.actionStartedAt) / 1000;
    const t = Math.min(elapsed / this.attackDuration, 1.5);
    const ctx = playerCtx || { position: playerPosition };

    this._playerCenter.set(
      playerPosition.x,
      playerPosition.y + PLAYER_HURTBOX_HEIGHT,
      playerPosition.z,
    );

    // 出始めだけ軽く追尾、その後ロック
    if (!this._isCharging && !this._trackLock && t < 0.28) {
      const targetYaw = Math.atan2(
        -(ctx.position.x - this.position.x),
        -(ctx.position.z - this.position.z),
      );
      this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA * 1.5, dt);
    } else if (t >= 0.28) {
      this._trackLock = true;
    }

    if (this._isCharging) {
      this._chargeTimer -= dt;
      const speed = CHARGE_SPEED * Math.max(0, this._chargeTimer / CHARGE_DURATION);
      this.position.addScaledVector(this._chargeDir, speed * dt);

      if (
        !this._hitApplied &&
        (this._boneHitsPlayer(this.headBone, CHARGE_HIT_RADIUS) ||
          this._chainHitsPlayer(this.armBones, CHARGE_HIT_RADIUS * 0.85))
      ) {
        this._hitApplied = true;
        this._hitLanded = true;
        onPlayerHit?.(CHARGE_DAMAGE);
      }

      if (this._chargeTimer <= 0) {
        this._isCharging = false;
        this._finishAttack('charge');
      }
      return;
    }

    if (!this._hitApplied) {
      const window = this._impactWindow(this.attackType);
      if (t >= window.start && t <= window.end && this._checkAttackBones(onPlayerHit)) {
        this._hitApplied = true;
      }
    }

    if (t >= 1) {
      const a = this.animator.actions[this._attackAnimKey];
      if (a) a.timeScale = 1;
      this._finishAttack(this.attackType);
    }
  }

  _impactWindow(type) {
    switch (type) {
      case 'tail':
        return { start: TAIL_IMPACT_T, end: TAIL_IMPACT_END };
      case 'slam':
        return { start: SLAM_IMPACT_T, end: SLAM_IMPACT_END };
      case 'claw':
        return { start: CLAW_IMPACT_T, end: CLAW_IMPACT_END };
      case 'swipe':
        return { start: SWIPE_IMPACT_T, end: SWIPE_IMPACT_END };
      case 'roar':
        return { start: ROAR_IMPACT_T, end: ROAR_IMPACT_END };
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
      if (this._boneHitsPlayer(this.headBone, BITE_RADIUS)) return land(BITE_DAMAGE);
    } else if (type === 'claw' || type === 'swipe') {
      const r = type === 'claw' ? CLAW_ARM_RADIUS : SWIPE_ARM_RADIUS;
      const dmg = type === 'claw' ? CLAW_DAMAGE : SWIPE_DAMAGE;
      if (
        this._chainHitsPlayer(this.leftArmBones, r) ||
        this._chainHitsPlayer(this.rightArmBones, r)
      ) {
        return land(dmg);
      }
    } else if (type === 'tail') {
      if (this._chainHitsPlayer(this.tailBones, TAIL_RADIUS)) return land(TAIL_DAMAGE);
      if (this.tailBones.length === 0) {
        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const tip = this.position.clone().addScaledVector(forward, -3.2);
        tip.y += 1.2;
        if (tip.distanceTo(this._playerCenter) <= TAIL_RADIUS + 0.8) return land(TAIL_DAMAGE);
      }
    } else if (type === 'slam') {
      if (
        this._chainHitsPlayer(this.leftArmBones, SLAM_ARM_RADIUS) ||
        this._chainHitsPlayer(this.rightArmBones, SLAM_ARM_RADIUS)
      ) {
        return land(SLAM_DAMAGE);
      }
    } else if (type === 'roar') {
      if (
        this._boneHitsPlayer(this.headBone, ROAR_RADIUS) ||
        this.position.distanceTo(this._playerCenter) <= ROAR_RADIUS + 1.5
      ) {
        return land(ROAR_DAMAGE);
      }
    }
    return false;
  }

  _finishAttack(type) {
    this.action = null;
    this.brain.endAttack(this._hitLanded);
    const cd = {
      bite: BITE_COOLDOWN,
      claw: CLAW_COOLDOWN,
      swipe: SWIPE_COOLDOWN,
      tail: TAIL_COOLDOWN,
      charge: CHARGE_COOLDOWN,
      slam: SLAM_COOLDOWN,
      roar: ROAR_COOLDOWN,
    };
    this._cooldowns[type] = cd[type] ?? 3.0;
    this._recoverTimer = 0.45 + Math.random() * 0.55;
    this._patience = 0.4 + Math.random() * 0.7;

    if (this._hitLanded && Math.random() < (this.phase === 2 ? 0.55 : 0.35)) {
      this._comboLeft = 1 + (Math.random() < 0.4 ? 1 : 0);
      this._recoverTimer = 0.12;
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
    if (knockback) this.knockback.copy(knockback);
    if (this.hp <= 0) {
      this._startDeath();
      return;
    }
    if (!stagger && !forceStagger) return;
    // 攻撃中はハイパーアーマー（強攻撃のみ崩せる）
    if (this.action === 'attack' && !forceStagger) return;
    if (this.brain.absorbHit(amount, { forceStagger })) {
      this.action = 'hit';
      this.actionStartedAt = performance.now();
      this.speed = 0;
      this._isCharging = false;
      this._comboLeft = 0;
    }
  }

  _startDeath() {
    this.alive = false;
    this.action = 'dead';
    this.speed = 0;
    this.deathTimer = 0;
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
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET;
  }
}
