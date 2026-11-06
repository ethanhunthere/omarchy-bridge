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

## 2. Phone

The app is not on the App Store or Play Store. Same screens on iPhone and Android.

Until a download link is posted, run it from the checkout you just installed:

```bash
cd ~/Projects/omarchy-bridge/mobile
npm install --legacy-peer-deps
npx expo start
```

Install **Expo Go** (SDK 58) on the phone. Sign in with your own Expo account. The PC must be logged into that same account (`npx expo login`). Enter the URL Expo prints. Do not use the iPhone Camera app on the QR code.

Then tap **PAIR**. Host is the IP from `pair`. Code is the 6 digits from `pair`.

Do not post the pairing card, `server/.env`, or your LAN IP in the thread. The code expires in about 10 minutes. `pair --new` prints another.

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
