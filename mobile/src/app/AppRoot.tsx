import React from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../shared/ui';
import { HeaderBar } from '../widgets/header';
import { TerminalView } from '../views/terminal';
import { PowerView } from '../views/system';
import { SettingsModal } from '../features/settings';
import { ConfirmModal } from '../features/confirm';
import { ThemeProvider, useTheme, useThemedStyles } from '../shared/theme';
import { ThemeTokens } from '../shared/theme';
import { useBridge } from '../entities/bridge';

function ThemedApp() {
  const bridge = useBridge();
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();

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

      {bridge.hostModalVisible && (
        <SettingsModal
          visible
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
        />
      )}

      {bridge.confirmModal.visible && (
        <ConfirmModal
          state={bridge.confirmModal}
          onCancel={() => bridge.setConfirmModal((p) => ({ ...p, visible: false }))}
          onExecute={() => {
            bridge.dispatchAction(bridge.confirmModal.action);
            bridge.setConfirmModal((p) => ({ ...p, visible: false }));
          }}
        />
      )}
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
