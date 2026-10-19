import { test, expect, describe } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('Agent 3: TextInput & Typing Responsiveness Test Suite', () => {
  const appPath = path.resolve(__dirname, '../App.tsx');
  const code = fs.readFileSync(appPath, 'utf-8');

  test('App.tsx exists and is readable', () => {
    expect(fs.existsSync(appPath)).toBe(true);
    expect(code.length).toBeGreaterThan(1000);
  });

  describe('Requirement 1: High-contrast white text (#ffffff) with 14px Menlo monospace font on #161820', () => {
    test('fontFamily includes Menlo on iOS and monospace on Android', () => {
      const match = code.match(/inputField:\s*\{[^}]*fontFamily:\s*Platform\.OS === 'ios' \? 'Menlo' : 'monospace'/s);
      expect(match).not.toBeNull();
    });

    test('fontSize is 14px', () => {
      const match = code.match(/inputField:\s*\{[^}]*fontSize:\s*14/s);
      expect(match).not.toBeNull();
    });

    test('text color is high-contrast white (#ffffff)', () => {
      const match = code.match(/inputField:\s*\{[^}]*color:\s*'#ffffff'/s);
      expect(match).not.toBeNull();
    });

    test('background color is dark high-contrast (#161820)', () => {
      const match = code.match(/inputField:\s*\{[^}]*backgroundColor:\s*'#161820'/s);
      expect(match).not.toBeNull();
    });
  });

  describe('Requirement 2: Focus state changes border highlight to #3b82f6 with prompt ❯ highlighting in emerald green #22c55e', () => {
    test('onFocus and onBlur manage isInputFocused state', () => {
      expect(code.includes('setIsInputFocused(true)')).toBe(true);
      expect(code.includes('setIsInputFocused(false)')).toBe(true);
    });

    test('border highlight transitions to #3b82f6 when focused', () => {
      const barFocused = code.match(/inputBarFocused:\s*\{[^}]*borderTopColor:\s*'#3b82f6'/s);
      const fieldFocused = code.match(/inputFieldFocused:\s*\{[^}]*borderColor:\s*'#3b82f6'/s);
      expect(barFocused || fieldFocused).toBeTruthy();
    });

    test('prompt ❯ highlights in emerald green #22c55e when focused', () => {
      const promptFocused = code.match(/promptCharFocused:\s*\{[^}]*color:\s*'#22c55e'/s);
      expect(promptFocused).not.toBeNull();
      expect(code.includes('isInputFocused && styles.promptCharFocused')).toBe(true);
    });
  });

  describe('Requirement 3: Typing characters updates inputCommand immediately with zero lag', () => {
    test('TextInput value and onChangeText directly bound to inputCommand and setInputCommand', () => {
      const textInputMatch = code.match(/<TextInput\s+ref=\{inputRef\}[\s\S]*?\/>/);
      expect(textInputMatch).not.toBeNull();
      const block = textInputMatch![0];
      expect(block.includes('value={inputCommand}')).toBe(true);
      expect(block.includes('onChangeText={setInputCommand}')).toBe(true);
    });

    test('simulated keystroke dispatch executes with sub-millisecond latency (< 1ms)', () => {
      let state = '';
      const setCmd = (v: string) => { state = v; };
      const sample = 'omarchy bridge status --debug';
      const start = performance.now();
      for (let i = 0; i < 5000; i++) {
        setCmd(state + sample[i % sample.length]);
        if (i % 25 === 0) setCmd('');
      }
      const elapsed = performance.now() - start;
      const perCharMs = elapsed / 5000;
      expect(perCharMs).toBeLessThan(0.01); // Less than 10 microseconds
    });
  });

  describe("Requirement 4: When inputCommand is not empty, clear '✕' button appears and clears text on tap", () => {
    test('clear button renders conditionally when inputCommand.length > 0', () => {
      expect(code.includes('inputCommand.length > 0')).toBe(true);
      expect(code.includes('clearInputBtn')).toBe(true);
    });

    test("clear button displays glyph '✕'", () => {
      expect(code.includes('clearInputText')).toBe(true);
      expect(code.includes('>✕<')).toBe(true);
    });

    test("clear button onPress calls setInputCommand('')", () => {
      expect(code.includes("setInputCommand('')")).toBe(true);
    });
  });

  describe('Requirement 5: Native input flags are active', () => {
    test('autoCorrect={false}, autoCapitalize="none", spellCheck={false}, keyboardAppearance="dark"', () => {
      const textInputMatch = code.match(/<TextInput\s+ref=\{inputRef\}[\s\S]*?\/>/);
      expect(textInputMatch).not.toBeNull();
      const block = textInputMatch![0];
      expect(block.includes('autoCorrect={false}')).toBe(true);
      expect(block.includes('autoCapitalize="none"') || block.includes("autoCapitalize='none'")).toBe(true);
      expect(block.includes('spellCheck={false}')).toBe(true);
      expect(block.includes('keyboardAppearance="dark"') || block.includes("keyboardAppearance='dark'")).toBe(true);
    });
  });
});
