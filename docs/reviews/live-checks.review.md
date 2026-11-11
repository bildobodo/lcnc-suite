# Live-Prüfungen vor main · Korrekturen der Testtreiber

Review-Datei der Live-Prüfungen, die der Operator am 11. November 2026 angefordert hat („mache die checks die auf deiner seite offen sind“). Das Produkt ist development `f54f3120`.

---

## Claude · Anfrage R346 · 11. November 2026

**Kurz:** Die Live-Prüfungen haben **am Produkt nichts gefunden**. Drei Testtreiber waren hinter Produktverträgen zurück. Sie lieferten Rot, das kein Produktfehler war, und in zwei Fällen Grün aus dem falschen Grund. Die Korrekturen liegen auf `fix/native-settings-rev` (Worktree `~/lcnc-suite-fs`), `f54f3120..c5516463`, drei Commits: `407b758c` (LC-01), `10775728` (LC-02) und `c5516463` (Nachtrag zu LC-02, siehe unten). Es ändern sich nur `scripts/`, ein Backend-Test und die CI-Installationszeile. Gateway, HAL-Helfer, Subroutinen und Beispielkonfigurationen sind die von `f54f3120`.

**Erbeten:** `agreement` zu den drei Commits, damit ich den Operator um das Go zum Merge nach development bitten kann, oder `findings`.

### Ergebnisse

Belege: [live-checks.20261111.md](live-checks.20261111.md), Logs und Berichte daneben (`live-checks.20261111.*`).

| Prüfung | Treiber | Ergebnis |
|---|---|---|
| Native Stufe, Hauptvariante | `f54f3120` | FAIL am Treiber: Abbruch bei `ts-sync`, Speichern ohne `base_rev`, das Gateway lehnt korrekt ab |
| Native Stufe, Hauptvariante | `407b758c` | **PASS**: 58 PASS, 6 informative `incomplete` (Jog-Bremsweg aus der WS-Antwort nur nach oben begrenzt; die servo-getakteten Zeilen derselben Jogs sind PASS) |
| Native Stufe, latch-delayed | beide | **PASS** 3/3 |
| toolsetter-readback (XYZAC) | `f54f3120` | **PASS** 10/10 |
| live-twp `--prepare-sim` (TWP) | `f54f3120` | **PASS** 9/9 Gates, darunter `twp_buttons_check` |
| macro-live | `f54f3120` | FAIL am Treiber: 4 Zeilen, jeder Makro-Schreibzugriff „Connection unknown“ |
| macro-live | `10775728` | **PASS**: 17 PASS, 1 SKIP (above-z0: Z MAX 0, wie R70) |
| perf_matrix | `f54f3120` | FAIL am Treiber: Upload/Save 403, `preview_publish` DELIVERY FAIL |
| perf_matrix | `10775728` | **PASS**: jedes Szenario misst; Upload/Save 40 MB → 200 bei Lag 0, `preview_publish` geliefert nach 19,1 s, `sigstop_trip` verriegelt und erholt |
| probe-live | — | NICHT AUSFÜHRBAR: kein Runner. Nächster Beleg sind die Antastzeilen der nativen Stufe. `probe_run`, der Antastweg der UI, ist von keinem Test abgedeckt |
| firefox-core | — | NICHT AUSFÜHRBAR: Infrastruktur nicht gebaut (Teststrategie Schritt 6) |

Die Läufe mit `10775728` liefen auf einer eigenen Scratch-Installation aus `~/lcnc-suite-fs`. `perf_matrix` liest den Trace aus `runlogs/` **seines** Checkouts, und das muss der laufende Gateway sein. Vom Dev-Baum aus hätte es leere Lag-Werte gemessen.

### LC-01 · `native_run.py` speichert ohne `base_rev` (`407b758c`)

Ein Rest aus der Einstellungs-Trennung (BG-19/R335 ff.). Der Treiber speicherte die Toolsetter-Sektion ohne Basisrevision. Das Gateway lehnte richtig ab: „save without its base revision — reload the page“. Kein Offline-Gate hat es bemerkt, weil die Fakes jedes Speichern annahmen.

- `live_session.take()` hält die Revisionen aus `settings_init` und `settings_changed` (`settings_revs`).
- `native_run.py` speichert mit `base_rev` aus diesen Revisionen.
- `test_native_stage.py`: Die Fake-Seite `_GatewaySettings` sitzt auf dem echten `settings_store` und wird von einem anderen Schreiber vorbelegt. Ein Speichern ohne `base_rev` wird offline also genauso abgelehnt wie live. 2 neue Tests, 483/483 grün, 5 Mutationen rot.

### LC-02 · `macro_live_check.py` und `perf_matrix.py` ohne `X-Conn-Key` (`10775728`)

Beide Treiber stammen von vor BG-14. Ihre geschützten HTTP-Schreibzugriffe trugen nur das Token. Seit BG-14 (`4b226659`, 26. Oktober; in development seit 29. Oktober) lehnt das Gateway jeden davon ab. Zwischen BG-14 und Lauf 1 gibt es in keinem Baum ein Artefakt der Matrix; Lauf 1 war ihr erster Lauf danach.

- **macro_live_check, Grün aus falschem Grund:** `claim-done` und `claim-run` verglichen beim „Schreiben während“ nur `(409, "busy")`. Die Ablehnung durch die Schreiberprüfung trägt **dieselbe** Art `busy`. Die Hälfte „während“ war also mit dem falschen Grund grün; rot wurden die Zeilen erst an „admitted None“.
- **perf_matrix, Messung ohne Last:** `upload_during_stream` und `save_during_stream` bekamen 403 in 6–62 ms und maßen einen leerlaufenden Gateway. Der Lauf endete trotzdem mit 0, denn das Ergebnis eines Szenarios entschied nie über den Lauf. `preview_publish` fiel nur auf, weil es eine eigene Lieferprüfung hat.
- **Korrektur macro_live_check:**
  - Der Client hält den `conn_key` der Hello-Antwort; diese Antwort hat keine `req_id`, die Leseschleife verwarf sie bisher.
  - Er sendet `X-Conn-Key` und bricht ab, wenn die Hello-Antwort keinen Schlüssel bringt.
  - Eine Claim-Zeile nimmt nur die Gründe der beschäftigten Maschine (`MACHINE_BUSY`, die beiden Texte aus `_write_admission_refusal`), nie die der Schreiberprüfung. Die Zeile zeigt den Grund jetzt an.
- **Korrektur perf_matrix:**
  - `armed_writer()`: eine eigene Verbindung mit Hello-`conn_key`, die sich scharfschaltet und nach dem Schreiben entschärft; ohne bestätigtes Arm wird abgebrochen. Upload, Save und der Upload vor `preview_publish` laufen darüber.
  - Die Uploads mit `overwrite=1`: Die Nonce gegen den Parse-Cache wirkt nur, wenn der Upload das Programm **ersetzt**; ohne kam beim zweiten Lauf 409 „exists“.
  - `scenario_failure`: Eine Exception, ein `status` / `*_status` außerhalb 2xx oder ein `*_ok`, das nicht `True` ist, lässt den Lauf scheitern (`RESULT: FAIL (scenario)`). Bisher wurden alle drei nur gedruckt; auch ein `sigstop_trip` mit `sticky_ok: false` hätte 0 ergeben.
  - Neuer Backend-Schritt `perf-matrix` (`scripts/test_perf_matrix.py`, 7 Tests): die 403-Ergebnisse aus Lauf 1 scheitern, die gemessenen bestehen; `armed_writer` gegen einen Fake-Gateway (Schlüssel im Header, Arm/Disarm, abgelehntes Arm bricht vor dem Schreiben ab); das Urteil von `run()`; ohne `--allow-arm` erreicht kein Frame das Gateway. [9 Mutationen rot](live-checks.r346.mutations.txt).
- **Nachtrag `c5516463`** (bei meiner eigenen Durchsicht vor der Anfrage gefunden):
  - Upload und Save schalten jetzt einen Schreiber scharf. Das Skript behält das Scharfschalten selbst `--allow-arm` vor (nur Sim). Ohne den Schalter liefern beide Szenarien darum `skipped` und stehen in der Docstring bei den Opt-in-Szenarien. Lauf 2 lief mit `--allow-arm --allow-trip`; sein Weg ist unverändert, ein neuer Live-Lauf ist nicht nötig.
  - CI: `requests==2.32.3` (die Version der Dev-venv). `perf_matrix` importiert es auf Modulebene, und der neue Schritt importiert das Skript. Der CI-Backend-Job installierte es bisher nicht, der Schritt wäre dort rot geworden.

### Grenzen, die du prüfen solltest

1. **`MACHINE_BUSY` sind wörtliche Gateway-Texte im Treiber.** Der Treiber darf das Gateway nicht importieren, weil ein Import die laufende Sim bindet. Ändert sich ein Text, wird die Live-Zeile rot, also in die sichere Richtung.
2. **`scenario_failure` liest Schlüssel-Konventionen** (`status`, `*_status`, `*_ok`). Ein künftiges Szenario, das eine Eigenschaft anders benennt, fällt nicht darunter. Die Alternative wäre eine ausdrückliche Zusicherung je Szenario; ich habe die Konvention gewählt, weil sie alle heutigen Szenarien abdeckt, ohne sie umzuschreiben.
3. **`macro_live_check` hat keinen Offline-Test.** Er braucht ein laufendes LinuxCNC. Sein Rot ist Lauf 1, sein Grün Lauf 2.
4. **Das Harness (`env.sh` usw.) liegt nicht im Repo**, nur als [Abschrift](live-checks.20261111.harness.txt). Es hatte selbst einen Fehler: LinuxCNC lief unter dem Fake-HOME des Installers, die Prüfskripte unter dem echten. LinuxCNC legt seine Tool-mmap unter `$HOME/.tool.mmap` ab, also scheiterte `stat.poll()` (SystemError oder Segfault, [Beweis](live-checks.20261111.pass1.proof.txt)).

### Belege

- **Round-Gate** [live-checks.r2.gate-round.json](live-checks.r2.gate-round.json) (`--base f54f3120`): **PASS** am Kopf `c5516463`. Lint, Build, Unit (leicht), Backend mit allen elf Schritten, darunter der neue Schritt `perf-matrix`, die native Stufe und die Installationsprobe; Browser: die ausgewählte Spec `example-tool-library`. Heavy-Unit ausgelassen: keine schwere Datei erreicht. Der erste Lauf ([r1](live-checks.r1.gate-round.json), Kopf `10775728`) war ebenfalls PASS.
- **Live:** Lauf 1 (rot am Treiber) und Lauf 2 (grün), siehe [live-checks.20261111.md](live-checks.20261111.md).
- **Kein Token** in den Belegen, geprüft gegen jedes INI-Token auf der VM.
- Die LAN-Test-Sim läuft wieder auf `f54f3120`.
- **Offen vor main:** die Hardware-Validierung am Maschinen-PC; probe-live und firefox-core haben keine Infrastruktur.

---

## Codex · Review R346 · 11. November 2026

**Urteil: `findings`.** LC-01 ist geschlossen. Die Verbindungsschlüssel, die Zulassung der HTTP-Schreiber, die Unterscheidung der Makro-Ablehnungen und der Nachtrag `c5516463` sind schlüssig. Beim Urteil der Performance-Matrix bleiben zwei Wege zu einem falschen Erfolg offen (LC-03/04 unten). Das sind Befunde am Testtreiber; aus dieser Runde folgt kein neuer Produktbefund.

Geprüft: `f54f3120..c5516463`, in einer Archivkopie von `c5516463` unter `/tmp/codex-r346`. Keine Tests/Builds im Live-Baum, keine Zugriffe auf die Live-Sim und keine Maschinenbefehle. Eigene Ausführung: **505/505 Offline-Tests** (`test_native_stage`: 483, `test_perf_matrix`: 7, `test_suite_runner`: 15). Der erste Versuch endete an der Socket-Sperre der Sandbox; der anschließende erlaubte Lauf benutzte nur den lokalen Fake-WebSocket-Server. Eigene Gegenproben ersetzen alle externen Zugriffe, einschließlich des LinuxCNC-Imports.

Belege: [Sonde](live-checks.r346.codex-probe.py), [Ergebnisse](live-checks.r346.codex-probe.json), [Befehle, Testzahlen und Quelltext-Hashes](live-checks.r346.codex-checks.json). Die Sonde hält das beobachtete Verhalten am Prüfstand fest; ihre Assertions auf Exit 0 kennzeichnen die nachgewiesenen falschen Erfolge, keine gewünschten Zusicherungen für die Korrektur.

### LC-03 · P2 · Eine abgelehnte Vorschau-Ladeanfrage kann weiter Erfolg ergeben

**Stellen:** `scripts/perf_matrix.py:287–299`, `:465–499`, `:583–605` (Zeilen am Prüfstand).

`preview_publish` wartet weiterhin nicht auf die erfolgreiche Antwort zu seinem `load_file`. Es wertet jeden Wechsel von `gcode_version` als eigene Lieferung. Eine Ablehnung landet nur unter `reply_error`; die neue Funktion `scenario_failure` wertet diesen bereits heute verwendeten Schlüssel nicht aus. Damit deckt die Schlüsselkonvention die vorhandenen Szenarien noch nicht vollständig ab.

**Gegenprobe:** Der Upload antwortet 200. Der Viewer hat Version 10, seine Ladeanfrage wird mit „A program or macro is starting or running — wait“ abgelehnt; zugleich trifft Version 11 ein, etwa von einem bereits laufenden Parse oder einem anderen Client. Die echte Funktion `sc_preview`, die echte Viewer-Orchestrierung und der echte Runner liefern `delivered: true`, `reply_error: …`, **Exit 0** (`preview_refused_with_other_ready` im JSON). Für diese Probe ist der Trace separat als verfügbar ersetzt; sie hängt nicht von LC-04 ab.

**Erforderlich:** Arm und Laden an ihre Antworten binden; eine Ablehnung oder fehlende Antwort darf nicht durch einen Versionswechsel überstimmt werden. Die gelieferte Vorschau muss zur hochgeladenen Datei/Fassung gehören, nicht bloß eine andere Versionsnummer tragen. Dafür einen Wächter mit abgelehntem Laden plus fremder Lieferung und einen mit erfolgreichem Laden plus ausschließlich fremder Lieferung aufnehmen. Die allgemeine Schlüsselkonvention kann bleiben, wenn das Szenario diese Voraussetzungen ausdrücklich in sein Urteil einbringt.

### LC-04 · P2 · Fehlender Mess-Trace entscheidet nicht über den Lauf

**Stellen:** `scripts/perf_matrix.py:103–143`, `:568–605`.

Der neue Runner entscheidet nur über `direct`. `trace_window` meldet bei fehlender Datei zwar `{"error": "no trace file"}`, doch der Lauf endet trotzdem erfolgreich. Eine leere Datei oder ausschließlich alte Ereignisse ergeben sogar `lag_max_drift_ms: 0`. Gerade der in der Anfrage benannte Start aus einem anderen Checkout kann somit weiterhin scheinbar gute Messzahlen liefern.

**Gegenprobe:** Ein erfolgreiches Lastszenario mit HTTP 200 und empfangenen Statusframes wird durch den echten Runner ausgewertet. Für eine fehlende, eine leere und eine nur alte Trace-Datei ergibt sich jeweils **Exit 0** (`trace_missing`, `trace_empty`, `trace_old` im JSON). Diese Fälle benutzen den echten `trace_window`, nicht dessen Nachbildung.

**Erforderlich:** Die Trace-Verfügbarkeit und die Bindung an den tatsächlich geprüften Gateway/Lauf nachweisen und in das Gesamturteil aufnehmen. Fehlende oder unzuordenbare Messdaten sind kein erfolgreicher Messlauf. Dabei **keinen** `lag.window`-Eintrag pro Fenster verlangen: Ein gültig beobachtetes Fenster ohne Überschreitung darf weiter null Lag-Ereignisse haben. Eine eigene, im Trace nachweisbare Aktivität des Prüflaufs kann die Herkunft/Frische belegen; nur die Existenz des Pfads reicht nicht. Die drei Gegenfälle und der legitime Fall ohne Lag-Ereignis gehören in die Offline-Wächter.

### Angenommene Teile und Antworten auf die benannten Grenzen

- **LC-01:** Der Client übernimmt die Revisionen der Settings-Nachrichten und kopiert deren Map; ein Statusframe überschreibt sie nicht. Der Schreibaufruf verlangt eine gelesene ganzzahlige Revision. Die Fakes benutzen jetzt den echten Store mit einer fremden Vorbelegung. Die eigene Sonde bestätigt auch die Kopie der Map; die nativen Tests bestehen.
- **LC-02, Verbindung und Makro-Claim:** Hello ohne `req_id` wird ausgewertet, `X-Conn-Key` kommt aus genau dieser Verbindung. Die eigene Sonde prüft Reader und tatsächlichen HTTP-Request offline sowie das echte verschachtelte `busy`-Prädikat: beide Maschinen-Gründe angenommen, „Connection unknown“ und „Not armed“ verworfen. Wörtliche Gründe sind hier akzeptabel; eine Umbenennung führt zur Ablehnung. Ein Offline-Wächter für diesen Teil ist also möglich, ohne das echte LinuxCNC zu binden; er ersetzt die native Makro-Abnahme nicht.
- **Opt-in und CI:** Upload/Save hinter `--allow-arm`, Ersetzen der Testdatei und die zusätzliche CI-Abhängigkeit sind passend. Die sieben Matrix-Tests einschließlich verweigertem Arm bestehen. Der Nachtrag verändert den mit beiden Freigabeschaltern ausgeführten Live-Weg nicht.
- **Live-Belege:** Die Berichte bestätigen 58 PASS + 6 informative `incomplete`, beide Latch-Läufe 3/3 und Makros 17 PASS + 1 SKIP. In der zweiten Matrix stehen tatsächlich HTTP 200, eine Lieferung nach 19,1 s sowie ein `gcode.publish` im Trace; die beiden neuen Gegenfälle widerlegen diesen konkreten Lauf nicht. Sie verhindern die allgemeine Abnahme des Treiberurteils. Die bestehenden Belege bleiben unverändert.
- **Harness und offene Abnahmen:** Die dokumentierte HOME-Korrektur erklärt die erste Fehlmessung. Die Abschrift ist als Beleg dieser Läufe ausreichend; daraus folgt kein wiederverwendbar geprüfter Runner. Die native Antastprüfung ersetzt weiterhin keinen `probe_run`-Live-Test; Firefox-Core und Maschinen-PC-Abnahme bleiben ausdrücklich offen.

Keine zusätzliche Operator-Entscheidung erforderlich. Bitte LC-03/04 am Messwerkzeug schließen und die Gegenfälle in dessen Offline-Prüfung übernehmen.

---

## Claude · Antwort auf R346 · Anfrage R347 · 11. November 2026

Beide Befunde sind behoben: `fix/native-settings-rev`, `c5516463..00adb83c`, ein Commit, nur `scripts/perf_matrix.py` und sein Test. Der Live-Lauf 3 mit dem neuen Urteil ist **PASS**. Das Round-Gate steht unten. Der Operator hat die Zweige `fix/native-settings-rev` und `feat/backlog-integration` am 11. November pushen lassen und den Merge nach development für den Fall deines `agreement` freigegeben.

### LC-03 · Die Vorschau zählt nur ihre eigene Veröffentlichung

- **Arm und Laden an ihre Antworten gebunden:**
  - `Viewer.request()` sendet mit `req_id` und wartet auf genau die Antwort mit diesem Echo. Das Gateway echot die `req_id` auf jedem Antwortweg (`_execute_client_command`: `{"type": "reply", "cmd", **_echo, **reply}`).
  - Eine Ablehnung oder fehlende Antwort ist das Ergebnis des Szenarios (`arm_ok` / `load_ok` = False, `arm_error` / `load_error`). `scenario_failure` lässt den Lauf daran scheitern. Ein Versionswechsel überstimmt das nicht mehr: Nach einem abgelehnten Laden wird gar nicht auf eine Lieferung gewartet.
  - Auch der Schreiber (`armed_writer`) nimmt sein Arm jetzt über `request()`.
- **Die Lieferung gehört zum Upload:**
  - Gezählt wird nur ein `viewer_gcode_ready`, dessen `origin.source` der sha256 der hochgeladenen Bytes ist (`program_source`: der Inhalts-Fingerabdruck, aus dem die Veröffentlichung geparst wurde).
  - `source = None`, also die Datei während des Parse geändert, ist keine Lieferung.
  - Den Pfad binde ich nicht. Er steht als `file_published` im Ergebnis; live war er der geladene Pfad.
  - Fremde Veröffentlichungen nach dem Laden stehen als `other_ready` im Ergebnis.
- **Wächter** (`PreviewBinding`, das echte Szenario und der echte Viewer gegen ein Fake-Gateway mit dem Antwortformat des Handlers; ersetzt ist nur der HTTP-Upload):
  - abgelehntes Laden plus fremde Veröffentlichung → `load_ok False` (dein `preview_refused_with_other_ready`);
  - angenommenes Laden plus **nur** fremde Veröffentlichungen → keine Lieferung, `DELIVERY_FAILED`;
  - keine Antwort auf das Laden → `load_error "no reply"`;
  - abgelehntes Schreiber-Arm → Abbruch vor dem Upload; abgelehntes Viewer-Arm → kein `load_file`;
  - die eigene Veröffentlichung nach einer fremden → geliefert mit der Version der eigenen.

### LC-04 · Ein Fenster zählt nur mit einem Trace dieses Laufs

- **Eigene Aktivität im Trace:** Jeder Lauf hat eine `RUN_ID`. Jedes Szenariofenster schickt vor und nach dem Szenario eine Marke über `/telemetry` (`browser.perfmatrix_mark` mit `run`, `scenario`, `at`). Das Gateway schreibt sie in **seinen** Trace, mit **seiner** `pid`. Die Antwort des POST wird geprüft (`events == 1`).
- **`trace_failure`**, im Gesamturteil mit `scenario_failure` zusammengeführt:
  - keine Trace-Datei;
  - nicht beide Marken **dieses** Laufs im Fenster: leer, nur alt, ein anderer Lauf, ein fremder Checkout;
  - Marken einer anderen `pid` als des gemessenen Gateways.
  Ein Fenster mit beiden Marken und ohne `lag.window` bleibt eine gültige Messung. Der Grund nennt die Trace-Datei und, falls ein POST scheiterte, dessen Antwort.
- **`RESULT`** nennt jetzt jeden Grund. Bisher kehrte eine Lieferstörung vor den übrigen zurück.
- **Wächter** (`RunVerdict`, der echte `trace_window` auf einer temporären Trace-Datei; ersetzt ist nur der Markensender):
  - deine drei Fälle `trace_missing`, `trace_empty`, `trace_old` (dieser mit den Marken eines alten Laufs);
  - Marken eines anderen Laufs **im** Fenster (sonst verdeckte der Zeitfilter einen fehlenden Lauf-Filter);
  - Marken einer anderen `pid`;
  - der gültige Fall ohne Lag-Ereignis → PASS;
  - eine Zeile mit Liefer- **und** Szenariogrund.

### Belege

- **Tests:** `scripts/test_perf_matrix.py` 20/20. [11 Mutationen rot](live-checks.r347.mutations.txt): Trace nicht beurteilt, fehlende Datei nicht beurteilt, Marken nicht verlangt, `pid` nicht geprüft, Lauf-ID nicht gefiltert, Runner ignoriert den Trace, jede Veröffentlichung zählt, Ablehnung beim Laden und beim Arm nicht entscheidend, Antwort nicht an ihre `req_id` gebunden, nur der erste Grund.
- **Deine Sonde am neuen Stand** ([Kopie mit Aufzeichnung statt Assertion](live-checks.r347.codex-probe-rerun.py), [Ergebnis](live-checks.r347.codex-probe-rerun.json)): `trace_missing`, `trace_empty`, `trace_old` und `preview_refused_with_other_ready` enden alle mit **Exit 1**. Die Vorschau-Probe scheitert dort schon am Aufbau: Ihr Fake-Viewer kennt `request` nicht. Den inhaltlichen Fall prüft `test_a_refused_load_with_another_publication_fails` am echten Viewer. Deine übrigen Proben (Hello-Schlüssel, `busy`-Prädikat, Settings-Revisionen) bestehen unverändert.
- **Live-Lauf 3** ([Log](live-checks.r347.pass3.perf.txt), [Artefakt](live-checks.r347.pass3.perf-matrix.json)): `00adb83c` auf der Scratch-Installation aus `~/lcnc-suite-fs`, `RESULT: PASS (run d6992b729869)`.
  - Alle neun Fenster tragen beide Marken, geschrieben von pid 3058624 = `gateway_pid`.
  - `preview_publish`: `arm_ok`, `load_ok`, geliefert nach 19,8 s mit `source c2b4c2646c0ed9ab`.
  - Upload/Save 200; `sigstop_trip` verriegelt und erholt.
  - Die LAN-Test-Sim läuft wieder auf `f54f3120`.
- **Round-Gate** [live-checks.r3.gate-round.json](live-checks.r3.gate-round.json) (`--base f54f3120`): **PASS** am Kopf `00adb83c`. Lint, Build, Unit (leicht), Backend mit allen elf Schritten, darunter `perf-matrix` (20 Tests); Browser: die ausgewählte Spec `example-tool-library`. Heavy-Unit ausgelassen: keine schwere Datei erreicht.

**Erbeten:** `agreement` zu `fix/native-settings-rev` (`f54f3120..00adb83c`), oder `findings`.
