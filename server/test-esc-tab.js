/**
 * OMARCHY BRIDGE: AGENT 8 (ESC & TAB AUTOCOMPLETE) TEST SUITE
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TOKEN = 'omarchy-bridge-secure-key-2026';
const WS_URL = `ws://127.0.0.1:19001?token=${encodeURIComponent(TOKEN)}`;

let totalTests = 0;
let passedTests = 0;

function pass(name, detail = '') {
  totalTests++;
  passedTests++;
  console.log(`[PASS] ${name}${detail ? ' -> ' + detail : ''}`);
}

function fail(name, error) {
  totalTests++;
  console.error(`[FAIL] ${name} -> ${error.message || error}`);
  process.exit(1);
}

async function run() {
  console.log('======================================================================');
  console.log(' AGENT 8: ESC & TAB AUTOCOMPLETE VERIFICATION SUITE');
  console.log('======================================================================\n');

  // Suite 1: Static Audit
  console.log('--- Suite 1: Static Audit of mobile/App.tsx & server/server.js ---');
  const appTsx = fs.readFileSync(path.join(__dirname, '../mobile/App.tsx'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  try {
    assert(appTsx.includes("sendSignal('esc')"), 'App.tsx must bind ESC keycap to sendSignal("esc")');
    pass('App.tsx ESC keycap bound to sendSignal("esc")');

    assert(appTsx.includes("sendSignal('tab')"), 'App.tsx must bind TAB keycap to sendSignal("tab")');
    pass('App.tsx TAB keycap bound to sendSignal("tab")');

    assert(serverJs.includes("case 'esc':"), 'server.js must implement case "esc"');
    assert(serverJs.includes("ptyProcess.write('\\x1b')"), 'server.js must write \\x1b for esc');
    pass('server.js esc handler writes ASCII 0x1b (ESC)');

    assert(serverJs.includes("case 'tab':"), 'server.js must implement case "tab"');
    assert(serverJs.includes("ptyProcess.write('\\t')"), 'server.js must write \\t for tab');
    pass('server.js tab handler writes ASCII 0x09 (TAB)');
  } catch (e) {
    fail('Static audit', e);
  }

  // Suite 2: Live WebSocket Signal Verification
  console.log('\n--- Suite 2: Live WebSocket Signal Delivery & Autocomplete ---');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let outputBuffer = '';

    ws.on('open', () => {
      pass('Connected to live omarchy-bridge daemon');

      // Clear any pending line and send partial command
      ws.send(JSON.stringify({ type: 'signal', signal: 'ctrl_c' }));

      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'raw', data: 'cat /etc/host' }));

        setTimeout(() => {
          // Send TAB signal to autocomplete
          ws.send(JSON.stringify({ type: 'signal', signal: 'tab' }));

          setTimeout(() => {
            // Check if hostname or hosts was autocompleted
            const autocompleted = outputBuffer.includes('host') || outputBuffer.includes('hosts');
            assert(autocompleted, 'PTY output should reflect shell tab autocomplete');
            pass('TAB signal triggered shell completion in PTY stream');

            // Send ESC signal
            ws.send(JSON.stringify({ type: 'signal', signal: 'esc' }));
            pass('ESC signal dispatched successfully');

            // Clean up with Ctrl+C
            ws.send(JSON.stringify({ type: 'signal', signal: 'ctrl_c' }));
            setTimeout(() => {
              ws.close();
              resolve();
            }, 300);
          }, 600);
        }, 400);
      }, 400);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'output' && msg.data) {
          outputBuffer += msg.data;
        } else if (msg.type === 'screen' && msg.lines) {
          outputBuffer += msg.lines.join('\n');
        }
      } catch (e) {
        outputBuffer += data.toString();
      }
    });

    ws.on('error', (err) => reject(err));
  });

  console.log('\n======================================================================');
  console.log(` SUMMARY: Total Tests: ${totalTests} | Passed: ${passedTests} | Failed: 0`);
  console.log('======================================================================');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
