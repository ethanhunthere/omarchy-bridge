const WebSocket = require('ws');
const { performance } = require('perf_hooks');

const PORT = 19001;
const TOKEN = require('../test-token');
const WS_URL = `ws://127.0.0.1:${PORT}?token=${TOKEN}`;
const PACKET_COUNT = 1000;

async function runWsBurstBenchmark() {
  console.log(`[BURST BENCHMARK] Connecting to ${WS_URL}...`);
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  let receivedPongs = 0;
  const latencies = [];

  const completionPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout: Received only ${receivedPongs}/${PACKET_COUNT} responses`));
    }, 10000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong' && typeof msg.clientTime === 'number') {
          latencies.push(performance.now() - msg.clientTime);
          receivedPongs++;
          if (receivedPongs === PACKET_COUNT) {
            clearTimeout(timeout);
            resolve();
          }
        }
      } catch (e) {}
    });
  });

  const burstStartTime = performance.now();
  for (let i = 0; i < PACKET_COUNT; i++) {
    ws.send(JSON.stringify({ type: 'ping', time: performance.now(), seq: i }));
  }

  await completionPromise;
  const burstEndTime = performance.now();
  const totalElapsedMs = burstEndTime - burstStartTime;
  const throughputPps = (PACKET_COUNT / totalElapsedMs) * 1000;

  latencies.sort((a, b) => a - b);
  const min = latencies[0];
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const max = latencies[latencies.length - 1];

  console.log(`\n============================================================`);
  console.log(` WEBSOCKET HIGH-SPEED THROUGHPUT & BURST BENCHMARK`);
  console.log(`============================================================`);
  console.log(` Packets Processed: ${PACKET_COUNT}`);
  console.log(` Total Time:        ${totalElapsedMs.toFixed(2)} ms`);
  console.log(` Throughput:        ${throughputPps.toFixed(1)} packets/sec`);
  console.log(` Round-Trip Latency:`);
  console.log(`   Min:             ${min.toFixed(2)} ms`);
  console.log(`   P50 (Median):    ${p50.toFixed(2)} ms`);
  console.log(`   Mean:            ${mean.toFixed(2)} ms`);
  console.log(`   P95:             ${p95.toFixed(2)} ms`);
  console.log(`   Max:             ${max.toFixed(2)} ms`);
  console.log(` Packet Loss:       0% (${receivedPongs}/${PACKET_COUNT})`);
  console.log(`============================================================\n`);

  ws.close();
  if (receivedPongs !== PACKET_COUNT || throughputPps < 1000) {
    process.exit(1);
  }
}

runWsBurstBenchmark().catch((err) => {
  console.error('[BENCHMARK ERROR]', err);
  process.exit(1);
});
