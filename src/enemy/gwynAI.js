import * as THREE from 'three';
import { getGroundHeight, resolveCircleColliders } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';
import { SoulsMeleeBrain, attackProfile } from './soulsCombat.js';

const DETECT_RADIUS = 15;
const LOSE_RADIUS = 24;
const WANDER_RADIUS = 5;
const BODY_RADIUS = 0.45;

const WALK_SPEED = 1.5;
const CHASE_SPEED = 3.6;
const TURN_LAMBDA = 7;
const ACCEL_LAMBDA = 7;
const IDLE_PAUSE_RANGE = [1.8, 3.5];

const ENEMY_MAX_HP = 220;
const ATTACK_DAMAGE = 22;
const HIT_STUN_DURATION = 0.5;
const WEAPON_REACH = 2.35;
const WEAPON_HIT_RADIUS = 1.2;
const PLAYER_HURTBOX_HEIGHT = 1.0;

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

export const MODEL_YAW_OFFSET = Math.PI;

// グウィン: 大剣ボス。溜め・コンボ・ロール狩り・ハイパーアーマー付き
export class GwynAI {
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
    this.name = 'グウィン';
    this.bodyRadius = BODY_RADIUS;
    this.hurtboxRadius = 0.7;
    this.hurtboxHeight = 1.2;

    this.action = null;
    this._hitApplied = false;
    this._hitLanded = false;
    this.knockback = new THREE.Vector3();
    this.deathTimer = 0;
    this.deathDuration = Math.max(animator.getClipDuration('death'), 2.5);

    this._attackKind = 'normal';
    this._profile = attackProfile('normal');
    this._windupTimer = 0;
    this._lungeDir = new THREE.Vector3();
    this._lungeBudget = 0;
    this._phase = 1;

    this.brain = new SoulsMeleeBrain({
      preferredRange: 2.6,
      attackRange: 3.0,
      closeRange: 1.5,
      engageRange: 7.0,
      aggression: 0.62,
      patienceMin: 0.35,
      patienceMax: 1.05,
      delayedChance: 0.4,
      comboChance: 0.55,
      maxCombo: 3,
      gapCloseChance: 0.32,
      rollCatchChance: 0.8,
      punishChance: 0.7,
      poiseMax: 70,
      recoverTime: [0.4, 0.85],
      facingYawOffset: Math.PI,
    });
  }

  get phase() {
    return this.hp / this.maxHp < 0.45 ? 2 : 1;
  }

  update(dt, playerPosition, onPlayerHit, playerCtx = null) {
    if (this.action === 'dead') {
      this._updateDeath(dt);
      return;
    }

    // フェーズ2で攻撃性アップ
    if (this.phase !== this._phase) {
      this._phase = this.phase;
      if (this._phase === 2) {
        this.brain.cfg.aggression = 0.85;
        this.brain.cfg.patienceMin = 0.15;
        this.brain.cfg.patienceMax = 0.55;
        this.brain.cfg.comboChance = 0.7;
        this.brain.cfg.delayedChance = 0.48;
      }
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
        this.yaw = dampAngle(
          this.yaw,
          this.brain.yawTowardPlayer(this.position, ctx),
          TURN_LAMBDA,
          dt,
        );
      }
      if (decision.attack) {
        this._startWindup(decision.attack, playerPosition, ctx);
        return;
      }
      if (decision.moveDir) {
        const base = decision.anim === 'run' ? CHASE_SPEED : WALK_SPEED;
        const spd = base * decision.speedMult * (this.phase === 2 ? 1.15 : 1);
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
    if (toTarget.length() < 0.5) {
      this.wanderTarget = null;
      this.idleTimer = randRange(IDLE_PAUSE_RANGE);
      this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      this.animator.setState('idle');
      return;
    }
    toTarget.normalize();
    const targetYaw = Math.atan2(-toTarget.x, -toTarget.z);
    this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
    this.speed = damp(this.speed, WALK_SPEED, ACCEL_LAMBDA, dt);
    this.position.addScaledVector(toTarget, this.speed * dt);
    this.animator.setState('walk');
  }

  _startWindup(kind, playerPosition, playerCtx) {
    this._attackKind = kind;
    this._profile = attackProfile(kind);
    // ボスは溜めを長めに
    if (kind === 'delayed') this._profile = { ...this._profile, windup: 0.75, trackUntil: 0.6 };
    this.action = 'windup';
    this._windupTimer = this._profile.windup;
    this.speed = 0;
    this.brain.beginAttack(kind);
    const ctx = playerCtx || { position: playerPosition };
    this.yaw = this.brain.yawTowardPlayer(this.position, ctx);
    const d = new THREE.Vector3().subVectors(ctx.position || playerPosition, this.position);
    d.y = 0;
    if (d.lengthSq() > 1e-4) this._lungeDir.copy(d.normalize());
    this.animator.setState('idle');
  }

  _updateWindup(dt, playerPosition, playerCtx) {
    const ctx = playerCtx || { position: playerPosition };
    const elapsed = this._profile.windup - this._windupTimer;
    if (elapsed < this._profile.trackUntil) {
      this.yaw = dampAngle(
        this.yaw,
        this.brain.yawTowardPlayer(this.position, ctx),
        TURN_LAMBDA,
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
    const base = this.animator.getClipDuration('attack') || 1.0;
    this.attackDuration = base / this._profile.timeScale;
    this._hitApplied = false;
    this._hitLanded = false;
    this._lungeBudget = this._profile.lunge;
    this.animator.trigger('attack');
    const a = this.animator.actions.attack;
    if (a) {
      a.timeScale = this._profile.timeScale;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
  }

  _updateAttack(dt, playerPosition, onPlayerHit, playerCtx) {
    const t = (performance.now() - this.actionStartedAt) / 1000 / this.attackDuration;
    const ctx = playerCtx || { position: playerPosition };

    if (this._lungeBudget > 0 && t < 0.5) {
      const step = Math.min(this._lungeBudget, this._profile.lunge * dt * 2.8);
      this.position.addScaledVector(this._lungeDir, step);
      this._lungeBudget -= step;
    }

    if (
      !this._hitApplied &&
      t >= this._profile.impactT &&
      t <= this._profile.impactEnd
    ) {
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const tip = this.position.clone().addScaledVector(forward, WEAPON_REACH);
      tip.y += 1.1;
      const playerCenter = new THREE.Vector3(
        playerPosition.x,
        playerPosition.y + PLAYER_HURTBOX_HEIGHT,
        playerPosition.z,
      );
      if (tip.distanceTo(playerCenter) <= WEAPON_HIT_RADIUS + 0.45) {
        this._hitApplied = true;
        this._hitLanded = true;
        onPlayerHit?.(ATTACK_DAMAGE * this._profile.damageMult);
      }
    }

    if (t >= 1) {
      const a = this.animator.actions.attack;
      if (a) {
        a.timeScale = 1;
        a.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.action = null;
      this.brain.endAttack(this._hitLanded);
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
    if (this.brain.absorbHit(amount, { forceStagger })) {
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
    this.deathTimer = 0;
    this.animator.trigger('death');
  }

  _updateDeath(dt) {
    this.deathTimer += dt;
    this.animator.update(dt);
    this._syncRoot();
    const fadeStart = this.deathDuration * 0.55;
    if (this.deathTimer >= fadeStart) {
      const u = Math.min(
        1,
        (this.deathTimer - fadeStart) / Math.max(0.01, this.deathDuration - fadeStart),
      );
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
