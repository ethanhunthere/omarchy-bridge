import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Dimensions, Keyboard, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  BRIDGE_PORT,
  BridgeTarget,
  DEFAULT_BRIDGE_HOST,
  clearDeviceToken,
  deviceDisplayName,
  fetchWithTimeout,
  normalizeBridgeValue,
  persistBridgeHost,
  persistDeviceToken,
  persistRemoteHost,
  readDeviceToken,
  readSavedBridgeHost,
  readSavedRemoteHost,
  resolveCandidateTargets,
  toBridgeTarget,
} from '../lib/bridge';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface Telemetry {
  cpuPercent?: number;
  cpuTemp?: number | null;
  memory?: { usedGb: string; totalGb: string; percent: number };
  battery?: { level: number; status: string; ac: boolean };
  netSpeed?: { rxKbps: number; txKbps: number };
  stealthMode?: boolean;
  dpmsOn?: boolean;
  uptimeSeconds?: number;
}

export interface ConfirmModalState {
  visible: boolean;
  title: string;
  description: string;
  action: string;
  isDanger: boolean;
}

export type BridgeController = ReturnType<typeof useBridge>;

// ==========================================
// Single controller hook: connection, pairing, terminal + hardware actions.
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

  // Connection state
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [latency, setLatency] = useState<number | null>(null);

  // Terminal state
  const [screenLines, setScreenLines] = useState<string[]>([]);
  const [terminalText, setTerminalText] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);

  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    visible: false,
    title: '',
    description: '',
    action: '',
    isDanger: false,
  });

  // Low-latency refs
  const socketRef = useRef<WebSocket | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const incomingBufferRef = useRef('');
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostIndexRef = useRef(0);
  const isMountedRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const reconnectAttemptRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const pendingScreenRef = useRef<string[] | null>(null);
  const screenFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  historyRef.current = history;
  historyIndexRef.current = historyIndex;

  // Coalesce high-frequency screen frames into at most one commit per 16ms,
  // inside a transition so typing/focus work always wins the scheduler.
  // Leading edge applies instantly (latency 0 for single frames); trailing
  // commits collapse bursts.
  const scheduleScreenLines = useCallback((lines: string[]) => {
    if (!screenFrameTimerRef.current) {
      setScreenLines(lines);
      screenFrameTimerRef.current = setTimeout(() => {
        screenFrameTimerRef.current = null;
        const next = pendingScreenRef.current;
        pendingScreenRef.current = null;
        if (next) startTransition(() => setScreenLines(next));
      }, 16);
      return;
    }
    pendingScreenRef.current = lines;
  }, []);

  // Re-negotiate terminal grid when the window changes (rotation, resize)
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        const calculatedCols = Math.max(45, Math.floor((window.width - 24) / 7.2));
        const calculatedRows = Math.max(20, Math.floor((window.height - 200) / 19));
        socketRef.current.send(JSON.stringify({ type: 'resize', cols: calculatedCols, rows: calculatedRows }));
      }
    });
    return () => subscription?.remove();
  }, []);

  const triggerHaptic = useCallback((type: 'light' | 'medium' | 'warning' = 'light') => {
    try {
      if (type === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (type === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (e) {}
  }, []);

  const selectTab = useCallback(
    (tab: 'terminal' | 'power') => {
      triggerHaptic('light');
      if (tab !== 'terminal') Keyboard.dismiss();
      setActiveTab(tab);
    },
    [triggerHaptic]
  );

  // 16ms V-sync aligned batching prevents bridge flooding on bursty output
  const appendOutputChunk = useCallback((chunk: string) => {
    incomingBufferRef.current += chunk;
    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(() => {
        setTerminalText((prev) => {
          const next = prev + incomingBufferRef.current;
          incomingBufferRef.current = '';
          flushTimeoutRef.current = null;
          return next.length > 30000 ? next.slice(-30000) : next;
        });
      }, 16);
    }
  }, []);

  const connect = useCallback(() => {
    if (!isMountedRef.current) return;
    if (!deviceTokenRef.current) return;
    if (
      socketRef.current &&
      (socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const candidateTargets = resolveCandidateTargets(savedHostRef.current, savedRemoteHostRef.current);
    const target = candidateTargets[hostIndexRef.current % candidateTargets.length];
    // Credential travels in the WebSocket subprotocol header, never in the URL.
    const targetUrl = target ? target.wsUrl : `ws://${DEFAULT_BRIDGE_HOST}:${BRIDGE_PORT}`;
    const protocols = [`omarchy-bridge.${deviceTokenRef.current}`];

    setStatus('connecting');

    try {
      const ws = new WebSocket(targetUrl, protocols);
      socketRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setStatus('connected');
        reconnectAttemptRef.current = 0;
        triggerHaptic('light');

        const { width, height } = Dimensions.get('window');
        const calculatedCols = Math.max(45, Math.floor((width - 24) / 7.2));
        const calculatedRows = Math.max(20, Math.floor((height - 200) / 19));
        ws.send(JSON.stringify({ type: 'resize', cols: calculatedCols, rows: calculatedRows }));

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', time: Date.now() }));
          }
        }, 8000);
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'screen' && Array.isArray(msg.lines)) {
            scheduleScreenLines(msg.lines);
          } else if (msg.type === 'init') {
            if (Array.isArray(msg.lines)) scheduleScreenLines(msg.lines);
            if (msg.history) setTerminalText(msg.history);
            if (msg.telemetry) setTelemetry(msg.telemetry);
            if (msg.remote) {
              const remoteValue = normalizeBridgeValue(msg.remote.tunnelUrl || msg.remote.magicDns || msg.remote.ip || '');
              if (remoteValue && remoteValue !== savedRemoteHostRef.current) {
                persistRemoteHost(remoteValue);
                savedRemoteHostRef.current = remoteValue;
                setSavedRemoteHost(remoteValue);
              }
            }
          } else if (msg.type === 'output') {
            appendOutputChunk(msg.data);
          } else if (msg.type === 'telemetry') {
            setTelemetry(msg.data);
          } else if (msg.type === 'action_result') {
            if (msg.result && typeof msg.result.dpmsOn === 'boolean') {
              setTelemetry((prev) => ({ ...(prev || {}), dpmsOn: msg.result.dpmsOn }));
            }
            if (msg.result && typeof msg.result.stealthMode === 'boolean') {
              setTelemetry((prev) => ({ ...(prev || {}), stealthMode: msg.result.stealthMode }));
            }
          } else if (msg.type === 'status' && msg.message) {
            appendOutputChunk(msg.message);
          } else if (msg.type === 'pong' && msg.clientTime) {
            setLatency(Date.now() - msg.clientTime);
          } else if (msg.type === 'cleared') {
            incomingBufferRef.current = '';
            if (flushTimeoutRef.current) {
              clearTimeout(flushTimeoutRef.current);
              flushTimeoutRef.current = null;
            }
            pendingScreenRef.current = null;
            if (screenFrameTimerRef.current) {
              clearTimeout(screenFrameTimerRef.current);
              screenFrameTimerRef.current = null;
            }
            setScreenLines([]);
            setTerminalText('');
          }
        } catch (e) {
          appendOutputChunk(event.data);
        }
      };

      ws.onerror = () => {
        hostIndexRef.current += 1;
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        setStatus('disconnected');
        setLatency(null);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        if (appStateRef.current !== 'active') return;

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        const attempt = reconnectAttemptRef.current++;
        const base = Math.min(500 * Math.pow(2, attempt), 30000);
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (isMountedRef.current && appStateRef.current === 'active') connect();
        }, delay);
      };
    } catch (err) {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (appStateRef.current === 'active') connect();
      }, 1000);
    }
  }, [appendOutputChunk, scheduleScreenLines, triggerHaptic]);

  const teardownSocket = useCallback(() => {
    const ws = socketRef.current;
    socketRef.current = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch (e) {}
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
  }, []);

  // Pause the tunnel while backgrounded, reconnect immediately on foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
      if (state === 'active') {
        if (!deviceTokenRef.current) return;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        reconnectAttemptRef.current = 0;
        connect();
      } else if (state === 'background') {
        teardownSocket();
        setStatus('disconnected');
        setLatency(null);
      }
    });
    return () => sub.remove();
  }, [connect, teardownSocket]);

  const openHostEditor = useCallback(() => {
    Keyboard.dismiss();
    setHostInput(savedHostRef.current || DEFAULT_BRIDGE_HOST);
    setPairError('');
    setHostModalVisible(true);
  }, []);

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
    hostIndexRef.current = 0;
    Keyboard.dismiss();

    teardownSocket();
    setStatus('connecting');
    setLatency(null);
    connect();
  }, [connect, hostInput, teardownSocket]);

  const pairDevice = useCallback(async () => {
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
          hostIndexRef.current = 0;
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
  }, [connect, pairCodeInput, hostInput]);

  const unpairDevice = useCallback(() => {
    clearDeviceToken();
    deviceTokenRef.current = '';
    setDeviceToken('');
    teardownSocket();
    setStatus('disconnected');
    setLatency(null);
  }, [teardownSocket]);

  useEffect(() => {
    isMountedRef.current = true;
    (async () => {
      const token = await readDeviceToken();
      if (!isMountedRef.current) return;
      if (token) {
        deviceTokenRef.current = token;
        setDeviceToken(token);
        connect();
      } else {
        setStatus('disconnected');
      }
    })();

    return () => {
      isMountedRef.current = false;
      if (socketRef.current) socketRef.current.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
      if (screenFrameTimerRef.current) clearTimeout(screenFrameTimerRef.current);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [connect]);

  const sendCommand = useCallback((cmd: string) => {
    try {
      triggerHaptic('light');
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        if (!cmd || cmd.trim() === '') {
          socketRef.current.send(JSON.stringify({ type: 'signal', signal: 'enter' }));
        } else {
          socketRef.current.send(JSON.stringify({ type: 'input', data: cmd }));
          setHistory((prev) => [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 40));
          setHistoryIndex(-1);
        }
      } else {
        connect();
      }
    } catch (e) {
      console.warn('[BRIDGE] sendCommand error intercepted:', e);
    }
  }, [connect, triggerHaptic]);

  const sendSignal = useCallback((signal: string) => {
    try {
      triggerHaptic('medium');
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'signal', signal }));
      }
    } catch (e) {
      console.warn('[BRIDGE] sendSignal error intercepted:', e);
    }
  }, [triggerHaptic]);

  const dispatchAction = (action: string, payload: Record<string, unknown> = {}) => {
    try {
      triggerHaptic('medium');
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'action', action, payload }));
      }
    } catch (e) {
      console.warn('[BRIDGE] dispatchAction error intercepted:', e);
    }
  };

  const clearScreen = useCallback(() => {
    try {
      triggerHaptic('light');
      incomingBufferRef.current = '';
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      pendingScreenRef.current = null;
      if (screenFrameTimerRef.current) {
        clearTimeout(screenFrameTimerRef.current);
        screenFrameTimerRef.current = null;
      }
      setScreenLines([]);
      setTerminalText('');
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'clear' }));
      }
    } catch (e) {
      console.warn('[BRIDGE] clearScreen error intercepted:', e);
    }
  }, [triggerHaptic]);

  const promptConfirmation = useCallback(
    (title: string, description: string, action: string, isDanger: boolean = false) => {
      triggerHaptic('warning');
      setConfirmModal({ visible: true, title, description, action, isDanger });
    },
    [triggerHaptic]
  );

  // Returns the next history entry; the input bar applies it imperatively.
  const nextHistoryValue = useCallback((direction: 'up' | 'down'): string | null => {
    triggerHaptic('light');
    const items = historyRef.current;
    if (items.length === 0) return null;
    const current = historyIndexRef.current;
    if (direction === 'up') {
      const nextIdx = Math.min(current + 1, items.length - 1);
      setHistoryIndex(nextIdx);
      return items[nextIdx] || '';
    }
    const nextIdx = Math.max(current - 1, -1);
    setHistoryIndex(nextIdx);
    return nextIdx === -1 ? '' : items[nextIdx];
  }, [triggerHaptic]);

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
