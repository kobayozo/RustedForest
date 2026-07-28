import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEY_MAP = {
  w: 'KeyW',
  a: 'KeyA',
  s: 'KeyS',
  d: 'KeyD',
  shift: 'ShiftLeft',
  space: 'Space',
};

function parseArgs(argv) {
  const args = { url: 'http://127.0.0.1:5173', out: null, wait: 300, keys: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') args.url = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--wait') args.wait = Number(argv[++i]);
    else if (arg === '--keys') args.keys = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = args.out || `capture-${Date.now()}.png`;
  const outPath = path.isAbsolute(outFile) ? outFile : path.join(outDir, outFile);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));

  await page.goto(args.url);
  await page.waitForFunction('window.__ready === true', { timeout: 15000 });

  if (args.keys) {
    const keys = args.keys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => KEY_MAP[k.toLowerCase()] || k);

    for (const code of keys) await page.keyboard.down(code);
    await page.waitForTimeout(args.wait);
    for (const code of keys) await page.keyboard.up(code);
  } else {
    await page.waitForTimeout(args.wait);
  }

  const canvas = page.locator('canvas#app');
  await canvas.screenshot({ path: outPath });

  const debugState = await page.evaluate(() => window.__debugState || null);
  const statePath = outPath.replace(/\.png$/, '.json');
  fs.writeFileSync(statePath, JSON.stringify(debugState, null, 2));

  console.log(`Saved screenshot: ${outPath}`);
  console.log(`Saved debug state: ${statePath}`);
  console.log(debugState);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
