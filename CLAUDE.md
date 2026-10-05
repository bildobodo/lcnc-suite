# LCNC Suite — Project Context

## Architecture

```
lcnc-webui/src/     Vue 3 + TypeScript frontend (Vite dev server, port 5173)
lcnc-gateway/       Python FastAPI + WebSocket backend (uvicorn, port 8000)
subroutines/        G-code subroutines shipped with the project
  probe_basic/      62 probing .ngc files (bundled from kcjengr/probe_basic, GPL v3)
  tool_length_probe/ bundled from TooTall18T's tool length probe (GPL v3)
  surfacemap/       bundled from mhubig/surfacemap_usertab (GPL v3)
```

Gateway connects to LinuxCNC via Python bindings (`linuxcnc.stat`, `linuxcnc.command`, `linuxcnc.error_channel`). WebUI connects to gateway via WebSocket at `/ws`.

The bundled routines retract with `G53 G0 Z0` and assume **machine Z0 is the top of travel** (LinuxCNC's convention: `[AXIS_Z] MAX_LIMIT` at or just above 0 — true on every shipped config; the XYZAC example carried Z 100..500 until 2026-09-27 and was moved to −400..0 with the A/C intersection at machine Z −500, `xyzac-trt-kins.z-rot-point`). The suite's own retracts (→ Zero / → Home / → G30, run-from-line safe-Z) additionally never LOWER Z (`#<_abs_z>` guard); the upstream toolsetter/probe files keep the bare idiom, so a config whose Z0 is not the top must not run them (recorded 2026-09-05).

## Frontend Structure (lcnc-webui/src/)

- `App.vue` — Root component, sidebar + multi-panel tab layout, state management
- `ChoiceGroup.vue` + `MachineChoice.vue` (+ `choiceGroup.ts`) — the strip's choice groups (operator point P7, Codex R21–R24; the 18 px radio rows are gone): options are `MachineChoice` buttons (`role="radio"`, catalog gate from INPUT_DEFS, `min-height`/`min-width` `--control-h` — 28 / 36 px in the strip), ONE Tab stop (roving tabindex, kept where the operator left it: a status change never pulls focus), every navigation key default-prevented with a modifier too (the TabNav rule — a focused option once sent `set_mode`/`set_kins_mode`/`mdi G55` on one arrow). `activation="manual"` (default) = a MACHINE command: radios in a `role="toolbar"` (APG) — the arrows only move focus, click/Enter/Space choose; the group SENDS through `act` (the caller's `fire()`, which returns the `req_id`; not sent = no pending) and waits for THAT reply (`lcncWs.awaitReply`): the checked option is the CONFIRMED state, a chosen one is `pending` (warn bar, `aria-busy`) until the status shows it or `PENDING_MS` (5 s) → "Not confirmed — the machine shows X" at the option (never "failed", no retry), cleared on disconnect; a REFUSAL of its own request ends the pending at once and says why at the option (+ a quiet log line) — an older request's refusal never cancels a newer choice (Codex R25 OP-I04). `activation="auto"` = a LOCAL setting (the jog step): a plain radiogroup, the arrows choose. A row by default; `columns` = a grid by row (Up/Down a row), `rows` = a grid by column, `fill` = a grid as wide as its container that adds nothing to the container's own width (`width: 0; min-width: 100%`). Checked = a tint AND a 3 px bar, never colour alone.
- `stickyHead.ts` — `v-sticky-head` on a `.dataTable` scroller: keeps `--sticky-head-h` at the head's `offsetHeight` (ResizeObserver), the table's `scroll-padding-top` — a row focused by Tab lands below the head (WCAG 2.4.11). The head sits over every cell (`--z-sticky-head`) and draws its bottom rule as an inset shadow (a border scrolls away with a sticky head) — operator P2.
- `TabPanel.vue` — A `TabNav` over v-show panes (`role="tabpanel"`, named by the tab; a hidden pane is display:none, never focusable). Props: tabs, modelValue, `label` (the navigation's accessible name), `variant` (main = the side pane, sub = Settings), `narrow` (a labelled select instead of the list, with the `bar` slot beside it on the same row)
- `TabNav.vue` — the ONE tab navigation (design wave D3, UI-K17/K12): `tablist` of `tab` buttons (`MachineBtn` `tabMain`/`tabSub` — the look lives in Btn.vue's `tab` prop, the layout in style.css `.tabNav`), ONE Tab stop (roving tabindex on the selected tab), MANUAL activation (arrows move focus, Enter/Space select). Left/Right in reading order with wrap, Home/End, Up/Down a grid row (`columns`, Probing's 4 × 2); ALL six are default-prevented, WITH a modifier too — the shortcut map listens on window (bubble), matches `e.key` alone and returns on `defaultPrevented`, and with the default mapping the arrows jog (`tabs.spec` mutation-checked: without it a focused tab sent 16 jog commands; Ctrl/Alt/Meta+Arrow on a focused tab still jogged until round 4, UI-DI06); only the bare key (or Shift) moves focus. Selection is a SHAPE (main: top-rounded, the selected tab open to the content, a cover shadow over the list's baseline; sub: a 2 px bar), focus the global `:focus-visible` ring — never the same signal. Height `--control-h` (32 / 44 px touch). `tabIds(base, id)` names a tab and its panel; the caller renders the panel with `role="tabpanel"` + `aria-labelledby`. Used by TabPanel (side pane, Settings), ProbePanel (`probeViews.ts`, 4 × 2), HalshowTab (Pins/Signals/Params). NARROW side pane (content width < `NARROW_PANE_PX` — 432 px since the sixth tab, DR decision, 150 % portrait): App's ResizeObserver on `.sidePane` (clientWidth, layout px) switches the area list and Probing's grid to two `MachineSelect`s (`tabSelect`) on one row and marks the pane `.sidePane.narrow` — the ONE narrow flag every narrow rule hangs on (no container query: one threshold, so the selects and every narrow rule flip together); `probeView` lives in App (`v-model:view`). A tab switch sends nothing; a jog still running (keyboard or pointer) stops at the switch — the main tab AND the Probing procedure, grid or narrow select (`stopJogOnNavigation`; the procedure kept jogging until the keyup, round 4, UI-DI11) — only then, `stopAllJog` sends a stop per axis whenever jogging is allowed.
- `ThreeViewer.vue` — Three.js 3D viewer (Z-up, OrbitControls, ResizeObserver)
- `ViewCube.vue` + `viewer/cubeFaces.ts` — the view cube, the ONE orientation display (operator 2026-10-04/05, from renders): its faces are named by AXIS — X+, X−, Y+, Y−, Z+, Z− — and lightly tinted with their axis colour (`--viewcube-tint` over `--viewcube-face`, alpha-composited in the face texture; `axisColors.ts`). FRONT/LEFT were fixed to the world frame (+X / −Y) and read wrong on a machine whose front is −Y (the 5-axis sim's "LEFT" was its front). A STRAIGHT view shows the face's two in-plane axes as plain arrows ON THE DISPLAYED SQUARE'S BORDER (the 0.96 face less its texture border — on the cube's own edge they sat 1.5 px outside), the whole side long, both from the corner from which they run positive (seen from −X or +Y the horizontal one runs left), the letter outside past the tip; they fade in below 16° off the face normal, whole below 6° (`arrowOpacity`), so an oblique view stays quiet. Arrows and letters draw over the cube and are never raycast targets (the click reads only the hit grid). The corner gizmo of the viewer (a 140 px viewport fixed 8 px above the canvas's bottom-right — under the scrub bar most of the time) is gone; the work-zero triad in the scene stays. The view presets are named by the face they show (`setView("z+" | "z-" | "x+" | "x-" | "y+" | "y-" | "iso" | "dimetric" | "reset")`). `__viewerDiag.getViewCube` (labels, arrow opacity, the projected border and arrows); `cubeFaces.test.ts`, `e2e/viewcube.viewer.spec.ts` (border, whole side, letter outside, direction per side view, axis-coloured pixels; 7 mutations red)
- `GcodePanel.vue` — G-code viewer with syntax highlighting, inline editor, program controls, run-from-line. PORTRAIT edit mode (`compactEdit`) folds the file ops, the run controls and the progress row while nothing runs or pauses — the editor is the on-screen keyboard's readout and had 13.5 px left at 150 % on 900 × 1200 (review round 3, UI-I08); a running/paused program brings Pause/Abort back. The run options (M01, /BD) and the management sit behind "More" at the end of the action row (`MoreMenu.vue`; an option that is on stays named on it: "More · M01"). NARROW (`.sidePane.narrow`, 150 % portrait: 271 × 266 px of tab content) the rows sit at `--gap-tight`, the run grid is TWO rows — Start · Step · Pause, then Abort … More at the right end — with Step and Pause / Resume as SYMBOLS there (`.ctrlWord` hidden; their name is the word in every width — operator 2026-10-05: with their words "Start L1234" ran 4 px out of the 269 px row, with the symbols "Start L1234567" leaves 46 px): three whole code lines (`--code-line-h`, 23 / 32 px) and Abort in view — the head used to take all 272 px (round 4, UI-DI09). The program holds are bound to the published REVISION (`programRevision` / `programTextRevision` from `ws/bulkData.ts`: `<file>#<version>` of `viewer_gcode_ready`, set on ARRIVAL, and the revision whose text is displayed, set when the fetch lands) — the arrival cancels a running hold, the landing one begun while the text loaded; until it lands Start, Step and the Run-from-line action wait ("Loading program — wait"). Every re-parse bumps the revision (a drift re-parse after a touch-off too). A line selection belongs to its program and text: another program or a changed text clears it and closes a Run-from-line dialog opened on it (round 4, UI-DI05). The followed line — the run's, the simulation's, the indented sub view's — GLIDES (`codeGlide.ts`, operator 2026-09-30: a hard scroll per status packet moved the text by 0, 3, 5 lines at a time and the highlight "zuckt"): each new target is reached over the last packet gap (30–150 ms), evenly, one step per animation frame, so at a steady pace the code scrolls under a centred highlight that stays on the line that actually runs (at most one packet interval off centre — no band lagging the machine); after a pause in the packets (a dwell, a long move) the next step glides over the longest duration — a jump from rest was a jerk of its own; a jump further than two viewport heights and `prefers-reduced-motion` snap. The running line NEVER leaves the view (Codex R52 VP-I21: at 20 lines a packet the highlight moved at once while the text followed over the interval — out of view in 81 % of the frames): a glide starts inside the line's VISIBLE BAND (`visibleBand`: the scroll tops that keep the row with one line of margin in the viewport, mapped through the scaled scroll space), a step past it puts the text at the band's edge at once and glides the rest; a view under three lines snaps. `setScroll` sets the element and the virtual window's `scrollTop` in one step; a REBUILT viewer element (the editor closed, the text back after an unload) re-reads its position, and another program opens at its first line — the old position rendered rows past the visible part and the code stayed blank until a scroll (live look 2026-10-01). `layout.spec` drives 3 lines per packet at 30 Hz (hardly a frame moves a whole packet's step — measured at ≥ 50 fps — and the last line centred) and 20 lines a packet forwards and back, requiring the highlighted row wholly in view in EVERY frame of both phases
- `GcodeReferenceDialog.vue` — Searchable G/M-code reference dialog, as wide as Settings (`lg` `wide`, operator 2026-10-03 from renders): nothing scrolls sideways — Name and Syntax wrap; a dialog narrower than 520 px (`@container` on its content: portrait at 150 %) stacks each row as a CARD (code and name, then description and syntax; the group only in the filter) under the same sticky head with its two sort buttons. It opens three ways: plain (the header button — keeps the operator's search and group, never the codes block's view), AT a code word (`openGcodeRef({ at })`: a code tapped in the program — the whole list, scrolled to the entry or every form the word heads, each row marked with the selection tint, a bar and `aria-current`; a word with no entry searches for it, never a blank jump; it used to set the word as the search: "G1" found G10–G19), and on "Active now" (`{ active: true }`: the Safety strip's codes block — a filter option beside the groups that lists exactly the active codes the reference knows, the footer names the ones it does not, "not in the reference: G8"). `gcodeRefView.ts` (pure, tested) holds the rows (natural order: G2 before G10, G10 L2 before G10 L10), the targets (`refTargets`: G01 is G1, G10 heads its L forms, G38 its .2–.5) — the code panel's tooltip uses them too — and the strip's code words (`gCodeWords` / `mCodeWords` from STAT). `e2e/gcode-reference.spec.ts` (8 mutations red)
- `MessagesDialog.vue` + `messageView.ts` — the message center (the feedback channels' PROTOCOL), laid out like the G-code reference and the Macros tab (operator 2026-10-04, from renders): a search row with ONE filter for the type AND the origin (All messages / Errors / Info / Display / From LinuxCNC / From the WebUI), a table with a sortable head (Time — newest first —, Type, Source; `aria-sort`), Copy and the trash per row (the trash deletes at once; Clear All asks), the count in the TITLE ("Messages (7 of 12)" — a footer line cost the touchscreen's low dialog a row), "Copy All" becomes "Copy Shown" and copies exactly the rows shown, each line naming type and origin. The types are LinuxCNC's three (kind 1–2 error, 3–4 info, 5–6 display). Every message keeps its ORIGIN (`LcncMessage.source`): the error channel's entries (`status.errors`) are "linuxcnc", every `pushMessage` "webui"; one stored before origins were kept shows "—", is in neither origin filter and sorts last either way round. ONE narrow flag (a ResizeObserver on the content, < 520 px — 150 % portrait; the side pane's rule: one threshold) makes each message a CARD (time · type · source, the text under it, Copy over the trash at its end, over both lines) and the header's Copy / Clear All symbols with the same names — the old list broke its text letter by letter there, and the header ran 8 px out. Initial focus: the search field. `messageView.test.ts`, `e2e/messages.spec.ts`, `select-writes.spec` (the filter while messages arrive) — 11 mutations red.
- `ProbePanel.vue` — Probe operations grid, calls `O<probe_*> CALL` via MDI
- `ToolTablePanel.vue` — Tool table with load/delete dialogs, STL upload, 2D preview. The table is READ through `request()` — its OWN reply (req_id), the newest read only (operator 2026-10-04: it waited without a limit for any reply named get_tool_table, and a read lost in a reconnect left "Loading tools…" until a browser refresh): after 8 s a slow read says "No reply from the gateway yet — retry" and still takes its late reply; no reply in 60 s, or a lost connection, ends the read with the reason; a table not read shows "Tool table not read.", never "No tools in the table"; `tool_table_changed` and a reconnect read again — the ToolStrip too (it used to take the tab's reply along). Nothing takes an unsolicited reply: the specs serve the table like the gateway (`e2e/ctl.ts` `publishToolTable`: the mock's `replyFor` answers every read with its req_id, then `tool_table_changed`; unscripted, the mock answers a read with an EMPTY table — a gateway always answers — and `replyFor … "silent"` scripts one slow to answer); `tool-table-read.spec`. Header X and footer Cancel run ONE check: an unchanged form closes at once, an edited one asks "Discard changes?" (Keep editing / Discard) like the G-code editor (UX-02). A running library import keeps its preview dialog: X, Cancel and the backdrop wait for the reply (`cancelImport` returns while `importBusy`, like `cancelDelete`) — hiding it cancelled nothing (UI-K16).
- `ToolPreview.vue` — Small orthographic Three.js canvas for tool side-view preview
- `toolGeometry.ts` — Shared tool geometry utilities (vertex colors, fallback cylinder)
- `toolTypes.ts` — Shared TOOL_TYPE_LABELS map (18 types) + toolTypeLabel() function
- `format.ts` — Shared formatters (fmtCoord, fmtAxisValue, fmtNum, fmtCell, fmtOffset, fmtRpm, fmtElapsed, fmtDuration, fmtDist, fmtSize, fmtPct, fmtRatio, fmtMs, fmtQty, fmtUnit) and `NO_VALUE` ("—"), the ONE display placeholder for a missing value — never an input value. Units are set off by a space and come from their source through a formatter; words, case, state words and units follow `docs/ui-glossary.md` (design wave D0; the CSS audit's `ELLIPSIS` and `UNIT_LITERAL` categories enforce the mechanical part)
- `wcs.ts` — ONE source for fixture names: `G5X_LABELS`, `g5xLabel(idx)` (1-based g5x_index → "G54"…"G59.3", `NO_VALUE` for none), `RESERVED_WCS` (the TWP scratch rows). App's label, the WCS selector and the viewer's fixture markers all read it.
- `mathEval.ts` — Safe expression evaluator for the number keypad (one decimal literal per number token — `1.2.3` is refused, never prefix-parsed) + `validateEntry(expr, constraints)`, the ONE admissibility check (min/max/integer, empty = 0 visibly) behind the keypad's readout, OK button and confirm()
- `useNumberKeypad.ts` — Number-keypad session singleton with an OWNER model: `openKeypad({ownerId, constraints, canConfirm, context})`, `closeKeypadIf(ownerId)` (unmount / gate closed), owner veto at confirm; `MachineInput` is the standard owner
- `inputSession.ts` — ONE on-screen input helper at a time (WP8): the number keypad (`useNumberKeypad.ts`, its facade) or the text/code keyboard (`TextKeypadStrip.vue`), owned by one target (`ownerId`). Opening is a deliberate tap/click or the keyboard glyph, NEVER focus; field + glyph + strip section form a focus area (`data-input-area`). Leaving — for BOTH helpers, one document listener each — is a pointerdown outside EVERY input area, or focus ARRIVING outside the owner's area (Tab out of the field or out of a key): hide without confirming, the owner keeps its draft. A pointerdown on ANOTHER owner's area is a switch, not a leave (the click opens the new session; hiding on the pointerdown re-flowed the strip under the finger). A hidden-but-mounted owner LOCKS the session (polled here through the number trigger's / the text target's visibility; App's tab watcher locks MDI/editor at once) — a backstop for non-pointer hiding, since a tab TAP is itself an outside pointerdown. Number drafts live in `useNumberKeypad.ts` (`closeKeypad(keepDraft)`, filed by the strip on unmount) and come back marked; `''` IS a draft (the entry after C = 0, shown "= 0"). A draft ends with its OWNER's context, never with whichever session is open: `closeKeypadIf(ownerId)` drops the owner's draft whether or not it holds the keypad and closes only its own session, `dropDrafts(match)` ends a panel's cells at once (OffsetPanel gate end / unmount). The busy latch after any `fire()` is NOT an owner end — or every neighbour's OK would have wiped every filed draft (review round 2) — but a real backend revocation INSIDE the latch is: `MachineInput`/`OffsetPanel` watch the OWNER permissions (`useOwnerPermissions()`, the backend classes under armed/sim WITHOUT the latch term), never the displayed reason, where "settling" outranks the backend's reason (round 3, UI-I05). Keys of both helpers act on CLICK with `pointerdown` default-prevented: pointer (tap/click) and keyboard (Enter/Space on a Tab-focused key) activate a key exactly once, and the number keypad's root handles Enter/Space only while no key holds focus (Enter on a focused Cancel used to confirm the value — UI-I10). Focus return after OK/Cancel (`returnFocusTo`) is a guarded TRANSITION: the field's own confirm disables it for the latch and drops the focus it just took, and an unfocused document is where Space is Cycle Start — `focusReturn.pending` keeps the modal guard up until focus has LANDED (field once it can hold it, whatever the operator focused meanwhile, else the strip), decided per animation frame, 2 s backstop (review round 2, UI-I06). The keyboard glyph is ONE app-wide element (`inputGlyph`, rendered by `FloatingOverlays.vue`). Enter is target-specific (MDI sends, editor newline, a text field closes) — a search field never reaches the machine; the confirm key READS "Apply" in both helpers (operator 2026-10-01: it read Apply / Send / OK), its accessible name starting with that word (WCAG 2.5.3; the MDI one is "Apply — send the MDI command"). `textKeyboardPages.ts` (pure) holds the Code/ABC/123/#+= pages; its unit test pins full printable-ASCII + umlaut coverage. Every page reads ROW BY ROW in both orientations (landscape 6 wide × 5, portrait 5 × 6 — landscape used to run down the columns); the Code page is laid out in BLOCKS for the grid's width (`codePage(axes, cols)`): the digit block 7 8 9 / 4 5 6 / 1 2 3 / 0 . - left, the letter block (G M T F S, the axes, the fill) beside and in portrait below it, ; ( ) # after — one inner reading order in both (design wave D7). An EXPLICIT close (the keyboard's X key) hands focus back through the same guarded return — `closeTextSessionByOperator` reads the owner's `TextTarget.focusEl()` BEFORE the session ends: activated by Tab + Enter/Space the key unmounted with focus ON it, focus fell to `body`, the guard fell with the session and the next Space was Cycle Start (round 4, UI-I10); the LEAVE paths (outside pointerdown, focus arriving outside, a switch) never pull focus back. The MDI line sends on KEYDOWN (`onMdiKeydown`, `e.repeat`/IME guarded) — a keyup handler would have sent the draft on the keyup of the Enter that activated the X — and hands focus back after every send (`afterSend` → `returnFocusTo`): its own send disables it for the busy latch, the UI-I06 class. Both helpers CLOSE the same way (UX-01, operator decision 2026-09-21): the X hides and KEEPS the entry — the number keypad files it as the owner's draft (`closeKeypad(true)` + `returnFocusTo`), `Discard` is its explicit throw-away, `Apply` confirms; every key has an accessible name (`Backspace`, `Clear entry`, `Divide` …) and the word keys sit in zero-padded `--key-size` cells. The close X is each helper's TOP-RIGHT key, 44 × 44, in both orientations, and RED like the number keypad's Discard (catalog `numClose` / `numDiscard`, both `danger` — operator 2026-10-01 from renders: found at a glance; the X still keeps the entry, its title says so) (design wave D7, operator decision 4): the number keypad's readout heads its grid with the X at its right — TWO right-aligned lines, the entry on top and the result preview / draft mark under it (live look 2026-10-01: a preview left of the entry read as part of the number; the lower line is always reserved, so the entry never moves) (landscape: Discard · ═ · Apply (2 rows) down column 6; portrait: Discard (2) · ═ · Apply (2) the bottom row), the text keyboard's X heads its page rail (landscape) / ends its page row (portrait) — DOM order unchanged, the X last in the Tab order. Both helpers are 5 key rows high in landscape (236 px under the title).
- `btnHint.ts` + `FloatingOverlays.vue` — the ONE transient control hint ("Hold to activate", "Busy — try again", a dimmed control's reason) and the ONE keyboard glyph, rendered once in App. The hint is placed FROM ITS RENDERED SIZE through `placePopover(…, "above")` (above the control, else below, clamped to every edge, width capped by the viewport, viewport px ÷ `cssZoomOf`), stays at most `hintDuration(text)` (1.5–4 s by length) and closes on the NEXT pointerdown or key anywhere (window capture — a press that asks again closes the old hint first), on any scroll — except the asking press's own reveal: a scroll within 300 ms of the hint re-places it (the press focused a half-hidden control and the browser scrolls it into view a frame later; the hint closed 24 ms after it appeared, the flake of choices.spec's reserved G59 in three gates, 2026-10-04) — or when its control leaves the document (design wave D1, UI-D08; operator: a hint never lingers over buttons). Its anchor may be a getter resolved at placement (`MachineBtn` passes one: a gate closing under the finger re-renders the button into its `.btnTip` wrapper). The hint and the HelpIcon popover are ONE card (`.helpPopover, .btnHint` in style.css: panel, border, radius-lg, shadow-md, fs-sm, body typography, `white-space: normal` — a popover inherits `nowrap` from a HUD row or a stats label through the DOM). Never a Teleport inside `MachineBtn`/`MachineInput`: a second root makes the component a fragment and Vue no longer stamps the parent's scoped-CSS id on the button/input — every `.nkKey`/`.tkKey`/`.safetyBtn`/`.mdiInput` rule silently stops applying (implementation review UI-I07).
- `gateExplain.ts` — `useGateExplain({gate, disabled, reason?})`: the ONE explanation path for a dimmed control (UX-09) — the caller's reason while it disables the control, else the gate's from the reason map, offered only while armed; `explain(at)` tells it AT the control (the btnHint, anchored on the event's control) and NOWHERE else — never the status line, never the message log, which is reserved for machine information (`explainAt(at, reason)` is the same path for a caller without a composable per item; design wave D1, UI-K18, operator decisions 2026-09-23/24), `onKeydown` makes Enter/Space say it and stops Space before the shortcut map, `label` names the affordance. `MachineBtn` wraps in `.btnTip` (focusable); label-rooted controls (`MachineToggle`) carry title/tabindex/role/aria-label/click/keydown on their root; `MachineChoice` (a `role="radio"` BUTTON, `aria-disabled`, never `disabled`) explains on its click — Enter/Space are clicks; input-rooted controls (`MachineInput`, `MachineSelect`, `MachineSlider`, `MachineRadio`) stay single-root and explain on `pointerdown` + `title` — Chromium ≥ 116 and Firefox ≥ 105 deliver pointer events to disabled controls, a disabled input is not keyboard-reachable (documented limit; Safari unverified). A ChoiceGroup option carries the caller's reason itself (`ChoiceOption.reason`: SetupStrip's reserved TWP rows).
- `FormField.vue` — the ONE labelled field (design wave D4): label ABOVE the control, wired `for`/`id` (a label tap is a tap on the field — a number field opens its keypad); the head row holds the label, the "?" as the label's SIBLING (inside a `<label for>` a role=button joins the field's name) and the unit, right-aligned above the right-aligned value; unit and error are the field's `aria-describedby`. The control is the caller's catalog component bound through slot props — `input` (MachineInput: + `label` and `context` = "Slow Feed · mm/min", the keypad readout), `field` (any labelable control; `<output class="formValue">` for a read-only value), `group` (a radio group, the label a plain span) — so the single-root controls keep their scoped CSS. `wide` spans both grid columns; `inline` puts label, "?", field and unit in ONE row (only where a fixed section has room for one row: the rough sizes under a probe grid).
- `probeFields.ts` — the Probing and Toolsetter parameter fields as data (label, help ≤ 120 chars, unit kind, min/max, integer), rendered through FormField; `unitText(kind, linearUnit)` — lengths and feeds from the machine's linear unit, a share in %, counts and tool numbers without a unit.
- `DetailsPopover.vue` — a labelled detail card behind one header button (design wave D5, K06): the diagnostics that are not operating states (clients, latencies — "Connection details"); a native popover in the shared `.helpPopover` card, placed like HelpIcon's, no dialog role. The header keeps the operating states (clock, WS, LinuxCNC, ARMED, input icons) and one button height; Shutdown's caption sits beside its icon.
- `HelpIcon.vue` — the ONE tap-friendly help pattern (UX-11): a native `popover="auto"` opened by a focusable `span role="button"` named `Help: <label>` (prop `label`); content through the slot. A span, not a `<button>` (design wave D1 live look): a button inside a Gate's disabled fieldset is disabled and dimmed — help went dead with its section, though reading help is never a machine action; the span toggles its popover itself (`showPopover`/`hidePopover`; the open state at `pointerdown` decides, because light dismiss closes the popover before the click arrives), cancels its click (a "?" in a toggle's label never flips the toggle nor fires its tap-to-explain) and owns Enter/Space. It brings its OWN gap to the text it explains (`margin-inline-start: --gap-tight`; a container never spaces it — no space before `<HelpIcon>` in a template), and a box whose text ends in a "?" lays both out as ONE centred flex row (`.textWithHelp`, or `display: flex; align-items: center` on the chip / HUD line / label class): `vertical-align: middle` centres on the x-height (low beside uppercase), and an inline box is a line-break opportunity that can drop the "?" onto its own line. Its text is what the value is and the one rule the operator needs, at most 120 characters (the CSS audit's `LONG_HELP`; the popover sweep caps the rendered text at 140). Escape while it is open is still E-Stop (capture listener) and closes the popover. In a strip title the icon is absolutely positioned at the right edge (out of the flow — a 264 px section has no height to give) and on touch it is the declared 16 px square (the generic 36 px button floor is reset for it) with an INVISIBLE `--help-hit` (24 px) target around it — `::before`, centred on the padding box, adding no layout, so the glyph stays in its label's line box (design wave D6); its size is ONE token, `--help-icon-size`, which a label anchoring it out of the flow reserves beside its text (JogStrip's "Kinematics Frame" label is `fit-content`, so its "?" sits beside "Frame" in a column its choice rows widen — a block label put it at the column's edge, K6; the help-look sweep measures the gap of every pinned "?" outside a `.sub` title). Used by the probe/toolsetter forms, `MachineToggle`'s `help` prop, JogStrip's Kinematics frame and SetupStrip's Go-to block — never a long `title` on a control for an explanation. The popover is PLACED FROM ITS LAID-OUT SIZE (`helpPlacement.ts`, pure: below the trigger when it fits, else above, else the roomier side with a capped height and an inner scroll) in the animation frame after `beforetoggle` — measuring inside `beforetoggle` read a display:none 0 × 0 and every popover opened off the bottom (round 5, UI-I13); the inline left/top/max-* are reset before measuring (a stale `left` narrows a shrink-to-fit fixed box), viewport px are divided by the CSS zoom (`currentCSSZoom`, else rect/offset ratio) for the element's own left/top, and it reads in body typography whatever `.sub` title it sits in.
- `MoreMenu.vue` — the ONE "More" disclosure (operator 2026-10-02): a tab's management and options behind one button (catalog `more`, gate `always`) at the RIGHT end of its action row. A disclosure (`aria-expanded` / `aria-controls`), not an ARIA menu: its items are the catalog's own buttons and toggles with their gates and reasons. The panel is a native `popover="auto"` (top layer, but in the DOM inside the Gate's fieldset — a closed gate disables its items), the trigger its native invoker (`popovertarget`, exempt from light dismiss), placed from its laid-out size by `placePopover(…, "below", "end")` (end edges aligned). NO display utility on the popover element itself — an author `display` beats the UA rule that hides a closed popover (the items showed inline); the stack is an inner `.moreMenuItems`. Keys: Enter / Space toggle; opened by keyboard the first item takes the focus; Up / Down / Home / End move among the items and EVERY arrow is default-prevented, with modifiers too (with keyboard jog on, an arrow that reached the shortcut map jogged — macros.spec proves it red with a bare-page control); Tab out or a press outside closes it; Escape stays E-Stop. A press on a BUTTON item closes the panel and puts the focus on the trigger in the CLICK CAPTURE phase — in the bubble phase it came too late: Vue rendered the dialog the item opened in the microtasks between the two listeners and the dialog's focus was taken away (measured) — so the dialog's opener is More and its guarded return lands there. `folded` names options that are on ("More · M01"), open or closed; the trigger keeps ONE width — it reserves its widest label (`reserve`, every option on: "More · M01 /BD") in the open state's semibold (operator 2026-10-03: opening it, selected = semibold, and the option leaving the label made it jump; macros.spec measures Program, Tools and Macros). Tests open it with `e2e/more.ts` (`moreItem` / `clickMore` / `tapMore`).
- `modalRegistry.ts` — `registerModal(isOpen)` (DialogFrame calls it for every dialog while it is mounted); `modalOpen` (dialogs or keypad) makes the global shortcut map pass nothing but E-Stop. The guard spec compares the DOM's overlay count with the registry (a forgotten registration is a test failure, not a silent gap). Since design wave D2 also the DIALOG STACK (`pushDialog`, `popDialog`, `topDialog`, `dialogBelowEl`, `inDialogScope`) and its FOCUS SCOPE. ONE order decides the visible layer AND the operating position (initial focus, Tab scope, helper pause, focus fallback, focus return — implementation review UI-DI01): a machine flow (kind `flow`, whose `.safetyDialog` tier DialogFrame binds to the same kind) stays above every other dialog, so a dialog opened while a flow is up (the header stays reachable by pointer) is inserted BELOW the flows; within a tier the order is the mount order = the Teleport's DOM order. Each entry carries its `opener`; a LOWER dialog closing first re-points every opener above that lay inside it to its own (the eventual return lands on the bottom's opener whichever sibling Vue unmounts first). while a dialog is open, Tab / Shift+Tab (a document keydown-capture handler whose first line returns without a dialog) walk only the topmost dialog, its own input helper (same `data-input-area`), the safety strip and the banner's Abort / Acknowledge (`data-dialog-reachable`, UI-D01); a radio group is one stop. `takeOpener()` = the focused element, else the last pressed control (macOS Safari/Firefox do not focus a clicked button) — and the pressed control when the focused element is a dialog CONTAINER and the press is under 1 s old (there a container keeps focus through a click on its X or a header button). It registers inputSession's focus fallback (the topmost dialog's initial focus, else the strip — never `body`; the fallback counts only a VERIFIED landing — `focus()` on a control a Gate disabled is silently ignored). Focus that falls to `body` while a dialog is open (a disarm disables the focused field through the content Gate: Chromium moves focus to body with a focusout, verified) goes to the topmost dialog's CONTAINER one frame later — unless a focus return is in flight (`focusReturn.pending`, a closing dialog owns its landing) or the focus moved to a control (a strip button by pointer); Firefox/Safari may keep focus on the disabled control, there the next Tab recovers (review UI-DI04). `__modalRegistry.top()` names the topmost dialog for the scan.
- `DialogFrame.vue` — the ONE dialog frame (design wave D2, plan Anhang B): Teleport (defer) to `#content-dialog-area`, `role="dialog"` named by its title (`aria-labelledby`), the tier (`size`: confirm / md / lg, `wide`, `full`, `box-class` for a per-dialog size rule — GLOBAL, the caller's scoped rule never reaches the box), the header X (`close-label`, class `dialogClose`), the `#header` and `#actions` slots (`.dialogActions` is the frame's; the cancel side LEFT, the verb repeated right), self-registration in the registry and the stack while mounted (callers mount it with `v-if` and never call `registerModal`), the initial focus (`initial-focus`; by kind: form → first field, info → the X, host → the container, confirm / flow → the first action = the safe one; a flow with two machine actions passes `container`), `pauseInputIn` of the dialog below (or the panels) on mount, and the guarded focus return on unmount. Only the TOPMOST dialog is an operating position (implementation review UI-DI01/02): one opened under a machine flow waits behind it — no initial focus, no pause, and focus a header click took goes back to the flow; only the topmost returns focus when it closes — with a dialog left, its opener counts only inside that dialog's scope (a child's control in its parent), else the guarded return falls back to the new top's initial focus (the header button that opened a flow over Settings is outside Settings' scope); a LOWER dialog closing under a surviving top (the machine ends a tool change under a confirm, a save replies under Settings) leaves focus alone. The initial target must take focus: disabled (incl. by an enclosing Gate — Settings' selected tab while disarmed, review UI-DI04), not rendered, or outside the visible part of the dialog's content (WAI-ARIA APG: the initial focus never hides a dialog's beginning — Run from line's first option under its warning text at 1280 × 720) → the container, which always can. ONE close policy by `kind`: info / confirm close on X and backdrop (emit `close`), `form` and `flow` ignore the backdrop (N41), `host` (Settings) emits for its own guard, `busy` closes nothing until the operation replied (the caller clears it on success, error and lost connection). No native `<dialog>`, no `inert`: both would make the safety strip unreachable, and a modal `<dialog>` turns Escape (E-Stop) into a cancel. Dialogs stay inside the armed Gate: disarmed, their buttons are disabled with everything else (default-deny); the container (tabindex -1) stays the focus fallback. The CSS audit's `DIALOG_FRAME` fails the gate on a hand-built overlay (`dialogOverlay` class or `role="dialog"` outside this file); `e2e/dialogs.spec.ts` scans all 25 dialogs from one table (role, name, tier, action order, initial focus, Tab scope, Escape = exactly `estop`, backdrop, focus return, registry, and a HIT TEST: a pointer at the focused element's centre lands in the focused dialog, never on another layer's scrim) and scans each again NARROW — opened at the desktop size, then 900 × 1200 at 150 % with touch density: nothing sideways, the dialog inside the content area (2026-10-04: Program Stats and Run from line ran out of it on both sides, the message center's header 8 px out of its dialog; the scan had run at the desktop size only) plus the UI-D01 and UI-D06 acceptance cases and the stack orders of review round 1 (flow ↔ Settings / Messages both ways, a lower flow or a save ending under a surviving top).
- `gcodeHighlight.ts` — G-code syntax tokenizer + highlighter (shared by GcodePanel + MDI history)
- `OffsetPanel.vue` — WCS offset table editor (G54–G59.3), inline cell editing, auxiliary rows (G52/G92, G43, Comp). Operator P5/P6: an editable value is a BUTTON (catalog `offsetCell`, Btn's `value` look — the cell's typography; Tab, Enter/Space open the keypad), four cues for four states (active fixture = a bar + `aria-current`, selected for Clear = the row tint, edited = the cell's inner edge, focus = the global ring); A/B/C and R in degrees. Locked the value is TEXT in the button's place (`data-layout-slot` — the layout sweep holds it to the button's footprint): a dimmed button would fade 70 values read during a run. Locked means the OWNER `probe` gate (`useOwnerPermissions`, no busy latch — the latch must not flip the table after every confirmed value); the cell's editable tint and a tap stay on `can.probe` (a tap inside the latch opens nothing — UI-I05's draft contract). A focused value keeps a focus in its cell: the button's focus goes to its text (`tabindex="-1"`; arrows, Space, Enter stay there — never BODY, where an arrow jogs) and back to the button when the gate opens; ONE reserved line under the head says what a tap does or why the values are read-only (`Read-only — <the probe gate's reason>`, nowrap) — Codex R25 OP-I06, answer 5. `offsetRows.ts` (pure) reads G52/G92 and the tool offset in effect (row "G43" — "Tool" read as the Tool strip's table length) from their CANONICAL slot (`"XYZABCUVW"` — on XYZAC the C column showed B), a missing or short vector is unknown, comp enabled with no amount is unknown; ONE summary line says "nothing in effect" only when every source is known, else names the unknown ones. A "?" in the head's corner (the name column is fixed at 56 px) says what G52/G92 is — one register, kept BY DEFAULT after program end and restart (`[RS274NGC] DISABLE_G92_PERSISTENCE = 1` clears them — the help never claims more, Codex R36 OP-I07), G92.2 suspends it — and that G43 is in effect, not the tool table; the rows carry no explanatory title (operator P6, 2026-09-29). Clear <fixture> / Clear All are hold-to-fire (operator decision 2026-09-19); their titles name the hold and its target, Clear All's accessible name spells out the scope (all work offsets G54–G59.3) — no dialog (UX-12).
- `CameraPip.vue` — Picture-in-picture camera overlay with MJPEG feed, SVG crosshair/circle/grid overlay; chrome = `.overlay-card`, minimize/expand = `windowToggle` lucide icons
- `ScrubBar.vue` — Program-scrub timeline overlay (viewer-hosted): poses the machine model along the loaded program via `viewer/scrubTrack.ts` (see "Program scrub"); also the control surface for the collision sweep (`viewer/collision.ts` + `collisionWorker.ts`, see "Collision sweep"). A narrow viewer gets its COMPACT form (review round 7, UI-DI15): once the timeline would drop under `--scrub-slider-min` (120 px) or the findings row runs out of the bar, row 1 keeps Sim, play, the timeline and ONE "More timeline controls" toggle (`.moreToggle`, `aria-expanded`, its name counts the findings: "… — 1 limit violation, 2 collisions"); opened, speed, line and position readouts and the findings rows follow on their own lines, and each findings group (prev · count · next · target · "?") wraps as a UNIT (`.navGroup`). `fitScrub` measures the uncompacted bar (ResizeObserver + content watch); the bar's height is in `fitHud`'s budget like any bottom-column content; opened in the viewer's capped column, row 1 stays whole and the findings row scrolls, and More and the viewer's warnings card fold each other (prop `notesOpen`, event `more-open`).
- `SettingsPanel.vue` — Sub-tabbed settings (3D Viewer | Machine | Display | Gamepad | Keyboard | HAL | Debug; the macros moved to their side tab, package 5 — Settings' one draft left is the gamepad mapping wizard, which covers Settings, so only a header navigation asks) The header states the save model per area — changes save automatically, the macro editor and the gamepad wizard say Save/Cancel — and carries the save status (UX-08). Closing Settings is ONE guarded path (UI-K16): its X, the backdrop and every header switch to another navigation dialog (`useDialogState.openDialog`/`closeSettings`) ask `guardSettingsClose` first — `SettingsPanel.unsavedDraft()` names a CHANGED macro draft (vs. its opening snapshot) or a running gamepad-mapping wizard, and App shows "Discard changes?" (Keep editing / Discard, registered modal); Discard carries out the navigation that asked. Automatically saved settings are no draft. The dialog is the WIDE tier (`.dialog.lg.wide`, `--dialog-wide-w` 760 px like the tool editor, operator 2026-09-30); the 3D Viewer tab stands its sections ONE BELOW THE OTHER, each across the whole width — Layers, View, HUD (its "Show HUD" switch is the `hud` layer), Camera Overlay, Colors, Machine Colors — and splits a section into two columns INSIDE where they fit (`.sectionColumns`; operator 2026-10-01: the sections side by side of 2026-09-30 were hard to take in): the LAYERS in four row groups — Program (Toolpath, Rapids, Backplot), Bounds & Reach, Machine, References & Markers (`viewerLayerGroups.ts`; `viewerLayerGroups.test.ts` holds every layer of `ALL_LAYERS` to exactly one place) — as two tables, the first two groups left, the other two right (`LAYER_COLUMNS`, read column by column, so one column keeps the order), the findings legend under both; View: projection and tracking left, the toolpath preview right; HUD: Show HUD and the scale left, the card's sections right; Camera Overlay: the switches left, the fields right; Custom colours' two checks side by side. A layer's line sample sits at the end of its cell (under the name where the column is narrow), toggle grids take the `.formGrid` rule, and the panel has no padding of its own (the dialog's content box pads it; the scroller holds a "?"'s reach) — at 150 % portrait (a 248 px dialog) the layer table, the HUD and the camera toggles ran out sideways before. `layout.spec` measures the width, the sections (one below the other, each across the width, found by their headings), the columns inside (side by side at desktop and touch landscape, stacked at 150 % portrait), the groups' order and nothing running out sideways.
- `MacrosPanel.vue` — the Macros side tab (package 5 stage C, plan `docs/reviews/makros.plan.md`), laid out LIKE THE TOOL TABLE (operator 2026-10-03): the head after the tab pattern (the selected macro; Run — `macroRun`, a hold, or with parameters a tap to the dialog — · Abort … More: New / Upload / Download), a search row (`macroSearch`: name, title and description) with a bar filter (All / On the bar / Not on the bar), then ONE table — Macro (sortable, `aria-sort`), Description (the file's first free comment line, ONE line with an ellipsis, the whole text in its title), On bar, the pencil, the trash (`listActionSetup`), the bar order — in NAME order: switching On bar or reordering the bar moves no row, and every row reserves the order buttons' slot (hidden off the bar), so no row height or column width changes (operator 2026-10-02, live). A tap on a ROW selects the macro for Run (no button in the row, operator 2026-10-03); the keyboard's way is the row's name (`.rowPick`, `role="radio"`, ONE Tab stop — the selected row, else the first): Enter / Space and Up / Down / Home / End select, every navigation key default-prevented with a modifier too (an arrow that reached the shortcut map jogged — macros.spec proves it with a bare-page control). Narrow, the description column leaves and the order buttons stand one over the other. No Files: the list IS the macro folder. The pencil opens the EDITOR DIALOG (like Edit Tool; `DialogFrame` form, lg wide; New opens it empty): File name, Title (on the bar) and Description as FIELDS over the code — the fields ARE the file's header lines (`macroHeader.ts`, pure: the name is the subroutine's label, every `o<name>` of the sub itself; the title the `(MACRO …)` line; the description the first free comment line, written `( … )` unless it would read as a header word or break the comment, then `; …`); a field writes its line into the text (the field keeps what is typed), an edit of the code reads the fields back. It mirrors the gateway's parser, and both read `scripts/test_fixtures/macro_header_cases.json` with the same answers (`macroHeader.test.ts`, `test_macro_files.HeaderParity`). New: the title follows the name until typed. Save under ANOTHER name is a RENAME — `PUT /macro?name=<new>&base=new&rename_from=&rename_base=`, ONE step under `_source_lock` (the new name free, the old file still the revision the editor read; the new file published, the old one removed — if that fails, the new one leaves again, 500) — and the bar keeps the macro's place. The editor is bound to its REVISION (Save sends `base`, a 409 of kind `conflict` for its own file is a conflict note with Reload / Keep editing — Keep editing makes the next Save replace exactly the revision the gateway named, never silently; a busy machine, a taken name or an answer without the revision is "Not saved" and the draft keeps its base, Codex R70 VP-I31); a read the list overtook (a save, a delete, a new file of the name while the text was on its way) never turns the editor clean: it turns clean only on the revision the list names NOW, else reads again (twice at most) or closes when the file is gone, and a clean editor on another revision than the file blocks its run (`MacroEditorBasis.revision`, Codex R70 VP-I32); Cancel and X over a draft ask "Discard changes?" (Keep editing / Discard), and so does a tab switch from outside the scrim (the strip's Tool Table button; App `requestTab`, which closes an untouched editor with its tab). The EARLIER settings macros (one MDI line each) were dropped on the operator's word (2026-10-02): a stored `macros` list stays in the settings section exactly as stored (`mergeMacrosSection`, never used, never rewritten; the console says once that it is there). The run rule (Codex VP69-05): a file with an unsaved draft, a text loading or an open conflict runs NOWHERE — `macroEditorBasis` (macroFiles.ts, the DISK name) read by `macroRunBlock` (macroBar.ts) for the bar (it stays reachable beside the dialog), the tab's Run and the dialog's Execute. Upload creates only, or replaces exactly the confirmed revision; after a delete the focus goes to the next row's name, else the previous, else More. `e2e/macroFolder.ts` is the ONE macro-folder mock for every spec (page.route: real sha256 revisions, the gateway's 409s and the rename; title and description read from the text through `macroHeader`; `serveNow` after the page loaded); `macros.spec` pins list, search / filter / sort, the row selection and its keys, bar toggle + hold, the file dialog, the editor dialog (fields ↔ lines, rename, New), the draft block, the conflict, the closing asks, the downloads and the no-jump rows.
- `CodeEditor.vue` — the ONE CodeMirror host (extracted from GcodePanel, package 5): dynamic import, the theme following isDark, inputmode none on touch, the strip keyboard's CODE target under the caller's owner id, `autoOpen` (default on: focus + keyboard at mount). The caller owns the session (file, original, revision); `text()` / `setText()` / `openSession()` exposed; unmount closes its keyboard session.
- `Gate.vue` — Permission gate wrapper: `<fieldset :disabled="!allow">` with `#exempt` slot
- `permissions.ts` — Permission evaluation (evaluatePermissions + provide/inject). `PERMISSIONS_KEY` = the gates with the client overlay (armed, busy, sim); `OWNER_PERMISSIONS_KEY` / `useOwnerPermissions()` = the same WITHOUT the busy latch — what an input owner's context (session + draft) lives by
- `machineControls.ts` — Machine controls catalog: BUTTON_TYPES + INPUT_DEFS (single source of truth for permissions + styling)
- `MachineBtn.vue` — Catalog-aware button (wraps Btn.vue, looks up gate/variant/size from BUTTON_TYPES); SINGLE-ROOT (the wrapper span or the Btn) so parents' scoped CSS reaches the button — hints go through `btnHint.ts` A `type="close"` control carries a Lucide `X` at `:size="14"` (the icon size that keeps a header's line box — 16 grew every dialog header by 2 px) and a CONTEXTUAL `aria-label` ("Close settings", "Dismiss upload error", "Close tool editor"); the CSS audit's `CLOSE` category fails the offline gate on a nameless one (UX-05). A × that does something else is not a close: Remove binding = `Trash2`, Reset color = `RotateCcw`, both `type="listAction"` with the target in the name (UX-02). Reset/Clear buttons name their target in the accessible name (`Reset view`, `Clear backplot`, `Reset feed override to 100 %`, `Clear MDI history`, `Reset E-Stop`); the visible text may stay short where the context is unambiguous (UX-06). Hold-to-fire (UX-12): EVERY cancelled hold says so at the control through `btnHint` (tap: "Hold to activate"; slide-off: "… stay on the button"; drag-scroll: "… the page scrolled"; gate closed under the finger: "Unavailable — <reason>"; selection changed: "… hold again"; hidden page / lost focus stay console-only), a hold button carries `title="Hold to activate"` unless the caller names the action, and shows no resting mark: the `.holding::after` fill runs while held (the 2 px bottom track of UX-12 took the corner radius and read as a stray shadow — removed, operator decision 2026-09-26).
- `MachineInput.vue`, `MachineToggle.vue`, `MachineSlider.vue`, `MachineSelect.vue`, `MachineRadio.vue`, `MachineColor.vue` — Catalog-aware form controls (look up permission from INPUT_DEFS). A radio's native `name` IS its group: a literal name lives in ONE component, a group a component can mount beside another takes a per-instance name (`useId()`) — Settings' default Run-from-line preset and the dialog's preset shared `rflSpindleDir` and mounting Settings unchecked the dialog's choice while its model kept it (round 4, UI-DI07; `radioNames.test.ts` scans the literals). `MachineInput` is the standard owner of both helpers: number fields open the keypad with their contract, text fields open the text keyboard (`session-owner`/`session-open` let a parent run a code session, `no-session` opts out) `MachineInput`'s text branch has ONE writer of the element's value — attrs-first (`:value` = the caller's `value` if it passes one, else the model) with the native input event writing the model: a `v-model="model"` beside `v-bind="attrs"` was a second writer and the MDI line (`:value` + `@input`) lost every typed character (round 4, UI-I11); the MDI line is `v-model` like every other text field. Field contract (UX-13): every catalog input renders `autocomplete="off"`, `autocorrect`/`autocapitalize="off"`, `spellcheck="false"`, `name` = the catalog key and `aria-label` from the `label` prop (the defaults sit BEFORE `v-bind="attrs"`, so a caller's own attribute wins); visible labels are wired `for`/`id`. `autocomplete="off"` is no guarantee against every password manager — the acceptance is in the operator's browser. It was NOT enough for the operator's Firefox/macOS Apple Passwords extension: the trigger was the word "code" in the MDI PLACEHOLDER ("G-code command (↑↓ history)") — the extension reads it as a verification-code field (operator's one-feature variant test 2026-09-23: only no-placeholder and code-free texts stayed quiet, "G-code (↑↓ history)" popped up). The line reads "MDI command (↑↓ history)"; no text-field placeholder may contain the word "code" (the field-contract e2e scan enforces it; "Search codes…" in the reference stayed quiet, a search field).
- `Btn.vue` — Internal button component (never used directly in templates — wrapped by MachineBtn). Looks besides the button: `icon`, `inline`, `value` (an offset cell's value), `area` (a block of readout text that IS the control — the strip's active codes; the placing class gives its width). Two axes (design wave D10, UI-K14): the VARIANT is what an action is (`primary` = the group's main action, `warn`, `danger`, `estop`), the `active` state what the machine is (armed, powered — green); there is no `ok` variant.
- `lcncWs.ts` — WebSocket client, heartbeat, server-authoritative armed state. The socket lives in `wsWorker.ts`; after a close it reconnects only through the HTTP gate `GET /ready` (empty 204, no token, own `Access-Control-Allow-Origin: *`) — a failed WebSocket attempt feeds the browser's own backoff (Firefox: per IP:port, up to 60 s, across reloads) and Firefox lets only one WebSocket per IP, across ports, be connecting; the connect backstop is 10 s (a held socket is legitimate). `ws/wsTransport.ts` respawns a worker that fails to load or stays silent 8 s. In dev, `viteHttpRestartPing.ts` makes Vite's restart ping HTTP too (it held the per-IP slot). `scripts/ws_reconnect_report.py` measures reconnects per gateway boot (2026-09-23). `request(obj, timeoutMs)` (and `awaitReply(reqId)` for a command already sent through `fire()`) waits for the reply carrying the command's own `req_id` (a map — two replies in one tick overwrite `lastReply`) and resolves `null` on a timeout or a closed socket, never a guessed success (after a timeout the command may still run — "no reply", never "not sent"); the awaiting caller reports a refusal itself (the generic "Command:" line is left out). A command that DEPENDS on another's outcome is ONE gateway command, never a continuation after an await: the browser held one between `set_probe_vars` and the M600 that no abort reached (review R16 XZ-06/07)
- `lcncApi.ts` — REST helpers for file listing and upload. A refused request throws `HttpError` (message = the server's detail, `status`); `browseFailure.ts` (pure) maps a listing failure for `FileBrowser.vue`: a 400 is a permanent refusal and offers NO Retry (UI-K15), 403/404/5xx/network keep it. The program listing (`gateway.list_files`) offers only children whose real path stays inside the program folder — the same rule `load_file` and opening apply (the shipped `nc_files` links to `/usr/share/linuxcnc/ncfiles` used to be listed and then refused as "Invalid directory"); the tool-library browser filters the same way (`tool_files.py`).
- `lcnc.ts` — LinuxCNC constants (TASK_MODE_*, INTERP_*, SPINDLE_*) and WsCommand union type
- `defaults.ts` — Server-synced settings with section registry pattern (no localStorage) A save is never silent (UX-08): `saveSection` drives `settingsSaveStatus.ts` — pending through the debounce, `saving` once the saver returned the `req_id`, `saved`/`error` from the CORRELATED reply (lcncWs; the gateway's READER answers `save_settings` itself and must echo `req_id` + `cmd` on every path — it did not, and the live header read "Saving…" forever while every mock-driven test passed), `blocked` before the server's settings arrived, `error` on a lost connection — and the Settings header shows it (`.saveStatus`). The status is a LEDGER per section and REVISION (round 5, UI-I12): every change is a revision, a reply confirms or fails exactly the revision it was sent for, a section reads `saved` only once its LATEST revision is confirmed, and a failed or blocked section stays in the header, named (`Save failed — keyboard: …`), behind every other section's success until its own retry succeeds (the header shows the worst section: failure > block > saving > saved). One global state with a set of request ids said `Saved` over a refused keyboard save and over a change still in the debounce. The PAGE-HIDE path (round 6): a change still in the debounce when the page is hidden leaves through `sendBeacon` and its timer is cleared — no WS request, no reply — so `flushPendingSaves` notes the hand-off (`noteSaveBeaconed`) and the revision is `unconfirmed` ("Sent on page hide — not yet confirmed") until the gateway's next FULL settings blob (`settings_changed` after the save, `settings_init` on reconnect — `noteSaveServerState` in lcncWs) carries the section: equal (`stableJson`, key order free) → saved, different → "not on the server" (an error a later matching blob corrects; a broadcast raised by another client can precede the beacon's own); a refused `sendBeacon()` is a failure, a lost connection leaves a beaconed revision unconfirmed. `sendBeacon() === true` is a hand-off, never a confirmation. The blob is the COMPLETE store, so a beaconed section it LACKS is not saved either (round 7, rest B), and the gateway's `SettingsStore` prepares every change on a deep copy and caches it only AFTER the file write succeeded (round 7, rest A: a failed write used to leave the unwritten value in the cache, the next `settings_init` carried it and the page read "Saved"). The header's `.saveStatus` wraps (never nowrap — a long named failure once took its width from the hint and buried the Settings tabs).
- `useKeyboardShortcuts.ts` — Global shortcut map. **Escape is the reserved E-Stop key**: a capture listener registered at App setup (before any child mounts its own), not re-bindable (`normalizeKeyboardMapping` pins it, KeyboardTab shows it fixed, its key-capture lets Escape through); E-Stop RESET is button-only. Space/Enter belong to any focused element; behind a dialog or the keypad (`modalOpen`) nothing but E-Stop passes; Cycle Start needs gate `run` and no open editor; jog KEYUP is never filtered (a field opened mid-jog must not swallow the `jog_stop`)
- `main.ts` — Vue app entry point with settings migration
- `style.css` — Global styles, theme vars, design tokens
- `SafetyStrip.vue` — Bottom strip: Arm/Disarm, E-Stop, Machine On/Off, status display (in #exempt slot). The active G- and M-codes are ONE button (catalog `activeCodes`, gate `always`, Btn's `area` look: the readout's own typography, a tint on hover and press, a book glyph): a tap or Enter opens the G-code reference on "Active now" (operator 2026-10-03, variant B of the renders — one big target on touch, the strip unchanged; a chip per code would have taken the 36 px touch height per line). Its name carries the codes ("Active codes G80 G17 … — open in the G-code reference"). G over M by a gap, no `.sep` inside the button (a `.sep` is a SECTION rule — `measureLayout`'s crosses-separator flags a control on one). In portrait with an input helper open the status detail folds with the block, so `layout.spec`'s strip-state invariant compares the Safety section's PINNED controls there (`refControls`: everything outside `.statusDetail`); landscape compares every control. In PORTRAIT with an input helper open the status detail folds away (title + the three buttons stay): the sticky section's 172 px detail is what pushed the 150 % keyboard below the fold (review UI-I08); the banner names the machine state meanwhile Arm and Machine Power are labelled with the NEXT ACTION (`Arm`/`Disarm`, `Power on`/`Power off`), like E-Stop/Reset — the state stays in the variant, the header pill and the status rows; the unacknowledged-trip case is a `reason`, not a title (UX-10, operator decision 2026-09-21).
- `JogStrip.vue` — Bottom strip: jog wheel, speed slider, step increments. In LANDSCAPE two rotary / UVW axes share a jog column (operator 2026-10-01: "jeden Button splitten — das gibt mehr Platz"): an axis takes HALF a column, its + over its −, the next axis below — the cluster is a four-row grid filled down the columns (CSS only, `.axisCol` dissolves), a last odd axis keeps a whole column (`solo`), a half-height button puts its arrow beside the letter; X, Y, Z and portrait are unchanged. Step, Mode and Kinematics frame are `ChoiceGroup`s in one column (K6): Mode and frame manual (machine commands), the step `auto` (local) — a DIRECT choice with at most six options (`STEP_ROW_MAX`) in the fewest rows that fit (Codex R25 answer 3): one row, else two (a `fill` grid), else a labelled `MachineSelect`. The width is the widest other choice row (landscape — so the strip never grows past its budget, by construction) or the column (portrait); two rows must also fit the column's height. Measured by two inert, `aria-hidden` sizers (`.stepSizer`: the row, and the two rows at their NATURAL column widths). Default increments: two rows in landscape, a row in portrait; TWP on touch-landscape a select (the plane note leaves no height). The block OWNS its focus (from a focusin until the focus moves elsewhere or a pointer goes down outside) and gets it back after EVERY change of its DOM — layout, option set, selection — in the post flush of the change, the same task as the removal: the checked option (the group's stop falls back to it on a new option set) or the select, else the block itself, which keeps the navigation keys. A layout change waits while a pointer or Enter/Space is down in the block. A step the INI no longer offers falls back LOCALLY to the largest offered step not above it (Cont when none) — never kept invisibly, never a bigger step. The select used to replace a focused row, and a new INI list removed a focused option: focus fell to BODY and the next arrow jogged (Codex R25/R26 OP-I01, P1). Plane's state has a reserved note line under the frame group. The Kinematics-frame explanation is a `HelpIcon` popover (UX-11); a dimmed Plane explains itself where pressed.
- `SetupStrip.vue` — Bottom strip: DRO display, axis touchoff, homing grid, WCS selector. An axis action is a SYMBOL and the letter (operator 2026-10-01: the words took the strip's width; `SetupIcon.vue`: a house = Home, the same house struck through = Unhome, the datum mark — a circle with two opposite quadrants filled under a crosshair — = Zero), NAMED for the action (`aria-label` "Zero X", "Unhome Z") and titled for the hold ("Hold to zero X"); Zero All / Home All carry the same symbols beside their words. In PORTRAIT, while the number keypad edits one of its fields (`entryOpen`, App: the keypad's owner is `setup`), the section keeps only its axis rows (Zero All, Go to, Plane, WCS fold — `.foldOnEntry`): at 150 % the edited field sat under the sticky Safety section while the column showed the whole keypad (design wave D7; up to six axes both ends stay in view, nine axes at 150 % is a named limit) The three Go-to destinations are explained by a `HelpIcon` on the section title (the action row is a three-cell grid); the buttons keep their titles as hover complements (UX-11). The WCS selector is a manual `ChoiceGroup` (K6): landscape 2 × 5 by column (3 × 3 cost +40–50 px of strip width), portrait 3 × 3 by row (2 × 5 cost 103 px of height); a reserved TWP row stays focusable and explains itself.
- `OverridesStrip.vue` — Bottom strip: Feed/Spindle/Rapid override sliders
- `SpindleStrip.vue` — Bottom strip: FWD/REV/STOP, RPM input, actual speed, coolant toggles
- `ToolStrip.vue` — Bottom strip: READ-ONLY tool info (Tool Table nav button + T / Pocket / Diameter / Z-offset / Type / Description for the loaded tool). The Z-offset row says whether the spindle tool's own length is IN EFFECT (`viewer/toolOffsetState.ts`, one decision with the viewer's control-point pin): in effect, the REPORTED tool-length mode ("· G43", "· G43.1", a zero-length tool under G49 "· G49"; "· Applied" when no mode is reported — a numeric match proves no mode, Codex R61 VP-I25), else a warn "· Off (G49)" / "· Other offset" — LinuxCNC's startup code and every abort run G49 while the tool stays in the spindle, and zeroing then lands at the spindle nose (operator 2026-10-01). The tool-CHANGE dialog lives in `App.vue` (`confirmToolChange`), "Measure Current"/"Unload" are App-level actions, and tool editing is in `ToolTablePanel.vue`
- `ToolsetterSettings.vue` — Toolsetter configuration form (Probing's Toolsetter procedure; fields from `probeFields.ts`). Its G30 section (operator P4) edits the stored tool-change position through the gateway's G30 contract (see "G30 position"): Capture takes the current position into the DRAFT, Save sends the changed axes with the values they were based on, Read re-reads; the stored line shows the confirmed values and their time; the draft is dirty against the STORED values (`g30Form.ts`, pure: `sameG30` at 1e-6, `changedAxes`, `savePayload`, `contextChanged`). A reply belongs to what its request was SENT under (Codex R25/R26 OP-I03, `replyApplies`): every request takes a ticket (order, draft revision — bumped by an operator entry or a captured position, never by a reset to the stored values — and context = units + kinematics + connection epoch); a reply changes the stored line and the BASIS only when no newer reply is shown and in its connection and units (a late file read never overwrites a confirmed save; an answer from before a reconnect supplies no basis — a reconnect or another unit drops the basis, "unknown", and reads G30 again), resets the draft to it only when nobody edited the draft since, and a captured position fills the draft only in the whole unchanged context — a save's confirmation leaves an entry typed meanwhile a draft, a capture answered after a frame change or an edit takes nothing over. Use Current Position is gate `g30Capture` (the machine stands).
- `GamepadLiveInput.vue` — Gamepad input visualization (SettingsPanel Gamepad sub-tab)
- `DebugTab.vue` — Debug/diagnostics tab (SettingsPanel Debug sub-tab)
- `gcodeReference.ts` — G/M-code reference data + lookup map
- `interpolation.ts` — IDW interpolation for probe surface maps
- `toolsetterVars.ts` — Toolsetter variable mapping utilities
- `dragScroll.ts` — Drag-to-scroll handler for touch/mouse on `.scroll-thin` containers
- `edgeWorker.ts` — Web Worker for Three.js edge geometry computation
- `useAxes.ts` — Single source for the machine's axis set (from `viewer_init.axes`): entries {letter,index,kind}, primary/abc/uvw groups, by-letter index resolvers. Never hardcode axis positions or letter sets in components.
- `touchDetect.ts` — sets `html.touch-device` on the first touch (`isTouchDevice`), and refuses the browser's context menu on touch everywhere but in editable text: Chromium ends a LONG PRESS with `contextmenu`, and a hold that just fired re-renders into its `.btnTip` wrapper (busy latch) where the hold's own handler is not — the menu opened after the action (operator, real machine 2026-09-26). A mouse right click on a desktop keeps the menu. The body sets `-webkit-tap-highlight-color: transparent` (inherited): Chromium's grey tap box flashed over sliders and the view cube.
- `useGamepad.ts` — Gamepad polling composable (analog sticks + buttons; X/Y/Z resolved by letter)
- `useJogPointers.ts` — Jogging pointer event management composable
- `ws/bulkData.ts` — Shared wire types for `viewer_init` / `viewer_gcode` payloads (ViewerInit, ViewerPart, KinematicsList)
- `viewer/programZero.ts` — The program-zero markers (pure, tested). INVARIANT: program zero = where the tool TIP lands when the control is commanded to program (0,0,0), evaluated through the machine.json chain (work + tool) at the joint set the mode implies, expressed in the work group's local frame — `transformToPartFrame`'s per-vertex rule (`buildChain` + `tipInWorkFrame`, exported from partFrame.ts), so the markers and the path-on-part preview agree by construction and linear table DOFs are table-attached / rotary DOFs room-fixed with no per-machine reasoning (the old `W(live)⁻¹·W0·P` counter-transform drifted by the slide travel on moving-table chains). `workMarkers` rule table: the active-fixture triad is program zero ON THE PART in every mode — identity: the chain at the fixture's W1 stamp A (absent = A0 rule), riding the table; TCP: the numbers; TOOL + reserved fixture: the plane compose (`activeFixturePose`). The muted `program zero (machine)` ghost draws only under identity kins while live A ≠ stamp A (`fixtureOffDatum`): the room-fixed spot identity kins will actually use. Bound `fixtureRidesOnA`: the stamp records A only, so a work chain with other rotaries (xyzac: A+C) gets the machine placement at the live pose, labelled `· machine`, one console warn. Identity evaluations hold tool-chain rotaries at 0 (control point's zero, what the DRO reads). `markerInputsChanged` is the marker-only repaint diff (M428 used to re-pose without a paint).
- `viewer/kins.ts` — Kinematics boundary: machine axis coords ↔ joint values behind one swappable KinsModel interface (trivkins = letter→slot permutation; TCP+TWP plan phase 1c adds real kins mirrors pinned by compiled-C-oracle fixtures). ALL offline joint derivation (partFrame emit, collision poseAt, scrub jointsForSample, entry-move machineJointsToProgram) goes through it — never inline `"XYZABC".indexOf` letter mapping again. KinsSpec is plain data (crosses postMessage); construct models at the use site via makeKins/kinsFor.
- `viewer/` — ThreeViewer support modules: `machineAssetCache.ts` (machine STL fetch/parse with L1 in-memory + L2 IndexedDB caches, single-flight dedup, `failedParts` surface), `geometryCache.ts` (the IndexedDB layer), `disposal.ts` (scene teardown that skips `userData._shared`), `viewerContext.ts` (fresh-snapshot scene pointers), `labelFont.ts` (the bundled font every troika label sets — see "UI font"), `lineIndex.ts` (per-line point ranges + cum as direct-indexed typed arrays — replaced three 1.18 M-entry Maps and a Set that cost 110–140 ms per major GC and a 0.9 s clone per publish; `ScrubTrack.lineIndex`, `ViewerGcode.feedLineIndex`, `mainLinesTrusted` mask), plus backplot/surface/toolpath controllers. `partFrameWorker.ts` keeps the program's streams RESIDENT (one `load` per program, small `transform` requests per WCS change; `needPayload` reply → re-send)

### Main Tabs

`Program | MDI | Probing | Offsets | Tools | Macros` — a `TabNav` (main): six equal columns while the side pane has ≥ `NARROW_PANE_PX` (432 px, `sidePaneNarrow.ts`, measured by a width scan of the real tab list — first unclipped width 431) of content width; below, one select ("Side panel") and, in Probing, the procedure select beside it. Probing's procedures: a 4 × 2 `TabNav` grid (`probeViews.ts`: Outside · Inside · Angle · Boss/Pocket / Ridge/Valley · Surface · Calibrate · Toolsetter).

### Bottom Action Strip

Horizontally scrollable strip with six components (wrapped in `<Gate gate="armed">`):

1. **SafetyStrip** — Arm/Disarm, E-Stop, Machine On/Off, status display (in `#exempt` slot — always accessible)
2. **JogStrip** — Jog wheel, speed slider, step increments, world/joint mode
3. **SetupStrip** — DRO display, axis touchoff, homing grid, WCS selector
4. **OverridesStrip** — Feed/Spindle/Rapid override sliders
5. **SpindleStrip** — FWD/REV/STOP, RPM input, actual speed, coolant toggles
6. **ToolStrip** — Read-only loaded-tool info + a Tool Table nav button (the change dialog and measure/unload actions are App-level, not here)

## Safety System — Three Layers

### Safety Layers

1. **Disconnect handler** — armed client disconnects → immediate `jog_stop` + `abort`
2. **Heartbeat watchdog** — client heartbeat timeout (3s) → auto-disarm + abort
3. **HAL watchdog** — retriggerable `oneshot` (0.5s, self-healing) + servo-thread `estop_latch` (`webui-hb-latch`, operator-cleared) in a three-stage AND chain → latched ESTOP

HAL heartbeat runs in an independent asyncio task (`_heartbeat_loop`), decoupled from status processing. Three tasks per client (2026-09-03): the **reader** (liveness and bookkeeping frames only — `heartbeat`, `hello`, `safety_trip_ack`, settings, diagnostics, `tab_visibility` — it never awaits a handler or `_cmd_lock`), the **command worker** (one per client, in order, bounded queue `_WS_CMD_QUEUE_MAX`; stop-class commands are never the ones rejected; `arm` is queued too, so a disarm lands after the in-flight command; each command runs as its own sub-task, and `abort`/`estop` SUPERSEDE the client's queued non-stop commands — replied "Superseded by abort", traced `ws.command_superseded` — and PREEMPT every client's in-flight non-stop handler via `_preempt_inflight` — victim replied "Preempted by abort", traced `ws.command_preempt`/`ws.command_preempted`; `jog_stop` stays plain FIFO, never reordered ahead of its `jog_cont`; stops and `arm` are never cancelled), and the **status loop** (can be slow without affecting safety; owns the 3 s client hb-stall disarm, now reporting the in-flight command). Before the split a handler waiting inside `_cmd_lock` (plane touch-off, Capture) parked the reader and the client's OWN heartbeats went unread → false hb-stall disarms. `_cmd_blocking` holds `_cmd_lock` through a cancel (shield-and-wait) so a disconnect can never let two NML calls overlap, and waits in `_CMD_WAIT_SLICE` (50 ms) slices: the binding's `wait_complete()` holds the GIL for its whole wait (2.9.4 emcmodule.cc — `to_thread` isolates nothing for that half), so one slice is the most the event loop can be frozen by an awaited command, and a cancel lands after the current slice rather than after a 30 s wait. Additional: server-authoritative arming, backend `require_armed()`, `fire()` 200ms anti-spam, auto-stop jogs on focus loss.

**Trip latching (issue #34).** `oneshot.0.out` self-heals when heartbeats resume, so the sticky latch lives in the HAL **servo thread** as an `estop_latch` (`webui-hb-latch`): its `ok-in` is `oneshot.0.out`, so it latches `ok-out` FALSE the instant the oneshot drops — in the *same ~1 ms cycle* — and stays FALSE until the operator clicks E-Stop Reset. This replaced an earlier `hal_watchdog.py` 100 ms Python edge-detector that **lost the race** against a ~1 ms oneshot re-arm (a heartbeat blip after a brief stall sampled `oneshot.0.out` already back TRUE → never saw the falling edge → silent auto-recovery from ESTOP). The latch is owned by HAL, so it survives both gateway *and* watchdog freezes/restarts. The gateway reads the sticky latch **level** `webui-hb-latch.fault-out` (snapshot field `trip_latched`) and runs `gateway_util.evaluate_trip_latch` (pure, unit-tested) — a clean FALSE→TRUE after a known-good baseline sets the `_unacked_trip` dict, broadcast as `status_msg.safety_trip` (a boot-faulted first-sight TRUE is audited as `safety.latch_faulted_on_connect`, not bannered). The frontend shows it in the existing `.statusBanner` (text + Acknowledge button; flash-danger while `safetyTrip` is set). Arm is rejected while `_unacked_trip is not None`. Recovery (enforced order): banner-Acknowledge clears `_unacked_trip` (both Arm and E-Stop Reset are rejected while it is set — a client that stayed armed through the trip must still acknowledge before it can leave ESTOP) → re-Arm if armed was lost → E-Stop Reset sends `{"trip_reset": true}` IPC to `hal_watchdog.py`, which pulses `webui-safety.trip-reset-out` → `webui-hb-latch.reset` rising edge → latch clears → 20 ms later `CMD.state(STATE_ESTOP_RESET)` → Machine On. (`hal_watchdog.py`'s `hb-ok-in` edge detection now only emits best-effort `wd.hb_edge`/`trip-count` forensics — no longer in the safety or banner path.)

Full layer behavior tables, pin semantics, and failure mode coverage in `safety-permissions.md` memory file.

### HAL access via `webui-reader` sibling process

The gateway never imports `hal`. All HAL access goes through three independent userspace processes connected by Unix sockets:

- **`hal_reader.py`** — owns the `webui-reader` HAL component. Pushes a snapshot of ~9 pins (`tool-change`, `tool-prep-number`, `spindle.0.speed-in`, `axis.z.eoffset`, `axis.z.eoffset-enable`, `motion.probe-input`, `compensation.method`, `compensation.grid-version`, `webui-hb-latch.fault-out` → `trip_latched`) to the gateway at 30 Hz over `/tmp/webui-reader.sock`. Gateway-configured extra pins ride the same snapshot (`set_extra_pins` RPC): `spindle_load` (settings-driven) and, on switchable-kins configs only, `motion.switchkins-type` → `kins_type` (status field; sim entry + run playhead invert live joints under the machine's ACTUAL kins mode — `worldModeForType` in viewer/kins.ts mirrors `kins_world_flags`' type mapping). Also serves request/reply RPC for `set_p` (compensation reload bumps) and `halshow_dump` (diagnostics tab). Any pin read failure logs every tick — no silent fallback.
- **`hal_watchdog.py`** — single-purpose safety supervisor. Generates the gateway heartbeat and pulses `webui-safety.trip-reset-out` on operator E-Stop Reset. The sticky latch itself is a servo-thread `estop_latch` (`webui-hb-latch`), not Python — so it latches in-cycle and survives gateway *and* watchdog freezes (issue #34). Independent process (100 ms select loop).
- **`gateway.py`** — connects to both sockets. `_reader_recv_loop` updates `_reader_state: Tuple[snapshot, monotonic_ts]` (single-rebind so reads are torn-free). `poll_status()` calls `_reader_get(field)` which returns `None` if the snapshot is absent or the field is missing — the absent value propagates to the frontend so consumers see "no data" honestly rather than a synthetic default. If no snapshot has arrived in 2 s, `status_msg.reader_stale = True` is broadcast and the UI shows a banner. **Safety-chain completeness** (review B1): after a 15 s startup grace, `evaluate_safety_chain` (pure, unit-tested) broadcasts `status_msg.safety_chain_incomplete` (reason string) when the watchdog socket is down, when a FRESH reader snapshot lacks `trip_latched` (= `webui-hb-latch` not loaded), or when the one-shot `unwritten_estop_signal` check finds `estop-loop` with no writer pin (the stuck-in-ESTOP trap: `net` silently creates unwritten signals) — the UI shows a danger-tier banner; a config missing `lcnc_webui.hal` can no longer run with the safety chain silently absent.

**Session binding (2026-09-13, `session_bind.py`).** A logout once left the previous session's `setsid`'d gateway alive; on the next `linuxcnc` run it re-attached to the NEW session's helpers and fed the watchdog heartbeat with a dead LinuxCNC behind it. Now: a LinuxCNC instance is `(linuxcncsvr pid, /proc start ticks)` (zombies excluded); the gateway binds to it on its first NML connect (`_bound_instance`) and NEVER re-binds — a client-independent `_instance_watch_loop` (1 s; the status poller skips instance checks with zero clients, exactly an orphan's state) detects the instance ending and calls `_request_process_shutdown` (launcher SIGTERM else self-SIGTERM, 5 s `os._exit` deadline). `bind_to_launcher()` arms `PR_SET_PDEATHSIG` against `LCNC_LAUNCHER_PID` so a launcher-managed gateway dies with its launcher on the paths bash cannot trap. Receiver side: the first line on either helper socket must be `{"type":"hello","proto":1,"gateway_pid","instance"}`; `AdmissionGate` checks `SO_PEERCRED` (fail closed), uid, pid, the helper's cache-once `InstanceResolver` identity, and never replaces a connected gateway (kernel EOF is the liveness signal — heartbeats only flow while browsers are connected, so a heartbeat window would let an idle gateway be superseded). Verdict `welcome` / `rejected{reason}`; reasons `no_hello` (pre-binding code), `no_peercred`, `uid_mismatch`, `pid_mismatch`, `bad_hello`, `unbound_gateway`, `no_current_instance`, `instance_ended`, `stale_instance`, `duplicate_gateway`. A rejected connect never touches pins (previously ANY accept forced them LOW — a 30 Hz reconnecting orphan would have tripped the live session); rejection logs are throttled per (reason, pid). Bridge side (`hal_bridge.py`): never dials while unbound, drains the verdict without blocking (zero-timeout `select` — a bare `recv` on the 50 ms-timeout socket costs 50 ms per heartbeat), backs off 5 s after a rejection, classifies a silent helper as legacy (banner), and drains a pending verdict on EPIPE so a rejection racing the helper's close is not lost. `stale_instance` → the gateway shuts down; other reasons ride the safety-chain banner (`helper_status_reason`). Launcher: port pre-flight terminates a stale holder only if its cmdline is our gateway/Vite (loud), aborts on any other holder; `trap _term INT TERM HUP`. `WEBUI_ALLOW_REBIND=1` = legacy reconnect for dev harnesses only (`test_viewer_init.py`). Tests: `test_session_bind.py` (incl. a real PDEATHSIG kill), `test_helpers_admission.py` (both helpers as subprocesses under `fake_hal.py`), `test_session_policy.py`, `test_hal_bridge.py`.

Why this split: the previous in-process approach had `webui-monitor` mirror-pin shadowing for sub-µs reads, but a SIGKILL orphan left stale shadow values readable by `hal.get_value` while the real pin was disconnected — silent-fallback failure mode that masked a safety-trip read. See GitHub issue #9 for full history. Driving rule: [feedback_no_silent_fallbacks.md](.claude/projects/-home-cnc-lcnc-suite/memory/feedback_no_silent_fallbacks.md).

### Log Locations

All four processes (launcher, gateway, hal_reader, hal_watchdog) write to a single shared directory resolved by `lcnc_paths.resolve()`. Precedence: `LCNC_LOG_DIR` env > INI `[DISPLAY] LOG_DIR` > `<install-dir>/runlogs` default (derived from the module's own location, so it follows the install and matches `restart.sh`). There is no `/tmp` fallback: `resolve()` always returns the requested path and never raises (the safety supervisor must boot even with degraded logging), and the `lcnc-suite` launcher write-tests the resolved dir and aborts loudly before any process starts if it isn't writable.

| File | Source | Contents |
|---|---|---|
| `trace.ndjson` | gateway, hal_reader, hal_watchdog, launcher proc.status loop, browser telemetry | Structured event bus. Multi-writer safe (atomic O_APPEND ≤ PIPE_BUF). RotatingFileHandler 50 MB × 5. |
| `crash.log` | Same logger, filtered | `crash.*` and `browser.error.*` events only. RotatingFileHandler 5 MB × 5. Operator triage entry point. |
| `gateway.log` | Launcher tee of uvicorn stdout/stderr | Color startup banner, pre-Python failures, libc abort messages (SIGSEGV/SIGABRT are uncatchable in Python — look here). |
| `launcher.log` | bash `_log` helper | Launcher diagnostic (process starts, FIFO setup, sampler/proc.status loop). |
| `hal_watchdog.log` | Watchdog `_HB_RECV_LOG_PATH` (TEMP) | Heartbeat-arrival probe. |
| `hal_sample.csv` | Optional `halsampler -t` | HAL servo-cycle pin sampling. |
| `trips/<trip_ts_ns>/` | `_snapshot_trip()` | Forensic bundle dumped on each safety trip via `scripts/trace-bundle.py`. |
| `timing/timing-<ts>.jsonl` | On-demand via `timing_log` WS cmd | Per-session timing histogram. |
| `loaded_program.json` | gateway (`status_runtime.program_tick`) | The loaded program per LinuxCNC instance — a restarted gateway's only proof of it (R16 XZ-08). State, not a log; one small JSON, rewritten on change. |

Override examples: `LCNC_LOG_DIR=/tmp/altlogs lcnc-suite -ini foo.ini`, or `LOG_DIR = /var/log/lcnc-suite` in `[DISPLAY]`. The launcher exports `LCNC_RESOLVED_LOG_DIR` for any subshell that needs the chosen path. The FIFO at `/tmp/lcnc-fifo.*` and the IPC sockets (`/tmp/webui-safety.sock`, `/tmp/webui-reader.sock`) stay on tmpfs (runtime plumbing, not logs; `mkfifo` on NFS or odd filesystems is unreliable) — these are the only suite files outside the resolved log dir.

**Crash hooks** in `lcnc_trace.install_crash_hooks(proc)` wire `sys.excepthook`, `threading.excepthook`, and SIGTERM/SIGINT in all three processes; `install_asyncio_handler(proc)` runs from FastAPI lifespan startup. Tags: `crash.sys_excepthook`, `crash.thread`, `crash.asyncio_unhandled`, `crash.signal`. SIGSEGV/SIGABRT cannot be caught in Python — that's why `gateway.log` exists as the launcher-tee backstop.

## Permission System & Machine Controls Catalog

### Permissions (`permissions.ts`)

Single source of truth for all enable/disable logic. Components never compute their own disable conditions. 14 permission classes organized in 6 tiers:

```
base = armed && !estop && enabled
```

```
TIER 0 — Unconditional
  always ─────────────── true                                         Arm, E-Stop, UI nav

TIER 1 — Client state (no machine state needed)
  armed ──────────────── s.armed                                      Outer content gate

TIER 2 — Machine power (no enabled needed)
  safety ─────────────── armed + !estop                               Machine On/Off
  setup ──────────────── armed + !estop + isIdle + !busy              File ops, tool edits, settings reset

TIER 3 — Machine enabled (base = armed + !estop + enabled)
  abort ──────────────── base                                         Abort, Shutdown
  override ───────────── base + !busy                                 Feed/Spindle/Rapid overrides
  pause ──────────────── base + isRunning + !isPaused                 Pause
  resume ─────────────── base + isPaused                              Resume
  step ───────────────── base + ((isIdle+!busy+isHomed) OR isPaused)  Single-step

TIER 4 — Machine idle (requires base + isIdle)
  idle ───────────────── base + isIdle + !busy                        Banner home, mode select
  jog ────────────────── base + isIdle + isHomed                      Jog buttons, speed slider
  zero ───────────────── base + isIdle + !busy + !eoffset             Home, Unhome

TIER 5 — Full ready (requires everything)
  ready ──────────────── base + isIdle + !busy + isHomed              MDI, Spindle, Coolant
  run ────────────────── ready + kins runnable (Plane kins needs its plane + G59; unknown mode refuses)   Cycle Start, Run from line
  machineFrame ───────── ready + identity kins (G53 routines: → Home/G30, tool load/measure/unload, probe ops)
  g30Capture ─────────── machineFrame + the machine STANDS (STAT.inpos, |current_vel| ≤ 0.001; unknown refuses)   G30 Use Current Position
  goZero ─────────────── ready + a → Zero plan for the mode (Machine: subroutine — Z to machine zero only when below it, rotaries to the fixture's STAMP angle before X/Y; Plane: retract along the tool axis, X0 Y0 in the plane; TCP refuses). A retract NEVER lowers Z (`#<_abs_z>` guard in go_to_zero/home/g30.ngc + the RFL safe-Z step)
  probe ──────────────── base + isIdle + !busy + isHomed + !eoffset   Probe ops, tool change, WCS edit, macros (run_macro; a `FRAME machine` macro also machineFrame)
  touchoff ───────────── probe + kins-mode × fixture rule (linear)     DRO touch-off / Zero (linear letters)
  touchoffRotary ─────── probe + identity kins + G54                    DRO touch-off / Zero (A/B/C)
  twpCapture ─────────── probe + capture rules (TWP machine, G54, no     Capture plane (one-button workflow 2)
                         plane defined, offsets clean)
```

**State transition map — when gates open:**
```
Disconnected      → always
Armed             → + armed
E-Stop Cleared    → + safety, setup (if idle)
Machine On        → + abort, override, idle, zero, jog (TIER 3+4)
Homed             → + ready, probe, step (TIER 5)
Running           → abort, override, pause, step remain; idle/ready/jog close
Paused            → abort, override, resume, step remain; pause closes
```

**Touch-off under kinematics modes (2026-08-30):** a touch-off is the gateway
command `touchoff {axes}`, never a client-built `G10 L20` (`useTouchoffMath.ts`
→ `command_policy.touchoff_route`, pure): identity → G54–G58 (rotary letters
G54 only); TCP → G54–G58 with the table at A=0 (`to_storage_frame`'s own
admission rule); Plane (kins 2) → G59 with the plane active, routed to the
remap (`o<twp_touchoff>` → `M535`) which writes the WORKPIECE datum G54
THROUGH the plane (`G59' = G59 + current − v`, `M' = R_tool⁻¹·G59'`, table
frame at the LIVE A, minus the plane's origin vector) and stamps G54's W1
provenance table-frame; the gateway then seeds its G54 row from the
helper's datum pins once `twp-helper-comp.twp-datum-seq` (a datum-WRITE
epoch M535 bumps AFTER publishing; the helper copies it last, the reader
samples it first) has advanced — never a dwell, never the value alone
(`twp.datum_settled`; a same-datum touch-off replies in ~85 ms). G59–G59.3 are the TWP remap's scratch rows — never a
touch-off target, disabled in the WCS selector on TWP configs, rewritten
COMPLETELY (`A0 B0 C0 R0`) by every orient; the orient move is `G53 G0 B C`.
The fixture rides the kins mode (M428/M429 → G54 when leaving a reserved row,
M430 → G59); a reserved fixture active on identity kins at boot is bannered
and healed with one `G54` at `ready`. The viewer draws ONE work-system
marker, the active fixture, where the PART's zero physically is in every
kins mode (`viewer/programZero.ts`: identity = the chain at the fixture's
W1 stamp A, riding the table; TCP = the numbers; Plane = the plane compose
via `viewer/activeFixtureFrame.ts`), never moves `workOrigin` (the toolpath
anchor), and shows no inactive fixture — the survey found no UI that does.
Under identity kins with the table away from the touch-off angle, a muted
`program zero (machine)` ghost marks the room-fixed spot identity kins will
send the tool to, and the chip/HUD says `MACHINE · off datum`
(`fixtureOffDatum`, the Machine-mode mirror of head-stale). The datum lives
in ONE place: G54, table frame; `twp_datum` (the remap's snapshot) feeds
only the plane overlay and the datum-moved chip. Record: docs/decisions.md
2026-08-30 and 2026-09-02 (program zero rides the part).

**Motion-button certification**: `scripts/twp_buttons_check.py` drives every
motion button (→ Zero, → Home/G30, Zero All, tool measure/load, probe op, Cycle
Start) through the WebSocket in Machine / TCP / Plane and asserts reply +
machine outcome as one PASS/FAIL/SKIP table — the acceptance gate for any
change touching a motion button, next to the corpus gate. The gateway tracks the
jogs IT started (`_active_jogs`): a `jog_stop` for an axis with no active jog is a
traced no-op — it used to force MANUAL, which aborted an MDI issued a beat
earlier (the operator's finger leaving the A jog after pressing → Zero); a
verified switch to MDI/AUTO clears the set (task refuses those while jogging);
every new jog emits `jog.cmd`. `set_mode` raises on refusal AND when task
ignored the switch — the reply says what was asked and what stayed and names
only the states it SEES (a jog the gateway started → "release it", the
machine off, joints unhomed for MDI/AUTO; `gateway_util.mode_switch_ignored_message`,
Codex R62: it said "a jog is still active" for an unhomed machine too); LinuxCNC operator errors
ride the trace as `nml.error`. A retract NEVER lowers Z: the `G53 G0 Z0` in go_to_zero/home/g30
is guarded by `#<_abs_z> LT 0` (the same four offset terms a G53 Z word
subtracts — interp_namedparams NP_ABS_Z / interp_find G_53) and the RFL safe-Z
step skips when already at/above; the matrix certifies the frame premise
(`#<_abs_z>` == machine-frame Z with a TLO active) and both branches from
above/below machine zero (the above rows SKIP with the reason on a Z0-at-top
config).

**LinuxCNC enforces very little** — mode sequence (MDI needs MODE_MDI) and state transitions only. Our gates enforce: armed state (web-safety invention), idle-vs-running checks, homing requirements, and eoffset contamination prevention. The `set_mode()` + `reject_if_auto_running()` functions in gateway.py are the real backend gatekeepers.

**Client-local overlay terms** (`applyClientOverlay`): `armed` (per-client), `busy` (per-tab debounce), and `sim` (`simMode.ts` — viewer simulation mode: the model shows the program, not the machine, so all machine-action gates close except `always`/`armed`/`setup`; see "Program scrub").

### Machine Controls Catalog (`machineControls.ts`)

Central catalog of every interactive element type — inspired by QtPyVCP's predefined widget types. Each entry defines its permission gate, variant, and size. Components look up their type from the catalog; developers never specify permissions or styling inline.

- **`BUTTON_TYPES`** — 55+ button types (start, abort, probe, close, tab, dialogConfirm, etc.)
- **`INPUT_DEFS`** — 34+ input types (jogSpeed, mdiText, touchoff, feedOverride, etc.)

Machine action types use permission gates (`ready`, `idle`, `probe`, etc.). UI-only types use `gate: 'always'` — they don't gate themselves but are still covered by the outer Gate fieldset.

### Catalog Components (Machine*)

All interactive elements use catalog-aware wrapper components. **Never use `<Btn>` directly in templates** — it's an internal component wrapped by MachineBtn.

| Component | Wraps | Catalog |
|-----------|-------|---------|
| `MachineBtn.vue` | `Btn.vue` | `BUTTON_TYPES` — looks up gate, variant, size, icon, muted, inline |
| `MachineInput.vue` | `<input>` | `INPUT_DEFS` — looks up permission from gate prop |
| `MachineToggle.vue` | toggle input | `INPUT_DEFS` |
| `MachineSlider.vue` | range input | `INPUT_DEFS` |
| `MachineSelect.vue` | `<select>` | `INPUT_DEFS` |
| `MachineRadio.vue` | radio input | `INPUT_DEFS` |
| `MachineColor.vue` | color input | `INPUT_DEFS` |

### Gating Architecture — Default-Deny (IEC 62443 / ARINC 661)

Four layers enforce permissions:

1. **Outer Gate** — `<Gate gate="armed">` wraps content area, macro bar, and bottom strip. When disarmed, everything is disabled by browser `<fieldset disabled>` cascade. Uses `armed` (not `safety`) so navigation works during E-Stop.
2. **Inner Gates** — Section-level Gates with tighter permissions: `<Gate gate="override">` (OverridesStrip), `<Gate gate="ready">` (SpindleStrip), `<Gate gate="idle">` (OffsetPanel), `<Gate gate="setup">` (ToolTable/Gcode/Settings dialogs), `<Gate gate="safety">` (SafetyStrip Machine On/Off).
3. **Catalog self-gating** — Each `MachineBtn`/`MachineInput` checks its own permission class for visual dimming + HTML disabled.
4. **Backend `require_armed()`** — Every motion command in gateway.py checks armed before executing (defense-in-depth). Additionally, `fire()` in App.vue takes a gate parameter and re-checks permissions before sending.

**DOM layout**: Bottom strip's `#exempt` slot holds SafetyStrip (Arm/E-Stop always accessible even when disarmed).

### Usage — Gate.vue (primary pattern)
```vue
<!-- Wrap a section; fieldset :disabled propagates to all children -->
<Gate gate="ready">
  <MachineBtn type="start" @click="run">Start</MachineBtn>
  <MachineInput gate="mdiText" v-model="mdi" />
</Gate>
```

### Usage — MachineBtn (catalog-driven)
```vue
<!-- Gate + variant + size + icon all come from catalog -->
<MachineBtn type="close" @click="dismiss">×</MachineBtn>
<MachineBtn type="dialogConfirm" @click="save">Save</MachineBtn>
<MachineBtn type="tab" :selected="active === 'dro'" @click="active = 'dro'">DRO</MachineBtn>
```

### When individual `:disabled` is still correct
```vue
<!-- Tighter permission than parent Gate -->
<Gate gate="idle">
  <MachineBtn type="mdi" :disabled="!can.ready">Needs ready inside idle Gate</MachineBtn>
</Gate>
```

## Layout Architecture

- Content area: viewerPane (left, 3D viewer always visible) + sidePane (right, tabbed content panels)
- Bottom action strip: horizontally scrollable row of strip components (SafetyStrip in `#exempt` slot)
- Macro bar (`MacroBar.vue`): optional ROW of macro FILE buttons (the `bar` setting), a DENSE area like the strip and tables (`--control-h` = the compact 28 / 36 px; its `macro` buttons are md) — the macros scroll sideways in `.macroScroll` (both edges fade), its own Abort sits at the right end OUTSIDE the scroller and never scrolls away (operator 2026-10-02). App mounts it in ONE of two places by orientation (package 5 stage A, operator 2026-10-02): landscape under the content, over the strip; portrait in the viewer's column (`.viewerColumn` = viewer + bar, ONE flex item with the viewer floor) between the 3D viewer and the side pane — the side pane and the content keep exactly their place with or without macros, the viewer gives the row (it used to be a ~155 px vertical middle column). An orientation change mounts a NEW bar: a hold in progress ends with its button (nothing runs), App puts a focused macro's focus back on the same macro (`data-macro-id`) and re-points an open parameter dialog's opener to the new button (`modalRegistry.repointOpeners`); the scroll fades re-attach. `layout.spec` (portrait 100/150 %: one row under the viewer, full column width, side pane unmoved, every button whole and reachable; the strip-state frame now measures the side pane too) and `run-hold.spec` (mid-hold orientation change) pin it.
- Each content panel independently selects tabs via TabPanel component
- Shared state: coordMode, jogVel, mdiText, armed, busy
- Responsive: landscape (side-by-side panels) and portrait (stacked panels; the page grid is two columns, strip | content). Portrait viewer floor `--viewer-min-h-portrait: min(500px, 45%)` of the content column, held by `.viewerColumn` (viewer + the macro bar) (a fixed 500 px left the side pane 126 px at 150 % on 900 × 1200 — the MDI line fell below the fold); a percentage, not `vh`: Chromium does not scale viewport units under CSS `zoom` (the tests' 150 % emulation)

## 3D Machine Model (machine.json)

The active catalog is `examples/sim_config/profiles.json`: **3 Axis XYZ**,
**5 Axis XYZAC** (new model from PR #41, identity/TCP) and **6 Axis TWP XYZABC**
(45° wall gantry from PR #39). Install/update via `scripts/install_examples.py`;
`install.sh` also builds the TWP component. The new 5-axis model has no TWP yet.
See `examples/sim_config/README.md` and `docs/testing.md` for current paths and
acceptance commands. Old trunnion/55° models below are historical regression
fixtures under `scripts/test_fixtures/legacy_sim/`, not launchable examples.
The unlicensed local DMU was archived under `runlogs/example-migration-20260917/`.


ThreeViewer renders an articulated machine driven by live joint positions.
The model is pure **data**: a directory containing `machine.json` + STL
files. Default dir is `lcnc-gateway/machine/` (3-axis PM-25MV); override
per-config with INI `[DISPLAY] WEBUI_MACHINE_DIR` (launcher exports it as
`LCNC_WEBUI_MACHINE_DIR`; `~` is expanded). Example: the 5-axis sim uses
`scripts/test_fixtures/legacy_sim/machine-xyzac/`, generated by
`scripts/vismach_to_stl.py` — v2 geometry: the vismach original was drawn
for pivot offsets ≈0 but shipped with 20/10 (floating brackets, C base
inside the trunnion — the collision sweep exposed it); v2 DERIVES the
rotary assembly from the pivot constants and is gated by
`src/viewer/machineModel.test.ts`, which sweeps the working envelope with
the collision engine and requires zero self-collisions with static
contacts only at the five designed joints. Sim travels match the v2
geometry: X ±200, Y ±70, Z −30..+100 (retract is +Z, knee down; nose→
platter crash plane at Z −35), A −100..+50. A second 5-axis example,
`machine-dmu160p/` (+ `lcnc_suite_sim_dmu160p.ini`), is **LOCAL-ONLY —
UNTRACKED, never commit it**: the STL source repo
(Sigma1912/LinuxCNC_Demo_Configs) declares NO license, so redistribution
isn't clearly granted (his companion vtk-vismach IS GPL-3.0 and is
credited in NOTICE as the kinematic reference; the kinematic constants
mirror `vtk-dmu-160-p-gui.py`). Regenerate on a fresh machine with its
`fetch-model.sh` (downloads from upstream directly). It is the OPPOSITE
rotary layout — a DMU 160 P-style portal mill with a
45° NUTATING B head (tool-chain rotary about axis `[0, sin45°, cos45°]`)
+ C table, gated by the (also local-only) `machineDmu160p.test.ts`, and
carrying the first `stock: true`
body (500 mm cube on the platter). Frame: X0 Y0 = table center, Z0 =
TOP of travel (Z −970..0; nose 1120..150 above the table; stock top at
machine −620) — Z0-at-top makes the joints-at-zero startup pose legal
and parked (a Z0-at-table first attempt both drew the head buried and
broke homing: LinuxCNC refuses to home a joint outside its soft
limits). Both chains carry the frame: work chain lifted +1120 with
meshes shifted back, preserving relative-pose ≡ machine coords.
Trivkins boundary: G43 along machine Z vs the tilted-spindle marker —
consistent at B0, divergent tilted+TLO (TCP out of scope; see its
README).

A third example, `machine-xyzacb-trsrn/` (+ `lcnc_suite_sim_twp.ini`), is
the TWP machine and IS tracked — its source is LinuxCNC's own GPL-2
vismach (David Mueller), unlike the DMU. Generated by
`scripts/vismach_to_stl_trsrn.py`, gated by `machineTrsrn.test.ts`. It is
the SPLIT rotary layout — the third topology: A is a work-side rotary
FACEPLATE (axis along machine X), while B (nutating, `[0, sin55°,
cos55°]`) and C (swivel about Z) are both tool-side. Geometry is DERIVED
from the seven kins pins the INI `setp`s, and the head is built to an
invariant rather than to sampling: rotation about the nutation axis
preserves the coordinate ALONG it, so keeping every B-side body at
n·p ≤ −2 and every C-side body at n·p ≥ +2 makes the joint
collision-free for ALL B at any C by construction (the generator asserts
it and refuses to write a violating model). The work frame is SPLIT from
the faceplate (`a_work` under `a_table`): the A rotation must happen
about the real axis, but the work ORIGIN must sit at machine zero or
tool-vs-work relative pose carries the constant nose-to-table offset and
the toolpath draws 2.3 m from the tool. Carries a `stock: true` 600 mm
cube. Its frame is schematic ABOVE the kinematics — a head moving in all
three linear axes cannot be supported by any static structure the schema
expresses, so the column is a portal the ram passes through with
clearance: a crash body, not a fake bearing. Requires a one-time
`halcompile --install scripts/kins_oracle/xyzacb_trsrn.comp`
(deliberately not in install.sh — see examples/sim_config/README.md).

TWP sim travels (2026-09-05): **Z0 is the TOP of travel** — joints-at-zero is the
parked pose (nose 2000 above the A axis; stock top at machine −1400), type-0
window `[AXIS_Z]/[JOINT_2] −2000..0.01` (HOME 0 strictly inside, DMU precedent),
X/Y ±5000 on purpose (the joint-side soft-limit case). LinuxCNC checks the
WORLD pose against `[AXIS_*]` in EVERY kins mode, so under TCP/TOOL (rotated
world frames) the X, Y and Z axis windows are lifted to ±5000 by `hallib/limit_window.hal`
(`wcomp` window on `:kinstype-select` → `mux2` → `ini.z.min_limit/max_limit`,
the switchkins.adoc pattern), a `[HAL]POSTGUI_HALFILE` that the `lcnc-suite`
launcher runs after `halcmd start` the way axis does — a `[HAL]HALCMD` net onto
an `ini.*` pin runs before the servo thread exists and blocks task (boot
timeout); `near`/`comp` are already loaded by the hallib and a module loads once while the joint window keeps protecting the slide;
`machineTrsrn.test.ts` reads the INI and ties the window to the model.

**Schema** (`machine.json`):
- `groups`: `[{id, parent, translate?}]` — transform tree under implicit
  `root`. `translate` is a static base offset (pivot/home position), in mm.
- `parts`: `[{id, file, group, translate?, rotate?, color?, stock?, collision?, collide?}]` —
  STL meshes attached to groups. `color` is `[r,g,b]` 0–1 (STL has no
  color channel); per-part user overrides from Settings still win. Parts
  get color pickers in Settings automatically. `stock: true` marks the
  ONE body class the collision sweep may FEED into (cutting semantics);
  `rotate` is Euler radians (prefer baking static rotations into the STL,
  as fetch-model.sh does for the DMU B head).
  `collision: "collision/<part>.stl"` (2026-09-13) names a coarser SUPERSET
  mesh the collision sweep checks INSTEAD of the display mesh — one
  axis-aligned box per connected component for rails/blocks/end caps
  (`scripts/stl_collision_proxy.py`; `machineGantry.test.ts` gates that every
  display vertex lies inside a proxy box, so the sweep can only get more
  conservative). `collide: false` marks decor the sweep never sees — a crash
  into such a part is NOT reported, by the model author's declaration.
- `kinematics`: `[{group, joint, type: translate|rotate, direction: x|y|z
  or axis: [x,y,z], sign}]` — each entry drives one group from
  `joint_pos[joint]` (**joint index, not axis letter** — trivkins:
  identical; non-trivial kins: joint space). Rotations are degrees.
- `workGroup` / `toolGroup`: group ids that carry the toolpath/backplot/
  bounds (work) and tool marker + TCP offset (tool). On a moving-table
  machine the work rides the table (e.g. the C platter on a trunnion).

**Transform semantics — transforms COMPOSE** (`applyState` phases): driven
groups reset to their static base each frame, then DOFs accumulate in
`kinematics` list order (translations add along their unit axis, rotations
right-multiply), then the tool's offset subtracts from the tool group's
composed position. LIVE that offset is the PHYSICAL tool (Codex R44 ST-I03):
Z = the spindle tool's TABLE offset WITH ITS SIGN (status `tool_table_z`;
`tool_length` is its magnitude — a negative table offset drawn from it put the
tip 2 × L off, R45 ST-I04; without a table row the active signed offset), X/Y
the active offset's — the tool routine
measures under G49, and the drawn tip used to jump a tool length up with the
tool unmoved; under G43 with the spindle tool's own offset both agree. A
scrub pose uses its sample's TLO (a program's G49 segment still poses the tip
at the control point — named limit). A changed physical offset moves the
drawn tip without motion: `backplot.lift()` (pen up), never a stroke; the
trail follows the machine (`__viewerDiag.getToolTip` / `getBackplot`). A
group may therefore carry a static pivot translate plus any number of DOFs
(compound slides, trunnions) — never rely on overwrite behavior. Axis unit vectors are precomputed at normalize time;
the per-frame loop is allocation-free.

**Serving & caching**: gateway mounts the model dir at `/assets/`
(absolute URL to port 8000 — bypasses the Vite proxy; identical dev/prod).
STL URLs carry `?v=<mtime>`. Client caches: L1 in-memory geometry by part
id, L2 IndexedDB parsed geometry by URL, L3 HTTP. `machine.json` itself is
mtime-cached in the gateway and hot-reloads on the next `viewer_init`
build — no restart needed; a missing/broken file raises the operator
config-warning banner (no silent fallback) and clears it on recovery.

**Conventions**: STLs are authored in mm; the viewer scales by
`_unitScale` for inch machines. Z-up. Every shipped model is a GREY LADDER
(`viewer/palette.ts` `MACHINE_PALETTE`, operator 2026-09-29: muted metal
greys, no hue near the program's line colours — paint, steel, stock, table,
cast, accent, dark from light to dark, the table and stock a program lies on
in the middle); explicit part colors must be ladder entries (`palette.test.ts`
pins the examples and the legacy fixtures; the FreeCAD generators' `COL` and
`vismach_to_stl.py` carry the same values). Linear slides without a color
get their axis' grey step. The `machine` layer toggle shows/hides
the whole model.

**Toolpath preview modes (rotary-aware preview)**: on machines whose
work/tool chain has a rotary DOF, the programmed XYZ polyline is not the
tool-versus-workpiece path. The parse worker ships per-vertex A/B/C
(`feed_abc`/`rapid_abc`, present whenever the tool-vs-work POSE depends
on abc — `should_ship_abc`, W2 P3: a rotary sweeps, raw abc ≠ 0 anywhere
(a constant tilt — the per-epoch peel can zero it, the TWP pattern), or
switchkins markers are present; absence = programmed polyline already
exact) and decimates in 6D under the same condition so rotary sweeps
survive RDP; `viewer/partFrame.ts`
(pure, unit-tested; run off-thread by `partFrameWorker.ts`) subdivides
rotary segments (~4°/sample) and transforms each sample into the work
frame by evaluating the machine.json chain — same normalize code as the
live scene (`viewer/kinematics.ts`), so the preview overlays the backplot
by construction. TLO rule (W3 P0 + schema 8): the tool-length offset is
PER-SEGMENT state — the wire's `tlo_events` rows ([seq, xo, yo, zo, tool],
recorded by the canon at every G43/G43.1/G49 and executed M6 on a program
line; segments before the first row ran under the START tool state the
parse was seeded with — `tlo_start`, see "Start tool state" below — and
resolve to the payload's tool basis) — resolved by ONE function
(`viewer/tloEvents.ts` tloForIndex) and LIFTED by one (`partFrame.ts`
liftToJoints, on TIP-space terms: epoch terms carry no tool, so the offset
can never ride twice). It subtracts in the TOOL NODE'S WORLD ROTATION —
the same frame in applyState phase 3 (local .position under the rotated
spindle chain; the scrub SAMPLE's offset while a scrub pose is shown), the
part-frame tip peel (lift and peel from the same per-vertex value) and the
collision sweep (a per-pose tool-local translation of the tool body, no
longer baked into its verts). A world-axis subtraction is off by a
constant rigid offset whenever the spindle chain is tilted (operator-
caught: 12.58 mm at the TWP hold); ONE live offset for the whole track
posed every post-G43 joint a tool length high on a fresh boot (the corpus
gate's 22.000 catch). The sweep and the scrub marker also wear the tool the
program has active per segment (`parse_tlos` rows carry diameter). Settings → 3D Viewer → "Path on part" (default) vs
"Programmed XYZ". The transform re-runs on live WCS changes (debounced —
part-frame vertices depend on pivot-vs-work-origin). Machine-limit
overflow + bounds boxes stay in programmed/machine space (the correct
space for limits). CRITICAL mapping: kinematics `joint` indices ↔ axis
letters via `viewer_init.axes` (joint order) — on XYZAC, C is joint 4 but
canonical axis 5; never index axis-lettered data by joint number. Known
limits: trivkins assumption (non-trivial kins would need joint-space
samples), and UVW joints evaluate as 0 in the preview transform (linear,
virtually never in a work/tool chain; the live model still articulates
them from joint_pos).

**Per-line soft-limit validation (offline dry run, stage 1)**: the parse
worker checks every canon segment — pre-RDP, since decimation can shave
extremes — against per-axis INI limits. Pure helpers in `gateway_util.py`
(`read_axis_limits`: `AXIS_<letter>` preferred, `JOINT_<n>` fallback in
joint order; `check_limit_violations`: machine-frame, joint-side — TLO
added back to XYZ — all axes incl. rotary; both unit-tested; VECTORIZED
with numpy since 2026-09-05 — the per-segment Python loops stay as
`_check_limit_violations_scalar` / `_check_limit_violations_trsrn_scalar`
oracle twins pinned by `TestVectorizedLimitChecks`, and the trsrn inverse
has a vectorized twin `_trsrn_inverse_np` pinned to the scalar to 1e-9).
WORLD-mode (TCP) segments (phase 2c): joints ≠ words, so those segments
route through `check_limit_violations_world` — rotary-subdivided (4°,
mid-segment extremes are the point: the phase-0 capture's joint X hit
−22.36 on a program whose X words never left ±20) through the Python
kins twin, TLO applied to BOTH world coords and the pivot param; a
declared kins without a twin leaves its segments UNCHECKED — the count
rides the wire as `violations_world_unchecked` (present only >0) and the
stats dialog appends "N TCP segments not validated" (warn, never OK) —
never identity-checked wrongly. Marker policy (`kins_marker_policy`):
markers on a NON-switchable declared kins (trivkins / no `[KINS]`) are
IGNORED with one stderr note — the machine can't switch, so emitting
flags would map startup type 0 to "world" (no sparm) and gut the identity
check; only 'twin'/'unchecked' configs get mode arrays. Client honesty:
world-flagged segments arriving with NO kins spec pose as trivkins but
log loudly once per JS context (`warnWorldWithoutSpec` — scrub pose,
entry move, part-frame, collision sweep). RDP anchors both flip vertices
(`mode_boundary_indices`: i-1 ends the old-mode span, i starts the new —
keeping only i relabels a collapsed collinear span). Reports merge per
(line, axis). Attribution
rule: only a line that MOVES an axis while out of bounds is flagged; lines
where the axis merely sits parked past a limit are not re-flagged, so the
culprit line stands alone. Wire: `violations` (per-line records, capped at
200) + `violations_total`; `null` means the INI had no MIN/MAX_LIMIT —
unchecked ≠ clean, and the stats dialog says "Not validated". UI is
centralized in the scrub bar's second row: warn-variant prev/next
navigation ("◀ | N limit violations → L10 | ▶", anchored to the CURRENT timeline
position — scrubbing re-anchors it; collision hits get the same in
danger-red) and timeline marks — one tick per kind plus a lucide glyph
under the track in the tick's colour (▲ limit, × clash, ● tool change;
the dark theme cannot separate red from amber) and extent BANDS (warn over
the violating line's cum span, danger over every contact interval, red
wins) — plus warn-tinted line numbers in GcodePanel (`.codeLine.violation`,
global; collision hits are danger via `.codeLine.collision`) and
a Soft limits row in the program stats dialog. Limitation: validated
against the parse-time WCS — touch-off after load requires a file reload
to re-validate (the live overflow box remains the coarse always-current
check).

**Preview refusals are loud (2026-09-05)**: the preview interpreter runs
from the machine's LIVE state (active fixture, kinematics), so a TWP remap
can refuse a program in preview exactly as a run would (G68.2 while the
machine sits in G59 with a plane active: "Must be in G54"). In the preview
module `CANON_ERROR` is a stub and every remap refusal `yield INTERP_EXIT`
(= 1 < MIN_ERROR), so `gcode.parse` reports an EMPTY success — the fork's
`_canon_error` records the first refusal (`webui_preview_refusal`), the
worker ships `parse_refused {line, message[, sub, sub_line]}` + the
`__REFUSED__` stderr twin (`gcode.parse_refused` trace), and the client's
`previewRefusal` feeds the "Preview stopped — …" banner and a "Parse" stats
row. Line attribution is the unique-site rule (inside a marked sub span →
the span's verified caller line; else the one main-file line matching the
trigger text or the message's G-word), because `sequence_number` reads 0
inside a remap, `linetext` is empty in preview and the canon never fires
`next_line` for a remap trigger line — `line: null` rather than a guess.

**Sectioned preview streams**: the wire ships feed/rapid as separate
endpoint lists, which loses their interleaving — rendered as plain strips,
every stream switch drew a FALSE connector (a feed after a `G0 Z` lift
appeared to start at the pre-lift position, and the part-frame transform
subdivided that phantom into a long wrong curve; user-caught on a
post-lift rotary sweep). `splitTrackStreams` (viewer/scrubTrack.ts, pure,
unit-tested) re-derives both drawn streams from the seq-merged scrub
track as SECTIONS — each section's first vertex is the true start (the
other stream's last point) — plus `feedBreaks`/`rapidBreaks` (section-
start indices); `makeLine` turns breaks into an index buffer +
`THREE.LineSegments` so only real segments draw, and
`transformToPartFrame` never subdivides a break segment (breaks are
remapped through subdivision). Track-less legacy payloads keep the old
strips (no seq = no honest interleaving — same degradation as the scrub
bar). ANCHOR INVARIANT: baked geometry (part-frame output, or a programmed
multi-epoch rebase) hangs under its OWN `pathAnchor`/`pathRot`, posed only
by `toolpath.apply` from `anchorTerms` of the WCS it was baked with —
never from live status. `workOrigin` (stock, surface map, axes) keeps
following the live offsets. A mid-run G10 L2 / fixture switch used to move
the live origin ahead of the 300 ms re-bake: the whole path jumped, then
returned.

**Machine bounds (2026-09-12)**: the drawn box, the toolpath-bounds clip
planes and the camera reframe all use ONE box in the MACHINE frame
(`machineFrameGrp`): the LIVE per-joint limits the status
carries as `joint_limits` (`viewer/machineBounds.ts` boundsFromJointLimits,
joint order → letters via `viewer_init.axes`), with the INI-derived
`viewer_init.machine_bounds` as the documented fallback. The box is the
JOINT window and does not change with kins mode — the TWP sim's HAL mux
switches the AXIS-letter `ini.z.*` window (the WORLD pose LinuxCNC checks
programmed moves against), never `[JOINT_2]`. It bounds the HEAD reference
point while the drawn path is the TIP, so the yellow outside-limits overlay
never compares vertices with the box (that was off by the TLO in Z and the
tilt lever under B/C). ONE SOURCE OF TRUTH (2026-09-12 pm, operator: "so
not one source of truth?"): the GATEWAY validator emits, next to its
per-line records, one byte per shipped vertex — `feed_outside` /
`rapid_outside`: the segment ENDING there had a joint beyond the window,
raw geometric verdict with no parked exemption or attribution
(`gateway_util.segment_outside_flags` for identity segments,
`trsrn_segment_outside_flags` / `world_segment_outside_flags` for the
4°-subdivided world-mode ones, `reduce_outside_flags` onto the kept
vertices after RDP). The window is the LIVE joint window from STAT
(`live_joint_limits`; INI file fallback offline) and rides a `__LIMITS__`
stderr line into `published_limits`; `evaluate_limits_drift` reparses when
the live window leaves a live-sourced one (never loops). The client only
CARRIES the flag: previewDecode → track `outside` (merged like mode) →
`splitTrackStreams` feedOutside/rapidOutside → the part-frame transform
stamps every sample of a segment with its flag → `buildOverlays` draws the
pairs whose run (a, b] holds a flagged vertex as per-chunk index subsets
(prefix sum, so a decimated LOD chord over an excursion stays yellow) — no
clip planes, no box gate, nothing derived from tip geometry in the
browser. No flags on the wire = no overlay (unchecked ≠ clean). The
per-line records keep their attribution rule (the culprit line stands
alone) and stay the HUD chip / marks / scrub stops; the flags paint every
move motion would refuse.

**Reach envelope (2026-09-12)**: layers `reachRoom` / `reachPart`
(Settings → Layers → Machine Reach / Part Reach, both off by default) draw
the reachable-volume OUTLINES — lines only, no fills — from the live joint
limits, the machine.json chain and the live tool length — no program: `viewer/reachEnvelope.ts` (pure) hulls the travel box's corners
through the chain at every head-rotary sample (ROOM solid, under
`machineFrameGrp` like the bounds box; the box is what LinuxCNC enforces on
the joints, the hull is where the TIP can be), then sweeps that solid about
each work-chain rotary over its limit range — per-slice ray spans and a
circular min/max angle window; radial-table solids chain for a second
rotary — into the work frame (PART solid, rides `_workGrp`). The 5-D
workspace (position + tool direction) projects onto these two 3-D solids;
which tilt reaches a point is not shown, and no collision is subtracted
(the sweep answers that per program). `reachWorker.ts` computes off-thread
(~0.5 s on the trsrn model, one computation serves both layers), only
when the inputs change while either layer is on; the worker ships line
soups (hull creases at 8°, the swept solid's cage), never triangles. Three's quickhull produced non-supporting faces on this input (8
translated copies of one orbit): `HullSolid` deduplicates, jitters 1e-3,
VALIDATES every plane against the hull's own vertices and rebuilds with a
fresh seed, dropping faces that still fail (noted in the reply). Outlines:
the swept solid ships a CAGE (rings, generators, spokes — a body the camera
sits inside has no silhouette; crease edges showed only its caps and the
layer read as "still a cube"), the hull draws its 8° facet creases (the
head-lever fillets). With no tool loaded the room solid on the trsrn model
IS the travel box plus the 130 mm pivot lever — the honest answer. The TWP
sim's travels are model-derived since 2026-09-12 (X ±1500, Y −2000..1300
asymmetric — the head homes 1 m in front of the trunnion axis — Z
−2000..0.01; the upstream ±5000 was a 10 m box); every corpus and demo
program was validator-probed inside them. The box never hangs
under the rotating work group (7a04909 moved the planes but not the mesh —
"yellow while inside the box"). A stale path is ONE neutral grey
(`--bg` lifted toward `--fg` by `--opacity-disabled`, opaque) with the
overlays hidden; the soft-limit HUD chip shows the validator's count and is
not clickable (the scrub bar navigates violations).

**Chunked draw, display LOD, room-fixed prefix (2026-09-12)**: the drawn
streams are CHUNKS (`viewer/lineChunks.ts`, pure): real segment pairs
(`buildFrameIndex`, breaks index-skipped) binned SPATIALLY into ≤ 64 grid
cells by a counting sort — the index buffer is permuted, the vertex order
(`feedSrc`'s address space) never is — each cell one
object per LOD LEVEL with an explicit bounding sphere (a null one makes
Three compute the whole shared attribute's sphere per chunk). Per rendered
frame `toolpath.updateCulling` hides each chunk's outside-bounds overlay
whose box lies inside the machine bounds at the parent's current pose (the
overlay used to be a full second draw of every segment) and picks the
coarsest LOD level under 0.5 device px at the chunk's nearest point. Levels
are Douglas–Peucker pair lists over the SAME vertices (`decimatePairs`,
runs end at breaks and frame flips; tolerances `[1e-4, 5e-4] × envelope
diagonal`), cut by the worker that produced the vertices (`buildLodLevels`
in previewWorker for the programmed path, partFrameWorker for the bake);
scrub/sweep stay at full resolution. The machine-bounds clip
planes and the box live in `machineFrameGrp` = the work group's frame with
every WORK-chain rotary at zero (machine coordinates; a child of the parent
of the topmost work-chain rotary, offset by the base translates; `_workGrp`
itself without one) — never under the rotating table. ROOM-FIXED PREFIX:
the parse worker ships `rotary_cmd` (per rotary letter the seq of the
segment that first COMMANDS it — raw endpoint moved from the seed, or the
source line carries the letter as a word, `rotary_word_lines` /
`first_rotary_commands` in gateway_util — plus `unknown` and the seed);
`ScrubTrack.inheritedEnd` (per-axis leading-point counts), `roomEndOf(track,
work-chain letters)`; identity-kins vertices before it bake in the room
frame (`tipInRoomFrame`; the part-frame bake DUPLICATES the previous vertex
as a break at every flip inside a section) and hang under roomOrigin/
roomRotGroup (live) or roomAnchor/roomRot (baked) beneath `machineFrameGrp`,
so an uncommanded table rotary never moves them; world-kins segments and
everything from the first command on ride the part as before. A payload
without the key keeps the old picture. Follow-on hooks: `published_rotary_cmd`
in the bulk pipeline (skip the rotary reparse when the drifted axes are never
commanded), `rapidSrc`, `roomEnd` plumbing. Schema bump for the key is owed at
the next suite stop (never bump `PREVIEW_SCHEMA` while the suite is live: the
fresh worker emits the new number against the running gateway's imported old
one and the schema-mismatch edge reparses forever).

**Program scrub (offline dry run, stage 2 + unified-timeline phase 1)**: a
timeline bar overlaid on the 3D viewer (`ScrubBar.vue`, hosted in
ThreeViewer's overlay next to CameraPip) poses the articulated machine
model at any point of the loaded program without running it — drag or
play with a continuous log-scale speed slider (×0.1–×100). The timeline
axis is PROGRAM TIME (seconds; ×1 = real time; mm:ss readout): the parse
worker ships per-stream cumulative seconds (`feed_tcum`/`rapid_tcum` —
feeds from F with max(linear, rotary°) governing, rapids from
TRAJ/AXIS MAX_VELOCITY; also `rapid_rate`/`rot_rapid_rate` for the
client-built entry move) and the track merge diffs them per stream.
`timeBased: false` (no INI velocity / legacy payload) falls back to the
distance axis (1° ≙ 1 mm), honest not guessed. Tool-change events ride
the wire as `tool_change_lines` (canon M6 only — preview-skipped M600
remaps contribute none) and the client unions them with a TEXT scan for
M6 / M600 / M601 lines (`viewer/toolChangeScan.ts`, tool from the T word
on or before the line; "T13 M600" had no mark) — a change line has no
motion, so its mark sits at the next line with one; info-blue ● marks +
the "T13 in 2:41" countdown.
**Phase 2 (run-time display)**: the bar stays visible during a REAL run
as a read-only surface — every control is dead via the existing gating,
a RUNNING chip marks the mode, the playhead follows `motion_line` on the
estimate axis (line granularity via lineCum; subroutine loops move it
backward legitimately), and the findings/tool marks become look-ahead
("next clash → L11", "T3 in 2:41" — the next-tool countdown, shown in
sim too). No motion verb lives on the timeline — cycle
start/pause/abort stay in their constant home (see
unified-timeline-design memory: unify display, not actuation).
Execution order is reconstructed by merging the
feed/rapid streams on per-point `feed_seq`/`rapid_seq` (global counter in
`gcode_canon.py` — line numbers can't order subroutine loops);
`previewWorker` builds the merged `scrubTrack` off-thread
(`viewer/scrubTrack.ts`, pure, unit-tested). The pose is derived per frame:
lerp adjacent program-space samples, program→joint-space via the same
`wcsTerms`/`programToMachine` as the part-frame preview (exported from
`viewer/partFrame.ts`), letters→joints via `viewer_init.axes`, then through
the SAME `applyState` compose path as live motion (null joint entries — UVW
— keep the live value). The transform is **RS274-exact and pinned by golden
tests** (`viewer/rs274.test.ts` — fixtures generated from LinuxCNC's own
`rs274.interpret.Translated.rotate_and_translate` by
`scripts/gen_rs274_wcs_fixtures.py`; Python twin
`TestRs274EffectiveOffset`): effective XY origin is `g5x + Rz(θ)·g92` (g92
applies BEFORE the G10 R rotation — a plain sum deviates when both are
active), and `wcs.tool` (live `stat.tool_offset`) makes the derived joints
TRUE joint-space (G43-inclusive) so `applyState` phase 3's marker shift
lands the tip on the path — pose, part-frame tip peel, and the collision
worker's tool-cylinder shift all subtract the same TLO back. `tool_offset`
is therefore a watched transform input everywhere WCS is (ScrubBar
`_wcsKey`, ThreeViewer preview refresh + sweep re-run). Scrubbing is an explicit **SIMULATION mode**
(`simMode.ts`, client-local like `busy`): the posed model is an
intentionally wrong display, so while active every machine-action gate is
closed (`permissions.ts` SIM_GATES — only `always`/`armed`/`setup` stay
open; `safety` is closed too, so Machine On requires a purposeful Exit
first). Entry requires armed (outer Gate) + machine OFF + interpreter
idle, via the bar's Simulate button (play and clash-jump also enter when
eligible); a warn `.simBanner` heads the viewer's top-left column
(`.viewerTop`, above the DRO card) the whole time.
Auto-exits: run start, program change, machine powered on by another
client, real joint motion (0.05-unit backstop — above servo dither).
While simulating: backplot recording is suspended (never fabricate motion
history), GcodePanel follows the scrub line, and
touch-off re-poses immediately (WCS watcher). A stale pre-seq cached
payload yields `scrubTrack: null` — the bar simply doesn't offer itself
(unchecked ≠ broken). Text-panel line: `displayLineForPoint` is the ONE
gating rule for scrub AND run playhead — the point's own line only when
per-point trust allows (motion in called subs/remaps carries THAT file's
colliding linenos, W2 P6), else the sub span's text-verified CALL/trigger
line (W4, schema 7: `(WEBUI_SUB=name CALLER=g53.3)` markers +
unique-site scan in `attribute_sub_callers` — multiple call sites of one
sub keep the chip-only display; no positional signal exists, the interp
never fires next_line for o-call/remap trigger lines), else null + the
"(name)" chip. Above it sits `resolveCurrentLine` (W5, the display
spec in docs/decisions.md wave 5): live `motion_line` — a bare
motion-queue id with NO file identity — may display only when the
track's per-line trust set vouches for it (the off-path approach
rescue) and NEVER at idle (post-run it holds the last executed id: the
stale blank-line-8 class); the track's terminal vertex displays the
text-scanned unique M2/M30 line ("end" readout). While a marked o-call
span executes, GcodePanel renders the called file's lines INDENTED
under the call line (`subRows.ts` row model, `GET /subfile` source,
expansion only when the call line's text IS `o<name> call` — remap
wrappers and nested spans never expand).

**Run-time state freshness + the sim-parity gate (W6)**: the preview
depends on four run-time state inputs, each freshness-guarded — WCS
table (per-epoch terms), tool length (TLO-drift auto-reparse), XYZ
start (entry move), and rotary pose: the worker emits its schema-5
rotary seed as an `__ABCSEED__` stderr line and the gateway's idle
drift edge (`evaluate_rotary_drift`, 0.01°) auto-reparses when the live
pose leaves it (a run parking the table tilted made the cached preview
orient from a pose the next run never visits — the arc-vs-plunge
class). A parse IN FLIGHT whose rotary seed the live pose has left is
cancelled at once, every tick, no settle (`inflight_doomed_reason` — it
used to run through the whole jog); the RESTART waits until the rotary
pose has held still 1 s (`rotary_hold_update`/`rotary_hold_settled`, the
schedule gate in the poller), and linear motion never defers or dooms a
parse — the payload does not depend on where X/Y/Z sit. Acceptance standard: `scripts/sim_parity.py gate --corpus
scripts/parity_corpus/<config>.json` (run by `test_suite.py live-twp`, which
copies the corpus into the program folder: each program is loaded through
the gateway's `load_file`, never a bare `program_open` — docs/testing.md) — per run it saves the RUNNING
gateway's cached payload, captures the real run (twp_parity
sample_run; truth file opens with a context header), replays the
payload through the ACTUAL client chain (`lcnc-webui/scripts/
simDump.ts` via vite-node — decodePreviewStreams/buildEntryTrack are
single pure implementations shared with the browser), and gates on
bidirectional 6D joint-space path deviation (deg ≙ mm; wall-clock never
compared; per-program tolerance absorbs G64 blending).

**Mid-run tool-table re-parse (operator 2026-09-29, Codex R40)**: every
drift edge above is idle-gated because the worker seeds its start state
from the LIVE machine (fixture, WCS patches, parameter file, kins, rotary
pose, applied offset, spindle tool) — mid-run that is the running
program's state, and a parse from it describes the program wrongly. But a
program that measures its own tool (`T13 M600` → G10 L1) cuts right after,
the interpreter is not idle again before M2, and the preview stayed muted
on the old length for the whole run. ONE edge re-parses DURING a run:
`midrun_table_gate_open` (AUTO mode, interpreter busy, a published ctx for
the loaded file, not `pin_unsupported`, 2 s debounce) with
`evaluate_tlo_drift(table_only=True)` — only `table_mtime` / `table_row`;
the run's own G43 / M6 are no drift. The parse is PINNED
(`BulkPipeline.pinned_ctx`): the published parse's ctx verbatim (fixture
index, WCS var patches, kins type/frame) + its PARAMETER BASIS (the var
file's raw text and G92 the worker reported in `__PARAMS__` → `param_text`
/ `g92_offset`: G92, G28/G30 and every numbered parameter the program reads
— MR-I02) + its rotary seed (`rotary_pose`) + its tool seed (`seed_tool`):
the worker puts the START tool's row, from the table NOW, into the
interpreter's spindle pocket (`seeded_spindle_row` — a `G43` without H read
the live pocket, MR-I01) and reports it back in `__TLO__`
(`seeded_tool_meta`). A random toolchanger cannot be pinned faithfully: the
worker exits `PIN_UNSUPPORTED_EXIT`, the pipeline latches `pin_unsupported`
and the preview stays stale-marked until idle. Read live on purpose: the
tool TABLE (the reason for the parse), the operator's run option block
delete, and the configuration (units, axis mask, joint limits, INI, program
and sub files). So the preview shows the program as the machine executes
it: from the same start, with the table it now holds. Niced
(`PINNED_NICE` 19, the worker's first act — a priority, no guarantee for
real-time, memory or I/O latency; SCHED_IDLE is weaker still), 3× the
timeout, its duration never enters the idle estimate, a pinned in-flight
parse is never doomed by the (program's) rotary motion; a second
measurement during it is picked up by one follow-up parse (the worker reads
the table's file time BEFORE its STAT read). After the run the idle edge
re-parses for the table and the spindle tool (the program's M6:
`tool_loaded`), and VERIFIES a changed start tool state (below). The browser: a publish during a run clears the collision findings and
the sweep, held while the interpreter runs, starts once it is idle again
(`_colHeldByRun`, MR-I03). Traces `gcode.reparse_table_midrun`,
`pinned: true` on `spawn_start` / `publish`, `gcode.pinned_unsupported`;
banner reason "tool measured (program running)". Tests: `native_pinned_probe.py`
(the real worker + native interpreter, synthetic STAT) behind
`test_pinned_worker.py`.

**Start tool state + verify at the actual offset (VP-I20, Codex R51–R57,
2026-10-01)**: the machine runs every move before a program's own G43/G49
under its INHERITED modal G43 (live-confirmed: `G0 Z-100` lands at −100 +
G54 + the applied offset for G43.1 Z12.345 / G49 / G43 H13), but the parse's
interpreter used to start at offset 0 — Z45 under a start offset of 10 ran
at Z55 and was not reported. The worker reads the start ONCE
(`start_tlo_seed`: the gates' `applied_tlo` override, else a pinned parse's
seed, else STAT — 490 → G49 start, a G43-family code → `G43.1` with the
applied vector), seeds it as an init line after the rotary sync, and ships
it as `tlo_start` / `start_known` (+ `start_mode` on `__TLO__`). An unknown
start (no mode, not finite, an A–W component, a pinned seed without a mode)
seeds nothing and gives NO limit verdict (`violations: null`,
`violations_reason: "start_unknown"`, stats "Not validated (start tool
offset unknown)"). A `%`-delimited file has an INIT PHASE
(`PreviewCanon.percent_delimited` from `percent_delimiter_line`): LinuxCNC
reports the `%` line as sequence 1 (whatever blank lines precede it) and runs
the initcode block right after it, so its callbacks arrive numbered 1 — it
used to record the rotary sync as a phantom zero-length point at program
0,0,0 and the seed as a TLO row. The phase is the observed ORDER (from that
next_line to the next one, then never again — a subroutine's line 1 is
program), never a line number (Codex R58 VP-I22). The idle edge
(`evaluate_start_drift`) fires on ANY actual change of the start (> 1e-9,
mode included; no tolerance — two samples prove nothing, Codex R54): reason
`tool_offset` → a VERIFY parse at the live offset: the gateway hands the
worker the published bytes (`verify_against`, temp file), the worker
compares its encoded payload (`compare_preview_payloads`): the published
one NORMALISED to the new start — points before the first TLO row p +
tlo_start_old − tlo_start_new within float32 precision, every later point
bit-equal, the rows byte-equal (they are the offset of every later point —
the client uses an offset TWICE, axis position and tip/body, Codex VP55-01),
bounds recomputed, every other field byte-equal. Same → `__SAME__`, no
stdout, no version bump: only the TOOL BASIS moves (`BulkPipeline.tool_basis`,
status `preview_tool_basis` {file, version, xyz} while it differs from
`tlo_start`), and previewWorker re-decodes the SAME bytes it kept
(`normalizeToToolBasis` — every basis from the original data) so the prefix
re-tips — only for exactly that FILE and version (a basis naming another
file is never applied; the payload falls back to its own start, Codex R58
VP-I24), and until that decode is on screen the preview counts as being
refreshed (`previewBasisPending` → the same "checking" line, muted path,
sweep findings dropped and not restarted; only the matching reply ends it,
never an older one or a worker error — VP-I23). A reply is checked against
the decode WANTED now (`_previewWantKey`), not the one sent last: a return
to the basis already on screen ends the wait at once and drops the reply
still out for the other basis (Codex R59); ThreeViewer `_programTool()` / ScrubBar resolve the pre-first-row
offset to the payload's `toolBasis` (a payload without a known start keeps
the live offset). Different → the verify parse is the re-parse, published.
Banner reason "tool offset changed — checking" (in the HUD's "?"). A pinned parse seeds the tool
basis. Tests: `native_start_probe.py` behind `test_start_tlo_worker.py`
(one fresh process per case; Codex's R54/R53 counterexamples differ, his R55
pair and heavy_test's shape compare same), `viewer/toolBasis.test.ts` (real
payloads `scripts/test_fixtures/tool_basis_pairs.json`, regenerated by
`scripts/gen_tool_basis_fixture.py`, through decode, track, part frame,
scrub pose and sweep both ways), `collisions.viewer.spec`. The goldens are
pinned to a G49 start (`preview_gate.GOLDEN_APPLIED_TLO`). Schema 10 (the
start state + the `%` init phase) shipped at the suite stop of 2026-10-01:
the four goldens (`3axis` haus / kontur / 1001 against a headless boot,
`twp_gantry` against the gantry sim) moved in the schema field alone — none
of them is a `%` program on a rotary config.

**Re-parse cancel-and-restart + visibility (2026-09-05)**: every drift
edge above used to be gated on "no parse running", so an edge raised
DURING a parse (a touch-off while the rotary-drift parse from → Zero
still ran — every zeroing sequence, live) was not evaluated until that
parse published and then queued a second full parse behind it: 41–167 s
to a correct preview on a 1.18 M-line program. Now `BulkPipeline.inflight`
holds the running parse's input snapshot (rotary seed, kins seed, flat
WCS offsets, file + mtime) and the poll loop evaluates the same edges
against it under the same idle gate, settle guards and 2 s debounce
(`inflight_stale_reason`, pure); a hit CANCELS the worker
(`cancel_inflight`: SIGTERM — inside `gcode.parse` the handler's
SystemExit becomes `interp_error` → exit 3 within ~100 ms, temp dir
removed; SIGKILL fallback after 2 s; `gcode.reparse_superseded` /
`gcode.parse_cancelled`) and `reparse_pending` restarts it under the
specific edge (`wcsoff:G54:x`, `rotary:A`, `kins:type`, …) — the
scheduled reason is that edge, never a bare "drift". A running parse for
the CURRENT file+mtime is never superseded by its own file edge
(`preview_file_edge_action` — `file_changed` holds until the publish;
the first acceptance run killed every load parse 33 ms after spawn).
The worker timeout is `max(60 s, 3× expected)` where expected = the last
measured publish of that path, else 1.2 ms/byte (the flat 60 s sat 14 s
above the plane-mode parse). While a parse runs the status envelope
carries `preview_refresh` {reason, file, expected_ms, started_ms,
queued, superseded}: App.vue shows a warn banner with the reason in
operator wording (`previewRefreshLabel`), a locally ticked elapsed clock
and a progress track that never reaches 100 % on its own, the viewer HUD
shows ONE line "Preview re-parsing" with the same bar — the reason only in
its "?" ("Why: …", operator 2026-10-01: the reason took width) — and the
drawn toolpath is MUTED
(`toolpathController.setStale`: an OPAQUE colour mix toward the scene
background at the `--opacity-disabled` ratio — never alpha; a million
blended segments held the Mac's GPU 3 frames behind during every re-parse,
measured with the viewerPerf probe 2026-09-09) while a parse runs
or the payload's offsets / tool length are known stale. The stale-offsets
LINE ("Preview uses older offsets — re-parses when idle") shows at once
only during a run; in standstill the gateway re-parses within its
debounce, so it waits 5 s for that re-parse and shows only if none began
(live look 2026-10-01: it flashed before every "Preview re-parsing"). Parse speed on
the same program (identity, this VM): ~23 s → ~15 s quiet / ~23 s while
a VM-local tab decodes the previous publish — the comment-strip fast
path, the canon's WCS snapshot only on a setter call, and the vectorized
limit checks (below).

**Entry move + auto-check**: at sim entry the live machine position is
captured (joints→machine→program via `machineToProgram`, the exact
inverse of the preview transform) and `prependEntry` puts the rapid from
the machine's ACTUAL position to the program's first point at the front
of the track (scrub 0 = live position, labeled "entry", rapid-flagged) —
run-time-only motion no parse can know, and the classic crash. The
conversion runs under the TRACK's first-segment labeling (mode[0] +
frame[0] + epoch-0 terms as ONE triple — W3 P3: joints are the physical
invariant, kins maps are labelings; mixing the live kins pin/plane pins
with epoch-0 terms landed the entry ~900 mm off when parked labeling ≠
track labeling); the live pin is only the legacy fallback for mode-less
tracks. Since schema 6 the track's first point is the program's own
first-move ENDPOINT (`rapid_ustart` — the canon records suppressed
first moves as zero-length unknown-start rapids instead of dropping
them; ustart unions into brk client-side, and the entry move supersedes
the unknown approach), so the sim reproduces the run's real multi-stage
approach. The sweep
keeps itself current with NO manual trigger: auto-runs on program load
(base track — marks appear before sim is entered), on sim entry (entry
track, fresh position = fresh baseline), and on WCS/tool changes while
idle (stale results clear + re-run, debounced; in sim ScrubBar re-checks
with the rebuilt entry track). SWEEP STATES (2026-09-13, no button): the sweep has NO control on the bar
— it is OPEN-ENDED (the 300 s budget and the ❚❚ / ▶ / ↻ button of
2026-09-12 are gone, operator decision), its progress is the TIMELINE's
swept band (`sweptFrac`; the iterator's progress and `covered` are
TRACK-AXIS fractions, `distToTrackCum(s) / cum[n-1]`, so a scrub shows
which section is already checked), and its findings show LIVE: the worker
posts the UNREFINED sweep-so-far (`SnapshotHandle.peek`, `partial` on the
progress message, at most every 500 ms and only when the record count
changed — hits at their discovering samples, up to one step late) as
`collisionPartial`, so ticks, bands, the tint and the code-panel marks
appear as the sweep finds them and the verdict reads "N collisions so far";
the refined result replaces it when the sweep ends or parks. The worker
PAUSES for camera interaction (auto-expires after 30 s — a lost pointer-
up) and for a HIDDEN tab (no expiry; `visibilitychange`), two independent
holds; a ROTARY jog PARKS it (`stop`, honoured at the next checkpoint — the
iterator yields on TIME, 8 ms of active clock, the 16-segment / 512-
sample checkpoints as the floor; the park snapshot's refinement is
MEMOIZED per unchanged record) and a settled pose continues it — the
worker keeps the suspended generator with every clearance certificate and
contact state, `SnapshotHandle.take` hands out the sweep-so-far without
ending it; parked reads "no clash in N % swept" / "in N % swept". The
iterator's 4 M-sample backstop is the only hard limit (`truncated`,
reason "samples"). The findings — limits nav, clash nav, verdict text —
keep every variable-width readout AFTER the last button of its group.
Row 1's line /
time readouts are FIXED slots sized PER PROGRAM (flex basis, ellipsis,
full text in the title; line = "L" + digits of the last line + " →",
time = "mm:ss/mm:ss" + "~"; the timer shows always — "00:00/45:00" at
idle, never "live"; the mode chip is gone — "off path" shows in the line
slot) — a min-width floor let "L1234 (sub_name) →" eat the timeline. The
speed slider stays in row 1 (row 2 shifts with findings). Timeline BANDS
span the thumb's EDGES (an extent to program end reaches the track's
end); ticks sit at thumb centres. Dragging the timeline PAUSES playback
(`@input`). Only a ROTARY jog (> 0.05°) parks; nothing cancels but a
superseding change (program, touch-off, tool). A motion-parked sweep resumes by itself
once the pose has held still 4.5 s with no re-parse in flight; a re-parse
that lands drops it and starts fresh. SIM ENTRY never touches the
program's sweep (the MAIN run, always on the BASE track): the ENTRY
SEGMENT (the live position → first point rapid, `sliceTrack`) is a SIDE
sweep in the worker (`side: true` — beside a running or parked main run,
milliseconds) whose result is the entry OVERLAY, merged onto the base
result AT DISPLAY TIME (`collisionEntryResult` = `sweepMerge.ts`: base
cums shift by the entry length; ONE contact seen by both sweeps — an
entry onset still in contact at the entry's end + a base onset for the
same pair from the first point — counts ONCE: the entry record keeps the
onset and the base's span, the base's first-line record becomes its
continuation (line 0 = the entry move) — unless that record SEPARATES and
comes back on its line: then only its first interval joins the entry's
finding (`carried`, the entry spans to its end) and its re-entries stay the
program's findings under their own keys (Codex R34 VP-I09); TWO baselines, both reported — the live
pose's and the first point's static contacts). `viewer/sweepEntry.ts`
(pure, pinned) decides what runs: base unknown → base + side; base
current / running / parked → side only; overlay already swept for this
entry track → nothing; machine at the first point → the track IS the
base, nothing new. The entry track STAYS after sim exit — the entry move
is the rapid the next cycle start will make from where the machine sits,
and its verdict must not vanish with the mode (operator-caught: a clash
in sim, "clear" on exit); a run start or program change drops it, and
when the machine moves outside sim ScrubBar rebuilds it from the settled
pose (500 ms) and re-asks for the segment. The base result keeps its
identity, so a re-entry sweeps only the new segment.
The first attempt cancelled a base sweep at 59 % for that one segment and
re-swept the whole program on every re-entry; its full entry-track sweep
also had the LIVE pose as its only baseline, so a program that starts in
contact reported a continuation record per line (200 capped hits at 3 %)
and every park refined thousands of them — refinement is now bounded to
the reported set (MAX_HITS, onsets first) and skipped on a driver abort.

**Collision sweep (offline dry run, stage 3)**: the scrub bar's Check
button sweeps the machine model through the scrub track off-thread
(`viewer/collisionWorker.ts`) and reports tool-side vs work-side body
pairs inside a 2 mm clearance margin. `viewer/collision.ts` (pure,
unit-tested, incl. against the real machine-xyzac STLs during dev):
full-group-tree pose evaluation (same compose semantics as
applyState/partFrame), machine.json STL bodies — UNGROUPED parts
(column, base, spindle housing) attach to an implicit root node and are
fully collidable; everything moves relative to the frame — + a
parametric tool cylinder (the DISPLAYED marker dims — tip at origin,
+Z), three-mesh-bvh
`closestPointToGeometry` with margin early-out behind a bounding-sphere
prescreen, and CONSERVATIVE ADVANCEMENT stepping: every distance query
certifies the pair can't reach the margin within (d − margin)/V of
sweep parameter — the sweep runs in its OWN distance parameterization
(mm, 1° ≙ 1 mm), never the track's cum, which may be time: the guarantee
constants are spatial; hits convert back to track-cum on report —
(V = provably conservative relative-speed bound from the
pair's connecting DOFs — translations exact under identity kins,
rotations × endpoint levers with ×2 inflation, chunked so the SUMMED
rotary sweep stays ≤22.5° (capping only the largest let three
simultaneous rotaries reach 67.5°, where the inflation's
1/(1−rotRad)≤1.65 argument goes negative); under a world kins the linear
joints are trigonometric in the swept rotary, so endpoint deltas can
read 0 across a symmetric bulge and a pair whose path lacks the rotary
has no lever budget — the miss class. Each kins family bounds its OWN
per-joint mid-chunk excursion via `KinsModel.jointBulge`; collision.ts
reads no family's parameter names (it used to read the trt-only
`KinsParams`, which a trsrn spec does not carry, collapsing a 2 m rotary
lever to the distance from the machine origin). Bounds are CERTIFIED per
family by `kinsBulge.test.ts` — randomized chunks, densely resampled,
requiring the sampled excursion never to exceed the declared bound for
any joint; trivkins and trsrn mode 2 are exactly 0 because their inverses
are affine in the coords. Adversarial pins: the trt C-sweep-into-wall and
the trsrn A-sweep, both verified red with the bound stubbed to 0);
pairs re-query only on certificate
expiry. Guarantee: no margin crossing wider than 0.25 units of path is
missed — clear programs stride in a handful of samples (adversarial
tests: a 2 mm graze and a 2.3°-window large-radius rotary clash that
fixed 5 mm/4° sampling provably missed). NOTE that 0.25 is a fixed floor
(`MIN_ADV`) in a parameterization where 1° ≙ 1 mm, so on a metre-scale
machine a forced 0.25° step is ~8.7 mm of surface travel: the bound
removes the systematic blind spot, not the sampling floor (recorded in
docs/decisions.md). Certificates CARRY across chunk boundaries (2026-09-10):
a query's clearance d − margin is decremented by each chunk's V × Lc and
re-expressed in the next chunk's V, so a far pair costs nothing until the
motion could have closed the gap — the old per-chunk reset re-queried every
pair at every segment, which on a program of a million 0.09 mm segments
was ~2 h per sweep (now 31 s, certified). Pairs inside the margin keep
their EXPLORE re-probe cadence but are sampled at least once on every line
they stay in contact with (the per-line continuation marks). The sweep is a
resumable iterator (`sweepCollisionsIter`, checkpoints every 16 segments /
512 samples and every 8 ms of clock) with an optional WALL-CLOCK budget
(`maxMs`, sync API + tests only — the worker runs sweeps OPEN-ENDED since
2026-09-13): on breach it stops and the result says `truncated`
{covered, reason} — ScrubBar reads "no clash in N % swept", never "clear".
The sample budget (4 M) is only a runaway backstop, and its breach is
`truncated.reason = "samples"`, no longer a silent break.
A sweep whose guarantee does not hold — a declared kins this client
cannot evaluate falls back to trivkins, whose bound is legitimately 0 —
reports `uncertified` with the reason, surfaced in ScrubBar on BOTH the
"Clear" and the "N collisions" branches.
Attribution: worst hit per (line, pair); penetrating hits are REFINED to
first contact (walk back to the last clear parameter + bisect, ~30 pair
probes per hit) so scrub-to-hit poses the model at first touch, never a
sample-step deep. Contact within one line can be INTERMITTENT (rotary
return moves brush parts twice — user-caught): hits carry
`intervals` ([enter, exit][], every boundary bisected; in-contact
samples cluster with gaps > the in-margin stride = verified
separations); the clash tint tests interval membership and the
timeline marks/navigates every interval ONSET, so a re-entry is its own clash
stop. A contact from the start of the axis (the program begins in it) is
refined into intervals too — it may separate and come back on its line. A
record that carried a contact in from an earlier line and re-enters on its
own line marks that first interval `carried`: it is the earlier finding's
contact (whose span reaches its end), not a stop of its own (Codex R34
VP-I09). The clash COUNT, the marks and prev/next all read ONE list
(`viewer/clashTargets.ts`; a same-line re-entry is labelled) and contiguous
refined windows are merged (`mergeContiguousIntervals`) — count ≡ ticks ≡ stops. Near-miss hits keep their closest-approach sample.
Hits during RAPID segments are flagged `rapid` — always real. ThreeViewer owns the worker (geometry from machineAssetCache, tool
dims from live status); the worker drives the iterator in 40 ms slices
(`viewer/sweepPump.ts`) and reads `{cancel}` / `{pause}` / `{resume}`
between them — no terminate, the BVH model stays RESIDENT under a
`modelKey` (STL copies are re-sent only when it changes; a worker that
lacks the model answers `needBodies`); OrbitControls start/end pause and
resume a running sweep, because a busy worker is off the main thread but
not off the machine (it starved the Mac's GPU 3–4 frames behind,
2026-09-10). Results reflect check-time
WCS/tool and clear on program change; GcodePanel reuses
`.codeLine.violation` markers via `collisionLines`. SEMANTIC LIMIT (no
stock model): a program cutting at the work surface reports tool-vs-
platter contact — cutting and crashing are indistinguishable without
stock; the high-value signals are non-platter pairs and any rapid-flagged
hit. CUTTING SEMANTICS: only a body flagged `stock: true` is cuttable —
machine parts NEVER are (without a stock body the tool may touch nothing:
real programs cut stock sitting above the fixture, so tool contact with
any machine body is a crash by definition; the platter is workholding).
For stock bodies: FEED contact is machining and never reports; contact
whose ONSET falls in a RAPID is the gouge class and reports; a rapid
RETRACT leaving feed-begun contact is benign. Stock pairs are never
baseline-excluded (parked-on-work is normal); they seed the in-contact
state instead. The (local-only) machine-dmu160p example carries the first
stock body
(`work_piece` cube, `stock: true` — flag flows gateway → `viewer_init`
parts → collision bodies); the deferred user-placed stock-box feature
would provide one for arbitrary machines/programs. Pair scope: DERIVED from relative motion
— any two bodies whose
group-tree path crosses a kinematic DOF below their lowest common
ancestor form a pair (tool-vs-work, tool-vs-frame, and same-side pairs
like platter-vs-table across the A tilt); rigid pairs are skipped. A whole-program REACH PRESCREEN (2026-09-13) then
drops pairs that can provably never come within the margin at any pose the
sweep will evaluate: every joint's range over the track (both endpoints of
every segment under its own kins labeling, bulge-padded on world-kins
segments) pushed through each body's chain below the pair's LCA as a reach
sphere (translations widen by half their range, rotations by the chord
2ρ·sin(min(Δ/4, π/2))); reported as `pairsPrescreened`. Query side (same day, from the opt-in
`CollisionOptions.profile`): the larger body is always the OUTER BVH
traversal (three-mesh-bvh prunes the outer tree by the inner body's whole
box — a wall-spanning inner box prunes nothing: 12.8 ms → 0.02 ms per
query), each body carries its connected components' AABBs
(`componentBoxes`) whose box-to-box distance is a valid lower bound that
answers every above-margin query without the BVH, and a cutting pair in
feed-begun contact owes no per-line sample. The wall gantry's ~450 pairs
over 236k triangles made a 1.2 M-point sweep take hours; a 20k-point slice
went 203 s → 5.1 s (docs/decisions.md 2026-09-13).
Baseline subtraction keeps it quiet: pairs inside the margin at the
program's FIRST pose AND at the model's REST pose (every joint at zero —
the designed pose the machine-model tests require to be self-collision-
free but for the designed bearings; slides, bearings, trunnion mounts —
found automatically, no annotations) are reported once as
`staticContacts` and excluded from per-line reporting. A pair CLEAR at
rest but touching at the first pose is a crash the program starts in
(operator-caught 2026-09-12: the entry rapid drove the ram into the
column; the first-pose-only rule filed the pair as static, never queried
it again, and its tint and extent stopped at L1): seeded as an onset on
the first line and checked throughout. NEVER a TOOL pair either
(operator decision, same day): the tool is no one's mechanical neighbour
(`CollisionBody.tool`, set by the worker on the parametric cutter;
`pairTool` in the model). An onset whose contact persists past its own
line carries `spanCumEnd` (where it finally ends, over ALL records — the
report keeps MAX_HITS = 200 records, onsets first, and a contact that
never separates over thousands of lines is a record per LINE): the tint
and the timeline's red extent read it for lines with no record of their
own. Test fixture:
`~/linuxcnc/nc_files/5axis_collision_test.ngc` — in-limits program whose
low rapid traverse rams the trunnion (stage 1 quiet, stage 3 flags it).

## Key Patterns

- **No hardcoded visual styles** — never invent custom font-size, padding, border-radius, colors, opacity, or font-family for new elements. Always inherit from the nearest parent class or global base styles in `style.css`. New CSS should only override layout properties (flex, width, text-align). If a visual style doesn't exist, extend the existing class hierarchy or global base — never create one-off overrides. For color semantics: machine active states use `--ok` (green), form controls (toggles, radios, checkboxes) use `--info` (blue), danger/abort uses `--danger`, warnings use `--warn` — as FILLS, borders and tints; a TEXT or state glyph in that state reads its `-text` role (`--ok-text`, `--warn-text`, `--danger-text`, `--info-text`, `--accent-text`), muted text `--fg-muted` (see Text roles).
- **Focus ring** — ONE keyboard ring (design wave D3, UI-K12): `:focus-visible` on buttons, selects, checkboxes, radios, `[role="button"]` and sliders (`outline-offset: 4px` — the 6 px track sits inside its box) draws `2px solid var(--focus-ring)` — its own role per theme, ≥ 3 : 1 on bg, panel and button (`--info` was 2.9 : 1 on white; design wave D8a). A FIELD (`.inputField`, `textarea`) draws it INSIDE, over its edge (`outline-offset: -2px`): outside it was cut off wherever a field sits flush with a scroller's edge — the MDI line, the Tools search, the probe forms (live look 2026-10-01; `layout.spec` focuses every field in every side tab and requires its whole ring inside every clipping ancestor). Selection never uses the ring (tabs show it by shape).
- **Non-text contrast** (viewer contrast plan V5, WCAG 1.4.11) — what identifies an ACTIVE control holds 3 : 1 against what lies next to it: a switch (`input.toggle`) carries an inset `--control-edge` in both states (the off track sat at 1.3 : 1) and its checked knob is `--control-knob-on` (the light knob sat at 2.4 : 1 on the dark themes' `--info`); slider thumbs are `--fg`. `contrast.spec`'s non-text pass checks cards (edge or body on the scene), switches (edge or track on the panel, knob on the track), button glyphs, and slider thumbs from RENDERED pixels (found along the axis — the thumb overflows a thin track's box) in the viewer (simulation off and on), the strip and Settings, five themes.
- **Motion and forced colours** (design wave D8) — a pulse or flash moves a BACKGROUND, never the words (`banner-pulse`, `pulse-warn`: they faded the whole box to 50 %); `prefers-reduced-motion: reduce` stops every pulse and flash and leaves the state as a static fill, and the banner's fade-in is dropped (a new animation adds its own reduce rule after its base rule); under `forced-colors: active` a selection takes `SelectedItem` / `SelectedItemText` (Btn.vue `.b.selected`), the state banner an outline — backgrounds and shadows are dropped there. `appearance.spec` pins all three.
- **Control height** (design wave D4, UI-K03) — ONE height per density: `--control-h` (32 px desktop, 44 px touch — operator decision 2026-09-26) for fields (`.inputField`: input and select), TabNav tabs and the md TEXT buttons of the side pane and dialogs (Btn.vue `.b.md` — not the icon buttons: a dialog's X keeps the header's line box); `--control-h-compact` (28 / 36 px) is an AREA's choice — `.strip` and `.dataTable` redefine `--control-h` to it, so every control inside follows. Never a per-control padding for height (the catalog's size tiers are gone; `density: 'compact'` is only the strip DRO field's dense look). The strip's own button sizes are D6's.
- **Starting motion is a hold** (design wave D6, operator 2026-09-25) — Start, Step, Resume (catalog `hold`, `holdKey` = the program's path + published revision + displayed-text revision, UI-DI05), the Run-from-line action (+ the line) and macros (macro FILES, package 5 — a bar button without parameters: the file's name + its sha256 revision; with parameters the dialog's Execute, `macroExecute`: + the values; a parameter is a number field, so Enter opens its keypad and never executes). The parameter dialog reads its file LIVE by name (`useMacros` `dialogFile`): a revision saved while it is open — by any client — is what it shows, binds and runs; entered values stay, a new parameter shows its default, a deleted file runs nothing (round 4, UI-DI08). Start with a selected line only opens the dialog (a tap). Pause and Abort are taps; the Space shortcut stays instant (K13 follow-up). The macro send checks `probe`, the button's class.
- **Tab pattern** (design wave D5, UI-K05; operator 2026-10-02) — every side-pane tab's head is `.panelHead`: `.panelObject` (what it acts on and its state), then ONE `.actionGroup`: the machine actions with Abort right BESIDE them on the left, and — where the tab has management — the "More" disclosure (`MoreMenu.vue`, class `actionEnd`) at the RIGHT end: Program Start · Step · Pause · Abort … More (M01, /BD, Edit, Reload, Unload, Files, Upload, Download), Tools Measure Current (primary) · Unload · Abort … More (New, Files, Upload, Download), Macros Run · Abort … More (New, Upload, Download); MDI and Probing have no More and Abort ends their group at the right edge. Search / filter, content, inline feedback follow. One files toggle, "Files", pressed while the browser shows (Macros has none: its list IS the folder). Download (catalog `fileDownload`, gate `always` — a read moves nothing; `download.ts` `saveAsFile`) saves the file as it is: the loaded program (`GET /gcode`), the tool table FILE as LinuxCNC reads it (`GET /tool-table`, token, its name in `X-File-Name`), the selected macro. No card around a group. `layout.spec` sweeps the rule over the four DR states (N80 reformulated: with More, More ends the group at its right edge after Abort and Abort follows the machine actions; without, Abort ends it). Narrow (`.sidePane.narrow`) the head's rows sit at `--gap-tight`; Program's run grid is two rows, Step and Pause as symbols (Start · Step · Pause / Abort … More); the management lives behind More in every width (the narrow-only `.panelMore` / `.foldNarrow` fold is gone).
- **Resets and list rows** (design wave D4, N65/N67) — a reset to defaults sits at the end of its section, right (`.resetRow`), asks once, and its confirm keeps the button's gate. A list row's actions are pencil / `Trash2` in the listAction look (`listAction`, or `listActionSetup` where the action needs setup) named for their target ("Edit T5"). Keyboard and gamepad command names come from ONE list (`INPUT_COMMAND_LABELS`, defaults.ts); both binding tables read Action | binding.
- **Forms** (design wave D4, UI-K04/K10) — a labelled field is a `FormField` (see its entry) in a `.formGrid`: two equal columns while each keeps `--form-col-min` (160 px, the widest measured head + reserve), else one; `.sub` / `.sep` / `.wide` span both. The ONE label class is `.formLabel`; a unit is never a placeholder. One level up, `.sectionColumns` splits a SECTION into two columns by the same rule (`--section-col-min`, 320 px: a layer table with its line samples and On top column); the sections themselves stand one below the other.
- **Spacing tokens** — use `--gap-micro` (2px, ultra-tight), `--gap-tight` (4px, grouped toggles), `--gap-controls` (8px, button rows/form fields), `--gap-section` (12px, between sections), `--gap-panel` (20px, major divisions) for all layout gaps. Never hardcode gap/margin values for spacing between elements. Padding inside buttons/inputs is visual and stays hardcoded. Minimum gap between any clickable elements: `--gap-tight` (4px).
- **Opacity tokens** — `--opacity-subtle` (0.3, separators), `--opacity-disabled` (0.4), `--opacity-muted` (0.6, decoration), `--opacity-secondary` (0.8, dialog body, icon hover). Never hardcode opacity values (exception: animation keyframes). Opacity is for DISABLED controls and decoration — never for a text someone reads.
- **Text roles** (design wave D8a, UI-K08/K09, UI-D07) — a text that is not plain `--fg` reads a ROLE each theme defines: `--fg-muted` (labels, `.sub`, `.label-muted`, units, descriptions, hints, line numbers, table heads, unselected tab labels, icon buttons), `--ok-text` / `--warn-text` / `--danger-text` / `--info-text` / `--accent-text` (a text or state glyph in that state), the syntax palette, `--focus-ring`. Muted is a COLOUR, never `opacity`: an ancestor's opacity multiplies into every child and no child rule undoes it (the "?" inside a muted label looked muted while fully usable; `feedback-channels.spec` measures every help icon's effective opacity), and it fades against whatever lies behind (3.6 : 1 on the light panel). EVERY theme block defines every role — the dark one TWICE, `[data-theme="dark"]` and the auto block under `prefers-color-scheme: dark` (`themeTokens.test.ts` pins both); `contrast.spec` measures every visible text at 4.5 : 1 against what is rendered behind it in five passes (four themes + auto on a dark system). A DISABLED label keeps `opacity` (it must compose with a colour of its own — a colour rule loses to `.val-status.warn`), so a "?" never sits inside a label that can be disabled: MachineToggle's root row holds the label and the "?" side by side.
- **UI font** — the app SHIPS its face: Inter (SIL OFL, `src/assets/fonts/`), one variable WOFF2 behind `@font-face` in `style.css` (`font-display: block`, weights 100–900), first in `--font-sans` (operator decision 2026-09-25). Every browser on every machine renders the same face, and the layout tests and visual references measure exactly it — the system font differed per machine (San Francisco, DejaVu Sans without semibold, Segoe UI) and a zero-reserve layout fitted on one and scrolled on another. Canvas text reads the same stack (`ViewCube.vue` redraws once the face has loaded); every troika `Text` sets `font = LABEL_FONT_URL` (`viewer/labelFont.ts`, a static Inter WOFF — troika reads no WOFF2 and no variable axes): a Text WITHOUT a font fetches its fonts from cdn.jsdelivr.net at run time, and on a machine without internet the dimension/probe/plane labels never rendered (`labelFont.test.ts` scans every `new Text()`, the viewer spec aborts every request to another host). The code surfaces ship theirs too (operator, same day): JetBrains Mono (SIL OFL), regular + semibold WOFF2 — the two weights the syntax highlighting uses — first in `--font-mono`. `src/bundledFonts.test.ts` requires both stacks to START with a family `style.css` declares with `@font-face`, and every face's file to exist.
- **Syntax highlight tokens** — `--syntax-gcode`, `--syntax-mcode`, `--syntax-coord`, `--syntax-param`, `--syntax-comment`, a palette PER THEME (the dark palette was 1.5 : 1 on the light theme). Token classes (`.token-gcode`/`.tok-gcode`, etc.) and the CodeMirror highlight style (`gcodeCmLanguage.ts`) read the same variables; no opacity on comments. `.token-text` uses `var(--fg)`. The editor's CodeMirror base theme follows App's resolved `isDark` (injected; a Compartment reconfigures it live).
- **Shared modules** — `format.ts` (formatters incl. fmtPct/fmtQty/fmtMs/fmtUnit and the `NO_VALUE` placeholder — see `docs/ui-glossary.md`), `toolTypes.ts` (TOOL_TYPE_LABELS + toolTypeLabel()), `gcodeHighlight.ts` (highlightGcode). Never duplicate formatters or tool type labels in components.
- **Global utility classes** — `.text-muted` / `.text-ok` / `.text-warn` / `.text-danger` (a text in a role; never a scoped one-line copy — audit ONE_LINER), `.mono` (font-mono), `.emptyState` (centered muted text; audit EMPTYSTATE_COPY), `.statusDot` (8px indicator with `.probing`/`.tripped` states), `.sub` (section heading — no margin, parent flex gap handles spacing), `.sep` (horizontal divider). Always use these instead of scoped equivalents. For horizontal dividers, always use `<div class="sep">` — never manual `border-bottom` as section separators.
- `defaults.ts` section registry: `registerSection<T>(name, fallback, migrateFn)` + `loadSection`/`saveSection`. All sections are server-synced. Server is the single source of truth. Gateway sends `settings_init` on every WS connect. `sendBeacon` flushes pending saves on page exit. New sections must be added to `_VALID_SETTINGS_SECTIONS` in `gateway.py` and `SERVER_SECTIONS` in `main.ts`.
- localStorage is used in three intentional places only: (a) `ws/statusStore.ts` message history — intentionally per-tab so sessions don't cross-talk; (b) `main.ts` one-time migration of pre-server-sync keys to the server; (c) `defaults.ts:resetAllDefaults` removes those legacy keys (migration cleanup — safe to delete ~2027+). Do not introduce additional localStorage usage.
- Camera Z-up: `camera.up.set(0, 0, 1)`, except top view uses `(0, 1, 0)` to avoid gimbal lock
- Camera distance (`viewer/cameraFraming.ts`, WP5): the default frame puts the eye outside the travel-box rule and the MODEL sphere. Under the PARALLEL projection the distance changes nothing in the image, only what lies behind the eye — so every rendered frame keeps the parallel eye outside the whole scene's sphere (ground grid, machine, drawn path) about the target, pushed back along its line of sight (`orthoEyeDistance`, ThreeViewer `_orthoEyeOutsideScene`): the grid reaches up to 2.5 × the model's span and was cut at the near plane while orbiting (operator 2026-09-30). Perspective keeps the framing distance (moving it changes the view); the Ortho → Perspective switch derives its distance from the frustum height, never from the parallel eye's distance. `viewer.spec` orbits a bed/column model at 3° all round and requires the whole grid between the near and far planes
- ThreeViewer uses ResizeObserver (not window resize) to handle v-show tab switching
- **Dialog tiers** — three sizes, two internal structures:
  - `.dialog` (sm, centered confirm): `padding: var(--gap-panel)`, uses `.dialogTitle` + `.dialogBody` + `.dialogActions` directly
  - `.dialog.md` (mid, structured content): `padding: 0`, uses `.dialogHeader` + `.dialogContent` + `.dialogActions`
  - `.dialog.lg` (large panels, 70vw×70vh): `padding: 0`, uses `.dialogHeader` + `.dialogContent` (+ custom footer if needed)
  - `.dialog.lg.dialog-full` = 90% height variant
  - All tiers inherit `font-size: var(--fs-base)` from `.dialog` base — never set font-size on dialog body content
  - `.dialog.md.wide` = `--dialog-wide-w` (760 px) mid tier for two-column content (tool edit, library import); `.dialog.lg.wide` the same width on the large tier (Settings, the macro editor)
  - The md and lg tiers pad their `.dialogActions` (`--gap-controls` / `--gap-section`); the lg tier lacked it and the macro editor's Cancel and Save sat on its lower edge (operator 2026-10-03) — `dialogs.spec` holds every dialog's buttons ≥ 8 px from its edges
  - A per-dialog `min-width` (`box-class`, and the base `.dialog`'s 280 px) is capped by the room like every `max-width` — `min(340px, calc(100% - 2 * var(--gap-panel)))`: a min-width beats a max-width, and a 296 px content area (150 % portrait) cut both sides off
  - Every dialog is a `DialogFrame` (see its entry above): the machine flows (tool change, shutdown, compensation) are `kind="flow"` with `class="safetyDialog"` (`--z-modal-top`, global) and close by their own buttons only; forms ignore the backdrop; Escape never closes a dialog (it is E-Stop)
  - Wording (N43/N44/N49): a confirmation's title is the QUESTION with its object ("Delete T5?", "Reset probe calibration?"), a work dialog's title a noun ("Upload Conflict"); the confirming button repeats the verb (never "Confirm"/"OK"); every irreversible action says "This cannot be undone."; a discard ask offers "Keep editing". A destructive action is `danger` UNDER ITS OWN GATE — `dialogDangerSetup` (setup) or a `<Gate>` around a `dialogDanger` in the `#actions` slot; Cancel stays outside that Gate so the dialog always closes
- **z-index scale** — `--z-base` (0) / `--z-raised` (1, sticky cells, viewer overlays) / `--z-fade` (2) / `--z-pane-overlay` (5) / `--z-float` (10, PIP, sim bar) / `--z-banner` (11) / `--z-modal` (1000) / `--z-modal-top` (1010). Never a literal.
- **Viewer palette** (design wave D8c, UI-K08/UI-D05) — every colour the 3D viewer draws in a role comes from `viewer/viewerPalette.ts` `resolveViewerPalette`: the theme's `--viewer-feed/-rapid/-backplot/-limit/-collision/-bounds/-toolpath-bounds/-tool/-cutter` (literal hex in all five theme blocks), the operator's Custom colours over the seven user roles when `paletteMode === "custom"` (limit and collision stay the theme's). ThreeViewer's `refreshPalette` re-resolves on a theme switch and on every settings change and puts it on every live object (collision tint included) — never a colour of its own, never a cached token. ONE PALETTE IN EVERY THEME (operator 2026-10-01, from renders on the light ground and on the model — replacing the two schemes of 2026-09-29, which kept each role's hue at the theme's own lightness): every colour role draws the dark theme's luminous value in all five themes (`themeTokens.test.ts` "every colour role is the dark theme's"), only the neutral box / reach tones stay per theme (pure black and white in HC): path GREEN `#5cff5c`, backplot MAGENTA `#ff00ff`, rapid BLUE `#3d8bff` dashed, limit overlay ORANGE `#ff7a00` (the warn family everywhere; complementary where lines lie on each other: backplot on path, limit on rapid); the 3 : 1 background floor holds on the dark grounds — on the light ones the path lies on the model, which every theme's lines stand off (MODEL_MIN), and the operator judged the light ground from renders (`#5cff5c` on white is ~1.4 : 1 by the number); the collision `#c8102e` is a body — the toolpath box's overflow edges (outside the machine window) are the limit's orange, dashed. A path line holds ≥ 3 : 1 on `--bg` (4.5 in HC), stands off the grey-ladder model's path-carrying surfaces (`customContrast.MODEL_SURFACES`, the rendered stock / table tops, ≥ `MODEL_MIN` 1.8 : 1 in light and dark — the chosen palette's own floor) and keeps ≥ 0.25 OKLab FROM THE OTHER LINES (lines lie on and beside each other — the operator's primary criterion); colours were chosen with the operator from real renders on the XYZAC model. The two BOXES are TWO-TONE (`viewer/boxLines.ts`, operator 2026-09-29 — the cased edges of P2 looked strange, and a single neutral vanished wherever a grey model part had its lightness): a dark solid line (`--viewer-bounds` = `--viewer-toolpath-bounds` `#15181c`) with light dashes over it (`--viewer-bounds-alt` `#f0f2f4`; `#000` / `#fff` in HC), the same width (1 CSS px since operator 2026-09-30 — "weniger präsent"; the boxes are context under the 2 px path; no casing), like the selection border of a drawing program — one tone reads on any background and on every grey (`themeTokens.test.ts` sweeps all 256), the same pair in every theme. ONE PATTERN FOR EVERY BOUND (package 4, operator 2026-10-01: the box dashes "ändern beim Zoomen die Länge der Elemente", lines here and dots there; plan `docs/reviews/viewer-marks.plan.md` Fassungen 2–3.1, Codex R62–R65 — it REPLACES R44 VP-I10's screen-px dash, which crawled along an edge as its projected length changed): the machine box, the toolpath box (its orange overflow edges too) and both reach outlines draw GEOMETRY-ANCHORED cells (`boxLines.geoDash`, a `GEO_DASH` define patching LineMaterial's own source — every anchor once or it throws). A UNIT (a box edge, a reach chain) is cut into N = 2^k equal cells, alternating dark / light, phased at the unit's FIXED first end (a box edge's smaller coordinate; a reach chain's lexicographically smallest end, a ring's smallest vertex towards its smaller neighbour, a chain with BOTH ends at one junction the way whose walk is the smaller vertex by vertex, never by storage index (Codex R66 VP-I27) — `viewer/geoDash.ts buildChains`, independent of storage order and direction, its own chain distances, never `computeLineDistances`' storage order). The shader takes the world-linear unit parameter t per instance (`instanceGeoT`, perspective-correct; where LineMaterial trims a segment reaching behind the eye, the trim point gets its own t — the cells stay at the real world end) and the unit's N (`instanceGeoCells`). N is STATE per unit (`GeoDashState`, one per drawn bound, updated per frame in ThreeViewer's loop and `toolpath.updateBoxPattern`; the cells attribute uploads only when an N changed): from the VISIBLE parameter interval (Liang–Barsky against the view volume in clip space) the mean visible cell L_visible / (N · Δt) stays 6 … 12 CSS px nominal, with hysteresis (×1.25: kept from 4.8 to 15 px, so 95.99 ↔ 96.01 px never pendulums), N ≥ 2 (both tones on every visible unit — R45 VP-I12's lost tone stays closed) and ≤ 2^14 (a named limit, said once in the console per pattern when it binds); a chain with several visible pieces takes the largest L / Δt. Promise (Fassung 3.1): a visible piece LONGER than 15 CSS px below the cap holds an inner cell boundary — both tones have positive parameter length there; NO pixel or legibility guarantee (perspective squeezes single cells, a chain's other pieces may be over-refined). The pins keep a dash in CSS px (`screenDash` — a marker in CSS px has no geometry to anchor to), the rapid its world dash. The machine box is built at its REAL size (`setSize` — new units, new state), never a unit cube under a non-uniform scale. With ONE pattern the dash length tells the boxes apart no more: the pair table's box cues are `["ticks", "label"]` (plan A''/Fassung 3, VP62-02). The toolpath box carries DIMENSION END MARKS (`boxLines.makeBoxTicks`, its child, posed per frame by `toolpath.updateBoxPattern`, no allocation, sized at each corner's DEPTH along the view axis — `worldPerPixelAt`, the one CSS-px scale the pins and type labels use too: the distance made them grow towards the edge of a perspective view, 10.6–11.9 px for 10, Codex R66 VP-I28; the frame loop renews the camera's matrices right after controls / tween / the parallel eye and BEFORE anything is sized or culled from them — a view preset's tween writes position and quaternion and skips controls.update(), so the render alone renewed them, after the sizing: 8.5–11.7 px in the drawn frames, R67): at both ends of every edge a bar ACROSS the edge on screen, `TICK_ARM_PX` (5) each side, its own contrast carrier — a light underlay `TICK_UNDER_PX` (4) under a dark core `TICK_CORE_PX` (2), the underlay overhanging 1 px across and, through LineMaterial's round screen-space caps, at each end; 2 / 4 and not the plan's 1 / 3: at DPR 1 a 1 px core on a pixel boundary is two half-covered pixels — the model's mid grey (2.42 : 1 measured). Each box carries a TYPE LABEL ("Machine bounds" at the machine box's (max, max, max) corner, "Program bounds" at the toolpath box's (min, min, max) — apart where the boxes coincide), CSS-px sized like a pin's label, following its box's layer AND its box's "On top" (operator 2026-10-02: a label is drawn over the machine exactly when its box is — `setLayerOnTop`, ON_TOP_ORDER.marker; otherwise a model part hides it like the box); label variant (ii) of the plan, the operator's choice of 2026-10-02 against (i) — the size labels alone (`__viewerDiag.setBoxTypeLabelsShown` hides them for the variant (i) render; the pattern specs hide them, the labels are their own guard). The legend's Toolpath Bounds sample carries the end marks (`.legendLine.ticks`). A FLAT program's box (no Z extent) draws its overflow too — `rebuildOverflowEdges` follows the box's own rule (it refused any zero extent, and the part beyond the window vanished). Guards: `geoDash.test` (choice, hysteresis, the 15 px promise as a property, clipping, chains), `boxLines.test` (Codex R63's near-plane edge → N = 512; a two-piece chain), `scenes.viewer.spec` (every light / dark transition of every measurable projected edge at a world cell boundary k / N — parallel and perspective, three directions, before and after a zoom within a step and across one; the R63 geometry in the viewer showing both tones in light and HC light — red with the phase shifted half a cell and with N taken without Δt), `reach.viewer.spec` (both tones on the part reach's short segments), `boxLines.test` (each end mark across its edge, 10 px, centred, parallel and perspective) and `scenes.viewer.spec` (every end-mark arm stands off its ground at 3 : 1 in light, dark, hc-light and hc-dark, over the background and over the model — the underlay carrying it on a dark theme, the core on a light one; the type labels apart, drawn, one per box after a rebuild, and seen from below through the base each label shows exactly while its own box is on top (red always on top and with the switches swapped); the plan's NAMED chain case — one reach chain dipping into the view twice, injected through `__viewerDiag.setReachSoup` — shows both tones in each visible piece, red with N taken without Δt; every drawn frame of a view animation keeps the end marks at 10 ± 0.05 px and the pins and labels at their CSS-px scale — read through `__viewerDiag.startFrameProbe` / `takeFrameProbe`, which record what each render DREW, never re-posing before reading as `getBoxTicks` does; red without the frame loop's camera update. The box-edge spec reads along an edge the darkest (light scene) / lightest (dark scene) pixel ACROSS it at five canvas sizes: a 1 px line centred on a pixel boundary is two half-covered pixels, and one column read the line or the scene by sub-pixel luck, R67). `__viewerDiag.getBoundsPattern(role)` / `getBoxTicks` / `getBoxTypeLabels` / `projectPoints` / `canvasRect` / `zoomBy`. The REACH outlines (Machine / Part Reach) are the same two tones (`--viewer-reach` = the dark tone), 1 px — quieter than the boxes by width alone; their mid grey at 60 % vanished on the grey model. Drawing order: the path (10) under the backplot (11) under the LIMIT OVERLAY (12, `LIMIT_OVERLAY_RENDER_ORDER`) — a backplot lying on a violation never hides the finding (P5, Codex R30). A RAPIDS layer (Settings → Layers, P3) hides the rapid LINES while their limit overlay follows the toolpath layer alone (a finding stays visible on a hidden rapid); a finding NAVIGATED to on a hidden rapid (or with the toolpath off) shows its OWN MOVE — the run of track segments around the jumped-to segment (`scrubTrack.lineRunAround`: the occurrence, not a line number a sub or loop repeats), in base-track indices — never the whole hidden layer (Codex R31 VP-I03): `toolpathController.setReveal` draws the pairs of the hidden streams whose source track segment (`feedSrc` / `rapidSrc`, the part-frame worker ships both) lies in the run, in the stream's own material, with the toolpath off also the run's limit mark; the stored layers draw as stored. It is named — a PINNED `.hudWarn` line "Rapids shown for this finding — hidden in Layers", shown with the HUD off and in the folded card, never counted among the warnings (VP-I02; `viewer/pathReveal.ts`, a LOCAL state: the stored layer choice is never rewritten) — until a manual scrub, the simulation's end, a program change or a CHANGED toolpath / Rapids choice from any client (a settings refresh re-applying the same value keeps it, VP-I01). A line's timeline extent starts where its first move STARTS (`scrubTrack.lineSpanCum`): a track point carries the line of the move ending there, so `lineCumOf` (the line's first point) is where that move ENDS — limit targets, bands and tool-change marks read the span (a limit jump landed in the next line's move). Limit targets and bands are found on the BASE track and read on the displayed one (`lineFirstMoveCum(base, line, shown)` / `lineSpanCum`, the displayed track's own cums): the entry move ENDS at the program's first point and carries its line, so by line number it was the first line's "move" (Codex R33 VP-I05); tool-change marks read the displayed track (a change before the first motion runs before the entry move). A JUMP samples INSIDE the finding's extent (`viewer/findingNav.ts` `sampleCum`: a hair past its start, never past its middle — a limit's first move with an extent, `lineFirstMoveCum`; a clash's contact interval), prev/next skip the finding just shown by its KEY while the timeline stands there and otherwise compare where a jump would land — no fixed window (a 0.1 ms move and a finding 5 ms after the shown one were unreachable on the seconds axis), and the first jump resolves the CHOSEN finding on the track it displays after building the entry move (`mapAcrossEntry`; Codex R32 VP-I05/I06). A collision's key names its ORIGIN: `mergeEntryResult` marks the entry move's own records `entry` (key `E…`, readout "→ entry") — their line is the program's first line, so line + pair alone aliased a program contact — and a program key (`C…`) stays the same when the entry result arrives, so a chosen program contact survives it (VP-I07). The shown finding's identity ends FOR GOOD once the timeline leaves its position (a sync watcher on the position; coming back by hand is a position, not the finding), on manual input, at play start and on another displayed track; a jump sets it after the entry it caused (VP-I08). The legend sits AT THE LAYER ROWS (a line sample beside each drawing layer, dashed or two-tone like the line) plus a ▲ limit and a × collision row — the glyphs of the timeline and the code panel. The mode is stored for the whole palette; a palette stored before it is Custom (`viewerSection.ts`, no heuristics); Reset → Automatic. In Custom, Settings shows the custom colours' CONTRAST, never corrects them (plan K3, Codex R25 OP-I05; `viewer/customContrast.ts`, the rules above): each custom line on the background (3 : 1, HC 4.5) and on the machine (`MODEL_SURFACES`, `MODEL_MIN`), a two-tone box where either tone reads; "low" in words. Its ORIGIN is said only where known (viewer contrast plan, V6): a palette stored WITHOUT a mode is `paletteOrigin: "legacy"` (kept through every later save until the operator chooses) and Settings says "Colors from an earlier version" with "Use automatic colors"; a mode without an origin (saved under D8c) gets the offer only, claiming nothing; an explicit choice (a radio, a colour picker) is `"operator"` and quiet. Drawn materials carry `userData.role` (`__viewerDiag.getPalette`). The CURRENT LINE IS NOT DRAWN IN 3D (operator 2026-09-28: the 3 px selection on its halo, which followed `motion_line` / the scrub line, competed with every other line — the code panel names the line, the tool shows where it is; no `selection` role, no halo; `docs/reviews/viewer-palette-fest.ideen.md`); `e2e/scenes.viewer.spec.ts` renders the palette on a model in four themes (structure asserted, images attached for the eye, no pixel references). The TILTED WORK PLANE's colour, its label on the object ("Plane · active / defined / head moved / datum moved / simulated"), its OPAQUE dashed-when-stale edge and its normal arrow (the head's claim only) come from ONE decision, `viewer/planeView.ts`; the HUD's plane word reads the same result (`planeViewState`), and the HUD mode line says each part once (`hudModeLine`); roles `--viewer-plane-active/-defined/-stale`; `__viewerDiag.getPlane` / `simulatePlane` (a seam past the scrub chain). PAIR TABLE (`viewer/palettePairs.ts`, one colour arithmetic in `viewer/colourMath.ts`): two path LINES keep ≥ 0.25 OKLab (hc-dark alone 0.24 — its band, named; `lineMinFor`); colour-vision deficiency is no criterion (operator 2026-09-29 — the simulation is gone); a line against the collision body and two objects (boxes, plane states) keep ≥ 0.12 plus their cue; form supplements colour, never replaces it; 0.25 is the search and regression value, not a proof of legibility; `themeTokens.test.ts` checks every theme block against it, the path roles' families across themes, and that light, dark and auto-dark carry the same values for every other role. The Custom hint lists the line pairs too (`customPairRows`: "close" in words). EVERY PATH LINE IS 2 CSS px (operator decision 3, 2026-09-29, part B — Codex R39 plan): feed, rapid, limit overlay, the finding's reveal and the toolpath box's overflow edges are `LineSegments2` at `PATH_PX` (`viewer/fatPaths.ts`: `packPairs` packs each chunk × LOD level's pairs into its own instance buffer, the rapid's dash distances taken from the stream's own `dist`, never re-summed; degenerate pairs dropped), in the same chunk / LOD / frame structure — the shared position attribute stays the source for scrub, sweep and navigation; `updateCulling` widens each chunk's sphere by the line's reach (a stroke still reaching into the view is not culled at the frame edge); `depthWrite: false` on every `LineMaterial`; the backplot too (`BACKPLOT_WIDTH_PX = PATH_PX`, a ring of segments, one update range per push). Width is therefore no cue: the pair table relies on colour and form (dash, two-tone). `toolpath.pathMemory()` / `__viewerDiag.getPathMemory` is the VP39-01 ledger (Codex R47/R48 VP-I17): CPU bytes HELD by owner at each ArrayBuffer's CAPACITY (a small view keeps its whole buffer), incl. the fat geometries' own quad mesh, the toolpath box with its overflow edges (`box`, released with the path) and the PAYLOAD kept for rebuilds; GPU bytes actually uploaded; `allocated` (cumulative), `peak` (this path's build: held at its start + allocated in it, an upper bound); `eager` {estimate, packed} (apply() PREPARES every set — binned levels, chunk boxes, the overlays' flagged pairs — estimates the fat pack from the pair counts, THEN packs; the estimate bounds the pack, equal but for dropped degenerate pairs); `generation` (bumped per build); `pairs` {source, lod, drawn — visible objects only}. Every allocation of a build is counted WHERE IT HAPPENS, scratch included: `viewer/allocMeter.ts` is the one count (lineChunks, fatPaths, boxLines and the controller allocate through it; three's own arrays are counted right after three creates them — `countedGeometry`; outputs are sized by a counting pass, never cut from a full-size scratch; the box edges are written out, no BoxGeometry/EdgesGeometry) — `fatPaths.test.ts` spies the typed-array constructors and requires peak = held-at-start + exactly what they saw (fat and GL; table, room and legacy paths; rebuild; reveal), `allocMeter.test.ts` fails on a raw typed-array constructor in those files. Named limit: the toolpath box's troika size labels build their glyph buffers asynchronously, outside the ledger. The Mac A/B measurement of the previous GL line (A) against the 2 CSS px line (B) PASSED on 2026-10-01 (`docs/reviews/viewer-palette-fest.ab-mac.txt`: every steady phase p95 19 ms in both, builds and memory inside the limits fixed with Codex R47–R49). The Debug switch, the run (`abRun` / `abDriver` / `abHistogram` / `abRunBus`), `viewerPerf`'s sample tap, `scripts/viewer_ab_report.py` with its gate step and `__APP_COMMIT__` are gone. The controller keeps `lineMode: "gl"` as a TEST SEAM only — its selection tests read the GL index ranges and `fatPaths.test.ts` pins that the fat lines draw exactly those pairs; nothing in the product selects it. Every role LINE draws opaque (a role's contrast is its drawn colour; the toolpath box and overflow edges were 0.9 / 0.8). `__viewerDiag.getRoleMaterials` (kind = cue, width, opacity) and `projectRole` (a role's longest segment on screen) let the scenes spec MEASURE the image: the drawn width across each line as the sum of pixel coverage (DPR 1 and 2).
- **Viewer overlays** (design wave D9) — top-left the DRO card, which FITS its pane (`fitHud` in ThreeViewer: steps the scale down from the operator's HUD scale — the ceiling — then folds the Machine column, the F / S rows, the tool line by class, then folds the findings card to ONE summary line with a "Show viewer warnings" toggle and the column head ("Work · G54" — the summary names the fixture), last `xs` (0.7) and `xxs` (0.6 — values at the UI's 12 px), never settings; every candidate is measured WHOLE — both cards at its scale, the real bottom column with the scrub bar — so the pick depends on pane and content only and cannot swing (review round 6, UI-DI12/13); never clipped or transform-scaled; `data-hud-fit` says `overflow` only where even the smallest form cannot fit — landscape from 150 %); the DRO card sits in the top-left COLUMN `.viewerTop` under the simulation banner, which keeps its words whole (wraps; in a pane < 440 px it reads "SIMULATION" + a "?") and whose height is in the fit's budget (review round 7, UI-DI16); top-right the ViewCube + quick grid (`--viewcube-size` 96 px in a pane < 440 px, `.narrowViewer`); bottom edge ONE column (`.viewerBottom`): the findings card (`.hudNotes`: mode chip + every warning line, the failed-model-part line too — one warning look, N102) above the scrub bar. A new viewer warning is a `.hudWarn` line in `.hudNotes`, never a chip of its own and never a line in the DRO card, and it joins `hudWarnCount` — the ONE list that counts the folded summary AND decides whether the card renders (`hasHudNotes` = mode chip or a counted line; a second list left the mid-run tool-table line out and the card never showed on a machine without a mode chip, Codex R42). An OPENED detail view (the warnings card, the scrub bar's More — ONE at a time, each folds the other) grows the bottom column over the DRO — and, the scrub bar being full-width, over the ViewCube column — by the operator's choice, but `fitHud` CAPS the column (`--viewer-bottom-max`: the viewer minus its margins and the simulation banner): never over the banner, never out of the viewer (review round 8, UI-DI16/17). The heads stay pinned — the warnings summary with its toggle, the scrub bar's row 1 with More: the way back — and the bodies scroll (`.hudNotesBody`, the findings row; `.scroll-thin`) — a body that scrolls takes the pointer (opened, or cut by the cap: fitHud's `.scrolls`), so a touch scrolls it. A body scrolls ONLY past a cut line: a "?"'s invisible hit area reaches past its glyph, so the warnings body's padding holds that reach and a negative margin gives it back (`--help-reach`) — as overflow it put a scrollbar under the off-datum chip, made the card 10 px taller and the uncut body take the pointer (operator's live look 2026-09-27; `layout.spec`'s column check). `fitHud` measures both views FOLDED, so opening one never changes the DRO's form; everything folded never overlaps. The SHARED viewer geometry — the narrow flag (the banner's short form, the smaller cube) and the cap — is computed on every resize whether or not the DRO card shows (Settings → Layers → HUD off, review round 9); only the DRO's size pick (`fitDro`) needs the card. `layout.spec` sweeps every overlay inside the viewer and apart, and the scrub bar's insides (slider width, rows within the bar, every rendered control and "?" hit-tested, button words whole) folded, opened and simulating. A button's glyph content needs an aria-label (CSS audit `GLYPH_BUTTON`); a window icon that is not a close is `windowToggle`.
- **On top per layer** (operator 2026-09-30) — Settings → 3D Viewer → Layers is a table (Layer | line sample | On top; the column heads are the first BODY row — `.dataTable`'s sticky head covers the top row inside the scrolling Settings page, like KeyboardTab's): the lines and markers can be drawn OVER the machine, one switch each (`ON_TOP_LAYERS`: toolpath, rapids, backplot, work zero, work plane, tool setter, tool change, both boxes, both reach outlines — never a body), stored as `viewer.onTop` (defaults `ON_TOP_FALLBACK`: the markers on, everything else off; the old single "Always on Top" `pathOnTop` becomes the Toolpath/Rapids/Backplot rows in `mergeViewerSection`). ThreeViewer's `setLayerOnTop` is the ONE mapping from a layer to what it draws; on top means depth test off AND a draw after the machine (`viewer/onTop.ts` `applyOnTop`: three sorts by renderOrder first — the order ladder boxes 8 / reach 6 / work plane 7 under the path's 10–12, markers 20 over it; each object keeps its built values to return to); the toolpath controller keeps the path's per stream (`setOnTop(feed|rapid)`, its limit overlay and a finding's section follow the stream) and the toolpath box's (`setBoxOnTop`) across programs; the rest is re-applied after every build (buildFromInit, the reach outlines).
- **Viewer overlay chrome** — `.overlay-card` (HUD, sim bar, findings card, camera PiP; 92 % panel + blur — its text keeps 4.5 : 1 with dark geometry behind it, contrast.spec composites both) and `.overlay-card.warn` (sim banner, STL-failed chip): one chrome, components add layout only. Its EDGE holds 3 : 1 against the scene behind (the page background and the lit table): `--control-edge` per theme, the warn variant `--warn-text` (the `--warn` fill held 2 : 1 on white) — viewer contrast plan V5, the operator's "outline". `--viewcube-size` (140px) is the ViewCube edge the quick grid offsets by.
- **Utilities** — `.w-full` (width: 100%) instead of an inline `style="width: 100%"`. `.saveStatus` (+ `.saved`/`.error`/`.blocked`) is the one save-status readout (Settings header). `.settingDesc` is the one section-description line (global).
- **Feedback channels** (design wave D1, UI-K18) — ONE channel per trigger: what a touch triggers answers AT THE CONTROL (btnHint: hold hint, busy, a dimmed control's reason — the reason is never logged); the result of an operation shows INLINE where it began (`.statusNote.error` / `.warn` / `.ok` — role="alert" on error/warn, an optional action on the right: `retry` for a RETRYABLE read only, a close X for a persistent note; it replaced `.errorBanner`/`.warnBanner`/`.importBanner`, `.noteWarn` stays an inline text span); machine and system STATE is the banner (`bannerLine` in App.vue: two tiers — `bannerError` for safety, machine and connection, `bannerWarn` for program, preview and configuration — the state plus one recovery verb, the why in `detail`, which a tap on the banner shows on top of the message center; buttons from the `banner*` family); the message center is the PROTOCOL (searchable, one filter by type and origin — `MessagesDialog.vue`). `pushMessage(kind, text, mode)` (origin "webui"; the error channel's entries are "linuxcnc"): `notify` (counted, takes over the status line for 5 s — every machine message, e.g. a program's `(MSG, …)`, arrives this way), `status` (status line, uncounted: run-from-line progress), `log` (quiet: uncounted, never on the status line — a local confirmation the operator has moved on from). A failure is never DISPLAY severity. `openMessages()`/`closeMessages()` (useDialogState) are the only ways in and out; every close marks read. Help: a section's description is a `.settingDesc` line, a field's help a `HelpIcon` with `label`, a `title` only a short name or a hover complement — the CSS audit's `LONG_TITLE` (> 90 chars) fails the gate on an explanation hidden in a title. A REASON (why a control is dimmed; also a denied command's reply) is "why — what to do" in at most 60 characters — a MODE restriction says where the action works, positively ("Machine frame and Plane only", "Rotary touch-off: G54 only"; "Not in TCP — …" read as a statement about the current mode, operator 2026-09-25): `command_policy.REASON_MAX_CHARS` (swept over random machine states by `TestReasonLength`), `permissions.REASON_MAX_CHARS` for `CLIENT_REASONS`, the audit's `LONG_REASON` for `reason` literals and `*_REASON`/`*_TITLE` constants.
- **Axis fallback** — `DEFAULT_AXES` in `useAxes.ts` is the only pre-`viewer_init` axis set; never a local `["X","Y","Z"]`.
- **Selects that live through status** (operator 2026-10-04, Firefox) — Vue re-assigns a bound `<option value>` on EVERY render of a component whose slot is dynamic, and Firefox rebuilds an OPEN dropdown on any change inside the select: on macOS the choice was lost, on Linux the list flickered back. A select whose component re-renders with status packets or the gamepad's poll keeps its options untouched — `v-memo` on the bound options (the G-code reference's group) or, where the select sits in a `v-for`, on that loop's ROW (the gamepad mapping, `[binding, label]` — a `v-memo` nested inside a `v-for` is not honoured, `vue/valid-v-memo`) — and a component is never handed a NEW array per packet when nothing changed (the reference's active codes come from the two code strings). `select-writes.spec` watches every select of the app in the state that shows it (Tools filter, tool editor, import mode, Macros filter, reference, side panel and probing procedure at 150 % portrait, jog step on TWP, gamepad mapping with a pad polled) through 20 packets of position, G0 ↔ G1, tool and feed: no mutation inside any of them.
- **Number fields** — `MachineInput type="number"` opens the keypad with the field's contract: `min`/`max` attrs and the explicit `integer` prop (never `step`), plus `label`/`context` for the readout. Out-of-range values are refused, never clamped. A press on a number field takes NO focus and selects nothing (primary `pointerdown` default-prevented; the click still opens the keypad, Tab + Enter/Space still work): the keypad strip holds the physical keyboard, and a second click, a double click or a drag to "select the value" once moved the focus into the read-only field — every digit typed after it went nowhere (operator 2026-09-29). A press on the field whose session is open (a label tap, Enter after Tab back) hands the focus back to the keypad (`refocusKeypad`).
- **Macro files** (package 5 stage B, plan `docs/reviews/makros.plan.md`) — a macro is `<name>.ngc` in `[DISPLAY] WEBUI_MACRO_DIR` (resolved like PROGRAM_PREFIX; no default — unset = no macro files, named), a folder that must be on `[RS274NGC] SUBROUTINE_PATH` (the examples put it LAST: a macro can never shadow a suite routine such as `m600.ngc`) and must not overlap PROGRAM_PREFIX. `lcnc-gateway/macro_files.py` (pure) is the ONE parser: names `[a-z0-9_]{1,63}` (the interpreter lower-cases every o-word, NO_DOWNCASE_OWORD notwithstanding), one `o<name> sub … endsub` per file, a header of whole-line comments before `sub` — `MACRO <title>`, `UNITS mm|inch` (required with length/feed parameters), `FRAME machine` (identity kins required, a G53 macro or one calling a G53 helper; a G53 without it is only a warning), `PARAM <n> <key> "<Label>" <unit> <default> [min=] [max=] [integer]` (units are kinds: length, feed, angle, rpm, time, count, none); any other all-caps first word is an error, other comments are description; the body is text-checked (no M2/M30, no `%` before endsub) and, with length/feed/rpm parameters, must ENTER with `M73` alone and then a line setting G21/G20, G94, G97 as needed (Codex VP69-04 — a value means what the dialog shows whatever mode was active; M73 restores at endsub, not on abort, and not G0/G1). An error lists the macro, not runnable. `macro_files.resolve_oword` mirrors find_ngc_file (milltask's cwd — read from /proc and required to be the INI folder — then PROGRAM_PREFIX, then SUBROUTINE_PATH; WIZARD_ROOT comes after the macro folder and is not walked): a macro runs only when the interpreter's first hit IS its file, else "Shadowed by <path>". Routes (token): `GET /macros` (metadata, sha256 `revision`, runnable/reason, folder problems), `GET /macro` (`X-Macro-Revision`), `PUT /macro?base=<rev>|new` (409 when the disk changed / the name exists — every refusal's body is `{error: "refused", kind, reason, …}` per `scripts/test_fixtures/macro_refusals.json` (`busy` / `conflict` / `exists` / `taken` / `outside`; a disk conflict carries `name` and the `revision` read under the same lock, null = gone — Codex R70 VP-I31), which `test_macros_gateway.RefusalShape` holds the gateway to and `e2e/macroFolder.ts` answers from; with `rename_from=<old>&rename_base=<rev>` and `base=new` a RENAME in one step under `_source_lock`: the old file still that revision, the new name free, the new file published and the old removed — `_atomic_stream_write(after_publish=…)`, a failed removal takes the new one back), `POST /macro-upload[?replace=<rev>]` (a replacing import is bound to the revision the operator confirmed, VP69-03), `DELETE /macro?base=`. WS `run_macro {name, args, revision}` (gate probe): the gateway builds `o<name> call [v] …` itself (6 decimals, every declared parameter, range checked on the ROUNDED value, ≤ 254 characters), refuses another revision ("Macro changed — hold again"), and before the call FORCES `SET_MODE(MDI)` even in MDI — emcTaskSetMode → emcTaskAbort → Interp::reset empties the interpreter's subroutine offset cache, which an MDI remap leaves filled (Codex VP69-01); the one case task ignores the switch (`jogging_is_active()` = HAL `motion.jog-is-active`, a reader extra pin) is refused up front, and the "Ignoring task mode change while jogging" message is a tripwire read after two poller cycles. ONE admission for writers and starts (VP69-02): `_cmd_blocking` registers a START CLAIM under `_source_lock` for every CMD.mdi / CMD.auto(run/step/resume) (the sending thread stamps its serial — a cancelled handler cannot lose it; a source test forbids any CMD.mdi/auto call outside `_cmd_blocking`), only the status poller releases it, on a POSITIVE proof from a status read after the send, every value known (Codex R70 VP-I30 — "not RCS_EXEC" proved nothing: task reports RCS_ERROR for a later command it refused while the MDI still waits in its queue): RCS_DONE at an echo ≥ its serial with the interpreter IDLE (task's DONE needs its MDI queue, interp list and command empty), or its OWN error (echo = its serial) with no MDI queued, `exec_state` DONE and IDLE over two polls ≥ 20 ms apart — an AUTO run holds it for the whole run, an abort's RCS_DONE releases it; the serial is the command BUFFER's counter, shared by every writer of task's channel (halui, a second GUI — Codex R71, measured natively), so an echo names exactly one command; a macro write publishes only through `_atomic_stream_write(gate=…)`, whose gate runs under `_source_lock` IMMEDIATELY before the atomic publish (no claim, IDLE in a fresh poll, base revision unchanged, no program of that name in PROGRAM_PREFIX), and the publish — with a rename's removal and its rollback — is ONE commit held to its END under the lock (`_thread_to_end`, the `_var_file_thread` shape: a cancelled request, cancelled twice too, keeps the lock until the thread finished — Codex R70 VP-I29: a cancel freed the lock while `os.replace` still ran, a start got in, a second client's acknowledged save was removed); DELETE likewise. ONE admission of the FILE (Codex R70 VP-I33, `_macro_bytes`): the name's file resolved must be a regular file inside the macro folder (a link within it is followed; one leading out or to nothing is refused 403 — the list skips it, a read, every writer and `run_macro` refuse it), read through a descriptor that follows no further link, opened without waiting (O_NONBLOCK) and type-checked before any read — a named pipe or a directory `*.ngc` is refused at once (Codex R71 VP-I33 rest: a FIFO waited in open(), a directory raised from fdopen); `/upload` and `/save` keep working during runs and only refuse the exact name `<macro>.ngc` in PROGRAM_PREFIX. Lock order `_cmd_lock` → `_source_lock`; writers never take `_cmd_lock`; no timer releases a claim. The folder's change (own writes, and a 1 Hz (name, mtime, size) signature in the poller for an outside editor) reaches clients as `macros_changed`. Tests: `test_macro_files.py` (grammar, body, entry rule, call line, lookup, every example), `test_macros_gateway.py` (claims, routes, admission, run_macro, cancelled writes with the file operation held, refusal shapes, the folder admission; 23 mutations red — 11 of R69, 10 of R70, 2 of R71), `test_example_install.py`.
- **INI lines LinuxCNC reads** — LinuxCNC's INI reader keeps 255 bytes of a line and cuts the rest silently (measured with `linuxcnc.ini`: 255 whole, 256 → 255), the interpreter takes the first 10 SUBROUTINE_PATH entries. The installed TWP INI's absolute SUBROUTINE_PATH (264 bytes) lost its last folder (`…/surfacemap` → `…/s`) this way. `install_examples.ini_line_problems` refuses such an install; `config_sync_check.py` reports `[TRUNCATED]`. Its drift ignores a line that only MOVED inside its section — but only while LinuxCNC reads the same (Codex R70 VP-I34, measured with `linuxcnc.ini`): the key's values keep their order in the section (`find` is first-wins — two swapped MAX_VELOCITY lines read 20 instead of 10; `findall` reads the list), except REMAP (`SET_INI_KEYS`: rs274ngc keys its table by the code, a second line for one code is an error — with every code once the lines are a set; the installer puts the suite's at the section's start); a section that occurs twice is read in its FIRST block only (a key in the second `[A]` reads nothing), so its lines are compared in order, like ORDERED_INI_KEYS. The examples' SUBROUTINE_PATH is RELATIVE to the configuration folder (milltask's working directory — `/usr/bin/linuxcnc` cds there) through the `subroutines` / `remap_subs` / `twp` links.
- **Program upload** — `POST /upload` never replaces an existing program unless `overwrite=1` (409 → Cancel / Rename / Replace dialog); the no-replace publish is an `os.link`, and a filesystem that cannot link REFUSES the upload (no copy fallback — a partial file must never appear under the final name).
- **Editor session** — the G-code editor's buffer is bound to the file it was opened on (`{id, path, original}`): an external program change raises a conflict banner, Save writes only the session's file, Discard asks when dirty.
- Gateway `tool_change` handler is fire-and-forget (no `CMD.wait_complete()` — blocks heartbeat loop)
- Toolsetter settings live in Probing's Toolsetter procedure (`ToolsetterSettings.vue` inside ProbePanel); tool ACTIONS live in App.vue (tool-change dialog, Measure/Unload) and ToolTablePanel, not in the read-only ToolStrip
- **Toolsetter set up** (review R15 B1) — its values reach the machine only when SET UP: every `TOOLSETTER_REQUIRED` field (positions, feeds, distances) in the section the SERVER confirmed, raw, each valid by its `probeFields` rule or option values (`toolsetterSetup.ts`, pure; `defaults.confirmedSection` — this tab's optimistic cache is no confirmation). `TOOLSETTER_FALLBACK` is a form's starting point, never a machine configuration (a config without a section pushed its zeros into the var file). Every M600 the WebUI starts — Measure Current, Unload and a tool-table load in M600 mode, the run-from-line pre-measurement — goes through App's `toolsetterMdi` / `fireWithVars`: refused with the reason at the control unless set up, then ONE `mdi` with the values in `vars` — the gateway sets them in the interpreter (the var file is read only at LinuxCNC's start) and sends the line only once every chunk ended RCS_DONE, and an abort/estop from ANY client cancels that handler (`_preempt_inflight`); nothing is sent after the reply (review R16 XZ-06). Probe operations send their vars the same way. Run from line sends ONE `auto_run` at the confirmation, carrying the program the dialog showed (`file` + the published `version` of the displayed text + that text's fingerprint `source` — the sha256 GET /gcode names in `X-Program-Source` for exactly the bytes it served; the gateway refuses another), and for a pre-measurement the toolsetter values (`probe_vars`, required with `pre_tool`). The gateway accepts it only when `source` is the text the published version was parsed from (`BulkPipeline.published_source`, fingerprinted before the worker and checked after it, none when the file changed meanwhile) AND the file on disk is still that text — before any value is taken over (R17 XZ-07: the version moves only after a re-parse, and the binding used to be stamped from the file found at arrival). Its background sequence re-checks the loaded path and the text's fingerprint before every step that moves (phase `program_changed`) — never the version, which the pre-measurement's TLO re-parse moves on; load/unload are refused while it runs, and abort/estop cancel it (phase `aborted`). The latch is the TASK (`_rfl_busy()`: the sequence or its `#3116` clear still running), its end reported by a done callback of the task that owns the slot — a boolean set before the task stayed set when the task was cancelled before its first step or a second abort cut the clear in its `finally` (R17 XZ-10); the clear is its own task that waits up to 10 s for an interpreter idle that holds 300 ms (the abort processed; never an MDI with the machine off), then gives its MDI its own 10 s, and is told to the operator when it fails. A stale flag skips a measurement silently (live R17 check: 2.2 s, no probe trip), and the gateway cannot read it, so it tracks what it SENT (`_skip_flag_unknown`, R18 XZ-11): true at boot (the var file carries `#3116` across a LinuxCNC restart), from the moment the sequence MAY send `#3116=<tool>` (armed before the send — a cancelled send still completes), after the sequence's own start (the skim consumes it; an abort can cut that short) and after an MDI line naming it; false only once a `#3116=0` it sent was taken. Every START from idle — `cycle_start`, the first `auto_step`, `auto_run`, `mdi`, `tool_change` (an M6 remap may run the routine) — passes `_start_guard`: refused while run from line starts or ends ("Run from line is ending — wait"), and a flag that may be set is cleared first IN THE SAME COMMAND (a refused mode switch names itself, a refused clear starts nothing); a step in a paused program clears nothing. Routines started with values carry the clear themselves (`_skip_flag_cleared`); only the sequence's own program may skip, right after it armed the flag, under the latch (R16–R18 XZ-07/10/11). The form shows an unset required field EMPTY, saves only the edited field onto what was saved, names what is missing; Reset saves an EMPTY section.
- **Sim tool setter** (operator 2026-09-29) — the sim configs trip the probe where a real tool setter would: `hallib/sim_toolsetter.hal` (sourced by every `core_sim_*.hal` in place of `net probe-in => motion.probe-input`) routes the probe through the realtime component `examples/sim_config/sim_toolsetter/sim_toolsetter.comp` (servo thread: control point = the JOINT positions `joint.N.pos-fb` — never `motor-pos-*`, which carry the home / motor offset and made every measurement drift by it, Codex R44 ST-I02 — in the plate's ±25 mm X/Y window AND Z − the spindle tool's TABLE length ≤ the plate Z; OR the WebUI's manual trip `probe-in`). The PLATE is PHYSICAL, a fixed `setp sim-toolsetter.0.plate-x/-y/-z` per profile in its `core_sim_N.hal` (3-axis 10/10/−180, XYZAC 150/0/−300, TWP 1200/1000/−1000 = each profile's shipped `#3100`–`#3102`; beside the work, never under the parked head — no shipped tool reaches it from home, `test_sim_toolsetter.py`: the TWP gantry carried the 3-axis plate until 2026-10-02, 14 mm from its home, and its 200 mm T1 and the parity programs tripped it), never the WebUI's setting read back — the var file lagged the interpreter and a measurement right after a change took the old plate (ST-I01); the SUPPORTED operation is the WebUI's reference on the plate: another one measures wrong by the difference, and since the sim's tool length is the TABLE's, the next measurement starts from the wrong length — the error ADDS UP (a Z 20 mm too high: 65 → 45 → 25 → 5, Codex R45 ST-I05; `TestRepeatedMeasurement` pins it). `sim_toolsetter_feed.py` (userspace) supplies only the table length from STAT (empty spindle or no length → no automatic trip, reason on stderr). With the setting on the plate the table length is the sim's physical length, so a measurement returns it. Built by `install.sh` (`sudo halcompile --install`, like the TWP kinematics); `config_sync_check.py` names a missing component with its command. Faithful on purpose: a retract (`#3009`) shorter than the fast probe's deceleration overshoot ends in "probe already tripped", as on a machine — under G64 a probe move brakes at HALF the Z acceleration, overshoot v²/a (the operator's F2000 with 2 mm on the XYZAC sim, 500 mm/s²: 2.2 mm, measured 2.13, 2026-09-30); the profiles ship fast 2000 / slow 200 mm/min with a 3 mm retract, ≥ 0.5 mm past the overshoot on every profile (`TestProbeRetract`). Tests: `lcnc-gateway/test_sim_toolsetter.py`. The 3D view marks the setter the WebUI measures on and the stored tool-change position with PINS (operator 2026-09-30: "eine Markierung mit Beschriftung, die man gut sieht — anstelle eines Modells"; `viewer/toolsetterMarker.ts` decides where, `viewer/pointMarker.ts` draws): a cross at the point and a stem up, the boxes' dark tone as the carrier with CYAN over it (`--viewer-pin` `#00e5ff`, every theme, HC too — operator 2026-10-01: in the boxes' grey they vanished beside the bounds; Codex R62; ≥ 0.12 OKLab from every line role, the tinted body and the light box tone, `palettePairs.ts`; `toolsetter.viewer.spec` counts cyan pixels on all three real pins in four themes and after a rebuild), no axis triad (it must not read as a work coordinate system), a label ("tool setter", "tool change (G30)", light text on a dark outline) UP ON SCREEN from the point — the pin is built in CSS px and posed every frame (`posePointMarker`: scaled by the world size of a pixel at its point, so it is the same size at every zoom; its label along the camera's up, so seen from above it never covers the cross). The tool setter (layer "Tool Setter") at `touchX`/`touchY`/`touchZ` in the machine frame (`machineFrameGrp`) — `touchZ` is the control point's Z when a zero-length tool touches, so a tool's tip meets the point exactly where it would trip — only while `confirmedToolsetter()` is set up (the fallback zeros are no position), re-placed on every settings change. The tool change (layer "Tool Change (G30)") at the stored G30's X/Y/Z from `GET /g30` — the parameter file as of the interpreter's last synch, a display read — read again on every busy→idle edge of the interpreter (a G30.1, a program end), and moved AT ONCE by a read or Save in Probing › Toolsetter that LinuxCNC confirmed (`g30Shared.ts`, Codex R50 VP-I18: a short parameter MDI need not show as busy in any status packet — the form said "confirmed" while the pin stood at the old place); reads in flight are ORDERED (VP-I19): a reply, a failure too, applies only while no newer read was asked for and no confirmed value came, and the unmount ends them all (two edges' reads answered in reverse put the pin back); a failed read or a missing row shows no pin (never 0) and says so once in the console. A third pin, "control point · G49" (or "· other offset"), marks what the DRO, zeroing and touch-off refer to while the spindle tool's own offset is not in effect (`toolOffsetState` off / other): the tip + (physical − applied) in the tool group's frame — under G49 the spindle nose; live only, with the Tool layer — a switch of the layer re-applies the last state, so the pin follows at once, not with the next status (Codex R61 VP-I26) — always on top (`__viewerDiag.getControlPoint`, `toolsetter.viewer.spec`). Both are drawn OVER the machine by default (the "On top" column below); `__viewerDiag.getToolsetter` / `getToolChange` ({visible, top, screen, onTop}), `e2e/toolsetter.viewer.spec.ts` (the tip on the setter's point under G43 and G49 on the XYZAC model; the pin over the spindle head from above while on top, hidden by it when not — red with the depth test off but the draw order unchanged; G30 follows its reads).
- **Loaded program** (review R15 B2) — `active_file` is the program the operator LOADED, not the interpreter's open file (`gateway_util.LoadedProgram`): it changes only from the gateway's own `load_file` (a 5 s window, program_open being fire-and-forget) / `unload_file`; STAT.file flips — remaps, o-calls, a subroutine left open after an MDI error with no program loaded — are held and traced once (`status.file_flip_ignored`). A restarted gateway adopts a program only from its own LOAD RECORD for this LinuxCNC instance (`loaded_program.json` in the suite's log dir, keyed by `(linuxcncsvr pid, start ticks)`, written on every change); without one the interpreter's open file is `program_unconfirmed` — a warn banner with Load program, never loaded or previewed. A load or unload is ONE record transaction (R17 XZ-08): before the interpreter changes, `begin_program_change` marks the record unsettled (else removes it; neither → the command is refused), no settled record is written until the change is observed, a failed write keeps it unsettled and retries every tick — an unsettled record proves nothing. Only the interpreter settles a change (R18/R19 XZ-08): a load settles on the open's OWN success — its RCS status (`_cmd_blocking(CMD.program_open, …, wait=5)`, sliced; RCS_ERROR = refused, reply "LinuxCNC did not open the program") or STAT.file changing TO the path — never on a name that was there before the request (task sets its file only on a successful open: a refused reload left the old name standing and it matched); it keeps its 5 s window whatever ended the handler (a cancel lands after `program_open` went out); a refused open, a window that runs out, or an unload refused or cut short (`abandon_change`) leaves it UNRESOLVED — no program loaded, the open file named unconfirmed, `change_pending` held (no settled record) — until a load, an unload or an empty interpreter resolves it; never the old program again. `auto_run` waits while a change is under way. No directory hint: PROGRAM_PREFIX and the subroutine path are no proof of a file's role (review R16 XZ-08). The connect-time preview reads the loaded program, never the raw STAT.file.
- **Tool geometry**: Per-tool STL files in `machine/tools/`, loaded via `STLLoader`. Fallback: simple cylinder from diameter + length. Cutter and shaft are split by `flute_length` / `shoulder_length` Z thresholds: in the 3D viewer the cutter is bright steel (`--viewer-cutter`, ≥ 0.25 OKLab from every line role — the tip meets the path; the gold it replaced sat 0.12 from the orange limit) and the shaft mid steel (`--viewer-tool`), operator 2026-09-29; the Tools dialog's small 2D preview keeps gold / silver (an illustration on the panel). STL origin convention: tool tip at (0,0,0), extends in +Z.
- **No `:deep()` visual overrides** — scoped CSS may use `:deep()` for layout properties (flex, width, height, padding) but NEVER for visual properties (background, color, border, box-shadow). Visual overrides bypass Btn.vue's state system. If a button state looks wrong, fix it in Btn.vue.
- **A class on a MachineBtn PLACES it** (flex, grid, width, aspect-ratio, margin) and never styles its interior (padding, content alignment, gap): a dimmed button with a reason is wrapped in `.btnTip`, which takes the class, and the button fills it — interior styling on the class shrank and distorted the probe cells under TCP (design wave D1 live look); interior comes from the catalog size (`probeCell` → Btn `cell`). Equal-share rows are GRID tracks (`minmax(max-content, 1fr)`), not `flex: 1`: a flex basis of 0 floors at each button's padding + border, which the wrapper has not (a dimmed Start came out 9 px narrower). `layout.spec` guards it: the strip sweep and the side-panel sweep (every main tab and Probing sub-tab × every machine state incl. TCP/Plane) compare each control's footprint with its enabled self (a `[data-layout-slot]` readout a control turns into under a closed gate counts as that control — same place, same size) and flag `overflowing-box` (content past a box that neither grows nor scrolls), `crosses-separator` `sliver-scroll` (a scroll box overflowing by 1–4 px: a scrollbar for a layout that almost fits) and `sideways-scroll` (ANY sideways overflow inside the bottom strip — the strip itself is the horizontal scroller; the Safety status columns overflowed by 10 px, past the sliver window, and nothing saw it). In portrait the strip's sections share ONE content column (the pinned Safety section included), its two status columns fit side by side with a reserve (rule and label–value gap at `--gap-tight`, portrait side padding `--gap-tight`: 240 px of need in the 13 px test font, 4 px reserve on the touch tablet), and the pinned section stays ≤ 30 % of the strip, ≤ 55 % at 150 % (stacking the columns fitted them too, but pinned 35 % and 60 % — today 25 % and 45 %). The probe grid section is a FIXED height (360 px, `flex: none`) so the parameters below never move between sub-tabs — no description line under the grid (operator: the glyphs say it), and `layout.spec` checks the parameters start at one height in every grid sub-tab.
- **Single-root catalog components** — `MachineBtn`/`MachineInput` render exactly one root element. Anything floating (hint, glyph) is app-wide state rendered by `FloatingOverlays.vue`; a Teleport or a second root inside the component drops the parent's scoped-CSS id from the control.
- **Gate.vue** — renders `<fieldset :disabled="!allow">` with `.fs-reset` styling (chrome-only: no border/padding/margin). Browser-enforced default-deny: disabled propagates to all descendants. The outer Gate (`gate="armed"`) wraps the entire main area. `#exempt` slot reserved for safety section only (Arm, E-Stop). All buttons use MachineBtn catalog types; `<Btn>` is never used directly in templates.

## Pre-Flight Checklist — MANDATORY for every CSS/UI edit

Before writing or modifying ANY CSS or interactive element, verify ALL items:

**Spacing** — `gap`/`row-gap`/`column-gap`/`margin` between siblings MUST use tokens: `--gap-micro` (2px), `--gap-tight` (4px), `--gap-controls` (8px), `--gap-section` (12px), `--gap-panel` (20px). Never hardcode. No double-layer spacing (parent flex gap + child margin-bottom on `.sub` headings, etc.). Grid cell gaps use `--gap-controls` or `--gap-tight` — never `--gap-section` for internal grid spacing.

**Layout** — Use `stack-*` / `row-*` utility classes from `style.css` for flex layout. Never write `display: flex; flex-direction: column; gap: var(--gap-*)` directly in component CSS. Component-scoped CSS should only add non-layout properties (height, overflow, position, flex, min-height). Classes: `stack-panel` (20px), `stack-sections` (12px), `stack-controls` (8px), `stack-tight` (4px), `stack-micro` (2px), `row-controls` (8px), `row-tight` (4px). A conditional rule (`@media`, `@supports`) comes AFTER the base rule it adjusts: same specificity, the later one wins — the Safety section's portrait rules sat before its base rule and never applied for seven weeks (content 8 px further in than every other section, the scroll fade in its landscape geometry); the CSS audit's `MEDIA_SHADOW` fails the gate on that order, in `.vue` style blocks and in `style.css`.

**Opacity** — Use tokens: `--opacity-subtle` (0.3), `--opacity-disabled` (0.4), `--opacity-muted` (0.6), `--opacity-secondary` (0.8). Never hardcode opacity values except in animation keyframes.

**Typography** — `font-size` → `--fs-*` tokens. `letter-spacing` → `var(--tracking-caps)` (uppercase text only). `border-radius` → `--radius-*` tokens. `font-family` → `var(--font-mono)` or `var(--font-sans)`. Never hardcode any of these.

**Colors** — Use semantic CSS variables (`--ok`, `--danger`, `--warn`, `--accent`, `--fg`, `--bg`, etc.) with `color-mix()`. Never raw hex. A TEXT takes `--fg`, `--fg-muted` or a `-text` role — never a fill colour, never an opacity. Hover tiers: `--hl-hover` (12%), `--hl-selected` (15%), `--hl-active` (20%) — no other percentages. A STATE colour mixes at a named strength: `--tint-faint` (10 %), `--tint-note` (15 %), `--tint-active` (20 %), `--tint-fill` (25 %), `--tint-heavy` (40 %), `--tint-edge` (50 %) — never a literal (audit TINT).

**Permission gates** — Use `MachineBtn`/`MachineInput`/etc. catalog components for all interactive elements — they self-gate from the catalog. Wrap sections in `<Gate :allow="can.X">` for fieldset-level gating. Never use `<Btn>` directly in templates. Individual `:disabled="!can.X"` is only correct for elements with tighter permissions than the parent Gate. Never use `:class="{ inactive: !can.X }"` for permission gating.

**Global patterns** — Form elements inherit from `style.css` base (component CSS only adds layout). Tables → `.dataTable`. Dialogs → `<DialogFrame>` (never a hand-built `.dialogOverlay` — the audit's `DIALOG_FRAME`). Close buttons → `<MachineBtn type="close">`. Empty states → `.emptyState`. Status dots → `.statusDot`. Section headings → `.sub`. Horizontal dividers → `<div class="sep">`. Monospace → `.mono`. Nothing in a side tab or a dialog runs out SIDEWAYS (`sidewaysOverflow` in layout-audit: content wider than a box that does not let it show — the side-pane sweep in every tab and state, every dialog in `dialogs.spec`; Codex R70): only a code editor, an ellipsis, a field's own value and a box marked `data-scroll-x` (the Offsets table past its axes, the G-code reference's one-line syntax) scroll or cut sideways on purpose — it found Settings' scroller 6 px past `.tab-content`, whose `overflow: hidden` cut its scrollbar. Scrollable containers → add `.scroll-thin` (a `.dialogContent` and CodeMirror's `.cm-scroller` carry it by themselves — a dialog's content always scrolls in a low window; seven dialogs and both code editors drew the browser's wide black bar, operator 2026-10-03). `measureLayout` flags any scroller without the thin bar (`thick-scrollbar`, judged by its style, scrolling or not — headless Chromium hides every scrollbar, so no screenshot shows one) and `dialogs.spec` checks every dialog, `editor-guards.spec` the program editor (`thickScrollbars`). Check existing components before creating new CSS.

**New patterns** — If the needed style doesn't exist globally, STOP and tell the user: "This pattern doesn't exist in our global styles. We should add it to style.css first." Never create one-off scoped styles for reusable patterns.

**Dead CSS** — a scoped rule that styles nothing (`EMPTY_RULE`) or a class the component never names (`DEAD_CLASS`: template, script literals, `prefix-${…}`, Transition names, a child component's root class) fails the CSS audit; delete it with the markup that used it (design wave D10).

**Enforcement** — A `PreToolUse` hook (`.claude/hooks/style-check.sh`) fires before every Edit/Write to `.vue`/`.css` files, injecting a reminder. This ensures mid-conversation adherence.

## Toolsetter Var-File Mapping (#3100–#3115)

The `tool_touch_off.ngc` subroutine reads parameters from the LinuxCNC var file so the web UI can configure them:

| Var    | Parameter              | Description                           |
|--------|------------------------|---------------------------------------|
| #3100  | tool_touch_x_coords    | Toolsetter X position (G53)           |
| #3101  | tool_touch_y_coords    | Toolsetter Y position (G53)           |
| #3102  | tool_touch_z_coords    | Toolsetter Z approach height (G53)    |
| #3103  | use_tool_table         | 1 = use tool table for positioning    |
| #3104  | tool_min_dis           | Min distance for known tool re-probe  |
| #3105  | brake_after_M600       | 0=none, 1=M00, 2=M01                 |
| #3106  | go_back_to_start_pos   | 1 = return to start after measurement |
| #3107  | spindle_stop_m         | M-code to stop spindle (5 or 500)     |
| #3108  | disable_pre_pos        | Disable G30 pre-change positioning    |
| #3109  | addreps                | Extra retry count on probe fail       |
| #3110  | lasttry                | 1 = last retry without tool table     |
| #3111  | offset_diameter        | Tool diameter threshold for offset    |
| #3112  | offset_value           | Offset percentage of tool diameter    |
| #3113  | finder_touch_x_coords  | Edge-finder X reference (G53)         |
| #3114  | finder_touch_y_coords  | Edge-finder Y reference (G53)         |
| #3115  | finder_diff_z          | Height diff probe vs reference        |
| #3116  | rfl_skip_tool          | One-shot RFL guard: tool just measured via MDI — skip its in-program re-measurement once (set by gateway, self-cleared by routine; cleared by every routine the WebUI starts with values, and before any start while the gateway cannot vouch it is 0) |
| #3014  | finder_number          | Probe tool number (shared with probe tab) |

### G30 position (#5181–#5189, operator P4, Codex R21–R24)

The stored tool-change position lives in the INTERPRETER; the parameter file holds it as of the last `Interp::synch()` — task synchs on every switch to MDI/AUTO and on `task_plan_synch` (rs274ngc_pre.cc `synch` → `save_parameters`, verified live 2026-09-28; not only at shutdown). `save_parameters` writes `<file>.new`, links the old file as `.bak` and renames: a NEW INODE proves a fresh file (a failed write leaves the inode, and synch still answers RCS_DONE). `G30.1` stores `STAT.position` (the commanded position in the machine frame) for all nine axes at `#5181 + canonical index` (`gateway_util.g30_param`); a `WRAPPED_ROTARY` axis is stored in [0, 360). Three gateway commands, every step under `_cmd_lock` then `_var_file_lock` (never the reverse; the gateway's own var-file writers take the same lock, `_var_file_thread` waits for a write to end even through repeated cancels):
- `read_g30` (gate idle): `task_plan_synch` must answer RCS_DONE, the inode must change, every configured axis must hold a finite value — else `confirmed: false` with the reason; one fd + `fstat` snapshot (`read_var_snapshot`).
- `capture_g30` (g30Capture: machineFrame + standstill — a manual jog keeps INTERP_IDLE): the confirmed stored values plus the current position (wrapped rotaries normalised) — a DRAFT, nothing written. After the awaited synch it re-checks the admission on a CURRENT controller read before it takes the position (`_controller_capture_state`, Codex R25–R27 OP-I02; the published snapshot lags a cycle): the STAT poll must SUCCEED (a failed one leaves the last poll's position in the object), the kins frame is the reader pin read NOW — an absent value or a stale reader is unknown and refuses on a switchable machine, never the snapshot's frame; a machine whose declaration cannot switch needs no pin — and the interpreter state and the motion come from that poll; no status at all refuses too ("Machine status not read — capture again"). Stricter than `_controller_touchoff_state`, which keeps a snapshot value the controller does not offer.
- `set_g30 {values, based_on}` (machineFrame): the window check (`g30_window_refusal`: AXIS_ / JOINT_ limits, an open bound is named in `open_axes`), then the confirmed read must still equal `based_on` (1e-6, else "G30 changed meanwhile — reload"), ONE MDI of `#518x=` words, and a second confirmed read must show every value — only then `ok`.
`_read_g30_vars` is the display read (no machine command): a missing row is `None`, never 0.0, with the file's time.

## Build Verification

**ALWAYS run `npm run build` (in `lcnc-webui/`) after any TypeScript/Vue change.** This uses `vue-tsc -b` which is stricter than `vue-tsc --noEmit` — it catches unused imports (TS6133) and declaration emit issues that `--noEmit` misses. Zero TS errors is a hard requirement. Never use `vue-tsc --noEmit` as the sole verification step. `-b` builds THREE projects: `tsconfig.app.json` (DOM, `src/**` minus the node-side tests), `tsconfig.node.json` (the vite/vitest/playwright configs) and `tsconfig.test.json` (the node-side tests, `scripts/simDump.ts`, `e2e/**`) — a test that imports `node:fs` goes in the app exclude AND the test include; `src/tsconfigCoverage.test.ts` enforces both lists and refuses stale entries.

## Lessons Learned

- Normalize camera direction vectors before scaling by distance — non-unit vectors (iso, dimetric) cause distance drift on repeated clicks
- ThreeViewer in hidden v-show tabs: guard `if (w === 0 || h === 0) return` in resize() or canvas gets 0x0
- Don't use CSS grid overlay (visibility:hidden) for tab panes with ThreeViewer — ResizeObserver feedback loops
- `CMD.wait_complete()` in a gateway handler blocks that client's command worker (commands are serialized per client), never the reader — heartbeats keep flowing since 2026-09-03. Keep waits bounded anyway: the worker is FIFO, so a 30 s wait delays that client's next command (incl. abort) by up to 30 s.
- Scoped CSS styles (e.g. `button.primary` in App.vue) don't apply in child components — put shared button styles in global `style.css`
- HAL access is now in a sibling process (`hal_reader.py`) — the gateway never imports `hal`. Benchmarks (`hal.get_value` ~2 µs; `hal.get_info_pins()` ~1 ms typical with ~276 ms tails under load) remain accurate but the gateway no longer pays the cost on its hot path. See GitHub issue #9 and `hal-cost-benchmarks.md` for history. Custom mirror components (direct pointer reads, <1 µs) are theoretically faster but introduce orphan-cleanup complexity and silent-fallback risk; do not re-introduce without measured perf pressure.
- Never use `:deep()` to override visual CSS properties (background, color, border) in scoped styles — it bypasses Btn.vue's design system. Layout overrides (flex, width, padding) are acceptable.
- Always use `with open()` for file I/O in Python — bare `open()` in loops leaks handles until GC
- `.get()` is a dict method — calling it on a list silently raises AttributeError. Use `[index]` for list access.
- Read the actual CSS before speculating about visual bugs — the override might be setting the value to match the background, not just being "too subtle"
- A range input under `v-model` clamps a value to its OLD range: `v-model` writes the element's value in `beforeUpdate`, before the render patches `min`/`max`/`step`, so a value past the old max arriving with a longer range sat at the old end (the scrub bar's first finding jump — the entry move lengthens the timeline — showed its thumb at 20 of 120). `MachineSlider` binds `:value` (Vue patches `value` after every other prop) and writes the model on `input` (found by the R33 limit guard, 2026-09-28)
- A flex item that holds single-line (`nowrap`) text needs `min-width: 0`, or its automatic minimum width is the full text and it pushes its siblings out of the container — the status banner's action buttons (messages, Refresh, Home All, Abort) vanished behind the right edge whenever a long banner showed. Compact banner texts to the state plus one recovery verb; the explanation goes in the `title`
- A `min-width` floor on a readout slot is not a fixed slot: content past the floor still grows it and `text-overflow: ellipsis` never engages. A readout that must not move its siblings gets `flex: 0 0 <w>` + `overflow: hidden` (ScrubBar row 1 ate the timeline). Same family: a control that changes state must keep its geometry — one slot, one button position, variable-width text AFTER the last button of its group
- Every overlay on the 3D viewer keeps `--gap-section` from the frame and floats on the global `.overlay-card` (92 % panel + blur: HUD card, sim bar) — never hard-code the 12px or copy the chrome into a component; the bar sat 8px in on an opaque panel while the HUD sat 12px in on a translucent one
- Use direct child selectors (`.grid > label`) not descendant selectors (`.grid label`) when styling grid/container labels — descendant selectors mute nested form controls (radios, checkboxes) inside those containers
- When adding server-synced settings sections, update `_VALID_SETTINGS_SECTIONS` in `gateway.py` — the gateway rejects unknown sections with "Unknown settings section" error
- Don't hack around permission issues in the backend — use the proper frontend permission gate so the UI reflects machine state (dimming). The gate IS the fix, not a workaround.
- Any component that emits MDI commands (e.g. `setProbeVars`) must gate those emissions behind `can.ready` — MDI requires homed. Settings persistence (`saveDefaults`) is separate and always works.
- Fusion 360 tool library geometry params (`TA`, `LCF`, `LB`, `shoulder-length`) are ambiguous per tool type with no official docs — same key means different things for different tool types. STL import eliminates the interpretation guesswork.
- Settings `saveSection()` must block BEFORE cache write when server isn't ready — otherwise fallback zeros poison the cache and eventually overwrite the server
- Every component reading settings at setup time needs a `settingsVersion` watcher to re-read when WS delivers server data — stale snapshots cause settings to appear lost on refresh
- ThreeViewer `buildFromInit` creates scene objects as visible after `onMounted` already applied layer defaults — must re-apply at end of `buildFromInit` using fresh `loadViewerDefaults()`
- Never re-derive RS274/interp semantics from docs or memory — mirror the interpreter's own source and pin it with differential golden tests (`rs274.test.ts` + `TestRs274EffectiveOffset`, oracle = `rs274.interpret.Translated.rotate_and_translate`). Two latent bugs came from re-derivation: combined `g5x+g92` origin (wrong under G92+G10 R together) and TLO missing from the scrub joint transform (sim pose off in Z by exactly the G43 offset while `applyState` phase 3 subtracted it anyway)
- Mode overrides must swap COMPLETE state objects, not single fields: `_scrubJoints` substituting joints inside `applyState` while `tool_offset`/WCS stayed live is how the TLO pose bug hid — every phase of a shared code path must be audited when one input is overridden per-mode
- Three deletes only a geometry's CURRENT index attribute on dispose: an index attribute swapped out with `setIndex` and never current at dispose time leaks its GL buffer. Give each LOD level its own geometry object (visibility flip) instead of swapping indices.
- Program-order index ranges are not spatially compact (a pocketing pass sweeps the whole part every 40 k segments): bin segments spatially before expecting frustum culling or a bounds gate to fire. Per-object cost (~5–15 µs) bounds the chunk count — ~64, not hundreds.
- A benchmark program can be adversarial to an optimisation by construction: `perfmatrix-big.ngc` is a random walk (median turn 52°), so no honest decimation collapses it; read a perf lever on a real CAM program too.
- Machine bounds are joint limits, fixed in the room: anything expressing them (clip planes, the bounds box) lives in the machine frame (the work chain with its rotaries zeroed), never under the rotating work group.
- Never bump a wire schema constant while the suite is live when the producer is a fresh subprocess and the consumer imported the constant at start — the mismatch edge loops. Ship the new key (ignored by old readers), bump at the stop.
- Surface-map Z compensation (`axis.z.eoffset`) is a **3-axis feature**: a machine-Z shim applied after kinematics, valid only with the tool normal to the mapped surface (A=0) and the map's XY grid aligned to the work (C=0 — the map does not ride the platter). Probing or applying it tilted is directionally wrong; enforcement gate deferred (recorded in dry-run memory)
- A per-line `Map`/`Set` on a million-line program is a million heap objects the browser's collector marks on EVERY major GC (110–140 ms measured) and a ~1 s structured clone per worker hop — the "sometimes lags when rotating" class. Line-indexed typed arrays (`viewer/lineIndex.ts`) are the shape for anything keyed by line number
- A background re-parse that cannot be cancelled QUEUES: an edge raised during it was not even evaluated until it published, then ran a second full parse (41–167 s live). Snapshot the running parse's inputs and supersede it; and an edge that stays true until the publish (`file_changed`) must never be allowed to cancel the parse that will clear it
- `browser.viewer.perf` `frames`/`gap_*` are the STATUS cadence (30 Hz active, 5 Hz at the gateway's idle poll after a manual jog), NOT the frame rate — a whole record once called the Mac's viewer "30 fps capped" from them. `raf_*` is the render loop; `mt_*` (timer lateness) vs `gpu_*` (WebGL2 fences) say whether a stall is the main thread or the GPU — the CPU-side `render_*` never shows a GPU-bound draw (WebGL is out of process in Firefox and Chromium)
- A Web Worker is off the main thread, not off the machine: the collision sweep running for minutes made the GPU trail 3–4 frames on the operator's Mac with a perfectly clean main thread. Profile before designing (the "2 h sweep" was a per-chunk certificate reset meeting 0.09 mm segments — 45 BVH queries per 0.09 mm — not mesh cost); let interaction (camera) and a hidden tab pause every background job, and make it report what it covered whenever it stops early (the wall-clock budget that once bounded the sweep was retired 2026-09-13 once the pauses and the carried certificates made it pointless)
- Lazy conservative advancement must CARRY its certificates across chunk boundaries in clearance terms (d − margin, decremented by each chunk's V × L); resetting them per chunk makes the cost O(segments × pairs) regardless of geometry
- Never probe a server's liveness with a WebSocket and never cancel a CONNECTING socket on a short timer: the browser remembers failed WebSocket connections (Firefox: per IP:port, ×1.5 up to 60 s, surviving reloads) and holds the next attempt, and Firefox admits one connecting WebSocket per IP across ports — blind retries through an outage plus a 3 s timeout kept tabs 35–58 s on "reconnecting" after every restart, and Vite's WebSocket restart ping on :5173 queued the gateway socket on :8000. Ask over HTTP first (`/ready`)
- An invisible hit area is real overflow: a `::before` larger than its element (the "?"'s `--help-hit`) counts as scrollable overflow in any scroll container around it — a scroller whose lines end in a "?" needs end padding for the reach (a negative margin keeps its size), or it shows a scrollbar for 3–6 px and clips the target. `overflow-y: auto` alone turns `overflow-x` to auto too
- Profile before vectorizing: 40 % of the 46 s plane-mode parse was 2.36 M pure-Python inverse-kinematics solves, another ~40 % three passes that re-stripped comments character by character; the interpreter itself was a quarter. cProfile inflates Python-call-heavy code ~2× — use it for proportions, the trace for absolute numbers

## Production DISPLAY Integration

The `lcnc-suite` launcher script lets LinuxCNC start the gateway as its native display:

```
linuxcnc my_machine.ini    # single command — starts everything
```

**Setup:**
```bash
# 1. Build the frontend (once, and after any frontend changes)
cd lcnc-webui && npm run build

# 2. Symlink launcher to PATH so LinuxCNC can find it
#    (LinuxCNC does not expand ~ in DISPLAY paths — must be on PATH)
mkdir -p ~/.local/bin
ln -sf "$(pwd)/../lcnc-suite" ~/.local/bin/lcnc-suite

# 3. Verify
which lcnc-suite    # should print ~/.local/bin/lcnc-suite

# 4. Set DISPLAY in your machine INI [DISPLAY] section:
#    DISPLAY = lcnc-suite
```

**How it works:**
1. LinuxCNC launches `lcnc-suite -ini /path/to.ini` as a subprocess
2. Launcher sources NVM (for correct Node version), activates Python venv
3. Reads `WEBUI_*` config from INI `[DISPLAY]` section via `inivar`
4. Production (`WEBUI_DEV=0`): exports `LCNC_WEBUI_DIST_DIR`, `exec`s uvicorn serving API + built frontend
5. Dev (`WEBUI_DEV=1`): starts Vite on :5173 (hot-reload) + gateway on :8000, cleans up both on exit
   Before either: runs every `[HAL]POSTGUI_HALFILE` with `halcmd -i <ini> -f`, the way axis/gmoccapy
   do — after `halcmd start`, and after WAITING for milltask's `inihal` component to be ready (the
   linuxcnc script spawns milltask in the background and this launcher is up in milliseconds, so
   `ini.*` pins may not exist yet). A failing file aborts the display loudly.
6. LinuxCNC blocks on the display process; SIGTERM triggers clean HAL shutdown

**INI configuration** (`[DISPLAY]` section):

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBUI_HOST` | `0.0.0.0` | `127.0.0.1` for local, `0.0.0.0` for LAN |
| `WEBUI_PORT` | `8000` | HTTP/WebSocket port |
| `WEBUI_BROWSER` | `1` | Auto-open browser on start |
| `WEBUI_DEV` | `0` | `1` = Vite dev server on :5173 (hot-reload) |
| `WEBUI_TOKEN` | *(none)* | Pre-shared auth token (issue #17). **Required** when `WEBUI_HOST` is non-loopback — the launcher aborts loudly if bound to a network interface without one. Required to connect the WS and to use REST mutation routes. Empty = auth disabled (loopback/dev only). |
| `WEBUI_ALLOWED_ORIGINS` | *(same-host)* | Comma/space-separated WS/CORS Origin allow-list. Unset = allow only same-host origins (works for any LAN IP). Browser drive-by from other origins is rejected regardless. |
| `LOG_DIR` | `<install-dir>/runlogs` | Optional suite log dir (all four processes). Unset = next to launcher; unwritable = loud launcher abort, no `/tmp` fallback |
| `CAMERA_SOURCE` | *(disabled)* | USB device index (`0`, `1`) or URL (`rtsp://host/live`, `http://host/mjpeg`) |
| `CAMERA_RESOLUTION` | `1280x720` | Capture resolution `WxH` (USB cameras only) |
| `CAMERA_FPS` | `15` | MJPEG stream frame rate |
| `WEBUI_MACRO_DIR` | *(none)* | The macro folder (package 5): `.ngc` macros run by `o<name> call`; must be on `[RS274NGC] SUBROUTINE_PATH` (the examples: last) and apart from PROGRAM_PREFIX. Unset = no macro files. See "Macro files". |
| `WEBUI_MACHINE_DIR` | *(gateway default)* | Machine viewer-model dir (`machine.json` + STLs) for the 3D machine model. Unset = `lcnc-gateway/machine/`. See "3D Machine Model". |

Environment variables `LCNC_WEBUI_HOST`, `LCNC_WEBUI_PORT`, `LCNC_WEBUI_BROWSER`, `LCNC_WEBUI_DEV`, `LCNC_WEBUI_TOKEN`, `LCNC_WEBUI_ALLOWED_ORIGINS` override INI values. `LCNC_LOG_DIR` overrides `LOG_DIR`. Camera variables: `LCNC_CAMERA_SOURCE`, `LCNC_CAMERA_RESOLUTION`, `LCNC_CAMERA_FPS`.

**Auth (issue #17):** the gateway is a machine-control surface, so when bound to a network interface it requires `WEBUI_TOKEN`. The token is injected into the served `index.html` (`window.__LCNC_TOKEN__`), so browsers the gateway serves get it automatically; the WS carries it as `?token=` and REST mutations as the `X-Auth-Token` header (`sendBeacon` settings flush uses `?token=`). This blocks cross-origin WS hijack and unauthenticated REST mutation on a trusted LAN; it is **not** a defense against an attacker already running code on that LAN.

**Development mode:** Set `WEBUI_DEV = 1` — launcher starts Vite on :5173 (hot-reload) alongside the gateway on :8000. Browser opens to :5173 where Vite proxies API/WS to the gateway.

For headless/no-UI: `DISPLAY = dummy` (zero overhead, gateway connects separately). A standalone gateway has no launcher (no PDEATHSIG) but is still session-bound: it binds to the LinuxCNC instance on its first NML connect and exits when that instance ends; set `WEBUI_ALLOW_REBIND=1` only for a harness that restarts LinuxCNC under one gateway.
