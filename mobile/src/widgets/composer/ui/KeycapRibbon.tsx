import React, { memo } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ThemeTokens, useThemedStyles } from '../../../shared/theme';

// ==========================================
// Keycap ribbon — memoized: never re-renders while typing.
// ==========================================
export const KeycapRibbon = memo(function KeycapRibbon({
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

const makeStyles = (t: ThemeTokens) =>
  ({
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
  }) as const;
