# LCNC Suite — Project Context

## Architecture

```
lcnc-webui/src/     Vue 3 + TypeScript frontend (Vite dev server, port 5173)
lcnc-gateway/       Python FastAPI + WebSocket backend (uvicorn, port 8000)
subroutines/        G-code subroutines shipped with the project
  probe_basic/      44 probing .ngc files (bundled from kcjengr/probe_basic, GPL v3)
  tool_length_probe/ git submodule → bildobodo/tool_length_probe@lcnc-suite-mods
  surfacemap/       git submodule → bildobodo/surfacemap_usertab@lcnc-suite-mods
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
- `MdiPanel.vue` — MDI input + send button
- `ManualPanel.vue` — DRO + jogging + MDI (consolidated)
- `ProbePanel.vue` — Probe operations grid, calls `O<probe_*> CALL` via MDI
- `ToolTablePanel.vue` — Tool table with load/delete dialogs
- `CameraViewer.vue` — Camera tab with MJPEG feed, SVG crosshair/circle/grid overlay, floating toolbar
- `SettingsPanel.vue` — Sub-tabbed settings (3D Viewer | Machine | Toolsetter | Display | Camera | Macros | Gamepad | Keyboard | HAL | Debug)
- `permissions.ts` — Centralized button permission system (evaluatePermissions + provide/inject)
- `lcncWs.ts` — WebSocket client, heartbeat, server-authoritative armed state
- `lcncApi.ts` — REST helpers for file listing and upload
- `defaults.ts` — localStorage defaults with section registry pattern
- `style.css` — Global styles/theme vars, button.primary/button.danger

### Main Tabs

`3D Viewer | Manual Control | Program | Tool Table | Probing | Camera | Settings`

### Sidebar

Left column (150px) with three sections:

1. **Machine Safety** — Arm/Disarm, E-Stop, Machine On/Off
2. **Machine Status** — Click-to-toggle popovers for Machine, Program, Overrides
3. **Controls** — Spindle, Coolant, Tool, Macros button+popover groups
   - Spindle: FWD/REV/STOP, RPM input, actual speed, override slider
   - Coolant: Flood/Mist toggles
   - Tool: Tool # input, Measure/Manual/Load/Abort buttons, probe status, tool context (T# D# Z#)
   - Macros: User-configurable MDI command buttons with `{param}` prompt support (configured in Settings > Macros)

## Safety System — Three Layers

### HAL E-Stop Chain

`lcnc_webui.hal` inserts two AND gates and a heartbeat watchdog into the e-stop loop:

```
user-enable-out ──┐
                  AND2.0 ──┐
connected ────────┘        AND2.1 ──► emc-enable-in
watchdog.ok ───────────────┘
```

Machine stays enabled only when ALL THREE: user hasn't pressed e-stop, at least one web client is **connected**, AND the gateway heartbeat is alive (watchdog hasn't tripped). When any condition drops, LinuxCNC enters **ESTOP** (task_state=1).

### Layer Behavior

| Trigger | Gateway action | `connected` pin | LinuxCNC state |
|---------|---------------|----------------|----------------|
| Armed client, normal operation | heartbeat toggles at 30Hz | TRUE | ON |
| Clients connected, **none armed** | heartbeat toggles at 30Hz | TRUE | **ON** |
| Last client disconnects | 3s grace period: heartbeat keeps toggling | TRUE (grace) | **ON** |
| Grace period expires, no reconnect | pins drop | FALSE | **OFF** |
| Page refresh (reconnect within 3s) | grace cancelled on reconnect | TRUE | **ON** |
| Heartbeat timeout (armed), other clients exist | force-disarm + `abort()` + `jog_stop()` | TRUE | ON |
| Heartbeat timeout (armed), last client | force-disarm + `abort()` + `jog_stop()` → grace starts | TRUE (grace) | ON |
| Gateway crashes | watchdog detects socket close → resets all pins | FALSE | **ESTOP** |
| Gateway freezes | heartbeat stops → watchdog trips after 0.5s | TRUE | **ESTOP** |
| User presses E-Stop | `CMD.state(ESTOP)` + forces `connected: false` | FALSE (transient) | **ESTOP** |

Recovery: clear E-Stop → Machine On. Motion commands still require `require_armed()`.

### Heartbeat Architecture

The HAL heartbeat runs in an **independent asyncio task** (`_heartbeat_loop`), decoupled from status processing. This prevents `poll_status` delays (NML IPC, HAL reads, WebSocket backpressure) from starving the heartbeat and causing false watchdog trips.

**Two independent concurrent paths per client:**
1. **Command path** (`ws.receive_text` → `handle_command`): processes E-Stop, abort, jog, MDI — always responsive
2. **Status path** (`status_loop`): polls LinuxCNC state, sends updates to UI — can be slow without affecting safety

**Failure mode coverage:**

| Failure | Heartbeat | Watchdog | E-Stop | Outcome |
|---------|-----------|----------|--------|---------|
| Gateway process crash | stops | trips | N/A | ESTOP |
| Gateway process freeze (GIL) | stops | trips | N/A | ESTOP |
| All clients disconnect | grace period | alive during grace | N/A | Machine off after 3s |
| `poll_status` slow/blocked | keeps toggling | alive | works | Stale display, controls work |
| WebSocket backpressure | keeps toggling | alive | works | Delayed status, controls work |

**Design trade-off**: a stuck `status_loop` (NML hang, executor blocked) results in frozen UI numbers, but all controls (E-Stop, abort, jog stop) remain functional via the independent command path. This is preferable to false watchdog trips from normal processing delays.

### Pin Semantics

- **`webui-safety.connected`**: TRUE when `bool(clients)` or during disconnect grace period — keeps machine alive; armed state gates motion commands via `require_armed()`, not the HAL pin
- **`webui-safety.heartbeat`**: toggles every ~33ms (30Hz) via independent `_heartbeat_loop` task while gateway has active clients, or via `_disconnect_grace` during grace period; monitored by `watchdog` component (0.5s timeout)
- **`watchdog.ok-out`**: TRUE while heartbeat keeps toggling within timeout; FALSE if gateway freezes or stops sending

Additional safety mechanisms:
- **Server-authoritative arming**: Each WebSocket client independently armed/disarmed; gateway is the source of truth
- **Backend `require_armed()`**: Every motion command in gateway.py checks armed before executing
- **Busy gate**: `fire()` 200ms anti-spam cooldown prevents double-execution
- **Focus loss**: Auto-stop jogs on window blur / tab hidden

### HAL Monitor Component (`webui-monitor`)

`poll_status()` needs 6 HAL pin values not available through `STAT`. `hal.get_value(name)` acquires a mutex + linear search (~6-8ms each, ~40ms total). The `webui-monitor` HAL component creates input pins and wires them to the source signals, enabling direct pointer reads (<1μs each).

- **Config**: `_HAL_MONITOR_PINS` list in `gateway.py` — add new pins here as `(source_pin, local_name, hal_type)` tuples
- **Init**: `_init_hal_monitor()` called once from `try_connect_lcnc()` — creates component, connects pins via `halcmd net`
- **Read**: `_hal_read(local_pin, default)` — falls back to default if component unavailable
- **Fallback**: if component creation fails, `poll_status()` falls back to `hal_get()` (original slow path)

## Permission System

**File**: `permissions.ts` — single source of truth for all button enable/disable logic.

**Rule: Every button must be assigned to a permission gate.** Components never compute their own disable conditions — they reference a permission class.

```
base = armed && !estop && enabled
```

| Class | Rule | Buttons / Actions |
|-------|------|-------------------|
| `idle` | base, idle, !busy | Home, Unhome, Zero, G5x select, file ops |
| `jog` | base, idle, homed | Jog buttons, speed slider, keyboard jog |
| `override` | base, !busy | Feed/Spindle/Rapid override sliders + presets |
| `ready` | base, idle, !busy, homed | MDI, Cycle Start, Spindle, Coolant, Probe, Tool measure/load, Toolsetter settings |
| `pause` | base, running, !paused | Pause |
| `resume` | base, paused | Resume |
| `abort` | base | Abort |

### Usage in App.vue (direct)
```vue
<button :disabled="!permissions.ready" @click="...">Send MDI</button>
```

### Usage in child components (inject)
```vue
const can = usePermissions();
<button :disabled="!can.idle">Zero All</button>
```

## Layout Architecture

- Sidebar (150px) + main content column with horizontally scrollable panels
- Each panel independently selects tabs via TabPanel component
- Same tab can appear in multiple panels (e.g. two 3D Viewers with separate refs)
- Shared state: coordMode, jogVel, mdiText, armed, busy
- Responsive: landscape (side-by-side panels) and portrait (stacked panels)

## Key Patterns

- **No hardcoded visual styles** — never invent custom font-size, padding, border-radius, colors, or font-family for new elements. Always inherit from the nearest parent class or global base styles in `style.css`. New CSS should only override layout properties (flex, width, text-align, opacity). If a visual style doesn't exist, extend the existing class hierarchy or global base — never create one-off overrides. For color semantics: machine active states use `--ok` (green), form controls (toggles, radios, checkboxes) use `--info` (blue), danger/abort uses `--danger`, warnings use `--warn`. Always match existing patterns (e.g. `.controlBtn.active`, `.coolantToggle.active` in App.vue).
- **Spacing tokens** — use `--gap-tight` (4px, grouped toggles), `--gap-controls` (8px, button rows/form fields), `--gap-section` (12px, between sections), `--gap-panel` (20px, major divisions) for all layout gaps. Never hardcode gap/margin values for spacing between elements. Padding inside buttons/inputs is visual and stays hardcoded. Minimum gap between any clickable elements: `--gap-tight` (4px).
- `defaults.ts` section registry: `registerSection<T>(name, fallback, migrateFn)` + `loadSection`/`saveSection` with localStorage. Server-synced sections must be added to `SERVER_SECTIONS` in **three** places: `defaults.ts` (Set), `main.ts` (array), and `gateway.py` (`_VALID_SETTINGS_SECTIONS` Set).
- ViewPreset type is duplicated in ThreeViewer.vue and Toolbar.vue — update both when adding presets
- Camera Z-up: `camera.up.set(0, 0, 1)`, except top view uses `(0, 1, 0)` to avoid gimbal lock
- ThreeViewer uses ResizeObserver (not window resize) to handle v-show tab switching
- Dialog overlays use `position: fixed; z-index: 1000` with global `button.primary`/`button.danger` styles
- Gateway `tool_change` handler is fire-and-forget (no `CMD.wait_complete()` — blocks heartbeat loop)
- Toolsetter settings live in SettingsPanel (Toolsetter sub-tab), tool actions in sidebar Tool popover
- **No `:deep()` visual overrides** — scoped CSS may use `:deep()` for layout properties (flex, width, height, padding) but NEVER for visual properties (background, color, border, box-shadow). Visual overrides bypass Btn.vue's state system. If a button state looks wrong, fix it in Btn.vue.

## Pre-Flight Checklist — MANDATORY for every CSS/UI edit

Before writing or modifying ANY CSS or interactive element, verify ALL items:

**Spacing** — `gap`/`row-gap`/`column-gap`/`margin` between siblings MUST use tokens: `--gap-tight` (4px), `--gap-controls` (8px), `--gap-section` (12px), `--gap-panel` (20px). Never hardcode. No double-layer padding (parent + child both adding padding).

**Layout** — Use `stack-*` / `row-*` utility classes from `style.css` for flex layout. Never write `display: flex; flex-direction: column; gap: var(--gap-*)` directly in component CSS. Component-scoped CSS should only add non-layout properties (height, overflow, position, flex, min-height). Classes: `stack-panel` (20px), `stack-sections` (12px), `stack-controls` (8px), `stack-tight` (4px), `stack-micro` (2px), `row-controls` (8px), `row-tight` (4px).

**Typography** — `font-size` → `--fs-*` tokens. `border-radius` → `--radius-*` tokens. `font-family` → `var(--font-mono)` or `var(--font-sans)`. Never hardcode any of these.

**Colors** — Use semantic CSS variables (`--ok`, `--danger`, `--warn`, `--accent`, `--fg`, `--bg`, etc.) with `color-mix()`. Never raw hex. Hover tiers: `--hl-hover` (12%), `--hl-selected` (15%), `--hl-active` (20%) — no other percentages.

**Permission gates** — Every button/input/select gets `:disabled="!can.<class>"`. Only exception: pure navigation (sidebar, tabs). Inactive sections use `:class="{ inactive: !can.X }"` — never inline `:style` opacity.

**Global patterns** — Form elements inherit from `style.css` base (component CSS only adds layout). Tables → `.dataTable`. Dialogs → `.dialogOverlay` + `.dialog` + `.dialog-full`. Close buttons → `.btn-icon`. Check existing components before creating new CSS.

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
