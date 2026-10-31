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


## Codex · Implementierungsreview R241

**Urteil: `findings` — drei offene Punkte FH-01 bis FH-03.** Das Konzept der stehenden Markierung passt zum Operatorwunsch. Für die gewöhnliche Hauptdatei und die geprüften Sim-Übergänge funktioniert es. Im aufgeklappten Unterprogramm fehlt es jedoch, bei skaliertem Scroll bewegt sich das Band noch sichtbar, und die behauptete Ein-Paket-Grenze stimmt nicht.

Geprüft ist **`d11c3d68..0e4deea9`**, aus einer eigenen Archivkopie. Kein Produktcode geändert, keine Builds oder Tests im Live-Baum, keine Live-Sim benutzt. Eigener Mock `127.0.0.1:4188`, inzwischen beendet. Alle 409 Dateien unter `lcnc-webui/src` stimmen bytegleich mit dem geprüften Commit überein.

### FH-01 · P2 · Eine neue Unterprogrammzeile wird wie eine neue Erweiterung behandelt

**Stellen:** `lcnc-webui/src/GcodePanel.vue:217` (`expansion`), `:407` (Reset-Watch), `:471` (Folgen der Unterprogrammzeile).

`expansion` liest das ganze `props.subView` und liefert ein neues Objekt mit einer neuen `lines`-Liste. Auch wenn Name, Aufrufstelle und Quelltext gleich bleiben und sich lediglich `subLine` ändert, läuft deshalb der neue Watch auf `expansion`: `stopGlide(); _followedRow = null`. Das nächste Folgen hat damit keine vorherige Markierung, aus der es das feste Band bilden könnte. Das ist innerhalb einer weiterhin geöffneten Erweiterung kein tatsächliches Auf- oder Zuklappen.

**Gegenprobe:** Ein Hauptprogramm mit `o<r241sub> call` auf Zeile 20; attributierte Unterprogramm-Bewegungen im Preview und 100 Zeilen über `/subfile`. Der normale Sim-Regler bewegt sich durch das aufgeklappte Unterprogramm. In **134 Frames über 17 verschiedene aktive Unterprogrammzeilen erscheint kein einziges Band**. Die Oberkante der Markierung bewegt sich insgesamt um 179 CSS px, auch **nach den ersten 500 ms noch um 72 px**. Die Zeile springt und gleitet wieder wie vor dieser Änderung.

**Erwartung:** Nur ein tatsächlicher Strukturwechsel der Erweiterung verwirft die vorherige Markierung — anderer Aufruf, anderer Text, Auf-/Zuklappen oder Programmwechsel. Ein reines Fortschreiten von `subLine` innerhalb derselben Erweiterung muss die laufende Animation erhalten. Bitte diesen Fall durch den echten Preview → Unterprogramm → GcodePanel-Ablauf absichern, einschließlich Rückkehr ins Hauptprogramm.

### FH-02 · P2 · Die Scroll-Skalierung verstärkt die Restbewegung des Bands

**Stellen:** `lcnc-webui/src/GcodePanel.vue:296–314` (Scroll-Abbildung und `offsetY`), `:388` (`_glideFrame`), `:429–453` (Startposition und Band-Gleitweg).

Der Scroll wird auf den vom Browser tatsächlich angenommenen Wert gesetzt; das Band verfolgt daneben seinen interpolierten Wert im Inhaltsraum und liegt im großen verschobenen Zeilencontainer. Rundung dieser beiden Darstellungen wird bei skaliertem Scroll sichtbar. Die mathematisch gleichen Gleitwege ergeben hier keine pixelgleiche Position auf dem Bildschirm.

**Gegenprobe:** Freies Folgen mit je drei Zeilen vorwärts und rückwärts, normaler Motion-Einstellung, identischem Viewport und kleinen Preview-Daten; nur die Größe des Programmtexts ändert sich:

| Programmtext | Bewegung der Bandoberkante vorwärts | rückwärts |
| --- | ---: | ---: |
| 1.200 Zeilen | 0,97 px | 0,94 px |
| 600.000 Zeilen | 1,75 px | 1,80 px |
| 2.000.000 Zeilen | **4,95 px** | **4,63 px** |

Das passiert mitten im freien Scroll, nicht am Dateianfang oder -ende. Die aktive Zeile ist vorhanden; in Ruhe endet das Band korrekt. Die beiden großen Dateien verfehlen aber die 1-px-Ruhe, die der neue Repository-Wächter für den Normalfall zusichert. Gerade große CAM-Dateien sind ein Anlass für diese Darstellung; die bestehende Scroll-Abbildung nennt selbst den Fall mit 1,35 Millionen Zeilen.

**Erwartung:** Das Band während freien Folgens an einer Position im sichtbaren Bereich halten beziehungsweise die tatsächlich gerenderte Scroll-/Containerposition kompensieren. Nicht nur die mathematischen Zielwerte vergleichen. Bitte einen skalierten Fall mit deutlich mehr als 12 Millionen Inhalts-px in den Bild-Wächter aufnehmen.

### FH-03 · P2 · „Höchstens eine Paketlücke dahinter“ ist keine Eigenschaft der Umsetzung

**Stellen:** `lcnc-webui/src/GcodePanel.vue:354–369`, `:425–454`, der neue Kommentar und Wächter in `e2e/layout.spec.ts:2148` sowie die gleichlautende Zusage in dieser Anfrage/Doku.

Eine neue Gleitbewegung beginnt am bisher gezeichneten Zwischenstand. Ist die vorige Bewegung noch nicht am Ziel, übernimmt die neue ihren Rückstand. Die Dauer des neuen Gleitwegs ist daher nicht gleich dem Alter der Zeile unter dem Band. Der vorhandene Wächter prüft die Ruhe des Bands und die Lage vor der aktiven Zeile, aber nicht die behauptete obere Nachlaufgrenze.

**Gegenprobe:** Bereits bei 1.200 Zeilen und **drei Zeilen pro Update** liegt das Band im eingeschwungenen Vorwärtslauf bis zu **4,02 Zeilen** hinter der aktiven Zeile. Konkreter Frame: zuletzt sichtbar Zeile 151, danach Zeile 154; die neue aktive Zeile steht bei 295 px, das Band bei 202,5 px, Zeilenhöhe 23 px. Das Band liegt also ungefähr auf Zeile **149,98**, noch vor dem vorherigen Ziel 151. Dieser Frame liegt mehr als 300 ms nach Beginn des gemessenen Laufs; es ist kein bloßer erster Anlauf.

**Mein Vorschlag:** Die stehende, interpolierte Anzeige akzeptiere ich. Die Ein-Paket-Zusage bitte streichen oder tatsächlich implementieren und messen. Als Vertrag trägt: Die semantisch aktive Zeile und die Zeilennummer werden sofort aktualisiert; das Band ist während des Nachführens eine interpolierte Anzeige und trifft nach dem letzten Zielwechsel beim Abschluss der Animation auf dessen Zeile. **150 ms ist die maximale geplante Dauer eines neu begonnenen Gleitwegs, keine bewiesene Altersgrenze gegenüber der Maschine.** Bei anhaltenden Updates darf daraus keine Ein-Paket-Garantie abgeleitet werden. Die Probe enthält bewusst eine rote Assertion für die derzeit behauptete Grenze; bei einer vereinbarten Korrektur des Vertrags ist diese Aussage neu zu fassen.

### Antworten auf die drei Fragen und abgenommene Teile

1. **Entkopplung der sichtbaren Markierung:** Ja, als Darstellung des nachgeführten Codes. Die genaue Ein-Paket-/Alterszusage ist durch FH-03 nicht abgenommen. Für diesen präzisierten Interpolationsvertrag brauche ich keine neue Operatorentscheidung.
2. **Übergänge:** Die vorhandenen Wächter für VP-I21, ×50/×100, das verschobene Sim-Fenster und neue Ergebnisse sind grün. Eigene Proben für Vor-/Rückwärtsfolgen, Dateianfang/-ende sowie Ende, leeren Filter, Größenwechsel und Tabwechsel der Sim-Liste hinterlassen kein Band in Ruhe. Unterprogramm und skalierte Ansicht bleiben wegen FH-01/FH-02 offen. Die erwähnten Hover-/Forced-Colors-Grenzen werden dadurch nicht als beseitigt erklärt.
3. **Perf-Spannen als Aktivität:** Angenommen. Eine Spanne ist tatsächlich gebuchte Arbeit. Sie muss auch in einem Fenster ohne Frames/Renderings ausgegeben und anschließend zurückgesetzt werden. Die Ergänzung der Flush-Bedingung tut genau das; der neue Unit-Wächter prüft zudem, dass danach keine leere zusätzliche Zeile entsteht. Der betroffene Browserablauf mit Prüfung während des Laufs ist unabhängig grün. Für Berichtsauswerter bleiben `frames: 0` und `renders: 0` gültige Werte, keine fehlende Messung.

**Full HD:** Die neuen 1920×1080- und 1920×940-Fälle sind sinnvoll. Layout/Geometrie **28/28**, beide neuen Referenzbildprüfungen **2/2** grün; Referenzen auch angesehen. Das bestätigt die geprüfte Bedienbarkeit einschließlich Scrollen. Es besagt nicht, dass die gesamte untere Leiste ohne horizontales Scrollen passt. Diese bereits benannte Gestaltungsfrage bleibt getrennt vom vorliegenden Highlight-Fix; ich stelle dafür keine neue Freigabefrage.

### Prüfungen und Belege

- Produktions-Build erfolgreich; `codeGlide.test.ts` und `viewerPerf.test.ts` **40/40**.
- Gezielt erneut ausgeführte Repository-Browserwächter **38/38**: sieben Follow-/Sim-Fälle, 28 Full-HD-Layout-/Geometriefälle, zwei Referenzbilder und der betroffene Perf-Ablauf.
- Eigene Gegenproben liefern die oben genannten roten Nachweise; die vier Sim-Übergänge sind grün. Kein vollständiger Gate- oder nativer Maschinenlauf wiederholt.
- [Reproduktion und Abgrenzung](fixed-highlight.r241.codex-README.md), [Probe](fixed-highlight.r241.codex-probe.spec.ts), [Konfiguration](fixed-highlight.r241.codex-config.ts).
- [Messübersicht](fixed-highlight.r241.codex-measurements.json), [Rohdaten je Frame](fixed-highlight.r241.codex-frames.json), [Laufprotokolle](fixed-highlight.r241.codex-validation.txt), [Quellenvergleich](fixed-highlight.r241.codex-integrity.json).

**Nächste Runde:** FH-01/FH-02 korrigieren und FH-03 durch einen zutreffenden Vertrag oder eine nachgewiesene Grenze schließen. Bis dahin kein gemeinsames Agreement für R241.
