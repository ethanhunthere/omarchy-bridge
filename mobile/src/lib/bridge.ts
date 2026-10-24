import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

// ==========================================
// Bridge configuration + host discovery
// ==========================================

export const BRIDGE_PORT = 19001;
export const DEFAULT_BRIDGE_HOST = 'omarchy-bridge.local';
export const BRIDGE_HOST_FILENAME = 'omarchy-bridge-host.txt';
export const REMOTE_HOST_FILENAME = 'omarchy-bridge-remote.txt';
export const DEVICE_TOKEN_KEY = 'omarchy-bridge-device-token';

export async function readDeviceToken(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)) || '';
  } catch (e) {
    return '';
  }
}

export async function persistDeviceToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
  } catch (e) {}
}

export async function clearDeviceToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
  } catch (e) {}
}

export async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function deviceDisplayName(): string {
  if (Constants.deviceName) return Constants.deviceName;
  return Platform.OS === 'android' ? 'Android device' : 'iPhone';
}

interface LegacyConstants {
  manifest?: { debuggerHost?: string };
  manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
}

export function normalizeBridgeHost(raw: string): string {
  let host = (raw || '').trim();
  host = host.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '');
  host = host.split('/')[0];
  host = host.replace(/:\d+$/, '');
  return host;
}

// Accepts both local hosts ("192.168.1.5", "omarchy-bridge.local") and
// remote tunnel URLs ("https://xxx.trycloudflare.com", "wss://...").
export function normalizeBridgeValue(raw: string): string {
  const value = (raw || '').trim();
  if (/^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value)) {
    const host = value.replace(/^(https?|wss?):\/\//i, '').split('/')[0];
    return host ? `https://${host}` : '';
  }
  return normalizeBridgeHost(value);
}

export interface BridgeTarget {
  kind: 'tunnel' | 'local';
  host: string;
  httpOrigin: string;
  wsUrl: string;
  storageValue: string;
}

export function toBridgeTarget(value: string): BridgeTarget | null {
  const normalized = normalizeBridgeValue(value);
  if (!normalized) return null;
  if (normalized.startsWith('https://')) {
    const host = normalized.slice('https://'.length);
    return { kind: 'tunnel', host, httpOrigin: normalized, wsUrl: `wss://${host}`, storageValue: normalized };
  }
  return {
    kind: 'local',
    host: normalized,
    httpOrigin: `http://${normalized}:${BRIDGE_PORT}`,
    wsUrl: `ws://${normalized}:${BRIDGE_PORT}`,
    storageValue: normalized,
  };
}

export function readSavedBridgeHost(): string {
  try {
    const file = new File(Paths.document, BRIDGE_HOST_FILENAME);
    if (!file.exists) return '';
    return normalizeBridgeHost(file.textSync());
  } catch (e) {
    return '';
  }
}

export function persistBridgeHost(host: string): void {
  try {
    const file = new File(Paths.document, BRIDGE_HOST_FILENAME);
    file.write(host);
  } catch (e) {}
}

export function readSavedRemoteHost(): string {
  try {
    const file = new File(Paths.document, REMOTE_HOST_FILENAME);
    if (!file.exists) return '';
    return (file.textSync() || '').trim();
  } catch (e) {
    return '';
  }
}

export function persistRemoteHost(host: string): void {
  try {
    const file = new File(Paths.document, REMOTE_HOST_FILENAME);
    file.write(host);
  } catch (e) {}
}

// Candidate order: saved host -> Cloudflare tunnel (primary remote path)
// -> dev host -> mDNS. Tailscale stays a commented server-side option.
export function resolveCandidateTargets(savedHost = '', remoteHost = '', manualHost = ''): BridgeTarget[] {
  const targets: BridgeTarget[] = [];
  const add = (candidate?: string | null) => {
    const target = toBridgeTarget(candidate || '');
    if (target && !targets.some((t) => t.wsUrl === target.wsUrl)) targets.push(target);
  };

  add(savedHost);
  add(remoteHost);

  const extraHost = (Constants.expoConfig?.extra as { bridgeHost?: string } | undefined)?.bridgeHost;
  add(extraHost);

  const legacyConstants = Constants as unknown as LegacyConstants;
  const hostUri =
    Constants.expoConfig?.hostUri ||
    legacyConstants.manifest?.debuggerHost ||
    legacyConstants.manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const detectedIp = hostUri.split(':')[0];
    if (detectedIp && detectedIp !== 'localhost' && detectedIp !== '127.0.0.1') {
      add(detectedIp);
    }
  }

  add(DEFAULT_BRIDGE_HOST);
  add(manualHost);
  return targets;
}
