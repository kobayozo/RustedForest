import * as THREE from 'three';
import { getGroundHeight } from '../physics/collision.js';
import { damp, dampAngle } from '../utils/math.js';

const WALK_SPEED = 2.6;
const RUN_SPEED = 6.0;
const TURN_LAMBDA = 14;
const ACCEL_LAMBDA = 10;

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
const ATTACK_RECOVERY_CUT = 0.75;

// 攻撃コンボ: 利用可能なクリップが"Sword_Attack"1種類しか無いため、段が進むごとに
// 再生速度を上げ、体の向きを左右交互にひねることで単調な繰り返しに見えないようにする
const ATTACK_COMBO_MAX = 3;
const ATTACK_COMBO_WINDOW_START = 0.35; // このタイミング以降に次の入力があれば繋げる
const ATTACK_COMBO_SPEED_STEP = 0.18; // 段ごとに再生速度を上げる割合
const ATTACK_COMBO_YAW_KICK = 0.22; // 段ごとに交互に振る体の向き(ラジアン)

// 重攻撃: 通常攻撃と同じクリップを使うが、あえて再生を遅くして「タメ」の重みを
// 出す。コンボには繋がず単発、スタミナ消費も大きく、前進(踏み込み)を伴う
const HEAVY_ATTACK_STAMINA_COST = 32;
const HEAVY_ATTACK_SPEED_MULT = 0.65;
const HEAVY_ATTACK_RECOVERY_CUT = 0.7;
const HEAVY_ATTACK_LUNGE_DISTANCE = 0.5;
const HEAVY_ATTACK_LUNGE_END = 0.4; // 踏み込みが起きるのはクリップ前半のみ

const STAMINA_MAX = 100;
const STAMINA_REGEN_RATE = 18; // per second
const STAMINA_REGEN_DELAY = 0.45; // 行動後、回復が始まるまでの待ち時間

const PLAYER_MAX_HP = 100;
const HIT_STUN_DURATION = 0.4; // 被弾時ののけぞり時間(短めにしてテンポを保つ)

// モデルによっては正面がZ+/Z-どちらを向いているか異なるため、見た目確認の上で調整する
export const MODEL_YAW_OFFSET = Math.PI;

export class PlayerController {
  constructor(root, animator) {
    this.root = root;
    this.animator = animator;
    this.position = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.speed = 0;
    this.state = 'idle';

    this.stamina = STAMINA_MAX;
    this.staminaRegenTimer = 0;

    // action: 'roll' | 'attack' | null。移動入力を無視して専用モーションを再生する
    this.action = null;
    this.actionTimer = 0;
    this.rollDuration = animator.getClipDuration('roll');
    this.baseAttackDuration = animator.getClipDuration('attack');
    this.attackDuration = this.baseAttackDuration;
    this.rollDir = new THREE.Vector3(0, 0, -1);
    this.invincible = false;

    // 攻撃コンボの進行状況。comboStageは0始まり、attackTriggerIdは1発ごとに
    // インクリメントするので、外部(main.js)が「新しい1発が始まった」ことを検知できる
    this.comboStage = 0;
    this.attackTriggerId = 0;
    this.attackKind = null; // 'light' | 'heavy'
    this._comboQueuedNext = false;

    this.hp = PLAYER_MAX_HP;
    this.maxHp = PLAYER_MAX_HP;
  }

  update(dt, input, cameraYaw) {
    if (this.action === 'dead') {
      // 死亡後は入力を一切受け付けず、死亡モーションの再生だけ続ける
      this.animator.update(dt);
      return;
    }

    // 行動中(ロール/攻撃)かどうかに関わらず毎フレーム消費する。busy中は判定に
    // 使わず捨てることで、ロール中に押したSpace/クリックが行動終了の瞬間に
    // 溜まっていた入力として突然発火する(連続入力時の予期せぬ暴発)のを防ぐ
    const rollPressed = input.consumeJustPressed('Space');
    const attackPressed = input.consumeJustPressed('Mouse0');
    const heavyAttackPressed = input.consumeJustPressed('Mouse2');

    if (this.action === 'roll') {
      this._updateRoll(dt);
    } else if (this.action === 'attack') {
      this._updateAttack(dt, attackPressed);
    } else if (this.action === 'hit') {
      this._updateHit();
    } else {
      this._updateMove(dt, input, cameraYaw);

      if (rollPressed && this.stamina >= ROLL_STAMINA_COST) {
        this._startRoll(input, cameraYaw);
      } else if (heavyAttackPressed && this.stamina >= HEAVY_ATTACK_STAMINA_COST) {
        this.comboStage = 0;
        this.stamina = Math.max(0, this.stamina - HEAVY_ATTACK_STAMINA_COST);
        this.staminaRegenTimer = STAMINA_REGEN_DELAY;
        this._startAttack('heavy');
      } else if (attackPressed) {
        this.comboStage = 0;
        this._startAttack('light');
      }
    }

    this._updateStamina(dt);
    this.position.y = getGroundHeight(this.position.x, this.position.z);

    this.animator.setState(this.state);
    this.animator.update(dt);

    this._syncRoot();
  }

  _updateMove(dt, input, cameraYaw) {
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const s = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    // 既定を走りにし、Shiftで抑えて歩く(狙いを定めたい場面向け)
    const walking = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const moving = f !== 0 || s !== 0;

    if (moving) {
      const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
      const dir = forward.multiplyScalar(f).add(right.multiplyScalar(s)).normalize();

      const targetYaw = Math.atan2(-dir.x, -dir.z);
      this.yaw = dampAngle(this.yaw, targetYaw, TURN_LAMBDA, dt);

      const targetSpeed = walking ? WALK_SPEED : RUN_SPEED;
      this.speed = damp(this.speed, targetSpeed, ACCEL_LAMBDA, dt);

      this.position.addScaledVector(dir, this.speed * dt);
      this.state = walking ? 'walk' : 'run';
    } else {
      this.speed = damp(this.speed, 0, ACCEL_LAMBDA, dt);
      this.state = 'idle';
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
    }
  }

  _startAttack(kind) {
    this.action = 'attack';
    this.attackKind = kind;
    this.actionTimer = 0;
    this.actionStartedAt = performance.now();
    this.state = 'attack';
    this.speed = 0;
    this.attackTriggerId += 1;

    if (kind === 'heavy') {
      // あえて再生を遅くして「タメ」の重みを出す。コンボの向き変更は行わず、
      // 今向いている方向へまっすぐ踏み込む一撃にする
      this.attackDuration = this.baseAttackDuration / HEAVY_ATTACK_SPEED_MULT;
      this.animator.triggerAttack(HEAVY_ATTACK_SPEED_MULT);
    } else {
      // 段が進むほど再生を速くする(実時間の長さはその分短くなる)。同じクリップの
      // 使い回しだと単調なので、左右交互に少し体をひねって毎回違う一撃に見せる
      const speedMultiplier = 1 + this.comboStage * ATTACK_COMBO_SPEED_STEP;
      this.attackDuration = this.baseAttackDuration / speedMultiplier;
      const kick = ATTACK_COMBO_YAW_KICK * (this.comboStage % 2 === 0 ? 1 : -1);
      this.yaw += kick;
      this.animator.triggerAttack(speedMultiplier);
    }
  }

  _updateAttack(dt, attackPressed) {
    // dt積算だと低フレームレート時にdtクランプの影響で進みが遅くなり、
    // 攻撃状態から抜けられなくなることがあったため実時計で判定する
    this.actionTimer = (performance.now() - this.actionStartedAt) / 1000;
    const t = this.actionTimer / this.attackDuration;

    if (this.attackKind === 'heavy') {
      // 振り下ろしの序盤だけ前方へ踏み込む(イーズアウトで最初に速く、すぐ減速)
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
      }
      return;
    }

    // コンボ受付ウィンドウ内に次の攻撃入力があれば、硬直を待たず即座に次の段へ繋げる
    if (attackPressed && t >= ATTACK_COMBO_WINDOW_START && this.comboStage < ATTACK_COMBO_MAX - 1) {
      this.comboStage += 1;
      this._startAttack('light');
      return;
    }

    if (t >= ATTACK_RECOVERY_CUT) {
      this.action = null;
      this.comboStage = 0;
      this.attackKind = null;
    }
  }

  _updateStamina(dt) {
    if (this.staminaRegenTimer > 0) {
      this.staminaRegenTimer -= dt;
    } else if (this.stamina < STAMINA_MAX) {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
    }
  }

  // ロール中の無敵時間はここで一括判定する。既に死亡している場合は何もしない。
  // 攻撃モーション中(振り始めていた場合)はダメージは受けつつもよろけで中断しない
  // (=攻撃側にハイパーアーマーを持たせる)。これが無いと近接では敵の攻撃周期の方が
  // 短く、プレイヤーが常に振り始める前にのけぞらされて一撃も入らなくなってしまう
  takeDamage(amount) {
    if (this.action === 'dead' || this.invincible) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this._startDeath();
    } else if (this.action !== 'attack') {
      this._startHit();
    }
  }

  _startHit() {
    this.action = 'hit';
    this.actionTimer = 0;
    this.actionStartedAt = performance.now();
    this.state = 'hit';
    this.speed = 0;
    this.animator.triggerHit();
  }

  _updateHit() {
    this.actionTimer = (performance.now() - this.actionStartedAt) / 1000;
    if (this.actionTimer >= HIT_STUN_DURATION) {
      this.action = null;
    }
  }

  _startDeath() {
    this.action = 'dead';
    this.state = 'dead';
    this.speed = 0;
    this.invincible = false;
    this.animator.triggerDeath();
  }

  // GAME OVER画面からのリスポーン。HP/スタミナ/戦闘状態を全て初期値に戻し、
  // 指定位置(省略時は現在地)へ再配置する。アニメーションは次のupdate()で
  // action=null経由の通常フローに乗るため、ここではsetState()を呼ぶ必要はない
  respawn(position) {
    this.hp = PLAYER_MAX_HP;
    this.stamina = STAMINA_MAX;
    this.action = null;
    this.state = 'idle';
    this.speed = 0;
    this.invincible = false;
    this.comboStage = 0;
    this.attackKind = null;
    if (position) this.position.copy(position);
  }

  _syncRoot() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET;
  }
}
