import * as THREE from 'three';
import { getGroundHeight, resolveCircleColliders } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';
import { SoulsMeleeBrain, attackProfile } from './soulsCombat.js';

const DETECT_RADIUS = 11;
const LOSE_RADIUS = 16;
const WANDER_RADIUS = 6;
const BODY_RADIUS = 0.35;

const WALK_SPEED = 1.6;
const CHASE_SPEED = 4.0;
const TURN_LAMBDA = 8;
const ACCEL_LAMBDA = 8;
const IDLE_PAUSE_RANGE = [1.5, 3.5];

const ENEMY_MAX_HP = 100;
const ATTACK_DAMAGE = 10;
const HIT_STUN_DURATION = 0.55;
const WEAPON_HIT_RADIUS = 1.25;
const PLAYER_HURTBOX_HEIGHT = 1.0;

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

function findBone(root, name) {
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isBone && obj.name === name) found = obj;
  });
  return found;
}

export const MODEL_YAW_OFFSET = Math.PI;

export class EnemyAI {
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
    this.bodyRadius = BODY_RADIUS;
    this.name = '野盗';

    this.action = null; // null | 'windup' | 'attack' | 'hit' | 'dead'
    this._hitApplied = false;
    this._hitLanded = false;
    this.handBone = findBone(root, 'hand_r');
    this.knockback = new THREE.Vector3();
    this._attackKind = 'normal';
    this._profile = attackProfile('normal');
    this._windupTimer = 0;
    this._lungeDir = new THREE.Vector3();
    this._lungeBudget = 0;

    this.brain = new SoulsMeleeBrain({
      preferredRange: 2.0,
      attackRange: 2.15,
      closeRange: 1.2,
      engageRange: 5.0,
      aggression: 0.5,
      poiseMax: 28,
      delayedChance: 0.28,
      comboChance: 0.38,
      maxCombo: 2,
      facingYawOffset: Math.PI,
    });
  }

  update(dt, playerPosition, onPlayerHit, playerCtx = null) {
    if (this.action === 'dead') {
      this.animator.update(dt);
      return;
    }

    if (this.knockback.lengthSq() > 1e-4) {
      this.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.max(0, 1 - 6 * dt));
    }

    if (this.action === 'windup') {
      this._updateWindup(dt, playerPosition, playerCtx);
    } else if (this.action === 'attack') {
      this._updateAttack(dt, playerPosition, onPlayerHit, playerCtx);
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

  _updateMove(dt, playerPosition, playerCtx) {
    const dist = this.position.distanceTo(playerPosition);
    const ctx = playerCtx || { position: playerPosition };

    if (this.state === 'chase') {
      if (dist > LOSE_RADIUS) {
        this.state = 'idle';
        this.idleTimer = randRange(IDLE_PAUSE_RANGE);
        this.brain.resetCombat();
      }
    } else if (dist < DETECT_RADIUS) {
      this.state = 'chase';
      this.brain.resetCombat();
    }

    if (this.state === 'chase') {
      const decision = this.brain.think(dt, this.position, ctx, dist);
      if (decision.facePlayer) {
        const ty = this.brain.yawTowardPlayer(this.position, ctx);
        this.yaw = dampAngle(this.yaw, ty, TURN_LAMBDA, dt);
      }
      if (decision.attack) {
        this._startWindup(decision.attack, playerPosition, ctx);
        return;
      }
      if (decision.moveDir) {
        const spd =
          (decision.anim === 'run' ? CHASE_SPEED : WALK_SPEED) * decision.speedMult;
        this.speed = damp(this.speed, spd, ACCEL_LAMBDA, dt);
        this.position.addScaledVector(decision.moveDir, this.speed * dt);
      } else {
        this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      }
      this.animator.setState(
        this.speed > 0.08 ? (decision.anim === 'run' ? 'run' : 'walk') : 'idle',
      );
      return;
    }

    this._wander(dt);
    this.animator.setState(this.speed > 0.05 ? 'walk' : 'idle');
  }

  _wander(dt) {
    if (!this.wanderTarget) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * WANDER_RADIUS;
        this.wanderTarget = new THREE.Vector3(
          this.home.x + Math.cos(angle) * dist,
          0,
          this.home.z + Math.sin(angle) * dist,
        );
      } else {
        this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
        return;
      }
    }

    const toTarget = new THREE.Vector3().subVectors(this.wanderTarget, this.position);
    toTarget.y = 0;
    if (toTarget.length() < 0.3) {
      this.wanderTarget = null;
      this.idleTimer = randRange(IDLE_PAUSE_RANGE);
      this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      return;
    }
    toTarget.normalize();
    const targetYaw = Math.atan2(-toTarget.x, -toTarget.z);
    this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
    this.speed = damp(this.speed, WALK_SPEED, ACCEL_LAMBDA, dt);
    this.position.addScaledVector(toTarget, this.speed * dt);
  }

  _startWindup(kind, playerPosition, playerCtx) {
    this._attackKind = kind;
    this._profile = attackProfile(kind);
    this.action = 'windup';
    this._windupTimer = this._profile.windup;
    this.speed = 0;
    this.brain.beginAttack(kind);

    const ctx = playerCtx || { position: playerPosition };
    this.yaw = this.brain.yawTowardPlayer(this.position, ctx);
    const d = new THREE.Vector3().subVectors(
      ctx.position || playerPosition,
      this.position,
    );
    d.y = 0;
    if (d.lengthSq() > 1e-4) this._lungeDir.copy(d.normalize());
    else this._lungeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.animator.setState('idle');
  }

  _updateWindup(dt, playerPosition, playerCtx) {
    const ctx = playerCtx || { position: playerPosition };
    const elapsed = this._profile.windup - this._windupTimer;
    // 予備動作中はプレイヤーを追尾、ロック後は向き固定
    if (elapsed < this._profile.trackUntil) {
      this.yaw = dampAngle(
        this.yaw,
        this.brain.yawTowardPlayer(this.position, ctx),
        TURN_LAMBDA * 1.2,
        dt,
      );
      const d = new THREE.Vector3().subVectors(ctx.position || playerPosition, this.position);
      d.y = 0;
      if (d.lengthSq() > 1e-4) this._lungeDir.copy(d.normalize());
    }
    this._windupTimer -= dt;
    if (this._windupTimer <= 0) this._startAttackSwing();
  }

  _startAttackSwing() {
    this.action = 'attack';
    this.actionStartedAt = performance.now();
    const base = this.animator.getClipDuration('attack') || 0.8;
    this.attackDuration = base / this._profile.timeScale;
    this._hitApplied = false;
    this._hitLanded = false;
    this._lungeBudget = this._profile.lunge;
    this.animator.trigger('attack');
    const a = this.animator.actions.attack;
    if (a) a.timeScale = this._profile.timeScale;
  }

  _updateAttack(dt, playerPosition, onPlayerHit, playerCtx) {
    const t = (performance.now() - this.actionStartedAt) / 1000 / this.attackDuration;
    const ctx = playerCtx || { position: playerPosition };

    // 出始めのみ微追尾
    if (t < 0.15) {
      this.yaw = dampAngle(
        this.yaw,
        this.brain.yawTowardPlayer(this.position, ctx),
        TURN_LAMBDA * 0.6,
        dt,
      );
    }

    if (this._lungeBudget > 0 && t < 0.45) {
      const step = Math.min(this._lungeBudget, this._profile.lunge * dt * 3.2);
      this.position.addScaledVector(this._lungeDir, step);
      this._lungeBudget -= step;
    }

    if (
      !this._hitApplied &&
      t >= this._profile.impactT &&
      t <= this._profile.impactEnd
    ) {
      const weaponPos = this.handBone
        ? this.handBone.getWorldPosition(new THREE.Vector3())
        : this.position.clone().add(new THREE.Vector3(0, 1, 0));
      const playerCenter = new THREE.Vector3(
        playerPosition.x,
        playerPosition.y + PLAYER_HURTBOX_HEIGHT,
        playerPosition.z,
      );
      if (weaponPos.distanceTo(playerCenter) <= WEAPON_HIT_RADIUS) {
        this._hitApplied = true;
        this._hitLanded = true;
        onPlayerHit?.(ATTACK_DAMAGE * this._profile.damageMult);
      }
    }

    if (t >= 1) {
      const a = this.animator.actions.attack;
      if (a) a.timeScale = 1;
      this.action = null;
      this.brain.endAttack(this._hitLanded);
      // コンボ即時接続
      if (this.brain.queuedAttack === 'combo') {
        this._startWindup('combo', playerPosition, ctx);
      }
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
    const shouldStagger = this.brain.absorbHit(amount, { forceStagger });
    if (shouldStagger) {
      this.action = 'hit';
      this.actionStartedAt = performance.now();
      this.speed = 0;
      this.animator.trigger('hit');
    }
  }

  _startDeath() {
    this.alive = false;
    this.action = 'dead';
    this.speed = 0;
    this.animator.trigger('death');
  }

  _syncRoot() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET;
  }
}
