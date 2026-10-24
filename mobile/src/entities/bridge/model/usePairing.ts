import { useCallback } from 'react';
import {
  BridgeTarget,
  DEFAULT_BRIDGE_HOST,
  deviceDisplayName,
  fetchWithTimeout,
  persistBridgeHost,
  persistDeviceToken,
  persistRemoteHost,
  readDeviceToken,
  resolveCandidateTargets,
  toBridgeTarget,
} from '../lib/bridge';

interface Options {
  hostInput: string;
  pairCodeInput: string;
  savedHostRef: React.MutableRefObject<string>;
  savedRemoteHostRef: React.MutableRefObject<string>;
  deviceTokenRef: React.MutableRefObject<string>;
  setPairCodeInput: (value: string) => void;
  setPairing: (value: boolean) => void;
  setPairError: (value: string) => void;
  setDeviceToken: (value: string) => void;
  setSavedHost: (value: string) => void;
  setSavedRemoteHost: (value: string) => void;
  setHostModalVisible: (value: boolean) => void;
  connect: () => void;
  resetHostIndex: () => void;
}

export function usePairing(options: Options) {
  const {
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
  } = options;

  return useCallback(async () => {
    const code = pairCodeInput.trim();
    const name = deviceDisplayName();
    if (!/^\d{6}$/.test(code)) {
      setPairError('Enter the 6-digit code from the server log');
      return;
    }
    setPairing(true);
    setPairError('');

    const targets: BridgeTarget[] = [];
    const manualTarget = toBridgeTarget(hostInput);
    if (manualTarget) targets.push(manualTarget);
    for (const candidate of resolveCandidateTargets(savedHostRef.current, savedRemoteHostRef.current)) {
      if (!targets.some((t) => t.wsUrl === candidate.wsUrl)) targets.push(candidate);
    }
    let sawRejection = false;
    for (const target of targets) {
      try {
        const res = await fetchWithTimeout(`${target.httpOrigin}/api/pair`, 4000, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, name }),
        });
        if (res.status === 429) {
          setPairError('Too many attempts. Wait a minute and try again.');
          setPairing(false);
          return;
        }
        if (!res.ok) {
          sawRejection = true;
          continue;
        }
        const data = await res.json();
        if (data.token) {
          await persistDeviceToken(data.token);
          deviceTokenRef.current = data.token;
          setDeviceToken(data.token);
          if (target.kind === 'tunnel') {
            persistRemoteHost(target.storageValue);
            savedRemoteHostRef.current = target.storageValue;
            setSavedRemoteHost(target.storageValue);
          } else {
            persistBridgeHost(target.storageValue);
            savedHostRef.current = target.storageValue;
            setSavedHost(target.storageValue);
          }
          setPairCodeInput('');
          setPairError('');
          setPairing(false);
          resetHostIndex();
          setHostModalVisible(false);
          connect();
          return;
        }
        sawRejection = true;
      } catch (e) {}
    }

    setPairing(false);
    setPairError(
      sawRejection
        ? 'Wrong or expired code. Grab the newest code from the PC log.'
        : `Could not reach the bridge (${targets[0]?.host || DEFAULT_BRIDGE_HOST}). Set Bridge Host to the PC's LAN IP (same Wi-Fi) or your tunnel URL, then tap Pair Device again.`
    );
  }, [
    connect,
    deviceTokenRef,
    hostInput,
    pairCodeInput,
    resetHostIndex,
    savedHostRef,
    savedRemoteHostRef,
    setDeviceToken,
    setHostModalVisible,
    setPairCodeInput,
    setPairError,
    setPairing,
    setSavedHost,
    setSavedRemoteHost,
  ]);
}

// Reads the persisted pairing token on boot. Kept here so the controller hook
// stays a composition root.
export async function readPersistedToken(): Promise<string> {
  return readDeviceToken();
}
