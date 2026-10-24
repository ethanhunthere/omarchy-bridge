import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';
import { ThemeTokens, THEMES } from '../theme/palettes';
import { DEFAULT_BRIDGE_HOST } from '../lib/bridge';

export interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  deviceToken: string;
  hostInput: string;
  setHostInput: (value: string) => void;
  onApplyHost: () => void;
  pairCodeInput: string;
  setPairCodeInput: (value: string) => void;
  pairError: string;
  pairing: boolean;
  onPair: () => void;
  onUnpair: () => void;
  themeId: string;
  onSelectTheme: (id: string) => void;
}

export default memo(function SettingsModal(props: SettingsModalProps) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const pendingScrollRef = useRef(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const {
    visible,
    onClose,
    deviceToken,
    hostInput,
    setHostInput,
    onApplyHost,
    pairCodeInput,
    setPairCodeInput,
    pairError,
    pairing,
    onPair,
    onUnpair,
    themeId,
    onSelectTheme,
  } = props;

  // Keep the dialog top-aligned while typing so the card never gets pushed
  // off-screen by the keyboard, and scroll the focused field into view once
  // the keyboard has actually resized the layout.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      if (pendingScrollRef.current) {
        pendingScrollRef.current = false;
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const onFieldFocus = () => {
    pendingScrollRef.current = true;
    // Keyboard may already be up (second field): scroll after the layout pass.
    setTimeout(() => {
      if (pendingScrollRef.current) {
        pendingScrollRef.current = false;
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, 300);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      testID="host-modal"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalKav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          style={[
            styles.modalBackdrop,
            keyboardVisible && styles.modalBackdropKeyboard,
            keyboardVisible && { paddingTop: insets.top + 12 },
          ]}
        >
          <TouchableOpacity
            style={styles.modalDismissLayer}
            activeOpacity={1}
            testID="host-backdrop"
            onPress={Keyboard.dismiss}
            accessibilityLabel="Dismiss keyboard"
          />
          <View style={styles.dialogCard}>
            <ScrollView
              ref={scrollRef}
              style={styles.dialogScroll}
              contentContainerStyle={styles.dialogScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
              <Text style={styles.dialogTitle}>Bridge Host</Text>
              <Text style={styles.dialogMessage}>
                Auto-discovers the PC as "{DEFAULT_BRIDGE_HOST}". If your network blocks mDNS, enter the PC's LAN IP.
              </Text>
              <Text style={styles.fieldLabel}>Bridge host</Text>
              <TextInput
                style={[styles.hostInput, styles.fieldInput]}
                value={hostInput}
                onChangeText={setHostInput}
                placeholder={DEFAULT_BRIDGE_HOST}
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardAppearance="dark"
                returnKeyType="done"
                onSubmitEditing={onApplyHost}
                textContentType="none"
                autoComplete="off"
                importantForAutofill="no"
                onFocus={onFieldFocus}
                testID="host-input"
              />

              <View style={styles.modalDivider} />

              {deviceToken ? (
                <View>
                  <Text style={styles.dialogTitle}>Device Paired</Text>
                  <Text style={styles.dialogMessage}>This device holds its own key in the OS keychain.</Text>
                  <TouchableOpacity style={styles.dialogBtnSecondary} testID="unpair-btn" onPress={onUnpair} accessibilityRole="button">
                    <Text style={styles.dialogBtnSecondaryText}>Forget This Device</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <Text style={styles.dialogTitle}>Pair This Device</Text>
                  <Text style={styles.dialogMessage}>Get the newest code from the PC terminal:</Text>
                  <Text style={styles.commandBlock} selectable allowFontScaling={false}>
                    journalctl --user -u omarchy-bridge | grep PAIRING
                  </Text>
                  <Text style={styles.fieldLabel}>Pairing code</Text>
                  <TextInput
                    style={[styles.hostInput, styles.fieldInput]}
                    value={pairCodeInput}
                    onChangeText={(text) => {
                      const cleaned = text.replace(/\D/g, '').slice(0, 6);
                      setPairCodeInput(cleaned);
                      if (cleaned.length === 6) Keyboard.dismiss();
                    }}
                    placeholder="6-digit code"
                    placeholderTextColor={theme.textMuted}
                    keyboardType="number-pad"
                    maxLength={6}
                    keyboardAppearance="dark"
                    textContentType="none"
                    autoComplete="off"
                    importantForAutofill="no"
                    onFocus={onFieldFocus}
                    testID="pair-code-input"
                  />
                  {pairError ? <Text style={styles.pairError}>{pairError}</Text> : null}
                </View>
              )}

              <View style={styles.modalDivider} />

              <Text style={styles.dialogTitle}>Appearance</Text>
              <Text style={styles.dialogMessage}>Terminal palette, applied instantly and saved on this device.</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.themeRow}
                keyboardShouldPersistTaps="handled"
              >
                {THEMES.map((t) => {
                  const active = t.id === themeId;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.themeChip, active && styles.themeChipActive]}
                      onPress={() => onSelectTheme(t.id)}
                      testID={`theme-option-${t.id}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <View style={[styles.themeSwatch, { backgroundColor: t.bg, borderColor: t.accent }]} />
                      <Text style={[styles.themeChipText, active && styles.themeChipTextActive]}>{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </ScrollView>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.dialogBtnSecondary}
                testID="host-cancel-btn"
                onPress={() => {
                  Keyboard.dismiss();
                  onClose();
                }}
                accessibilityRole="button"
              >
                <Text style={styles.dialogBtnSecondaryText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  Close
                </Text>
              </TouchableOpacity>

              {deviceToken ? (
                <TouchableOpacity style={styles.dialogBtnPrimary} testID="host-save-btn" onPress={onApplyHost} accessibilityRole="button">
                  <Text style={styles.dialogBtnPrimaryText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    Save & Reconnect
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.dialogBtnPrimary, pairing && styles.dialogBtnDisabled]}
                  testID="pair-btn"
                  onPress={onPair}
                  disabled={pairing}
                  accessibilityRole="button"
                >
                  <Text style={styles.dialogBtnPrimaryText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {pairing ? 'Pairing...' : 'Pair Device'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

const makeStyles = (t: ThemeTokens) =>
  ({
    modalKav: {
      flex: 1,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.75)',
      justifyContent: 'center',
      padding: 24,
    },
    modalBackdropKeyboard: {
      justifyContent: 'flex-start',
    },
    modalDismissLayer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    dialogCard: {
      backgroundColor: t.surfaceElevated,
      borderRadius: 8,
      padding: 18,
      borderWidth: 1,
      borderColor: t.borderStrong,
      width: '100%',
      maxWidth: 420,
      maxHeight: '82%',
    },
    dialogScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    dialogScrollContent: {
      paddingBottom: 4,
    },
    dialogTitle: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 16,
      fontWeight: '800',
      color: t.textPrimary,
      marginBottom: 6,
    },
    dialogMessage: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      color: t.textSecondary,
      lineHeight: 18,
      marginBottom: 12,
    },
    dialogActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
    },
    dialogBtnSecondary: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      flexShrink: 1,
      borderRadius: 4,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.borderStrong,
    },
    dialogBtnSecondaryText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '700',
      color: t.textSecondary,
    },
    dialogBtnPrimary: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      flexShrink: 1,
      borderRadius: 4,
      backgroundColor: t.accent,
    },
    dialogBtnDisabled: {
      opacity: 0.45,
    },
    dialogBtnPrimaryText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '800',
      color: t.accentText,
    },
    modalDivider: {
      height: 1,
      backgroundColor: t.borderStrong,
      marginTop: 4,
      marginBottom: 16,
    },
    fieldLabel: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: t.textMuted,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginTop: 10,
      marginBottom: 6,
    },
    fieldInput: {
      marginBottom: 4,
    },
    hostInput: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      color: t.textPrimary,
      backgroundColor: t.inputBg,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 46,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.borderStrong,
    },
    pairError: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: t.danger,
      marginBottom: 12,
    },
    commandBlock: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: t.textSecondary,
      backgroundColor: t.bg,
      borderWidth: 1,
      borderColor: t.borderStrong,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginBottom: 12,
    },
    themeRow: {
      flexDirection: 'row',
      gap: 8,
      paddingBottom: 2,
    },
    themeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 40,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    themeChipActive: {
      borderColor: t.focus,
      backgroundColor: t.surfaceElevated,
    },
    themeSwatch: {
      width: 14,
      height: 14,
      borderRadius: 3,
      borderWidth: 1,
    },
    themeChipText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 0.4,
    },
    themeChipTextActive: {
      color: t.textPrimary,
    },
  }) as const;
