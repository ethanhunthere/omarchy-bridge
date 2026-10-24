import React, { memo } from 'react';
import { Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useThemedStyles } from '../../shared/theme';
import { ThemeTokens } from '../../shared/theme';
import { ConfirmModalState } from '../../entities/bridge';

export default memo(function ConfirmModal({
  state,
  onCancel,
  onExecute,
}: {
  state: ConfirmModalState;
  onCancel: () => void;
  onExecute: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="fade"
      testID="confirmation-modal"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.dialogCard}>
          <ScrollView style={styles.dialogScroll} contentContainerStyle={styles.dialogScrollContent}>
            <Text style={[styles.dialogTitle, state.isDanger && styles.textRed]} testID="modal-title">
              {state.title}
            </Text>
            <Text style={styles.dialogMessage} testID="modal-description">
              {state.description}
            </Text>
          </ScrollView>
          <View style={styles.dialogActions}>
            <TouchableOpacity
              style={styles.dialogBtnSecondary}
              testID="modal-cancel-btn"
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dialogBtnPrimary, state.isDanger ? styles.dialogBtnDanger : {}]}
              testID="modal-execute-btn"
              onPress={onExecute}
              accessibilityRole="button"
            >
              <Text style={styles.dialogBtnPrimaryText}>Execute</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const makeStyles = (t: ThemeTokens) =>
  ({
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.75)',
      justifyContent: 'center',
      padding: 24,
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
      paddingBottom: 2,
    },
    dialogTitle: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 16,
      fontWeight: '800',
      color: t.textPrimary,
      marginBottom: 6,
    },
    textRed: {
      color: t.danger,
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
    dialogBtnDanger: {
      backgroundColor: t.danger,
    },
    dialogBtnPrimaryText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      fontWeight: '800',
      color: t.accentText,
    },
  }) as const;
