# Machine day · checklist (Saturday 2026-11-21)

For the operator at the machine: 3 axes XYZ, Full HD touch panel in landscape, Chromium. Configuration `milling_machine_webui_development`, `DISPLAY = lcnc-suite-development`. The machine PC (Intel N100) keeps 2 of its 4 cores for realtime, so browser and gateway share 2.

Each step has three columns: **Do**, **Expect** and **Note**. Record one result per step: PASS; FAIL with a short note; or "skipped, because …".
- On a FAIL, repair nothing; note it and carry on.
- Every move with a hand on the E-stop.
- Programs run in the air, Z up.

The values below were read on the machine itself over SSH (Friday 2026-11-20).

Steps marked **(SSH)** I do myself over SSH, read-only, once the key is in. Anything that changes the install or can move waits for your go, and moves only with you at the machine.

## 0 · Preparation — done Friday evening over SSH

| # | Do | Expect | Note |
|---|---|---|---|
| 0.0 | SSH: on the VM `ssh-keygen -t ed25519 -C claude-vm-to-machine -f ~/.ssh/id_ed25519_machine` (or tell me to run it); add the `.pub` line to the machine PC's `~/.ssh/authorized_keys`; tell me the machine's address | I can log in (read only) | **done** 2026-11-20: `cnc@192.168.50.171` |
| 0.1 | Update development and build: `git pull` in the suite folder (`~/linuxcnc/configs/lcnc-suite-development`), then `cd lcnc-webui && npm run build` (SSH after your go) | the build ends without errors; the commit is `98748fab` or later | **done** 2026-11-20: 1adfc403 (2026-10-23) → `98748fab`, a fast-forward; build OK in 45 s. Four weeks of changes reach the machine at once |
| 0.2 | **(SSH)** `lcnc-gateway/.venv/bin/python3 lcnc-gateway/venv_check.py` (#42) | `OK: numpy … from /usr/lib/…` | **done**: `OK: numpy 1.24.2 from /usr/lib/python3/dist-packages/numpy`; opencv 4.13 (outside the pin) loads, used only by the camera, which is off |
| 0.3 | **(SSH)** the var file has a line `3116 0` | present (if missing: add it, after asking) | **done**: present (0); every WebUI number of the current template is declared |
| 0.4 | **(SSH)** the log folder: `<suite folder>/runlogs`, or `LOG_DIR` from the INI | — | **done**: no `LOG_DIR`, so `<suite folder>/runlogs` (last written 2026-10-24) |
| 0.5 | **(SSH)** the machine's `lcnc_webui.hal`: `loadrt estop_latch names=webui-hb-latch`, and no `webui-safety.trip-latch` | present | **done**: `loadrt estop_latch names=webui-hb-latch`, no old latch. (The copy on GitHub is older: the machine's config changes are not committed. Toolsetter settings pass today's rule.) |

## 1 · Start and safety chain

| # | Do | Expect | Note |
|---|---|---|---|
| 1.1 | `linuxcnc milling_machine_webui_development.ini` | the browser opens the UI; **no** red "safety chain incomplete" banner; your settings as before (the first start of the four weeks' changes) | a photo if a banner shows; anything that looks different |
| 1.2 | Arm → E-Stop Reset → Machine On | the order works; a control that is still closed says why at the control | — |
| 1.3 | E-stop (Escape or the button), then Reset → On again | the machine goes off, then on again | — |
| 1.4 | No other device has the UI open. Close the browser tab, wait 5 s, open it again | the machine goes to E-stop about 3.5 s after the tab closed (3 s grace, then the 0.5 s watchdog; 3.6 s measured on the VM sim); after reopening a red banner "SAFETY TRIPPED (…) — Acknowledge, re-Arm if needed, then E-Stop Reset" with an Acknowledge button. Arm works only after Acknowledge, then Reset, then On | a photo of the banner |

## 2 · Homing

| # | Do | Expect | Note |
|---|---|---|---|
| 2.1 | Tap a single axis Home | closed, with the reason at the control: "Homes X Y Z together (HOME_SEQUENCE -1) — Home All" (HOME_SEQUENCE −1 on all three joints) | — |
| 2.2 | Home All (hold) | all three axes home | — |
| 2.3 | Unhome one axis | only that axis | — |

## 3 · Jogging by touch

| # | Do | Expect | Note |
|---|---|---|---|
| 3.1 | Hold X+, then release | moves only while held, stops on release | — |
| 3.2 | Step 1 mm, one tap | exactly 1 mm | — |
| 3.3 | Switch tabs while jogging | the jog stops | — |
| 3.4 | A step in Z down, then back up | — | — |

## 4 · Holds

| # | Do | Expect | Note |
|---|---|---|---|
| 4.1 | A short tap on Unhome All | "Hold to activate"; nothing happens | — |
| 4.2 | Hold Unhome All fully | fires after 0.5 s | — |
| 4.3 | A short tap on Start (program loaded) | "Hold to activate"; nothing starts | — |
| 4.4 | During the whole day: watch for "Page delayed — hold again" | appears only when the page stalls; the hold did nothing, hold again | when and where it showed |

## 5 · MDI, overrides, spindle, coolant

| # | Do | Expect | Note |
|---|---|---|---|
| 5.1 | MDI `G0 X100 Y100` | moves | — |
| 5.2 | Change the feed, rapid and spindle overrides | the display and the effect agree | — |
| 5.3 | Spindle Fwd at an RPM, Stop; then Rev | turns, stops | — |
| 5.4 | Flood on/off | — | — |

## 6 · A program in the air

Set the work zero so that the program runs safely above the table.

| # | Do | Expect | Note |
|---|---|---|---|
| 6.1 | Load a known program | the preview; the Sim tab's collision check runs to 100 % | — |
| 6.2 | Start (hold) | runs; the code line follows | — |
| 6.3 | Pause; Resume (hold); Abort | — | — |
| 6.4 | Run from line, from a line after the program's tool change (one M600 before the line) | the button reads "Measure T‹n› + Run from Line ‹N›" (hold); the tool is measured first; then, with "Retract to safe Z" on, Z goes to the top (skipped when Z is already there, as after the measurement); then the line. With more than one tool change before the line, Run from line refuses | — |

## 7 · Tools

| # | Do | Expect | Note |
|---|---|---|---|
| 7.1 | M6 in a program or in MDI | a dialog to confirm; Confirm continues | — |
| 7.2 | M600 at the toolsetter (the usual path; G30 0/0/0 at Z top) | measures; the tool length in the table is new | the measured length |
| 7.3 | Measure a tool from the UI (Measure Current) | as 7.2 | — |
| 7.4 | In 6.4: count the measurements | the tool is measured **once**; the program's own M600 does not measure it again (#3116) | — |

## 8 · Probing (the test table and the calibration ring)

The probe is in the spindle and its tool number is set (#3014 = 99); the tool table holds its ball diameter. Each routine starts a few millimetres from its feature. The ring (20 mm bore) is clamped, so no touch can shift it.

| # | Do | Expect | Note |
|---|---|---|---|
| 8.1 | **Surface** Z on the test table | a plausible value | the value |
| 8.2 | **Outside**, one edge of the test table (X, then Y) | the edge where it is | the values |
| 8.3 | **Outside**, a corner of the test table (top corner) | X and Y of the corner | the values |
| 8.4 | **Angle**, along one table edge | a small angle (the table's alignment) | the angle |
| 8.5 | The calibration ring: **Boss/Pocket** › Round Pocket C — the ball inside the bore, below its top edge, roughly centred (the routine makes no Z move). Or Round Pocket: start above the ring's top face, left of the bore, closer to the bore than the step-off width (#3023) and lower than the max Z distance (#3020) above the face | the centre, and a diameter near 20 mm (before 8.6 it may be off by a few hundredths). The moves between the touches run at the traverse feed `#3017` (1000 mm/min); before this update the pocket routines took the number 3017 as the feed | centre, diameter |
| 8.6 | **Calibrate** › Round Hole: Diameter = the value on the ring (engraving or certificate), Calibrate On = Avg XY; start as for Round Pocket (above the top face, left of the bore). Then 8.5 again | the Calibration Offset (#3032) is new; 8.5 again reads close to the ring's value | the offset; the diameter before and after |
| 8.7 | Surface scan on the test table, then compensation ON and OFF | with ON, Z follows the surface; with OFF it does not. The chosen method (e.g. Linear) now really applies; before this update it was always Cubic | the method |

## 9 · G30

In MANUAL or MDI: after a program the machine is in AUTO, where the read says "G30 not confirmed in AUTO — switch to MDI first". The buttons are in Probing › Toolsetter.

| # | Do | Expect | Note |
|---|---|---|---|
| 9.1 | Read G30 (Refresh) | 0/0/0, confirmed | the values |
| 9.2 | Use Current Position, without saving | a draft; nothing written | — |

## 10 · Load on the machine PC

| # | Do | Expect | Note |
|---|---|---|---|
| 10.1 | Load a large program. While the collision check runs, jog and go through the tabs | no stutter that disturbs operation; no safety trip | the check's rough duration |

## 10b · Strip width (for the strip package, 2 minutes, needs a keyboard)

The strip package is on the machine since its merge before this day. The Tool section takes the rest of the row; how much room it keeps above its minimum width (224 px) is the strip's reserve. The panel's fonts decide the real number.

| # | Do | Expect | Note |
|---|---|---|---|
| 10b.1 | Before the first touch (desktop sizes), in the browser you use: F12 → Console, paste the line below, Enter | one line of JSON with `"fonts":"loaded"` | copy it into your notes, with the browser zoom (shown in the address bar; 100 % if nothing shows); machine idle, MANUAL, no dialog open |
| 10b.2 | Touch the screen once, then the same line again | `"touch":true` | copy it too |
| 10b.3 | If Firefox ESR is installed: 10b.1 and 10b.2 there | — | — |

```js
(() => { const s = document.querySelector('.strip'); const secs = [...s.children].filter(c => !c.classList.contains('stripFade') && c.getBoundingClientRect().width > 0); const tool = document.querySelector('[data-strip="tool"]'); const tw = tool ? tool.getBoundingClientRect().width : NaN; const tmin = tool ? parseFloat(getComputedStyle(tool).getPropertyValue('--strip-tool-w')) : NaN; const t = (sel) => document.querySelector(sel)?.textContent?.trim(); return JSON.stringify({ fonts: document.fonts.status, over: s.scrollWidth - s.clientWidth, room: Math.round((tw - tmin) * 10) / 10, tool: Math.round(tw * 10) / 10, toolMin: tmin, client: s.clientWidth, win: innerWidth, devicePixelRatio, touch: document.documentElement.classList.contains('touch-device'), ua: navigator.userAgent.match(/(Firefox|Chrom\w*)\/[\d.]+/)?.[0], step: t('[data-strip="jog"] .stepBlock .label-muted'), mode: t('[data-strip="jog"] [aria-label="Task mode"] [aria-checked="true"]'), sections: secs.map(c => Math.round(c.getBoundingClientRect().width * 10) / 10) }); })()
```

**How I read it.**
- `over` must be 0: nothing runs past the strip's edge.
- `room` is Tool's width minus its minimum (CSS px). It must be ≥ 24. Run on the VM it gave:
  - Chromium: touch 32.5, desktop 41.5;
  - Firefox 160: touch 49.5, desktop 60.4.
- `room` < 24 or `over` > 0: the panel's fonts take more than the reserve; I adjust from these lines.
- `room` and `toolMin` are `null`: the machine still runs a version without the strip package. Update it first (development, then restart the suite) and run the line again; this is no failed reserve.

## 11 · Logs

**(SSH)** Afterwards I pull `runlogs/` (`trace.ndjson`, `crash.log`, `gateway.log`, `trips/…`) myself over SSH, read-only, and evaluate them. A USB stick is the fallback. From you I only need the notes from this list.

## Not on the machine day

- TWP: the machine has none. The TWP checks and the perf matrix run on the VM sim.
- Firefox ESR on the machine is deferred.
- The strip for more axes is planned, not built; nothing of it is on the machine.
