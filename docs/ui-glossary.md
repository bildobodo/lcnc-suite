# WebUI glossary — terms, case, placeholders, units

The one source for the words the WebUI shows (design wave D0, 2026-09-24). A new
label, title or message follows this page. The CSS audit
(`scripts/audit-scoped-css.py`) enforces the mechanical parts (`ELLIPSIS`,
`UNIT_LITERAL`); the rest is review.

## Terms

| Concept | Write | Never |
|---|---|---|
| The main tab for tools | **Tools** | — |
| The machine's tool list | **Tool Table** (heading, strip button) | "tool list" |
| A library file to import | **Tool Library** | "tool file" |
| A tool-table read that got no table (an error, no reply) | **Tool table not read.** (no rows) | "No tools" |
| A read LinuxCNC's own table does not prove (rule R, P6) | **Tool table not confirmed** — the note "File incomplete or differs from LinuxCNC — T3 differs; T4 missing in the file; line 7 not read." | "is being written", "corrupt" (a paused writer and a closed incomplete file look the same) |
| A read rule R cannot check (random tool changer, tool database, controller not read) | **Tool table not checked** — "Not checked against LinuxCNC — random tool changer." | "unverified" |
| An edit refused on such a basis | the cause and the way out (`tool_proof.partial_reason`): "T5 twice in the file — remove one, restart LinuxCNC" / "Last line has no line end — add it in an editor" / "T5 differs from LinuxCNC — load the file or restart" / "T5 not in the file — restore it, or load the file" (and, TF-2, the words of a file LinuxCNC may not be asked to load); "Table not checked (random tool changer) — nothing written"; the Tools tab's note repeats it after "Edits refused:" | "read again" for a cause that stays |
| A tool-table write that would shift a tool prepared without M6 | "A tool is prepared — change to another tool or send T0" ("A tool is being prepared — wait until it is done", "Prepared tool unclear since the E-Stop — send T0 first", "Prepared tool unknown — send T0 or restart LinuxCNC", "Prepared tool not read — try again") | "pocket prepped", "index", "finish the change" (M6 of the tool in the spindle changes nothing) |
| The same while something moves | "Machine moving — wait until it stands" | "not in position" |
| A tool row LinuxCNC would read as something else | "T5: line too long for LinuxCNC — shorten its description" ("… — check its numbers", "T5: line break or NUL in its description — remove it", "T5: P is past LinuxCNC's integers — correct it") | "remark" (the field is **Description**), a cut text |
| A written table LinuxCNC was not asked to load (or the ask failed), where the read cannot say it | head + tail (TF-2): "Table saved, load into LinuxCNC failed" / "… load not confirmed" / "… load requested but not confirmed", then "— load table or restart." / "— read again." / ". <the file's own cause>." (a gateway before TF-2: "— restart loads it.") | "not saved" (the table IS), "loaded" |
| LinuxCNC asked to load the tool table file (TF-2) | **Load table** (button); "Load tool table into LinuxCNC?"; "Not requested: <reason>."; a file read with 0 bytes: "File read empty — read again; if it stays empty, restore it" | "Reload", "Sync" |
| What was observed of it | "Load requested. LinuxCNC now shows the file's tool values; pockets and remarks are not compared." / "Load requested, values not shown — <why>." / "Load requested, not awaited — the table shows the result." | "loaded", "confirmed" (a request and the values are all that is known) |
| A written table whose metadata were not saved | "Table saved, metadata not — check tool_library.json" | "Save failed" |
| A table read whose connection changed under it | "Connection to LinuxCNC changed — try again" (no rows) | the old proof |
| The loaded G-code file | **Program** ("No program loaded") | "file" in the program context |
| G54–G59.3 | **Work offset(s)** ("Work Offsets", "Clear all work offsets") | "fixture offset", "work coordinate offset" |
| The same, in a compact button | **WCS** ("Go to WCS 0") | — |
| G0 motion | **Rapid** (viewer colour, overrides) | "Fast Feed" |
| The probing feeds | **Fast Feed / Slow Feed / Traverse Feed** (probe and toolsetter alike) | "Probe Fast FRate", "Traverse FR" |
| Probe travel limits | **Max X/Y Travel / Max Z Travel** | "Max Z Distance" |
| A move beyond a joint limit | **Limit violation(s)** ("3 limit violations") | "3 limits", "soft-limit violation" |
| The boundary itself | **Soft limit** | — |
| A machine body contact found by the sweep | **Collision(s)** ("2 collisions", "No collision so far") | "clash" |
| A run the collision check does not cover (a run from line N, or a start line not proven) | **Not checked** ("Not checked · run from line 7", "Not checked · start line not proven") | "Clear", "skipped", "lines before N not run" |
| An unbound key or gamepad button | **None** | "Unassigned" |
| The simulation's return to position 0 — the program's beginning (the timeline's ⏮) | **Back to start** | "Rewind", "Restart", "Go to start" |
| A calibration's measured result before it is taken over | **Candidate**, **Apply** / **Discard** | "New offset", "Accept" |
| The probe tip offset in use | **Calibration offset** (block), **Calibration Offset** (field label) | "cal offset", "tip offset" |
| Where a value is | **On the machine · 05:12** / **Saved · the next probe writes it** / **Saved · machine value unknown**; with an open edit the first half is **Not saved yet**, before the server ever held it **Defaults** | "synced", "written" without its time |
| An act not carried out | **Not applied: … / Not discarded: … / Not reset: … / Not saved: …** | "failed" |
| Spindle direction | **Rev · Stop · Fwd** in this order (a preset: Rev · Off · Fwd) | FWD / REV |
| The HAL browser (Settings tab) | **HAL** | "Halshow" |
| The comments a CAM post writes at a program's start (its tool list, `(T13 D=1.875 …)`) | **program header** ("program header Ø 1.875" on the Check basis card) | "preamble", "program comment" |

Abbreviations are written out in labels ("Retract Distance", "Spindle Zero
Height", "Offset Direction", "Calibration Offset"). G-/M-codes, axis letters,
units and "WCS"/"MDI"/"HAL"/"TCP" stay as they are.

## Case

- **Title Case** for every short label — buttons, tabs, section headings, work
  dialog titles, field, toggle and radio labels ("Measure Current", "Max Z
  Travel", "Edge Outline", "Machine Position").
- **Sentence case** for anything that is a sentence: help text, descriptions,
  long option labels that read as an instruction ("Prevent screen lock while
  connected"), status sentences ("No collision so far").
- A **confirmation dialog title** is a sentence-case question naming its object
  ("Delete T5?", "Discard changes?").
- **Status words** in status rows are UPPERCASE (below).
- An icon-only control's accessible name is a sentence-case phrase naming its
  target ("Close settings", "Reset feed override to 100 %").

## State words

Status rows name the state, never TRUE/FALSE — the banner's vocabulary:

| Row | Values |
|---|---|
| E-Stop | ACTIVE · CLEAR |
| Power | ON · OFF |
| Axes | HOMED · UNHOMED |
| Overrides | ACTIVE · NONE |
| Mode / Interp | MANUAL · MDI · AUTO / IDLE · RUNNING · PAUSED · WAITING |

## Placeholders

- **`NO_VALUE` ("—")** is the one display placeholder for a missing value —
  readouts, stats, table cells, the HUD (`format.ts`). Every display formatter
  returns it.
- It is **never an input value**: editable values show a number or an empty
  entry (`fmtAxisValue` → "").
- An **empty list** is a word ("None", "No tools loaded"), not a placeholder.
- An ellipsis is **"…"**, never "...".

## Units

- A unit follows its **source**: machine lengths from `linearUnit`, preview
  lengths from the preview's unit, angles in ° (°/min), dimensionless values
  without a unit. A label change is never a conversion.
- A unit is **set off by a space** and comes from a formatter: `fmtPct` ("120 %",
  from a ratio), `fmtQty` ("12.0000 mm"), `fmtDist` ("12.3 mm"), `fmtMs`
  ("12 ms"), `fmtUnit` (any value + unit). No unit literal next to an
  interpolation in a template.
- A readout without room for a unit carries it on its own line in the same cell
  (the jog speeds) or in its group label ("Step (mm / °)").
