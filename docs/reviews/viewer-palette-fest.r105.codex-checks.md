# R105 — Codex: Aufbau und Wiederholung

8. Oktober 2026. Implementierungsreview `9e6c9cb5..461c39d5`; Archiv `644db8e3` (danach nur die Anfrage). Keine Produktänderung. Alle Tests/Builds in `/tmp/codex-r105-_pz5jalv/archive`, nice 19, Vitest ein Worker. Keine Live-Ports, kein Server und kein Maschinenbefehl. Native Fälle: synthetisches STAT, `linuxcnc.command` verboten, private INI/Parameterdatei/Tool-mmap wie im Repository-Harness. Gateway-Fälle: ausschließlich `fake_linuxcnc` und temporäre Dateien.

## Prüfungen

- **458 Backend-Tests PASS**, pytest über `run_backend.py`: `test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py`. Der Repository-Runner ist doppelt quiet; 458 Punkte, keine Fails/Skips, Exit 0. `backend-final.txt`.
- **211 Client-Repositorytests PASS**, Vitest: `src/viewer/{probeStop,collision,toolChangePayloads,tloEvents,scrubTrack}.test.ts`. `unit.txt`.
- **12 eigene native Programme**, alle ohne Parsefehler, Tool-mmap unverändert. `native.py`, `native-cases.json`, `native.json`, zwölf msgpack-Dateien. Beobachtungsproben: Sie bestätigen die dokumentierten Fehler, nicht deren gewünschtes Sollverhalten.
- **Sechs Scanner-/Buchführungsbeobachtungen**, zwei Kontrollformen, vier unerkannte gültige Schreibweisen: `basis.py`, `basis.json`.
- **Drei reale Handlerpfade unter Fake-Binding**: `startpaths.py`, `startpaths.json`. `auto_run` startet nach validiertem Dateifingerabdruck/Version tatsächlich im Double, lässt aber #3009 auf `read`; `cycle_start` und `auto_step` invalidieren.
- **Abbruch nach ausgeführtem MDI-Schreibzugriff**: `cancel.py`, `cancel.json`. Thread führt `#3009=4` aus, signalisiert das und wartet; Handler wird abgebrochen, Thread freigegeben. Interpreter 4, Buchführung weiter 3/`read`.
- **Zwei Client-Beobachtungsproben PASS**: `client.test.ts`, `client.txt`, `entry.json`, `notes.json`. Reale native Payloads → Decoder/Track/Entry/Sweep bzw. Notizbildung/Zeilenbildung. Die beiden Werkzeugziele für den Notiztest werden ausdrücklich als zwei Zeilen derselben Werkzeugnummer vorgegeben; kein Browsertest.
- **Produktionsbuild PASS**, `npm run build`: `build.txt`. Vites üblicher Hinweis auf Chunks >500 kB.
- Archivvergleich: 3763 Dateien bytegleich mit Git-Blobs, 95 LFS-Dateien gegen Inhaltshash und Länge verifiziert, vier lokale Cache-Pfadänderungen. Die Task-Vergleichsfixture ist bytegleich mit der Routine am Basiscommit. Live-Baum vor Veröffentlichung sauber, HEAD unverändert. `context.json`, `checks.json`, `validate.py`.

## Wiederholung

Neue Archivkopie von `644db8e3` erzeugen. Die `viewer-palette-fest.r105.codex-*`-Belege in einen eigenen Ordner `evidence` kopieren und dabei das Präfix entfernen (beispielsweise `…codex-native.py` → `native.py`). Gateway-Venv der Suite nur als Interpreter/Abhängigkeit benutzen. Aus `archive/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/native.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/basis.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/startpaths.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/cancel.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run_backend.py test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py
```

`native.py` fügt nur Fälle **im Speicher** in das unveränderte `native_start_probe.py` ein; `__file__`, echte Routine und Worker bleiben aus dem Archiv. Der Parameterindex aus dem JSON wird zurück nach int gewandelt; sonst scheitert bereits das Harness an gemischten int/str-Schlüsseln.

Client: Abhängigkeiten einzeln aus dem vorhandenen `node_modules` verlinken; `.tmp/.cache/.vite/.vite-temp` nicht teilen. Vitest-Konfiguration: node, ein Worker, `testTimeout:240000`, Cache außerhalb der Quellen. `client.test.ts` als `src/viewer/r105.codex.test.ts` kopieren und die Konstante `ev` auf den eigenen evidence-Ordner setzen. Mit Vitest ausführen, danach diese Sondenkopie vor dem Produktionsbuild entfernen. Alle vier Cache-Pfadänderungen stehen in `context.json`; `validate.py` akzeptiert ausschließlich diese Ersetzungen.

## Grenzen und Prüfwerkzeug-Korrekturen

- Unveränderte asynchrone Backend-Tests blieben in dieser eingeschränkten Sandbox im Eventloop stehen. Ein isoliertes `asyncio.to_thread(lambda:42)` lieferte 42, blieb anschließend beim Runner-Abschluss hängen. `backend.txt` wurde abgebrochen; `backend-pytest.txt`/`backend-diagnostic.txt` liefen in die Zeitgrenze. Kein belegter Produkt-Deadlock.
- `run_backend.py` registriert ausschließlich einen 10-ms-Eventloop-Timer, auch während des Executor-Abschlusses. Kein Ersatz für `_cmd_blocking`, Sperren oder Produktentscheidungen. Die erste Variante beendete den Timer zu früh (`backend-ticked.txt`); die veröffentlichte Variante läuft durch (`backend-final.txt`, Exit 0). Auch die eigenen asynchronen Sonden verwenden diesen Timer.
- Die erste Abbruchsonde traf die vorherige #3116-Löschung. In der veröffentlichten Sonde ist das Skip-Flag vorab bekannt klar; abgebrochen wird genau der zu prüfende #3009-Schreibzugriff. Erwartung unverändert: Ein bereits ausgeführter Schreibzugriff darf die alte Bestätigung nicht erhalten.
- Kein Playwright/Gesamtgate/Live-Paritätslauf. Kein nativer `task_plan_synch`/`save_parameters`-Beleg; die Gateway-Rücklesetests verwenden den vorhandenen Interpreter-Double. Ein Aufruf `rs274 -h` lieferte nur einen mmap-Initialisierungsfehler und wird nicht als Beleg verwendet. Die offenen Nachweise aus dem Plan sind damit nicht ersetzt.
- Keine Live-Abnahme und keine Freigabe der benannten WRAPPED_ROTARY-Grenze für solche Konfigurationen. Vorherige Belege bleiben unverändert.
