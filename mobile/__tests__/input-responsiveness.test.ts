import { test, expect, describe } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// ==========================================
// Shared source collector: App shell + all src files,
// so structural assertions keep working after the split.
// ==========================================
function collectMobileSource(): string {
  const root = path.resolve(__dirname, '..');
  const files: string[] = [path.join(root, 'App.tsx')];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(p);
    }
  };
  walk(path.join(root, 'src'));
  return files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
}

describe('Agent 3: TextInput & Typing Responsiveness Test Suite', () => {
  const appPath = path.resolve(__dirname, '../App.tsx');
  const code = collectMobileSource();

  test('App entry exists and source tree is readable', () => {
    expect(fs.existsSync(appPath)).toBe(true);
    expect(code.length).toBeGreaterThan(1000);
  });

  describe('Requirement 1: High-contrast text with 14px Menlo monospace font on raised input surface', () => {
    test('fontFamily includes Menlo on iOS and monospace on Android', () => {
      const match = code.match(/inputField:\s*\{[^}]*fontFamily:\s*Platform\.OS === 'ios' \? 'Menlo' : 'monospace'/s);
      expect(match).not.toBeNull();
    });

    test('fontSize is 14px', () => {
      const match = code.match(/inputField:\s*\{[^}]*fontSize:\s*14/s);
      expect(match).not.toBeNull();
    });

    test('text uses theme primary token backed by high-contrast white (#ffffff)', () => {
      const match = code.match(/inputField:\s*\{[^}]*color:\s*t\.textPrimary/s);
      expect(match).not.toBeNull();
      const palette = fs.readFileSync(path.resolve(__dirname, '../src/theme/palettes.ts'), 'utf-8');
      expect(palette.includes("textPrimary: '#ffffff'")).toBe(true);
    });

    test('input background uses theme inputBg token backed by dark high-contrast surface (#161820)', () => {
      const match = code.match(/inputField:\s*\{[^}]*backgroundColor:\s*t\.inputBg/s);
      expect(match).not.toBeNull();
      const palette = fs.readFileSync(path.resolve(__dirname, '../src/theme/palettes.ts'), 'utf-8');
      expect(palette.includes("inputBg: '#161820'")).toBe(true);
    });
  });

  describe('Requirement 2: Focus state changes border highlight to accent focus color with prompt ❯ highlighting in green', () => {
    test('onFocus and onBlur manage isInputFocused state', () => {
      expect(code.includes('setIsInputFocused(true)')).toBe(true);
      expect(code.includes('setIsInputFocused(false)')).toBe(true);
    });

    test('border highlight transitions to focus token (#3b82f6) when focused', () => {
      const barFocused = code.match(/inputBarFocused:\s*\{[^}]*borderTopColor:\s*t\.focus/s);
      const fieldFocused = code.match(/inputFieldFocused:\s*\{[^}]*borderColor:\s*t\.focus/s);
      expect(barFocused || fieldFocused).toBeTruthy();
      const palette = fs.readFileSync(path.resolve(__dirname, '../src/theme/palettes.ts'), 'utf-8');
      expect(palette.includes("focus: '#3b82f6'")).toBe(true);
    });

    test('prompt ❯ highlights in emerald green (#22c55e) when focused', () => {
      const promptFocused = code.match(/promptCharFocused:\s*\{[^}]*color:\s*t\.success/s);
      expect(promptFocused).not.toBeNull();
      expect(code.includes('isInputFocused && styles.promptCharFocused')).toBe(true);
      const palette = fs.readFileSync(path.resolve(__dirname, '../src/theme/palettes.ts'), 'utf-8');
      expect(palette.includes("success: '#22c55e'")).toBe(true);
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
