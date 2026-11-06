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

Other people do not use Expo Go and do not need an Expo account.

### Android: APK only

No Play Store. Google’s 12-tester rule does not apply.

1. On the PC, once:

```bash
cd ~/Projects/omarchy-bridge/mobile
npx eas build -p android --profile preview
```

2. Send people the APK link from that build.
3. On the phone: download the APK, allow install from that browser, open it, pair.

### iPhone: TestFlight

Needs your Apple Developer account. Their phones do not.

1. On the PC, once:

```bash
cd ~/Projects/omarchy-bridge/mobile
npx eas build -p ios --profile production
npx eas submit -p ios --latest
```

2. In App Store Connect, turn on TestFlight and share the public link.
3. On the iPhone: install TestFlight, open your link, install Omarchy Bridge, pair.

Expo Go is only for you while developing. It always demands an Expo login. Do not send other people there.

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
