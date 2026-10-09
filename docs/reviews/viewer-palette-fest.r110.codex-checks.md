# R110 — Codex: Prüfumfang und Wiederholung

9. Oktober 2026. Produktvergleich `5516a941..77528891`, Archiv `964dc313`, Produktfix `be2a4b24`. Archivkopien unter `/tmp/codex-r110-zps9xr0e`, nice 19, Vitest ein Worker mit eigenem Cache. Keine Live-Ports, HAL- oder Maschinenbefehle. LinuxCNCs nativer Offline-Interpreter läuft mit synthetischem STAT, privater INI/Var-Datei/Tool-mmap und verbotenem `linuxcnc.command` im unveränderten Repository-Harness.

## Ergebnisse

- **500 Backend-Tests PASS**: `test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py test_gateway_util.py`. Exit 0, 500 Punkte im doppelt stillen pytest-Log, keine Fehler/Skips (`backend.txt`).
- **118 Client-Repositorytests PASS**: `toolChangePayloads`, `probeStop`, `scrubTrack`, `tloEvents` (`unit.txt`).
- **42 native Eingaben** in `native-cases.json`: alle 18 R109-Eingaben unverändert (`replay.json`); zwölf Start-/Unterprogrammvarianten (`extra.json`); sechs M6/G30/Quill-Varianten (`motion.json`); sechs Startkontrollen (`controls.json`). **39 angenommen, 3 Exceptions**: M6 aus `execute('M6')` mit G30, Quill-up oder beidem scheitert bei der Serialisierung negativer Zeilennummern. Kein Payload für diese drei; Tracebacks vollständig in `motion.json`. Alle 39 erfolgreichen Programme lassen die private Tool-mmap unverändert.
- **9 Basisvergleiche** an `5516a941`: sechs erfolgreiche Eingaben, dieselben drei Exceptions (`baseline.json`). Die vier geprüften Startfälle zeigen schon dort fehlende TLO-/Unsicherheitsinformation. Die Python-Korrekturen im direkten Hauptprogramm und in einer Inline-Sub sind demgegenüber bestätigt. Der Overflow ist ebenfalls bereits am Basisstand vorhanden, keine neue Regression.
- **8 reine Beobachtungsläufe** (`trace.json`): Profiling nur beim Eintritt in Register-, Tool- und Traverse-Callbacks; keine Entscheidung ersetzt. Alle Ergebnisfelder sind identisch zum Lauf ohne Profiling. Erster Python-Aufruf: Hauptzeile 1 / in Prozentdatei 2 und Remap M200 bekannt, aber `started=False`, `program=False`; im Prozentfall zusätzlich `init=True`. Mit Zeilenargument wird das Ereignis verarbeitet.
- **5 eigene Client-Tests PASS**, `client.txt`: zwei Sollprüfungen der korrigierten Fälle und sicheren expliziten Kontrollen, eine Beobachtung des verbliebenen M6/G92-Fehlers, eine Prüfung seiner funktionierenden Kontrollen, eine Beobachtung des G43-Fehlers samt Kontrollen. Die grünen Beobachtungs-Assertions sind **keine Soll-Abnahme**. Decode → Track → Sweep einschließlich WCS-Epochen wie in der Seite; Würfel/Kopf je 0,5 mm, Marge 0,1 mm. Erster Python-M6/G92: falscher Befund bei `(15,5,5)`, 1 s, kein Hinweis. G43 Z10: ohne Callbackzeile Treffer bei Welt-Z40, keiner bei Z50; mit Zeilenargument/vorheriger Bewegung umgekehrt, wie erwartet. Die R109-Gegenfälle am Würfel `(15,5,45)` bleiben jetzt alle unbekannt/ohne Dauer/ohne Befund.
- Der erste eigene Client-Lauf (`client.initial.txt`) platzierte das neue M6/G92-Hindernis bei Z15, also vor der hier wirksamen G92-Verschiebung −10, und seine erwartete Kollision blieb aus. Nur die Sondenposition wurde auf **Welt-Z5** korrigiert; das Produkt blieb unverändert. Für G43 wurden anschließend die beobachteten beiden Höhen mit Assertions festgehalten.
- **Archiv validiert** (`validate.txt`): 4094 Dateien identisch zum Git-Blob, 95 LFS-Inhalte gegen SHA256/Länge geprüft. Keine geänderte Produktdatei und keine Build-Konfigurationsänderung. Eigene Konfiguration/Sonde sind zusätzliche Dateien nur im Archiv. Live-HEAD unverändert, Baum vor Veröffentlichung sauber.

## Wiederholung

Archiv `964dc313`, bei Bedarf LFS-Inhalte materialisieren. Belege in einen neuen `evidence`-Ordner kopieren und das Präfix `viewer-palette-fest.r110.codex-` entfernen. `native-cases.json` enthält bereits alle Eingaben. Aus `archive/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/replay.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/extra.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/motion.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/controls.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run-trace.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/baseline.py /pfad/zum/repository
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run_backend.py test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py test_gateway_util.py
```

`replay.py` wiederholt nur die fest aufgeführten 18 alten Eingaben, auch wenn die gemeinsame Eingabedatei schon die neuen enthält. `native.py` ist bytegleich aus R109 übernommen: nur zusätzliche Fälle im Speicher des aktuellen Repository-Harness, keine Canon-/Worker-Patches. `run_backend.py` verwendet den bisherigen 10-ms-Timer gegen den Sandbox-Eventloop-Wakeup, keine zusätzlichen Gateway-Mocks. `baseline.py` legt eine neue Archivkopie daneben an; der Ordner `baseline` muss frei sein.

Client-Abhängigkeiten einzeln verlinken, `.tmp/.cache/.vite/.vite-temp` nicht teilen. Eigene Vitest-Konfiguration: node, ein Worker, Timeout 240000 ms, Cache außerhalb der Quellen, `include: ['src/**/*.test.ts']`. `client.test.ts` nach `src/viewer/r110.codex.test.ts` kopieren und `ev` anpassen. Aus `lcnc-webui`: `nice -n 19 node node_modules/vitest/vitest.mjs run --config r110.vitest.config.ts src/viewer/r110.codex.test.ts`.

## Grenzen

Kein Gesamtgate, Browserlauf oder Build wiederholt: ausschließlich Python-Produktänderung. Nativer Task-Synch-/Rücklesebeleg, M600-Live-Parität und TWP-Goldens bleiben offen. WRAPPED_ROTARY, separate Restprüfung im Lauf und allgemeine Punktzeilen-Zuordnung unverändert außerhalb dieser Nachprüfung. Die Inline-Python-Probe meldet den äußeren Hauptaufruf L7; Fremd-/M98-Proben bleiben konservativ mit Herkunft 0. Ihre Unsicherheit bleibt erhalten; kein weiterer Befund zur Punktzuordnung daraus.
