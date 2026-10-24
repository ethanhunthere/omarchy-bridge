import React, { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/palettes';
import { parseAnsi, StyledSegment } from '../lib/ansi';
import { BridgeController, ConnectionStatus } from '../hooks/useBridge';

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

const TerminalLine = memo(function TerminalLine({
  line,
  themeId,
  styles,
}: {
  line: string;
  themeId: string;
  styles: Styles;
}) {
  return (
    <Text style={styles.terminalLine} selectable allowFontScaling={false}>
      {getCachedStyledLine(themeId, line, styles)}
    </Text>
  );
});

// ==========================================
// Terminal body — memoized so typing never re-renders the output.
// ==========================================
const TerminalBody = memo(function TerminalBody({
  screenLines,
  terminalText,
  autoScroll,
  onPress,
  onContentSizeChange,
  scrollViewRef,
}: {
  screenLines: string[];
  terminalText: string;
  autoScroll: boolean;
  onPress: () => void;
  onContentSizeChange: () => void;
  scrollViewRef: React.RefObject<ScrollView | null>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { theme, themeId } = useTheme();

  const parsedSegments: StyledSegment[] = useMemo(() => {
    if (screenLines.length > 0 || !terminalText) return [];
    return parseAnsi(terminalText, theme.terminalText, theme.ansi);
  }, [screenLines.length, terminalText, theme]);

  const renderedScreenLines = useMemo(
    () => screenLines.map((line, idx) => <TerminalLine key={idx} line={line} themeId={themeId} styles={styles} />),
    [screenLines, themeId, styles]
  );

  const renderedParsedSegments = useMemo(
    () =>
      parsedSegments.map((seg, idx) => (
        <Text
          key={idx}
          allowFontScaling={false}
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
      )),
    [parsedSegments, theme]
  );

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.terminalViewport}
      contentContainerStyle={styles.terminalContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      onContentSizeChange={() => {
        if (autoScroll) onContentSizeChange();
      }}
    >
      <TouchableOpacity activeOpacity={1} onPress={onPress} style={styles.touchableTerminal}>
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
  );
});

// ==========================================
// Keycap ribbon — memoized: never re-renders while typing.
// ==========================================
const KeycapRibbon = memo(function KeycapRibbon({
  autoScroll,
  onToggleAutoScroll,
  onSignal,
  onHistory,
  onClear,
  onPrefill,
}: {
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onSignal: (signal: string) => void;
  onHistory: (direction: 'up' | 'down') => void;
  onClear: () => void;
  onPrefill: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const keycap = (label: string, onPress: () => void, extraStyle?: object, extraTextStyle?: object) => (
    <TouchableOpacity
      style={[styles.keycap, extraStyle]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.keycapText, extraTextStyle]} allowFontScaling={false}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.keycapRibbon}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.ribbonScroll}
        keyboardShouldPersistTaps="handled"
      >
        {keycap('Ctrl+C', () => onSignal('ctrl_c'), styles.keycapCtrlC, styles.keycapCtrlCText)}
        {keycap('Ctrl+D', () => onSignal('ctrl_d'), styles.keycapCtrlD, styles.keycapCtrlDText)}
        {keycap('ESC', () => onSignal('esc'))}
        {keycap('TAB', () => onSignal('tab'))}
        {keycap('▲', () => onHistory('up'))}
        {keycap('▼', () => onHistory('down'))}
        {keycap('Enter ↵', () => onSignal('enter'), styles.keycapEnter, styles.keycapEnterText)}
        {keycap('agy', onPrefill, styles.keycapTool, styles.keycapToolText)}
        {keycap('clear', onClear)}
        {keycap(autoScroll ? 'SCROLL: ON' : 'SCROLL: FREE', onToggleAutoScroll, autoScroll ? styles.keycapAutoScroll : undefined)}
      </ScrollView>
    </View>
  );
});

// ==========================================
// Input bar — owns its own text state: keystrokes re-render only this bar.
// ==========================================
export interface TerminalInputHandle {
  setValue: (value: string) => void;
  focus: () => void;
}

const TerminalInput = React.forwardRef<TerminalInputHandle, {
  status: ConnectionStatus;
  onSend: (command: string) => void;
  onFocused: () => void;
  onBlurred: () => void;
}>(function TerminalInput({ status, onSend, onFocused, onBlurred }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [value, setValue] = useState('');
  const [hasText, setHasText] = useState(false);
  const [focused, setFocused] = useState(false);

  useImperativeHandle(ref, () => ({
    setValue: (next: string) => {
      setValue(next);
      setHasText(next.length > 0);
    },
    focus: () => inputRef.current?.focus(),
  }));

  const handleChange = (text: string) => {
    setValue(text);
    setHasText(text.length > 0);
  };

  const handleSend = () => {
    onSend(value);
    if (value.length > 0) {
      setValue('');
      setHasText(false);
    }
  };

  return (
    <View style={[styles.inputBar, focused && styles.inputBarFocused]}>      <Text style={[styles.promptChar, focused && styles.promptCharFocused]} allowFontScaling={false}>
        ❯
      </Text>
      <TextInput
        ref={inputRef}
        style={[styles.inputField, focused && styles.inputFieldFocused]}
        value={value}
        onChangeText={handleChange}
        onFocus={() => {
          setFocused(true);
          onFocused();
        }}
        onBlur={() => {
          setFocused(false);
          onBlurred();
        }}
        placeholder="Type command or prompt..."
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        allowFontScaling={false}
        keyboardAppearance="dark"
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={handleSend}
        textContentType="none"
        autoComplete="off"
        importantForAutofill="no"
      />
      {hasText && (
        <TouchableOpacity
          style={styles.clearInputBtn}
          onPress={() => {
            setValue('');
            setHasText(false);
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear input"
        >
          <Text style={styles.clearInputText} allowFontScaling={false}>✕</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[styles.sendBtn, status === 'connected' ? styles.sendBtnActive : styles.sendBtnDisabled]}
        onPress={handleSend}
        accessibilityRole="button"
        accessibilityLabel={hasText ? 'Send command' : 'Send enter'}
      >
        <Text
          style={[styles.sendBtnText, status !== 'connected' && styles.sendBtnTextDisabled]}
          allowFontScaling={false}
        >
          {hasText ? 'SEND' : '↵'}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

// ==========================================
// Terminal tab composition
// ==========================================
export default function TerminalView({ bridge }: { bridge: BridgeController }) {
  const styles = useThemedStyles(makeStyles);
  const inputHandleRef = useRef<TerminalInputHandle>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const {
    screenLines,
    terminalText,
    autoScroll,
    setAutoScroll,
    status,
    sendCommand,
    sendSignal,
    clearScreen,
    nextHistoryValue,
    scrollViewRef,
    scrollRafRef,
  } = bridge;

  const onContentSizeChange = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollViewRef.current?.scrollToEnd({ animated: false });
    });
  }, [scrollRafRef, scrollViewRef]);

  // Keyboard insets land after a layout pass; pin to the newest line then.
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const show = Keyboard.addListener('keyboardDidShow', () => {
      if (!autoScroll) return;
      scrollViewRef.current?.scrollToEnd({ animated: true });
      // The inset animation runs ~250ms; settle once more after it lands.
      settleTimer = setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 300);
    });
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      show.remove();
    };
  }, [autoScroll, scrollViewRef]);

  // Animate the inset ourselves instead of jumping: KeyboardAvoidingView
  // applies its padding in one frame, which makes the keycap row appear to
  // flash above the keyboard while iOS is still sliding it up.
  const anchorRef = useRef<View>(null);
  const anchorBottomRef = useRef(0);
  const keyboardInset = useRef(new Animated.Value(0)).current;

  const measureAnchor = useCallback(() => {
    anchorRef.current?.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
      if (typeof y === 'number' && typeof h === 'number') anchorBottomRef.current = y + h;
    });
  }, []);

  useEffect(() => {
    measureAnchor();
    const dims = Dimensions.addEventListener('change', measureAnchor);
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', measureAnchor);
    return () => {
      dims.remove();
      show.remove();
    };
  }, [measureAnchor]);

  useEffect(() => {
    // Android resizes the window itself (softwareKeyboardLayoutMode=resize),
    // so only iOS needs the animated inset.
    if (Platform.OS !== 'ios') return;
    const sub = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
      if (!e.endCoordinates) return;
      const overlap = Math.max(0, anchorBottomRef.current - e.endCoordinates.screenY);
      Animated.timing(keyboardInset, {
        toValue: overlap,
        duration: e.duration || 250,
        easing: Easing.bezier(0.17, 0.59, 0.4, 0.99),
        useNativeDriver: false,
      }).start();
    });
    return () => sub.remove();
  }, [keyboardInset]);

  // Tap the output: open the keyboard, or close it if it is already up.
  const onTerminalPress = useCallback(() => {
    if (inputFocused) {
      Keyboard.dismiss();
    } else {
      inputHandleRef.current?.focus();
    }
  }, [inputFocused]);
  const onInputFocused = useCallback(() => setInputFocused(true), []);
  const onInputBlurred = useCallback(() => setInputFocused(false), []);

  const onToggleAutoScroll = useCallback(() => setAutoScroll((p) => !p), [setAutoScroll]);
  const onHistory = useCallback(
    (direction: 'up' | 'down') => {
      const next = nextHistoryValue(direction);
      if (next !== null) inputHandleRef.current?.setValue(next);
      inputHandleRef.current?.focus();
    },
    [nextHistoryValue]
  );
  const onPrefill = useCallback(() => {
    inputHandleRef.current?.setValue('agy');
    inputHandleRef.current?.focus();
  }, []);

  return (
    <View ref={anchorRef} style={styles.flexOne} collapsable={false} onLayout={measureAnchor}>
      <Animated.View style={[styles.flexOne, { paddingBottom: keyboardInset }]}>
        <View style={styles.flexOne}>
          <TerminalBody
            screenLines={screenLines}
            terminalText={terminalText}
            autoScroll={autoScroll}
            onPress={onTerminalPress}
            onContentSizeChange={onContentSizeChange}
            scrollViewRef={scrollViewRef}
          />
          <KeycapRibbon
            autoScroll={autoScroll}
            onToggleAutoScroll={onToggleAutoScroll}
            onSignal={sendSignal}
            onHistory={onHistory}
            onClear={clearScreen}
            onPrefill={onPrefill}
          />
          <TerminalInput
            ref={inputHandleRef}
            status={status}
            onSend={sendCommand}
            onFocused={onInputFocused}
            onBlurred={onInputBlurred}
          />
        </View>
      </Animated.View>
    </View>
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
