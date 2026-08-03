import * as THREE from 'three';
import { fbm2D } from '../utils/noise.js';
import { loadGrassTextures } from '../render/textures.js';

const SIZE = 160;
const SEGMENTS = 120;
const HEIGHT_SCALE = 3;
const NOISE_SCALE = 0.06;
// 原点(0,0)がノイズ格子の交点(特異点)に一致し不自然な窪地になるのを防ぐオフセット
const NOISE_OFFSET_X = 91.7;
const NOISE_OFFSET_Z = 43.3;

// 色のパッチ(草地/土)用の別ノイズ場。地形の起伏ノイズとは周波数・オフセットを変え、
// 高低差と無相関のまだら模様を作る
const PATCH_NOISE_SCALE = 0.16;
const PATCH_OFFSET_X = 512.3;
const PATCH_OFFSET_Z = 271.9;

// 城・池など「地形を平らにならしたい」場所の定義。座標はcastle.js/pond.js側の
// 配置ロジックと共有する単一の情報源として、ここからimportして使う
export const CASTLE_ANCHOR = { x: 28, z: -28, radius: 14, height: 1.4 };
export const POND_ANCHOR = { x: -22, z: 18, radius: 7.5, height: -1.6 };
/** ドラゴンが城から出て戦う野外アリーナ */
export const DRAGON_FIELD_ARENA = { x: 28, z: 8, radius: 12 };
const FLATTEN_ZONES = [CASTLE_ANCHOR, POND_ANCHOR];

function applyFlattening(x, z, rawHeight) {
  let h = rawHeight;
  for (const zone of FLATTEN_ZONES) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d < zone.radius) {
      // 中心に近いほど完全にターゲット高さへ、縁に向かって元の地形へなだらかに戻す
      const t = 1 - THREE.MathUtils.smoothstep(d, zone.radius * 0.55, zone.radius);
      h = THREE.MathUtils.lerp(h, zone.height, t);
    }
  }
  return h;
}

// 地形の高さ関数。描画(createTerrain)と当たり判定(physics/collision.js)の
// 両方がこの関数を参照することで、見た目と論理上の地形を一致させる
export function getHeightAt(x, z) {
  const nx = (x + NOISE_OFFSET_X) * NOISE_SCALE;
  const nz = (z + NOISE_OFFSET_Z) * NOISE_SCALE;
  const raw = fbm2D(nx, nz, 4) * HEIGHT_SCALE;
  return applyFlattening(x, z, raw);
}

// 実テクスチャに掛け合わせるための「ほぼ白」の色味ティント。
// 濃い単色にすると実テクスチャの質感を潰してしまうため、変化幅は控えめにする
const TINT_LOW = new THREE.Color(0.92, 1.0, 0.9);
const TINT_HIGH = new THREE.Color(1.05, 1.0, 0.85);
const TINT_DIRT = new THREE.Color(0.85, 0.72, 0.55);

function heightColor(h, x, z) {
  const t = THREE.MathUtils.clamp((h + HEIGHT_SCALE) / (HEIGHT_SCALE * 2), 0, 1);
  const base = TINT_LOW.clone().lerp(TINT_HIGH, t);

  const patch = fbm2D(
    x * PATCH_NOISE_SCALE + PATCH_OFFSET_X,
    z * PATCH_NOISE_SCALE + PATCH_OFFSET_Z,
    3
  );
  // しきい値の幅を狭めて輪郭のある土のパッチにしつつ、閾値を上げて
  // 「たまに現れる土の露出」程度の面積比に抑える(草の緑を基調にする)
  const dirtAmount = THREE.MathUtils.smoothstep(patch, 0.22, 0.34) * 0.7;
  return base.lerp(TINT_DIRT, dirtAmount);
}

export function createTerrain() {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = getHeightAt(x, z);
    position.setY(i, y);

    const color = heightColor(y, x, z);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.computeVertexNormals();
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const { map, normalMap, roughnessMap } = loadGrassTextures();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map,
    normalMap,
    roughnessMap,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export const TERRAIN_SIZE = SIZE;
