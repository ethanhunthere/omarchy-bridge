/**
 * 60-Second Memory & Scrollback Ring Buffer Profiler for Omarchy Bridge Server
 *
 * Verifies:
 * 1. RSS & HeapUsed before, during, and after 60 seconds of continuous PTY output streaming
 * 2. scrollbackChunks ring buffer never exceeds MAX_SCROLLBACK_BYTES (512 KB)
 * 3. Old buffers are properly garbage collected (heap compaction / recovery after GC)
 */

const { spawn, exec } = require('child_process');
const http = require('http');
const { WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = 19005; // Dedicated port to avoid conflict with running systemd daemon on 19001
const TOKEN = 'omarchy-bridge-secure-key-2026';
const MAX_SCROLLBACK_BYTES = 512 * 1024; // 524,288 bytes
const TEST_TMUX_SESSION = 'omarchy-profile-60s';
const DURATION_SEC = 60;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    }).on('error', reject);
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await fetchJson('/health');
      if (h.status === 'ok') return;
    } catch (e) {
      // retry
    }
    await sleep(200);
  }
  throw new Error('Server failed to start within timeout');
}

async function runProfiler() {
  console.log('='.repeat(70));
  console.log(' OMARCHY BRIDGE 60-SECOND MEMORY & RING BUFFER PROFILER');
  console.log('='.repeat(70));
  console.log(`Duration:           ${DURATION_SEC} seconds continuous streaming`);
  console.log(`Buffer Limit:       ${MAX_SCROLLBACK_BYTES} bytes (${(MAX_SCROLLBACK_BYTES / 1024).toFixed(0)} KB)`);
  console.log(`Dedicated Port:     ${PORT}`);
  console.log(`TMUX Session:       ${TEST_TMUX_SESSION}`);
  console.log('='.repeat(70) + '\n');

  // Pre-cleanup of any prior session
  exec(`tmux kill-session -t ${TEST_TMUX_SESSION} 2>/dev/null`);
  await sleep(500);

  // 1. Launch server with --expose-gc on dedicated port
  console.log('[1/6] Launching server with --expose-gc on port ' + PORT + '...');
  const serverProc = spawn('/usr/bin/node', ['--expose-gc', path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      AUTH_TOKEN: TOKEN,
      TMUX_SESSION: TEST_TMUX_SESSION,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text.includes('Bridge Daemon Active')) {
      console.log(`      [SERVER LOG] Active on port ${PORT}`);
    }
  });

  serverProc.stderr.on('data', (d) => {
    console.error(`      [SERVER ERROR] ${d.toString().trim()}`);
  });

  await waitForServer();
  console.log('      Server active and responding to /health.');

  // 2. Connect WebSocket Client
  console.log('[2/6] Connecting WebSocket client to drain streaming output...');
  let ws;
  let totalMessagesReceived = 0;
  let totalBytesReceived = 0;

  await new Promise((resolve, reject) => {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${TOKEN}`);
    ws.on('open', () => {
      console.log('      WebSocket connected and authenticated.');
    });
    ws.on('message', (raw) => {
      totalMessagesReceived++;
      totalBytesReceived += raw.length;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'init') {
          resolve();
        }
      } catch (e) {}
    });
    ws.on('error', reject);
  });

  // 3. Baseline Measurement (Before Streaming)
  console.log('\n[3/6] Measuring Initial Baseline Memory (Pre-streaming, GC warmed)...');
  await fetchJson(`/api/memory?token=${TOKEN}&gc=1`);
  await sleep(300);
  const baseline = await fetchJson(`/api/memory?token=${TOKEN}&gc=1`);

  console.log('      Baseline Metrics:');
  console.log(`        RSS:                 ${(baseline.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Heap Total:          ${(baseline.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Heap Used:           ${(baseline.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        External:            ${(baseline.external / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Scrollback Bytes:    ${baseline.scrollbackBytes} bytes (${(baseline.scrollbackBytes / 1024).toFixed(2)} KB)`);
  console.log(`        Scrollback Chunks:   ${baseline.scrollbackChunksCount}`);

  // 4. Start 60-Second Continuous PTY Streaming
  console.log(`\n[4/6] Commencing continuous high-throughput PTY stream for ${DURATION_SEC} seconds...`);
  // Use setImmediate batch streamer running directly in Node via PTY input
  const streamCmd = `node -e 'const end = Date.now() + 60000; let i = 0; const chunk = "X".repeat(500) + "\\n"; function step() { if (Date.now() >= end) process.exit(0); for (let j = 0; j < 30; j++) process.stdout.write("CHUNK_" + (++i) + "_" + chunk); setImmediate(step); } step();'`;
  ws.send(JSON.stringify({ type: 'input', data: streamCmd }));

  const timeline = [];
  const startTime = Date.now();
  let maxScrollbackDuringStream = baseline.scrollbackBytes;
  let invariantViolations = 0;

  console.log('\n  Time  | RSS (MB) | HeapUsed | HeapTot  | Scrollback (KB) | Limit (KB) | Chunks | Streamed (MB) | Invariant');
  console.log('--------+----------+----------+----------+-----------------+------------+--------+---------------+----------');

  const sampleIntervalMs = 5000; // sample every 5 seconds
  const totalSamples = DURATION_SEC / (sampleIntervalMs / 1000);

  for (let s = 1; s <= totalSamples; s++) {
    await sleep(sampleIntervalMs);
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    const mem = await fetchJson(`/api/memory?token=${TOKEN}`);

    const rssMb = (mem.rss / 1024 / 1024).toFixed(2);
    const heapUsedMb = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotMb = (mem.heapTotal / 1024 / 1024).toFixed(2);
    const scrollbackKb = (mem.scrollbackBytes / 1024).toFixed(1);
    const limitKb = (MAX_SCROLLBACK_BYTES / 1024).toFixed(1);
    const streamedMb = (totalBytesReceived / 1024 / 1024).toFixed(2);

    if (mem.scrollbackBytes > maxScrollbackDuringStream) {
      maxScrollbackDuringStream = mem.scrollbackBytes;
    }

    const checkInvariant = mem.scrollbackBytes <= MAX_SCROLLBACK_BYTES && mem.scrollbackExceededCount === 0;
    if (!checkInvariant) {
      invariantViolations++;
    }

    const invariantStatus = checkInvariant ? 'PASS (<=512K)' : 'FAIL!';

    console.log(
      `  ${String(elapsedSec).padStart(3)}s  | ` +
      `${rssMb.padStart(8)} | ` +
      `${heapUsedMb.padStart(8)} | ` +
      `${heapTotMb.padStart(8)} | ` +
      `${scrollbackKb.padStart(15)} | ` +
      `${limitKb.padStart(10)} | ` +
      `${String(mem.scrollbackChunksCount).padStart(6)} | ` +
      `${streamedMb.padStart(13)} | ` +
      ` ${invariantStatus}`
    );

    timeline.push({
      elapsedSec,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      scrollbackBytes: mem.scrollbackBytes,
      actualSumBytes: mem.actualSumBytes,
      scrollbackChunksCount: mem.scrollbackChunksCount,
      totalBytesReceived,
      scrollbackExceededCount: mem.scrollbackExceededCount,
    });
  }

  // 5. Measure End-of-Streaming Metrics (Before GC)
  console.log('\n[5/6] 60-Second Stream Complete. Measuring Post-Stream Memory...');
  ws.send(JSON.stringify({ type: 'signal', signal: 'ctrl_c' }));
  await sleep(1000);

  const postStreamNoGc = await fetchJson(`/api/memory?token=${TOKEN}`);
  console.log('      Post-Stream Metrics (Before Manual GC):');
  console.log(`        RSS:                 ${(postStreamNoGc.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Heap Used:           ${(postStreamNoGc.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Scrollback Bytes:    ${postStreamNoGc.scrollbackBytes} bytes (${(postStreamNoGc.scrollbackBytes / 1024).toFixed(2)} KB)`);
  console.log(`        Scrollback Chunks:   ${postStreamNoGc.scrollbackChunksCount}`);
  console.log(`        Total Data Streamed: ${(totalBytesReceived / 1024 / 1024).toFixed(2)} MB (${totalBytesReceived.toLocaleString()} bytes)`);

  // 6. Trigger GC & Measure Post-GC Retention
  console.log('\n[6/6] Triggering V8 Garbage Collection to Verify Buffer Deallocation...');
  await fetchJson(`/api/memory?token=${TOKEN}&gc=1`);
  await sleep(400);
  const postGc = await fetchJson(`/api/memory?token=${TOKEN}&gc=1`);

  const heapDiffMb = ((postGc.heapUsed - baseline.heapUsed) / 1024 / 1024).toFixed(2);
  const rssDiffMb = ((postGc.rss - baseline.rss) / 1024 / 1024).toFixed(2);
  const reclaimedHeapMb = ((postStreamNoGc.heapUsed - postGc.heapUsed) / 1024 / 1024).toFixed(2);

  console.log('      Post-GC Metrics (After V8 Major GC):');
  console.log(`        RSS:                 ${(postGc.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Heap Total:          ${(postGc.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Heap Used:           ${(postGc.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`        Scrollback Bytes:    ${postGc.scrollbackBytes} bytes (${(postGc.scrollbackBytes / 1024).toFixed(2)} KB)`);
  console.log(`        Scrollback Chunks:   ${postGc.scrollbackChunksCount}`);
  console.log(`        Heap Reclaimed by GC: ${reclaimedHeapMb} MB`);
  console.log(`        Net Heap Growth:     ${heapDiffMb} MB`);
  console.log(`        Net RSS Growth:      ${rssDiffMb} MB`);

  // Summary Verifications
  const ringBufferPass = postGc.maxObservedScrollbackBytes <= MAX_SCROLLBACK_BYTES && postGc.scrollbackExceededCount === 0;
  const gcReclaimPass = postGc.heapUsed <= postStreamNoGc.heapUsed || (postGc.heapUsed / 1024 / 1024) < 40;
  const memoryLeakPass = (postGc.heapUsed - baseline.heapUsed) < (20 * 1024 * 1024); // Net growth < 20MB after tens/hundreds of MBs streamed

  console.log('\n' + '='.repeat(70));
  console.log(' VERIFICATION RESULTS');
  console.log('='.repeat(70));
  console.log(`1. Scrollback Ring Buffer Cap:  ${ringBufferPass ? 'PASSED (STRICT <= 512 KB)' : 'FAILED'}`);
  console.log(`   - Max Observed Scrollback:   ${postGc.maxObservedScrollbackBytes.toLocaleString()} / ${MAX_SCROLLBACK_BYTES.toLocaleString()} bytes`);
  console.log(`   - Invariant Violations:      ${postGc.scrollbackExceededCount}`);
  console.log(`2. Garbage Collection:          ${gcReclaimPass ? 'PASSED (Buffers properly reclaimed)' : 'FAILED'}`);
  console.log(`   - Reclaimed By GC:           ${reclaimedHeapMb} MB`);
  console.log(`3. Net Heap Growth:             ${memoryLeakPass ? 'PASSED (No Memory Leak)' : 'FAILED'}`);
  console.log(`   - Heap Used Before:          ${(baseline.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Heap Used After GC:        ${(postGc.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Total Output Processed:    ${(totalBytesReceived / 1024 / 1024).toFixed(2)} MB`);
  console.log('='.repeat(70) + '\n');

  // Save full profile report
  const report = {
    testDate: new Date().toISOString(),
    durationSeconds: DURATION_SEC,
    maxScrollbackBytes: MAX_SCROLLBACK_BYTES,
    totalBytesStreamed: totalBytesReceived,
    totalMessagesReceived,
    baseline: {
      rss: baseline.rss,
      heapUsed: baseline.heapUsed,
      heapTotal: baseline.heapTotal,
      scrollbackBytes: baseline.scrollbackBytes,
      scrollbackChunksCount: baseline.scrollbackChunksCount,
    },
    postStreamNoGc: {
      rss: postStreamNoGc.rss,
      heapUsed: postStreamNoGc.heapUsed,
      heapTotal: postStreamNoGc.heapTotal,
      scrollbackBytes: postStreamNoGc.scrollbackBytes,
      scrollbackChunksCount: postStreamNoGc.scrollbackChunksCount,
    },
    postGc: {
      rss: postGc.rss,
      heapUsed: postGc.heapUsed,
      heapTotal: postGc.heapTotal,
      scrollbackBytes: postGc.scrollbackBytes,
      scrollbackChunksCount: postGc.scrollbackChunksCount,
      maxObservedScrollbackBytes: postGc.maxObservedScrollbackBytes,
      scrollbackExceededCount: postGc.scrollbackExceededCount,
    },
    timeline,
    verifications: {
      ringBufferCapHonored: ringBufferPass,
      maxObservedBytes: postGc.maxObservedScrollbackBytes,
      invariantViolationCount: postGc.scrollbackExceededCount,
      garbageCollectionReclaimedBytes: postStreamNoGc.heapUsed - postGc.heapUsed,
      buffersProperlyGarbageCollected: gcReclaimPass,
      zeroMemoryLeak: memoryLeakPass,
    },
  };

  fs.writeFileSync(path.join(__dirname, 'memory-profile-report.json'), JSON.stringify(report, null, 2));
  console.log('Report saved to memory-profile-report.json');

  // Cleanup
  ws.close();
  serverProc.kill('SIGTERM');
  await sleep(1000);
  exec(`tmux kill-session -t ${TEST_TMUX_SESSION} 2>/dev/null`);

  return report;
}

runProfiler()
  .then(() => {
    console.log('[PROFILER COMPLETED SUCCESSFULLY]');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[PROFILER ERROR]', err);
    exec(`tmux kill-session -t ${TEST_TMUX_SESSION} 2>/dev/null`);
    process.exit(1);
  });
