import React, { memo } from 'react';
import { Platform, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useTheme, useThemedStyles } from '../../shared/theme';
import { ThemeTokens } from '../../shared/theme';
import { ConnectionStatus } from '../../entities/bridge';

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
  const isConnecting = status === 'connecting';
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
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      style={[
        styles.latencyPill,
        !paired && styles.latencyPillIdle,
        isConnecting && styles.latencyPillConnecting,
        isOffline && styles.latencyPillOffline,
      ]}
      testID="connection-pill"
      accessibilityRole="button"
      accessibilityLabel={`Connection ${label}`}
    >
      <Text
        style={[
          styles.latencyText,
          !paired && styles.latencyTextIdle,
          isConnecting && styles.latencyTextConnecting,
          isOffline && styles.latencyTextOffline,
        ]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
});

export default memo(function HeaderBar({
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
  const { width } = useWindowDimensions();
  const compact = width < 360;

  const renderSegment = (tab: 'terminal' | 'power', label: string) => {
    const active = activeTab === tab;
    return (
      <TouchableOpacity
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        style={[styles.segmentBtn, compact && styles.segmentBtnCompact, active && styles.segmentBtnActive]}
        onPress={() => onSelectTab(tab)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
      >
        <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.header}>
      <View style={styles.headerSide} />
      <View style={[styles.segmentedControl, compact && styles.segmentedControlCompact, { backgroundColor: theme.chipBg }]}>
        {renderSegment('terminal', 'TERMINAL')}
        {renderSegment('power', 'SYSTEM')}
      </View>
      <View style={styles.headerSide}>
        <ConnectionPill latency={latency} status={status} paired={paired} onPress={onPressPill} />
      </View>
    </View>
  );
});

const makeStyles = (t: ThemeTokens) =>
  ({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: t.bg,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      gap: 8,
    },
    headerSide: {
      flex: 1,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    latencyPill: {
      maxWidth: 96,
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.08)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      minHeight: 24,
      justifyContent: 'center',
      borderRadius: 12,
    },
    latencyPillIdle: {
      borderColor: t.borderStrong,
    },
    latencyPillConnecting: {
      borderColor: 'rgba(251, 191, 36, 0.45)',
    },
    latencyText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 9,
      fontWeight: '600',
      color: t.success,
    },
    latencyTextIdle: {
      color: t.textSecondary,
    },
    latencyTextConnecting: {
      color: t.warning,
    },
    latencyPillOffline: {
      borderColor: t.dangerBorder,
      backgroundColor: t.dangerBg,
    },
    latencyTextOffline: {
      color: t.danger,
      fontWeight: '700',
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
      minHeight: 44,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBtnCompact: {
      paddingHorizontal: 10,
    },
    segmentedControlCompact: {
      flexShrink: 1,
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
