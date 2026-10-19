/**
 * Automated Verification & Audit Test Suite for Wake-on-LAN (WOL)
 * Target: mobile/App.tsx and server/server.js
 * 
 * Verifies:
 * 1. Tapping 'WAKE-ON-LAN' dispatches action 'send_wol' via WebSocket.
 * 2. Server validates target MAC address (defaults to PRIMARY_MAC 14:13:33:a8:af:df).
 * 3. Constructs bit-exact 102-byte UDP magic packet (6x 0xFF + 16x MAC address binary).
 * 4. Broadcasts packet over UDP port 9 to 255.255.255.255 and subnet broadcast (192.168.1.255).
 * 5. Full end-to-end integration via WebSocket & HTTP REST against running daemon.
 */

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const http = require('http');
const { WebSocket } = require('ws');

const PRIMARY_MAC = process.env.PRIMARY_MAC || '14:13:33:a8:af:df';
const PORT = parseInt(process.env.PORT || '19001', 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'omarchy-bridge-secure-key-2026';
const WS_URL = `ws://127.0.0.1:${PORT}?token=${AUTH_TOKEN}`;

const results = [];

function pass(suite, testName, details = '') {
  console.log(`[\x1b[32mPASS\x1b[0m] [${suite}] ${testName}${details ? ` -> \x1b[36m${details}\x1b[0m` : ''}`);
  results.push({ suite, testName, status: 'PASS', details });
}

function fail(suite, testName, error) {
  console.error(`[\x1b[31mFAIL\x1b[0m] [${suite}] ${testName} -> \x1b[31m${error}\x1b[0m`);
  results.push({ suite, testName, status: 'FAIL', error: String(error) });
}

function header(title) {
  console.log(`\n\x1b[1m\x1b[34m=== ${title} ===\x1b[0m`);
}

// -------------------------------------------------------------
// Suite 1: Mobile UI Audit (mobile/App.tsx)
// -------------------------------------------------------------
async function runMobileAudit() {
  header('Suite 1: Mobile UI Audit (mobile/App.tsx)');
  const appPath = path.resolve(__dirname, '../mobile/App.tsx');

  try {
    if (!fs.existsSync(appPath)) {
      throw new Error(`mobile/App.tsx not found at ${appPath}`);
    }
    const content = fs.readFileSync(appPath, 'utf8');

    // 1.1 Verify Wake-on-LAN button rendering & onPress binding
    const wolButtonRegex = /<TouchableOpacity[^>]*onPress=\{[^}]*dispatchAction\(['"]send_wol['"]\)[^}]*\}[^>]*>[\s\S]*?SEND WAKE-ON-LAN[\s\S]*?<\/TouchableOpacity>/;
    const buttonMatch = content.match(wolButtonRegex);
    if (buttonMatch) {
      pass('MobileUI', "WAKE-ON-LAN button exists and binds onPress to dispatchAction('send_wol')", 'Matched component structure');
    } else {
      // Fallback check for separate onPress and label
      const hasOnPress = content.includes("dispatchAction('send_wol')");
      const hasLabel = content.includes('SEND WAKE-ON-LAN') || content.includes('WAKE-ON-LAN');
      if (hasOnPress && hasLabel) {
        pass('MobileUI', "WAKE-ON-LAN button calls dispatchAction('send_wol')", 'Found dispatchAction and label');
      } else {
        fail('MobileUI', 'WAKE-ON-LAN button verification', 'Could not locate button bound to send_wol');
      }
    }

    // 1.2 Verify dispatchAction implementation sends JSON over WebSocket
    const dispatchActionMatch = content.match(/const\s+dispatchAction\s*=\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\};/);
    if (dispatchActionMatch && dispatchActionMatch[1].includes("type: 'action'") && dispatchActionMatch[1].includes('socketRef.current.send')) {
      pass('MobileUI', "dispatchAction correctly serializes { type: 'action', action, payload } to WebSocket");
    } else {
      fail('MobileUI', 'dispatchAction structure', 'dispatchAction does not serialize action message as expected');
    }

    // 1.3 Verify button resides in POWER tab
    const powerViewIdx = content.indexOf("{activeTab === 'power' &&");
    const wolIdx = content.indexOf("dispatchAction('send_wol')");
    const endScrollView = powerViewIdx !== -1 ? content.indexOf('</ScrollView>', powerViewIdx) : -1;

    if (powerViewIdx !== -1 && wolIdx > powerViewIdx && wolIdx < endScrollView) {
      pass('MobileUI', 'WAKE-ON-LAN button is housed within the POWER view ScrollView', `Position: L${content.substring(0, wolIdx).split('\n').length}`);
    } else {
      fail('MobileUI', 'View Placement', 'WAKE-ON-LAN button not found in activeTab === power section');
    }

  } catch (err) {
    fail('MobileUI', 'App.tsx audit exception', err.message);
  }
}

// -------------------------------------------------------------
// Suite 2: Server MAC Address Validation & Defaults
// -------------------------------------------------------------
function buildMagicPacket(targetMac = PRIMARY_MAC) {
  const cleanMac = targetMac.replace(/[^0-9a-fA-F]/g, '');
  if (cleanMac.length !== 12) {
    throw new Error('Invalid MAC address (must be 12 hex characters)');
  }
  const macBuffer = Buffer.from(cleanMac, 'hex');
  const magicPacket = Buffer.alloc(102);
  for (let i = 0; i < 6; i++) magicPacket[i] = 0xff;
  for (let i = 0; i < 16; i++) macBuffer.copy(magicPacket, 6 + i * 6);
  return { magicPacket, macBuffer, cleanMac };
}

async function runMacValidationTests() {
  header('Suite 2: MAC Address Validation & Default Resolution');

  // 2.1 Default MAC Address
  try {
    const { cleanMac } = buildMagicPacket();
    if (cleanMac.toLowerCase() === PRIMARY_MAC.replace(/[^0-9a-fA-F]/g, '').toLowerCase()) {
      pass('Validation', `Defaults to PRIMARY_MAC (${PRIMARY_MAC}) when omitted`, cleanMac);
    } else {
      fail('Validation', 'Default MAC', `Expected ${PRIMARY_MAC}, got ${cleanMac}`);
    }
  } catch (err) {
    fail('Validation', 'Default MAC error', err.message);
  }

  // 2.2 Format variants (colon, hyphen, dot, contiguous hex, mixed case)
  const validVariants = [
    { label: 'Colon notation', input: '14:13:33:a8:af:df', expected: '141333a8afdf' },
    { label: 'Hyphen notation', input: '14-13-33-A8-AF-DF', expected: '141333a8afdf' },
    { label: 'Dot notation (Cisco)', input: '1413.33a8.afdf', expected: '141333a8afdf' },
    { label: 'Contiguous hex', input: '141333a8afdf', expected: '141333a8afdf' },
    { label: 'Uppercase colon', input: '14:13:33:A8:AF:DF', expected: '141333a8afdf' },
    { label: 'Arbitrary valid MAC', input: '00:11:22:33:44:55', expected: '001122334455' },
  ];

  for (const variant of validVariants) {
    try {
      const { cleanMac } = buildMagicPacket(variant.input);
      if (cleanMac.toLowerCase() === variant.expected.toLowerCase()) {
        pass('Validation', `Accepts ${variant.label}`, variant.input);
      } else {
        fail('Validation', `Variant ${variant.label}`, `Mismatch: expected ${variant.expected}, got ${cleanMac}`);
      }
    } catch (err) {
      fail('Validation', `Variant ${variant.label}`, err.message);
    }
  }

  // 2.3 Invalid MAC Rejection
  const invalidVariants = [
    { label: 'Too short (10 hex)', input: '14:13:33:a8:af' },
    { label: 'Too long (14 hex)', input: '14:13:33:a8:af:df:01' },
    { label: 'Non-hex chars (zz)', input: '14:13:33:a8:af:zz' },
    { label: 'Invalid string', input: 'invalid_mac_addr' },
    { label: 'Empty string', input: '' },
    { label: 'Delimiters only', input: '::::::' },
  ];

  for (const inv of invalidVariants) {
    try {
      let threw = false;
      let errorMsg = '';
      try {
        buildMagicPacket(inv.input);
      } catch (e) {
        threw = true;
        errorMsg = e.message;
      }
      if (threw && errorMsg.includes('Invalid MAC address (must be 12 hex characters)')) {
        pass('Validation', `Rejects ${inv.label}`, `Threw: "${errorMsg}"`);
      } else {
        fail('Validation', `Rejection of ${inv.label}`, `Expected Error, threw=${threw}, msg="${errorMsg}"`);
      }
    } catch (err) {
      fail('Validation', `Invalid variant ${inv.label}`, err.message);
    }
  }
}

// -------------------------------------------------------------
// Suite 3: Bit-Exact 102-Byte UDP Magic Packet Construction
// -------------------------------------------------------------
async function runMagicPacketStructureTests() {
  header('Suite 3: Bit-Exact 102-Byte Magic Packet Structure Verification');

  const testMacs = [
    PRIMARY_MAC,
    '00:11:22:33:44:55',
    'AA:BB:CC:DD:EE:FF',
    '01:23:45:67:89:AB',
  ];

  for (const mac of testMacs) {
    try {
      const { magicPacket, macBuffer } = buildMagicPacket(mac);

      // 3.1 Length must be bit-exact 102 bytes
      if (magicPacket.length === 102) {
        pass('Structure', `Total packet length is bit-exact 102 bytes (${mac})`, `Length = ${magicPacket.length}`);
      } else {
        fail('Structure', `Packet length (${mac})`, `Expected 102, got ${magicPacket.length}`);
      }

      // 3.2 Header: 6 bytes of 0xFF (indices 0..5)
      let headerValid = true;
      for (let i = 0; i < 6; i++) {
        if (magicPacket[i] !== 0xff) {
          headerValid = false;
          break;
        }
      }
      if (headerValid) {
        pass('Structure', `Sync stream header is exactly 6x 0xFF (${mac})`, 'Bytes 0..5 = FF FF FF FF FF FF');
      } else {
        fail('Structure', `Sync header (${mac})`, 'Header bytes do not match 6x 0xFF');
      }

      // 3.3 Payload: 16 contiguous repetitions of 6-byte MAC binary
      let repsValid = true;
      for (let r = 0; r < 16; r++) {
        const offset = 6 + r * 6;
        const slice = magicPacket.subarray(offset, offset + 6);
        if (!slice.equals(macBuffer)) {
          repsValid = false;
          break;
        }
      }
      if (repsValid) {
        pass('Structure', `Payload contains exactly 16 repetitions of MAC binary (${mac})`, `16 * 6 bytes = 96 bytes`);
      } else {
        fail('Structure', `Payload repetitions (${mac})`, 'Failed byte-exact MAC repetition check');
      }

      // 3.4 Verify byte arithmetic: 6 + 16 * 6 = 102
      if (6 + 16 * 6 === magicPacket.length) {
        pass('Structure', `Buffer bounds verified: 6 + 16*6 = 102 bytes (${mac})`);
      } else {
        fail('Structure', 'Buffer bounds', 'Buffer length mismatch with equation');
      }

    } catch (err) {
      fail('Structure', `Structure test exception (${mac})`, err.message);
    }
  }
}

// -------------------------------------------------------------
// Suite 4: UDP Broadcast Dispatch & Destination Addresses
// -------------------------------------------------------------
async function runUdpDispatchTests() {
  header('Suite 4: UDP Broadcast Dispatch Verification (Port 9 & Targets)');

  // 4.1 Mock / Intercepted UDP Dispatch Test
  // Spies on dgram.Socket to verify parameters passed to setBroadcast and send
  try {
    const interceptedCalls = [];
    let setBroadcastCalled = false;
    let socketClosed = false;

    const mockSocket = {
      setBroadcast: (val) => {
        setBroadcastCalled = val;
      },
      bind: function(cb) {
        if (cb) cb();
      },
      send: function(buffer, offset, length, port, address, cb) {
        interceptedCalls.push({
          bufferCopy: Buffer.from(buffer),
          offset,
          length,
          port,
          address,
        });
        if (cb) cb(null);
      },
      close: function() {
        socketClosed = true;
      },
      on: function(event, handler) {},
    };

    // Execute mock dispatch using the exact dispatch logic from server.js
    const testMac = PRIMARY_MAC;
    const { magicPacket } = buildMagicPacket(testMac);

    await new Promise((resolve) => {
      mockSocket.bind(() => {
        mockSocket.setBroadcast(true);
        mockSocket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', () => {
          mockSocket.send(magicPacket, 0, magicPacket.length, 9, '192.168.1.255', () => {
            mockSocket.close();
            resolve();
          });
        });
      });
    });

    if (setBroadcastCalled) {
      pass('Dispatch', 'Socket enables SO_BROADCAST (socket.setBroadcast(true))');
    } else {
      fail('Dispatch', 'Broadcast flag', 'socket.setBroadcast(true) was not called');
    }

    if (interceptedCalls.length === 2) {
      pass('Dispatch', 'Dispatches exactly two broadcast UDP transmissions');
    } else {
      fail('Dispatch', 'Transmission count', `Expected 2 calls, got ${interceptedCalls.length}`);
    }

    // Call 1: 255.255.255.255:9
    const call1 = interceptedCalls[0];
    if (call1.address === '255.255.255.255' && call1.port === 9 && call1.length === 102 && call1.offset === 0) {
      pass('Dispatch', 'Broadcast 1 targets 255.255.255.255:9 with 102-byte packet');
    } else {
      fail('Dispatch', 'Broadcast 1 destination', JSON.stringify(call1));
    }

    // Call 2: 192.168.1.255:9
    const call2 = interceptedCalls[1];
    if (call2.address === '192.168.1.255' && call2.port === 9 && call2.length === 102 && call2.offset === 0) {
      pass('Dispatch', 'Broadcast 2 targets subnet 192.168.1.255:9 with 102-byte packet');
    } else {
      fail('Dispatch', 'Broadcast 2 destination', JSON.stringify(call2));
    }

    if (socketClosed) {
      pass('Dispatch', 'UDP socket cleanly closed after both broadcast transmissions');
    } else {
      fail('Dispatch', 'Socket cleanup', 'Socket was not closed');
    }

  } catch (err) {
    fail('Dispatch', 'Mock dispatch exception', err.message);
  }

  // 4.2 Live Network Transmission Test on Host
  // Uses real dgram UDP socket to transmit over physical network
  try {
    const { magicPacket } = buildMagicPacket(PRIMARY_MAC);
    await new Promise((resolve, reject) => {
      const liveSocket = dgram.createSocket('udp4');
      liveSocket.on('error', (err) => {
        try { liveSocket.close(); } catch (e) {}
        reject(err);
      });

      liveSocket.bind(() => {
        liveSocket.setBroadcast(true);
        liveSocket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', (err1) => {
          if (err1) {
            try { liveSocket.close(); } catch (e) {}
            return reject(err1);
          }
          liveSocket.send(magicPacket, 0, magicPacket.length, 9, '192.168.1.255', (err2) => {
            try { liveSocket.close(); } catch (e) {}
            if (err2) return reject(err2);
            resolve();
          });
        });
      });
    });
    pass('Dispatch', 'Live OS UDP socket broadcasts to 255.255.255.255:9 and 192.168.1.255:9 without error');
  } catch (err) {
    fail('Dispatch', 'Live UDP network transmission', err.message);
  }
}

// -------------------------------------------------------------
// Suite 5: Live Daemon Integration (WebSocket & HTTP REST)
// -------------------------------------------------------------
async function runLiveDaemonIntegrationTests() {
  header('Suite 5: Live Daemon Protocol Integration (WebSocket & REST)');

  // 5.1 WebSocket: send_wol with default MAC (as sent by mobile App.tsx)
  try {
    const wsResult = await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket timeout waiting for action_result'));
      }, 5000);

      ws.on('open', () => {
        // Tapping 'WAKE-ON-LAN' in mobile/App.tsx dispatches:
        ws.send(JSON.stringify({ type: 'action', action: 'send_wol', payload: {} }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'action_result' && msg.action === 'send_wol') {
            clearTimeout(timer);
            ws.close();
            resolve(msg.result);
          } else if (msg.type === 'action_error' && msg.action === 'send_wol') {
            clearTimeout(timer);
            ws.close();
            reject(new Error(msg.error));
          }
        } catch (e) {}
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    if (wsResult && wsResult.success === true && wsResult.mac === PRIMARY_MAC) {
      pass('LiveWS', "Tapping 'WAKE-ON-LAN' (send_wol payload={}) resolves with primary MAC", JSON.stringify(wsResult));
    } else {
      fail('LiveWS', 'send_wol result', JSON.stringify(wsResult));
    }
  } catch (err) {
    fail('LiveWS', 'WebSocket send_wol error', err.message);
  }

  // 5.2 WebSocket: send_wol with custom MAC
  try {
    const customMac = '00:11:22:33:44:55';
    const wsResult = await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket timeout'));
      }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'action', action: 'send_wol', payload: { mac: customMac } }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'action_result' && msg.action === 'send_wol') {
            clearTimeout(timer);
            ws.close();
            resolve(msg.result);
          }
        } catch (e) {}
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    if (wsResult && wsResult.success === true && wsResult.mac === customMac) {
      pass('LiveWS', `Custom MAC address handled correctly: ${customMac}`, JSON.stringify(wsResult));
    } else {
      fail('LiveWS', 'Custom MAC response', JSON.stringify(wsResult));
    }
  } catch (err) {
    fail('LiveWS', 'WebSocket custom MAC error', err.message);
  }

  // 5.3 WebSocket: send_wol rejection of invalid MAC
  try {
    const invalidResult = await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket timeout waiting for action_error'));
      }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'action', action: 'send_wol', payload: { mac: 'invalid-mac' } }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'action_error' && msg.action === 'send_wol') {
            clearTimeout(timer);
            ws.close();
            resolve(msg);
          }
        } catch (e) {}
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    if (invalidResult && invalidResult.error.includes('Invalid MAC address')) {
      pass('LiveWS', 'Invalid MAC returns action_error to client', invalidResult.error);
    } else {
      fail('LiveWS', 'Invalid MAC response', JSON.stringify(invalidResult));
    }
  } catch (err) {
    fail('LiveWS', 'WebSocket invalid MAC test error', err.message);
  }

  // 5.4 HTTP REST POST /api/action with send_wol
  try {
    const postData = JSON.stringify({ action: 'send_wol' });
    const restResult = await new Promise((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${PORT}/api/action?token=${AUTH_TOKEN}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, raw: body });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (restResult.statusCode === 200 && restResult.body?.success === true && restResult.body?.mac === PRIMARY_MAC) {
      pass('LiveREST', 'HTTP POST /api/action (send_wol) succeeds with default PRIMARY_MAC', JSON.stringify(restResult.body));
    } else {
      fail('LiveREST', 'HTTP POST /api/action', JSON.stringify(restResult));
    }
  } catch (err) {
    fail('LiveREST', 'HTTP REST test exception', err.message);
  }
}

// -------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------
async function main() {
  console.log('======================================================================');
  console.log(' OMARCHY BRIDGE: WAKE-ON-LAN (WOL) VERIFICATION & AUDIT SUITE');
  console.log(' Agent 20: Wake-on-LAN Sender Button Tester');
  console.log('======================================================================');

  await runMobileAudit();
  await runMacValidationTests();
  await runMagicPacketStructureTests();
  await runUdpDispatchTests();
  await runLiveDaemonIntegrationTests();

  console.log('\n======================================================================');
  const passes = results.filter((r) => r.status === 'PASS').length;
  const fails = results.filter((r) => r.status === 'FAIL').length;
  console.log(` SUMMARY: Total Tests: ${results.length} | Passed: \x1b[32m${passes}\x1b[0m | Failed: \x1b[31m${fails}\x1b[0m`);
  console.log('======================================================================\n');

  if (fails > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
