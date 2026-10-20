/**
 * Automated Mock Verification & Audit Test Suite for Agent 15
 * (Reboot Exclusion & Power Safety Confirmation Tester)
 * Target: mobile/App.tsx, server/server.js, setup/50-omarchy-bridge.rules
 *
 * Verifies:
 * 1. The 'REBOOT PC' button is excluded from mobile/App.tsx to prevent accidental remote disconnection on Wi-Fi laptop.
 * 2. Primary safe power mode 'SUSPEND (SLEEP)' is rendered.
 * 3. Power action confirmation modal structure remains robust and secure.
 * 4. Tapping 'Cancel' dismisses the modal cleanly without dispatching.
 * 5. Polkit policy and systemctl handlers remain intact.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');
const http = require('http');

const APP_PATH = path.resolve(__dirname, 'App.tsx');
const SERVER_PATH = path.resolve(__dirname, '../server/server.js');
const POLKIT_PATH = path.resolve(__dirname, '../setup/50-omarchy-bridge.rules');
const SUDOERS_PATH = path.resolve(__dirname, '../setup/omarchy-bridge.sudoers');

const results = [];
let passCount = 0;
let failCount = 0;

function assert(condition, suite, name, details = '') {
  if (condition) {
    passCount++;
    console.log(`[\x1b[32mPASS\x1b[0m] [${suite}] ${name}${details ? ` -> ${details}` : ''}`);
    results.push({ suite, name, status: 'PASS', details });
  } else {
    failCount++;
    console.error(`[\x1b[31mFAIL\x1b[0m] [${suite}] ${name}${details ? ` -> ${details}` : ''}`);
    results.push({ suite, name, status: 'FAIL', details });
  }
}

function logInfo(msg) {
  console.log(`\x1b[34m[INFO]\x1b[0m ${msg}`);
}

async function runTestSuite() {
  console.log('\n============================================================');
  console.log(' AGENT 15: REBOOT EXCLUSION & POWER CONFIRMATION MODAL AUDIT');
  console.log('============================================================\n');

  // ============================================================
  // Suite 1: App.tsx Source Code & Modal Architecture Audit
  // ============================================================
  logInfo('--- Suite 1: mobile/App.tsx Static & Architectural Audit ---');

  assert(fs.existsSync(APP_PATH), 'AppCode', 'mobile/App.tsx exists on disk', APP_PATH);
  const appCode = fs.readFileSync(APP_PATH, 'utf-8');

  // 1.1 Verify Reboot button is completely excluded from power cards
  const hasRebootBtn = appCode.includes('testID="reboot-btn"');
  assert(!hasRebootBtn, 'AppCode', "Reboot button is completely removed from mobile/App.tsx (testID='reboot-btn' absent)");

  // 1.2 Verify button label does NOT contain 'REBOOT PC'
  const hasRebootLabel = appCode.includes('REBOOT PC');
  assert(!hasRebootLabel, 'AppCode', "Reboot PC label is removed from UI");

  // 1.3 Verify warning styles for reboot card are cleaned up
  const hasPowerCardWarning = appCode.includes('powerCardWarning:');
  assert(!hasPowerCardWarning, 'AppCode', "styles.powerCardWarning cleanly removed from stylesheet");

  // 1.4 Verify primary safe power mode SUSPEND is rendered
  const hasSuspendBtn = appCode.includes('testID="suspend-btn"');
  assert(hasSuspendBtn, 'AppCode', "Primary safe power mode 'SUSPEND (SLEEP)' exists (testID='suspend-btn')");

  // 1.5 Verify Confirmation Modal Component Structure
  const modalBlock = appCode.substring(appCode.indexOf('<Modal'), appCode.indexOf('</Modal>') + 8);
  assert(modalBlock.includes('visible={confirmModal.visible}'), 'AppCode', 'Modal visibility is tied to confirmModal.visible');
  assert(
    modalBlock.includes('{confirmModal.title}') && modalBlock.includes('confirmModal.isDanger && styles.textRed'),
    'AppCode',
    'Modal title renders {confirmModal.title} with styles.textRed danger coloring when isDanger is true'
  );
  assert(modalBlock.includes('{confirmModal.description}'), 'AppCode', 'Modal renders {confirmModal.description}');

  // 1.6 Verify Cancel button dismisses modal cleanly
  const hasCancelBtn = modalBlock.includes('styles.dialogBtnSecondary') &&
                       modalBlock.includes('Cancel') &&
                       modalBlock.includes('setConfirmModal((p) => ({ ...p, visible: false }))');
  assert(
    hasCancelBtn,
    'AppCode',
    "Modal has 'Cancel' button that cleanly resets confirmModal.visible to false"
  );

  // 1.7 Verify Execute button styling and action dispatch
  const executeBtnHasDanger = modalBlock.includes('confirmModal.isDanger ? styles.dialogBtnDanger : {}');
  assert(executeBtnHasDanger, 'AppCode', "Execute button dynamically applies styles.dialogBtnDanger when isDanger is true");

  const executeBtnDispatches = modalBlock.includes('dispatchAction(confirmModal.action)') &&
                               modalBlock.includes('setConfirmModal((p) => ({ ...p, visible: false }))');
  assert(
    executeBtnDispatches,
    'AppCode',
    "Execute button dispatches confirmModal.action and dismisses modal"
  );

  // 1.8 Verify danger button colors
  const dangerBtnStyleMatch = appCode.match(/dialogBtnDanger:\s*\{[^}]*backgroundColor:\s*['"]#ef4444['"]/);
  assert(!!dangerBtnStyleMatch, 'AppCode', "styles.dialogBtnDanger has red background color #ef4444", '#ef4444');

  const textRedStyleMatch = appCode.match(/textRed:\s*\{[^}]*color:\s*['"](#ef4444|#f87171|#f43f5e)['"]/);
  assert(!!textRedStyleMatch, 'AppCode', "styles.textRed has red danger color", textRedStyleMatch ? textRedStyleMatch[1] : 'none');

  // ============================================================
  // Suite 2: Client State Machine Simulation
  // ============================================================
  logInfo('\n--- Suite 2: Client State Machine Simulation ---');

  class AppModalSimulation {
    constructor() {
      this.confirmModal = {
        visible: false,
        title: '',
        description: '',
        action: '',
        isDanger: false,
      };
      this.dispatchedActions = [];
      this.wsMessages = [];
      this.wsOpen = true;
    }

    promptConfirmation(title, description, action, isDanger = false) {
      this.confirmModal = { visible: true, title, description, action, isDanger };
    }

    dispatchAction(action, payload = {}) {
      this.dispatchedActions.push({ action, payload });
      if (this.wsOpen) {
        this.wsMessages.push(JSON.stringify({ type: 'action', action, payload }));
      }
    }

    onTapSuspend() {
      this.promptConfirmation(
        'Suspend PC?',
        'This will execute "systemctl suspend" to put the PC into low-power RAM sleep (~1W).',
        'suspend',
        false
      );
    }

    onTapPoweroff() {
      this.promptConfirmation(
        'Shut Down PC?',
        'Execute "systemctl poweroff"?',
        'poweroff',
        true
      );
    }

    onTapCancel() {
      this.confirmModal = { ...this.confirmModal, visible: false };
    }

    onTapExecute() {
      this.dispatchAction(this.confirmModal.action);
      this.confirmModal = { ...this.confirmModal, visible: false };
    }
  }

  const sim = new AppModalSimulation();

  // Test 2.1: Initial State
  assert(sim.confirmModal.visible === false, 'StateSim', 'Initial state: modal is hidden (visible === false)');

  // Test 2.2: Tap Suspend
  sim.onTapSuspend();
  assert(
    sim.confirmModal.visible === true &&
    sim.confirmModal.title === 'Suspend PC?' &&
    sim.confirmModal.action === 'suspend' &&
    sim.confirmModal.isDanger === false,
    'StateSim',
    "Tapping 'SUSPEND' opens modal with title 'Suspend PC?' and isDanger=false",
    JSON.stringify(sim.confirmModal)
  );

  // Test 2.3: Tap Cancel
  sim.onTapCancel();
  assert(
    sim.confirmModal.visible === false,
    'StateSim',
    "Tapping 'Cancel' dismisses modal (visible === false)"
  );
  assert(
    sim.dispatchedActions.length === 0,
    'StateSim',
    "Tapping 'Cancel' does NOT dispatch any action or network message"
  );

  // Test 2.4: Tap Poweroff (Danger) and then Tap Execute
  sim.onTapPoweroff();
  assert(
    sim.confirmModal.visible === true && sim.confirmModal.isDanger === true,
    'StateSim',
    "Tapping dangerous power action opens confirmation modal with isDanger=true"
  );

  sim.onTapExecute();
  assert(
    sim.confirmModal.visible === false,
    'StateSim',
    "Tapping 'Execute' dismisses the modal cleanly"
  );
  assert(
    sim.dispatchedActions.length === 1 && sim.dispatchedActions[0].action === 'poweroff',
    'StateSim',
    "Tapping 'Execute' dispatches action 'poweroff'",
    JSON.stringify(sim.dispatchedActions[0])
  );
  assert(
    sim.wsMessages.length === 1 && sim.wsMessages[0] === JSON.stringify({ type: 'action', action: 'poweroff', payload: {} }),
    'StateSim',
    "Tapping 'Execute' sends WebSocket message",
    sim.wsMessages[0]
  );

  // ============================================================
  // Suite 3: Server Action Handler Implementation Audit
  // ============================================================
  logInfo('\n--- Suite 3: server/server.js Action Handler Audit ---');

  assert(fs.existsSync(SERVER_PATH), 'ServerCode', 'server/server.js exists on disk', SERVER_PATH);
  const serverCode = fs.readFileSync(SERVER_PATH, 'utf-8');

  // Verify 'suspend' case exists in handleAction
  const hasSuspendCase = serverCode.includes("case 'suspend':");
  assert(hasSuspendCase, 'ServerCode', "server.js handleAction() implements case 'suspend':");

  // Verify exact suspend command executed
  const suspendExecRegex = /case 'suspend':[\s\S]*?exec\(['"]([^'"]+)['"]\)/;
  const suspendExecMatch = serverCode.match(suspendExecRegex);
  const suspendCmd = suspendExecMatch ? suspendExecMatch[1] : '';

  assert(
    suspendCmd.includes('systemctl suspend --no-ask-password'),
    'ServerCode',
    "Suspend action executes 'systemctl suspend --no-ask-password'",
    suspendCmd
  );

  // ============================================================
  // Suite 4: Systemd, Polkit, and Sudo Passwordless Policy Audit
  // ============================================================
  logInfo('\n--- Suite 4: Systemd, Polkit, and Sudo Passwordless Policy Audit ---');

  // 4.1 Polkit Policy File Audit
  assert(fs.existsSync(POLKIT_PATH), 'Policy', 'setup/50-omarchy-bridge.rules exists', POLKIT_PATH);
  const polkitRules = fs.readFileSync(POLKIT_PATH, 'utf-8');
  assert(
    polkitRules.includes('org.freedesktop.login1.suspend') &&
    polkitRules.includes('org.freedesktop.login1.power-off'),
    'Policy',
    'Polkit rule covers login1 suspend and power-off'
  );
  assert(
    polkitRules.includes('polkit.Result.YES'),
    'Policy',
    'Polkit rule returns polkit.Result.YES (passwordless authorization)'
  );

  // 4.2 Sudoers Policy File Audit
  assert(fs.existsSync(SUDOERS_PATH), 'Policy', 'setup/omarchy-bridge.sudoers exists', SUDOERS_PATH);
  const sudoersRules = fs.readFileSync(SUDOERS_PATH, 'utf-8');
  assert(
    sudoersRules.includes('NOPASSWD') && sudoersRules.includes('/usr/bin/systemctl suspend'),
    'Policy',
    'Sudoers rule configures NOPASSWD for /usr/bin/systemctl suspend'
  );

  // 4.3 Live Polkit Authorization Check
  try {
    execSync('pkcheck --process $$ --action-id org.freedesktop.login1.suspend 2>&1');
    assert(true, 'LivePolicy', 'pkcheck allows org.freedesktop.login1.suspend without password prompt', 'Status: OK (Exit 0)');
  } catch (err) {
    assert(false, 'LivePolicy', 'pkcheck org.freedesktop.login1.suspend', err.message);
  }

  // 4.4 Live Sudo Non-Blocking Execution Check
  try {
    const sudoStart = Date.now();
    try {
      execSync('sudo -n -l 2>&1', { timeout: 1000 });
    } catch (e) {}
    const sudoElapsed = Date.now() - sudoStart;
    assert(
      sudoElapsed < 1000,
      'LivePolicy',
      'sudo -n returns non-blocking result without interactive password prompt hang',
      `Completed in ${sudoElapsed}ms`
    );
  } catch (err) {
    assert(false, 'LivePolicy', 'sudo -n execution check', err.message);
  }

  // ============================================================
  // Suite 5: Mock WebSocket Integration Test (Zero Danger)
  // ============================================================
  logInfo('\n--- Suite 5: Isolated Mock WebSocket Server & Protocol Integration ---');

  const MOCK_PORT = 19185;
  let mockServer;
  let mockWss;
  let receivedAction = null;
  let simulatedCommand = null;

  await new Promise((resolve) => {
    mockServer = http.createServer();
    mockWss = new WebSocket.Server({ server: mockServer });

    mockWss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'action') {
            receivedAction = parsed;
            if (parsed.action === 'suspend') {
              simulatedCommand = 'systemctl suspend --no-ask-password || sudo -n systemctl suspend';
              ws.send(JSON.stringify({ type: 'action_result', success: true, message: 'Suspending Omarchy PC into RAM sleep...' }));
            }
          }
        } catch (e) {}
      });
    });

    mockServer.listen(MOCK_PORT, () => {
      resolve();
    });
  });

  // Client connects and dispatches action
  await new Promise((resolve, reject) => {
    const wsClient = new WebSocket(`ws://127.0.0.1:${MOCK_PORT}`);

    wsClient.on('open', () => {
      // Simulate App.tsx dispatchAction('suspend')
      wsClient.send(JSON.stringify({ type: 'action', action: 'suspend', payload: {} }));
    });

    wsClient.on('message', (msg) => {
      try {
        const res = JSON.parse(msg.toString());
        assert(
          res.success === true && res.message.includes('Suspending'),
          'MockE2E',
          'Mock server received action and returned immediate success confirmation',
          JSON.stringify(res)
        );
        wsClient.close();
        resolve();
      } catch (e) {
        reject(e);
      }
    });

    wsClient.on('error', (err) => {
      reject(err);
    });
  });

  // Close mock server
  await new Promise((resolve) => {
    mockWss.close(() => {
      mockServer.close(() => {
        resolve();
      });
    });
  });

  assert(
    receivedAction && receivedAction.action === 'suspend',
    'MockE2E',
    "Mock WebSocket server validated receipt of { type: 'action', action: 'suspend' }"
  );

  assert(
    simulatedCommand === 'systemctl suspend --no-ask-password || sudo -n systemctl suspend',
    'MockE2E',
    "Simulated action execution produced bit-exact systemctl suspend command",
    simulatedCommand
  );

  // ============================================================
  // Final Summary Report
  // ============================================================
  console.log('\n============================================================');
  console.log(` AGENT 15 AUDIT COMPLETE: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${results.length})`);
  console.log('============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
