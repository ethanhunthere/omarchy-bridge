import React, { memo, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme, useThemedStyles } from '../../shared/theme';
import { DEFAULT_BRIDGE_HOST } from '../../entities/bridge';
import { ModalShell } from './ui/ModalShell';
import { makeStyles } from './ui/settingsStyles';

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
