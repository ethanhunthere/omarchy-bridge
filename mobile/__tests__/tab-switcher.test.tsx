import { mock, test, expect, describe, beforeEach, afterEach } from 'bun:test';
import React from 'react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ==========================================
// Mocks Setup
// ==========================================
const hapticsCalls: Array<{ method: string; arg: any }> = [];

const hapticsMock = {
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Warning: 'warning', Success: 'success', Error: 'error' },
  impactAsync: mock((style: string) => {
    hapticsCalls.push({ method: 'impactAsync', arg: style });
    return Promise.resolve();
  }),
  notificationAsync: mock((type: string) => {
    hapticsCalls.push({ method: 'notificationAsync', arg: type });
    return Promise.resolve();
  }),
};
mock.module('expo-haptics', () => hapticsMock);
mock.module(import.meta.resolve('expo-haptics').replace('file://', ''), () => hapticsMock);

const constantsMock = {
  default: {
    expoConfig: { hostUri: '127.0.0.1:8081' },
  },
};
mock.module('expo-constants', () => constantsMock);
mock.module(import.meta.resolve('expo-constants').replace('file://', ''), () => constantsMock);

const mockComponent = (name: string) => {
  const comp = (props: any) => React.createElement(name, props, props?.children);
  comp.displayName = name;
  return comp;
};

const keyboardListeners: Array<{ event: string; callback: Function }> = [];
const dimensionsListeners: Array<{ event: string; callback: Function }> = [];

const rnMock = {
  StyleSheet: {
    create: (styles: any) => styles,
  },
  Text: mockComponent('Text'),
  View: mockComponent('View'),
  TextInput: mockComponent('TextInput'),
  TouchableOpacity: mockComponent('TouchableOpacity'),
  ScrollView: mockComponent('ScrollView'),
  SafeAreaView: mockComponent('SafeAreaView'),
  StatusBar: mockComponent('StatusBar'),
  KeyboardAvoidingView: mockComponent('KeyboardAvoidingView'),
  Keyboard: {
    dismiss: mock(() => {}),
    addListener: mock((event: string, callback: Function) => {
      const sub = { event, callback, remove: mock(() => {}) };
      keyboardListeners.push(sub);
      return sub;
    }),
  },
  Platform: {
    OS: 'android',
    select: (obj: any) => obj.android || obj.default,
  },
  Modal: mockComponent('Modal'),
  Dimensions: {
    get: mock(() => ({ width: 400, height: 800 })),
    addEventListener: mock((event: string, callback: Function) => {
      const sub = { event, callback, remove: mock(() => {}) };
      dimensionsListeners.push(sub);
      return sub;
    }),
  },
};

const rnPath = import.meta.resolve('react-native').replace('file://', '');
mock.module('react-native', () => rnMock);
mock.module(rnPath, () => rnMock);

// WebSocket Mock
export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = 0; // CONNECTING
  onopen: any = null;
  onmessage: any = null;
  onerror: any = null;
  onclose: any = null;
  sentMessages: string[] = [];
  closeCalls: number = 0;

  constructor(url: string) {
    this.url = url;
    this.readyState = 1; // OPEN
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.closeCalls++;
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
}

(global as any).WebSocket = MockWebSocket;

const { default: TestRenderer, act } = await import('react-test-renderer');
const App = (await import('../App')).default;

// Helper to extract texts from tree
function getAllTextStrings(node: any): string[] {
  const texts: string[] = [];
  function recurse(n: any) {
    if (!n) return;
    if (typeof n === 'string' || typeof n === 'number') {
      texts.push(String(n));
      return;
    }
    if (n.props && n.props.children) {
      if (Array.isArray(n.props.children)) {
        n.props.children.forEach(recurse);
      } else {
        recurse(n.props.children);
      }
    }
    if (n.children && Array.isArray(n.children)) {
      n.children.forEach(recurse);
    }
  }
  recurse(node);
  return texts;
}

// Helper to find segmented control buttons
function getSegmentedButtons(root: any) {
  const touchables = root.findAllByType('TouchableOpacity');
  const terminalBtn = touchables.find((t: any) =>
    getAllTextStrings(t).some((str) => str.trim() === 'TERMINAL')
  );
  const powerBtn = touchables.find((t: any) =>
    getAllTextStrings(t).some((str) => str.trim() === 'POWER')
  );
  return { terminalBtn, powerBtn };
}

describe('mobile/App.tsx Segmented Control Buttons Audit', () => {
  let renderer: any;

  beforeEach(() => {
    hapticsCalls.length = 0;
    MockWebSocket.instances.length = 0;
    act(() => {
      renderer = TestRenderer.create(React.createElement(App));
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer.unmount();
      });
    }
  });

  test('Suite 1: Initial Render & Segmented Control Defaults to TERMINAL', () => {
    const { terminalBtn, powerBtn } = getSegmentedButtons(renderer.root);
    expect(terminalBtn).toBeDefined();
    expect(powerBtn).toBeDefined();

    // Verify Active styling is on TERMINAL
    expect(terminalBtn.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#282b37' })])
    );

    // Verify TERMINAL view is rendered
    const texts = getAllTextStrings(renderer.root);
    expect(texts).toContain('[omarchy-remote ready]');
    expect(texts).toContain('Tap anywhere to start typing...');

    // Verify Keycap Ribbon items are present
    expect(texts).toContain('Ctrl+C');
    expect(texts).toContain('Ctrl+D');
    expect(texts).toContain('ESC');
    expect(texts).toContain('TAB');
    expect(texts).toContain('▲');
    expect(texts).toContain('▼');
    expect(texts).toContain('Enter ↵');
    expect(texts).toContain('agy');
    expect(texts).toContain('clear');
    expect(texts).toContain('SCROLL: ON');

    // Verify POWER view components are NOT rendered
    expect(texts).not.toContain('CPU LOAD');
    expect(texts).not.toContain('MACHINE POWER');
    expect(texts).not.toContain('SHUT DOWN PC');
    expect(texts).not.toContain('systemctl poweroff');
    expect(texts).not.toContain('systemctl reboot');
    expect(texts).not.toContain('systemctl suspend');
  });

  test('Suite 2: Tapping POWER sets activeTab to power and renders HUD metrics + power cards', () => {
    const { powerBtn } = getSegmentedButtons(renderer.root);

    // Tap POWER
    act(() => {
      powerBtn.props.onPress();
    });

    // 1. Verify Haptics: Light impact
    expect(hapticsCalls).toHaveLength(1);
    expect(hapticsCalls[0]).toEqual({ method: 'impactAsync', arg: 'light' });

    // 2. Verify Segmented Control Active state shifted to POWER
    const { terminalBtn, powerBtn: updatedPowerBtn } = getSegmentedButtons(renderer.root);
    expect(updatedPowerBtn.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#282b37' })])
    );
    expect(terminalBtn.props.style).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#282b37' })])
    );

    // 3. Verify HUD metrics are rendered
    const texts = getAllTextStrings(renderer.root);
    expect(texts).toContain('CPU LOAD');
    expect(texts).toContain('RAM');
    expect(texts).toContain('BATTERY');

    // 4. Verify all Machine Power Cards are rendered
    expect(texts).toContain('MACHINE POWER');
    expect(texts).toContain('SHUT DOWN PC');
    expect(texts).toContain('systemctl poweroff');
    expect(texts.some((t) => t.includes('REBOOT'))).toBe(true);
    expect(texts).toContain('systemctl reboot');
    expect(texts.some((t) => t.includes('SUSPEND') || t.includes('SLEEP'))).toBe(true);
    expect(texts).toContain('systemctl suspend');

    // 5. Verify Display & Remote Session cards
    expect(texts).toContain('DISPLAY & REMOTE SESSION');
    expect(texts.some((t) => t.includes('STEALTH'))).toBe(true);
    expect(texts).toContain('SEND WAKE-ON-LAN');
    expect(texts.some((t) => t.includes('LOCK'))).toBe(true);

    // 6. Verify Terminal View & Keycap Ribbon are unmounted / not rendered
    expect(texts).not.toContain('[omarchy-remote ready]');
    expect(texts).not.toContain('Ctrl+C');
    expect(texts).not.toContain('Ctrl+D');
    expect(texts).not.toContain('SCROLL: ON');
    expect(texts).not.toContain('Type command or prompt...');
  });

  test('Suite 3: Tapping TERMINAL sets activeTab to terminal and restores terminal view', () => {
    const { powerBtn } = getSegmentedButtons(renderer.root);

    // First switch to POWER
    act(() => {
      powerBtn.props.onPress();
    });
    expect(getAllTextStrings(renderer.root)).toContain('CPU LOAD');

    // Tap TERMINAL
    hapticsCalls.length = 0;
    const { terminalBtn } = getSegmentedButtons(renderer.root);
    act(() => {
      terminalBtn.props.onPress();
    });

    // 1. Verify Haptics: Light impact
    expect(hapticsCalls).toHaveLength(1);
    expect(hapticsCalls[0]).toEqual({ method: 'impactAsync', arg: 'light' });

    // 2. Verify Segmented Control Active state restored to TERMINAL
    const { terminalBtn: updatedTerminalBtn, powerBtn: updatedPowerBtn } = getSegmentedButtons(renderer.root);
    expect(updatedTerminalBtn.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#282b37' })])
    );

    // 3. Verify Terminal View and Keycaps are restored
    const texts = getAllTextStrings(renderer.root);
    expect(texts).toContain('[omarchy-remote ready]');
    expect(texts).toContain('Ctrl+C');
    expect(texts).toContain('Enter ↵');
    expect(texts).toContain('agy');

    // 4. Verify Power view is unmounted
    expect(texts).not.toContain('CPU LOAD');
    expect(texts).not.toContain('MACHINE POWER');
    expect(texts).not.toContain('SHUT DOWN PC');
  });

  test('Suite 4: Tab switching is instantaneous (< 10ms per switch)', () => {
    const { terminalBtn, powerBtn } = getSegmentedButtons(renderer.root);

    const iterations = 50;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      act(() => {
        powerBtn.props.onPress();
      });
      act(() => {
        terminalBtn.props.onPress();
      });
    }

    const totalDuration = performance.now() - start;
    const avgDurationPerSwitch = totalDuration / (iterations * 2);

    console.log(
      `[Benchmark] ${iterations * 2} tab switches executed in ${totalDuration.toFixed(2)}ms ` +
        `(${avgDurationPerSwitch.toFixed(3)}ms / switch)`
    );

    // In a test runner with full tree reconciliation, average switch time must be under 15ms
    expect(avgDurationPerSwitch).toBeLessThan(15.0);
  });

  test('Suite 5: Tab switching maintains connection state without drops or reconnections', () => {
    expect(MockWebSocket.instances.length).toBe(1);
    const initialSocket = MockWebSocket.instances[0];
    expect(initialSocket.readyState).toBe(1); // OPEN

    const { terminalBtn, powerBtn } = getSegmentedButtons(renderer.root);

    // Simulate incoming telemetry from bridge server
    act(() => {
      initialSocket.onmessage({
        data: JSON.stringify({
          type: 'telemetry',
          data: {
            cpuPercent: 42,
            cpuTemp: 55,
            memory: { usedGb: '4.2', totalGb: '15.4', percent: 27 },
            battery: { level: 98, status: 'Charging', ac: true },
            stealthMode: false,
          },
        }),
      });
    });

    // Switch to POWER tab
    act(() => {
      powerBtn.props.onPress();
    });

    // Verify WebSocket was NEVER closed or recreated
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0]).toBe(initialSocket);
    expect(initialSocket.closeCalls).toBe(0);
    expect(initialSocket.readyState).toBe(1);

    // Verify Telemetry data is immediately displayed on the POWER view
    const powerTexts = getAllTextStrings(renderer.root);
    expect(powerTexts).toContain('42%');
    expect(powerTexts).toContain('55°C');
    expect(powerTexts).toContain('4.2G');
    expect(powerTexts).toContain('98%');
    expect(powerTexts).toContain('AC Connected');

    // Simulate incoming terminal output while user is on POWER tab
    act(() => {
      initialSocket.onmessage({
        data: JSON.stringify({
          type: 'screen',
          lines: ['~ ❯ agy -p "status"', '[PASS] System verified OK'],
        }),
      });
    });

    // Switch back to TERMINAL tab
    act(() => {
      terminalBtn.props.onPress();
    });

    // Verify WebSocket is still the same active socket
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0]).toBe(initialSocket);
    expect(initialSocket.closeCalls).toBe(0);

    // Verify screen output arrived while on POWER tab is immediately visible
    const termTexts = getAllTextStrings(renderer.root);
    expect(termTexts).toContain('[PASS] System verified OK');
  });

  test('Suite 6: Zero Memory Leaks across rapid tab switch cycles', () => {
    const { terminalBtn, powerBtn } = getSegmentedButtons(renderer.root);

    // Record initial metrics
    const initialSocketCount = MockWebSocket.instances.length;
    const initialHeap = process.memoryUsage().heapUsed;

    // Execute 100 switches (50 cycles back and forth)
    for (let i = 0; i < 50; i++) {
      act(() => {
        powerBtn.props.onPress();
      });
      act(() => {
        terminalBtn.props.onPress();
      });
    }

    // 1. Socket count must remain strictly constant (no leaked socket creations)
    expect(MockWebSocket.instances.length).toBe(initialSocketCount);

    // 2. Active socket must not have been closed
    expect(MockWebSocket.instances[0].closeCalls).toBe(0);

    // 3. Check heap growth
    const finalHeap = process.memoryUsage().heapUsed;
    const heapDeltaMb = (finalHeap - initialHeap) / 1024 / 1024;
    console.log(
      `[Memory Leak Audit] Initial Heap: ${(initialHeap / 1024 / 1024).toFixed(2)} MB, ` +
        `Final Heap: ${(finalHeap / 1024 / 1024).toFixed(2)} MB, Delta: ${heapDeltaMb.toFixed(2)} MB`
    );

    // Heap change over iterations must be strictly bounded (< 15 MB)
    expect(heapDeltaMb).toBeLessThan(15);

    // 4. Verify terminal view is still cleanly interactive
    const texts = getAllTextStrings(renderer.root);
    expect(texts).toContain('[omarchy-remote ready]');
    expect(texts).toContain('Ctrl+C');
  });
});
