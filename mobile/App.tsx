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
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import Constants from 'expo-constants';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';

// ==========================================
// 1. Zero-Config Endpoint Resolution
// ==========================================
const FIXED_AUTH_TOKEN = 'omarchy-bridge-secure-key-2026';
const BRIDGE_PORT = 19001;

function resolveCandidateHosts(): string[] {
  const hosts: string[] = [];

  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest?.debuggerHost ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const detectedIp = hostUri.split(':')[0];
    if (detectedIp && detectedIp !== 'localhost' && detectedIp !== '127.0.0.1') {
      hosts.push(detectedIp);
    }
  }

  if (!hosts.includes('192.168.1.6')) {
    hosts.push('192.168.1.6');
  }

  return hosts;
}

// ==========================================
// 2. Types & Interfaces
// ==========================================
interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
}

interface TopProcess {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

interface TelemetryData {
  cpuPercent: number;
  cpuCores: number[];
  cpuTemp: number | null;
  memory: { usedGb: string; totalGb: string; percent: number };
  swap: { usedGb: string; totalGb: string; percent: number };
  disk: { totalGb: number; usedGb: number; percent: number };
  battery: { level: number; status: string; ac: boolean };
  netSpeed: { rxKbps: number; txKbps: number };
  topProcesses: TopProcess[];
  uptimeSeconds: number;
  dpmsOn: boolean;
  keepAwake: boolean;
  stealthMode: boolean;
  governor: string;
  powerProfile: string;
  mac: string;
  tmuxSession: string;
  windows: TmuxWindow[];
}

// ==========================================
// 3. xterm.js Inlined HTML Bundle
// ==========================================
const XTERM_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background-color: #07090e; overflow: hidden;
      font-family: Menlo, Monaco, "Courier New", monospace;
    }
    #terminal-container {
      width: 100%; height: 100%; padding: 4px;
    }
    .xterm-viewport {
      overflow-y: auto !important;
    }
  </style>
</head>
<body>
  <div id="terminal-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
  <script>
    var term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      theme: {
        background: '#07090e',
        foreground: '#e2e8f0',
        cursor: '#00ff9d',
        selectionBackground: 'rgba(0, 255, 157, 0.3)',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#f1f5f9',
      },
      allowProposedApi: true,
      convertEol: true
    });
    var fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    fitAddon.fit();

    window.termWrite = function(data) {
      try { term.write(data); } catch(e) {}
    };

    window.termResetAndWrite = function(data) {
      try {
        term.reset();
        term.write(data);
      } catch(e) {}
    };

    window.termFit = function() {
      try {
        fitAddon.fit();
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows
          }));
        }
      } catch(e) {}
    };

    window.addEventListener('resize', window.termFit);
    setTimeout(window.termFit, 200);

    term.onData(function(data) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'input',
          data: data
        }));
      }
    });
  </script>
</body>
</html>
`;

// ==========================================
// 4. Main Application Component
// ==========================================
export default function App() {
  const candidateHosts = useMemo(() => resolveCandidateHosts(), []);
  const [activeTab, setActiveTab] = useState<'terminal' | 'control' | 'vault'>('terminal');
  const [termViewMode, setTermViewMode] = useState<'xterm' | 'reader'>('xterm');

  // Connection State
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [connectedHost, setConnectedHost] = useState<string>('192.168.1.6');
  const [tmuxSession, setTmuxSession] = useState('omarchy-remote');
  const [windows, setWindows] = useState<TmuxWindow[]>([{ index: 1, name: 'terminal', active: true }]);
  const [latency, setLatency] = useState<number | null>(null);

  // Telemetry State
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);

  // Clean Screen Buffer for Reader Mode
  const [cleanScreenLines, setCleanScreenLines] = useState<string[]>([]);

  // Input & Command History
  const [inputCommand, setInputCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // New Window Modal
  const [newWindowModalVisible, setNewWindowModalVisible] = useState(false);
  const [newWindowName, setNewWindowName] = useState('');

  // Screenshot & Modals
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    title: string;
    description: string;
    action: string;
    payload?: any;
    dangerLevel: 'warning' | 'danger';
  }>({
    visible: false,
    title: '',
    description: '',
    action: '',
    dangerLevel: 'warning',
  });

  // Refs
  const socketRef = useRef<WebSocket | null>(null);
  const webViewRef = useRef<WebView | null>(null);
  const pingIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const hostIndexRef = useRef(0);
  const isMountedRef = useRef(true);

  // Haptic feedback helper
  const triggerHaptic = (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' = 'light') => {
    try {
      if (type === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (type === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (type === 'heavy') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      else if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else if (type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (e) {}
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await Clipboard.setStringAsync(text);
      triggerHaptic('success');
      alert(`Copied ${label} to clipboard!`);
    } catch (e) {}
  };

  // ==========================================
  // 5. Stable WebSocket Connection Loop
  // ==========================================
  const connect = useCallback(() => {
    if (!isMountedRef.current) return;

    if (
      socketRef.current &&
      (socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const currentHost = candidateHosts[hostIndexRef.current % candidateHosts.length] || '192.168.1.6';
    setConnectedHost(currentHost);
    const targetUrl = `ws://${currentHost}:${BRIDGE_PORT}?token=${encodeURIComponent(FIXED_AUTH_TOKEN)}`;

    setStatus('connecting');

    try {
      const ws = new WebSocket(targetUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setStatus('connected');
        triggerHaptic('success');

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

          if (msg.type === 'output') {
            // Forward raw PTY chunk to xterm.js inside WebView
            webViewRef.current?.injectJavaScript(`window.termWrite(${JSON.stringify(msg.data)}); true;`);
          } else if (msg.type === 'screen') {
            setCleanScreenLines(msg.lines || []);
          } else if (msg.type === 'telemetry') {
            setTelemetry(msg.data);
            if (msg.data?.windows) setWindows(msg.data.windows);
          } else if (msg.type === 'windows') {
            setWindows(msg.data || []);
          } else if (msg.type === 'init') {
            if (msg.session?.tmux) setTmuxSession(msg.session.tmux);
            if (msg.history) {
              webViewRef.current?.injectJavaScript(`window.termResetAndWrite(${JSON.stringify(msg.history)}); true;`);
            }
            if (msg.screen) setCleanScreenLines(msg.screen);
            if (msg.telemetry) setTelemetry(msg.telemetry);
            if (msg.windows) setWindows(msg.windows);
          } else if (msg.type === 'status' && msg.message) {
            webViewRef.current?.injectJavaScript(`window.termWrite(${JSON.stringify(msg.message)}); true;`);
          } else if (msg.type === 'pong' && msg.clientTime) {
            setLatency(Date.now() - msg.clientTime);
          } else if (msg.type === 'cleared') {
            webViewRef.current?.injectJavaScript(`window.termResetAndWrite(''); true;`);
            setCleanScreenLines([]);
          } else if (msg.type === 'action_result' && msg.action === 'screenshot') {
            if (msg.result?.base64) {
              setScreenshotUri(`data:image/jpeg;base64,${msg.result.base64}`);
            }
            setScreenshotLoading(false);
          }
        } catch (e) {
          webViewRef.current?.injectJavaScript(`window.termWrite(${JSON.stringify(event.data)}); true;`);
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
        }, 2500);
      };
    } catch (err) {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connect, 2500);
    }
  }, [candidateHosts]);

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  // ==========================================
  // 6. Action & Signal Dispatchers
  // ==========================================
  const sendCommand = (cmd: string = inputCommand) => {
    triggerHaptic('light');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      if (!cmd || cmd.trim() === '') {
        socketRef.current.send(JSON.stringify({ type: 'signal', signal: 'enter' }));
      } else {
        socketRef.current.send(JSON.stringify({ type: 'input', data: cmd }));
        setHistory((prev) => [cmd, ...prev.slice(0, 50)]);
        setHistoryIndex(-1);
        setInputCommand('');
      }
    } else {
      connect();
    }
  };

  const sendSignal = (signal: string) => {
    triggerHaptic('medium');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'signal', signal }));
    }
  };

  const dispatchAction = (action: string, payload: any = {}) => {
    triggerHaptic('light');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'action', action, payload }));
    }
  };

  const switchWindow = (index: number) => {
    triggerHaptic('light');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'window_switch', index }));
    }
  };

  const createNewWindow = () => {
    triggerHaptic('success');
    const name = newWindowName.trim() || 'term';
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'window_new', name }));
    }
    setNewWindowName('');
    setNewWindowModalVisible(false);
  };

  const closeWindow = (index: number) => {
    triggerHaptic('warning');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'window_close', index }));
    }
  };

  const clearScreen = () => {
    triggerHaptic('light');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'clear' }));
    }
  };

  const triggerScreenshot = () => {
    triggerHaptic('light');
    setScreenshotLoading(true);
    dispatchAction('screenshot');
  };

  const promptConfirmation = (
    title: string,
    description: string,
    action: string,
    dangerLevel: 'warning' | 'danger' = 'warning',
    payload: any = {}
  ) => {
    triggerHaptic('warning');
    setConfirmModal({
      visible: true,
      title,
      description,
      action,
      payload,
      dangerLevel,
    });
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
  };

  const formatUptime = (sec: number) => {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#07090e" />

      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.statusDot,
              status === 'connected' && styles.statusConnected,
              status === 'connecting' && styles.statusConnecting,
              status === 'disconnected' && styles.statusDisconnected,
            ]}
          />
          <Text style={styles.headerTitle}>
            {status === 'connected'
              ? tmuxSession.toUpperCase()
              : status === 'connecting'
              ? 'CONNECTING...'
              : 'RECONNECTING...'}
          </Text>
          {latency !== null && <Text style={styles.latencyText}>{latency}ms</Text>}
        </View>

        {/* Tab Switcher Pills */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'terminal' && styles.tabButtonActive]}
            onPress={() => {
              triggerHaptic('light');
              setActiveTab('terminal');
            }}
          >
            <Text style={[styles.tabButtonText, activeTab === 'terminal' && styles.tabButtonTextActive]}>
              TERMINAL
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'control' && styles.tabButtonActive]}
            onPress={() => {
              triggerHaptic('light');
              setActiveTab('control');
            }}
          >
            <Text style={[styles.tabButtonText, activeTab === 'control' && styles.tabButtonTextActive]}>
              CONTROL
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'vault' && styles.tabButtonActive]}
            onPress={() => {
              triggerHaptic('light');
              setActiveTab('vault');
            }}
          >
            <Text style={[styles.tabButtonText, activeTab === 'vault' && styles.tabButtonTextActive]}>
              VAULT
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ==================================================== */}
      {/* TAB 1: TERMINAL STUDIO                               */}
      {/* ==================================================== */}
      {activeTab === 'terminal' && (
        <View style={styles.flexOne}>
          {/* Subheader: Mode Toggle & Tmux Window Pills */}
          <View style={styles.terminalSubheader}>
            <View style={styles.viewModeToggle}>
              <TouchableOpacity
                style={[styles.viewModeBtn, termViewMode === 'xterm' && styles.viewModeBtnActive]}
                onPress={() => {
                  triggerHaptic('light');
                  setTermViewMode('xterm');
                  setTimeout(() => webViewRef.current?.injectJavaScript('window.termFit(); true;'), 100);
                }}
              >
                <Text style={[styles.viewModeText, termViewMode === 'xterm' && styles.viewModeTextActive]}>
                  ⚡ XTERM
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewModeBtn, termViewMode === 'reader' && styles.viewModeBtnActive]}
                onPress={() => {
                  triggerHaptic('light');
                  setTermViewMode('reader');
                  if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                    socketRef.current.send(JSON.stringify({ type: 'get_screen' }));
                  }
                }}
              >
                <Text style={[styles.viewModeText, termViewMode === 'reader' && styles.viewModeTextActive]}>
                  📖 READER
                </Text>
              </TouchableOpacity>
            </View>

            {/* Tmux Window Switcher Pills */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.windowPillsScroll}>
              {windows.map((win) => (
                <TouchableOpacity
                  key={win.index}
                  style={[styles.windowPill, win.active && styles.windowPillActive]}
                  onPress={() => switchWindow(win.index)}
                >
                  <Text style={[styles.windowPillText, win.active && styles.windowPillTextActive]}>
                    #{win.index} {win.name}
                  </Text>
                  {windows.length > 1 && win.active && (
                    <TouchableOpacity
                      onPress={() =>
                        promptConfirmation(
                          `Close Window #${win.index}`,
                          `Kill tmux window "${win.name}"? Running processes inside this window will exit.`,
                          'window_close',
                          'warning',
                          { index: win.index }
                        )
                      }
                      style={styles.closeWinBtn}
                    >
                      <Text style={styles.closeWinText}>×</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.newWinBtn}
                onPress={() => {
                  triggerHaptic('light');
                  setNewWindowModalVisible(true);
                }}
              >
                <Text style={styles.newWinText}>+ NEW</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Terminal Viewport */}
          {termViewMode === 'xterm' ? (
            <View style={styles.flexOne}>
              <WebView
                ref={webViewRef}
                originWhitelist={['*']}
                source={{ html: XTERM_HTML }}
                style={styles.webview}
                javaScriptEnabled
                domStorageEnabled
                onMessage={(event) => {
                  try {
                    const data = JSON.parse(event.nativeEvent.data);
                    if (data.type === 'input') {
                      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({ type: 'raw', data: data.data }));
                      }
                    } else if (data.type === 'resize') {
                      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({ type: 'resize', cols: data.cols, rows: data.rows }));
                      }
                    }
                  } catch (e) {}
                }}
              />
            </View>
          ) : (
            <ScrollView style={styles.readerContainer} contentContainerStyle={styles.readerContent}>
              <View style={styles.readerCard}>
                <Text style={styles.readerHeader}>VIRTUAL SCREEN BUFFER (@xterm/headless)</Text>
                {cleanScreenLines.length > 0 ? (
                  cleanScreenLines.map((line, idx) => (
                    <Text key={idx} style={styles.readerLine}>
                      {line}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.readerEmpty}>Screen buffer initialized. Run a command below.</Text>
                )}
              </View>
            </ScrollView>
          )}

          {/* Terminal Input Bar & Keyboard Ribbons */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
          >
            <View style={styles.controlBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controlScroll}>
                <TouchableOpacity style={[styles.keyButton, styles.dangerKey]} onPress={() => sendSignal('ctrl_c')}>
                  <Text style={styles.dangerKeyText}>Ctrl+C</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.keyButton, styles.warningKey]} onPress={() => sendSignal('ctrl_d')}>
                  <Text style={styles.warningKeyText}>Ctrl+D</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.keyButton, styles.specialKey]} onPress={() => sendSignal('esc')}>
                  <Text style={styles.specialKeyText}>ESC</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendSignal('tab')}>
                  <Text style={styles.keyButtonText}>TAB</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.keyButton}
                  onPress={() => {
                    sendSignal('arrow_up');
                    handleHistoryNav('up');
                  }}
                >
                  <Text style={styles.arrowKeyText}>▲</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.keyButton}
                  onPress={() => {
                    sendSignal('arrow_down');
                    handleHistoryNav('down');
                  }}
                >
                  <Text style={styles.arrowKeyText}>▼</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendSignal('arrow_left')}>
                  <Text style={styles.arrowKeyText}>◀</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendSignal('arrow_right')}>
                  <Text style={styles.arrowKeyText}>▶</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.keyButton, styles.enterKey]} onPress={() => sendSignal('enter')}>
                  <Text style={styles.enterKeyText}>ENTER ↵</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.keyButton, styles.toolKey]} onPress={() => sendCommand('agy')}>
                  <Text style={styles.toolKeyText}>agy</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendCommand('/quit')}>
                  <Text style={styles.keyButtonText}>/quit</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendCommand('/model')}>
                  <Text style={styles.keyButtonText}>/model</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendCommand('/status')}>
                  <Text style={styles.keyButtonText}>/status</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendCommand('git status')}>
                  <Text style={styles.keyButtonText}>git</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={() => sendCommand('ls -la')}>
                  <Text style={styles.keyButtonText}>ls</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={clearScreen}>
                  <Text style={styles.keyButtonText}>clear</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.promptSymbol}>❯</Text>
              <TextInput
                style={styles.textInput}
                value={inputCommand}
                onChangeText={setInputCommand}
                placeholder="Send shell command or agy prompt..."
                placeholderTextColor="#475569"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={() => sendCommand()}
              />
              <TouchableOpacity
                style={[styles.sendButton, status === 'connected' ? styles.sendButtonActive : styles.sendButtonDisabled]}
                onPress={() => sendCommand()}
              >
                <Text style={styles.sendButtonText}>SEND</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {/* ==================================================== */}
      {/* TAB 2: MISSION CONTROL                               */}
      {/* ==================================================== */}
      {activeTab === 'control' && (
        <ScrollView style={styles.controlCenterContainer} contentContainerStyle={styles.controlCenterContent}>
          {/* Master Stealth Mode Toggle Card */}
          <Text style={styles.sectionHeading}>STEALTH REMOTE OPERATION</Text>
          <TouchableOpacity
            style={[
              styles.stealthCard,
              telemetry?.stealthMode ? styles.stealthCardActive : styles.stealthCardInactive,
            ]}
            onPress={() => dispatchAction('stealth_mode_toggle')}
          >
            <View style={styles.stealthHeader}>
              <Text style={styles.stealthIcon}>{telemetry?.stealthMode ? '🌙' : '☀️'}</Text>
              <View style={styles.stealthInfo}>
                <Text style={styles.stealthTitle}>
                  {telemetry?.stealthMode ? 'STEALTH ACTIVE: DISPLAY OFF & AWAKE' : 'STEALTH INACTIVE'}
                </Text>
                <Text style={styles.stealthDesc}>
                  {telemetry?.stealthMode
                    ? 'Physical monitor is blacked out via DPMS; systemd-inhibit blocks sleep.'
                    : 'Tap to instantly black out your laptop display and prevent sleep while working remotely.'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Live Telemetry Bento Grid */}
          <Text style={styles.sectionHeading}>LIVE SYSTEM TELEMETRY</Text>
          <View style={styles.telemetryGrid}>
            {/* CPU Overall & Per-Core Mini Bars */}
            <View style={[styles.telemetryCard, styles.telemetryCardWide]}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.telemetryLabel}>CPU USAGE (8 CORES)</Text>
                <Text style={styles.telemetryValueSmall}>{telemetry ? `${telemetry.cpuPercent}%` : '--'}</Text>
              </View>
              <View style={styles.coreBarsContainer}>
                {telemetry?.cpuCores ? (
                  telemetry.cpuCores.map((load, idx) => (
                    <View key={idx} style={styles.coreBarWrapper}>
                      <View style={styles.coreBarTrack}>
                        <View style={[styles.coreBarFill, { height: `${Math.max(4, load)}%` }]} />
                      </View>
                      <Text style={styles.coreLabel}>C{idx}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.telemetrySub}>Reading per-core sensors...</Text>
                )}
              </View>
            </View>

            {/* Thermals */}
            <View style={styles.telemetryCard}>
              <Text style={styles.telemetryLabel}>TEMPERATURE</Text>
              <Text
                style={[
                  styles.telemetryValue,
                  telemetry?.cpuTemp && telemetry.cpuTemp > 75 ? styles.textRed : styles.textCyan,
                ]}
              >
                {telemetry?.cpuTemp ? `${telemetry.cpuTemp}°C` : '--'}
              </Text>
              <Text style={styles.telemetrySub}>
                {telemetry?.cpuTemp && telemetry.cpuTemp > 75 ? 'Heavy Load' : 'Normal Range'}
              </Text>
            </View>

            {/* RAM & Swap */}
            <View style={styles.telemetryCard}>
              <Text style={styles.telemetryLabel}>MEMORY & SWAP</Text>
              <Text style={styles.telemetryValue}>
                {telemetry ? `${telemetry.memory.usedGb}/${telemetry.memory.totalGb}G` : '--'}
              </Text>
              <Text style={styles.telemetrySub}>
                {telemetry ? `Swap: ${telemetry.swap?.usedGb || '0'}/${telemetry.swap?.totalGb || '0'}G` : '--'}
              </Text>
            </View>

            {/* Disk Storage */}
            <View style={styles.telemetryCard}>
              <Text style={styles.telemetryLabel}>ROOT STORAGE</Text>
              <Text style={styles.telemetryValue}>
                {telemetry ? `${telemetry.disk.usedGb}/${telemetry.disk.totalGb}G` : '--'}
              </Text>
              <Text style={styles.telemetrySub}>{telemetry ? `${telemetry.disk.percent}% utilized` : '--'}</Text>
            </View>

            {/* Battery & Power Supply */}
            <View style={styles.telemetryCard}>
              <Text style={styles.telemetryLabel}>BATTERY & AC</Text>
              <Text style={styles.telemetryValue}>
                {telemetry?.battery ? `${telemetry.battery.level}%` : '--'}
              </Text>
              <Text style={styles.telemetrySub}>
                {telemetry?.battery?.ac ? '⚡ AC Plugged In' : `🔋 ${telemetry?.battery?.status || 'On Battery'}`}
              </Text>
            </View>

            {/* Network Throughput */}
            <View style={styles.telemetryCard}>
              <Text style={styles.telemetryLabel}>NETWORK SPEED</Text>
              <Text style={styles.telemetryValueSmall}>
                ↓ {telemetry?.netSpeed ? `${telemetry.netSpeed.rxKbps} KB/s` : '0'}
              </Text>
              <Text style={styles.telemetrySub}>
                ↑ {telemetry?.netSpeed ? `${telemetry.netSpeed.txKbps} KB/s` : '0'}
              </Text>
            </View>

            {/* Uptime & Power Profile */}
            <View style={styles.telemetryCard}>
              <Text style={styles.telemetryLabel}>UPTIME & PROFILE</Text>
              <Text style={styles.telemetryValueSmall}>
                {telemetry ? formatUptime(telemetry.uptimeSeconds) : '--'}
              </Text>
              <Text style={styles.telemetrySub}>
                {telemetry ? (telemetry.powerProfile || telemetry.governor).toUpperCase() : '--'}
              </Text>
            </View>
          </View>

          {/* Top Processes & Process Killer */}
          <Text style={styles.sectionHeading}>PROCESS MANAGER (TOP CPU)</Text>
          <View style={styles.cardBox}>
            {telemetry?.topProcesses && telemetry.topProcesses.length > 0 ? (
              telemetry.topProcesses.map((p) => (
                <View key={p.pid} style={styles.procRow}>
                  <View style={styles.procInfo}>
                    <Text style={styles.procCmd} numberOfLines={1}>
                      {p.command}
                    </Text>
                    <Text style={styles.procMeta}>
                      PID: {p.pid} | User: {p.user} | CPU: {p.cpu}% | MEM: {p.mem}%
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.killBtn}
                    onPress={() =>
                      promptConfirmation(
                        `Kill Process: ${p.command}`,
                        `Send SIGKILL (-9) to process ${p.pid}?`,
                        'kill_process',
                        'danger',
                        { pid: p.pid }
                      )
                    }
                  >
                    <Text style={styles.killBtnText}>KILL</Text>
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={styles.telemetrySub}>No active processes reported</Text>
            )}
          </View>

          {/* Scheduled Hardware Wake (rtcwake) */}
          <Text style={styles.sectionHeading}>SCHEDULED WAKE (RTCWAKE)</Text>
          <View style={styles.cardBox}>
            <Text style={styles.boxTitle}>Suspend PC with Motherboard RTC Alarm</Text>
            <Text style={styles.boxDesc}>
              Suspends system immediately and sets Linux hardware clock to wake up for your shift:
            </Text>

            <View style={styles.timerPillsRow}>
              {[
                { label: '+15m', sec: 900 },
                { label: '+30m', sec: 1800 },
                { label: '+1h', sec: 3600 },
                { label: '+2h', sec: 7200 },
                { label: '+4h', sec: 14400 },
                { label: '+8h', sec: 28800 },
              ].map((t) => (
                <TouchableOpacity
                  key={t.sec}
                  style={styles.timerPill}
                  onPress={() =>
                    promptConfirmation(
                      `Schedule Wake (${t.label})`,
                      `Your PC will suspend into RAM immediately and wake up automatically in ${t.label}.`,
                      'rtcwake',
                      'warning',
                      { seconds: t.sec }
                    )
                  }
                >
                  <Text style={styles.timerPillText}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Desktop Screenshot Preview */}
          <Text style={styles.sectionHeading}>WAYLAND DESKTOP PREVIEW</Text>
          <View style={styles.cardBox}>
            <View style={styles.previewHeader}>
              <Text style={styles.boxTitle}>Live Desktop Snapshot (grim)</Text>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={triggerScreenshot}
                disabled={screenshotLoading}
              >
                {screenshotLoading ? (
                  <ActivityIndicator size="small" color="#00ff9d" />
                ) : (
                  <Text style={styles.refreshButtonText}>📸 CAPTURE NOW</Text>
                )}
              </TouchableOpacity>
            </View>

            {screenshotUri ? (
              <Image source={{ uri: screenshotUri }} style={styles.screenshotImage} resizeMode="contain" />
            ) : (
              <View style={styles.screenshotPlaceholder}>
                <Text style={styles.placeholderText}>Tap 'Capture Now' to preview your desktop</Text>
              </View>
            )}
          </View>

          {/* Power Management Actions (Protected) */}
          <Text style={styles.sectionHeading}>SYSTEM POWER (2-STEP CONFIRMATION)</Text>
          <View style={styles.powerButtonsRow}>
            <TouchableOpacity
              style={[styles.powerButton, styles.suspendButton]}
              onPress={() =>
                promptConfirmation(
                  'Suspend System',
                  'Put the Omarchy PC to sleep immediately?',
                  'suspend',
                  'warning'
                )
              }
            >
              <Text style={styles.powerButtonText}>💤 SUSPEND</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.powerButton, styles.rebootButton]}
              onPress={() =>
                promptConfirmation(
                  'Confirm Reboot',
                  'Are you sure you want to reboot your Omarchy PC remotely? Tailscale will reconnect automatically.',
                  'reboot',
                  'warning'
                )
              }
            >
              <Text style={styles.rebootButtonText}>🔄 REBOOT</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.powerButton, styles.shutdownButton]}
              onPress={() =>
                promptConfirmation(
                  'Confirm Shutdown',
                  'Are you sure you want to power off your Omarchy PC? It will require physical power or Wake-on-LAN to turn back on.',
                  'poweroff',
                  'danger'
                )
              }
            >
              <Text style={styles.shutdownButtonText}>⚠️ SHUTDOWN</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ==================================================== */}
      {/* TAB 3: CONNECTION VAULT                              */}
      {/* ==================================================== */}
      {activeTab === 'vault' && (
        <ScrollView style={styles.controlCenterContainer} contentContainerStyle={styles.controlCenterContent}>
          <Text style={styles.sectionHeading}>CONNECTION HEALTH & STATUS</Text>
          <View style={styles.cardBox}>
            <View style={styles.vaultRow}>
              <Text style={styles.vaultLabel}>Bridge Status:</Text>
              <Text
                style={[
                  styles.vaultValue,
                  status === 'connected' ? styles.textGreen : styles.textRed,
                ]}
              >
                {status.toUpperCase()}
              </Text>
            </View>

            <View style={styles.vaultRow}>
              <Text style={styles.vaultLabel}>Connected Host:</Text>
              <Text style={styles.vaultValue}>{connectedHost}</Text>
            </View>

            <View style={styles.vaultRow}>
              <Text style={styles.vaultLabel}>Port:</Text>
              <Text style={styles.vaultValue}>{BRIDGE_PORT}</Text>
            </View>

            <View style={styles.vaultRow}>
              <Text style={styles.vaultLabel}>Round-Trip Latency:</Text>
              <Text style={styles.vaultValue}>{latency !== null ? `${latency} ms` : 'Measuring...'}</Text>
            </View>

            <View style={styles.vaultRow}>
              <Text style={styles.vaultLabel}>Target MAC Address:</Text>
              <Text style={styles.vaultValue}>{telemetry?.mac || '14:13:33:a8:af:df'}</Text>
            </View>
          </View>

          {/* Quick Copy Command Tools */}
          <Text style={styles.sectionHeading}>KEYS & REMOTE ACCESSIBILITY</Text>
          <View style={styles.cardBox}>
            <Text style={styles.boxTitle}>Session Security Token</Text>
            <Text style={styles.tokenBox} numberOfLines={1}>
              {FIXED_AUTH_TOKEN}
            </Text>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => copyToClipboard(FIXED_AUTH_TOKEN, 'Auth Token')}
            >
              <Text style={styles.actionBtnText}>📋 COPY AUTH TOKEN</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.cardBox}>
            <Text style={styles.boxTitle}>SSH Tunnel Command</Text>
            <Text style={styles.boxDesc}>Forward bridge port 19001 securely over SSH:</Text>
            <Text style={styles.tokenBox}>
              ssh -N -L 19001:localhost:19001 f0id@{connectedHost}
            </Text>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() =>
                copyToClipboard(
                  `ssh -N -L 19001:localhost:19001 f0id@${connectedHost}`,
                  'SSH Tunnel Command'
                )
              }
            >
              <Text style={styles.actionBtnText}>📋 COPY SSH COMMAND</Text>
            </TouchableOpacity>
          </View>

          {/* Wake-on-LAN Dispatch Tool */}
          <Text style={styles.sectionHeading}>WAKE-ON-LAN DISPATCH</Text>
          <View style={styles.cardBox}>
            <Text style={styles.boxTitle}>Broadcast Magic Packet to Subnet</Text>
            <Text style={styles.boxDesc}>
              Dispatches UDP magic packet to target MAC ({telemetry?.mac || '14:13:33:a8:af:df'}) to wake up the network adapter:
            </Text>
            <TouchableOpacity
              style={styles.actionBtnPrimary}
              onPress={() => dispatchAction('send_wol', { mac: telemetry?.mac || '14:13:33:a8:af:df' })}
            >
              <Text style={styles.actionBtnPrimaryText}>📡 DISPATCH WAKE-ON-LAN</Text>
            </TouchableOpacity>
          </View>

          {/* Manual Reconnect */}
          <View style={styles.cardBox}>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => {
                triggerHaptic('medium');
                if (socketRef.current) socketRef.current.close();
                connect();
              }}
            >
              <Text style={styles.actionBtnText}>🔄 FORCE RECONNECT</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* New Tmux Window Modal */}
      <Modal visible={newWindowModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create New Tmux Window</Text>
            <Text style={styles.modalDescription}>
              Spawn an additional independent virtual shell tab in tmux session "{tmuxSession}":
            </Text>
            <TextInput
              style={styles.modalInput}
              value={newWindowName}
              onChangeText={setNewWindowName}
              placeholder="Window Name (e.g. agy-worker, logs)"
              placeholderTextColor="#64748b"
              autoFocus
              autoCapitalize="none"
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.dialogButton, styles.dialogCancel]}
                onPress={() => setNewWindowModalVisible(false)}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogButton, styles.dialogConfirm]} onPress={createNewWindow}>
                <Text style={styles.dialogConfirmText}>Create Tab</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 2-Step Safety Confirmation Dialog */}
      <Modal visible={confirmModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[styles.modalTitle, confirmModal.dangerLevel === 'danger' && styles.textRed]}>
              {confirmModal.title}
            </Text>
            <Text style={styles.modalDescription}>{confirmModal.description}</Text>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.dialogButton, styles.dialogCancel]}
                onPress={() => setConfirmModal((prev) => ({ ...prev, visible: false }))}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.dialogButton,
                  confirmModal.dangerLevel === 'danger' ? styles.dialogDanger : styles.dialogConfirm,
                ]}
                onPress={() => {
                  if (confirmModal.action === 'window_close') {
                    closeWindow(confirmModal.payload?.index);
                  } else {
                    dispatchAction(confirmModal.action, confirmModal.payload);
                  }
                  setConfirmModal((prev) => ({ ...prev, visible: false }));
                }}
              >
                <Text style={styles.dialogConfirmText}>Execute</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ==========================================
// 7. Cyberpunk / Luxury Dark Theme Styles
// ==========================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07090e',
  },
  flexOne: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0d1117',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 1.2,
  },
  latencyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#38bdf8',
    backgroundColor: '#0c2238',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusConnected: {
    backgroundColor: '#00ff9d',
    shadowColor: '#00ff9d',
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  statusConnecting: {
    backgroundColor: '#fbbf24',
  },
  statusDisconnected: {
    backgroundColor: '#ef4444',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#161b22',
    borderRadius: 6,
    padding: 2,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  tabButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tabButtonActive: {
    backgroundColor: '#00ff9d',
  },
  tabButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#8b949e',
  },
  tabButtonTextActive: {
    color: '#07090e',
  },

  // Terminal Subheader (Mode toggle + Window switcher)
  terminalSubheader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0a0d14',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    gap: 8,
  },
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#161b22',
    borderRadius: 5,
    padding: 2,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  viewModeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 3,
  },
  viewModeBtnActive: {
    backgroundColor: '#38bdf8',
  },
  viewModeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
  },
  viewModeTextActive: {
    color: '#07090e',
  },
  windowPillsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  windowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#30363d',
    gap: 6,
  },
  windowPillActive: {
    backgroundColor: '#0c2238',
    borderColor: '#00ff9d',
  },
  windowPillText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  windowPillTextActive: {
    color: '#00ff9d',
    fontWeight: '800',
  },
  closeWinBtn: {
    paddingHorizontal: 2,
  },
  closeWinText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#f43f5e',
    fontWeight: '800',
  },
  newWinBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#475569',
  },
  newWinText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#cbd5e1',
    fontWeight: '700',
  },

  // WebView for xterm.js
  webview: {
    flex: 1,
    backgroundColor: '#07090e',
  },

  // Reader Mode
  readerContainer: {
    flex: 1,
    backgroundColor: '#07090e',
    padding: 10,
  },
  readerContent: {
    paddingBottom: 24,
  },
  readerCard: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
  },
  readerHeader: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '800',
    color: '#00ff9d',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  readerLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    lineHeight: 16,
    color: '#e2e8f0',
  },
  readerEmpty: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
  },

  // Keyboard Accessory Ribbon
  controlBar: {
    backgroundColor: '#0d1117',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingVertical: 6,
  },
  controlScroll: {
    paddingHorizontal: 8,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  keyButton: {
    backgroundColor: '#161b22',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  arrowKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#38bdf8',
  },
  dangerKey: {
    backgroundColor: '#3b1219',
    borderColor: '#f43f5e',
  },
  dangerKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#f43f5e',
  },
  warningKey: {
    backgroundColor: '#3a2408',
    borderColor: '#f59e0b',
  },
  warningKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#f59e0b',
  },
  specialKey: {
    backgroundColor: '#1e293b',
    borderColor: '#64748b',
  },
  specialKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  enterKey: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
  },
  enterKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#34d399',
  },
  toolKey: {
    backgroundColor: '#2e1065',
    borderColor: '#a855f7',
  },
  toolKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#c084fc',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1117',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    gap: 8,
  },
  promptSymbol: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16,
    fontWeight: '900',
    color: '#00ff9d',
  },
  textInput: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: '#f8fafc',
    backgroundColor: '#161b22',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 6,
  },
  sendButtonActive: {
    backgroundColor: '#00ff9d',
  },
  sendButtonDisabled: {
    backgroundColor: '#1e293b',
  },
  sendButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#07090e',
  },

  // Control Center Styles
  controlCenterContainer: {
    flex: 1,
    backgroundColor: '#07090e',
  },
  controlCenterContent: {
    padding: 14,
    paddingBottom: 40,
  },
  sectionHeading: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1.5,
    marginTop: 16,
    marginBottom: 10,
  },
  stealthCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  stealthCardActive: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
  },
  stealthCardInactive: {
    backgroundColor: '#0d1117',
    borderColor: '#1e293b',
  },
  stealthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stealthIcon: {
    fontSize: 24,
  },
  stealthInfo: {
    flex: 1,
  },
  stealthTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 2,
  },
  stealthDesc: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#94a3b8',
    lineHeight: 14,
  },

  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  telemetryCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: '#0d1117',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  telemetryCardWide: {
    minWidth: '100%',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  telemetryLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
  },
  telemetryValue: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 18,
    fontWeight: '800',
    color: '#00ff9d',
    marginVertical: 4,
  },
  telemetryValueSmall: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    fontWeight: '800',
    color: '#38bdf8',
    marginVertical: 2,
  },
  telemetrySub: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#64748b',
  },

  // Per-Core CPU Mini Bars
  coreBarsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 48,
    marginTop: 8,
  },
  coreBarWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  coreBarTrack: {
    width: 14,
    height: 34,
    backgroundColor: '#161b22',
    borderRadius: 3,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  coreBarFill: {
    width: '100%',
    backgroundColor: '#00ff9d',
    borderRadius: 3,
  },
  coreLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 8,
    color: '#64748b',
    marginTop: 3,
  },

  // Process Manager
  procRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#161b22',
  },
  procInfo: {
    flex: 1,
    marginRight: 10,
  },
  procCmd: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#f8fafc',
  },
  procMeta: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    color: '#64748b',
    marginTop: 2,
  },
  killBtn: {
    backgroundColor: '#3b1219',
    borderColor: '#f43f5e',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  killBtnText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '800',
    color: '#f43f5e',
  },

  cardBox: {
    backgroundColor: '#0d1117',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 10,
  },
  boxTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 4,
  },
  boxDesc: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#94a3b8',
    marginBottom: 12,
  },
  timerPillsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  timerPill: {
    flex: 1,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#38bdf8',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  timerPillText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#38bdf8',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  refreshButton: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#00ff9d',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  refreshButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '800',
    color: '#00ff9d',
  },
  screenshotImage: {
    width: '100%',
    height: 180,
    borderRadius: 6,
    backgroundColor: '#07090e',
  },
  screenshotPlaceholder: {
    width: '100%',
    height: 100,
    borderRadius: 6,
    backgroundColor: '#161b22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#64748b',
  },
  powerButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  powerButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  suspendButton: {
    backgroundColor: '#161b22',
    borderColor: '#38bdf8',
  },
  rebootButton: {
    backgroundColor: '#2d1a08',
    borderColor: '#f59e0b',
  },
  shutdownButton: {
    backgroundColor: '#3b1219',
    borderColor: '#f43f5e',
  },
  powerButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#38bdf8',
  },
  rebootButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#fbbf24',
  },
  shutdownButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#f43f5e',
  },

  // Connection Vault Styles
  vaultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#161b22',
  },
  vaultLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#94a3b8',
  },
  vaultValue: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#f8fafc',
  },
  tokenBox: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#38bdf8',
    backgroundColor: '#161b22',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    marginBottom: 8,
  },
  actionBtnSecondary: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#475569',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionBtnPrimary: {
    backgroundColor: '#0c2238',
    borderWidth: 1,
    borderColor: '#38bdf8',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionBtnText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  actionBtnPrimaryText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#38bdf8',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#0d1117',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  modalTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 8,
  },
  modalInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: '#f8fafc',
    backgroundColor: '#161b22',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    marginVertical: 12,
  },
  modalDescription: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
    marginBottom: 16,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  dialogButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  dialogCancel: {
    backgroundColor: '#1e293b',
  },
  dialogCancelText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
  },
  dialogConfirm: {
    backgroundColor: '#38bdf8',
  },
  dialogDanger: {
    backgroundColor: '#f43f5e',
  },
  dialogConfirmText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#07090e',
  },
  textRed: { color: '#f43f5e' },
  textCyan: { color: '#38bdf8' },
  textGreen: { color: '#00ff9d' },
});
