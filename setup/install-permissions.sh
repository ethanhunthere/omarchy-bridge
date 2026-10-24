#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Installing Omarchy Bridge Permissions & System Settings ==="

# 0. Master key hygiene: server/.env keeps a unique random AUTH_TOKEN per install.
ENV_FILE="$SCRIPT_DIR/../server/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "[+] Creating server/.env with a random master key..."
    cat > "$ENV_FILE" <<EOF
PORT=19001
HOST=0.0.0.0
AUTH_TOKEN=$(openssl rand -hex 32)
TMUX_SESSION=omarchy-remote
SHELL_CMD=/usr/bin/fish
WORK_DIR=$HOME
BUFFER_MAX_BYTES=524288
EOF
elif grep -q "omarchy-bridge-secure-key-2026" "$ENV_FILE"; then
    echo "[+] Replacing default AUTH_TOKEN with a random master key..."
    NEW_TOKEN=$(openssl rand -hex 32)
    sed -i "s/^AUTH_TOKEN=.*/AUTH_TOKEN=$NEW_TOKEN/" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true

# 1. Sudoers rule
echo "[+] Installing /etc/sudoers.d/omarchy-bridge..."
sudo install -m 0440 "$SCRIPT_DIR/omarchy-bridge.sudoers" /etc/sudoers.d/omarchy-bridge

# 2. Polkit rule
if [ -d /etc/polkit-1/rules.d ]; then
    echo "[+] Installing Polkit rules into /etc/polkit-1/rules.d/..."
    sudo install -m 0644 "$SCRIPT_DIR/50-omarchy-bridge.rules" /etc/polkit-1/rules.d/50-omarchy-bridge.rules
fi

# 3. Persistent Wake-on-LAN configuration
echo "[+] Configuring persistent Wake-on-LAN for wireless / ethernet..."
WLAN_IF="wlan0"
if [ -d "/sys/class/net/$WLAN_IF" ]; then
    echo "[+] Enabling WoWLAN on $WLAN_IF..."
    sudo iw "$WLAN_IF" wowlan enable any 2>/dev/null || true
fi

# 4. System-level Tailscale service
if which tailscale >/dev/null 2>&1; then
    echo "[+] Enabling system-level tailscaled.service across reboots..."
    sudo systemctl enable --now tailscaled
else
    echo "[!] Tailscale package not installed. Installing via pacman..."
    sudo pacman -S --noconfirm tailscale
    sudo systemctl enable --now tailscaled
fi

# Let the user-level bridge daemon read 'tailscale status' (MagicDNS name / remote IP)
sudo tailscale set --operator="${SUDO_USER:-$USER}" 2>/dev/null || true
echo "[!] Run 'sudo tailscale up' once, then log in with same account on phone."
echo "[!] Remote endpoint appears in: journalctl --user -u omarchy-bridge -f"

# 5. Cloudflare Tunnel (primary remote transport)
if ! which cloudflared >/dev/null 2>&1; then
    echo "[!] cloudflared not installed. Arch: sudo pacman -S cloudflared"
    echo "[!] Then either: cloudflared tunnel login && create a named tunnel +"
    echo "[!] TUNNEL_URL=https://your.hostname in server/.env (stable, recommended),"
    echo "[!] or set TUNNEL_MODE=quick in server/.env for a random test URL."
else
    echo "[+] cloudflared found. Set TUNNEL_URL or TUNNEL_MODE=quick in server/.env"
fi

echo "=== Permissions & System Services Configured Successfully ==="
