import { useCallback } from 'react';
import type { ConfirmModalState } from './types';
import type { HapticKind } from './useHaptics';

interface Options {
  socketRef: React.MutableRefObject<WebSocket | null>;
  connect: () => void;
  triggerHaptic: (type?: HapticKind) => void;
  recordHistory: (cmd: string) => void;
  resetOutput: () => void;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
}

export function useBridgeActions(options: Options) {
  const { socketRef, connect, triggerHaptic, recordHistory, resetOutput, setConfirmModal } = options;

  const sendCommand = useCallback(
    (cmd: string) => {
      try {
        triggerHaptic('light');
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          if (!cmd || cmd.trim() === '') {
            socketRef.current.send(JSON.stringify({ type: 'signal', signal: 'enter' }));
          } else {
            socketRef.current.send(JSON.stringify({ type: 'input', data: cmd }));
            recordHistory(cmd);
          }
        } else {
          connect();
        }
      } catch (e) {
        console.warn('[BRIDGE] sendCommand error intercepted:', e);
      }
    },
    [connect, recordHistory, socketRef, triggerHaptic]
  );

  const sendSignal = useCallback(
    (signal: string) => {
      try {
        triggerHaptic('medium');
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'signal', signal }));
        }
      } catch (e) {
        console.warn('[BRIDGE] sendSignal error intercepted:', e);
      }
    },
    [socketRef, triggerHaptic]
  );

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
      resetOutput();
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'clear' }));
      }
    } catch (e) {
      console.warn('[BRIDGE] clearScreen error intercepted:', e);
    }
  }, [resetOutput, socketRef, triggerHaptic]);

  const promptConfirmation = useCallback(
    (title: string, description: string, action: string, isDanger: boolean = false) => {
      triggerHaptic('warning');
      setConfirmModal({ visible: true, title, description, action, isDanger });
    },
    [setConfirmModal, triggerHaptic]
  );

  return { sendCommand, sendSignal, dispatchAction, clearScreen, promptConfirmation };
}
