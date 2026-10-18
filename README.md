# Omarchy Remote CLI Bridge & System Control Center

A unified remote terminal bridge and mobile System Control Center connecting an Omarchy Linux laptop to an iOS iPhone via WebSockets, native Pseudo-Terminals (`node-pty`), and a persistent detached `tmux` session named `omarchy-remote`.

---

## 1. System Overview

```
┌────────────────────────────────────────────────────────┐
│                   iOS Device (iPhone)                  │
│  ┌───────────────────────┬──────────────────────────┐  │
│  │   [TERMINAL TAB]      │   [CONTROL CENTER TAB]   │  │
│  │  • Interactive tmux   │  • Live Telemetry Gauges │  │
│  │  • ANSI 256 colors    │  • DPMS Screen Off/On    │  │
│  │  • Quick signal keys  │  • Scheduled rtcwake     │  │
│  │  • Shell prompt input │  • Desktop Screenshot    │  │
│  │  • Command history    │  • 2-Step Power Controls │  │
│  └───────────────────────┴──────────────────────────┘  │
└──────────────────────────┬─────────────────────────────┘
                           │
              Encrypted WebSocket (:19001) / REST API
              Auth: Bearer / Query Token Pre-Shared Key
              Transport: Local Wi-Fi (LAN) or Tailscale Mesh
                           │
┌──────────────────────────▼─────────────────────────────┐
│                 Omarchy Linux Laptop                   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │   systemd --user service (omarchy-bridge)        │  │
│  │   • Port 19001 (Bypasses UFW firewall)           │  │
│  │   • Live Telemetry Stream (CPU, RAM, Temp, Disk) │  │
│  │   • REST Endpoints (/api/screenshot, /api/action)│  │
│  │   • Wake-on-LAN Magic Packet Dispatcher          │  │
│  │   • systemd-inhibit Keep-Awake Manager           │  │
│  └───────────────────────┬──────────────────────────┘  │
│                          │                             │
│                 Native Linux PTY (`/dev/ptmx`)         │
│                          │                             │
│  ┌───────────────────────▼──────────────────────────┐  │
│  │    Persistent Detached tmux ("omarchy-remote")   │  │
│  │    • Session never dies when phone disconnects   │  │
│  │    • Preserves running tasks (e.g. agy, builds)  │  │
│  │    • Full user environment ($SHELL -l) & PATH    │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 2. One-Time Permissions Setup (Passwordless Power & rtcwake)

To allow the background bridge daemon to put the machine to sleep with hardware RTC wake timers (`rtcwake`) and trigger power commands without getting blocked by password prompts, run the automated setup script once:

```bash
cd ~/Projects/omarchy-bridge/setup
sudo ./install-permissions.sh
```

This installs:
1. `/etc/sudoers.d/omarchy-bridge`: Tightly-scoped passwordless sudo for `systemctl poweroff`, `reboot`, `suspend`, `rtcwake`, `powerprofilesctl`, and `iw`.
2. `/etc/polkit-1/rules.d/50-omarchy-bridge.rules`: Polkit authorization rules for power and session management.
3. Persistent Wake-on-LAN (WoWLAN) configuration.
4. Enables `tailscaled.service` at the system level so Tailscale reconnects automatically on boot before user login.

---

## 3. System Control Center Features

### A. Display & Session Controls
* **Display Off / On (Hyprland DPMS)**: Toggles physical monitor power via `hyprctl dispatch dpms off`. Your laptop monitor stays completely dark while you work remotely from your phone.
* **Keep-Awake**: Spawns a `systemd-inhibit` lock that blocks idle sleep, screen timeouts, and lid-close sleep while toggled active.
* **Lock Screen**: Triggers `hyprlock` / `loginctl lock-session` immediately.

### B. Scheduled Hardware Wake (`rtcwake`)
* Choose `+30m`, `+1h`, `+2h`, `+4h`, or `+8h`.
* Suspends the computer into RAM (`mem`) and programs the motherboard's Real-Time Clock (RTC) chip to wake the machine automatically for your shift.

### C. Live Desktop Screenshot Preview
* Tap **📸 CAPTURE NOW** in the Control Center.
* Grabs a live screenshot of your active Wayland desktop via `grim` and renders it on your iPhone.

### D. System Power with 2-Step Confirmation
* **Suspend**: Instant sleep into RAM.
* **Reboot**: Restarts the system (Tailscale reconnects automatically).
* **Shutdown**: Powers off the PC.
* Both Reboot and Shutdown require an explicit confirmation modal to prevent accidental taps.

### E. Wake-on-LAN
* Dispatches an authenticated UDP magic packet containing your PC's MAC address (`14:13:33:a8:af:df`) to the subnet broadcast (`255.255.255.255:9` and `192.168.1.255:9`).

---

## 4. REST API Reference

All `/api` endpoints require `?token=omarchy-bridge-secure-key-2026` or header `Authorization: Bearer <TOKEN>`:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Public health check & uptime |
| `/api/telemetry` | `GET` | Live CPU %, Temp, RAM, Disk, Uptime, DPMS status, Governor |
| `/api/screenshot` | `GET` | Live JPEG snapshot of the Wayland desktop (`Content-Type: image/jpeg`) |
| `/api/action` | `POST` | Dispatches system action (`{ action: "dpms_toggle" \| "lock" \| "keep_awake_toggle" \| "rtcwake" \| "suspend" \| "reboot" \| "poweroff" \| "send_wol" }`) |
