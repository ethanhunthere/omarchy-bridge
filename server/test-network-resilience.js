/**
 * Network Resilience & Reconnect Handling Audit
 * Simulates 50 rapid connect/disconnect cycles (clean and abrupt)
 * Tracks socket file descriptors, clients Set cleanup, and tmux session persistence.
 */

const { WebSocket } = require('ws');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = 19001;
const TOKEN = require('./test-token');
const WS_URL = `ws://127.0.0.1:${PORT}?token=${TOKEN}`;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const TMUX_SESSION = 'omarchy-remote';

function getHealth() {
  return new Promise((resolve, reject) => {
    http.get(HEALTH_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function getServerPid() {
  const out = execSync(`ss -tulpn '( sport = :${PORT} )'`).toString();
  const match = out.match(/pid=(\d+)/);
  if (!match) throw new Error('Could not find bridge server PID');
  return parseInt(match[1], 10);
}

function getSocketFds(pid) {
  try {
    const fds = fs.readdirSync(`/proc/${pid}/fd`);
    let socketCount = 0;
    const socketDetails = [];
    for (const fd of fds) {
      try {
        const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
        if (link.startsWith('socket:')) {
          socketCount++;
          socketDetails.push({ fd, target: link });
        }
      } catch (e) {
        // fd might have closed between readdir and readlink
      }
    }
    return { count: socketCount, totalFds: fds.length, socketDetails };
  } catch (e) {
    return { count: -1, totalFds: -1, socketDetails: [] };
  }
}

function checkTmux() {
  let sessions = '';
  let clients = '';
  let hasSession = false;
  try {
    sessions = execSync(`tmux list-sessions`).toString().trim();
  } catch (e) {}
  try {
    clients = execSync(`tmux list-clients`).toString().trim();
  } catch (e) {}
  try {
    execSync(`tmux has-session -t ${TMUX_SESSION}`);
    hasSession = true;
  } catch (e) {
    hasSession = false;
  }
  return {
    hasSession,
    sessions,
    clients,
    isAttached: clients.includes(TMUX_SESSION) && /attached/i.test(clients)
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function singleCycleClean(idx) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const ws = new WebSocket(WS_URL);

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timeout on cycle ${idx}`));
    }, 4000);

    ws.on('open', () => {});

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'init') {
          clearTimeout(timer);
          ws.close(1000, 'Normal Closure');
        }
      } catch (e) {
        // ignore raw data
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      resolve({ cycle: idx, durationMs: Date.now() - start, clean: true });
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function singleCycleAbrupt(idx) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const ws = new WebSocket(WS_URL);

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timeout on abrupt cycle ${idx}`));
    }, 4000);

    ws.on('open', () => {
      clearTimeout(timer);
      // Abruptly destroy socket / terminate immediately
      ws.terminate();
    });

    ws.on('close', () => {
      clearTimeout(timer);
      resolve({ cycle: idx, durationMs: Date.now() - start, abrupt: true });
    });

    ws.on('error', (err) => {
      // In terminate(), error might or might not fire; close is expected
      clearTimeout(timer);
      resolve({ cycle: idx, durationMs: Date.now() - start, abrupt: true, err: err.message });
    });
  });
}

async function singleCycleUnderStream(idx) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const ws = new WebSocket(WS_URL);

    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ cycle: idx, durationMs: Date.now() - start, streamAbrupt: true, timeout: true });
    }, 4000);

    ws.on('open', () => {});

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'init') {
          // Trigger rapid output stream from shell
          ws.send(JSON.stringify({ type: 'input', data: `seq 1 50` }));
        } else if (msg.type === 'output') {
          // As soon as data starts streaming back, abruptly terminate mid-flight
          clearTimeout(timer);
          ws.terminate();
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      clearTimeout(timer);
      resolve({ cycle: idx, durationMs: Date.now() - start, streamAbrupt: true });
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ cycle: idx, durationMs: Date.now() - start, streamAbrupt: true, error: err.message });
    });
  });
}

async function runAudit() {
  console.log('================================================================');
  console.log(' OMARCHY BRIDGE: NETWORK RESILIENCE & RECONNECT AUDIT');
  console.log('================================================================\n');

  const pid = getServerPid();
  console.log(`[INIT] Target Server PID: ${pid}`);

  const initialHealth = await getHealth();
  console.log(`[INIT] Server Uptime: ${initialHealth.uptime.toFixed(1)}s | Initial clients in Set: ${initialHealth.clients}`);

  const initialFds = getSocketFds(pid);
  console.log(`[INIT] Initial Open FDs: ${initialFds.totalFds} | Open Sockets: ${initialFds.count}`);

  const initialTmux = checkTmux();
  console.log(`[INIT] Tmux has session '${TMUX_SESSION}': ${initialTmux.hasSession}`);
  console.log(`[INIT] Tmux clients attached:\n       ${initialTmux.clients.replace(/\n/g, '\n       ')}`);
  console.log(`[INIT] Tmux is attached: ${initialTmux.isAttached}\n`);

  if (!initialTmux.isAttached) {
    throw new Error('Tmux is not initially attached!');
  }

  // --- PHASE 1: 50 Rapid Clean Connect/Disconnect Cycles ---
  console.log('----------------------------------------------------------------');
  console.log(' PHASE 1: 50 Rapid Clean Connect/Disconnect Cycles (Handshake + Close)');
  console.log('----------------------------------------------------------------');

  const cleanLatencies = [];
  const phase1Start = Date.now();

  for (let i = 1; i <= 50; i++) {
    const res = await singleCycleClean(i);
    cleanLatencies.push(res.durationMs);
    if (i % 10 === 0) {
      const midHealth = await getHealth();
      const midFds = getSocketFds(pid);
      console.log(`  Completed ${i}/50 cycles | Avg Latency: ${(cleanLatencies.reduce((a, b) => a + b, 0) / i).toFixed(1)}ms | Active Clients: ${midHealth.clients} | Sockets: ${midFds.count}`);
    }
  }

  const phase1Duration = Date.now() - phase1Start;
  console.log(`[PHASE 1 COMPLETE] 50 Clean Cycles finished in ${phase1Duration}ms (avg ${(phase1Duration / 50).toFixed(1)}ms/cycle)\n`);

  // Allow event loop and sockets a moment to flush
  await sleep(1000);

  const postPhase1Health = await getHealth();
  const postPhase1Fds = getSocketFds(pid);
  const postPhase1Tmux = checkTmux();

  console.log(`[PHASE 1 VERIFICATION]`);
  console.log(`  - Clients in Set: ${postPhase1Health.clients} (Expected: 0)`);
  console.log(`  - Socket FDs: ${postPhase1Fds.count} (Initial: ${initialFds.count})`);
  console.log(`  - Total FDs: ${postPhase1Fds.totalFds} (Initial: ${initialFds.totalFds})`);
  console.log(`  - Tmux Attached: ${postPhase1Tmux.isAttached}`);

  if (postPhase1Health.clients !== 0) {
    console.error(`[FAIL] Clients Set did not drain to 0! Found: ${postPhase1Health.clients}`);
  }
  if (!postPhase1Tmux.isAttached) {
    console.error(`[FAIL] Tmux session detached during Phase 1!`);
  }

  // --- PHASE 2: 50 Rapid Abrupt Disconnect Cycles ---
  console.log('\n----------------------------------------------------------------');
  console.log(' PHASE 2: 50 Rapid Abrupt Connect/Terminate Cycles (ws.terminate())');
  console.log('----------------------------------------------------------------');

  const abruptLatencies = [];
  const phase2Start = Date.now();

  for (let i = 1; i <= 50; i++) {
    const res = await singleCycleAbrupt(i);
    abruptLatencies.push(res.durationMs);
    if (i % 10 === 0) {
      const midHealth = await getHealth();
      const midFds = getSocketFds(pid);
      console.log(`  Completed ${i}/50 abrupt cycles | Active Clients: ${midHealth.clients} | Sockets: ${midFds.count}`);
    }
  }

  const phase2Duration = Date.now() - phase2Start;
  console.log(`[PHASE 2 COMPLETE] 50 Abrupt Cycles finished in ${phase2Duration}ms\n`);

  // Allow event loop and OS socket cleanups to settle
  await sleep(1500);

  const postPhase2Health = await getHealth();
  const postPhase2Fds = getSocketFds(pid);
  const postPhase2Tmux = checkTmux();

  console.log(`[PHASE 2 VERIFICATION]`);
  console.log(`  - Clients in Set: ${postPhase2Health.clients} (Expected: 0)`);
  console.log(`  - Socket FDs: ${postPhase2Fds.count} (Initial: ${initialFds.count})`);
  console.log(`  - Total FDs: ${postPhase2Fds.totalFds} (Initial: ${initialFds.totalFds})`);
  console.log(`  - Tmux Attached: ${postPhase2Tmux.isAttached}`);

  // --- PHASE 3: 50 Rapid Disconnects Under Active Output Streaming ---
  console.log('\n----------------------------------------------------------------');
  console.log(' PHASE 3: 50 Rapid Disconnects Mid-Stream (Shell Streaming Traffic)');
  console.log('----------------------------------------------------------------');

  const streamStart = Date.now();
  for (let i = 1; i <= 50; i++) {
    await singleCycleUnderStream(i);
    if (i % 10 === 0) {
      const midHealth = await getHealth();
      const midFds = getSocketFds(pid);
      console.log(`  Completed ${i}/50 mid-stream abrupt cycles | Active Clients: ${midHealth.clients} | Sockets: ${midFds.count}`);
    }
  }

  const streamDuration = Date.now() - streamStart;
  console.log(`[PHASE 3 COMPLETE] 50 Mid-Stream Cycles finished in ${streamDuration}ms\n`);

  await sleep(1500);

  const postPhase3Health = await getHealth();
  const postPhase3Fds = getSocketFds(pid);
  const postPhase3Tmux = checkTmux();

  console.log(`[PHASE 3 VERIFICATION]`);
  console.log(`  - Clients in Set: ${postPhase3Health.clients} (Expected: 0)`);
  console.log(`  - Socket FDs: ${postPhase3Fds.count} (Initial: ${initialFds.count})`);
  console.log(`  - Total FDs: ${postPhase3Fds.totalFds} (Initial: ${initialFds.totalFds})`);
  console.log(`  - Tmux Attached: ${postPhase3Tmux.isAttached}`);

  // --- PHASE 4: Functional Tmux Verification via Bridge WebSocket ---
  console.log('\n----------------------------------------------------------------');
  console.log(' PHASE 4: Functional Tmux Interactivity & Output Verification');
  console.log('----------------------------------------------------------------');

  const functionalVerification = await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let captured = '';
    const testEcho = `AUDIT_TOKEN_${Date.now()}`;

    ws.on('open', () => {});

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'init') {
          // Send command after init is acknowledged
          ws.send(JSON.stringify({ type: 'input', data: `echo "${testEcho}"` }));
        } else if (msg.type === 'output' && msg.data) {
          captured += msg.data;
          if (captured.includes(testEcho)) {
            ws.close();
            resolve({ success: true, tokenFound: true, capturedSnippet: testEcho });
          }
        }
      } catch (e) {
        captured += data.toString();
        if (captured.includes(testEcho)) {
          ws.close();
          resolve({ success: true, tokenFound: true, capturedSnippet: testEcho });
        }
      }
    });

    ws.on('error', reject);

    setTimeout(() => {
      ws.close();
      if (captured.includes(testEcho)) {
        resolve({ success: true, tokenFound: true });
      } else {
        reject(new Error(`Failed to capture test token in tmux output after 5s. Captured: ${captured}`));
      }
    }, 5000);
  });

  console.log(`[PHASE 4 COMPLETE] Interactivity test passed: ${functionalVerification.success}`);

  // Final check
  await sleep(1000);
  const finalHealth = await getHealth();
  const finalFds = getSocketFds(pid);
  const finalTmux = checkTmux();

  console.log('\n================================================================');
  console.log(' AUDIT SUMMARY & RESULTS');
  console.log('================================================================');
  console.log(`Total Cycles Executed: 150 (50 clean handshake + 50 abrupt terminate + 50 mid-stream terminate)`);
  console.log(`Clients Set: Initial=${initialHealth.clients}, Final=${finalHealth.clients} (Status: ${finalHealth.clients === 0 ? 'PASSED (0 LEAKS)' : 'FAILED'})`);
  console.log(`Socket FDs: Initial=${initialFds.count}, Final=${finalFds.count} (Status: ${finalFds.count === initialFds.count ? 'PASSED (0 LEAKS)' : 'LEAK DETECTED'})`);
  console.log(`Total FDs: Initial=${initialFds.totalFds}, Final=${finalFds.totalFds}`);
  console.log(`Tmux Session '${TMUX_SESSION}': Still Active=${finalTmux.hasSession}, Still Attached=${finalTmux.isAttached}`);
  console.log(`Interactivity Verified: ${functionalVerification.success}`);
  console.log('================================================================\n');

  const passed = finalHealth.clients === 0 &&
                 finalFds.count === initialFds.count &&
                 finalTmux.isAttached &&
                 functionalVerification.success;

  if (passed) {
    console.log('>>> ALL VERIFICATION CRITERIA MET: NO LEAKS, CLEAN TEARDOWN, TMUX UNINTERRUPTED <<<');
    process.exit(0);
  } else {
    console.error('>>> AUDIT FAILED <<<');
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('\n[FATAL AUDIT FAILURE]', err);
  process.exit(1);
});
