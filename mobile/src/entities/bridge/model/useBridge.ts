import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import {
  DEFAULT_BRIDGE_HOST,
  clearDeviceToken,
  persistBridgeHost,
  persistRemoteHost,
  readSavedBridgeHost,
  readSavedRemoteHost,
} from '../lib/bridge';
import { useBridgeConnection } from './useBridgeConnection';
import { useHaptics } from './useHaptics';
import { useHistory } from './useHistory';
import { useHostEditor } from './useHostEditor';
import { useBridgeActions } from './useBridgeActions';
import { readPersistedToken, usePairing } from './usePairing';
import { useTerminalBuffer } from './useTerminalBuffer';
import type { ConfirmModalState, ConnectionStatus, Telemetry } from './types';

export type { ConfirmModalState, ConnectionStatus, Telemetry } from './types';

export type BridgeController = ReturnType<typeof useBridge>;

// ==========================================
// Composition root: pairing, connection, terminal + hardware actions.
// Views stay dumb and receive this object.
// ==========================================
export function useBridge() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'power'>('terminal');
  const [savedHost, setSavedHost] = useState<string>(() => readSavedBridgeHost());
  const savedHostRef = useRef<string>(savedHost);
  const [savedRemoteHost, setSavedRemoteHost] = useState<string>(() => readSavedRemoteHost());
  const savedRemoteHostRef = useRef<string>(savedRemoteHost);
  const [hostModalVisible, setHostModalVisible] = useState(false);
  const [hostInput, setHostInput] = useState<string>(savedHost || DEFAULT_BRIDGE_HOST);

  // Device pairing (per-device token in OS keychain; nothing shared is shipped)
  const [deviceToken, setDeviceToken] = useState<string>('');
  const deviceTokenRef = useRef<string>('');
  const [pairCodeInput, setPairCodeInput] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    visible: false,
    title: '',
    description: '',
    action: '',
    isDanger: false,
  });

  const triggerHaptic = useHaptics();
  const {
    screenLines,
    terminalText,
    setTerminalText,
    scheduleScreenLines,
    appendOutputChunk,
    resetOutput,
    scrollViewRef,
    scrollRafRef,
  } = useTerminalBuffer();

  const patchTelemetry = useCallback((patch: Partial<Telemetry>) => {
    setTelemetry((prev) => ({ ...(prev || {}), ...patch }));
  }, []);

  const persistRemote = useCallback((value: string) => {
    persistRemoteHost(value);
    savedRemoteHostRef.current = value;
    setSavedRemoteHost(value);
  }, []);

  const persistHost = useCallback((ip: string) => {
    if (!ip || ip === '127.0.0.1' || ip === 'localhost') return;
    persistBridgeHost(ip);
    savedHostRef.current = ip;
    setSavedHost(ip);
    setHostInput(ip);
  }, []);

  const { record: recordHistory, loadHistory, nextHistoryValue } = useHistory(triggerHaptic);

  const {
    status,
    latency,
    setStatus,
    setLatency,
    socketRef,
    connect,
    teardownSocket,
    resetHostIndex,
  } = useBridgeConnection({
    deviceTokenRef,
    savedHostRef,
    savedRemoteHostRef,
    scheduleScreenLines,
    appendOutputChunk,
    setTerminalText,
    setTelemetry,
    patchTelemetry,
    resetOutput,
    persistRemote,
    persistHost,
    triggerHaptic,
    loadHistory,
  });

  const selectTab = useCallback(
    (tab: 'terminal' | 'power') => {
      triggerHaptic('light');
      if (tab !== 'terminal') Keyboard.dismiss();
      setActiveTab(tab);
    },
    [triggerHaptic]
  );

  const { openHostEditor, applyBridgeHost } = useHostEditor({
    hostInput,
    savedHostRef,
    savedRemoteHostRef,
    setHostInput,
    setPairError,
    setHostModalVisible,
    setSavedHost,
    setSavedRemoteHost,
    setStatus,
    setLatency,
    resetHostIndex,
    teardownSocket,
    connect,
  });

  const pairDevice = usePairing({
    hostInput,
    pairCodeInput,
    savedHostRef,
    savedRemoteHostRef,
    deviceTokenRef,
    setPairCodeInput,
    setPairing,
    setPairError,
    setDeviceToken,
    setSavedHost,
    setSavedRemoteHost,
    setHostModalVisible,
    connect,
    resetHostIndex,
  });

  const unpairDevice = useCallback(() => {
    clearDeviceToken();
    deviceTokenRef.current = '';
    setDeviceToken('');
    teardownSocket();
    setStatus('disconnected');
    setLatency(null);
  }, [setLatency, setStatus, teardownSocket]);

  // Boot: restore the keychain token and dial the last known target.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = await readPersistedToken();
      if (!mounted) return;
      if (token) {
        deviceTokenRef.current = token;
        setDeviceToken(token);
        connect();
      } else {
        setStatus('disconnected');
        setHostModalVisible(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [connect, setStatus]);

  const { sendCommand, sendSignal, dispatchAction, clearScreen, promptConfirmation } = useBridgeActions({
    socketRef,
    connect,
    triggerHaptic,
    recordHistory,
    resetOutput,
    setConfirmModal,
  });

  return {
    // Shell
    activeTab,
    setActiveTab,
    selectTab,
    // Connection
    status,
    latency,
    savedHost,
    savedRemoteHost,
    // Pairing
    deviceToken,
    pairCodeInput,
    setPairCodeInput,
    pairing,
    pairError,
    pairDevice,
    unpairDevice,
    // Host editor
    hostModalVisible,
    setHostModalVisible,
    hostInput,
    setHostInput,
    openHostEditor,
    applyBridgeHost,
    // Terminal
    screenLines,
    terminalText,
    autoScroll,
    setAutoScroll,
    nextHistoryValue,
    sendCommand,
    sendSignal,
    clearScreen,
    // Hardware
    telemetry,
    dispatchAction,
    promptConfirmation,
    confirmModal,
    setConfirmModal,
    // Refs
    scrollViewRef,
    scrollRafRef,
  };
}
