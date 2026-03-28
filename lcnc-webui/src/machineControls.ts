import type { Permissions } from './permissions';

export type ControlGate = keyof Permissions;

// ── Button definitions ──

export interface ButtonDef {
  gate: ControlGate;
  variant: 'default' | 'primary' | 'ok' | 'danger' | 'estop';
  size: 'xs' | 'sm' | 'md' | 'lg';
  icon?: boolean;
  muted?: boolean;
  inline?: boolean;
}

export const BUTTON_TYPES = {
  // Program control
  start:          { gate: 'ready',    variant: 'primary', size: 'md' },
  step:           { gate: 'ready',    variant: 'default', size: 'md' },
  pause:          { gate: 'pause',    variant: 'default', size: 'md' },
  resume:         { gate: 'resume',   variant: 'default', size: 'md' },
  abort:          { gate: 'abort',    variant: 'danger',  size: 'md' },

  // MDI / motion
  mdi:            { gate: 'ready',    variant: 'default', size: 'md' },
  goTo:           { gate: 'ready',    variant: 'default', size: 'md' },
  home:           { gate: 'idle',     variant: 'default', size: 'md' },
  unhome:         { gate: 'idle',     variant: 'default', size: 'md' },

  // Probe
  probe:          { gate: 'probe',    variant: 'default', size: 'md' },

  // Tool
  toolLoad:       { gate: 'ready',    variant: 'primary', size: 'md' },
  toolMeasure:    { gate: 'ready',    variant: 'ok',      size: 'md' },
  toolUnload:     { gate: 'ready',    variant: 'default', size: 'md' },

  // Spindle
  spindleFwd:     { gate: 'ready',    variant: 'default', size: 'md' },
  spindleRev:     { gate: 'ready',    variant: 'default', size: 'md' },
  spindleStop:    { gate: 'ready',    variant: 'danger',  size: 'md' },

  // Coolant
  flood:          { gate: 'ready',    variant: 'default', size: 'md' },
  mist:           { gate: 'ready',    variant: 'default', size: 'md' },

  // Overrides
  overridePreset: { gate: 'override', variant: 'default', size: 'xs' },
  overrideReset:  { gate: 'override', variant: 'default', size: 'xs' },

  // File operations
  fileOp:         { gate: 'idle',     variant: 'default', size: 'md' },
  fileSave:       { gate: 'idle',     variant: 'primary', size: 'md' },

  // Settings / tool table management
  manage:         { gate: 'idle',     variant: 'default', size: 'md' },
  reset:          { gate: 'idle',     variant: 'danger',  size: 'md' },

  // WCS selection
  wcs:            { gate: 'ready',    variant: 'default', size: 'sm' },

  // Zero / touchoff
  zero:           { gate: 'zero',     variant: 'default', size: 'md' },

  // Macros
  macro:          { gate: 'ready',    variant: 'default', size: 'lg' },

  // Safety (sidebar)
  arm:            { gate: 'always',   variant: 'default', size: 'lg' },
  estop:          { gate: 'always',   variant: 'estop',   size: 'lg' },
  machineOn:      { gate: 'always',   variant: 'default', size: 'lg' },

  // Shutdown
  shutdown:       { gate: 'abort',    variant: 'danger',  size: 'md' },

  // Sidebar chips (popover toggles)
  sidebarChip:    { gate: 'always',   variant: 'default', size: 'lg' },
  sidebarNav:     { gate: 'always',   variant: 'default', size: 'lg' },
  simTrip:        { gate: 'always',   variant: 'default', size: 'md' },

  // ── UI buttons (gate: always — no permission, styling only) ──
  close:          { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  tab:            { gate: 'always',  variant: 'default', size: 'sm',  muted: true },
  viewPreset:     { gate: 'always',  variant: 'default', size: 'sm' },
  overlayToggle:  { gate: 'always',  variant: 'default', size: 'xs' },
  dialogCancel:   { gate: 'always',  variant: 'default', size: 'md' },
  dialogConfirm:  { gate: 'always',  variant: 'primary', size: 'md' },
  dialogDanger:   { gate: 'always',  variant: 'danger',  size: 'md' },
  listAction:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  inline:         { gate: 'always',  variant: 'default', size: 'sm' },
  inlineXs:       { gate: 'always',  variant: 'default', size: 'xs' },
  bannerAction:   { gate: 'always',  variant: 'default', size: 'sm' },
  headerIcon:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },
} as const satisfies Record<string, ButtonDef>;

export type ButtonType = keyof typeof BUTTON_TYPES;

// ── Input gate definitions ──

export const INPUT_GATES = {
  // Motion parameters
  jogSpeed:        'jog',
  jogIncrement:    'jog',
  jogWheel:        'jog',
  jogAxis:         'jog',
  mdiText:         'ready',
  touchoff:        'zero',
  rpmInput:        'ready',

  // Override sliders
  feedOverride:    'override',
  spindleOverride: 'override',
  rapidOverride:   'override',

  // Probe parameters
  probeParam:      'ready',
  scanParam:       'ready',

  // Toolsetter parameters
  toolsetterParam: 'ready',

  // Tool table editing
  toolEdit:        'idle',
  toolSearch:      'idle',

  // 3D Viewer settings
  viewerSetting:   'idle',
  cameraSetting:   'idle',

  // Display settings
  displaySetting:  'idle',

  // Macro editing
  macroEdit:       'idle',

  // Keyboard/gamepad config
  inputConfig:     'idle',

  // Program toggles
  optionalStop:    'override',
  blockDelete:     'override',
} as const satisfies Record<string, ControlGate>;

export type InputType = keyof typeof INPUT_GATES;
