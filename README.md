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
