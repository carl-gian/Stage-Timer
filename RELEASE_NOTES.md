# Stage Timer 1.1.1

A meeting timer for the stage, controlled from OBS or any phone, with the schedule downloaded automatically.

## What's new in 1.1

- **OBS scene switching** (optional, off by default). Give each part an OBS scene in Stage Timer's settings. When a part starts, its scene is sent to OBS Preview and then Transitioned, exactly like pressing the Transition button in Studio Mode, so tools that react to Preview and Transition (such as the EMEET-OBS Bridge) keep working. Needs OBS Studio Mode and the WebSocket server turned on.
  - Resuming after a pause does not switch scenes, and a scene that is already on air is left alone.
  - If you start another part while a transition is still running, it waits for the transition to finish.
  - If OBS can't be reached (or Studio Mode is off, or a scene no longer exists), a message appears in the settings window and in the control page and dock. The timer is never held up.
  - Upgrading from 1.0.0 changes nothing until you turn this on.

## Download

**Stage-Timer-Setup-1.1.1.exe** (Windows 10 or later), attached below.

The installer isn't code-signed yet, so Windows SmartScreen will warn you. Choose **More info → Run anyway**.

## Everything it does

- **Automatic schedule.** Downloads the week's meeting parts and times (cached for offline use). Midweek or weekend is picked from the day of the week, with a manual override and a circuit visit option.
- **Control from anywhere.** Start, Stop, Pause, Reset, ±30 s / ±1 min, and pick any part, from a phone, tablet or browser. A PIN protects remote control.
- **OBS custom dock.** Add `http://localhost/dock` as a Custom Browser Dock. A Connect button reveals the QR code and PIN, and a Settings button opens the app. Both are hidden until you need them.
- **Display page.** `http://stage.local/display` for any screen, or as an OBS Browser Source (`?bg=transparent` for a see-through background).
- **Easy links.** The app announces itself as `stage.local` and uses port 80 when it can, so there is no IP address or port to type. It falls back to the IP link if `.local` names don't work on your network.
- **Warnings without sound or system notifications.** Amber glow at one minute left (skipped for Opening Comments and parts of 2 minutes or less), flashing amber from 30 seconds, flashing red from 10 seconds, and a flashing "Time's up" pop-up.
- **Stop moves on.** Stopping a part records how long it took and lines up the next one. Pause keeps your place.
- **OBS scene switching** (off by default). See above.
- **Adaptive timing** (off by default). When the meeting runs early or late, later parts are shortened (or lengthened) in proportion. Choose Off / Shorten / Both in Settings.
- Lives in the system tray; closing the window keeps the timer running.

## Getting started

1. Install and open Stage Timer. Its window shows your links, the QR code and the PIN.
2. In OBS: **View → Docks → Custom Browser Docks**, paste the dock link, Apply.
3. For the on-screen timer, add a **Browser Source** with the display link.

## Known limitations

- Windows is the tested platform. A macOS build can be made with `npm run dist` on a Mac but isn't published yet.
- The installer is unsigned (see above).
- `stage.local` needs a network that allows device discovery; guest or "client isolation" Wi-Fi may block it.
- Only the midweek and weekend meetings are supported; the adaptive timer's countdown-window start time from OnlyT isn't included.

## Credits

Scheduling and adaptive timing are ported from [OnlyT](https://github.com/AntonyCorbett/OnlyT) by Antony Corbett (MIT).
