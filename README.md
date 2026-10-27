# Stage Timer

A meeting timer for the stage that you control from **OBS**, a phone, or any browser. It downloads the week's
schedule automatically, shows a clear countdown on any screen, and warns the speaker with flashing colours instead
of sounds or system notifications.

**[Download the latest Windows installer](https://github.com/carl-gian/Stage-Timer/releases/latest)** · [Release notes](RELEASE_NOTES.md)

> The installer isn't code-signed, so Windows SmartScreen will warn you. Choose **More info → Run anyway**.

## What it does

- **Automatic schedule.** Fetches the week's parts and times (cached for offline use). Midweek or weekend is picked from the day, with a manual override and a circuit visit option.
- **Control from anywhere.** Start, Stop, Pause, Reset, ±30 s / ±1 min, and choose any part, from a phone, tablet or browser. Protected by a PIN.
- **OBS dock.** A compact control panel you can dock inside OBS, with a hidden Connect panel (QR code + PIN) and a button that opens the app's settings.
- **Display page.** A big, readable timer for any screen, or an OBS Browser Source with a transparent background.
- **Easy links.** `http://stage.local/display`: no IP address or port to type.
- **Warnings you can see from the back of the room.** Amber glow with one minute left, flashing amber from 30 s, flashing red from 10 s, then a flashing "Time's up" pop-up.
- **Adaptive timing** (optional). If the meeting runs early or late, later parts are shortened or lengthened in proportion.

## Quick start

1. Install and open Stage Timer. The window shows your links, a QR code and the PIN.
2. **OBS control dock:** *View → Docks → Custom Browser Docks…*, name it "Stage Timer", paste `http://localhost/dock`, Apply.
3. **On-screen timer:** add a *Browser Source* with `http://localhost/display?bg=transparent`.
4. **Phone or tablet:** scan the QR code (or click **Connect** in the dock) and enter the PIN. On the computer running OBS no PIN is needed.

Closing the window keeps Stage Timer running in the system tray.

## Pages

| Page | Use |
|---|---|
| `/display` | The timer. Options: `?bg=transparent` `?name=0` (hide part name) `?bar=0` (hide progress bar) `?mode=elapsed` (count up) |
| `/control` | Full control page for phones and tablets (PIN required away from the host computer) |
| `/dock` | The same control page, sized for an OBS Custom Browser Dock |

## How the timer behaves

- **Stop** finishes the part, records the time it took and lines up the next part. **Pause** keeps the part and its time.
- Warnings use in-page pop-ups and flashing only: no sound and no system notifications.
  - 1 minute left: amber glow (not for Opening Comments, or parts of 2 minutes or less)
  - 30 seconds: flashing amber
  - 10 seconds: flashing red
  - Time's up: flashing pop-up for 15 seconds, then steady red while over time
- **Adaptive timing** is off by default (Settings: Off / Shorten / Both). When on, the difference between the clock and the planned end of the meeting is shared across the remaining adaptive parts (the "Living as Christians" parts, the Congregation Bible Study and the weekend talks after the first) in proportion to their length.

## Links, ports and networking

Stage Timer announces itself on your local network as `stage.local` (you can change the name in Settings), so other devices can open
`http://stage.local/display` and `http://stage.local/control`. It uses port 80 when available and falls back to 4580. Everything stays on your
local network; the app is not exposed to the internet.

If `stage.local` doesn't work (some guest or "client isolation" Wi-Fi blocks device discovery), use the IP address link shown in the app.

The only outgoing request is the schedule download, a single JSON file from the same feed [OnlyT](https://github.com/AntonyCorbett/OnlyT) uses.

## Remote API

The control page uses a small HTTP API you can call yourself (send the PIN in an `x-pin` header, except from the host computer):

| Method | Path | Body |
|---|---|---|
| GET | `/api/state` | Current timer state (JSON) |
| GET | `/api/events` | Live state stream (Server-Sent Events) |
| POST | `/api/timer/start` · `stop` · `pause` · `reset` | none |
| POST | `/api/timer/select` | `{ "talkId": 3 }` |
| POST | `/api/timer/adjust` | `{ "deltaSeconds": -30 }` |
| POST | `/api/timer/refresh` | re-download the schedule |

## Build from source

Requires [Node.js](https://nodejs.org) 22 or later.

```bash
npm install
npm start          # desktop app (tray + settings window)
npm run serve      # headless server, no Electron
npm test
npm run dist       # build an installer for the current OS
```

Releases are built by GitHub Actions: pushing a tag like `v1.0.1` builds the Windows installer and attaches it to a release.

```
src/core/      timer, schedule, feed download, adaptive timing, HTTP server, mDNS
src/main.js    Electron main process (tray, settings window)
src/renderer/  settings window
web/           display and control pages
test/          unit and API tests
```

## Credits and licence

Stage Timer's schedule feed, part timings and adaptive timing logic are ported from
[OnlyT](https://github.com/AntonyCorbett/OnlyT) by Antony Corbett. This is an independent project and is not affiliated with or endorsed by OnlyT or its author.

Released under the [MIT licence](LICENSE).
