# Stage Timer 1.4.0

A meeting timer for the stage, controlled from OBS or any phone, with the schedule downloaded automatically.

## What's new in 1.4.0

- **Picking another part no longer stops the timer.** Before, tapping a different part while one was being timed silently stopped and reset the clock. Now the running or paused timer carries on, and the part you tapped is only *selected* (shown with a dashed outline and a "Selected, not started" panel). This lets you set its OBS scene ahead of time: the *Scene for…* picker follows the selected part, and the scene is saved for when that part starts, without switching OBS now. Tap the running part, or press **Back**, to drop the selection.
- **Starting another part asks first.** Press **Start…** on the selected part and a warning appears: "A timer is still going". Choose:
  - **End part, then start…**: ends the running part (its time is recorded, exactly like Stop, including the OBS stop scene and the timer report) and starts the selected one.
  - **Finish timer**: ends the running part the same way and lines up the selected one without starting it.
  - **Keep timing**: closes the warning and changes nothing.
- The normal **Stop** button still lines up the next part in order.

## What's new in 1.3.3

- **ZOOM Raise Hand is bigger.** Before a name is sent, "✋ ZOOM Raise Hand" fills the screen on two lines, more than 40% larger than before.
- **A small timer stays on top.** While the raise hand is showing, a strip along the top of the screen keeps the meeting timer in view, in words and in real time: for example "Watchtower Study — 15 minutes, 30 seconds left". It turns amber and red with the usual warnings, and says "over" after the time is up.
- **A countdown ring for the raise hand.** A ring in the bottom-right corner counts down the raise hand's own seconds (45, or 90 after a name is sent). In the last 10 seconds it pulses gently.
- **The countdown waits while you type.** While you type a name, the raise hand's countdown is held, and the ring turns dashed, so the screen can't disappear in the middle of a name. It carries on when you stop typing or press Send. If the control page stops responding, it resumes after 5 seconds, and one raise hand is never held for more than 3 minutes.

## What's new in 1.3.2

- **A confirmation when the name is sent.** After you press **Send**, a green "✓ Sent: Maria is on the speaker's screen" appears under the buttons for a few seconds, and the name also shows in the panel's status line. If the raise hand has already ended, it says "Not sent" in red instead, and your typing is kept.
- **The raise hand now stays for 1½ minutes after the name is sent.** It no longer adds 45 seconds. Sending a name sets it to 90 seconds from that moment. Without a name, it still goes away after 45 seconds.

## What's new in 1.3.1

- **Show who is raising their hand.** After pressing **✋ ZOOM Raise Hand**, a box appears at the bottom of the panel to type the person's name. Press **Send** (or Enter) and the speaker's screen shows the name very large, bigger than the "ZOOM Raise Hand" heading, and the 45 seconds start again. Long names shrink to fit across the screen. The name stays on the screen if you press *Tell conductor to unmute*.

## What's new in 1.3.0

- **ZOOM Raise Hand.** When someone raises their hand on Zoom, press **✋ ZOOM Raise Hand** on the control page. The speaker's screen shows a big "✋ ZOOM Raise Hand" with an amber border that glows in and out. It goes away by itself after 45 seconds, and the timer keeps running underneath.
  - **Cancel:** the screen shows "Zoom raise hand cancelled" for 5 seconds, then returns to the timer.
  - **Stop:** goes straight back to the timer.
  - **Tell conductor to unmute:** adds "Conductor: ask them to unmute" to the screen, without restarting the 45 seconds.
  - **Optional:** turn it off under *Meeting → Zoom raise hand*. The button then disappears from the control page.
- **Bigger text on the speaker's screen, made for a 1080p monitor.** The countdown, the time of day, the part name and the progress bar are larger. A one-hour countdown (1:00:00) still fits with room to spare.

## What's new in 1.2.4

- **The speaker's countdown is bigger and brighter.** The time on the speaker's screen is larger and now shows in white while a part is running, so it is easier to read from the platform. The amber and red warnings are brighter too, and the flashing no longer dims the numbers so far that they are hard to read in the last seconds. A dim, grey time still means the timer is stopped or waiting.

## What's new in 1.2.3

- **Fixed: "Time's up" stayed on screen after Stop.** The pop-up kept flashing at the top of the speaker's screen and the control page after a part was stopped. It now disappears as soon as you press Stop, Pause or Reset, or move to another part.

## What's new in 1.2.2

- **The speaker's screen shows the time when no timer is going.** Before a part is started, it shows just the time of day (12- or 24-hour, as you chose). When you press Start, it switches to the countdown.
- **Set when the meeting starts.** Songs, prayers and the chairman's remarks vary, so the schedule can now start from a time you choose instead of a guess from the first part.
  - **Settings:** under *Meeting*, set *Midweek starts at* and *Weekend starts at*. Left empty, it works as before.
  - **Just this week:** on the control page, *Meeting start → Starts at* sets a different time for one meeting only. *Use saved* puts the saved time back.
  - **Each part shows its scheduled time** in the parts list.
  - **Behind or ahead:** the control page shows *Starts in…*, then *2:10 behind* or *1:00 ahead*, with the *Scheduled end*. The end is a reference, not a promise, because songs and prayers aren't timed.
  - **Adaptive timing** (when turned on) now measures from this start time.
- **Fixed:** a second Stage Timer on the same network no longer stops the first from announcing its own `stage.local` name.

## What's new in 1.2.1

- **Connect other devices more reliably.**
  - **Refresh network.** Stage Timer now announces `stage.local` again on its own whenever this computer's network address changes (a new Wi-Fi network, a new IP, waking from sleep). There's also a **Refresh network** button under *Advanced → Network* and in the tray menu.
  - **Open port** (Windows). If another device can't reach the timer, press **Open port** under *Advanced → Network* and choose Yes when Windows asks. It adds Windows Firewall rules for the timer's port and for the `stage.local` name announcements.
  - **Clear status.** The Network row says whether `stage.local` leads to this computer or to a different device (for example a second Stage Timer using the same name), and shows the IP link that always works.

## What's new in 1.2.0

- **A new, calmer look.** The control page, the speaker's screen and the app window have a fresh design with the Noto Sans font (built in, so it works offline).
  - On a laptop, the control page shows three columns: the meeting's parts on the left, the timer in the middle, and on the right exactly what the speaker sees. On a tablet it shows two columns, and on a phone or in the OBS dock, one.
  - The app window now has a side menu (Overview, Meeting, OBS, Reports, Updates, Advanced) instead of one long page.
  - The speaker's screen stays dark, with clearer colours. The warnings work exactly as before.
- **Show the current time** (off by default). Turn it on under *Meeting → Clock*. The time of day appears on the control page, with when the meeting should end, and on the speaker's screen between parts, with the next part below it. While someone is speaking, the screen shows only their countdown. Choose a 12-hour (7:30 PM) or 24-hour (19:30) clock.
- **Theme.** Under *Advanced*, choose Auto (follows Windows), Light or Dark for the control page and the app window. The speaker's screen and the OBS dock are always dark, so they never glare.
- **The meeting changes with the day.** When the app is left running, it now switches between the midweek and weekend meeting by itself within a few seconds of the day changing, and loads the new week's parts. It never switches while a part is running or paused.
- **Show the speaker's screen on another monitor.** By default it opens in your browser. Under *Advanced → Show speaker's screen on* you can pick a connected monitor (such as a third screen or a TV), and *Open* shows it fullscreen there. Press Esc to close it.
- **OBS gets the control dock only.** The OBS Browser Source ("on-screen timer") setup and the `?bg=transparent` option are removed.

## What's new in 1.1.5

- **Starts hidden in the background.** Stage Timer now launches into the system tray without opening its window. Click the tray icon to open it, or turn *Start hidden* off under Advanced. A brand-new install still shows the window the first time, and launching the app again while it runs brings the window up.

## What's new in 1.1.4

- **Change scenes during a part.** The control page and OBS dock now have a *Scene for this part* picker for the current part. Pick a scene while the part is running and it goes on air straight away; pick one before it starts and it's used when it starts. Nothing needs the app window.
- **Counseling scene.** For student talks in Apply Yourself to the Field Ministry, a *Counseling scene* picker sets the scene OBS goes to when you press Stop (when the counsel is given). It is set per part, so each talk can use its own. *Usual counseling scene* uses the general one from the app window (*Counseling in Apply Yourself*), and if none is set, the default stop scene. Other parts use the default stop scene.
- **PDF reports go to your Desktop and Documents.** Each report PDF is saved in both places, still named like `MIDWEEK Time Report 10-27-2026.pdf`.

## What's new in 1.1.3

- **Timer reports are saved as PDFs.** When a report is made, Stage Timer also saves it as `MIDWEEK Time Report 10-27-2026.pdf` (or `WEEKEND Time Report …`, month-day-year) in **Documents → Stage Timer Reports** (from 1.1.4: on the Desktop and in Documents). Open the PDF, or the folder, from the *Timer reports* card in the app window. A second report on the same day is saved alongside the first as `(2)`.

## What's new in 1.1.2

- **Default scene when a part is stopped** (OBS scene switching). Choose a scene, such as the full stage shot, that OBS goes to when you press Stop, so it isn't left on the last part's scene. Only Stop does this; Pause and Reset don't. None (the default) leaves OBS alone.
- **Timer report.** When the Congregation Bible Study (midweek) or the Watchtower Study (weekend) is stopped, Stage Timer saves a report of every part's planned time, actual time and how far over or under it ran, with a net total. Concluding Comments doesn't make one. Open it from the new **Report** button in the control page and dock, or from the app window, where you can also make one on request. The page prints cleanly, and earlier weeks are kept.
- **Automatic updates.** New versions download quietly in the background and install when you quit the app. It never restarts by itself, and not while the timer is running. Turn it off or check by hand under *Updates* in the app window.
- Fixed: the **Open** buttons in the app window did nothing when the app was using port 80.

**Updating from 1.1.1 or earlier:** install version 1.1.2 or later by hand once. From then on, updates arrive automatically.

## What's new in 1.1

- **OBS scene switching** (optional, off by default). Give each part an OBS scene in Stage Timer's settings. When a part starts, its scene is sent to OBS Preview and then Transitioned, exactly like pressing the Transition button in Studio Mode, so tools that react to Preview and Transition (such as the EMEET-OBS Bridge) keep working. Needs OBS Studio Mode and the WebSocket server turned on.
  - Resuming after a pause does not switch scenes, and a scene that is already on air is left alone.
  - If you start another part while a transition is still running, it waits for the transition to finish.
  - If OBS can't be reached (or Studio Mode is off, or a scene no longer exists), a message appears in the settings window and in the control page and dock. The timer is never held up.
  - Upgrading from 1.0.0 changes nothing until you turn this on.

## Download

**Stage-Timer-Setup-1.4.0.exe** (Windows 10 or later), attached below.

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
- **Current time** (off by default), in a 12- or 24-hour clock, and a Light / Dark / Auto theme. See above.
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
