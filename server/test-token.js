/**
 * Resolves the master AUTH_TOKEN for live-server test suites.
 * Reads process.env first, then server/.env. Keeps test files free of
 * hardcoded secrets so each install can rotate its own master key.
 */
const fs = require('fs');
const path = require('path');

let token = process.env.AUTH_TOKEN || '';

if (!token) {
  try {
    const envPath = path.join(__dirname, '.env');
    const env = fs.readFileSync(envPath, 'utf8');
    const match = env.match(/^AUTH_TOKEN=(.+)$/m);
    if (match) token = match[1].trim();
  } catch (e) {}
}

module.exports = token;
