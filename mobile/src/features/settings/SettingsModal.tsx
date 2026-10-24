import React, { memo, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
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
import { useTheme, useThemedStyles } from '../../shared/theme';
import { ThemeTokens } from '../../shared/theme';
import { DEFAULT_BRIDGE_HOST } from '../../entities/bridge';

// iOS animates the inset in step with the keyboard; Android lets the dialog
// KeyboardAvoidingView shrink instead.
function ModalShell({ style, children }: { style: any; children: React.ReactNode }) {
  if (Platform.OS === 'ios') return <Animated.View style={style}>{children}</Animated.View>;
  return (
    <KeyboardAvoidingView style={style} behavior="height">
      {children}
    </KeyboardAvoidingView>
  );
}

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
}

export default memo(function SettingsModal(props: SettingsModalProps) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const pendingScrollRef = useRef(false);
  const modalInset = useRef(new Animated.Value(0)).current;
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
  } = props;

  // Scroll the focused field into view after the keyboard has resized us.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      if (pendingScrollRef.current) {
        pendingScrollRef.current = false;
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    });
    return () => show.remove();
  }, []);

  // Same animated inset trick as the terminal composer: no card jump.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
      if (!e.endCoordinates) return;
      const overlap = Math.max(0, Dimensions.get('screen').height - e.endCoordinates.screenY);
      Animated.timing(modalInset, {
        toValue: overlap,
        duration: e.duration || 250,
        easing: Easing.bezier(0.17, 0.59, 0.4, 0.99),
        useNativeDriver: false,
      }).start();
    });
    return () => sub.remove();
  }, [modalInset]);

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
      <ModalShell style={[styles.modalKav, Platform.OS === 'ios' && { paddingBottom: modalInset }]}>
        <View style={styles.modalBackdrop}>
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
      </ModalShell>
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
  }) as const;
