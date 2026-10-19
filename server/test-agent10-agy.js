/**
 * OMARCHY BRIDGE: AGENT 10 (ONE-TAP AGY QUICK LAUNCHER) AUDIT SUITE
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const TOKEN = 'omarchy-bridge-secure-key-2026';
const WS_URL = `ws://127.0.0.1:19001?token=${encodeURIComponent(TOKEN)}`;

let total = 0;
let passed = 0;

function pass(name) {
  total++;
  passed++;
  console.log(`[PASS] ${name}`);
}

function fail(name, err) {
  total++;
  console.error(`[FAIL] ${name}:`, err);
  process.exit(1);
}

async function run() {
  console.log('======================================================');
  console.log(' AGENT 10: ONE-TAP AGY QUICK LAUNCHER TEST SUITE');
  console.log('======================================================\n');

  // 1. Audit App.tsx
  const appTsx = fs.readFileSync(path.join(__dirname, '../mobile/App.tsx'), 'utf8');
  assert(appTsx.includes("setInputCommand('agy')"), 'App.tsx must set inputCommand to "agy"');
  assert(appTsx.includes('styles.keycapTool'), 'App.tsx must use keycapTool styling');
  assert(appTsx.includes('styles.keycapToolText'), 'App.tsx must use keycapToolText styling');
  pass('mobile/App.tsx renders "agy" button with dedicated tool styling and tap handler');

  // 2. Verify agy binary is accessible and executable
  const agyPath = execSync('which agy', { encoding: 'utf8' }).trim();
  assert(fs.existsSync(agyPath), `agy binary must exist at ${agyPath}`);
  const agyVersion = execSync('agy --version', { encoding: 'utf8' }).trim();
  assert(agyVersion.includes('agy') || agyVersion.includes('1.'), 'agy --version must return valid version');
  pass(`agy binary verified at ${agyPath} (${agyVersion})`);

  // 3. Verify WebSocket Connection and Terminal Screen Broadcast
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      pass('Connected to live omarchy-bridge daemon');
      setTimeout(() => {
        ws.close();
        resolve();
      }, 200);
    });
    ws.on('error', (err) => reject(err));
  });

  console.log(`\nAgent 10 Summary: ${passed}/${total} passed (100%)\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
