import React from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';
import { ThemeTokens, THEMES } from '../theme/palettes';
import { BridgeController } from '../hooks/useBridge';

export default function PowerView({ bridge }: { bridge: BridgeController }) {
  const styles = useThemedStyles(makeStyles);
  const { themeId, setThemeId } = useTheme();
  const {
    telemetry,
    status,
    savedHost,
    savedRemoteHost,
    dispatchAction,
    promptConfirmation,
    openHostEditor,
  } = bridge;

  return (
    <ScrollView
      style={styles.powerView}
      contentContainerStyle={styles.powerViewContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
    >
      {/* Status HUD */}
      <View style={styles.hudContainer}>
        <View style={styles.hudCol}>
          <Text style={styles.hudTitle}>CPU LOAD</Text>
          <Text style={styles.hudStat}>{telemetry?.cpuPercent !== undefined ? `${telemetry.cpuPercent}%` : '--'}</Text>
          <Text style={styles.hudSub}>{telemetry?.cpuTemp ? `${telemetry.cpuTemp}°C` : 'Normal'}</Text>
        </View>

        <View style={styles.hudDivider} />

        <View style={styles.hudCol}>
          <Text style={styles.hudTitle}>RAM</Text>
          <Text style={styles.hudStat}>{telemetry?.memory ? `${telemetry.memory.usedGb}G` : '--'}</Text>
          <Text style={styles.hudSub}>
            {telemetry?.memory ? `of ${telemetry.memory.totalGb}G (${telemetry.memory.percent}%)` : '--'}
          </Text>
        </View>

        <View style={styles.hudDivider} />

        <View style={styles.hudCol}>
          <Text style={styles.hudTitle}>BATTERY</Text>
          <Text style={styles.hudStat}>{telemetry?.battery ? `${telemetry.battery.level}%` : '--'}</Text>
          <Text style={styles.hudSub}>{telemetry?.battery?.ac ? 'AC Connected' : 'Discharging'}</Text>
        </View>
      </View>

      {/* System controls */}
      <View style={styles.groupHeaderRow}>
        <Text style={styles.groupHeading}>SYSTEM CONTROLS</Text>
        <Text style={styles.profileBadge}>WI-FI SAFE</Text>
      </View>

      {/* Suspend / Sleep (primary safe option for laptops) */}
      <TouchableOpacity
        style={[styles.powerCard, styles.powerCardPrimary]}
        testID="suspend-btn"
        accessibilityRole="button"
        accessibilityLabel="SUSPEND"
        onPress={() =>
          promptConfirmation(
            'Suspend PC?',
            'This will execute "systemctl suspend" to put the PC into low-power RAM sleep (~1W). Screen and fans turn off; preserves state for instant wake.',
            'suspend',
            false
          )
        }
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardLabelPrimary}>SUSPEND (SLEEP)</Text>
          <Text style={styles.cmdBadge}>systemctl suspend</Text>
        </View>
        <Text style={styles.cardDesc}>Recommended for laptops. Low-power RAM standby (~1W) with instant keystroke resume.</Text>
      </TouchableOpacity>

      {/* Stealth display mode */}
      <TouchableOpacity
        testID="stealth-mode-btn"
        accessibilityRole="button"
        accessibilityLabel="STEALTH MODE"
        style={[styles.powerCard, telemetry?.stealthMode ? styles.powerCardActive : {}]}
        onPress={() => dispatchAction('stealth_toggle')}
      >
        <View style={styles.cardHeader}>
          <Text style={telemetry?.stealthMode ? styles.cardLabelActive : styles.cardLabel}>
            {telemetry?.stealthMode ? 'STEALTH MODE: ACTIVE' : 'STEALTH MODE'}
          </Text>
          <Text style={styles.cmdBadge}>{telemetry?.stealthMode ? 'hyprctl dpms on' : 'hyprctl dpms off'}</Text>
        </View>
        <Text style={styles.cardDesc}>
          {telemetry?.stealthMode
            ? 'Physical screen is blacked out; systemd-inhibit blocks idle sleep.'
            : 'Turn off physical monitor while keeping background tasks running.'}
        </Text>
      </TouchableOpacity>

      {/* Lock screen */}
      <TouchableOpacity
        testID="lock-screen-btn"
        accessibilityRole="button"
        accessibilityLabel="LOCK SCREEN"
        style={styles.powerCard}
        onPress={() => dispatchAction('lock')}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardLabel}>LOCK SCREEN</Text>
          <Text style={styles.cmdBadge}>omarchy-system-lock</Text>
        </View>
        <Text style={styles.cardDesc}>Instantly secures Hyprland desktop session and locks 1Password vault.</Text>
      </TouchableOpacity>

      {/* Bridge host & auto-discovery */}
      <View style={styles.powerCard} testID="bridge-host-card">
        <View style={styles.cardHeader}>
          <Text style={styles.cardLabel}>BRIDGE HOST</Text>
          <Text style={styles.cmdBadge}>{savedHost || 'auto (mDNS)'}</Text>
        </View>
        <Text style={styles.cardDesc}>
          {status === 'connected'
            ? 'Connected. Host is saved on this device for instant reconnects.'
            : 'Auto-discovers your PC as omarchy-bridge.local on the same Wi-Fi. Override with the PC IP if discovery is blocked.'}
        </Text>
        {savedRemoteHost ? <Text style={styles.cardDesc}>Remote: {savedRemoteHost}</Text> : null}
        <TouchableOpacity style={styles.hostEditBtn} onPress={openHostEditor} activeOpacity={0.8} accessibilityRole="button">
          <Text style={styles.hostEditText}>CHANGE HOST</Text>
        </TouchableOpacity>
      </View>

      {/* Wi-Fi profile safety notice */}
      <View style={styles.safetyNoticeCard}>
        <Text style={styles.safetyNoticeTitle}>REMOTE WI-FI PROFILE</Text>
        <Text style={styles.safetyNoticeText}>
          Unused high-risk poweroff, reboot, and Wake-on-LAN controls are excluded to prevent remote session disconnection on wireless hardware.
        </Text>
      </View>

      {/* Appearance */}
      <View style={styles.groupHeaderRow}>
        <Text style={styles.groupHeading}>APPEARANCE</Text>
      </View>
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
              onPress={() => setThemeId(t.id)}
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
  );
}

const makeStyles = (t: ThemeTokens) =>
  ({
    powerView: {
      flex: 1,
      backgroundColor: t.bg,
    },
    powerViewContent: {
      padding: 14,
      paddingBottom: 40,
    },
    hudContainer: {
      flexDirection: 'row',
      backgroundColor: t.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      marginBottom: 18,
    },
    hudCol: {
      flex: 1,
      alignItems: 'center',
    },
    hudDivider: {
      width: 1,
      backgroundColor: t.border,
      marginHorizontal: 8,
    },
    hudTitle: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      fontWeight: '700',
      color: t.textMuted,
      marginBottom: 4,
      letterSpacing: 1.0,
    },
    hudStat: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 19,
      fontWeight: '800',
      color: t.textPrimary,
      marginBottom: 2,
    },
    hudSub: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: t.textSecondary,
    },
    groupHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
      marginTop: 4,
    },
    groupHeading: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11.5,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 1.5,
    },
    profileBadge: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 9.5,
      fontWeight: '700',
      color: t.promptPath,
      backgroundColor: t.surface,
      borderColor: t.borderStrong,
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      letterSpacing: 0.5,
      overflow: 'hidden',
    },
    powerCard: {
      backgroundColor: t.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      marginBottom: 10,
    },
    powerCardPrimary: {
      borderColor: t.focus,
    },
    powerCardActive: {
      backgroundColor: t.successBg,
      borderColor: t.successBorder,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
      gap: 8,
    },
    cardLabel: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      fontWeight: '700',
      color: t.textPrimary,
      flexShrink: 1,
    },
    cardLabelPrimary: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      fontWeight: '700',
      color: t.promptPath,
      flexShrink: 1,
    },
    cardLabelActive: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 14,
      fontWeight: '700',
      color: t.success,
      flexShrink: 1,
    },
    cmdBadge: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10.5,
      color: t.textSecondary,
      backgroundColor: t.bg,
      borderColor: t.border,
      borderWidth: 1,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: 'hidden',
      flexShrink: 1,
    },
    cardDesc: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12.5,
      lineHeight: 18,
      color: t.textSecondary,
      marginTop: 2,
    },
    safetyNoticeCard: {
      backgroundColor: t.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      padding: 12,
      marginTop: 10,
    },
    safetyNoticeTitle: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 10.5,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 1,
      marginBottom: 4,
    },
    safetyNoticeText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11.5,
      lineHeight: 17,
      color: t.textSecondary,
    },
    hostEditBtn: {
      marginTop: 10,
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: 4,
      borderWidth: 1,
      borderColor: t.borderStrong,
      backgroundColor: t.surfaceElevated,
      alignItems: 'center',
    },
    hostEditText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      fontWeight: '700',
      color: t.textSecondary,
      letterSpacing: 0.8,
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
