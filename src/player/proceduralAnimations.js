import * as THREE from 'three';

// Mixamo剣盾パックにローリング専用が無いため、腰ボーンを前方回転させて前転を作る。
// コントローラ側で visualModel 全体の回転も重ね、全身が転がって見えるようにする
const ROLL_CLIP_NAME = 'PlayerRoll';
const ROLL_KEYFRAME_STEPS = 16;

export function createRollClip(hipsBone, duration) {
  const baseQuat = hipsBone.quaternion.clone();
  // キャラ正面(+Z/-Z)へ前転するよう、腰のローカルX周りに360°
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
