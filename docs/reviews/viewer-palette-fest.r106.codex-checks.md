# R106 — Codex: Prüfaufbau und Wiederholung

9. Oktober 2026. Nachprüfung `336bb018..8c7eb172`; Archiv `c9a9c9e1` (Anfrage danach). Tests und Build ausschließlich in `/tmp/codex-r106-pq9gvy45/archive`, nice 19, Vitest ein Worker. Kein Server, keine Live-Ports, keine Maschinenbefehle. Native Fälle mit dem echten Offline-Interpreter, synthetischem STAT, verbotenem `linuxcnc.command`, privater INI/Var-Datei/Tool-mmap; Gateway-Sonden ausschließlich mit `fake_linuxcnc` und temporären Dateien.

## Resultate

- **576 Backend-Tests PASS**: `test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py test_command_dispatch.py`. `backend.txt` enthält 576 Punkte (Repository und Runner zusammen doppelt quiet), Exit 0, keine Fehler/Skips.
- **220 Client-Repositorytests PASS**: `src/viewer/{probeStop,collision,toolChangePayloads,tloEvents,scrubTrack,simRows}.test.ts`, `unit.txt`.
- **12 unveränderte native R105-Programme**: alle ohne Parsefehler und ohne Änderung der privaten Tool-mmap. Alle fünf fremden-M600-Fälle tragen jetzt den Stopp. Die fünf Parameter-Schreibweisen erreichen X4. `native.py`, `native.json`.
- **Sechs zusätzliche native Eingaben**: Vier gültige Programme (`near_call_pair`, `near_call_single`, `remap_write`, `foreign_remap_nested`); zwei absichtlich untersuchte, vom Interpreter verworfene O-Wort/Zuweisungs-Kombinationen (`inline_if_assignment`, `inline_endif_assignment`, „Unexpected character after O-word“). Diese beiden sind **keine Produktbefunde**. `extra.py`, `extra-native.json`; alle 18 Eingaben gemeinsam in `native-cases.json`, je eine msgpack-Datei.
- **R105-Buchführung/Start/Abbruch wiederholt**: sechs Zuweisungsformen jetzt `assumed`; `auto_run`, `cycle_start`, `auto_step` invalidieren vor dem Senden; Abbruch eines bereits gesendeten MDI erhält keine Bestätigung. `basis.json`, `startpaths.json`, `cancel.json`.
- **Neue Remap-Buchführungssonde**: echter `handle_command` mit dem Repository-Task-Double; dessen M200-Körper schreibt #3009=4. Dieser Körper ist unabhängig im nativen Fall `remap_write` ausgeführt. Handler antwortet ok, Interpreter-Double 4, Buchführung weiter 3/`read`/`confirmed`, Rücklesen nicht fällig. `remap-basis.py`, `remap-basis.json`.
- **Drei Client-Sonden PASS**: `client.test.ts`, `client.txt`. (1) Nativer `unknown_first` → Decode/Track/Entry/Sweep: Entry null, Zeit 0, kein Befund. (2) Native wiederholte T2-Messung → getrennte Ereignisse, keine an beide Zeilen angehängte Notiz, beide Einträge in Stats. Die zwei Werkzeug-Zielzeilen werden für diese Notizprobe ausdrücklich vorgegeben; kein Browser. (3) Beobachtung des noch falschen nativen `near_call_pair` → beide Ereignisse L5, auch in Program Stats. Diese dritte grüne Sonde bestätigt **das beobachtete Fehlverhalten**, nicht das Soll.
- **Produktionsbuild PASS**, `build.txt`. Vite nennt weiterhin Chunks >500 kB.
- **Archiv validiert**: 3811 Dateien bytegleich zu Git-Blobs, 95 LFS-Dateien gegen Hash und Länge geprüft; ausschließlich vier lokale Cache-Konfigurationsänderungen. Live-HEAD unverändert, Arbeitsbaum vor Veröffentlichung sauber. `context.json`, `validate.py`, `validate.txt`, `checks.json`. Keine Produktänderung.

## Wiederholung

Eine neue Archivkopie von `c9a9c9e1` erstellen, LFS-Objekte anhand der Pointer-OIDs/Längen aus dem lokalen Git-LFS-Store materialisieren. Die `viewer-palette-fest.r106.codex-*`-Dateien in einen eigenen `evidence`-Ordner kopieren, dabei das Präfix entfernen (`…codex-native.py` → `native.py`). Die bestehende Gateway-Venv nur als Interpreter/Abhängigkeit verwenden. Aus `archive/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/native.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/extra.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/basis.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/startpaths.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/cancel.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/remap-basis.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run_backend.py test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py test_command_dispatch.py
```

`native.py` unverändert aus R105; die Fallinjektion ändert das Harness nur im Speicher. `extra.py` erweitert anschließend `native-cases.json` um sechs Fälle. Produktworker und Routine bleiben unverändert. `basis.py` ebenfalls unverändert aus R105. `startpaths.py` und `cancel.py`: Spione bekommen jetzt die Namen `auto`/`mdi`, damit sie dieselbe neue `_start_kind`-Erkennung wie das echte Binding durchlaufen. Keine andere Erwartung entschärft. `run_backend.py`/asynchrone Sonden verwenden den bereits in R105 beschriebenen 10-ms-Timer gegen Sandbox-Selfpipe-Warteprobleme; keine Produktlogik wird ersetzt.

Client-Abhängigkeiten einzeln aus dem bestehenden `node_modules` verlinken, `.tmp/.cache/.vite/.vite-temp` auslassen. Archiv-eigene Vitest-Konfiguration: node, ein Worker, `testTimeout:240000`, Cache außerhalb der Quellen. `client.test.ts` nach `src/viewer/r106.codex.test.ts` kopieren und seine Konstante `ev` auf den eigenen evidence-Ordner setzen. Nach den drei Tests diese Kopie vor dem Build entfernen. `npm run build` mit den vier Cache-Pfadänderungen aus `validate.py`; keine gemeinsam genutzten Cache-Dateien. Validierung vor Veröffentlichung der Review-Dateien im Live-Baum ausführen.

## Grenzen

Kein erneutes Gesamtgate, kein Playwright, keine Live-Parität und kein nativer Task-Synch-Rücklesebeleg. Der Offline-Interpreter beweist die Remap-/Zahlensemantik, nicht das Speichern eines laufenden milltask. Die offenen Nachweise aus R104/R105 bleiben offen. WRAPPED_ROTARY bleibt ohne neue Freigabe. Die drei Fehlbeobachtungen sind nicht durch grüne Repositorytests aufgehoben.
