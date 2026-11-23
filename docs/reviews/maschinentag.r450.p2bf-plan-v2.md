## Claude · P2b-F · Detailplan v2 (Bau P2b-F1) · 23. November 2026

Grundlage: Codex R449 (MT449-01…03, Punkt 4 angenommen) und die Entscheidung „P2b-F1 jetzt, P2b-F2 später“ nach Codex' Gegenvorschlag zur Reihenfolge. Codestellen an development `54955611`. **Planfreigabe erbeten, noch kein Code.**

| R449 | Antwort |
|---|---|
| **MT449-01** erster gepinnter Parse ohne vorherige Veröffentlichung | **Zurückgestellt nach P2b-F2** (Abschnitt F2: offener Aufnahmevertrag). F1 schließt die Falschanzeige ohne ihn. Die R448-Regel „kein ungepinnter Neustart unter dem Lauf“ bleibt und wird zusätzlich an einer Stelle geschlossen, die sie heute umgeht (F1-1 V6, Verbindungsaufbau). |
| **MT449-02** Programmidentität bis zur gezeigten Nutzlast | **F1-1:** Identität Gateway → Draht → Seite. **F1-2:** Seitenschutz „verbergen“ als EIN Tor in `bulkData`. |
| **MT449-03** vollständige Wartegründe; „nach dem Lauf“ nur im passenden Zustand | **F1-3:** `preview_wait` mit allen Gründen, Lebensdauer, Abfolge und den Worten je Zustand. |
| **Punkt 4** Simulationsschalter (angenommen) | **F1-4:** Bindung an `settingsVersion` und der Browserwächter im offen gebliebenen Dialog. |

### Wo der Code mehr verlangt als der Plantext

1. **Gleicher Pfad neu geladen und A→B→A (B unveröffentlicht) parsen heute nichts.**
   - Die Dateikante ist Pfad + mtime (`gateway_util.py:2261–2266`, Aufruf `gateway.py:2020`), und eine Ladung setzt kein `reparse_pending`.
   - Mit Identität wäre die alte Veröffentlichung fremd, und nichts ersetzt sie: Das Verbergen endete nie.
   - Die Ladekante muss deshalb an der Identität hängen (F1-1 V5, Frage C1).
2. **Der Verbindungsaufbau plant selbst.** `schedule_refresh(initial_file, "connect")` (`gateway.py:12642`) umgeht `_restart_wait` (`gateway.py:4022–4045`).
   - Im Fall (c) startet ein zweiter Client oder ein Reconnect während des Laufs einen **ungepinnten Parse unter dem Lauf**.
   - Das bricht MT-I28 (R448).
3. **Die Identität entsteht an zwei Zeitpunkten.**
   - Die Programmgeneration steigt beim Beginn der Schreibung (`gateway.py:3845–3849` über `began=` in `8050`).
   - `active_file` wechselt erst bei der beobachteten Übernahme (`gateway_util.py:461–466`).
   - Ein Neuladen desselben Pfads ist dort gar kein neues `loaded` (`:463`).
   - Ein Entladen zählt doppelt (`gateway.py:8076`, `2336`).
   - Der Zähler beginnt je Prozess bei 0.
4. **`/preview` ignoriert `v`** und liest Körper und Version in zwei Schritten (`gateway.py:11837–11870`), gecacht als `immutable`. Der Worker stempelt die **angefragte** Version (`previewWorker.ts:33, 44, 182`). Eine Identität kann heute nicht mit den Bytes reisen.
5. **Der Text kommt nur mit einer Bekanntgabe**, und zwar für deren Datei (`bulkData.ts:831–873`, `1001–1005`).
   - Zwischen einer Ladung und ihrer ersten Veröffentlichung steht der alte Text unter dem neuen Namen, auch im Leerlauf.
   - `enterEdit` (`GcodePanel.vue:945–957`) bindet diesen alten Text an den **neuen** Pfad: Speichern schreibt A2s Text in C.
   - Das gilt unter `sourceWrite`, also im Leerlauf und armiert, und schon vor P2b.
6. **Etwa 20 Leser greifen direkt auf `viewerGcode` / `gcodeContent` zu** (ThreeViewer, ScrubBar, `runDisplay.ts`, App, die Fehlerbanner `bulkData.ts:725, 738`, GcodePanel). Der Schutz gehört an die Quelle, nicht in jeden Leser.
7. **Die Wartegründe sind nicht vollständig erreichbar.**
   - `_restart_wait` liefert nur den ersten Grund.
   - `ActionLedger.busy()` liefert nur die erste Aktion (`calc_lifetime.py:434–442`).
   - Der Rotary-Halt liegt außerhalb (`gateway.py:2038–2046`).
   - `not_idle` mischt Lauf und Bewegung im Leerlauf (`:4044`).
   - `preview_refresh` gibt es erst ab `inflight` (`bulk_pipeline.py:762–768`; gesetzt in `:915`, nach dem Quell-Hash). Zwischen Planung und `inflight` steht nichts auf dem Draht.
   - Ein Jobende erreicht den Draht nur über `drift_decision`.
8. **Startriegel-Falle:** `loading = gcodeRevision !== gcodeTextRevision` (`App.vue:1934`, `GcodePanel.vue:792`). Ein Verbergen, das eine Revision verschiebt, sperrt Start und Step.
9. **Mock:**
   - 66 `viewer_gcode_ready`-Rahmen in 19 Specs und die Operation `loadGcode` (`mock-gateway.mjs:587–590`) tragen keine Identität.
   - Der Mock-Status hat standardmäßig kein `active_file`.
10. **Ein wiederhergestelltes Programm gilt heute als echte Ladung.**
   - Nach einem Gateway-Neustart ist `spawned_program_gen` `None` ≠ 0 (`gateway.py:4040`); `_restart_wait` lässt den Parse sofort zu.
   - Läuft das Programm noch, entsteht ein ungepinnter Parse aus dem Zustand mitten im Lauf. Mit neuer Epoche zeigte die Seite ihn als die Vorschau des laufenden Programms.

---

### P2b-F1-1 · MT449-02 · Programmidentität

**Heute:**
- **Programmgeneration:** `Generation.new_program` (`calc_lifetime.py:106`) zählt bei jedem Beginn einer Ladung oder Entladung hoch (`gateway.py:3845–3858`). Sie ist prozesslokal, beginnt bei 0 und steht auf dem Draht nur in `drift_decision.gen`.
- **`active_file`:** ist `LoadedProgram.loaded` (`gateway_util.py:314ff`), ein Pfad (`status_runtime.py:1352`).
- **Veröffentlichung:**
  - `published_origin` (`bulk_pipeline.py:1200–1207`) enthält Datei, Source und Version, aber keine Generation.
  - `spawned_program_gen` (`:187`, `:797`) dient nur MT-I28.
- **Bekanntgabe:** `viewer_gcode_ready {version, file, origin}` an zwei Stellen (`gateway.py:12636–12640`, `13004–13016`).
- **„Dasselbe Programm“ wird heute nach dem Pfad entschieden:**
  - Ladekante (`gateway.py:2020`);
  - Ladeterm in `_restart_wait` (`:4040`);
  - `run_start_check` (`bulk_pipeline.py:579`);
  - `start_ctx` / `pinned_ctx` (`:561–567`, `:661`);
  - `refreshes_published` (`:752–760`);
  - Lauf-Tabellenkante (`gateway.py:2183`);
  - `_begin_run_basis.version` (`:4245`);
  - `_run_for_pin` (`:4279–4287`);
  - Cache-Treffer beim Verbindungsaufbau (`:12629–12633`);
  - Werkzeugeinmesser-Kanten (`:6287`, `:6416`, `:6487`);
  - Bindung von `auto_run` (`:7550–7560`).

**Vertrag:**
1. **Identität:** `program_id = "<epoch>.<gen>"`.
   - `epoch` ist die Zufallsepoche des Gateway-Prozesses (heute `_TRIP_EPOCH`, `gateway.py:1622`). Sie gilt je Prozess und wird nie gespeichert.
   - `gen` ist die Programmgeneration, unter der **dieser** Ladevorgang begann.
   - Die Seite vergleicht nur auf Gleichheit und zerlegt die Zeichenkette nie.
2. **Aktiver Ladevorgang:**
   - `_program_began("load")` gibt die Generation aus `new_program` an die ausstehende Ladung, mit einem Rebind im Schreib-Thread.
   - Die Übernahme setzt daraus `loaded_gen`, auch beim Wiederöffnen desselben Pfads (`gateway_util.py:461–466`, `:463`).
   - Ein wiederhergestellter Lade-Datensatz übernimmt die beim ersten Sehen geltende Generation (in einem neuen Prozess 0).
   - **Statusfeld `program_id`** neben `active_file`, aus derselben Momentaufnahme: die Identität des geladenen Programms.
   - Es ist `null`, solange nichts geladen ist, solange eine Änderung aussteht oder unaufgelöst ist (`change_pending`, Ladefenster ≤ 5 s) und für ein unbestätigtes Programm. Eine abgelehnte Ladung ergibt `null`.
   - Das Feld steht in jedem Rahmen, nicht nur in einem Warten.
3. **Jede Veröffentlichung** trägt die Identität der Generation, unter der sie **gestartet** wurde (`_gen_at[0]`, `bulk_pipeline.py:795`).
   - Gesetzt wird sie in `_apply` (`:1166ff`) als `published_origin.program_id`.
   - Ohne Generation (Test-Pipeline) ist sie `null`, also überall fremd.
   - Dieselbe Identität steht in:
     - `viewer_gcode_ready.program_id` (beide Sendestellen);
     - `preview_origin`;
     - `preview_refresh` (aus `inflight`);
     - `run_basis.program_id` (die aktive Identität bei der Startaufnahme);
     - der Antwort von `/preview`.
4. **`/preview` atomar und gebunden:**
   - Körper, Version und `program_id` sind EIN Tupel. `_apply` und `clear_preview` (`bulk_pipeline.py:419`) binden es neu, die Route liest es einmal.
   - Ein `v`, das nicht die aktuelle Version ist, wird mit 409 `superseded` (`no-store`) beantwortet, nie mit anderen Bytes.
   - Die Antwort trägt `X-Preview-Version` und `X-Preview-Program`.
   - Die URL trägt die Identität (`/preview?v=<version>&p=<program_id>`). Damit schlüsseln der `immutable`-Cache des Browsers und `_lastUrl`/`_lastBuf` des Workers (`previewWorker.ts:24–49`) nach Identität.
   - Nach 409 fragt die Seite nichts selbst nach. Es gibt eine neuere Version; deren Bekanntgabe, beim Entladen deren leerer Rahmen, erreicht jede Verbindung über die Versionskante des Status-Loops (`gateway.py:13004–13016`).
   - Der Worker stempelt seine Antwort aus diesen Kopfzeilen. Weichen sie von seiner Anfrage ab, oder kommt 409, verwirft er die Antwort still als `superseded`: kein Ladefehler, kein Fehlerzähler.
   - `/gcode` bleibt, wie es ist. Die Seite stempelt den Text mit Identität und Version der Bekanntgabe; der Fingerabdruck bleibt `X-Program-Source`.
5. **Jeder Ladevorgang ist ein neuer**, auch der gleiche Pfad neu geladen und A→B→A.
   - **Ladekante:** veröffentlichte `program_id` ≠ aktive `program_id`. Die vorhandene mtime-Kante innerhalb eines Programms bleibt.
   - Damit plant jede Ladung ihren eigenen Parse: normale Priorität, eine echte Ladung, die nie wartet.
   - Der Ladeterm von `_restart_wait` liest `spawned_program_gen` ≠ aktive `gen` mit dieser Kante statt `file_changed`.
   - Eine ältere Identität wird nie wieder aktuell, denn innerhalb einer Epoche steigen die Identitäten nur.
   - **Kante und `preview_wait` verlangen eine aktive Identität ≠ `null`.** Im Ladefenster (V2) plant nichts. Sonst parste ein Tick im Fenster den alten Pfad unter der neuen Generation, setzte `spawned_program_gen`, und die echte Ladung gälte danach als Neustart und wartete.
   - **„Eine echte Ladung wartet nie“ gilt nur für eine Ladung, die DIESER Prozess geschrieben hat** (`_program_began("load")`). Ein wiederhergestelltes Programm (V2) ist für `_restart_wait` ein Neustart: Sein erster Parse wartet auf Ruhe, Leerlauf und Stillstand, unter einem Lauf also bis nach dem Lauf.
   - **Kosten:** Ein Neuladen desselben 40-MB-Programms parst neu. Preview-Publish auf der VM 18,6–18,8 s laut perf-matrix (Frage C1).
6. **Der Verbindungsaufbau plant nie.**
   - Er gibt nur eine Veröffentlichung bekannt, deren Identität die aktive ist (`gateway.py:12624–12644`).
   - Der direkte `schedule_refresh(…, "connect")` entfällt. Die Kante des Pollers mit `_restart_wait` ist der einzige Planer einer fehlenden Veröffentlichung.
   - Ein nach Gateway-Neustart wiederhergestelltes Programm hat keine Veröffentlichung. Die Kante feuert im ersten Tick; ihr Parse wartet nach V5 wie ein Neustart.
7. **„Dasselbe Programm“ heißt dieselbe Identität**, an jeder Stelle der Heute-Liste.
   - Innerhalb einer Identität gelten die vorhandenen Stale-Regeln unverändert: mtime-Kante, Drift-Kanten, Werkzeugeinmesser, Schema, Tabelle.
   - Die Generationsprüfung `publish_if` wird nicht gelockert.
8. **`auto_run`** trägt `program_id`.
   - Das Gateway weist eine andere als die aktive und die veröffentlichte ab („Program changed — confirm Run from line again“).
   - Mitzuziehen: `COMMAND_SCHEMA`, `WsCommand` (`lcnc.ts:83`), `commandShapes.test.ts`.
9. **Lebensdauer:**
   - Eine neue Verbindung zum selben Gateway behält jede Identität.
   - Ein neuer Gateway-Prozess (Neustart, Sitzungsende) macht jede frühere Identität fremd (andere Epoche).
   - Ein Neuladen der Seite beginnt leer.

**Wächter:**
- **Backend** (pytest, fake_linuxcnc):
  - A, A neu, B, A ergeben vier Identitäten.
  - Die Veröffentlichung des ersten A ist dem zweiten fremd: `run_start_check` meldet „no publication of this program“, `_run_for_pin` liefert `None`, die Lauf-Tabellenkante handelt nicht.
  - Neuladen desselben Pfads und A→B→A planen je einen Parse (`gcode.refresh_scheduled`). **Rot an 54955611.**
  - Eine abgelehnte Ladung ergibt `null`. Eine Wiederherstellung ergibt `<epoch>.0`, und deren Veröffentlichung passt. Im Ladefenster ist `program_id` `null`.
  - Ein Poller-Tick im Ladefenster plant nichts (`spawned_program_gen` unverändert); die echte Ladung danach wartet nicht.
- **Backend Gateway neu:** Ein Neustart mitten im Lauf mit wiederhergestelltem Programm parst nicht vor dem Leerlauf; `preview_wait` nennt `running`. **Rot an 54955611.**
- **Backend `/preview`:**
  - Eine Veröffentlichung zwischen Körper und Kopfzeile, per gepatchtem `_apply` mitten in der Route, wird nie falsch beschriftet.
  - Ein altes `v` ergibt 409.
- **Backend Verbindungsaufbau:** Fall-(c)-Zustand (C geladen, unveröffentlicht, AUTO läuft, Neustart wartet) plus neue WS-Verbindung ergeben kein `refresh_scheduled`. **Rot an 54955611.**
- **Backend `auto_run`:** Die alte Identität nach Neuladen desselben Pfads wird abgewiesen. **Rot an 54955611**, denn dort reichen Version und Source.
- **Unit** (`bulkData.test.ts`): Eine Worker-Antwort mit abweichenden Kopfzeilen wird verworfen; 409 bleibt still.
- **Mutationen:**
  - Pfad statt Identität in `run_start_check`;
  - Neulade-Kante entfernt;
  - aktueller Zähler statt Start-Generation gestempelt;
  - Planung beim Verbindungsaufbau wieder eingesetzt;
  - Kante mit `null`-Identität;
  - Ausnahme „echte Ladung“ auch für ein wiederhergestelltes Programm.

### P2b-F1-2 · MT449-02 · Seitenschutz „verbergen“

**Heute:**
- `viewerGcode` und `gcodeContent` werden nur von Bekanntgabe und Dekodierung gesetzt (`bulkData.ts:675`, `684`, `831–873`, `887–912`). Nichts vergleicht sie mit `active_file` (`App.vue:882–884`).
- **Leser:**
  - ThreeViewer: Bahn, Bake, Marken, Prüfung, HUD;
  - ScrubBar: Zeitleiste, Prüfung, Zeit, nur mit Simulation;
  - `runDisplay.ts:110–124`, `208–239`: Laufprojektion, Zeile, Marken, auf jedem Gerät, auch mit Simulation aus;
  - App: Statistik, Verletzungen, M600-Text (`:2198–2216`);
  - die Fehler- und Ablehnungsbanner;
  - GcodePanel: Text, Zeilen, RFL-Scans, Edit.
- **Fall (c):** A2s Bahn, Code, Marken und Zeitleiste („100 %“, 00:18) unter C.
- **Fall (a):** Kopf C, Körper „No program loaded“ (`GcodePanel.vue:1245–1254`).
- **Edit** bindet den alten Text an den neuen Pfad (`:945–957`).
- **RFL-Zeilenwahl** arbeitet auf dem alten Text (`:833–857`). Das Gateway wehrt nur über Pfad, Version und Source ab.
- **Vergleiche nach Pfad bzw. Version:**
  - `collisionPrevious` und `admitRunCheck` vergleichen nach Pfad (`ThreeViewer.vue:4562–4564`, `checkBasis.ts:150`).
  - Dedupe und Wächter für späte Antworten vergleichen Version bzw. Datei+Version (`bulkData.ts:760`, `857–870`, `887–889`).

**Vertrag:**
1. **EIN Tor an der Quelle (`bulkData`):**
   - Empfangene Nutzlast und Text werden **mit ihrer Identität gehalten**; der Text trägt die seiner Bekanntgabe.
   - **Sichtbar** als `viewerGcode` / `gcodeContent` / `gcodeTextSource` sind sie nur, solange ihre Identität gleich `program_id` aus den **Status-Daten** ist. Sonst sind sie `null` bzw. `""`.
   - Hüllenfelder (`preview_origin`, `preview_refresh`, `preview_wait`) dürfen den Daten einen Rahmen vorauslaufen. Sie werden über ihre eigene Identität zugeordnet, nie über die Ankunftsreihenfolge.
   - Kein Leser prüft selbst.
   - Der Schutz endet nur mit passenden Daten, nie mit dem Fehlen oder Ende eines Wartedatensatzes.
2. **Verborgen ist alles, was daraus folgt**, mit Simulation an UND aus:
   - Bahn, Eilgänge, Grenzüberlagerung;
   - Zeitleiste mit Zeit und Abdeckung;
   - Prüfergebnis und „bisheriges“ Ergebnis, Anfahrtsergebnisse;
   - Marken (Werkzeug, Grenze, Kollision);
   - Codezeilen und Zeilenzuordnung (`trustedLines`, `runLineState`, `subExecState`);
   - Laufprojektion (`runDisplay.ts`);
   - Statistik, Verletzungen, M600-Text;
   - Fehler- und Ablehnungsbanner der fremden Nutzlast;
   - Sim-Zeilen.
3. **Es bleibt:**
   - Maschinenstatus, DRO, Bannerzustand, Abort / Pause / E-Stop, Maschinenmodell;
   - `active_file` im Codepanel-Kopf;
   - Download / Reload / Unload (an den Pfad gebunden).
4. **Kein neuer Startriegel:**
   - Im verborgenen Zustand sind beide sichtbaren Revisionen `""` und gleich; `programLoading` und `startContext.loading` sind falsch.
   - `loading` ist nur wahr, solange der eigene bekanntgegebene Text des **aktiven** Programms unterwegs ist (die heutige Regel).
   - Start, Leertaste, Gamepad und Step lassen `startRefusal` bzw. `run` wie heute zu, mit und ohne Vorschau.
5. **Textgebundene Bedienung** wirkt nie auf einen fremden Text:
   - Edit braucht sichtbaren Text; verborgen ist es gedimmt mit „Program text not loaded yet — wait“.
   - Die Edit-Sitzung merkt sich die Identität ihres Texts.
   - Zeilenwahl, RFL-Scans und `confirmRunFromLine` lesen nur den sichtbaren Text und senden `program_id` (F1-1 V8).
   - G-Code-Referenz und Inline-Unterprogramm lesen nur Sichtbares.
   - Haltschlüssel: `program_id|path|revision|text revision`. Ein Identitätswechsel beendet einen Halt, nach der vorhandenen Regel.
6. **Abgeleitete Ergebnisse an die Identität:**
   - `collisionPrevious` nur innerhalb einer Identität (`ThreeViewer.vue:4562–4564`).
   - `admitRunCheck`: Herkunft, Lauf und gezeigte Nutzlast mit EINER Identität (`checkBasis.ts:144–158`).
   - Die Übernahme in `driftWait` liest die sichtbare Nutzlast; eine fremde Version zählt nie als übernommen.
   - `_basisFor` und der Dekodierwunsch schließen die Identität ein (`bulkData.ts:939–960`).
   - Die GcodePanel-Schlüssel, die heute nur `activeFile` lesen (`:373`, `:431–432`, `:807`), lesen die Identität.
7. **Späte Antworten:**
   - Ein später `/gcode`-Text, eine späte Worker-Dekodierung und eine späte Kollisions- oder Anfahrtsantwort mit anderer Identität werden bei Ankunft verworfen bzw. gehalten, nie gezeigt.
   - Die Prüfung wird beim Verbergen abgebrochen, wie heute bei einem Programmwechsel (`ThreeViewer.vue:4559–4572`).
8. **Verbindung:**
   - Getrennt bleibt die letzte Sichtbarkeit stehen; das Banner sagt DISCONNECTED. Der Status wird beim Schließen nicht geleert (`connectionGone`, `lcncWs.ts:111–125`).
   - Der erste Statusrahmen der neuen Verbindung entscheidet:
     - **Gleiche Epoche:** kein Verbergen, nichts neu geholt (Dedupe nach Epoche + Identität + Version), keine neue Prüfung.
     - **Andere Epoche:** ab diesem Rahmen verborgen, bis zur passenden Veröffentlichung des neuen Gateways.
9. **Worte** aus dem EINEN Modul aus F1-3:
   - Codepanel-Körper: statt „No program loaded“, wenn ein Programm aktiv ist.
   - HUD-Zeile: `.hudWarn` in `.hudNotes`, zählt in `hudWarnCount` (`ThreeViewer.vue:5658`).
   - Sim-Tab-Leerzustand (`SimPanel.vue:596`).
   - Laufbanner-Zusatz (`App.vue:319–326`).

**Wächter:**
- **Unit** (`bulkData.test.ts`):
  - Sichtbarkeitsmatrix: Nutzlast- und Text-Identität × Status-Identität × Epoche; Text vor Status, Status vor Nutzlast;
  - späte Antworten: Text, Dekodierung, Prüfung;
  - Reconnect mit gleicher Epoche: kein Verbergen, kein Neuholen, keine neue Prüfung;
  - die verborgenen Revisionen sind gleich.
- **Browser** (neue `program-identity.spec.ts`, Mock):
  - **Fälle:** (c) im Leerlauf und im Lauf; gleicher Pfad neu; A→B→A; Reconnect (gleiche Epoche); Gateway-Neustart (neue Epoche). Jeder Fall mit verzögertem Text, verzögerter Dekodierung und (Simulation an) verzögerter Prüfantwort.
  - **Messung:** Ein Rahmenrekorder prüft jeden Rahmen vom Wechsel des aktiven Programms bis zur Übernahme:
    - nie ein fremder Bahnpunkt, eine fremde Codezeile, Marke, Zeitleistenzeit, Prüf-% oder Laufzeile;
    - die Worte durchgehend vorhanden, bei der Übernahme weg.
  - **Bedienung:** Start, Leertaste und Gamepad sind im Leerlauf verborgen zugelassen. Edit ist gedimmt mit Grund. Keine Zeile ist wählbar.
  - **Simulation AUS:** alles wiederholt. `runDisplay` zeigt keine Laufzeile und keine Marken des fremden Programms.
  - **Rot an 54955611.**
- **Nativ** (echtes LinuxCNC, echte Seite; die Fälle des Seitentreibers der P2b-Prüfung als native Fälle):
  - (a), (b) und (c), (c) als Hauptfall, auch mit Simulation aus.
  - Die Seite zeigt nie A2s Bahn oder Code unter C, vom Laden bis zur Übernahme nach dem Lauf; (b) unverändert.
  - (c) **rot an 54955611** (Bildschirmfoto).
- **Mutationen:**
  - Sichtbarkeit nach Datei statt Identität;
  - ungleiche verborgene Revisionen (Startriegel);
  - Worker ignoriert die Kopfzeilen;
  - `collisionPrevious` nach Datei;
  - `admitRunCheck` ohne Identität.

### P2b-F1-3 · MT449-03 · Wartestatus auf dem Draht

**Heute:**
- `_restart_wait` (`gateway.py:4022–4045`) liefert einen Grund: `unloading`, `held:` / `observed:` (nur die erste Aktion, `calc_lifetime.py:434–442`), `debounce` oder `not_idle`.
- Der Rotary-Halt (`gateway.py:2038–2046`) hält auch eine echte Ladung und ist nur getraced.
- Ein überfälliger Dateischreiber hält weiter (`overdue_files`, `:409`), auch nach Laufende.
- `preview_refresh` gibt es nur bei gesetztem `inflight` (`bulk_pipeline.py:762–776`).
- Jobenden stehen nur in `drift_decision` (`:516–530`).
- Nichts benennt das Warten des Falls (c).

**Vertrag:**
1. **Gründe vollständig:** EINE reine Funktion liefert jedes Veto, das in diesem Tick einen Parse des aktiven Programms hält:
   - `running`: Interpreter nicht idle, auch PAUSED;
   - `moving`: Interpreter idle, `current_vel` ≠ 0;
   - `held:<what>` und `observed:<what>` für JEDE offene Aktion (neu `ActionLedger.busy_all()`);
   - `overdue:<what>` für einen Dateischreiber über seiner Grenze, der weiter hält;
   - `debounce`;
   - `settle:rotary`;
   - `unloading`.

   `_restart_wait` behält Entscheidung und Reihenfolge; es ist das erste Element, und eine echte Ladung wartet weiter nur auf den Rotary-Halt. **Der Datensatz berichtet, er entscheidet nichts.**
2. **`preview_wait {program_id, file, reasons[], since_ms, last_end?}`** in der Status-Hülle (`ws_fanout.build_status_envelope`, `ws_fanout.py:206–278`):
   - **In JEDEM Rahmen**, solange er gilt, wie `drift_decision`.
   - Er gilt, solange das aktive Programm keine eigene Veröffentlichung hat und kein Parse von ihm geplant ist oder läuft.
   - `last_end` ist der letzte Job dieser Identität, der ohne Veröffentlichung endete: `{job, why}`.
3. **Lebensdauer:**
   - Jeder Poller-Tick berechnet ihn aus den tatsächlichen Bedingungen.
   - Er endet **nie über eine Frist**: kein Countdown, kein `until`.
   - Eine neue Ladung ersetzt ihn (neue Identität).
   - Er endet in dem Tick, in dem sein Job geplant wird, und beim Entladen (Identität `null`).
   - Das Ende des Wartens allein zeigt nichts; sichtbar wird erst die passende Veröffentlichung (F1-2 V1).
4. **Abfolge auf dem Draht:**
   1. **Wartend:** `preview_wait`.
   2. **Parse:** `preview_refresh {program_id, job, first, phase}` steht **ab `schedule_refresh`**. Bis `inflight` gesetzt ist, gilt `phase: "starting"`; das schließt die heutige Lücke. `first` heißt: keine Veröffentlichung dieser Identität; die Bezeichnung ist dann „Program load“.
   3. **Ende:** die passende Veröffentlichung wird bekanntgegeben und sichtbar, oder ein benannter Fehler. Eine Nutzlast mit Parse-Fehler oder Ablehnung ist passende Daten und zeigt ihr Banner. Ein Jobende ohne Veröffentlichung erscheint als `last_end`.
5. **Worte:** EIN reines Modul `previewWait.ts` entscheidet in dieser Reihenfolge:
   1. Passende Daten sichtbar → keine Worte.
   2. Sonst `preview_refresh` dieser Identität → „lädt“.
   3. Sonst `preview_wait` dieser Identität → nach den Gründen.
   4. Sonst „Preview not ready“.

   Datensätze einer anderen Identität zählen nicht. Die Aktionsnamen bezeichnet EINE Tabelle über die `input_action`-Befehle aus `COMMAND_EFFECTS` (`command_policy.py:946`) und die Namen der Dateischreiber (`program_file`, `macro_file`, `tool_table_file` …). Ein Name ohne Bezeichnung erscheint roh.

| Zustand (aktives Programm, keine passenden Daten) | HUD-Zeile (Hilfe ≤ 120) | Codepanel-Körper | Laufbanner |
|---|---|---|---|
| `program_id` null, Datei genannt (Ladefenster) | — | „Loading program“ | — |
| Parse dieser Identität, `first` | „Preview loading“ (vorhandene Re-Parse-Zeile; Banner „Program load“) | „Text and preview loading“ | — |
| `running`, Start unbelegt | „Preview after the run“ — Hilfe: „Started before its preview was ready. Path, limits and collision check follow after the run.“ | „Text and preview after the run“ | „· PREVIEW AFTER THE RUN“ |
| `running` + offener Dateischreiber | „Preview after the run and \<writer\>“ | entsprechend | wie oben |
| Leerlauf, `held:` / `observed:` | „Preview waits for \<action\>“ — Hilfe: „The preview reads the machine's state; it waits while \<action\> is open.“ | „Text and preview wait for \<action\>“ | — |
| Leerlauf, `overdue:` | „Preview waits for \<writer\> — still open“ | entsprechend | — |
| `moving` / `debounce` / `settle:rotary` | „Preview waits for standstill“ / „… for the machine to settle“ / „… for the rotary axes to rest“ | entsprechend | — |
| `last_end` ohne Halt | „Preview not ready — last parse failed“ (Hilfe nennt `why`) | gleich | — |
| nichts davon | „Preview not ready“ | gleich | — |

6. **„Nach dem Lauf“** gilt nur, solange `running` unter den Gründen ist und der Start unbelegt ist (`run_basis.verified` falsch; in F1 jeder solche Lauf).
   - Ein offener Dateischreiber wird mitgenannt.
   - Im Leerlauf wird die offene Aktion bzw. der Schreiber genannt.
   - `moving`, `debounce` und `settle:rotary` werden ohne Zusage genannt.
7. **MT-I28 unverändert:** Kein Parse einer ersten Ladung startet unter dem Lauf.

**Wächter:**
- **Backend, rein:**
  - jeder Grund allein und kombiniert;
  - offene Aktion nach Handlerende ergibt `observed:…`;
  - überfälliger Schreiber im Leerlauf ergibt `observed:…` + `overdue:…` und hält nach Laufende weiter;
  - `running` gegen `moving`;
  - `settle:rotary` bei einer echten Ladung;
  - `unloading`;
  - `_restart_wait` identisch zu heute auf den vorhandenen Fällen (`test_calc_lifetime_gateway.py:420–454`).
- **Backend, Datensatz:**
  - steht in jedem Rahmen, solange er gilt;
  - wird durch eine neue Ladung ersetzt;
  - fehlt im Planungstick, `preview_refresh` steht ab diesem Tick (`starting`). **Rot an 54955611** (Lücke).
  - Eine Testuhr über die Ruhefrist hinaus im Lauf bleibt `running`.
  - Ein Timeout-Job ergibt `last_end`.
- **Browser** (Mock):
  - Worte je Zeile der Tabelle.
  - Ein Rahmen ohne jeden Datensatz und ohne passende Daten zeigt weiter „Preview not ready“.
  - Die Worte verschwinden genau mit der Sichtbarkeit.
  - Ein Reconnect im Wartezustand zeigt sie ab dem ersten Rahmen.
  - Fehler und Timeout.
- **Nativ:**
  - (c) zeigt ab dem Start `preview_wait {reasons: [running, …]}` und „Preview after the run“, nach dem Lauf `preview_refresh first` und dann die Übernahme.
  - Zwischen Start und Leerlauf gibt es kein `gcode.refresh_scheduled` (MT-I28).
  - Ein MDI im Leerlauf nach einer Ladung ergibt `observed:mdi`, dann die Ruhefrist, dann den Parse.
- **Codex' Liste:**
  - „Fehlende Startbasis unter AUTO“ sind (a) und (c).
  - „Erfolgreicher gepinnter Parse während AUTO“ ist in F1 die vorhandene Lauf-Tabellenneuberechnung eines passenden Programms: Sie veröffentlicht weiter, wird sichtbar, ihre Prüfung wird zugelassen; Identität auf allen drei. Die positiven Erstfälle gehören zu F2.

### P2b-F1-4 · Punkt 4 · Simulationsschalter (angenommen)

**Heute:**
- `simPending` (`DevicesSettings.vue:31`) vergleicht `simOn` mit `loadSimulationDefaults()`. Das liest das nicht reaktive `_confirmed` (`defaults.ts:401`, `719–721`).
- Der Watcher (`:32–35`) setzt nur `simOn` neu; nach „Saved“ bleibt es gleich, der Computed wird nicht ungültig, und der Hinweis bleibt stehen.
- `simulationOn` (`defaults.ts:774–777`) liest `settingsVersion`.

**Vertrag:**
- `simPending` liest `settingsVersion` und `serverSettingsReady` wie `simulationOn`. Es ist genau dann wahr, wenn der Schalter dieses Tabs von dem abweicht, was der Server hält.
- Eine verweigerte Speicherung wird nie als gehalten gezeigt, ob stale (`applyStale`, `:301–311`) oder blockiert/nicht gebunden. Der Schalter zeigt den Serverstand, oder er bleibt ausstehend, und der Speicherstatus nennt die Ablehnung.

**Wächter** (`devices.spec.ts`, im offen gebliebenen Dialog):
- Umschalten zeigt den Hinweis.
- Der Mock bestätigt per Rundsendung; der Hinweis verschwindet ohne Wiederöffnen. **Rot an 54955611.**
- Hält der Mock die Antwort zurück, bleibt der Hinweis.
- Eine stale-Ablehnung mit `enabled:false` stellt den Schalter auf aus; nichts behauptet „gehalten“.
- Eine blockierte Speicherung lässt den Hinweis stehen.
- Mutation: `simPending` ohne `settingsVersion`.

### P2b-F2 · MT449-01 · Erster gepinnter Parse ohne Veröffentlichung (zurückgestellt, nicht in diesem Bau)

Mit F1 zeigt ein Lauf, der vor seiner ersten Vorschau startete, bis nach dem Lauf **keine** Vorschau, benannt. F2 bringt sie während des Laufs, auf einem eigenen Vertrag. Offen für die eigene Planung:

- **Quelle und Aufnahmezeit je Basisbestandteil**, keiner aus einer Veröffentlichung:
  - Parametertext + G92;
  - Fixture-Index + WCS-Tabelle + Var-Patches;
  - Rotary-Pose;
  - Kins-Typ und -Rahmen;
  - Werkzeugstart: angewandte TLO, geladenes Werkzeug, Startmodus;
  - Werkzeugeinmesserwerte;
  - Softlimit-Fenster;
  - Laufoptionen;
  - Programm-Source.

  Ein Lade-Schnappschuss muss gegen zwischenzeitliche Änderungen gesichert sein. Ein Lesen nach Beginn der Ausführung ist kein Startnachweis.
- **Bindung an die tatsächliche Start- bzw. erste Step-Schreibung** (`_cmd_blocking(admit=, written=)`, `run_basis` `sending → sent`), einschließlich abgelehntem bzw. ungesendetem Start und Linkwechsel.
- **Aufgenommen ≠ übereinstimmend:**
  - Ein eigenes Feld benennt die Art der Basis.
  - `verified` behält seine Bedeutung (die vorhandene Veröffentlichung gleicht dem Start).
  - `_run_for_pin` lässt eine aufgenommene Basis nur nach eigener Regel zu.
  - Unvollständige oder nicht unterstützte Aufnahmen bleiben ungepinnt; dann gelten F1s Worte.
- **Laufbindung der ersten Veröffentlichung:**
  - Der gepinnte Pfad liest Rotary- und WCS-Metadaten aus `published_*` (`bulk_pipeline.py:894–897`).
  - Er vergleicht die Werkzeugbasis-Revision nach `_set_tool_basis` mit der des Starts (`:1176–1206`).
  - Beides setzt den Wiederholungsfall voraus. Gebraucht wird eine Regel für den Erstfall, einschließlich Laufende/Abbruch, neuer Ladung und neuer Startbasis während des Jobs. Keine Lockerung der Generationsprüfung.
- **Wächter (Codex):**
  - positiver Erstfall ohne jede und mit fremder Veröffentlichung, beide an die aufgenommene Basis gebunden;
  - Basis zwischen Laden und Start geändert;
  - fehlender Bestandteil;
  - abgelehnter Start;
  - spätes Ergebnis nach Laufende bzw. neuer Ladung.

  Ein positiver Test mit vorab eingesetzter Veröffentlichung beweist nichts.
- **In F1 vorbereitet, nicht gezeigt:** `preview_refresh {first, pinned}` erhält das Wort „Preview being prepared“.

### Bau und Prüfung

- **Reihenfolge:**
  1. F1-1 (Gateway und Draht, die Backend-Wächter rot → grün)
  2. F1-3
  3. F1-2
  4. F1-4
  5. Mock und Specs
  6. native Fälle
  7. Mutationen
  8. `round_gate.py --base 54955611`
  9. Merge-Gate
- **Mock:**
  - Identitäten entstehen an EINER Stelle von `mock-gateway.mjs`.
  - Ein Statusrahmen bzw. eine Bekanntgabe oder Preview-Antwort ohne `program_id` erhält die aktuelle Mock-Identität.
  - Eigene Operationen setzen eine fremde Identität oder eine neue Epoche (Frage C3).
- **Mitzuziehen:**
  - `rules.py` für neue Dateien;
  - `COMMAND_SCHEMA` und `commandShapes` für `auto_run.program_id`;
  - das Inventar, wenn sein Wächter anschlägt;
  - `CLAUDE.md` (Kurzform `bulkData` und Frische), der volle Eintrag in `docs/architecture/scrub-and-run.md`, `docs/decisions.md`.
- **Vor dem Maschinen-Update:**
  - die nativen Fälle (a)/(b)/(c) mit echter Seite;
  - einmal perf-matrix: Der Datensatz wird je Tick berechnet; die Last wird gemessen, nicht angenommen.

### Fragen an Codex

- **C1** „Jede Ladung parst“: kostet beim Neuladen desselben großen Programms einen vollen Parse. Oder eine benannte Umbindungsregel, die eine Veröffentlichung derselben Source unter die neue Identität übernimmt? Ich schlage das Parsen vor; die Umbindung ließe eine alte Antwort wieder aktuell werden.
- **C2** `/preview` mit 409 bei `v` ≠ aktuell, oder Körper mit Kopfzeilen beschriften und dem Worker die Prüfung überlassen? Ich schlage 409 vor, weil `?v=N` heute ein Jahr lang `immutable` gecacht wird.
- **C3** Die Standard-Identität im Mock für die 66 vorhandenen Rahmen, statt jeden Rahmen umzustellen: annehmbar, wenn die Specs zur Identität fremde Identitäten ausdrücklich setzen?
- **C4** Der Zusatz im Laufbanner zusätzlich zu HUD und Codepanel: behalten?
- **C5** Den eigenen Text des aktiven Programms vor seiner Vorschau zeigen (nur lesend, ohne Zeilenzuordnung)? Das liegt außerhalb von F1; als eigener Punkt?
