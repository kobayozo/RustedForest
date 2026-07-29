import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
await page.mouse.move(450, 350);

await page.evaluate(() => {
  window.__debug.thirdPersonCamera.update = () => {};
  const controller = window.__debug.controller;
  controller.baseAttackDuration = 20;
});

await page.mouse.click(450, 350, { button: 'left' });
await new Promise((r) => setTimeout(r, 700)); // 振り抜き(命中)付近のポーズで止める

// ミキサーの更新を止めて、以降アニメーションが進まないようにポーズを固定する
await page.evaluate(() => {
  const controller = window.__debug.controller;
  controller.animator.update = () => {};
});

async function shot(name, rot) {
  await page.evaluate(({ rot }) => {
    const rig = window.__debug.controller.animator.swordRig;
    rig.sword.rotation.set(rot.x, rot.y, rot.z);
    const root = window.__debug.characterRoot;
    let handR = null;
    root.traverse((o) => { if (!handR && o.isBone && o.name === 'Rig_hand_R') handR = o; });
    const handPos = handR.getWorldPosition(new (handR.position.constructor)());
    const camera = window.__debug.camera;
    camera.position.set(handPos.x + 0.5, handPos.y + 0.3, handPos.z + 0.5);
    camera.lookAt(handPos.x, handPos.y - 0.05, handPos.z);
  }, { rot });
  await page.screenshot({ path: `tools/out/${name}.png` });
  console.log('saved', name, rot);
}

const P = Math.PI;
await shot('hr4late_current', { x: 0, y: 0, z: 0 });
await shot('hr4late_x90', { x: P / 2, y: 0, z: 0 });
await shot('hr4late_xneg90', { x: -P / 2, y: 0, z: 0 });
await shot('hr4late_y90', { x: 0, y: P / 2, z: 0 });
await shot('hr4late_yneg90', { x: 0, y: -P / 2, z: 0 });
await shot('hr4late_z90', { x: 0, y: 0, z: P / 2 });
await shot('hr4late_zneg90', { x: 0, y: 0, z: -P / 2 });

await browser.close();
