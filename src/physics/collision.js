import { getHeightAt } from '../world/terrain.js';

// 現段階では地形サンプリングのみ。城壁・木との押し出し判定はM6で追加する
export function getGroundHeight(x, z) {
  return getHeightAt(x, z);
}
