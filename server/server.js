/**
 * Omarchy Linux Remote CLI Bridge & Mission Control Daemon
 * Full Autonomous Production Stack
 *
 * Capabilities:
 * - AGENT 1: Headless PTY, Environment Inheritance, @xterm/headless Virtual Screen & Tmux Multi-Window
 * - AGENT 2: Live hardware telemetry (per-core CPU, RAM/Swap, GPU/CPU temps, disk, battery, net speed, top processes, stealth mode, rtcwake, WoL, powerprofilesctl)
 * - AGENT 3: Zero-trust token guard, systemd background execution, live desktop screenshot streaming (grim)
 */

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const dgram = require('dgram');
const { exec, execSync, spawn } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer, WebSocket } = require('ws');
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
require('dotenv').config();

// ==========================================
// 1. Configuration & Security
// ==========================================
const PORT = parseInt(process.env.PORT || '19001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TMUX_SESSION = process.env.TMUX_SESSION || 'omarchy-remote';
const USER_SHELL = process.env.SHELL_CMD || process.env.SHELL || '/usr/bin/fish';
const WORK_DIR = process.env.WORK_DIR || process.env.HOME || process.cwd();
const BUFFER_MAX_BYTES = parseInt(process.env.BUFFER_MAX_BYTES || '2097152', 10); // 2 MB
const PRIMARY_MAC = process.env.PRIMARY_MAC || '14:13:33:a8:af:df';

// Enforce full environment PATH for agy, node, python, git
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

let AUTH_TOKEN = process.env.AUTH_TOKEN || 'omarchy-bridge-secure-key-2026';

// ==========================================
// 2. High-Capacity Scrollback & Headless Terminal Engine
// ==========================================
class CircularScrollbackBuffer {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.buffer = [];
    this.currentBytes = 0;
  }

  append(chunk) {
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    this.buffer.push({ data: chunk, bytes: chunkBytes, time: Date.now() });
    this.currentBytes += chunkBytes;

    while (this.currentBytes > this.maxBytes && this.buffer.length > 0) {
      const removed = this.buffer.shift();
      this.currentBytes -= removed.bytes;
    }
  }

  getAll() {
    return this.buffer.map((item) => item.data).join('');
  }

  clear() {
    this.buffer = [];
    this.currentBytes = 0;
  }
}

const scrollback = new CircularScrollbackBuffer(BUFFER_MAX_BYTES);

// Headless terminal emulator to maintain clean 2D screen buffer
const headlessTerm = new HeadlessTerminal({
  cols: 80,
  rows: 30,
  allowProposedApi: true,
  scrollback: 5000,
});
const serializeAddon = new SerializeAddon();
headlessTerm.loadAddon(serializeAddon);

function getCleanScreenLines() {
  const lines = [];
  const buffer = headlessTerm.buffer.active;
  const numRows = headlessTerm.rows;
  for (let y = 0; y < numRows; y++) {
    const line = buffer.getLine(buffer.baseY + y);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines;
}

// ==========================================
// 3. Tmux Multi-Window & Session Management
// ==========================================
function ensureTmuxSession() {
  try {
    execSync(`tmux has-session -t ${TMUX_SESSION} 2>/dev/null`);
  } catch (e) {
    console.log(`[TMUX] Creating persistent detached session: ${TMUX_SESSION} (${USER_SHELL} -l)`);
    try {
      execSync(`tmux set-environment -g PATH "${process.env.PATH}" 2>/dev/null || true`);
      execSync(`tmux set-environment -g DBUS_SESSION_BUS_ADDRESS "${process.env.DBUS_SESSION_BUS_ADDRESS}" 2>/dev/null || true`);
      execSync(`tmux set-environment -g XDG_RUNTIME_DIR "${process.env.XDG_RUNTIME_DIR}" 2>/dev/null || true`);
      execSync(`tmux set-environment -g XDG_CONFIG_HOME "${process.env.XDG_CONFIG_HOME}" 2>/dev/null || true`);
      execSync(`tmux new-session -d -s ${TMUX_SESSION} -n "terminal" -c "${WORK_DIR}" "${USER_SHELL} -l"`);
      execSync(`tmux set-option -t ${TMUX_SESSION} status off`);
      execSync(`tmux set-option -t ${TMUX_SESSION} history-limit 20000`);
      execSync(`tmux set-option -t ${TMUX_SESSION} default-terminal "xterm-256color"`);
    } catch (err) {
      console.error(`[TMUX] Error initializing session:`, err.message);
    }
  }
}

function listWindows() {
  try {
    const out = execSync(
      `tmux list-windows -t ${TMUX_SESSION} -F "#{window_index}:#{window_name}:#{window_active}" 2>/dev/null`
    )
      .toString()
      .trim();
    if (!out) return [{ index: 1, name: 'terminal', active: true }];
    return out.split('\n').map((line) => {
      const parts = line.split(':');
      return {
        index: parseInt(parts[0], 10),
        name: parts[1] || `win-${parts[0]}`,
        active: parts[2] === '1',
      };
    });
  } catch (e) {
    return [{ index: 1, name: 'terminal', active: true }];
  }
}

function getPaneSnapshot() {
  try {
    return execSync(`tmux capture-pane -p -e -t ${TMUX_SESSION}`).toString();
  } catch (e) {
    return '';
  }
}

// ==========================================
// 4. Linux PTY Manager (tmux Attachment)
// ==========================================
let ptyProcess = null;
const clients = new Set();

function spawnPty(cols = 80, rows = 30) {
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {}
  }

  ensureTmuxSession();

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

  ptyProcess.onData((data) => {
    // Intercept and auto-respond to terminal feature probes (crucial for fish/omarchy prompts)
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

    // Feed headless terminal emulator
    try {
      headlessTerm.write(data);
    } catch (e) {}

    scrollback.append(data);

    // Broadcast raw chunk to clients (consumed by xterm.js WebView)
    const payload = JSON.stringify({ type: 'output', data });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    const payload = JSON.stringify({
      type: 'status',
      status: 'detached',
      exitCode,
      message: `\r\n\x1b[33m[Session detached - Reconnecting to tmux session ${TMUX_SESSION}...]\x1b[0m\r\n`,
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }

    setTimeout(() => {
      spawnPty(cols, rows);
    }, 1000);
  });
}

spawnPty(80, 30);

// ==========================================
// 5. Hardware Telemetry & Sensor Engine
// ==========================================
let lastCpuPerCore = null;
let lastNetSample = null;
let keepAwakeProcess = null;

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
    results.push(dTot === 0 ? 0 : Math.min(100, Math.max(0, Math.round(100 - (100 * dIdl) / dTot))));
  }
  return results;
}

function getCpuTemp() {
  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    return Math.round(parseInt(raw.trim(), 10) / 1000);
  } catch (e) {
    return null;
  }
}

function getDiskUsage() {
  try {
    const df = execSync('df -k / | tail -1').toString().trim().split(/\s+/);
    return {
      totalGb: Math.round(parseInt(df[1], 10) / 1024 / 1024),
      usedGb: Math.round(parseInt(df[2], 10) / 1024 / 1024),
      percent: parseInt(df[4], 10) || 0,
    };
  } catch (e) {
    return { totalGb: 0, usedGb: 0, percent: 0 };
  }
}

function getSwapUsage() {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const totalMatch = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/);
    const freeMatch = meminfo.match(/SwapFree:\s+(\d+)\s+kB/);
    if (totalMatch && freeMatch) {
      const totalKb = parseInt(totalMatch[1], 10);
      const freeKb = parseInt(freeMatch[1], 10);
      const usedKb = totalKb - freeKb;
      return {
        totalGb: (totalKb / 1024 / 1024).toFixed(1),
        usedGb: (usedKb / 1024 / 1024).toFixed(1),
        percent: totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0,
      };
    }
  } catch (e) {}
  return { totalGb: '0.0', usedGb: '0.0', percent: 0 };
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

function getTopProcesses() {
  try {
    const lines = execSync('ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n 6')
      .toString()
      .trim()
      .split('\n');
    return lines.slice(1).map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[0], 10),
        user: parts[1],
        cpu: parseFloat(parts[2]),
        mem: parseFloat(parts[3]),
        command: parts.slice(4).join(' '),
      };
    });
  } catch (e) {
    return [];
  }
}

function getDpmsStatus() {
  try {
    const out = execSync('hyprctl monitors -j 2>/dev/null').toString();
    const parsed = JSON.parse(out);
    return parsed[0] ? Boolean(parsed[0].dpmsStatus) : true;
  } catch (e) {
    return true;
  }
}

function getGovernor() {
  try {
    return fs.readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'utf8').trim();
  } catch (e) {
    return 'performance';
  }
}

function getPowerProfile() {
  try {
    const profile = execSync('powerprofilesctl get 2>/dev/null').toString().trim();
    if (profile) return profile;
  } catch (e) {}
  return getGovernor();
}

function getFullTelemetry() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cores = getPerCoreCpu();
  const avgCpu = cores.length > 0 ? Math.round(cores.reduce((a, b) => a + b, 0) / cores.length) : 0;

  return {
    cpuPercent: avgCpu,
    cpuCores: cores,
    cpuTemp: getCpuTemp(),
    memory: {
      usedGb: (usedMem / 1024 / 1024 / 1024).toFixed(1),
      totalGb: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      percent: Math.round((usedMem / totalMem) * 100),
    },
    swap: getSwapUsage(),
    disk: getDiskUsage(),
    battery: getBattery(),
    netSpeed: getNetworkSpeed(),
    topProcesses: getTopProcesses(),
    uptimeSeconds: Math.floor(os.uptime()),
    dpmsOn: getDpmsStatus(),
    keepAwake: keepAwakeProcess !== null,
    stealthMode: !getDpmsStatus() && keepAwakeProcess !== null,
    governor: getGovernor(),
    powerProfile: getPowerProfile(),
    mac: PRIMARY_MAC,
    tmuxSession: TMUX_SESSION,
    windows: listWindows(),
  };
}

// ==========================================
// 6. Wake-on-LAN & System Action Dispatcher
// ==========================================
function sendWakeOnLan(targetMac = PRIMARY_MAC) {
  return new Promise((resolve, reject) => {
    try {
      const cleanMac = targetMac.replace(/[^0-9a-fA-F]/g, '');
      if (cleanMac.length !== 12) {
        return reject(new Error('Invalid MAC address format (must be 12 hex characters)'));
      }

      const macBuffer = Buffer.from(cleanMac, 'hex');
      const magicPacket = Buffer.alloc(102);
      for (let i = 0; i < 6; i++) magicPacket[i] = 0xff;
      for (let i = 0; i < 16; i++) macBuffer.copy(magicPacket, 6 + i * 6);

      const socket = dgram.createSocket('udp4');
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', () => {
          socket.send(magicPacket, 0, magicPacket.length, 9, '192.168.1.255', () => {
            socket.close();
            resolve({ success: true, mac: targetMac });
          });
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

function captureScreenshotJpeg() {
  return new Promise((resolve, reject) => {
    exec('grim -t jpeg -q 70 -', { encoding: 'buffer', maxBuffer: 15 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function handleSystemAction(action, payload = {}) {
  console.log(`[ACTION] Executing: ${action}`, payload);

  switch (action) {
    case 'stealth_mode_toggle': {
      const currentDpms = getDpmsStatus();
      if (currentDpms) {
        // Enable Stealth: Turn screen off + activate keep-awake
        execSync('hyprctl dispatch dpms off');
        if (!keepAwakeProcess) {
          keepAwakeProcess = spawn('systemd-inhibit', [
            '--what=idle:sleep:handle-lid-switch',
            '--who=omarchy-bridge',
            '--why=Stealth Remote Mode Active',
            'sleep',
            'infinity',
          ]);
          keepAwakeProcess.on('exit', () => {
            keepAwakeProcess = null;
          });
        }
        return { success: true, stealthMode: true, dpmsOn: false, keepAwake: true };
      } else {
        // Disable Stealth: Turn screen on + release keep-awake
        execSync('hyprctl dispatch dpms on');
        if (keepAwakeProcess) {
          try {
            keepAwakeProcess.kill();
          } catch (e) {}
          keepAwakeProcess = null;
        }
        return { success: true, stealthMode: false, dpmsOn: true, keepAwake: false };
      }
    }

    case 'dpms_toggle': {
      const current = getDpmsStatus();
      const next = current ? 'off' : 'on';
      execSync(`hyprctl dispatch dpms ${next}`);
      return { success: true, dpmsOn: !current };
    }

    case 'lock':
      exec('hyprlock || loginctl lock-session');
      return { success: true, message: 'Session locked' };

    case 'keep_awake_toggle':
      if (keepAwakeProcess) {
        try {
          keepAwakeProcess.kill();
        } catch (e) {}
        keepAwakeProcess = null;
        return { success: true, keepAwake: false };
      } else {
        keepAwakeProcess = spawn('systemd-inhibit', [
          '--what=idle:sleep:handle-lid-switch',
          '--who=omarchy-bridge',
          '--why=Remote iOS Control Center Session',
          'sleep',
          'infinity',
        ]);
        keepAwakeProcess.on('exit', () => {
          keepAwakeProcess = null;
        });
        return { success: true, keepAwake: true };
      }

    case 'rtcwake': {
      const seconds = parseInt(payload.seconds, 10);
      if (!seconds || seconds <= 0) {
        throw new Error('Invalid seconds for rtcwake');
      }
      console.log(`[RTCWAKE] Suspending machine with hardware wake in ${seconds}s...`);
      exec(`sudo rtcwake -m mem -s ${seconds} || rtcwake -m mem -s ${seconds}`);
      return { success: true, wakeInSeconds: seconds };
    }

    case 'suspend':
      setTimeout(() => {
        exec('sudo systemctl suspend || systemctl suspend');
      }, 500);
      return { success: true, message: 'Suspending machine...' };

    case 'reboot':
      setTimeout(() => {
        exec('sudo systemctl reboot || systemctl reboot');
      }, 800);
      return { success: true, message: 'Rebooting...' };

    case 'poweroff':
      setTimeout(() => {
        exec('sudo systemctl poweroff || systemctl poweroff');
      }, 800);
      return { success: true, message: 'Shutting down...' };

    case 'kill_process': {
      const pid = parseInt(payload.pid, 10);
      if (!pid || pid <= 1) throw new Error('Invalid PID to terminate');
      execSync(`kill -9 ${pid} 2>/dev/null || sudo kill -9 ${pid}`);
      return { success: true, killedPid: pid };
    }

    case 'set_power_profile': {
      const profile = payload.profile;
      if (!profile || !['performance', 'balanced', 'power-saver'].includes(profile)) {
        throw new Error('Invalid power profile');
      }
      try {
        execSync(`powerprofilesctl set ${profile} 2>/dev/null || true`);
      } catch (e) {}
      return { success: true, powerProfile: profile };
    }

    case 'set_governor': {
      const gov = payload.governor;
      if (!gov || !['performance', 'powersave', 'balanced', 'schedutil'].includes(gov)) {
        throw new Error('Invalid governor option');
      }
      try {
        execSync(`echo "${gov}" | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null || true`);
      } catch (e) {}
      return { success: true, governor: gov };
    }

    case 'send_wol':
      return await sendWakeOnLan(payload.mac || PRIMARY_MAC);

    case 'screenshot': {
      const buffer = await captureScreenshotJpeg();
      return { success: true, base64: buffer.toString('base64') };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// Periodic Telemetry Broadcaster (every 2.5 seconds)
setInterval(() => {
  if (clients.size > 0) {
    const telemetry = getFullTelemetry();
    const payload = JSON.stringify({ type: 'telemetry', data: telemetry });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}, 2500);

// ==========================================
// 7. HTTP & REST Endpoints
// ==========================================
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = req.headers['authorization'];
  const token = queryToken || (authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Public health check
  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        clients: clients.size,
        tmuxSession: TMUX_SESSION,
      })
    );
    return;
  }

  // Token Auth Guard for /api/*
  if (token !== AUTH_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized: Invalid token' }));
    return;
  }

  // GET /api/telemetry
  if (reqUrl.pathname === '/api/telemetry' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getFullTelemetry()));
    return;
  }

  // GET /api/screen (clean headless screen lines)
  if (reqUrl.pathname === '/api/screen' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lines: getCleanScreenLines() }));
    return;
  }

  // GET /api/pair (Diagnostics & Pairing Payload)
  if (reqUrl.pathname === '/api/pair' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        serverName: 'Omarchy Remote Station',
        token: AUTH_TOKEN,
        port: PORT,
        mac: PRIMARY_MAC,
        session: TMUX_SESSION,
        shell: USER_SHELL,
        endpoints: Object.entries(os.networkInterfaces())
          .flatMap(([_, addrs]) => addrs.filter((a) => a.family === 'IPv4'))
          .map((a) => `ws://${a.address}:${PORT}`),
      })
    );
    return;
  }

  // GET /api/screenshot
  if (reqUrl.pathname === '/api/screenshot' && req.method === 'GET') {
    try {
      const buffer = await captureScreenshotJpeg();
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
      });
      res.end(buffer);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Screenshot capture failed: ' + e.message }));
    }
    return;
  }

  // POST /api/action
  if (reqUrl.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const result = await handleSystemAction(payload.action, payload);
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
  res.end('Omarchy Remote CLI Bridge & Mission Control Daemon\n');
});

// ==========================================
// 8. WebSocket Upgrade & Handshake
// ==========================================
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const reqUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = request.headers['authorization'];
  const headerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
  const protoHeader = request.headers['sec-websocket-protocol'];

  const candidateToken = queryToken || headerToken || protoHeader;

  if (!candidateToken || candidateToken !== AUTH_TOKEN) {
    console.warn(`[SECURITY] Rejected unauthorized connection attempt from ${socket.remoteAddress}`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// ==========================================
// 9. WebSocket Client Protocol
// ==========================================
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[CLIENT] Connected: ${clientIp} (Total clients: ${clients.size + 1})`);
  clients.add(ws);

  const historyData = scrollback.getAll() || getPaneSnapshot();
  const screenLines = getCleanScreenLines();

  ws.send(
    JSON.stringify({
      type: 'init',
      session: {
        tmux: TMUX_SESSION,
        shell: USER_SHELL,
        cwd: WORK_DIR,
        pid: ptyProcess ? ptyProcess.pid : null,
        serverTime: Date.now(),
      },
      history: historyData,
      screen: screenLines,
      telemetry: getFullTelemetry(),
      windows: listWindows(),
    })
  );

  if (ptyProcess) {
    ptyProcess.write('\x0c');
  }

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
              case 'SIGINT':
                ptyProcess.write('\x03');
                break;
              case 'ctrl_d':
              case 'EOF':
                ptyProcess.write('\x04');
                break;
              case 'ctrl_z':
              case 'SIGTSTP':
                ptyProcess.write('\x1a');
                break;
              case 'ctrl_l':
                ptyProcess.write('\x0c');
                break;
              case 'esc':
              case 'escape':
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
              case 'arrow_right':
                ptyProcess.write('\x1b[C');
                break;
              case 'arrow_left':
                ptyProcess.write('\x1b[D');
                break;
            }
          }
          break;

        // Multi-Window tmux Management
        case 'window_new': {
          const winName = (parsed.name || 'term').replace(/[^a-zA-Z0-9_-]/g, '');
          try {
            execSync(`tmux new-window -t ${TMUX_SESSION} -n "${winName}" -c "${WORK_DIR}" "${USER_SHELL} -l" 2>/dev/null`);
            if (ptyProcess) ptyProcess.write('\x0c');
          } catch (e) {}
          ws.send(JSON.stringify({ type: 'windows', data: listWindows() }));
          break;
        }

        case 'window_switch': {
          const idx = parseInt(parsed.index, 10);
          if (idx) {
            try {
              execSync(`tmux select-window -t ${TMUX_SESSION}:${idx} 2>/dev/null`);
              if (ptyProcess) ptyProcess.write('\x0c');
            } catch (e) {}
            ws.send(JSON.stringify({ type: 'windows', data: listWindows() }));
          }
          break;
        }

        case 'window_rename': {
          const idx = parseInt(parsed.index, 10);
          const newName = (parsed.name || '').replace(/[^a-zA-Z0-9_-]/g, '');
          if (idx && newName) {
            try {
              execSync(`tmux rename-window -t ${TMUX_SESSION}:${idx} "${newName}" 2>/dev/null`);
            } catch (e) {}
            ws.send(JSON.stringify({ type: 'windows', data: listWindows() }));
          }
          break;
        }

        case 'window_close': {
          const idx = parseInt(parsed.index, 10);
          if (idx) {
            try {
              execSync(`tmux kill-window -t ${TMUX_SESSION}:${idx} 2>/dev/null`);
              if (ptyProcess) ptyProcess.write('\x0c');
            } catch (e) {}
            ws.send(JSON.stringify({ type: 'windows', data: listWindows() }));
          }
          break;
        }

        case 'get_screen':
          ws.send(JSON.stringify({ type: 'screen', lines: getCleanScreenLines() }));
          break;

        case 'action':
          try {
            const result = await handleSystemAction(parsed.action, parsed.payload || {});
            ws.send(
              JSON.stringify({
                type: 'action_result',
                action: parsed.action,
                result,
              })
            );
            ws.send(
              JSON.stringify({
                type: 'telemetry',
                data: getFullTelemetry(),
              })
            );
          } catch (e) {
            ws.send(
              JSON.stringify({
                type: 'action_error',
                action: parsed.action,
                error: e.message,
              })
            );
          }
          break;

        case 'resize':
          if (ptyProcess && parsed.cols && parsed.rows) {
            const cols = Math.max(10, Math.min(parseInt(parsed.cols, 10), 300));
            const rows = Math.max(5, Math.min(parseInt(parsed.rows, 10), 100));
            try {
              headlessTerm.resize(cols, rows);
            } catch (e) {}
            ptyProcess.resize(cols, rows);
            try {
              execSync(`tmux resize-window -t ${TMUX_SESSION} -x ${cols} -y ${rows} 2>/dev/null`);
            } catch (e) {}
          }
          break;

        case 'clear':
          scrollback.clear();
          try {
            headlessTerm.clear();
          } catch (e) {}
          ws.send(JSON.stringify({ type: 'cleared' }));
          if (ptyProcess) ptyProcess.write('\x0c');
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', clientTime: parsed.time, serverTime: Date.now() }));
          break;
      }
    } catch (err) {
      const rawText = message.toString();
      if (ptyProcess) {
        let cmd = rawText.replace(/\r?\n$/, '');
        ptyProcess.write(cmd + '\r');
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[CLIENT] Disconnected: ${clientIp} (Remaining: ${clients.size})`);
  });

  ws.on('error', (err) => {
    console.error(`[CLIENT] Socket error from ${clientIp}:`, err.message);
    clients.delete(ws);
  });
});

// ==========================================
// 10. Start Server
// ==========================================
server.listen(PORT, HOST, () => {
  const interfaces = os.networkInterfaces();
  console.log('\n============================================================');
  console.log(` Omarchy Remote Mission Control Daemon running on port ${PORT}`);
  console.log('============================================================');
  console.log(` tmux Session:  ${TMUX_SESSION} (Detached, Multi-Window)`);
  console.log(` Login Shell:   ${USER_SHELL} -l`);
  console.log(` Primary MAC:   ${PRIMARY_MAC}`);
  console.log('------------------------------------------------------------');
  console.log(' Available Endpoints:');

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4') {
        const isTailscale = name.includes('tailscale') || addr.address.startsWith('100.');
        const tag = isTailscale ? ' [TAILSCALE - Global Mesh]' : addr.internal ? ' [Loopback]' : ' [Local LAN]';
        console.log(`  * ${name}: ws://${addr.address}:${PORT}?token=${AUTH_TOKEN}${tag}`);
      }
    }
  }
  console.log('============================================================\n');
});

function cleanup() {
  console.log('\n[SERVER] Stopping bridge server (tmux session remains running)...');
  if (keepAwakeProcess) {
    try {
      keepAwakeProcess.kill();
    } catch (e) {}
  }
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
