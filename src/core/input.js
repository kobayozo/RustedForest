// 標準ゲームパッドマッピング(Xbox/PS系のUSB/Bluetoothコントローラでブラウザが
// 認識する共通レイアウト)でのボタン番号。R2/RTはトリガーのため0.5以上の押し込みで
// 「押した」とみなす
const GAMEPAD_DEADZONE = 0.25;
const GAMEPAD_MOVE_ENTER = 0.28;
const GAMEPAD_MOVE_EXIT = 0.16;
const GAMEPAD_BUTTON_A = 0; // A: かがり火休息
const GAMEPAD_BUTTON_B = 1;
const GAMEPAD_BUTTON_Y = 3; // Y: 聖杯瓶
const GAMEPAD_BUTTON_L1 = 4; // LB / L1: 盾構え
const GAMEPAD_BUTTON_L2 = 6; // LT / L2: キック
const GAMEPAD_BUTTON_R1 = 5; // RB / R1: 軽攻撃
const GAMEPAD_BUTTON_R2 = 7;
const GAMEPAD_BUTTON_R3 = 11; // 右スティック押し込み: ロックオン
const GAMEPAD_TRIGGER_THRESHOLD = 0.5;
// 右スティック最大倒し時の仮想マウス移動量(px/秒)。ThirdPersonCameraの
// MOUSE_SENSITIVITY(0.0025)と組み合わせると約1.2rad/秒で視点が回る
const GAMEPAD_LOOK_SPEED = 480;

export class InputState {
  constructor(domElement) {
    this.domElement = domElement;
    this.keys = new Set();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.pointerLocked = false;
    this.justPressed = new Set();
    // 左スティックのヒステリシス用。デッドゾーン境界のチラつきで
    // 移動が途切れ途切れになるのを防ぐ
    this._padMoving = false;
    this._padMoveKeys = new Set();
    this._padActionKeys = new Set();
    // 接続直後のゴースト入力でロールが暴発しないよう、少し遅らせてからボタンを見る
    this._padButtonsAt = performance.now() + 800;

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
  // キーボード/マウスとコントローラを同列に扱えるようにしている。
  // 右スティックはマウス移動デルタへ加算し、既存のカメラ回転パスを共有する
  // (ポインターロック不要なので、コントローラ単体でも視点操作できる)
  pollGamepad(dt = 1 / 60) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[0];
    if (!pad || !pad.connected) return;

    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const moveMag = Math.hypot(x, y);
    if (this._padMoving) {
      if (moveMag < GAMEPAD_MOVE_EXIT) this._padMoving = false;
    } else if (moveMag >= GAMEPAD_MOVE_ENTER) {
      this._padMoving = true;
    }
    if (this._padMoving && moveMag > 1e-4) {
      const nx = x / moveMag;
      const ny = y / moveMag;
      const wanted = new Set();
      if (ny < -0.35) wanted.add('KeyW');
      if (ny > 0.35) wanted.add('KeyS');
      if (nx < -0.35) wanted.add('KeyA');
      if (nx > 0.35) wanted.add('KeyD');
      if (wanted.size === 0) {
        if (Math.abs(ny) >= Math.abs(nx)) wanted.add(ny < 0 ? 'KeyW' : 'KeyS');
        else wanted.add(nx < 0 ? 'KeyA' : 'KeyD');
      }
      for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) {
        const on = wanted.has(code);
        this._setVirtualKey(code, on);
        if (on) this._padMoveKeys.add(code);
        else this._padMoveKeys.delete(code);
      }
    } else {
      // スティック中立時はパッドが立てた移動キーだけ解放し、キーボード入力は残す
      for (const code of [...this._padMoveKeys]) {
        this.keys.delete(code);
        this._padMoveKeys.delete(code);
      }
    }

    if (performance.now() >= this._padButtonsAt) {
      this._setPadActionKey('Mouse0', !!pad.buttons[GAMEPAD_BUTTON_R1]?.pressed); // R1: 軽攻撃
      this._setPadActionKey('Space', !!pad.buttons[GAMEPAD_BUTTON_B]?.pressed); // B: 短押しロール / 押しっぱなしダッシュ
      this._setPadActionKey('KeyQ', !!pad.buttons[GAMEPAD_BUTTON_L1]?.pressed); // L1: 盾構え
      this._setPadActionKey('KeyF', !!pad.buttons[GAMEPAD_BUTTON_R3]?.pressed); // R3: ロックオン
      this._setPadActionKey('KeyC', !!pad.buttons[GAMEPAD_BUTTON_Y]?.pressed); // Y: 聖杯瓶
      this._setPadActionKey('KeyT', !!pad.buttons[GAMEPAD_BUTTON_A]?.pressed); // A: かがり火休息
      const r2 = pad.buttons[GAMEPAD_BUTTON_R2];
      const r2Pressed = r2 ? (r2.pressed || r2.value >= GAMEPAD_TRIGGER_THRESHOLD) : false;
      this._setPadActionKey('Mouse2', r2Pressed); // R2: 重攻撃
      const l2 = pad.buttons[GAMEPAD_BUTTON_L2];
      const l2Pressed = l2 ? (l2.pressed || l2.value >= GAMEPAD_TRIGGER_THRESHOLD) : false;
      this._setPadActionKey('KeyE', l2Pressed); // L2: キック
    }

    // axes[2]/[3] = 右スティック。放射状デッドゾーンで端の微動を切り、
    // 残りを0〜1へ再マップしてからマウス相当のデルタへ変換する
    let rx = pad.axes[2] ?? 0;
    let ry = pad.axes[3] ?? 0;
    const lookMag = Math.hypot(rx, ry);
    if (lookMag > GAMEPAD_DEADZONE) {
      const scale = ((lookMag - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE)) / lookMag;
      rx *= scale;
      ry *= scale;
      this.mouseDeltaX += rx * GAMEPAD_LOOK_SPEED * dt;
      this.mouseDeltaY += ry * GAMEPAD_LOOK_SPEED * dt;
    }
  }

  // パッド由来のアクションキーだけを立て/落とす。キーボードのSpace等を消さない
  _setPadActionKey(code, isDown) {
    if (isDown) {
      if (!this.keys.has(code)) this.justPressed.add(code);
      this.keys.add(code);
      this._padActionKeys.add(code);
    } else if (this._padActionKeys.has(code)) {
      this.keys.delete(code);
      this._padActionKeys.delete(code);
    }
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
