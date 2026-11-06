#!/usr/bin/env bash
# ==============================================================================
# Omarchy Bridge — 1-Step Complete Installer
# ==============================================================================

set -e

REPO_URL="https://github.com/ethanhunthere/omarchy-bridge.git"
DEST="${OMARCHY_BRIDGE_DIR:-$HOME/Projects/omarchy-bridge}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"

# curl | bash has no checkout next to the script. Clone, then re-run the real installer.
if [ ! -f "${SCRIPT_DIR}/server/package.json" ]; then
  echo "=== Fetching Omarchy Bridge ==="
  mkdir -p "$(dirname "$DEST")"
  if [ -d "$DEST/.git" ]; then
    git -C "$DEST" pull --ff-only
  else
    git clone "$REPO_URL" "$DEST"
  fi
  exec "$DEST/install.sh"
fi

REPO_DIR="$SCRIPT_DIR"

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
