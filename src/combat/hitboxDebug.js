import * as THREE from 'three';

const COLOR_PLAYER = 0x22d3ee; // cyan
const COLOR_ENEMY = 0xff3355; // red
const COLOR_HURT = 0xfbbf24; // amber (受け側)

/**
 * 攻撃当たり判定のデバッグ可視化。
 * 味方攻撃=シアン / 敵攻撃=赤 / 受け側hurtbox=琥珀
 */
export class HitboxDebug {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'hitboxDebug';
    scene.add(this.group);
    // 既定では無効。有効時は毎フレーム全プレイヤー/敵のhurtbox球を含め描画するため、
    // 通常プレイでは無駄な描画コストになる上に半透明球が常時見えてしまう。
    // デバッグ時のみ window.__debug.setHitboxDebug(true) で有効化する
    this.enabled = false;
    this._spheres = [];
    this._capsules = [];
    this._cones = [];
    this._sphereUsed = 0;
    this._capsuleUsed = 0;
    this._coneUsed = 0;
    this._tmp = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  begin() {
    this._sphereUsed = 0;
    this._capsuleUsed = 0;
    this._coneUsed = 0;
  }

  end() {
    for (let i = this._sphereUsed; i < this._spheres.length; i++) {
      this._spheres[i].visible = false;
    }
    for (let i = this._capsuleUsed; i < this._capsules.length; i++) {
      this._capsules[i].visible = false;
    }
    for (let i = this._coneUsed; i < this._cones.length; i++) {
      this._cones[i].visible = false;
    }
  }

  sphere(pos, radius, { team = 'enemy', active = true, hurt = false } = {}) {
    if (!this.enabled) return;
    const mesh = this._allocSphere();
    const color = hurt ? COLOR_HURT : team === 'player' ? COLOR_PLAYER : COLOR_ENEMY;
    mesh.material.color.setHex(color);
    mesh.material.opacity = active ? (hurt ? 0.22 : 0.45) : 0.18;
    mesh.position.copy(pos);
    mesh.scale.setScalar(Math.max(0.05, radius));
    mesh.visible = true;
  }

  /** 線分 a→b を半径 radius のカプセルとして描画 */
  capsule(a, b, radius, { team = 'enemy', active = true } = {}) {
    if (!this.enabled) return;
    const mesh = this._allocCapsule();
    const color = team === 'player' ? COLOR_PLAYER : COLOR_ENEMY;
    mesh.material.color.setHex(color);
    mesh.material.opacity = active ? 0.4 : 0.16;

    this._tmp.subVectors(b, a);
    const len = this._tmp.length();
    if (len < 1e-4) {
      // 退化したら球だけ
      this.sphere(a, radius, { team, active });
      mesh.visible = false;
      return;
    }
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, len * 0.5, radius);
    mesh.quaternion.setFromUnitVectors(this._up, this._tmp.normalize());
    mesh.visible = true;

    // 端点の球
    this.sphere(a, radius, { team, active });
    this.sphere(b, radius, { team, active });
  }

  /** 前方円錐（ブレス等）。origin から dir 方向へ length、半角 halfAngle(rad) */
  cone(origin, dir, length, halfAngle, { team = 'enemy', active = true } = {}) {
    if (!this.enabled) return;
    const mesh = this._allocCone();
    const color = team === 'player' ? COLOR_PLAYER : COLOR_ENEMY;
    mesh.material.color.setHex(color);
    mesh.material.opacity = active ? 0.28 : 0.12;

    const d = dir.clone();
    if (d.lengthSq() < 1e-8) d.set(0, 0, -1);
    else d.normalize();
    const tipR = Math.tan(halfAngle) * length;
    // ConeGeometry: 先端=+Y、底面=-Y。口元を先端にするため +Y を -dir に合わせる
    mesh.scale.set(tipR, length, tipR);
    mesh.position.copy(origin).addScaledVector(d, length * 0.5);
    mesh.quaternion.setFromUnitVectors(this._up, this._tmp.copy(d).negate());
    mesh.visible = true;
  }

  _makeMat(color) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  _allocSphere() {
    if (this._sphereUsed < this._spheres.length) {
      return this._spheres[this._sphereUsed++];
    }
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      this._makeMat(COLOR_ENEMY),
    );
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this._spheres.push(mesh);
    this._sphereUsed++;
    return mesh;
  }

  _allocCapsule() {
    if (this._capsuleUsed < this._capsules.length) {
      return this._capsules[this._capsuleUsed++];
    }
    // Y軸方向の円柱。端点球は capsule() 側で別途出す
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 2, 12, 1, true),
      this._makeMat(COLOR_ENEMY),
    );
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this._capsules.push(mesh);
    this._capsuleUsed++;
    return mesh;
  }

  _allocCone() {
    if (this._coneUsed < this._cones.length) {
      return this._cones[this._coneUsed++];
    }
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 16, 1, true),
      this._makeMat(COLOR_ENEMY),
    );
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this._cones.push(mesh);
    this._coneUsed++;
    return mesh;
  }
}

export const HITBOX_COLORS = {
  player: COLOR_PLAYER,
  enemy: COLOR_ENEMY,
  hurt: COLOR_HURT,
};
