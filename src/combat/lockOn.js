import * as THREE from 'three';

const LOCK_RANGE = 16;
const LOCK_BREAK_RANGE = 24;
const LOCK_FOCUS_HEIGHT = 1.1;

// カメラ前方寄り・近い敵を優先してロック対象を選ぶ
export function findLockTarget(playerPos, cameraYaw, enemies, range = LOCK_RANGE) {
  let best = null;
  let bestScore = Infinity;
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));

  for (const enemy of enemies) {
    if (!enemy.alive || enemy.action === 'fly') continue;
    const dx = enemy.position.x - playerPos.x;
    const dz = enemy.position.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range || dist < 0.25) continue;
    const to = new THREE.Vector3(dx, 0, dz).normalize();
    const facing = forward.dot(to);
    // 正面外でも拾うが、正面・近距離を優先
    const score = dist - Math.max(facing, -0.2) * 5;
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

export function getLockFocusPosition(enemy, out = new THREE.Vector3()) {
  return out.set(enemy.position.x, enemy.position.y + LOCK_FOCUS_HEIGHT, enemy.position.z);
}

export function shouldBreakLock(playerPos, enemy) {
  if (!enemy || !enemy.alive) return true;
  const dx = enemy.position.x - playerPos.x;
  const dz = enemy.position.z - playerPos.z;
  return Math.hypot(dx, dz) > LOCK_BREAK_RANGE;
}

export { LOCK_RANGE, LOCK_BREAK_RANGE, LOCK_FOCUS_HEIGHT };
