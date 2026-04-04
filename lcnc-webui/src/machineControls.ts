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
  mono?: boolean;
}

export const BUTTON_TYPES = {
  // Program control
  start:          { gate: 'ready',    variant: 'primary', size: 'md' },
  step:           { gate: 'step',     variant: 'default', size: 'md' },
  pause:          { gate: 'pause',    variant: 'default', size: 'md' },
  resume:         { gate: 'resume',   variant: 'default', size: 'md' },
  abort:          { gate: 'abort',    variant: 'danger',  size: 'md' },

  // MDI / motion
  mdi:            { gate: 'ready',    variant: 'primary', size: 'md' },
  goTo:           { gate: 'ready',    variant: 'default', size: 'md' },
  home:           { gate: 'idle',     variant: 'default', size: 'md' },
  unhome:         { gate: 'idle',     variant: 'default', size: 'md' },

  // Probe
  probe:          { gate: 'probe',    variant: 'default', size: 'md' },
  compToggle:     { gate: 'ready',    variant: 'default', size: 'md' },

  // Tool
  toolLoad:       { gate: 'ready',    variant: 'default', size: 'md' },
  toolMeasure:    { gate: 'ready',    variant: 'default', size: 'md' },
  toolUnload:     { gate: 'ready',    variant: 'default', size: 'md' },

  // Spindle
  spindleFwd:     { gate: 'ready',    variant: 'default', size: 'lg' },
  spindleRev:     { gate: 'ready',    variant: 'default', size: 'lg' },
  spindleStop:    { gate: 'ready',    variant: 'danger',  size: 'lg' },

  // Coolant
  flood:          { gate: 'ready',    variant: 'default', size: 'md' },
  mist:           { gate: 'ready',    variant: 'default', size: 'md' },

  // Jog
  jog:            { gate: 'jog',      variant: 'default', size: 'sm', mono: true },

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

// ── Input definitions ──

export interface InputDef {
  gate: ControlGate;
  size?: 'sm' | 'md' | 'lg';
  mono?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export const INPUT_DEFS = {
  // Motion parameters
  jogSpeed:        { gate: 'jog',      mono: true, align: 'right' },
  jogIncrement:    { gate: 'jog',      mono: true, align: 'right' },
  jogWheel:        { gate: 'jog' },
  jogAxis:         { gate: 'jog' },
  mdiText:         { gate: 'ready' },
  touchoff:        { gate: 'zero',     mono: true, align: 'right' },
  rpmInput:        { gate: 'ready',    mono: true, align: 'right' },
  coolant:         { gate: 'ready' },

  // Override sliders
  feedOverride:    { gate: 'override' },
  spindleOverride: { gate: 'override' },
  rapidOverride:   { gate: 'override' },

  // Probe parameters
  probeParam:      { gate: 'ready',    mono: true, align: 'right' },
  scanParam:       { gate: 'ready',    mono: true, align: 'right' },

  // Toolsetter parameters
  toolsetterParam: { gate: 'ready',    mono: true, align: 'right' },

  // Tool table editing
  toolEdit:        { gate: 'idle' },
  toolEditNum:     { gate: 'idle',     mono: true, align: 'right' },
  toolSearch:      { gate: 'idle' },

  // 3D Viewer settings
  viewerSetting:   { gate: 'idle' },
  viewerSettingNum:{ gate: 'idle',     mono: true, align: 'right', size: 'sm' },
  cameraSetting:   { gate: 'idle' },

  // Display settings
  displaySetting:  { gate: 'idle' },
  displaySettingNum:{ gate: 'idle',    mono: true, align: 'right' },

  // Macro editing
  macroEdit:       { gate: 'idle' },

  // Keyboard/gamepad config
  inputConfig:     { gate: 'idle' },

  // Program toggles
  optionalStop:    { gate: 'override' },
  blockDelete:     { gate: 'override' },

  // Color pickers (used by MachineColor)
  viewerColor:     { gate: 'idle' },
  cameraColor:     { gate: 'idle' },

  // Offset editing
  offsetEdit:      { gate: 'zero',     mono: true, align: 'right' },

  // UI-only (always enabled)
  search:          { gate: 'always' },
  filter:          { gate: 'always' },
} as const satisfies Record<string, InputDef>;

export type InputType = keyof typeof INPUT_DEFS;

// Size tier inline styles — shared by MachineInput, MachineSelect
export const INPUT_SIZE_STYLES: Record<string, Record<string, string>> = {
  sm: { padding: '3px 6px', fontSize: 'var(--fs-sm)' },
  lg: { padding: '6px 10px', fontSize: 'var(--fs-md)' },
};
