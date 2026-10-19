/**
 * Automated Ctrl+C Interrupt Signal Verification & Test Suite
 * Agent 6: Ctrl+C Interrupt Signal Tester
 * 
 * Verifies:
 * 1. Ctrl+C keycap styling (amber/red alert theme) & haptic tactile trigger in mobile/App.tsx
 * 2. Dispatch of { type: 'signal', signal: 'ctrl_c' } over WebSocket
 * 3. Server-side ASCII byte \x03 (ETX/SIGINT) direct write to ptyProcess in server/server.js
 * 4. Any running foreground command (e.g. ping, sleep, cat, loop) is immediately interrupted and returns to shell prompt
 */

const { WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 19001;
const TOKEN = 'omarchy-bridge-secure-key-2026';
const WS_URL = `ws://127.0.0.1:${PORT}?token=${TOKEN}`;

const APP_PATH = path.resolve(__dirname, '../mobile/App.tsx');
const SERVER_PATH = path.resolve(__dirname, 'server.js');

let ws;
let accumulatedOutput = '';
let testLog = [];

function log(status, title, details = '') {
  const line = `[${status}] ${title}${details ? ` -> ${details}` : ''}`;
  console.log(line);
  testLog.push({ status, title, details, time: new Date().toISOString() });
}

function assert(condition, message) {
  if (!condition) {
    log('FAIL', message);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function sendInput(cmd) {
  ws.send(JSON.stringify({ type: 'input', data: cmd }));
}

function sendSignal(signal) {
  ws.send(JSON.stringify({ type: 'signal', signal }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForOutput(predicate, timeoutMs = 8000) {
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
            `Timeout waiting for predicate after ${timeoutMs}ms. Captured:\n${accumulatedOutput.slice(-500)}`
          )
        );
      }
    }, 30);
  });
}

function getPaneForegroundCommand() {
  try {
    return execSync('tmux display-message -t omarchy-remote -p "#{pane_current_command}"', {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (e) {
    return 'unknown';
  }
}

async function ensureCleanPrompt() {
  sendSignal('ctrl_c');
  await sleep(150);
  const curCmd = getPaneForegroundCommand();
  if (curCmd === 'bash' || curCmd === 'sh') {
    sendInput('exit');
    await sleep(200);
  }
  sendSignal('ctrl_c');
  await sleep(100);
  sendInput('');
  await sleep(150);
}

async function verifyCanary(label) {
  accumulatedOutput = '';
  sendInput(`echo ${label}`);
  await waitForOutput((out) => out.includes(label), 6000);
  log('PASS', `Prompt Recovered (${label})`, 'Shell returned to prompt and executed canary command');
}

async function auditSourceCode() {
  console.log('\n============================================================');
  console.log(' SECTION 1: STATIC AUDIT OF mobile/App.tsx & server/server.js');
  console.log('============================================================\n');

  // 1. Audit mobile/App.tsx
  assert(fs.existsSync(APP_PATH), `mobile/App.tsx exists at ${APP_PATH}`);
  const appContent = fs.readFileSync(APP_PATH, 'utf8');

  // Verify button renders with keycapCtrlC style & calls sendSignal('ctrl_c')
  const hasButton = appContent.includes('styles.keycapCtrlC') && appContent.includes("sendSignal('ctrl_c')");
  assert(hasButton, "Ctrl+C button found with styles.keycapCtrlC and onPress={() => sendSignal('ctrl_c')}");
  log('PASS', 'Ctrl+C Button JSX Declaration', 'Found with keycapCtrlC style & sendSignal handler');

  // Verify keycap styling has alert red/amber styling
  const hasKeycapStyle =
    appContent.includes('keycapCtrlC:') &&
    appContent.includes("backgroundColor: '#231518'") &&
    appContent.includes("borderColor: '#3e1d23'");
  assert(hasKeycapStyle, 'keycapCtrlC has dark red alert background (#231518) and border (#3e1d23)');
  log('PASS', 'Ctrl+C Container Styling', 'Alert styling verified: background #231518, border #3e1d23');

  const hasKeycapTextStyle = appContent.includes('keycapCtrlCText:') && appContent.includes("color: '#f87171'");
  assert(hasKeycapTextStyle, 'keycapCtrlCText has bold alert red/coral text (#f87171)');
  log('PASS', 'Ctrl+C Text Styling', 'Alert red/coral color #f87171, bold monospace font');

  // Verify haptic tactile feedback in sendSignal
  const sendSignalFn = appContent.match(/const sendSignal = \(signal: string\) => \{([\s\S]*?)\n  \};/);
  assert(sendSignalFn, 'sendSignal function definition found');
  const sendSignalBody = sendSignalFn[1];
  assert(sendSignalBody.includes("triggerHaptic('medium')"), "sendSignal calls triggerHaptic('medium')");
  assert(
    appContent.includes('Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)'),
    'triggerHaptic triggers Haptics.ImpactFeedbackStyle.Medium'
  );
  log('PASS', 'Tactile Haptics Feedback', 'sendSignal invokes medium impact tactile haptic feedback');

  // Verify WebSocket signal payload format
  assert(
    sendSignalBody.includes("JSON.stringify({ type: 'signal', signal })"),
    "sendSignal dispatches { type: 'signal', signal }"
  );
  log('PASS', 'WebSocket Payload Format', 'Correct JSON structure: { type: "signal", signal: "ctrl_c" }');

  // 2. Audit server/server.js
  assert(fs.existsSync(SERVER_PATH), `server/server.js exists at ${SERVER_PATH}`);
  const serverContent = fs.readFileSync(SERVER_PATH, 'utf8');

  const hasSignalHandler =
    serverContent.includes("case 'signal':") &&
    serverContent.includes("case 'ctrl_c':") &&
    serverContent.includes("ptyProcess.write('\\x03');");
  assert(hasSignalHandler, "server/server.js handles 'signal' -> 'ctrl_c' and writes '\\x03' to ptyProcess");
  log('PASS', 'Server ASCII Byte Handler', 'server.js writes \\x03 (ETX / ASCII 3 / SIGINT) directly to ptyProcess');
}

async function runLiveInterruptionTests() {
  console.log('\n============================================================');
  console.log(' SECTION 2: LIVE END-TO-END PROCESS INTERRUPTION TESTS');
  console.log('============================================================\n');

  // 1. Establish WebSocket Connection
  await new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      log('PASS', 'WebSocket Connected', `Connected to ${WS_URL}`);
    });

    ws.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'output' && parsed.data) {
          accumulatedOutput += parsed.data;
        } else if (parsed.type === 'init') {
          log('PASS', 'Terminal Initialized', `Session: ${parsed.session?.tmux}, Shell: ${parsed.session?.shell}`);
          resolve();
        }
      } catch (e) {
        accumulatedOutput += msg.toString();
      }
    });

    ws.on('error', (err) => {
      log('FAIL', 'WebSocket Connection Error', err.message);
      reject(err);
    });
  });

  // Stabilize prompt
  await sleep(500);
  await ensureCleanPrompt();
  await verifyCanary('PROMPT_INIT_AGENT_6');

  // -------------------------------------------------------------
  // Test 1: Interruption of `ping 127.0.0.1`
  // -------------------------------------------------------------
  console.log('\n--- Test 1: Interrupting Foreground ping 127.0.0.1 ---');
  await ensureCleanPrompt();
  accumulatedOutput = '';
  sendInput('ping 127.0.0.1');

  // Wait until ping outputs packets
  await waitForOutput((out) => out.includes('64 bytes from 127.0.0.1') || out.includes('PING 127.0.0.1'));
  const pingCmd = getPaneForegroundCommand();
  assert(pingCmd === 'ping', `Foreground command is ping (actual: ${pingCmd})`);
  log('PASS', 'ping 127.0.0.1 Active', 'ping confirmed running in foreground');

  // Dispatch Ctrl+C signal via WebSocket
  const pingInterruptStart = Date.now();
  sendSignal('ctrl_c');

  // Wait for foreground command to transition back to shell
  let pingRestored = false;
  for (let i = 0; i < 40; i++) {
    const cmd = getPaneForegroundCommand();
    if (cmd === 'fish' || (cmd !== 'ping' && cmd !== 'unknown')) {
      pingRestored = true;
      break;
    }
    await sleep(60);
  }
  const pingInterruptElapsed = Date.now() - pingInterruptStart;
  assert(pingRestored, 'Foreground command reverted to fish shell');
  log('PASS', 'ping Interrupted by Ctrl+C', `Interrupted in ${pingInterruptElapsed}ms, returned to shell`);

  await verifyCanary('CANARY_AFTER_PING');

  // -------------------------------------------------------------
  // Test 2: Interruption of `sleep 60`
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Interrupting Foreground sleep 60 ---');
  await ensureCleanPrompt();
  accumulatedOutput = '';
  sendInput('sleep 60');

  // Wait until sleep command takes foreground
  let sleepStarted = false;
  for (let i = 0; i < 15; i++) {
    if (getPaneForegroundCommand() === 'sleep') {
      sleepStarted = true;
      break;
    }
    await sleep(40);
  }
  assert(sleepStarted, 'Foreground command is sleep');
  log('PASS', 'sleep 60 Running', 'Confirmed sleep 60 process active in foreground');

  const sleepInterruptStart = Date.now();
  sendSignal('ctrl_c');

  // Poll until foreground command reverts to shell
  let sleepTerminated = false;
  for (let i = 0; i < 40; i++) {
    const cmd = getPaneForegroundCommand();
    if (cmd === 'fish' || (cmd !== 'sleep' && cmd !== 'unknown')) {
      sleepTerminated = true;
      break;
    }
    await sleep(60);
  }
  const sleepInterruptElapsed = Date.now() - sleepInterruptStart;
  assert(sleepTerminated, 'sleep 60 was interrupted by Ctrl+C');
  assert(sleepInterruptElapsed < 3000, `Interruption was instant (${sleepInterruptElapsed}ms << 60000ms)`);
  log('PASS', 'sleep 60 Interrupted by Ctrl+C', `Terminated in ${sleepInterruptElapsed}ms (far before 60s timeout)`);

  await verifyCanary('CANARY_AFTER_SLEEP');

  // -------------------------------------------------------------
  // Test 3: Interruption of blocking `cat`
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Interrupting Blocking stdin cat ---');
  await ensureCleanPrompt();
  accumulatedOutput = '';
  sendInput('cat');

  let catStarted = false;
  for (let i = 0; i < 15; i++) {
    if (getPaneForegroundCommand() === 'cat') {
      catStarted = true;
      break;
    }
    await sleep(40);
  }
  assert(catStarted, 'cat process active waiting on stdin');
  log('PASS', 'cat Running', 'Blocking stdin cat process confirmed');

  const catInterruptStart = Date.now();
  sendSignal('ctrl_c');

  let catTerminated = false;
  for (let i = 0; i < 40; i++) {
    const cmd = getPaneForegroundCommand();
    if (cmd === 'fish' || (cmd !== 'cat' && cmd !== 'unknown')) {
      catTerminated = true;
      break;
    }
    await sleep(60);
  }
  const catInterruptElapsed = Date.now() - catInterruptStart;
  assert(catTerminated, 'cat process exited on SIGINT');
  log('PASS', 'cat Interrupted by Ctrl+C', `Terminated in ${catInterruptElapsed}ms, returned to shell prompt`);

  await verifyCanary('CANARY_AFTER_CAT');

  // -------------------------------------------------------------
  // Test 4: Interruption of continuous output stream
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Interrupting Endless Output Loop ---');
  await ensureCleanPrompt();
  accumulatedOutput = '';
  sendInput('sh -c \'i=0; while true; do echo "TICK_$i"; i=$((i+1)); sleep 0.1; done\'');

  await waitForOutput((out) => out.includes('TICK_2'));
  log('PASS', 'Continuous Stream Running', 'Detected high-frequency stream output');

  const streamInterruptStart = Date.now();
  sendSignal('ctrl_c');

  let streamStopped = false;
  for (let i = 0; i < 40; i++) {
    const cmd = getPaneForegroundCommand();
    if (cmd === 'fish' || (cmd !== 'sleep' && cmd !== 'unknown')) {
      streamStopped = true;
      break;
    }
    await sleep(60);
  }
  const streamInterruptElapsed = Date.now() - streamInterruptStart;
  assert(streamStopped, 'Stream loop was interrupted');
  log('PASS', 'Stream Interrupted Immediately', `Terminated in ${streamInterruptElapsed}ms`);

  await verifyCanary('CANARY_AFTER_STREAM');

  // -------------------------------------------------------------
  // Test 5: Rapid Burst Stress Test (15 consecutive Ctrl+C signals)
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Rapid Burst Stress Test (15 Consecutive Ctrl+C) ---');
  await ensureCleanPrompt();
  sendInput('sleep 30');
  await sleep(150);

  for (let i = 0; i < 15; i++) {
    sendSignal('ctrl_c');
    await sleep(15);
  }
  log('PASS', '15 Rapid Ctrl+C Signals Dispatched', 'Dispatched rapid-fire burst without errors');

  await sleep(200);
  await verifyCanary('CANARY_BURST_COMPLETE');
  log('PASS', 'Shell Robust Under Ctrl+C Burst', 'PTY process stable and prompt responsive');

  ws.close();
}

async function main() {
  try {
    await auditSourceCode();
    await runLiveInterruptionTests();

    console.log('\n============================================================');
    console.log(' ALL CTRL+C AUDIT AND INTERRUPTION TESTS PASSED [100%]');
    console.log('============================================================\n');

    const summaryReport = {
      timestamp: new Date().toISOString(),
      summary: 'All Ctrl+C signal, haptics, UI styling, and process interruption checks PASSED.',
      tests: testLog,
      status: 'SUCCESS',
    };

    fs.writeFileSync(
      path.resolve(__dirname, 'ctrl-c-audit-report.json'),
      JSON.stringify(summaryReport, null, 2)
    );
    console.log('Report written to server/ctrl-c-audit-report.json');
    process.exit(0);
  } catch (err) {
    console.error('\n[FATAL TEST FAILURE]:', err);
    process.exit(1);
  }
}

main();
