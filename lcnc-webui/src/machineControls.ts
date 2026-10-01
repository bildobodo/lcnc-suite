import type { Permissions } from './permissions';

export type ControlGate = keyof Permissions;

// ── Button definitions ──

export interface ButtonDef {
  gate: ControlGate;
  variant: 'default' | 'primary' | 'warn' | 'danger' | 'estop';
  size: 'xs' | 'sm' | 'md' | 'lg' | 'cell';
  icon?: boolean;
  muted?: boolean;
  inline?: boolean;
  /** The value look (Btn.vue `.b-value`): an editable table value. */
  value?: boolean;
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
  /** A TabNav tab (design wave D3): its look in Btn.vue. */
  tab?: 'main' | 'sub';
}

/** Press-and-hold duration for hold-to-fire buttons (ButtonDef.hold). */
export const HOLD_FIRE_MS = 500;

export const BUTTON_TYPES = {
  // Program control. Starting motion is a hold (design wave D6, operator
  // decision 2026-09-25): Start, Step and Resume — the caller binds the hold
  // to the program (holdKey). Pause and Abort stop motion: taps.
  start:          { gate: 'run',      variant: 'primary', size: 'md', hold: true },
  step:           { gate: 'step',     variant: 'default', size: 'md', hold: true },
  pause:          { gate: 'pause',    variant: 'default', size: 'md' },
  resume:         { gate: 'resume',   variant: 'default', size: 'md', hold: true },
  abort:          { gate: 'abort',    variant: 'danger',  size: 'md' },

  // MDI / motion
  mdi:            { gate: 'ready',    variant: 'primary', size: 'md' },
  goTo:           { gate: 'machineFrame', variant: 'default', size: 'md', hold: true },   // → Home / → G30: G53 routines
  goZero:         { gate: 'goZero',   variant: 'default', size: 'md', hold: true },   // → Zero: mode-aware (gateway go_to_zero)
  home:           { gate: 'zero',     variant: 'default', size: 'md', hold: true },
  unhome:         { gate: 'zero',     variant: 'default', size: 'md', hold: true },

  // Probe
  probe:          { gate: 'machineFrame',    variant: 'default', size: 'md', whileProbing: true, hold: true },
  // A probe-grid cell: the probe cycle's gate and hold, a square glyph cell.
  probeCell:      { gate: 'machineFrame',    variant: 'default', size: 'cell', whileProbing: true, hold: true },
  probeReset:     { gate: 'probe',    variant: 'danger',  size: 'md', whileProbing: true },
  // Surface-map scan: `probe` plus every rotary parked at zero. The map is a
  // machine-Z shim valid only with the tool normal to the mapped surface and
  // the grid aligned to the work, so probing one tilted is directionally wrong.
  surfaceScan:    { gate: 'surfaceComp', variant: 'default', size: 'md', whileProbing: true, hold: true },

  // Tool
  toolLoad:       { gate: 'machineFrame',    variant: 'default', size: 'md' },
  toolMeasure:    { gate: 'machineFrame',    variant: 'default', size: 'md', whileProbing: true, hold: true },
  toolUnload:     { gate: 'machineFrame',    variant: 'default', size: 'md', whileProbing: true },

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
  // The editor's Discard throws the edit away: danger, under fileOp's gate
  // (every Discard is danger — design wave D1, N31; live look 2026-10-01).
  fileDiscard:    { gate: 'setup',    variant: 'danger',  size: 'md' },
  fileSave:       { gate: 'setup',    variant: 'primary', size: 'md' },

  // Settings / tool table management
  manage:         { gate: 'setup',    variant: 'default', size: 'md' },
  reset:          { gate: 'setup',    variant: 'danger',  size: 'md' },

  // WCS selection
  wcs:            { gate: 'probe',    variant: 'default', size: 'sm' },
  // Offsets tab: clear one fixture / all — `clear_wcs` is probe-tier on the
  // backend (command_policy), and a destructive write gets the same hold as
  // Zero / Home (operator decision 2026-09-19).
  wcsClear:       { gate: 'probe',    variant: 'default', size: 'md', hold: true },
  wcsClearAll:    { gate: 'probe',    variant: 'danger',  size: 'md', hold: true },
  // TWP re-orient: re-solves the head at the current table pose. It MOVES the
  // rotaries, so it carries the probe tier (idle + homed + no eoffset), not
  // jogFrame's — a jog-frame switch is a stationary relabel, this is motion.
  // hold: like every other motion-initiating button (home, goTo, zero…) —
  // it sits next to the WCS radios on a touch-first strip.
  twpReorient:    { gate: 'probe',    variant: 'default', size: 'md', hold: true },

  // Zero / touchoff — the `touchoff` command (gateway-routed G10 L20 or the
  // Plane-mode remap; needs homed + !eoffset + the kins-mode × fixture rule).
  // Linear and rotary letters carry different rules, hence two types.
  zero:           { gate: 'touchoff', variant: 'default', size: 'md', hold: true },
  zeroRotary:     { gate: 'touchoffRotary', variant: 'default', size: 'md', hold: true },

  // One-button plane capture at the tool tip (workflow 2): the gateway's
  // twp_capture command drives G69 → G68.3 at the tip → M530 Q2 (adopt the
  // current pose — a plain G53.1 may pick the other rotary branch) → plane
  // touch-off (M535, XYZ zero → DRO 0 at the tip, datum in G54) as separate
  // MDIs (remapped G-codes never run inside an o-sub from MDI).
  // hold: the orient is a G53 G0 — zero-length by construction,
  // still motion. Gate = the backend's twp_capture_check verbatim.
  twpCapture:     { gate: 'twpCapture', variant: 'default', size: 'md', hold: true },
  // Clear plane: plain MDI G69 (idempotent, guardless, restores identity
  // kins + G54 — nothing to refuse, hence no typed command). `ready` tier:
  // a stationary relabel like the jog-frame switch, not motion. hold: a
  // tap-guard on a setup-destroying action.
  twpClear:       { gate: 'ready',    variant: 'default', size: 'md', hold: true },

  // Macros (design wave D6, UI-D02 / N95): a macro runs MDI motion, so it
  // runs on a hold like every motion button — the bar button itself for a
  // macro without parameters (the caller sets hold + holdKey), the dialog's
  // Execute for one with parameters (opening the dialog is no motion).
  macro:          { gate: 'probe',    variant: 'default', size: 'lg' },
  macroExecute:   { gate: 'probe',    variant: 'primary', size: 'md', hold: true },

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
  // A destructive dialog action under the action's own gate (N42): the look
  // never replaces the gate — `dialogDanger` is `always`.
  dialogDangerSetup: { gate: 'setup', variant: 'danger', size: 'md' },

  // ── UI buttons (gate: always — no permission, styling only) ──
  close:          { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  // A window header's icon that is NOT a close (the camera's minimize /
  // expand, design wave D9): the X stays the only `close`.
  windowToggle:   { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  // TabNav tabs (design wave D3): main = the side pane's areas, sub = a
  // section's views (Probing, Settings, HAL). Height --control-h.
  tabMain:        { gate: 'always',  variant: 'default', size: 'sm',  muted: true, tab: 'main' },
  tabSub:         { gate: 'always',  variant: 'default', size: 'sm',  muted: true, tab: 'sub' },
  viewPreset:     { gate: 'always',  variant: 'default', size: 'sm' },
  viewerQuickToggle: { gate: 'always', variant: 'default', size: 'sm' },
  // Program-scrub / simulation bar. `scrub` controls are display-only; the
  // MODE itself is what gates machine actions (permissions.ts SIM_GATES).
  // The Sim toggle uses `:selected` for its active state, like other toggles.
  scrub:          { gate: 'always',  variant: 'default', size: 'sm' },
  overlayToggle:  { gate: 'always',  variant: 'default', size: 'xs' },
  dialogCancel:   { gate: 'always',  variant: 'default', size: 'md' },
  dialogConfirm:  { gate: 'always',  variant: 'primary', size: 'md' },
  dialogDanger:   { gate: 'always',  variant: 'danger',  size: 'md' },
  listAction:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },
  // A list row's pencil / Trash2 whose action needs the setup class (the
  // tool table's edit and delete): the listAction look, the action's gate
  // (design wave D4, UI-N67).
  listActionSetup: { gate: 'setup',  variant: 'default', size: 'md',  icon: true },
  // Removing a gamepad profile: destructive, outside a dialog, and like
  // the rest of the gamepad configuration never gated (UI-N71).
  profileRemove:  { gate: 'always',  variant: 'danger',  size: 'md' },
  nav:            { gate: 'always',  variant: 'default', size: 'md' },
  inline:         { gate: 'always',  variant: 'default', size: 'sm' },
  // An offset cell's value: opens the number keypad for that fixture × axis
  // (operator P5 — the cell used to open only on a click, with no keyboard
  // path). G10 L2 is a probe-tier write (command_policy).
  offsetCell:     { gate: 'probe',   variant: 'default', size: 'sm',  value: true },
  // G30's stored position (operator P4, Codex R21–R24): no motion. Taking
  // the current position over and saving are machine-frame only (our G30
  // routines address it with G53 moves); a confirming read synchs — idle.
  g30Capture:     { gate: 'g30Capture', variant: 'default', size: 'md' },   // + standstill (Codex R25 OP-I02)
  g30Save:        { gate: 'machineFrame', variant: 'primary', size: 'md' },
  g30Read:        { gate: 'idle',         variant: 'default', size: 'md' },
  // Discard in an inline note is the same destructive choice as in a
  // dialog — danger wherever it appears (design wave D1, UI-N31).
  inlineDanger:   { gate: 'always',  variant: 'danger',  size: 'sm' },
  // Re-reading after a failed read never needs a permission: the ONE retry
  // type of every .statusNote (design wave D1, UI-N28).
  retry:          { gate: 'always',  variant: 'default', size: 'md' },
  surfaceRefresh: { gate: 'always',  variant: 'default', size: 'md' },
  inlineXs:       { gate: 'always',  variant: 'default', size: 'xs' },
  inlineMd:       { gate: 'always',  variant: 'default', size: 'md' },
  bannerAction:   { gate: 'always',  variant: 'default', size: 'md' },
  // Banner buttons are ONE family (design wave D1, UI-N25): the trip
  // acknowledgement and the program reload are banner actions too.
  bannerAck:      { gate: 'always',  variant: 'primary', size: 'md' },
  bannerReload:   { gate: 'setup',   variant: 'default', size: 'md' },
  bannerAbort:    { gate: 'abort',   variant: 'danger',  size: 'md' },
  // Banner Home All: `home_all` is ZERO-tier on the backend (idle + !eoffset).
  bannerHome:     { gate: 'zero',    variant: 'default', size: 'md', hold: true },
  // Manual tool-change confirm: meaningful only while iocontrol asks for one;
  // the state gate is `armed` (it happens mid-program, never idle/ready).
  toolChangeConfirm: { gate: 'armed', variant: 'primary', size: 'md' },
  headerIcon:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },

  // ── Number keypad ──
  numKey:  { gate: 'always', variant: 'default', size: 'lg', mono: true },  // digits, decimal
  numOp:   { gate: 'always', variant: 'default', size: 'lg', mono: true },  // operators, ±, ( )
  numDel:  { gate: 'always', variant: 'default', size: 'lg' },              // ⌫ backspace
  numClr:  { gate: 'always', variant: 'default', size: 'lg' },              // Clr — clears the unconfirmed entry only: no danger style (UX-03)
  numEq:   { gate: 'always', variant: 'primary', size: 'lg', mono: true },  // ═ evaluate
} as const satisfies Record<string, ButtonDef>;

export type ButtonType = keyof typeof BUTTON_TYPES;

// ── Input definitions ──

export interface InputDef {
  gate: ControlGate;
  /** Compact: the field's own dense look (the strip's DRO touch-off). The
   *  HEIGHT follows the area (--control-h, style.css) — never a padding. */
  density?: 'compact';
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
  touchoff:        { gate: 'touchoff', mono: true, align: 'right', density: 'compact' },
  touchoffRotary:  { gate: 'touchoffRotary', mono: true, align: 'right', density: 'compact' },
  // WCS selector radios: selecting a fixture is a plain modal (G54..), the
  // probe tier like the `wcs` button; the reserved rows are disabled per
  // option in SetupStrip, not by a gate.
  wcsSelect:       { gate: 'probe' },
  stripInput:      { gate: 'always',   mono: true, align: 'right' },
  scrubPos:        { gate: 'always' },  // scrub timeline — display-only, see BUTTON_TYPES.scrub
  simToggle:       { gate: 'always' },  // simulation mode toggle — entry rules live in ScrubBar
  simSpeed:        { gate: 'always' },  // sim playback speed — display-only
  coolant:         { gate: 'override' },

  // Mode selection
  modeSelect:      { gate: 'idle' },
  // Jog-frame selector (switchable-kins machines): switching runs an MDI
  // remap (M428/M430), so it carries the MDI tier, not modeSelect's.
  jogFrame:        { gate: 'ready' },
  // The Plane frame radio: its own backend class — plane defined AND the
  // head still aligned with it (TWP-04, command_policy.plane_frame_check).
  planeFrame:      { gate: 'planeFrame' },

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

  // Program upload — the rename field in the name-conflict dialog (UI-09)
  uploadName:      { gate: 'setup' },

  // Tool table editing
  toolEdit:        { gate: 'setup' },
  toolEditNum:     { gate: 'setup',    mono: true, align: 'right' },
  toolSearch:      { gate: 'always' },
  // The narrow side pane's navigation selects (design wave D3): the area
  // (Program … Tools) and Probing's procedure — navigation, never gated.
  tabSelect:       { gate: 'always' },

  // 3D Viewer settings
  viewerSetting:   { gate: 'always' },
  viewerSettingNum:{ gate: 'always',   mono: true, align: 'right' },
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
