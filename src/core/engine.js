import * as THREE from 'three';

export class Engine {
  constructor({ update, render }) {
    this.clock = new THREE.Clock();
    this.update = update;
    this.render = render;
    this._running = false;
    this._tick = this._tick.bind(this);
  }

  start() {
    this._running = true;
    this.clock.start();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
  }

  _tick() {
    if (!this._running) return;
    // 一時的なタブ非アクティブ等での大きなdt飛びを防ぐ
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.update(dt);
    this.render();
    requestAnimationFrame(this._tick);
  }
}
