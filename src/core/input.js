// 標準ゲームパッドマッピング(Xbox/PS系のUSB/Bluetoothコントローラでブラウザが
// 認識する共通レイアウト)でのボタン番号。R2/RTはトリガーのため0.5以上の押し込みで
// 「押した」とみなす
const GAMEPAD_DEADZONE = 0.25;
const GAMEPAD_BUTTON_A = 0;
const GAMEPAD_BUTTON_B = 1;
const GAMEPAD_BUTTON_R2 = 7;
const GAMEPAD_TRIGGER_THRESHOLD = 0.5;

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

  // Gamepad APIはボタン押下イベントを持たないため、毎フレーム呼び出してポーリングする。
  // 左スティックはWASD相当の仮想キーへ、ボタンはSpace/Mouse0/Mouse2という既存の
  // コード名へそのまま合成することで、PlayerController側の入力判定を一切変えずに
  // キーボード/マウスとコントローラを同列に扱えるようにしている
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[0];
    if (!pad || !pad.connected) return;

    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    this._setVirtualKey('KeyW', y < -GAMEPAD_DEADZONE);
    this._setVirtualKey('KeyS', y > GAMEPAD_DEADZONE);
    this._setVirtualKey('KeyA', x < -GAMEPAD_DEADZONE);
    this._setVirtualKey('KeyD', x > GAMEPAD_DEADZONE);

    this._setVirtualKey('Mouse0', !!pad.buttons[GAMEPAD_BUTTON_A]?.pressed); // Aボタン: 軽攻撃
    this._setVirtualKey('Space', !!pad.buttons[GAMEPAD_BUTTON_B]?.pressed); // Bボタン: ローリング
    const r2 = pad.buttons[GAMEPAD_BUTTON_R2];
    const r2Pressed = r2 ? (r2.pressed || r2.value >= GAMEPAD_TRIGGER_THRESHOLD) : false;
    this._setVirtualKey('Mouse2', r2Pressed); // R2: 重攻撃
  }

  _setVirtualKey(code, isDown) {
    if (isDown) {
      if (!this.keys.has(code)) this.justPressed.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
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
