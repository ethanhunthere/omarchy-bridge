import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Dimensions } from 'react-native';
import {
  BRIDGE_PORT,
  DEFAULT_BRIDGE_HOST,
  normalizeBridgeValue,
  resolveCandidateTargets,
} from '../lib/bridge';
import type { ConnectionStatus, Telemetry } from './types';
import type { HapticKind } from './useHaptics';

interface Options {
  deviceTokenRef: React.MutableRefObject<string>;
  savedHostRef: React.MutableRefObject<string>;
  savedRemoteHostRef: React.MutableRefObject<string>;
  scheduleScreenLines: (lines: string[]) => void;
  appendOutputChunk: (chunk: string) => void;
  setTerminalText: React.Dispatch<React.SetStateAction<string>>;
  setTelemetry: React.Dispatch<React.SetStateAction<Telemetry | null>>;
  patchTelemetry: (patch: Partial<Telemetry>) => void;
  resetOutput: () => void;
  persistRemote: (value: string) => void;
  triggerHaptic: (type?: HapticKind) => void;
}

export function useBridgeConnection(options: Options) {
  const {
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
    triggerHaptic,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [latency, setLatency] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostIndexRef = useRef(0);
  const isMountedRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);

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
                persistRemote(remoteValue);
              }
            }
          } else if (msg.type === 'output') {
            appendOutputChunk(msg.data);
          } else if (msg.type === 'telemetry') {
            setTelemetry(msg.data);
          } else if (msg.type === 'action_result') {
            if (msg.result && typeof msg.result.dpmsOn === 'boolean') {
              patchTelemetry({ dpmsOn: msg.result.dpmsOn });
            }
            if (msg.result && typeof msg.result.stealthMode === 'boolean') {
              patchTelemetry({ stealthMode: msg.result.stealthMode });
            }
          } else if (msg.type === 'status' && msg.message) {
            appendOutputChunk(msg.message);
          } else if (msg.type === 'pong' && msg.clientTime) {
            setLatency(Date.now() - msg.clientTime);
          } else if (msg.type === 'cleared') {
            resetOutput();
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
  }, [
    appendOutputChunk,
    deviceTokenRef,
    patchTelemetry,
    persistRemote,
    resetOutput,
    savedHostRef,
    savedRemoteHostRef,
    scheduleScreenLines,
    setTelemetry,
    setTerminalText,
    triggerHaptic,
  ]);

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
  }, [connect, deviceTokenRef, teardownSocket]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (socketRef.current) socketRef.current.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  const resetHostIndex = useCallback(() => {
    hostIndexRef.current = 0;
  }, []);

  return {
    status,
    latency,
    setStatus,
    setLatency,
    socketRef,
    connect,
    teardownSocket,
    resetHostIndex,
  };
}
