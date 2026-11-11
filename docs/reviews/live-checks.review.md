# Live-Prüfungen vor main · Korrekturen der Testtreiber

Review-Datei der Live-Prüfungen, die der Operator am 11. November 2026 angefordert hat („mache die checks die auf deiner seite offen sind“). Das Produkt ist development `f54f3120`.

---

## Claude · Anfrage R346 · 11. November 2026

**Kurz:** Die Live-Prüfungen haben **am Produkt nichts gefunden**. Drei Testtreiber waren hinter Produktverträgen zurück. Sie lieferten Rot, das kein Produktfehler war, und in zwei Fällen Grün aus dem falschen Grund. Die Korrekturen liegen auf `fix/native-settings-rev` (Worktree `~/lcnc-suite-fs`), `f54f3120..10775728`, zwei Commits. Nur `scripts/` und ein Backend-Test ändern sich. Gateway, HAL-Helfer, Subroutinen und Beispielkonfigurationen sind die von `f54f3120`.

**Erbeten:** `agreement` zu den beiden Commits, damit ich den Operator um das Go zum Merge nach development bitten kann, oder `findings`.

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

Beide Treiber stammen von vor BG-14. Ihre geschützten HTTP-Schreibzugriffe trugen nur das Token. Seit dem 29. Oktober lehnt das Gateway jeden davon ab.

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
  - Neuer Backend-Schritt `perf-matrix` (`scripts/test_perf_matrix.py`, 6 Tests): die 403-Ergebnisse aus Lauf 1 scheitern, die gemessenen bestehen; `armed_writer` gegen einen Fake-Gateway (Schlüssel im Header, Arm/Disarm, abgelehntes Arm bricht vor dem Schreiben ab); das Urteil von `run()`. [7 Mutationen rot](live-checks.r346.mutations.txt).

### Grenzen, die du prüfen solltest

1. **`MACHINE_BUSY` sind wörtliche Gateway-Texte im Treiber.** Der Treiber darf das Gateway nicht importieren, weil ein Import die laufende Sim bindet. Ändert sich ein Text, wird die Live-Zeile rot, also in die sichere Richtung.
2. **`scenario_failure` liest Schlüssel-Konventionen** (`status`, `*_status`, `*_ok`). Ein künftiges Szenario, das eine Eigenschaft anders benennt, fällt nicht darunter. Die Alternative wäre eine ausdrückliche Zusicherung je Szenario; ich habe die Konvention gewählt, weil sie alle heutigen Szenarien abdeckt, ohne sie umzuschreiben.
3. **`macro_live_check` hat keinen Offline-Test.** Er braucht ein laufendes LinuxCNC. Sein Rot ist Lauf 1, sein Grün Lauf 2.
4. **Das Harness (`env.sh` usw.) liegt nicht im Repo**, nur als [Abschrift](live-checks.20261111.harness.txt). Es hatte selbst einen Fehler: LinuxCNC lief unter dem Fake-HOME des Installers, die Prüfskripte unter dem echten. LinuxCNC legt seine Tool-mmap unter `$HOME/.tool.mmap` ab, also scheiterte `stat.poll()` (SystemError oder Segfault, [Beweis](live-checks.20261111.pass1.proof.txt)).

### Belege

- **Round-Gate** [live-checks.r1.gate-round.json](live-checks.r1.gate-round.json) (`--base f54f3120`): **PASS** am Kopf `10775728`. Lint, Build, Unit (leicht), Backend mit allen Schritten, darunter der neue Schritt `perf-matrix`, die native Stufe und die Installationsprobe. Browser: die ausgewählte Spec `example-tool-library`. Heavy-Unit ausgelassen: keine schwere Datei erreicht.
- **Live:** Lauf 1 (rot am Treiber) und Lauf 2 (grün), siehe [live-checks.20261111.md](live-checks.20261111.md).
- **Kein Token** in den Belegen, geprüft gegen jedes INI-Token auf der VM.
- Die LAN-Test-Sim läuft wieder auf `f54f3120`.
- **Offen vor main:** die Hardware-Validierung am Maschinen-PC; probe-live und firefox-core haben keine Infrastruktur.
