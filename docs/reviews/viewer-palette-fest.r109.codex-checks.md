# R109 — Codex: Prüfumfang und Wiederholung

9. Oktober 2026. Produktvergleich `acd2f754..0da81920`, Archiv `9c06928c`, Produktfix `6166c369`. Nur Archivkopien unter `/tmp/codex-r109-zd3dl8vz`, nice 19, Vitest ein Worker und eigener Cache. Keine Live-Ports, kein HAL, keine Maschinenbefehle. Die nativen Programme laufen im unveränderten Offline-Harness des Archivs mit synthetischem STAT, privater INI/Var-Datei/Tool-mmap und verbotenem `linuxcnc.command`.

## Ergebnisse

- **74 Backend-Tests PASS**: `test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py`. Exit 0, 74 Punkte, keine Skips/Fehler; die doppelt stille pytest-Konfiguration unterdrückt die Schlusszahl (`backend.txt`).
- **118 Client-Repositorytests PASS**: `toolChangePayloads`, `probeStop`, `scrubTrack`, `tloEvents` (`unit.txt`).
- **18 eigene native Eingaben**, alle angenommen, private mmap unverändert: `native.json` (10) und `python-cases.json` (8), Eingaben in `native-cases.json`, je eine msgpack-Datei. Die ersten drei Programme sind unverändert aus R108 übernommen. Fünf NGC-Kontrollen, fünf Python-Varianten mit Standard-Callbackzeile, vier mit expliziter Callbackzeile, vier Hauptdatei-Sub-Kontrollen.
- **5 identische Eingaben an `acd2f754`** (`baseline.json`). Der NGC-Fall war dort falsch und ist jetzt korrigiert. Die Python-Varianten sind vor und nach R109 gleich: ein verbliebener Fall des Herkunftsvertrags, kein neu eingeführter Rückschritt. Die M98-L2-Kontrolle bleibt konservativ (`stale_offset_lines=[0]`), ebenfalls unverändert; kein neuer Befund daraus.
- **4 Beobachtungsläufe** (`trace.json`): Python-Profiling protokolliert nur den Eintritt in `_register_write`, ersetzt weder Methode noch Entscheidung. Alle ausgegebenen Ergebnisfelder sind identisch zum jeweiligen Lauf ohne Profiling. Beim NGC-Rumpf: fremder Dateiname und Hauptzeile 4; beim Python-Rumpf: Hauptdateiname, Remap `m200`, stale XYZ; Standardzeile 0 oder explizite Zeile 4.
- **4 eigene Client-Tests PASS**, `client.txt`. Die dritte Prüfung assertiert ausdrücklich das gemessene Fehlverhalten und ist **keine Soll-Abnahme**. Decode → Track → Sweep mit den WCS-Epochen wie in der Seite. Vier NGC-Fälle bleiben unbekannt/ohne Zeit/Befund; drei explizite Kontrollen bleiben benutzbar. Sieben Python-Gegenfälle erzeugen trotz des ungesicherten G92 einen Befund auf L6 und 1 s Dauer. Zwei weitere Kontrollen behalten die Unsicherheit. Würfel und Kopf je 0,5 mm, Marge 0,1 mm, Hindernis `(15,5,45)`, bei expliziten Kontrollen `(15,5,15)`.
- **Archiv validiert**: 4040 Dateien gleich dem Git-Blob; 95 LFS-Inhalte gegen SHA256/Länge geprüft. Kein geänderter Produktinhalt, auch keine Build-Cache-Pfadänderung. Live-HEAD und sauberer Baum vor Veröffentlichung bestätigt (`validate.txt`, `context.json`). Eigene Vitest-Konfiguration und Sonde sind zusätzliche Dateien nur im Archiv.

## Wiederholung

Archiv `9c06928c` anlegen, LFS-Inhalte materialisieren, falls Pointer vorliegen. Belege in einen eigenen `evidence`-Ordner kopieren, dabei das Präfix `viewer-palette-fest.r109.codex-` entfernen. Aus `archive/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/cases.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/python-cases.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run-trace.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/baseline.py /pfad/zum/repository
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run_backend.py test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py
```

`native.py` injiziert zusätzliche Eingaben in den Speicher des aktuellen Repository-Harness, keine Produktlogik. `{work}` in der Python-Konfiguration wird durch dessen privates temporäres Verzeichnis ersetzt. `cases.py` enthält die übernommenen R108-Eingaben direkt, benötigt keine alten temporären Verzeichnisse. `python-cases.py` erweitert diese. `baseline.py` legt eine neue Archivkopie `baseline` daneben an (Ordner muss frei sein). `run_backend.py` verwendet wie R108 den 10-ms-Timer gegen den Sandbox-Eventloop-Wakeup; keine zusätzlichen Gateway-Mocks.

Client-Abhängigkeiten einzeln aus vorhandenen Paketen verlinken, `.tmp/.cache/.vite/.vite-temp` nicht teilen. Eigene Vitest-Konfiguration: `environment: 'node'`, `maxWorkers: 1`, `testTimeout: 240000`, `cacheDir` außerhalb der Quellen, `include: ['src/**/*.test.ts']`. Für die eigene Sonde `client.test.ts` nach `src/viewer/r109.codex.test.ts` kopieren und `ev` anpassen. Aus `lcnc-webui`: `nice -n 19 node node_modules/vitest/vitest.mjs run --config r109.vitest.config.ts src/viewer/r109.codex.test.ts`.

## Grenzen

Kein erneutes Gesamtgate/Browserlauf/Build: Produktänderung ausschließlich Python, Frontend nur neuer Fixture-Wächter. Nativer Task-Synch-/Rücklesebeleg und M600-Live-Parität bleiben offen. WRAPPED_ROTARY, separate Restprüfung im Lauf und allgemeine Punktzeilen-Zuordnung unverändert außerhalb dieser Nachprüfung.
