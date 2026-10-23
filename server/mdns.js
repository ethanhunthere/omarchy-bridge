/**
 * Omarchy Bridge mDNS Advertiser
 * Publishes a stable LAN hostname (omarchy-bridge.local) plus a
 * _omarchy-bridge._tcp service so the mobile app can find the PC
 * without any hardcoded IP address or manual setup.
 */

const os = require('os');
const mdns = require('multicast-dns');

const HOSTNAME = process.env.MDNS_HOST || 'omarchy-bridge.local';
const SERVICE_TYPE = '_omarchy-bridge._tcp.local';
const SERVICE_NAME = `Omarchy Bridge.${SERVICE_TYPE}`;
const RECORD_TTL = 120;

let instance = null;
let currentIp = null;
let announceTimer = null;
let refreshTimer = null;

function getLanIp() {
  const interfaces = os.networkInterfaces();
  const preferred = ['wlan0', 'wlp0s20f3', 'enp0s3', 'eth0'];
  const names = [...preferred, ...Object.keys(interfaces)];

  for (const name of names) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function buildRecords(port, ip, ttl = RECORD_TTL) {
  return [
    { name: SERVICE_TYPE, type: 'PTR', ttl, data: SERVICE_NAME },
    { name: SERVICE_NAME, type: 'SRV', ttl, flush: true, data: { port, target: HOSTNAME } },
    { name: SERVICE_NAME, type: 'TXT', ttl, flush: true, data: ['version=1'] },
    { name: HOSTNAME, type: 'A', ttl, flush: true, data: ip },
  ];
}

function announce(port) {
  if (!instance || !currentIp) return;
  const records = buildRecords(port, currentIp);
  try {
    instance.respond({ answers: records, additionals: records });
  } catch (e) {
    console.warn('[MDNS] Announce failed:', e.message);
  }
}

function goodbye(port, ip) {
  if (!instance || !ip) return;
  const records = buildRecords(port, ip, 0);
  try {
    instance.respond({ answers: records });
  } catch (e) {}
}

function handleQuery(port, query) {
  const records = buildRecords(port, currentIp);
  const answers = [];
  const additionals = [];

  for (const question of query.questions || []) {
    if (question.name === HOSTNAME && (question.type === 'A' || question.type === 'ANY')) {
      answers.push(records[3]);
    } else if (question.name === SERVICE_TYPE && (question.type === 'PTR' || question.type === 'ANY')) {
      answers.push(records[0]);
      additionals.push(records[1], records[2], records[3]);
    } else if (question.name === SERVICE_NAME && (question.type === 'SRV' || question.type === 'TXT' || question.type === 'ANY')) {
      if (question.type !== 'TXT') answers.push(records[1]);
      if (question.type !== 'SRV') answers.push(records[2]);
      additionals.push(records[3]);
    }
  }

  if (answers.length === 0) return;

  try {
    instance.respond({ answers, additionals });
  } catch (e) {}
}

function startMdns(port) {
  if (process.env.MDNS_ENABLED === 'false') {
    console.log('[MDNS] Disabled via MDNS_ENABLED=false');
    return;
  }
  if (instance) return;

  currentIp = getLanIp();
  if (!currentIp) {
    console.warn('[MDNS] No non-internal IPv4 interface found; skipping mDNS advertisement.');
    return;
  }

  try {
    instance = mdns({ reuseAddr: true });
  } catch (e) {
    console.warn('[MDNS] Failed to start responder:', e.message);
    instance = null;
    return;
  }

  instance.on('error', (err) => {
    console.warn('[MDNS] Responder error:', err.message);
  });

  instance.on('query', (query) => {
    handleQuery(port, query);
  });

  announceTimer = setTimeout(() => announce(port), 200);

  refreshTimer = setInterval(() => {
    const ip = getLanIp();
    if (ip && ip !== currentIp) {
      console.log(`[MDNS] LAN IP changed ${currentIp} -> ${ip}; re-announcing ${HOSTNAME}`);
      goodbye(port, currentIp);
      currentIp = ip;
    }
    announce(port);
  }, 60000);

  console.log(`[MDNS] Advertising ws://${HOSTNAME}:${port} (${currentIp})`);
}

function stopMdns(port) {
  if (announceTimer) {
    clearTimeout(announceTimer);
    announceTimer = null;
  }
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (instance) {
    goodbye(port, currentIp);
    try {
      instance.destroy();
    } catch (e) {}
    instance = null;
  }
}

module.exports = { startMdns, stopMdns, getLanIp };
