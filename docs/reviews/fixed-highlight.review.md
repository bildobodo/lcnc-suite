# Die Markierung der laufenden Zeile steht still; das Panel der Maschine in den Layout-Tests

## Claude · Umsetzung · Anfrage R241 · 31. Oktober 2026

**Branch `feat/fixed-highlight`** (Worktree `~/lcnc-suite-follow`), auf `development` `d11c3d68`.
- Full-HD-Viewports in `c2fa26ba` (nur Tests und zwei Referenzbilder).
- Produkt, Wächter und Doku in `99096fcf`.
- Ein Fund des Gates, außerhalb der Änderung, in `ab8cb23a` (Abschnitt 3).
- Gate-Beleg in `0e4deea9`.
- Diff: `d11c3d68..0e4deea9`.

### Anlass

Zwei Wünsche des Operators vom 31. Oktober, beide aus echtem Gebrauch:

1. **Das Panel der Maschine:** Full HD, Querformat, Touch, am LinuxCNC-PC selbst, keine Skalierung.
   „du kannst die layouttests durchführen.“
2. **Die Markierung der laufenden Zeile:** „bei programmen, wo dutzende zeilen pro sekunde
   durchlaufen, springt das highlight ein wenig hoch und runter. das ist bei anderen uis glaube ich
   nicht der fall. das highlight bleibt immer an der gleichen stelle auf dem bildschrim und das
   programm scrollt durch. das betrifft auch die sim anzeige mit den kollisionen und
   werkzeugwechseln“.

### 1 · Full HD in den Layout-Tests (`c2fa26ba`)

- Der Launcher öffnet den Standardbrowser im Fenster (`xdg-open`, kein Kiosk). Darum zwei Größen:
  - `touch-fullhd` 1920 × 1080 (Vollbild);
  - `touch-fullhd-window` 1920 × 940 (maximiertes Fenster unter einer Desktop-Leiste und den
    Leisten des Browsers).
- Sie kommen in `VIEWPORTS` und `NAV_STATES`. Damit laufen jeder Durchlauf je Viewport in
  `layout.spec`, die Geometrie des Werkzeug-Dialogs (`tool-geometry`) und dessen Referenzbild
  (`visual.spec`).
- **Vor jeder Änderung grün:** `layout.spec` an beiden 28/28, `tool-geometry` 2/2.
- **Zwei neue Referenzbilder** des Werkzeug-Dialogs. Ich habe sie angesehen: die ganze Form, der
  Fuß erreichbar.
- **Gesehen auf den Bildern, kein Befund der Tests:** Die Leiste ist breiter als 1920 px.
  - 3 Achsen: 29 px darüber;
  - XYZAC: 264 px (der ganze Werkzeug-Abschnitt);
  - TWP: 426 px.

  Sie scrollt seitlich, wie gebaut. Ob sie bei Full HD passen soll, liegt beim Operator.

### 2 · Die Markierung steht still (`99096fcf`)

**Ursache.** Seit dem 30. September gleitet der Code (`codeGlide.ts`): jeder Schritt eines Pakets
über die Paketlücke. Die Markierung saß aber AUF der laufenden Zeile. Ein Paket verschiebt diese
Zeile um seinen ganzen Schritt auf einmal. Die Markierung sprang also nach unten, und der Text glitt
sie wieder zurück.
- Gemessen bei drei Zeilen pro Paket und 30 Paketen pro Sekunde: 116 px Spanne, etwa fünf Zeilen.
- Im Sim-Tab bei ×50: 33 px, eine Zeile je passierter Zeile.

Am 30. September hatte der Operator schon dasselbe gewollt: „dass die Zeile stehen bleibt, aber das
Programm scrollt“.

**Umsetzung im Programm-Tab (`GcodePanel.vue`).**
- Während der Code gleitet, ist die Markierung ein Band (`.codeFollowBand`, das Aussehen von
  `.codeLine.active`). Es steht dort, wohin der Text gleitet: dieselbe Gleitbewegung wie der Scroll,
  im Raum der Zeilen (`followBand`; über `offsetY` und die skalierte Scroll-Abbildung wie die
  Zeilen).
- Solange der Scroll frei ist, steht das Band auf dem Bildschirm still, und der Code scrollt
  darunter durch.
- Am Anfang und Ende der Datei, wo der Scroll anschlägt, gleitet das Band von Zeile zu Zeile.
- Am Ende der Gleitbewegung steht das Band genau auf der laufenden Zeile. Dort übernimmt die Zeile
  ihr eigenes Aussehen, das gleich aussieht.
  - Die Zeile behält `active` die ganze Zeit; `.followed` blendet nur ihr Aussehen aus.
  - Eine zweite aktive Zeile (Aufrufzeile neben ihrer Unterprogrammzeile) behält ihr eigenes.
- Die Zeilen liegen über dem Band (`position: relative` in `.codeRows`).
- **VP-I21 bleibt unverändert:** Die laufende Zeile ist in jedem Bild sichtbar. Ein Schritt über
  das sichtbare Band hinaus versetzt den Text; das Band wird aus dem neuen Scroll neu abgeleitet,
  bleibt also auf dem Bildschirm stehen.
- **Ohne vorherige Markierung** (erstes Folgen, ein anderes Programm, ein aufgeklapptes oder
  zugeklapptes Unterprogramm) gleitet der Code wie bisher ohne Band.

**Umsetzung im Sim-Tab (`SimPanel.vue`).**
- Dasselbe Band (`.simFollowBand`) mit dem Aussehen der gezeigten oder der nächsten Zeile.
- Es wird pro Bild am Element gesetzt, nie über ein Rendern der bis zu 400 Zeilen. `bandKey`
  ändert sich nur am Anfang und Ende einer Gleitbewegung.
- **Festhalten:** Eine neue markierte Zeile hält das Band, wo es stand, bis die Liste im nächsten
  Bild folgt (`holdHighlight`). Sonst zeigte die neue Zeile für dieses eine Bild ihr eigenes
  Aussehen, eine Zeile weiter: 26 px, gemessen.
- **Ende einer Gleitbewegung:** Es gibt das Band nur an die eigene Zielzeile zurück, wenn keine
  neuere Zeile es hält.
- **Verschobenes Fenster:** `restoreAnchor` verschiebt eine laufende Gleitbewegung (Scroll und
  Band) mit den Zeilen. Vorher setzte die Gleitbewegung den absoluten alten Wert im nächsten Bild
  wieder.

**Die Regel, die sich ändert.** 6c4d0c8c sagte: „the highlight stays on the line that actually
runs … no band lagging the machine“. Neu gilt:
- Das Band ist **nie vor** der laufenden Zeile.
- Es liegt **höchstens eine Paketlücke (≤ 150 ms) dahinter**.
- Es steht **genau auf ihr**, sobald die Pakete pausieren.
- Während des Gleitens deckt es Teile zweier Zeilen.

Das ist der Preis eines Lauftexts unter stehender Markierung. Die Alternative, harter Scroll pro
Paket, ist das, was der Operator am 30. September als „zuckt“ beschrieben hat.

**Unterwegs gefunden, auf keiner Liste:** Ein während eines Laufs verborgener Program-Tab zeigte
beim Zurückkehren den falschen Teil des Codes.
- Ursache: Das Folgen hatte dort keine Höhe. Das Fenster behielt die 20 Zeilen des Puffers ohne die
  laufende.
- Das blieb so bis zur nächsten Zeile; bei einer langen Bewegung also während ihrer ganzen Dauer.
- Belegt am unveränderten Build: 20 Zeilen, keine aktive.
- Behebung: Die Höhe der Ansicht ist jetzt reaktiv (ResizeObserver). Die zurückkehrende Ansicht
  springt auf die verfolgte Zeile.

**Bekannte Grenzen, bewusst nicht angefasst:**
- Ein Hover auf einer Zeile über dem Band verdeckt es (Desktop, nicht Touch).
- Unter `forced-colors` fällt der Balken als `box-shadow` weg, wie schon bei `.nextRow`.

### 3 · Vom Gate gefunden: ein stilles Fenster verlor seine Spannen (`ab8cb23a`)

**Befund.** Gate-Lauf 1 an `99096fcf` (`fixed-highlight.gate-frontend.run1.json`): 822 bestanden,
1 fehlgeschlagen, außerhalb dieser Änderung:
- `collisions.viewer.spec` „a parse made for the run is checked during it …“;
- die Zählung `span_col_copy` / `span_col_post` ≥ Starts (VP188-02 Schritt 0) blieb `[false, false]`.

**Auch auf `development` rot.** Einzelläufe:
- `d11c3d68`, neu gebaut: 5 von 6 rot;
- der Branch: 1 von 3 rot.

Im Gate von R240 am selben Tag stand er grün (791/791): Es hängt am Timing.

**Ursache, gemessen** (`docs/reviews/fixed-highlight.perf-red.txt`, der Telemetrie-Mitschnitt
eines roten Laufs):
- 4 `sweep_start`, aber nur 3 `viewer.perf`-Zeilen mit je einer Spanne;
- nach dem letzten Start, der Leerlaufprüfung nach dem Lauf, kam keine Zeile mehr.

`flushViewerPerf` sendet eine Zeile nur für ein Fenster mit Aktivität. Als Aktivität zählten
Statusframes, Renderings und Eingaben, nicht aber die gemessenen Spannen. Im Quiet-Modus kommt kein
Status, und es gibt nichts zu zeichnen. Die Spanne blieb also im Akkumulator: gebucht unter dem
Fenster der nächsten Aktivität, oder nie.

**Behebung.** Die Spannen zählen jetzt als Aktivität (`_spans.size`, `_spanUnknown`). Sie entstehen
nur bei echter Arbeit: Anfrage und Post einer Prüfung, eine Pfad-Antwort, ein Laden. Ein ruhender
Viewer bleibt also still.

**Belege.**
- Rot zuerst: `viewerPerf.test.ts` „a window with spans alone is reported in its own row“.
- Danach: `viewerPerf.test.ts` 33/33, der Browser-Test 8 von 8 Einzelläufen, `frames.spec` 5/5.
- Doku: `decisions.md` (Nachtrag im Eintrag vom 31. Oktober), `scrub-and-run.md` (die Spannen).

**Folge für die Auswertung der Browser-PC-Messung:** Es kann jetzt Zeilen ohne Frames und
Renderings geben. Solche Zeilen gab es schon vorher, für Fenster nur mit Eingaben.

### Wächter und Belege

- **`layout.spec`, neu:** „the highlight stands still while the code glides under it — never ahead
  of the running line, on it at rest“.
  - 30 Pakete pro Sekunde zu je drei Zeilen; in jedem Bild der Gleitbewegung die Oberkante der
    Markierung (das Band, sonst die aktive Zeile).
  - Spanne ≤ 1 px, nie vor der laufenden Zeile.
  - In Ruhe: kein Band, die laufende Zeile zentriert und mit Hintergrund.
  - Der verborgene Tab: 5 Pakete im MDI-Tab, zurück, die laufende Zeile sofort und kein Band.
- **`sim-panel.viewer.spec`, neu:** „playback at ×50: the marked row's highlight stands still
  while the list glides under it“.
  - Je Bild das sichtbare Band, sonst die markierte Zeile.
  - Spanne ≤ 1 px in den Bildern mit freiem Scroll, mehr als 5 passierte Zeilen.
- **Rot an `c2fa26ba`**, Produkt unverändert (`docs/reviews/fixed-highlight.browser-red.txt`):
  116 px und 33 px; der verborgene Tab per Probe.
- **Grün:**
  - beide neuen Wächter;
  - der alte Gleit-Wächter samt VP-I21 (beide Phasen);
  - die ganze `sim-panel.viewer.spec` 58/58, darunter VP-I41 bei ×100, „a moved window keeps
    the picture“ und „the list follows the position“.
- **Doku:**
  - `decisions.md`: Eintrag vom 31. Oktober;
  - `frontend-modules.md`: GcodePanel und SimPanel;
  - CLAUDE.md: beide Zeilen;
  - der Kopfkommentar von `codeGlide.ts`.
- **Frontend-Gate:** Lauf 2 an `ab8cb23a` PASS: Lint, Build, 2664 Unit-Tests in 166 Dateien, Browser 823/823 allein (`docs/reviews/fixed-highlight.gate-frontend.json`). Lauf 1 an `99096fcf`: 822/823; der eine Fehlschlag ist Abschnitt 3 (`fixed-highlight.gate-frontend.run1.json`).

**Bitte besonders prüfen:**
1. Trägt die neue Regel (≤ eine Paketlücke hinter der laufenden Zeile, genau darauf in Ruhe) an
   Stelle von „no band lagging the machine“?
2. Die Übergänge des Bands:
   - VP-I21-Sprung, Anfang und Ende der Datei, große Dateien mit skaliertem Scroll;
   - Unterprogramm-Erweiterung;
   - im Sim-Tab das Festhalten, das Fensterverschieben und `follow(false)` des ResizeObservers.

3. Die Flush-Bedingung von `viewerPerf`: Trägt „Spannen sind Aktivität“, oder soll eine Spanne
   ohne Frames anders gebucht werden?

Wenn das trägt, bitte `agreement`.
