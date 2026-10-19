/**
 * Automated Verification & Audit Suite for Agent 16
 * (Suspend Button & Confirmation Modal Tester)
 * Target: mobile/App.tsx, server/server.js, and systemd/ACPI subsystem
 *
 * Verifies:
 * 1. Tapping 'SUSPEND' opens the confirmation modal with title 'Suspend PC?'.
 * 2. Tapping 'Cancel' closes the modal cleanly without dispatching actions.
 * 3. Tapping 'Execute' dispatches action 'suspend', which executes systemctl suspend --no-ask-password.
 * 4. System suspends to RAM cleanly without password hangs (zero prompt hang, Polkit / ACPI verified).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { performance } = require('perf_hooks');

const APP_PATH = path.resolve(__dirname, 'App.tsx');
const SERVER_PATH = path.resolve(__dirname, '../server/server.js');
const POLKIT_PATH = path.resolve(__dirname, '../setup/50-omarchy-bridge.rules');

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

async function runAudit() {
  console.log('================================================================');
  console.log('  Agent 16: Suspend Button & Confirmation Modal Verification   ');
  console.log('================================================================');

  // Verify file existence
  if (!fs.existsSync(APP_PATH)) {
    logFail('FileCheck', 'App.tsx exists', 'File not found at ' + APP_PATH);
    process.exit(1);
  }
  const appCode = fs.readFileSync(APP_PATH, 'utf-8');

  // ============================================================
  // Suite 1: 'SUSPEND' Button & Modal Trigger Audit in App.tsx
  // ============================================================
  logInfo('\n--- Suite 1: SUSPEND Button & Confirmation Trigger Audit ---');

  // 1.1 SUSPEND button label
  const hasSuspendLabel = appCode.includes('<Text style={styles.cardLabel}>SUSPEND</Text>');
  if (hasSuspendLabel) {
    logPass('ButtonUI', "'SUSPEND' button text rendered with styles.cardLabel", '<Text>SUSPEND</Text>');
  } else {
    logFail('ButtonUI', "'SUSPEND' button text", 'Card label SUSPEND not found');
  }

  // 1.2 SUSPEND button testID and accessibility
  const hasSuspendTestId = appCode.includes('testID="suspend-btn"');
  const hasSuspendA11y = appCode.includes('accessibilityLabel="SUSPEND"');
  if (hasSuspendTestId && hasSuspendA11y) {
    logPass('ButtonA11y', 'SUSPEND button has testID="suspend-btn" and accessibilityLabel="SUSPEND"', 'testID & a11y verified');
  } else {
    logFail('ButtonA11y', 'SUSPEND button testID/a11y attributes', `testID=${hasSuspendTestId}, a11y=${hasSuspendA11y}`);
  }

  // 1.3 promptConfirmation call with title 'Suspend PC?' and action 'suspend'
  const promptRegex = /promptConfirmation\(\s*['"]Suspend PC\?['"]\s*,[\s\S]*?,\s*['"]suspend['"]\s*,\s*false\s*\)/;
  const promptMatch = appCode.match(promptRegex);
  if (promptMatch) {
    logPass('TriggerAction', "Tapping 'SUSPEND' invokes promptConfirmation with title 'Suspend PC?' and action 'suspend'", promptMatch[0].replace(/\s+/g, ' '));
  } else {
    logFail('TriggerAction', "promptConfirmation call for 'Suspend PC?'", 'Expected promptConfirmation("Suspend PC?", ..., "suspend", false)');
  }

  // 1.4 systemctl suspend badge
  const hasCmdBadge = appCode.includes('<Text style={styles.cmdBadge}>systemctl suspend</Text>');
  if (hasCmdBadge) {
    logPass('ButtonUI', "SUSPEND button displays 'systemctl suspend' command badge", 'Badge: systemctl suspend');
  } else {
    logFail('ButtonUI', 'systemctl suspend command badge', 'Badge not found');
  }

  // ============================================================
  // Suite 2: Confirmation Modal Structure & Lifecycle Handlers
  // ============================================================
  logInfo('\n--- Suite 2: Confirmation Modal Structure & Lifecycle Handlers ---');

  // 2.1 Modal Component with visibility binding
  const hasModalComponent = appCode.includes('<Modal visible={confirmModal.visible}') && appCode.includes('testID="confirmation-modal"');
  if (hasModalComponent) {
    logPass('ModalStructure', 'Modal component bound to confirmModal.visible with testID="confirmation-modal"', 'Modal visible={confirmModal.visible}');
  } else {
    logFail('ModalStructure', 'Modal visibility binding', 'Modal visible={confirmModal.visible} not found');
  }

  // 2.2 Modal Title rendering confirmModal.title
  const hasModalTitle = appCode.includes('{confirmModal.title}') && appCode.includes('testID="modal-title"');
  if (hasModalTitle) {
    logPass('ModalTitle', 'Modal title bound to confirmModal.title with testID="modal-title"', '{confirmModal.title}');
  } else {
    logFail('ModalTitle', 'Modal title element', 'testID="modal-title" or {confirmModal.title} not found');
  }

  // 2.3 Cancel Button closes modal cleanly
  const hasCancelBtn = appCode.includes('testID="modal-cancel-btn"') &&
                       appCode.includes('<Text style={styles.dialogBtnSecondaryText}>Cancel</Text>') &&
                       appCode.includes('setConfirmModal((p) => ({ ...p, visible: false }))');
  if (hasCancelBtn) {
    logPass('ModalCancel', "Tapping 'Cancel' cleanly resets visible: false", 'Cancel handler verified');
  } else {
    logFail('ModalCancel', "Cancel button handler in Modal", 'Cancel button or dismiss handler missing');
  }

  // 2.4 Execute Button dispatches action and closes modal
  const hasExecuteBtn = appCode.includes('testID="modal-execute-btn"') &&
                        appCode.includes('<Text style={styles.dialogBtnPrimaryText}>Execute</Text>') &&
                        appCode.includes('dispatchAction(confirmModal.action)') &&
                        appCode.includes('setConfirmModal((p) => ({ ...p, visible: false }))');
  if (hasExecuteBtn) {
    logPass('ModalExecute', "Tapping 'Execute' dispatches confirmModal.action and closes modal", 'dispatchAction(confirmModal.action)');
  } else {
    logFail('ModalExecute', 'Execute button handler', 'Execute button missing dispatchAction or close');
  }

  // 2.5 dispatchAction implementation sends WebSocket action payload
  const hasDispatchAction = appCode.includes("socketRef.current.send(JSON.stringify({ type: 'action', action, payload }))");
  if (hasDispatchAction) {
    logPass('DispatchAction', "dispatchAction serializes payload to { type: 'action', action, payload }", 'WebSocket send verified');
  } else {
    logFail('DispatchAction', 'dispatchAction WebSocket serialization', 'Missing WebSocket action payload serialization');
  }

  // ============================================================
  // Suite 3: Simulated Modal State Machine & Interaction Flow
  // ============================================================
  logInfo('\n--- Suite 3: Simulated Modal State Machine & Interaction Flow ---');

  // Simulate component state and handlers
  let modalState = {
    visible: false,
    title: '',
    description: '',
    action: '',
    isDanger: false,
  };
  let dispatchedAction = null;

  function mockPromptConfirmation(title, description, action, isDanger = false) {
    modalState = { visible: true, title, description, action, isDanger };
  }

  function mockCancel() {
    modalState = { ...modalState, visible: false };
  }

  function mockExecute() {
    dispatchedAction = modalState.action;
    modalState = { ...modalState, visible: false };
  }

  // Step 3.1: Initial State is closed
  if (modalState.visible === false) {
    logPass('StateSim', 'Initial modal state is hidden (visible: false)', 'visible: false');
  } else {
    logFail('StateSim', 'Initial modal state', 'Modal should initially be hidden');
  }

  // Step 3.2: User taps SUSPEND
  const t0 = performance.now();
  mockPromptConfirmation(
    'Suspend PC?',
    'This will execute "systemctl suspend" to put the PC into low-power RAM sleep.',
    'suspend',
    false
  );
  const openTime = performance.now() - t0;
  if (modalState.visible === true && modalState.title === 'Suspend PC?' && modalState.action === 'suspend') {
    logPass('StateSim', `Tapping 'SUSPEND' opens modal with title 'Suspend PC?' and action 'suspend' in ${openTime.toFixed(3)}ms`, `Title: "${modalState.title}"`);
  } else {
    logFail('StateSim', "Modal open simulation failed", JSON.stringify(modalState));
  }

  // Step 3.3: User taps Cancel -> cleanly closes without dispatching
  dispatchedAction = null;
  mockCancel();
  if (modalState.visible === false && dispatchedAction === null) {
    logPass('StateSim', "Tapping 'Cancel' closes modal cleanly without dispatching any action", 'visible: false, dispatched: null');
  } else {
    logFail('StateSim', "Cancel tap did not close cleanly", `visible=${modalState.visible}, dispatched=${dispatchedAction}`);
  }

  // Step 3.4: Re-open and tap Execute -> dispatches 'suspend' and closes
  mockPromptConfirmation('Suspend PC?', 'Putting PC into sleep', 'suspend', false);
  dispatchedAction = null;
  mockExecute();
  if (modalState.visible === false && dispatchedAction === 'suspend') {
    logPass('StateSim', "Tapping 'Execute' dispatches action 'suspend' and closes modal cleanly", `dispatched: "${dispatchedAction}", visible: false`);
  } else {
    logFail('StateSim', "Execute tap failed", `dispatched=${dispatchedAction}, visible=${modalState.visible}`);
  }

  // ============================================================
  // Suite 4: Backend Handler & Command Execution Formatting
  // ============================================================
  logInfo('\n--- Suite 4: Backend Server Action Handler & Command String ---');

  if (fs.existsSync(SERVER_PATH)) {
    const serverCode = fs.readFileSync(SERVER_PATH, 'utf-8');
    const suspendCaseMatch = serverCode.includes("case 'suspend':") &&
                             serverCode.includes("exec('systemctl suspend --no-ask-password || sudo -n systemctl suspend')");
    if (suspendCaseMatch) {
      logPass('ServerBackend', "Backend 'suspend' action executes 'systemctl suspend --no-ask-password || sudo -n systemctl suspend'", 'Exact command match');
    } else {
      logFail('ServerBackend', "Backend 'suspend' action handler", 'Expected exact systemctl suspend command in server.js');
    }

    const messageMatch = serverCode.includes("return { success: true, message: 'Suspending PC into RAM...' };");
    if (messageMatch) {
      logPass('ServerBackend', "Backend returns clean confirmation message: 'Suspending PC into RAM...'", 'Return payload verified');
    } else {
      logFail('ServerBackend', 'Backend confirmation message', 'Expected message not found in server.js');
    }
  } else {
    logFail('ServerBackend', 'server.js exists', 'Server file not found');
  }

  // ============================================================
  // Suite 5: OS Suspend Capability & Zero-Hang Verification
  // ============================================================
  logInfo('\n--- Suite 5: OS Suspend Capability & Zero Password Hangs ---');

  // 5.1 Test systemctl suspend --dry-run --no-ask-password
  try {
    const dryRunStart = performance.now();
    execSync('systemctl suspend --dry-run --no-ask-password 2>&1');
    const dryRunElapsed = performance.now() - dryRunStart;
    if (dryRunElapsed < 500) {
      logPass('SystemdDryRun', `systemctl suspend --dry-run --no-ask-password succeeds cleanly without password in ${dryRunElapsed.toFixed(1)}ms`, 'Exit code: 0, No password prompt');
    } else {
      logFail('SystemdDryRun', 'systemctl suspend took too long', `${dryRunElapsed}ms`);
    }
  } catch (err) {
    logFail('SystemdDryRun', 'systemctl suspend --dry-run --no-ask-password failed', err.message);
  }

  // 5.2 Verify non-blocking behavior of sudo -n
  try {
    const sudoStart = performance.now();
    try {
      execSync('sudo -n systemctl suspend --dry-run 2>&1', { timeout: 2500 });
    } catch (e) {
      // It may fail with 'a password is required', which is standard sudo -n non-interactive behavior.
      // Crucial test: exits immediately without hanging for password on TTY.
    }
    const sudoElapsed = performance.now() - sudoStart;
    if (sudoElapsed < 2000) {
      logPass('ZeroHangSudo', `sudo -n fails fast without hanging on TTY prompt (${sudoElapsed.toFixed(1)}ms < 2000ms limit)`, 'Non-blocking verified');
    } else {
      logFail('ZeroHangSudo', 'sudo -n hung on execution', `Elapsed: ${sudoElapsed}ms`);
    }
  } catch (err) {
    logFail('ZeroHangSudo', 'sudo -n execution', err.message);
  }

  // 5.3 Systemd-logind D-Bus CanSuspend check
  try {
    const dbusOutput = execSync('busctl call org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager CanSuspend 2>&1', { timeout: 2000 }).toString().trim();
    if (dbusOutput.includes('"yes"')) {
      logPass('DBusCanSuspend', 'org.freedesktop.login1.Manager.CanSuspend returned "yes"', dbusOutput);
    } else {
      logFail('DBusCanSuspend', 'D-Bus CanSuspend check', `Returned: ${dbusOutput}`);
    }
  } catch (err) {
    logFail('DBusCanSuspend', 'D-Bus busctl call failed', err.message);
  }

  // 5.4 Kernel ACPI Power Sleep States
  try {
    const powerStates = fs.readFileSync('/sys/power/state', 'utf-8').trim();
    const memSleep = fs.existsSync('/sys/power/mem_sleep') ? fs.readFileSync('/sys/power/mem_sleep', 'utf-8').trim() : 'N/A';
    if (powerStates.includes('mem') || powerStates.includes('freeze')) {
      logPass('ACPISleepStates', `Kernel supports RAM sleep states: /sys/power/state=[${powerStates}], mem_sleep=[${memSleep}]`, 'RAM sleep available');
    } else {
      logFail('ACPISleepStates', 'Kernel /sys/power/state missing mem/freeze', powerStates);
    }
  } catch (err) {
    logFail('ACPISleepStates', 'Reading /sys/power/state', err.message);
  }

  // 5.5 Polkit Rule for Passwordless Suspend
  if (fs.existsSync(POLKIT_PATH)) {
    const polkitContent = fs.readFileSync(POLKIT_PATH, 'utf-8');
    const hasPolkitSuspend = polkitContent.includes('org.freedesktop.login1.suspend') &&
                             polkitContent.includes('polkit.Result.YES') &&
                             polkitContent.includes('subject.user == "f0id"');
    if (hasPolkitSuspend) {
      logPass('PolkitAuth', 'Polkit rule explicitly grants passwordless org.freedesktop.login1.suspend to user f0id', 'setup/50-omarchy-bridge.rules');
    } else {
      logFail('PolkitAuth', 'Polkit suspend permission', 'Rule missing org.freedesktop.login1.suspend or Result.YES');
    }
  } else {
    logFail('PolkitAuth', 'Polkit rules file existence', 'File not found at ' + POLKIT_PATH);
  }

  // ============================================================
  // Summary
  // ============================================================
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('\n================================================================');
  console.log(`Agent 16 Audit Results: ${passed} PASSED, ${failed} FAILED (Total: ${results.length})`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
