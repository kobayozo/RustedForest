import * as THREE from 'three';
import { getGroundHeight, resolveCircleColliders } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';

const WALK_SPEED = 4.2;          // デフォルト走り速度
const SPRINT_SPEED = 8.5;        // Bダッシュ速度
const LOCK_MOVE_SPEED = 4.2;     // ロックオン中も同じ走り速度
const GUARD_WALK_SPEED = 1.7;
const GUARD_DAMAGE_MULT = 0; // 盾で受けたとき体力は減らない（スタミナ消費のみ）
const TURN_LAMBDA = 14;
const ACCEL_LAMBDA = 10;
export const PLAYER_BODY_RADIUS = 0.38;
const BODY_RADIUS = PLAYER_BODY_RADIUS;

// B短押し=ロール、押しっぱなし+移動=Bダッシュ
const SPRINT_HOLD_THRESHOLD = 0.16;

// エルデンリングのローリングを参考に、距離は伸ばしつつ「初速が速く、すぐ減速する」
// イーズアウト形の速度カーブにする(等速だと間延びして遅く感じるため)
const ROLL_DISTANCE = 5.8;
const ROLL_STAMINA_COST = 25;
// 無敵時間はロール全体ではなく、実際に転がって避けている序盤〜中盤だけにする
const ROLL_INVINCIBLE_START = 0.05;
const ROLL_INVINCIBLE_END = 0.6;
// クリップ全部を待つと後隙(硬直)が大きく次の行動に移りづらいため、
// クリップ長の一定割合が経過した時点で操作を返す(イーズアウトのおかげで
// 移動距離のほとんどは序盤で稼いでいるため、多少早く打ち切っても違和感は少ない)。
// 自作の前転モーション(360°回転)をなるべく見せきりたいので、他のRECOVERY_CUTより
// 高めの値にして回転の大部分が終わってから操作を返す
const ROLL_RECOVERY_CUT = 0.85;
// 振りの大半が見えたら早めに次へ繋ぐ
const ATTACK_RECOVERY_CUT = 0.58;

// コンボ: 1段通常 / 2段しゃがみ / 3段回転斬り。入力予約→接続
const ATTACK_COMBO_MAX = 3;
const ATTACK_COMBO_WINDOW_START = 0.28;
const ATTACK_COMBO_SPEED_STEP = 0.12;
const LIGHT1_SPEED_MULT = 1.55; // 1発目の出を速く
// 3段目: 出始めを速く、振り下ろし後に短く硬直
const ATTACK3_SPEED_MULT = 1.55;
const ATTACK3_RECOVERY_CUT = 0.72;
const ATTACK3_COMBO_WINDOW_START = 0.35;
const ATTACK3_LUNGE_DISTANCE = 1.0;
const ATTACK3_LUNGE_END = 0.48;

// 重攻撃
const HEAVY_ATTACK_STAMINA_COST = 32;
const HEAVY_ATTACK_SPEED_MULT = 1.25;
const HEAVY_ATTACK_RECOVERY_CUT = 0.75;
const HEAVY_ATTACK_LUNGE_DISTANCE = 1.7;
const HEAVY_ATTACK_LUNGE_END = 0.55;

// ダッシュからのジャンプ切り (Attack 2)
const JUMP_ATTACK_STAMINA_COST = 18;
const JUMP_ATTACK_SPEED_MULT = 1.2;
const JUMP_ATTACK_RECOVERY_CUT = 0.8;
const JUMP_ATTACK_LUNGE_DISTANCE = 3.4;
const JUMP_ATTACK_LUNGE_END = 0.5;

// L2キック
const KICK_STAMINA_COST = 16;
const KICK_SPEED_MULT = 1.2;
const KICK_RECOVERY_CUT = 0.85;

const STAMINA_MAX = 100;
const STAMINA_REGEN_RATE = 18;
const STAMINA_REGEN_DELAY = 0.45;
const SPRINT_STAMINA_RATE = 12;
const GUARD_CHIP_MULT = 0.55; // 受けたダメージに対するスタミナ削り倍率
const GUARD_BREAK_STUN = 1.15;

const PLAYER_MAX_HP = 100;
const HIT_STUN_DURATION = 0.65;
const FLASK_HEAL = 45;
const FLASK_MAX = 4;
// 掲げるモーション(~1.15s)＋口元で少し保持してから終わる
const FLASK_USE_TIME = 1.55;
const REST_DURATION = 2.4;
const BACKSTEP_DISTANCE = 2.4;
const BACKSTEP_DURATION = 0.42;
const BACKSTEP_STAMINA = 18;
const BACKSTEP_IFRAMES_START = 0.05;
const BACKSTEP_IFRAMES_END = 0.55;
const INPUT_BUFFER_WINDOW = 0.22;
const CRITICAL_RANGE = 2.1;
const CRITICAL_DAMAGE = 55;
const CRITICAL_STAMINA = 5;

// モデルによっては正面がZ+/Z-どちらを向いているか異なるため、見た目確認の上で調整する
export const MODEL_YAW_OFFSET = Math.PI;

export class PlayerController {
  constructor(root, animator, visualModel = null, groundYBias = 0) {
    this.root = root;
    this.animator = animator;
    // FBX本体。ロール時にX回転させて全身前転を見せる
    this.visualModel = visualModel || root.children[0] || null;
    this._visualBaseY = this.visualModel ? this.visualModel.position.y : 0;
    this.groundYBias = groundYBias;
    this.position = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.speed = 0;
    this.state = 'idle';

    this.stamina = STAMINA_MAX;
    this.staminaRegenTimer = 0;

    // action: 'roll' | 'attack' | null。移動入力を無視して専用モーションを再生する
    this.action = null;
    this.actionTimer = 0;
    this.rollDuration = Math.max(animator.getClipDuration('roll'), 0.8);
    this.baseAttackDuration = Math.max(animator.getClipDuration('attack'), 0.4);
    this.baseAttack2Duration = Math.max(animator.getClipDuration('attack2'), 0.5);
    this.baseAttack3Duration = Math.max(animator.getClipDuration('attack3'), 0.6);
    this.baseHeavyAttackDuration = Math.max(animator.getClipDuration('heavyAttack'), 0.6);
    this.baseJumpAttackDuration = Math.max(animator.getClipDuration('jumpAttack'), 0.7);
    this.baseKickDuration = Math.max(animator.getClipDuration('kick'), 0.6);
    this.baseHitDuration = Math.max(animator.getClipDuration('hit'), HIT_STUN_DURATION);
    // 倒れきってから YOU DIED を出すため、死亡クリップ長を保持する
    this.deathDuration = Math.max(animator.getClipDuration('dead'), 2.0);
    this.attackDuration = this.baseAttackDuration;
    this.bodyRadius = BODY_RADIUS;
    this.rollDir = new THREE.Vector3(0, 0, -1);
    this.invincible = false;

    // 攻撃コンボの進行状況。comboStageは0始まり、attackTriggerIdは1発ごとに
    // インクリメントするので、外部(main.js)が「新しい1発が始まった」ことを検知できる
    this.comboStage = 0;
    this.attackTriggerId = 0;
    this.attackKind = null; // 'light' | 'heavy' | 'jump' | 'kick'
    this._comboQueuedNext = false;

    this.hp = PLAYER_MAX_HP;
    this.maxHp = PLAYER_MAX_HP;
    this.blocking = false;
    this.lastHitWasBlocked = false;
    this.lastHitWasGuardBreak = false;
    this.lastHitWasDeadAngle = false;
    this.lockTargetPos = null;

    this.flasks = FLASK_MAX;
    this.maxFlasks = FLASK_MAX;
    this.healing = false;
    this._bufferedAction = null; // 'roll' | 'attack' | 'heavy' | null
    this._bufferExpiresAt = 0;
    this.guardBroken = false;
    this._usingFlask = false;
    this.flaskHealSfxPending = false;

    // B / Space: 短押しロール、長押しダッシュ判定用
    this._dodgeHeld = false;
    this._dodgePressAt = 0;
    this._dodgeRollPending = false;
    this._sprintArmed = false;
    this._rollRequested = false;
    this._interactPressed = false;
    this._restHealed = false;
    this.sprinting = false;
  }

  update(dt, input, cameraYaw, lockTargetPos = null) {
    if (this.action === 'dead') {
      this.animator.update(dt);
      return;
    }

    this.lockTargetPos = lockTargetPos;
    this.criticalTarget = this.criticalTarget ?? null;

    const attackPressed = input.consumeJustPressed('Mouse0');
    const heavyAttackPressed = input.consumeJustPressed('Mouse2');
    const kickPressed = input.consumeJustPressed('KeyE');
    const flaskPressed = input.consumeJustPressed('KeyC') || input.consumeJustPressed('Digit1');
    const interactPressed = input.consumeJustPressed('KeyT'); // ゲームパッドA / キーボードT
    const wantGuard = input.isDown('KeyQ');
    this._interactPressed = interactPressed;

    this._updateDodgeSprintInput(dt, input);

    // リカバリ中の入力バッファ
    if (this.action === 'attack' || this.action === 'roll' || this.action === 'backstep') {
      if (attackPressed) this._bufferInput('attack');
      if (heavyAttackPressed) this._bufferInput('heavy');
      if (this._rollRequested) {
        this._bufferInput('roll');
        this._rollRequested = false;
      }
    }

    if (this.action === 'roll') {
      this.blocking = false;
      this.sprinting = false;
      this._updateRoll(dt);
    } else if (this.action === 'backstep') {
      this.blocking = false;
      this.sprinting = false;
      this._updateBackstep(dt);
    } else if (this.action === 'flask') {
      this.blocking = false;
      this.sprinting = false;
      this._updateFlask();
    } else if (this.action === 'rest') {
      this.blocking = false;
      this.sprinting = false;
      this._updateRest();
    } else if (this.action === 'attack') {
      this.blocking = false;
      this.sprinting = false;
      this._updateAttack(dt, attackPressed);
    } else if (this.action === 'hit' || this.action === 'guardBreak') {
      this.blocking = false;
      this.sprinting = false;
      this._updateHit();
    } else {
      this.blocking = wantGuard && !this.guardBroken;
      this._updateMove(dt, input, cameraYaw);

      // バッファ消化
      const buffered = this._consumeBuffer();
      const wantRoll = buffered === 'roll' || this._consumeRollRequest();
      const wantLight = buffered === 'attack' || attackPressed;
      const wantHeavy = buffered === 'heavy' || heavyAttackPressed;

      if (flaskPressed && this.flasks > 0 && this.hp < PLAYER_MAX_HP) {
        this._startFlask();
      } else if (wantRoll && this.stamina >= Math.min(ROLL_STAMINA_COST, BACKSTEP_STAMINA)) {
        this.blocking = false;
        this.sprinting = false;
        // ロック中＋無方向入力 = バックステップ
        const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
        const s = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
        if (this.lockTargetPos && f === 0 && s === 0 && this.stamina >= BACKSTEP_STAMINA) {
          this._startBackstep();
        } else if (this.stamina >= ROLL_STAMINA_COST) {
          this._startRoll(input, cameraYaw);
        }
      } else if (!this.blocking && kickPressed && this.stamina >= KICK_STAMINA_COST) {
        this.comboStage = 0;
        this._comboQueuedNext = false;
        this.stamina = Math.max(0, this.stamina - KICK_STAMINA_COST);
        this.staminaRegenTimer = STAMINA_REGEN_DELAY;
        this._startAttack('kick');
      } else if (!this.blocking && wantHeavy && this.stamina >= HEAVY_ATTACK_STAMINA_COST) {
        this.comboStage = 0;
        this._comboQueuedNext = false;
        this.stamina = Math.max(0, this.stamina - HEAVY_ATTACK_STAMINA_COST);
        this.staminaRegenTimer = STAMINA_REGEN_DELAY;
        this._startAttack('heavy');
      } else if (!this.blocking && wantLight) {
        this.comboStage = 0;
        this._comboQueuedNext = false;
        if (this.criticalTarget?.openForCritical && this.tryCritical(this.criticalTarget)) {
          // 姿勢破壊クリティカル
        } else if (this.sprinting && this.stamina >= JUMP_ATTACK_STAMINA_COST) {
          this.stamina = Math.max(0, this.stamina - JUMP_ATTACK_STAMINA_COST);
          this.staminaRegenTimer = STAMINA_REGEN_DELAY;
          this._startAttack('jump');
        } else {
          this._startAttack('light');
        }
      }
    }

    if (this.guardBroken && this.action !== 'guardBreak' && this.action !== 'hit') {
      this.guardBroken = false;
    }

    this._updateStamina(dt);
    this.position.y = this._groundY() + this.groundYBias;
    const resolved = resolveCircleColliders(this.position.x, this.position.z, BODY_RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    if (
      this.action !== 'roll' &&
      this.action !== 'backstep' &&
      this.action !== 'attack' &&
      this.action !== 'hit' &&
      this.action !== 'guardBreak' &&
      this.action !== 'flask' &&
      this.action !== 'rest' &&
      this.action !== 'dead'
    ) {
      this.animator.setState(this.state);
    }
    this.animator.update(dt);
    this._syncRoot();
  }

  _bufferInput(kind) {
    this._bufferedAction = kind;
    this._bufferExpiresAt = performance.now() + INPUT_BUFFER_WINDOW * 1000;
  }

  _consumeBuffer() {
    if (!this._bufferedAction) return null;
    if (performance.now() > this._bufferExpiresAt) {
      this._bufferedAction = null;
      return null;
    }
    const k = this._bufferedAction;
    this._bufferedAction = null;
    return k;
  }

  _updateDodgeSprintInput(_dt, input) {
    const down = input.isDown('Space');
    // justPressed はここで消費し、移動側では isDown のみ見る
    const pressed = input.consumeJustPressed('Space');

    if (pressed) {
      this._dodgeHeld = true;
      this._dodgePressAt = performance.now();
      this._dodgeRollPending = true;
      this._sprintArmed = false;
    }

    if (down && this._dodgeHeld) {
      const held = (performance.now() - this._dodgePressAt) / 1000;
      if (held >= SPRINT_HOLD_THRESHOLD) {
        this._dodgeRollPending = false;
        this._sprintArmed = true;
      }
    }

    if (!down && this._dodgeHeld) {
      // 閾値前に離したらロール要求を立てる
      if (this._dodgeRollPending) this._rollRequested = true;
      this._dodgeHeld = false;
      this._dodgeRollPending = false;
      this._sprintArmed = false;
    }

    // busy中はロール要求をバッファへ回す（捨てない）
    if (this.action === 'roll' || this.action === 'attack' || this.action === 'hit' || this.action === 'backstep') {
      if (this._rollRequested) {
        this._bufferInput('roll');
        this._rollRequested = false;
      }
      this._dodgeRollPending = false;
    }
  }

  _consumeRollRequest() {
    if (!this._rollRequested) return false;
    this._rollRequested = false;
    return true;
  }

  _faceLockTarget(dt) {
    if (!this.lockTargetPos) return false;
    const dx = this.lockTargetPos.x - this.position.x;
    const dz = this.lockTargetPos.z - this.position.z;
    if (dx * dx + dz * dz < 1e-4) return false;
    const targetYaw = Math.atan2(-dx, -dz);
    this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
    return true;
  }

  _updateMove(dt, input, cameraYaw) {
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const s = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const moving = f !== 0 || s !== 0;
    const guarding = this.blocking;
    const locked = !!this.lockTargetPos;
    // エルデンリング風: 通常移動は歩き、B押しっぱなしでダッシュ。Shiftでも歩き固定
    const forceWalk = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const wantSprint = !guarding && !forceWalk && this._sprintArmed && input.isDown('Space');
    this.sprinting = wantSprint && moving;

    if (moving) {
      const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
      const dir = forward.multiplyScalar(f).add(right.multiplyScalar(s)).normalize();

      if (!this._faceLockTarget(dt)) {
        const targetYaw = Math.atan2(-dir.x, -dir.z);
        this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);
      }

      let targetSpeed = WALK_SPEED;
      if (guarding) targetSpeed = GUARD_WALK_SPEED;
      else if (this.sprinting) targetSpeed = SPRINT_SPEED;

      this.speed = damp(this.speed, targetSpeed, ACCEL_LAMBDA, dt);

      this.position.addScaledVector(dir, this.speed * dt);
      if (guarding) this.state = 'guardWalk';
      else if (this.sprinting) this.state = 'run';
      else this.state = 'run'; // デフォルトは常に走りアニメ
    } else {
      this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      this.sprinting = false;
      this._faceLockTarget(dt);
      this.state = guarding ? 'guardIdle' : 'idle';
    }
  }

  _startRoll(input, cameraYaw) {
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const s = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);

    let dir;
    if (f !== 0 || s !== 0) {
      const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
      dir = forward.multiplyScalar(f).add(right.multiplyScalar(s)).normalize();
    } else {
      // 入力が無ければ現在向いている方向へ転がる
      dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }

    this.rollDir.copy(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.action = 'roll';
    this.actionTimer = 0;
    this.actionStartedAt = performance.now();
    this.state = 'roll';
    this.animator.triggerRoll();

    this.stamina = Math.max(0, this.stamina - ROLL_STAMINA_COST);
    this.staminaRegenTimer = STAMINA_REGEN_DELAY;
  }

  _updateRoll(dt) {
    // フレームレートが落ちてdtクランプの影響を受けても確実に終了するよう、
    // 経過時間はdt積算ではなく実時計(performance.now())で判定する
    this.actionTimer = (performance.now() - this.actionStartedAt) / 1000;
    const t = Math.min(this.actionTimer / this.rollDuration, 1);

    this.invincible = t >= ROLL_INVINCIBLE_START && t <= ROLL_INVINCIBLE_END;

    // イーズアウト(2*(1-t))を速度係数にすると、積分(平均倍率1)がROLL_DISTANCEを
    // 保ったまま「最初は速く、終盤は減速して止まる」動きになる
    const speedFactor = 2 * (1 - t);
    const distanceThisFrame = (ROLL_DISTANCE / this.rollDuration) * speedFactor * dt;
    this.position.addScaledVector(this.rollDir, distanceThisFrame);

    if (t >= ROLL_RECOVERY_CUT) {
      this.action = null;
      this.invincible = false;
      this.state = 'idle';
    }
  }

  _startBackstep() {
    const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.rollDir.copy(back);
    this.action = 'backstep';
    this.actionTimer = 0;
    this.actionStartedAt = performance.now();
    this.state = 'roll';
    this.animator.triggerRoll();
    this.stamina = Math.max(0, this.stamina - BACKSTEP_STAMINA);
    this.staminaRegenTimer = STAMINA_REGEN_DELAY;
  }

  _updateBackstep(dt) {
    this.actionTimer = (performance.now() - this.actionStartedAt) / 1000;
    const t = Math.min(this.actionTimer / BACKSTEP_DURATION, 1);
    this.invincible = t >= BACKSTEP_IFRAMES_START && t <= BACKSTEP_IFRAMES_END;
    const speedFactor = 2 * (1 - t);
    this.position.addScaledVector(
      this.rollDir,
      (BACKSTEP_DISTANCE / BACKSTEP_DURATION) * speedFactor * dt,
    );
    if (t >= 0.85) {
      this.action = null;
      this.invincible = false;
      this.state = 'idle';
    }
  }

  _startFlask() {
    this.action = 'flask';
    this.actionStartedAt = performance.now();
    this.healing = true;
    this._usingFlask = true;
    this.speed = 0;
    this.flasks = Math.max(0, this.flasks - 1);
    this.flaskHealSfxPending = false;
    // 掲げるモーション(地面に立てる前まで)＋軽い傾きで飲む
    this.animator.triggerFlask();
    this.animator.setFlaskTilt(0);
  }

  _updateFlask() {
    const t = (performance.now() - this.actionStartedAt) / 1000;
    // 掲げたあと口元へ少し傾ける(モーション側で腕は上がっているので控えめに)
    const u = Math.min(1, Math.max(0, (t - 0.35) / (FLASK_USE_TIME * 0.55)));
    this.animator.setFlaskTilt(Math.sin(u * Math.PI) * 0.45);
    if (t >= FLASK_USE_TIME * 0.55 && this._usingFlask) {
      this.hp = Math.min(PLAYER_MAX_HP, this.hp + FLASK_HEAL);
      this._usingFlask = false;
      this.flaskHealSfxPending = true;
    }
    if (t >= FLASK_USE_TIME) {
      this.action = null;
      this.healing = false;
      this.animator.endFlask();
      this.animator.setState('idle');
    }
  }

  /** かがり火休息。A/T で呼ぶ */
  startRest() {
    if (this.action === 'dead' || this.action === 'rest') return false;
    this.action = 'rest';
    this.actionStartedAt = performance.now();
    this.healing = false;
    this.speed = 0;
    this.blocking = false;
    this.sprinting = false;
    this._restHealed = false;
    this.animator.setState('idle');
    // 座り込み風に少し沈める
    if (this.visualModel) {
      this.visualModel.position.y = this._visualBaseY - 0.35;
    }
    return true;
  }

  _updateRest() {
    const t = (performance.now() - this.actionStartedAt) / 1000;
    this.speed = 0;
    if (!this._restHealed && t >= REST_DURATION * 0.45) {
      this._restHealed = true;
      this.hp = PLAYER_MAX_HP;
      this.flasks = FLASK_MAX;
      this.stamina = STAMINA_MAX;
    }
    if (t >= REST_DURATION) {
      this.action = null;
      if (this.visualModel) this.visualModel.position.y = this._visualBaseY;
    }
  }

  consumeInteractPressed() {
    const v = !!this._interactPressed;
    this._interactPressed = false;
    return v;
  }

  /** 姿勢破壊された敵へのクリティカル */
  tryCritical(target) {
    if (!target?.openForCritical || !target.alive) return false;
    if (this.action) return false;
    const dist = this.position.distanceTo(target.position);
    if (dist > CRITICAL_RANGE) return false;
    this.stamina = Math.max(0, this.stamina - CRITICAL_STAMINA);
    this.staminaRegenTimer = STAMINA_REGEN_DELAY;
    this.comboStage = 0;
    this._startAttack('critical');
    return true;
  }

  _startAttack(kind) {
    this.action = 'attack';
    this.attackKind = kind;
    this.actionTimer = 0;
    this.actionStartedAt = performance.now();
    this.state = 'attack';
    this.speed = 0;
    this.attackTriggerId += 1;

    if (this.lockTargetPos) {
      const dx = this.lockTargetPos.x - this.position.x;
      const dz = this.lockTargetPos.z - this.position.z;
      if (dx * dx + dz * dz > 1e-4) {
        this.yaw = Math.atan2(-dx, -dz);
      }
    }

    if (kind === 'critical') {
      this.attackDuration = this.baseHeavyAttackDuration / 1.35;
      this.animator.triggerHeavyAttack(1.35);
      return;
    }
    if (kind === 'heavy') {
      this.attackDuration = this.baseHeavyAttackDuration / HEAVY_ATTACK_SPEED_MULT;
      this.animator.triggerHeavyAttack(HEAVY_ATTACK_SPEED_MULT);
      return;
    }
    if (kind === 'jump') {
      this.attackDuration = this.baseJumpAttackDuration / JUMP_ATTACK_SPEED_MULT;
      this.animator.triggerJumpAttack(JUMP_ATTACK_SPEED_MULT);
      return;
    }
    if (kind === 'kick') {
      this.attackDuration = this.baseKickDuration / KICK_SPEED_MULT;
      this.animator.triggerKick(KICK_SPEED_MULT);
      return;
    }

    const stage = this.comboStage;
    let baseDur = this.baseAttackDuration;
    if (stage === 1) baseDur = this.baseAttack2Duration;
    else if (stage >= 2) {
      baseDur = this.baseAttack3Duration;
      this.attackDuration = baseDur / ATTACK3_SPEED_MULT;
      this.animator.triggerAttack(ATTACK3_SPEED_MULT, {
        comboStage: stage,
        comboContinue: true,
      });
      return;
    }
    const speedMultiplier =
      stage === 0 ? LIGHT1_SPEED_MULT : 1 + stage * ATTACK_COMBO_SPEED_STEP;
    this.attackDuration = baseDur / speedMultiplier;
    this.animator.triggerAttack(speedMultiplier, {
      comboStage: stage,
      comboContinue: stage > 0,
    });
  }

  _updateAttack(dt, attackPressed) {
    this.actionTimer = (performance.now() - this.actionStartedAt) / 1000;
    const t = this.actionTimer / this.attackDuration;

    if (this.attackKind === 'heavy') {
      if (t < HEAVY_ATTACK_LUNGE_END) {
        const speedFactor = 2 * (1 - t / HEAVY_ATTACK_LUNGE_END);
        const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const distanceThisFrame =
          (HEAVY_ATTACK_LUNGE_DISTANCE / (this.attackDuration * HEAVY_ATTACK_LUNGE_END)) *
          speedFactor *
          dt;
        this.position.addScaledVector(dir, distanceThisFrame);
      }
      if (t >= HEAVY_ATTACK_RECOVERY_CUT) {
        this.action = null;
        this.attackKind = null;
        this._comboQueuedNext = false;
      }
      return;
    }

    if (this.attackKind === 'jump') {
      if (t < JUMP_ATTACK_LUNGE_END) {
        const speedFactor = 2 * (1 - t / JUMP_ATTACK_LUNGE_END);
        const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const distanceThisFrame =
          (JUMP_ATTACK_LUNGE_DISTANCE / (this.attackDuration * JUMP_ATTACK_LUNGE_END)) *
          speedFactor *
          dt;
        this.position.addScaledVector(dir, distanceThisFrame);
      }
      if (t >= JUMP_ATTACK_RECOVERY_CUT) {
        this.action = null;
        this.attackKind = null;
        this._comboQueuedNext = false;
      }
      return;
    }

    if (this.attackKind === 'kick') {
      if (t >= KICK_RECOVERY_CUT) {
        this.action = null;
        this.attackKind = null;
        this._comboQueuedNext = false;
      }
      return;
    }

    if (this.attackKind === 'critical') {
      if (t >= HEAVY_ATTACK_RECOVERY_CUT) {
        this.action = null;
        this.attackKind = null;
        this._comboQueuedNext = false;
      }
      return;
    }

    // 軽攻撃コンボ
    const isFinisher = this.comboStage >= 2;
    const windowStart = isFinisher ? ATTACK3_COMBO_WINDOW_START : ATTACK_COMBO_WINDOW_START;
    const recoveryCut = isFinisher ? ATTACK3_RECOVERY_CUT : ATTACK_RECOVERY_CUT;

    // 3段目は前方へ踏み込みながら出す
    if (isFinisher && t < ATTACK3_LUNGE_END) {
      const speedFactor = 2 * (1 - t / ATTACK3_LUNGE_END);
      const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const distanceThisFrame =
        (ATTACK3_LUNGE_DISTANCE / (this.attackDuration * ATTACK3_LUNGE_END)) * speedFactor * dt;
      this.position.addScaledVector(dir, distanceThisFrame);
    }

    if (attackPressed && t >= windowStart && this.comboStage < ATTACK_COMBO_MAX - 1) {
      this._comboQueuedNext = true;
    }

    if (t >= recoveryCut) {
      if (this._comboQueuedNext && this.comboStage < ATTACK_COMBO_MAX - 1) {
        this._comboQueuedNext = false;
        this.comboStage += 1;
        this._startAttack('light');
        return;
      }
      this.action = null;
      this.comboStage = 0;
      this.attackKind = null;
      this._comboQueuedNext = false;
    }
  }

  _updateStamina(dt) {
    if (this.sprinting && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - SPRINT_STAMINA_RATE * dt);
      this.staminaRegenTimer = STAMINA_REGEN_DELAY;
      if (this.stamina <= 0) {
        this.sprinting = false;
        this._sprintArmed = false;
      }
      return;
    }
    // 構え中もスタミナは通常どおり回復させる(構え自体では消費しない)
    if (this.staminaRegenTimer > 0) {
      this.staminaRegenTimer -= dt;
    } else if (this.stamina < STAMINA_MAX) {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
    }
  }

  // attackerPos を渡すとデッドアングル判定できる。options: { chipMult, unblockable }
  takeDamage(amount, attackerPos = null, options = {}) {
    if (this.action === 'dead' || this.invincible) return;
    this.lastHitWasGuardBreak = false;
    this.lastHitWasDeadAngle = false;

    let blocked = this.blocking && !options.unblockable;
    if (blocked && attackerPos) {
      const toAtkX = attackerPos.x - this.position.x;
      const toAtkZ = attackerPos.z - this.position.z;
      const len = Math.hypot(toAtkX, toAtkZ) || 1;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const dot = (fx * toAtkX + fz * toAtkZ) / len;
      if (dot < 0.15) {
        blocked = false;
        this.lastHitWasDeadAngle = true;
      }
    }

    this.lastHitWasBlocked = blocked;
    if (blocked) {
      const chip = amount * (options.chipMult ?? GUARD_CHIP_MULT);
      this.stamina = Math.max(0, this.stamina - chip);
      this.staminaRegenTimer = STAMINA_REGEN_DELAY;
      const dealt = amount * GUARD_DAMAGE_MULT;
      this.hp = Math.max(0, this.hp - dealt);
      if (this.stamina <= 0.5) {
        this.guardBroken = true;
        this.lastHitWasGuardBreak = true;
        this.blocking = false;
        this.stamina = 0;
        this._startGuardBreak();
      }
    } else {
      this.hp = Math.max(0, this.hp - amount);
      if (this.action === 'flask' || this.healing) {
        // 回復隙は必ずよろける
        this.healing = false;
        this._usingFlask = false;
        this.flaskHealSfxPending = false;
        this.animator.endFlask();
        if (this.hp > 0) this._startHit();
      } else if (this.action !== 'attack' && this.hp > 0) {
        this._startHit();
      }
    }

    if (this.hp <= 0) this._startDeath();
  }

  _startGuardBreak() {
    this.action = 'guardBreak';
    this.actionTimer = 0;
    this.actionStartedAt = performance.now();
    this.state = 'hit';
    this.speed = 0;
    this.animator.triggerHit();
  }

  _startHit() {
    this.animator.endFlask?.();
    this.action = 'hit';
    this.actionTimer = 0;
    this.actionStartedAt = performance.now();
    this.state = 'hit';
    this.speed = 0;
    this.healing = false;
    this._usingFlask = false;
    this.flaskHealSfxPending = false;
    this._comboQueuedNext = false;
    this.animator.triggerHit();
  }

  _updateHit() {
    this.actionTimer = (performance.now() - this.actionStartedAt) / 1000;
    const stun =
      this.action === 'guardBreak'
        ? GUARD_BREAK_STUN
        : Math.max(HIT_STUN_DURATION, this.baseHitDuration * 0.75);
    if (this.actionTimer >= stun) {
      this.action = null;
      this.guardBroken = false;
    }
  }

  _startDeath() {
    this.animator.endFlask?.();
    this.action = 'dead';
    this.state = 'dead';
    this.speed = 0;
    this.invincible = false;
    this.healing = false;
    this.animator.triggerDeath();
  }

  respawn(position) {
    this.hp = PLAYER_MAX_HP;
    this.stamina = STAMINA_MAX;
    this.flasks = FLASK_MAX;
    this.action = null;
    this.state = 'idle';
    this.speed = 0;
    this.invincible = false;
    this.blocking = false;
    this.healing = false;
    this.guardBroken = false;
    this.comboStage = 0;
    this.attackKind = null;
    if (position) this.position.copy(position);
  }

  // 斜面では中心だけだと谷側が浮いて見えるため、左右の平均高さを使う
  _groundY() {
    const x = this.position.x;
    const z = this.position.z;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const stance = 0.25;
    const y0 = getGroundHeight(x, z);
    const yL = getGroundHeight(x - right.x * stance, z - right.z * stance);
    const yR = getGroundHeight(x + right.x * stance, z + right.z * stance);
    return (y0 + yL + yR) / 3;
  }

  _syncRoot() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET;
  }
}
