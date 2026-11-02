# Testabdeckung — Bestandsaufnahme 2. November 2026

Lesende Durchsicht von development @ 4ad87515 (ein Agent, ohne Testlauf). Selbst nachgeprüft: kein Spec klickt einen Antast-Button; alle Browser-Projekte laufen in Chromium; renumber_tool (Schema `new_number`, Client `old_tool_number`). Der Rest ist die Lesart der Durchsicht.

Read-only analysis of /home/cnc/lcnc-suite-dev (development @ 4ad87515). I ran nothing.

**The two defects you named are fixed on branch `fix/probe-vars` (769760ce), not on development.** That branch adds `src/probeVarFiles.test.ts` (every var number the WebUI writes is declared in each example `sim.var`). It also adds a `layout.spec` probe-grid cell-size guard, which runs in Chromium imitating Firefox. Everything below assumes that branch is merged.

## Coverage map
(a) clicked in the browser, result checked · (b) only drawn / layout / contrast · (c) unit logic only · (d) manual live check · (e) none

- **Program:** (a) Load, editor session, upload conflicts, Start/Step/Resume holds, Run from line (`editor-guards`, `run-hold`). Unload, re-parse, optional stop, block delete: (e), 0 specs name them.
- **MDI:** (a) `input-session`.
- **Probing procedures:** (b) only: `tabs`, `forms` (field units), the contrast sweeps. **No spec clicks a probe cell**; searching `O<` across e2e finds only macro, sim and layout texts. Simulate trip and surface-map apply/method: (e).
- **Toolsetter, G30:** (a) `toolsetter-setup` (`T5 M600` with vars), `g30`.
- **Offsets:** (a) `touchoff`, `offsets`, `input-session`.
- **Tools:** (a) read, import, add, delete. Edit existing tool (`save_tool`), Renumber, Load (`tool_change`): (e).
- **Macros:** (a) `macros`, `run-hold`; a real macro file only (d) `macro_live_check.py`.
- **Sim:** (a) `sim-panel.viewer`, `collisions.viewer`.
- **Strip:**
  - Safety (a).
  - Jog (a) single axis; diagonals (b) — only their closure before homing is checked, `jog_*_multi` is never asserted.
  - Setup (a) touch-off and homing. → Zero / → Home / → G30: (b) — placed and explained, but no spec checks what they send.
  - Overrides (b).
  - Spindle: Fwd and Stop (a) (`disarmed.spec:236/352`); Rev and ± (e); coolant (c).
- **Dialogs:** (a) for the shared rules (`dialogs.spec`: 23 dialogs, focus, Escape = `estop`, backdrop); what each dialog contains is mostly (b).
- **Settings:**
  - Keyboard and save status (a) `keyboard-guards`; 3D Viewer (a) `viewer.spec`; Display (a) `contrast`; HAL (a) `frames`.
  - Gamepad wizard (b), with a stubbed pad; Machine and Debug (b), the `forms` scan only.
- **3D viewer:** (a), well covered (drawn material colours, pixel-measured line widths, camera framing, collision views). Chromium's software renderer only; the ToolPreview canvas is masked.
- **Banners / messages:** (a) `feedback-channels`, `messages`.
- **Input:** Keyboard (a); touch (a) only as Chromium-emulated touch events; gamepad (c) `useGamepad.test`; camera (e).

## Gaps by class, most consequential first

**1. The mock gateway accepts what the real one refuses.** `mock-gateway.mjs:272` answers every command with a status frame. It runs none of the real checks: no `check_command`, no `validate_payload` (declared vars, the 255-character MDI limit, clamps) and no handler refusals. Its hello has no `conn_key`, so no spec has ever sent `X-Conn-Key`; every protected HTTP write is a hand-written `page.route`. The auth token is the same: no test checks the client sends it, and the mock ignores it. Every REST reply (`/files`, `/gcode`, `/upload`, `/macro`, `/import-tool-library`) is also written by hand in each spec, and nothing checks it against the gateway's real reply.
- **`renumber_tool`:** the schema bounds `tool_number` and `new_number` (`command_policy.py:1151`). The UI sends `old_tool_number` and `tool_number` (`ToolTablePanel.vue:316`), and the handler reads `old_tool_number` (`gateway.py:5255`). The `new_number` bound never applies, and the old number is never range-checked.
- **Overrides:** sent as slider/100 (`App.vue:1081`), and the gateway clamps silently. A ×100 slip would just show up as maximum override.
- **Handlers with no pytest at all:** `clear_wcs` (the TWP "all" = G54–G58 rule and the reserved-row refusal, `gateway.py:5926`), the `twp_capture` handler (its policy function is unit-tested, and `twp_capture_check.py` runs it live), `get_comp_grid`, `get_probe_results`, `get_wcs_table`, flood and mist, `set_block_delete`, `set_optional_stop`, `set_rapid_override`, `set_spindle_override`.
- **Mock start-up permissions:** they open `twpCapture` and `surfaceComp` on a 3-axis identity machine, which the real gateway cannot produce.
- **Guards:**
  - The mock writes its recorded commands to a file; a pytest replays each through `validate_payload` with limits from each example INI and var file. This would have caught defect 2 and the renumber mismatch.
  - A cross-source test like `viteProxyCoverage.test.ts`: every `COMMAND_SCHEMA` field exists on that command's type in `lcnc.ts`.
  - An e2e: drag Feed to 50 %, assert `{scale: 0.5}` is sent.

**2. Shipped data vs code.** I checked by hand that all 42 subroutine names the UI calls resolve to files today. But `test_example_install.py:75-79` only checks that each `SUBROUTINE_PATH` entry is a directory. (The `_ini[axis_*]` reads are `EXISTS`-guarded, so fine.) Guards:
- Take the names from `ProbePanel.vue` and `App.vue` and assert each `<name>.ngc` is found on every profile's path.
- Assert each `#30xx` in `probeVars.ts` is read by at least one bundled routine.

**3. Browser engines.** Every Playwright project is Chromium (`playwright.config.ts:45-129`), and CI installs only Chromium (`ci.yml:34`). The launcher opens the system default browser via `xdg-open` (`lcnc-suite:663`); on the machine PC that is presumably Debian's Firefox ESR. Guard: a `firefox` project running `smoke`, `tabs`, `dialogs`, the grid-size test and `visual.spec` with its own references.

**4. Drawn content inside controls.** No test references `CornerGlyph.vue`, `StatsDonut.vue` or the 155 inline SVG elements in `ProbePanel.vue`. `SetupIcon` appears only in the Chromium Setup screenshots. The only glyph-content test is `glyphMarkup.test.ts`, which covers the ScrubBar and SimPanel marks. Guards:
- A per-procedure Probing screenshot in `visual.spec`.
- An ink check: each `.gridCell svg` covers at least 60 % of its cell and draws a minimum number of non-background pixels.

**5. Operator flows done only by hand.**
- **Real probe run:** `twp_buttons_check.py:14` judges only the gate.
- **M600:** `docs/testing.md:383` says "stays manual"; `toolsetter_readback_check.py` loads `T1 M600` but never runs it.
- **Also manual:** the macro run, the tool-change confirmation with real iocontrol, and surface-map scan/apply.
- **Guard:** a `probe_live_check.py` like `macro_live_check.py`. The sim's `sim_toolsetter` already trips the probe at a physical plate, so it can probably run `probe_z_minus_wco` over that plate with `probeVarMap` and assert the reply is ok and G54 Z changed.

**6. Hardware-only paths.**
- **Touch:** whether the panel's browser reports `pointerType "touch"` (which `touchDetect.ts` uses to switch to touch sizes and the strip keyboard) is unknown.
- **Gamepad:** a static stub only.
- **Camera:** not covered.
- **Real HAL latch:** fakes only; validated live once (issue #34).
- **Guards:** a hardware checklist; trace the first `pointerType` and the gamepad mapping.

On the positive side: all 49 status fields the UI reads are named in `status_runtime.py` or `gateway.py`. No test enforces it, but there is no drift today.
