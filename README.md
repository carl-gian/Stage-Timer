# Stage Timer

Meeting timer (Electron) with a live display page, a PIN-protected control page, and an OBS dock.
Schedule is downloaded from the same feed OnlyT uses (midweek) and cached for offline use.

    npm install
    npm start          # desktop app (tray + settings window)
    npm run serve      # headless, no Electron
    npm test
    npm run dist       # installer for the current OS (build Windows installers on Windows)

| Page | Use |
|---|---|
| /display | Show the timer. Options: ?bg=transparent ?name=0 ?bar=0 ?mode=elapsed |
| /control | Phone/tablet control: start, stop, adjust time, choose part (PIN required off-machine) |
| /dock | Same as control, sized for an OBS Custom Browser Dock |

Adaptive timing (Settings: Off / Shorten / Both) is a port of OnlyT's: when the meeting runs early or late, later "Living as Christians" and weekend parts are shortened (or lengthened) in proportion. Off by default.

Midweek vs weekend is detected from the day (Sat/Sun = weekend); override in settings.

## Credits

The schedule feed, the part timings and the adaptive timing logic are ported from
[OnlyT](https://github.com/AntonyCorbett/OnlyT) by Antony Corbett (MIT). See `LICENSE`.

## Links and ports

Stage Timer announces itself on the local network as `stage.local` (change the name in Settings), so
other devices can open `http://stage.local/display` and `http://stage.local/control` instead of an IP
address. It tries port 80 first (no `:port` in the link) and falls back to 4580. The IP link is the fallback if
`.local` names don't work on a network.

## Timer behaviour

- **Stop** finishes the part and lines up the next one (time taken is recorded). **Pause** keeps the part and its time.
- Warnings (no sound, no system notifications): amber glow with one minute left (not for Opening Comments or parts
  of 2 minutes or less), flashing amber from 30 s, flashing red from 10 s, then a flashing "Time's up" pop-up.
