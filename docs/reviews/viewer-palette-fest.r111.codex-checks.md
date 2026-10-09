# R111 — Codex: Prüfumfang und Wiederholung

9. Oktober 2026. Produktvergleich `22b715c6..50f074c2`, Archiv `88f2e81b`, Produktfix `11363b62`. Nur Archivkopie `/tmp/codex-r111-fg60nqgi`, nice 19, Vitest ein Worker mit eigenem Cache. Keine Live-Ports, HAL- oder Maschinenbefehle. Nativer Offline-Interpreter mit synthetischem STAT, privater INI/Var-Datei/Tool-mmap und verbotenem `linuxcnc.command` im unveränderten Repository-Harness.

## Ergebnisse

- **503 Backend-Tests PASS**: `test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py test_gateway_util.py`. Exit 0; 503 Punkte im doppelt stillen pytest-Log, keine Fehler/Skips (`backend.txt`).
- **120 Client-Repositorytests PASS**: `toolChangePayloads`, `probeStop`, `scrubTrack`, `tloEvents` (`unit.txt`).
- **63 native Eingaben, alle ohne Parsefehler/Exception**, alle privaten Tool-mmaps unverändert. `native-cases.json` enthält die vollständigen Eingaben. **42 unveränderte R110-Eingaben** (`replay.json`), drei ergänzende Init-Kontrollen (`init-probe.json`), 18 weitere Start-/Basis-/Fremd-Remap-Kontrollen (`extra.json`). Die drei früheren Overflow-Fälle erzeugen jetzt reguläre Payloads mit erhaltenen Rückzugsfahrten.
- **6 Basisvergleiche**: G92, G10 L2 mit verschobener und gedrehter Fixture sowie G43.1 als erster direkter Befehl oder erster Python-Remap, jeweils mit/ohne `%`, Rotationssync aktiviert und geerbtem G43 Z10. Jeweils gleicher Payload-Digest ohne Dateipfad, Stats und `tlo_start`; `tlo_start` zusätzlich auf Gleichheit geprüft (`basis-parity.json`). Keine Phantom-Init-Bewegung in den ergänzenden ersten Python-Bewegungen. Ein fremder Python-M600 als erster Aufruf setzt die Auslassung bei seq 0.
- **7 eigene Client-Sollprüfungen PASS**, `client.txt`, `client.test.ts`: korrigierte R109-Fälle; explizite Kontrollen; die vier R110-Startfälle; ihre Zeilenargument-/Vorbewegungs-Kontrollen; G43 an Welt-Z40/Z50; M6-Rückzugsfahrten; fremder erster Python-M600. Alle Beobachtungs-Assertions aus R110 wurden hier durch Soll-Assertions ersetzt. Geprüft wird Decode → Track → Sweep inklusive WCS-Epochen wie in der Seite.
- **VP-I65:** Keine Kollision an `(15,5,5)` und 0 s bei allen vier M6/G92-Startfällen; fortdauernder Hinweis L1/L2/L2/L3. G43 Z10 erzeugt keinen Treffer an `(5,0,40)`, einen Treffer an `(5,0,50)`. Kopf/Würfel je 0,5 mm, Marge 0,1 mm.
- **VP-I66:** Geometrie, kumulative Dauer und Unknown-Start-Flags stimmen bei allen drei M6-Varianten mit den funktionierenden Zeilenargument-Kontrollen überein. G30 aus R110 nach `(10,0,0)`, Quill-up nach `(0,0,0)`, beide in Folge. Die Rückzugsfahrten werden auch bei Herkunft 0 gesweept: Hindernis bei `(5,0,20)` für G30, bei `(0,0,20)` für Quill-up/beides erzeugt einen tatsächlichen Befund mit Zeile 0 (`m6-sweep.json`). Herkunft 0 ist keine erfundene Quellzeile; sie unterdrückt hier weder Bewegung noch Kollisionsprüfung.
- **Init-Kontrollen:** Ein versuchsweise konfigurierter G0-Remap wird von diesem nativen Interpreter nicht aufgerufen (kein `RAPID`-Log), weder im Init noch im Hauptprogramm. Der befürchtete Eintritt über die Rotationssync-Initialisierung ließ sich damit nicht auslösen; das Vorschau-Payload stimmt mit der normalen Kontrollkonfiguration überein. Diese drei Eingaben sind kein Nachweis für beliebige andere Interpreter-/Remap-Versionen.
- **Archiv validiert**: 4179 Dateien gleich dem Git-Blob; 95 LFS-Inhalte gegen SHA256/Länge geprüft. Keine Produktdatei und keine Build-Konfiguration geändert. Eigene Konfiguration/Sonde sind zusätzliche Dateien nur im Archiv. Live-HEAD unverändert, Baum vor Veröffentlichung sauber (`validate.txt`, `context.json`).

## Wiederholung

Archiv `88f2e81b`, bei Bedarf LFS-Inhalte materialisieren. Belege in einen neuen `evidence`-Ordner kopieren und Präfix `viewer-palette-fest.r111.codex-` entfernen. `native-cases.json` enthält alle Eingaben. Aus `archive/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/replay.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/init-probe.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/extra.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run_backend.py test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py test_gateway_util.py
```

`replay.py` wiederholt die fest aufgeführten 42 R110-Eingaben, auch wenn die gemeinsame Datei schon weitere enthält. `native.py` ist unverändert übernommen: nur zusätzliche Fälle im Speicher des aktuellen Repository-Harness, keine Canon-/Worker-Patches. `run_backend.py` verwendet den bisherigen 10-ms-Timer gegen den Sandbox-Eventloop-Wakeup, keine zusätzlichen Gateway-Mocks.

Client-Abhängigkeiten einzeln verlinken, `.tmp/.cache/.vite/.vite-temp` nicht teilen. Eigene Vitest-Konfiguration: node, ein Worker, Timeout 240000 ms, Cache außerhalb der Quellen, `include: ['src/**/*.test.ts']`. `client.test.ts` nach `src/viewer/r111.codex.test.ts` kopieren und `ev` anpassen. Aus `lcnc-webui`: `nice -n 19 node node_modules/vitest/vitest.mjs run --config r111.vitest.config.ts src/viewer/r111.codex.test.ts`.

## Grenzen

Kein Gesamtgate, Browserlauf oder Build wiederholt: ausschließlich Python-Produktänderung. Das Agreement gilt der Nachprüfung VP-I65/VP-I66. Nativer Task-Synch-/Rücklesebeleg, M600-Live-Parität und TWP-Goldens bleiben offen. WRAPPED_ROTARY, separate Restprüfung im Lauf und allgemeine Punktzeilen-Zuordnung unverändert außerhalb dieser Nachprüfung.
