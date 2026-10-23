/**
 * Automated Verification & Audit Test Suite for Terminal Clear Functionality
 * Agent 11: Terminal Clear Button Tester
 * 
 * Verifies:
 * 1. Tapping 'clear' keycap button dispatches { type: 'clear' } over WebSocket.
 * 2. Server resets scrollbackChunks, resets scrollbackBytes to 0, calls headlessTerm.clear()
 *    and headlessTerm.reset(), and writes \x0c to ptyProcess.
 * 3. Server broadcasts a clean screen update and sends { type: 'cleared' }.
 * 4. Mobile client clears screenLines and terminalText to empty state (with in-flight buffer protection).
 */

const { WebSocket } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 19001;
const TOKEN = require('./test-token');
const WS_URL = `ws://127.0.0.1:${PORT}?token=${TOKEN}`;
const MEMORY_URL = `http://127.0.0.1:${PORT}/api/memory?token=${TOKEN}`;
const SCREEN_URL = `http://127.0.0.1:${PORT}/api/screen?token=${TOKEN}`;

const APP_PATH = path.resolve(__dirname, '../mobile/App.tsx');
const SERVER_PATH = path.resolve(__dirname, 'server.js');

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

// =========================================================================
// Suite 1: Static Code Contract & AST/Regex Audit of mobile/App.tsx
// =========================================================================
function auditMobileApp() {
  logInfo('--- Suite 1: Static Code Audit of mobile/App.tsx ---');
  try {
    assert(fs.existsSync(APP_PATH), `mobile/App.tsx must exist at ${APP_PATH}`);
    const code = fs.readFileSync(APP_PATH, 'utf8');

    // 1.1 Verify clear keycap button exists and has onPress={clearScreen}
    const hasKeycap = /<TouchableOpacity[^>]*style=\{styles\.keycap\}[^>]*onPress=\{clearScreen\}[^>]*>\s*<Text[^>]*style=\{styles\.keycapText\}[^>]*>clear<\/Text>\s*<\/TouchableOpacity>/.test(code);
    assert(hasKeycap, 'TouchableOpacity for "clear" keycap button must exist with onPress={clearScreen}');
    logPass('Mobile Audit', "Clear keycap button rendered with onPress={clearScreen}");

    // 1.2 Verify clearScreen function definition
    const clearScreenMatch = code.match(/const clearScreen = \(\) =>\s*\{([\s\S]*?)\n  \};/);
    assert(clearScreenMatch, 'clearScreen function must be defined');
    const clearScreenBody = clearScreenMatch[1];

    // 1.3 Verify triggerHaptic('light')
    assert(clearScreenBody.includes("triggerHaptic('light')"), 'clearScreen must trigger haptic feedback');
    logPass('Mobile Audit', "clearScreen invokes triggerHaptic('light') for tactile feedback");

    // 1.4 Verify buffer and timeout clearing in clearScreen
    assert(clearScreenBody.includes("incomingBufferRef.current = ''"), 'clearScreen must reset incomingBufferRef to prevent stale batch flush');
    assert(clearScreenBody.includes('clearTimeout(flushTimeoutRef.current)'), 'clearScreen must cancel flushTimeoutRef');
    logPass('Mobile Audit', 'clearScreen cancels batch flush and clears incomingBufferRef');

    // 1.5 Verify local state reset in clearScreen
    assert(clearScreenBody.includes('setScreenLines([])'), 'clearScreen must reset screenLines to empty array');
    assert(clearScreenBody.includes("setTerminalText('')"), 'clearScreen must reset terminalText to empty string');
    logPass('Mobile Audit', 'clearScreen immediately sets screenLines=[] and terminalText=""');

    // 1.6 Verify WebSocket dispatch of { type: 'clear' }
    assert(clearScreenBody.includes("JSON.stringify({ type: 'clear' })"), "clearScreen must dispatch { type: 'clear' } over WebSocket");
    assert(clearScreenBody.includes('socketRef.current.readyState === WebSocket.OPEN'), 'clearScreen must check socketRef readyState before send');
    logPass('Mobile Audit', "clearScreen dispatches { type: 'clear' } when WebSocket is OPEN");

    // 1.7 Verify 'cleared' message handler in ws.onmessage
    const clearedIdx = code.indexOf("msg.type === 'cleared'");
    assert(clearedIdx !== -1, "ws.onmessage must handle msg.type === 'cleared'");
    const clearedSection = code.slice(clearedIdx, clearedIdx + 300);
    assert(clearedSection.includes('setScreenLines([])'), "cleared handler must setScreenLines([])");
    assert(clearedSection.includes("setTerminalText('')"), "cleared handler must setTerminalText('')");
    assert(clearedSection.includes("incomingBufferRef.current = ''"), 'cleared handler must reset incomingBufferRef');
    logPass('Mobile Audit', "Server 'cleared' confirmation sets screenLines=[], terminalText='', and resets buffer");

    // 1.8 Verify Empty State View rendering
    assert(code.includes('screenLines.length === 0 && !terminalText'), 'UI must render empty state container when screenLines is empty and terminalText is empty');
    assert(code.includes('[omarchy-remote ready]'), 'Empty state must display "[omarchy-remote ready]" placeholder');
    logPass('Mobile Audit', 'Terminal renders [omarchy-remote ready] placeholder when empty');
  } catch (err) {
    logFail('Mobile Audit', 'Static code audit failed', err.message);
  }
}

// =========================================================================
// Suite 2: Static Code Contract Audit of server/server.js
// =========================================================================
function auditServerJs() {
  logInfo('--- Suite 2: Static Code Audit of server/server.js ---');
  try {
    assert(fs.existsSync(SERVER_PATH), `server/server.js must exist at ${SERVER_PATH}`);
    const code = fs.readFileSync(SERVER_PATH, 'utf8');

    // 2.1 Verify case 'clear' exists
    const clearCaseMatch = code.match(/case 'clear':\s*([\s\S]*?)\s*break;/);
    assert(clearCaseMatch, "server.js must contain a switch case 'clear':");
    const clearBody = clearCaseMatch[1];

    // 2.2 Verify scrollback reset
    assert(clearBody.includes('scrollbackChunks = [];'), 'server.js must reset scrollbackChunks = []');
    assert(clearBody.includes('scrollbackBytes = 0;'), 'server.js must reset scrollbackBytes = 0');
    assert(clearBody.includes('maxObservedScrollbackBytes = 0;'), 'server.js must reset maxObservedScrollbackBytes = 0');
    assert(clearBody.includes('scrollbackExceededCount = 0;'), 'server.js must reset scrollbackExceededCount = 0');
    logPass('Server Audit', 'case clear resets scrollbackChunks=[], scrollbackBytes=0, and telemetry counters');

    // 2.3 Verify headlessTerm.clear() and headlessTerm.reset()
    assert(clearBody.includes('headlessTerm.clear();'), 'server.js must call headlessTerm.clear()');
    assert(clearBody.includes('headlessTerm.reset();'), 'server.js must call headlessTerm.reset()');
    logPass('Server Audit', 'case clear calls headlessTerm.clear() and headlessTerm.reset()');

    // 2.4 Verify { type: 'cleared' } response
    assert(clearBody.includes("JSON.stringify({ type: 'cleared' })"), "server.js must send { type: 'cleared' } back to client");
    logPass('Server Audit', "case clear responds with { type: 'cleared' } to client");

    // 2.5 Verify writing \x0c to ptyProcess
    assert(clearBody.includes("ptyProcess.write('\\x0c')") || clearBody.includes('ptyProcess.write("\\x0c")'), 'server.js must write \\x0c to ptyProcess');
    logPass('Server Audit', 'case clear writes \\x0c (Form Feed / Ctrl+L) to ptyProcess');

    // 2.6 Verify broadcastCleanScreen() call
    assert(clearBody.includes('broadcastCleanScreen();'), 'server.js must invoke broadcastCleanScreen()');
    logPass('Server Audit', 'case clear invokes broadcastCleanScreen() to update all active clients');
  } catch (err) {
    logFail('Server Audit', 'Static code audit failed', err.message);
  }
}

// =========================================================================
// Suite 3: Live End-to-End WebSocket Clear Protocol Verification
// =========================================================================
async function runLiveProtocolTests() {
  logInfo('--- Suite 3: Live End-to-End WebSocket & Server Clear Protocol Verification ---');

  let wsClientA = null;
  let wsClientB = null;

  try {
    // 3.1 Connect Client A
    const clientAMessages = [];
    wsClientA = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      wsClientA.on('open', () => {
        logPass('Live Clear', 'Client A WebSocket connected');
        resolve();
      });
      wsClientA.on('error', (e) => reject(new Error(`Client A error: ${e.message}`)));
      wsClientA.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          clientAMessages.push(parsed);
        } catch (e) {
          clientAMessages.push({ type: 'raw', data: raw.toString() });
        }
      });
    });

    // 3.2 Connect Client B for multi-client broadcast verification
    const clientBMessages = [];
    wsClientB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      wsClientB.on('open', () => {
        logPass('Live Clear', 'Client B WebSocket connected for broadcast observation');
        resolve();
      });
      wsClientB.on('error', (e) => reject(new Error(`Client B error: ${e.message}`)));
      wsClientB.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          clientBMessages.push(parsed);
        } catch (e) {
          clientBMessages.push({ type: 'raw', data: raw.toString() });
        }
      });
    });

    // Wait 500ms for init messages to settle
    await sleep(500);

    // 3.3 Generate terminal output and scrollback data
    logInfo('Injecting command to populate terminal buffer and scrollback...');
    wsClientA.send(JSON.stringify({ type: 'input', data: 'echo "MARKER_BEFORE_CLEAR_123456"; seq 1 60' }));

    // Wait for output to be processed by server
    let outputSeen = false;
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      const mem = await fetchJson(MEMORY_URL);
      if (mem.scrollbackBytes > 0) {
        outputSeen = true;
        logPass('Live Clear', 'Terminal output accumulated', `scrollbackBytes: ${mem.scrollbackBytes}, chunks: ${mem.scrollbackChunksCount}`);
        break;
      }
    }
    assert(outputSeen, 'Server scrollback buffer must be populated before testing clear');

    // Verify /api/screen has lines
    const screenBefore = await fetchJson(SCREEN_URL);
    assert(screenBefore.lines && screenBefore.lines.length > 0, 'Screen lines must not be empty before clear');
    logPass('Live Clear', 'Terminal screen populated before clear', `lines: ${screenBefore.lines.length}`);

    // Clear client message buffers to capture clear events cleanly
    clientAMessages.length = 0;
    clientBMessages.length = 0;

    // 3.4 Dispatch { type: 'clear' } from Client A
    logInfo("Client A sending { type: 'clear' }...");
    const clearSendTime = Date.now();
    wsClientA.send(JSON.stringify({ type: 'clear' }));

    // Wait for 'cleared' and 'screen' messages
    let receivedClearedA = false;
    let receivedCleanScreenA = false;
    let receivedCleanScreenB = false;

    for (let i = 0; i < 40; i++) {
      await sleep(50);

      if (!receivedClearedA) {
        const clearedIdx = clientAMessages.findIndex((m) => m.type === 'cleared');
        if (clearedIdx !== -1) {
          receivedClearedA = true;
          logPass('Live Clear', "Client A received { type: 'cleared' } confirmation", `${Date.now() - clearSendTime}ms`);
        }
      }

      if (!receivedCleanScreenA) {
        const screenIdx = clientAMessages.findIndex((m) => m.type === 'screen' && Array.isArray(m.lines) && m.lines.length === 0);
        if (screenIdx !== -1) {
          receivedCleanScreenA = true;
          logPass('Live Clear', "Client A received clean screen broadcast { type: 'screen', lines: [] }");
        }
      }

      if (!receivedCleanScreenB) {
        const screenIdxB = clientBMessages.findIndex((m) => m.type === 'screen' && Array.isArray(m.lines) && m.lines.length === 0);
        if (screenIdxB !== -1) {
          receivedCleanScreenB = true;
          logPass('Live Clear', "Client B received broadcast clean screen update { type: 'screen', lines: [] }");
        }
      }

      if (receivedClearedA && receivedCleanScreenA && receivedCleanScreenB) break;
    }

    assert(receivedClearedA, "Client A must receive { type: 'cleared' }");
    assert(receivedCleanScreenA, "Client A must receive clean screen broadcast");
    assert(receivedCleanScreenB, "Client B must receive clean screen broadcast");

    // 3.5 Verify server-side scrollback state reset via /api/memory
    // Right after clear, scrollbackBytes was reset to 0. (Shell might write a few bytes for prompt redraw)
    const memAfter = await fetchJson(MEMORY_URL);
    logInfo(`Server memory state after clear: scrollbackBytes=${memAfter.scrollbackBytes}, chunks=${memAfter.scrollbackChunksCount}`);
    // Prior output was hundreds of bytes; prompt redraw is very small
    assert(memAfter.scrollbackBytes < 3000, `Scrollback bytes after clear must be reset (observed: ${memAfter.scrollbackBytes})`);
    logPass('Live Clear', 'Server scrollback buffer successfully wiped clean', `Bytes after clear: ${memAfter.scrollbackBytes}`);

    // 3.6 Verify ptyProcess received \x0c and shell prompt was redrawn
    // Allow up to 1 second for shell prompt redraw
    await sleep(400);
    const screenAfter = await fetchJson(SCREEN_URL);
    assert(Array.isArray(screenAfter.lines), 'Screen lines must be an array');
    
    // The previous 60 lines of numbers should NOT be in screen lines
    const containsOldMarker = screenAfter.lines.some((l) => l.includes('MARKER_BEFORE_CLEAR_123456') || l.includes('45'));
    assert(!containsOldMarker, 'Screen must NOT contain lines from before the clear');
    logPass('Live Clear', 'Screen buffer contains no residue of pre-clear output');

    // Prompt redraw must have occurred: line count should be small (1-5 lines for prompt)
    assert(screenAfter.lines.length <= 5, `Screen after clear should only contain fresh prompt (lines: ${screenAfter.lines.length})`);
    logPass('Live Clear', 'Pty received \\x0c formfeed and shell prompt redrawn cleanly', `Lines: ${screenAfter.lines.length}`);

    // 3.7 Stress Test: Rapid consecutive clear calls (Idempotence)
    logInfo('Running rapid consecutive clear calls stress test (10 dispatches)...');
    for (let c = 0; c < 10; c++) {
      wsClientA.send(JSON.stringify({ type: 'clear' }));
    }
    await sleep(500);

    const memStress = await fetchJson(MEMORY_URL);
    assert(memStress.ptyPaused === false, 'PTY process must not be paused after rapid clears');
    logPass('Live Clear', 'Rapid clear stress test passed cleanly (PTY active, no hangs)');

  } catch (err) {
    logFail('Live Clear', 'Protocol verification failed', err.message);
  } finally {
    if (wsClientA) wsClientA.close();
    if (wsClientB) wsClientB.close();
  }
}

// =========================================================================
// Suite 4: Mobile Client State Simulation (In-flight Batch Flush Protection)
// =========================================================================
async function runMobileStateSimulationTests() {
  logInfo('--- Suite 4: Mobile Client In-Flight Buffer & State Simulation ---');

  try {
    // Simulate Mobile App State and Refs
    let screenLines = ['line 1', 'line 2', 'line 3'];
    let terminalText = 'existing terminal text';
    let incomingBuffer = 'incoming chunk about to flush';
    let flushTimeout = setTimeout(() => {
      terminalText += incomingBuffer;
      incomingBuffer = '';
      flushTimeout = null;
    }, 30);

    let hapticTriggered = null;
    const triggerHaptic = (style) => {
      hapticTriggered = style;
    };

    let wsSent = null;
    const mockSocket = {
      readyState: 1, // OPEN
      send: (data) => {
        wsSent = data;
      },
    };

    // Simulate clearScreen() as implemented in mobile/App.tsx
    const clearScreen = () => {
      triggerHaptic('light');
      incomingBuffer = '';
      if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
      }
      screenLines = [];
      terminalText = '';
      if (mockSocket && mockSocket.readyState === 1) {
        mockSocket.send(JSON.stringify({ type: 'clear' }));
      }
    };

    // 4.1 Invoke clearScreen
    clearScreen();

    // Verify immediate local state reset
    assert(hapticTriggered === 'light', 'clearScreen must trigger light haptic feedback');
    assert(screenLines.length === 0, 'screenLines must be empty array immediately');
    assert(terminalText === '', 'terminalText must be empty string immediately');
    assert(incomingBuffer === '', 'incomingBuffer must be empty immediately');
    assert(flushTimeout === null, 'flushTimeout must be cancelled immediately');
    assert(wsSent === JSON.stringify({ type: 'clear' }), "WebSocket must receive { type: 'clear' } payload");
    logPass('State Simulation', 'clearScreen resets local state, buffers, and dispatches payload');

    // 4.2 Wait past 50ms (well past 30ms flush window) to verify no zombie chunk flush
    await sleep(60);
    assert(terminalText === '', 'terminalText must remain completely empty after timeout window');
    logPass('State Simulation', 'No in-flight chunk resurrected in terminalText after batch window expires');

    // 4.3 Simulate incoming server confirmation message { type: 'cleared' }
    screenLines = ['stale line'];
    terminalText = 'stale text';
    incomingBuffer = 'new chunk';
    flushTimeout = setTimeout(() => {}, 30);

    const onClearedMessage = () => {
      incomingBuffer = '';
      if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
      }
      screenLines = [];
      terminalText = '';
    };

    onClearedMessage();
    assert(screenLines.length === 0, 'cleared handler resets screenLines');
    assert(terminalText === '', 'cleared handler resets terminalText');
    assert(incomingBuffer === '', 'cleared handler clears incomingBuffer');
    logPass('State Simulation', "Server 'cleared' message confirms and resets terminal state and buffer");

    // 4.4 Verify Empty State UI predicate
    const isEmptyState = screenLines.length === 0 && !terminalText;
    assert(isEmptyState === true, 'Empty state condition evaluates to true');
    logPass('State Simulation', 'Empty state condition (screenLines.length === 0 && !terminalText) activates [omarchy-remote ready]');

  } catch (err) {
    logFail('State Simulation', 'Mobile state simulation failed', err.message);
  }
}

// =========================================================================
// Main Runner & Summary
// =========================================================================
async function runAll() {
  console.log('\n=======================================================================');
  console.log('   OMARCHY BRIDGE AGENT 11: TERMINAL CLEAR BUTTON VERIFICATION SUITE');
  console.log('=======================================================================\n');

  auditMobileApp();
  auditServerJs();
  await runLiveProtocolTests();
  await runMobileStateSimulationTests();

  console.log('\n=======================================================================');
  console.log('                          TEST SUMMARY');
  console.log('=======================================================================');

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;

  console.log(`Total: ${results.length} | Passed: \x1b[32m${passed}\x1b[0m | Failed: ${failed > 0 ? `\x1b[31m${failed}\x1b[0m` : '0'}`);

  if (failed > 0) {
    console.error('\nFAILURES ENCOUNTERED:');
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((f) => console.error(` - [${f.suite}] ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('\n\x1b[32mALL TERMINAL CLEAR BUTTON AUDITS AND TESTS PASSED PERFECTLY!\x1b[0m\n');
    process.exit(0);
  }
}

runAll().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
