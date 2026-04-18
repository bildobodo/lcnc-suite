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
  home:           { gate: 'zero',     variant: 'default', size: 'md' },
  unhome:         { gate: 'zero',     variant: 'default', size: 'md' },

  // Probe
  probe:          { gate: 'probe',    variant: 'default', size: 'md' },
  probeReset:     { gate: 'probe',    variant: 'danger',  size: 'md' },

  // Tool
  toolLoad:       { gate: 'probe',    variant: 'default', size: 'md' },
  toolMeasure:    { gate: 'probe',    variant: 'default', size: 'md' },
  toolUnload:     { gate: 'probe',    variant: 'default', size: 'md' },

  // Spindle
  spindleFwd:     { gate: 'ready',    variant: 'default', size: 'md' },
  spindleRev:     { gate: 'ready',    variant: 'default', size: 'md' },
  spindleStop:    { gate: 'ready',    variant: 'danger',  size: 'md' },

  // Coolant
  flood:          { gate: 'ready',    variant: 'default', size: 'md' },
  mist:           { gate: 'ready',    variant: 'default', size: 'md' },

  // Jog
  jog:            { gate: 'jog',      variant: 'default', size: 'sm', mono: true },

  // Overrides
  overridePreset: { gate: 'override', variant: 'default', size: 'xs' },
  overrideReset:  { gate: 'override', variant: 'default', size: 'xs' },

  // File operations
  fileOp:         { gate: 'setup',    variant: 'default', size: 'md' },
  fileSave:       { gate: 'setup',    variant: 'primary', size: 'md' },

  // Settings / tool table management
  manage:         { gate: 'setup',    variant: 'default', size: 'md' },
  reset:          { gate: 'setup',    variant: 'danger',  size: 'md' },

  // WCS selection
  wcs:            { gate: 'probe',    variant: 'default', size: 'sm' },

  // Zero / touchoff (sends G10 L20 MDI — needs homed + !eoffset)
  zero:           { gate: 'probe',    variant: 'default', size: 'md' },

  // Macros
  macro:          { gate: 'probe',    variant: 'default', size: 'lg' },

  // Safety
  arm:            { gate: 'always',   variant: 'default', size: 'lg' },
  estop:          { gate: 'always',   variant: 'estop',   size: 'lg' },
  machineOn:      { gate: 'always',   variant: 'default', size: 'lg' },

  // Shutdown
  shutdown:       { gate: 'safety',   variant: 'danger',  size: 'md' },
  simTrip:        { gate: 'always',   variant: 'default', size: 'md' },

  // ── Gated dialog actions (confirm/danger that require machine state) ──
  dialogAbort:    { gate: 'abort',   variant: 'danger',  size: 'md' },
  dialogBase:     { gate: 'abort',   variant: 'primary', size: 'md' },
  dialogReady:    { gate: 'ready',   variant: 'primary', size: 'md' },
  dialogReadyDanger: { gate: 'ready', variant: 'danger', size: 'md' },

  // ── UI buttons (gate: always — no permission, styling only) ──
  close:          { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  tab:            { gate: 'always',  variant: 'default', size: 'sm',  muted: true },
  viewPreset:     { gate: 'always',  variant: 'default', size: 'sm' },
  overlayToggle:  { gate: 'always',  variant: 'default', size: 'xs' },
  dialogCancel:   { gate: 'always',  variant: 'default', size: 'md' },
  dialogConfirm:  { gate: 'always',  variant: 'primary', size: 'md' },
  dialogDanger:   { gate: 'always',  variant: 'danger',  size: 'md' },
  listAction:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  nav:            { gate: 'always',  variant: 'default', size: 'md' },
  inline:         { gate: 'always',  variant: 'default', size: 'sm' },
  inlineXs:       { gate: 'always',  variant: 'default', size: 'xs' },
  inlineMd:       { gate: 'always',  variant: 'default', size: 'md' },
  bannerAction:   { gate: 'always',  variant: 'default', size: 'md' },
  bannerAbort:    { gate: 'abort',   variant: 'danger',  size: 'md' },
  bannerHome:     { gate: 'idle',    variant: 'default', size: 'md' },
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
  touchoff:        { gate: 'probe',    mono: true, align: 'right', size: 'md' },
  stripInput:      { gate: 'always',   mono: true, align: 'right', size: 'md' },
  coolant:         { gate: 'ready' },

  // Mode selection
  modeSelect:      { gate: 'idle' },

  // Override sliders
  feedOverride:    { gate: 'override' },
  spindleOverride: { gate: 'override' },
  rapidOverride:   { gate: 'override' },

  // Probe parameters
  probeParam:      { gate: 'always',   mono: true, align: 'right' },
  scanParam:       { gate: 'always',   mono: true, align: 'right' },
  compToggle:      { gate: 'ready' },
  compMethod:      { gate: 'probe' },

  // Toolsetter parameters
  toolsetterParam: { gate: 'always',   mono: true, align: 'right' },

  // Tool table editing
  toolEdit:        { gate: 'setup' },
  toolEditNum:     { gate: 'setup',    mono: true, align: 'right' },
  toolSearch:      { gate: 'always' },

  // 3D Viewer settings
  viewerSetting:   { gate: 'always' },
  viewerSettingNum:{ gate: 'always',   mono: true, align: 'right', size: 'sm' },
  cameraSetting:   { gate: 'always' },

  // Display settings
  displaySetting:  { gate: 'always' },
  displaySettingNum:{ gate: 'always',  mono: true, align: 'right' },

  // Macro editing
  macroEdit:       { gate: 'always' },
  macroParam:      { gate: 'ready' },

  // Keyboard/gamepad config
  inputConfig:     { gate: 'always' },

  // Program toggles
  optionalStop:    { gate: 'override' },
  blockDelete:     { gate: 'override' },

  // Color pickers (used by MachineColor)
  viewerColor:     { gate: 'always' },
  cameraColor:     { gate: 'always' },

  // Offset editing
  offsetEdit:      { gate: 'probe',    mono: true, align: 'right' },

  // UI-only (always enabled)
  search:          { gate: 'always' },
  filter:          { gate: 'always' },
} as const satisfies Record<string, InputDef>;

export type InputType = keyof typeof INPUT_DEFS;

// Size tier inline styles — shared by MachineInput, MachineSelect
export const INPUT_SIZE_STYLES: Record<string, Record<string, string>> = {
  sm: { padding: '3px 6px', fontSize: 'var(--fs-sm)' },
  md: { padding: '8px 12px', fontSize: 'var(--fs-base)' },
  lg: { padding: '6px 10px', fontSize: 'var(--fs-md)' },
};
