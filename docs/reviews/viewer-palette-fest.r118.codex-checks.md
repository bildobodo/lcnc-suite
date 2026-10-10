# R118 · Codex · Prüfaufbau und Wiederholung

Stand: `4232a44d051662538785388b9d051d26a4621535`, Vergleich `5692f3b1..4232a44d`, 10. Oktober 2026. Eigene Archivkopie `/tmp/codex-r118-__gpv7fl`; keine Produktänderung im Live-Checkout. Dort werden nur Review-Anhang und neue Belege abgelegt. Bestehende Belege bleiben unverändert.

## Ergebnisse

| Prüfung | Ergebnis | Aussage / Grenze |
|---|---|---|
| Repository-Backend, G30/Toolsetter/TLO/Werkzeugnummer | 55 PASS | Gezielte Regression, kein gesamtes Offline-Gate |
| `collisionRange.test.ts`, `toolChangePayloads.test.ts` | 40 PASS | Bereichszeile und bestehende Payload-Regeln |
| Web-Produktionsbuild | PASS | Übliche Vite-Warnung zur Chunkgröße |
| Neuer Browser-Test zur Startzeile in aufgerufener Routine | 1 PASS | Echte Seite mit eigenem Mock auf 127.0.0.1:4188 |
| AUTO-Interleaving | Befund reproduziert | Echter Gateway-Dispatch, Repository-Task-Doppelgänger, kein Live-Abbruch |
| Sim-Zielprüfung des neuen Readback-Skripts | Befund reproduziert | LinuxCNC und Gateway durch Doppelgänger ersetzt; nicht-simulierte INI wird bis `estop_reset` akzeptiert |
| Native Interpreterproben | 5 ausgeführt, kein SKIP | 1 Fehlerfall G53/G91 wie erwartet; 3 G30-Bewegungsfälle; 1 falsche Werkzeugidentität beim Zufallswechsler |

Keine Verbindung zu :5173 oder :8000, keine Live-NML-Befehle, keine HAL-Abfragen oder Maschinenbefehle. Native Proben verwenden den vorhandenen `native_start_probe.py`: synthetischer Status, private temporäre INI/Parameter-/Werkzeugdateien und Werkzeugablage; `linuxcnc.command` ist verboten. Installierter Interpreter: LinuxCNC `1:2.9.4-2+deb13u1`.

## Belege rekonstruieren

Die Dateien `viewer-palette-fest.r118.codex-*` stammen aus `evidence/` der Archivkopie. Zum Wiederholen eine neue Archivkopie des genannten Commits anlegen und die Belege unter Entfernung des Präfixes nach `evidence/` kopieren. Beispielsweise wird `viewer-palette-fest.r118.codex-backend_runner.py` zu `evidence/backend_runner.py`. Die Runner erwarten diese Namen. Die bestehende Python-Umgebung kann lesend verwendet werden; Caches und Ausgaben gehören in die Kopie. Native Fälle laufen einzeln in getrennten Prozessen.

Vom Verzeichnis `ARCHIV/lcnc-gateway` mit dem Python der Gateway-Umgebung:

```bash
PYTHONPATH="$PWD:$PWD/../evidence" python ../evidence/backend_runner.py \
  test_g30 test_toolsetter_basis test_gateway_util.TestTloEvents \
  test_tool_change_motion_worker.TestToolNumberIsTheRowsId \
  test_m600_preview_worker.TestPredictedMeasurement.test_the_measured_tool_is_named_by_its_number_not_its_row
PYTHONPATH="$PWD:$PWD/../evidence" python ../evidence/backend-probe.py ../evidence/auto-read-race.json
PYTHONPATH="$PWD:$PWD/../evidence" python ../evidence/readback-target-probe.py ../evidence/readback-target.json
python ../evidence/native-runner.py
```

`backend_runner.py` setzt wie R116/R117 einen Selector-Weckruf alle 20 ms. Es ersetzt weder Produktfunktionen noch Assertions und ist kein Latenznachweis. Die Race-Probe ersetzt ausschließlich die Befehlsannahme im Task-Doppelgänger: nach dem letzten Status-Poll wird READING gesetzt, dann dessen reguläre `mode`-Semantik ausgeführt. Das Ergebnis enthält den so ausgelösten Abbruch und die bestätigte G30-Antwort.

Die Ziel-Probe importiert das neue Live-Skript mit `fake_linuxcnc`; ihr Gateway zeichnet nur auf. Ein ersetzter Retry-Helfer sendet einmal an diesen Doppelgänger und beendet den Setup-Pfad. Es werden weder Sockets geöffnet noch Signale gesendet. Sie bestätigt das Fehlen der Zielprüfung vor dem ersten schreibenden Befehl, nicht die Ausführung der gesamten Homing-Sequenz.

`native-probe.py` erweitert die Falltabelle des Repository-Helfers. Für `r118_random_repeat` bildet es P0=T7, P1=T1, P2=T2 ab und aktiviert die private zufällige Werkzeugverwaltung. Produkt-Canon und Interpreter sind unverändert. Die Probe beschränkt sich auf die erneute Wahl des anfangs bereits geladenen Werkzeugs; sie ist keine vollständige Prüfung aller Wechslerfolgen. `native-results.json` enthält die Payloads, `native-summary.txt` die entscheidenden Felder; die einzelnen `native-r118_*.txt` sind die Prozessausgaben.

Vom Verzeichnis `ARCHIV/lcnc-webui`, mit lesend bereitgestellten Abhängigkeiten und eigenen Cacheverzeichnissen:

```bash
npx vitest run --config r118.vitest.config.ts src/viewer/collisionRange.test.ts src/viewer/toolChangePayloads.test.ts --reporter=dot
npm run build
npx playwright test --config r118.playwright.config.ts -g 'a run check that begins inside a called routine'
```

Beide verwendeten Konfigurationen liegen bei: `codex-vitest.config.ts` nach `lcnc-webui/r118.vitest.config.ts`, `codex-playwright.config.ts` nach `lcnc-webui/r118.playwright.config.ts` kopieren (jeweils mit dem vollständigen R118-Dateipräfix in den Belegen). Für den Browser wurde ausschließlich in der Archivkopie `e2e/ctl.ts` von `http://localhost:4174` auf `http://127.0.0.1:4188` umgestellt; der Mock wird durch Playwright gestartet und beendet. Ein Worker, kein bestehender Server, kein Live-Ziel. Die Sandbox-Freigabe für diesen isolierten lokalen Mock wurde erteilt. Die Repository-Spec und ihre Assertions sind unverändert.

## Quellen und Abgrenzung

`sources.json` prüft die SHA256 der gelesenen Produkt-/Testdateien gegen die Git-Objekte des Review-Stands. Browser-Konfiguration und umadressierter Kontrollhelfer sind separat benannt. `context.json` hält den anfänglich sauberen Arbeitsbaum und den Hash der Review-Datei vor dem Anhang fest; `sha256.json` umfasst die veröffentlichten Belege außer sich selbst.

Für die AUTO-Semantik zusätzlich gelesen: LinuxCNC `emcTaskAbort`/`emcTaskSetMode` in `emctask.cc`, die Zulassung von `EMC_TASK_SET_MODE_TYPE` in `emctaskmain.cc`; für Tasche 0 der installierte `rs274.interpret.StatMixin`. Die lokalen Quellkopien werden mit Pfad und Hash in `sources.json` benannt. Primärquellen:

- [LinuxCNC 2.9.4 Task](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/task/emctask.cc)
- [LinuxCNC 2.9.4 Task-Zulassung](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/task/emctaskmain.cc)
- [LinuxCNC Antastung](https://linuxcnc.org/docs/2.9/html/gcode/g-code.html#gcode:g38)

Claudes Messungen, Mutationen, Profiling und Live-Parität sind gelesen, nicht erneut auf der laufenden Sim ausgeführt. Das Review trennt deren Nachweise von den eigenen Tests. Keine vollständige Wiederholung des Offline-Gates, keine Stundenläufe des Kollisionsorakels und keine neue Behauptung zur realen Bremsdynamik.
