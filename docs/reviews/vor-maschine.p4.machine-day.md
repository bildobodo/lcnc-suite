# Machine day · checklist (Saturday 2026-11-21)

For the operator at the machine: 3 axes XYZ, Full HD touch panel in landscape, Chromium. Configuration `milling-machine-webui`, `DISPLAY = lcnc-suite-development`.

Each step has three columns: **Do**, **Expect** and **Note**. Record one result per step: PASS; FAIL with a short note; or "skipped, because …".
- On a FAIL, repair nothing; note it and carry on.
- Every move with a hand on the E-stop.
- Programs run in the air, Z up.

Steps marked **(SSH)** I do myself over SSH, read-only, once the key is in. Anything that changes the install or can move waits for your go, and moves only with you at the machine.

## 0 · Preparation (the day before, or before power-on)

| # | Do | Expect | Note |
|---|---|---|---|
| 0.0 | SSH: on the VM `ssh-keygen -t ed25519 -C claude-vm-to-machine -f ~/.ssh/id_ed25519_machine` (or tell me to run it); add the `.pub` line to the machine PC's `~/.ssh/authorized_keys`; tell me the machine's address | I can log in (read only) | — (without SSH you run 0.1–0.5 yourself and send me the output) |
| 0.1 | Update development and build: `git pull` in the suite folder (`~/linuxcnc/configs/lcnc-suite-development`), then `cd lcnc-webui && npm run build` (SSH after your go) | the build ends without errors; the commit is `dc9dc3e4` or later | the commit (`git log -1 --oneline`) |
| 0.2 | **(SSH)** `lcnc-gateway/.venv/bin/python3 lcnc-gateway/venv_check.py` (#42) | `OK: numpy … from /usr/lib/…` | the output and `pip show opencv-python-headless` (version) |
| 0.3 | **(SSH)** the var file has a line `3116 0` | present (if missing: add it, after asking) | — |
| 0.4 | **(SSH)** the log folder: `<suite folder>/runlogs`, or `LOG_DIR` from the INI | — | the path |
| 0.5 | **(SSH)** the machine's `lcnc_webui.hal`: `loadrt estop_latch names=webui-hb-latch`, and no `webui-safety.trip-latch` | present. The copy on GitHub is from 2026-05-29 and still has the old latch; the machine's file must be newer, since the current suite would not start with it. Please push the machine's config, so I read its real state | the file's latch lines |

## 1 · Start and safety chain

| # | Do | Expect | Note |
|---|---|---|---|
| 1.1 | `linuxcnc milling_machine_webui_development.ini` | the browser opens the UI; **no** red "safety chain incomplete" banner | a photo if a banner shows |
| 1.2 | Arm → E-Stop Reset → Machine On | the order works; a control that is still closed says why at the control | — |
| 1.3 | E-stop (Escape or the button), then Reset → On again | the machine goes off, then on again | — |
| 1.4 | No other device has the UI open. Close the browser tab, wait 5 s, open it again | the machine goes to E-stop about 3.5 s after the tab closed (3 s grace, then the 0.5 s watchdog); after reopening a red banner "SAFETY TRIPPED (…) — Acknowledge, re-Arm if needed, then E-Stop Reset" with an Acknowledge button. Arm works only after Acknowledge, then Reset, then On | a photo of the banner |

## 2 · Homing

| # | Do | Expect | Note |
|---|---|---|---|
| 2.1 | Tap a single axis Home | closed, with the reason at the control: "Homes X Y Z together (HOME_SEQUENCE -1) — Home All" | — |
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

## 8 · Probing (the test table and the round test piece)

The probe is in the spindle and its tool number is set. Each routine starts a few millimetres from its feature.

| # | Do | Expect | Note |
|---|---|---|---|
| 8.1 | **Surface** Z on the test table | a plausible value | the value |
| 8.2 | **Outside**, one edge of the test table (X, then Y) | the edge where it is | the values |
| 8.3 | **Outside**, a corner of the test table (top corner) | X and Y of the corner | the values |
| 8.4 | **Angle**, along one table edge | a small angle (the table's alignment) | the angle |
| 8.5 | The round test piece: **Boss/Pocket** › Round Boss for a cylinder; Round Pocket for a ring (start at its edge) or Round Pocket C (start at its centre) | a plausible centre and diameter | centre, diameter |
| 8.6 | **Calibrate** on the round test piece, only if its diameter is known precisely | the tip offset (#3036) is new | the value, the piece's diameter |
| 8.7 | Surface scan on the test table, then compensation ON and OFF | with ON, Z follows the surface; with OFF it does not | — |

## 9 · G30

In MANUAL or MDI: after a program the machine is in AUTO, where the read says "G30 not confirmed in AUTO — switch to MDI first". The buttons are in Probing › Toolsetter.

| # | Do | Expect | Note |
|---|---|---|---|
| 9.1 | Read G30 (Refresh) | 0/0/0, confirmed | — |
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
