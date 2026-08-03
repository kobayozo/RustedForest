/**
 * ルートモーション（移動）をアニメから除去し、見た目の瞬間移動を防ぐ
 */

const ROOT_BONE_NEEDLES = [
  'hips',
  'pelvis',
  'bip001_03',
  'root_02',
  '_rootjoint',
  'rootnode',
  'armature',
  'mixamorighips',
];

function isRootPositionTrack(trackName) {
  const n = (trackName || '').toLowerCase();
  if (!n.includes('position')) return false;
  // Bip001-Head など子ボーンは残す。ルート相当だけ対象
  if (n.includes('bip001-') || n.includes('bip001.')) return false;
  if (n.includes('bip001_03')) return true;
  return ROOT_BONE_NEEDLES.some((needle) => n.includes(needle));
}

/** ルート位置トラックを基準値に固定（クリップ切替の瞬間移動を防ぐ） */
export function pinRootMotion(clip, refXYZ = null) {
  if (!clip?.tracks) return clip;
  for (const track of clip.tracks) {
    if (!isRootPositionTrack(track.name)) continue;
    const values = track.values;
    if (!values || values.length < 3) continue;
    const x = refXYZ ? refXYZ[0] : values[0];
    const y = refXYZ ? refXYZ[1] : values[1];
    const z = refXYZ ? refXYZ[2] : values[2];
    for (let i = 0; i < values.length; i += 3) {
      values[i] = x;
      values[i + 1] = y;
      values[i + 2] = z;
    }
  }
  return clip;
}

/** 先頭クリップからルート位置の基準を取る */
export function getRootMotionRef(clip) {
  if (!clip?.tracks) return null;
  for (const track of clip.tracks) {
    if (!isRootPositionTrack(track.name)) continue;
    const v = track.values;
    if (v && v.length >= 3) return [v[0], v[1], v[2]];
  }
  return null;
}

/**
 * 互換: ルート位置を先頭フレームにピン留め（削除より切替が安定）
 */
export function stripRootMotion(clip) {
  return pinRootMotion(clip, null);
}

function isRootQuaternionTrack(trackName) {
  const n = (trackName || '').toLowerCase();
  if (!n.includes('quaternion')) return false;
  if (n.includes('bip001-') || n.includes('bip001.')) return false;
  if (n.includes('bip001_03')) return true;
  return ROOT_BONE_NEEDLES.some((needle) => n.includes(needle));
}

/**
 * ルート回転を基準に固定する。
 * refQuat を渡すと全ルート骨に同じ値を書くため、骨が違うと上下逆になる。
 * refByBone (骨名→[x,y,z,w]) を渡すか、省略時は各トラック先頭フレームで固定する。
 */
export function pinRootRotation(clip, refQuatOrMap = null) {
  if (!clip?.tracks) return clip;
  const isMap =
    refQuatOrMap &&
    typeof refQuatOrMap === 'object' &&
    !Array.isArray(refQuatOrMap);
  for (const track of clip.tracks) {
    if (!isRootQuaternionTrack(track.name)) continue;
    const values = track.values;
    if (!values || values.length < 4) continue;
    const bone = track.name.slice(0, track.name.lastIndexOf('.'));
    let x;
    let y;
    let z;
    let w;
    if (isMap && refQuatOrMap[bone]) {
      [x, y, z, w] = refQuatOrMap[bone];
    } else if (Array.isArray(refQuatOrMap) && refQuatOrMap.length >= 4) {
      // 後方互換: 単一クォータニオン指定は非推奨(骨違いで破綻する)
      [x, y, z, w] = refQuatOrMap;
    } else {
      x = values[0];
      y = values[1];
      z = values[2];
      w = values[3];
    }
    for (let i = 0; i < values.length; i += 4) {
      values[i] = x;
      values[i + 1] = y;
      values[i + 2] = z;
      values[i + 3] = w;
    }
  }
  return clip;
}

/** idle等からルート回転の骨名→クォータニオン対応を作る */
export function getRootRotationMap(clip) {
  if (!clip?.tracks) return null;
  const map = {};
  for (const track of clip.tracks) {
    if (!isRootQuaternionTrack(track.name)) continue;
    const bone = track.name.slice(0, track.name.lastIndexOf('.'));
    const v = track.values;
    if (v && v.length >= 4) map[bone] = [v[0], v[1], v[2], v[3]];
  }
  return Object.keys(map).length ? map : null;
}

/** 先頭クリップからルート回転の基準を取る（単一骨・後方互換） */
export function getRootRotationRef(clip) {
  if (!clip?.tracks) return null;
  for (const track of clip.tracks) {
    if (!isRootQuaternionTrack(track.name)) continue;
    const v = track.values;
    if (v && v.length >= 4) return [v[0], v[1], v[2], v[3]];
  }
  return null;
}

/** 1フレームあたりの移動量を制限 */
export function clampMove(dx, dz, maxStep) {
  const len = Math.hypot(dx, dz);
  if (len <= maxStep || len < 1e-8) return { dx, dz };
  const s = maxStep / len;
  return { dx: dx * s, dz: dz * s };
}
