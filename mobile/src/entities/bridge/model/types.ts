export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface Telemetry {
  cpuPercent?: number;
  cpuTemp?: number | null;
  memory?: { usedGb: string; totalGb: string; percent: number };
  battery?: { level: number; status: string; ac: boolean };
  netSpeed?: { rxKbps: number; txKbps: number };
  stealthMode?: boolean;
  dpmsOn?: boolean;
  uptimeSeconds?: number;
}

export interface ConfirmModalState {
  visible: boolean;
  title: string;
  description: string;
  action: string;
  isDanger: boolean;
}
