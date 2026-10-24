import { useCallback } from 'react';
import { Keyboard } from 'react-native';
import {
  DEFAULT_BRIDGE_HOST,
  normalizeBridgeValue,
  persistBridgeHost,
  persistRemoteHost,
} from '../lib/bridge';
import type { ConnectionStatus } from './types';

interface Options {
  hostInput: string;
  savedHostRef: React.MutableRefObject<string>;
  savedRemoteHostRef: React.MutableRefObject<string>;
  setHostInput: (value: string) => void;
  setPairError: (value: string) => void;
  setHostModalVisible: (value: boolean) => void;
  setSavedHost: (value: string) => void;
  setSavedRemoteHost: (value: string) => void;
  setStatus: (value: ConnectionStatus) => void;
  setLatency: (value: number | null) => void;
  resetHostIndex: () => void;
  teardownSocket: () => void;
  connect: () => void;
}

export function useHostEditor(options: Options) {
  const {
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
  } = options;

  const openHostEditor = useCallback(() => {
    Keyboard.dismiss();
    setHostInput(savedHostRef.current || DEFAULT_BRIDGE_HOST);
    setPairError('');
    setHostModalVisible(true);
  }, [savedHostRef, setHostInput, setHostModalVisible, setPairError]);

  const applyBridgeHost = useCallback(() => {
    const value = normalizeBridgeValue(hostInput);
    if (!value) return;

    if (value.startsWith('https://')) {
      persistRemoteHost(value);
      savedRemoteHostRef.current = value;
      setSavedRemoteHost(value);
    } else {
      persistBridgeHost(value);
      savedHostRef.current = value;
      setSavedHost(value);
    }
    setHostModalVisible(false);
    resetHostIndex();
    Keyboard.dismiss();

    teardownSocket();
    setStatus('connecting');
    setLatency(null);
    connect();
  }, [
    connect,
    hostInput,
    resetHostIndex,
    savedHostRef,
    savedRemoteHostRef,
    setHostModalVisible,
    setLatency,
    setSavedHost,
    setSavedRemoteHost,
    setStatus,
    teardownSocket,
  ]);

  return { openHostEditor, applyBridgeHost };
}
