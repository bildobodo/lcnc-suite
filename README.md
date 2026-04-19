# LCNC Suite

A modern, UI-agnostic WebSocket gateway for LinuxCNC with a reference Vue 3 web interface.

## Table of Contents

- [Overview](#overview)
- [Safety and Liability Disclaimer](#%EF%B8%8F-safety-and-liability-disclaimer)
- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [WebSocket API](#websocket-api)
  - [Connection](#connection)
  - [Server Messages](#server-messages)
  - [Client Commands](#client-commands)
  - [Error Handling](#error-handling)
  - [Safety System](#safety-system)
- [Building Your Own UI](#building-your-own-ui)
- [Development](#development)
- [LinuxCNC Configuration](#linuxcnc-configuration)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Overview

**lcnc-suite** provides a real-time WebSocket API for controlling and monitoring LinuxCNC machines. The architecture separates machine control (backend) from user interface (frontend), allowing you to build custom UIs for web, mobile, desktop, or embedded applications.

### Architecture

```
┌─────────────────────┐
│   Any UI Client     │  ← Web, Mobile, Desktop, Custom Hardware
│   (Your Choice)     │
└──────────┬──────────┘
           │ WebSocket (ws://host:8000/ws)
           │
┌──────────▼──────────┐
│   lcnc-gateway      │  ← UI-Agnostic API Server
│   (Python/FastAPI)  │
└──────────┬──────────┘
           │ Python API
           │
┌──────────▼──────────┐
│     LinuxCNC        │  ← Machine Controller
└─────────────────────┘
```

The repository includes:
- **lcnc-gateway**: WebSocket gateway (UI-agnostic)
- **lcnc-webui**: Reference Vue 3 web interface (optional, one possible UI)

## ⚠️ Safety and Liability Disclaimer

**READ THIS CAREFULLY BEFORE USING THIS SOFTWARE**

This software is provided for controlling CNC machines and other potentially dangerous equipment. By using this software, you acknowledge and agree to the following:

### No Warranty

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. THE SOFTWARE MAY CONTAIN BUGS, ERRORS, OR DEFECTS THAT COULD CAUSE EQUIPMENT MALFUNCTION, PROPERTY DAMAGE, PERSONAL INJURY, OR DEATH.

### No Liability

IN NO EVENT SHALL THE AUTHORS, COPYRIGHT HOLDERS, OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE, INCLUDING BUT NOT LIMITED TO:

- Personal injury or loss of life
- Property damage or equipment damage
- Loss of data or work product
- Loss of business or profits
- Any direct, indirect, incidental, special, exemplary, or consequential damages

### User Responsibility

YOU ARE SOLELY RESPONSIBLE FOR:

1. **Safety Measures**: Implementing appropriate safety systems, emergency stops, interlocks, guards, and protective equipment according to applicable safety standards
2. **Testing and Validation**: Thoroughly testing this software in a safe environment before use on production equipment
3. **Supervision**: Never leaving CNC equipment running unattended
4. **Compliance**: Ensuring compliance with all applicable local, state, national, and international laws, regulations, and safety standards
5. **Professional Review**: Having this software reviewed by qualified engineers or safety professionals before use in any critical application
6. **Risk Assessment**: Understanding the risks involved in operating CNC machinery and taking appropriate precautions
7. **Maintenance**: Keeping all equipment properly maintained and in safe operating condition

### CNC-Specific Warnings

CNC machines are inherently dangerous. They can:
- Move rapidly and with great force
- Cause severe crushing injuries
- Generate projectiles from broken tools or workpieces
- Create fire hazards from spindle operation
- Cause electrical hazards
- Produce dangerous noise levels and particulates

**Do not operate CNC equipment unless you are trained and qualified to do so.**

### No Support Guarantee

The authors provide this software on a voluntary basis and are under no obligation to provide support, updates, bug fixes, or any assistance whatsoever.

### Assumption of Risk

BY USING THIS SOFTWARE, YOU EXPRESSLY ACKNOWLEDGE AND ASSUME ALL RISKS ASSOCIATED WITH ITS USE. If you do not agree to these terms, do not use this software.

---

## Features

### Gateway (lcnc-gateway)

- **Real-time Status**: 30 Hz machine state updates via WebSocket
- **Full Machine Control**: E-stop, enable, jog, MDI, auto run
- **Three-Layer Safety System**:
  - Connection-level arming to prevent accidental commands (`require_armed()` gates all motion)
  - Disconnect handler: stops all motion when an armed client disconnects
  - Heartbeat watchdog: client sends 1 s heartbeat; gateway disarms after 3 s timeout
  - HAL watchdog: `webui-safety` HAL component + retriggerable `oneshot` monostable — machine enters ESTOP when all clients disconnect, the gateway crashes, or the gateway stalls ≥ 0.5 s. A `trip-latch` pin latches the ESTOP (independent edge counter inside `hal_watchdog.py`, so trips survive gateway freezes) until the operator clicks E-Stop Reset and acknowledges the sticky safety-trip banner
  - E-Stop button forces HAL pin LOW for defense-in-depth alongside software command
- **Client Tracking**: Connected clients with IP and armed state, visible to all sessions
- **Auto-Reconnect**: Detects LinuxCNC restart and reconnects without gateway restart
- **3D Visualization Support**: Machine model, kinematics, G-code preview
- **Position Tracking**: Machine, work, and joint coordinates with full offset handling
- **Tool Management**: Tool number, diameter, and length offset tracking
- **G-code Parser**: Preview generator for feed and rapid moves (G0/G1/G2/G3)
- **G-code File Management**: Upload, browse, and load G-code files via REST API
- **Probe Support**: Real-time probe results and calibration offset parsed from DEBUG EVAL messages on the error channel
- **Camera Streaming**: MJPEG stream from USB or network cameras (OpenCV) via `GET /camera/stream`
- **Server Settings**: JSON-backed settings store (`settings.json`) with per-INI sections, shared across all clients with real-time sync via WebSocket
- **Error Channel**: Real-time LinuxCNC error/message forwarding
- **STL Model Serving**: Static file server for 3D machine models

### Reference UI (lcnc-webui)

- Modern Vue 3 + TypeScript single-page interface
- Real-time DRO with G5x work coordinate selector, touch-off to value, and DTG display
- Offset table editor (G54–G59.3) with direct value editing
- XY + Z jogging with diagonal support and World/Joint mode toggle
- Configurable keyboard shortcuts with dedicated Settings tab: master enable/disable toggle, jog sub-toggle, click-to-capture rebindable key bindings for all actions (jog, E-Stop, cycle start, abort), duplicate detection, visual key highlights
- Gamepad jogging (Xbox/PS/standard) with proportional analog sticks, D-pad discrete jog, dead man switch, 12 configurable button actions, deadzone visualization
- Bottom action strip with jog wheel, speed slider, step increments, touch-off/homing grid, WCS selector, override sliders, spindle controls (FWD/REV/STOP, RPM, actual speed, load), coolant toggles, tool management (load/unload/measure, metadata, 2D preview)
- MDI command interface with persistent history
- G-code file browser with drag-and-drop upload
- G-code viewer with syntax highlighting, inline editor with save, program controls, progress bar, and run-from-line
- G-code context help: hover any G/M-code token for instant tooltip, click to open searchable reference dialog
- Single-block step mode
- Optional stop / block delete toggles
- 3D machine visualization with Three.js (colorized toolpath, backplot, STL machine model with per-part coloring/opacity)
- 9-layer visibility/opacity control: backplot, toolpath, machine, workpiece, bounds, work zero, HUD, surface, tool
- Probe panel with 8 views: Outside/Inside Corners (3x3 grid), Boss/Pocket, Ridge/Valley, Edge Angle, Calibrate (round/rect), Surface Scan, and Toolsetter
- Probe results grid (X/Y/Z probed, diameter, width, center, edge angle) from real-time DEBUG EVAL messages
- Calibration offset display with reset in always-visible control bar
- Surface map 3D visualization (probe grid rendered as point cloud in the viewer)
- Toolsetter integration with 23 configurable parameters and tool change position (G30)
- Tool table editor with tool library metadata (15+ fields: flutes, material, OAL, corner radius, etc.), filter/sort, spreadsheet import, per-tool STL upload with 2D side-view preview
- 3D tool model from per-tool STL files with vertex-colored cutter/shaft zones, fallback cylinder from diameter/length
- Camera PiP overlay with MJPEG feed, configurable crosshair/circle/grid SVG overlay (USB and IP cameras)
- User-configurable macro buttons with `{param}` parameter prompts (sidebar popover + Settings editor)
- HAL inspector built into Settings tab (tree view with search, live pin values)
- Server-authoritative settings with multi-client sync (probe, toolsetter, gamepad, keyboard, macros, machine, camera, MDI settings shared across all connected UIs)
- 5 theme modes (auto/light/dark/high-contrast light/high-contrast dark)
- Responsive auto-layout (content panels + bottom action strip) with portrait and landscape modes
- Connected clients display with IP and armed status
- Dynamic connection label (local vs. LAN hostname)
- Error/message panel with persistent log (survives reload), unread count badge, per-message and bulk copy to clipboard, date+time timestamps
- UI shutdown with confirmation dialog and clean gateway exit
- **Machine Controls Catalog** — central catalog (`machineControls.ts`) defines every button type and input gate with permission class, variant, and size. Catalog-aware components (`MachineBtn`, `MachineInput`, etc.) look up their permissions automatically — developers never specify permissions inline.
- **Default-deny gating** — outer `<Gate gate="armed">` fieldsets wrap content area, macro bar, and bottom action strip. SafetyStrip (Arm, E-Stop, Machine On) lives in the bottom strip's `#exempt` slot — always accessible even when disarmed. Browser `<fieldset disabled>` cascade enforces permissions at the DOM level.
- **Permission classes** (14 total, defined in `permissions.ts`):

| Class | Rule | Usage |
|-------|------|-------|
| `always` | unconditional | Arm, E-Stop |
| `armed` | armed | Outer content gate |
| `safety` | armed, not estopped | Machine On/Off |
| `setup` | armed, not estopped, idle, not busy | File ops, tool edits, settings reset |
| `idle` | base, idle, not busy | Banner home, mode select |
| `jog` | base, idle, homed | Jog, speed slider, keyboard jog |
| `override` | base, not busy | Feed/Spindle/Rapid overrides |
| `ready` | base, idle, not busy, homed | MDI, Cycle Start, Spindle, Coolant, comp toggle |
| `pause` | base, running, not paused | Pause |
| `resume` | base, paused | Resume |
| `step` | base, (idle+homed OR paused) | Single-step |
| `abort` | base | Abort, Shutdown |
| `probe` | ready, no eoffset | Probe ops, tool change, WCS edit, touch-off, zero, macros |
| `zero` | idle, no eoffset | Home, Unhome |

`base` = armed, not estopped, enabled

## Screenshots

### Landscape & Portrait layouts

| Landscape | Portrait (tablet) |
|-----------|-------------------|
| ![Landscape](docs/screenshots/landscape.png) | ![Portrait](docs/screenshots/portrait.png) |

The landscape layout places the 3D viewer and tabbed side panel side by side with a horizontally scrollable action strip along the bottom. In portrait mode the action strip rotates into a fixed left column, macro buttons into a thin middle column, and the main content stacks vertically — optimised for touchscreens and tablet mounting.

---

### Themes

| Dark | Light | Dark High-Contrast | Light High-Contrast |
|------|-------|-------------------|---------------------|
| ![Dark](docs/screenshots/darkmode.png) | ![Light](docs/screenshots/lightmode.png) | ![Dark HC](docs/screenshots/dark_high_contrast.png) | ![Light HC](docs/screenshots/light_high_contrast.png) |

Five theme modes selectable at runtime: Auto (follows OS), Light, Dark, High-Contrast Light, High-Contrast Dark.

---

### 3D Viewer — Toolpath & Surface Visualisation

| Toolpath preview | Surface compensation map |
|-----------------|--------------------------|
| ![Toolpath](docs/screenshots/toolpath.png) | ![Surface map](docs/screenshots/surfacemap.png) |

The Three.js viewer renders the full machine model from STL files alongside the G-code toolpath (rapids in red, feeds in cyan). The surface compensation tab overlays a probe height-map directly on the workpiece and shows a 3D surface plot with the interpolated Z values used for live compensation.

---

### Program Panel

![Program](docs/screenshots/program.png)

G-code viewer with syntax highlighting, inline editing, program controls (start / pause / step / abort), progress bar, and run-from-line. Hover any G/M-code token for an instant tooltip; click to open the searchable reference dialog.

---

### Probing

| 3D probing operations | G-code reference |
|-----------------------|-----------------|
| ![3D Probing](docs/screenshots/3D_probing.png) | ![G-code Reference](docs/screenshots/gcode_reference.png) |

The Probing tab covers 8 probe views: Outside/Inside corners (3×3 grid), Boss/Pocket, Ridge/Valley, Edge Angle, Calibrate, Surface Scan, and Toolsetter. Probe results (X/Y/Z, diameter, centre, angle) are captured live from LinuxCNC's debug channel. The built-in G-code reference dialog is searchable across all G and M codes with syntax and parameter descriptions.

---

### Tool Table

| Tool library | Tool editor |
|-------------|-------------|
| ![Tool table](docs/screenshots/tool_table.png) | ![Tool edit](docs/screenshots/tool_edit.png) |

The tool table lists all tools with metadata (type, diameter, flutes, material, OAL, corner radius, etc.) alongside a live 3D side-view preview rendered from per-tool STL files or a fallback cylinder. The editor dialog lets you update all fields and see the geometry update in real time.

---

### WCS Offset Table

![Offsets](docs/screenshots/offsets.png)

Inline editing of all work coordinate systems (G54–G59.3) plus G92, tool, and compensation auxiliary rows. Click any cell to edit, press Enter to apply.

---

### Messages & Settings

| Message log | Settings |
|-------------|----------|
| ![Messages](docs/screenshots/messages.png) | ![Settings](docs/screenshots/settings.png) |

The message panel shows a persistent log of all LinuxCNC errors and operator messages with timestamps, severity colour coding, per-message dismiss, and bulk copy to clipboard. Settings are server-authoritative and sync across all connected clients in real time — covering the 3D viewer, machine parameters, display, macros, gamepad, keyboard shortcuts, HAL inspector, and debug tools.

---

## Requirements

### Gateway
- LinuxCNC 2.8+ with Python bindings
- Python 3.9+
- Virtual environment with system-site-packages enabled

### Reference UI
- Node.js 18+ and npm (22.x LTS recommended; installed automatically by `install.sh`)

## Installation

### Option A: Automated

```bash
git clone https://github.com/bildobodo/lcnc-suite.git
cd lcnc-suite
./install.sh          # checks dependencies, creates venv, installs npm packages
cd lcnc-webui && npm run build && cd ..   # build frontend for production
```

### Option B: Manual

**Prerequisites:** LinuxCNC 2.8+ with Python bindings, Python 3.9+, Node.js 18+ (22.x LTS recommended), npm, git-lfs

```bash
# 1. Clone
git clone https://github.com/bildobodo/lcnc-suite.git
cd lcnc-suite
git lfs pull

# 2. Python venv (--system-site-packages required for linuxcnc bindings)
python3 -m venv lcnc-gateway/.venv --system-site-packages
source lcnc-gateway/.venv/bin/activate
pip install -r lcnc-gateway/requirements.txt
deactivate

# 3. Node.js dependencies
cd lcnc-webui
npm install

# 4. Build frontend for production
npm run build
cd ..
```

### Configure LinuxCNC

After installing (either option), configure your machine:

#### 1. Symlink launcher to PATH

LinuxCNC does not expand `~` in DISPLAY paths — the launcher must be on PATH.

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/lcnc-suite" ~/.local/bin/lcnc-suite

# Verify:
which lcnc-suite    # should print ~/.local/bin/lcnc-suite
```

#### 2. INI `[DISPLAY]` section

Add these to your machine's INI file:

```ini
[DISPLAY]
DISPLAY = lcnc-suite
WEBUI_HOST = 0.0.0.0
WEBUI_PORT = 8000
WEBUI_BROWSER = 1
WEBUI_DEV = 0
```

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBUI_HOST` | `0.0.0.0` | `127.0.0.1` = localhost only, `0.0.0.0` = LAN accessible |
| `WEBUI_PORT` | `8000` | HTTP and WebSocket port |
| `WEBUI_BROWSER` | `1` | Auto-open browser on start (`0` to disable) |
| `WEBUI_DEV` | `0` | `1` = Vite dev server on :5173 with hot-reload |
| `DEBUG` | `0` | Subroutine debug logging — `0` = off, `1` = write `logfile.txt` to config folder (read by `tool_touch_off.ngc`) |
| `CAMERA_SOURCE` | *(disabled)* | USB device index (`0`, `1`) or URL (`rtsp://host/live`, `http://host/mjpeg`) |
| `CAMERA_RESOLUTION` | `1280x720` | Capture resolution `WxH` (USB cameras only) |
| `CAMERA_FPS` | `15` | MJPEG stream frame rate |

Environment variables `LCNC_WEBUI_HOST`, `LCNC_WEBUI_PORT`, `LCNC_WEBUI_BROWSER`, `LCNC_WEBUI_DEV` override INI values. Camera variables: `LCNC_CAMERA_SOURCE`, `LCNC_CAMERA_RESOLUTION`, `LCNC_CAMERA_FPS`.

#### 3. HAL safety chain

The gateway uses a HAL watchdog component for the e-stop safety chain. Copy the example HAL file to your machine config and add it to your INI:

```bash
cp examples/sim_config/hallib/lcnc_webui.hal /path/to/your/config/hallib/
```

Then add to your INI `[HAL]` section:

```ini
[HAL]
HALFILE = hallib/lcnc_webui.hal
```

The HAL file wires three safety conditions into the e-stop chain:
1. **E-stop clear** — user hasn't pressed e-stop
2. **Client connected** — at least one web client is connected (or within 3s grace period)
3. **Heartbeat alive** — gateway is responsive (watchdog trips after 0.5s if frozen)

All three must be TRUE for the machine to stay enabled. See [Setting Up the HAL Watchdog](#setting-up-the-hal-watchdog) for the full wiring details and notes on adapting to non-sim configs.

**Important:** The example HAL file uses `unlinkp` + AND2 gates, which works for simple sim configs. On real machines with multi-input e-stop gates, expand the existing gate instead — see [Setting Up the HAL Watchdog](#setting-up-the-hal-watchdog) for details.

## Quick Start

### Production

```bash
linuxcnc your_machine.ini    # single command — starts everything
```

The launcher serves the built frontend at `http://localhost:8000` (or your configured port). Other devices on the LAN can connect at `http://<machine-ip>:8000`.

### Development (hot-reload)

Set `WEBUI_DEV = 1` in your INI, then:

```bash
linuxcnc your_machine.ini
```

This starts both the Vite dev server on `:5173` (with hot-reload) and the gateway on `:8000`. The browser opens to `:5173` where Vite proxies API/WebSocket requests to the gateway.

### Standalone (without LinuxCNC DISPLAY)

If you prefer to manage processes separately:

```bash
./restart.sh local    # localhost only
./restart.sh lan      # LAN accessible
```

This starts the gateway on :8000 and Vite dev server on :5173. Logs go to `runlogs/`.

## WebSocket API

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8000/ws');
```

### Server Messages

The gateway sends these message types:

#### `viewer_init`
Machine model configuration (sent once per connection). See [Machine Model](#machine-model-machinejson) for the full schema.
```json
{
  "type": "viewer_init",
  "data": {
    "units": "mm",
    "axes": ["X", "Y", "Z"],
    "stl_base_url": "http://localhost:8000/assets/",
    "machine_bounds": {
      "origin": [0, 0, 0],
      "size": [300, 200, 100]
    },
    "groups": [
      { "id": "x", "parent": "root" },
      { "id": "y", "parent": "root" },
      { "id": "z", "parent": "y" },
      { "id": "tool", "parent": "z" }
    ],
    "parts": [
      { "id": "frame", "file": "frame.stl?v=1234", "group": null, "translate": [-760, -122, -294] }
    ],
    "kinematics": [
      { "group": "x", "joint": 0, "direction": "x", "sign": -1 }
    ],
    "workGroup": "x",
    "toolGroup": "tool"
  }
}
```

#### `status`
Full machine status (30 Hz):
```json
{
  "type": "status",
  "data": {
    "ts": 1234567890.123,
    "estop": false,
    "enabled": true,
    "homed": true,
    "task_mode": 1,
    "interp_state": 1,
    "state": 1,
    "machine_pos": [10.5, 20.3, 5.0],
    "work_pos": [0.0, 0.0, 0.0],
    "joint_pos": [10.5, 20.3, 5.0],
    "g5x_offset": [10.5, 20.3, 5.0],
    "g92_offset": [0.0, 0.0, 0.0],
    "tool_offset": [0.0, 0.0, 0.0],
    "dtg": [0.0, 0.0, 0.0],
    "feed_override": 1.0,
    "spindle_override": 1.0,
    "spindle_speed": 1000.0,
    "spindle_speed_actual": 998.5,
    "spindle_direction": 1,
    "rapid_override": 1.0,
    "max_velocity": 100.0,
    "current_vel": 50.0,
    "active_file": "/path/to/file.ngc",
    "motion_line": 42,
    "tool_number": 1,
    "tool_diameter": 6.0,
    "tool_length": 50.0,
    "flood": false,
    "mist": false,
    "probe_tripped": false,
    "probing": false,
    "probed_position": [0.0, 0.0, 0.0]
  },
  "errors": [],
  "clients": [
    {"ip": "192.168.1.42", "armed": true},
    {"ip": "192.168.1.10", "armed": false}
  ],
  "probe_results": {
    "x_minus": 10.5, "x_plus": 20.3,
    "y_minus": 5.0, "y_plus": 15.2,
    "z_minus": -3.5,
    "diameter": 25.4, "x_width": 50.0, "y_width": 30.0,
    "x_center": 15.4, "y_center": 10.1,
    "edge_angle": 0.0, "edge_delta": 0.0
  }
}
```

#### `viewer_gcode`
G-code toolpath preview (sent when active file changes):
```json
{
  "type": "viewer_gcode",
  "data": {
    "file": "/path/to/file.ngc",
    "feed": [[x, y, z], ...],
    "rapid": [[x, y, z], ...]
  }
}
```

#### `reply`
Command response:
```json
{
  "type": "reply",
  "ok": true
}
```

### Client Commands

Send JSON messages to control the machine:

#### Arming
```json
{"cmd": "arm", "armed": true}
```

#### Heartbeat
Clients should send a heartbeat every 1 second. If the gateway doesn't receive a heartbeat from an armed client within 3 seconds, it will stop all motion and disarm the connection.
```json
{"cmd": "heartbeat"}
```

#### E-stop Control
```json
{"cmd": "estop"}
{"cmd": "estop_reset"}
```

#### Machine Power
```json
{"cmd": "machine_on"}
{"cmd": "machine_off"}
```

#### Abort
```json
{"cmd": "abort"}
```

#### MDI Commands
```json
{"cmd": "mdi", "text": "G0 X10 Y20"}
```

#### Auto Run
```json
{"cmd": "auto_run", "line": 0}
```

#### Jogging
```json
{"cmd": "jog_cont", "axis": 0, "vel": 100.0}
{"cmd": "jog_stop", "axis": 0}
{"cmd": "jog_cont_multi", "axes": [{"axis": 0, "vel": 70.7}, {"axis": 1, "vel": 70.7}]}
{"cmd": "jog_stop_multi", "axes": [0, 1]}
```

**Axis mapping**: 0=X, 1=Y, 2=Z, etc.

#### Homing & Mode
```json
{"cmd": "home_all"}
{"cmd": "unhome_all"}
{"cmd": "teleop_enable"}
{"cmd": "teleop_disable"}
```

#### Spindle Control
```json
{"cmd": "spindle_forward", "speed": 1000}
{"cmd": "spindle_reverse", "speed": 1000}
{"cmd": "spindle_stop"}
```

#### Overrides
```json
{"cmd": "set_feed_override", "scale": 1.0}
{"cmd": "set_spindle_override", "scale": 1.0}
{"cmd": "set_rapid_override", "scale": 1.0}
{"cmd": "set_max_velocity", "velocity": 100.0}
```

**Scale ranges**:
- Feed: 0.0-2.0 (0-200%)
- Spindle: 0.5-2.0 (50-200%)
- Rapid: 0.0-1.0 (0-100%)

#### Coolant
```json
{"cmd": "flood_on"}
{"cmd": "flood_off"}
{"cmd": "mist_on"}
{"cmd": "mist_off"}
```

#### Probing
```json
{"cmd": "set_probe_vars", "vars": {"3014": 50.0, "3015": 5.0}}
{"cmd": "get_probe_vars", "nums": ["3014", "3015", "3032"]}
{"cmd": "list_probe_macros"}
{"cmd": "simulate_probe_trip"}
```

`set_probe_vars` writes variables to the LinuxCNC parameter file and sets them via MDI. `probe_results` (including `cal_offset`) are parsed in real-time from ProbeBasic's `DEBUG EVAL` messages on the LinuxCNC error channel and included in `status` messages automatically.

### Error Handling

All commands return a reply:
```json
{
  "type": "reply",
  "ok": false,
  "error": "Cannot Machine On while in E-stop"
}
```

### Safety System

The gateway implements three layers of safety to handle connection loss during machine operation. Motion commands are gated by `require_armed()` (server-side check on every command). The HAL `connected` pin gates machine power — it tracks whether any web client is connected (not whether anyone is armed).

#### HAL E-Stop Chain

The HAL config inserts three AND gates, a retriggerable `oneshot` monostable, and a trip-latch pin into the e-stop loop:

```
user-enable-out ──┐
                  AND2.0 ──┐
connected ────────┘        AND2.1 ──┐
oneshot.0.out ─────────────┘        AND2.2 ──► emc-enable-in
trip-latch ─────────────────────────┘
```

Machine stays enabled only when ALL FOUR: user hasn't pressed e-stop, at least one web client is connected, the gateway heartbeat is alive (`oneshot.0.out` TRUE), AND no watchdog trip is latched (`trip-latch` TRUE). `oneshot` is retriggerable — each heartbeat edge restarts its 0.5 s pulse, so it self-heals when edges resume; `trip-latch` is the operator-cleared latch that turns a transient stall into a real ESTOP.

#### Layer Behavior

| Trigger | Gateway action | `connected` pin | LinuxCNC state |
|---------|---------------|----------------|----------------|
| Armed client, normal operation | heartbeat toggles at 30Hz | TRUE | ON |
| Clients connected, **none armed** | heartbeat toggles at 30Hz | TRUE | **ON** |
| Last client disconnects | 3s grace period: heartbeat keeps toggling | TRUE (grace) | **ON** |
| Grace period expires, no reconnect | pins drop | FALSE | **OFF** |
| Page refresh (reconnect within 3s) | grace cancelled on reconnect | TRUE | **ON** |
| Heartbeat timeout (armed), other clients exist | force-disarm + `abort()` + `jog_stop()` | TRUE | ON |
| Heartbeat timeout (armed), last client | force-disarm + `abort()` + `jog_stop()` → grace starts | TRUE (grace) | ON |
| Gateway crashes | `hal_watchdog.py` detects socket close → resets all pins | FALSE | **ESTOP** |
| Gateway freezes or stalls (≥0.5 s) | heartbeat stops → `oneshot.0.out` drops FALSE → `trip-latch` drops FALSE (independent edge counter in `hal_watchdog.py`) | TRUE | **ESTOP (latched)** |
| User presses E-Stop | `CMD.state(ESTOP)` + forces `connected: false` | FALSE (transient) | **ESTOP** |

Recovery: clear E-Stop → (`estop_reset` also sends `trip_reset` IPC, releasing `trip-latch`) → Acknowledge the safety-trip banner → Arm → Machine On. Motion commands still require `require_armed()`. The banner persists across reloads and multiple clients — cleared server-side by `safety_trip_ack`.

**Layer 1 — Disconnect Handler**: When an armed WebSocket client disconnects (browser closed, network drop), the gateway immediately sends `jog_stop` for all axes and `abort` to halt any running program.

**Layer 2 — Heartbeat Watchdog**: The client sends `{"cmd": "heartbeat"}` every 1 second. If the gateway doesn't receive a heartbeat from an armed client within 3 seconds (e.g., browser freeze, WiFi stall), it stops all motion and disarms the connection. The client receives an error message: `"Heartbeat timeout — disarmed for safety"`.

**Layer 3 — HAL Watchdog**: A standalone `hal_watchdog.py` component is loaded by LinuxCNC via the HAL config (not spawned by the gateway). It creates HAL pins and listens on a Unix socket (`/tmp/webui-safety.sock`). The gateway connects to this socket as a client and sends pin updates. A retriggerable `oneshot` comp monitors the heartbeat pin — each heartbeat edge restarts its 0.5 s pulse, so it self-heals when edges resume (unlike the stock `watchdog` component, which latches on trip and requires a FALSE→TRUE edge on `enable-in` to clear — fragile across gateway reconnects).

`hal_watchdog.py` also runs an independent 100 ms polling loop that edge-detects `oneshot.0.out` falling edges via its own `hb-ok-in` pin. Because it runs in a separate userspace process, it captures trip edges even when the gateway itself is frozen during the FALSE window. On every falling edge it increments `trip-count` and drops `trip-latch` FALSE — the latter is gated into the safety chain so LinuxCNC stays in ESTOP even after `oneshot.0.out` auto-heals. `trip-latch` is released only when the operator clicks E-Stop Reset (the gateway's `estop_reset` handler sends a `{"trip_reset": true}` IPC message to `hal_watchdog.py` before running `CMD.state(STATE_ESTOP_RESET)`).

| Pin | Type | Description |
|---|---|---|
| `webui-safety.heartbeat` | BIT OUT | Toggles at 30 Hz; drives `oneshot.0.in` (0.5 s retriggerable pulse) |
| `webui-safety.connected` | BIT OUT | TRUE when any web client is connected (or during 3 s grace period) |
| `webui-safety.hb-ok-in` | BIT IN | Fed from `oneshot.0.out`; falling edge detected inside `hal_watchdog.py` |
| `webui-safety.trip-count` | U32 OUT | Monotonic count of `oneshot.0.out` FALSE edges; gateway polls via `webui-monitor` |
| `webui-safety.trip-latch` | BIT OUT | Starts TRUE; falls FALSE on watchdog trip; released by `trip_reset` IPC (operator E-Stop Reset) |
| `webui-safety.compensation-enable` | BIT OUT | Enables surface compensation Z offsets |
| `webui-safety.compensation-method` | U32 OUT | Interpolation method (0=nearest, 1=linear, 2=cubic) |
| `webui-safety.tool-changed` | BIT OUT | Tool change confirmation from web UI |
| `oneshot.0.out` | BIT OUT | TRUE while heartbeat edges keep retriggering the 0.5 s pulse; FALSE on stall |

Because `hal_watchdog.py` and `oneshot` are owned by LinuxCNC, the HAL pins (and `trip-latch` state) survive gateway restarts. If the gateway crashes or disconnects, `hal_watchdog.py` forces `connected`/`heartbeat` pins LOW, triggering ESTOP through the safety chain. If the gateway stalls, `oneshot.0.out` drops FALSE and the edge counter latches `trip-latch` FALSE independently.

#### Setting Up the HAL Watchdog

Add the following to a **HALFILE** in your LinuxCNC config (runs after the core HAL config that creates the e-stop loopback):

```hal
# 1. Load the hal_watchdog userspace component (owned by LinuxCNC)
loadusr -Wn webui-safety /path/to/lcnc-suite/lcnc-gateway/hal_watchdog.py

# 2. Heartbeat monostable: trips if gateway stops toggling heartbeat (freeze detection).
#    Retriggerable — each edge restarts the 0.5s pulse. Self-healing: when edges
#    resume after a stall, out returns HIGH on the next edge.
loadrt oneshot count=1
addf oneshot.0 servo-thread
setp oneshot.0.width 0.5
setp oneshot.0.retriggerable 1
setp oneshot.0.rising 1
setp oneshot.0.falling 1
net webui-heartbeat webui-safety.heartbeat => oneshot.0.in

# 3. Create three AND gates for the e-stop chain (oneshot self-heals, trip-latch latches)
loadrt and2 count=3
addf and2.0 servo-thread
addf and2.1 servo-thread
addf and2.2 servo-thread

# 4. Break the existing e-stop loopback (adapt to your config)
#    For sim configs this is typically:
#      net estop-loop iocontrol.0.user-enable-out iocontrol.0.emc-enable-in
unlinkp iocontrol.0.emc-enable-in

# 5. Wire the safety chain: ALL FOUR conditions must be TRUE
#    - AND2.0: e-stop clear + client connected
#    - AND2.1: AND2.0 output + heartbeat alive (oneshot.0.out)
#    - AND2.2: AND2.1 output + trip-latch (operator-cleared latch)
net estop-loop                              => and2.0.in0
net webui-connected webui-safety.connected  => and2.0.in1
net estop-connected and2.0.out              => and2.1.in0
net webui-hb-ok oneshot.0.out               => and2.1.in1
# Feed oneshot.0.out into webui-safety so the independent userspace process
# can edge-detect FALSE trips even when the gateway itself is frozen.
net webui-hb-ok                             => webui-safety.hb-ok-in
net hb-chain-ok and2.1.out                  => and2.2.in0
net webui-trip-latch webui-safety.trip-latch => and2.2.in1
net webui-estop-final and2.2.out            => iocontrol.0.emc-enable-in
```

**Notes for non-sim configs**: The `unlinkp` + AND2 approach above works for simple e-stop loopbacks (sim configs). On real machines, the e-stop chain is typically already a multi-input gate (e.g., `lut5` or `logic` component with personality bits). The preferred approach is to **expand the existing gate** by adding `webui-safety.connected`, `oneshot.0.out`, and `webui-safety.trip-latch` as additional inputs — no `unlinkp`, no extra AND2 components. For example, if your e-stop uses a `logic` component with personality `0x106` (6 inputs), change it to `0x109` (9 inputs) and wire the three webui conditions as inputs 6, 7, and 8.

**Startup order does not matter**: The gateway and LinuxCNC can start in any order. The gateway retries the webui-safety socket connection automatically. `trip-latch` defaults TRUE at component creation, `connected`/`heartbeat` default FALSE until the gateway connects and reports an armed client. `hal_watchdog.py` initializes its edge detector to skip the first read so the initial FALSE state of `oneshot.0.out` (before the first heartbeat) does not register as a phantom trip.

**Monitoring**: Use `halcmd` to inspect the safety pins at runtime:
```bash
halcmd show pin webui-safety
halcmd show pin oneshot
halcmd show sig webui-connected
halcmd show sig webui-hb-ok
halcmd show sig webui-trip-latch
halcmd show sig webui-estop-final
```

## Building Your Own UI

The gateway is completely UI-agnostic. To build your own interface:

1. **Connect to WebSocket**: `ws://<gateway-host>:8000/ws`
2. **Receive `viewer_init`**: Get machine configuration
3. **Receive `status` messages**: Update your UI @ 30 Hz
4. **Send commands**: Control the machine via JSON messages
5. **Handle replies**: Process command responses and errors

Example minimal client:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch(msg.type) {
    case 'viewer_init':
      console.log('Machine config:', msg.data);
      break;
    case 'status':
      console.log('Position:', msg.data.work_pos);
      break;
    case 'reply':
      console.log('Command result:', msg.ok);
      break;
  }
};

// Arm the connection
ws.send(JSON.stringify({cmd: 'arm', armed: true}));

// Send MDI command
ws.send(JSON.stringify({cmd: 'mdi', text: 'G0 X10'}));
```

## Development

### Gateway Development

```bash
cd lcnc-gateway
source .venv/bin/activate

# Run with auto-reload
uvicorn gateway:app --reload --host 127.0.0.1 --port 8000
```

### UI Development

```bash
cd lcnc-webui
npm run dev
```

The Vite dev server provides hot module replacement for rapid development.

## LinuxCNC Configuration

The gateway reads settings from the active LinuxCNC INI file at runtime. This section documents all the INI keys, HAL wiring, and subroutine paths needed for full functionality.

### INI Settings

All velocity values are in **machine units per second** (mm/s or in/s). The gateway auto-detects configs that accidentally use units/minute and converts them.

#### `[TRAJ]`

| Key | Required | Description |
|-----|----------|-------------|
| `LINEAR_UNITS` | yes | Machine units: `mm` or `inch` |
| `MAX_LINEAR_VELOCITY` | yes | Trajectory planner max velocity (used as jog limit fallback) |

#### `[DISPLAY]`

| Key | Required | Description |
|-----|----------|-------------|
| `DEFAULT_LINEAR_VELOCITY` | recommended | Default jog speed |
| `MAX_LINEAR_VELOCITY` | recommended | Maximum jog speed (slider upper bound) |
| `MIN_LINEAR_VELOCITY` | recommended | Minimum jog speed (slider lower bound) |
| `INCREMENTS` | recommended | Jog increment steps (e.g. `5mm 1mm .5mm .1mm .05mm .01mm .005mm`) |
| `DEFAULT_SPINDLE_SPEED` | recommended | Default RPM for spindle input |
| `MAX_FEED_OVERRIDE` | recommended | Feed override upper limit (e.g. `2.0` = 200%) |
| `MIN_SPINDLE_OVERRIDE` | recommended | Spindle override lower limit (e.g. `0.5` = 50%) |
| `MAX_SPINDLE_OVERRIDE` | recommended | Spindle override upper limit (e.g. `2.0` = 200%) |
| `PROGRAM_PREFIX` | recommended | Root directory for the G-code file browser |
| `DEBUG` | required | Subroutine debug logging — must be present or `tool_touch_off.ngc` aborts with "not defined". Set `0` to disable, `1` to write `logfile.txt` |
| `CAMERA_SOURCE` | optional | USB device index (`0`, `1`) or URL (`rtsp://host/live`) — empty = disabled |
| `CAMERA_RESOLUTION` | optional | Capture resolution `WxH` (default: `1280x720`, USB only) |
| `CAMERA_FPS` | optional | MJPEG stream frame rate (default: `15`) |

#### `[SPINDLE_0]`

| Key | Required | Description |
|-----|----------|-------------|
| `MAX_FORWARD_VELOCITY` | recommended | Maximum spindle RPM (slider upper bound) |
| `MIN_FORWARD_VELOCITY` | optional | Minimum spindle RPM |

The gateway checks `SPINDLE_0` through `SPINDLE_9` and uses the first section found.

#### `[AXIS_X]`, `[AXIS_Y]`, `[AXIS_Z]`

| Key | Required | Description |
|-----|----------|-------------|
| `MIN_LIMIT` | yes | Axis minimum travel — used for 3D viewer machine bounds |
| `MAX_LIMIT` | yes | Axis maximum travel — used for 3D viewer machine bounds |

Falls back to `[JOINT_N]` limits if `[AXIS_*]` is not present.

#### `[EMCIO]`

| Key | Required | Description |
|-----|----------|-------------|
| `TOOL_TABLE` | yes | Path to tool table file (e.g. `tool.tbl`) |

#### `[RS274NGC]`

| Key | Required | Description |
|-----|----------|-------------|
| `PARAMETER_FILE` | yes | Var file for WCS offsets, probe variables (#3000+), and toolsetter settings (#3100–#3115) |
| `SUBROUTINE_PATH` | yes (for probing) | Colon-separated paths — gateway scans these for `probe_*.ngc` macros |
| `ON_ABORT_COMMAND` | recommended | `O<on_abort> call` — required by probe_basic to re-enable overrides after abort |
| `REMAP=M600` | for tool change | `modalgroup=6 ngc=m600` — manual tool change via web UI |
| `REMAP=M601` | for tool change | `modalgroup=6 ngc=m601` — tool unload via web UI |
| `FEATURES` | recommended | `12` enables `#<named>` parameters and expression evaluation |

Example `[RS274NGC]` section:

```ini
[RS274NGC]
RS274NGC_STARTUP_CODE = F100 S50 G21 G17 G40 G49 G54 G64 P0.001 G80 G90 G91.1 G92.1 G94 G97 G98
PARAMETER_FILE = sim.var
OWORD_NARGS = 1
NO_DOWNCASE_OWORD = 1
SUBROUTINE_PATH = /path/to/lcnc-suite/subroutines/probe_basic:/path/to/lcnc-suite/subroutines/tool_length_probe:/path/to/lcnc-suite/subroutines/surfacemap
ON_ABORT_COMMAND = O<on_abort> call
REMAP=M600 modalgroup=6 ngc=m600
REMAP=M601 modalgroup=6 ngc=m601
USER_M_PATH = ./
FEATURES = 12
```

### HAL Configuration

The gateway communicates with LinuxCNC through a HAL watchdog component. See [Setting Up the HAL Watchdog](#setting-up-the-hal-watchdog) above for the e-stop AND gate wiring.

Additional HAL signals used by the gateway:

```hal
# Tool change: web UI drives the ack back to LinuxCNC
# On real machines, replace the auto-loopback (net tool-change-loop iocontrol.0.tool-change iocontrol.0.tool-changed)
# with these two nets so the web UI confirms each change:
net tool-change-confirmed <= webui-safety.tool-changed
net tool-change-confirmed => iocontrol.0.tool-changed
# Tool prep is still auto-looped (no UI interaction needed):
net tool-prep-loop iocontrol.0.tool-prepare iocontrol.0.tool-prepared

# Surface compensation (optional — requires surfacemap subroutine)
net compensation-on  webui-safety.compensation-enable => compensation.enable-in
net comp-method      webui-safety.compensation-method => compensation.method

# Program elapsed timer (optional)
loadrt time
loadrt not
addf time.0 servo-thread
addf not.0 servo-thread
net prog-running not.0.in <= halui.program.is-idle
net prog-paused halui.program.is-paused => time.0.pause
net cycle-timer time.0.start <= not.0.out
```

The HAL pins the gateway reads at runtime:

| Pin | Description |
|-----|-------------|
| `spindle.0.speed-in` | Actual spindle speed (RPS or RPM depending on config — see below) |
| `iocontrol.0.tool-change` | Tool change request from interpreter |
| `iocontrol.0.tool-prep-number` | Requested tool number during tool change |
| `axis.z.eoffset` | Current Z external offset (surface compensation) |
| `axis.z.eoffset-enable` | Whether compensation is active |
| `compensation.method` | Active interpolation method (0=nearest, 1=linear, 2=cubic) |
| `compensation.grid-version` | Increments each time compensation grid is recomputed — triggers UI refresh |
| `motion.probe-input` | Current probe input state (TRUE = tripped) |

> **Note:** The gateway automatically creates an internal HAL component called `webui-monitor` that wires these pins for efficient direct reads. It is visible in `halcmd show comp` but requires no manual configuration — it is created and wired automatically at startup.

#### Spindle Feedback

The gateway reads `spindle.0.speed-in` for actual spindle speed display. LinuxCNC defines this pin as **RPS** (revolutions per second), so by default the gateway multiplies by 60 to display RPM. However, some VFD drivers and encoder configurations output **RPM** directly on this pin.

**Settings → Machine → Spindle Feedback Unit** lets you select:
- **RPS (default)** — pin outputs revolutions per second (×60 for display). Correct for simulators and standard LinuxCNC configs.
- **RPM** — pin outputs RPM directly (×1). Use this if your VFD or `cia402` component scales to RPM.

**No encoder/VFD feedback?** If your machine has no speed feedback, `spindle.0.speed-in` stays at 0 and the UI shows 0 RPM actual. To display commanded speed instead, wire the commanded output to the feedback pin in your HAL config:

```hal
net spindle-speed-faked spindle.0.speed-out-rps => spindle.0.speed-in
```

A complete working example is in the sim config at `hallib/lcnc_webui.hal` (referenced by the sim INI).

### Subroutines

The `[RS274NGC] SUBROUTINE_PATH` must include paths to the subroutine directories you use:

| Directory | Contents | Required |
|-----------|----------|----------|
| `subroutines/probe_basic/` | 62 probing .ngc files + `on_abort.ngc` | yes (for probing) |
| `subroutines/tool_length_probe/` | Tool length measurement (`m600.ngc`, `m601.ngc`, `tool_touch_off.ngc`) | for toolsetter |
| `subroutines/surfacemap/` | Surface scanning + `compensation.py` | for surface compensation |

`on_abort.ngc` ships in `subroutines/probe_basic/` and handles cleanup on program abort (spindle off, coolant off, re-enable overrides). It is called by the `ON_ABORT_COMMAND` INI setting.

### Machine Model (`machine.json`)

The 3D viewer loads a machine model defined in `lcnc-gateway/machine/machine.json`. This file describes the kinematic hierarchy, STL parts, and how joints drive the model.

STL files are stored alongside `machine.json` in `lcnc-gateway/machine/` and tracked with Git LFS (see `.gitattributes`).

#### Schema

```json
{
  "name": "Machine display name",
  "groups": [
    { "id": "group_id", "parent": "root", "translate": [x, y, z] }
  ],
  "parts": [
    { "id": "part_id", "file": "model.stl", "group": "group_id", "translate": [x, y, z], "rotate": [rx, ry, rz] }
  ],
  "kinematics": [
    { "group": "group_id", "joint": 0, "type": "translate", "direction": "x", "sign": 1 }
  ],
  "workGroup": "group_id",
  "toolGroup": "group_id"
}
```

| Field | Description |
|-------|-------------|
| `name` | Display name for the machine |
| `groups` | Hierarchical assembly tree. Each group has an `id` and `parent` (use `"root"` for the top level). Optional `translate` sets a static pivot offset (e.g., rotary axis center). |
| `parts` | STL meshes. `file` is relative to `machine/`. `group` assigns the part to a group (`null` = fixed frame). `translate` and `rotate` (Euler angles) are optional static offsets. |
| `kinematics` | Maps LinuxCNC joints to group transforms. `joint` is the joint index from `joint_pos`. `type` is `"translate"` (default) or `"rotate"`. `direction` is `"x"`, `"y"`, or `"z"`. `sign` flips the direction (1 or -1). For arbitrary rotation axes, use `"axis": [x, y, z]` instead of `direction`. |
| `workGroup` | Which group represents the workpiece/bed. DRO origin, backplot, and toolpath attach here. |
| `toolGroup` | Which group represents the tool holder. Tool offset compensation is applied here. |

Parent-child relationships in `groups` create a scene graph — transforms cascade automatically. A child group inherits all parent transforms, so a tool mounted on a Z carriage that rides on a Y saddle moves correctly without manual composition.

#### Example: 3-Axis Mill

```json
{
  "name": "3-Axis Mill",
  "groups": [
    { "id": "x", "parent": "root" },
    { "id": "y", "parent": "root" },
    { "id": "z", "parent": "y" },
    { "id": "tool", "parent": "z" }
  ],
  "parts": [
    { "id": "frame",  "file": "frame.stl",  "group": null, "translate": [-760, -122, -294] },
    { "id": "x_axis", "file": "x_axis.stl", "group": "x",  "translate": [319, 398, -244] },
    { "id": "y_axis", "file": "y_axis.stl", "group": "y",  "translate": [-140, 0, 21] },
    { "id": "z_axis", "file": "z_axis.stl", "group": "z",  "translate": [0, 0, 0] }
  ],
  "kinematics": [
    { "group": "x", "joint": 0, "direction": "x", "sign": -1 },
    { "group": "y", "joint": 1, "direction": "y", "sign":  1 },
    { "group": "z", "joint": 2, "direction": "z", "sign":  1 }
  ],
  "workGroup": "x",
  "toolGroup": "tool"
}
```

Hierarchy: `root → x` (bed moves in X), `root → y → z → tool` (column moves in Y, head in Z, tool at tip). The `workGroup` is `"x"` because the workpiece sits on the X table.

#### Example: Cross-Table Mill (X+Y table, Z spindle)

```json
{
  "name": "Cross-Table Mill",
  "groups": [
    { "id": "x", "parent": "root" },
    { "id": "y", "parent": "x" },
    { "id": "z", "parent": "root" },
    { "id": "tool", "parent": "z" }
  ],
  "parts": [
    { "id": "frame",   "file": "frame.stl",   "group": null },
    { "id": "x_table", "file": "x_table.stl", "group": "x" },
    { "id": "y_table", "file": "y_table.stl", "group": "y" },
    { "id": "z_head",  "file": "z_head.stl",  "group": "z" }
  ],
  "kinematics": [
    { "group": "x", "joint": 0, "direction": "x", "sign": 1 },
    { "group": "y", "joint": 1, "direction": "y", "sign": 1 },
    { "group": "z", "joint": 2, "direction": "z", "sign": 1 }
  ],
  "workGroup": "y",
  "toolGroup": "tool"
}
```

Hierarchy: `root → x → y` (table moves in X, then Y on top of X), `root → z → tool` (spindle only moves in Z). The `workGroup` is `"y"` because the workpiece sits on the Y table — the innermost table group that carries the work.

#### Example: 5-Axis Mill with Trunnion Table (A+C)

```json
{
  "name": "5-Axis Trunnion Mill",
  "groups": [
    { "id": "y", "parent": "root" },
    { "id": "z", "parent": "y" },
    { "id": "tool", "parent": "z" },
    { "id": "a_trunnion", "parent": "root", "translate": [150, 200, 50] },
    { "id": "c_table", "parent": "a_trunnion" }
  ],
  "parts": [
    { "id": "frame",    "file": "frame.stl",    "group": null },
    { "id": "y_saddle", "file": "y_saddle.stl", "group": "y" },
    { "id": "z_head",   "file": "z_head.stl",   "group": "z" },
    { "id": "trunnion", "file": "trunnion.stl",  "group": "a_trunnion" },
    { "id": "rotary",   "file": "c_table.stl",   "group": "c_table" }
  ],
  "kinematics": [
    { "group": "y", "joint": 1, "direction": "y", "sign": 1 },
    { "group": "z", "joint": 2, "direction": "z", "sign": 1 },
    { "group": "a_trunnion", "joint": 3, "type": "rotate", "direction": "x", "sign": 1 },
    { "group": "c_table",    "joint": 4, "type": "rotate", "direction": "z", "sign": 1 }
  ],
  "workGroup": "c_table",
  "toolGroup": "tool"
}
```

The trunnion's `translate` positions the A-axis rotation center. The C table is a child of the A trunnion, so it inherits the tilt — no manual rotation composition needed. `workGroup` is `"c_table"` because the workpiece sits on the rotating table.

#### Kinematics Types

| Type | Description | Example |
|------|-------------|---------|
| `translate` (default) | Drives `group.position[direction]` | Linear axes X, Y, Z, U, V, W |
| `rotate` with `direction` | Drives `group.rotation[direction]` (degrees) | A rotates around X, B around Y, C around Z |
| `rotate` with `axis` | Drives rotation around arbitrary vector | `"axis": [0, 0.707, 0.707]` for a 45° tilted axis |

### Polling Rate

Adjust `POLL_HZ` in `gateway.py` (default: 30 Hz).

## Project Structure

```
lcnc-suite/
├── lcnc-gateway/              # Backend WebSocket gateway
│   ├── gateway.py             # FastAPI application
│   ├── hal_watchdog.py        # HAL safety component (loaded by LinuxCNC)
│   ├── requirements.txt       # Python dependencies
│   ├── setup-venv.sh          # Virtual environment setup
│   ├── settings.json          # Server-side settings (auto-created, per-INI)
│   ├── tool_library.json      # Extended tool metadata (auto-created)
│   └── machine/               # Machine model config + STL files (Git LFS)
│       ├── machine.json       # Kinematic hierarchy and part definitions
│       └── *.stl              # STL mesh files for machine components
├── lcnc-webui/                # Reference Vue 3 UI
│   ├── src/
│   │   ├── App.vue            # Root component, state, layout, action strip
│   │   ├── permissions.ts     # Centralized permission system (14 classes)
│   │   ├── machineControls.ts # Machine controls catalog (BUTTON_TYPES + INPUT_DEFS)
│   │   ├── defaults.ts        # Persistent settings (section registry, server sync)
│   │   ├── lcnc.ts            # LinuxCNC constants and WsCommand types
│   │   ├── lcncWs.ts          # WebSocket client with heartbeat
│   │   ├── lcncApi.ts         # REST API helpers (file ops, settings)
│   │   ├── format.ts          # Shared formatters (coordinates, RPM, time, size)
│   │   ├── toolTypes.ts       # Tool type labels (18 types)
│   │   ├── gcodeHighlight.ts  # G-code syntax tokenizer + highlighter
│   │   ├── useGamepad.ts      # Gamepad polling composable (analog + buttons)
│   │   ├── gcodeReference.ts  # G/M-code reference data + lookup map
│   │   ├── main.ts            # App bootstrap with settings migration
│   │   ├── style.css          # Global styles, design tokens, theme vars
│   │   ├── Gate.vue           # Permission gate (<fieldset :disabled>)
│   │   ├── MachineBtn.vue     # Catalog-aware button (wraps Btn.vue)
│   │   ├── MachineInput.vue   # Catalog-aware input (+ Toggle/Slider/Select/Radio/Color)
│   │   ├── SafetyStrip.vue    # Bottom strip: Arm/Disarm, E-Stop, Machine On/Off
│   │   ├── JogStrip.vue       # Bottom strip: jog wheel, speed slider, increments
│   │   ├── SetupStrip.vue     # Bottom strip: DRO, touchoff, homing, WCS selector
│   │   ├── OverridesStrip.vue # Bottom strip: Feed/Spindle/Rapid sliders
│   │   ├── SpindleStrip.vue   # Bottom strip: FWD/REV/STOP, RPM, coolant
│   │   ├── ToolStrip.vue      # Bottom strip: load/unload/measure, metadata
│   │   ├── TabPanel.vue       # Tab selector for content panels
│   │   ├── Toolbar.vue        # 3D viewer toolbar (view presets, layer toggles)
│   │   ├── ThreeViewer.vue    # 3D machine visualization (Three.js)
│   │   ├── DroPanel.vue       # Digital readout with G5x, zero, home
│   │   ├── JogPanel.vue       # Jog wheel + speed/increment controls
│   │   ├── GcodePanel.vue     # G-code viewer + editor + program controls
│   │   ├── GcodeReferenceDialog.vue # Searchable G/M-code reference dialog
│   │   ├── ProbePanel.vue     # Probe operations + calibration + results
│   │   ├── ToolTablePanel.vue # Tool table editor with library metadata
│   │   ├── ToolPreview.vue    # 2D tool side-view preview (Three.js)
│   │   ├── OffsetPanel.vue    # WCS offset table editor (G54–G59.3)
│   │   ├── CameraPip.vue      # Camera PiP overlay with SVG crosshair (MJPEG)
│   │   ├── SettingsPanel.vue  # Application settings (sub-tabbed)
│   │   └── DebugTab.vue       # Debug/diagnostics tab
│   └── package.json
├── subroutines/               # G-code subroutines (bundled)
│   ├── probe_basic/           # Probing routines (from kcjengr/probe_basic, GPL v3)
│   ├── tool_length_probe/     # Tool measurement (from TooTall18T, GPL v3)
│   └── surfacemap/            # Surface scanning + compensation (from mhubig/surfacemap_usertab, GPL v2+)
├── lcnc-suite                 # LinuxCNC DISPLAY launcher (symlink to ~/.local/bin/)
├── restart.sh                 # Start/restart gateway + web UI (standalone)
├── kill.sh                    # Stop gateway + web UI
├── install.sh                 # Automated dependency installer
├── runlogs/                   # Application logs
└── README.md
```

## Contributing

Contributions welcome! This project is designed to be extensible:

- **Gateway enhancements**: Add new commands, improve status data
- **Alternative UIs**: Build interfaces for different platforms
- **Machine models**: Contribute STL models for common machines
- **Documentation**: Improve API docs and examples

## License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0).
See the [LICENSE](LICENSE) file for the full text.

This project uses subroutines from [ProbeBasic](https://github.com/kcjengr/probe_basic)
(Chris P / kcjengr) and [tool_length_probe](https://github.com/TooTall18T/tool_length_probe)
(TooTall18T), both licensed under GPL v3, and the surface compensation component from
[LinuxCNC-3D-Printing](https://github.com/scottalford75/LinuxCNC-3D-Printing) (Scott Alford),
licensed under GPL v2. See [NOTICE](NOTICE) for full attribution.

**THIS SOFTWARE IS PROVIDED WITHOUT WARRANTY OF ANY KIND. THIS SOFTWARE IS
INTENDED FOR USE WITH POTENTIALLY DANGEROUS EQUIPMENT. BY USING THIS SOFTWARE,
YOU ACCEPT ALL RISKS AND AGREE THAT THE AUTHORS BEAR NO RESPONSIBILITY FOR ANY
INJURIES, DEATHS, PROPERTY DAMAGE, OR OTHER LOSSES THAT MAY RESULT FROM ITS USE.**

## Acknowledgments

Built on top of the excellent [LinuxCNC](https://linuxcnc.org) project.

---

**Note**: This is an independent project and is not officially affiliated with LinuxCNC.
