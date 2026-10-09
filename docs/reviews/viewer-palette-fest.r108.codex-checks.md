# R108 — Codex: Prüfaufbau und Wiederholung

9. Oktober 2026. Nachprüfung `b1761b51..67fbcf8e`, Archiv/Anfrage `429f64ed`. Nur Archivkopien in `/tmp/codex-r108-nsubpv33`, nice 19, Vitest ein Worker. Keine Server/Live-Ports und keine Maschinenbefehle. Native Proben verwenden LinuxCNCs Offline-Interpreter mit synthetischem STAT, privater INI/Var-Datei/Tool-mmap und verbotenem `linuxcnc.command`; Gateway-Sonden ausschließlich `fake_linuxcnc`. Produktcode unverändert.

## Ergebnisse

- **628 Backend-Tests PASS**, `backend.txt`: `test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py test_command_dispatch.py test_tool_change_motion_worker.py`. 628 Punkte im doppelt stillen pytest-Log, Exit 0, keine Fehler/Skips. Einschließlich neuer Herkunfts-, Vorzeichen- und Remap-Wächter.
- **117 Client-Repositorytests PASS**, `unit.txt`: `src/viewer/{probeStop,toolChangePayloads,tloEvents,scrubTrack}.test.ts`.
- **40 eigene native Eingaben am neuen Stand**: die 32 R107-Eingaben unverändert, dazu acht neue Herkunfts-/Schreibzugriffs-/Startgrenzen-Fälle. **36 akzeptiert**, vier bereits bekannte Negativkontrollen verworfen: `inline_if_assignment`, `inline_endif_assignment`, `comment_split_remap`, `negative_g10_function`. Keine dieser vier ist ein Befund. Ergebnisse: `native.json`, `extra-native.json`, `boundary.json`, `sequence.json`, `new-cases.json`; Eingaben gemeinsam in `native-cases.json`, je eine msgpack-Datei. Alle privaten Tool-mmaps unverändert.
- **Drei zusätzliche native Basisvergleiche** mit identischen neuen Eingaben an `b1761b51`: `explicit_same_block`, `explicit_separate_blocks`, `remap_only`. Alle akzeptiert, die Folgefahrten bleiben unbekannt/ohne Zeit. `baseline.py`, `baseline.json`, drei `*.baseline.msgpack`. Der alte Hinweis nennt noch die Rumpfzeile 2; er hatte bereits die richtige fortdauernde Unsicherheit. Die Regression ist deren Verlust, nicht die alte Zeilennummer.
- **Buchführung, Start, Abbruch unverändert wiederholt**: `basis.json`, `startpaths.json`, `cancel.json`, `remap-basis.json`.
- **Fünf Client-Prüfungen PASS**, `client.txt`/`client.test.ts`: vier Sollprüfungen der R107-Korrekturen (Aufrufvorkommen, Fremd-Remap vor erster Bewegung, negative G-Ausdrücke, wirklicher Aufruf statt Kandidat hinter M2), eine positive Assertion des neuen Fehlverhaltens. Letztere ist **keine Soll-Abnahme**. Der Sweep bekommt WCS-Epochen wie die Seite. Hindernis der neuen Probe: 0,5-mm-Würfel bei `(15,5,45)`, gleiche Kopfgeometrie, Marge 0,1 mm. Kombinierter Satz: 1 s, Befund L6; getrennte Sätze und Remap allein: 0 s, keine Befunde, fortdauernder Hinweis.
- **Build PASS**, `build.txt`; übliche Vite-Warnung zu Chunks >500 kB.
- **Archiv validiert**: 3944 Dateien identisch zu Git-Blobs, 95 LFS-Dateien gegen Hash/Länge geprüft; nur vier lokale Cache-Pfadänderungen. Live-HEAD unverändert, Baum vor Veröffentlichung sauber. `validate.py`, `validate.txt`, `context.json`, `checks.json`.

## Wiederholung

Neue Archivkopie von `429f64ed`; LFS-Inhalte anhand ihrer OIDs/Längen materialisieren, sofern das Archiv Pointer enthält. Belege `viewer-palette-fest.r108.codex-*` in einen eigenen `evidence`-Ordner kopieren und das Präfix entfernen. Aus `archive/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/native.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/extra.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/boundary.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/sequence.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/new-cases.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/basis.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/startpaths.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/cancel.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/remap-basis.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run_backend.py test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py test_command_dispatch.py test_tool_change_motion_worker.py
```

Die fünf nativen Skripte in dieser Reihenfolge ausführen: jedes erweitert die Eingabedatei. Alle aus R107 übernommenen Python-Sonden sind bytegleich; das bestehende `native.py` injiziert nur zusätzliche Fälle im Speicher in das aktuelle Repository-Harness. Keine Canon-/Worker-Monkeypatches. Der bereits dokumentierte 10-ms-Eventloop-Timer in den Gateway-Proben ersetzt keine Produktlogik.

`baseline.py /pfad/zum/repo` legt im Elternordner von `evidence` eine neue Archivkopie `baseline` von `b1761b51` an (Ordner darf noch nicht bestehen) und führt dieselben drei neuen Fälle mit dem dortigen Produktcode aus. Nur read-only Git-Zugriff auf das Repository.

Client-Abhängigkeiten einzeln aus vorhandenen Paketen verlinken, `.tmp/.cache/.vite/.vite-temp` nicht teilen. Eigene Vitest-Konfiguration: node, ein Worker, `testTimeout:240000`, Cache außerhalb der Quellen. `client.test.ts` nach `src/viewer/r108.codex.test.ts` kopieren, `ev` anpassen, ausführen, vor dem Build entfernen. Gegenüber R107 folgen die Erwartungen den belegten Korrekturen: konkrete Zeilen 3/5 statt ungebunden, keine Zeit/Kollision im Fremdrumpf, erhaltene Unbekannt-Flags, Aufrufzeile 3 statt 6. Die zusätzliche Same-Block-Probe zeichnet den verbliebenen Fehler auf.

Vier lokale Build-Cache-Pfadänderungen in `validate.py`; Validierung vor Veröffentlichung. Keine früheren Belege ändern.

## Grenzen

Kein erneutes Gesamtgate/Browserlauf; die in Claudes Gate genannte GC-Schwankung wurde hier nicht als Produktbefund behandelt. Kein nativer Task-Synch-Rücklesebeleg und keine Live-Parität — beide bleiben offen. WRAPPED_ROTARY und Restprüfung während des Laufs unverändert begrenzt. Die eigenen neuen N-Nummern-, Inline-Sub- und Fremd-M600-Startfälle (mit/ohne Prozentrahmen) sind erfolgreiche Kontrollen. Eine allgemeine Freigabe anderer Interpreter-Versionen ist damit nicht behauptet.
