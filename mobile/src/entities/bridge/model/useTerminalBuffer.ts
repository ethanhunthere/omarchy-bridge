import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

// Terminal output state + frame coalescing. Owns the top of the terminal only,
// so the rest of the controller does not re-render on every output frame.
export function useTerminalBuffer() {
  const [screenLines, setScreenLines] = useState<string[]>([]);
  const [terminalText, setTerminalText] = useState<string>('');

  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const incomingBufferRef = useRef('');
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScreenRef = useRef<string[] | null>(null);
  const screenFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const resetOutput = useCallback(() => {
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
  }, []);

  useEffect(
    () => () => {
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
      if (screenFrameTimerRef.current) clearTimeout(screenFrameTimerRef.current);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    },
    []
  );

  return {
    screenLines,
    terminalText,
    setTerminalText,
    scheduleScreenLines,
    appendOutputChunk,
    resetOutput,
    scrollViewRef,
    scrollRafRef,
  };
}
