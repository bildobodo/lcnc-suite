# LCNC Suite

A modern, UI-agnostic WebSocket gateway for LinuxCNC with a reference Vue 3 web interface.

## Table of Contents

- [Overview](#overview)
- [Safety and Liability Disclaimer](#%EF%B8%8F-safety-and-liability-disclaimer)
- [Features](#features)
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
- [Configuration](#configuration)
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
  - Connection-level arming to prevent accidental commands
  - Disconnect handler: stops all motion when an armed client disconnects
  - Heartbeat watchdog: client sends 1 s heartbeat; gateway disarms after 3 s timeout
  - HAL watchdog: `webui-safety` HAL component with `heartbeat` and `connected` pins for hardware-level estop integration
- **Client Tracking**: Connected clients with IP and armed state, visible to all sessions
- **Auto-Reconnect**: Detects LinuxCNC restart and reconnects without gateway restart
- **3D Visualization Support**: Machine model, kinematics, G-code preview
- **Position Tracking**: Machine, work, and joint coordinates with full offset handling
- **Tool Management**: Tool number, diameter, and length offset tracking
- **G-code Parser**: Preview generator for feed and rapid moves (G0/G1/G2/G3)
- **G-code File Management**: Upload, browse, and load G-code files via REST API
- **Probe Support**: 1 Hz polling of probe variables (#3032 cal offset) and probe result HAL pins (M68 analog outputs E0-E11)
- **Error Channel**: Real-time LinuxCNC error/message forwarding
- **STL Model Serving**: Static file server for 3D machine models

### Reference UI (lcnc-webui)

- Modern Vue 3 + TypeScript single-page interface
- Real-time DRO with G5x work coordinate selector and DTG display
- XY + Z jogging with diagonal support and World/Joint mode toggle
- Keyboard jog with visual key highlights and incremental jog mode
- Sidebar spindle popover (FWD/REV/STOP, RPM input, live actual speed, override slider)
- Feed, spindle, and rapid override popovers with sliders and presets
- MDI command interface with history
- G-code file browser with drag-and-drop upload
- G-code viewer with syntax highlighting, program controls, and progress bar
- 3D machine visualization with Three.js (colorized toolpath, backplot, HUD overlays)
- Probe panel with 6 views: Outside/Inside Corners (3x3 grid), Boss/Pocket, Ridge/Valley, Edge Angle, and Calibrate (round/rect)
- Probe results grid (X/Y/Z probed, diameter, width, center, edge angle) from HAL analog output pins
- Calibration offset display with reset in always-visible control bar
- HUD overlay pills on 3D viewer: jog, gcode, spindle, override, and setup controls
- Centralized permission system via Vue provide/inject — all button enable/disable logic defined once:

| Class | Rule | Buttons / Actions |
|-------|------|-------------------|
| `idle` | base, idle, not busy | Home All, Unhome, Zero X/Y/Z, Zero All, G5x select, file Reload/Unload/Browse/Upload |
| `jog` | base, idle, homed | Jog X+/X-/Y+/Y-/Z+/Z-, speed slider, increment select, teleop toggle, keyboard jog |
| `override` | base, not busy | Feed/Spindle/Rapid override sliders + presets, Reset All |
| `ready` | base, idle, not busy, homed | MDI input + Send, Cycle Start, Spindle FWD/REV/STOP, RPM input, Flood/Mist toggle, all probe buttons + inputs |
| `pause` | base, running, not paused | Pause |
| `resume` | base, paused | Resume |
| `abort` | armed | Abort |

`base` = armed, not estopped, enabled

- Persistent settings (colors, opacities, layers, workpiece defaults)
- Responsive auto-layout (1–4 panels based on viewport) with portrait and landscape modes
- Connected clients display with IP and armed status
- Dynamic connection label (local vs. LAN hostname)
- Error/message panel with unread count badge

## Requirements

### Gateway
- LinuxCNC 2.8+ with Python bindings
- Python 3.9+
- Virtual environment with system-site-packages enabled

### Reference UI
- Node.js 18+ and npm

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/lcnc-suite.git
cd lcnc-suite
```

### 2. Setup Gateway

```bash
cd lcnc-gateway
./setup-venv.sh  # Creates venv with system-site-packages for LinuxCNC
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Setup Web UI (Optional)

```bash
cd ../lcnc-webui
npm install
```

## Quick Start

### Using the Launcher Script

The easiest way to run both services:

```bash
# Localhost only (default)
./restart.sh local

# Accessible from LAN
./restart.sh lan
```

The script will:
- Stop any existing instances
- Start the gateway on port 8000
- Start the web UI on port 5173
- Perform health checks
- Open your browser automatically

Logs are saved to `runlogs/`

### Manual Start

**Gateway:**
```bash
cd lcnc-gateway
source .venv/bin/activate
uvicorn gateway:app --host 127.0.0.1 --port 8000
```

**Web UI:**
```bash
cd lcnc-webui
npm run dev -- --host 127.0.0.1 --port 5173
```

## WebSocket API

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8000/ws');
```

### Server Messages

The gateway sends these message types:

#### `viewer_init`
Machine model configuration (sent once per connection):
```json
{
  "type": "viewer_init",
  "data": {
    "units": "mm",
    "stl_base_url": "http://localhost:8000/assets/",
    "machine_bounds": {
      "origin": [0, 0, 0],
      "size": [300, 200, 100]
    },
    "parts": [...],
    "kinematics": {...}
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
  "probe_vars": {"3032": 0.0123},
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

`set_probe_vars` writes variables to the LinuxCNC parameter file and sets them via MDI. `probe_vars` (#3032 cal offset) and `probe_results` (HAL analog output pins from probe subroutines) are polled at 1 Hz and included in `status` messages automatically.

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

The gateway implements three layers of safety to handle connection loss during machine operation:

**Layer 1 — Disconnect Handler**: When an armed WebSocket client disconnects (browser closed, network drop), the gateway immediately sends `jog_stop` for all axes and `abort` to halt any running program.

**Layer 2 — Heartbeat Watchdog**: The client sends `{"cmd": "heartbeat"}` every 1 second. If the gateway doesn't receive a heartbeat from an armed client within 3 seconds (e.g., browser freeze, WiFi stall), it stops all motion and disarms the connection. The client receives an error message: `"Heartbeat timeout — disarmed for safety"`.

**Layer 3 — HAL Watchdog**: A standalone `hal_watchdog.py` component is loaded by LinuxCNC via the HAL config (not spawned by the gateway). It creates two HAL pins and listens on a Unix socket (`/tmp/webui-safety.sock`). The gateway connects to this socket as a client and sends pin updates.

| Pin | Type | Description |
|---|---|---|
| `webui-safety.heartbeat` | BIT OUT | Toggles with each gateway heartbeat cycle |
| `webui-safety.connected` | BIT OUT | True when at least one armed client is connected |

Because the watchdog is owned by LinuxCNC, the HAL pins survive gateway restarts. If the gateway crashes or disconnects, the watchdog immediately forces both pins LOW, triggering e-stop through the safety chain.

#### Setting Up the HAL Watchdog

Add the following to your **POSTGUI_HALFILE** (runs after your main HAL config):

```hal
# 1. Load the watchdog component (owned by LinuxCNC)
loadusr -Wn webui-safety /path/to/lcnc-suite/lcnc-gateway/hal_watchdog.py

# 2. Create an AND gate for the e-stop chain
loadrt and2 count=1
addf and2.0 servo-thread

# 3. Break the existing e-stop loopback (adapt to your config)
#    For sim configs this is typically:
#      net estop-loop iocontrol.0.user-enable-out iocontrol.0.emc-enable-in
unlinkp iocontrol.0.emc-enable-in

# 4. Wire the AND gate: both conditions must be TRUE to leave e-stop
#    - Input 0: User has not pressed e-stop
#    - Input 1: An armed web client is connected
net estop-loop                    => and2.0.in0
net webui-connected webui-safety.connected => and2.0.in1
net estop-out and2.0.out          => iocontrol.0.emc-enable-in
```

**Notes for non-sim configs**: The `unlinkp` line must match whatever pin currently drives `iocontrol.0.emc-enable-in` in your setup. Check your existing HAL files to identify the current e-stop topology before inserting the AND gate.

**Startup order does not matter**: The gateway and LinuxCNC can start in any order. The gateway retries the watchdog socket connection automatically, and the watchdog defaults both pins to FALSE until the gateway connects and reports an armed client.

**Monitoring**: Use `halcmd` to inspect the safety pins at runtime:
```bash
halcmd show pin webui-safety
halcmd show sig webui-connected
halcmd show sig estop-out
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

## Configuration

### Machine Models

STL models are stored in `lcnc-gateway/machine/`:
- `frame.stl` - Machine base/frame
- `x_axis.stl` - X-axis assembly
- `y_axis.stl` - Y-axis assembly
- `z_axis.stl` - Z-axis assembly

Models are tracked with Git LFS (see `.gitattributes`).

### Kinematics

Edit the `build_viewer_init()` function in `gateway.py` to match your machine's kinematics and model transforms.

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
│   └── machine/               # STL machine models (Git LFS)
├── lcnc-webui/                # Reference Vue 3 UI
│   ├── src/
│   │   ├── App.vue            # Root component, state, layout, sidebar popovers
│   │   ├── permissions.ts     # Centralized button permission system
│   │   ├── defaults.ts        # Persistent settings (sections, localStorage)
│   │   ├── lcnc.ts            # LinuxCNC constants
│   │   ├── lcncWs.ts          # WebSocket client
│   │   ├── lcncApi.ts         # REST API helpers (file ops)
│   │   ├── Toolbar.vue        # Top toolbar with status + controls
│   │   ├── TabPanel.vue       # Tab selector for content panels
│   │   ├── ThreeViewer.vue    # 3D machine visualization
│   │   ├── ManualPanel.vue    # DRO + jogging + MDI (consolidated)
│   │   ├── DroPanel.vue       # Digital readout with G5x, zero, home
│   │   ├── JogPanel.vue       # Jog wheel + speed/increment controls
│   │   ├── JogButton.vue      # Reusable jog button
│   │   ├── GcodePanel.vue     # G-code viewer + program controls
│   │   ├── ProbePanel.vue     # Probe operations + calibration + results
│   │   ├── ToolTablePanel.vue # Tool table editor
│   │   ├── SettingsPanel.vue  # Application settings
│   │   ├── JogHUD.vue         # Jog overlay pill
│   │   ├── GcodeHUD.vue       # G-code overlay pill
│   │   ├── SpindleHUD.vue     # Spindle overlay pill
│   │   ├── OverrideHUD.vue    # Override overlay pill
│   │   └── SetupHUD.vue       # Setup overlay pill
│   └── package.json
├── restart.sh                 # Start/restart gateway + web UI
├── kill.sh                    # Stop gateway + web UI
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

MIT License with Safety Disclaimer

Copyright (c) 2025 [Your Name/Organization]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.**

**THIS SOFTWARE IS INTENDED FOR USE WITH POTENTIALLY DANGEROUS EQUIPMENT.
BY USING THIS SOFTWARE, YOU ACCEPT ALL RISKS AND AGREE THAT THE AUTHORS
BEAR NO RESPONSIBILITY FOR ANY INJURIES, DEATHS, PROPERTY DAMAGE, OR OTHER
LOSSES THAT MAY RESULT FROM ITS USE.**

## Acknowledgments

Built on top of the excellent [LinuxCNC](https://linuxcnc.org) project.

---

**Note**: This is an independent project and is not officially affiliated with LinuxCNC.
