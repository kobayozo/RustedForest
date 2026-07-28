export class InputState {
  constructor(domElement) {
    this.domElement = domElement;
    this.keys = new Set();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.pointerLocked = false;
    this.justPressed = new Set();

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    domElement.addEventListener('click', () => {
      if (!this.pointerLocked) domElement.requestPointerLock();
    });

    // 右クリック(重攻撃)でブラウザの標準コンテキストメニューが出ないようにする
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    // マウスボタンもキーボードと同じMouse0/Mouse2のような合成コードとして扱う
    domElement.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (!this.keys.has(code)) this.justPressed.add(code);
      this.keys.add(code);
    });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === domElement;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    });
  }

  isDown(code) {
    return this.keys.has(code);
  }

  // そのフレームで新たに押された場合のみtrueを返し、消費する(長押しでの連発を防ぐ)
  consumeJustPressed(code) {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  consumeMouseDelta() {
    const dx = this.mouseDeltaX;
    const dy = this.mouseDeltaY;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return { dx, dy };
  }
}
