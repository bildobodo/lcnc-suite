# lcnc-webui

Reference Vue 3 + TypeScript web interface for lcnc-gateway.

## Table of Contents

- [Development](#development)
- [Architecture](#architecture)
- [Permission System](#permission-system)
- [Panel Layout](#panel-layout)

## Development

```bash
npm install
npm run dev          # Dev server with HMR
npm run build        # Production build
npm run type-check   # TypeScript checking
```

## Architecture

```
App.vue                          Root — state, layout, sidebar popovers
├── Toolbar.vue                  Top bar: connection, arm, estop, enable
├── Sidebar                      Machine Safety, Machine Status, Controls
│   ├── Status chip popovers     Machine, Program, Overrides (click-to-toggle)
│   └── Controls section         Spindle button → popover with full controls
├── ThreeViewer.vue              3D viewer (Three.js)
│   ├── JogHUD.vue               Jog overlay pill
│   ├── GcodeHUD.vue             G-code overlay pill
│   ├── SpindleHUD.vue           Spindle overlay pill
│   ├── OverrideHUD.vue          Override overlay pill
│   └── SetupHUD.vue             Setup overlay pill (home, zero)
└── TabPanel.vue                 Content panel tab selector
    ├── ManualPanel.vue          DRO + jogging + MDI (consolidated)
    ├── GcodePanel.vue           G-code viewer + program controls
    ├── ToolTablePanel.vue       Tool table editor
    ├── SettingsPanel.vue        Colors, opacities, layers, workpiece
    └── MessagesPanel.vue        Error/message log
```

### Services

| File | Purpose |
|------|---------|
| `lcncWs.ts` | WebSocket client — status polling, command sending, heartbeat |
| `lcncApi.ts` | REST helpers — file listing, upload |
| `permissions.ts` | Centralized button permission system |

## Permission System

All button enable/disable logic is defined once in `permissions.ts` and distributed via Vue's provide/inject. Components never compute their own disable conditions — they reference a permission class.

See the [permission class table](../README.md#reference-ui-lcnc-webui) in the root README for the full rule and button matrix.

### Usage

```vue
<script setup>
import { usePermissions } from "./permissions";
const can = usePermissions();
</script>

<template>
  <button :disabled="!can.idle">Zero All</button>
  <button :disabled="!can.jog">Jog X+</button>
  <button :disabled="!can.override">Feed 100%</button>
</template>
```

`usePermissions()` returns a `ComputedRef<Permissions>` — auto-unwraps in templates, use `.value` in script.

## Panel Layout

Viewport-locked layout: `html { overflow: auto }`, `body { overflow: hidden; min-width: 760px; min-height: 600px }`. Browser scrollbar appears only when the window is smaller than the minimums. Inside the app, `.panels` scrolls one axis per orientation — horizontal in landscape, vertical in portrait. All `.panel` elements use `box-sizing: border-box` (sizes include padding + border).

### Landscape (side by side, `overflow-x: auto`)

| Panel | Width | Height |
|-------|-------|--------|
| viewer | `flex: 1`, `min-width: 560px` | stretch, `min-height: 400px` |
| manual | `min-width: 560px` | stretch, `min-height: 400px` |
| gcode, tools, messages, settings | `flex: 0.5` | stretch, `min-height: 400px` |

Viewer fills remaining width. Gcode, tools, messages, and settings grow at half rate (`flex: 0.5`). Manual gets a wider `min-width` override. Height is uniform — all panels stretch to `.panels` container height.

### Portrait (stacked, `overflow-y: auto`)

| Panel | Width | Height |
|-------|-------|--------|
| viewer | stretch, `min-width: 560px` | `flex: 1`, `min-height: 500px` |
| manual, settings | stretch, `min-width: 560px` | `flex: 0 0 auto` (content-sized) |
| gcode, tools, messages | stretch, `min-width: 560px` | `flex: 0 0 500px` (fixed for internal scroll) |

Viewer fills remaining height. Static panels (manual, settings) auto-size to their content. Scrollable panels (gcode, tools, messages) use a fixed 500px height to bound their internal scroll areas. Width is uniform — all panels stretch to `.panels` width with a shared `min-width: 560px`.

### Sidebar

The sidebar (left column, 150px wide) contains three sections:

1. **Machine Safety** — Arm/Disarm, E-Stop, Machine On/Off
2. **Machine Status** — Click-to-toggle popovers for Machine, Program, and Overrides
3. **Controls** — Spindle button with popover (direction, RPM, actuals, override slider)
