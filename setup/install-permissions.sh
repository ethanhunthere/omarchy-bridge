#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Installing Omarchy Bridge Permissions & System Settings ==="

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
    echo "[!] Run 'sudo tailscale up' to register your machine."
fi

echo "=== Permissions & System Services Configured Successfully ==="
