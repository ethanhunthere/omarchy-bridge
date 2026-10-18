/**
 * Omarchy Linux Remote CLI Bridge & Mission Control Daemon
 * High-Speed, Non-Blocking Architecture
 */

const http = require('http');
const os = require('os');
const fs = require('fs');
const dgram = require('dgram');
const { exec, spawn } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer, WebSocket } = require('ws');
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

let AUTH_TOKEN = process.env.AUTH_TOKEN || 'omarchy-bridge-secure-key-2026';

// ==========================================
// 2. High-Performance Circular Scrollback
// ==========================================
const MAX_SCROLLBACK_BYTES = 512 * 1024; // 512 KB
let scrollbackChunks = [];
let scrollbackBytes = 0;

function appendScrollback(chunk) {
  const bytes = Buffer.byteLength(chunk, 'utf8');
  scrollbackChunks.push({ data: chunk, bytes });
  scrollbackBytes += bytes;

  while (scrollbackBytes > MAX_SCROLLBACK_BYTES && scrollbackChunks.length > 0) {
    const rem = scrollbackChunks.shift();
    scrollbackBytes -= rem.bytes;
  }
}

function getRecentScrollback(maxBytes = 32768) {
  let acc = '';
  for (let i = scrollbackChunks.length - 1; i >= 0; i--) {
    acc = scrollbackChunks[i].data + acc;
    if (Buffer.byteLength(acc, 'utf8') >= maxBytes) break;
  }
  return acc;
}

// ==========================================
// 3. Persistent Headless tmux Engine
// ==========================================
function ensureTmuxSession() {
  exec(`tmux has-session -t ${TMUX_SESSION} 2>/dev/null`, (err) => {
    if (err) {
      console.log(`[TMUX] Spawning detached session: ${TMUX_SESSION} (${USER_SHELL} -l)`);
      exec(
        `tmux set-environment -g PATH "${process.env.PATH}"; ` +
          `tmux set-environment -g DBUS_SESSION_BUS_ADDRESS "${process.env.DBUS_SESSION_BUS_ADDRESS}"; ` +
          `tmux set-environment -g XDG_RUNTIME_DIR "${process.env.XDG_RUNTIME_DIR}"; ` +
          `tmux new-session -d -s ${TMUX_SESSION} -n "terminal" -c "${WORK_DIR}" "${USER_SHELL} -l"; ` +
          `tmux set-option -t ${TMUX_SESSION} status off; ` +
          `tmux set-option -t ${TMUX_SESSION} default-terminal "xterm-256color"`,
        (e) => {
          if (e) console.error('[TMUX] Init error:', e.message);
        }
      );
    }
  });
}

ensureTmuxSession();

// ==========================================
// 4. Zero-Delay PTY Process
// ==========================================
let ptyProcess = null;
const clients = new Set();

function spawnPty(cols = 80, rows = 30) {
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

    appendScrollback(data);

    // Direct immediate broadcast (zero latency)
    if (clients.size > 0) {
      const payload = JSON.stringify({ type: 'output', data });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    const payload = JSON.stringify({
      type: 'status',
      message: `\r\n\x1b[33m[Session reconnecting to ${TMUX_SESSION}...]\x1b[0m\r\n`,
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
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

function getLightTelemetry() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    cpuPercent: getCpuPercent(),
    cpuTemp: getCpuTemp(),
    memory: {
      usedGb: (usedMem / 1024 / 1024 / 1024).toFixed(1),
      totalGb: (totalMem / 1024 / 1024 / 1024).toFixed(1),
      percent: Math.round((usedMem / totalMem) * 100),
    },
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
        client.send(payload);
      }
    }
  }
}, 4000);

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

function handleAction(action, payload = {}) {
  console.log(`[ACTION] Executing: ${action}`);

  switch (action) {
    // 1. Instant Shutdown
    case 'poweroff':
    case 'shutdown':
      setTimeout(() => {
        exec('systemctl poweroff || sudo systemctl poweroff');
      }, 300);
      return { success: true, message: 'Shutting down Omarchy PC now...' };

    // 2. Instant Reboot
    case 'reboot':
      setTimeout(() => {
        exec('systemctl reboot || sudo systemctl reboot');
      }, 300);
      return { success: true, message: 'Rebooting Omarchy PC now...' };

    // 3. Sleep / Suspend
    case 'suspend':
    case 'sleep':
      setTimeout(() => {
        exec('systemctl suspend || sudo systemctl suspend');
      }, 300);
      return { success: true, message: 'Suspending PC into RAM...' };

    // 4. Lock Screen
    case 'lock':
      exec('hyprlock || loginctl lock-session');
      return { success: true, message: 'Desktop locked' };

    // 5. Stealth Mode Toggle (Display Off + Prevent Sleep)
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

    // 6. Display Toggle
    case 'dpms_toggle':
      dpmsOn = !dpmsOn;
      exec(`hyprctl dispatch dpms ${dpmsOn ? 'on' : 'off'}`);
      return { success: true, dpmsOn };

    // 7. Dispatch Wake-on-LAN Magic Packet
    case 'send_wol':
      return sendWakeOnLan(payload.mac || PRIMARY_MAC);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ==========================================
// 7. HTTP & REST Layer
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

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), clients: clients.size }));
    return;
  }

  if (token !== AUTH_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (reqUrl.pathname === '/api/telemetry') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getLightTelemetry()));
    return;
  }

  if (reqUrl.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
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

// ==========================================
// 8. WebSocket Upgrade & Client Protocol
// ==========================================
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const reqUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = request.headers['authorization'];
  const headerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
  const token = queryToken || headerToken;

  if (token !== AUTH_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[CLIENT] Connected: ${clientIp} (Active: ${clients.size + 1})`);
  clients.add(ws);

  // Send fast initial snapshot (max 32KB so launch is instant)
  const initialHistory = getRecentScrollback(32768);
  ws.send(
    JSON.stringify({
      type: 'init',
      session: {
        tmux: TMUX_SESSION,
        shell: USER_SHELL,
      },
      history: initialHistory,
      telemetry: getLightTelemetry(),
    })
  );

  ws.on('message', async (message) => {
    try {
      const parsed = JSON.parse(message.toString());

      switch (parsed.type) {
        // Direct command input
        case 'input':
          if (ptyProcess && typeof parsed.data === 'string') {
            let cmd = parsed.data.replace(/\r?\n$/, '');
            ptyProcess.write(cmd + '\r');
          }
          break;

        // Raw input stream
        case 'raw':
          if (ptyProcess && typeof parsed.data === 'string') {
            ptyProcess.write(parsed.data);
          }
          break;

        // Interactive control signals
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
            }
          }
          break;

        // Power actions (shutdown, reboot, suspend, stealth, etc.)
        case 'action':
          try {
            const result = await handleAction(parsed.action, parsed.payload || {});
            ws.send(JSON.stringify({ type: 'action_result', action: parsed.action, result }));
            ws.send(JSON.stringify({ type: 'telemetry', data: getLightTelemetry() }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'action_error', action: parsed.action, error: e.message }));
          }
          break;

        // Resize terminal dimensions
        case 'resize':
          if (ptyProcess && parsed.cols && parsed.rows) {
            const cols = Math.max(10, Math.min(parseInt(parsed.cols, 10), 200));
            const rows = Math.max(5, Math.min(parseInt(parsed.rows, 10), 80));
            ptyProcess.resize(cols, rows);
            exec(`tmux resize-window -t ${TMUX_SESSION} -x ${cols} -y ${rows} 2>/dev/null`);
          }
          break;

        // Clear terminal output
        case 'clear':
          scrollbackChunks = [];
          scrollbackBytes = 0;
          ws.send(JSON.stringify({ type: 'cleared' }));
          if (ptyProcess) ptyProcess.write('\x0c');
          break;

        // Latency ping
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

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[CLIENT] Disconnected: ${clientIp} (Remaining: ${clients.size})`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// ==========================================
// 9. Start Daemon
// ==========================================
server.listen(PORT, HOST, () => {
  console.log(`\n============================================================`);
  console.log(` Omarchy Ultra-Fast Bridge Daemon Active on Port ${PORT}`);
  console.log(` Session: ${TMUX_SESSION} | Shell: ${USER_SHELL} -l`);
  console.log(` LAN Endpoint: ws://192.168.1.6:${PORT}?token=${AUTH_TOKEN}`);
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
