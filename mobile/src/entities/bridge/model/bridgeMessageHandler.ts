import { normalizeBridgeValue } from '../lib/bridge';
import type { Telemetry } from './types';

export interface BridgeMessageHandlers {
  scheduleScreenLines: (lines: string[]) => void;
  appendOutputChunk: (chunk: string) => void;
  setTerminalText: React.Dispatch<React.SetStateAction<string>>;
  setTelemetry: React.Dispatch<React.SetStateAction<Telemetry | null>>;
  patchTelemetry: (patch: Partial<Telemetry>) => void;
  resetOutput: () => void;
  persistRemote: (value: string) => void;
  persistHost?: (value: string) => void;
  loadHistory?: (commands: string[]) => void;
  setLatency: (latency: number | null) => void;
  savedRemoteHost: string;
}

/**
 * Dispatches structured WebSocket events received from the omarchy-bridge server.
 */
export function handleBridgeSocketMessage(rawData: string, handlers: BridgeMessageHandlers): void {
  try {
    const msg = JSON.parse(rawData);
    if (!msg || typeof msg !== 'object') {
      handlers.appendOutputChunk(rawData);
      return;
    }

    if (msg.type === 'screen' && Array.isArray(msg.lines)) {
      handlers.scheduleScreenLines(msg.lines);
    } else if (msg.type === 'init') {
      if (Array.isArray(msg.lines)) handlers.scheduleScreenLines(msg.lines);
      if (msg.history) handlers.setTerminalText(msg.history);
      if (Array.isArray(msg.commands) && handlers.loadHistory) handlers.loadHistory(msg.commands);
      if (msg.lanIp && handlers.persistHost) handlers.persistHost(msg.lanIp);
      if (msg.telemetry) handlers.setTelemetry(msg.telemetry);
      if (msg.remote) {
        const remoteValue = normalizeBridgeValue(msg.remote.tunnelUrl || msg.remote.magicDns || msg.remote.ip || '');
        if (remoteValue && remoteValue !== handlers.savedRemoteHost) {
          handlers.persistRemote(remoteValue);
        }
      }
    } else if (msg.type === 'command_history' && Array.isArray(msg.commands)) {
      if (handlers.loadHistory) handlers.loadHistory(msg.commands);
    } else if (msg.type === 'output') {
      handlers.appendOutputChunk(msg.data);
    } else if (msg.type === 'telemetry') {
      handlers.setTelemetry(msg.data);
    } else if (msg.type === 'action_result') {
      if (msg.result && typeof msg.result.dpmsOn === 'boolean') {
        handlers.patchTelemetry({ dpmsOn: msg.result.dpmsOn });
      }
      if (msg.result && typeof msg.result.stealthMode === 'boolean') {
        handlers.patchTelemetry({ stealthMode: msg.result.stealthMode });
      }
    } else if (msg.type === 'status' && msg.message) {
      handlers.appendOutputChunk(msg.message);
    } else if (msg.type === 'pong' && msg.clientTime) {
      handlers.setLatency(Date.now() - msg.clientTime);
    } else if (msg.type === 'cleared') {
      handlers.resetOutput();
    }
  } catch (_err) {
    handlers.appendOutputChunk(rawData);
  }
}
