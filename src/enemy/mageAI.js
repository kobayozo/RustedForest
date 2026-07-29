import * as THREE from 'three';
import { getGroundHeight, resolveCircleColliders } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';

const DETECT_RADIUS = 16;
const LOSE_RADIUS = 26;
const WANDER_RADIUS = 8;
const ATTACK_RANGE = 12; // この距離以内なら撃てる
const PREFERRED_RANGE = 9; // この距離を保つ
const FLEE_RANGE = 5.5; // これより近いと歩いて逃げる

const WALK_SPEED = 1.5;
const CHASE_SPEED = 1.9; // 近づくときも歩き
const FLEE_SPEED = 2.1; // 歩いて逃げる
const TURN_LAMBDA = 9;
const ACCEL_LAMBDA = 9;
const IDLE_PAUSE_RANGE = [1.5, 3.5];

const ENEMY_MAX_HP = 90;
const ATTACK_DAMAGE = 14;
const ATTACK_COOLDOWN = 1.8;
const ATTACK_IMPACT_T = 0.4;
const HIT_STUN_DURATION = 0.55;
const BODY_RADIUS = 0.4;

const BOLT_SPEED = 14;
const BOLT_RADIUS = 0.28;
const BOLT_LIFE = 2.2;
const PLAYER_HURTBOX_HEIGHT = 1.0;

// 青玉は毎発射で Geometry / Material / PointLight を作るとヒッチるので共有・プールする
const _boltGeom = new THREE.SphereGeometry(0.18, 8, 8);
const _boltMat = new THREE.MeshBasicMaterial({
  color: 0x7ec8ff,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});
const _boltGlowGeom = new THREE.SphereGeometry(0.32, 6, 6);
const _boltGlowMat = new THREE.MeshBasicMaterial({
  color: 0x66aaff,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const _boltPool = [];
const _tmpOrigin = new THREE.Vector3();
const _tmpTarget = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();
const _tmpPlayerCenter = new THREE.Vector3();

function acquireBoltMesh() {
  let mesh = _boltPool.pop();
  if (!mesh) {
    mesh = new THREE.Mesh(_boltGeom, _boltMat);
    const glow = new THREE.Mesh(_boltGlowGeom, _boltGlowMat);
    glow.name = 'boltGlow';
    mesh.add(glow);
  }
  mesh.visible = true;
  return mesh;
}

function releaseBoltMesh(mesh) {
  mesh.visible = false;
  if (mesh.parent) mesh.parent.remove(mesh);
  _boltPool.push(mesh);
}

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

export const MODEL_YAW_OFFSET = Math.PI;

// Quaternius Wizard 向け遠距離AI。Shoot_OneHanded のタイミングで光弾を飛ばす
export class MageAI {
  constructor(root, animator, homePosition, scene) {
    this.root = root;
    this.animator = animator;
    this.scene = scene;
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
    this.name = '魔法使い';
    this.bodyRadius = BODY_RADIUS;

    this.action = null;
    this.attackCooldownTimer = 0;
    this._boltFired = false;
    this.bolts = [];
    this.deathTimer = 0;
    this.deathDuration = 2.5;
    this._deathFading = false;
    this.knockback = new THREE.Vector3();
  }

  update(dt, playerPosition, onPlayerHit, playerCtx = null) {
    this._updateBolts(dt, playerPosition, onPlayerHit);

    if (this.action === 'dead') {
      this._updateDeath(dt);
      return;
    }

    if (this.attackCooldownTimer > 0) this.attackCooldownTimer -= dt;

    // プレイヤーがロール着地直後 / 近距離詰めなら早めに射撃
    if (
      playerCtx &&
      this.action == null &&
      this.attackCooldownTimer > 0.2 &&
      ((playerCtx.rollEndedAgo < 0.45 && this.position.distanceTo(playerPosition) < ATTACK_RANGE) ||
        (playerCtx.attackEndedAgo < 0.4 && this.position.distanceTo(playerPosition) < FLEE_RANGE + 1))
    ) {
      this.attackCooldownTimer = Math.min(this.attackCooldownTimer, 0.15);
    }

    if (this.knockback.lengthSq() > 1e-4) {
      this.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.max(0, 1 - 6 * dt));
    }

    if (this.action === 'attack') {
      this._updateAttack(dt, playerPosition);
    } else if (this.action === 'hit') {
      this._updateHit();
    } else {
      this._updateMove(dt, playerPosition);
    }

    this.position.y = getGroundHeight(this.position.x, this.position.z);
    const resolved = resolveCircleColliders(this.position.x, this.position.z, BODY_RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.z;
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
      // 常にプレイヤー方向を向く(逃げながら撃つため)
      const toPlayer = new THREE.Vector3().subVectors(playerPosition, this.position);
      toPlayer.y = 0;
      if (toPlayer.lengthSq() > 1e-4) {
        toPlayer.normalize();
        const faceYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
        this.yaw = dampAngle(this.yaw, faceYaw, TURN_LAMBDA, dt);
      }

      // 近すぎる → 歩いて逃げる(キティング)
      if (distToPlayer < FLEE_RANGE) {
        const back = new THREE.Vector3().subVectors(this.position, playerPosition);
        back.y = 0;
        if (back.lengthSq() > 1e-4) {
          back.normalize();
          // 逃げ方向へ移動しつつ、向きはプレイヤーのまま
          this.speed = damp(this.speed, FLEE_SPEED, ACCEL_LAMBDA, dt);
          this.position.addScaledVector(back, this.speed * dt);
        }
        this.animator.setState('walk');
        // 逃げながらクールダウンが空いていれば撃つ
        if (this.attackCooldownTimer <= 0 && distToPlayer <= ATTACK_RANGE) {
          this._startAttack(playerPosition);
        }
        return;
      }

      // 射程内かつ好ましい距離帯 → 止まって撃つ
      if (distToPlayer <= ATTACK_RANGE && this.attackCooldownTimer <= 0) {
        this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
        this._startAttack(playerPosition);
        return;
      }

      // 好ましい距離より遠い → 近づく / 近い → 少し離れる
      if (distToPlayer > PREFERRED_RANGE + 1.5) {
        this._chase(dt, playerPosition);
        this.animator.setState('walk');
      } else if (distToPlayer < PREFERRED_RANGE - 1.0) {
        const back = new THREE.Vector3().subVectors(this.position, playerPosition);
        back.y = 0;
        if (back.lengthSq() > 1e-4) {
          back.normalize();
          this.speed = damp(this.speed, FLEE_SPEED, ACCEL_LAMBDA, dt);
          this.position.addScaledVector(back, this.speed * dt);
        }
        this.animator.setState('walk');
      } else {
        this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
        this.animator.setState('idle');
      }
      return;
    }

    this._wander(dt);
    this.animator.setState(this.speed > 0.05 ? 'walk' : 'idle');
  }

  _chase(dt, playerPosition) {
    const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();
    // 向きは別途プレイヤーへ向けているので、移動だけ行う
    this.speed = damp(this.speed, CHASE_SPEED, ACCEL_LAMBDA, dt);
    this.position.addScaledVector(dir, this.speed * dt);
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
    this._boltFired = false;
    this.speed = 0;
    if (!this._aimPos) this._aimPos = new THREE.Vector3();
    this._aimPos.copy(playerPosition);

    const dir = new THREE.Vector3().subVectors(playerPosition, this.position);
    dir.y = 0;
    if (dir.lengthSq() > 0.0001) {
      dir.normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
    }
    this.animator.trigger('attack');
  }

  _updateAttack(dt, playerPosition) {
    const t = (performance.now() - this.actionStartedAt) / 1000 / this.attackDuration;
    if (playerPosition) this._aimPos.copy(playerPosition);

    if (!this._boltFired && t >= ATTACK_IMPACT_T) {
      this._boltFired = true;
      this._spawnBolt(this._aimPos || playerPosition);
    }

    if (t >= 1) {
      this.action = null;
      this.attackCooldownTimer = ATTACK_COOLDOWN;
    }
  }

  _spawnBolt(targetPos) {
    if (!this.scene || !targetPos) return;
    _tmpOrigin.set(this.position.x, this.position.y + 1.2, this.position.z);
    _tmpTarget.set(targetPos.x, targetPos.y + PLAYER_HURTBOX_HEIGHT, targetPos.z);
    _tmpDir.subVectors(_tmpTarget, _tmpOrigin);
    if (_tmpDir.lengthSq() < 1e-6) return;
    _tmpDir.normalize();

    const mesh = acquireBoltMesh();
    mesh.position.copy(_tmpOrigin);
    this.scene.add(mesh);

    this.bolts.push({
      mesh,
      velocity: _tmpDir.clone().multiplyScalar(BOLT_SPEED),
      life: BOLT_LIFE,
      hit: false,
    });
  }

  _updateBolts(dt, playerPosition, onPlayerHit) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.life -= dt;
      bolt.mesh.position.addScaledVector(bolt.velocity, dt);

      if (!bolt.hit && playerPosition) {
        _tmpPlayerCenter.set(
          playerPosition.x,
          playerPosition.y + PLAYER_HURTBOX_HEIGHT,
          playerPosition.z,
        );
        if (bolt.mesh.position.distanceTo(_tmpPlayerCenter) <= BOLT_RADIUS + 0.45) {
          bolt.hit = true;
          onPlayerHit?.(ATTACK_DAMAGE);
          bolt.life = 0;
        }
      }

      if (bolt.life <= 0) {
        releaseBoltMesh(bolt.mesh);
        this.bolts.splice(i, 1);
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
    if (this.hp <= 0) this._startDeath();
    else if (forceStagger || stagger) this._startHit();
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
    this.deathTimer = 0;
    this.deathDuration = Math.max(this.animator.getClipDuration('death'), 2.0);
    this._deathFading = false;
    this.animator.trigger('death');
    for (const bolt of this.bolts) {
      releaseBoltMesh(bolt.mesh);
    }
    this.bolts.length = 0;
  }

  _updateDeath(dt) {
    this.deathTimer += dt;
    this.animator.update(dt);
    this._syncRoot();

    // 死亡クリップ後半でフェードし、終了後に消す
    const fadeStart = this.deathDuration * 0.65;
    if (this.deathTimer >= fadeStart) {
      const u = Math.min(1, (this.deathTimer - fadeStart) / Math.max(0.01, this.deathDuration - fadeStart));
      this.root.traverse((obj) => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.transparent = true;
          mat.opacity = 1 - u;
          mat.depthWrite = u < 0.85;
          mat.needsUpdate = true;
        }
      });
      this._deathFading = true;
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
