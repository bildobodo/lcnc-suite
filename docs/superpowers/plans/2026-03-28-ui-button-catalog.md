# UI Button Catalog Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all remaining 101 `<Btn>` usages to `<MachineBtn>` with UI catalog types, eliminating direct Btn usage in templates entirely.

**Architecture:** Add UI button types to the existing `machineControls.ts` catalog with `gate: 'always'`. All buttons go through one component, one catalog. Btn.vue becomes an internal implementation detail, never used directly.

**Tech Stack:** Vue 3, TypeScript, existing machineControls.ts + MachineBtn.vue

**Spec:** `docs/superpowers/specs/2026-03-28-machine-controls-catalog-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `lcnc-webui/src/machineControls.ts` | Add UI button types to BUTTON_TYPES |
| Modify | `lcnc-webui/src/MachineBtn.vue` | Add `icon` and `inline` prop pass-through |
| Modify | `lcnc-webui/src/App.vue` | Convert ~27 Btn → MachineBtn |
| Modify | `lcnc-webui/src/Toolbar.vue` | Convert ~19 Btn → MachineBtn |
| Modify | `lcnc-webui/src/SettingsPanel.vue` | Convert ~21 Btn → MachineBtn |
| Modify | `lcnc-webui/src/GcodePanel.vue` | Convert ~10 Btn → MachineBtn |
| Modify | `lcnc-webui/src/ProbePanel.vue` | Convert ~8 Btn → MachineBtn |
| Modify | `lcnc-webui/src/ManualPanel.vue` | Convert ~4 Btn → MachineBtn |
| Modify | `lcnc-webui/src/ToolTablePanel.vue` | Convert ~5 Btn → MachineBtn |
| Modify | `lcnc-webui/src/CameraViewer.vue` | Convert ~3 Btn → MachineBtn |
| Modify | `lcnc-webui/src/ThreeViewer.vue` | Convert ~4 Btn → MachineBtn |
| Modify | `lcnc-webui/src/TabPanel.vue` | Convert ~1 Btn → MachineBtn |
| Modify | `lcnc-webui/src/GcodeReferenceDialog.vue` | Convert ~1 Btn → MachineBtn |
| Modify | `lcnc-webui/src/DebugTab.vue` | Convert ~3 Btn → MachineBtn |

---

## Important Context for All Tasks

- **MachineBtn already exists** and wraps Btn.vue. We're adding new types to the catalog, not creating a new component.
- **`gate: 'always'`** means the button's own gate check always returns true. The outer Gate fieldset still enforces when disarmed.
- **Btn.vue stays** as the internal component MachineBtn wraps. It's never imported directly in templates after this migration.
- **Props to pass through:** MachineBtn already passes `variant`, `size`, `active`, `selected`, `muted`, `mono`, `block`, `flashing`, `warning`, `disabled`. It needs `icon` and `inline` added for UI buttons.
- **Build verification:** `cd lcnc-webui && npm run build` after every task.
- **Don't change behavior.** This is a styling consistency migration. Every button should look and behave exactly as before. Only the component name and prop source change.

---

### Task 1: Add UI types to catalog + extend MachineBtn

**Files:**
- Modify: `lcnc-webui/src/machineControls.ts`
- Modify: `lcnc-webui/src/MachineBtn.vue`

- [ ] **Step 1: Add UI button types to BUTTON_TYPES**

```ts
  // ── UI buttons (gate: always — no permission, styling only) ──

  // Close / dismiss
  close:          { gate: 'always',  variant: 'default', size: 'md',  icon: true },

  // Tab / sub-view selector
  tab:            { gate: 'always',  variant: 'default', size: 'sm',  muted: true },

  // 3D view presets
  viewPreset:     { gate: 'always',  variant: 'default', size: 'sm' },

  // Camera overlay toggle
  overlayToggle:  { gate: 'always',  variant: 'default', size: 'xs' },

  // Dialog actions
  dialogCancel:   { gate: 'always',  variant: 'default', size: 'md' },
  dialogConfirm:  { gate: 'always',  variant: 'primary', size: 'md' },
  dialogDanger:   { gate: 'always',  variant: 'danger',  size: 'md' },

  // List management (icon buttons: edit, delete, move, unbind)
  listAction:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },

  // Inline / compact utility
  inline:         { gate: 'always',  variant: 'default', size: 'sm' },

  // Header icon button (fullscreen, shutdown trigger)
  headerIcon:     { gate: 'always',  variant: 'default', size: 'md',  icon: true },
```

Update the `ButtonDef` interface to include optional `icon`, `muted`, `inline` flags:

```ts
export interface ButtonDef {
  gate: ControlGate;
  variant: 'default' | 'primary' | 'ok' | 'danger' | 'estop';
  size: 'xs' | 'sm' | 'md' | 'lg';
  icon?: boolean;
  muted?: boolean;
  inline?: boolean;
}
```

- [ ] **Step 2: Extend MachineBtn to pass icon, muted, inline from catalog**

Read MachineBtn.vue. Update it so that `icon`, `muted`, and `inline` are resolved from the catalog def OR from explicit props (prop overrides catalog). The Btn component already accepts `icon`, `muted`, `inline` props.

Pattern: `<Btn :icon="def.icon || icon" :muted="def.muted || muted" :inline="def.inline || inline" ...>`.

But be careful: if the catalog says `icon: true` but the usage wants `icon: false`, the OR logic is wrong. Use: prop explicitly passed overrides catalog, otherwise use catalog default. Since Vue props default to `undefined` when not passed, check: `props.icon !== undefined ? props.icon : def.value.icon`.

Simpler: just spread catalog defaults and let explicit props override. Or: add the props to MachineBtn if not already there, and pass them through.

- [ ] **Step 3: Verify build**

Run: `cd lcnc-webui && npm run build`

- [ ] **Step 4: Commit**

```bash
git add lcnc-webui/src/machineControls.ts lcnc-webui/src/MachineBtn.vue
git commit -m "feat: add UI button types to catalog, extend MachineBtn for icon/muted/inline"
```

---

### Task 2: Convert App.vue (27 Btn → MachineBtn)

**Files:**
- Modify: `lcnc-webui/src/App.vue`

- [ ] **Step 1: Read App.vue, find all remaining `<Btn ` usages**

- [ ] **Step 2: Convert close buttons**

All `<Btn icon @click="...= false">×</Btn>` and `<Btn icon @click="...= null">×</Btn>` → `<MachineBtn type="close" @click="...">×</MachineBtn>`.

- [ ] **Step 3: Convert header icon buttons**

Fullscreen toggle → `<MachineBtn type="headerIcon" ...>`. Shutdown trigger → already converted to MachineBtn type="shutdown" — verify.

- [ ] **Step 4: Convert dialog Cancel/Confirm buttons**

Cancel buttons → `<MachineBtn type="dialogCancel" ...>`. Confirm/primary → `<MachineBtn type="dialogConfirm" ...>`. Danger actions → `<MachineBtn type="dialogDanger" ...>`.

NOTE: Dialog action buttons are inside `<Gate :allow="...">` wrappers. The Gate stays (it gates Cancel too). Replace the Btn inside the Gate with MachineBtn.

- [ ] **Step 5: Convert message popover buttons**

Copy All, Clear All → `<MachineBtn type="inline" ...>`. Per-message Copy/Dismiss → `<MachineBtn type="listAction" ...>` or `<MachineBtn type="close" ...>`.

- [ ] **Step 6: Convert banner Refresh button**

`<MachineBtn type="inline" @click="reloadPage">Refresh</MachineBtn>`.

- [ ] **Step 7: Remove Btn import if no longer used**

- [ ] **Step 8: Verify build**

Run: `cd lcnc-webui && npm run build`

- [ ] **Step 9: Commit**

```bash
git add lcnc-webui/src/App.vue
git commit -m "refactor: convert remaining App.vue Btn to MachineBtn catalog types"
```

---

### Task 3: Convert Toolbar.vue (19 Btn → MachineBtn)

**Files:**
- Modify: `lcnc-webui/src/Toolbar.vue`

- [ ] **Step 1: Read and convert**

- Close buttons (5 pill closes) → `type="close"`
- Pill openers (5: Views, Layers, Toolpath, Tracking, Workpiece) → `type="tab"` with `:selected`
- View presets (8: Top, Bottom, Front, Back, Left, Right, Dimetric, Reset) → `type="viewPreset"`
- Clear Backplot → `type="viewPreset"`

- [ ] **Step 2: Remove Btn import if no longer used**

- [ ] **Step 3: Verify build + Commit**

```bash
git add lcnc-webui/src/Toolbar.vue
git commit -m "refactor: convert remaining Toolbar Btn to MachineBtn catalog types"
```

---

### Task 4: Convert SettingsPanel.vue (21 Btn → MachineBtn)

**Files:**
- Modify: `lcnc-webui/src/SettingsPanel.vue`

- [ ] **Step 1: Read and convert**

- Macro management icons (edit, delete, move up/down) → `type="listAction"` with `:disabled` for boundary checks
- Macro Save/Cancel → `type="dialogConfirm"` / `type="dialogCancel"`
- KB unbind buttons (×) → `type="close"` or `type="listAction"`
- HAL expand/collapse (+all/-all) → `type="inline"`
- HAL group headers → keep as `<Btn>` if they're structural, or convert to `type="inline"`
- HAL Refresh → `type="inline"` with `:disabled="halLoading"`
- G30 Refresh → `type="inline"` with `:disabled="g30Loading"`
- Reset confirm dialog Cancel/Reset → `type="dialogCancel"` / `type="dialogDanger"`
- Machine color reset (×) → `type="close"`

- [ ] **Step 2: Remove Btn import if no longer used**

- [ ] **Step 3: Verify build + Commit**

```bash
git add lcnc-webui/src/SettingsPanel.vue
git commit -m "refactor: convert remaining SettingsPanel Btn to MachineBtn catalog types"
```

---

### Task 5: Convert GcodePanel.vue (10 Btn → MachineBtn)

**Files:**
- Modify: `lcnc-webui/src/GcodePanel.vue`

- [ ] **Step 1: Read and convert**

- Stats popover close → `type="close"`
- Stats popover trigger → `type="inline"`
- Error banner dismiss (×) → `type="close"`
- Save error dismiss (×) → `type="close"`
- File browser back (..) → `type="inline"`
- Run dialog Cancel → `type="dialogCancel"`
- Run dialog Run → already MachineBtn — verify
- Run dialog spindle presets (Off/FWD/REV) → `type="tab"` with `:selected`

- [ ] **Step 2: Remove Btn import if no longer used**

- [ ] **Step 3: Verify build + Commit**

```bash
git add lcnc-webui/src/GcodePanel.vue
git commit -m "refactor: convert remaining GcodePanel Btn to MachineBtn catalog types"
```

---

### Task 6: Convert remaining files (ProbePanel, ManualPanel, ToolTablePanel, CameraViewer, ThreeViewer, TabPanel, GcodeReferenceDialog, DebugTab)

**Files:**
- Modify: 8 files

- [ ] **Step 1: ProbePanel.vue**

- Sub-view tabs (7: Outside, Inside, Boss, Ridge, Angle, Surface, Cal) → `type="tab"` with `:selected`
- Surface map dialog close (×) → `type="close"`

- [ ] **Step 2: ManualPanel.vue**

- Sub-view tabs (3: DRO, Jog, MDI) → `type="tab"` with `:selected`
- Clear history → `type="inline"` with `:disabled="history.length === 0"`

- [ ] **Step 3: ToolTablePanel.vue**

- Edit modal close (×) → `type="close"`
- Import result banner close (×) → `type="close"`
- Dialog Cancel buttons → `type="dialogCancel"`
- Dialog Save/Import buttons → already MachineBtn — verify
- Dialog Delete button → already MachineBtn — verify

- [ ] **Step 4: CameraViewer.vue**

- Overlay toggle buttons (crosshair, circle, grid) → `type="overlayToggle"` with `:active`

- [ ] **Step 5: ThreeViewer.vue**

- HUD panel tabs (Jog, Quick Setup) → `type="tab"` with `:selected`
- HUD close buttons (×) → `type="close"`

- [ ] **Step 6: TabPanel.vue**

- Main tab buttons are inside a v-for. Convert to `type="tab"` with `:selected`.
- Panel close button (×) → `type="close"`

- [ ] **Step 7: GcodeReferenceDialog.vue**

- Dialog close (×) → `type="close"`

- [ ] **Step 8: DebugTab.vue**

- Start/Stop Log → `type="inline"`
- Reset → `type="inline"`
- Download CSV → `type="inline"` with `:disabled="!timingStats"`

- [ ] **Step 9: Remove Btn import from each file if no longer used**

Check each file — if zero `<Btn ` remain, remove the import.

- [ ] **Step 10: Verify build**

Run: `cd lcnc-webui && npm run build`

- [ ] **Step 11: Commit all 8 files**

```bash
git add lcnc-webui/src/ProbePanel.vue lcnc-webui/src/ManualPanel.vue lcnc-webui/src/ToolTablePanel.vue lcnc-webui/src/CameraViewer.vue lcnc-webui/src/ThreeViewer.vue lcnc-webui/src/TabPanel.vue lcnc-webui/src/GcodeReferenceDialog.vue lcnc-webui/src/DebugTab.vue
git commit -m "refactor: convert all remaining Btn to MachineBtn catalog types"
```

---

### Task 7: Final verification

- [ ] **Step 1: Grep for remaining direct Btn usage**

Run: `grep -rn '<Btn ' lcnc-webui/src/ --include="*.vue"`

Expected: ZERO results. Every `<Btn>` should be replaced by `<MachineBtn>`. If any remain, convert them.

Exception: `Btn.vue` itself and `MachineBtn.vue` (which wraps Btn) — these are internal, not template usage.

- [ ] **Step 2: Verify Btn import cleanup**

Run: `grep -rn "import Btn from" lcnc-webui/src/ --include="*.vue"`

Expected: Only `MachineBtn.vue` imports Btn. No other file should import Btn directly.

- [ ] **Step 3: Build verification**

Run: `cd lcnc-webui && npm run build`

- [ ] **Step 4: Commit if any final fixes**
