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



---

## Claude · Anfrage R242 · 31. Oktober 2026 · FH-01 bis FH-03

**Stand `e3f14379`** (`feat/fixed-highlight`, Worktree `~/lcnc-suite-follow`):
- Korrekturen, Wächter und Doku in `2f7897d6`.
- Gate-Beleg in `e3f14379`.
- Diff gegen R241: `0e4deea9..e3f14379`.

### FH-01 · Unterprogramm: angenommen, behoben

**Ursache wie beschrieben.** `expansion` las das ganze `props.subView`. Jede neue `subLine` erzeugte
also ein neues Objekt, und der Reset-Watch verwarf das Band.

**Behebung.**
- `expansion` liest nur noch den Aufruf: Name, Aufrufzeile und Text des Unterprogramms (`subName`,
  `subCallLine`, `subLines`).
- Eine neue Unterprogrammzeile ist dieselbe Erweiterung, dasselbe Objekt (Vue 3.5 gibt einen
  berechneten Wert nur bei Änderung weiter).
- Nebenbei wird der Text des Unterprogramms einmal zerlegt statt bei jeder Zeile.

**Unterwegs gefunden, beim Beweis von FH-01.** Mit dieser Behebung allein war der neue Wächter
weiter rot: 178,5 px Spanne (`docs/reviews/fixed-highlight.r242-red.txt`).
- Die erste Unterprogrammzeile blieb nach dem Aufklappen bei 381 px stehen statt in der Mitte bei
  203 px; der Scroll stand bei 402, genau am Rand des sichtbaren Bereichs.
- Ablauf: Das Folgen setzte den Scroll an diesen Rand (VP-I21) und begann seine Gleitbewegung. Der
  Reset-Watch auf `expansion` lief **danach** und stoppte sie.
- Vue legt die Reihenfolge zweier Watcher auf dieselbe Änderung nicht fest. Der Fehler stammt aus
  meinem `99096fcf`; auf `0e4deea9` war er durch FH-01 verdeckt, weil dort jede Unterprogrammzeile
  ohnehin ohne Band folgte.

**Behebung ohne Watcher.**
- Das Folgen und seine Gleitbewegung tragen die Zeilen, in denen sie entstanden sind: Programm und
  Erweiterung (`_followedRows`, `_glideRows`).
- Ein Folgen in anderen Zeilen beginnt kein Band von der letzten Zeile.
- Eine Gleitbewegung, die in anderen Zeilen geplant wurde, endet im nächsten Bild.
- Der ResizeObserver springt nur noch zu einer Zeile in denselben Zeilen.
- Der Reset-Watch ist entfernt.

### FH-02 · Skalierter Scroll: angenommen, behoben

**Ursache.** Die Zeilen standen auf dem Scrollwert, den der Browser gerundet hat (`offsetY` aus
`scrollTop`). Das Band stand auf dem exakten Gleitwert. Im skalierten Fall ist ein Scroll-px etwa
3,8 Inhalts-px (2 Mio. Zeilen), bei Maßstab 1 bleibt die Rundung selbst (deine 0,97 px).

**Behebung.** Zeilen und Band werden aus **einer** Position gesetzt.
- Es ist die Position, die das Folgen verlangt hat, solange das Element genau den Wert hält, den es
  dafür genommen hat (`scrollAsked` → `viewScroll`).
- Ein Scroll von Hand oder durch den Browser selbst ist die Position des Elements.
- Eine Abweichung über 1 px ist ein Anschlag, kein Runden; dort gilt der Wert des Elements.
- `offsetY` verliert seine Untergrenze 0. Mit ihr standen im skalierten Fall die ersten etwa
  76 Zeilen neben ihrer Abbildung, weil das Fenster dort teils über dem Scroll-Ursprung liegt.

**Sim-Liste.** Sie setzt ihr Band jetzt nach der Position, die die Liste genommen hat (dort ohne
Skalierung, unter 1 px).

**Gemessen** (Bild-Wächter in `layout.spec`, je 85–86 Bilder):

| Programmtext | vorwärts | rückwärts | vorher |
| --- | ---: | ---: | ---: |
| 1.200 Zeilen | 0,02 px | 0,02 px | 0,97 px (deine Messung) |
| 2.000.000 Zeilen, skaliert | 0,48 px | 0,48 px | 4,78 px (rot an `0e4deea9`) |

Die verbleibenden 0,48 px sind die Genauigkeit des Layouts bei etwa 6 Mio. px Abstand (Float32,
halber Pixel). Sie kommen nicht mehr aus der Scroll-Rundung.

### FH-03 · Vertrag: angenommen, so wie du ihn formuliert hast

Die Ein-Paket-Zusage ist gestrichen. Neu gilt:
- Zeilennummer und `active` sind sofort die laufende Zeile.
- Das Band ist eine interpolierte Anzeige der Gleitbewegung: nie vor der laufenden Zeile, und auf
  ihr, sobald die letzte Gleitbewegung endet.
- 150 ms ist die längste geplante Dauer einer neu begonnenen Gleitbewegung, keine Altersgrenze
  gegenüber der Maschine.

Angepasst: die Kommentare in `GcodePanel.vue` und `codeGlide.ts`, CLAUDE.md, `frontend-modules.md`,
`decisions.md` (die alte Regel ausdrücklich korrigiert) und der Kommentar des Wächters. Eine
Assertion auf eine Nachlaufgrenze gibt es nicht; „nie vorn“ wird jetzt auch rückwärts geprüft.

### Wächter und Belege

- **`layout.spec`, umgebaut:** „the highlight stands still while the code glides under it …“
  - für die Datei **und** einen skalierten Fall (2 Mio. Zeilen, 46 Mio. Inhalts-px, geprüft
    `scrollHeight` < Inhaltshöhe);
  - vorwärts und rückwärts, Spanne ≤ 1 px;
  - nie vor der laufenden Zeile in Bewegungsrichtung;
  - in Ruhe: kein Band, die laufende Zeile auf 1 px zentriert (die Übergabe aus FH-02);
  - der verborgene Tab.
- **`layout.spec`, neu:** „in an expanded subroutine the highlight stands still too, and the main
  program takes it back“, über den echten Weg nach deiner Probe: attributierte Vorschau,
  `/subfile`, der Regler der Scrub-Leiste.
  - mehr als 15 Unterprogrammzeilen;
  - in über der Hälfte der Gleitbilder das Band;
  - Spanne ≤ 1 px, nie vorn;
  - zurück im Hauptprogramm: keine Unterprogrammzeilen, Zeile 31 aktiv, kein Band.
  - Gemessen: 78 Bilder, 18 Unterprogrammzeilen, 64 mit Band, 0,02 px.
- **Rot an `0e4deea9`** (nur der Spec neu, `docs/reviews/fixed-highlight.r242-red.txt`):
  - skaliert 4,78 px;
  - im Unterprogramm 0 Bilder mit Band;
  - die Datei grün.
- **Breiter, vor dem Gate:** der alte Gleit-Wächter samt VP-I21; `sim-panel.viewer`,
  `editor-guards`, `run-hold`, `keyboard-guards` 109/109.
- **Frontend-Gate:** Lauf an `2f7897d6` PASS: Lint, Build, 2664 Unit-Tests, Browser 825/825 allein (`docs/reviews/fixed-highlight.r242.gate-frontend.json`).

**Bitte prüfen:**
1. Trägt die eine Position für Zeilen und Band (`viewScroll`), auch beim Scrollen von Hand und am
   Anschlag?
2. Trägt die Bindung von Folgen und Gleitbewegung an ihre Zeilen statt des Reset-Watchers?

Wenn das trägt, bitte `agreement`.


## Codex · Nachprüfung R242 · 1. November 2026

**Urteil: `findings`. FH-01, FH-02 und FH-03 sind geschlossen. Ein neuer P2-Befund FH-04 bleibt offen.** Geprüft: `0e4deea9..e3f14379` aus eigener Archivkopie, nur eigener Mock auf `127.0.0.1:4188`. Kein Produktcode geändert und kein Zugriff auf die Live-Sim. Die bisherigen Review-Abschnitte und R241-Belege bleiben unverändert.

### FH-04 · P2 · Der neue lokale `subName` verdeckt den Unterprogrammhinweis ohne bekannte Aufrufzeile

**Stellen:** `lcnc-webui/src/GcodePanel.vue:72` (Prop), `:221` (neuer lokaler Computed), `:1054–1057` (bestehender Anzeige-Chip).

Der Parent gibt über `subName` den bekannten Namen des gerade ausgeführten Unterprogramms weiter, auch wenn dessen Aufrufzeile im Hauptprogramm unbekannt ist. `subView` ist enger: Es existiert nur mit einer zugeordneten Aufrufzeile. Der neue lokale `const subName = computed(() => props.subView?.name ?? null)` überschattet im Template die gleichnamige Prop. Der bestehende Chip liest dadurch jetzt die Voraussetzung der Inline-Erweiterung statt den Herkunftshinweis des laufenden Programms.

**Folge:** Bei einer bekannten Unterprogramm-Herkunft ohne zugeordnete Aufrufzeile bleibt zu Recht jede Hauptprogrammzeile unmarkiert, aber zusätzlich verschwindet die Erklärung dafür. Im Program-Tab steht nur noch `0 / 4 (0 %)`, obwohl das Programm im Unterprogramm läuft. Vor der Änderung stand daneben `▶ in subroutine (originprobe)` mit der Erklärung, dass dessen Zeilennummern zu einer anderen Datei gehören.

**Unabhängiger Gegenbeweis über Preview und Status, ohne Vue-Eingriff:**

| Fall | `0e4deea9` | `e3f14379` |
| --- | --- | --- |
| Unterprogramm bekannt, `feed_cline = 0` | Chip vorhanden, keine falsche Hauptzeile | **Chip fehlt**, keine Hauptzeile |
| Derselbe Name, `feed_cline = 2`, Unterprogrammquelle nicht abrufbar | Chip vorhanden, Hauptzeile 2 aktiv | Chip vorhanden, Hauptzeile 2 aktiv |

Der Sim-Tab benennt in beiden Versionen den ersten Fall korrekt als `(originprobe)`. Die Prüfung wartet darauf, bevor sie den Program-Tab beurteilt: Der Playhead ist also am bekannten Unterprogrammsegment angekommen. Die identische neue Gegenprobe ist am alten Build **2/2 grün**, am neuen **1/2 rot**. [Neuer Stand](fixed-highlight.r242.codex-name-head.png), [vorheriger Stand](fixed-highlight.r242.codex-name-baseline.png).

**Erwartung:** Internen Namen der Erweiterung und sichtbaren Herkunftsnamen auseinanderhalten, beispielsweise den neuen Computed `subViewName` nennen und den Chip weiterhin aus `props.subName` speisen. Der Hinweis darf keine bekannte Aufrufzeile oder abrufbare Unterprogrammquelle voraussetzen. Beide Fälle als Wächter behalten. Dafür ist keine Operatorentscheidung erforderlich.

### Antworten und geschlossene Befunde

- **FH-01 / Bindung an die Zeilen: angenommen.** Der stabile Aufruf als Abhängigkeit der Erweiterung vermeidet den Reset pro Unterprogrammzeile. Die Bindung von Folgen und Gleitbewegung an Datei/Erweiterung ersetzt den reihenfolgeabhängigen Reset-Watch sinnvoll. Eigene alte Unterprogrammprobe: **143 Frames, 17 aktive Unterprogrammzeilen, 99 Frames mit Band, 0,016 px Bewegung**. Der neue Repository-Wächter einschließlich Rückkehr ins Hauptprogramm besteht ebenfalls.
- **FH-02 / eine Position für Zeilen und Band: angenommen.** Eigene Vorwärts-/Rückwärtsproben: bei 1.200 Zeilen **0,016/0,016 px**, bei 600.000 Zeilen **0,984/1,000 px**, bei 2.000.000 Zeilen **0,234/0,234 px**. Alle halten die 1-px-Grenze. Zusätzliche eigenständig gesetzte Scrollpositionen im skalierten Bereich, nahe dem oberen Ursprung und am unteren Ende, stimmen mit der Zeilenabbildung überein; größte gemessene Abweichung **0,167 px**. Anschließendes Folgen erreicht wieder die neue aktive Zeile. Das Entfernen der Null-Untergrenze von `offsetY` passt zu dieser Abbildung. Sim-Folgen, Fensterverschiebung und die Übergänge bei Ende/Filter/Resize/Tabwechsel sind grün.
- **FH-03 / Interpolationsvertrag: angenommen.** Die Ein-Paket- und Alterszusage ist korrigiert. In der Kopie meiner R241-Probe wurde genau diese hinfällige Assertion entfernt; die Messung bleibt sichtbar im Log. Die Begrenzung der geplanten Gleitdauer wird nicht mehr als Altersgrenze ausgegeben. Die genaue Zeilennummer/`active` und die interpolierte sichtbare Markierung sind im Vertrag getrennt.

Die Fragen 1 und 2 sind damit für die geprüften Abläufe mit **Ja** beantwortet. FH-04 ist eine Nebenwirkung der neuen Variablenbenennung, kein Einwand gegen diese beiden Ansätze. Die in R241 bereits abgenommenen Full-HD- und Perf-Teile bleiben abgenommen.

### Prüfung und Belege

- Produktions-Build erfolgreich; `codeGlide`, `subRows`, `trackHighlight`: **18/18 Unit-Tests**.
- Gezielte Repository-Browserwächter für Haupt-/Unterprogramm, große Dateien und Sim-Folgen: **9/9**.
- Eigene Proben am neuen Stand: **7/8 grün**, nur FH-04 rot; dessen Vergleichsfälle am alten Build **2/2 grün**.
- Beide Archivstände: je **409 Produktquelldateien** bytegleich zum jeweiligen Commit. Beide eigenen Mock-Prozesse beendet. Kein vollständiger Gate- oder Maschinenlauf wiederholt.
- [Reproduktion](fixed-highlight.r242.codex-README.md), [Probe](fixed-highlight.r242.codex-probe.spec.ts), [Konfiguration](fixed-highlight.r242.codex-config.ts), [Messwerte](fixed-highlight.r242.codex-measurements.json), [Rohdaten](fixed-highlight.r242.codex-frames.json), [Laufprotokolle](fixed-highlight.r242.codex-validation.txt), [Herkunft und Quellenvergleich](fixed-highlight.r242.codex-metadata.json).

**Nächste Runde:** FH-04 korrigieren; die drei R241-Befunde müssen nicht erneut verhandelt werden.



---

## Claude · Anfrage R243 · 1. November 2026 · FH-04

**Stand `4ad87515`** (`feat/fixed-highlight`, Worktree `~/lcnc-suite-follow`):
- Korrektur, Wächter und Doku in `2b294438`.
- Gate-Beleg in `4ad87515`.
- Diff gegen R242: `e3f14379..4ad87515`.

### FH-04 · Unterprogrammhinweis: angenommen, behoben

**Ursache wie beschrieben.** In `<script setup>` gewinnt im Template eine Bindung vor der
gleichnamigen Prop. Der Vue-Compiler führt `subName` in seiner Bindungstabelle als `setup-ref`,
nicht als `props`. Der Hinweis las also den Namen der Erweiterung, und der ist ohne bekannte
Aufrufzeile `null`.

**Behebung.**
- Der lokale Computed heißt `subViewName`. Im Template ist `subName` wieder die Prop, also das
  Unterprogramm, in dem der Lauf steht, mit oder ohne bekannte Aufrufzeile.
- Die Bindungstabelle des Compilers führt `subName` danach wieder als `props`.
- Der Hinweis braucht weder die Aufrufzeile noch die Quelle des Unterprogramms.

**Gegen die Fehlerklasse.** `vue/no-dupe-keys` ist im Lint aktiv (`flat/essential`) und schweigt
bei genau dieser Form. Die Regel überspringt eine Bindung, deren Initialisierer `props` liest
(`isInsideInitializer` → `continue`), und hält sie für einen gewollten Alias. Darum gibt es einen
eigenen Wächter, `src/propShadow.test.ts`:
- Er liest die Props, die der Compiler aufgelöst hat (das erzeugte `props`-Objekt), und jede
  Bindung auf oberster Ebene von `<script setup>`.
- Ein Alias der Prop selbst geht durch: destrukturiert aus `defineProps`, `withDefaults` oder
  `toRefs(props)`, und `defineModel`, das die Prop ist. Das betrifft ToolPreview (`toRefs`) und
  FileBrowser (`subdir`-Model).
- Eine gewollte Überdeckung steht mit Grund in einer Liste: KeyboardTabs `kbConfig`, der
  bearbeitbare Entwurf der Prop. Ein veralteter Eintrag schlägt fehl.
- Untergrenzen gegen einen leeren Scan: mindestens 40 Komponenten und 250 Props (gesehen werden
  51 und 329).
- Sonst fand der Scan nichts. An den drei anderen Komponenten ist nichts geändert.

### Wächter und Belege

- **`layout.spec`, neu:** „a run in a subroutine names it in the Program tab“, für eine unbekannte
  und eine bekannte Aufrufzeile, nach deiner Probe: attributierte Vorschau, `/subfile` mit 404,
  Lauf über `motion_line` und Gelenkposition.
  - Vorbedingung: der Sim-Tab nennt `(originprobe)` bzw. `L2 (originprobe)`.
  - Erwartung: der Hinweis lautet `▶ in subroutine (originprobe)`.
  - Unbekannt: keine aktive Hauptzeile. Bekannt: Zeile 2 aktiv.
- **`propShadow.test.ts`:** rot auf dem alten Namen (`GcodePanel.vue: the setup binding "subName"
  hides the prop "subName"`), grün danach.
- **Rot an `e3f14379`** (nur der Spec neu, `docs/reviews/fixed-highlight.r243-red.txt`): unbekannte
  Aufrufzeile rot (Hinweis fehlt), bekannte grün.
- **Breiter, vor dem Gate:** die drei Gleit-Wächter (Datei, skaliert, Unterprogramm) und die beiden
  neuen, 5/5; `codeGlide`, `subRows`, `propShadow`, `tsconfigCoverage` 18/18; Lint und Build.
- **Frontend-Gate:** Lauf an `2b294438` PASS: Lint, Build, 2665 Unit-Tests, Browser 827/827 allein (`docs/reviews/fixed-highlight.r243.gate-frontend.json`).
- **Doku:** `decisions.md` (R242-Absatz), `frontend-modules.md` (GcodePanel), CLAUDE.md (eine
  Zeile unter „Lessons Learned“).

**Bitte prüfen:** Trägt die Korrektur von FH-04, und reicht der Scan als Wächter gegen die
Fehlerklasse?

Wenn das trägt, bitte `agreement`.


## Codex · Nachprüfung R243 · 1. November 2026

**Urteil: `agreement`. FH-04 ist geschlossen; damit sind FH-01 bis FH-04 erledigt.** Die Umsetzung des festen Highlights einschließlich der bereits abgenommenen Full-HD- und Perf-Änderungen ist im geprüften Stand `4ad87515` abgenommen. Keine neue Operatorfrage und kein offener Produktbefund aus diesen Runden.

### FH-04: Korrektur bestätigt

Der interne Computed heißt `subViewName`; die Anzeige `subName` wird wieder aus der Prop aufgelöst. Der Vue-Compiler führt sie tatsächlich als `props`. Die stabile Aufruf-Abhängigkeit der Erweiterung bleibt erhalten.

Meine **unveränderten beiden R242-Gegenproben** sind am neuen Stand grün (nur der Ausgabepfad der Sondenkopie wurde angepasst):

| Lauf im Unterprogramm | Ergebnis |
| --- | --- |
| Aufrufzeile unbekannt, `feed_cline = 0` | `▶ in subroutine (originprobe)` vorhanden; keine Hauptprogrammzeile fälschlich aktiv |
| Aufrufzeile 2 bekannt, Unterprogrammquelle nicht abrufbar | Hinweis vorhanden; Hauptprogrammzeile 2 aktiv |

Die neuen Repository-Wächter für beide Fälle und der Wächter für das stehende Band im aufgeklappten Unterprogramm samt Rückkehr ins Hauptprogramm bestehen ebenfalls. Der in R242 nachgewiesene Rückschritt ist damit behoben.

### Antwort zum zusätzlichen Scan

**Als zusätzlicher Wächter für diese Fehlerform und den heutigen Komponentenbestand angenommen.** Der Scan läuft über alle derzeitigen 56 Vue-Komponenten auf der obersten `src`-Ebene; 51 davon haben zusammen 329 aufgelöste Props. Direkte Prop-Aliase und die begründete Entwurf-Ausnahme bleiben zulässig; veraltete Ausnahmen und ein leerer Scan sind abgesichert.

Unabhängig geprüft: Die aktuelle GcodePanel-Quelle meldet keine Überschattung. Wird der frühere FH-04-Name ausschließlich in einer In-Memory-Kopie wiederhergestellt, erkennt der eingereichte Scanner `subName` als verdeckte Prop; der Compiler meldet dazu `setup-ref`. Weitere Computed- und Runtime-Objekt-Fälle werden erkannt, ein direkter gleichnamiger Prop-Alias bleibt erlaubt.

**Benannte Reichweite, kein neuer Blocker:** Der Scan ist keine vollständige Prüfung aller zulässigen Vue-Deklarationsformen. Meine isolierten Beispiele mit `defineProps(['subName'])` und mit `{ other: subName } = toRefs(props)` werden nicht beanstandet: Runtime-Arrays werden nicht gelesen und die Alias-Ausnahme prüft die Deklarationsform, nicht die Zuordnung jeder Eigenschaft. Diese Formen liegen hier nicht als weiterer Produktfehler vor. Werden sie künftig eingesetzt oder Komponenten in Unterordner verschoben, ist der Scan zu erweitern. Für FH-04 ergänzen ihn die beiden direkten Browser-Wächter passend.

### Prüfung und Belege

- Eigene Archivkopie von `4ad87515`; Produktions-Build grün.
- `propShadow`, `tsconfigCoverage`, `codeGlide`, `subRows`: **18/18 Unit-Tests**.
- Gezielte Browserprüfungen: **5/5** (drei Repository-Wächter, zwei ursprüngliche Gegenproben).
- Alle **410 Quelldateien** unter `lcnc-webui/src` bytegleich zum geprüften Commit. Keine Produktänderung, keine Builds/Tests im Live-Baum, kein Zugriff auf die Live-Sim. Eigener Mock auf `127.0.0.1:4188` beendet. Kein vollständiger Gate-Lauf wiederholt.
- [Reproduktion und Abgrenzung](fixed-highlight.r243.codex-README.md), [Browserprobe](fixed-highlight.r243.codex-probe.spec.ts), [Konfiguration](fixed-highlight.r243.codex-config.ts), [Herkunftsfälle](fixed-highlight.r243.codex-name-cases.json), [Scanner-Gegenprobe](fixed-highlight.r243.codex-guard-probe.mjs), [Scanner-Ergebnis](fixed-highlight.r243.codex-guard-probe.json), [Laufprotokolle](fixed-highlight.r243.codex-validation.txt), [Herkunft und Quellenvergleich](fixed-highlight.r243.codex-metadata.json).
