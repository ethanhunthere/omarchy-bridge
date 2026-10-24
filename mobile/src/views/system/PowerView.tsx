import React from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { THEMES, useTheme, useThemedStyles } from '../../shared/theme';
import { BridgeController } from '../../entities/bridge';
import { makeStyles } from './ui/powerStyles';

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
