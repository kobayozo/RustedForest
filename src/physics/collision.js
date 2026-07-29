import { getHeightAt } from '../world/terrain.js';

// 円(キャラ)と軸平行AABBの押し出し。城壁などXZ平面の障害物用
let castleColliders = [];

export function setCastleColliders(colliders) {
  castleColliders = colliders || [];
}

export function getGroundHeight(x, z) {
  return getHeightAt(x, z);
}

// 半径radiusの円をAABB群から押し出す。戻り値は補正後のxz
export function resolveCircleColliders(x, z, radius = 0.35) {
  let px = x;
  let pz = z;
  for (const c of castleColliders) {
    const nearestX = Math.max(c.minX, Math.min(px, c.maxX));
    const nearestZ = Math.max(c.minZ, Math.min(pz, c.maxZ));
    const dx = px - nearestX;
    const dz = pz - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    if (distSq < 1e-8) {
      // 完全にめり込んだ場合は最も近い面へ押し出す
      const left = px - c.minX + radius;
      const right = c.maxX - px + radius;
      const top = pz - c.minZ + radius;
      const bottom = c.maxZ - pz + radius;
      const m = Math.min(left, right, top, bottom);
      if (m === left) px = c.minX - radius;
      else if (m === right) px = c.maxX + radius;
      else if (m === top) pz = c.minZ - radius;
      else pz = c.maxZ + radius;
      continue;
    }
    const dist = Math.sqrt(distSq);
    const push = (radius - dist) / dist;
    px += dx * push;
    pz += dz * push;
  }
  return { x: px, z: pz };
}

/**
 * 2つの円をXZ平面で押し出す。weightA/weightB でどちらが動くか配分
 * (1,1)=半分ずつ, (0,1)=Bのみ動く, (1,0)=Aのみ動く
 */
export function separateCircles(ax, az, ar, bx, bz, br, weightA = 1, weightB = 1) {
  const dx = bx - ax;
  const dz = bz - az;
  const minDist = ar + br;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minDist * minDist) {
    return { ax, az, bx, bz, separated: false };
  }

  let nx;
  let nz;
  let dist;
  if (distSq < 1e-8) {
    nx = 1;
    nz = 0;
    dist = 0;
  } else {
    dist = Math.sqrt(distSq);
    nx = dx / dist;
    nz = dz / dist;
  }

  const overlap = minDist - dist;
  const totalW = weightA + weightB;
  const moveA = totalW > 0 ? (weightA / totalW) * overlap : 0;
  const moveB = totalW > 0 ? (weightB / totalW) * overlap : 0;

  return {
    ax: ax - nx * moveA,
    az: az - nz * moveA,
    bx: bx + nx * moveB,
    bz: bz + nz * moveB,
    separated: true,
  };
}
