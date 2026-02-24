# LCNC Suite — Project Context

## Architecture

```
lcnc-webui/src/     Vue 3 + TypeScript frontend (Vite dev server, port 5173)
lcnc-gateway/       Python FastAPI + WebSocket backend (uvicorn, port 8000)
subroutines/        G-code subroutines shipped with the project
  probe_basic/      44 probing .ngc files (bundled from kcjengr/probe_basic, GPL v3)
  tool_length_probe/ git submodule → bildobodo/tool_length_probe@lcnc-suite-mods
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
- `SettingsPanel.vue` — Sub-tabbed settings (3D Viewer | Machine | Toolsetter | Jogging | Debug)
- `permissions.ts` — Centralized button permission system (evaluatePermissions + provide/inject)
- `lcncWs.ts` — WebSocket client, heartbeat, server-authoritative armed state
- `lcncApi.ts` — REST helpers for file listing and upload
- `defaults.ts` — localStorage defaults with section registry pattern
- `style.css` — Global styles/theme vars, button.primary/button.danger

### Main Tabs

`3D Viewer | Manual Control | Program | Tool Table | Probing | Settings`

### Sidebar

Left column (150px) with three sections:

1. **Machine Safety** — Arm/Disarm, E-Stop, Machine On/Off
2. **Machine Status** — Click-to-toggle popovers for Machine, Program, Overrides
3. **Controls** — Spindle, Coolant, Tool button+popover groups
   - Spindle: FWD/REV/STOP, RPM input, actual speed, override slider
   - Coolant: Flood/Mist toggles
   - Tool: Tool # input, Measure/Manual/Load/Abort buttons, probe status, tool context (T# D# Z#)

## Safety System — Three Layers

See `README.md` Safety System section for full details including HAL setup.

| Layer | Mechanism | Timeout | Effect |
|-------|-----------|---------|--------|
| **1. Disconnect** | Armed client disconnects | Immediate | `jog_stop` all axes + `abort` |
| **2. Heartbeat** | Client sends every 1s; server checks | 3.0s | Auto-disarm + abort + stop jogs |
| **3. HAL Watchdog** | `hal_watchdog.py` pins: `heartbeat`, `connected` | External HAL | Pins go LOW → hardware e-stop chain |

Additional safety mechanisms:
- **Client-local arming**: Each WebSocket client independently armed/disarmed (server-authoritative)
- **Backend `require_armed()`**: Every motion command in gateway.py checks armed before executing
- **Busy gate**: `fire()` 200ms anti-spam cooldown prevents double-execution
- **Focus loss**: Auto-stop jogs on window blur / tab hidden

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
| `ready` | base, idle, !busy, homed | MDI, Cycle Start, Spindle, Coolant, Probe, Tool measure/load |
| `pause` | base, running, !paused | Pause |
| `resume` | base, paused | Resume |
| `abort` | armed | Abort |

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

- `defaults.ts` section registry: `registerSection<T>(name, fallback, migrateFn)` + `loadSection`/`saveSection` with localStorage
- ViewPreset type is duplicated in ThreeViewer.vue and Toolbar.vue — update both when adding presets
- Camera Z-up: `camera.up.set(0, 0, 1)`, except top view uses `(0, 1, 0)` to avoid gimbal lock
- ThreeViewer uses ResizeObserver (not window resize) to handle v-show tab switching
- Dialog overlays use `position: fixed; z-index: 1000` with global `button.primary`/`button.danger` styles
- Gateway `tool_change` handler is fire-and-forget (no `CMD.wait_complete()` — blocks heartbeat loop)
- Toolsetter settings live in SettingsPanel (Toolsetter sub-tab), tool actions in sidebar Tool popover

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

## Lessons Learned

- Normalize camera direction vectors before scaling by distance — non-unit vectors (iso, dimetric) cause distance drift on repeated clicks
- ThreeViewer in hidden v-show tabs: guard `if (w === 0 || h === 0) return` in resize() or canvas gets 0x0
- Don't use CSS grid overlay (visibility:hidden) for tab panes with ThreeViewer — ResizeObserver feedback loops
- `CMD.wait_complete()` in gateway blocks the WebSocket receive loop → heartbeat timeout → disarm. Use fire-and-forget instead.
- Scoped CSS styles (e.g. `button.primary` in App.vue) don't apply in child components — put shared button styles in global `style.css`

## Future: Production DISPLAY Integration

Status: deferred (still in development — Vite hot-reload is more productive)

LinuxCNC can launch lcnc-suite as its native display:
1. `npm run build` → static dist/ folder
2. Gateway serves dist/ via `StaticFiles` mount (no Node at runtime)
3. Launcher script on PATH accepts `-ini`, runs uvicorn in foreground
4. INI: `[DISPLAY] DISPLAY = lcnc-webui`
5. LinuxCNC blocks on display, cleans up when it exits

For headless/no-UI: `DISPLAY = dummy` (zero overhead, gateway connects separately).
