## Claude · Die native Stufe, Planfassung 3 · Anfrage R284 · 5. November 2026 · die Reste aus R283

Nichts gebaut. Ersetzt die genannten Punkte der Planfassung 2, alles andere aus ihr ist angenommen und gilt.

### FI282-01 · Zurück auf die R269-Einzelheiten

- **`node_modules`:** eine **echte Kopie** (`cp -a --reflink=auto`). Vor dem Build vergleicht die Zielprüfung Gerät und Inode der Kopie mit dem Original: Jede gleiche Inode bricht ab. Der Grund ist `node_modules/.tmp/*.tsbuildinfo` (`tsconfig.app.json:4`). `realpath` allein reicht nicht.
- **`DISPLAY`:** absolut auf `<lauf>/tree/lcnc-suite`, wie `install_examples.py --repo <tree>` es schreibt; kein PATH-Weg. Dasselbe gilt für alle Programme, die die Kopie startet: `hal_reader.py`, `hal_watchdog.py`, `compensation.py`, `sim_toolsetter_feed.py` und die `loadusr`-Ziele.
  - **Vor dem Start** löst die Zielprüfung jedes Ziel aus HAL-Dateien und INI auf (`realpath`). Es muss im Laufbaum oder in der Kopie liegen.
  - **Nach dem Start** prüft der Prozessnachweis Kommandozeile, `/proc/<pid>/exe`-Interpreter und Skriptpfad. Er ergänzt die Prüfung vor dem Start, er ersetzt sie nicht.
- **Veränderliche Dateien:** `PARAMETER_FILE`, **`POSITION_FILE`**, `TOOL_TABLE`, `PROGRAM_PREFIX`, `TOOL_LIBRARY_DIR`, `WEBUI_MACRO_DIR` und die `settings.json` des Baums. Jede liegt im Laufverzeichnis, geprüft mit `realpath` und Gerät/Inode.
- **`LCNC_LOG_DIR`:** in der Unit ausdrücklich auf `<lauf>/logs` gesetzt. Da die Umgebung Vorrang vor `[DISPLAY] LOG_DIR` hat, prüft der Lauf beides. Nachweis: `LCNC_RESOLVED_LOG_DIR` aus `/proc/<pid>/environ` des Launchers und die tatsächlich geöffneten Log-Dateien (`/proc/<pid>/fd`) des Gateways.
- **Rückgabe:** Das Ergebnis ist eines von drei getrennt ausgewiesenen:
  - **vollständig zurückgegeben**;
  - **LAN gestartet, Trip unquittiert:** Er bleibt unquittiert, mit Beleg;
  - **nicht zurückgegeben**, mit Grund.
- **Signale im Abschluss:** SIGCONT nur nach erneuter Prüfung der Prozessidentität, also PID plus Startzeit aus `/proc/<pid>/stat` gleich dem festgehaltenen Paar. Sonst geht kein Signal hinaus, und das wird belegt.

### FI282-02 · Der M6-Helfer an der echten Schnittstelle

Die WS-Felder sind `tool_change_requested`, `tool_change_tool` und `tool_change_seq`. Die Sequenz ist `null`, solange keine Anforderung offen ist (`status_runtime.py:1383–1395`). `expect_tool_change(tool, deadline)` arbeitet so:
1. **Vor dem Auslösen:** keine offene Anforderung (`tool_change_requested` falsch, `tool_change_seq` null). Sonst bricht die Sequenz ab, ohne zu bestätigen.
2. **Je Verbindung und Instanz** merkt sich der Helfer die zuletzt angenommene, nichtleere Sequenz.
3. **Annahme** nur einer **neuen** Anforderung: `tool_change_requested` wahr, `tool_change_seq` nicht null und ungleich der zuletzt angenommenen, `tool_change_tool` gleich `tool`. Ein fehlendes oder unbekanntes Feld ist nie Werkzeug 0.
4. **Bestätigung** mit `confirm_tool_change {request: seq}`. **Abschluss:** `tool_number == tool`, die Anforderung geschlossen (`seq` wieder null).
5. **Abbruch** ohne Bestätigung, wenn die Verbindung während des Wartens endet.

**Offline-Gegenfälle** (Fake-Status): die erste Anforderung (null → 1), T0, eine alte offene Anforderung vor dem Auslösen, eine falsche Werkzeugnummer, ein fehlendes `tool_change_tool`, das Ende der Verbindung während des Wartens.

### FI282-03 · S5b bleibt offen

- **F-JOG.S5b** („Jeder Jog-Knopf und sein Loslassen senden `jog_cont`/`jog_stop` seiner Achse und Richtung“) wird **nicht** als belegt geführt. Zugeordnet sind nur, was es gibt: die Tastatur je Belegung (`keyboard-guards`) und der Knopf X+ (`joint-jog.spec.ts:85–86`).
- **Lücke:** eine parametrisierte Prüfung der Bildschirm-Knöpfe je Achse und Richtung. Die Diagonalen sind Mehrfach-Jogs und bekommen eine eigene Zeile.
- Das ist ein Browser-Paket, nicht Teil des nativen Laufs.

### FI282-04 · Die HAL-Varianten als abgeleitete Fixtures

Die Kopie bleibt **bytegleich zur Produktionsvariante**; die Zielprüfung vergleicht wie bisher auch die Reihenfolge, ohne Ausnahme. Die Instrumentierung und die verzögerte Variante entstehen **zur Laufzeit in der eigenen Testinstanz**, erst nachdem der Ausgang geprüft ist:
- **Instrumentiert:** `halcmd loadrt sampler depth=4096 cfg=bb` und `addf sampler.0 servo-thread` (ans Ende) und `net` der zwei Pins.
- **Verzögert:** zusätzlich `delf webui-hb-latch servo-thread` und `addf webui-hb-latch servo-thread <Position vor oneshot.0>`.

Der Bericht hält je Variante fest: den geprüften Ausgang (Hash der HAL-Dateien), die genau benannten `halcmd`-Änderungen, die danach **gelesene** Funktionsreihenfolge (`halcmd show thread servo-thread`) und den Variantennamen.
- S4b erhält PASS nur aus der Variante „instrumentiert“, deren gelesene Reihenfolge `oneshot.0` → `webui-hb-latch` → `sampler.0` ist.
- Die Variante „verzögert“ muss FAIL zeigen. Sie ergibt nie einen PASS der Produktionsvariante.
- Nach jeder Variante baut der Lauf die Instanz ab. Die nächste Sequenz beginnt auf einer frischen, wieder geprüften Instanz.

### FI282-05 · Messaufbauten, die ihren Kontakt erreichen

**Antasten Z:**
- **Werkzeug:** T99 kommt in die Spindel per `T99 M6`; der Wechsel ist erwartet (`[99]`) und wird durch den M6-Helfer bestätigt. Die Tabellenlänge L₀ = 50,000 mm wird vorher gesetzt und zurückgelesen; dann `G43 H99`.
- **Geometrie:** Der Kontakt liegt bei Gelenk-Z = −180 + 50 = **−130 mm**. Start bei G53 X10 Y10 **Z−122**, also 8 mm über dem Kontakt und innerhalb von `#3020 = 10`, dem ausgelieferten Wert, unverändert. Der Weg bis zur Achsgrenze Z −190 ist 68 mm.
- **Vars** wie ausgeliefert in `xyz3/sim.var`: `#3014` = 99, `#3015` = 50, `#3016` = 200, `#3017` = 1000, `#3020` = 10, `#3021` = 2. Nur **`#3030` = 0** (Nullpunkt setzen; ausgeliefert 1 = nur messen), gesendet wie die UI mit den Vars des `mdi`. Der Bericht nennt alle zurückgelesen.
- **Bremsen** nach dem Kontakt bei schnell 3,33 mm/s: 3,33²/(2·750) = 0,007 mm, weit innerhalb.
- **Toleranz ±0,003 mm:** eine festgelegte Modellannahme für genau diesen Fall, keine bewiesene allgemeine Genauigkeit. Bei Abweichung werden Messung und Modell untersucht; die Toleranz wird nie nachträglich vergrößert.
- **Zweiter nativer Fehlerfall:** derselbe Aufbau mit Start Z−115 (15 mm über dem Kontakt, mehr als die Suchtiefe). Die Routine darf keinen Kontakt melden und keinen Nullpunkt setzen: G54 Z bleibt unverändert, #5070 = 0, ein Fehler im Fehlerkanal.

**Rückzugsweg:**
- **Vorbereitung:** Der Test setzt `G64 P0.001` (der Profilstand) ausdrücklich und protokolliert ihn; die Routinen übernehmen ihn über `M73`.
- **Bewertet wird der ganze Weg in Phasen**, mit Startbasis, Zielposition und Abschluss:
  1. Z steigt bis ≥ −0,010 mm; X/Y bleiben dabei innerhalb 0,010 mm ihres Starts.
  2. X/Y fahren zum Ziel; Z bleibt dabei ≥ −0,010 mm.
  3. Nur bei G30: der Abstieg auf #5183, erst nachdem X/Y ihr Ziel innerhalb 0,010 mm erreicht haben. Er ist kein verfrühter Rückzug.
- **Abschluss:** `inpos`, Interpreter idle, Endposition gleich dem Ziel innerhalb 0,010 mm.
- Ein Weg, der eine Phase nicht zeigt, ist `incomplete` und nie PASS.

**M600-Sperre:** gebunden an die Messphase zwischen `M50 P0` (`tool_touch_off.ngc:143`) und dem `M50 P1`, mit dem der genommene Zweig sie beendet (Zeilen 177, 220 oder 611).
- Verlangt ist die **beobachtete** Flanke `feed_override_enabled` wahr → falsch, falsch an jedem Sample, solange sich die Achse in der Messphase bewegt, und die Flanke zurück auf wahr vor dem Ende der Routine.
- Ohne beobachtete falsch-Phase ist der Fall `incomplete`, nie ein leeres „überall falsch“.

**Jog-Bremsweg:**
- **Messanker:** das Sample beim Rücklauf der Antwort auf `jog_stop`; Position und `current_vel` daran.
- **Wirksame Beschleunigung:** X/Y 750 mm/s², Z 750 · (1 − 0,2) = 600 mm/s² wegen `OFFSET_AV_RATIO = 0.2`.
- **Grenzen** bei 50 mm/s: X/Y ≤ 2500/1500 + 2·50·0,004 = **2,1 mm**, Z ≤ 2500/1200 + 0,4 = **2,5 mm**. Stillstand innerhalb 0,5 s.

**Erbeten:** `agreement` oder `findings` zur Planfassung 3.
