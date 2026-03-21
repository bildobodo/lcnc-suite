# Keyboard Settings Tab — Design Spec

## Goal

Create a dedicated "Keyboard" settings tab that gives users full control over keyboard shortcuts: a master enable/disable toggle, a jog-specific sub-toggle, and a rebindable key mapping table for all keyboard actions.

## Architecture

Flat key map (`Record<KeyboardAction, string>`) stored as a server-synced section in `defaults.ts`. App.vue builds a reverse lookup map (`key → action`) and uses it in `onKeyDown`/`onKeyUp` instead of hardcoded key checks. SettingsPanel gets a new Keyboard tab with toggles and a key capture UI.

## Current State

All keyboard bindings are hardcoded in App.vue:
- `JOG_KEY_MAP`: arrows → X/Y, PgUp/PgDn → Z
- `ROTARY_KEY_PAIRS`: `[]` → first rotary, `;'` → second rotary
- Inline checks: `Escape` → E-Stop, `Space` → Cycle Start/Pause/Resume, backtick → Abort
- `keyboardJogEnabled` boolean lives in Machine settings (`MachineDefaults.keyboardJog`)
- `isInputFocused()` guard prevents shortcuts when typing in inputs
- E-Stop (Escape) works even when input is focused — special-cased before the guard

## Data Model

### KeyboardAction type

```typescript
type KeyboardAction =
  | "jog_x+" | "jog_x-" | "jog_y+" | "jog_y-" | "jog_z+" | "jog_z-"
  | "jog_a+" | "jog_a-" | "jog_b+" | "jog_b-"
  | "estop" | "cycle" | "abort";
```

Notes:
- `cycle` is a combined action: runtime logic decides Cycle Start, Pause, or Resume based on machine state (matches gamepad pattern where `"start"` does the same)
- Rotary jog actions (`jog_a+/a-`, `jog_b+/b-`) are included in the type but only shown in the UI if the machine has rotary axes

### KEYBOARD_ACTION_LABELS

```typescript
const KEYBOARD_ACTION_LABELS: Record<KeyboardAction, string> = {
  "jog_x+": "Jog X+", "jog_x-": "Jog X-",
  "jog_y+": "Jog Y+", "jog_y-": "Jog Y-",
  "jog_z+": "Jog Z+", "jog_z-": "Jog Z-",
  "jog_a+": "Jog A+", "jog_a-": "Jog A-",
  "jog_b+": "Jog B+", "jog_b-": "Jog B-",
  "estop": "E-Stop",
  "cycle": "Cycle Start / Pause / Resume",
  "abort": "Abort",
};
```

Used for the key binding table labels and the duplicate-check error message ("Already bound to [label]").

### KeyboardDefaults interface

```typescript
interface KeyboardDefaults {
  enabled: boolean;       // master toggle — all shortcuts dead when false (except E-Stop)
  jogEnabled: boolean;    // sub-toggle — jog keys dead when false
  mapping: Record<KeyboardAction, string>;  // action → KeyboardEvent.key
}
```

### Default mapping

| Action | Key | Display |
|--------|-----|---------|
| jog_x+ | ArrowRight | → |
| jog_x- | ArrowLeft | ← |
| jog_y+ | ArrowUp | ↑ |
| jog_y- | ArrowDown | ↓ |
| jog_z+ | PageUp | PgUp |
| jog_z- | PageDown | PgDn |
| jog_a+ | ] | ] |
| jog_a- | [ | [ |
| jog_b+ | ' | ' |
| jog_b- | ; | ; |
| estop | Escape | Esc |
| cycle | (Space) | Space |
| abort | Backspace | ⌫ |

Note: the default for `abort` is `Backspace` (changed from the current backtick). This is an intentional improvement — backtick is easy to hit accidentally and varies by keyboard layout. Backspace is more intentional ("take back" the operation).

### Storage

Registered as a `SERVER_SECTION` in both `defaults.ts` and `main.ts` (same pattern as gamepad):
- Add `"keyboard"` to `SERVER_SECTIONS` Set in `defaults.ts`
- Add `"keyboard"` to `SERVER_SECTIONS` array in `main.ts`
- `registerSection<KeyboardDefaults>("keyboard", KEYBOARD_FALLBACK, migrateFn)`
- Synced via gateway WebSocket (`save_settings` / `settings_update`)
- `loadKeyboardDefaults()` / `saveKeyboardDefaults()` functions

### Migration

`migrateFn` validates all mapping values are valid `KeyboardEvent.key` strings and all actions are present. Missing actions get default keys. Unknown actions are dropped.

## Settings Tab Layout

New "Keyboard" tab in SettingsPanel, positioned after Gamepad in the tab list.

### Section 1: Keyboard Shortcuts (always visible)

```
[toggle] Enable keyboard shortcuts
```

Description: "Allow keyboard keys to control the machine. When disabled, no keyboard shortcuts are active except E-Stop."

### Section 2: Keyboard Jogging (visible when master enabled)

```
[toggle] Enable keyboard jogging
```

Description: "Allow jog keys to move axes."

### Section 3: Key Bindings (visible when master enabled)

Two-column table using existing `.gpMapTable`-style layout:

| Action | Key |
|--------|-----|
| Jog X+ | [→] [×] |
| Jog X- | [←] [×] |
| Jog Y+ | [↑] [×] |
| Jog Y- | [↓] [×] |
| Jog Z+ | [PgUp] [×] |
| Jog Z- | [PgDn] [×] |
| Jog A+ | []] [×] |
| Jog A- | [[] [×] |
| — separator — | |
| E-Stop | [Esc] [×] |
| Cycle Start / Pause / Resume | [Space] [×] |
| Abort | [⌫] [×] |

- Jog rows visually dimmed (`.inactive` class) when jog sub-toggle is off, but still configurable
- Rotary jog rows only shown if machine has rotary axes (dynamic, based on axis config from gateway status)
- Each key cell is a clickable button showing the current key (or "None" if unbound)
- `×` button (Btn icon) unbinds the key (sets to empty string)

### Section 4: Reset

```
[Reset Keyboard] (danger button)
```

Resets to `KEYBOARD_FALLBACK` defaults.

## Key Capture Interaction

### Flow

1. User clicks the key cell → cell enters listening mode
2. Cell text changes to "Press a key..." with highlighted border (`--info` color, `--hl-selected` background)
3. A temporary `keydown` listener is added to `window` (capturing phase)
4. `e.preventDefault()` + `e.stopPropagation()` to block the key from triggering any machine action
5. **Duplicate check:** if `e.key` is already bound to a different action:
   - Show inline error "Already bound to [Action Name]" for 2 seconds
   - Reject the binding
   - Stay in listening mode (user can try another key)
6. If valid: update the mapping, save config, exit listening mode
7. **Cancel:** clicking anywhere outside the listening cell cancels without changing

### Rejected keys

- **Modifier-only keys** (Shift, Ctrl, Alt, Meta): ignored — not useful as standalone bindings and would interfere with browser shortcuts
- **Tab key**: rejected — breaks accessibility (keyboard-only focus navigation). Show brief "Tab cannot be bound" message.

### Edge cases

- **Escape key binding:** Escape is treated as a normal capturable key (no special cancel behavior). Cancel listening by clicking outside.
- **Only one cell can be in listening mode at a time:** clicking another cell cancels the first
- **E-Stop while in listening mode:** the capturing-phase listener intercepts the keypress, so E-Stop is temporarily blocked during key capture. This is acceptable since the user is actively configuring settings and the UI E-Stop button remains functional.

## App.vue Integration

### Changes

1. **New ref:** `keyboardConfig = ref<KeyboardDefaults>(loadKeyboardDefaults())`
2. **New computed:** `reverseKeyMap = computed(() => { ... })` — builds `Map<string, KeyboardAction>` from `keyboardConfig.mapping`
3. **Replace `onKeyDown`:**
   - Look up `e.key` in `reverseKeyMap`
   - If no match → return
   - **E-Stop always fires:** if action is `estop`, dispatch immediately (bypasses both master toggle and `isInputFocused()` guard — matches current behavior)
   - Early return if `!keyboardConfig.enabled`
   - Early return if `isInputFocused()`
   - If `jog_*` action and `!keyboardConfig.jogEnabled` → return
   - Dispatch: jog actions use existing hold-to-jog logic (jogKeys Set, jog_cont/jog_incr), command actions use existing press-once logic
4. **Replace `onKeyUp`:** same reverse lookup, only matters for jog keys (send `jog_stop`)
5. **Remove:** `JOG_KEY_MAP`, `ROTARY_KEY_PAIRS`, `rotaryJogKeys` computed, `keyboardJogEnabled` ref, all inline key string checks
6. **Remove from Machine tab:** "Keyboard Jogging" section (moved to Keyboard tab)
7. **`settingsVersion` watcher:** add `keyboardConfig.value = loadKeyboardDefaults()` alongside existing gamepad/machine re-reads
8. **Safety on disable:** when `keyboardConfig.enabled` or `jogEnabled` changes to `false` (via watcher or `setKeyboardConfig`), call `stopAllJog()` to clear active jog keys and send `jog_stop` for all axes. Prevents indefinite jogging if disabled mid-jog.

### `isInputFocused()` improvement

Add `document.activeElement?.isContentEditable` check alongside existing `INPUT`/`TEXTAREA`/`SELECT` tag checks. This is a pre-existing gap worth fixing during this refactor.

### Props/emits to SettingsPanel

```typescript
// Props
keyboardConfig: KeyboardDefaults

// Emits
setKeyboardConfig(cfg: KeyboardDefaults): void
```

Handler in App.vue:
```typescript
function setKeyboardConfig(cfg: KeyboardDefaults) {
  keyboardConfig.value = cfg;
  saveKeyboardDefaults(cfg);
}
```

### JogPanel visual feedback

JogPanel currently receives `activeJogKeys` (a `Set<string>` of pressed key strings) and uses `KEY_SECTOR_MAP` to highlight sectors. This needs updating:

**Change:** rename `activeJogKeys` to `activeJogActions` and pass `Set<string>` of action names (e.g., `"jog_x+"`) instead of key strings. This decouples JogPanel from specific key bindings.

In App.vue, the `jogKeys` Set changes from storing `e.key` strings to storing `KeyboardAction` strings. When a jog key is pressed, look up the action and add/remove the action string.

In JogPanel:
- Remove `KEY_SECTOR_MAP` (hardcoded key → sector mapping)
- Add `ACTION_SECTOR_MAP`: `{ "jog_x+": 1, "jog_x-": 5, "jog_y+": 3, "jog_y-": 7, ... }` (action → sector)
- Update all `:active="activeJogKeys?.has('PageUp')"` template bindings to use action strings: `:active="activeJogActions?.has('jog_z+')"`

### `stopAllJog()` — no changes needed

`stopAllJog()` clears the `jogKeys` Set and sends `jog_stop` for all axes. After refactoring `jogKeys` to store action strings instead of key strings, the clear+stop logic remains the same. No functional changes required.

## Key Display Helper

Utility function in `defaults.ts`:

```typescript
function formatKeyName(key: string): string
```

Maps `KeyboardEvent.key` values to user-friendly labels:
- `"ArrowRight"` → `"→"`, `"ArrowLeft"` → `"←"`, `"ArrowUp"` → `"↑"`, `"ArrowDown"` → `"↓"`
- `" "` → `"Space"`, `"Escape"` → `"Esc"`, `"Backspace"` → `"⌫"`
- `"PageUp"` → `"PgUp"`, `"PageDown"` → `"PgDn"`
- `"Delete"` → `"Del"`, `"Insert"` → `"Ins"`
- Single character keys → uppercase (`"a"` → `"A"`)
- Empty string → `"None"`

## Files Changed

| File | Change |
|------|--------|
| `defaults.ts` | Add `KeyboardAction`, `KeyboardDefaults`, `KEYBOARD_ACTION_LABELS`, `KEYBOARD_FALLBACK`, `DEFAULT_KB_MAPPING`, `formatKeyName()`, section registration, load/save functions. Add `"keyboard"` to `SERVER_SECTIONS` Set. |
| `main.ts` | Add `"keyboard"` to `SERVER_SECTIONS` array |
| `SettingsPanel.vue` | Add Keyboard tab template + key capture logic. Remove "Keyboard Jogging" from Machine tab |
| `App.vue` | Replace hardcoded key handling with config-driven reverse map lookup. Add `keyboardConfig` prop/emit to SettingsPanel. Change `activeJogKeys` → `activeJogActions` (action-based). Add `settingsVersion` watcher for keyboard config. Add `stopAllJog()` call on disable. Improve `isInputFocused()` with `isContentEditable` check. |
| `JogPanel.vue` | Replace `KEY_SECTOR_MAP` (key-based) with `ACTION_SECTOR_MAP` (action-based). Update all `:active` bindings on JogButton components. Rename `activeJogKeys` prop to `activeJogActions`. |
| `ManualPanel.vue` | Rename `activeJogKeys` prop to `activeJogActions` (pass-through only, no logic changes) |

## Migration Path

- Existing `MachineDefaults.keyboardJog` is migrated: on first load, if `keyboard` section doesn't exist in server settings, create it with `jogEnabled` set to the existing `keyboardJog` value
- `keyboardJog` field stays in `MachineDefaults` for one version (ignored if keyboard section exists), then removed

## Out of Scope

- Modifier key combinations (Ctrl+X, Shift+Arrow) — possible future enhancement
- Per-axis jog speed bindings
- Macro key bindings (macros have their own system)
- Keyboard shortcuts for tab switching or UI navigation
