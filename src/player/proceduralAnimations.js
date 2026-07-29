import * as THREE from 'three';

// Solus Knightにはローリング(前転)専用のモーションが収録されていない。
// Rig_Hipsが全身(脊椎・両脚)の実質的なルートボーンであることを確認済みなので、
// これをローカルX軸周りに360°回転させることで簡易的な前転を表現する。
// 実際の前転のように接地点が移動するわけではなく、腰の高さを中心に体が
// 剛体的に回転するだけの簡略表現だが、モーション無しよりは大きく改善する
const ROLL_CLIP_NAME = 'PlayerRoll';
const ROLL_KEYFRAME_STEPS = 8;

export function createRollClip(hipsBone, duration) {
  const baseQuat = hipsBone.quaternion.clone();
  const axis = new THREE.Vector3(1, 0, 0);

  const times = [];
  const values = [];
  for (let i = 0; i <= ROLL_KEYFRAME_STEPS; i += 1) {
    const t = (duration * i) / ROLL_KEYFRAME_STEPS;
    const angle = (Math.PI * 2 * i) / ROLL_KEYFRAME_STEPS;
    const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const q = baseQuat.clone().multiply(delta);
    times.push(t);
    values.push(q.x, q.y, q.z, q.w);
  }

  const track = new THREE.QuaternionKeyframeTrack(`${hipsBone.name}.quaternion`, times, values);
  return new THREE.AnimationClip(ROLL_CLIP_NAME, duration, [track]);
}

export { ROLL_CLIP_NAME };
