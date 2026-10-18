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
} from 'react-native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';

// ==========================================
// 1. Config & Host Discovery
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
// 2. Fast Lightweight ANSI Parser
// ==========================================
interface StyledSegment {
  text: string;
  color?: string;
  bold?: boolean;
}

const ANSI_COLOR_MAP: Record<number, string> = {
  30: '#64748b',
  31: '#f87171',
  32: '#4ade80',
  33: '#fbbf24',
  34: '#60a5fa',
  35: '#c084fc',
  36: '#38bdf8',
  37: '#f1f5f9',
  90: '#475569',
  91: '#ef4444',
  92: '#22c55e',
  93: '#eab308',
  94: '#3b82f6',
  95: '#a855f7',
  96: '#06b6d4',
  97: '#ffffff',
};

function parseAnsi(rawText: string): StyledSegment[] {
  // Clean out common screen/cursor escape sequences that cause text jitter
  const sanitized = rawText
    .replace(/\x1b\[\?1049[hl]/g, '')
    .replace(/\x1b\[\?25[hl]/g, '')
    .replace(/\x1b\[2J/g, '\n')
    .replace(/\x1b\[H/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, (match) => {
      // Keep color 'm' sequences, strip other VT controls
      return match.endsWith('m') ? match : '';
    });

  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  const segments: StyledSegment[] = [];

  let lastIndex = 0;
  let currentColor: string = '#e2e8f0';
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
        currentColor = '#e2e8f0';
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

// ==========================================
// 3. Main Fast Application Component
// ==========================================
export default function App() {
  const candidateHosts = useMemo(() => resolveCandidateHosts(), []);
  const [activeTab, setActiveTab] = useState<'terminal' | 'power'>('terminal');

  // Connection State
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [latency, setLatency] = useState<number | null>(null);

  // Terminal Buffer
  const [terminalText, setTerminalText] = useState<string>('');
  const [inputCommand, setInputCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);

  // Telemetry HUD
  const [telemetry, setTelemetry] = useState<{
    cpuPercent?: number;
    cpuTemp?: number | null;
    memory?: { usedGb: string; totalGb: string; percent: number };
    battery?: { level: number; status: string; ac: boolean };
    netSpeed?: { rxKbps: number; txKbps: number };
    stealthMode?: boolean;
    uptimeSeconds?: number;
  } | null>(null);

  // Power Action Confirmation Modal
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

  // Refs for low-latency batching
  const socketRef = useRef<WebSocket | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const incomingBufferRef = useRef('');
  const flushTimeoutRef = useRef<any>(null);
  const pingIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const hostIndexRef = useRef(0);
  const isMountedRef = useRef(true);

  // Haptic feedback
  const triggerHaptic = (type: 'light' | 'medium' | 'warning' = 'light') => {
    try {
      if (type === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (type === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (e) {}
  };

  // High-frequency PTY buffer flusher (30ms batching prevents React Native freezing)
  const appendOutputChunk = useCallback((chunk: string) => {
    incomingBufferRef.current += chunk;
    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(() => {
        setTerminalText((prev) => {
          const next = prev + incomingBufferRef.current;
          incomingBufferRef.current = '';
          flushTimeoutRef.current = null;
          // Keep the last 30,000 characters for high-speed scrolling
          return next.length > 30000 ? next.slice(-30000) : next;
        });
      }, 30);
    }
  }, []);

  // Stable WebSocket connection
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
            appendOutputChunk(msg.data);
          } else if (msg.type === 'init') {
            if (msg.history) setTerminalText(msg.history);
            if (msg.telemetry) setTelemetry(msg.telemetry);
          } else if (msg.type === 'telemetry') {
            setTelemetry(msg.data);
          } else if (msg.type === 'status' && msg.message) {
            appendOutputChunk(msg.message);
          } else if (msg.type === 'pong' && msg.clientTime) {
            setLatency(Date.now() - msg.clientTime);
          } else if (msg.type === 'cleared') {
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

  // Command & signal dispatchers (immediate WebSocket writes)
  const sendCommand = (cmd: string = inputCommand) => {
    triggerHaptic('light');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      if (!cmd || cmd.trim() === '') {
        socketRef.current.send(JSON.stringify({ type: 'signal', signal: 'enter' }));
      } else {
        socketRef.current.send(JSON.stringify({ type: 'input', data: cmd }));
        setHistory((prev) => [cmd, ...prev.slice(0, 40)]);
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
    triggerHaptic('medium');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'action', action, payload }));
    }
  };

  const clearScreen = () => {
    triggerHaptic('light');
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
  };

  const parsedSegments = useMemo(() => {
    return parseAnsi(terminalText);
  }, [terminalText]);

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
            {status === 'connected' ? 'OMARCHY' : status === 'connecting' ? 'CONNECTING...' : 'OFFLINE'}
          </Text>
          {latency !== null && <Text style={styles.latencyBadge}>{latency}ms</Text>}
        </View>

        {/* Quick View Toggle */}
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
            style={[styles.tabButton, activeTab === 'power' && styles.tabButtonActive]}
            onPress={() => {
              triggerHaptic('light');
              setActiveTab('power');
            }}
          >
            <Text style={[styles.tabButtonText, activeTab === 'power' && styles.tabButtonTextActive]}>
              ⏻ POWER
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ==================================================== */}
      {/* 1. INSTANT TERMINAL VIEW                             */}
      {/* ==================================================== */}
      {activeTab === 'terminal' && (
        <View style={styles.flexOne}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.terminalViewport}
            contentContainerStyle={styles.terminalContent}
            onContentSizeChange={() => {
              if (autoScroll) {
                scrollViewRef.current?.scrollToEnd({ animated: false });
              }
            }}
          >
            <Text style={styles.terminalText} selectable>
              {parsedSegments.map((seg, idx) => (
                <Text
                  key={idx}
                  style={{
                    color: seg.color || '#e2e8f0',
                    fontWeight: seg.bold ? '700' : '400',
                  }}
                >
                  {seg.text}
                </Text>
              ))}
            </Text>
          </ScrollView>

          {/* Floating Above-Keyboard Action Ribbon */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
          >
            <View style={styles.controlBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controlScroll}>
                <TouchableOpacity style={[styles.keyButton, styles.dangerKey]} onPress={() => sendSignal('ctrl_c')}>
                  <Text style={styles.dangerKeyText}>Ctrl+C</Text>
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

                <TouchableOpacity style={[styles.keyButton, styles.enterKey]} onPress={() => sendSignal('enter')}>
                  <Text style={styles.enterKeyText}>ENTER ↵</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.keyButton, styles.toolKey]} onPress={() => sendCommand('agy')}>
                  <Text style={styles.toolKeyText}>agy</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.keyButton} onPress={clearScreen}>
                  <Text style={styles.keyButtonText}>clear</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.keyButton, autoScroll ? styles.autoScrollActive : {}]}
                  onPress={() => {
                    triggerHaptic('light');
                    setAutoScroll((p) => !p);
                  }}
                >
                  <Text style={styles.keyButtonText}>{autoScroll ? 'AUTO-SCROLL: ON' : 'SCROLL: FREE'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>

            {/* Prompt Input Box */}
            <View style={styles.inputContainer}>
              <Text style={styles.promptSymbol}>❯</Text>
              <TextInput
                style={styles.textInput}
                value={inputCommand}
                onChangeText={setInputCommand}
                placeholder="Type command or agy prompt..."
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
      {/* 2. INSTANT POWER & SYSTEM HUD VIEW                   */}
      {/* ==================================================== */}
      {activeTab === 'power' && (
        <ScrollView style={styles.powerContainer} contentContainerStyle={styles.powerContent}>
          {/* Quick HUD Metrics */}
          <Text style={styles.sectionHeading}>SYSTEM HUD</Text>
          <View style={styles.hudRow}>
            <View style={styles.hudCard}>
              <Text style={styles.hudLabel}>CPU LOAD</Text>
              <Text style={styles.hudValue}>{telemetry?.cpuPercent !== undefined ? `${telemetry.cpuPercent}%` : '--'}</Text>
              <Text style={styles.hudSub}>{telemetry?.cpuTemp ? `${telemetry.cpuTemp}°C` : 'Normal'}</Text>
            </View>

            <View style={styles.hudCard}>
              <Text style={styles.hudLabel}>RAM USAGE</Text>
              <Text style={styles.hudValue}>
                {telemetry?.memory ? `${telemetry.memory.usedGb}/${telemetry.memory.totalGb}G` : '--'}
              </Text>
              <Text style={styles.hudSub}>{telemetry?.memory ? `${telemetry.memory.percent}% used` : '--'}</Text>
            </View>

            <View style={styles.hudCard}>
              <Text style={styles.hudLabel}>BATTERY / AC</Text>
              <Text style={styles.hudValue}>{telemetry?.battery ? `${telemetry.battery.level}%` : '--'}</Text>
              <Text style={styles.hudSub}>{telemetry?.battery?.ac ? '⚡ AC Online' : '🔋 Battery'}</Text>
            </View>
          </View>

          {/* Primary Machine Power Actions */}
          <Text style={styles.sectionHeading}>POWER ACTIONS</Text>

          {/* 1. Shut Down PC */}
          <TouchableOpacity
            style={[styles.bigActionButton, styles.shutdownButton]}
            onPress={() =>
              promptConfirmation(
                'Shut Down PC',
                'Are you sure you want to completely power off your Omarchy Linux PC? It will turn off immediately.',
                'poweroff',
                true
              )
            }
          >
            <Text style={styles.actionIconLarge}>⏻</Text>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitleLarge}>SHUT DOWN PC</Text>
              <Text style={styles.actionDescLarge}>Immediately powers off laptop hardware</Text>
            </View>
          </TouchableOpacity>

          {/* 2. Reboot PC */}
          <TouchableOpacity
            style={[styles.bigActionButton, styles.rebootButton]}
            onPress={() =>
              promptConfirmation(
                'Reboot System',
                'Restart your Omarchy Linux PC remotely? The bridge daemon will come back online automatically on boot.',
                'reboot',
                true
              )
            }
          >
            <Text style={styles.actionIconLarge}>🔄</Text>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitleLarge}>REBOOT PC</Text>
              <Text style={styles.actionDescLarge}>Performs clean system reboot</Text>
            </View>
          </TouchableOpacity>

          {/* 3. Suspend / Sleep */}
          <TouchableOpacity
            style={[styles.bigActionButton, styles.suspendButton]}
            onPress={() =>
              promptConfirmation(
                'Suspend System',
                'Put the PC into low-power RAM sleep immediately?',
                'suspend',
                false
              )
            }
          >
            <Text style={styles.actionIconLarge}>💤</Text>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitleLarge}>SUSPEND / SLEEP</Text>
              <Text style={styles.actionDescLarge}>Puts system into low-power sleep mode</Text>
            </View>
          </TouchableOpacity>

          {/* 4. Stealth Mode (Screen Off + Stay Awake) */}
          <TouchableOpacity
            style={[
              styles.bigActionButton,
              telemetry?.stealthMode ? styles.stealthActiveButton : styles.stealthInactiveButton,
            ]}
            onPress={() => dispatchAction('stealth_toggle')}
          >
            <Text style={styles.actionIconLarge}>{telemetry?.stealthMode ? '🌙' : '☀️'}</Text>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitleLarge}>
                {telemetry?.stealthMode ? 'STEALTH MODE: ACTIVE (SCREEN OFF)' : 'TURN SCREEN OFF (STEALTH)'}
              </Text>
              <Text style={styles.actionDescLarge}>
                {telemetry?.stealthMode
                  ? 'Monitor is dark; laptop stays awake so you can work.'
                  : 'Blacks out laptop screen via DPMS while keeping CLI awake.'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* 5. Wake-on-LAN Magic Packet */}
          <TouchableOpacity
            style={[styles.bigActionButton, styles.wolButton]}
            onPress={() => dispatchAction('send_wol')}
          >
            <Text style={styles.actionIconLarge}>📡</Text>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitleLarge}>SEND WAKE-ON-LAN</Text>
              <Text style={styles.actionDescLarge}>Dispatches UDP magic packet to power on/wake PC</Text>
            </View>
          </TouchableOpacity>

          {/* 6. Lock Screen */}
          <TouchableOpacity
            style={[styles.bigActionButton, styles.lockButton]}
            onPress={() => dispatchAction('lock')}
          >
            <Text style={styles.actionIconLarge}>🔒</Text>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitleLarge}>LOCK DESKTOP</Text>
              <Text style={styles.actionDescLarge}>Triggers hyprlock immediately</Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Safety Confirmation Modal */}
      <Modal visible={confirmModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[styles.modalTitle, confirmModal.isDanger && styles.textRed]}>
              {confirmModal.title}
            </Text>
            <Text style={styles.modalDescription}>{confirmModal.description}</Text>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.dialogButton, styles.dialogCancel]}
                onPress={() => setConfirmModal((p) => ({ ...p, visible: false }))}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dialogButton, confirmModal.isDanger ? styles.dialogDanger : styles.dialogConfirm]}
                onPress={() => {
                  dispatchAction(confirmModal.action);
                  setConfirmModal((p) => ({ ...p, visible: false }));
                }}
              >
                <Text style={styles.dialogConfirmText}>Execute Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ==========================================
// 4. Styles (Clean, Obsidian Dark Theme)
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
    fontSize: 13,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 1.2,
  },
  latencyBadge: {
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
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  tabButtonActive: {
    backgroundColor: '#00ff9d',
  },
  tabButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#8b949e',
  },
  tabButtonTextActive: {
    color: '#07090e',
  },

  // Terminal Viewport
  terminalViewport: {
    flex: 1,
    backgroundColor: '#07090e',
    paddingHorizontal: 10,
  },
  terminalContent: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  terminalText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 17,
    color: '#e2e8f0',
  },

  // Floating Control Bar
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
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    minWidth: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
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
    fontWeight: '800',
    color: '#f43f5e',
  },
  specialKey: {
    backgroundColor: '#1e293b',
    borderColor: '#64748b',
  },
  specialKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
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
  autoScrollActive: {
    borderColor: '#00ff9d',
  },

  // Input Bar
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

  // Power Center Styles
  powerContainer: {
    flex: 1,
    backgroundColor: '#07090e',
  },
  powerContent: {
    padding: 14,
    paddingBottom: 40,
  },
  sectionHeading: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1.5,
    marginTop: 14,
    marginBottom: 10,
  },
  hudRow: {
    flexDirection: 'row',
    gap: 8,
  },
  hudCard: {
    flex: 1,
    backgroundColor: '#0d1117',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  hudLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#94a3b8',
  },
  hudValue: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16,
    fontWeight: '800',
    color: '#00ff9d',
    marginVertical: 2,
  },
  hudSub: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    color: '#64748b',
  },
  bigActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  actionIconLarge: {
    fontSize: 22,
  },
  actionTextCol: {
    flex: 1,
  },
  actionTitleLarge: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 2,
  },
  actionDescLarge: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#94a3b8',
  },
  shutdownButton: {
    backgroundColor: '#3b1219',
    borderColor: '#f43f5e',
  },
  rebootButton: {
    backgroundColor: '#2d1a08',
    borderColor: '#f59e0b',
  },
  suspendButton: {
    backgroundColor: '#0c2238',
    borderColor: '#38bdf8',
  },
  stealthActiveButton: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
  },
  stealthInactiveButton: {
    backgroundColor: '#0d1117',
    borderColor: '#1e293b',
  },
  wolButton: {
    backgroundColor: '#161b22',
    borderColor: '#38bdf8',
  },
  lockButton: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
  },

  // Modal
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
  modalDescription: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
    marginBottom: 20,
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
});
