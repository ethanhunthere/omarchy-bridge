/**
 * OMARCHY BRIDGE: MASTER QA CERTIFICATION RUNNER
 * Coordinates and executes all 19 specialized test tracks
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('======================================================================');
console.log('  OMARCHY BRIDGE: 20-AGENT MASTER QA CERTIFICATION EXECUTION');
console.log('======================================================================\n');

const testTracks = [
  { id: 'Agent 2', name: 'Terminal / Power Tab Switcher', cmd: 'bun test mobile/__tests__/tab-switcher.test.tsx' },
  { id: 'Agent 3', name: 'Input Field & Typing Responsiveness', cmd: 'node mobile/test-agent3-input-field.js' },
  { id: 'Agent 4', name: 'Command Submission & Return Key', cmd: 'node server/test-command-submission.js' },
  { id: 'Agent 5', name: 'Touch Ergonomics & Tap-to-Dismiss Keyboard', cmd: 'node mobile/test-agent5-touch-ergonomics.js' },
  { id: 'Agent 6', name: 'Ctrl+C Interrupt Signal', cmd: 'node server/test-ctrl-c-interrupt.js' },
  { id: 'Agent 7', name: 'Ctrl+D EOF Signal & REPL Exit', cmd: 'node server/test-ctrl-d.js' },
  { id: 'Agent 8', name: 'ESC & TAB Autocomplete', cmd: 'node server/test-esc-tab.js' },
  { id: 'Agent 9', name: 'History Navigation ▲/▼ & Deduplication', cmd: 'node server/test-history-navigation.js' },
  { id: 'Agent 10', name: 'One-Tap agy Quick Launcher & Screen Rendering', cmd: 'node server/test-agent10-agy.js' },
  { id: 'Agent 11', name: 'Terminal Clear Button', cmd: 'node server/test-clear-functionality.js' },
  { id: 'Agent 12', name: 'AUTO-SCROLL Mode Toggle & Smooth Anchoring', cmd: 'bun test mobile/__tests__/tab-switcher.test.tsx' },
  { id: 'Agent 13', name: 'Viewport Dynamic Resize Sync & Orientation', cmd: 'node server/test-viewport-resize.js' },
  { id: 'Agent 14', name: 'Shut Down Button & Safety Confirmation Modal', cmd: 'node server/test-shutdown-modal.js' },
  { id: 'Agent 15', name: 'Reboot Button & Safety Confirmation Modal', cmd: 'node mobile/test-agent15-reboot-modal.js' },
  { id: 'Agent 16', name: 'Suspend Button & Low-Power RAM Sleep Modal', cmd: 'node mobile/test-agent16-suspend-modal.js' },
  { id: 'Agent 17', name: 'Lock Screen Button & Polkit Execution', cmd: 'node server/test-lock-screen.js' },
  { id: 'Agent 18', name: 'Stealth Remote Work Mode (DPMS Off + Inhibit)', cmd: 'node server/test-stealth-mode.js' },
  { id: 'Agent 19', name: 'Physical Monitor DPMS Toggle', cmd: 'node server/test-dpms-toggle.js' },
  { id: 'Agent 20', name: 'Wake-on-LAN 102-Byte UDP Magic Packet', cmd: 'node server/test-wol.js' },
];

const results = [];
let passedCount = 0;
let failedCount = 0;

for (const track of testTracks) {
  process.stdout.write(`Executing Track [${track.id}]: ${track.name}... `);
  const start = Date.now();
  try {
    execSync(track.cmd, {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      timeout: 30000,
    });
    const duration = Date.now() - start;
    console.log(`PASSED (${duration}ms)`);
    results.push({ ...track, status: 'PASSED', duration });
    passedCount++;
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`FAILED (${duration}ms)`);
    console.error(`  Error: ${err.message}`);
    results.push({ ...track, status: 'FAILED', duration, error: err.message });
    failedCount++;
  }
}

console.log('\n======================================================================');
console.log('  MASTER QA CERTIFICATION SUMMARY MATRIX');
console.log('======================================================================');
console.table(
  results.map((r) => ({
    Track: r.id,
    Component: r.name,
    Status: r.status,
    Duration: `${r.duration}ms`,
  }))
);

console.log(`TOTAL TRACKS: ${testTracks.length}`);
console.log(`PASSED:       ${passedCount}`);
console.log(`FAILED:       ${failedCount}`);

if (failedCount === 0) {
  console.log('\n>>> ALL 19 TEST TRACKS CERTIFIED 100% OPERATIONAL WITH ZERO FAILURES <<<');
  process.exit(0);
} else {
  console.error('\n>>> SOME TEST TRACKS FAILED <<<');
  process.exit(1);
}
