import React, { useImperativeHandle, useRef, useState } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemeTokens, useTheme, useThemedStyles } from '../../../shared/theme';
import { ConnectionStatus } from '../../../entities/bridge';

export interface TerminalInputHandle {
  setValue: (value: string) => void;
  focus: () => void;
}

// ==========================================
// Input bar — owns its own text state: keystrokes re-render only this bar.
// ==========================================
export const TerminalInput = React.forwardRef<
  TerminalInputHandle,
  {
    status: ConnectionStatus;
    onSend: (command: string) => void;
    onFocused: () => void;
    onBlurred: () => void;
  }
>(function TerminalInput({ status, onSend, onFocused, onBlurred }, ref) {
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
    <View style={[styles.inputBar, focused && styles.inputBarFocused]}>
      <Text style={[styles.promptChar, focused && styles.promptCharFocused]} allowFontScaling={false}>
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

const makeStyles = (t: ThemeTokens) =>
  ({
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
