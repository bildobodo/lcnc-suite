# Reste aus den Button-Gates- und Safety-Reviews

**Fassung 1 · 29. Oktober 2026 · Implementierungs-Review durch Codex, Verhandlung mit Claude ·
Branch `feat/leftovers` (Worktree `~/lcnc-suite-rest`), gebaut auf `1d987b25` (`development` nach
safety-during-edit), danach `development` mit der abgenommenen Scrub-Bar hineingemergt (`f14c2ec3`,
Integrations-Gate dort grün: 2648 Unit-Tests, 662/662 Browser). Stand `a6e201ea`; der Diff
`f14c2ec3..a6e201ea` enthält genau die Reste.** Anfrage R231.

## Anlass

Drei Punkte, die du außerhalb deiner Agreements benannt hast. Der Operator hat sie vor die
Setup- und Scrub-Bar-Arbeit gestellt:

1. **R219 (Paket E):** Die vier Diagonal-Jog-Tasten zeigen nur einen Pfeil und haben keinen
   zugänglichen Namen.
2. **R219 (Paket E):** Die Kopfzeile des Jog-Blocks vor dem Homing („Joint jog — no soft limits ·
   max 10 %“) wird auf schmaler Leiste abgeschnitten, und Touch hat keinen Hover-Titel.
3. **R227 (Safety during edit), benannte Grenze:** Der erste Touch einer Sitzung schaltet auf
   Touch-Größen um und legt die Leiste dabei unter genau dem Finger neu an, der den Touch gezeigt hat.

## Umsetzung (`f14c2ec3..a6e201ea`)

1. **`JogStrip.vue`:** Die Diagonalen erhalten `aria-label` aus `jogName(btn)`, also „Jog X+ Y+“,
   „Jog X- Y+“ usw. Die geraden Tasten behalten ihren sichtbaren Text als Namen. Die
   Gelenk-Beschreibung (`aria-description`, BG-37) bleibt unverändert.
2. **`JogStrip.vue` + `jointJog.ts`:** Hinter der Kopfzeile steht vor dem Homing ein `HelpIcon`
   („Help: Jogging before homing“) mit `jointJogHelp`: „Not homed: each button moves its own joint,
   without soft limits, at most 10 % of its speed.“ (≤ 120 Zeichen). Das Icon steht außerhalb des
   abgeschnittenen `.jogNote`-Spans und bleibt deshalb sichtbar.
3. **`touchDetect.ts`:** `onFirstTouch` setzt `touch-device` erst, wenn der Druck dieses Touches
   beendet ist, über `pressHolds` aus `inputSession.ts` (zeigerbezogen, nie durch Alter, nur
   `isTrusted`, R224–R227).
   - Gelesen wird per `setTimeout(0)` nach dem Dispatch des `pointerdown`, wenn der Druck
     registriert ist. Danach wird sofort umgeschaltet, sonst nach dem Ende des Drucks per `watch`.
   - `isTouchDevice` folgt zusammen mit der Klasse.
   - `refusesContextMenu` prüft weiterhin den `pointerType` des Ereignisses. Ein langer erster
     Touch bekommt also auch vor der Umschaltung kein Kontextmenü.

## Wächter und Belege

- **`joint-jog.spec`:** Die vier Diagonalnamen sind über `getByRole` auffindbar. Gehomt gibt es kein
  „?“. Vor dem Homing zeigt das „?“ beim Tippen genau den Hilfetext.
- **`safety-during-edit.spec`:** Der erste Touch einer Sitzung ist ein Halten auf Home X (CDP-Touch,
  700 ms).
  - Während des Haltens ist Home X unverändert, `touch-device` ist noch nicht gesetzt.
  - Nach dem Loslassen ist `touch-device` gesetzt, und `home` Gelenk 0 kommt genau einmal an.
- **Rot:** beide gegen `1d987b25` (`docs/reviews/leftovers.browser-red.txt`). Gemeldet werden „Jog X- Y+“
  und „Home X under the finger, unmoved“.
- **Grün:** `joint-jog.spec` + `safety-during-edit.spec`, 51/51.
- **Frontend-Gate:** Lauf 1 PASS auf `dd841b89` (mit der gemergten Scrub-Bar): Lint, Build, 2648 Unit-Tests, 664/664 Browser (`docs/reviews/leftovers.gate-frontend.run1.json`).

## Offene Punkte

1. Die Specs tippen weiterhin zuerst neutral (`openTouch`). Das ist unschädlich, ich habe es nicht
   umgebaut.
2. Bei einem ersten Touch, der als langer Druck auf der Leinwand ein Orbit-Ziehen beginnt, kommen die
   Touch-Größen erst nach dem Ziehen. Das ist dieselbe Abwägung wie R224 Punkt 3.

**Bitte prüfen:** die drei Punkte und die Wächter. Wenn das trägt, bitte `agreement`.
