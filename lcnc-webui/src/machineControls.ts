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
  // Disable while a probe operation is in flight (st.probing). Centralises
  // the ~14 ad-hoc `:disabled="probing"` props that were scattered across
  // ProbePanel and the tool actions in App.vue. MachineBtn injects the
  // 'probing' ref provided by App.vue and ANDs this flag into isDisabled.
  whileProbing?: boolean;
  // Press-and-hold to fire instead of a plain click — accidental-tap
  // protection for buttons where one touch starts machine motion (probe
  // cycles, rapids, spindle start). MachineBtn swallows the native click
  // and fires the @click handler after HOLD_FIRE_MS with a visual fill;
  // releasing or sliding off early cancels. Note: this makes the button
  // dead to keyboard Enter/Space — these ops have keyboard-shortcut and
  // gamepad paths that bypass the button. Per-instance override via the
  // MachineBtn `hold` prop.
  hold?: boolean;
}

/** Press-and-hold duration for hold-to-fire buttons (ButtonDef.hold). */
export const HOLD_FIRE_MS = 500;

export const BUTTON_TYPES = {
  // Program control
  start:          { gate: 'ready',    variant: 'primary', size: 'md' },
  step:           { gate: 'step',     variant: 'default', size: 'md' },
  pause:          { gate: 'pause',    variant: 'default', size: 'md' },
  resume:         { gate: 'resume',   variant: 'default', size: 'md' },
  abort:          { gate: 'abort',    variant: 'danger',  size: 'md' },

  // MDI / motion
  mdi:            { gate: 'ready',    variant: 'primary', size: 'md' },
  goTo:           { gate: 'ready',    variant: 'default', size: 'md', hold: true },
  home:           { gate: 'zero',     variant: 'default', size: 'md', hold: true },
  unhome:         { gate: 'zero',     variant: 'default', size: 'md', hold: true },

  // Probe
  probe:          { gate: 'probe',    variant: 'default', size: 'md', whileProbing: true, hold: true },
  probeReset:     { gate: 'probe',    variant: 'danger',  size: 'md', whileProbing: true },

  // Tool
  toolLoad:       { gate: 'ready',    variant: 'default', size: 'md' },
  toolMeasure:    { gate: 'ready',    variant: 'default', size: 'md', whileProbing: true, hold: true },
  toolUnload:     { gate: 'ready',    variant: 'default', size: 'md', whileProbing: true },

  // Spindle
  spindleFwd:      { gate: 'ready',    variant: 'default', size: 'md', hold: true },
  spindleRev:      { gate: 'ready',    variant: 'default', size: 'md', hold: true },
  spindleStop:     { gate: 'ready',    variant: 'danger',  size: 'md' },
  spindleIncrease: { gate: 'ready',    variant: 'default', size: 'md' },
  spindleDecrease: { gate: 'ready',    variant: 'default', size: 'md' },

  // Coolant (override gate: toggleable during program execution, like overrides)
  flood:          { gate: 'override', variant: 'default', size: 'md' },
  mist:           { gate: 'override', variant: 'default', size: 'md' },

  // Jog
  jog:            { gate: 'jog',      variant: 'default', size: 'sm', mono: true },

  // Overrides
  overridePreset: { gate: 'override', variant: 'default', size: 'xs' },
  overrideReset:  { gate: 'override', variant: 'default', size: 'xs' },
  jogSpeedReset:  { gate: 'jog',      variant: 'default', size: 'xs' },

  // File operations
  fileOp:         { gate: 'setup',    variant: 'default', size: 'md' },
  fileSave:       { gate: 'setup',    variant: 'primary', size: 'md' },

  // Settings / tool table management
  manage:         { gate: 'setup',    variant: 'default', size: 'md' },
  reset:          { gate: 'setup',    variant: 'danger',  size: 'md' },

  // WCS selection
  wcs:            { gate: 'probe',    variant: 'default', size: 'sm' },

  // Zero / touchoff (sends G10 L20 MDI — needs homed + !eoffset)
  zero:           { gate: 'probe',    variant: 'default', size: 'md', hold: true },

  // Macros
  macro:          { gate: 'probe',    variant: 'default', size: 'lg' },

  // Safety
  arm:            { gate: 'always',   variant: 'default', size: 'lg' },
  estop:          { gate: 'always',   variant: 'estop',   size: 'lg' },
  machineOn:      { gate: 'always',   variant: 'default', size: 'lg' },

  // Shutdown
  shutdown:       { gate: 'armed',    variant: 'danger',  size: 'md' },
  simTrip:        { gate: 'always',   variant: 'default', size: 'md' },

  // ── Gated dialog actions (confirm/danger that require machine state) ──
  dialogBase:     { gate: 'abort',   variant: 'primary', size: 'md' },
  dialogReady:    { gate: 'ready',   variant: 'primary', size: 'md' },
  dialogReadyDanger: { gate: 'ready', variant: 'danger', size: 'md' },

  // ── UI buttons (gate: always — no permission, styling only) ──
  close:          { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  tab:            { gate: 'always',  variant: 'default', size: 'sm',  muted: true },
  viewPreset:     { gate: 'always',  variant: 'default', size: 'sm' },
  viewerQuickToggle: { gate: 'always', variant: 'default', size: 'sm' },
  // Program-scrub / simulation bar. `scrub` controls are display-only; the
  // MODE itself is what gates machine actions (permissions.ts SIM_GATES).
  scrub:          { gate: 'always',  variant: 'default', size: 'sm' },
  scrubExit:      { gate: 'always',  variant: 'primary', size: 'sm' },
  overlayToggle:  { gate: 'always',  variant: 'default', size: 'xs' },
  dialogCancel:   { gate: 'always',  variant: 'default', size: 'md' },
  dialogConfirm:  { gate: 'always',  variant: 'primary', size: 'md' },
  dialogDanger:   { gate: 'always',  variant: 'danger',  size: 'md' },
  listAction:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  nav:            { gate: 'always',  variant: 'default', size: 'md' },
  inline:         { gate: 'always',  variant: 'default', size: 'sm' },
  surfaceRefresh: { gate: 'always',  variant: 'default', size: 'md' },
  inlineXs:       { gate: 'always',  variant: 'default', size: 'xs' },
  inlineMd:       { gate: 'always',  variant: 'default', size: 'md' },
  bannerAction:   { gate: 'always',  variant: 'default', size: 'md' },
  bannerAbort:    { gate: 'abort',   variant: 'danger',  size: 'md' },
  bannerHome:     { gate: 'idle',    variant: 'default', size: 'md', hold: true },
  headerIcon:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },

  // ── Number keypad ──
  numKey:  { gate: 'always', variant: 'default', size: 'lg', mono: true },  // digits, decimal
  numOp:   { gate: 'always', variant: 'default', size: 'lg', mono: true },  // operators, ±, ( )
  numDel:  { gate: 'always', variant: 'default', size: 'lg' },              // ⌫ backspace
  numClr:  { gate: 'always', variant: 'danger',  size: 'lg' },              // C clear
  numEq:   { gate: 'always', variant: 'primary', size: 'lg', mono: true },  // ═ evaluate
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
  touchoff:        { gate: 'probe',    mono: true, align: 'right', size: 'sm' },
  stripInput:      { gate: 'always',   mono: true, align: 'right', size: 'md' },
  scrubPos:        { gate: 'always' },  // scrub timeline — display-only, see BUTTON_TYPES.scrub
  coolant:         { gate: 'override' },

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
