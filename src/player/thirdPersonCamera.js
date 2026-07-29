import * as THREE from 'three';
import { damp, dampAngle, clamp } from '../utils/math.js';

const DISTANCE = 3.6;
const LOCK_DISTANCE = 4.2;
const SHOULDER_OFFSET = 0.5;
const HEIGHT_OFFSET = 1.05;
const PIVOT_HEIGHT = 1.4;
const MOUSE_SENSITIVITY = 0.0025;
const MIN_PITCH = -0.6;
const MAX_PITCH = 0.4;
const FOLLOW_LAMBDA = 14;
const LOCK_YAW_LAMBDA = 12;
const LOCK_PITCH_LAMBDA = 9;
const MIN_CAMERA_DISTANCE = 0.5;
const COLLISION_MARGIN = 0.3;

// スプリングアーム方式の肩越しカメラ。プレイヤー頭上少し後ろのピボットを
// 注視点とし、地形・障害物へのレイキャストでめり込みを回避する。
// ロックオン中はターゲット方向へヨー/ピッチを寄せる
export class ThirdPersonCamera {
  constructor(camera, collidables = []) {
    this.camera = camera;
    this.collidables = collidables;
    this.yaw = 0;
    this.pitch = 0.25;
    this._currentPos = new THREE.Vector3();
    this._initialized = false;
    this._raycaster = new THREE.Raycaster();
    this.lockFocus = null; // { x, y, z } ワールド座標
  }

  setLockFocus(positionOrNull) {
    this.lockFocus = positionOrNull;
  }

  handleMouseDelta(dx, dy) {
    // ロック中は視点の自由回転を弱め、微調整だけ許可する
    const sens = this.lockFocus ? MOUSE_SENSITIVITY * 0.35 : MOUSE_SENSITIVITY;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch + dy * sens, MIN_PITCH, MAX_PITCH);
  }

  update(dt, targetPosition) {
    if (this.lockFocus) {
      const dx = this.lockFocus.x - targetPosition.x;
      const dy = this.lockFocus.y - (targetPosition.y + PIVOT_HEIGHT);
      const dz = this.lockFocus.z - targetPosition.z;
      const desiredYaw = Math.atan2(-dx, -dz);
      this.yaw = dampAngle(this.yaw, desiredYaw, LOCK_YAW_LAMBDA, dt);
      const horiz = Math.hypot(dx, dz) || 0.01;
      const desiredPitch = clamp(Math.atan2(dy, horiz) * 0.55 + 0.08, MIN_PITCH, MAX_PITCH);
      this.pitch = damp(this.pitch, desiredPitch, LOCK_PITCH_LAMBDA, dt);
    }

    const pivot = new THREE.Vector3(
      targetPosition.x,
      targetPosition.y + PIVOT_HEIGHT,
      targetPosition.z
    );

    const distance = this.lockFocus ? LOCK_DISTANCE : DISTANCE;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const idealOffset = forward
      .multiplyScalar(-distance * Math.cos(this.pitch))
      .add(right.multiplyScalar(SHOULDER_OFFSET))
      .add(new THREE.Vector3(0, HEIGHT_OFFSET + distance * Math.sin(this.pitch), 0));

    let idealPos = pivot.clone().add(idealOffset);

    const toIdeal = idealPos.clone().sub(pivot);
    const dist = toIdeal.length();
    if (dist > 0.01 && this.collidables.length > 0) {
      this._raycaster.set(pivot, toIdeal.clone().normalize());
      this._raycaster.far = dist;
      const hits = this._raycaster.intersectObjects(this.collidables, false);
      if (hits.length > 0) {
        const safeDist = Math.max(hits[0].distance - COLLISION_MARGIN, MIN_CAMERA_DISTANCE);
        idealPos = pivot.clone().add(toIdeal.normalize().multiplyScalar(safeDist));
      }
    }

    if (!this._initialized) {
      this._currentPos.copy(idealPos);
      this._initialized = true;
    } else {
      this._currentPos.x = damp(this._currentPos.x, idealPos.x, FOLLOW_LAMBDA, dt);
      this._currentPos.y = damp(this._currentPos.y, idealPos.y, FOLLOW_LAMBDA, dt);
      this._currentPos.z = damp(this._currentPos.z, idealPos.z, FOLLOW_LAMBDA, dt);
    }

    this.camera.position.copy(this._currentPos);
    if (this.lockFocus) {
      // プレイヤーと敵の中間やや敵寄りを見る
      const look = new THREE.Vector3(
        pivot.x * 0.35 + this.lockFocus.x * 0.65,
        pivot.y * 0.4 + this.lockFocus.y * 0.6,
        pivot.z * 0.35 + this.lockFocus.z * 0.65
      );
      this.camera.lookAt(look);
    } else {
      this.camera.lookAt(pivot);
    }
  }
}
