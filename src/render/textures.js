import * as THREE from 'three';

// CC0ライセンス(表示義務なし)のテクスチャをPoly Haven(polyhaven.com)から使用。
// grass: sparse_grass / rock: gray_rocks / leather: brown_leather

const loader = new THREE.TextureLoader();

function loadTiled(path, repeatX, repeatY, { srgb = false } = {}) {
  const texture = loader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function loadGrassTextures() {
  return {
    map: loadTiled('/textures/grass_diff.jpg', 24, 24, { srgb: true }),
    normalMap: loadTiled('/textures/grass_nor.jpg', 24, 24),
    roughnessMap: loadTiled('/textures/grass_rough.jpg', 24, 24),
  };
}

export function loadRockTextures() {
  return {
    map: loadTiled('/textures/rock_diff.jpg', 2, 2, { srgb: true }),
    normalMap: loadTiled('/textures/rock_nor.jpg', 2, 2),
    roughnessMap: loadTiled('/textures/rock_rough.jpg', 2, 2),
  };
}

export function loadBarkTextures() {
  return {
    map: loadTiled('/textures/bark_diff.jpg', 1, 3, { srgb: true }),
    normalMap: loadTiled('/textures/bark_nor.jpg', 1, 3),
    roughnessMap: loadTiled('/textures/bark_rough.jpg', 1, 3),
  };
}

export function loadCastleTextures() {
  return {
    map: loadTiled('/textures/castle_diff.jpg', 1, 1, { srgb: true }),
    normalMap: loadTiled('/textures/castle_nor.jpg', 1, 1),
    roughnessMap: loadTiled('/textures/castle_rough.jpg', 1, 1),
  };
}

export function loadLeatherTextures() {
  return {
    map: loadTiled('/textures/leather_diff.jpg', 2, 2, { srgb: true }),
    normalMap: loadTiled('/textures/leather_nor.jpg', 2, 2),
    roughnessMap: loadTiled('/textures/leather_rough.jpg', 2, 2),
  };
}
