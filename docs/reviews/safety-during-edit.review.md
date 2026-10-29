# Safety-Tasten während einer Eingabe

**Fassung 1 · 29. Oktober 2026 · Implementierungs-Review durch Codex, Verhandlung mit Claude ·
Branch `feat/safety-during-edit` (Worktree `~/lcnc-suite-gates`), Basis `729a7f4a` (= `development`
nach dem Button-Gates-Merge), Stand `3c24fbea`.** Anfrage R224.

## Anlass

Der Operator, 28. Oktober, beim Test des Button-Gates-Stands (Querformat):

> wenn ich während dem editiermodus eines feldes oder von code die disarm, estop oder machine on
> off taste drücke passiert nichts. getestet im landscape layout. ich vermute das liegt daran, dass
> das safety panel springt. ich finde das safety panel sollte sowieso immer links zu finden sein.
> also an gleicher stelle. das keyboard kann dann direkt rechts davon beginnen, wenn es aufgerufen
> wird. im portrait habe ich das nicht getestet. aber was ich gesehen habe, ist dass wir dort die
> maschineninfos nicht haben im editiermodus. ich finde diese sollten wie im landscape auch
> erhalten bleiben.

## Befund (gemessen im Mock, vor der Änderung)

- **Ursache:** Die Leiste zentrierte, was hineinpasste (`.strip::before/::after { flex: 1 }` in
  App.vue). Öffnet sich ein Helfer, verschwinden alle anderen Abschnitte. Safety stand dann bei
  1920 px auf x 571 statt 17, bei 2560 px schon ohne Helfer auf 278.
- **Ablauf:** Der `pointerdown` außerhalb des Eingabebereichs schließt den Helfer (Sitzungsregel
  UI-15a). Die Abschnitte kommen zurück, Safety springt nach links, und der Klick fällt daneben.
  Gesendet wurde nichts; ohne Helfer kam `arm` an.
- **Dieselbe Klasse außerhalb von Safety:** Ist der Ziffernblock für ein Antastfeld offen, endet
  ein Halten auf „Home X“ im Setup-Abschnitt neben der Taste. Setup rückt um 448 px nach rechts,
  sobald Jog zurückkommt.
- **Hochformat:** Safety bewegte sich nie (diese Taps gingen schon durch). Die Maschineninfos
  klappten aber bei jedem offenen Helfer ein (D7, UI-I08).
- **Platz im Hochformat, mit Infos gemessen:**
  - 900 × 1200 bei 100 %: Die Tastatur endet bei 880 px, der Ziffernblock bei 893 px von 1200.
  - Bei 150 % (600 × 800 CSS-px) enden beide unterhalb des Fensters: die Tastatur um 76 px, der
    Ziffernblock unter Setup um 89 px.

## Entscheidungen des Operators (29. Oktober)

1. **Querformat alles linksbündig, nie zentriert.** Safety steht in jedem Zustand und bei jeder
   Breite links. Ein Helfer beginnt direkt rechts davon, der Ziffernblock rechts von seinem
   Besitzerabschnitt. Freier Platz bleibt am Ende.
2. **Grundsätzlich beheben, nicht nur Safety:** Unter einem Druck bewegt sich nichts mehr.
3. **Hochformat:** Die Infos klappen nur ein, wo der Helfer mit ihnen nicht passt. Das ist eine
   Messung, keine Regel nach Ausrichtung.

## Umsetzung (`729a7f4a..3c24fbea`)

- **Keine Zentrierung (App.vue):**
  - Die beiden Platzhalter sind weg, ebenso ihre Hochformat-Gegenregel.
  - Nebeneffekt: Safety beginnt jetzt am Rand der Leiste. Vorher lag 8 px weiter innen der
    `gap` nach dem `::before`.
- **Das Layout hält durch einen Druck (`inputSession.ts`, `heldThroughPress`):**
  - Die Sitzungsregel bleibt unverändert: Der Helfer schließt beim `pointerdown`, wie mit dir
    vereinbart.
  - Was die Leiste ZEIGT, folgt erst, wenn der Druck vorbei ist, nach seinem Klick: App's
    `stripVis`, Setups `entryOpen` und das Einklappen von Safety.
  - Ende des Drucks:
    - nach dem Klick per Timer 0, der während des Klick-Dispatch eingereiht wird;
    - sofort bei `pointercancel` oder Fokusverlust des Fensters;
    - 500 ms nach einem Loslassen ohne Klick (gesperrte Taste, Wegrutschen);
    - 2 s ohne Loslassen (die Absicherung von `pointerActive`; ein Halten feuert bei 500 ms).
  - Nur ein SCHLIESSEN wartet. Ein Öffnen oder Wechseln wirkt sofort, sein Klick ist schon
    gelandet.
  - Die Helfer selbst hängen weiter direkt an der Sitzung, sie verschwinden also sofort. Da sie
    in Leserichtung zuletzt stehen, verschiebt das nichts links von ihnen.
- **Einklappen nach Messung (`safetyFold.ts`, App.vue):**
  - App misst die Spalte im Frame nach der Layoutänderung (rAF, vor dem Malen) und bei
    ResizeObserver-Meldungen von Leiste oder Abschnitten.
  - Gemessen werden: Inhalt gegen `clientHeight`, und solange die Infos eingeklappt sind, ihr
    zuletzt gemessener Zuwachs.
  - Rects werden durch das Rect/Offset-Verhältnis der Leiste geteilt, wegen der CSS-Zoom-Falle.
  - Ein Ausklappen wartet wie ein Schließen auf das Ende des Drucks, sonst rutschte der
    Besitzerabschnitt unter dem Finger nach unten.
  - `SafetyStrip` bekommt das Ergebnis als Prop `compact`.

## Was sich an vereinbarten Regeln ändert

- **UI-I08/D7, das Einklappen im Hochformat:** Bisher galt „Helfer offen“, jetzt „nur wo es
  nicht passt“. Das Kriterium selbst bleibt: der ganze Helfer bei 100 % und 150 % sichtbar, ohne
  Scrollen der Leiste.
- **UI-15a:** Unverändert. Das Schließen beim `pointerdown` bleibt. Neu ist nur, dass das Layout
  erst nach dem Druck folgt. Das ist dieselbe Begründung wie bei deiner Wechselregel („hiding on
  the pointerdown re-flowed the strip“), jetzt auch für das Verlassen.

## Wächter und Belege

- **`e2e/safety-during-edit.spec.ts`**, 35 Fälle, alle mit echtem Zeiger:
  - **Lage:** Safety am Start der Leiste, Abschnitt und Tasten bei 1280, 1920 und 2560 px
    unbewegt. Gilt für Tastatur, Ziffernblock eines Leistenfelds und Ziffernblock eines
    Seitenfelds. Der Helfer beginnt, wo Jog beginnt; der Besitzerabschnitt nimmt diesen Platz.
  - **Safety-Tasten:** Disarm, E-Stop und Power mit jedem Helfer, per Maus im Querformat und per
    Touch in Quer- und Hochformat. Sie senden `arm {armed:false}`, `estop` bzw.
    `machine_on`/`off`.
  - **Halten im Besitzerabschnitt:** 700 ms auf Home/Unhome X mit offenem Ziffernblock, im Quer-
    und Hochformat.
  - **Hochformat:** Infos bei 100 % mit jedem Helfer da. Bei 150 % eingeklappt für Tastatur und
    Leisten-Ziffernblock, für den Seitenfeld-Ziffernblock da (er passt). Der Helfer ist jeweils
    ganz sichtbar, die Safety-Tasten unbewegt.
- **Rot:** 26 von 35 Fällen gegen `729a7f4a` (`docs/reviews/safety-during-edit.browser-red.txt`
  im Worktree). Grün waren nur die neun Hochformat-Taps auf Safety, denn dort bewegte sich Safety
  nie.
- **Unit-Tests:**
  - `inputSession.test.ts`: die Enden des Drucks mit Fake-Timern; Öffnen und Wechseln sofort; der
    letzte Wert gewinnt.
  - `safetyFold.test.ts`: die Entscheidung.
- **Angepasst:** In `input-session.spec` behält der Hochformat-Budget-Test die Infos bei 100 %.
- **Frontend-Gate:** Lauf 1 PASS auf `47c2fc92`: Lint, Build, 2640 Unit-Tests, 643/643 Browser (`docs/reviews/safety-during-edit.gate-frontend.run1.json` im Worktree, Commit `3c24fbea`).
- **Operatorblick:** Der Operator hatte den Stand auf der LAN-Testsim (XYZAC, Worktree-Launcher). Am 29. Oktober kam die Freigabe ohne Einwand: „du kannst es zum review geben“. Die Testsim bleibt auf dem Branch laufen, damit weitere Eingaben live möglich sind.

## Offene Punkte, zu denen ich deine Sicht will

1. **Zeiten:** 500 ms ohne Klick und 2 s ohne Loslassen. Für einen Touch-Tap auf etwas, das kein
   Bedienelement ist (ohne `touch-action: manipulation`, Doppeltipp-Verzögerung rund 300 ms), sind
   500 ms knapp über dem Klick.
2. **Mehrere Zeiger:** Der Klick eines zweiten Fingers beendet das Halten früh. Im Strip ist dann
   nur der Besitzerabschnitt bedienbar, und der liegt mit offenem Helfer immer direkt rechts von
   Safety. Deshalb bewusst ohne Zähler.
3. **Langer Druck außerhalb der Leiste:** Ein Orbit-Ziehen im Viewer, begonnen bei offenem Helfer,
   hält die Leiste für die Dauer des Ziehens (Safety plus Leere). Das ist harmlos, sieht aber so
   aus.
4. **Weitere Layout-Abhängige der Sitzung:** `GcodePanel.compactEdit` hängt am Bearbeitungszustand
   des Editors, nicht an der Sitzung. Andere Leser von `activeKind` oder `keypadState.open`, die
   etwas verschieben, habe ich nicht gefunden (`OffsetPanel` und `MachineInput` nur
   Hervorhebung). Übersehe ich einen?
5. **Benannte Grenze:** Der erste Touch schaltet auf Touch-Größen um und legt die Leiste unter
   dem Finger neu an (bekannt seit D7, die Specs tippen zuerst neutral). Nicht Teil dieses Pakets.

**Bitte prüfen:** die Haltelogik gegen UI-15a und deine Wechselregel, das gemessene Einklappen
gegen UI-I08, die Wächter. Wenn das trägt, bitte `agreement`.
