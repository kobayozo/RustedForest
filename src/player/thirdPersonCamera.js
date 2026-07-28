import * as THREE from 'three';
import { damp, clamp } from '../utils/math.js';

const DISTANCE = 3.6;
const SHOULDER_OFFSET = 0.5;
const HEIGHT_OFFSET = 1.05;
const PIVOT_HEIGHT = 1.4;
const MOUSE_SENSITIVITY = 0.0025;
const MIN_PITCH = -0.6;
const MAX_PITCH = 0.4;
const FOLLOW_LAMBDA = 14;
const MIN_CAMERA_DISTANCE = 0.5;
const COLLISION_MARGIN = 0.3;

// スプリングアーム方式の肩越しカメラ。プレイヤー頭上少し後ろのピボットを
// 注視点とし、地形・障害物へのレイキャストでめり込みを回避する
export class ThirdPersonCamera {
  constructor(camera, collidables = []) {
    this.camera = camera;
    this.collidables = collidables;
    this.yaw = 0;
    this.pitch = 0.25;
    this._currentPos = new THREE.Vector3();
    this._initialized = false;
    this._raycaster = new THREE.Raycaster();
  }

  handleMouseDelta(dx, dy) {
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch = clamp(this.pitch + dy * MOUSE_SENSITIVITY, MIN_PITCH, MAX_PITCH);
  }

  update(dt, targetPosition) {
    const pivot = new THREE.Vector3(
      targetPosition.x,
      targetPosition.y + PIVOT_HEIGHT,
      targetPosition.z
    );

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const idealOffset = forward
      .multiplyScalar(-DISTANCE * Math.cos(this.pitch))
      .add(right.multiplyScalar(SHOULDER_OFFSET))
      .add(new THREE.Vector3(0, HEIGHT_OFFSET + DISTANCE * Math.sin(this.pitch), 0));

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
    this.camera.lookAt(pivot);
  }
}
