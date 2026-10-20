/**
 * Omarchy Linux Remote CLI Bridge & Mission Control Daemon
 * High-Speed, Non-Blocking, Fully Hardened Architecture
 */

const http = require('http');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const dgram = require('dgram');
const { exec, spawn, execSync } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer, WebSocket } = require('ws');
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
require('dotenv').config();

// ==========================================
// 1. Configuration & Environment
// ==========================================
const PORT = parseInt(process.env.PORT || '19001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TMUX_SESSION = process.env.TMUX_SESSION || 'omarchy-remote';
const USER_SHELL = process.env.SHELL_CMD || process.env.SHELL || '/usr/bin/fish';
const WORK_DIR = process.env.WORK_DIR || process.env.HOME || process.cwd();
const PRIMARY_MAC = process.env.PRIMARY_MAC || '14:13:33:a8:af:df';

const ENHANCED_PATH = [
  '/home/f0id/.gemini/antigravity-cli/bin',
  '/home/f0id/.local/bin',
  '/home/f0id/.opencode/bin',
  '/home/f0id/.adal/bin',
  '/home/f0id/.local/share/mise/installs/node/26.2.0/bin',
  '/home/f0id/.local/share/mise/shims',
  '/home/f0id/.local/share/omarchy/bin',
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  process.env.PATH || '',
]
  .filter(Boolean)
  .join(':');

process.env.PATH = ENHANCED_PATH;
process.env.HOME = process.env.HOME || '/home/f0id';
process.env.USER = process.env.USER || 'f0id';
process.env.LOGNAME = process.env.LOGNAME || 'f0id';
process.env.DBUS_SESSION_BUS_ADDRESS = process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus';
process.env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || '/run/user/1000';
process.env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || '/home/f0id/.config';
process.env.TERM = 'xterm-256color';
process.env.COLORTERM = 'truecolor';

if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
  try {
    const hyprDir = `${process.env.XDG_RUNTIME_DIR || '/run/user/1000'}/hypr`;
    if (fs.existsSync(hyprDir)) {
      const sigs = fs.readdirSync(hyprDir).filter((f) => !f.startsWith('.'));
      if (sigs.length > 0) process.env.HYPRLAND_INSTANCE_SIGNATURE = sigs[0];
    }
  } catch (e) {}
}

if (!process.env.WAYLAND_DISPLAY) {
  try {
    const runtimeDir = process.env.XDG_RUNTIME_DIR || '/run/user/1000';
    const waylandSockets = fs.readdirSync(runtimeDir).filter((f) => f.startsWith('wayland-'));
    if (waylandSockets.length > 0) process.env.WAYLAND_DISPLAY = waylandSockets[0];
  } catch (e) {}
}

let AUTH_TOKEN = process.env.AUTH_TOKEN || 'omarchy-bridge-secure-key-2026';

function safeParseUrl(urlStr, hostHeader) {
  try {
    return new URL(urlStr, `http://${hostHeader || 'localhost'}`);
  } catch (e) {
    return null;
  }
}

// ==========================================
// 2. High-Performance Circular Scrollback
// ==========================================
const MAX_SCROLLBACK_BYTES = 512 * 1024; // 512 KB
let scrollbackChunks = [];
let scrollbackBytes = 0;
let maxObservedScrollbackBytes = 0;
let scrollbackExceededCount = 0;

function appendScrollback(chunk) {
  const bytes = Buffer.byteLength(chunk, 'utf8');
  scrollbackChunks.push({ data: chunk, bytes });
  scrollbackBytes += bytes;

  // Evict in chunks to avoid array shift overhead
  if (scrollbackBytes > MAX_SCROLLBACK_BYTES) {
    let excess = scrollbackBytes - MAX_SCROLLBACK_BYTES;
    let removeCount = 0;
    for (let i = 0; i < scrollbackChunks.length; i++) {
      excess -= scrollbackChunks[i].bytes;
      removeCount++;
      if (excess <= 0) break;
    }
    const removed = scrollbackChunks.splice(0, removeCount);
    for (const r of removed) scrollbackBytes -= r.bytes;
  }

  if (scrollbackBytes > MAX_SCROLLBACK_BYTES) {
    scrollbackExceededCount++;
  }
  if (scrollbackBytes > maxObservedScrollbackBytes) {
    maxObservedScrollbackBytes = scrollbackBytes;
  }
}

function getRecentScrollback(maxBytes = 32768) {
  const selected = [];
  let bytesCount = 0;
  for (let i = scrollbackChunks.length - 1; i >= 0; i--) {
    selected.unshift(scrollbackChunks[i].data);
    bytesCount += scrollbackChunks[i].bytes;
    if (bytesCount >= maxBytes) break;
  }
  return selected.join('');
}

// Headless terminal emulator to maintain clean 2D screen buffer
const headlessTerm = new HeadlessTerminal({
  cols: 80,
  rows: 30,
  allowProposedApi: true,
  scrollback: 5000,
});
const serializeAddon = new SerializeAddon();
headlessTerm.loadAddon(serializeAddon);

function getCleanScreenLines(maxLines = 120) {
  const lines = [];
  const buffer = headlessTerm.buffer.active;
  const numRows = headlessTerm.rows;
  const total = buffer.baseY + numRows;
  const start = Math.max(0, total - maxLines);
  for (let y = start; y < total; y++) {
    const line = buffer.getLine(y);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines;
}

// ==========================================
// 3. Persistent Headless tmux Engine
// ==========================================
function ensureTmuxSession() {
  try {
    const { execSync } = require('child_process');
    execSync(`tmux has-session -t ${TMUX_SESSION} 2>/dev/null`);
  } catch (err) {
    console.log(`[TMUX] Spawning detached session: ${TMUX_SESSION} (${USER_SHELL} -l)`);
    try {
      const { execSync } = require('child_process');
      execSync(
        `tmux new-session -d -s ${TMUX_SESSION} -n "terminal" -c "${WORK_DIR}" "${USER_SHELL} -l" 2>/dev/null; ` +
          `tmux set-option -t ${TMUX_SESSION} status off 2>/dev/null; ` +
          `tmux set-option -t ${TMUX_SESSION} default-terminal "xterm-256color" 2>/dev/null`
      );
    } catch (e) {
      console.error('[TMUX] Init error:', e.message);
    }
  }
}

ensureTmuxSession();

// ==========================================
// 4. Zero-Delay PTY Process with Backpressure
// ==========================================
let ptyProcess = null;
const clients = new Set();
let ptyPaused = false;
let backpressureEvents = 0;

function checkBackpressure() {
  if (!ptyProcess) return;

  let maxBuffered = 0;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > maxBuffered) {
        maxBuffered = client.bufferedAmount;
      }
    }
  }

  // Instant backpressure handling:
  // Pause PTY stream if WebSocket send buffer exceeds 128KB (ideal for mobile bandwidth)
  if (!ptyPaused && maxBuffered >= 128 * 1024) {
    ptyPaused = true;
    backpressureEvents++;
    try {
      ptyProcess.pause();
    } catch (e) {}
  } else if (ptyPaused && maxBuffered <= 32 * 1024) {
    ptyPaused = false;
    try {
      ptyProcess.resume();
    } catch (e) {}
  }
}

// Rapid unpause monitor
setInterval(() => {
  if (ptyPaused) {
    checkBackpressure();
  }
}, 25);

let screenBroadcastTimer = null;
let lastBroadcastScreen = '';

function broadcastCleanScreen() {
  if (clients.size === 0) return;
  const lines = getCleanScreenLines(120);
  const serialized = JSON.stringify(lines);
  if (serialized === lastBroadcastScreen) return;
  lastBroadcastScreen = serialized;
  const payload = JSON.stringify({ type: 'screen', lines });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload, (err) => {
        if (err) clients.delete(client);
      });
    } else {
      clients.delete(client);
    }
  }
}

function scheduleScreenBroadcast() {
  if (screenBroadcastTimer) return;
  screenBroadcastTimer = setTimeout(() => {
    screenBroadcastTimer = null;
    broadcastCleanScreen();
  }, 20);
}

function spawnPty(cols = 80, rows = 30) {
  ensureTmuxSession();

  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {}
  }

  ptyProcess = pty.spawn('/usr/bin/tmux', ['attach-session', '-t', TMUX_SESSION], {
    name: 'xterm-256color',
    cols: cols,
    rows: rows,
    cwd: WORK_DIR,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'en_US.UTF-8',
      PAGER: 'cat',
    },
  });

  ptyPaused = false;

  ptyProcess.onData((data) => {
    // Auto-respond to terminal feature probes (avoids shell hangs)
    if (
      data.includes('\x1b[0c') ||
      data.includes('\x1b]11;?') ||
      data.includes('\x1b[6n') ||
      data.includes('\x1b[?u')
    ) {
      let response = '';
      if (data.includes('\x1b[0c')) response += '\x1b[?62;c';
      if (data.includes('\x1b]11;?')) response += '\x1b]11;rgb:0709/0c0e/1012\x1b\\';
      if (data.includes('\x1b[6n')) response += '\x1b[1;1R';
      if (data.includes('\x1b[?u')) response += '\x1b[?0u';
      if (response && ptyProcess) {
        ptyProcess.write(response);
      }
    }

    try {
      headlessTerm.write(data);
    } catch (e) {}

    appendScrollback(data);
    scheduleScreenBroadcast();

    // Direct immediate broadcast (zero latency)
    if (clients.size > 0) {
      const payload = JSON.stringify({ type: 'output', data });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload, (err) => {
            if (err) clients.delete(client);
          });
        } else {
          clients.delete(client);
        }
      }
      checkBackpressure();
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    ensureTmuxSession();
    scheduleScreenBroadcast();
    const payload = JSON.stringify({
      type: 'status',
      message: `\r\n\x1b[33m[Session reconnecting to ${TMUX_SESSION}...]\x1b[0m\r\n`,
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload, (err) => {
          if (err) clients.delete(client);
        });
      } else {
        clients.delete(client);
      }
    }
    setTimeout(() => spawnPty(cols, rows), 800);
  });
}

spawnPty(80, 30);

// ==========================================
// 5. Ultra-Light Non-Blocking Telemetry (Pure FS/OS)
// ==========================================
let lastNetSample = null;
let keepAwakeProcess = null;
let stealthActive = false;
let dpmsOn = true;
try {
  const monOut = execSync('hyprctl monitors -j 2>/dev/null', { timeout: 1000 }).toString();
  const mons = JSON.parse(monOut);
  if (Array.isArray(mons) && mons.length > 0 && typeof mons[0].dpmsStatus === 'boolean') {
    dpmsOn = mons[0].dpmsStatus;
  }
} catch (e) {}

function getCpuTemp() {
  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    return Math.round(parseInt(raw.trim(), 10) / 1000);
  } catch (e) {
    return null;
  }
}

function getBattery() {
  try {
    const cap = parseInt(fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8').trim(), 10);
    const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf8').trim();
    const ac = fs.readFileSync('/sys/class/power_supply/AC0/online', 'utf8').trim() === '1';
    return { level: cap, status, ac };
  } catch (e) {
    return { level: 100, status: 'AC Connected', ac: true };
  }
}

function getNetworkSpeed() {
  let rxBytes = 0;
  let txBytes = 0;
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n');
    for (const l of lines) {
      if (l.includes('wlan0:') || l.includes('eth0:')) {
        const parts = l.split(':')[1].trim().split(/\s+/);
        rxBytes += parseInt(parts[0], 10) || 0;
        txBytes += parseInt(parts[8], 10) || 0;
      }
    }
  } catch (e) {}

  const now = Date.now();
  if (!lastNetSample) {
    lastNetSample = { rxBytes, txBytes, time: now };
    return { rxKbps: 0, txKbps: 0 };
  }

  const dtSec = (now - lastNetSample.time) / 1000;
  if (dtSec <= 0) return { rxKbps: 0, txKbps: 0 };

  const rxDiff = rxBytes - lastNetSample.rxBytes;
  const txDiff = txBytes - lastNetSample.txBytes;
  lastNetSample = { rxBytes, txBytes, time: now };

  return {
    rxKbps: Math.max(0, Math.round(rxDiff / 1024 / dtSec)),
    txKbps: Math.max(0, Math.round(txDiff / 1024 / dtSec)),
  };
}

let lastCpuTimes = null;
function getCpuPercent() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += Object.values(c.times).reduce((a, b) => a + b, 0);
  }

  if (!lastCpuTimes) {
    lastCpuTimes = { idle, total };
    return 0;
  }

  const dTotal = total - lastCpuTimes.total;
  const dIdle = idle - lastCpuTimes.idle;
  lastCpuTimes = { idle, total };
  return dTotal > 0 ? Math.min(100, Math.max(0, Math.round(100 - (100 * dIdle) / dTotal))) : 0;
}

let lastCpuPerCore = null;
function getPerCoreCpu() {
  const cpus = os.cpus();
  if (!lastCpuPerCore || lastCpuPerCore.length !== cpus.length) {
    lastCpuPerCore = cpus.map((c) => ({
      idle: c.times.idle,
      total: Object.values(c.times).reduce((a, b) => a + b, 0),
    }));
    return cpus.map(() => 0);
  }

  const results = [];
  for (let i = 0; i < cpus.length; i++) {
    const tot = Object.values(cpus[i].times).reduce((a, b) => a + b, 0);
    const idl = cpus[i].times.idle;
    const dTot = tot - lastCpuPerCore[i].total;
    const dIdl = idl - lastCpuPerCore[i].idle;
    lastCpuPerCore[i] = { idle: idl, total: tot };
    results.push(dTot <= 0 ? 0 : Math.min(100, Math.max(0, Math.round(100 - (100 * dIdl) / dTot))));
  }
  return results;
}

function getDiskUsage() {
  try {
    const s = fs.statfsSync('/');
    const totalGb = Math.round((s.bsize * s.blocks) / (1024 ** 3));
    const usedGb = Math.round((s.bsize * (s.blocks - s.bfree)) / (1024 ** 3));
    const percent = totalGb > 0 ? Math.round((usedGb / totalGb) * 100) : 0;
    return { totalGb, usedGb, percent };
  } catch (e) {
    return { totalGb: 0, usedGb: 0, percent: 0 };
  }
}

function getLightTelemetry() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuCores = getPerCoreCpu();

  return {
    cpuPercent: getCpuPercent(),
    cpuCores: cpuCores,
    cpuTemp: getCpuTemp(),
    memory: {
      usedGb: (usedMem / 1024 / 1024 / 1024).toFixed(1),
      totalGb: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      percent: Math.round((usedMem / totalMem) * 100),
    },
    disk: getDiskUsage(),
    battery: getBattery(),
    netSpeed: getNetworkSpeed(),
    uptimeSeconds: Math.floor(os.uptime()),
    stealthMode: stealthActive,
    dpmsOn: dpmsOn,
    mac: PRIMARY_MAC,
    tmuxSession: TMUX_SESSION,
  };
}

// Low-overhead telemetry broadcast (every 4 seconds, zero execSync)
setInterval(() => {
  if (clients.size > 0) {
    const data = getLightTelemetry();
    const payload = JSON.stringify({ type: 'telemetry', data });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload, (err) => {
          if (err) clients.delete(client);
        });
      } else {
        clients.delete(client);
      }
    }
  }
}, 4000);

// Heartbeat to clean dead sockets
setInterval(() => {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) {
      clients.delete(client);
    }
  }
}, 15000);

// ==========================================
// 6. Direct System Power & Action Handlers
// ==========================================
function sendWakeOnLan(targetMac = PRIMARY_MAC) {
  return new Promise((resolve, reject) => {
    try {
      const cleanMac = targetMac.replace(/[^0-9a-fA-F]/g, '');
      if (cleanMac.length !== 12) {
        return reject(new Error('Invalid MAC address (must be 12 hex characters)'));
      }
      const macBuffer = Buffer.from(cleanMac, 'hex');
      const magicPacket = Buffer.alloc(102);
      for (let i = 0; i < 6; i++) magicPacket[i] = 0xff;
      for (let i = 0; i < 16; i++) macBuffer.copy(magicPacket, 6 + i * 6);

      const socket = dgram.createSocket('udp4');
      socket.on('error', (err) => {
        try {
          socket.close();
        } catch (e) {}
        reject(err);
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', () => {
          socket.send(magicPacket, 0, magicPacket.length, 9, '192.168.1.255', () => {
            try {
              socket.close();
            } catch (e) {}
            resolve({ success: true, mac: targetMac });
          });
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

function handleAction(action, payload = {}) {
  console.log(`[ACTION] Executing: ${action}`);

  switch (action) {
    case 'poweroff':
    case 'shutdown':
      setTimeout(() => {
        exec('systemctl poweroff --no-ask-password || sudo -n systemctl poweroff');
      }, 300);
      return { success: true, message: 'Shutting down Omarchy PC now...' };

    case 'reboot':
      setTimeout(() => {
        exec('systemctl reboot --no-ask-password || sudo -n systemctl reboot');
      }, 300);
      return { success: true, message: 'Rebooting Omarchy PC now...' };

    case 'suspend':
    case 'sleep':
      setTimeout(() => {
        exec('systemctl suspend --no-ask-password || sudo -n systemctl suspend');
      }, 300);
      return { success: true, message: 'Suspending PC into RAM...' };

    case 'lock':
      exec('omarchy-system-lock || loginctl lock-session');
      return { success: true, message: 'Desktop locked' };

    case 'stealth_toggle':
      stealthActive = !stealthActive;
      dpmsOn = !stealthActive;
      if (stealthActive) {
        exec('hyprctl dispatch dpms off');
        if (!keepAwakeProcess) {
          keepAwakeProcess = spawn('systemd-inhibit', [
            '--what=idle:sleep:handle-lid-switch',
            '--who=omarchy-bridge',
            'sleep',
            'infinity',
          ]);
          keepAwakeProcess.on('error', () => {
            keepAwakeProcess = null;
          });
          keepAwakeProcess.on('exit', () => {
            keepAwakeProcess = null;
          });
        }
      } else {
        exec('hyprctl dispatch dpms on');
        if (keepAwakeProcess) {
          try {
            keepAwakeProcess.kill();
          } catch (e) {}
          keepAwakeProcess = null;
        }
      }
      return { success: true, stealthMode: stealthActive, dpmsOn };

    case 'dpms_toggle':
      if (typeof payload.dpmsOn === 'boolean') {
        dpmsOn = payload.dpmsOn;
      } else if (payload.state === 'on') {
        dpmsOn = true;
      } else if (payload.state === 'off') {
        dpmsOn = false;
      } else {
        dpmsOn = !dpmsOn;
      }
      exec(`hyprctl dispatch dpms ${dpmsOn ? 'on' : 'off'}`, (err) => {
        if (err) console.error(`[DPMS] hyprctl error: ${err.message}`);
      });
      return { success: true, dpmsOn };

    case 'send_wol':
      return sendWakeOnLan(payload.mac || PRIMARY_MAC);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ==========================================
// 6.5 Security Hardening & Rate Limiting
// ==========================================
function timingSafeTokenCheck(providedToken, expectedToken) {
  if (typeof providedToken !== 'string' || typeof expectedToken !== 'string') return false;
  const bufA = Buffer.from(providedToken, 'utf8');
  const bufB = Buffer.from(expectedToken, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const failedAuthAttempts = new Map();

function isClientRateLimited(ip) {
  const entry = failedAuthAttempts.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    failedAuthAttempts.delete(ip);
    return false;
  }
  return false;
}

function recordAuthFailure(ip) {
  const now = Date.now();
  const entry = failedAuthAttempts.get(ip) || { count: 0, firstAttempt: now, lockedUntil: 0 };
  if (now - entry.firstAttempt > 60000) {
    entry.count = 1;
    entry.firstAttempt = now;
    entry.lockedUntil = 0;
  } else {
    entry.count++;
  }
  if (entry.count >= 25) {
    entry.lockedUntil = now + 60000;
    console.warn(`[SECURITY ALERT] Rate-limiting IP ${ip}: 25 failed auth attempts.`);
  }
  failedAuthAttempts.set(ip, entry);
}

function recordAuthSuccess(ip) {
  failedAuthAttempts.delete(ip);
}

function getPrimaryLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// ==========================================
// 7. HTTP & REST Layer
// ==========================================
const server = http.createServer(async (req, res) => {
  const clientIp = req.socket?.remoteAddress || 'unknown';
  const reqUrl = safeParseUrl(req.url, req.headers.host);
  if (!reqUrl) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request\n');
    return;
  }

  // Strict Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), clients: clients.size }));
    return;
  }

  if (isClientRateLimited(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Too Many Requests - Rate limit exceeded' }));
    return;
  }

  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = req.headers['authorization'];
  const token = queryToken || (authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null);

  if (!timingSafeTokenCheck(token, AUTH_TOKEN)) {
    recordAuthFailure(clientIp);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  recordAuthSuccess(clientIp);

  if (reqUrl.pathname === '/api/telemetry') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getLightTelemetry()));
    return;
  }

  if (reqUrl.pathname === '/api/screen') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lines: getCleanScreenLines() }));
    return;
  }

  if (reqUrl.pathname === '/api/memory') {
    if (reqUrl.searchParams.get('gc') === '1' && typeof global.gc === 'function') {
      global.gc();
    }
    const mem = process.memoryUsage();
    const actualSumBytes = scrollbackChunks.reduce((acc, c) => acc + c.bytes, 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
        scrollbackBytes,
        actualSumBytes,
        scrollbackChunksCount: scrollbackChunks.length,
        maxScrollbackBytes: MAX_SCROLLBACK_BYTES,
        maxObservedScrollbackBytes,
        scrollbackExceededCount,
        ptyPaused,
        backpressureEvents,
        activeClients: clients.size,
      })
    );
    return;
  }

  if (reqUrl.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 524288) {
        req.destroy();
      }
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = await handleAction(payload.action, payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Omarchy Fast Bridge Running\n');
});

server.on('error', (err) => {
  console.error('[SERVER] HTTP Error:', err.message);
});

// ==========================================
// 8. WebSocket Upgrade & Client Protocol
// ==========================================
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  socket.on('error', () => {
    try {
      socket.destroy();
    } catch (e) {}
  });

  const reqUrl = safeParseUrl(request.url, request.headers.host);
  if (!reqUrl) {
    socket.destroy();
    return;
  }

  const clientIp = socket.remoteAddress || 'unknown';
  if (isClientRateLimited(clientIp)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = request.headers['authorization'];
  const headerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
  const token = queryToken || headerToken;

  if (!timingSafeTokenCheck(token, AUTH_TOKEN)) {
    recordAuthFailure(clientIp);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  recordAuthSuccess(clientIp);

  try {
    socket.setNoDelay(true);
  } catch (e) {}

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket?.remoteAddress || 'unknown';
  console.log(`[CLIENT] Connected: ${clientIp} (Active: ${clients.size + 1})`);
  clients.add(ws);

  const cleanupClient = () => {
    if (clients.has(ws)) {
      clients.delete(ws);
      console.log(`[CLIENT] Disconnected: ${clientIp} (Remaining: ${clients.size})`);
    }
  };

  ws.on('close', cleanupClient);
  ws.on('error', cleanupClient);

  if (ws.readyState !== WebSocket.OPEN) {
    cleanupClient();
    return;
  }

  // Send fast initial snapshot (max 32KB so launch is instant)
  const initialHistory = getRecentScrollback(32768);
  ws.send(
    JSON.stringify({
      type: 'init',
      session: {
        tmux: TMUX_SESSION,
        shell: USER_SHELL,
      },
      lines: getCleanScreenLines(120),
      history: initialHistory,
      telemetry: getLightTelemetry(),
    }),
    (err) => {
      if (err) cleanupClient();
    }
  );

  ws.on('message', async (message) => {
    try {
      const parsed = JSON.parse(message.toString());

      switch (parsed.type) {
        case 'input':
          if (ptyProcess && typeof parsed.data === 'string') {
            let cmd = parsed.data.replace(/\r?\n$/, '');
            ptyProcess.write(cmd + '\r');
          }
          break;

        case 'raw':
          if (ptyProcess && typeof parsed.data === 'string') {
            ptyProcess.write(parsed.data);
          }
          break;

        case 'signal':
          if (ptyProcess) {
            switch (parsed.signal) {
              case 'ctrl_c':
                ptyProcess.write('\x03');
                break;
              case 'ctrl_d':
                ptyProcess.write('\x04');
                break;
              case 'esc':
                ptyProcess.write('\x1b');
                break;
              case 'enter':
                ptyProcess.write('\r');
                break;
              case 'tab':
                ptyProcess.write('\t');
                break;
              case 'arrow_up':
                ptyProcess.write('\x1b[A');
                break;
              case 'arrow_down':
                ptyProcess.write('\x1b[B');
                break;
              case 'arrow_left':
                ptyProcess.write('\x1b[D');
                break;
              case 'arrow_right':
                ptyProcess.write('\x1b[C');
                break;
            }
          }
          break;

        case 'action':
          try {
            const result = await handleAction(parsed.action, parsed.payload || {});
            ws.send(JSON.stringify({ type: 'action_result', action: parsed.action, result }));
            ws.send(JSON.stringify({ type: 'telemetry', data: getLightTelemetry() }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'action_error', action: parsed.action, error: e.message }));
          }
          break;

        case 'resize':
          if (ptyProcess && parsed.cols && parsed.rows) {
            const cols = Math.max(10, Math.min(parseInt(parsed.cols, 10), 200));
            const rows = Math.max(5, Math.min(parseInt(parsed.rows, 10), 80));
            try {
              headlessTerm.resize(cols, rows);
            } catch (e) {}
            ptyProcess.resize(cols, rows);
            exec(`tmux resize-window -t ${TMUX_SESSION} -x ${cols} -y ${rows} 2>/dev/null`);
          }
          break;

        case 'clear':
          scrollbackChunks = [];
          scrollbackBytes = 0;
          maxObservedScrollbackBytes = 0;
          scrollbackExceededCount = 0;
          try {
            headlessTerm.clear();
            headlessTerm.reset();
          } catch (e) {}
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'cleared' }));
          }
          if (ptyProcess) ptyProcess.write('\x0c');
          lastBroadcastScreen = '';
          broadcastCleanScreen();
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', clientTime: parsed.time, serverTime: Date.now() }));
          break;
      }
    } catch (err) {
      if (ptyProcess) {
        ptyProcess.write(message.toString() + '\r');
      }
    }
  });
});

// ==========================================
// 9. Start Daemon
// ==========================================
server.listen(PORT, HOST, () => {
  const lanIp = getPrimaryLanIp();
  console.log(`\n============================================================`);
  console.log(` Omarchy Ultra-Fast Bridge Daemon Active on Port ${PORT}`);
  console.log(` Session: ${TMUX_SESSION} | Shell: ${USER_SHELL} -l`);
  console.log(` LAN Endpoint: ws://${lanIp}:${PORT}?token=${AUTH_TOKEN}`);
  console.log(`============================================================\n`);
});

function cleanup() {
  if (keepAwakeProcess) {
    try {
      keepAwakeProcess.kill();
    } catch (e) {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
