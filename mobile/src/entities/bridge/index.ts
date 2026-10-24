export { useBridge } from './model/useBridge';
export type {
  BridgeController,
  ConfirmModalState,
  ConnectionStatus,
  Telemetry,
} from './model/useBridge';

export * from './lib/bridge';
export { DEFAULT_TERMINAL_COLOR, parseAnsi } from './lib/ansi';
export type { StyledSegment } from './lib/ansi';
