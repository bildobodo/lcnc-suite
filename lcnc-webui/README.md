# lcnc-webui

Reference Vue 3 + TypeScript web interface for lcnc-gateway.

This README covers frontend development basics. The root
[README](../README.md) is the full reference (permission matrix, WS API,
machine model); the layout below is a map, not an inventory.

## Development

```bash
npm install
npm run dev          # Vite dev server with HMR (proxies /ws + API to :8000)
npm run build        # Production build — vue-tsc -b + vite build (zero TS errors required)
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright end-to-end tests
npm run lint         # ESLint + scoped-CSS audit
```

For hot-reload against a running machine config, set `WEBUI_DEV = 1` in
the INI `[DISPLAY]` section — the launcher starts Vite on :5173 alongside
the gateway on :8000.

## Architecture

```
App.vue                        Root — state, layout, status banner, dialogs
├── Gate(armed)                OUTER GATE — default-deny: everything below is
│   │                          browser-disabled (<fieldset disabled>) until Armed
│   ├── viewerPane             ThreeViewer.vue (3D machine, Three.js)
│   │   ├── ScrubBar.vue       Program scrub timeline, simulation mode,
│   │   │                      collision-sweep controls
│   │   └── CameraPip.vue      Camera picture-in-picture overlay
│   ├── sidePane               TabPanel.vue — Program | MDI | Probing | Offsets | Tools
│   │   ├── GcodePanel.vue     G-code viewer/editor, program controls, run-from-line
│   │   ├── ProbePanel.vue     Probe operations grid
│   │   ├── OffsetPanel.vue    WCS offset table (G54–G59.3)
│   │   ├── ToolTablePanel.vue Tool table + library metadata + STL previews
│   │   └── SettingsPanel.vue  Sub-tabbed settings (viewer, machine, macros, …)
│   ├── Macro bar              User-configurable macro buttons
│   └── Bottom action strip    JogStrip, SetupStrip, OverridesStrip,
│                              SpindleStrip, ToolStrip
└── #exempt slot               SafetyStrip.vue — Arm/Disarm, E-Stop, Machine
                               On/Off: always accessible, even disarmed
```

Support layers: `viewer/` (kins boundary, collision sweep, scrub track,
part-frame transform, asset caches — pure modules with unit tests),
`ws/` (WebSocket transport, status/bulk-data stores, telemetry), and web
workers for parsing, part-frame transforms, and collision sweeps.

### Services & Catalog

| File | Purpose |
|------|---------|
| `lcncWs.ts` | WebSocket client barrel — status, commands, heartbeat |
| `lcncApi.ts` | REST helpers — file listing, upload |
| `permissions.ts` | Permission evaluation (14 classes, 6 tiers) + provide/inject |
| `machineControls.ts` | Machine controls catalog — `BUTTON_TYPES` + `INPUT_DEFS` |
| `MachineBtn.vue` | Catalog-aware button (wraps the internal `Btn.vue`) |
| `MachineInput/Toggle/Slider/Select/Radio/Color.vue` | Catalog-aware form controls |
| `Gate.vue` | Permission gate (`<fieldset :disabled>`) |
| `defaults.ts` | Server-synced settings with section registry |

## Permission System & Machine Controls Catalog

All permissions are defined in `permissions.ts` (14 classes in 6 tiers,
`base = armed && !estop && enabled`) and distributed via Vue
provide/inject. Interactive elements use catalog-aware components that
look up their permission gate automatically — components never compute
their own disable conditions, and `Btn.vue` is never used directly in
templates.

See the permission class table in the root [README](../README.md) for the
full rule matrix.

### Usage — Catalog Components (primary pattern)

```vue
<!-- Buttons: type maps to a BUTTON_TYPES entry (gate + variant + size) -->
<MachineBtn type="start" @click="run">Start</MachineBtn>
<MachineBtn type="close" @click="dismiss">×</MachineBtn>
<MachineBtn type="tab" :selected="active === 'dro'">DRO</MachineBtn>

<!-- Inputs: gate maps to an INPUT_DEFS entry -->
<MachineInput gate="mdiText" v-model="mdi" />
<MachineSlider gate="feedOverride" v-model="feed" />
<MachineToggle gate="optionalStop" v-model="m01" label="M01" />
```

### Usage — Gate.vue (section-level gating)

```vue
<Gate gate="ready">
  <!-- All children browser-disabled when the gate is closed -->
  <MachineBtn type="start" @click="run">Start</MachineBtn>
</Gate>
```

### Gating architecture

- **Outer Gate** (`gate="armed"`) wraps the content area, macro bar, and
  bottom strip — default-deny when disarmed; `armed` (not `safety`) so UI
  navigation keeps working during E-Stop
- **`#exempt` slot** holds SafetyStrip — Arm/E-Stop always accessible as
  a DOM sibling of the gated content
- **Inner Gates** tighten sections (`override`, `ready`, `idle`, `setup`,
  `safety`); **catalog self-gating** dims and disables each control from
  its own permission class
- **Backend `require_armed()`** re-checks every motion command —
  defense-in-depth; the UI gate is UX, the server gate is authority
- **Simulation mode** (`simMode.ts`) closes all machine-action gates
  while the viewer poses the model offline (program scrub)

## Layout

Responsive two-pane layout: the 3D viewer pane stays visible while the
side pane tabs switch; landscape puts them side by side, portrait stacks
them. The bottom action strip scrolls horizontally when narrow. Layout
primitives, spacing/opacity/typography tokens, and the styling rules live
in `src/style.css` — new CSS must use the shared tokens and utility
classes (see the pre-flight checklist in the repo's `CLAUDE.md`).
