# lcnc-webui

Reference Vue 3 + TypeScript web interface for lcnc-gateway.

## Development

```bash
npm install
npm run dev          # Dev server with HMR
npm run build        # Production build
npm run type-check   # TypeScript checking
```

## Architecture

```
App.vue                          Root — state, layout, permission provider
├── Toolbar.vue                  Top bar: connection, arm, estop, enable
├── ThreeViewer.vue              3D viewer (Three.js)
│   ├── JogHUD.vue               Jog overlay pill
│   ├── GcodeHUD.vue             G-code overlay pill
│   ├── SpindleHUD.vue           Spindle overlay pill
│   ├── OverrideHUD.vue          Override overlay pill
│   └── SetupHUD.vue             Setup overlay pill (home, zero)
└── TabPanel.vue                 Side panel tab selector
    ├── DroPanel.vue             Digital readout + G5x selector
    ├── JogPanel.vue             Axis jog wheel + speed/increment
    ├── MdiPanel.vue             Manual data input + history
    ├── GcodePanel.vue           G-code viewer + program controls
    ├── SpindlePanel.vue         Spindle direction + RPM + override
    ├── OverridePanel.vue        Feed/spindle/rapid override sliders
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

### Classes

| Class | Rule | Controls |
|-------|------|----------|
| `idle` | armed, not estopped, enabled, idle, not busy | Home, zero, MDI, spindle direction, file ops, cycle start |
| `jog` | armed, not estopped, enabled, idle, homed | Jog buttons, speed slider, increment select |
| `override` | armed, not busy | Feed/spindle/rapid sliders and presets |
| `pause` | armed, enabled, running, not paused | Pause button |
| `resume` | armed, enabled, paused | Resume button |
| `abort` | armed | Abort/stop button |

Safety buttons (E-Stop, Machine On/Off) use direct conditions in App.vue — they have unique toggle logic and appear in one place.

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
