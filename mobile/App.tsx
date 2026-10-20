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
import * as Haptics from 'expo-haptics';

// ==========================================
// 1. Config & Host Discovery
// ==========================================
const FIXED_AUTH_TOKEN = 'omarchy-bridge-secure-key-2026';
const BRIDGE_PORT = 19001;

interface LegacyConstants {
  manifest?: { debuggerHost?: string };
  manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
}

function resolveCandidateHosts(): string[] {
  const hosts: string[] = [];
  const legacyConstants = Constants as unknown as LegacyConstants;
  const hostUri =
    Constants.expoConfig?.hostUri ||
    legacyConstants.manifest?.debuggerHost ||
    legacyConstants.manifest2?.extra?.expoGo?.debuggerHost;

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
// 3. Main Industrial Minimalist Component
// ==========================================
export default function App() {
  const candidateHosts = useMemo(() => resolveCandidateHosts(), []);
  const [activeTab, setActiveTab] = useState<'terminal' | 'power'>('terminal');

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

  // 30ms batching prevents React Native bridge flooding
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
      }, 30);
    }
  }, []);

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
    const targetUrl = `ws://${currentHost}:${BRIDGE_PORT}?token=${encodeURIComponent(FIXED_AUTH_TOKEN)}`;

    setStatus('connecting');

    try {
      const ws = new WebSocket(targetUrl);
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
  }, [candidateHosts, appendOutputChunk]);

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      if (socketRef.current) socketRef.current.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
    };
  }, [connect]);

  const sendCommand = (cmd: string = inputCommand) => {
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
  };

  const sendSignal = (signal: string) => {
    triggerHaptic('medium');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'signal', signal }));
    }
  };

  const dispatchAction = (action: string, payload: Record<string, unknown> = {}) => {
    triggerHaptic('medium');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'action', action, payload }));
    }
  };

  const clearScreen = () => {
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
    return parseAnsi(terminalText);
  }, [terminalText]);

  return (
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

        {latency !== null && (
          <View style={styles.latencyPill}>
            <Text style={styles.latencyText}>{latency}ms</Text>
          </View>
        )}
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
                  scrollViewRef.current?.scrollToEnd({ animated: false });
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
                  screenLines.map((line, idx) => (
                    <Text key={idx} style={styles.terminalLine} selectable>
                      {renderStyledLine(line)}
                    </Text>
                  ))
                ) : (
                  parsedSegments.map((seg, idx) => (
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
                  ))
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

          {/* Wi-Fi Profile Safety Notice */}
          <View style={styles.safetyNoticeCard}>
            <Text style={styles.safetyNoticeTitle}>REMOTE WI-FI PROFILE</Text>
            <Text style={styles.safetyNoticeText}>
              Unused high-risk poweroff, reboot, and Wake-on-LAN controls are excluded to prevent remote session disconnection on wireless hardware.
            </Text>
          </View>
        </ScrollView>
      )}

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
    fontSize: 12,
    lineHeight: 18,
    color: '#e4e4e7',
  },
  terminalLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 19,
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
    fontSize: 13,
    color: '#71717a',
    fontWeight: '700',
  },
  emptySub: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: '600',
    color: '#d4d4d8',
  },
  keycapCtrlC: {
    backgroundColor: '#231518',
    borderColor: '#3e1d23',
  },
  keycapCtrlCText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#f87171',
  },
  keycapCtrlD: {
    backgroundColor: '#261c14',
    borderColor: '#422c1d',
  },
  keycapCtrlDText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#fbbf24',
  },
  keycapEnter: {
    backgroundColor: '#16221c',
    borderColor: '#243c2f',
  },
  keycapEnterText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#4ade80',
  },
  keycapTool: {
    backgroundColor: '#1c1e28',
    borderColor: '#2c3042',
  },
  keycapToolText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
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
    fontSize: 9,
    fontWeight: '700',
    color: '#717686',
    marginBottom: 4,
    letterSpacing: 0.8,
  },
  hudStat: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16,
    fontWeight: '800',
    color: '#f4f4f6',
    marginBottom: 2,
  },
  hudSub: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
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
    fontSize: 10,
    fontWeight: '700',
    color: '#717686',
    letterSpacing: 1.2,
  },
  profileBadge: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 8,
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
    fontSize: 13,
    fontWeight: '700',
    color: '#f4f4f6',
  },
  cardLabelPrimary: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#60a5fa',
  },
  cardLabelActive: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#4ade80',
  },
  cmdBadge: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
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
    fontSize: 11,
    lineHeight: 16,
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
    fontSize: 9,
    fontWeight: '700',
    color: '#63687b',
    letterSpacing: 1,
    marginBottom: 4,
  },
  safetyNoticeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#717688',
    lineHeight: 15,
  },

  // Modal
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
  },
  dialogTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 15,
    fontWeight: '800',
    color: '#f4f4f5',
    marginBottom: 6,
  },
  dialogMessage: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#a1a1aa',
    lineHeight: 16,
    marginBottom: 18,
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
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: '800',
    color: '#0a0b0d',
  },
});
