#!/usr/bin/env bash
# ==============================================================================
# Omarchy Bridge — 1-Step Complete Installer
# ==============================================================================

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Installing Omarchy Bridge ==="

# 1. Install server dependencies
echo "[1/4] Installing backend dependencies..."
cd "$REPO_DIR/server"
npm install

# 2. Configure system permissions, systemd unit, and 'pair' command
echo "[2/4] Setting up system permissions and 'pair' command..."
sudo "$REPO_DIR/setup/install-permissions.sh"

# 3. Enable & start background service
echo "[3/4] Enabling & starting omarchy-bridge background service..."
systemctl --user enable --now omarchy-bridge

# 4. Display live pairing card
echo "[4/4] Installation complete! Your live pairing card:"
"$REPO_DIR/bin/pair"
