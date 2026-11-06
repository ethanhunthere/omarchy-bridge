import { useCallback, useRef, useState } from 'react';
import { persistCommandHistory, readSavedCommandHistory } from '../lib/bridge';
import type { HapticKind } from './useHaptics';

export function useHistory(triggerHaptic: (type?: HapticKind) => void) {
  const [history, setHistory] = useState<string[]>(() => readSavedCommandHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<string[]>(history);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef('');

  historyRef.current = history;
  historyIndexRef.current = historyIndex;

  const loadHistory = useCallback((commands: string[]) => {
    if (!Array.isArray(commands) || commands.length === 0) return;
    setHistory((prev) => {
      // Merge server commands while keeping any active session commands on top
      const merged = [...prev];
      for (const cmd of commands) {
        if (typeof cmd === 'string') {
          const trimmed = cmd.trim();
          if (trimmed && !merged.includes(trimmed)) {
            merged.push(trimmed);
          }
        }
      }
      const capped = merged.slice(0, 100);
      persistCommandHistory(capped);
      return capped;
    });
  }, []);

  const record = useCallback((cmd: string) => {
    const trimmed = (cmd || '').trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const updated = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 100);
      persistCommandHistory(updated);
      return updated;
    });
    setHistoryIndex(-1);
    draftRef.current = '';
  }, []);

  // Returns the next history entry; the input bar applies it imperatively.
  const nextHistoryValue = useCallback(
    (direction: 'up' | 'down', currentDraft?: string): string | null => {
      triggerHaptic('light');
      const items = historyRef.current;
      if (items.length === 0) return null;
      const current = historyIndexRef.current;

      // Remember what the user had typed before browsing history
      if (current === -1 && typeof currentDraft === 'string') {
        draftRef.current = currentDraft;
      }

      if (direction === 'up') {
        const nextIdx = Math.min(current + 1, items.length - 1);
        setHistoryIndex(nextIdx);
        return items[nextIdx] || '';
      } else if (direction === 'down') {
        const nextIdx = Math.max(current - 1, -1);
        setHistoryIndex(nextIdx);
        return nextIdx === -1 ? draftRef.current : items[nextIdx];
      }
      return null;
    },
    [triggerHaptic]
  );

  return { record, loadHistory, nextHistoryValue };
}
