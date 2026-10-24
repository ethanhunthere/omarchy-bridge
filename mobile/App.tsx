import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Dimensions,
  Keyboard,
} from 'react-native';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';

// ==========================================
// 1. Config & Host Discovery
// ==========================================
const BRIDGE_PORT = 19001;
const DEFAULT_BRIDGE_HOST = 'omarchy-bridge.local';
const BRIDGE_HOST_FILENAME = 'omarchy-bridge-host.txt';
const REMOTE_HOST_FILENAME = 'omarchy-bridge-remote.txt';
const DEVICE_TOKEN_KEY = 'omarchy-bridge-device-token';

async function readDeviceToken(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)) || '';
  } catch (e) {
    return '';
  }
}

async function persistDeviceToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
  } catch (e) {}
}

async function clearDeviceToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
  } catch (e) {}
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface LegacyConstants {
  manifest?: { debuggerHost?: string };
  manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
}

function normalizeBridgeHost(raw: string): string {
  let host = (raw || '').trim();
  host = host.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '');
  host = host.split('/')[0];
  host = host.replace(/:\d+$/, '');
  return host;
}

// Accepts both local hosts ("192.168.1.5", "omarchy-bridge.local") and
// remote tunnel URLs ("https://xxx.trycloudflare.com", "wss://...").
function normalizeBridgeValue(raw: string): string {
  const value = (raw || '').trim();
  if (/^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value)) {
    const host = value.replace(/^(https?|wss?):\/\//i, '').split('/')[0];
    return host ? `https://${host}` : '';
  }
  return normalizeBridgeHost(value);
}

interface BridgeTarget {
  kind: 'tunnel' | 'local';
  host: string;
  httpOrigin: string;
  wsUrl: string;
  storageValue: string;
}

function toBridgeTarget(value: string): BridgeTarget | null {
  const normalized = normalizeBridgeValue(value);
  if (!normalized) return null;
  if (normalized.startsWith('https://')) {
    const host = normalized.slice('https://'.length);
    return { kind: 'tunnel', host, httpOrigin: normalized, wsUrl: `wss://${host}`, storageValue: normalized };
  }
  return {
    kind: 'local',
    host: normalized,
    httpOrigin: `http://${normalized}:${BRIDGE_PORT}`,
    wsUrl: `ws://${normalized}:${BRIDGE_PORT}`,
    storageValue: normalized,
  };
}

function readSavedBridgeHost(): string {
  try {
    const file = new File(Paths.document, BRIDGE_HOST_FILENAME);
    if (!file.exists) return '';
    return normalizeBridgeHost(file.textSync());
  } catch (e) {
    return '';
  }
}

function persistBridgeHost(host: string): void {
  try {
    const file = new File(Paths.document, BRIDGE_HOST_FILENAME);
    file.write(host);
  } catch (e) {}
}

function readSavedRemoteHost(): string {
  try {
    const file = new File(Paths.document, REMOTE_HOST_FILENAME);
    if (!file.exists) return '';
    return (file.textSync() || '').trim();
  } catch (e) {
    return '';
  }
}

function persistRemoteHost(host: string): void {
  try {
    const file = new File(Paths.document, REMOTE_HOST_FILENAME);
    file.write(host);
  } catch (e) {}
}

// Candidate order: user override -> Cloudflare tunnel (primary remote path)
// -> dev host -> mDNS. Tailscale stays a commented server-side option.
function resolveCandidateTargets(savedHost = '', remoteHost = '', manualHost = ''): BridgeTarget[] {
  const targets: BridgeTarget[] = [];
  const add = (candidate?: string | null) => {
    const target = toBridgeTarget(candidate || '');
    if (target && !targets.some((t) => t.wsUrl === target.wsUrl)) targets.push(target);
  };

  add(savedHost);
  add(remoteHost);

  const extraHost = (Constants.expoConfig?.extra as { bridgeHost?: string } | undefined)?.bridgeHost;
  add(extraHost);

  const legacyConstants = Constants as unknown as LegacyConstants;
  const hostUri =
    Constants.expoConfig?.hostUri ||
    legacyConstants.manifest?.debuggerHost ||
    legacyConstants.manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const detectedIp = hostUri.split(':')[0];
    if (detectedIp && detectedIp !== 'localhost' && detectedIp !== '127.0.0.1') {
      add(detectedIp);
    }
  }

  add(DEFAULT_BRIDGE_HOST);
  add(manualHost);
  return targets;
}

// ==========================================
// 2. High-Speed ANSI Color Translator
// ==========================================
interface StyledSegment {
  text: string;
  color?: string;
  bold?: boolean;
}

const ANSI_COLOR_MAP: Record<number, string> = {
  30: '#71717a',
  31: '#ef4444',
  32: '#22c55e',
  33: '#eab308',
  34: '#3b82f6',
  35: '#a855f7',
  36: '#06b6d4',
  37: '#f4f4f5',
  90: '#52525b',
  91: '#f87171',
  92: '#4ade80',
  93: '#fde047',
  94: '#60a5fa',
  95: '#c084fc',
  96: '#22d3ee',
  97: '#ffffff',
};

function parseAnsi(rawText: string): StyledSegment[] {
  const sanitized = rawText
    .replace(/\x1b\[\?1049[hl]/g, '')
    .replace(/\x1b\[\?25[hl]/g, '')
    .replace(/\x1b\[2J/g, '\n')
    .replace(/\x1b\[H/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, (match) => {
      return match.endsWith('m') ? match : '';
    });

  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  const segments: StyledSegment[] = [];

  let lastIndex = 0;
  let currentColor = '#e4e4e7';
  let isBold = false;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(sanitized)) !== null) {
    const textChunk = sanitized.substring(lastIndex, match.index);
    if (textChunk) {
      segments.push({ text: textChunk, color: currentColor, bold: isBold });
    }

    const codeStr = match[1] || '0';
    const codes = codeStr.split(';').map((c) => parseInt(c, 10) || 0);

    for (const code of codes) {
      if (code === 0) {
        currentColor = '#e4e4e7';
        isBold = false;
      } else if (code === 1) {
        isBold = true;
      } else if (ANSI_COLOR_MAP[code]) {
        currentColor = ANSI_COLOR_MAP[code];
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = sanitized.substring(lastIndex);
  if (remaining) {
    segments.push({ text: remaining, color: currentColor, bold: isBold });
  }

  return segments;
}

function renderStyledLine(line: string): React.ReactNode {
  if (!line || line.trim() === '') {
    return <Text style={styles.textMuted}>{' '}</Text>;
  }

  // 1. Starship prompt line: "~ ❯ cmd" or "❯ cmd"
  if (line.includes(' ❯ ') || line.startsWith('❯ ') || line.startsWith('~ ❯')) {
    const parts = line.split(/(❯)/);
    return (
      <Text>
        <Text style={styles.promptPath}>{parts[0]}</Text>
        <Text style={styles.promptArrow}>❯</Text>
        <Text style={styles.promptCmd}>{parts.slice(2).join('')}</Text>
      </Text>
    );
  }

  // 2. Failed exit code Starship prompt: "~ ✗ cmd"
  if (line.includes(' ✗ ') || line.startsWith('✗ ') || line.startsWith('~ ✗')) {
    const parts = line.split(/(✗)/);
    return (
      <Text>
        <Text style={styles.promptPath}>{parts[0]}</Text>
        <Text style={styles.promptFail}>✗</Text>
        <Text style={styles.promptCmd}>{parts.slice(2).join('')}</Text>
      </Text>
    );
  }

  // 3. Antigravity prompt: ">" or "> "
  if (line.startsWith('>') || line.startsWith(' > ')) {
    return (
      <Text>
        <Text style={styles.promptArrow}>&gt; </Text>
        <Text style={styles.textWhite}>{line.replace(/^>\s*/, '')}</Text>
      </Text>
    );
  }

  // 4. Antigravity logo characters (▄▀)
  if (line.includes('▄▀') || line.includes('▀▀')) {
    return <Text style={styles.logoText}>{line}</Text>;
  }

  // 5. Section dividers (───)
  if (/^[─━\-_=]{3,}$/.test(line.trim())) {
    return <Text style={styles.dividerLine}>{line}</Text>;
  }

  // 6. Errors or failures
  if (/^(error|fatal|fail|exception):/i.test(line.trim()) || line.includes('error:')) {
    return <Text style={styles.textRed}>{line}</Text>;
  }

  // 7. Warnings or notices
  if (/^(warning|notice):/i.test(line.trim())) {
    return <Text style={styles.textAmber}>{line}</Text>;
  }

  // 8. Success / Pass
  if (/^(\[PASS\]|success)/i.test(line.trim())) {
    return <Text style={styles.textGreen}>{line}</Text>;
  }

  // 9. Status bar (e.g. "? for shortcuts ... Gemini")
  if (line.includes('? for shortcuts') || line.includes('Gemini')) {
    return <Text style={styles.statusBarText}>{line}</Text>;
  }

  // 10. Default clean text
  return <Text style={styles.textNormal}>{line}</Text>;
}

// ==========================================
// 2.5 Line-Level Memoization & Pure Cache
// ==========================================
const styledLineCache = new Map<string, React.ReactNode>();
const MAX_STYLED_LINE_CACHE = 500;

function getCachedStyledLine(line: string): React.ReactNode {
  let cached = styledLineCache.get(line);
  if (cached === undefined) {
    if (styledLineCache.size >= MAX_STYLED_LINE_CACHE) {
      let count = 0;
      for (const key of styledLineCache.keys()) {
        styledLineCache.delete(key);
        if (++count >= 100) break;
      }
    }
    cached = renderStyledLine(line);
    styledLineCache.set(line, cached);
  }
  return cached;
}

const MemoizedTerminalLine = React.memo(
  function MemoizedTerminalLine({ line }: { line: string }) {
    return (
      <Text style={styles.terminalLine} selectable>
        {getCachedStyledLine(line)}
      </Text>
    );
  },
  (prev, next) => prev.line === next.line
);

const ConnectionPill = React.memo(function ConnectionPill({
  latency,
  status,
  paired,
  onPress,
}: {
  latency: number | null;
  status: 'connected' | 'connecting' | 'disconnected';
  paired: boolean;
  onPress: () => void;
}) {
  const isOffline = status === 'disconnected';
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
      style={[styles.latencyPill, isOffline && styles.latencyPillOffline]}
      testID="connection-pill"
    >
      <Text style={[styles.latencyText, isOffline && styles.latencyTextOffline]}>{label}</Text>
    </TouchableOpacity>
  );
});

// ==========================================
// 2.8 Resilient Crash Interceptor (ErrorBoundary)
// ==========================================
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CRITICAL] Unhandled UI error caught by ErrorBoundary:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.errorContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0a0b0d" />
          <View style={styles.errorCard}>
            <Text style={styles.errorBadge}>CRASH INTERCEPTED</Text>
            <Text style={styles.errorTitle}>Session Recovered</Text>
            <Text style={styles.errorDesc}>
              {this.state.error?.message || 'An unexpected rendering anomaly occurred and was safely caught.'}
            </Text>
            <TouchableOpacity style={styles.errorReloadBtn} onPress={this.handleReload} activeOpacity={0.8}>
              <Text style={styles.errorReloadText}>RELOAD BRIDGE</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ==========================================
// 3. Main Industrial Minimalist Component
// ==========================================
export default function App() {
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

  // Connection State
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [latency, setLatency] = useState<number | null>(null);

  // Terminal State
  const [screenLines, setScreenLines] = useState<string[]>([]);
  const [terminalText, setTerminalText] = useState<string>('');
  const [inputCommand, setInputCommand] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);

  // Telemetry
  const [telemetry, setTelemetry] = useState<{
    cpuPercent?: number;
    cpuTemp?: number | null;
    memory?: { usedGb: string; totalGb: string; percent: number };
    battery?: { level: number; status: string; ac: boolean };
    netSpeed?: { rxKbps: number; txKbps: number };
    stealthMode?: boolean;
    dpmsOn?: boolean;
    uptimeSeconds?: number;
  } | null>(null);

  // Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    title: string;
    description: string;
    action: string;
    isDanger: boolean;
  }>({
    visible: false,
    title: '',
    description: '',
    action: '',
    isDanger: false,
  });

  // Low-latency Refs
  const socketRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const incomingBufferRef = useRef('');
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostIndexRef = useRef(0);
  const isMountedRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);

  // Track keyboard visibility and handle background touch to dismiss keyboard
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Sync terminal dimensions dynamically on screen rotation / size changes
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

  const handleTerminalPress = useCallback(() => {
    if (isKeyboardVisible || isInputFocused) {
      Keyboard.dismiss();
    } else {
      inputRef.current?.focus();
    }
  }, [isKeyboardVisible, isInputFocused]);

  const triggerHaptic = (type: 'light' | 'medium' | 'warning' = 'light') => {
    try {
      if (type === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (type === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (e) {}
  };

  // Ultra-responsive 16ms V-sync aligned batching prevents React Native bridge flooding
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
        }, 3000);
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'screen' && Array.isArray(msg.lines)) {
            setScreenLines(msg.lines);
          } else if (msg.type === 'init') {
            if (Array.isArray(msg.lines)) setScreenLines(msg.lines);
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

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) connect();
        }, 2000);
      };
    } catch (err) {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    }
  }, [appendOutputChunk]);

  const openHostEditor = useCallback(() => {
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

    setStatus('connecting');
    setLatency(null);
    connect();
  }, [connect, hostInput]);

  const pairDevice = useCallback(async () => {
    const code = pairCodeInput.trim();
    const name = Constants.deviceName || 'iPhone';
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
    setStatus('disconnected');
    setLatency(null);
  }, []);

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
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [connect]);

  const sendCommand = (cmd: string = inputCommand) => {
    try {
      triggerHaptic('light');
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        if (!cmd || cmd.trim() === '') {
          socketRef.current.send(JSON.stringify({ type: 'signal', signal: 'enter' }));
        } else {
          socketRef.current.send(JSON.stringify({ type: 'input', data: cmd }));
          setHistory((prev) => [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 40));
          setHistoryIndex(-1);
          setInputCommand('');
        }
      } else {
        connect();
      }
    } catch (e) {
      console.warn('[BRIDGE] sendCommand error intercepted:', e);
    }
  };

  const sendSignal = (signal: string) => {
    try {
      triggerHaptic('medium');
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'signal', signal }));
      }
    } catch (e) {
      console.warn('[BRIDGE] sendSignal error intercepted:', e);
    }
  };

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

  const clearScreen = () => {
    try {
      triggerHaptic('light');
      incomingBufferRef.current = '';
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      setScreenLines([]);
      setTerminalText('');
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'clear' }));
      }
    } catch (e) {
      console.warn('[BRIDGE] clearScreen error intercepted:', e);
    }
  };

  const promptConfirmation = (title: string, description: string, action: string, isDanger: boolean = false) => {
    triggerHaptic('warning');
    setConfirmModal({ visible: true, title, description, action, isDanger });
  };

  const handleHistoryNav = (direction: 'up' | 'down') => {
    triggerHaptic('light');
    if (history.length === 0) return;
    if (direction === 'up') {
      const nextIdx = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIdx);
      setInputCommand(history[nextIdx] || '');
    } else {
      const nextIdx = Math.max(historyIndex - 1, -1);
      setHistoryIndex(nextIdx);
      setInputCommand(nextIdx === -1 ? '' : history[nextIdx]);
    }
    inputRef.current?.focus();
  };

  const parsedSegments = useMemo(() => {
    if (screenLines.length > 0 || !terminalText) return [];
    return parseAnsi(terminalText);
  }, [screenLines.length, terminalText]);

  const renderedScreenLines = useMemo(() => {
    return screenLines.map((line, idx) => (
      <MemoizedTerminalLine key={idx} line={line} />
    ));
  }, [screenLines]);

  const renderedParsedSegments = useMemo(() => {
    return parsedSegments.map((seg, idx) => (
      <Text
        key={idx}
        style={{
          color: seg.color || '#e4e4e7',
          fontWeight: seg.bold ? '700' : '400',
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        {seg.text}
      </Text>
    ));
  }, [parsedSegments]);

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0b0d" />

      {/* Centered Premium Glassy Header Bar */}
      <View style={styles.header}>
        {/* Centered Glassy Segmented Tabs */}
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[styles.segmentBtn, activeTab === 'terminal' && styles.segmentBtnActive]}
            onPress={() => {
              triggerHaptic('light');
              setActiveTab('terminal');
            }}
          >
            <Text style={[styles.segmentText, activeTab === 'terminal' && styles.segmentTextActive]}>
              TERMINAL
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, activeTab === 'power' && styles.segmentBtnActive]}
            onPress={() => {
              triggerHaptic('light');
              setActiveTab('power');
            }}
          >
            <Text style={[styles.segmentText, activeTab === 'power' && styles.segmentTextActive]}>
              POWER
            </Text>
          </TouchableOpacity>
        </View>

        <ConnectionPill latency={latency} status={status} paired={!!deviceToken} onPress={openHostEditor} />
      </View>

      {/* ==================================================== */}
      {/* VIEW 1: TERMINAL                                     */}
      {/* ==================================================== */}
      {activeTab === 'terminal' && (
        <KeyboardAvoidingView
          style={styles.flexOne}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <View style={styles.flexOne}>
            <ScrollView
              ref={scrollViewRef}
              style={styles.terminalViewport}
              contentContainerStyle={styles.terminalContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onContentSizeChange={() => {
                if (autoScroll) {
                  if (scrollRafRef.current !== null) {
                    cancelAnimationFrame(scrollRafRef.current);
                  }
                  scrollRafRef.current = requestAnimationFrame(() => {
                    scrollRafRef.current = null;
                    scrollViewRef.current?.scrollToEnd({ animated: false });
                  });
                }
              }}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPress={handleTerminalPress}
                style={styles.touchableTerminal}
              >
                {screenLines.length === 0 && !terminalText ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyPrompt}>[omarchy-remote ready]</Text>
                    <Text style={styles.emptySub}>Tap anywhere to start typing...</Text>
                  </View>
                ) : screenLines.length > 0 ? (
                  renderedScreenLines
                ) : (
                  renderedParsedSegments
                )}
              </TouchableOpacity>
            </ScrollView>

            {/* Keycap Ribbon (pinned above keyboard) */}
            <View style={styles.keycapRibbon}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.ribbonScroll}
                keyboardShouldPersistTaps="handled"
              >
                <TouchableOpacity style={[styles.keycap, styles.keycapCtrlC]} onPress={() => sendSignal('ctrl_c')}>
                  <Text style={styles.keycapCtrlCText}>Ctrl+C</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.keycap, styles.keycapCtrlD]} onPress={() => sendSignal('ctrl_d')}>
                  <Text style={styles.keycapCtrlDText}>Ctrl+D</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keycap} onPress={() => sendSignal('esc')}>
                  <Text style={styles.keycapText}>ESC</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keycap} onPress={() => sendSignal('tab')}>
                  <Text style={styles.keycapText}>TAB</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keycap} onPress={() => handleHistoryNav('up')}>
                  <Text style={styles.keycapText}>▲</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keycap} onPress={() => handleHistoryNav('down')}>
                  <Text style={styles.keycapText}>▼</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.keycap, styles.keycapEnter]} onPress={() => sendSignal('enter')}>
                  <Text style={styles.keycapEnterText}>Enter ↵</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.keycap, styles.keycapTool]}
                  onPress={() => {
                    setInputCommand('agy');
                    inputRef.current?.focus();
                  }}
                >
                  <Text style={styles.keycapToolText}>agy</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keycap} onPress={clearScreen}>
                  <Text style={styles.keycapText}>clear</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.keycap, autoScroll ? styles.keycapAutoScroll : {}]}
                  onPress={() => {
                    triggerHaptic('light');
                    setAutoScroll((p) => !p);
                  }}
                >
                  <Text style={styles.keycapText}>{autoScroll ? 'SCROLL: ON' : 'SCROLL: FREE'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>

            {/* High-Visibility Floating Input Bar */}
            <View style={[styles.inputBar, isInputFocused && styles.inputBarFocused]}>
              <Text style={[styles.promptChar, isInputFocused && styles.promptCharFocused]}>❯</Text>
              <TextInput
                ref={inputRef}
                style={[styles.inputField, isInputFocused && styles.inputFieldFocused]}
                value={inputCommand}
                onChangeText={setInputCommand}
                onFocus={() => {
                  setIsInputFocused(true);
                  if (autoScroll) {
                    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 150);
                  }
                }}
                onBlur={() => setIsInputFocused(false)}
                placeholder="Type command or prompt..."
                placeholderTextColor="#52525b"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardAppearance="dark"
                returnKeyType="send"
                onSubmitEditing={() => sendCommand()}
              />
              {inputCommand.length > 0 && (
                <TouchableOpacity style={styles.clearInputBtn} onPress={() => setInputCommand('')}>
                  <Text style={styles.clearInputText}>✕</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.sendBtn, status === 'connected' ? styles.sendBtnActive : styles.sendBtnDisabled]}
                onPress={() => sendCommand()}
              >
                <Text style={styles.sendBtnText}>{inputCommand.trim() ? 'SEND' : '↵'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* ==================================================== */}
      {/* VIEW 2: MACHINE POWER & HARDWARE                     */}
      {/* ==================================================== */}
      {activeTab === 'power' && (
        <ScrollView
          style={styles.powerView}
          contentContainerStyle={styles.powerViewContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Status HUD Header */}
          <View style={styles.hudContainer}>
            <View style={styles.hudCol}>
              <Text style={styles.hudTitle}>CPU LOAD</Text>
              <Text style={styles.hudStat}>{telemetry?.cpuPercent !== undefined ? `${telemetry.cpuPercent}%` : '--'}</Text>
              <Text style={styles.hudSub}>{telemetry?.cpuTemp ? `${telemetry.cpuTemp}°C` : 'Normal'}</Text>
            </View>

            <View style={styles.hudDivider} />

            <View style={styles.hudCol}>
              <Text style={styles.hudTitle}>RAM</Text>
              <Text style={styles.hudStat}>
                {telemetry?.memory ? `${telemetry.memory.usedGb}G` : '--'}
              </Text>
              <Text style={styles.hudSub}>
                {telemetry?.memory ? `of ${telemetry.memory.totalGb}G (${telemetry.memory.percent}%)` : '--'}
              </Text>
            </View>

            <View style={styles.hudDivider} />

            <View style={styles.hudCol}>
              <Text style={styles.hudTitle}>BATTERY</Text>
              <Text style={styles.hudStat}>
                {telemetry?.battery ? `${telemetry.battery.level}%` : '--'}
              </Text>
              <Text style={styles.hudSub}>{telemetry?.battery?.ac ? 'AC Connected' : 'Discharging'}</Text>
            </View>
          </View>

          {/* Active System Controls */}
          <View style={styles.groupHeaderRow}>
            <Text style={styles.groupHeading}>SYSTEM CONTROLS</Text>
            <Text style={styles.profileBadge}>WI-FI SAFE</Text>
          </View>

          {/* Suspend / Sleep (Primary Safe Option for Laptops) */}
          <TouchableOpacity
            style={[styles.powerCard, styles.powerCardPrimary]}
            testID="suspend-btn"
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

          {/* Stealth Display Mode */}
          <TouchableOpacity
            testID="stealth-mode-btn"
            accessibilityLabel="STEALTH MODE"
            style={[styles.powerCard, telemetry?.stealthMode ? styles.powerCardActive : {}]}
            onPress={() => dispatchAction('stealth_toggle')}
          >
            <View style={styles.cardHeader}>
              <Text style={telemetry?.stealthMode ? styles.cardLabelActive : styles.cardLabel}>
                {telemetry?.stealthMode ? 'STEALTH MODE: ACTIVE' : 'STEALTH MODE'}
              </Text>
              <Text style={styles.cmdBadge}>
                {telemetry?.stealthMode ? 'hyprctl dpms on' : 'hyprctl dpms off'}
              </Text>
            </View>
            <Text style={styles.cardDesc}>
              {telemetry?.stealthMode
                ? 'Physical screen is blacked out; systemd-inhibit blocks idle sleep.'
                : 'Turn off physical monitor while keeping background tasks running.'}
            </Text>
          </TouchableOpacity>

          {/* Lock Screen */}
          <TouchableOpacity
            testID="lock-screen-btn"
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

          {/* Bridge Host & Auto-Discovery */}
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
            <TouchableOpacity style={styles.hostEditBtn} onPress={openHostEditor} activeOpacity={0.8}>
              <Text style={styles.hostEditText}>CHANGE HOST</Text>
            </TouchableOpacity>
          </View>

          {/* Wi-Fi Profile Safety Notice */}
          <View style={styles.safetyNoticeCard}>
            <Text style={styles.safetyNoticeTitle}>REMOTE WI-FI PROFILE</Text>
            <Text style={styles.safetyNoticeText}>
              Unused high-risk poweroff, reboot, and Wake-on-LAN controls are excluded to prevent remote session disconnection on wireless hardware.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Bridge Host Editor */}
      <Modal visible={hostModalVisible} transparent animationType="fade" testID="host-modal">
        <KeyboardAvoidingView
          style={styles.modalKav}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            testID="host-backdrop"
            onPress={Keyboard.dismiss}
          >
            <View
              style={styles.dialogCard}
              onStartShouldSetResponder={() => {
                Keyboard.dismiss();
                return true;
              }}
            >
              <ScrollView
                style={styles.dialogScroll}
                contentContainerStyle={styles.dialogScrollContent}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
              >
              <Text style={styles.dialogTitle}>Bridge Host</Text>
              <Text style={styles.dialogMessage}>
                Auto-discovers the PC as "{DEFAULT_BRIDGE_HOST}". If your network blocks mDNS, enter the PC's LAN IP.
              </Text>
              <Text style={styles.fieldLabel}>Bridge host</Text>
              <TextInput
                style={[styles.hostInput, styles.fieldInput]}
                value={hostInput}
                onChangeText={setHostInput}
                placeholder={DEFAULT_BRIDGE_HOST}
                placeholderTextColor="#52525b"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardAppearance="dark"
                returnKeyType="done"
                onSubmitEditing={applyBridgeHost}
                testID="host-input"
              />

              <View style={styles.modalDivider} />

              {deviceToken ? (
                <View>
                  <Text style={styles.dialogTitle}>Device Paired</Text>
                  <Text style={styles.dialogMessage}>This device holds its own key in the OS keychain.</Text>
                  <TouchableOpacity style={styles.dialogBtnSecondary} testID="unpair-btn" onPress={unpairDevice}>
                    <Text style={styles.dialogBtnSecondaryText}>Forget This Device</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <Text style={styles.dialogTitle}>Pair This Device</Text>
                  <Text style={styles.dialogMessage}>Get the newest code from the PC terminal:</Text>
                  <Text style={styles.commandBlock}>journalctl --user -u omarchy-bridge | grep PAIRING</Text>
                  <Text style={styles.fieldLabel}>Pairing code</Text>
                  <TextInput
                    style={[styles.hostInput, styles.fieldInput]}
                    value={pairCodeInput}
                    onChangeText={(text) => {
                      const cleaned = text.replace(/\D/g, '').slice(0, 6);
                      setPairCodeInput(cleaned);
                      if (cleaned.length === 6) Keyboard.dismiss();
                    }}
                    placeholder="6-digit code"
                    placeholderTextColor="#52525b"
                    keyboardType="number-pad"
                    maxLength={6}
                    keyboardAppearance="dark"
                    testID="pair-code-input"
                  />
                  {pairError ? <Text style={styles.pairError}>{pairError}</Text> : null}
                </View>
              )}
            </ScrollView>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.dialogBtnSecondary}
                testID="host-cancel-btn"
                onPress={() => setHostModalVisible(false)}
              >
                <Text style={styles.dialogBtnSecondaryText}>Close</Text>
              </TouchableOpacity>

              {deviceToken ? (
                <TouchableOpacity style={styles.dialogBtnPrimary} testID="host-save-btn" onPress={applyBridgeHost}>
                  <Text style={styles.dialogBtnPrimaryText}>Save & Reconnect</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.dialogBtnPrimary}
                  testID="pair-btn"
                  onPress={pairDevice}
                  disabled={pairing}
                >
                  <Text style={styles.dialogBtnPrimaryText}>{pairing ? 'Pairing...' : 'Pair Device'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Industrial Minimal Confirmation Dialog */}
      <Modal visible={confirmModal.visible} transparent animationType="fade" testID="confirmation-modal">
        <View style={styles.modalBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={[styles.dialogTitle, confirmModal.isDanger && styles.textRed]} testID="modal-title">
              {confirmModal.title}
            </Text>
            <Text style={styles.dialogMessage} testID="modal-description">{confirmModal.description}</Text>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.dialogBtnSecondary}
                testID="modal-cancel-btn"
                onPress={() => setConfirmModal((p) => ({ ...p, visible: false }))}
              >
                <Text style={styles.dialogBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dialogBtnPrimary, confirmModal.isDanger ? styles.dialogBtnDanger : {}]}
                testID="modal-execute-btn"
                onPress={() => {
                  dispatchAction(confirmModal.action);
                  setConfirmModal((p) => ({ ...p, visible: false }));
                }}
              >
                <Text style={styles.dialogBtnPrimaryText}>Execute</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
    </ErrorBoundary>
  );
}

// ==========================================
// 4. Styles — Industrial Minimalist Aesthetic
// ==========================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0b0d',
  },
  flexOne: {
    flex: 1,
  },

  // Centered Glassy Header Bar
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0a0b0d',
    borderBottomWidth: 1,
    borderBottomColor: '#171922',
    position: 'relative',
  },
  headerLeft: {
    display: 'none',
  },
  headerTitle: {
    display: 'none',
  },
  latencyPill: {
    position: 'absolute',
    right: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
  },
  latencyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    fontWeight: '600',
    color: '#8e93a4',
  },
  latencyPillOffline: {
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  latencyTextOffline: {
    color: '#f87171',
  },

  // Centered Glassy Segmented Tabs
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(24, 27, 36, 0.75)',
    borderRadius: 20,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  segmentBtn: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#282b37',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  segmentText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#7e8494',
    letterSpacing: 0.8,
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },

  // Terminal Viewport
  terminalViewport: {
    flex: 1,
    backgroundColor: '#0a0b0d',
    paddingHorizontal: 8,
  },
  terminalContent: {
    flexGrow: 1,
    paddingTop: 8,
    paddingBottom: 24,
  },
  touchableTerminal: {
    flex: 1,
    minHeight: '100%',
  },
  terminalText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13.5,
    lineHeight: 20,
    color: '#e4e4e7',
  },
  terminalLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13.5,
    lineHeight: 20,
    color: '#e4e4e7',
    letterSpacing: 0.2,
  },
  promptPath: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  promptArrow: {
    color: '#22c55e',
    fontWeight: '800',
  },
  promptFail: {
    color: '#f87171',
    fontWeight: '800',
  },
  promptCmd: {
    color: '#f4f4f5',
    fontWeight: '600',
  },
  textWhite: {
    color: '#ffffff',
  },
  textNormal: {
    color: '#e4e4e7',
  },
  textMuted: {
    color: '#52525b',
  },
  textRed: {
    color: '#f87171',
  },
  textAmber: {
    color: '#fbbf24',
  },
  textGreen: {
    color: '#4ade80',
  },
  logoText: {
    color: '#818cf8',
    fontWeight: '700',
  },
  dividerLine: {
    color: '#3f3f46',
  },
  statusBarText: {
    color: '#a1a1aa',
    fontSize: 11,
  },
  emptyContainer: {
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPrompt: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    color: '#71717a',
    fontWeight: '700',
  },
  emptySub: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#52525b',
    marginTop: 6,
  },

  // Keycap Ribbon
  keycapRibbon: {
    backgroundColor: '#101116',
    borderTopWidth: 1,
    borderTopColor: '#1e2028',
    paddingVertical: 6,
  },
  ribbonScroll: {
    paddingHorizontal: 8,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  keycap: {
    backgroundColor: '#161820',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#262936',
    minWidth: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keycapText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '600',
    color: '#d4d4d8',
  },
  keycapCtrlC: {
    backgroundColor: '#231518',
    borderColor: '#3e1d23',
  },
  keycapCtrlCText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#f87171',
  },
  keycapCtrlD: {
    backgroundColor: '#261c14',
    borderColor: '#422c1d',
  },
  keycapCtrlDText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#fbbf24',
  },
  keycapEnter: {
    backgroundColor: '#16221c',
    borderColor: '#243c2f',
  },
  keycapEnterText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#4ade80',
  },
  keycapTool: {
    backgroundColor: '#1c1e28',
    borderColor: '#2c3042',
  },
  keycapToolText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  keycapAutoScroll: {
    borderColor: '#3b82f6',
  },

  // High-Visibility Floating Input Bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101116',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e2028',
    gap: 8,
  },
  inputBarFocused: {
    backgroundColor: '#14161f',
    borderTopColor: '#3b82f6',
  },
  promptChar: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 15,
    fontWeight: '800',
    color: '#71717a',
  },
  promptCharFocused: {
    color: '#22c55e',
  },
  inputField: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    color: '#ffffff',
    backgroundColor: '#161820',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#262936',
  },
  inputFieldFocused: {
    borderColor: '#3b82f6',
  },
  clearInputBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  clearInputText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: '#71717a',
    fontWeight: '700',
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 6,
  },
  sendBtnActive: {
    backgroundColor: '#f4f4f5',
  },
  sendBtnDisabled: {
    backgroundColor: '#20222a',
  },
  sendBtnText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#0a0b0d',
  },

  // Power View
  powerView: {
    flex: 1,
    backgroundColor: '#0a0b0d',
  },
  powerViewContent: {
    padding: 14,
    paddingBottom: 40,
  },
  hudContainer: {
    flexDirection: 'row',
    backgroundColor: '#111319',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1d222e',
    padding: 14,
    marginBottom: 18,
  },
  hudCol: {
    flex: 1,
    alignItems: 'center',
  },
  hudDivider: {
    width: 1,
    backgroundColor: '#1d222e',
    marginHorizontal: 8,
  },
  hudTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#717686',
    marginBottom: 4,
    letterSpacing: 1.0,
  },
  hudStat: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 19,
    fontWeight: '800',
    color: '#f4f4f6',
    marginBottom: 2,
  },
  hudSub: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#8e93a4',
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
    color: '#717686',
    letterSpacing: 1.5,
  },
  profileBadge: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9.5,
    fontWeight: '700',
    color: '#38bdf8',
    backgroundColor: '#0c1a24',
    borderColor: '#163b52',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  powerCard: {
    backgroundColor: '#111319',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1d222e',
    padding: 14,
    marginBottom: 10,
  },
  powerCardPrimary: {
    backgroundColor: '#111624',
    borderColor: '#21334f',
  },
  powerCardDanger: {
    backgroundColor: '#181214',
    borderColor: '#351c21',
  },
  powerCardActive: {
    backgroundColor: '#111814',
    borderColor: '#1e3828',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#f4f4f6',
  },
  cardLabelPrimary: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#60a5fa',
  },
  cardLabelActive: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: '#4ade80',
  },
  cmdBadge: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10.5,
    color: '#8b92a5',
    backgroundColor: '#0a0b0f',
    borderColor: '#1d222e',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cardDesc: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
    color: '#949ba8',
    marginTop: 2,
  },
  safetyNoticeCard: {
    backgroundColor: '#0d0f14',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#191c26',
    padding: 12,
    marginTop: 10,
  },
  safetyNoticeTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10.5,
    fontWeight: '700',
    color: '#63687b',
    letterSpacing: 1,
    marginBottom: 4,
  },
  safetyNoticeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11.5,
    color: '#717688',
    lineHeight: 17,
  },

  // Modal
  modalKav: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  dialogCard: {
    backgroundColor: '#12141a',
    borderRadius: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: '#262936',
    width: '100%',
    maxWidth: 420,
    maxHeight: '82%',
  },
  dialogScroll: {
    flexGrow: 0,
  },
  dialogScrollContent: {
    paddingBottom: 2,
  },
  dialogTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16,
    fontWeight: '800',
    color: '#f4f4f5',
    marginBottom: 6,
  },
  dialogMessage: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12.5,
    color: '#a1a1aa',
    lineHeight: 18,
    marginBottom: 12,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  dialogBtnSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: '#1a1c24',
    borderWidth: 1,
    borderColor: '#282a36',
  },
  dialogBtnSecondaryText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#a1a1aa',
  },
  dialogBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: '#f4f4f5',
  },
  dialogBtnDanger: {
    backgroundColor: '#ef4444',
  },
  dialogBtnPrimaryText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#0a0b0d',
  },
  hostEditBtn: {
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2c3042',
    backgroundColor: '#161820',
    alignItems: 'center',
  },
  hostEditText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#cbd5e1',
    letterSpacing: 0.8,
  },
  hostInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    color: '#ffffff',
    backgroundColor: '#161820',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#262936',
  },
  hostHint: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#717688',
    marginTop: 8,
    marginBottom: 16,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#262936',
    marginTop: 4,
    marginBottom: 16,
  },
  fieldLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#717688',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 6,
  },
  fieldInput: {
    marginBottom: 4,
  },
  pairError: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#ef4444',
    marginBottom: 12,
  },
  commandBlock: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#d4d4d8',
    backgroundColor: '#0d0f14',
    borderWidth: 1,
    borderColor: '#262936',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },

  // Resilient Crash Interceptor Styles
  errorContainer: {
    flex: 1,
    backgroundColor: '#0a0b0d',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorCard: {
    backgroundColor: '#12141a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#351c21',
    padding: 20,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  errorBadge: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10.5,
    fontWeight: '800',
    color: '#f87171',
    backgroundColor: '#261417',
    borderWidth: 1,
    borderColor: '#4d1e25',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 12,
    letterSpacing: 1,
  },
  errorTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
  },
  errorDesc: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: '#a1a1aa',
    textAlign: 'center',
    marginBottom: 20,
  },
  errorReloadBtn: {
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  errorReloadText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#0a0b0d',
    letterSpacing: 0.5,
  },
});
