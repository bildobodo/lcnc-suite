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

## Codex · Implementierungsreview · R231 · 30. Oktober 2026

**Ergebnis: `findings` — Diagonalnamen und Jog-Hilfe abgenommen; beim ersten Touch bleibt ein Rückschritt offen (LO-01).** Geprüft ist `f14c2ec3..a6e201ea`, einschließlich des gemergten Scrub-Bar-Stands. Keine Operator-Entscheidung erforderlich.

### LO-01 · P2 · Der erste Touch muss das Eingabeverhalten sofort umstellen, auch wenn die Größen noch warten

`lcnc-webui/src/touchDetect.ts:22–39` verzögert zusammen mit der CSS-Klasse auch `isTouchDevice`. Diese Variable steuert aber nicht nur Größen: `MachineInput.vue:139–142` setzt damit `inputmode="none"`, um bei Touch-Eingaben über die Strip-Tastatur die Betriebssystem-Tastatur zu unterdrücken. Beim ersten Touch erhält das Textfeld seinen Fokus **vor** dieser Umschaltung.

**Eigene Reproduktion mit echten Browser-Taps, ohne synthetischen Fokus:** Eine frische Sitzung zunächst per Maus auf MDI bzw. Tools umschalten, dann den ersten Touch direkt ins MDI- bzw. Suchfeld setzen. Ein Listener am betreffenden Feld protokolliert sein `focus`-Ereignis:

| Stand / Feld | `inputmode` beim Fokus | Touch-Klasse beim Fokus | `inputmode` nach der Umschaltung |
| --- | --- | --- | --- |
| `a6e201ea`, MDI | fehlt (`null`) | nein | `none` |
| `a6e201ea`, Search tools | fehlt (`null`) | nein | `none` |
| `f14c2ec3`, MDI, identische Sonde | `none` | ja | `none` |

Damit fehlt die bisherige Unterdrückung genau beim ersten Fokuserhalt; ein späteres Setzen nach dem Klick ersetzt diesen Vertrag nicht. Die Strip-Tastatur öffnet sich am neuen Stand trotzdem. **Nachweisgrenze:** Headless Chromium zeigt keine mobile Betriebssystem-Tastatur; nachgewiesen ist der falsche Feldzustand beim echten Fokus, nicht ein gefilmtes OS-Tastaturfenster. Der zweite Basisvergleich (Search tools) scheitert schon davor: Im alten Stand öffnet der erste Tap den Helfer nicht. Diesen Lauf werte ich ausdrücklich nicht als grünen Fokusvergleich; der unveränderte MDI-Vergleich belegt den Rückschritt.

**Vorschlag:** Touch-Eingabe und angewandte Touch-Größen getrennt führen, oder das Eingabeverhalten direkt am Touch-Ereignis entscheiden. Die Unterdrückung der OS-Tastatur muss vor dem ersten Fokus greifen; nur Größen und andere Layoutänderungen warten bis nach dem Druck/Klick. Dabei nicht einfach `isTouchDevice` vorziehen: `GcodePanel.vue:237–242` leitet seine virtuelle Zeilenhöhe daraus ab und muss weiter mit der tatsächlich angewandten CSS-Größe übereinstimmen. Auch die übrigen Touch-Verbraucher (Editor, Glyph, Tool-Preview) bei dieser Trennung nach Funktion zuordnen.

**Wächter für die Korrektur:** Die beiden Fokusfälle aus der beiliegenden Sonde müssen am neuen Stand grün werden, ohne die bestehenden Druck-/Mehrzeigerfälle zu verlieren. Keine neutrale erste Berührung als Vorbedingung einbauen.

### Was trägt

- Die vier zugänglichen Diagonalnamen stimmen mit den tatsächlich gesendeten Achsen und Vorzeichen überein. Meine Sonde prüft für jeden Namen `jog_cont_multi` und die zugehörigen Achsen; die bisherigen Gelenkbeschreibungen bleiben erhalten.
- Das neue „?“ ist im Hochformat bei 100 % und 150 % erreichbar. Auch als **erster Touch** öffnet es den vollständigen Hinweis ohne Maschinenbefehl; der Popover bleibt im sichtbaren Bereich. Das [Bild bei 150 %](leftovers.r231.help-portrait-150.png) wurde visuell geprüft.
- Die Verzögerung der **Größen** funktioniert in den geprüften Fällen: erster Druck auf Disarm, E-Stop und Power bleibt bis zur Freigabe am selben Ort und sendet genau einen passenden Befehl. Der erste Druck mit einem zusätzlichen Finger hält die Größen auch nach dessen Freigabe weiter zurück. Der vorhandene Home-X-Wächter und die bisherigen langen/mischten Druckfolgen sind ebenfalls grün.
- Die benannte Abwägung beim ersten Orbit-Ziehen akzeptiere ich: Die Größen wechseln erst nach dem Ende der Geste. Die vorhandenen neutralen Vorbereitungstaps können für Tests anderer Themen bleiben; die neuen Erst-Touch-Wächter müssen sie gezielt vermeiden.

### Eigene Prüfung und Belege

Alle Builds und Tests liefen in eigenen Archivkopien unter `/tmp/codex-r231-jezxg0l0/`, auf einem eigenen Mock `127.0.0.1:4188`, seriell. Kein Zugriff auf die LAN-Testsim, keine Maschinenbefehle an eine Sim, keine Tests/Builds/Checkouts oder Produktänderungen in den bereitgestellten Worktrees. Der eigene Mock ist beendet.

- Build `a6e201ea`: **PASS** ([Log](leftovers.r231.build.txt)); gezielte Units `inputSession` und `jointJog`: **20/20** ([Log](leftovers.r231.unit.txt)).
- Repository-Browserfälle `joint-jog.spec.ts` und `safety-during-edit.spec.ts`: **51/51** ([Log](leftovers.r231.repository-browser.txt)).
- Eigene Gegenproben: **sieben positive Fälle grün**, MDI-Fokus rot ([erster Lauf](leftovers.r231.codex-browser.txt)); anschließend beide gezielten Fokusfälle MDI/Search tools **rot** ([Log](leftovers.r231.focus-head.txt)). Der zweite Lauf erweitert die Fokusprobe auf Search tools und protokolliert auch den späteren Feldzustand; die sieben positiven Fälle wurden nicht nochmals ausgeführt.
- Unveränderte Fokussonde gegen eine vollständige Archivkopie von `f14c2ec3`: MDI **grün**; Search tools scheitert zuvor am nicht geöffneten Helfer, wie oben abgegrenzt ([Log](leftovers.r231.focus-baseline.txt), [Basis-Build](leftovers.r231.baseline-build.txt)).
- Reproduzierbare [Sonde](leftovers.r231.probe.spec.ts), [Playwright-Konfiguration](leftovers.r231.playwright.config.ts), Browser-Traces für [MDI](leftovers.r231.mdi-focus.trace.zip) und [Search tools](leftovers.r231.tools-focus.trace.zip), [Stände und Prüfsummen](leftovers.r231.manifest.json).

Zum Wiederholen: Archiv des gewünschten Stands erstellen, Abhängigkeiten installieren bzw. unverändert übernehmen, Produkt bauen; danach die Sonde als `lcnc-webui/e2e/r231-codex.spec.ts` und die Konfiguration als `playwright.r231.config.ts` kopieren. `e2e/ctl.ts` in der Kopie auf `127.0.0.1:4188` richten; Mock mit `MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs` starten. `npx playwright test --config playwright.r231.config.ts e2e/r231-codex.spec.ts --grep 'first touch into'` führt die beiden LO-01-Wächter aus. Für alle Fälle den `--grep`-Filter weglassen und den Bild-Ausgabepfad der Sonde an das eigene temporäre Verzeichnis anpassen.
