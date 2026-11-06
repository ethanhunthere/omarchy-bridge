# Omarchy Bridge

Control your Omarchy PC from your phone. Live terminal, power buttons, and a one-time pairing code. The iPhone and Android apps are the same screens: same top bar, same bottom composer, same themes.

Two different people. Do not make both do both jobs.

| Who | What they do | What they never do |
| :--- | :--- | :--- |
| PC owner | One install command, then `pair` | Expo Go |
| Phone | Install the app you sent, type the code | Git, Expo account, this repo |

## 1. PC owner, once

Need Omarchy, Node.js 20+, and `tmux`. Paste this. It clones and installs.

```bash
curl -fsSL https://raw.githubusercontent.com/ethanhunthere/omarchy-bridge/main/install.sh | bash
```

Then, any time someone needs in:

```bash
pair
```

That card is the Wi-Fi IP and the 6-digit code. Send those two lines. Fresh code: `pair --new`.

## 2. Phone, no repo

You build the app once and send a link. They do not clone anything.

Android is an APK. No Play Store, so the 12-tester rule does not apply.

```bash
cd ~/Projects/omarchy-bridge/mobile
npx eas build -p android --profile preview
```

iPhone is TestFlight. Uses your Apple Developer account. Their phones do not need Expo or Apple Developer.

```bash
npx eas build -p ios --profile production
npx eas submit -p ios --latest
```

Send the APK link or the TestFlight link. Their steps: install, open, tap **PAIR**, type the IP and the code from `pair`.

Expo Go is only for you while coding. It always wants an Expo login. Do not send other people there.

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
