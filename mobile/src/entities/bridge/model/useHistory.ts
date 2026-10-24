import { useCallback, useRef, useState } from 'react';
import type { HapticKind } from './useHaptics';

export function useHistory(triggerHaptic: (type?: HapticKind) => void) {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  historyRef.current = history;
  historyIndexRef.current = historyIndex;

  const record = useCallback((cmd: string) => {
    setHistory((prev) => [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 40));
    setHistoryIndex(-1);
  }, []);

  // Returns the next history entry; the input bar applies it imperatively.
  const nextHistoryValue = useCallback(
    (direction: 'up' | 'down'): string | null => {
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
    },
    [triggerHaptic]
  );

  return { record, nextHistoryValue };
}
