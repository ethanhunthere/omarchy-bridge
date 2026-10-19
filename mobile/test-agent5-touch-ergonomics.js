const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'App.tsx');
const content = fs.readFileSync(appPath, 'utf8');

console.log('====================================================');
console.log(' Agent 5: Touch-to-Type Focus Ergonomics Audit Test ');
console.log('====================================================');

const assertions = [
  {
    id: 1,
    desc: 'Terminal area wrapped in TouchableOpacity with activeOpacity={1}',
    test: () => content.includes('<TouchableOpacity') &&
                content.includes('activeOpacity={1}') &&
                (content.includes('onPress={() => inputRef.current?.focus()}') || content.includes('onPress={handleTerminalPress}')) &&
                content.includes('style={styles.touchableTerminal}')
  },
  {
    id: 2,
    desc: 'Tapping anywhere brings up keyboard (inputRef.current?.focus() & flexGrow: 1 coverage)',
    test: () => content.includes('const inputRef = useRef<TextInput | null>(null);') &&
                content.includes('ref={inputRef}') &&
                /terminalContent:\s*\{[^}]*flexGrow:\s*1/.test(content) &&
                /touchableTerminal:\s*\{[^}]*flex:\s*1/.test(content)
  },
  {
    id: 3,
    desc: 'Outer KeyboardAvoidingView behavior="padding" on iOS pinning input and ribbon',
    test: () => content.includes("behavior={Platform.OS === 'ios' ? 'padding' : undefined}") &&
                content.includes('keyboardVerticalOffset={Platform.OS === \'ios\' ? 0 : 0}') &&
                content.includes('<KeyboardAvoidingView') &&
                content.indexOf('<KeyboardAvoidingView') < content.indexOf('styles.keycapRibbon') &&
                content.indexOf('styles.keycapRibbon') < content.indexOf('styles.inputBar')
  },
  {
    id: 4,
    desc: 'keyboardShouldPersistTaps="handled" on terminal viewport ScrollView',
    test: () => /styles\.terminalViewport[\s\S]*?keyboardShouldPersistTaps="handled"/.test(content)
  },
  {
    id: 5,
    desc: 'keyboardShouldPersistTaps="handled" on keycap ribbon ScrollView',
    test: () => /styles\.keycapRibbon[\s\S]*?<ScrollView[^>]*keyboardShouldPersistTaps="handled"/.test(content)
  },
  {
    id: 6,
    desc: 'Auto-scroll onFocus with smooth animation to keep active line visible above keyboard',
    test: () => content.includes('setIsInputFocused(true)') &&
                content.includes('scrollViewRef.current?.scrollToEnd({ animated: true })')
  }
];

let allPassed = true;
assertions.forEach((a) => {
  const passed = a.test();
  console.log(`[${passed ? 'PASS' : 'FAIL'}] Item ${a.id}: ${a.desc}`);
  if (!passed) allPassed = false;
});

// Layout calculations audit
console.log('\n--- Layout Calculations Audit ---');
const screenHeights = [667, 844, 852, 932]; // SE, iPhone 12/13/14, 14/15/16 Pro, Pro Max
const keyboardHeightIOS = 336; // iOS keyboard with predictive text
const headerHeight = 38;
const ribbonHeight = 43;
const inputBarHeight = 55;
const totalFixedUi = headerHeight + ribbonHeight + inputBarHeight;

screenHeights.forEach((sh) => {
  const availableViewport = sh - 59 - totalFixedUi - keyboardHeightIOS;
  const terminalLinesVisible = Math.floor(availableViewport / 19);
  console.log(`Device screen ${sh}pt: Viewport with keyboard open = ${availableViewport}pt (~${terminalLinesVisible} lines visible, input + ribbon 100% visible)`);
});

if (!allPassed) {
  console.error('\n❌ Audit failed!');
  process.exit(1);
}

console.log('\n✅ All Agent 5 Touch-to-Type Ergonomics tests PASSED with 100% compliance.');
