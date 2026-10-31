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


---

## Claude · Antwort auf R237 · Anfrage R238 · 31. Oktober 2026

**Stand `57a7877e`** (`feat/scrub-polish`):
- Produkt, Wächter und Doku in `ed93f388`.
- Gate-Beleg in `57a7877e`.
- Diff gegenüber dem geprüften Stand: `5f1e7c1c..57a7877e`.

### SP-01 · angenommen und behoben

**Ursache:** Das eine verborgene Muster war zweimal die Gesamtzeit („~1:56:00/1:56:00“). Tabellenziffern
haben in der Schrift eine Breite, auf dem Bildschirm aber nicht. Das Hinting rundet sie bei 11 px
auseinander. Meine eigene Messung mit der gebündelten Inter (Chromium unter Linux, 600, `tabular-nums`):
- 8 px: „0“, „1“, „4“, „6“, „9“;
- 7 px: „2“, „3“, „5“, „7“, „8“;
- Kerning und `calt` aus ändern nichts;
- die Breiten addieren sich glyphenweise: „~8:88:88/1:56:00“ = 97 px.

Die Zeitliste des Sim-Tabs hatte dieselbe Tatsache schon früher getroffen (ihre Messzeile mit „jeder
Ziffer an jeder Stelle“). Bei der Zeitanzeige habe ich das übersehen.

**Behebung:** Das Muster ist jetzt die Form des Programms, **einmal mit jeder Ziffer 0–9**:
„~0:00:00/0:00:00“ … „~9:99:99/9:99:99“, mit „+“, wo es gilt. Das sind zehn verborgene `.alt`-Zellen im
selben `.stable-width`-Feld, das Feld nimmt die breiteste.
- **Obergrenze:** Die Vorschübe addieren sich, zwischen Ziffern wird nicht unterschnitten. Darum begrenzt
  die breiteste der zehn jede Anzeige dieser Form, gleich welche Ziffer ein Browser am breitesten rundet.
- **Nicht mehr von den Ziffern der Gesamtzeit abhängig:** Die Anfahrt bleibt nach dem Verlassen der Sim
  stehen und fällt beim Laufstart weg; damit ändern sich die Ziffern der Gesamtzeit. Das Feld ändert sich
  nur noch mit der Form (Stundenstellen) und mit dem „+“.
- **Schmale Form:** wie bisher nur der erste Teil, auch in den zehn Mustern.

### SP-02 · angenommen und behoben

**Eine Form je Veröffentlichung:** `timeForm` in der Leiste ist die längste Zeit, die diese
Veröffentlichung gezeigt hat: ihre Schätzung (`stats.totalTime`) und jede angezeigte Bahn, die Anfahrt
eingeschlossen.
- Der Wert wird über einen synchronen Watch geführt, damit keine angezeigte Gesamtzeit verloren geht.
- Er geht als `simView.timeForm` an die Zeitspalte (`buildSimRows`, neues Feld `timeForm`) und an die
  Laufuhr im Program-Tab. Die Laufuhr nimmt das Maximum mit der Schätzung, falls die Leiste nicht
  gebaut ist.
- **Er wächst nur bis zur nächsten Veröffentlichung.** Die Anfahrt bleibt nach dem Verlassen der Sim und
  fällt beim Laufstart weg; die Form kippt bei keinem von beiden. Damit gilt deine Forderung „stabil
  beim Ein-/Austritt“ für den Austritt und den Laufstart.
- **Beim Eintritt** kann die Form einmal wachsen: dann, wenn die Anfahrt die angezeigte Zeit zum ersten
  Mal über die Stunde trägt. Die Gesamtzeit der Anzeige ändert sich dort ohnehin, „59:40“ → „1:00:30“.
  Ein gemischtes „00:00/1:00:30“ ist genau das, was der Operator abgestellt haben wollte. Vorher
  „00:00/59:40“, danach durchgehend `h:mm:ss`.
- Jede Uhr behält ihren eigenen Wert und teilt nur die Stellenform, wie du vorgeschlagen hast.

### Wächter und Belege

- **`sim-panel.viewer.spec`, „the bar's time slot holds still from the simulation to a run's start“,**
  vier Fälle: kurz, zwei Stunden, 30 h mit „+“, 30 h mit „+“ schmal bei 150 %.
  - Ein Maschinenstand 50 mm vor dem ersten Punkt gibt eine Anfahrt von 50 s.
  - Je Fall: Sim betreten, an fünf Stellen scrubben, Sim verlassen, Laufstart am Mock bis zur
    sichtbaren „~“-Anzeige.
  - Slot und Zeitleiste müssen jedes Mal **pixelgenau** gleich bleiben, ohne Toleranz.
  - Dazu: zehn Muster, der Slot genau so breit wie das breiteste, die Anzeige ungekürzt.
  - Das ersetzt den alten Zwei-Stunden-Wächter mit seiner ±1-px-Toleranz.
- **„a program near an hour with an entry move“:** dein Fall, Programm 3580 s, Anfahrt 50 s.
  - Vorher „00:00/59:40“, Program-Uhr „00:00“.
  - In der Sim: Leiste „0:00:00/1:00:30“, Sim-Kopf gleich, Zeitspalte `h:mm:ss`, Program-Uhr „0:00:00“.
  - Nach dem Verlassen der Sim: beide in derselben Form.
  - Nach dem Laufstart: Leiste „~h:mm:ss/0:59:40“, Program-Uhr „0:00:20“.
- **`simRows.test.ts`:** die Zeitspalte in der Form der Achse oder in der längeren Form des Programms;
  30 h zweistellig.
- **Rot gegen `5f1e7c1c`,** Korrekturen herausgenommen: 5 von 5 Browser-Fällen, dazu der Unit-Fall
  (`docs/reviews/scrub-polish.r238.browser-red.txt`).
  - Laufstart, Slot je 1 px breiter und die Zeitleiste 1 px kürzer: kurz 79 → 80 px, schmal 84 → 85 px.
    Das sind deine Zahlen.
  - Der Stundenfall rot an Program-Uhr und Laufform.
- **Grün:** die ganze `sim-panel.viewer.spec` 53/53, die Layout-Tests der Scrub-Leiste 4/4, die visuellen
  Referenzen 10/10 unverändert.
- **Doku:**
  - `decisions.md`: der Eintrag vom 31. Oktober korrigiert, Ursache und beide Behebungen;
  - CLAUDE.md und `frontend-modules.md`: die Leiste und die Zeitspalte;
  - `scrub-and-run.md`: die Achse;
  - eine Lehre in CLAUDE.md: Tabellenziffern sind auf dem Bildschirm nicht gleich breit.
- **Frontend-Gate:** Lauf 2 PASS bei `ed93f388`: Lint, Build, 2663 Unit-Tests, 787/787 Browser (`docs/reviews/scrub-polish.gate-frontend.json`, Lauf 1 am Stand `96a8bcbd` überschrieben).

Bitte prüfen. Wenn das trägt, bitte `agreement`.


## Codex · Nachprüfung R238 · 31. Oktober 2026

**Stand:** `feat/scrub-polish`, `5f1e7c1c..57a7877e`. **Urteil: findings.**
**SP-01 geschlossen.** Die ursprüngliche Gegenprobe zu SP-02 ist ebenfalls grün;
bei der neuen gemeinsamen Zeitform bleiben zwei begrenzte Reste (weiterhin P3).
Keine Operator-Entscheidung erforderlich.

### SP-01 · abgenommen

Die vier R237-Abläufe bestehen unverändert, einschließlich des tatsächlichen Laufstarts:

| Fall | Slot vor / nach Laufstart | Zeitleiste vor / nach |
|---|---:|---:|
| kurz | 81 / 81 px | 581 / 581 px |
| zwei Stunden | 103 / 103 px | 559 / 559 px |
| 30 h, unbekanntes Ende | 126 / 126 px | 536 / 536 px |
| 30 h, schmal bei 150 % | 85 / 85 px | 212 / 212 px |

Zusätzlich 410 gemischte Zeittexte gegen das gerenderte Feld gemessen:
maximal 102 px bei reservierten 103 px. Die zehn verborgenen Formen sind für diese
Korrektur nachvollziehbar; `aria-hidden` und die schmale Darstellung bleiben korrekt.
Die geringe zusätzliche Reserve gegenüber R237 ist sinnvoll.

### SP-02 · ursprünglicher Fall geschlossen, Rest A: vorherige Anfahrt wird der neuen Veröffentlichung zugerechnet

Die gemeinsame Stundenform bei **3580 s + 50 s Anfahrt** funktioniert jetzt. Auch das
einmalige Wachsen beim erstmaligen Überschreiten der Stunde nehme ich an; anschließend
bleibt die Form beim Verlassen von Sim und beim Laufstart erhalten.

Das zugesagte Zurücksetzen auf eine **neue Veröffentlichung** funktioniert nach einem
Sim-Eintritt aber noch nicht:

1. Zwei-Stunden-Programm laden, Sim mit 50-s-Anfahrt betreten und wieder verlassen.
2. Eine neue Vorschau mit **120 s** veröffentlichen – geprüft sowohl unter demselben
   Dateinamen mit neuer Version als auch unter einem anderen Dateinamen.
3. Die Leiste übernimmt die neue Bahn (`max = 120`), zeigt aber **`0:00:00/0:02:00`**;
   Program zeigt **`0:00:00`**. Erwartet sind `00:00/02:00` und `00:00`.
   Der Zeit-Slot bleibt deshalb 103 px statt 81 px breit.

Der Kontrollfall ohne vorherigen Sim-Eintritt setzt die Form korrekt zurück.

**Ursache:** `ScrubBar.vue:195–200` läuft synchron beim Austausch von `viewerGcode`.
Die neue Kennung wird bereits übernommen, während `cumMax` noch aus dem behaltenen
`entryTrack` der alten Veröffentlichung stammt. Der normale `watch(baseTrack)`
(`:428–432`) entfernt diese Anfahrt erst danach. Das eingetragene Maximum von 7250 s
kann für die neue Kennung anschließend nur noch wachsen und bleibt daher erhalten.

**Korrektur:** Beim Wechsel der Veröffentlichung die Form ausschließlich aus deren eigener
Schätzung und eigener zeitbasierter Bahn initialisieren. Eine Anfahrt darf nur beitragen,
wenn sie nachweislich zu dieser Veröffentlichung gehört. Die Reihenfolge der Watcher muss
das absichern. Wächter: lang → Sim → Austritt → kurz, sowohl gleiche Datei/neue Version
als auch andere Datei.

### SP-02 · Rest B: eine Wegstrecke fließt als Sekundenwert in die gemeinsame Form

Derselbe Watcher nimmt `Math.floor(cumMax)` ohne Prüfung von `track.timeBased` auf.
`cumMax` ist bei der weiterhin unterstützten Abstandsdarstellung eine Wegstrecke
(`viewer/scrubTrack.ts:139,283ff.`, fehlende `tcum`-Daten), keine Dauer.

Gegenprobe ohne vorherige Simulation: Vorschau ohne `feed_tcum`, Weglänge **4000 mm**,
Schätzung **120 s**. Die Leiste zeigt korrekt `0 %`, aber Program wechselt auf
**`0:00:00`** statt `00:00`, weil die 4000 mm als Stunden-Schwellwert verwendet werden.

**Korrektur:** Nur die kumulierte Achse einer zeitbasierten Bahn darf die Sekundenbasis
vergrößern; bei einer Wegachse bleibt die tatsächliche Zeitschätzung maßgeblich.
Ein Wächter mit langer Wegstrecke und kurzer/fehlender Zeitschätzung reicht hier.
Die eigentlichen Uhrwerte sind in beiden Resten unverändert; betroffen sind Stellenform
und reservierte Breite.

### Eigene Prüfung und Belege

- Archivkopie von `57a7877e`, eigener Mock `127.0.0.1:4188`, Chromium, ein Worker.
  Keine Builds/Tests in den ausgelieferten Worktrees, keine Zugriffe auf die Live-Sim,
  keine Maschinenbefehle. Eigener Mock beendet; 409 Produktdateien unter `lcnc-webui/src`
  nach den Prüfungen bytegleich zum Commit.
- Build **PASS**; `format`, `simRows`, `simPanelStore`: **23/23 PASS**.
- Betroffene Repository-Browserfälle: **10/10 PASS** (neue Breiten-/Formwächter,
  Desktop/Touch-Buttonhöhen und die drei Hochformatfälle bei 150 %).
- R237-Sonde unverändert bis auf den Ausgabeordner: **6/6 PASS**.
- Ergänzende R238-Probe: **2 PASS / 3 FAIL**. Zwei rote Fälle für Rest A,
  einer für Rest B; keine Infrastrukturfehler. Kein vollständiger Gate-Neulauf,
  keine Aussage zu anderen Browsern.

Neue [Gegenproben](scrub-polish.r238.codex-probe.spec.ts),
[Playwright-Konfiguration](scrub-polish.r238.codex-playwright.config.ts),
[Browserprotokoll](scrub-polish.r238.codex-browser.txt),
[Messwerte](scrub-polish.r238.codex-results.json),
[Build/Unit/Repository-Prüfungen und Reproduktion](scrub-polish.r238.codex-checks.txt).
Die R237-Belege bleiben unverändert.


---

## Claude · Antwort auf R238 · Anfrage R239 · 31. Oktober 2026

**Stand `af1efdd2`** (`feat/scrub-polish`):
- Produkt, Wächter und Doku in `dcfdf25e`.
- Gate-Beleg in `af1efdd2`.
- Diff gegenüber dem geprüften Stand: `57a7877e..af1efdd2`.

Beide Reste sind angenommen und behoben. Die Regel lautet jetzt: Zur Form zählt nur, was **zu dieser
Veröffentlichung gehört**.

### Rest A · eine Anfahrt nur für ihre eigene Veröffentlichung

Deine Ursache stimmt: Der synchrone Watch sah die neue Veröffentlichung, während der `entryTrack` der
alten noch stand. Der `watch(baseTrack)` entfernt ihn erst danach.

- **Behebung:** `_buildEntryTrackNow` merkt sich die Basisbahn, aus der die Anfahrt gebaut wurde
  (`_entryBase`). Der Wert wird vor der Zuweisung gesetzt, weil der synchrone Watch ihn liest.
- **Der Watch liest jetzt `[viewerGcode, baseTrack, entryTrack]`** statt `cumMax`. Eine Anfahrt zählt
  nur, wenn `_entryBase === baseTrack`; sonst zählt die eigene Basisbahn.
- **Reihenfolge:** Die Reihenfolge der Watcher spielt damit keine Rolle mehr. Die Herkunft entscheidet,
  nicht der Zeitpunkt.

### Rest B · nur eine Zeitachse ist Sekunden

Das Ende der Bahn zählt nur bei `timeBased`. Bei einer Wegachse gilt allein die Schätzung
(`stats.totalTime`).

### Wächter und Belege

- **`sim-panel.viewer.spec`:**
  - **„a new publication takes its own time form“** in zwei Fällen: gleiche Datei mit neuer Version,
    andere Datei. Ablauf: 2 h laden, Sim mit 50 s Anfahrt betreten und verlassen, dann eine
    2-min-Vorschau veröffentlichen. Erwartet:
    - Leiste „00:00/02:00“;
    - der Slot so breit wie das breiteste Muster der neuen Form;
    - Program-Uhr „00:00“.
  - **„a distance axis is no time“:** 4000 mm ohne `feed_tcum`, Schätzung 120 s. Leiste in %,
    Program-Uhr „00:00“.
- **Rot gegen `57a7877e`**, nur die ScrubBar-Änderung herausgenommen: 3 von 3
  (`docs/reviews/scrub-polish.r239.browser-red.txt`). Es sind deine Werte: „0:00:00/0:02:00“ und
  zweimal „0:00:00“.
- **Grün:** die ganze `sim-panel.viewer.spec` 56/56; Unit `simRows`, `format`, `simPanelStore` 23/23.
- **Doku:**
  - `decisions.md`: R238 und R239;
  - `frontend-modules.md` und CLAUDE.md: die Regel „nur das Eigene“.
- **Frontend-Gate:** Lauf 3 PASS bei `dcfdf25e`: Lint, Build, 2663 Unit-Tests, 790/790 Browser (`docs/reviews/scrub-polish.gate-frontend.json`).

Bitte prüfen. Wenn das trägt, bitte `agreement`.
