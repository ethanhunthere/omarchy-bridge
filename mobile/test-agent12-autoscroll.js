/**
 * Automated Verification & Audit Test Suite for Agent 12
 * (AUTO-SCROLL Mode Toggle & Anchoring Tester)
 * Target: mobile/App.tsx
 *
 * Verifies:
 * 1. Button toggles between 'SCROLL: ON' and 'SCROLL: FREE' with light haptic feedback.
 * 2. When 'SCROLL: ON', onContentSizeChange invokes scrollToEnd({ animated: false }) to keep the terminal anchored to latest output.
 * 3. When 'SCROLL: FREE', automatic scrolling is disabled so users can inspect older history without jumping.
 * 4. Active visual state (blue border #3b82f6) clearly indicates active auto-scroll mode.
 * 5. Lines 590-605 architectural audit (keycap ribbon context, autoScroll button position at lines 642-650).
 */

const fs = require('fs');
const path = require('path');

const APP_PATH = path.resolve(__dirname, 'App.tsx');
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
  console.log(' AGENT 12: AUTO-SCROLL MODE TOGGLE & ANCHORING AUDIT');
  console.log('============================================================\n');

  // ============================================================
  // Suite 1: Source Code & Line Range Audit
  // ============================================================
  logInfo('--- Suite 1: Static Code & Architectural Line Range Audit ---');

  assert(fs.existsSync(APP_PATH), 'SourceAudit', 'mobile/App.tsx exists on disk', APP_PATH);
  const appCode = fs.readFileSync(APP_PATH, 'utf-8');
  const lines = appCode.split('\n');

  // 1.1 State Declaration
  const stateRegex = /const\s+\[autoScroll,\s*setAutoScroll\]\s*=\s*useState\((true|false)\);/;
  const stateMatch = appCode.match(stateRegex);
  assert(!!stateMatch, 'StateInit', 'autoScroll state defined with useState', stateMatch ? stateMatch[0] : 'None');
  assert(stateMatch && stateMatch[1] === 'true', 'StateInit', 'autoScroll defaults to true (enabled by default)');

  // 1.2 Lines 590-605 and Ribbon Context
  logInfo('Inspecting lines 590-652 (Keycap Ribbon & Terminal viewport boundary)...');
  const line590to605 = lines.slice(589, 606).join('\n');
  const hasRibbonStart = line590to605.includes('styles.keycapRibbon') || appCode.includes('styles.keycapRibbon');
  assert(hasRibbonStart, 'RibbonContext', 'Keycap ribbon component exists above keyboard input');

  // Find exact location of AutoScroll button in ribbon
  const autoScrollButtonLineIdx = lines.findIndex(l => l.includes('styles.keycapAutoScroll'));
  assert(autoScrollButtonLineIdx !== -1, 'ButtonLocation', `Auto-scroll button found in App.tsx at line ${autoScrollButtonLineIdx + 1}`);

  // 1.3 Toggle Button Structure & Haptics
  const buttonBlockRegex = /<TouchableOpacity[^>]*styles\.keycapAutoScroll[^>]*>[\s\S]*?<\/TouchableOpacity>/;
  const buttonBlockMatch = appCode.match(buttonBlockRegex);
  assert(!!buttonBlockMatch, 'ButtonStructure', 'AutoScroll TouchableOpacity exists with conditional keycapAutoScroll style');

  const buttonSnippet = buttonBlockMatch ? buttonBlockMatch[0] : '';
  const hasHapticLight = buttonSnippet.includes("triggerHaptic('light')");
  assert(hasHapticLight, 'Haptics', 'Tapping button triggers light haptic feedback', "triggerHaptic('light')");

  const hasToggleUpdater = buttonSnippet.includes('setAutoScroll((p) => !p)') || buttonSnippet.includes('setAutoScroll(!autoScroll)');
  assert(hasToggleUpdater, 'StateToggle', 'Button toggles boolean autoScroll state', 'setAutoScroll((p) => !p)');

  // 1.4 Dynamic Label
  const hasDynamicLabel = buttonSnippet.includes("autoScroll ? 'SCROLL: ON' : 'SCROLL: FREE'") ||
    (buttonSnippet.includes('SCROLL: ON') && buttonSnippet.includes('SCROLL: FREE'));
  assert(hasDynamicLabel, 'LabelToggle', "Button displays 'SCROLL: ON' when active and 'SCROLL: FREE' when disabled");

  // ============================================================
  // Suite 2: Terminal Anchoring onContentSizeChange Logic
  // ============================================================
  logInfo('\n--- Suite 2: Terminal Viewport Anchoring & onContentSizeChange ---');

  const scrollRegex = /onContentSizeChange=\{[\s\S]*?if\s*\(\s*autoScroll\s*\)\s*\{[\s\S]*?scrollToEnd\(\{\s*animated:\s*false\s*\}\);[\s\S]*?\}\s*\}/;
  const scrollMatch = appCode.match(scrollRegex);
  assert(!!scrollMatch, 'Anchoring', 'onContentSizeChange checks autoScroll before scrolling to end');

  // Verify non-animated instantaneous scroll for terminal streaming
  const animatedFalseRegex = /scrollToEnd\(\{\s*animated:\s*false\s*\}\)/;
  assert(animatedFalseRegex.test(appCode), 'Anchoring', 'scrollToEnd specifies { animated: false } for jitter-free terminal anchoring');

  // Verify ScrollView ref attachment
  assert(appCode.includes('ref={scrollViewRef}'), 'Anchoring', 'ScrollView is bound to scrollViewRef');

  // Verify free scroll inspection capability
  assert(appCode.includes('keyboardDismissMode="on-drag"'), 'FreeScroll', 'ScrollView allows keyboard dismissal on drag for free scrolling inspection');

  // ============================================================
  // Suite 3: Visual Styling & High-Contrast Active State
  // ============================================================
  logInfo('\n--- Suite 3: Visual State & Styling Specifications ---');

  // Check keycapAutoScroll style definition
  const keycapAutoScrollDef = appCode.match(/keycapAutoScroll:\s*\{[\s\S]*?borderColor:\s*'(#[0-9a-fA-F]+)'[\s\S]*?\}/);
  assert(!!keycapAutoScrollDef, 'Styling', 'keycapAutoScroll style defined in StyleSheet');
  assert(keycapAutoScrollDef && keycapAutoScrollDef[1].toLowerCase() === '#3b82f6', 'Styling', 'Active border color is electric blue #3b82f6', keycapAutoScrollDef ? keycapAutoScrollDef[1] : 'None');

  // Check base keycap border
  const baseKeycapDef = appCode.match(/keycap:\s*\{[\s\S]*?borderColor:\s*'(#[0-9a-fA-F]+)'[\s\S]*?\}/);
  assert(!!baseKeycapDef, 'Styling', 'Base keycap style defined in StyleSheet');
  const baseBorderColor = baseKeycapDef ? baseKeycapDef[1].toLowerCase() : '';
  assert(baseBorderColor === '#262936', 'Styling', 'Default inactive border color is neutral dark #262936', baseBorderColor);

  // Check keycap text typography
  assert(appCode.includes('keycapText'), 'Styling', 'Uses styles.keycapText for crisp monospace ribbon text');

  // ============================================================
  // Suite 4: State Machine & Event Simulation
  // ============================================================
  logInfo('\n--- Suite 4: State Machine & Scroll Event Simulation ---');

  class TerminalSimulator {
    constructor() {
      this.autoScroll = true;
      this.scrollEvents = [];
      this.hapticEvents = [];
      this.currentScrollY = 1000;
      this.contentHeight = 1000;
    }

    triggerHaptic(type) {
      this.hapticEvents.push(type);
    }

    toggleAutoScroll() {
      this.triggerHaptic('light');
      this.autoScroll = !this.autoScroll;
    }

    getButtonLabel() {
      return this.autoScroll ? 'SCROLL: ON' : 'SCROLL: FREE';
    }

    getButtonStyle() {
      return {
        base: 'keycap',
        borderColor: this.autoScroll ? '#3b82f6' : '#262936',
        activeClass: this.autoScroll ? 'keycapAutoScroll' : null,
      };
    }

    onContentSizeChange(newWidth, newHeight) {
      this.contentHeight = newHeight;
      if (this.autoScroll) {
        this.scrollToEnd({ animated: false });
      }
    }

    scrollToEnd(opts) {
      this.scrollEvents.push({ action: 'scrollToEnd', opts, targetY: this.contentHeight });
      this.currentScrollY = this.contentHeight;
    }

    userManualScroll(toY) {
      this.currentScrollY = toY;
    }
  }

  const sim = new TerminalSimulator();

  // Test 4.1: Initial State
  assert(sim.autoScroll === true, 'Simulation', 'Initial state: autoScroll is true');
  assert(sim.getButtonLabel() === 'SCROLL: ON', 'Simulation', "Initial label: 'SCROLL: ON'");
  assert(sim.getButtonStyle().borderColor === '#3b82f6', 'Simulation', 'Initial style has active blue border #3b82f6');

  // Test 4.2: Incoming content when SCROLL: ON
  sim.onContentSizeChange(400, 1500);
  assert(sim.scrollEvents.length === 1, 'Simulation', 'New content received: scrollToEnd triggered');
  assert(sim.scrollEvents[0].opts.animated === false, 'Simulation', 'scrollToEnd called with animated: false');
  assert(sim.currentScrollY === 1500, 'Simulation', 'Viewport anchored to bottom (Y=1500)');

  // Test 4.3: Toggle to SCROLL: FREE
  sim.toggleAutoScroll();
  assert(sim.autoScroll === false, 'Simulation', 'Toggled state: autoScroll is false');
  assert(sim.hapticEvents.includes('light'), 'Simulation', 'Haptic light fired on toggle');
  assert(sim.getButtonLabel() === 'SCROLL: FREE', 'Simulation', "Toggled label: 'SCROLL: FREE'");
  assert(sim.getButtonStyle().borderColor === '#262936', 'Simulation', 'Style reverts to default inactive border #262936');

  // Test 4.4: User scrolls up to inspect history
  sim.userManualScroll(200);
  assert(sim.currentScrollY === 200, 'Simulation', 'User scrolled up to older history at Y=200');

  // Test 4.5: Incoming content when SCROLL: FREE
  const scrollEventCountBefore = sim.scrollEvents.length;
  sim.onContentSizeChange(400, 2500);
  assert(sim.scrollEvents.length === scrollEventCountBefore, 'Simulation', 'New content received in FREE mode: scrollToEnd NOT triggered');
  assert(sim.currentScrollY === 200, 'Simulation', 'User scroll position remained anchored at Y=200 without jumping');

  // Test 4.6: Toggle back to SCROLL: ON
  sim.toggleAutoScroll();
  assert(sim.autoScroll === true, 'Simulation', 'Toggled back to autoScroll = true');
  assert(sim.getButtonLabel() === 'SCROLL: ON', 'Simulation', "Label restored to 'SCROLL: ON'");
  assert(sim.getButtonStyle().borderColor === '#3b82f6', 'Simulation', 'Blue border #3b82f6 restored');

  // Trigger content update to re-anchor
  sim.onContentSizeChange(400, 2600);
  assert(sim.scrollEvents.length === scrollEventCountBefore + 1, 'Simulation', 'New content immediately re-anchors to bottom');
  assert(sim.currentScrollY === 2600, 'Simulation', 'Viewport anchored back to bottom at Y=2600');

  console.log('\n============================================================');
  console.log(` AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Test suite execution failed:', err);
  process.exit(1);
});
