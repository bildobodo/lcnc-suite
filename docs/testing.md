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
| `lcnc-gateway/.venv/bin/python scripts/home_step_live_check.py /path/lcnc_suite_sim_<profile>.ini [--group]` | Home / Unhome per axis, the step jog, the MDI line's and the program path's byte limits (package 3a); `--group` the home-group fixture (`<profile>_group.ini`: the installed copy with every HOME_SEQUENCE -1). The target is proven before anything acts (`test_support/live_target.py`, Codex R367 VM-I13): the running INI, a shipped simulator's copy or exactly its group fixture, WEBUI_PORT named (no default), EVERY listener row on it identified (an unnamed one refuses — Codex R368) as the gateway serving that INI | Yes, simulator only |

## The native stage (Codex R282–R285; build step 1)

Cases on the VM's REAL LinuxCNC, run by hand, never beside a gate:
`scripts/native_run.py` takes the ONE heavy lock (`scripts/test_support/heavy_lock.py`, also held by
`round_gate.py`, `perf_matrix.py`, the install probe and `repro-load.sh` — a shell script through the module's
command line, never a bare `flock`: from the LAN stop the return is OWED and only the run's final restore,
its unit's ExecStopPost, settles it; an unreadable marker keeps everyone out), records and stops the LAN sim, builds a run tree
of the tested commit and a confined copy of the profile, checks it before the start, runs the cases and
gives the LAN sim back (`restore_lan.py`, also the unit's ExecStopPost). It runs only as the user unit
`native-run` — the command is in its docstring. Offline guards: `scripts/test_native_stage.py` (the
backend gate's `native-stage` step). Step 2a adds Z probing, M600 with the override lock and the M6 hold;
every routine runs under the M6 helper `test_support/tool_change.py` (nothing confirmed unless declared).
A native evidence in `functions.json` (layer `native`) is "named"
statically; a PASS comes only from a run report of the same commit, profile, case and variant
(`functions.native_status`).
Step 3 (Codex R313–R316) adds the heartbeat chain and the motion controller's period to the servo
stream (`servo_time.py`: time only on the checked `rtapi_app` hash), a client that goes away
(`disconnect-*`, a helper client in its own process, `proto_client.py`), 4 and 8 clients fetching the
preview (`clients-*`) and the HAL latch as the LAST step (`latch-*`, the gateway stopped through
`trip.py`, every stop continued by `restore_lan.continue_stopped`). The delayed latch order is a run
of its own: `native_run.py … --variant latch-delayed` (its rows carry the variant).
Package 3b: a run's verdict (and the install probe's, the same `verdict`) is FAIL when its `logs/crash.log`
or a rotation holds an error-level record or a line that is no classifiable record — no JSON object, no
tag the crash filter admits, no known level (Codex R370 VM-I15; each field's type first, R371) — or when
the check itself raised (the report is still written) — (`native_run.run_crashes`, read after
the restore — the processes' last words included): the instance-ended chain's BrokenPipeError sat in the
crash.log of 28 of the 82 kept run folders (2026-11-06 to 3a) while every report said PASS.

## Round gate and merge gate (test strategy, Codex R248–R260)

An implementation round runs the **round gate**: only the checks its change
needs, chosen from a named base, with the proof of what ran. A merge runs the
**full** offline gate on the integrated state: `round_gate.py --merge` (every
heavy unit file, the backend and the whole browser run, whatever the change
selects; the record says `kind: "merge"` and keeps the round's selection
beside it) or `test_suite.py offline`. A round whose change happens to select
the full browser run is NO merge gate — its heavy unit files may be left out
(Codex R279 FI-I17). A full run already made on the identical state is
reused. Live checks (`live-twp`, `twp_buttons_check.py`, the macro and
toolsetter read-backs, `perf_matrix.py`, the probe live check) stay owed before
main and stand as `pending` in the record.

**The install probe** (package I, operator 2026-11-07, Codex R329) is part of
every merge gate (`round_gate.py --merge`, check `install-probe`): a fresh
clone of HEAD in its own run folder, `install.sh --yes --no-root` with a NEW
environment (HOME, caches, logs, pycache, tmp — all in the run; nothing
inherited), the installed result (links, venv, build, the catalog's profiles,
config sync, no tracked file changed, the native stage's target and
confinement checks), then the installed 3-axis profile started through the
installed launcher in production: the process proof, the safety chain proven
POSITIVELY (the probe's own unarmed client past the gateway's 15 s grace — no
banner, reader fresh, no trip — the trace's `hal.admitted` and
`reader.connected` admitted for this gateway, `webui-hb-latch.fault-out`
FALSE and `oneshot.0.out` TRUE by halcmd) and a browser starting the built UI
against that gateway (`scripts/install_probe_browser.mjs`: mounted, its own
WebSocket took the instance's state, every script and worker served as
JavaScript). It takes the VM's LinuxCNC like the native stage and returns it
with the restore's proof; the isolation also records the operator's home
links BY TARGET. It runs AFTER the gate's heavy section, in its own run
folder with its own id and the gate's commit, and holds the heavy lock
itself (Codex R330–R331); from the LAN stop to the confirmed return the
return is OWED (`heavy_lock.owe` — a marker beside the lock that only the
run's own restore may pass, so a gate already waiting never comes between a
killed probe and its ExecStopPost restore; the native stage shares it). The
gate's wait is bounded (every systemctl call, an unread state, the
deadline) and an interrupt stops the probe and awaits its end. Not shown: the realtime components' installation (compiled
only), a new machine's apt/nodesource path, the bootstrap from GitHub.
Standalone (an evidence run): the command in `scripts/install_probe.py`'s
docstring; `--abort-at installer|start` are its two abort probes.

```
lcnc-gateway/.venv/bin/python3 scripts/test_select/round_gate.py \
    --base <the package's last accepted commit> --out docs/reviews/<topic>.gate-round.json
lcnc-gateway/.venv/bin/python3 scripts/test_select/round_gate.py --merge \
    --base <the development commit merged into> --out <a NEW path per run>
```

`--out` names a fresh record per run: the backend's evidence folder is never
replaced (`test_suite.py` refuses an existing one — a second run on the same
path failed its backend for that alone, 2026-11-05). A merge gate's `--out` also places the install probe's run folder
(`<out>.logs/install-probe-<12 hex>`), whose `home/.rtapi_fifo` is LinuxCNC's
realtime socket: 107 bytes at most (`sun_path`), or `rtapi_app` never starts. The
gate refuses a too-long `--out` at its start (`install_cases.run_dir_problem`;
2026-11-11 one inside a worktree reached 108 and the probe failed after the
heavy hour) — keep it short and outside the worktree, e.g.
`~/claude-work/<topic>/merge-gate.json`, and copy the record into `docs/reviews/`.

**The Python lint** (issue #36, Codex R349/R350) is the backend gate's FIRST
step, `ruff`: `python -m ruff check --no-cache` at the root, its files, rules and
target in `ruff.toml` (the same as a local `ruff check` there). ruff comes pinned
from `lcnc-gateway/requirements-test.txt` into the venv — never fetched at gate
time; a missing ruff fails the step. Rules: pyflakes (`F`) and bugbear (`B`)
minus five measured as noise here (B905, B023, B904, B008, B007 — not covered);
the TWP remap fork and its TOPLEVEL entry carry named per-file exceptions. A
rule that would need many `noqa` lines is deselected, not suppressed.

**The Python type check** (package 2, plan vor-maschine R352/R353) is the
backend gate's SECOND step, `pyright`: `scripts/run_pyright.py` runs the pyright
pinned in `lcnc-webui/package.json` (npm, lockfile — never fetched; missing =
FAIL with its reason) with the root `pyrightconfig.json`, mode `standard` and
`strict` for the pure modules (command_policy, settings_store, session_bind,
lcnc_paths, lcnc_trace), and the running Python's import paths. What it checks
and what it does not — the gateway's product modules (`gateway.py` included since 2b),
`writer_fixture.py`, compensation.py, the LinuxCNC stubs `typings/*.pyi`, the
interface `lcnc_iface.py` that the stub and the tests' fake are each held
against (`typings/conformance/`, the call forms in `check_forms.py`), and the
named exclusions — is `typings/BOUNDARY.md`. The REAL modules are checked
against every stub claim — names, members, constant values
(`lcnc_iface_check.py`): on surrogates in every job, on the VM in
`test_lcnc_iface.py`, in the install probe (row `install-binding`); only a job
that declares `LCNC_NO_BINDING=1` (the CI backend job) skips the native run,
by name.

The tree must be clean. In order, never two at once: the selector's own
guards (`scripts/test_select/test_selector.py` — red guards end the gate before
anything is left out), the selection, lint, build, the light unit set (every
unit file but the eight heavy collision files, `--allowOnly=false`), the heavy
files the change reaches, the backend offline gate when a backend path changed,
the browser run. The browser run needs port 4173 and the mock slots
`4500 … 4500 + N − 1` free, starts its own servers (`playwright.gate.config.ts`
for FULL, `playwright.select.config.ts` for a selection: the one project
narrowed to the selected files) and forbids `.only`. Every listed test must
have run exactly once (`proof.check_executed`; units `check_unit_executed`, a
test passed only after a retry fails), each on one worker against that
worker's own mock (`proof.check_workers`, from the fixture's event log of
THIS run — the gate gives the run its own id, which every event and the
report's `config.metadata.run` carry, and starts a fresh log: every mock bound
once on its slot's port and endpoint and stopped by the same worker; every
result of the report exactly one start/end pair with its retry, on the worker
and slot the report names, on the mock that worker bound, inside its life; no
pair without a result; a worker's tests one after another; on a slot the
mocks follow each other; order by the log's lines, never its clock — Codex
R263 PM263-02). The record names every check run and left out with its
reason, and the unit's CPU time and peak memory.

**The browser run in parallel** (per-worker mock, Codex R261–R263): ONE
project `e2e` on N workers (`LCNC_E2E_WORKERS`, default 3), `fullyParallel:
false` (a file's tests in order on one worker). Every worker starts its OWN
mock gateway on its slot (`TEST_PARALLEL_INDEX`, port 4500 + slot;
`e2e/mockSlot.mjs`, `e2e/mockFixture.ts`): ready only at its own child's
`MOCK-BOUND` line, an owner registry per run and slot, a busy port waited for
only while the run's own predecessor on that slot leaves (5 s), a foreign
process never used or stopped. Before every test the fixture `mockBaseline`
(`e2e/test.ts`) confirms the baseline — no app socket of the test before,
`reset`, the WHOLE snapshot equal to the mock's first and a fresh app
client's connect frames, read off the wire, equal to its first (a key a test
added at the status' top level once survived the reset unseen, R263
PM263-01) — and closes every context
the test left open. A spec imports `test` from `./test`, never from
`@playwright/test`; file hooks (`beforeAll`/`afterAll`) and
`describe.parallel`/`configure` are refused. `scripts/test_select/
proof_harness.py` proves the isolation (two workers at once, a shared mock
seen as the counter-proof, file after file, a crashed worker's replacement,
the delayed handoff in and past its bound, a foreign server).

**A test reads after a signal, never after a fixed wait.** Parallel workers
load the machine: the first parallel full runs (2026-11-03) found seven load
races in six tests, every one a read whose precondition a fixed wait or a
stale match only assumed — a list's "complete" mark matched the list BEFORE
the new one (`filled` in `sim-panel.viewer.spec.ts` waits for the new list's
last frame), a view read 400 ms into its 300 ms turn (`viewerSettle.ts`:
`topViewStands`, `framesDrawn`), the run's position sent once after a poll
that waits up to 500 ms between reads, against a 400 ms timer (now at the
gateway's cadence). A HOLD test runs on the test's clock (`page.clock`):
installed before the page loads, paused a second ahead while the cancelling
event lands, `runFor(HOLD_MS)` with the finger still down (a release before
the hold time is a tap and ends any hold — a test that releases first proves
nothing), then the release and a 300 ms window for what a fired hold sent.
To reproduce a load race: the tests `--repeat-each` on three workers beside
CPU burners (one `while 1: pass` per spare core) — red before the fix, green
after it under the same load.

**The selector** (`scripts/test_select/selector.py`, `rules.py`): every
changed path gets a decision. A rule owns a path (a spec group, FULL, backend,
live checks, or "no product code"); a path no rule owns selects the full
frontend and backend runs. Every module under `src` carries the UI sweep
(layout, contrast, visual, dialogs) and must hold the selection of every
component it renders through (`graph.py`, three named cuts: App.vue, defaults,
workers). A changed spec or unit file runs itself; an e2e helper selects the
specs that reach it (transitively, `E2EGraph`); a data file selects the files
whose declared reads cover it (`READ_SITES`: every read call in the heavy files,
the e2e files and node-side src modules, found by the TypeScript parser in
`readscan.mjs`). `vitest list --changed` adds the heavy files a change reaches.

**When a guard is red after a change:** a new source file needs its rule in
`rules.py`; a new disk read in a heavy test or an e2e file needs its
`READ_SITES` entry (or the read is refused); a module newly imported by
another area's component needs that area in its rule (the graph guard names
it). `scripts/test_select/mutations.py` proves the guards red first (run it
alone, never beside another run in the tree).

Measured: a scripts-only round ≈ 3 min, one spec ≈ 5 min, a component round
≈ 25 min (the UI sweep alone is ≈ 20 min), a FULL round ≈ 60 min.

The live parity loads every corpus program through the gateway's own
`load_file`, as the operator loads (since review R15 B2 a bare
`program_open` is a `STAT.file` flip the gateway ignores — the payload
never settled). `load_file` takes only files inside the INI's
`[DISPLAY] PROGRAM_PREFIX`, so the runner copies the corpus to
`<PROGRAM_PREFIX>/.lcnc-live-gate/` (replaced per run; the file browser
hides dot folders), and `sim_parity.py gate` needs `LCNC_WS_TOKEN` (the
runner sets it) for its short armed loader, which disarms before it
closes.

The existing `lcnc-gateway/run-tests.sh` also uses pytest discovery, including
new test files automatically. The offline suite excludes `test_viewer_init.py`,
which starts a separate gateway. NumPy is required for vectorized checks;
real-rs274 oracle tests explicitly skip when LinuxCNC Python modules are absent.
GitHub CI runs this same offline entry point separately for backend/frontend.
Backend gates also run `scripts/test_5axis_xyzac.py`: closed meshes, guide
coverage, 8,000 poses against the compiled LinuxCNC C oracle and demo limits.
A C compiler and Git LFS assets are required. Installer tests cover fresh
installs, upgrades, state preservation and retirement outside the chooser.

## Function inventory (Codex R265–R269)

Every operator function, complete with respect to the named sources: the
atoms the sources declare, each claimed by ONE function, with its statements
and their evidence. The operator's table is `docs/inventory/funktionen.md`
(rendered, never edited by hand).

- **Web atoms** — `lcnc-webui/src/inventory/webAtoms.ts` (pure; templates via
  `controlScan` with `all` and the acting components — a `ChoiceGroup` instance is
  the control at its place —, the catalogs, `KeyboardAction` / `GamepadAction` /
  `WsCommand` / the settings types through the TypeScript checker, the worker's
  frames, global listeners, the routines the UI names) →
  `scripts/inventory/atoms.web.json`; `webAtoms.test.ts` (light unit, every
  round) holds the file and a counter-case per adapter.
  Regenerate: `INVENTORY_WRITE=1 npx vitest run src/inventory/webAtoms.test.ts`.
- **Gateway atoms** — `scripts/inventory/py_atoms.py` (`ast` only, no gateway
  import: HTTP routes, the INI read registry, the launcher, the settings
  sections, the status message, the routines it starts, the example remaps
  and profiles) → `scripts/inventory/atoms.py.json`.
  Regenerate: `python3 -I scripts/inventory/py_atoms.py --write`.
- **Functions** — `scripts/inventory/functions.json` by hand: an exact atom id
  or a pattern with its pinned count (`control:NumberKeypadStrip.vue|*=24`); a
  new atom inside a pattern changes the count and fails. Re-render the table:
  `python3 -I scripts/inventory/functions.py --write`.
- **The guard** — `scripts/inventory/test_inventory.py` (backend, offline
  suite): the gateway atoms current, every atom owned once, every component
  with controls placed, the table current, no source site `unresolved`. Three
  classes stay apart: `unresolved` (incomplete, with a reason or without),
  `excluded` (outside the declared boundary, bound to file, form and
  expression), `variantsOpen` (a family whose members are not derived).
  The table has a view by place; every statement names its scope (`applies`:
  Machine / TCP / Plane, a profile id, `alle` or `offen`); a parametric test
  title lists its `instances`; every routine and remap is bound to its shipped
  file in the example profiles (`functions.routine_problems`).
- **Test-only modules** — `controlScan.ts`, `controlInventory.ts` and the
  inventory's adapters have a unit-only rule; `test_selector.py` walks the
  runtime imports from `main.ts`, `App.vue` and every worker a reached module
  starts, with no cut (`graph.reached_from`), and fails if a file of the
  rule's own globs (`rules.TEST_ONLY_GLOBS`) is reached. The graph's edge
  pattern is proven against TypeScript's parser per file
  (`scripts/test_select/importscan.mjs`, `graph.pattern_disagreements`): a
  missed edge or a refused form (`require()`, a computed `import()`) fails.
  The graph reads every source type the build compiles (`graph.SOURCE_EXT` =
  `tsconfig.app.json` include), a guard holds the two lists equal.

Evidence is bound statically in this step (the named file holds the title);
whether it ran and passed comes from the run artifacts with the measurement
(step 5, Replay).

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

## Guard specs

The guard specs ran one file at a time in their own serial project while the
mock gateway was shared; since the per-worker mock they run in the one
project like every spec, each worker against its own mock.

| Spec | Pins |
| --- | --- |
| `keyboard-guards.spec.ts` | Escape sends exactly `estop` (never `estop_reset`) from the keypad, the editor, every dialog and during a key capture; Space/Enter/Backspace send nothing behind a dialog, the keypad or the editor; pause/resume via Space unchanged; a jog key released after a field opened mid-jog still sends `jog_stop`; the modal registry matches the DOM's `.dialogOverlay` count (self-test); the KeyboardTab edits a copy. Keypad OK: Space is hammered from the confirm until the field holds focus again (busy latch, focus drop, re-enable) — exactly one `touchoff`, never `cycle_start`; Escape in that window sends `estop`; positive control afterwards (the guard is a transition, not a latch). A focused key acts as itself (UI-I10): real Tab to Cancel + Enter cancels without a touch-off, Space on a focused digit appends once, Enter on a focused OK confirms once, Enter on the root still confirms; text keys act on Enter/Space, a focused Close closes. An explicit close by keyboard (round 4, UI-I10 rest): Enter/Space on the keyboard's X, Enter on a search field's Done and the editor's X leave the OWNER focused (MDI line, search field, `.cm-content`), the modal guard released once focus landed, and the next Space TYPES — never `cycle_start`, never `mdi` (the MDI line sends on keydown). Tool editor (UX-02): the header X closes an unchanged form at once, asks "Discard changes?" on an edited one, Keep editing keeps the values, Discard closes; registry self-test covers the ask. Settings save status (UX-08): a keyboard-binding change shows "Saving…", the mock's correlated ok reply (by `req_id` from `lastCmds`) "Saved", an ok:false reply "Save failed — <section>: <reason>", a foreign reply moves nothing; the ledger cases (round 5, UI-I12): a refused keyboard save stays in the header behind the display's ok until the keyboard's own retry succeeds, and the ok for an older revision never reads "Saved" while a newer change of the section is still in the debounce (the status is sampled until the second request is out). The page-hide path (round 6): with a change in the debounce, a simulated hidden/visible cycle sends ONE `sendBeacon` to `/settings/keyboard` (routed), the status reads "Sent on page hide — not yet confirmed", a `settings_changed` blob with a DIFFERENT keyboard state reads "not on the server", the blob carrying the beaconed data reads "Saved", and no WS save follows the cleared debounce. Round 7: a first beacon that never arrived + a complete blob WITHOUT the section, and a refused (409) beacon + the blob with the STORED value, both read "Save failed — keyboard: page-hide save not on the server …" (no WS save; the header keeps the hint readable). Settings close guard (UI-K16): a changed macro draft asks "Discard changes?" on X, backdrop and a header switch (a registered modal of its own); Keep editing keeps it, Discard performs the navigation; an untouched new macro closes at once. Dimmed controls explain themselves (UX-09): the disabled MDI line carries the reason as its title and a real tap (`click({ force: true })` = pointerdown on a disabled control) puts it in the message center; a toggle whose OWN gate closed with a reason is a focusable `role=button` label — Enter and Space explain, Space never reaches Cycle Start. Help (UX-11): the Setup `Help: Go to positions` popover opens by click and by Space/Enter on the focused button, no machine command. Its geometry (round 5, UI-I13; touch): at 1280 × 900, 900 × 1200 and 900 × 1200 at 150 % CSS zoom the popover lies wholly inside the viewport on its first opening, its text fits without an inner scroll and reads in body typography (no uppercase, weight < 600). The taps are dispatched at MEASURED coordinates once the icon has held still for 300 ms (`tapSteady`): Playwright's own scroll-into-view under CSS zoom re-scrolled the strip between the two taps of one case in a loaded gate run (712 → 1171 px), the UA's light dismiss closed the popover on the first touch beside the trigger and the retried tap re-opened it. The open popover stays inside the viewport through 900 × 700 → 1280 × 700 → 900 × 1200 and re-opens inside it. |
| `feature-switches.spec.ts` | The switchable suite functions (settings split package 3): a first start with probing, surface map, toolsetter and macros off never paints their tabs or the macro bar (a MutationObserver from the first render — red on a stale "all on" and on an unread compensation); switched at run time the tab and the bar go and come back; the tab in use stays with its note until left; Probing shows the procedures of the functions on and goes with the last; surface map off with an observed compensation keeps its state and its OFF, nothing of the scan; toolsetter off takes its procedure, Measure Current and the M600 mode, Unload stays; camera off takes the toggle, the picture and the overlay settings; Settings › Features saves the section, Gamepad leaves the settings; the pad's commands carry `via`, off it is not read, on again a held button acts only after a release. |
| `simulation-off.viewer.spec.ts` | The simulation per device (settings split package 2): a device whose simulation is off (the mock's first settings say so) runs no check — `getSimulationWork` all false after the path and the tool mark are in, after a new parse and an offset change —, has no timeline and no Sim tab, keeps the code panel's tool-change mark and shows the run's line from the program's track (motion_line names 7, the projection says 6); switched off during a check the worker ends, the timeline, the Sim tab, the collision marks and the tint go, the tool mark stays; on again a fresh check finds the collision; a shown Sim tab gives way to Program. |
| `devices.spec.ts` | Settings › Devices (settings split, R335–R337): this device's simulation switch saves without arm into its own profile on the section's revision (`base_rev`) and shows checked once the mock echoes; another device's switch and rename are closed disarmed, armed its switch goes into THAT profile on the list's revision (`device`), a connected device's delete stays closed with its reason, an offline one's delete sends `device_delete` naming it; a tab bound to no device says why and blocks a device save (the header's "Not saved — … device not bound yet" is the signal, nothing sent); this device's name saves without arm (`device_rename`). The mock is ONE bound device with the simulation ON (the fixture default, `withDevice` in mock-gateway.mjs). |
| `dialogs.spec.ts` | The dialog contract (design wave D2, plan Anhang B), one table row per dialog (23): `role="dialog"` named by its title, the tier, the action order (the cancel side left), the initial focus Anhang B names, Tab AND Shift+Tab only inside the topmost dialog, its own helper, the safety strip and the banner's Abort / Acknowledge (backwards first — the initial focus sits early, so the walk wraps to the safety strip within a few stops even in Settings), Escape = exactly `estop` with the dialog still open, the backdrop by kind (info/confirm close, forms and flows stay), the focus back on the control that opened it, nothing sent by closing, and the registry self-test before and after. UI-D01: from Settings, from a stacked "Discard changes?" and with the text keyboard open on a Settings field, Tab reaches the banner's Abort and Enter sends exactly `abort`; after the run ends Tab stays in scope and Space sends nothing. UI-D06: a tool-change dialog opening over the tool editor's keypad pauses it — an unapplied expression and the empty entry come back exact after > 600 ms (two visibility polls), the field is unreachable by Tab and by pointer meanwhile, a draft filed by an outside tap stays as it is, only Discard ends it, nothing is applied. Review round 1/2: a HIT TEST on every row and every Tab stop (a pointer at the focused element lands in the focused dialog); UI-DI01 (a flow stays the operating position with Settings / Messages opened in either order), UI-DI02 (a lower dialog closing leaves focus in the top), UI-DI04 (after a disarm the fallback lands on the dialog container, never body), and Run from line's initial focus at two heights. |
| `tabs.spec.ts` | The one tab navigation (design wave D3): tablist/tab/tabpanel, one Tab stop per list, arrows move focus without selecting, Enter/Space select, Left/Right wrap, Home/End, Up/Down a row in Probing's 4 × 2 grid; with keyboard jog on and the navigation keys bound to jog, a focused tab sends nothing (control: the same key on an unfocused page jogs; mutation-checked — without the list's preventDefault 16 jog commands); a tab switch sends nothing, a running jog stops; a modified navigation key (Ctrl / Alt / Meta / Shift × the six keys) on a main tab, a Probing tab or a Settings section sends nothing and moves no focus (round 4, UI-DI06 — Ctrl+ArrowRight used to jog; control: the bare key on an unfocused page jogs); a Probing procedure switch (grid and narrow select) stops a running jog before the keyup and sends nothing without one (UI-DI11); a hidden panel refuses focus; the Run-from-line spindle preset is one radio group Rev · Stop · Fwd; the narrow side pane (150 % portrait) shows two selects on one row and returns to the lists with the same selection. |
| `forms.spec.ts` | Controls and forms (design wave D4), at the DR viewports: on the strip, every side-pane tab, every Probing procedure, the G-code Reference, the tool editor, the import preview, the macro parameters and every Settings section, every visible field has an accessible name and every visible `<label>` labels a control; fields and md buttons are `--control-h` tall in the side pane and dialogs (32 px desktop, 44 px touch), at least compact in the strip and in tables; a probe field's unit is its description and its keypad readout and follows the machine's linear unit (mm → in); a label tap opens the field; a count refuses 2.5; a reset sits at the end of its section and its confirm keeps its button's gate (setup / probe, not the looser safety / ready); the tool table's row actions look alike and name their target, both binding tables read Action | binding, the gamepad inverts only the machine's stick axes. |
| `touch-surface.spec.ts` | The touch surface (operator, real machine 2026-09-26): a touch `contextmenu` (Chromium's end of a long press) is refused on a hold button, a dimmed control's wrapper, a plain button, a slider, the view cube and a label, allowed in a text field; a mouse right click on a desktop session is left alone; no tap highlight on any surface; icon-only header pills are centred and as tall as the text pills; a help icon's invisible target is 24 px (a press 11 px from its centre hits it) and its glyph never makes a form label row taller than its text. |
| `appearance.spec.ts` | Design wave D8: the state banner keeps opacity 1 through a pulse (the background moves, the words never fade); under prefers-reduced-motion the banner (idle and E-Stop), the E-Stop button and the probing dot have no animation and the fill still carries the state; under forced colours the focus ring is ≥ 2 px, the selected tab differs from the others and the banner is outlined. |
| `contrast.spec.ts` | Design wave D8a: every visible text meets 4.5 : 1 against what is RENDERED behind it — its colour through the ancestors' opacity over the translucent layers down to the first opaque one; a floating card (HUD, hint, help) over the page AND over `--fg`; disabled controls exempt; measured once no transition runs. Five passes (light, dark, hc-light, hc-dark, auto under a dark system) over the page at rest, Program with a selected line, Run from line, the editor, the file list, every tab (Tools with the loaded tool), an open help card, every Settings section, the G-code reference, the hint, the status notes, running, a preview re-parse, a safety trip and E-Stop. Per pass the focus ring: ≥ 2 px, `--focus-ring`, ≥ 3 : 1 on bg, panel and button. |
| `run-hold.spec.ts` | Starting motion is a hold (design wave D6): Start, Step and Resume fire on a complete hold only (a tap sends nothing and says "Hold to activate"), Pause stays a tap; Start with a selected line opens the Run-from-line dialog on a tap and its action is a hold (the line in `auto_run`); a macro without parameters runs on a hold, a command saved by another client during the hold cancels it and the next hold runs the new command once; a macro with parameters opens on a tap, Enter moves field → field → Execute and never executes, a value changed during the Execute hold cancels it; the macro bar dims with `probe`. Round 4: a new revision of the SAME program (`viewer_gcode_ready`, the text served late per `v=`) cancels a Start, Step or Resume hold at its arrival — hint, no command — and after the text lands a complete hold sends once; while the text loads Start waits (UI-DI05); Run from line: a revision mid-hold runs nothing, a changed text closes the dialog and clears the selection, the next run carries the NEW entry (`entry_x` 20); another program clears a line selection. The Run-from-line preset and Settings' default preset never uncheck each other — both opening orders, Settings on another section, all three values: checked = model = sent `spindle_dir` (UI-DI07). The parameter dialog follows its macro: a new command and name, a new parameter (entered value kept, the new default shown) and the macro's removal, each saved by `settings_changed` during the Execute hold, cancel it; the next hold runs exactly the visible command once; removed, Execute is disabled and says so (UI-DI08; the local-setter path is `useMacros.test.ts`). |
| `editor-guards.spec.ts` | The edit session is bound to its file: external program changes keep buffer A and raise the conflict banner, Save writes A only, a delayed save never reloads B from A, the CodeMirror import is bound to the session, an older save reply never touches a newer session, dirty Discard asks; upload name conflict → Cancel / Rename / Replace. |
| `touch-hold.spec.ts` | Hold-to-fire under real touch events (CDP `Input.dispatchTouchEvent`, `hasTouch`): tap → nothing + "Hold to activate", complete hold → exactly one command, slide-off / touchCancel / hidden page → cancelled, a new hold starts from zero; the teleported tool dialog is usable by touch (scroll, keypad, confirm, footer). The tool dialog's Cancel after an edit meets the discard ask, answered by touch. Every cancel says so at the control (UX-12): the slide-off hint "Hold to activate — stay on the button", a gate closed under the finger "Unavailable — <reason>" (no command), and the hold button's default title. |
| `input-session.spec.ts` | The unified input session (WP8): one layout per target, drafts per owner (also across number → text → number), outside tap / Tab out of the field or out of a key hides both helpers without confirming, focus returns to the field after OK/Cancel, text entry with REAL touch taps (`hasTouch`), page switches within the strip budget. Keys are pressed with real pointer input (`click`/`tap`), never `dispatchEvent`, so a covered key fails. Portrait 900 × 1200: the whole keyboard within the viewport at 100 % AND at 150 % (CSS `zoom` on the root = 600 × 800 CSS px) — what makes 150 % fit is the sticky Safety section folding its status detail while a helper is open — only there: at 100 % it stays (operator 2026-10-29) (a four-row compact form was measured too: it misses by 11 px whenever the header wraps one line more, which its pill texts decide at 600 px) — plus the MDI line (the readout), the banner and the safety buttons `toBeInViewport()` at both zooms (the portrait viewer floor is column-relative, `min(500px, 45%)`). A failure names the space budget (header, banner, safety, strip top). Also: `''` is a draft ("= 0 draft"), a neighbour's OK (busy latch) is not an owner end, a gate end drops the owner's drafts (fields and offset cells), and a real backend revocation INSIDE the latch ends them too (two status frames 50 ms apart — the status store applies frames per animation frame, so a close and re-open inside one frame is no state). Editor and search as owners (round 3): the first code line, Save/Discard and the search field are judged by `elementFromPoint` at their centre (a viewport rectangle misses clipping by an ancestor), ≥ 3 editor lines visible at 150 % (measured 7.2), and portrait edit mode folds the idle program controls (Start/Upload/progress gone while editing, back after Discard). Physical typing into the MDI line (round 4, UI-I11): `page.keyboard.type` with the helper open and after closing it, Enter sends exactly one `mdi` with the whole line, focus returns to the line through the busy latch, ArrowDown recalls the history entry, on-screen keys append. Field contract (UX-13): every visible non-readonly `input.inputField` in the MDI tab, the Tools tab, the reference dialog and Settings › Machine carries `autocomplete=off`, `autocorrect=off`, `autocapitalize=off`, `spellcheck=false`, a `name` and an accessible name (≥ 4 fields, or the scan is vacuous). Number keypad X (UX-01): by tap and by Tab + Enter it hides and keeps the draft (comes back marked), focus lands on the field and the next Space is the field's own opener; Discard drops the draft. UX-13 result: the MDI placeholder is "MDI command (↑↓ history)" and no scanned text field has the word "code" in its placeholder (Apple Passwords reads it as a verification-code field). Design wave D7 (touch, after a neutral first tap — the first touch re-lays the strip out under the finger): the close X is the top-right key, 44 × 44, of the number keypad and the text keyboard (Code and ABC) in landscape 1280 × 800 and portrait 900 × 1200 — no control above or right of it; the Code page's digit block 7 8 9 / 4 5 6 / 1 2 3 / 0 . - in both orientations, the letters in one reading order, ABC a–z row by row; the number keypad at 100 % and 150 % portrait with a strip owner and a side-pane owner: keys ≥ 43 × zoom, the keypad in the viewport, the owner field in view and hit at its centre, plus the first and last field on six axes. |
| `safety-during-edit.spec.ts` | The safety buttons while an input helper is open (operator 2026-10-28/29). Landscape 1280 × 800, 1920 × 1080 and 2560 × 1440: Safety at the strip's start and its section and buttons unmoved with the text keyboard, the keypad of a strip field and the keypad of a side-pane field; the keyboard and the side-pane keypad start where Jog starts, the strip field's owner section takes that place and its keypad follows it. A REAL press (mouse in landscape, touch tap in landscape and portrait) on Disarm, E-Stop and Power with each helper open sends `arm {armed: false}`, `estop`, `machine_on`/`off`; a 700 ms mouse hold on Setup's Home / Unhome X with the keypad on a Setup field sends it (landscape and portrait — the owner section must not move under the press). Portrait (touch) 900 × 1200: the machine info stays (8 status rows + the codes) with each helper at 100 %, the helper whole in the viewport without a strip scroll, the safety buttons unmoved; at 150 % it folds for the keyboard and the strip keypad and stays for the side-pane keypad (it fits), the helper still whole; back at 100 % it returns. 26 of the 35 cases were red at 729a7f4a (`docs/reviews/safety-during-edit.browser-red.txt`; the portrait safety taps passed there — portrait never moved Safety). Codex R224: a 3 s press on G55 and on Setup's help lands unmoved; two fingers (CDP touch) in both orders — one finger's release leaves the other's press and target in place; a cancelled touch and a right-button release end the press (controls); a 100 ms press at 150 % with the strip scrolled sideways keeps scrollLeft and the target (6 red at 3c24fbea, `docs/reviews/safety-during-edit.r224.browser-red.txt`). Codex R225: a touch opens MDI while the mouse holds G55 — G55 unmoved until the release, the release on G55 and nothing else hit, then the keyboard (red at 5cdf20e0). Codex R226: the queued keyboard kept or closed again under the held mouse at 150 % with the strip scrolled — G55 and the scroll unchanged until the release, then the wanted helper or the normal strip, no place left (closed again red at 61a9253f). Leftovers: a first touch that holds Home X stays on it and fires, the touch sizes apply after its release (red at 1d987b25). |

Every case sets its own preconditions (its status envelope; the fixture has
reset the worker's mock and confirmed the baseline before it); a spec must pass
alone AND inside the full `npm run test:e2e`.

## Frame / strip states (layout gate)

`layout.spec.ts` also guards the side pane's patterns in the four DR states
(desktop, touch landscape, touch portrait, 150 % portrait): the navigation
budget (tabs or the narrow selects, no clipped name, the probing content
holds its form rows — measured on the real FormField), and the tab pattern
(design wave D5, N80): every tab with Abort has exactly one, at its action
group's right edge with nothing interactive to its right, and a tab's head
rows keep the order object line → machine actions → management. And the
viewer's overlays (design wave D9): with 5 and 6 axes, every HUD warning
line up and a preview re-parse, in the four viewports at 100 % and portrait
at 150 %, the DRO card, the findings card, the ViewCube and its quick grid
lie inside the viewer and apart, and the DRO card reports `data-hud-fit=
"fits"` (landscape from 150 % is the named WP-DR limit, not swept). Since
review round 6 with a PROGRAM loaded (a preview with sequence data: the
scrub bar is up and swept too), at HUD scales md and xl, every axis row
shown, a folded findings card naming its warnings, and the chosen form
holding still for 2 s (20 samples — the fit once swung between two sizes).
Since review rounds 7 and 8 also the scrub bar's INSIDES, the simulation
banner and the OPENED detail views: a program without findings, one with a
limit violation, and one with the limit plus two collisions
(`__viewerDiag.setCollisionHits` — the layout mock's model has no moving
pairs), portrait at 100 % and 150 %, idle and simulating, folded and then
in BOTH opening orders (More then the warnings, the warnings then More),
every close by a real click: the timeline >= 120 px, no row wider than the
bar, every rendered control, readout and "?" scrolled into view and
hit-tested at its centre, every button's words whole, the folded toggle
counting the findings, one detail view at a time, an opened view leaving
the DRO's form; after every step the bottom column and the warnings card
inside the VIEWER, both toggles' centres inside it, the simulation banner
geometrically apart from both cards (it ignores the pointer — a hit test
passes through it) and every line of an opened warnings card in view once
scrolled to; simulating, the banner whole, the DRO still `fits` with every
axis row. At 150 % the test requires both toggles to be offered (the case
under test exists). Since round 9 the same geometry with the DRO card OFF
(Settings → Layers → HUD): switched off at the desktop and then resized to
portrait 150 %, and off from the first settings after connecting — the
narrow flag as the pane says, the short banner's "?" reachable, the cap =
the viewer below the banner, the column check, through simulation on/off,
More opened and a zoom change with More open; the HUD back on as the
counter-check.
Every viewer scroller (the warnings body, the findings row) scrolls only
past a CUT line — sideways never — and an uncut warnings body the operator
has not opened lets the pointer through; a "?" in the warnings card (the
off-datum chip, alone and first of several; desktop, portrait 100/150 %)
answers over its whole `--help-hit` area. A "?"'s invisible hit area once
made the body scroll 6 px sideways and take the pointer (operator's live
look 2026-09-27) — beyond the audit's 4 px sliver window.

`setup-layout.spec.ts` pins the Setup arrangement by axis count (operator
2026-10-29/30, Codex R233/R234) on the visible layer: 14 configs (1, 2, 3,
4 XYZA / XYZC, 5 XYZBC / TCP, 6, 6 TWP, 7, 8, 9, synthetic 7 / 9 TWP) × 1280
landscape, touch, touch at 150 %, portrait, touch portrait and touch portrait at 150 % ×
ready, dimmed and mixed homing: no control outside, clipped or overlapping
(`measureLayout`), no landscape label on two lines, every action exactly
once, the axis columns and each action group's buttons per row as LITERAL
expected values (Codex's matrix), the actions under the last column /
beside / under every axis per form, the WCS title on the SETUP line with G54
level with the first axis row (landscape) or above two rows G54–G58 /
G59–G59.3 (portrait). Tab walks the axis rows, the actions in order, then
the WCS; every control can be brought out from under the pinned Safety
section and takes the hit at 150 %; a long frame chip ("MACHINE · off datum",
TWP "… · datum moved", from real status) changes neither the section's size
nor a fixture's place, the chip whole and on one line; a finger held on G55 (CDP touch) while the chip turns long and short again — G55 unmoved, still under the finger, chosen once on release (Codex R235 SL-01: touch portrait at 100 %; it found Jog's plane note shifting Setup in landscape too); every strip title's "?" centred on its line within 0.5 px (desktop, touch, portrait); a new axis set re-lays the section out. 82 of 90 red
at 5fb6c761 (`docs/reviews/setup-layout.browser-red.txt`; the 8 reach cases
hold there too); the R235 additions 4 of 15 red at 9303cf6e (`docs/reviews/setup-layout.r236.browser-red.txt`). The rule itself: `setupLayout.test.ts` (literal results
for 0–9 axes, TWP, portrait, the six-row budget).

`layout.spec.ts` measures the FRAME — the strip, the viewer
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
drives a bed/column fixture far larger than its travel box
through `window.__viewerDiag` (getCamera / getPartBounds / setView /
setViewDirection / switchProjection) and asserts the eye is outside every
part at the default frame, in all 26 ViewCube directions, after every
preset, in both projections and at Reset's endpoint — plus a negative
control (the old travel-box distance from diagonally below lands inside the
bed). Unit tests: `cameraFraming.test.ts`.

## Viewer palette (design wave D8c)

The viewer's colours are roles per theme (`--viewer-*`, style.css) resolved
by ONE function (`viewer/viewerPalette.ts`): Automatic = the theme's tokens,
Custom = the operator's seven colours over them (limit, selection and
collision stay the theme's). `themeTokens.test.ts` checks the palette
directly: every line role ≥ 3 : 1 on the theme's background (≥ 4.5 in HC)
AND on the lit machine (a table top renders ≈ #e0e0e0 in every theme), the
six path roles ≥ 0.12 apart in OKLab. `viewerSection.test.ts` pins the
migration (UI-D05: no stored section → Automatic, any stored palette →
Custom unchanged, custom colours survive Automatic ↔ Custom, the merge is a
fixed point for save / reload and a second client). `viewer.spec.ts`
reads the colours off the DRAWN materials (each tagged with
its role, `__viewerDiag.getPalette`): Automatic follows a theme switch — the
collision tint on screen included (`__viewerDiag.tintPart`) — a legacy
palette from another client is Custom and stays through a switch, Settings
switches Automatic ↔ Custom and keeps the custom colours stored, the legend
shows the drawn colours with the rapid dashed. `scenes.viewer.spec.ts`
renders a model with a dense and a thin path, limit
overflow, the driven path and the selected line in the four themes and
asserts the structure: the drawn roles and the WIDE selection (a
LineSegments2 >= 3 px carrying the line's segments, visible); it attaches
the eight images to the report (and to `SCENE_OUT=<dir>`) for the review by
eye. WebGL scenes are NOT
screenshot references (they differ between the VM and CI; the tool dialog
masks its canvas for the same reason) — a palette change is reviewed on
rendered scenes by eye and guarded by the material colours.

The scrub bar (operator 2026-10-29, `sim-panel.viewer.spec.ts`): the speed select right after Play holds the Sim tab's value; no progress band over the track and no coverage once the check is done; the link shows the Sim tab; the timeline bar holds 3 : 1 against the 92 % card composed over the page and over geometry, and against its thumb, in light, dark, hc-light and hc-dark, in and out of the simulation, never dimmed; a 2 min, 6 h and 30 h program at 150 % portrait keeps the timeline ≥ 120 px with the elapsed time whole; a portrait viewer (touch 900 × 1200) takes two rows: Sim, Play, the speed and the link above, the timeline, the coverage and the time below. `collisions.viewer.spec.ts` reads a stopped provisional check's coverage as "75 %" in the bar with the title "provisional from L7, stopped at 75 %", and the C2 states: "30 %" running, "40 %" with a glyph in the warn role when paused, empty at the end.

Viewer contrast (plan `docs/reviews/viewer-kontrast.plan.md`): `themeTokens.test.ts` checks the pair table (`viewer/palettePairs.ts`) in every theme block — colour-separated pairs under normal, protan, deutan and tritan simulation, every pair under normal vision, a cue for each pair without colour separation — and the selection's core-or-halo rule. `scenes.viewer.spec.ts` "the width ladder" measures the IMAGE: a top view onto a lit table with a program line, a line flagged outside the limits and the backplot, four themes at DPR 1 and 2; the drawn width across each line is the sum of each device pixel's coverage by the role colour against the local background (feed and limit ≈ 1, backplot 2 × DPR; a missing line reads 0), every role line opaque, then the selection's profile over the table: core in the middle, halo 2.5 CSS px either side — also after a resize. The HUD layer is off there (the scene is measured, not the DRO card). Red: a backplot in world units (0 px), a halo as narrow as the core (the sides read the table).

The code panel's findings (`layout.spec`, V3): a program with violations and collision hits — a glyph and a name per line (▲ "Limit violation", × "Collision", × "Limit violation, collision"), none on a clean line, the code at one x. The tilted work plane (`layout.spec`, V4, TWP profile): five live states and a simulated plane beside a live machine claiming staleness, with the HUD visible (four themes, a scene per state attached for the eye), folded (portrait 150 %) and off — the label on the object, role, dashed edge, arrow and HUD word from one decision, the edge opaque, the mode line saying each part once; red with the old HUD word ("plane stale" beside "head moved") and with the old mode line ("TWP · G54 · G54"). The non-text pass (`contrast.spec`, V5, five themes): card edges on the scene, switch edges/knobs, button glyphs and slider thumbs from rendered pixels; red on the pre-V5 styles (card edges 1.37, switch off 1.3–1.4, knob on the dark blue 2.4–2.5). The palette's origin (`viewerSection.test.ts` and `viewer.spec`, V6): stored without a mode → "legacy", kept through a save and reload and a layer toggle, the Settings note and its one-tap switch to Automatic (colours kept, the choice marked "operator"); a mode without an origin → the offer only; an operator's choice → quiet; red without V6 (no note).

The promise is exactly that: the DEFAULT frame starts outside the model.
Dolly, pan, later machine motion and the linear Reset tween between two
poses are not covered — this is not a camera-collision system, and
`polygonOffset` was left as it is.

## Browser layout regression checks

Layout checks run automatically in `npm run test:e2e` and therefore in the
offline frontend suite and pull-request CI. They use each worker's own mock
gateway (port 4500 + its slot), not a running LinuxCNC session or the
development server on 5173. Build first: these tests serve `dist/`, not the
working Vue sources. With ONE shared mock, `viewer.spec.ts` beside
`scenes.viewer.spec.ts` (review round 6) failed the clean-rebuild spec in every
full `playwright test` — the other spec's program and axes reached its renderer
— so the serial projects ran their files on one worker; with a mock per worker
that broadcast is gone, and the leak probe was repeated beside the heavy viewer
specs before the switch (per-worker mock R263). `src/playwrightProjects.test.ts`
pins the one project. The offline gate's single `playwright test` is the
arbiter — a per-file loop is no substitute.

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

The narrow side pane's CONTENT budget (implementation review round 4,
UI-DI09 / DI10) is its own case, at 900×1200 touch, 150 % and 100 % CSS
zoom: Program with a 40-line program shows at least three whole code
lines and Abort hit-testable inside the pane; at 150 % the management and
the run options are hidden behind "More program actions"
(`aria-expanded`), unfolded every one of them is hit-testable (scrolled
into view inside the pane) and the code keeps its three lines; at 100 %
there is no toggle. Tools with three real tools: the table header is no
taller than a tool row, the description keeps 7 em and is not covered at
its centre, a whole row shows at first sight, the pinned row actions
touch (nothing between them) and their header cells are opaque, the tab
never scrolls sideways or as a whole, the row actions and the head's
actions are reachable. Proven red at 150 % on the round-3 build (0 code
lines).

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

## Collision sweep tests on real payloads

A test that sweeps a native payload (`toolChangePayloads.test.ts`) must hand
the sweep the track the way the page does (`ThreeViewer.vue`'s `trackCopy`):
the scrub track keeps its per-point WCS epochs as `wcsEpoch`, the sweep reads
them as `wcs`. A `ScrubTrack` passed straight to `sweepCollisions` has no
`wcs`, and every segment is posed in the first epoch's frame — a move under a
later `G10 L2 R45` is swept unrotated (found 2026-10-08; Codex R94's probe had
the same blind spot). Pass `{ ...track, wcs: track.wcsEpoch }` with the
`epochTerms` from `epochTermsFor`, and keep an obstacle on the rotated path
as the control that goes red without them.

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
