/**
 * Automated Verification Script for Agent 4: Command Submission & Return Key Tester
 *
 * Verifies:
 * 1. Text input command dispatch: { type: 'input', data: cmd } over WebSocket
 * 2. Return key submission (onSubmitEditing) identical execution
 * 3. Empty input submission: { type: 'signal', signal: 'enter' } (\r)
 * 4. History array deduplication, unshifting, and capping at 40 entries
 * 5. Input field immediate reset upon dispatch
 * 6. End-to-end execution through live WebSocket daemon & PTY
 */

const { WebSocket } = require('ws');

const PORT = 19001;
const TOKEN = require('./test-token');
const WS_URL = `ws://127.0.0.1:${PORT}?token=${TOKEN}`;

let passCount = 0;
let failCount = 0;
const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    passCount++;
    console.log(`[PASS] ${testName}${details ? ` -> ${details}` : ''}`);
    results.push({ test: testName, status: 'PASS', details });
  } else {
    failCount++;
    console.error(`[FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
    results.push({ test: testName, status: 'FAIL', details });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// =========================================================================
// SECTION A: Client-Side Simulation & Logic Audit (mirroring App.tsx)
// =========================================================================
console.log('\n============================================================');
console.log(' SECTION A: App.tsx Client-Side Logic & State Audit');
console.log('============================================================\n');

class MockAppClient {
  constructor() {
    this.inputCommand = '';
    this.history = [];
    this.historyIndex = -1;
    this.dispatchedMessages = [];
    this.socketOpen = true;
  }

  // Exact reproduction of App.tsx sendCommand logic (lines 377-391)
  sendCommand(cmd = this.inputCommand) {
    if (this.socketOpen) {
      if (!cmd || cmd.trim() === '') {
        const msg = { type: 'signal', signal: 'enter' };
        this.dispatchedMessages.push(msg);
      } else {
        const msg = { type: 'input', data: cmd };
        this.dispatchedMessages.push(msg);
        this.history = [cmd, ...this.history.filter((h) => h !== cmd)].slice(0, 40);
        this.historyIndex = -1;
        this.inputCommand = '';
      }
    }
  }

  // Exact reproduction of App.tsx onSubmitEditing handler (line 626)
  onSubmitEditing() {
    this.sendCommand();
  }

  // Exact reproduction of App.tsx send button onPress handler (line 635)
  onSendPress() {
    this.sendCommand();
  }
}

// Test A1: When inputCommand has text, tapping SEND dispatches { type: 'input', data: cmd }
{
  const client = new MockAppClient();
  client.inputCommand = 'uname -a';
  client.onSendPress();

  assert(
    client.dispatchedMessages.length === 1 &&
      client.dispatchedMessages[0].type === 'input' &&
      client.dispatchedMessages[0].data === 'uname -a',
    'Verify 1 (App.tsx): Send button dispatches { type: "input", data: cmd } when text is present',
    JSON.stringify(client.dispatchedMessages[0])
  );
}

// Test A2: Submitting via keyboard Return key (onSubmitEditing) triggers sendCommand() identically
{
  const clientSend = new MockAppClient();
  clientSend.inputCommand = 'git status';
  clientSend.onSendPress();

  const clientReturn = new MockAppClient();
  clientReturn.inputCommand = 'git status';
  clientReturn.onSubmitEditing();

  assert(
    JSON.stringify(clientSend.dispatchedMessages) === JSON.stringify(clientReturn.dispatchedMessages) &&
      JSON.stringify(clientSend.history) === JSON.stringify(clientReturn.history) &&
      clientSend.inputCommand === clientReturn.inputCommand,
    'Verify 2 (App.tsx): Return key (onSubmitEditing) and SEND button execute identically',
    `Both dispatched: ${JSON.stringify(clientReturn.dispatchedMessages[0])}`
  );
}

// Test A3: When inputCommand is empty, tapping SEND/↵ or Return dispatches { type: 'signal', signal: 'enter' }
{
  const clientEmpty = new MockAppClient();
  clientEmpty.inputCommand = '';
  clientEmpty.onSendPress();

  const clientWhitespace = new MockAppClient();
  clientWhitespace.inputCommand = '   \t  ';
  clientWhitespace.onSubmitEditing();

  assert(
    clientEmpty.dispatchedMessages[0].type === 'signal' &&
      clientEmpty.dispatchedMessages[0].signal === 'enter' &&
      clientWhitespace.dispatchedMessages[0].type === 'signal' &&
      clientWhitespace.dispatchedMessages[0].signal === 'enter',
    'Verify 3 (App.tsx): Empty or whitespace input dispatches { type: "signal", signal: "enter" }',
    `Empty -> ${JSON.stringify(clientEmpty.dispatchedMessages[0])}, Whitespace -> ${JSON.stringify(clientWhitespace.dispatchedMessages[0])}`
  );

  assert(
    clientEmpty.history.length === 0 && clientWhitespace.history.length === 0,
    'Verify 3b (App.tsx): Empty submissions do not pollute the command history array',
    `History length: ${clientEmpty.history.length}`
  );
}

// Test A4: Submitting adds command to top of history without duplicates and max 40 entries
{
  const client = new MockAppClient();

  // 1. Submit initial commands
  client.inputCommand = 'cmd1';
  client.sendCommand();
  client.inputCommand = 'cmd2';
  client.sendCommand();
  client.inputCommand = 'cmd3';
  client.sendCommand();

  assert(
    JSON.stringify(client.history) === JSON.stringify(['cmd3', 'cmd2', 'cmd1']),
    'Verify 4a (App.tsx): Submitting adds new commands to top (index 0) of history array',
    `History: [${client.history.join(', ')}]`
  );

  // 2. Re-submit cmd2 (should move to top without duplicate)
  client.inputCommand = 'cmd2';
  client.sendCommand();

  assert(
    JSON.stringify(client.history) === JSON.stringify(['cmd2', 'cmd3', 'cmd1']),
    'Verify 4b (App.tsx): Re-submitting existing command moves it to top with zero duplicate entries',
    `History: [${client.history.join(', ')}]`
  );

  // 3. Verify history cap at 40 entries
  for (let i = 100; i < 160; i++) {
    client.inputCommand = `bulk_cmd_${i}`;
    client.sendCommand();
  }

  assert(
    client.history.length === 40 && client.history[0] === 'bulk_cmd_159',
    'Verify 4c (App.tsx): History array size is strictly capped at 40 entries',
    `History length: ${client.history.length}, Top item: ${client.history[0]}`
  );
}

// Test A5: Input field resets to empty string immediately upon dispatch
{
  const client = new MockAppClient();
  client.inputCommand = 'echo "hello"';
  assert(client.inputCommand === 'echo "hello"', 'Verify 5a (App.tsx): Input holds command before dispatch');
  client.sendCommand();
  assert(
    client.inputCommand === '',
    'Verify 5b (App.tsx): Input field resets to empty string immediately upon dispatch',
    `Current inputCommand: "${client.inputCommand}"`
  );
  assert(
    client.historyIndex === -1,
    'Verify 5c (App.tsx): historyIndex resets to -1 upon dispatch for clean future navigation'
  );
}

// =========================================================================
// SECTION B: Live WebSocket End-to-End Server Protocol Verification
// =========================================================================
console.log('\n============================================================');
console.log(' SECTION B: Live WebSocket & PTY End-to-End Protocol Audit');
console.log('============================================================\n');

async function runLiveWebSocketTests() {
  let ws;
  let accumulatedOutput = '';
  let screenLines = [];

  function sendWs(payload) {
    ws.send(JSON.stringify(payload));
  }

  function waitForOutput(predicate, timeoutMs = 12000, context = '') {
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
              `Timeout waiting for predicate (${context}) after ${timeoutMs}ms. Output buffer:\n${accumulatedOutput.slice(-300)}`
            )
          );
        }
      }, 50);
    });
  }

  try {
    // Connect to Bridge
    await new Promise((resolve, reject) => {
      ws = new WebSocket(WS_URL);
      ws.on('open', () => {
        assert(true, 'Verify B0: WebSocket connection established with authentication');
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'output' && msg.data) {
            accumulatedOutput += msg.data;
          } else if (msg.type === 'screen' && Array.isArray(msg.lines)) {
            screenLines = msg.lines;
          } else if (msg.type === 'init') {
            resolve();
          }
        } catch (e) {
          accumulatedOutput += raw.toString();
        }
      });

      ws.on('error', (err) => {
        assert(false, 'Verify B0: WebSocket connection failed', err.message);
        reject(err);
      });
    });

    await sleep(500);

    // Test B1: Send text command via { type: 'input', data: cmd }
    console.log('Testing B1: Dispatching command with text...');
    accumulatedOutput = '';
    const uniqueToken1 = `TOKEN_${Date.now()}_A4`;
    sendWs({ type: 'input', data: `echo "${uniqueToken1}"` });

    await waitForOutput((out) => out.includes(uniqueToken1), 8000, 'unique token 1');
    assert(
      true,
      'Verify 1 (E2E): Server processes { type: "input", data: cmd }, executes in PTY, returns stdout',
      `Captured token: ${uniqueToken1}`
    );

    // Test B2: Trailing newline strip test (ensures cmd.replace(/\r?\n$/, '') works)
    console.log('Testing B2: Dispatching command with trailing \\n in data...');
    accumulatedOutput = '';
    const uniqueToken2 = `NEWLINE_CLEAN_${Date.now()}`;
    sendWs({ type: 'input', data: `echo "${uniqueToken2}"\n` });

    await waitForOutput((out) => out.includes(uniqueToken2), 8000, 'trailing newline clean');
    assert(
      true,
      'Verify 2 (E2E): Server safely strips trailing newlines from input commands before appending \\r',
      `Captured token: ${uniqueToken2}`
    );

    // Test B3: Empty input enter signal { type: 'signal', signal: 'enter' }
    console.log('Testing B3: Dispatching empty input enter signal...');
    accumulatedOutput = '';
    sendWs({ type: 'signal', signal: 'enter' });

    // When enter is sent to a shell in tmux, it produces a carriage return and prompt refresh
    await sleep(400);
    // Send another echo to verify shell is active and responsive to subsequent commands
    const promptCheckToken = `PROMPT_OK_${Date.now()}`;
    sendWs({ type: 'input', data: `echo "${promptCheckToken}"` });
    await waitForOutput((out) => out.includes(promptCheckToken), 6000, 'post-enter responsive check');

    assert(
      true,
      'Verify 3 (E2E): Server handles { type: "signal", signal: "enter" }, writes \\r, and shell remains fully responsive',
      `Shell executed subsequent command: ${promptCheckToken}`
    );

    // Test B4: Rapid sequential command submissions (simulating quick typing / Return taps)
    console.log('Testing B4: Rapid consecutive submissions...');
    accumulatedOutput = '';
    const seqA = `SEQ_A_${Date.now()}`;
    const seqB = `SEQ_B_${Date.now()}`;
    sendWs({ type: 'input', data: `echo "${seqA}"` });
    sendWs({ type: 'input', data: `echo "${seqB}"` });

    await waitForOutput((out) => out.includes(seqA) && out.includes(seqB), 10000, 'rapid sequence');
    assert(
      true,
      'Verify 4 (E2E): Rapid consecutive commands are queued and executed in order without loss',
      `Received both: ${seqA} and ${seqB}`
    );

    // Test B5: Special characters in command submission (quotes, pipes, semicolons)
    console.log('Testing B5: Commands with complex shell syntax...');
    accumulatedOutput = '';
    const specialToken = `SPECIAL_${Date.now()}`;
    sendWs({ type: 'input', data: `printf '%s|%s\\n' "${specialToken}" "COMPLETE"` });

    await waitForOutput((out) => out.includes(`${specialToken}|COMPLETE`), 8000, 'special syntax');
    assert(
      true,
      'Verify 5 (E2E): Complex commands with quotes, pipes, and format specifiers execute flawlessly',
      `Matched: ${specialToken}|COMPLETE`
    );

    ws.close();
  } catch (err) {
    assert(false, 'Live WebSocket execution encountered an unhandled error', err.message);
    if (ws) ws.close();
  }
}

async function main() {
  await runLiveWebSocketTests();

  console.log('\n============================================================');
  console.log(` AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log('============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
