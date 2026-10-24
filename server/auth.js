/**
 * Omarchy Bridge - Device Authentication & Pairing
 *
 * Security model:
 *  - No shared secret is shipped to clients. Each paired device gets its own
 *    256-bit random token; only SHA-256 hashes are stored on disk (0600).
 *  - Pairing happens once per device using a short-lived (5 min) one-time code
 *    printed to the server log. Codes are invalidated after use.
 *  - The legacy AUTH_TOKEN from .env remains valid as an admin/master key
 *    (device management) and for automated test suites. Circle users should
 *    keep it random per install (setup/install-permissions.sh handles this).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = process.env.OMARCHY_BRIDGE_CONFIG_DIR || path.join(os.homedir(), '.config', 'omarchy-bridge');
const DEVICES_FILE = path.join(CONFIG_DIR, 'devices.json');
const AUDIT_FILE = path.join(CONFIG_DIR, 'audit.log');

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_MAX_ATTEMPTS_PER_MIN = 10;
const LAST_SEEN_PERSIST_INTERVAL_MS = 60 * 1000;

let devices = [];
let pairing = null;
let pairingAttempts = new Map();
let lastSeenPersistAt = 0;

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function load() {
  try {
    const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    devices = Array.isArray(parsed) ? parsed.filter((d) => d && typeof d.tokenHash === 'string') : [];
  } catch (e) {
    devices = [];
  }
  return devices;
}

function persist() {
  ensureDir();
  const tmp = `${DEVICES_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(devices, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DEVICES_FILE);
  try {
    fs.chmodSync(DEVICES_FILE, 0o600);
  } catch (e) {}
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still burn a comparison to avoid early-exit timing signal.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function audit(event, details = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...details });
  try {
    ensureDir();
    fs.appendFileSync(AUDIT_FILE, `${line}\n`, { mode: 0o600 });
  } catch (e) {}
  return line;
}

function deviceCount() {
  return devices.length;
}

function newPairingCode() {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  pairing = { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS };
  pairingAttempts = new Map();
  return pairing.code;
}

function activePairingCode() {
  if (!pairing) return null;
  if (Date.now() >= pairing.expiresAt) {
    pairing = null;
    return null;
  }
  return pairing.code;
}

function pairingAllowedForIp(ip) {
  const now = Date.now();
  const entry = pairingAttempts.get(ip);
  if (!entry || now - entry.windowStart > 60000) {
    pairingAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= PAIRING_MAX_ATTEMPTS_PER_MIN;
}

function issueDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

function redeemPairingCode(code, name, ip) {
  const expected = activePairingCode();
  if (!expected) return { ok: false, error: 'no_active_code' };
  if (!pairingAllowedForIp(ip)) return { ok: false, error: 'rate_limited' };
  if (!constantTimeEqual(String(code || ''), expected)) {
    audit('pair_failed', { ip });
    return { ok: false, error: 'invalid_code' };
  }

  const token = issueDeviceToken();
  const device = {
    id: crypto.randomBytes(4).toString('hex'),
    name: String(name || 'device').slice(0, 40),
    tokenHash: sha256(token),
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  };
  devices.push(device);
  persist();
  pairing = null;
  const nextCode = newPairingCode();
  audit('pair_success', { ip, deviceId: device.id, name: device.name });
  return { ok: true, token, deviceId: device.id, name: device.name, nextCode };
}

function touchDevice(device) {
  device.lastSeenAt = new Date().toISOString();
  if (Date.now() - lastSeenPersistAt > LAST_SEEN_PERSIST_INTERVAL_MS) {
    lastSeenPersistAt = Date.now();
    try {
      persist();
    } catch (e) {}
  }
}

/**
 * Verify any credential: a paired device token or the master AUTH_TOKEN.
 * Returns a principal { id, name, master } or null.
 */
function verifyToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  const hash = sha256(token);
  for (const device of devices) {
    if (constantTimeEqual(hash, device.tokenHash)) {
      touchDevice(device);
      return { id: device.id, name: device.name, master: false };
    }
  }
  const master = process.env.AUTH_TOKEN;
  if (master && constantTimeEqual(hash, sha256(master))) {
    return { id: 'master', name: 'master', master: true };
  }
  return null;
}

function listDevices() {
  return devices.map((d) => ({
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
  }));
}

function revokeDevice(deviceId) {
  const before = devices.length;
  devices = devices.filter((d) => d.id !== deviceId);
  if (devices.length === before) return false;
  persist();
  audit('device_revoked', { deviceId });
  return true;
}

module.exports = {
  load,
  verifyToken,
  newPairingCode,
  activePairingCode,
  redeemPairingCode,
  listDevices,
  revokeDevice,
  deviceCount,
  audit,
  CONFIG_DIR,
  DEVICES_FILE,
};
