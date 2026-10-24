/**
 * Omarchy Bridge - Cloudflare Tunnel (primary remote transport)
 *
 * Resolution order for the public URL:
 *   1. TUNNEL_URL env (e.g. https://bridge.example.com)
 *   2. First `hostname:` in ~/.cloudflared/config.yml or /etc/cloudflared/config.yml
 *   3. Managed quick tunnel when TUNNEL_MODE=quick (random *.trycloudflare.com URL,
 *      parsed from cloudflared output; auto-restarts if it dies)
 *
 * The bridge itself never needs inbound ports: cloudflared dials out to the
 * Cloudflare edge, and phones connect wss://<tunnel-url>.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let managedChild = null;
let quickUrl = null;

function which(cmd) {
  try {
    return execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return null;
  }
}

function readConfigUrl() {
  const files = [
    path.join(os.homedir(), '.cloudflared', 'config.yml'),
    '/etc/cloudflared/config.yml',
    '/etc/cloudflared/config.yaml',
  ];
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/^\s*hostname:\s*(\S+)/m);
      if (match && match[1]) return `https://${match[1]}`;
    } catch (e) {}
  }
  return null;
}

function startQuickTunnel(port) {
  if (managedChild) return;
  const bin = which('cloudflared');
  if (!bin) {
    console.warn('[TUNNEL] cloudflared not found - remote tunnel disabled.');
    return;
  }
  try {
    managedChild = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.warn(`[TUNNEL] cloudflared failed to start: ${e.message}`);
    managedChild = null;
    return;
  }

  const scan = (buf) => {
    const match = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== quickUrl) {
      quickUrl = match[0];
      console.log(`[TUNNEL] Quick tunnel live: ${quickUrl}`);
    }
  };
  managedChild.stdout.on('data', scan);
  managedChild.stderr.on('data', scan);
  managedChild.on('exit', (code) => {
    managedChild = null;
    quickUrl = null;
    if (process.env.TUNNEL_MODE === 'quick') {
      console.warn(`[TUNNEL] cloudflared exited (${code}) - restarting in 5s`);
      setTimeout(() => startQuickTunnel(port), 5000);
    }
  });
}

function startTunnel(port) {
  if (process.env.TUNNEL_MODE === 'quick') startQuickTunnel(port);
}

function stopTunnel() {
  if (managedChild) {
    try {
      managedChild.kill();
    } catch (e) {}
    managedChild = null;
  }
}

function getTunnelInfo() {
  if (process.env.TUNNEL_URL) {
    return { available: true, url: process.env.TUNNEL_URL.replace(/\/+$/, ''), mode: 'named' };
  }
  if (quickUrl) {
    return { available: true, url: quickUrl, mode: 'quick' };
  }
  const configUrl = readConfigUrl();
  if (configUrl) {
    return { available: true, url: configUrl, mode: 'named' };
  }
  return { available: false, url: null, mode: process.env.TUNNEL_MODE === 'quick' ? 'quick' : 'none' };
}

module.exports = {
  startTunnel,
  stopTunnel,
  getTunnelInfo,
};
