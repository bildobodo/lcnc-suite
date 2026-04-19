# LCNC Suite — Project Context

## Architecture

```
lcnc-webui/src/     Vue 3 + TypeScript frontend (Vite dev server, port 5173)
lcnc-gateway/       Python FastAPI + WebSocket backend (uvicorn, port 8000)
subroutines/        G-code subroutines shipped with the project
  probe_basic/      62 probing .ngc files (bundled from kcjengr/probe_basic, GPL v3)
  tool_length_probe/ bundled from TooTall18T's tool length probe (GPL v3)
  surfacemap/       bundled from mhubig/surfacemap_usertab (GPL v3)
```

Gateway connects to LinuxCNC via Python bindings (`linuxcnc.stat`, `linuxcnc.command`, `linuxcnc.error_channel`). WebUI connects to gateway via WebSocket at `/ws`.

## Frontend Structure (lcnc-webui/src/)

- `App.vue` — Root component, sidebar + multi-panel tab layout, state management
- `TabPanel.vue` — Reusable tab-panel (props: tabs, modelValue; uses v-show)
- `ThreeViewer.vue` — Three.js 3D viewer (Z-up, OrbitControls, ResizeObserver)
- `Toolbar.vue` — View preset buttons and layer toggles
- `DroPanel.vue` — Position/DRO display with work/machine coordinate toggle
- `JogPanel.vue` — Jog grid + speed slider
- `JogButton.vue` — Press-and-hold jog button with pointer capture
- `GcodePanel.vue` — G-code viewer with syntax highlighting, inline editor, program controls, run-from-line
- `GcodeReferenceDialog.vue` — Searchable G/M-code reference dialog
- `ProbePanel.vue` — Probe operations grid, calls `O<probe_*> CALL` via MDI
- `ToolTablePanel.vue` — Tool table with load/delete dialogs, STL upload, 2D preview
- `ToolPreview.vue` — Small orthographic Three.js canvas for tool side-view preview
- `toolGeometry.ts` — Shared tool geometry utilities (vertex colors, fallback cylinder)
- `toolTypes.ts` — Shared TOOL_TYPE_LABELS map (18 types) + toolTypeLabel() function
- `format.ts` — Shared formatters (fmtCoord, fmtNum, fmtCell, fmtOffset, fmtRpm, fmtElapsed, fmtDuration, fmtDist, fmtSize)
- `gcodeHighlight.ts` — G-code syntax tokenizer + highlighter (shared by GcodePanel + MDI history)
- `OffsetPanel.vue` — WCS offset table editor (G54–G59.3), inline cell editing, auxiliary rows (G92, Tool, Comp)
- `CameraPip.vue` — Picture-in-picture camera overlay with MJPEG feed, SVG crosshair/circle/grid overlay
- `SettingsPanel.vue` — Sub-tabbed settings (3D Viewer | Machine | Display | Macros | Gamepad | Keyboard | HAL | Debug)
- `Gate.vue` — Permission gate wrapper: `<fieldset :disabled="!allow">` with `#exempt` slot
- `permissions.ts` — Permission evaluation (evaluatePermissions + provide/inject)
- `machineControls.ts` — Machine controls catalog: BUTTON_TYPES + INPUT_DEFS (single source of truth for permissions + styling)
- `MachineBtn.vue` — Catalog-aware button (wraps Btn.vue, looks up gate/variant/size from BUTTON_TYPES)
- `MachineInput.vue`, `MachineToggle.vue`, `MachineSlider.vue`, `MachineSelect.vue`, `MachineRadio.vue`, `MachineColor.vue` — Catalog-aware form controls (look up permission from INPUT_DEFS)
- `Btn.vue` — Internal button component (never used directly in templates — wrapped by MachineBtn)
- `lcncWs.ts` — WebSocket client, heartbeat, server-authoritative armed state
- `lcncApi.ts` — REST helpers for file listing and upload
- `lcnc.ts` — LinuxCNC constants (TASK_MODE_*, INTERP_*, SPINDLE_*) and WsCommand union type
- `defaults.ts` — Server-synced settings with section registry pattern (no localStorage)
- `main.ts` — Vue app entry point with settings migration
- `style.css` — Global styles, theme vars, design tokens
- `SafetyStrip.vue` — Bottom strip: Arm/Disarm, E-Stop, Machine On/Off, status display (in #exempt slot)
- `JogStrip.vue` — Bottom strip: jog wheel, speed slider, step increments
- `SetupStrip.vue` — Bottom strip: DRO display, axis touchoff, homing grid, WCS selector
- `OverridesStrip.vue` — Bottom strip: Feed/Spindle/Rapid override sliders
- `SpindleStrip.vue` — Bottom strip: FWD/REV/STOP, RPM input, actual speed, coolant toggles
- `ToolStrip.vue` — Bottom strip: Tool # input, Measure/Manual/Load/Abort, probe status
- `ToolsetterSettings.vue` — Toolsetter configuration panel (used in SettingsPanel Machine sub-tab)
- `GamepadLiveInput.vue` — Gamepad input visualization (SettingsPanel Gamepad sub-tab)
- `DebugTab.vue` — Debug/diagnostics tab (SettingsPanel Debug sub-tab)
- `gcodeReference.ts` — G/M-code reference data + lookup map
- `interpolation.ts` — IDW interpolation for probe surface maps
- `toolsetterVars.ts` — Toolsetter variable mapping utilities
- `dragScroll.ts` — Drag-to-scroll handler for touch/mouse on `.scroll-thin` containers
- `edgeWorker.ts` — Web Worker for Three.js edge geometry computation
- `useGamepad.ts` — Gamepad polling composable (analog sticks + buttons)
- `useJogPointers.ts` — Jogging pointer event management composable

### Main Tabs

`Program | MDI | Probing | Offsets | Tools`

### Bottom Action Strip

Horizontally scrollable strip with six components (wrapped in `<Gate gate="armed">`):

1. **SafetyStrip** — Arm/Disarm, E-Stop, Machine On/Off, status display (in `#exempt` slot — always accessible)
2. **JogStrip** — Jog wheel, speed slider, step increments, world/joint mode
3. **SetupStrip** — DRO display, axis touchoff, homing grid, WCS selector
4. **OverridesStrip** — Feed/Spindle/Rapid override sliders
5. **SpindleStrip** — FWD/REV/STOP, RPM input, actual speed, coolant toggles
6. **ToolStrip** — Tool # input, Measure/Manual/Load/Abort buttons, probe status, tool context (T# D# Z#)

## Safety System — Three Layers

### Safety Layers

1. **Disconnect handler** — armed client disconnects → immediate `jog_stop` + `abort`
2. **Heartbeat watchdog** — client heartbeat timeout (3s) → auto-disarm + abort
3. **HAL watchdog** — retriggerable `oneshot` (0.5s, self-healing) + `trip-latch` (operator-cleared) in a three-stage AND chain → latched ESTOP

HAL heartbeat runs in an independent asyncio task (`_heartbeat_loop`), decoupled from status processing. Two concurrent paths per client: command path (always responsive) and status path (can be slow without affecting safety). Additional: server-authoritative arming, backend `require_armed()`, `fire()` 200ms anti-spam, auto-stop jogs on focus loss.

**Trip latching.** `oneshot.0.out` self-heals when heartbeats resume, but `webui-safety.trip-latch` falls FALSE on every `oneshot.0.out` falling edge and stays FALSE until the operator clicks E-Stop Reset — so brief gateway stalls become real latched ESTOPs instead of silent auto-recovery. Edge detection runs inside `hal_watchdog.py` (independent userspace process, 100 ms select loop), so trips survive gateway freezes. The gateway polls `webui-safety.trip-count` via `webui-monitor`, sets an `_unacked_trip` dict, and broadcasts it as `status_msg.safety_trip` so the frontend shows the safety state in the existing `.statusBanner` (text + Acknowledge button; flash-danger while `safetyTrip` is set). Arm is rejected while `_unacked_trip is not None`. Recovery: E-Stop Reset button sends `{"trip_reset": true}` IPC to `hal_watchdog.py` → `trip-latch` TRUE → 20 ms later `CMD.state(STATE_ESTOP_RESET)` → banner-Acknowledge clears `_unacked_trip` → Arm → Machine On.

Full layer behavior tables, pin semantics, and failure mode coverage in `safety-permissions.md` memory file.

### HAL Monitor Component (`webui-monitor`)

`poll_status()` needs 6 HAL pin values not available through `STAT`. `hal.get_value(name)` acquires a mutex + linear search (~6-8ms each, ~40ms total). The `webui-monitor` HAL component creates input pins and wires them to the source signals, enabling direct pointer reads (<1μs each).

- **Config**: `_HAL_MONITOR_PINS` list in `gateway.py` — add new pins here as `(source_pin, local_name, hal_type)` tuples
- **Init**: `_init_hal_monitor()` called once from `try_connect_lcnc()` — creates component, connects pins via `halcmd net`
- **Read**: `_hal_fast(local_pin, default)` — falls back to default if component unavailable
- **Fallback**: if component creation fails, `poll_status()` falls back to `hal_get()` (original slow path)

## Permission System & Machine Controls Catalog

### Permissions (`permissions.ts`)

Single source of truth for all enable/disable logic. Components never compute their own disable conditions. 14 permission classes organized in 6 tiers:

```
base = armed && !estop && enabled
```

```
TIER 0 — Unconditional
  always ─────────────── true                                         Arm, E-Stop, UI nav

TIER 1 — Client state (no machine state needed)
  armed ──────────────── s.armed                                      Outer content gate

TIER 2 — Machine power (no enabled needed)
  safety ─────────────── armed + !estop                               Machine On/Off
  setup ──────────────── armed + !estop + isIdle + !busy              File ops, tool edits, settings reset

TIER 3 — Machine enabled (base = armed + !estop + enabled)
  abort ──────────────── base                                         Abort, Shutdown
  override ───────────── base + !busy                                 Feed/Spindle/Rapid overrides
  pause ──────────────── base + isRunning + !isPaused                 Pause
  resume ─────────────── base + isPaused                              Resume
  step ───────────────── base + ((isIdle+!busy+isHomed) OR isPaused)  Single-step

TIER 4 — Machine idle (requires base + isIdle)
  idle ───────────────── base + isIdle + !busy                        Banner home, mode select
  jog ────────────────── base + isIdle + isHomed                      Jog buttons, speed slider
  zero ───────────────── base + isIdle + !busy + !eoffset             Home, Unhome

TIER 5 — Full ready (requires everything)
  ready ──────────────── base + isIdle + !busy + isHomed              MDI, Cycle Start, Spindle, Coolant
  probe ──────────────── base + isIdle + !busy + isHomed + !eoffset   Probe ops, tool change, touch-off, WCS edit, macros
```

**State transition map — when gates open:**
```
Disconnected      → always
Armed             → + armed
E-Stop Cleared    → + safety, setup (if idle)
Machine On        → + abort, override, idle, zero, jog (TIER 3+4)
Homed             → + ready, probe, step (TIER 5)
Running           → abort, override, pause, step remain; idle/ready/jog close
Paused            → abort, override, resume, step remain; pause closes
```

**LinuxCNC enforces very little** — mode sequence (MDI needs MODE_MDI) and state transitions only. Our gates enforce: armed state (web-safety invention), idle-vs-running checks, homing requirements, and eoffset contamination prevention. The `set_mode()` + `reject_if_auto_running()` functions in gateway.py are the real backend gatekeepers.

### Machine Controls Catalog (`machineControls.ts`)

Central catalog of every interactive element type — inspired by QtPyVCP's predefined widget types. Each entry defines its permission gate, variant, and size. Components look up their type from the catalog; developers never specify permissions or styling inline.

- **`BUTTON_TYPES`** — 55+ button types (start, abort, probe, close, tab, dialogConfirm, etc.)
- **`INPUT_DEFS`** — 34+ input types (jogSpeed, mdiText, touchoff, feedOverride, etc.)

Machine action types use permission gates (`ready`, `idle`, `probe`, etc.). UI-only types use `gate: 'always'` — they don't gate themselves but are still covered by the outer Gate fieldset.

### Catalog Components (Machine*)

All interactive elements use catalog-aware wrapper components. **Never use `<Btn>` directly in templates** — it's an internal component wrapped by MachineBtn.

| Component | Wraps | Catalog |
|-----------|-------|---------|
| `MachineBtn.vue` | `Btn.vue` | `BUTTON_TYPES` — looks up gate, variant, size, icon, muted, inline |
| `MachineInput.vue` | `<input>` | `INPUT_DEFS` — looks up permission from gate prop |
| `MachineToggle.vue` | toggle input | `INPUT_DEFS` |
| `MachineSlider.vue` | range input | `INPUT_DEFS` |
| `MachineSelect.vue` | `<select>` | `INPUT_DEFS` |
| `MachineRadio.vue` | radio input | `INPUT_DEFS` |
| `MachineColor.vue` | color input | `INPUT_DEFS` |

### Gating Architecture — Default-Deny (IEC 62443 / ARINC 661)

Four layers enforce permissions:

1. **Outer Gate** — `<Gate gate="armed">` wraps content area, macro bar, and bottom strip. When disarmed, everything is disabled by browser `<fieldset disabled>` cascade. Uses `armed` (not `safety`) so navigation works during E-Stop.
2. **Inner Gates** — Section-level Gates with tighter permissions: `<Gate gate="override">` (OverridesStrip), `<Gate gate="ready">` (SpindleStrip), `<Gate gate="idle">` (OffsetPanel), `<Gate gate="setup">` (ToolTable/Gcode/Settings dialogs), `<Gate gate="safety">` (SafetyStrip Machine On/Off).
3. **Catalog self-gating** — Each `MachineBtn`/`MachineInput` checks its own permission class for visual dimming + HTML disabled.
4. **Backend `require_armed()`** — Every motion command in gateway.py checks armed before executing (defense-in-depth). Additionally, `fire()` in App.vue takes a gate parameter and re-checks permissions before sending.

**DOM layout**: Bottom strip's `#exempt` slot holds SafetyStrip (Arm/E-Stop always accessible even when disarmed).

### Usage — Gate.vue (primary pattern)
```vue
<!-- Wrap a section; fieldset :disabled propagates to all children -->
<Gate gate="ready">
  <MachineBtn type="start" @click="run">Start</MachineBtn>
  <MachineInput gate="mdiText" v-model="mdi" />
</Gate>
```

### Usage — MachineBtn (catalog-driven)
```vue
<!-- Gate + variant + size + icon all come from catalog -->
<MachineBtn type="close" @click="dismiss">×</MachineBtn>
<MachineBtn type="dialogConfirm" @click="save">Save</MachineBtn>
<MachineBtn type="tab" :selected="active === 'dro'" @click="active = 'dro'">DRO</MachineBtn>
```

### When individual `:disabled` is still correct
```vue
<!-- JogButton: internal JS guard needs its own :disabled prop -->
<JogButton :disabled="!can.jog" ... />
<!-- Tighter permission than parent Gate -->
<Gate gate="idle">
  <MachineBtn type="mdi" :disabled="!can.ready">Needs ready inside idle Gate</MachineBtn>
</Gate>
```

## Layout Architecture

- Content area: viewerPane (left, 3D viewer always visible) + sidePane (right, tabbed content panels)
- Bottom action strip: horizontally scrollable row of strip components (SafetyStrip in `#exempt` slot)
- Macro bar: optional row of user-configurable macro buttons
- Each content panel independently selects tabs via TabPanel component
- Shared state: coordMode, jogVel, mdiText, armed, busy
- Responsive: landscape (side-by-side panels) and portrait (stacked panels)

## Key Patterns

- **No hardcoded visual styles** — never invent custom font-size, padding, border-radius, colors, opacity, or font-family for new elements. Always inherit from the nearest parent class or global base styles in `style.css`. New CSS should only override layout properties (flex, width, text-align). If a visual style doesn't exist, extend the existing class hierarchy or global base — never create one-off overrides. For color semantics: machine active states use `--ok` (green), form controls (toggles, radios, checkboxes) use `--info` (blue), danger/abort uses `--danger`, warnings use `--warn`.
- **Spacing tokens** — use `--gap-micro` (2px, ultra-tight), `--gap-tight` (4px, grouped toggles), `--gap-controls` (8px, button rows/form fields), `--gap-section` (12px, between sections), `--gap-panel` (20px, major divisions) for all layout gaps. Never hardcode gap/margin values for spacing between elements. Padding inside buttons/inputs is visual and stays hardcoded. Minimum gap between any clickable elements: `--gap-tight` (4px).
- **Opacity tokens** — `--opacity-subtle` (0.3, separators), `--opacity-disabled` (0.4), `--opacity-muted` (0.6, secondary text), `--opacity-secondary` (0.8, dialog body, syntax comments). Never hardcode opacity values (exception: animation keyframes).
- **Syntax highlight tokens** — `--syntax-mcode`, `--syntax-coord`, `--syntax-param`, `--syntax-comment` in `:root`. Token classes (`.token-gcode`/`.tok-gcode`, etc.) use these. `.token-gcode` uses `var(--info)`, `.token-text` uses `var(--fg)`.
- **Shared modules** — `format.ts` (9 formatters: fmtCoord, fmtNum, fmtCell, fmtOffset, fmtRpm, fmtElapsed, fmtDuration, fmtDist, fmtSize), `toolTypes.ts` (TOOL_TYPE_LABELS + toolTypeLabel()), `gcodeHighlight.ts` (highlightGcode). Never duplicate formatters or tool type labels in components.
- **Global utility classes** — `.mono` (font-mono), `.emptyState` (centered muted text), `.statusDot` (8px indicator with `.probing`/`.tripped` states), `.sub` (section heading — no margin, parent flex gap handles spacing), `.sep` (horizontal divider). Always use these instead of scoped equivalents. For horizontal dividers, always use `<div class="sep">` — never manual `border-bottom` as section separators.
- `defaults.ts` section registry: `registerSection<T>(name, fallback, migrateFn)` + `loadSection`/`saveSection`. All sections are server-synced. Server is the single source of truth. Gateway sends `settings_init` on every WS connect. `sendBeacon` flushes pending saves on page exit. New sections must be added to `_VALID_SETTINGS_SECTIONS` in `gateway.py` and `SERVER_SECTIONS` in `main.ts`.
- localStorage is used in two intentional places only: (a) `lcncWs.ts` message history — intentionally per-tab so sessions don't cross-talk; (b) `defaults.ts:resetAllDefaults` removes pre-server-sync localStorage keys (migration cleanup — safe to delete ~2027+). Do not introduce additional localStorage usage.
- ViewPreset type is duplicated in ThreeViewer.vue and Toolbar.vue — update both when adding presets
- Camera Z-up: `camera.up.set(0, 0, 1)`, except top view uses `(0, 1, 0)` to avoid gimbal lock
- ThreeViewer uses ResizeObserver (not window resize) to handle v-show tab switching
- **Dialog tiers** — three sizes, two internal structures:
  - `.dialog` (sm, centered confirm): `padding: var(--gap-panel)`, uses `.dialogTitle` + `.dialogBody` + `.dialogActions` directly
  - `.dialog.md` (mid, structured content): `padding: 0`, uses `.dialogHeader` + `.dialogContent` + `.dialogActions`
  - `.dialog.lg` (large panels, 70vw×70vh): `padding: 0`, uses `.dialogHeader` + `.dialogContent` (+ custom footer if needed)
  - `.dialog.lg.dialog-full` = 90% height variant
  - All tiers inherit `font-size: var(--fs-base)` from `.dialog` base — never set font-size on dialog body content
  - Safety dialogs add `.safetyDialog` (z-index 1010) and omit `@click.self` on overlay
- Gateway `tool_change` handler is fire-and-forget (no `CMD.wait_complete()` — blocks heartbeat loop)
- Toolsetter settings live in SettingsPanel (Machine sub-tab), tool actions in sidebar ToolStrip
- **Tool geometry**: Per-tool STL files in `machine/tools/`, loaded via `STLLoader`. Fallback: simple cylinder from diameter + length. Vertex colors split cutter (gold) / shaft (silver) by `flute_length` / `shoulder_length` Z thresholds. STL origin convention: tool tip at (0,0,0), extends in +Z.
- **No `:deep()` visual overrides** — scoped CSS may use `:deep()` for layout properties (flex, width, height, padding) but NEVER for visual properties (background, color, border, box-shadow). Visual overrides bypass Btn.vue's state system. If a button state looks wrong, fix it in Btn.vue.
- **Gate.vue** — renders `<fieldset :disabled="!allow">` with `.fs-reset` styling (chrome-only: no border/padding/margin). Browser-enforced default-deny: disabled propagates to all descendants. The outer Gate (`gate="armed"`) wraps the entire main area. `#exempt` slot reserved for safety section only (Arm, E-Stop). All buttons use MachineBtn catalog types; `<Btn>` is never used directly in templates.

## Pre-Flight Checklist — MANDATORY for every CSS/UI edit

Before writing or modifying ANY CSS or interactive element, verify ALL items:

**Spacing** — `gap`/`row-gap`/`column-gap`/`margin` between siblings MUST use tokens: `--gap-micro` (2px), `--gap-tight` (4px), `--gap-controls` (8px), `--gap-section` (12px), `--gap-panel` (20px). Never hardcode. No double-layer spacing (parent flex gap + child margin-bottom on `.sub` headings, etc.). Grid cell gaps use `--gap-controls` or `--gap-tight` — never `--gap-section` for internal grid spacing.

**Layout** — Use `stack-*` / `row-*` utility classes from `style.css` for flex layout. Never write `display: flex; flex-direction: column; gap: var(--gap-*)` directly in component CSS. Component-scoped CSS should only add non-layout properties (height, overflow, position, flex, min-height). Classes: `stack-panel` (20px), `stack-sections` (12px), `stack-controls` (8px), `stack-tight` (4px), `stack-micro` (2px), `row-controls` (8px), `row-tight` (4px).

**Opacity** — Use tokens: `--opacity-subtle` (0.3), `--opacity-disabled` (0.4), `--opacity-muted` (0.6), `--opacity-secondary` (0.8). Never hardcode opacity values except in animation keyframes.

**Typography** — `font-size` → `--fs-*` tokens. `border-radius` → `--radius-*` tokens. `font-family` → `var(--font-mono)` or `var(--font-sans)`. Never hardcode any of these.

**Colors** — Use semantic CSS variables (`--ok`, `--danger`, `--warn`, `--accent`, `--fg`, `--bg`, etc.) with `color-mix()`. Never raw hex. Hover tiers: `--hl-hover` (12%), `--hl-selected` (15%), `--hl-active` (20%) — no other percentages.

**Permission gates** — Use `MachineBtn`/`MachineInput`/etc. catalog components for all interactive elements — they self-gate from the catalog. Wrap sections in `<Gate :allow="can.X">` for fieldset-level gating. Never use `<Btn>` directly in templates. Individual `:disabled="!can.X"` is only correct for: JogButton props (internal JS guard) and elements with tighter permissions than the parent Gate. Never use `:class="{ inactive: !can.X }"` for permission gating.

**Global patterns** — Form elements inherit from `style.css` base (component CSS only adds layout). Tables → `.dataTable`. Dialogs → `.dialogOverlay` + `.dialog` + `.dialog-full`. Close buttons → `<MachineBtn type="close">`. Empty states → `.emptyState`. Status dots → `.statusDot`. Section headings → `.sub`. Horizontal dividers → `<div class="sep">`. Monospace → `.mono`. Scrollable containers → add `.scroll-thin`. Check existing components before creating new CSS.

**New patterns** — If the needed style doesn't exist globally, STOP and tell the user: "This pattern doesn't exist in our global styles. We should add it to style.css first." Never create one-off scoped styles for reusable patterns.

**Enforcement** — A `PreToolUse` hook (`.claude/hooks/style-check.sh`) fires before every Edit/Write to `.vue`/`.css` files, injecting a reminder. This ensures mid-conversation adherence.

## Toolsetter Var-File Mapping (#3100–#3115)

The `tool_touch_off.ngc` subroutine reads parameters from the LinuxCNC var file so the web UI can configure them:

| Var    | Parameter              | Description                           |
|--------|------------------------|---------------------------------------|
| #3100  | tool_touch_x_coords    | Toolsetter X position (G53)           |
| #3101  | tool_touch_y_coords    | Toolsetter Y position (G53)           |
| #3102  | tool_touch_z_coords    | Toolsetter Z approach height (G53)    |
| #3103  | use_tool_table         | 1 = use tool table for positioning    |
| #3104  | tool_min_dis           | Min distance for known tool re-probe  |
| #3105  | brake_after_M600       | 0=none, 1=M00, 2=M01                 |
| #3106  | go_back_to_start_pos   | 1 = return to start after measurement |
| #3107  | spindle_stop_m         | M-code to stop spindle (5 or 500)     |
| #3108  | disable_pre_pos        | Disable G30 pre-change positioning    |
| #3109  | addreps                | Extra retry count on probe fail       |
| #3110  | lasttry                | 1 = last retry without tool table     |
| #3111  | offset_diameter        | Tool diameter threshold for offset    |
| #3112  | offset_value           | Offset percentage of tool diameter    |
| #3113  | finder_touch_x_coords  | Edge-finder X reference (G53)         |
| #3114  | finder_touch_y_coords  | Edge-finder Y reference (G53)         |
| #3115  | finder_diff_z          | Height diff probe vs reference        |
| #3014  | finder_number          | Probe tool number (shared with probe tab) |

## Build Verification

**ALWAYS run `npm run build` (in `lcnc-webui/`) after any TypeScript/Vue change.** This uses `vue-tsc -b` which is stricter than `vue-tsc --noEmit` — it catches unused imports (TS6133) and declaration emit issues that `--noEmit` misses. Zero TS errors is a hard requirement. Never use `vue-tsc --noEmit` as the sole verification step.

## Lessons Learned

- Normalize camera direction vectors before scaling by distance — non-unit vectors (iso, dimetric) cause distance drift on repeated clicks
- ThreeViewer in hidden v-show tabs: guard `if (w === 0 || h === 0) return` in resize() or canvas gets 0x0
- Don't use CSS grid overlay (visibility:hidden) for tab panes with ThreeViewer — ResizeObserver feedback loops
- `CMD.wait_complete()` in gateway blocks the WebSocket receive loop → heartbeat timeout → disarm. Use fire-and-forget instead.
- Scoped CSS styles (e.g. `button.primary` in App.vue) don't apply in child components — put shared button styles in global `style.css`
- `hal.get_value(name)` takes ~6-8ms (mutex + linear search). Use HAL component input pins (`comp['pin']`) for hot-path reads (<1μs)
- Never use `:deep()` to override visual CSS properties (background, color, border) in scoped styles — it bypasses Btn.vue's design system. Layout overrides (flex, width, padding) are acceptable.
- Always use `with open()` for file I/O in Python — bare `open()` in loops leaks handles until GC
- `.get()` is a dict method — calling it on a list silently raises AttributeError. Use `[index]` for list access.
- Read the actual CSS before speculating about visual bugs — the override might be setting the value to match the background, not just being "too subtle"
- Use direct child selectors (`.grid > label`) not descendant selectors (`.grid label`) when styling grid/container labels — descendant selectors mute nested form controls (radios, checkboxes) inside those containers
- When adding server-synced settings sections, update `_VALID_SETTINGS_SECTIONS` in `gateway.py` — the gateway rejects unknown sections with "Unknown settings section" error
- Don't hack around permission issues in the backend — use the proper frontend permission gate so the UI reflects machine state (dimming). The gate IS the fix, not a workaround.
- Any component that emits MDI commands (e.g. `setProbeVars`) must gate those emissions behind `can.ready` — MDI requires homed. Settings persistence (`saveDefaults`) is separate and always works.
- Fusion 360 tool library geometry params (`TA`, `LCF`, `LB`, `shoulder-length`) are ambiguous per tool type with no official docs — same key means different things for different tool types. STL import eliminates the interpretation guesswork.
- Settings `saveSection()` must block BEFORE cache write when server isn't ready — otherwise fallback zeros poison the cache and eventually overwrite the server
- Every component reading settings at setup time needs a `settingsVersion` watcher to re-read when WS delivers server data — stale snapshots cause settings to appear lost on refresh
- ThreeViewer `buildFromInit` creates scene objects as visible after `onMounted` already applied layer defaults — must re-apply at end of `buildFromInit` using fresh `loadViewerDefaults()`

## Production DISPLAY Integration

The `lcnc-suite` launcher script lets LinuxCNC start the gateway as its native display:

```
linuxcnc my_machine.ini    # single command — starts everything
```

**Setup:**
```bash
# 1. Build the frontend (once, and after any frontend changes)
cd lcnc-webui && npm run build

# 2. Symlink launcher to PATH so LinuxCNC can find it
#    (LinuxCNC does not expand ~ in DISPLAY paths — must be on PATH)
mkdir -p ~/.local/bin
ln -sf "$(pwd)/../lcnc-suite" ~/.local/bin/lcnc-suite

# 3. Verify
which lcnc-suite    # should print ~/.local/bin/lcnc-suite

# 4. Set DISPLAY in your machine INI [DISPLAY] section:
#    DISPLAY = lcnc-suite
```

**How it works:**
1. LinuxCNC launches `lcnc-suite -ini /path/to.ini` as a subprocess
2. Launcher sources NVM (for correct Node version), activates Python venv
3. Reads `WEBUI_*` config from INI `[DISPLAY]` section via `inivar`
4. Production (`WEBUI_DEV=0`): exports `LCNC_WEBUI_DIST_DIR`, `exec`s uvicorn serving API + built frontend
5. Dev (`WEBUI_DEV=1`): starts Vite on :5173 (hot-reload) + gateway on :8000, cleans up both on exit
6. LinuxCNC blocks on the display process; SIGTERM triggers clean HAL shutdown

**INI configuration** (`[DISPLAY]` section):

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBUI_HOST` | `0.0.0.0` | `127.0.0.1` for local, `0.0.0.0` for LAN |
| `WEBUI_PORT` | `8000` | HTTP/WebSocket port |
| `WEBUI_BROWSER` | `1` | Auto-open browser on start |
| `WEBUI_DEV` | `0` | `1` = Vite dev server on :5173 (hot-reload) |
| `CAMERA_SOURCE` | *(disabled)* | USB device index (`0`, `1`) or URL (`rtsp://host/live`, `http://host/mjpeg`) |
| `CAMERA_RESOLUTION` | `1280x720` | Capture resolution `WxH` (USB cameras only) |
| `CAMERA_FPS` | `15` | MJPEG stream frame rate |

Environment variables `LCNC_WEBUI_HOST`, `LCNC_WEBUI_PORT`, `LCNC_WEBUI_BROWSER`, `LCNC_WEBUI_DEV` override INI values. Camera variables: `LCNC_CAMERA_SOURCE`, `LCNC_CAMERA_RESOLUTION`, `LCNC_CAMERA_FPS`.

**Development mode:** Set `WEBUI_DEV = 1` — launcher starts Vite on :5173 (hot-reload) alongside the gateway on :8000. Browser opens to :5173 where Vite proxies API/WS to the gateway.

For headless/no-UI: `DISPLAY = dummy` (zero overhead, gateway connects separately).
