import * as THREE from 'three';

/**
 * エルデンリング風の近接戦闘ブレイン。
 * - 間合い維持・回り込み
 * - 溜め/遅延攻撃・コンボ・隙突き
 * - ロール終わりの狩り（ロールキャッチ）
 * - 攻撃中ハイパーアーマー / ポイズ
 */

export function createPlayerCombatContext() {
  return {
    position: new THREE.Vector3(),
    prevPosition: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    action: null,
    prevAction: null,
    blocking: false,
    invincible: false,
    stamina: 100,
    staminaRatio: 1,
    attacking: false,
    rolling: false,
    hitStun: false,
    rollEndedAgo: 99,
    attackEndedAgo: 99,
    time: 0,
  };
}

export function syncPlayerCombatContext(ctx, controller, dt) {
  ctx.time += dt;
  ctx.prevAction = ctx.action;
  if (dt > 1e-6) {
    ctx.velocity.copy(controller.position).sub(ctx.position).multiplyScalar(1 / dt);
    ctx.velocity.y = 0;
  }
  ctx.prevPosition.copy(ctx.position);
  ctx.position.copy(controller.position);
  ctx.action = controller.action;
  ctx.blocking = !!controller.blocking;
  ctx.invincible = !!controller.invincible;
  ctx.stamina = controller.stamina ?? 100;
  ctx.staminaRatio = ctx.stamina / 100;
  ctx.attacking = ctx.action === 'attack';
  ctx.rolling = ctx.action === 'roll';
  ctx.hitStun = ctx.action === 'hit' || ctx.action === 'guardBreak';
  ctx.healing = !!controller.healing;
  ctx.guardBroken = !!controller.guardBroken;

  if (ctx.prevAction === 'roll' && ctx.action !== 'roll') ctx.rollEndedAgo = 0;
  else ctx.rollEndedAgo += dt;
  if (ctx.prevAction === 'attack' && ctx.action !== 'attack') ctx.attackEndedAgo = 0;
  else ctx.attackEndedAgo += dt;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function pickWeighted(entries) {
  let total = 0;
  for (const e of entries) total += Math.max(0, e.w);
  if (total <= 0) return entries[0]?.id ?? null;
  let r = Math.random() * total;
  for (const e of entries) {
    r -= Math.max(0, e.w);
    if (r <= 0) return e.id;
  }
  return entries[entries.length - 1].id;
}

export class SoulsMeleeBrain {
  /**
   * @param {object} cfg
   */
  constructor(cfg = {}) {
    this.cfg = {
      preferredRange: 2.3,
      attackRange: 2.5,
      closeRange: 1.35,
      engageRange: 5.5,
      strafeSpeedMult: 0.55,
      approachSpeedMult: 1.0,
      retreatSpeedMult: 0.7,
      aggression: 0.55,
      patienceMin: 0.4,
      patienceMax: 1.25,
      comboChance: 0.42,
      maxCombo: 2,
      delayedChance: 0.32,
      gapCloseChance: 0.28,
      rollCatchWindow: 0.65,
      rollCatchChance: 0.72,
      punishWindow: 0.55,
      punishChance: 0.6,
      blockPressureChance: 0.35,
      repositionChance: 0.45,
      repositionTime: [0.55, 1.15],
      strafeTime: [0.7, 1.6],
      poiseMax: 45,
      hyperArmorPoise: 999,
      recoverTime: [0.35, 0.75],
      facingYawOffset: Math.PI, // atan2(-dx,-dz) 系
      ...cfg,
    };

    this.mode = 'approach'; // approach | strafe | pressure | recover | reposition
    this.modeTimer = 0;
    this.patience = randRange(this.cfg.patienceMin, this.cfg.patienceMax);
    this.strafeSign = Math.random() < 0.5 ? 1 : -1;
    this.comboLeft = 0;
    this.poise = this.cfg.poiseMax;
    this.hyperArmor = false;
    this.queuedAttack = null; // 'normal' | 'delayed' | 'gap' | 'combo' | 'punish'
    this._tmp = new THREE.Vector3();
    this._side = new THREE.Vector3();
  }

  resetCombat() {
    this.mode = 'approach';
    this.modeTimer = 0;
    this.patience = randRange(this.cfg.patienceMin, this.cfg.patienceMax);
    this.comboLeft = 0;
    this.queuedAttack = null;
    this.hyperArmor = false;
    this.poise = this.cfg.poiseMax;
  }

  /** 攻撃開始時 */
  beginAttack(kind) {
    this.hyperArmor = true;
    this.poise = this.cfg.hyperArmorPoise;
    this.mode = 'pressure';
    this.queuedAttack = null;
    if (kind === 'combo') {
      // already counted
    } else if (kind === 'normal' || kind === 'delayed' || kind === 'gap' || kind === 'punish') {
      this.comboLeft =
        Math.random() < this.cfg.comboChance
          ? Math.floor(randRange(1, this.cfg.maxCombo + 0.99))
          : 0;
    }
  }

  /** 攻撃終了。hitLanded ならコンボ継続を検討 */
  endAttack(hitLanded = false) {
    this.hyperArmor = false;
    this.poise = this.cfg.poiseMax * 0.65;

    if (hitLanded && this.comboLeft > 0) {
      this.comboLeft -= 1;
      this.queuedAttack = 'combo';
      this.patience = 0.08;
      this.mode = 'pressure';
      this.modeTimer = 0.12;
      return;
    }

    this.comboLeft = 0;
    this.mode = 'recover';
    this.modeTimer = randRange(this.cfg.recoverTime[0], this.cfg.recoverTime[1]);
    this.patience = randRange(this.cfg.patienceMin, this.cfg.patienceMax);
    this.queuedAttack = null;
  }

  /**
   * 被弾時。false を返すとスタッガーしない（ハイパーアーマー等）
   */
  absorbHit(damage, { forceStagger = false } = {}) {
    if (forceStagger) {
      this.hyperArmor = false;
      this.poise = 0;
      this.comboLeft = 0;
      this.queuedAttack = null;
      return true;
    }
    if (this.hyperArmor) return false;
    this.poise -= damage;
    if (this.poise > 0) return false;
    this.poise = this.cfg.poiseMax;
    this.comboLeft = 0;
    this.queuedAttack = null;
    this.mode = 'recover';
    this.modeTimer = randRange(0.2, 0.45);
    return true;
  }

  /**
   * @returns {{
   *   moveDir: THREE.Vector3 | null,
   *   speedMult: number,
   *   facePlayer: boolean,
   *   attack: null | 'normal' | 'delayed' | 'gap' | 'combo' | 'punish',
   *   anim: 'idle' | 'walk' | 'run',
   * }}
   */
  think(dt, selfPos, playerCtx, dist) {
    const cfg = this.cfg;
    this.modeTimer = Math.max(0, this.modeTimer - dt);
    this.patience = Math.max(0, this.patience - dt * (0.7 + cfg.aggression));

    // ポイズ自然回復
    if (!this.hyperArmor) {
      this.poise = Math.min(cfg.poiseMax, this.poise + dt * 12);
    }

    // ロールキャッチ / 攻撃隙 / ガード圧を割り込みキューへ
    this._considerReactiveQueue(playerCtx, dist);

    if (this.queuedAttack === 'combo' && dist <= cfg.attackRange * 1.15) {
      return this._commit('combo', selfPos, playerCtx);
    }

    if (this.mode === 'recover') {
      if (this.modeTimer <= 0) {
        this.mode =
          Math.random() < cfg.repositionChance ? 'reposition' : 'strafe';
        this.modeTimer =
          this.mode === 'reposition'
            ? randRange(cfg.repositionTime[0], cfg.repositionTime[1])
            : randRange(cfg.strafeTime[0], cfg.strafeTime[1]);
        this.strafeSign = Math.random() < 0.5 ? 1 : -1;
      }
      return this._hold(selfPos, playerCtx, 'idle');
    }

    if (this.mode === 'reposition') {
      if (this.modeTimer <= 0) {
        this.mode = 'strafe';
        this.modeTimer = randRange(cfg.strafeTime[0], cfg.strafeTime[1]);
      }
      // 斜め後ろへ下がって間合いを作り直す
      const dir = this._dirToPlayer(selfPos, playerCtx);
      this._side.set(-dir.z, 0, dir.x).multiplyScalar(this.strafeSign);
      this._tmp.copy(dir).multiplyScalar(-0.55).addScaledVector(this._side, 0.85).normalize();
      return {
        moveDir: this._tmp.clone(),
        speedMult: cfg.retreatSpeedMult,
        facePlayer: true,
        attack: null,
        anim: 'walk',
      };
    }

    // 遠すぎ → 接近
    if (dist > cfg.engageRange) {
      this.mode = 'approach';
    } else if (dist > cfg.preferredRange + 0.85) {
      this.mode = 'approach';
    } else if (dist < cfg.closeRange) {
      // 密着されすぎたら下がる or 即攻撃
      if (this.patience <= 0 || this.queuedAttack) {
        return this._pickAndCommit(selfPos, playerCtx, dist);
      }
      const dir = this._dirToPlayer(selfPos, playerCtx);
      this._tmp.copy(dir).multiplyScalar(-1);
      return {
        moveDir: this._tmp.clone(),
        speedMult: cfg.retreatSpeedMult,
        facePlayer: true,
        attack: null,
        anim: 'walk',
      };
    } else if (this.mode === 'approach') {
      this.mode = 'strafe';
      this.modeTimer = randRange(cfg.strafeTime[0], cfg.strafeTime[1]);
      this.strafeSign = Math.random() < 0.5 ? 1 : -1;
    }

    // 攻撃コミット判定
    const inRange = dist <= cfg.attackRange;
    const ready =
      inRange &&
      (this.queuedAttack ||
        this.patience <= 0 ||
        (playerCtx?.blocking && Math.random() < cfg.blockPressureChance * dt * 3));

    if (ready) {
      return this._pickAndCommit(selfPos, playerCtx, dist);
    }

    if (this.mode === 'approach' || dist > cfg.preferredRange + 0.35) {
      const dir = this._dirToPlayer(selfPos, playerCtx);
      return {
        moveDir: dir.clone(),
        speedMult: cfg.approachSpeedMult,
        facePlayer: true,
        attack: null,
        anim: dist > cfg.preferredRange + 1.5 ? 'run' : 'walk',
      };
    }

    // strafe: 好みの間合いで回り込み
    if (this.modeTimer <= 0) {
      this.strafeSign *= -1;
      this.modeTimer = randRange(cfg.strafeTime[0], cfg.strafeTime[1]);
      // たまに再接近や下げ
      if (Math.random() < 0.2) this.patience *= 0.5;
    }
    const dir = this._dirToPlayer(selfPos, playerCtx);
    this._side.set(-dir.z, 0, dir.x).multiplyScalar(this.strafeSign);
    const radial =
      dist > cfg.preferredRange + 0.25 ? 0.35 : dist < cfg.preferredRange - 0.25 ? -0.45 : 0.05;
    this._tmp.copy(dir).multiplyScalar(radial).addScaledVector(this._side, 1).normalize();
    return {
      moveDir: this._tmp.clone(),
      speedMult: cfg.strafeSpeedMult,
      facePlayer: true,
      attack: null,
      anim: 'walk',
    };
  }

  _considerReactiveQueue(playerCtx, dist) {
    if (!playerCtx || this.queuedAttack) return;
    const cfg = this.cfg;

    // ロール着地直後の狩り
    if (
      playerCtx.rollEndedAgo < cfg.rollCatchWindow &&
      dist <= cfg.attackRange * 1.35 &&
      Math.random() < cfg.rollCatchChance * 0.08
    ) {
      this.queuedAttack = Math.random() < 0.55 ? 'delayed' : 'punish';
      this.patience = 0;
      return;
    }

    // プレイヤー攻撃の後隙
    if (
      playerCtx.attackEndedAgo < cfg.punishWindow &&
      dist <= cfg.attackRange * 1.2 &&
      Math.random() < cfg.punishChance * 0.1
    ) {
      this.queuedAttack = 'punish';
      this.patience = 0;
      return;
    }

    // 回復隙・ガード崩れを狙い撃ち
    if (
      (playerCtx.healing || playerCtx.guardBroken) &&
      dist <= cfg.attackRange * 1.4 &&
      Math.random() < 0.15
    ) {
      this.queuedAttack = 'punish';
      this.patience = 0;
      return;
    }

    // スタミナ切れ気味なら強圧
    if (playerCtx.staminaRatio < 0.25 && dist <= cfg.attackRange && Math.random() < 0.05) {
      this.queuedAttack = 'normal';
      this.patience = 0;
    }
  }

  _pickAndCommit(selfPos, playerCtx, dist) {
    const cfg = this.cfg;
    let kind = this.queuedAttack;
    if (!kind) {
      const weights = [
        { id: 'normal', w: 1.0 },
        { id: 'delayed', w: cfg.delayedChance * 2.2 },
        {
          id: 'gap',
          w: dist > cfg.preferredRange * 0.9 ? cfg.gapCloseChance * 2.5 : 0.15,
        },
        { id: 'punish', w: playerCtx?.hitStun ? 1.2 : 0.1 },
      ];
      kind = pickWeighted(weights);
    }
    return this._commit(kind, selfPos, playerCtx);
  }

  _commit(kind, selfPos, playerCtx) {
    this.patience = randRange(this.cfg.patienceMin, this.cfg.patienceMax);
    return {
      moveDir: null,
      speedMult: 0,
      facePlayer: true,
      attack: kind,
      anim: 'idle',
    };
  }

  _hold(selfPos, playerCtx, anim = 'idle') {
    return {
      moveDir: null,
      speedMult: 0,
      facePlayer: true,
      attack: null,
      anim,
    };
  }

  _dirToPlayer(selfPos, playerCtx) {
    const p = playerCtx?.position;
    if (!p) {
      this._tmp.set(0, 0, 1);
      return this._tmp;
    }
    this._tmp.set(p.x - selfPos.x, 0, p.z - selfPos.z);
    if (this._tmp.lengthSq() < 1e-6) this._tmp.set(0, 0, 1);
    else this._tmp.normalize();
    return this._tmp;
  }

  yawTowardPlayer(selfPos, playerCtx) {
    const d = this._dirToPlayer(selfPos, playerCtx);
    // facingYawOffset=PI の敵は atan2(-x,-z)
    if (Math.abs(this.cfg.facingYawOffset) > 1) {
      return Math.atan2(-d.x, -d.z);
    }
    return Math.atan2(d.x, d.z);
  }
}

/** 攻撃種別ごとのパラメータ（単一クリップ敵向け） */
export function attackProfile(kind) {
  switch (kind) {
    case 'delayed':
      return {
        windup: 0.55,
        trackUntil: 0.45,
        timeScale: 0.85,
        lunge: 0.35,
        damageMult: 1.15,
        impactT: 0.48,
        impactEnd: 0.72,
      };
    case 'gap':
      return {
        windup: 0.12,
        trackUntil: 0.2,
        timeScale: 1.25,
        lunge: 2.4,
        damageMult: 1.0,
        impactT: 0.35,
        impactEnd: 0.6,
      };
    case 'combo':
      return {
        windup: 0.05,
        trackUntil: 0.15,
        timeScale: 1.35,
        lunge: 0.9,
        damageMult: 0.85,
        impactT: 0.32,
        impactEnd: 0.58,
      };
    case 'punish':
      return {
        windup: 0.08,
        trackUntil: 0.1,
        timeScale: 1.4,
        lunge: 1.2,
        damageMult: 1.1,
        impactT: 0.3,
        impactEnd: 0.55,
      };
    default:
      return {
        windup: 0.18,
        trackUntil: 0.35,
        timeScale: 1.05,
        lunge: 0.7,
        damageMult: 1.0,
        impactT: 0.42,
        impactEnd: 0.65,
      };
  }
}
