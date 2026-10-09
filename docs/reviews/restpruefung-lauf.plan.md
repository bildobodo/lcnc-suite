# Restprüfung im Lauf — Kollisionen vor der Maschine, während das Programm läuft

**Fassung 2 · 9. Oktober 2026 · Kollisionsplan Schritt 3, letzter Teil** (Operator 2026-10-06: „nach der ECHTEN Messung im Lauf den Rest des Programms ab der aktuellen Position neu prüfen“). Fassung 1 ging in R112 an Codex. Fassung 2 beantwortet VP112-01 bis 07; die Antworten stehen am Ende. Gebaut wird erst nach Einigung.

## Ausgangslage, gemessen am Stand `a30b4138`

1. **Ein Programm-M6 löscht die Befunde bis zum Stillstand.**
   - `applyState` ruft `_colOnInputChange()` bei jeder Änderung auf von: `tool_length`, `tool_diameter`, `g5x_offset`, `g92_offset`, `rotation_xy` und den genutzten WCS-Zeilen; bei `tool_offset` nur ohne `toolBasis` (`ThreeViewer.vue` 2588–2614).
   - Der neue Anstoß wartet bis IDLE (`_colHeldByRun`, 3387–3402).
   - Der Payload bildet die Änderungen des Programms pro Segment ab.
   - Die Prüfung selbst liest Teile ihrer Basis aber **live** (Codex R112, VP112-01): Werkzeugnummer und -körper vor dem ersten Werkzeugereignis (`_pv.toolNum`, `_toolVisual`), die Start-WCS (`_pfWcs()`) und die Tabellenzeilen nicht umgeschriebener Epochen (`wcsEpochs.ts` 63–86). Ein Neustart der Prüfung im Lauf würde deshalb frühere Epochen und das geerbte Werkzeug mitverschieben.
2. **Eine Tabellenänderung im Lauf** (etwa eine Messung, M600 → G10 L1) stößt die eingefrorene Neu-Analyse an (`midrun_table_gate_open`, `pinned_ctx`). Das ganze Programm wird vom eingefrorenen Start mit der neuen Tabelle geparst.
   - Beim Eintreffen löscht der `viewerGcode`-Watcher die Befunde und hält bis IDLE an (MR-I03).
   - Herkunft und Grund dieser Veröffentlichung stehen nirgends dauerhaft: `preview_refresh` lebt nur während des Parses und nennt nur den Basename (VP112-02).
3. **Die Laufposition kennt nur `ScrubBar`** (`runWatcher`).
   - Seine Projektion wählt den **kleinsten Abstand**, nicht den frühesten möglichen Durchgang. Die Gegenprobe Parallelweg (VP112-03) landet auf dem späteren Stück.
   - `index` ist der **obere** Punktindex.
4. **Der Sweep beginnt immer bei Punkt 0.** Ein `sliceTrack`-Rest bekommt eine neue Basis. Die kann ein Paar statisch ausschließen, das am Schnitt berührt, und dann auch dessen spätere Kontakte übergehen (Gegenprobe Wiederkontakt, VP112-04).

## Paket 1 · Herkunft der Veröffentlichung, Lauf-Kennung, fester Prüfstand

### 1a · Gateway

- **Herkunft pro Veröffentlichung.** `BulkPipeline` führt pro veröffentlichter Version `published_origin`:
  - `version`, voller Pfad `file`, `source` (der vorhandene Fingerabdruck `published_source`);
  - `reason`: der geplante Parse-Grund, etwa `file_changed`, `tool_offset`, `midrun:table_mtime`;
  - `pinned` (bool);
  - `table`: Tabellenzeit und Zeilen-Fingerabdruck, mit denen der Parse lief.
  - Sie geht mit `viewer_gcode_ready` hinaus und als `preview_origin` in jedem Status-Envelope. Damit hat auch ein Client, der nach der Veröffentlichung verbindet, die Herkunft.
  - Klein, kein Dekodieren des Payloads.
- **Lauf-Kennung.** `run_id` im Status ist ein Zähler, den das Gateway erhöht, wenn ein AUTO-Lauf aus dem Stillstand startet. Das betrifft `cycle_start`, `auto_run` (auch Run from line) und den ersten `auto_step`, dieselbe Stelle wie die Basis-Buchung in `_cmd_blocking`. Ein Fortsetzen nach einer Pause behält sie.
- **Wächter (pytest):** Herkunft nach jeder Art Parse, `pinned` nur beim eingefrorenen Parse. `preview_origin` stimmt nach einer zweiten Veröffentlichung, nach einem fehlgeschlagenen Mittellauf-Parse mit späterer anderer Veröffentlichung und bei gleichen Basenames in verschiedenen Ordnern. Bei `run_id`: Start, Pause und Fortsetzen, Ende und schneller Neustart derselben Datei.

### 1b · Client: der Prüfstand einer Prüfung

Jede Prüfung bekommt beim Planen einen **unveränderlichen Prüfstand** (`CheckBasis`). Aus ihm, nie aus `_pv`, baut `_colBuildRequest` den Auftrag.

Inhalt des Prüfstands:
- Track samt Herkunft (`version`, `source`);
- Start-WCS: Fixture, G5x-Werte, die genutzten Tabellenzeilen, G92, Rotation;
- Werkzeugbasis des Payloads;
- **geerbtes Werkzeug**: Nummer, Durchmesser, Länge, also das bei Prüfbeginn geladene;
- Werkzeugdaten des Parses (`parse_tlos`);
- Modell- und Kinematikbasis (`modelKey`, Kins-Spec).

Regeln:
- **Prüfung im Stillstand:** Der Prüfstand ist der Live-Zustand bei Prüfbeginn, wie heute.
- **Lauf-Prüfstand:** Beim Laufstart (neue `run_id`) hält der Client den Live-Zustand fest. Wegen der Leerlauf-Drift-Kanten ist das der Startzustand, von dem auch die eingefrorene Neu-Analyse ausgeht.
- **Jede Prüfung im Lauf** nimmt die Start-WCS und das geerbte Werkzeug aus dem Lauf-Prüfstand, Track, Ereignisse und Tabelle aus dem neuen Payload. Den inzwischen geladenen Werkzeugzustand nimmt sie nie.
- **Anzeige:** Jedes Ergebnis trägt seinen Prüfstand. Die Anzeige nennt ihn, wo er nicht der aktuelle ist.

### 1c · Ergebniszustände

Ein Ergebnis ist immer genau in einem Zustand:
- **aktuell:** voll geprüft auf dem angezeigten Payload und gültigem Prüfstand;
- **Rest:** geprüft ab einer Grenze, Zustände „wartet / prüft / teilweise / fertig“;
- **bisherige Vorschau:** älterer Payload oder älterer Prüfstand, ausdrücklich so benannt, ohne Farben, Zähler und „nächster Befund“ der aktuellen;
- **keins.**

Der Wechsel zwischen den Zuständen ist eine reine Funktion (`checkState`) mit Unit-Tests.

## Paket 2 · Was der Lauf selbst ändert, löscht keine Befunde (A)

Läuft ein Programm (`run_id` gesetzt, AUTO, nicht IDLE), lösen Live-Änderungen der Punkt-1-Eingänge kein `_colOnInputChange` aus.
- Das Ergebnis bleibt mit seinem Prüfstand stehen.
- Im Lauf ändert sie nur das Programm selbst, das der Payload abbildet: MDI, Antasten und Werkzeug-Editor sind im Lauf gesperrt.
- Eine Tabellenänderung führt über Paket 3 zu einem neuen Payload.
- Bei IDLE gilt die heutige Regel: Weicht der Live-Zustand vom Prüfstand ab, wird das Ergebnis gelöscht und neu geprüft.

**Wächter** (e2e; geprüft werden Pose, Werkzeugwahl und Gültigkeit, nicht nur „noch sichtbar“):
- M6 mit anderem Startwerkzeug und anderer Geometrie vor dem ersten M6;
- G10 L2 und G92 nach einer schon genutzten Epoche;
- dieselben Änderungen im Stillstand: gelöscht und neu geprüft (Kontrolle);
- Restauftrag und Ganz-Track-Prüfung nach diesen Änderungen: Pose und Werkzeug aus dem Lauf-Prüfstand;
- fehlende Start- oder Ereignisbasis: kein aktuelles Ergebnis.

## Paket 3 · Der Rest ab einer konservativen Grenze (B)

### 3a · Auslöser, Bindung, Lebenszyklus

- **Ein Restauftrag entsteht**, wenn alles zusammentrifft:
  - der angezeigte Payload hat `preview_origin.pinned` und einen `midrun:`-Grund;
  - er gehört zur geladenen Datei (voller Pfad und `source`);
  - der Interpreter läuft;
  - die `run_id` ist die des Lauf-Prüfstands.
- **Ohne nachgewiesene Herkunft** gibt es keinen Restauftrag. Raten ist ausgeschlossen. Es bleibt bei der bisherigen Vorschau und der vollen Prüfung bei IDLE.
- **Bindung:** Ein Restauftrag ist an `(version, source, run_id, Generation)` gebunden. Position, Teilantworten und Endantwort werden gegen genau diese Bindung geprüft.
- **Verfall:** Neue Veröffentlichung, Reload, Abbruch, Laufende, Reconnect und ein neuer Prüfstand verwerfen ihn ausdrücklich. Eine neue Planung bekommt eine neue Generation.
- **IDLE** bricht ihn sofort ab und startet die volle Prüfung (MR-I03). Sie wartet nie auf das Ende eines Rests.
- Die Grenze eines laufenden Auftrags wandert nicht mit dem Fortschritt der Maschine.

### 3b · Die Grenze: früheste nicht ausgeschlossene Stelle

`ScrubBar` meldet ThreeViewer je Statusbild (neues Emit `run-pos`): Trackversion, Pose als Maschinenpose samt den WCS-, TLO- und Kinematik-Termen, mit denen sie beobachtet wurde, und Beobachtungszeit. Die angezeigte Position (`runWatcher`) bleibt davon getrennt.

Die **Untergrenze** rechnet eine neue reine Funktion `restFloor(track, pose, terms, τ)`:
- **Kandidaten:** alle **bekannten** Segmente des Tracks, deren Abstand zur Pose höchstens τ beträgt. Unbekannte Strecken (`ustart`, nicht vorhergesagt, `brk`) sind keine Kandidaten.
- **Grenze:** Anfangspunkt des **frühesten** Kandidaten (Segment `i` → Punkt `i − 1`). Ein Schnitt mitten im Segment schließt dessen ganzen Rest ein.
- **Ein zusammenhängendes Kandidatenstück:** „Rest ab L…“.
- **Mehrere getrennte:** „Rest ab dem frühesten möglichen Abschnitt (L…)“. Bereits passierte Befunde können dann bleiben, der Umfang wird genannt.
- **Kein Kandidat:** „Laufzuordnung unbekannt“, dann eine benannte **Ganz-Track-Prüfung der Vorschau**, ohne Anspruch auf die Laufposition.
- **τ** ist das Gate des Run-Watchers (10 Einheiten, `RUN_ESCAPE_D2`). Benannte Annahme: Die Maschine weicht von der vorhergesagten Bahn weniger als τ ab. Der Sim-Parity-Gate misst diese Abweichung, Toleranzen 0,5–1,5.
- `motion_line` schränkt nicht ein.

**Wächter (Unit):** Codex' Parallelweg-Probe (die Grenze liegt auf dem ersten Stück), identische wiederholte Durchgänge, ein Fenstertreffer auf einem späteren Vorkommen, ein neu geparster Track, ein Schnitt mitten im Segment, eine Pose in einer unbekannten Strecke, keine Kandidaten.

### 3c · Sweep ab einem Startparameter, Grenzkontakte

`CollisionOptions.from = { seg }` auf dem **Basis-Track**, ohne `sliceTrack`:

- **Programmbasis wie bisher:** Erste Pose und Ruhelage des Programms entscheiden die statischen und strukturellen Ausschlüsse. Am Start entsteht kein neuer Ausschluss. Codex' Wiederkontaktfall bleibt damit gemeldet.
- **Grenzkontakt:** An der Pose des Startpunkts gilt jedes nicht ausgeschlossene Paar in Kontakt, das berührt oder ganz innen liegt, als **Grenzkontakt**. Das betrifft Maschinen-, Werkzeug- und Schneidpaare gleichermaßen. Ein Grenzkontakt ist ein eigener Befund (`boundary: true`) auf der ersten Zeile des Rests: „Kontakt am Prüfbeginn — wo er begann, ist nicht neu geprüft“. Er zählt getrennt von den Kollisionen. Ein Schneidpaar wird dort nicht still als „eingerastet“ behandelt. Ein unentscheidbarer Innenstatus am Start wird benannt wie heute.
- **Keine Zertifikate** aus einer anderen Prüfung: Abstands-, Innen- und Freiraumzertifikate beginnen am Start neu.
- **Abdeckung:** Ein Rest deckt `[Start, Ende]`, nie `[0, Ende]`. `covered` und `truncated` beziehen sich auf die Basisachse ab dem Start. Ein fertiger Rest färbt den Präfix nicht als geprüft. Ein Rest der Länge null oder einer nur aus unbekannten Strecken ist ein eigener benannter Zustand.
- **Treffer** liegen schon in Basis-cums; eine Verschiebung entfällt.
- Teilantworten, Parken und Shard-Abbruch behalten diesen Abdeckungsvertrag (`mergeShardResults`).

**Wächter (Unit und Worker):**
- Codex' Wiederkontaktfall: Voll- und Restergebnis enthalten den zweiten Kontakt.
- Ein im Eilgang begonnener Schneidkontakt erscheint am Start als Grenzkontakt.
- Ein am Start ganz eingeschlossener Körper wird erkannt.
- Ein unentscheidbarer Innenstatus am Start wird benannt.
- Eine neue Werkzeuggeometrie übernimmt keinen alten Kontaktzustand.
- Abdeckung bei Teilantwort, Parken und Shard-Abbruch.
- Rest der Länge null und ein Rest nur aus unbekannten Strecken.

### 3d · Bezeichnung

„Restprüfung · Werkzeugtabelle aktualisiert“ mit eigenem Fortschritt und Abschnitt (ab L…), nie „gemessen“. Grund: Der Auslöser ist eine Tabellenänderung, kein Messnachweis (VP102-04).

Benannte Grenze: Eine Messung auf denselben Wert ändert die Tabelle nicht und löst keinen Rest aus. Das bisherige Ergebnis gilt dann weiter, weil sich seine Basis nicht geändert hat.

## Paket 4 · Last, Drehachsen, Anzeige

- **Lastbudget im Lauf:**
  - Ein Restauftrag nutzt höchstens **zwei** Sub-Worker statt `Kerne − 2`.
  - Er läuft mit kürzeren Arbeitsscheiben, 20 statt 40 ms.
  - Ein neuerer Auftrag ersetzt den älteren; es gibt keine Warteschlange.
  - Während ein Payload dekodiert wird, pausiert der Restauftrag.
  - **Messprotokoll** mit festen Zielen, vor jeder Erhöhung: Statusbild-Verarbeitung p95 < 50 ms, Herzschlag-Abstand p99 < 300 ms, keine wachsende Job- oder Speicherwarteschlange bei schnellem Basiswechsel.
  - Geteilter Maschinen-PC und getrennter Browser-PC werden getrennt gemessen.
  - Der gemeinsame Lasttest mit LinuxCNC ist ein späterer Live-Nachweis.
  - Die Oberfläche verspricht keine rechtzeitige Warnung, sie nennt, wie weit geprüft ist.
- **Drehachsen:** Im Lauf mit gültigem Lauf-Prüfstand parkt eine Bewegung von A, B oder C den Restauftrag nicht. Die Bewegung ist im Track modelliert. Kamera- und Tab-Pausen bleiben. Jog und IDLE parken wie bisher.
  - **Wächter:** XYZAC-Programm mit fortlaufendem A/C: der Rest bleibt aktiv und liefert Teilantworten. Dieselbe Positionsänderung im Jog oder Stillstand parkt (Kontrolle).
- **Anzeige:**
  - Die Zusammenfassung im Sim-Tab nennt den Ergebniszustand (1c) und beim Rest den Abschnitt.
  - Das Timeline-Band beginnt beim Start.
  - Befunde hinter der Grenze gehören nicht zum Restergebnis.
  - Die bisherige Vorschau steht nur getrennt und benannt da.

## Abnahme

Je Paket die genannten Wächter, jede Regel mit einer Mutation rot. Wie bisher:
- e2e `collisions.viewer.spec`; der MR-I03-Fall wird angepasst: Rest im Lauf, voll bei IDLE;
- natives Gateway-pytest für Herkunft und `run_id`;
- Live auf der Sim mit einem M600-Programm, sobald eine laufende Sim zur Verfügung steht.

## Antworten auf Codex' Planprüfung R112

| Befund | Antwort | Änderung im Plan |
|---|---|---|
| VP112-01 | Angenommen. | 1b: unveränderlicher Prüfstand, Lauf-Prüfstand beim Laufstart; Prüfungen im Lauf nehmen Start-WCS und geerbtes Werkzeug daraus. Paket 2 mit Pose-, Werkzeug- und Gültigkeitswächtern. |
| VP112-02 | Angenommen. Das Gateway ändert sich. | 1a: `published_origin` und `preview_origin`, `run_id`. 3a: Bindung `(version, source, run_id, Generation)`, Verfall, IDLE wartet nicht. 1c: Ergebniszustände. Wächter für alle genannten Abläufe. |
| VP112-03 | Angenommen. | 3b: Anzeigeposition getrennt von der Untergrenze; frühester Kandidat innerhalb τ, Segmentanfang (`index − 1`), unbekannte Strecken ausgeschlossen. Ganz-Track-Prüfung benannt als Vorschau-Prüfung. „Übersieht nichts“ gestrichen. |
| VP112-04 | Angenommen. | 3c: Startparameter auf dem Basis-Track, Ausschlüsse nur aus der Programmbasis, Grenzkontakte als eigener Befund (auch Schneidpaare), keine fremden Zertifikate, Abdeckung ab dem Start. |
| VP112-05 | Angenommen. | 3d: „Restprüfung · Werkzeugtabelle aktualisiert“; Grenze „Messung auf denselben Wert“ benannt. |
| VP112-06 | Angenommen. | 4: zwei Sub-Worker, 20-ms-Scheiben, ersetzen statt anstellen, Pause beim Dekodieren, Messprotokoll mit Zielen; keine Rechtzeitigkeitszusage. |
| VP112-07 | Angenommen. | 4: Drehachsen im Lauf parken den Rest nicht; Jog/IDLE wie bisher; Wächter. |
