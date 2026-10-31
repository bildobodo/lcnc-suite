# Scrub-Leiste nach echtem Gebrauch: eine Geschwindigkeit, der Zeit-Slot, eine Zeitform

## Claude · Umsetzung · Anfrage R237 · 31. Oktober 2026

**Branch `feat/scrub-polish`** (Worktree `~/lcnc-suite-scrub`), auf `development` `21c5364c`.
- Produkt, Wächter und Doku in `96a8bcbd`.
- Gate-Beleg in `5f1e7c1c`.
- Diff: `21c5364c..5f1e7c1c`.

### Anlass

Der Operator sah sich am 31. Oktober ein Zwei-Stunden-Programm auf der LAN-Test-Sim an
(`basify_zylinder_320x160x25.ngc`, „00:00/1:55:40“). Wie die Überarbeitung vom 29. Oktober ist das
ein Wunsch aus echtem Gebrauch unter dem Feature-Freeze vom 25. Oktober:

1. „beim sim tab die geschwindigkeitsauswahl entfernen“;
2. eine große Lücke dort, wo die Prozentanzeige erscheint: wofür, und lässt sie sich optimieren?
3. eine Klasse für die Auswahl in der Höhe der Play-Taste?
4. „bei den zeitreserven 00:00:00 haben, damit es klar ist wo der platz hingeht“;
5. wie das im Program- und im Sim-Tab aussieht.

Seine Lücke in den ×-Marken ist ein durchgehender Kontakt. × markiert den Beginn eines Kontakts,
das rote Band seine Dauer. Er hat das bestätigt; daran ändert sich nichts.

### Die Lücke rechts der Zeitleiste (gemessen, Desktop 1280)

121 px setzten sich so zusammen:
- halber Daumen und Abstand: 16;
- der Slot der Abdeckung („N %“), leer, sobald die Route abgedeckt ist: 52 + Abstand 8;
- **45 px im eigenen Slot der Zeit, die kein Text füllte.** Der Slot war in `ch` bemessen
  (`posSlotCh` = 2 · Länge der Gesamtzeit + 2, also 16 Zeichen für „~h:mm:ss/h:mm:ss“, je Zeichen
  eine Ziffernbreite). „:“ und „/“ sind in Inter aber viel schmaler: 13 Zeichen brauchten 83 px.

### Umsetzung

1. **`format.ts` · `fmtElapsedAs(s, total)`:** eine Zeit in der Form der Gesamtzeit.
   - Unter einer Stunde wie bisher `mm:ss`.
   - Ab einer Stunde `h:mm:ss`, mit so vielen Stundenziffern wie die Gesamtzeit: „0:00:00/1:55:40“;
     bei 30 h „00:00:00“.
   - Eine Zeit über die Form hinaus (ein Lauf länger als seine Schätzung) zeigt ihre eigenen Stunden.
2. **`ScrubBar.vue`, der Zeit-Slot:** Er ist ein `.stable-width`-Feld, das bestehende globale
   Muster. Das sichtbare Feld hat die aktuelle Anzeige, das verborgene `.alt` die breiteste Anzeige
   des Programms (`posWidest`):
   - während eines Laufs mit „~“;
   - die verstrichene Zeit in der Form der Gesamtzeit;
   - mit „+“, wo die Zeit ein unbekanntes Ende hat (Probe-Stopps, `depTime`).

   Der Browser bemisst den Slot also aus dem Text selbst. Die Zeitleiste bewegt sich weiterhin
   weder beim Scrubben noch beim Start eines Laufs.
   - **Eine Tücke:** Jedes Kind der Zelle ist ein Flex-Container. Zwei Flex-Elemente (Zeit und
     `.posRest`) lesen sich in `innerText` als zwei Zeilen. Jede Anzeige steckt deshalb in **einer**
     Inline-Spanne.
   - **Schmale Form:** `.posRest` bleibt verborgen, also nur die verstrichene Zeit; das `.alt` hat
     dort dieselbe Regel. Die `--slot-w-narrow`-Zuweisung im Container-Query ist entfallen.
3. **Der Abdeckungs-Slot bleibt**, wie er ist: 52 px gegen 50 für „100 %“ samt Zeichen. Ein
   `.stable-width` brächte 2 px und hätte sechs Testlesungen auf `useInnerText` umgestellt. Ich habe
   das zurückgenommen.
4. **`SimPanel.vue`:** Die eigene Geschwindigkeitsauswahl ist entfernt, samt `speed`-Computed,
   Beschriftung, `denseArea` am Kopf und CSS. Die Leiste hat die eine Geschwindigkeit
   (`simView.speed`). Der Eintrag in `controlInventory.ts` ist entfernt, die Begründung des
   SimPanels angepasst.
5. **Eine Zeitform je Programm:**
   - die Leiste und der Kopf des Sim-Tabs (`posLabel`, `posNow`);
   - die Zeitspalte des Sim-Tabs (`simRows.ts`, `at` in der Form von `axisEnd`). Bisher stand dort
     „59:13“ neben „1:39:21“, jetzt „0:59:13“;
   - die Laufuhr im Program-Tab (`App.vue`, `elapsedDisplay` gegen `gcodeStats.totalTime`).
6. **`Btn.vue`:** `:where(.scrubBar) .b { min-height: var(--control-h); }`.
   - Play und der Sim-Tab-Link waren auf dem Desktop durch ihr `sm`-Padding 26 px hoch, neben der
     28-px-Auswahl (kompaktes `--control-h` der `.denseArea`). Mit Touch hatten alle drei schon 36.
   - Das steht in Btn.vue und nicht an der Klasse des Aufrufers: Die Klasse einer gedimmten Taste
     landet auf ihrem `.btnTip`-Wrapper.
   - Eine kleinere Feldklasse gibt es mit Absicht nicht: eine Feldhöhe je Dichte.

### Gemessen (vorher → nachher, Desktop 1280, Zwei-Stunden-Programm)

| | vorher | nachher |
|---|---|---|
| Raum rechts der Zeitleiste | 121 px | 76 px |
| Zeitleiste | 534 px | 563 px |
| Play / Link / Auswahl | 26 / 26 / 28 | 28 / 28 / 28 (Touch 36 / 36 / 36) |
| Leiste | „00:00/1:58:01“ | „0:00:00/1:58:01“ |
| Sim-Tab-Kopf | „entry · 00:00/1:58:01“ | „entry · 0:00:00/1:58:01“ |
| Sim-Tab, Zeitspalte | „59:13“, „1:39:21“ | „0:59:13“, „1:39:21“ |
| Program-Tab, Laufuhr | „00:00“ | „0:00:00“ |

Von den verbleibenden 76 px sind 60 der leere Abdeckungs-Slot samt Abstand. Ob er nach der Prüfung
verschwinden soll, frage ich den Operator. Dann bekäme die Zeitleiste +60 px, ihr Ende würde sich
aber am Start und Ende jeder Prüfung verschieben, nie unter einem Druck (`heldThroughPress`).
Diese Runde enthält das nicht.

### Grenze

Läuft ein Programm so weit über seine Schätzung, dass die Stunden eine Ziffer mehr brauchen (9:59
geschätzt, 10:00:01 gelaufen), wird die Anzeige breiter als das `.alt`. Das Feld wächst dann mit,
statt abzuschneiden, und das Ende der Zeitleiste rückt einmal. Vorher hätte der feste `ch`-Slot den
Text abgeschnitten.

### Wächter und Belege

- **Unit (`format.test.ts`):** `fmtElapsedAs`:
  - unter einer Stunde: `00:00`, `12:34`;
  - Zwei-Stunden-Form: `0:00:00`, `0:59:13`, `1:39:21`;
  - 30 h: `00:00:00`, `01:00:00`;
  - über die Form hinaus: `10:00:00`, `1:00:00`.
- **Browser (`sim-panel.viewer.spec`, serial-viewer):**
  - **„the speed beside Play is the ONE speed“:** genau ein `select` im Sim-Tab, sein Listenfilter;
    keine „Playback speed“-Combobox dort.
  - **„Play and the Sim tab link as tall as the speed select, live and dimmed“:** Desktop und
    Touch quer.
  - **„a two-hour program“:**
    - die Leiste liest `0:00:00/1:5x:xx`;
    - der Slot ist so breit wie der Text der Laufanzeige mit „~“, gemessen an einer verborgenen
      Messspanne, ± 1 px;
    - der Sim-Tab-Kopf entspricht der Leiste, die Zeitspalte hat `h:mm:ss`;
    - die Program-Tab-Uhr zeigt „0:00:00“.
- **`select-writes.spec`:** Der Fall heißt jetzt „the Simulation tab's list filter and the bar's
  speed while the simulation plays“. Er beobachtet die Auswahl der Leiste, gesehen werden „Playback
  speed“ und „Show on the list“.
- **Rot gegen `21c5364c`,** Produktänderungen herausgenommen: 3 von 4
  (`docs/reviews/scrub-polish.browser-red.txt`). Grün war schon die Touch-Höhe, die heute hält.
- **Visuelle Referenzen:** unverändert, 10/10.
- **Frontend-Gate, Lauf 1, PASS bei `96a8bcbd`:** Lint, Build, 2662 Unit-Tests, 783/783 Browser
  (`docs/reviews/scrub-polish.gate-frontend.json`).

### Bitte prüfen

- `fmtElapsedAs` und seine drei Aufrufer: eine Form je Programm, kein Mischen in einer Spalte;
- den `.stable-width`-Zeit-Slot: Hält er die Zeitleiste in jedem Zustand still? Zustände: Scrub,
  Laufstart, „+“, schmale Form;
- die Höhenregel in Btn.vue, auch gedimmt;
- dass mit der Sim-Tab-Auswahl nichts verloren ging, was nur sie bediente.

Wenn das trägt, bitte `agreement`.


## Codex · Implementierungsreview R237 · 31. Oktober 2026

**Stand:** `feat/scrub-polish`, `21c5364c..5f1e7c1c`. **Urteil: findings.**
Die eine Geschwindigkeitswahl und die angeglichenen Höhen sind abgenommen.
Bei den beiden Zusagen zum Zeitfeld bleiben zwei kleine, reproduzierbare Darstellungsreste.
Keine zusätzliche Operator-Entscheidung erforderlich.

### SP-01 · P3 · Die Gesamtzeit ist nicht immer die breiteste Anzeige

`lcnc-webui/src/ScrubBar.vue:686–689` verwendet für das verborgene Breitenmuster
`~Gesamtzeit/Gesamtzeit`. Das hält die Breite beim geprüften Scrubben, umfasst aber nicht
alle Laufanzeigen. Trotz `tabular-nums` misst Chromium mit der gebündelten Schrift z. B.
`~1:56:00/1:56:00` mit **101 px**, `~0:00:00/1:56:00` mit **102 px**.
Auch die Zusatzmessung mit ausgeschaltetem Kerning beseitigt die Differenz nicht.

Die Gegenprobe setzt nach dem Scrubben die Position wieder auf null und meldet am Mock den
Laufstart. Vorschau und Gesamtzeit bleiben dabei identisch:

| Anzeige | Slot vor → nach Laufstart | Zeitleistenbreite vor → nach |
|---|---:|---:|
| `00:00/01:56` → `~00:00/01:56` | 79 → 80 px | 583 → 582 px |
| `0:00:00/1:56:00` → `~0:00:00/1:56:00` | 101 → 102 px | 561 → 560 px |
| `00:00:00/30:00:00+` → mit `~` | 124 → 125 px | 538 → 537 px |
| schmal, 150 %, `00:00:00` → `~00:00:00` | 84 → 85 px | 213 → 212 px |

Die Tabelle nennt `getBoundingClientRect()`-Werte; die letzte Zeile enthält den Zoom.
Das ist ein kleiner Layoutfehler, ohne abgeschnittene Anzeige oder verlorene Bedienfunktion.
Die Zusage „beim Start eines Laufs bleibt die Zeitleiste stehen“ ist damit noch nicht erfüllt.
Der bisherige Zwei-Stunden-Wächter erlaubt genau diese Abweichung durch seine ±1-px-Toleranz
und vergleicht keine tatsächlichen Zustandswechsel.

**Vorschlag:** Das verborgene Muster bzw. seine festgelegte Breite muss eine nachgewiesene
Obergrenze der möglichen Anzeigen dieser Schrift und Zeitform reservieren. Eine kleine Reserve
am Breitenmuster ist vertretbar. Den Wächter vom gleichen Zeitstand vor dem Start bis zur
sichtbaren `~`-Anzeige führen, bei unveränderter Vorschau; schmale Form und `+` einschließen.

### SP-02 · P3 · An der Stundengrenze teilen Program und Sim noch keine Zeitform

`App.vue:971–972` entscheidet die Stundenform aus `gcodeStats.totalTime`.
`ScrubBar.vue:675–689` und `viewer/simRows.ts:97–100` entscheiden sie aus der Dauer der
angezeigten Bahn, einschließlich einer eingefügten Anfahrt. Diese Grundlagen können auf
verschiedenen Seiten einer Formgrenze liegen.

Gegenprobe: Programmdauer **3580 s (59:40)**, Anfahrt **50 s**. Beim Eintritt in Sim ergibt
sich eine angezeigte Gesamtdauer von **3630 s (1:00:30)**. Gleichzeitig stehen dort:

- Leiste und Sim-Kopf: `0:00:00/1:00:30`;
- Sim-Zeitspalte: etwa `0:13:10`, `0:33:45`;
- Program-Laufuhr und Safety-Elapsed: `00:00`.

Die unterschiedlichen Zeitwerte der Laufuhr und der Vorschau sind sachlich richtig.
Die angefragte gemeinsame **Form je Programm** fehlt hier jedoch. Der normale Zwei-Stunden-Fall
prüft diesen Unterschied der Grundlagen nicht, weil beide bereits die Stundenform wählen.

**Vorschlag:** Eine gemeinsame Formatentscheidung für das geladene Programm führen,
unter Berücksichtigung der angezeigten Vorschau einschließlich Anfahrt. Beide Uhren behalten
ihre eigenen Werte und teilen die Stellenform. Die Entscheidung sollte innerhalb derselben
Programmversion beim Ein-/Austritt in Sim stabil bleiben. Einen Wächter über die Stundengrenze
mit Anfahrt ergänzen.

### Übrige Prüfpunkte und Grenzen

- `fmtElapsedAs` formatiert die geprüften ganzzahligen Zeiten korrekt: kurze Programme,
  Stunden, zweistellige Stunden und Überschreitung der Schätzung. Die vollständige Anzeige
  bei Überschreitung der vorgesehenen Stundenziffern ist sinnvoll. SP-01 tritt schon bei
  null Sekunden innerhalb der Schätzung auf.
- Die entfernte Sim-Auswahl schrieb denselben `simView.speed` wie die Leiste. Die verbliebene
  Auswahl arbeitet während der Wiedergabe; keine nur dort verfügbare Geschwindigkeitsfunktion
  gefunden. Listenfilter und Navigation bleiben erreichbar.
- Play, Link und Auswahl sind im Desktop sowie mit Touch gleich hoch, einschließlich der
  gedimmten Buttons mit Wrapper. Die Regel am eigentlichen Button trägt.
- Die schmale Form blendet den Gesamtzeitteil auch im Breitenmuster aus; `+` bleibt in der
  vollständigen Anzeige enthalten. Beim Scrubben der vier eigenen Fälle blieb die Leiste stabil.
- Der unveränderte Abdeckungs-Slot und seine spätere Operator-Frage gehören weiterhin nicht
  zu dieser Änderung.

### Eigene Prüfung und Belege

Ausschließlich Archivkopie von `5f1e7c1c`, eigener Mock `127.0.0.1:4188`, Chromium,
ein Browser-Worker. Keine Builds/Tests in den ausgelieferten Worktrees, kein Zugriff auf
`:5173`/`:8000`, keine Maschinenbefehle. Alle **409 Produktdateien unter `lcnc-webui/src`**
in der Testkopie abschließend bytegleich zum Commit; eigener Mock beendet.

- Build **PASS**; betroffene Unit-Suiten **21/21 PASS**.
- Ausgewählte Repository-Browserprüfungen **14/14 PASS**: Geschwindigkeitswahl während
  Wiedergabe, ×100, Buttonhöhen, Zwei-Stunden-Form, unbekannte Messung, Kontrast und
  150-%-Hochformat mit kurzen/langen Programmen.
- Finale eigene Probe: **5 erwartungswidrig rote Fälle / 1 grüne Diagnose**.
  Vier rote Fälle belegen SP-01, einer SP-02; keine Infrastrukturfehler.
  Kein vollständiger Gate-Neulauf und keine Aussage zu anderen Browsern.

Reproduzierbare [Sonde](scrub-polish.r237.probe.spec.ts),
[isolierte Playwright-Konfiguration](scrub-polish.r237.playwright.config.ts),
[Browserprotokoll](scrub-polish.r237.browser.txt),
[Messwerte einschließlich Schriftbreiten](scrub-polish.r237.results.json),
[Build/Unit/Repository-Prüfungen und Ablauf](scrub-polish.r237.checks.txt),
[Bild der unterschiedlichen Stundenform](scrub-polish.r237.hour-boundary.png).
