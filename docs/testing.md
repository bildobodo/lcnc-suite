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
scale factor 1, light colour scheme, fixed locale/timezone, reduced motion
and bundled DejaVu Sans regular/bold fonts (license in `e2e/fonts/LICENSE.txt`).
The fonts are injected only in visual tests, not shipped to operators.
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
