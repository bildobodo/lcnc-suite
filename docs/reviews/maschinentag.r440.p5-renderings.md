# P5 renderings for the operator's review (prototype `proto/p5-renderings`, never merged)

The prototype ran with the mock gateway in Chromium at two sizes:
- **`touch-fullhd`**: the machine panel, 1920 × 1080, touch. The side pane is 540 px wide.
- **`narrow`**: 900 × 1200 at 150 %, which gives the narrow side pane of 444 px.

Each state has three images: the whole page at Full HD (`cal-<state>-fullhd-page.png`), and a crop of the block at each of the two sizes (`cal-<state>-touch-fullhd.png`, `cal-<state>-narrow.png`). The numbers in the images are examples.

## Calibration offset (P5-1 / W3)

The block sits **under the cells' box**, so the cells stay where they are in every procedure. It holds the active offset, its machine state and **Reset**; the old "Reset Calibration" at the bottom of the box is gone. The space it leaves in the box stays empty.

| State | File | What to check |
|---|---|---|
| idle | `cal-idle-*` | Can you see the active offset and Reset at once? |
| pending | `cal-pending-*` | "New … — was …" with routine, size, axis and time, plus **Apply** and **Discard**. Is the amber draft clear enough? |
| applied | `cal-applied-*` | The green note; the new value is active and on the machine. |
| applied_saved | `cal-applied_saved-*` | Applied, but the machine was not ready: "Saved — written to the machine with the next probe". Updated after R439. |
| discarded | `cal-discarded-*` | A neutral note; the old value stays. |
| failed | `cal-failed-*` | Apply refused (here: not armed). The candidate stays open, and the red note gives the reason and the value that stays. |
| stale | `cal-stale-*` | A result from a run that did not complete is not offered and has no buttons. |

## W1 field states (P5-2)

The crops show the "Parameters" form with its machine line and the first fields. The second field, Slow Feed, carries the state.

| State | File | What to check |
|---|---|---|
| draft | `field-draft-*` | An amber bar on the field's left edge and a faint amber tint. The line says "not saved yet · on the machine: 25.0 (written 05:12)". The machine value is shown only from a still-valid machine booking; without one it says "machine value unknown". Updated after R439. |
| saved | `field-saved-*` | The field is neutral (your decision). The line says "Saved — written to the machine with the next probe". This holds only when nothing can write now (not ready); when ready the panel writes at once and the line says "Writing to the machine…". Updated after R439. |
| confirmed | `field-confirmed-*` | The field is neutral. The line says "On the machine — written 05:12", from the machine booking of exactly these values on the current connection. Updated after R439. |
| refused | `field-refused-*` | A red bar and the reason under the field. The section's red note gives the machine value only from a valid booking ("On the machine: 25.0 (written 05:12)"), else "machine value unknown". Updated after R439. |

Two things to decide:
- Is one machine line per section enough, with the per-field mark only for draft and refused (saved = no mark)?
- Should the amber bar also appear on the **Toolsetter** and **G30** fields in a second step?

## Texts after Codex R439 (no image)

These follow the plan's outcomes and have the same look as the images above.

- **Apply after saving:**
  - "Saved — machine value unknown: no answer" (`saved_write_unknown`).
  - "On the machine — not confirmed in the parameter file" (`taken_persist_unconfirmed`).
  - A repeated Apply answers "Already applied".
- **Candidate not offered:**
  - "Calibration did not start".
  - "The active offset changed since this run — calibrate again".
  - "Calibration routine is not the suite's — no result offered" (an upstream original).
- **Machine line:**
  - "Writing to the machine…".
  - "Saved — machine value unknown for Slow Feed".
  - "Partly on the machine — Slow Feed not written".

Re-generated after R439, all other images unchanged:
- `cal-applied_saved-fullhd-page.png`, `cal-applied_saved-touch-fullhd.png`, `cal-applied_saved-narrow.png`
- `field-draft-*.png`, `field-saved-*.png`, `field-confirmed-*.png`, `field-refused-*.png`, each at both sizes

## Notes

- **The W1 look needs a new global style.** No existing pattern marks a field's state. The prototype adds it in one place in `style.css` (`.formField.fs-draft` / `.fs-refused`, built only from existing tokens) and a `state` prop on `FormField`. You agreed on 2026-11-21 to one global pattern; its look is what these images ask you to approve.
- **The sideways scrollbar in the `narrow` images was already there.** The Calibrate view is wider than the 150 % narrow pane even without the prototype: measured 356 / 272 CSS px, with the prototype blocks hidden (`e2e/p5-overflow.spec.ts` in the prototype). It is not P5's doing. It is worth a look in the build, because the layout audit does not catch it.
