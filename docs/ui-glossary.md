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
| The loaded G-code file | **Program** ("No program loaded") | "file" in the program context |
| G54–G59.3 | **Work offset(s)** ("Work Offsets", "Clear all work offsets") | "fixture offset", "work coordinate offset" |
| The same, in a compact button | **WCS** ("Go to WCS 0") | — |
| G0 motion | **Rapid** (viewer colour, overrides) | "Fast Feed" |
| The probing feeds | **Fast Feed / Slow Feed / Traverse Feed** (probe and toolsetter alike) | "Probe Fast FRate", "Traverse FR" |
| Probe travel limits | **Max X/Y Travel / Max Z Travel** | "Max Z Distance" |
| A move beyond a joint limit | **Limit violation(s)** ("3 limit violations") | "3 limits", "soft-limit violation" |
| The boundary itself | **Soft limit** | — |
| A machine body contact found by the sweep | **Collision(s)** ("2 collisions", "No collision so far") | "clash" |
| An unbound key or gamepad button | **None** | "Unassigned" |
| Spindle direction | **Rev · Stop · Fwd** in this order (a preset: Rev · Off · Fwd) | FWD / REV |
| The HAL browser (Settings tab) | **HAL** | "Halshow" |

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
