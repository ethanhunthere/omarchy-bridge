import React, { memo } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/palettes';
import { ConnectionStatus } from '../hooks/useBridge';

const ConnectionPill = memo(function ConnectionPill({
  latency,
  status,
  paired,
  onPress,
}: {
  latency: number | null;
  status: ConnectionStatus;
  paired: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const isOffline = status === 'disconnected';
  const label = !paired
    ? 'PAIR'
    : status === 'connected'
      ? latency !== null
        ? `${latency}ms`
        : 'LINK'
      : status === 'connecting'
        ? 'LINKING'
        : 'OFFLINE';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.latencyPill, isOffline && styles.latencyPillOffline]}
      testID="connection-pill"
      accessibilityRole="button"
      accessibilityLabel={`Connection ${label}`}
    >
      <Text style={[styles.latencyText, isOffline && styles.latencyTextOffline]}>{label}</Text>
    </TouchableOpacity>
  );
});

export default function HeaderBar({
  activeTab,
  onSelectTab,
  latency,
  status,
  paired,
  onPressPill,
}: {
  activeTab: 'terminal' | 'power';
  onSelectTab: (tab: 'terminal' | 'power') => void;
  latency: number | null;
  status: ConnectionStatus;
  paired: boolean;
  onPressPill: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();

  const renderSegment = (tab: 'terminal' | 'power', label: string) => {
    const active = activeTab === tab;
    return (
      <TouchableOpacity
        style={[styles.segmentBtn, active && styles.segmentBtnActive]}
        onPress={() => onSelectTab(tab)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
      >
        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.header}>
      <View style={[styles.segmentedControl, { backgroundColor: theme.chipBg }]}>
        {renderSegment('terminal', 'TERMINAL')}
        {renderSegment('power', 'POWER')}
      </View>
      <ConnectionPill latency={latency} status={status} paired={paired} onPress={onPressPill} />
    </View>
  );
}

const makeStyles = (t: ThemeTokens) =>
  ({
    header: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: t.bg,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      position: 'relative',
    },
    latencyPill: {
      position: 'absolute',
      right: 14,
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.08)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      minHeight: 24,
      justifyContent: 'center',
      borderRadius: 12,
    },
    latencyText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 9,
      fontWeight: '600',
      color: t.textSecondary,
    },
    latencyPillOffline: {
      borderColor: t.dangerBorder,
    },
    latencyTextOffline: {
      color: t.danger,
    },
    segmentedControl: {
      flexDirection: 'row',
      borderRadius: 20,
      padding: 3,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    segmentBtn: {
      paddingHorizontal: 18,
      paddingVertical: 7,
      minHeight: 34,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBtnActive: {
      backgroundColor: t.chipActiveBg,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.15)',
    },
    segmentText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 0.8,
    },
    segmentTextActive: {
      color: t.textPrimary,
      fontWeight: '800',
    },
  }) as const;
