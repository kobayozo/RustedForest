import * as THREE from 'three';
import { getGroundHeight, resolveCircleColliders } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';
import { SoulsMeleeBrain, attackProfile } from './soulsCombat.js';

const IDLE_PAUSE_RANGE = [1.2, 3.0];
const HIT_STUN_DURATION = 0.45;
const PLAYER_HURTBOX_HEIGHT = 1.0;
const PLAYER_HURTBOX_RADIUS = 0.4;

export const MODEL_YAW_OFFSET = 0;

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

/**
 * 動物系敵AI（ソウル系間合い・ロール狩り・溜め攻撃）
 */
export class AnimalAI {
  constructor(root, animator, homePosition, options = {}) {
    this.root = root;
    this.animator = animator;
    this.home = homePosition.clone();
    this.position = homePosition.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.state = 'idle';

    this.name = options.name ?? '動物';
    this.maxHp = options.maxHp ?? 70;
    this.hp = this.maxHp;
    this.alive = true;
    this.bodyRadius = options.bodyRadius ?? 0.55;
    this.hurtboxRadius = options.hurtboxRadius ?? this.bodyRadius * 1.1;
    this.hurtboxHeight = options.hurtboxHeight ?? 0.7;

    this.detectRadius = options.detectRadius ?? 10;
    this.loseRadius = options.loseRadius ?? 16;
    this.wanderRadius = options.wanderRadius ?? 5;
    this.attackRange = options.attackRange ?? 1.8;
    this.attackDamage = options.attackDamage ?? 12;
    this.walkSpeed = options.walkSpeed ?? 1.8;
    this.chaseSpeed = options.chaseSpeed ?? 4.5;
    this.hitRadius = options.hitRadius ?? 1.15;

    this.wanderTarget = null;
    this.idleTimer = randRange(IDLE_PAUSE_RANGE);

    this.action = null;
    this._hitApplied = false;
    this._hitLanded = false;
    this.knockback = new THREE.Vector3();
    this._playerCenter = new THREE.Vector3();
    this._attackKind = 'normal';
    this._profile = attackProfile('normal');
    this._windupTimer = 0;
    this._lungeDir = new THREE.Vector3();
    this._lungeBudget = 0;

    this.brain = new SoulsMeleeBrain({
      preferredRange: this.attackRange * 0.85,
      attackRange: this.attackRange,
      closeRange: this.bodyRadius + 0.5,
      engageRange: this.detectRadius * 0.7,
      aggression: options.aggression ?? 0.85,
      patienceMin: 0,
      patienceMax: 0,
      delayedChance: 0.15,
      comboChance: 0.35,
      maxCombo: 2,
      gapCloseChance: 0.25,
      rollCatchChance: 0.75,
      recoverTime: [0.05, 0.12],
      repositionChance: 0.1,
      poiseMax: options.poiseMax ?? 35,
      facingYawOffset: 0,
      strafeSpeedMult: 0.6,
      approachSpeedMult: 1.0,
    });
  }

  update(dt, playerPosition, onPlayerHit, playerCtx = null) {
    if (this.action === 'dead') {
      this.animator.update(dt);
      this._syncRoot();
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
    const resolved = resolveCircleColliders(
      this.position.x,
      this.position.z,
      this.bodyRadius,
    );
    this.position.x = resolved.x;
    this.position.z = resolved.z;
    this.animator.update(dt);
    this._syncRoot();
  }

  _updateMove(dt, playerPosition, playerCtx) {
    const dist = this.position.distanceTo(playerPosition);
    const ctx = playerCtx || { position: playerPosition };

    if (this.state === 'chase') {
      if (dist > this.loseRadius) {
        this.state = 'idle';
        this.idleTimer = randRange(IDLE_PAUSE_RANGE);
        this.brain.resetCombat();
      }
    } else if (dist < this.detectRadius) {
      this.state = 'chase';
      this.brain.resetCombat();
    }

    if (this.state === 'chase') {
      const decision = this.brain.think(dt, this.position, ctx, dist);
      if (decision.facePlayer) {
        this.yaw = dampAngle(
          this.yaw,
          this.brain.yawTowardPlayer(this.position, ctx),
          8,
          dt,
        );
      }
      if (decision.attack) {
        this._startWindup(decision.attack, playerPosition, ctx);
        return;
      }
      if (decision.moveDir) {
        const base = decision.anim === 'run' ? this.chaseSpeed : this.walkSpeed;
        this.speed = damp(this.speed, base * decision.speedMult, 8, dt);
        this.position.addScaledVector(decision.moveDir, this.speed * dt);
      } else {
        this.speed = damp(this.speed, 0, 8, dt);
      }
      this.animator.setState(
        this.speed > 0.08 ? (decision.anim === 'run' ? 'run' : 'walk') : 'idle',
      );
      return;
    }

    if (this.idleTimer > 0) {
      this.idleTimer -= dt;
      this.speed = damp(this.speed, 0, 8, dt);
      this.animator.setState('idle');
      if (this.idleTimer <= 0) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * this.wanderRadius;
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
      this.speed = damp(this.speed, 0, 8, dt);
      this.animator.setState('idle');
      return;
    }
    toTarget.normalize();
    this._moveTowards(toTarget, this.walkSpeed, dt);
    this.animator.setState('walk');
  }

  _moveTowards(dir, targetSpeed, dt) {
    const targetYaw = Math.atan2(dir.x, dir.z);
    this.yaw = dampAngle(this.yaw, targetYaw, 8, dt);
    this.speed = damp(this.speed, targetSpeed, 8, dt);
    this.position.addScaledVector(dir, this.speed * dt);
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
        10,
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
    const base = this.animator.getClipDuration('attack') || 0.7;
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

    if (this._lungeBudget > 0 && t < 0.45) {
      const step = Math.min(this._lungeBudget, this._profile.lunge * dt * 3.5);
      this.position.addScaledVector(this._lungeDir, step);
      this._lungeBudget -= step;
    }

    if (
      !this._hitApplied &&
      t >= this._profile.impactT &&
      t <= this._profile.impactEnd
    ) {
      this._playerCenter.set(
        playerPosition.x,
        playerPosition.y + PLAYER_HURTBOX_HEIGHT,
        playerPosition.z,
      );
      const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const hitPos = this.position.clone().addScaledVector(forward, this.bodyRadius * 0.8);
      hitPos.y += this.hurtboxHeight;
      if (hitPos.distanceTo(this._playerCenter) <= this.hitRadius + PLAYER_HURTBOX_RADIUS) {
        this._hitApplied = true;
        this._hitLanded = true;
        onPlayerHit?.(this.attackDamage * this._profile.damageMult);
      }
    }

    if (t >= 1) {
      const a = this.animator.actions.attack;
      if (a) a.timeScale = 1;
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
      this.alive = false;
      this.action = 'dead';
      this.speed = 0;
      this.animator.trigger('death');
      return;
    }
    if (!stagger && !forceStagger) return;
    if (this.brain.absorbHit(amount, { forceStagger })) {
      this.action = 'hit';
      this.actionStartedAt = performance.now();
      this.speed = 0;
      this.animator.setState('idle');
    }
  }

  _syncRoot() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET;
  }
}

// Quaternius Ultimate Animated Animal Pack(CC0)。犬科はAttack、有蹄類は
// Attack_Headbuttが本来の攻撃クリップ名(wildlifeModel.js参照)
export const ANIMAL_PRESETS = {
  wolf: {
    path: '/models/enemy/wildlife/Wolf.glb',
    attackClip: 'Attack',
    name: 'オオカミ',
    height: 1.0,
    maxHp: 70,
    bodyRadius: 0.5,
    hurtboxHeight: 0.55,
    detectRadius: 13,
    loseRadius: 19,
    attackRange: 1.7,
    attackDamage: 14,
    walkSpeed: 2.0,
    chaseSpeed: 6.0,
    hitRadius: 1.1,
    aggression: 0.8,
    poiseMax: 30,
  },
  fox: {
    path: '/models/enemy/wildlife/Fox.glb',
    attackClip: 'Attack',
    name: 'キツネ',
    height: 0.55,
    maxHp: 40,
    bodyRadius: 0.32,
    hurtboxHeight: 0.35,
    detectRadius: 10,
    attackRange: 1.4,
    attackDamage: 8,
    walkSpeed: 2.1,
    chaseSpeed: 5.5,
    hitRadius: 0.95,
    aggression: 0.7,
    poiseMax: 15,
  },
  husky: {
    path: '/models/enemy/wildlife/Husky.glb',
    attackClip: 'Attack',
    name: 'ハスキー',
    height: 0.75,
    maxHp: 55,
    bodyRadius: 0.42,
    hurtboxHeight: 0.45,
    detectRadius: 11,
    attackRange: 1.5,
    attackDamage: 10,
    walkSpeed: 2.0,
    chaseSpeed: 5.0,
    hitRadius: 1.0,
    aggression: 0.55,
    poiseMax: 25,
  },
  bull: {
    path: '/models/enemy/wildlife/Bull.glb',
    attackClip: 'Attack_Headbutt',
    name: 'ブル',
    height: 1.55,
    maxHp: 150,
    bodyRadius: 0.9,
    hurtboxHeight: 0.95,
    detectRadius: 10,
    attackRange: 2.2,
    attackDamage: 22,
    walkSpeed: 1.5,
    chaseSpeed: 3.6,
    hitRadius: 1.45,
    aggression: 0.5,
    poiseMax: 70,
  },
  cow: {
    path: '/models/enemy/wildlife/Cow.glb',
    attackClip: 'Attack_Headbutt',
    name: 'ウシ',
    height: 1.5,
    maxHp: 130,
    bodyRadius: 0.85,
    hurtboxHeight: 0.9,
    detectRadius: 8,
    attackRange: 2.0,
    attackDamage: 16,
    walkSpeed: 1.3,
    chaseSpeed: 3.0,
    hitRadius: 1.4,
    aggression: 0.35,
    poiseMax: 65,
  },
  stag: {
    path: '/models/enemy/wildlife/Stag.glb',
    attackClip: 'Attack_Headbutt',
    name: 'オジカ',
    height: 1.35,
    maxHp: 90,
    bodyRadius: 0.6,
    hurtboxHeight: 0.75,
    detectRadius: 10,
    attackRange: 2.0,
    attackDamage: 18,
    walkSpeed: 1.8,
    chaseSpeed: 4.5,
    hitRadius: 1.3,
    aggression: 0.5,
    poiseMax: 45,
  },
  donkey: {
    path: '/models/enemy/wildlife/Donkey.glb',
    attackClip: 'Attack_Kick',
    name: 'ロバ',
    height: 1.3,
    maxHp: 80,
    bodyRadius: 0.55,
    hurtboxHeight: 0.7,
    detectRadius: 8,
    attackRange: 1.9,
    attackDamage: 12,
    walkSpeed: 1.5,
    chaseSpeed: 3.4,
    hitRadius: 1.2,
    aggression: 0.4,
    poiseMax: 40,
  },
};
