import * as THREE from 'three';
import { getGroundHeight } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';

const DETECT_RADIUS = 11; // この距離まで近づくと気づいて追いかけてくる
const LOSE_RADIUS = 16; // これより離れると追跡をやめる
const WANDER_RADIUS = 6; // 出現地点からうろつく範囲
const ATTACK_RANGE = 2.0; // この距離まで近づくと攻撃を始める

const WALK_SPEED = 1.6;
const CHASE_SPEED = 4.2;
const TURN_LAMBDA = 8;
const ACCEL_LAMBDA = 8;

const IDLE_PAUSE_RANGE = [1.5, 3.5]; // ランダム移動の合間に待機する秒数

const ENEMY_MAX_HP = 100;
const ATTACK_DAMAGE = 10;
const ATTACK_COOLDOWN = 1.5; // 攻撃後、次の攻撃までの待ち時間
const ATTACK_IMPACT_T = 0.5; // クリップのこの割合が経過した時点で当たり判定を取る
const HIT_STUN_DURATION = 0.55;

function randRange([min, max]) {
  return min + Math.random() * (max - min);
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
    this.state = 'idle'; // idle | wander | chase (移動AIの状態)

    this.wanderTarget = null;
    this.idleTimer = randRange(IDLE_PAUSE_RANGE);

    this.hp = ENEMY_MAX_HP;
    this.maxHp = ENEMY_MAX_HP;
    this.alive = true;

    // action: 'attack' | 'hit' | 'dead' | null。非nullの間は移動AIを止めて専用モーションを再生する
    this.action = null;
    this.attackCooldownTimer = 0;
    this._hitApplied = false;
  }

  update(dt, playerPosition, onPlayerHit) {
    if (this.action === 'dead') {
      this.animator.update(dt);
      return;
    }

    if (this.attackCooldownTimer > 0) this.attackCooldownTimer -= dt;

    if (this.action === 'attack') {
      this._updateAttack(dt, playerPosition, onPlayerHit);
    } else if (this.action === 'hit') {
      this._updateHit(dt);
    } else {
      this._updateMove(dt, playerPosition);
    }

    this.position.y = getGroundHeight(this.position.x, this.position.z);
    this.animator.update(dt);
    this._syncRoot();
  }

  _updateMove(dt, playerPosition) {
    const distToPlayer = this.position.distanceTo(playerPosition);

    if (this.state === 'chase') {
      if (distToPlayer > LOSE_RADIUS) {
        this.state = 'idle';
        this.idleTimer = randRange(IDLE_PAUSE_RANGE);
      }
    } else if (distToPlayer < DETECT_RADIUS) {
      this.state = 'chase';
    }

    if (this.state === 'chase') {
      if (distToPlayer <= ATTACK_RANGE) {
        // 攻撃間合いに入ったら足を止める。クールダウン中は睨み合いつつ向きだけ合わせる
        this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
        if (this.attackCooldownTimer <= 0) {
          this._startAttack(playerPosition);
          return;
        }
        const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
        dir.y = 0;
        if (dir.lengthSq() > 0.0001) {
          dir.normalize();
          const targetYaw = Math.atan2(-dir.x, -dir.z);
          this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
        }
      } else {
        this._chase(dt, playerPosition);
      }
    } else {
      this._wander(dt);
    }

    this.animator.setState(this.speed > 0.05 ? (this.state === 'chase' ? 'run' : 'walk') : 'idle');
  }

  _chase(dt, playerPosition) {
    const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
    dir.y = 0;
    dir.normalize();
    this._moveTowards(dir, CHASE_SPEED, dt);
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
          this.home.z + Math.sin(angle) * dist
        );
      } else {
        this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
        return;
      }
    }

    const toTarget = new THREE.Vector3().subVectors(this.wanderTarget, this.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 0.3) {
      this.wanderTarget = null;
      this.idleTimer = randRange(IDLE_PAUSE_RANGE);
      this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      return;
    }

    toTarget.normalize();
    this._moveTowards(toTarget, WALK_SPEED, dt);
  }

  _moveTowards(dir, targetSpeed, dt) {
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
    this.speed = damp(this.speed, targetSpeed, ACCEL_LAMBDA, dt);
    this.position.addScaledVector(dir, this.speed * dt);
  }

  _startAttack(playerPosition) {
    this.action = 'attack';
    this.actionStartedAt = performance.now();
    this.attackDuration = this.animator.getClipDuration('attack');
    this._hitApplied = false;
    this.speed = 0;

    const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
    dir.y = 0;
    if (dir.lengthSq() > 0.0001) {
      dir.normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
    }
    this.animator.trigger('attack');
  }

  _updateAttack(dt, playerPosition, onPlayerHit) {
    const t = (performance.now() - this.actionStartedAt) / 1000 / this.attackDuration;

    if (!this._hitApplied && t >= ATTACK_IMPACT_T) {
      this._hitApplied = true;
      const dist = this.position.distanceTo(playerPosition);
      if (dist <= ATTACK_RANGE + 0.6) {
        onPlayerHit(ATTACK_DAMAGE);
      }
    }

    if (t >= 1) {
      this.action = null;
      this.attackCooldownTimer = ATTACK_COOLDOWN;
    }
  }

  _updateHit(dt) {
    const t = (performance.now() - this.actionStartedAt) / 1000 / HIT_STUN_DURATION;
    if (t >= 1) {
      this.action = null;
    }
  }

  takeDamage(amount) {
    if (!this.alive || this.action === 'dead') return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this._startDeath();
    } else {
      this._startHit();
    }
  }

  _startHit() {
    this.action = 'hit';
    this.actionStartedAt = performance.now();
    this.speed = 0;
    this.animator.trigger('hit');
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
