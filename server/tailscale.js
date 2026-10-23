/**
 * Omarchy Bridge Tailscale Detection
 * Detects the machine's Tailscale identity so the mobile app can
 * reconnect from anywhere (cellular, other countries) after pairing once.
 */

const os = require('os');
const { execFileSync } = require('child_process');

const CACHE_MS = 30000;

let cached = null;
let lastFetch = 0;

function isTailscaleIpv4(address) {
  const parts = String(address || '').split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  // 100.64.0.0/10 CGNAT range used by Tailscale
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function getTailscaleIpFromInterfaces() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && isTailscaleIpv4(iface.address)) {
        return iface.address;
      }
    }
  }
  return null;
}

function getTailscaleStatus() {
  const now = Date.now();
  if (cached && now - lastFetch < CACHE_MS) return cached;

  let ip = getTailscaleIpFromInterfaces();
  let magicDns = null;
  let backendState = null;

  try {
    const raw = execFileSync('tailscale', ['status', '--json'], {
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const parsed = JSON.parse(raw);
    backendState = parsed.BackendState || null;
    const self = parsed.Self || {};
    if (Array.isArray(self.TailscaleIPs)) {
      const v4 = self.TailscaleIPs.find((entry) => isTailscaleIpv4(entry));
      if (v4) ip = v4;
    }
    if (self.DNSName) {
      magicDns = String(self.DNSName).replace(/\.$/, '');
    }
  } catch (e) {
    // tailscale binary missing, socket permission denied, or offline
  }

  cached = {
    available: Boolean(ip),
    ip: ip || null,
    magicDns,
    backendState,
  };
  lastFetch = now;
  return cached;
}

module.exports = { getTailscaleStatus };
