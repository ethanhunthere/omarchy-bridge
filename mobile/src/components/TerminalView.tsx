import React, { useCallback, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/palettes';
import { parseAnsi } from '../lib/ansi';
import { BridgeController } from '../hooks/useBridge';

type Styles = ReturnType<typeof makeStyles>;

// ==========================================
// Line-level memoization + theme-aware pure cache
// ==========================================
const styledLineCache = new Map<string, React.ReactNode>();
const MAX_STYLED_LINE_CACHE = 500;

function renderStyledLine(line: string, styles: Styles): React.ReactNode {
  if (!line || line.trim() === '') {
    return <Text style={styles.textMuted}>{' '}</Text>;
  }

  // 1. Starship prompt line: "~ ❯ cmd" or "❯ cmd"
  if (line.includes(' ❯ ') || line.startsWith('❯ ') || line.startsWith('~ ❯')) {
    const parts = line.split(/(❯)/);
    return (
      <Text>
        <Text style={styles.promptPath}>{parts[0]}</Text>
        <Text style={styles.promptArrow}>❯</Text>
        <Text style={styles.promptCmd}>{parts.slice(2).join('')}</Text>
      </Text>
    );
  }

  // 2. Failed exit code Starship prompt: "~ ✗ cmd"
  if (line.includes(' ✗ ') || line.startsWith('✗ ') || line.startsWith('~ ✗')) {
    const parts = line.split(/(✗)/);
    return (
      <Text>
        <Text style={styles.promptPath}>{parts[0]}</Text>
        <Text style={styles.promptFail}>✗</Text>
        <Text style={styles.promptCmd}>{parts.slice(2).join('')}</Text>
      </Text>
    );
  }

  // 3. Antigravity prompt: ">" or "> "
  if (line.startsWith('>') || line.startsWith(' > ')) {
    return (
      <Text>
        <Text style={styles.promptArrow}>&gt; </Text>
        <Text style={styles.textWhite}>{line.replace(/^>\s*/, '')}</Text>
      </Text>
    );
  }

  // 4. Antigravity logo characters (▄▀)
  if (line.includes('▄▀') || line.includes('▀▀')) {
    return <Text style={styles.logoText}>{line}</Text>;
  }

  // 5. Section dividers (───)
  if (/^[─━\-_=]{3,}$/.test(line.trim())) {
    return <Text style={styles.dividerLine}>{line}</Text>;
  }

  // 6. Errors or failures
  if (/^(error|fatal|fail|exception):/i.test(line.trim()) || line.includes('error:')) {
    return <Text style={styles.textRed}>{line}</Text>;
  }

  // 7. Warnings or notices
  if (/^(warning|notice):/i.test(line.trim())) {
    return <Text style={styles.textAmber}>{line}</Text>;
  }

  // 8. Success / Pass
  if (/^(\[PASS\]|success)/i.test(line.trim())) {
    return <Text style={styles.textGreen}>{line}</Text>;
  }

  // 9. Status bar (e.g. "? for shortcuts ... Gemini")
  if (line.includes('? for shortcuts') || line.includes('Gemini')) {
    return <Text style={styles.statusBarText}>{line}</Text>;
  }

  // 10. Default clean text
  return <Text style={styles.textNormal}>{line}</Text>;
}

function getCachedStyledLine(themeId: string, line: string, styles: Styles): React.ReactNode {
  const key = `${themeId}|${line}`;
  let cached = styledLineCache.get(key);
  if (cached === undefined) {
    if (styledLineCache.size >= MAX_STYLED_LINE_CACHE) {
      let count = 0;
      for (const k of styledLineCache.keys()) {
        styledLineCache.delete(k);
        if (++count >= 100) break;
      }
    }
    cached = renderStyledLine(line, styles);
    styledLineCache.set(key, cached);
  }
  return cached;
}

const MemoizedTerminalLine = React.memo(
  function MemoizedTerminalLine({ line, themeId, styles }: { line: string; themeId: string; styles: Styles }) {
    return (
      <Text style={styles.terminalLine} selectable>
        {getCachedStyledLine(themeId, line, styles)}
      </Text>
    );
  },
  (prev, next) => prev.line === next.line && prev.themeId === next.themeId
);

// ==========================================
// Terminal tab: viewport, keycap ribbon, input bar
// ==========================================
export default function TerminalView({ bridge }: { bridge: BridgeController }) {
  const styles = useThemedStyles(makeStyles);
  const { theme, themeId } = useTheme();
  const {
    screenLines,
    terminalText,
    autoScroll,
    setAutoScroll,
    inputCommand,
    setInputCommand,
    isInputFocused,
    setIsInputFocused,
    handleTerminalPress,
    handleHistoryNav,
    sendCommand,
    sendSignal,
    clearScreen,
    status,
    inputRef,
    scrollViewRef,
    scrollRafRef,
  } = bridge;

  const parsedSegments = useMemo(() => {
    if (screenLines.length > 0 || !terminalText) return [];
    return parseAnsi(terminalText, theme.terminalText, theme.ansi);
  }, [screenLines.length, terminalText, theme]);

  const renderedScreenLines = useMemo(() => {
    return screenLines.map((line, idx) => (
      <MemoizedTerminalLine key={idx} line={line} themeId={themeId} styles={styles} />
    ));
  }, [screenLines, themeId, styles]);

  const renderedParsedSegments = useMemo(() => {
    return parsedSegments.map((seg, idx) => (
      <Text
        key={idx}
        style={{
          color: seg.color || theme.terminalText,
          fontWeight: seg.bold ? '700' : '400',
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        {seg.text}
      </Text>
    ));
  }, [parsedSegments, theme]);

  const onTerminalContentChange = useCallback(() => {
    if (!autoScroll) return;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollViewRef.current?.scrollToEnd({ animated: false });
    });
  }, [autoScroll, scrollRafRef, scrollViewRef]);

  const keycap = (label: string, onPress: () => void, extraStyle?: object, extraTextStyle?: object) => (
    <TouchableOpacity style={[styles.keycap, extraStyle]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={[styles.keycapText, extraTextStyle]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={styles.flexOne}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.flexOne}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.terminalViewport}
          contentContainerStyle={styles.terminalContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onContentSizeChange={onTerminalContentChange}
        >
          <TouchableOpacity activeOpacity={1} onPress={handleTerminalPress} style={styles.touchableTerminal}>
            {screenLines.length === 0 && !terminalText ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyPrompt}>[omarchy-remote ready]</Text>
                <Text style={styles.emptySub}>Tap anywhere to start typing...</Text>
              </View>
            ) : screenLines.length > 0 ? (
              renderedScreenLines
            ) : (
              renderedParsedSegments
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* Keycap ribbon (pinned above the keyboard) */}
        <View style={styles.keycapRibbon}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.ribbonScroll}
            keyboardShouldPersistTaps="handled"
          >
            {keycap('Ctrl+C', () => sendSignal('ctrl_c'), styles.keycapCtrlC, styles.keycapCtrlCText)}
            {keycap('Ctrl+D', () => sendSignal('ctrl_d'), styles.keycapCtrlD, styles.keycapCtrlDText)}
            {keycap('ESC', () => sendSignal('esc'))}
            {keycap('TAB', () => sendSignal('tab'))}
            {keycap('▲', () => handleHistoryNav('up'))}
            {keycap('▼', () => handleHistoryNav('down'))}
            {keycap('Enter ↵', () => sendSignal('enter'), styles.keycapEnter, styles.keycapEnterText)}
            {keycap('agy', () => {
              setInputCommand('agy');
              inputRef.current?.focus();
            }, styles.keycapTool, styles.keycapToolText)}
            {keycap('clear', clearScreen)}
            {keycap(autoScroll ? 'SCROLL: ON' : 'SCROLL: FREE', () => setAutoScroll((p) => !p), autoScroll ? styles.keycapAutoScroll : undefined)}
          </ScrollView>
        </View>

        {/* Floating input bar */}
        <View style={[styles.inputBar, isInputFocused && styles.inputBarFocused]}>
          <Text style={[styles.promptChar, isInputFocused && styles.promptCharFocused]}>❯</Text>
          <TextInput
            ref={inputRef}
            style={[styles.inputField, isInputFocused && styles.inputFieldFocused]}
            value={inputCommand}
            onChangeText={setInputCommand}
            onFocus={() => {
              setIsInputFocused(true);
              if (autoScroll) {
                setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 150);
              }
            }}
            onBlur={() => setIsInputFocused(false)}
            placeholder="Type command or prompt..."
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardAppearance="dark"
            returnKeyType="send"
            onSubmitEditing={() => sendCommand()}
            textContentType="none"
            autoComplete="off"
          />
          {inputCommand.length > 0 && (
            <TouchableOpacity
              style={styles.clearInputBtn}
              onPress={() => setInputCommand('')}
              accessibilityRole="button"
              accessibilityLabel="Clear input"
            >
              <Text style={styles.clearInputText}>✕</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.sendBtn, status === 'connected' ? styles.sendBtnActive : styles.sendBtnDisabled]}
            onPress={() => sendCommand()}
            accessibilityRole="button"
            accessibilityLabel={inputCommand.trim() ? 'Send command' : 'Send enter'}
          >
            <Text style={[styles.sendBtnText, status !== 'connected' && styles.sendBtnTextDisabled]}>
              {inputCommand.trim() ? 'SEND' : '↵'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: ThemeTokens) =>
  ({
    flexOne: {
      flex: 1,
    },
    terminalViewport: {
      flex: 1,
      backgroundColor: t.bg,
      paddingHorizontal: 8,
    },
    terminalContent: {
      flexGrow: 1,
      paddingTop: 8,
      paddingBottom: 24,
    },
    touchableTerminal: {
      flex: 1,
      minHeight: '100%',
    },
    terminalLine: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13.5,
      lineHeight: 20,
      color: t.terminalText,
      letterSpacing: 0.2,
    },
    promptPath: {
      color: t.promptPath,
      fontWeight: '700',
    },
    promptArrow: {
      color: t.promptArrow,
      fontWeight: '800',
    },
    promptFail: {
      color: t.promptFail,
      fontWeight: '800',
    },
    promptCmd: {
      color: t.textPrimary,
      fontWeight: '600',
    },
    textWhite: {
      color: t.textPrimary,
    },
    textNormal: {
      color: t.terminalText,
    },
    textMuted: {
      color: t.textMuted,
    },
    textRed: {
      color: t.danger,
    },
    textAmber: {
      color: t.warning,
    },
    textGreen: {
      color: t.success,
    },
    logoText: {
      color: t.logo,
      fontWeight: '700',
    },
    dividerLine: {
      color: t.divider,
    },
    statusBarText: {
      color: t.textSecondary,
      fontSize: 11,
    },
    emptyContainer: {
      paddingVertical: 50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyPrompt: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      color: t.textMuted,
      fontWeight: '700',
    },
    emptySub: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      color: t.textMuted,
      marginTop: 6,
    },

    // Keycap ribbon
    keycapRibbon: {
      backgroundColor: t.surface,
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingVertical: 6,
    },
    ribbonScroll: {
      paddingHorizontal: 8,
      gap: 6,
      flexDirection: 'row',
      alignItems: 'center',
    },
    keycap: {
      backgroundColor: t.surfaceElevated,
      paddingHorizontal: 10,
      paddingVertical: 10,
      minHeight: 44,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: t.borderStrong,
      minWidth: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keycapText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '600',
      color: t.keycapText,
    },
    keycapCtrlC: {
      borderColor: t.dangerBorder,
    },
    keycapCtrlCText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '700',
      color: t.danger,
    },
    keycapCtrlD: {
      borderColor: t.borderStrong,
    },
    keycapCtrlDText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '700',
      color: t.warning,
    },
    keycapEnter: {
      borderColor: t.successBorder,
    },
    keycapEnterText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '700',
      color: t.success,
    },
    keycapTool: {
      borderColor: t.borderStrong,
    },
    keycapToolText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '700',
      color: t.textSecondary,
    },
    keycapAutoScroll: {
      borderColor: t.focus,
    },

    // Input bar
    inputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surface,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: t.border,
      gap: 8,
    },
    inputBarFocused: {
      backgroundColor: t.surfaceElevated,
      borderTopColor: t.focus,
    },
    promptChar: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 15,
      fontWeight: '800',
      color: t.textMuted,
    },
    promptCharFocused: {
      color: t.success,
    },
    inputField: {
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      color: t.textPrimary,
      backgroundColor: t.inputBg,
      paddingHorizontal: 12,
      paddingVertical: 9,
      minHeight: 42,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.borderStrong,
    },
    inputFieldFocused: {
      borderColor: t.focus,
    },
    clearInputBtn: {
      paddingHorizontal: 10,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
    },
    clearInputText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      color: t.textMuted,
      fontWeight: '700',
    },
    sendBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: 6,
    },
    sendBtnActive: {
      backgroundColor: t.accent,
    },
    sendBtnDisabled: {
      backgroundColor: t.surfaceElevated,
      borderWidth: 1,
      borderColor: t.borderStrong,
    },
    sendBtnText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      fontWeight: '800',
      color: t.accentText,
    },
    sendBtnTextDisabled: {
      color: t.textMuted,
    },
  }) as const;
