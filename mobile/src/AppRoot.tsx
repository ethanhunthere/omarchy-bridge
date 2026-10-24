import React from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ErrorBoundary from './components/ErrorBoundary';
import HeaderBar from './components/HeaderBar';
import TerminalView from './components/TerminalView';
import PowerView from './components/PowerView';
import SettingsModal from './components/SettingsModal';
import ConfirmModal from './components/ConfirmModal';
import { ThemeProvider, useTheme, useThemedStyles } from './theme/ThemeProvider';
import { ThemeTokens } from './theme/palettes';
import { useBridge } from './hooks/useBridge';

function ThemedApp() {
  const bridge = useBridge();
  const styles = useThemedStyles(makeStyles);
  const { theme, themeId, setThemeId } = useTheme();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

      <HeaderBar
        activeTab={bridge.activeTab}
        onSelectTab={bridge.selectTab}
        latency={bridge.latency}
        status={bridge.status}
        paired={!!bridge.deviceToken}
        onPressPill={bridge.openHostEditor}
      />

      {/* Both tabs stay mounted: switching is a visibility toggle, so the
          terminal keeps its scroll position and input text across tabs. */}
      <View style={styles.flexOne}>
        <View
          style={[styles.flexOne, bridge.activeTab !== 'terminal' && styles.hidden]}
          testID="tab-terminal"
        >
          <TerminalView bridge={bridge} />
        </View>
        <View
          style={[styles.flexOne, bridge.activeTab !== 'power' && styles.hidden]}
          testID="tab-power"
        >
          <PowerView bridge={bridge} />
        </View>
      </View>

      <SettingsModal
        visible={bridge.hostModalVisible}
        onClose={() => bridge.setHostModalVisible(false)}
        deviceToken={bridge.deviceToken}
        hostInput={bridge.hostInput}
        setHostInput={bridge.setHostInput}
        onApplyHost={bridge.applyBridgeHost}
        pairCodeInput={bridge.pairCodeInput}
        setPairCodeInput={bridge.setPairCodeInput}
        pairError={bridge.pairError}
        pairing={bridge.pairing}
        onPair={bridge.pairDevice}
        onUnpair={bridge.unpairDevice}
        themeId={themeId}
        onSelectTheme={setThemeId}
      />

      <ConfirmModal
        state={bridge.confirmModal}
        onCancel={() => bridge.setConfirmModal((p) => ({ ...p, visible: false }))}
        onExecute={() => {
          bridge.dispatchAction(bridge.confirmModal.action);
          bridge.setConfirmModal((p) => ({ ...p, visible: false }));
        }}
      />
    </SafeAreaView>
  );
}

export default function AppRoot() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <ThemedApp />
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const makeStyles = (t: ThemeTokens) =>
  ({
    container: {
      flex: 1,
      backgroundColor: t.bg,
    },
    flexOne: {
      flex: 1,
    },
    hidden: {
      display: 'none',
    },
  }) as const;
