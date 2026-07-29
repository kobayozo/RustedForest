import * as THREE from 'three';

/** ヒットストップ（攻撃側・被弾側の一瞬の硬直） */
export class HitStop {
  constructor() {
    this.remaining = 0;
  }

  trigger(seconds = 0.06) {
    this.remaining = Math.max(this.remaining, seconds);
  }

  /** @returns {number} 実効dt。ヒットストップ中はほぼ0 */
  scaleDt(dt) {
    if (this.remaining <= 0) return dt;
    this.remaining -= dt;
    return dt * 0.05;
  }

  get active() {
    return this.remaining > 0;
  }
}

/** 攻撃種別ごとの姿勢（スタンス）ダメージ */
export function stanceDamageForAttack(kind, comboStage = 0) {
  if (kind === 'heavy') return 38;
  if (kind === 'jump') return 28;
  if (kind === 'kick') return 45; // 盾割り/姿勢削り寄り
  if (kind === 'critical') return 0;
  if (kind === 'light') return comboStage >= 2 ? 22 : 12;
  return 10;
}

export function initEnemyStance(enemy, maxStance = 80) {
  enemy.maxStance = maxStance;
  enemy.stance = maxStance;
  enemy.stanceBroken = false;
  enemy.stanceBreakTimer = 0;
  enemy.openForCritical = false;
  enemy._hyperArmorUntilT = 0.15; // 攻撃正規化時刻: これ以降〜着弾前がHA
  enemy._hyperArmorEndT = 0.72;
}

export function updateEnemyStance(enemy, dt) {
  if (!enemy || enemy.maxStance == null) return;
  if (enemy.stanceBroken) {
    enemy.stanceBreakTimer -= dt;
    if (enemy.stanceBreakTimer <= 0) {
      enemy.stanceBroken = false;
      enemy.openForCritical = false;
      enemy.stance = enemy.maxStance * 0.55;
    }
    return;
  }
  if (enemy.action !== 'attack' && enemy.action !== 'windup') {
    enemy.stance = Math.min(enemy.maxStance, enemy.stance + dt * 10);
  }
}

/**
 * スタンス削り。破壊したら true。
 * 攻撃中ハイパーアーマーは stance は削れるが stagger は別判定。
 */
export function applyStanceDamage(enemy, stanceDmg, { forceBreak = false } = {}) {
  if (!enemy || enemy.maxStance == null) return false;
  if (enemy.stanceBroken) return true;
  enemy.stance = Math.max(0, enemy.stance - stanceDmg);
  if (forceBreak || enemy.stance <= 0) {
    enemy.stance = 0;
    enemy.stanceBroken = true;
    enemy.stanceBreakTimer = 2.4;
    enemy.openForCritical = true;
    return true;
  }
  return false;
}

/** 攻撃アニメ正規化時刻 t がハイパーアーマー窓か */
export function inHyperArmorWindow(enemy, t) {
  if (!enemy || enemy.action !== 'attack') return false;
  const a = enemy._hyperArmorUntilT ?? 0.18;
  const b = enemy._hyperArmorEndT ?? 0.7;
  return t >= a && t <= b;
}

/**
 * ガード角度。正面半球のみガード有効。背後〜側面はデッドアングル。
 * attackerPos から defender を見たとき、defender の正面との角度。
 */
export function isGuardEffective(defenderPos, defenderYaw, attackerPos, maxAngle = Math.PI * 0.55) {
  const toAtk = new THREE.Vector3(
    attackerPos.x - defenderPos.x,
    0,
    attackerPos.z - defenderPos.z,
  );
  if (toAtk.lengthSq() < 1e-6) return true;
  toAtk.normalize();
  // プレイヤー正面（MODEL_YAW_OFFSET込みの論理正面）
  const forward = new THREE.Vector3(-Math.sin(defenderYaw), 0, -Math.cos(defenderYaw));
  const dot = forward.dot(toAtk);
  const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
  return ang <= maxAngle;
}

/** 付近の敵にヘイト共有 */
export function shareAggro(enemies, source, playerPos, radius = 14) {
  if (!source?.alive) return;
  for (const e of enemies) {
    if (!e.alive || e === source) continue;
    if (e.position.distanceTo(source.position) > radius) continue;
    if (e.state === 'idle' || e.state === 'wander') {
      e.state = 'chase';
      e.brain?.resetCombat?.();
    }
  }
}
