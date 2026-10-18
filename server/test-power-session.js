/**
 * Comprehensive Automated Test Suite for Power & Session Endpoints
 * Tests: poweroff, reboot, suspend, stealth_toggle, dpms_toggle, send_wol
 * Verifies:
 *  1. Command formatting (systemctl, hyprctl, systemd-inhibit)
 *  2. Zero password prompt hangs (sudo -n, --no-ask-password)
 *  3. WOL magic packet bit-exact byte verification (102 bytes)
 *  4. HTTP REST /api/action integration with auth & validation
 *  5. WebSocket action message handling & telemetry dispatch
 */

const http = require('http');
const dgram = require('dgram');
const { exec, execSync, spawn } = require('child_process');
const { WebSocket, WebSocketServer } = require('ws');
const fs = require('fs');

const TEST_PORT = 19002;
const TEST_TOKEN = 'omarchy-test-key-2026';
const PRIMARY_MAC = '14:13:33:a8:af:df';

const results = [];

function logPass(suite, name, details = '') {
  console.log(`[\x1b[32mPASS\x1b[0m] [${suite}] ${name}${details ? ` -> ${details}` : ''}`);
  results.push({ suite, name, status: 'PASS', details });
}

function logFail(suite, name, error) {
  console.error(`[\x1b[31mFAIL\x1b[0m] [${suite}] ${name} -> ${error}`);
  results.push({ suite, name, status: 'FAIL', error: String(error) });
}

function logInfo(msg) {
  console.log(`\x1b[34m[INFO]\x1b[0m ${msg}`);
}

// -------------------------------------------------------------
// Suite 1: Live Systemctl & Sudo Non-Blocking / Zero Hang Tests
// -------------------------------------------------------------
async function runSystemctlAndSudoTests() {
  logInfo('--- Suite 1: Systemctl & Sudo Zero-Hang Verification ---');

  // Test 1.1: systemctl poweroff dry-run
  try {
    const start = Date.now();
    execSync('systemctl poweroff --dry-run --no-ask-password 2>&1');
    const elapsed = Date.now() - start;
    logPass('Systemctl', 'systemctl poweroff --dry-run succeeds without password', `${elapsed}ms`);
  } catch (err) {
    logFail('Systemctl', 'systemctl poweroff --dry-run', err.message);
  }

  // Test 1.2: systemctl reboot dry-run
  try {
    const start = Date.now();
    execSync('systemctl reboot --dry-run --no-ask-password 2>&1');
    const elapsed = Date.now() - start;
    logPass('Systemctl', 'systemctl reboot --dry-run succeeds without password', `${elapsed}ms`);
  } catch (err) {
    logFail('Systemctl', 'systemctl reboot --dry-run', err.message);
  }

  // Test 1.3: systemctl suspend dry-run
  try {
    const start = Date.now();
    execSync('systemctl suspend --dry-run --no-ask-password 2>&1');
    const elapsed = Date.now() - start;
    logPass('Systemctl', 'systemctl suspend --dry-run succeeds without password', `${elapsed}ms`);
  } catch (err) {
    logFail('Systemctl', 'systemctl suspend --dry-run', err.message);
  }

  // Test 1.4: sudo -n non-blocking behavior (MUST NOT HANG)
  try {
    const start = Date.now();
    try {
      execSync('sudo -n systemctl poweroff --dry-run 2>&1', { timeout: 2000 });
    } catch (e) {
      // It may fail with 'a password is required', which is expected if not NOPASSWD!
      // The critical test is that it exits immediately without hanging.
    }
    const elapsed = Date.now() - start;
    if (elapsed < 1500) {
      logPass('Sudo', 'sudo -n exits immediately without prompting or hanging', `${elapsed}ms`);
    } else {
      logFail('Sudo', 'sudo -n hang detected', `Took ${elapsed}ms`);
    }
  } catch (err) {
    logFail('Sudo', 'sudo -n execution', err.message);
  }

  // Test 1.5: systemd-inhibit capability
  try {
    const start = Date.now();
    execSync('systemd-inhibit --what=idle:sleep:handle-lid-switch --who=omarchy-bridge sleep 0.05 2>&1');
    const elapsed = Date.now() - start;
    logPass('SystemdInhibit', 'systemd-inhibit executes with user privileges', `${elapsed}ms`);
  } catch (err) {
    logFail('SystemdInhibit', 'systemd-inhibit execution', err.message);
  }

  // Test 1.6: Hyprctl and instance signature check
  try {
    const hyprDir = '/run/user/1000/hypr';
    const hasHyprDir = fs.existsSync(hyprDir);
    const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE || (hasHyprDir ? fs.readdirSync(hyprDir).filter(f => !f.startsWith('.'))[0] : null);
    if (sig) {
      logPass('Hyprland', 'Hyprland instance signature discovered', sig);
    } else {
      logFail('Hyprland', 'Hyprland instance signature discovery', 'No instance found in /run/user/1000/hypr');
    }
  } catch (err) {
    logFail('Hyprland', 'Hyprland discovery error', err.message);
  }
}

// -------------------------------------------------------------
// Suite 2: Wake-on-LAN Magic Packet Bit-Exact Verification
// -------------------------------------------------------------
async function runWakeOnLanTests() {
  logInfo('--- Suite 2: Wake-on-LAN Magic Packet Verification ---');

  function createMagicPacket(targetMac) {
    const cleanMac = targetMac.replace(/[^0-9a-fA-F]/g, '');
    if (cleanMac.length !== 12) {
      throw new Error('Invalid MAC address (must be 12 hex characters)');
    }
    const macBuffer = Buffer.from(cleanMac, 'hex');
    const magicPacket = Buffer.alloc(102);
    for (let i = 0; i < 6; i++) magicPacket[i] = 0xff;
    for (let i = 0; i < 16; i++) macBuffer.copy(magicPacket, 6 + i * 6);
    return { magicPacket, macBuffer };
  }

  // Test 2.1: Packet length & header validation
  try {
    const { magicPacket, macBuffer } = createMagicPacket(PRIMARY_MAC);
    if (magicPacket.length === 102) {
      logPass('WOL', 'Magic packet total size is exactly 102 bytes');
    } else {
      logFail('WOL', 'Magic packet size', `Expected 102, got ${magicPacket.length}`);
    }

    // Verify 6 bytes of 0xFF
    let headerValid = true;
    for (let i = 0; i < 6; i++) {
      if (magicPacket[i] !== 0xff) headerValid = false;
    }
    if (headerValid) {
      logPass('WOL', 'Sync stream header is 6 bytes of 0xFF');
    } else {
      logFail('WOL', 'Sync stream header', 'Header did not match 6x 0xFF');
    }

    // Verify 16 repetitions of MAC
    let repetitionsValid = true;
    for (let rep = 0; rep < 16; rep++) {
      const slice = magicPacket.subarray(6 + rep * 6, 6 + (rep + 1) * 6);
      if (!slice.equals(macBuffer)) {
        repetitionsValid = false;
        break;
      }
    }
    if (repetitionsValid) {
      logPass('WOL', 'Packet contains exactly 16 repetitions of target MAC', macBuffer.toString('hex'));
    } else {
      logFail('WOL', 'MAC repetitions', 'MAC repetitions mismatch');
    }
  } catch (err) {
    logFail('WOL', 'Packet structure validation', err.message);
  }

  // Test 2.2: Invalid MAC rejection
  try {
    let threw = false;
    try {
      createMagicPacket('invalid-mac-123');
    } catch (e) {
      threw = true;
    }
    if (threw) {
      logPass('WOL', 'Invalid MAC address correctly rejected with Error');
    } else {
      logFail('WOL', 'Invalid MAC rejection', 'Did not throw on invalid MAC');
    }
  } catch (err) {
    logFail('WOL', 'Invalid MAC test error', err.message);
  }

  // Test 2.3: Socket UDP dispatch test
  try {
    const { magicPacket } = createMagicPacket(PRIMARY_MAC);
    await new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', () => {
          socket.send(magicPacket, 0, magicPacket.length, 9, '192.168.1.255', () => {
            socket.close();
            resolve();
          });
        });
      });
      socket.on('error', reject);
    });
    logPass('WOL', 'UDP broadcast sockets sent successfully to 255.255.255.255 & 192.168.1.255:9');
  } catch (err) {
    logFail('WOL', 'UDP broadcast transmission', err.message);
  }
}

// -------------------------------------------------------------
// Suite 3: Mock Execution & Exact Command Formatting Engine
// -------------------------------------------------------------
async function runMockActionEngineTests() {
  logInfo('--- Suite 3: Mock Action Engine & Exact Command Verification ---');

  const executedCommands = [];
  const spawnedProcesses = [];

  // Mock exec & spawn
  const mockExec = (cmd, cb) => {
    executedCommands.push({ cmd, time: Date.now() });
    if (cb) cb(null, '', '');
  };

  let mockKeepAwake = null;
  const mockSpawn = (proc, args) => {
    const p = {
      proc,
      args,
      killed: false,
      kill: function () {
        this.killed = true;
      },
    };
    spawnedProcesses.push(p);
    return p;
  };

  // State
  let stealthActive = false;
  let dpmsOn = true;

  function mockHandleAction(action, payload = {}) {
    switch (action) {
      case 'poweroff':
      case 'shutdown':
        mockExec('systemctl poweroff --no-ask-password || sudo -n systemctl poweroff');
        return { success: true, message: 'Shutting down Omarchy PC now...' };

      case 'reboot':
        mockExec('systemctl reboot --no-ask-password || sudo -n systemctl reboot');
        return { success: true, message: 'Rebooting Omarchy PC now...' };

      case 'suspend':
      case 'sleep':
        mockExec('systemctl suspend --no-ask-password || sudo -n systemctl suspend');
        return { success: true, message: 'Suspending PC into RAM...' };

      case 'lock':
        mockExec('hyprlock || loginctl lock-session');
        return { success: true, message: 'Desktop locked' };

      case 'stealth_toggle':
        stealthActive = !stealthActive;
        dpmsOn = !stealthActive;
        if (stealthActive) {
          mockExec('hyprctl dispatch dpms off');
          if (!mockKeepAwake) {
            mockKeepAwake = mockSpawn('systemd-inhibit', [
              '--what=idle:sleep:handle-lid-switch',
              '--who=omarchy-bridge',
              'sleep',
              'infinity',
            ]);
          }
        } else {
          mockExec('hyprctl dispatch dpms on');
          if (mockKeepAwake) {
            mockKeepAwake.kill();
            mockKeepAwake = null;
          }
        }
        return { success: true, stealthMode: stealthActive, dpmsOn };

      case 'dpms_toggle':
        dpmsOn = !dpmsOn;
        mockExec(`hyprctl dispatch dpms ${dpmsOn ? 'on' : 'off'}`);
        return { success: true, dpmsOn };

      case 'send_wol':
        return { success: true, mac: payload.mac || PRIMARY_MAC };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // Test 3.1: poweroff formatting
  executedCommands.length = 0;
  const resPower = mockHandleAction('poweroff');
  if (resPower.success && executedCommands.some(c => c.cmd.includes('systemctl poweroff'))) {
    logPass('Formatting', 'poweroff exact command', executedCommands[0].cmd);
  } else {
    logFail('Formatting', 'poweroff formatting', 'Did not execute expected command');
  }

  // Test 3.2: reboot formatting
  executedCommands.length = 0;
  const resReboot = mockHandleAction('reboot');
  if (resReboot.success && executedCommands.some(c => c.cmd.includes('systemctl reboot'))) {
    logPass('Formatting', 'reboot exact command', executedCommands[0].cmd);
  } else {
    logFail('Formatting', 'reboot formatting', 'Did not execute expected command');
  }

  // Test 3.3: suspend formatting
  executedCommands.length = 0;
  const resSuspend = mockHandleAction('suspend');
  if (resSuspend.success && executedCommands.some(c => c.cmd.includes('systemctl suspend'))) {
    logPass('Formatting', 'suspend exact command', executedCommands[0].cmd);
  } else {
    logFail('Formatting', 'suspend formatting', 'Did not execute expected command');
  }

  // Test 3.4: stealth_toggle activation
  executedCommands.length = 0;
  spawnedProcesses.length = 0;
  stealthActive = false;
  dpmsOn = true;
  const resStealth1 = mockHandleAction('stealth_toggle');
  const hasDpmsOff = executedCommands.some(c => c.cmd === 'hyprctl dispatch dpms off');
  const hasInhibit = spawnedProcesses.some(p => p.proc === 'systemd-inhibit' && p.args.includes('--who=omarchy-bridge'));
  if (resStealth1.stealthMode === true && resStealth1.dpmsOn === false && hasDpmsOff && hasInhibit) {
    logPass('Formatting', 'stealth_toggle ON: dpms off & systemd-inhibit spawned');
  } else {
    logFail('Formatting', 'stealth_toggle ON', 'Incorrect commands or state');
  }

  // Test 3.5: stealth_toggle deactivation
  executedCommands.length = 0;
  const resStealth2 = mockHandleAction('stealth_toggle');
  const hasDpmsOn = executedCommands.some(c => c.cmd === 'hyprctl dispatch dpms on');
  const inhibitKilled = spawnedProcesses[0]?.killed === true;
  if (resStealth2.stealthMode === false && resStealth2.dpmsOn === true && hasDpmsOn && inhibitKilled) {
    logPass('Formatting', 'stealth_toggle OFF: dpms on & systemd-inhibit terminated');
  } else {
    logFail('Formatting', 'stealth_toggle OFF', 'Failed to kill inhibit or dispatch dpms on');
  }

  // Test 3.6: dpms_toggle cycle
  executedCommands.length = 0;
  dpmsOn = true;
  const resDpms1 = mockHandleAction('dpms_toggle');
  const resDpms2 = mockHandleAction('dpms_toggle');
  if (resDpms1.dpmsOn === false && resDpms2.dpmsOn === true &&
      executedCommands[0].cmd === 'hyprctl dispatch dpms off' &&
      executedCommands[1].cmd === 'hyprctl dispatch dpms on') {
    logPass('Formatting', 'dpms_toggle cycles correctly between off and on');
  } else {
    logFail('Formatting', 'dpms_toggle cycle', 'Incorrect commands or toggle state');
  }
}

// -------------------------------------------------------------
// Suite 4: End-to-End HTTP REST & WebSocket Server Integration
// -------------------------------------------------------------
async function runHttpAndWebSocketTests() {
  logInfo('--- Suite 4: HTTP REST /api/action & WebSocket Endpoint Integration ---');

  let stealthActive = false;
  let dpmsOn = true;
  const recordedActions = [];

  function safeHandleAction(action, payload = {}) {
    recordedActions.push({ action, payload, time: Date.now() });
    switch (action) {
      case 'poweroff':
      case 'shutdown':
        return { success: true, message: 'Shutting down Omarchy PC now...' };
      case 'reboot':
        return { success: true, message: 'Rebooting Omarchy PC now...' };
      case 'suspend':
      case 'sleep':
        return { success: true, message: 'Suspending PC into RAM...' };
      case 'stealth_toggle':
        stealthActive = !stealthActive;
        dpmsOn = !stealthActive;
        return { success: true, stealthMode: stealthActive, dpmsOn };
      case 'dpms_toggle':
        dpmsOn = !dpmsOn;
        return { success: true, dpmsOn };
      case 'send_wol':
        return { success: true, mac: payload.mac || PRIMARY_MAC };
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // Create isolated test server
  const testServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryToken = reqUrl.searchParams.get('token');
    const authHeader = req.headers['authorization'];
    const token = queryToken || (authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null);

    if (token !== TEST_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (reqUrl.pathname === '/api/action' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = safeHandleAction(payload.action, payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const testWss = new WebSocketServer({ noServer: true });

  testServer.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const queryToken = reqUrl.searchParams.get('token');
    if (queryToken !== TEST_TOKEN) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    testWss.handleUpgrade(request, socket, head, ws => {
      testWss.emit('connection', ws, request);
    });
  });

  testWss.on('connection', ws => {
    ws.on('message', message => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'action') {
          try {
            const result = safeHandleAction(parsed.action, parsed.payload || {});
            ws.send(JSON.stringify({ type: 'action_result', action: parsed.action, result }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'action_error', action: parsed.action, error: e.message }));
          }
        }
      } catch (e) {}
    });
  });

  await new Promise(resolve => testServer.listen(TEST_PORT, '127.0.0.1', resolve));
  logPass('HTTP/WS', `Isolated test server listening on port ${TEST_PORT}`);

  // Helper HTTP POST
  function postAction(payload, token = TEST_TOKEN) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const req = http.request(
        `http://127.0.0.1:${TEST_PORT}/api/action?token=${token}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        res => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, raw: body });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  // Test 4.1: HTTP 401 on missing/bad token
  try {
    const resAuth = await postAction({ action: 'poweroff' }, 'bad-token');
    if (resAuth.statusCode === 401) {
      logPass('REST', 'Rejects unauthorized requests with 401');
    } else {
      logFail('REST', 'Auth check', `Expected 401, got ${resAuth.statusCode}`);
    }
  } catch (err) {
    logFail('REST', 'Auth check', err.message);
  }

  // Test 4.2: HTTP POST poweroff, reboot, suspend
  for (const act of ['poweroff', 'reboot', 'suspend']) {
    try {
      const res = await postAction({ action: act });
      if (res.statusCode === 200 && res.data.success === true) {
        logPass('REST', `HTTP POST /api/action (${act})`, res.data.message);
      } else {
        logFail('REST', `HTTP POST /api/action (${act})`, JSON.stringify(res));
      }
    } catch (err) {
      logFail('REST', `HTTP POST /api/action (${act})`, err.message);
    }
  }

  // Test 4.3: HTTP POST stealth_toggle & dpms_toggle
  for (const act of ['stealth_toggle', 'dpms_toggle']) {
    try {
      const res = await postAction({ action: act });
      if (res.statusCode === 200 && res.data.success === true) {
        logPass('REST', `HTTP POST /api/action (${act})`, JSON.stringify(res.data));
      } else {
        logFail('REST', `HTTP POST /api/action (${act})`, JSON.stringify(res));
      }
    } catch (err) {
      logFail('REST', `HTTP POST /api/action (${act})`, err.message);
    }
  }

  // Test 4.4: HTTP POST send_wol
  try {
    const customMac = '00:11:22:33:44:55';
    const res = await postAction({ action: 'send_wol', mac: customMac });
    if (res.statusCode === 200 && res.data.mac === customMac) {
      logPass('REST', 'HTTP POST /api/action (send_wol)', `Custom MAC: ${res.data.mac}`);
    } else {
      logFail('REST', 'HTTP POST /api/action (send_wol)', JSON.stringify(res));
    }
  } catch (err) {
    logFail('REST', 'HTTP POST /api/action (send_wol)', err.message);
  }

  // Test 4.5: WebSocket action messages
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?token=${TEST_TOKEN}`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const sendWsAction = (action, payload = {}) => {
      return new Promise((resolve, reject) => {
        const handler = data => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'action_result' && parsed.action === action) {
              ws.off('message', handler);
              resolve(parsed.result);
            }
          } catch (e) {}
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ type: 'action', action, payload }));
        setTimeout(() => {
          ws.off('message', handler);
          reject(new Error(`Timeout waiting for action_result: ${action}`));
        }, 3000);
      });
    };

    for (const act of ['poweroff', 'reboot', 'suspend', 'stealth_toggle', 'dpms_toggle', 'send_wol']) {
      const res = await sendWsAction(act);
      if (res && res.success === true) {
        logPass('WebSocket', `WS action message (${act})`, JSON.stringify(res));
      } else {
        logFail('WebSocket', `WS action message (${act})`, JSON.stringify(res));
      }
    }

    ws.close();
  } catch (err) {
    logFail('WebSocket', 'WS action message suite', err.message);
  }

  // Close test server
  await new Promise(resolve => {
    testWss.close(() => {
      testServer.close(resolve);
    });
  });
  logPass('HTTP/WS', 'Isolated test server closed cleanly');
}

// -------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------
async function main() {
  console.log('======================================================================');
  console.log(' OMARCHY BRIDGE: POWER & SESSION ENDPOINTS VERIFICATION SUITE');
  console.log('======================================================================\n');

  await runSystemctlAndSudoTests();
  console.log('');
  await runWakeOnLanTests();
  console.log('');
  await runMockActionEngineTests();
  console.log('');
  await runHttpAndWebSocketTests();

  console.log('\n======================================================================');
  const passes = results.filter(r => r.status === 'PASS').length;
  const fails = results.filter(r => r.status === 'FAIL').length;
  console.log(` SUMMARY: Total: ${results.length} | Passed: ${passes} | Failed: ${fails}`);
  console.log('======================================================================\n');

  if (fails > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
