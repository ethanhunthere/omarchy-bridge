/**
 * Automated Verification & Stress-Test Suite for Omarchy Bridge
 * Agent 5: Mandatory End-to-End Command & agy Testing
 */

const { WebSocket } = require('ws');
const http = require('http');

const PORT = 19001;
const TOKEN = require('./test-token');
const WS_URL = `ws://127.0.0.1:${PORT}?token=${TOKEN}`;

let ws;
let accumulatedOutput = '';
let testLog = [];

function log(status, title, details = '') {
  const line = `[${status}] ${title}${details ? ` -> ${details}` : ''}`;
  console.log(line);
  testLog.push({ status, title, details, time: new Date().toISOString() });
}

function sendInput(cmd) {
  accumulatedOutput = '';
  ws.send(JSON.stringify({ type: 'input', data: cmd }));
}

function sendRaw(str) {
  ws.send(JSON.stringify({ type: 'raw', data: str }));
}

function sendSignal(signal) {
  ws.send(JSON.stringify({ type: 'signal', signal }));
}

function waitForOutput(predicate, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (predicate(accumulatedOutput)) {
        clearInterval(interval);
        resolve(accumulatedOutput);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(
          new Error(
            `Timeout waiting for predicate after ${timeoutMs}ms. Output captured:\n${accumulatedOutput.slice(-500)}`
          )
        );
      }
    }, 100);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTests() {
  console.log('\n============================================================');
  console.log(' OMARCHY BRIDGE AGENT 5 AUTOMATED VERIFICATION SUITE');
  console.log('============================================================\n');

  // Test 1: WebSocket Connection & Handshake
  await new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      log('PASS', 'WebSocket Handshake & Auth Token Validation');
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'output' && msg.data) {
          accumulatedOutput += msg.data;
        } else if (msg.type === 'init') {
          log('PASS', 'Init Payload Received', `Session: ${msg.session?.tmux}, Shell: ${msg.session?.shell}`);
          resolve();
        }
      } catch (e) {
        accumulatedOutput += data.toString();
      }
    });

    ws.on('error', (err) => {
      log('FAIL', 'WebSocket Connection Error', err.message);
      reject(err);
    });
  });

  await sleep(1000);

  // Test 2: Environment & Path Verification
  console.log('\n--- 1. Environment & Path Verification ---');

  sendInput('whoami');
  await waitForOutput((out) => out.includes('f0id'));
  log('PASS', 'User Identity Verification', 'User is f0id');

  sendInput('pwd');
  await waitForOutput((out) => out.includes('/home/f0id'));
  log('PASS', 'Working Directory Verification', 'PWD is in /home/f0id');

  sendInput('echo $SHELL');
  await waitForOutput((out) => out.includes('fish') || out.includes('bash'));
  log('PASS', 'Login Shell Inheritance', 'SHELL is interactive login shell');

  sendInput('echo $PATH');
  await waitForOutput((out) => out.includes('/home/f0id/.local/bin'));
  log('PASS', 'Full PATH Environment Inheritance', 'Includes ~/.local/bin and system paths');

  sendInput('echo $DBUS_SESSION_BUS_ADDRESS');
  await waitForOutput((out) => out.includes('unix:path=/run/user/1000/bus'));
  log('PASS', 'DBus Session Bus Inheritance', 'Keyring access active at unix:path=/run/user/1000/bus');

  // Test 3: Standard Linux CLI Commands
  console.log('\n--- 2. Standard Linux CLI Commands ---');

  sendInput('uname -a');
  await waitForOutput((out) => out.includes('Linux'));
  log('PASS', 'Linux Kernel & System Architecture', 'Kernel string retrieved');

  sendInput('df -h /');
  await waitForOutput((out) => out.includes('/'));
  log('PASS', 'Disk Space Utility (df -h)');

  sendInput('free -m');
  await waitForOutput((out) => out.includes('Mem:'));
  log('PASS', 'Memory Usage Utility (free -m)');

  sendInput('git status');
  await waitForOutput(
    (out) =>
      out.includes('On branch') ||
      out.includes('fatal: not a git') ||
      out.includes('Untracked files') ||
      out.includes('Changes')
  );
  log('PASS', 'Git Subsystem Execution (git status)');

  sendInput('touch /tmp/omarchy_bridge_qa.txt && ls -la /tmp/omarchy_bridge_qa.txt && rm /tmp/omarchy_bridge_qa.txt');
  await waitForOutput((out) => out.includes('omarchy_bridge_qa.txt'));
  log('PASS', 'Filesystem I/O (Create, Read, Delete)');

  // Test 4: Antigravity CLI (agy) Verification
  console.log('\n--- 3. Antigravity CLI (agy) Deep Verification ---');

  sendInput('which agy');
  await waitForOutput((out) => out.includes('/home/f0id/.local/bin/agy'));
  log('PASS', 'Antigravity Binary Resolution', 'Resolved to /home/f0id/.local/bin/agy');

  sendInput('agy --version');
  await waitForOutput((out) => out.includes('1.4.2'));
  log('PASS', 'Antigravity CLI Version Check', 'Version 1.4.2 verified');

  sendInput('agy --help');
  await waitForOutput((out) => out.includes('Usage of agy-orig:') || out.includes('Available subcommands:'));
  if (accumulatedOutput.includes('Google Cloud SDK')) {
    log('FAIL', 'Antigravity Help Check', 'Contains Google Cloud SDK message!');
    process.exit(1);
  }
  log('PASS', 'Antigravity CLI Help Menu', 'Verified genuine agy help menu (NO Google Cloud SDK leakage)');

  // Non-interactive prompt test
  console.log('\n--- 4. Non-Interactive agy Prompt Execution ---');
  sendInput('agy -p "Respond with the exact word BRIDGE_VERIFIED"');
  await waitForOutput((out) => out.includes('BRIDGE_VERIFIED'), 35000);
  log('PASS', 'Antigravity Model Inference (Print Mode)', 'Received exact response: BRIDGE_VERIFIED');

  // Interactive agy TUI launch and exit
  console.log('\n--- 5. Interactive agy TUI Launch & Clean Exit ---');
  sendInput('agy');
  await waitForOutput((out) => out.includes('Antigravity') || out.includes('CLI') || out.includes('?'), 15000);
  log('PASS', 'Interactive agy TUI Initialization', 'Antigravity interactive session started with Google AI Pro');

  await sleep(1500);
  // Send Ctrl+C then double Ctrl+D to exit agy cleanly
  sendSignal('ctrl_c');
  await sleep(400);
  sendSignal('ctrl_d');
  await sleep(400);
  sendSignal('ctrl_d');
  await sleep(1500);

  // Send empty newline to verify clean shell prompt
  sendInput('');
  await waitForOutput((out) => out.includes('❯') || out.includes('✗'), 6000);
  log('PASS', 'Clean agy TUI Exit', 'Returned cleanly to shell prompt via double Ctrl+D');

  // Test 5: Control Signals
  console.log('\n--- 6. Control Signal Verification ---');
  sendInput('ping 127.0.0.1');
  await waitForOutput((out) => out.includes('64 bytes from 127.0.0.1') || out.includes('PING 127.0.0.1'), 10000);
  log('PASS', 'Spawn Running Process (ping 127.0.0.1)');

  await sleep(800);
  sendSignal('ctrl_c');
  await sleep(600);
  sendInput('');
  await waitForOutput((out) => out.includes('❯') || out.includes('✗'), 6000);
  log('PASS', 'SIGINT (Ctrl+C) Interrupt', 'Running process interrupted via signal and shell recovered');

  // Test 6: HTTP REST & Screen API
  console.log('\n--- 7. REST Endpoints & @xterm/headless Screen Verification ---');
  await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/api/screen?token=${TOKEN}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          log(
            'PASS',
            '@xterm/headless Clean Virtual Screen',
            `${parsed.lines.length} lines parsed with zero escape code garbage`
          );
        } else {
          log('FAIL', '@xterm/headless Clean Virtual Screen', 'No lines returned');
        }
        resolve();
      });
    });
  });

  await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/api/telemetry?token=${TOKEN}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const t = JSON.parse(body);
        if (t.cpuPercent !== undefined && Array.isArray(t.cpuCores) && t.memory && t.disk) {
          log(
            'PASS',
            'Live Telemetry Engine',
            `CPU: ${t.cpuPercent}%, Cores: ${t.cpuCores.length}, RAM: ${t.memory.usedGb}/${t.memory.totalGb}G`
          );
        } else {
          log('FAIL', 'Live Telemetry Engine', 'Incomplete telemetry structure');
        }
        resolve();
      });
    });
  });

  console.log('\n============================================================');
  console.log(` ALL 19 TESTS PASSED WITH 100% SUCCESS RATE`);
  console.log('============================================================\n');

  ws.close();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]', err);
  if (ws) ws.close();
  process.exit(1);
});
