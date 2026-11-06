# Omarchy Bridge

Control your Omarchy PC from your phone. Live terminal, power buttons, and a one-time pairing code. The iPhone and Android apps are the same screens: same top bar, same bottom composer, same themes.

## 1. Install on the PC

You need Omarchy (or Arch with Hyprland), Node.js 20+, and `tmux`.

```bash
git clone https://github.com/ethanhunthere/omarchy-bridge.git ~/Projects/omarchy-bridge
cd ~/Projects/omarchy-bridge
./install.sh
```

That installs the server, permissions, and a background service, then prints a pairing card.

Later, from any terminal:

```bash
pair
```

The card shows:

- a 6-digit code (about 10 minutes, then it rotates)
- your Wi-Fi IP
- a tunnel URL, if one is running

Fresh code: `pair --new`.

## 2. Put the app on your phone

### Easiest: Expo Go

1. Install **Expo Go** from the App Store (iPhone) or Play Store (Android).
2. On the PC:

```bash
cd ~/Projects/omarchy-bridge/mobile
npm install --legacy-peer-deps
npx expo start
```

3. Phone and PC on the same Wi-Fi. Scan the QR code.
   - iPhone: Camera, then Open in Expo Go.
   - Android: scan inside Expo Go.

### A real install (no Expo Go)

Needs a free Expo account: `npx eas login` once.

Android APK you can sideload:

```bash
cd ~/Projects/omarchy-bridge/mobile
npx eas build -p android --profile preview
```

Open the finished link on the phone and install the APK.

iPhone build needs an Apple Developer account and that phone registered with it:

```bash
npx eas build -p ios --profile preview
```

Open the link in Safari on that iPhone. There is no public App Store listing yet.

## 3. Pair

1. Open the app. Tap **PAIR** at the top right.
2. Bridge host: the IP from `pair` (same Wi-Fi). Away from home, paste the tunnel URL instead.
3. Pairing code: the 6 digits from `pair`.
4. Tap **Pair Device**.

`omarchy-bridge.local` usually works on iPhone. On Android it depends on the phone, so use the IP if `.local` fails.

## If it will not connect

- Same Wi-Fi, or use the tunnel URL.
- `systemctl --user status omarchy-bridge`
- `journalctl --user -u omarchy-bridge -n 50`
- LAN firewall must allow TCP `19001`. UDP `5353` is only for `.local`.
- Code expired: `pair --new`.

Each phone gets its own key after pairing. The 6-digit code is single-use. Do not commit `server/.env`.

## What the app shows

- **TERMINAL**: live screen, input line, keycaps (`Ctrl+C`, `Ctrl+D`, `ESC`, `TAB`, history).
- **SYSTEM**: CPU and memory, suspend, lock, screen-off stealth, theme picker.
- Six themes. Colors change. Layout does not, on either platform.

Top bar is the tab switch plus the connection pill (green linked, amber linking, red offline). Bottom bar is the keycap row and the input line, sitting above the keyboard and the system home indicator / Android nav bar.

## Folder map

```
install.sh     PC installer
bin/pair       pairing card
server/        daemon
mobile/        iOS + Android app
setup/         systemd unit, sudoers, polkit
server/qa/     optional test scripts
mobile/qa/     optional mobile audits
```

MIT license.
