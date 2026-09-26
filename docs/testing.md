# Test suite and acceptance gates

Run from the repository root. `scripts/test_suite.py list` lists the checks.
Use the prepared gateway venv with its runtime dependencies, then install
`lcnc-gateway/requirements-test.txt` into that venv (the same pytest pin CI
uses). Install frontend dependencies with `cd lcnc-webui && npm ci`, and
Playwright Chromium with `npx playwright install --with-deps chromium` there.

| Command | What it checks | LinuxCNC motion |
| --- | --- | --- |
| `python3 scripts/test_suite.py offline` | Backend discovery; frontend lint, production build, units and browser tests | None |
| `python3 scripts/test_suite.py offline --component backend` | Backend discovery plus 5-axis mesh/kinematics acceptance | None; fake controller |
| `python3 scripts/test_suite.py offline --component frontend` | Frontend checks, including recorded parity replay | None |
| `lcnc-gateway/.venv/bin/python scripts/test_suite.py live-twp --ini /path/lcnc_suite_sim_6axis_twp_xyzabc.ini --allow-sim-motion` | Fresh preview goldens, cached-payload parity and plane invariants, mode/button, capture, reorient, touch-off and adverse-path checks | Yes, simulator only |

The existing `lcnc-gateway/run-tests.sh` also uses pytest discovery, including
new test files automatically. The offline suite excludes `test_viewer_init.py`,
which starts a separate gateway. NumPy is required for vectorized checks;
real-rs274 oracle tests explicitly skip when LinuxCNC Python modules are absent.
GitHub CI runs this same offline entry point separately for backend/frontend.
Backend gates also run `scripts/test_5axis_xyzac.py`: closed meshes, guide
coverage, 8,000 poses against the compiled LinuxCNC C oracle and demo limits.
A C compiler and Git LFS assets are required. Installer tests cover fresh
installs, upgrades, state preservation and retirement outside the chooser.

## Scoped-CSS / design-token linter

`npm run lint:css` (= `python3 scripts/audit-scoped-css.py`) scans every
`.vue` under `lcnc-webui/src` for scoped-class leaks and token drift:
TOKEN (gap/opacity/font-size/radius/hex literals), HOVER (off-tier
color-mix percentages), DEEP (visual `:deep()` overrides), STACK
(re-implemented stack utilities), HLPCT (a `--hl-*` COLOUR token in the
percent slot of `color-mix()` — parsed per argument), ZINDEX (literal
`z-index`), IMPORTANT, INLINE (static `style=` in the template) and
TOFIXED (`.toFixed(` in the template — formatting belongs in `format.ts`).
The template range is nesting-aware (a nested `<template v-if>` no longer
ends the scan). `audit-ok: <reason>` on or above the line suppresses one
finding, visibly.

Template categories: `INLINE` (static `style=`), `TOFIXED` (`.toFixed(` in a
template) and `CLOSE` (a `<MachineBtn type="close"` without an `aria-label` —
every close is named for its context, UX-05; the tag is read across lines).

The linter's own pins live in `scripts/test_audit_scoped_css.py` over the
fixtures in `scripts/test_fixtures/audit_css/` (a hit and a non-hit per
category, the real KeyboardTab rules that started HLPCT, a `.toFixed` after
a nested `</template>`), plus "the production sources scan clean".
`scripts/test_suite.py offline` runs them as the explicit `audit-css`
entry — the backend pytest starts in `lcnc-gateway/` with
`testpaths = ["."]` and would never discover `scripts/`. A deliberately
wrong fixture expectation turns that entry red; `python3
scripts/audit-scoped-css.py --paths <files…>` scans just the given files.

## Guard specs (serial-guards)

The guard specs share one filter (`guardSpecs` in `playwright.config.ts`) and run
one file at a time under the `serial-guards` project, between
`serial-touchoff` and `serial-layout`; the parallel `chromium` project
ignores them through the same constant. `npx playwright test --list` shows
each file once, under `serial-guards` only.

| Spec | Pins |
| --- | --- |
| `keyboard-guards.spec.ts` | Escape sends exactly `estop` (never `estop_reset`) from the keypad, the editor, every dialog and during a key capture; Space/Enter/Backspace send nothing behind a dialog, the keypad or the editor; pause/resume via Space unchanged; a jog key released after a field opened mid-jog still sends `jog_stop`; the modal registry matches the DOM's `.dialogOverlay` count (self-test); the KeyboardTab edits a copy. Keypad OK: Space is hammered from the confirm until the field holds focus again (busy latch, focus drop, re-enable) — exactly one `touchoff`, never `cycle_start`; Escape in that window sends `estop`; positive control afterwards (the guard is a transition, not a latch). A focused key acts as itself (UI-I10): real Tab to Cancel + Enter cancels without a touch-off, Space on a focused digit appends once, Enter on a focused OK confirms once, Enter on the root still confirms; text keys act on Enter/Space, a focused Close closes. An explicit close by keyboard (round 4, UI-I10 rest): Enter/Space on the keyboard's X, Enter on a search field's Done and the editor's X leave the OWNER focused (MDI line, search field, `.cm-content`), the modal guard released once focus landed, and the next Space TYPES — never `cycle_start`, never `mdi` (the MDI line sends on keydown). Tool editor (UX-02): the header X closes an unchanged form at once, asks "Discard changes?" on an edited one, Keep editing keeps the values, Discard closes; registry self-test covers the ask. Settings save status (UX-08): a keyboard-binding change shows "Saving…", the mock's correlated ok reply (by `req_id` from `lastCmds`) "Saved", an ok:false reply "Save failed — <section>: <reason>", a foreign reply moves nothing; the ledger cases (round 5, UI-I12): a refused keyboard save stays in the header behind the display's ok until the keyboard's own retry succeeds, and the ok for an older revision never reads "Saved" while a newer change of the section is still in the debounce (the status is sampled until the second request is out). The page-hide path (round 6): with a change in the debounce, a simulated hidden/visible cycle sends ONE `sendBeacon` to `/settings/keyboard` (routed), the status reads "Sent on page hide — not yet confirmed", a `settings_changed` blob with a DIFFERENT keyboard state reads "not on the server", the blob carrying the beaconed data reads "Saved", and no WS save follows the cleared debounce. Round 7: a first beacon that never arrived + a complete blob WITHOUT the section, and a refused (409) beacon + the blob with the STORED value, both read "Save failed — keyboard: page-hide save not on the server …" (no WS save; the header keeps the hint readable). Settings close guard (UI-K16): a changed macro draft asks "Discard changes?" on X, backdrop and a header switch (a registered modal of its own); Keep editing keeps it, Discard performs the navigation; an untouched new macro closes at once. Dimmed controls explain themselves (UX-09): the disabled MDI line carries the reason as its title and a real tap (`click({ force: true })` = pointerdown on a disabled control) puts it in the message center; a toggle whose OWN gate closed with a reason is a focusable `role=button` label — Enter and Space explain, Space never reaches Cycle Start. Help (UX-11): the Setup `Help: Go to positions` popover opens by click and by Space/Enter on the focused button, no machine command. Its geometry (round 5, UI-I13; touch): at 1280 × 900, 900 × 1200 and 900 × 1200 at 150 % CSS zoom the popover lies wholly inside the viewport on its first opening, its text fits without an inner scroll and reads in body typography (no uppercase, weight < 600). The taps are dispatched at MEASURED coordinates once the icon has held still for 300 ms (`tapSteady`): Playwright's own scroll-into-view under CSS zoom re-scrolled the strip between the two taps of one case in a loaded gate run (712 → 1171 px), the UA's light dismiss closed the popover on the first touch beside the trigger and the retried tap re-opened it. The open popover stays inside the viewport through 900 × 700 → 1280 × 700 → 900 × 1200 and re-opens inside it. |
| `dialogs.spec.ts` | The dialog contract (design wave D2, plan Anhang B), one table row per dialog (23): `role="dialog"` named by its title, the tier, the action order (the cancel side left), the initial focus Anhang B names, Tab AND Shift+Tab only inside the topmost dialog, its own helper, the safety strip and the banner's Abort / Acknowledge (backwards first — the initial focus sits early, so the walk wraps to the safety strip within a few stops even in Settings), Escape = exactly `estop` with the dialog still open, the backdrop by kind (info/confirm close, forms and flows stay), the focus back on the control that opened it, nothing sent by closing, and the registry self-test before and after. UI-D01: from Settings, from a stacked "Discard changes?" and with the text keyboard open on a Settings field, Tab reaches the banner's Abort and Enter sends exactly `abort`; after the run ends Tab stays in scope and Space sends nothing. UI-D06: a tool-change dialog opening over the tool editor's keypad pauses it — an unapplied expression and the empty entry come back exact after > 600 ms (two visibility polls), the field is unreachable by Tab and by pointer meanwhile, a draft filed by an outside tap stays as it is, only Discard ends it, nothing is applied. Review round 1/2: a HIT TEST on every row and every Tab stop (a pointer at the focused element lands in the focused dialog); UI-DI01 (a flow stays the operating position with Settings / Messages opened in either order), UI-DI02 (a lower dialog closing leaves focus in the top), UI-DI04 (after a disarm the fallback lands on the dialog container, never body), and Run from line's initial focus at two heights. |
| `tabs.spec.ts` | The one tab navigation (design wave D3): tablist/tab/tabpanel, one Tab stop per list, arrows move focus without selecting, Enter/Space select, Left/Right wrap, Home/End, Up/Down a row in Probing's 4 × 2 grid; with keyboard jog on and the navigation keys bound to jog, a focused tab sends nothing (control: the same key on an unfocused page jogs; mutation-checked — without the list's preventDefault 16 jog commands); a tab switch sends nothing, a running jog stops; a hidden panel refuses focus; the Run-from-line spindle preset is one radio group Rev · Stop · Fwd; the narrow side pane (150 % portrait) shows two selects on one row and returns to the lists with the same selection. |
| `forms.spec.ts` | Controls and forms (design wave D4), at the DR viewports: on the strip, every side-pane tab, every Probing procedure, the G-code Reference, the tool editor, the import preview, the macro parameters and every Settings section, every visible field has an accessible name and every visible `<label>` labels a control; fields and md buttons are `--control-h` tall in the side pane and dialogs (32 px desktop, 44 px touch), at least compact in the strip and in tables; a probe field's unit is its description and its keypad readout and follows the machine's linear unit (mm → in); a label tap opens the field; a count refuses 2.5; a reset sits at the end of its section and its confirm keeps its button's gate (setup / probe, not the looser safety / ready); the tool table's row actions look alike and name their target, both binding tables read Action | binding, the gamepad inverts only the machine's stick axes. |
| `editor-guards.spec.ts` | The edit session is bound to its file: external program changes keep buffer A and raise the conflict banner, Save writes A only, a delayed save never reloads B from A, the CodeMirror import is bound to the session, an older save reply never touches a newer session, dirty Discard asks; upload name conflict → Cancel / Rename / Replace. |
| `touch-hold.spec.ts` | Hold-to-fire under real touch events (CDP `Input.dispatchTouchEvent`, `hasTouch`): tap → nothing + "Hold to activate", complete hold → exactly one command, slide-off / touchCancel / hidden page → cancelled, a new hold starts from zero; the teleported tool dialog is usable by touch (scroll, keypad, confirm, footer). The tool dialog's Cancel after an edit meets the discard ask, answered by touch. Every cancel says so at the control (UX-12): the slide-off hint "Hold to activate — stay on the button", a gate closed under the finger "Unavailable — <reason>" (no command), and the hold button's default title. |
| `input-session.spec.ts` | The unified input session (WP8): one layout per target, drafts per owner (also across number → text → number), outside tap / Tab out of the field or out of a key hides both helpers without confirming, focus returns to the field after OK/Cancel, text entry with REAL touch taps (`hasTouch`), page switches within the strip budget. Keys are pressed with real pointer input (`click`/`tap`), never `dispatchEvent`, so a covered key fails. Portrait 900 × 1200: the whole keyboard within the viewport at 100 % AND at 150 % (CSS `zoom` on the root = 600 × 800 CSS px) — what makes 150 % fit is the sticky Safety section folding its status detail while a helper is open (a four-row compact form was measured too: it misses by 11 px whenever the header wraps one line more, which its pill texts decide at 600 px) — plus the MDI line (the readout), the banner and the safety buttons `toBeInViewport()` at both zooms (the portrait viewer floor is column-relative, `min(500px, 45%)`). A failure names the space budget (header, banner, safety, strip top). Also: `''` is a draft ("= 0 draft"), a neighbour's OK (busy latch) is not an owner end, a gate end drops the owner's drafts (fields and offset cells), and a real backend revocation INSIDE the latch ends them too (two status frames 50 ms apart — the status store applies frames per animation frame, so a close and re-open inside one frame is no state). Editor and search as owners (round 3): the first code line, Save/Discard and the search field are judged by `elementFromPoint` at their centre (a viewport rectangle misses clipping by an ancestor), ≥ 3 editor lines visible at 150 % (measured 7.2), and portrait edit mode folds the idle program controls (Start/Upload/progress gone while editing, back after Discard). Physical typing into the MDI line (round 4, UI-I11): `page.keyboard.type` with the helper open and after closing it, Enter sends exactly one `mdi` with the whole line, focus returns to the line through the busy latch, ArrowDown recalls the history entry, on-screen keys append. Field contract (UX-13): every visible non-readonly `input.inputField` in the MDI tab, the Tools tab, the reference dialog and Settings › Machine carries `autocomplete=off`, `autocorrect=off`, `autocapitalize=off`, `spellcheck=false`, a `name` and an accessible name (≥ 4 fields, or the scan is vacuous). Number keypad X (UX-01): by tap and by Tab + Enter it hides and keeps the draft (comes back marked), focus lands on the field and the next Space is the field's own opener; Discard drops the draft. UX-13 result: the MDI placeholder is "MDI command (↑↓ history)" and no scanned text field has the word "code" in its placeholder (Apple Passwords reads it as a verification-code field). |

Every case sets its own preconditions (`ctl reset` + its status envelope); a
spec must pass alone AND inside the full `npm run test:e2e`.

## Frame / strip states (layout gate)

`layout.spec.ts` (serial-layout) measures the FRAME — the strip, the viewer
pane and the content area, bounding box AND `clientWidth`/`clientHeight` —
and enters every state the bottom strip can show: the number keypad from a
setup field and from a panel field, the G-code keyboard, a macro bar, the
E-Stop / unhomed / message banners and the kins chip. The frame and the
always-visible reference controls (Safety, plus the keypad's owner section)
must not move; a macro bar may only take its own row in landscape
(`viewer.height`, `content.height`, `strip.y`) or its own column in
portrait (`viewer.x`, `viewer.width`, `content.x`, `content.width`, and
their client sizes). Two negative controls prove the gate sees the original
defect, using the keypad from a PANEL field (Safety + keypad only, so the
strip's overflow — and with it an auto band — is gone): injecting
`overflow-x: auto` on the landscape strip (strip/viewer height change) and
`overflow-y: auto` on the portrait strip (inner width and pinned controls
change; the portrait fix is `overflow-y: scroll` — the strip is a
`<fieldset>` whose inner scroll box ignores `scrollbar-gutter: stable` in
Chromium). Both assert their overflow precondition and skip on macOS overlay
scrollbars. The test browser SHOWS scrollbar bands (`launchOptions:
ignoreDefaultArgs ["--hide-scrollbars"]` in `playwright.config.ts`):
headless Chromium hides them by default, and with no band the whole gate
passes on nothing.

## Camera gate (default framing only)

`src/viewer/cameraFraming.ts` is the one rule for the default camera pose:
target = the travel box's centre, eye distance = max(2.345 × maxDim,
1.05 × model radius + near), where the model radius is the bounding sphere
of every non-stock part about the target at the scene's pose. `viewer.spec.ts`
(serial-viewer) drives a bed/column fixture far larger than its travel box
through `window.__viewerDiag` (getCamera / getPartBounds / setView /
setViewDirection / switchProjection) and asserts the eye is outside every
part at the default frame, in all 26 ViewCube directions, after every
preset, in both projections and at Reset's endpoint — plus a negative
control (the old travel-box distance from diagonally below lands inside the
bed). Unit tests: `cameraFraming.test.ts`.

The promise is exactly that: the DEFAULT frame starts outside the model.
Dolly, pan, later machine motion and the linear Reset tween between two
poses are not covered — this is not a camera-collision system, and
`polygonOffset` was left as it is.

## Browser layout regression checks

Layout checks run automatically in `npm run test:e2e` and therefore in the
offline frontend suite and pull-request CI. They use the mock gateway on
4174, not a running LinuxCNC session or the development server on 5173.
Build first: these tests serve `dist/`, not the working Vue sources.

```sh
cd lcnc-webui
npm run build
npm run test:layout
npm run test:visual
npx playwright show-report
```

The two checks complement each other:

| Check | Coverage | Failure conditions |
| --- | --- | --- |
| Geometry (`e2e/layout.spec.ts`) | 3 Axis XYZ, 5 Axis TCP XYZAC, 6 Axis TWP XYZABC; 1600×1000 desktop, 1024×768 compact, 1280×800 touch landscape, 900×1200 touch portrait; Safety, Jog, Setup, Overrides, Spindle and Tool panels | Overlapping or collapsed controls, controls outside their panel, clipped button content, clipping inside a panel, controls moving/resizing/disappearing across permission changes |
| Reference images (`e2e/visual.spec.ts`) | Jog and Setup for all three profiles, desktop and touch portrait, homed and unhomed; additionally stale TWP on the six-axis profile | Appearance differs from a committed reference beyond the configured pixel tolerance, or a reference is missing |

The geometry matrix transitions through homed, unhomed, machine off, E-stop,
disarmed, running, paused and back to homed. It also checks TCP on the five-
and six-axis machines, and both oriented and stale Plane states on the
six-axis machine. State assertions wait for the browser to render each mock
envelope before measuring. These envelopes exercise UI rendering; backend
policy tests remain authoritative for actual machine permissions.

Permission changes must preserve each native control's position and size to
within 1 CSS pixel, relative to its panel. Mode changes can add status text,
so those states get clipping/overlap checks without the same geometry
constraint. Disabled controls count; their explanation wrappers do not count
twice. Scrolling outside a panel is intentional and is not flagged as
clipping. The suite also deliberately injects the original disabled-button
shrinkage and several synthetic defects to prove the detector catches them.

Visual references live in `lcnc-webui/e2e/__screenshots__/visual.spec.ts/`.
They use Linux, the Chromium version from the committed Playwright lockfile,
scale factor 1, light colour scheme, fixed locale/timezone and reduced motion.
The UI font is the one the product ships (Inter, `src/assets/fonts/`, SIL
OFL): references, geometry tests and every operator's browser render the same
face, so a layout reserve measured here holds on the operator's machine.
Until 2026-09-25 the references injected a test-only DejaVu Sans while the
product used each machine's system font. The code surfaces ship
JetBrains Mono the same way (`--font-mono`).
The sticky Safety panel and scroll-edge shadows are hidden only during
Jog/Setup capture so they cannot obscure the panel being compared. Geometry
tests still inspect the normal application, including Safety.

[Playwright notes that screenshot rendering depends on the environment](https://playwright.dev/docs/test-snapshots).
Visual checks therefore skip explicitly on macOS/Windows; the geometry
checks still run. Keep reference updates on Linux with `npm ci` and the
matching installed Chromium. The image tolerance is 0.2% differing pixels,
with a per-pixel colour threshold of 0.2; geometric movement is checked
separately. A Linux CI run is still needed to validate a new baseline on the
CI runner, especially after upgrading Chromium or fonts.

On failure the HTML report contains the failing screenshot and browser
trace. Geometry failures also attach measured boxes/issues as JSON and an
image with affected controls outlined in magenta. Screenshot failures show
expected, actual and diff images. CI retains `playwright-report/` and
`test-results/` in the `frontend-test-evidence` artifact alongside the suite
logs. Each local Playwright invocation replaces its previous report.

For an intentional visual change, inspect the failure and then run:

```sh
npm run test:visual:update
npm run test:visual
```

Review the changed PNGs together with the CSS/component change before
committing them. Never update references simply to make a failure green.
Normal runs cannot create missing references; CI refuses the update flag.

To extend coverage, add panel selectors, viewports or state envelopes in
`e2e/layout-fixtures.ts`. Reuse `measureLayout`, `layoutChanges` and
`assertLayout` from `e2e/layout-audit.ts` for other bounded panels or dialogs.
Mock-state projects are chained and use one worker; do not run several of
them together with `--no-deps`, which would bypass that ordering.

This is a regression detector with explicit coverage, not an automatic
usability judgement. It does not certify every viewport, browser, dialog,
translation, occluding overlay or real touchscreen. Operator guidance and
whether a workflow is understandable still need human review.

## Live TWP setup

Use **6 Axis TWP XYZABC**, the 45-degree gantry installed by the suite.
The active corpus is `scripts/parity_corpus/twp_gantry.json`: its programs use
G54 `X-100 Y140 Z-725` and tool T1 with a 200 mm Z length. Keep that tool fixture
in the simulator's table. `--prepare-sim` does not rewrite tool geometry or
clear saved work offsets. The old 55-degree corpus and recordings remain
unchanged for offline regression tests; they are not the new live baseline.

Start a single LinuxCNC session using `lcnc_suite_sim_6axis_twp_xyzabc.ini`. Its `DISPLAY`,
`WEBUI_MACHINE_DIR`, remap/subroutine paths, `PATH_APPEND`, `TOPLEVEL` and
TWP helper command must reference the checkout under test. Restart after
changing these paths: editing an INI does not update an already running
gateway. The runner refuses a different running INI, wrong simulator geometry,
an old gateway checkout, or a busy interpreter. It never starts or stops
LinuxCNC itself. Never launch a second LinuxCNC session over an existing one.

The simulator must be ON and homed. Add `--prepare-sim` to the live command to
reset E-stop, enable and home it explicitly. The runner supplies an armed
WebSocket client, heartbeats and simulated tool-change confirmations for the
duration of the run. Its token comes from the INI and is not written to the
report. There is no automatic reconnect or safety-trip acknowledgement.
At completion it aborts any remaining test motion and disarms its client.
These tests exercise motion, homing, offsets and abort paths; use a dedicated
simulator setup, not a workpiece setup you need to retain.

Tests execute sequentially and stop at the first failed gate. Skips inside
the existing button matrix remain visible in the gate log and report. Actual
M600 tool measurement stays manual, and the standard fixture cannot exercise
the three above-Z-zero moves; a passed gate does not certify those rows.
For a focused rerun, repeat `--gate NAME` with names such as `live-parity` or
`twp_touchoff_check`. These reports say `scope: partial` and list omitted gates;
they are not a substitute for the full acceptance record.

## Evidence and scope

Each invocation creates a new `runlogs/test-suite/<timestamp>-<mode>/` directory
(or a new `--out-dir`). `report.json` records the commit, tracked changes,
hashes of modified/untracked files, runner hash, INI hash, commands, exit codes,
timings and log locations. A live run copies its corpus programs into that
directory and saves fresh payload,
truth and replay files under `parity/`. Existing output directories are refused.
Reports are local artifacts; retain or attach them when accepting a change.

The committed reference corpus in `scripts/parity_corpus/runs/` is never
overwritten by this runner. Its 11 recorded runs drive
`lcnc-webui/src/viewer/simReplay.corpus.test.ts`, which replays the actual client
code against recorded controller trajectories in CI. That covers the client
chain; fresh live parity additionally exercises parser output, the running
gateway's cache freshness and new controller trajectories. Plane invariants
independently compare the observed plane with programmed intent.

Thresholds are in `scripts/parity_corpus/twp_gantry.json`. In particular, the
G68.3 path comparison retains its existing 1.5 tolerance for the known initial
rotary-seed excursion; other path cases use 0.5. Passing that gate does not
close the existing seed-freshness follow-up. The gantry uses separate preview goldens because its geometry, datum and tool
length differ. Historical recordings and goldens remain unchanged.

Do not regenerate preview goldens merely to turn a failed comparison green.
The live runner only checks them. Performance measurements (`perf_matrix.py`
and browser worker/camera latency), operator walkthroughs, real hardware and
actual touchscreen acceptance remain separate gates with their own evidence.

## Current example acceptance

The three installed profiles are listed in
[`examples/sim_config/profiles.json`](../examples/sim_config/profiles.json).
The 2026-09-19 gantry run passed all nine live gates, including 11 trajectory
comparisons and 10 independent plane checks. Its report is
`runlogs/example-migration-20260919/acceptance/live-gantry/report.json`.
Three-axis homing/motion and the complete new five-axis identity/TCP demo
also passed; offsets and tool tables were restored and all sessions stopped.
See the 2026-09-19 entry in [decisions.md](decisions.md) for evidence paths
and remaining limitations. The new five-axis example currently supports TCP,
not TWP; the live TWP gates target the six-axis gantry.
