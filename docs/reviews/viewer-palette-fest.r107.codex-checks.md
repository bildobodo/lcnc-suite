# R107 — Codex: Prüfaufbau und Wiederholung

9. Oktober 2026. Nachprüfung `23da5285..2701e244`, Archiv/Anfrage `126aa64c`. Ausschließlich `/tmp/codex-r107-0jyogf94/archive`, nice 19, Vitest ein Worker. Keine Server/Live-Ports, keine Maschinenbefehle, kein Produktcode geändert. Native Proben verwenden das Repository-Harness mit privater INI/Var-Datei/Tool-mmap, synthetischem STAT und verbotenem `linuxcnc.command`. Gateway-Sonden verwenden `fake_linuxcnc`.

## Ergebnisse

- **596 Backend-Tests PASS**: `test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py test_command_dispatch.py`; 596 Punkte im doppelt stillen pytest-Log, keine Fehler/Skips, Exit 0. Darunter die neuen NearLiterals-Untertests. `backend.txt`.
- **114 Client-Repositorytests PASS**, vier Dateien `probeStop`, `toolChangePayloads`, `tloEvents`, `scrubTrack`. `unit.txt`.
- **32 eigene native Eingaben**: zwölf ursprüngliche R105-Fälle, sechs R106-Fälle, 13 neue Scanner-/Kontrollfälle, ein neuer Fall zur Ereignisherkunft. **28 akzeptiert**, vier verworfen: die zwei O-Wort/Zuweisungs-Kombinationen aus R106, `M2(x)00` und `G-ABS[-10]`. Diese vier sind **keine Befunde**. Private Tool-mmap bei allen unverändert. Programme gemeinsam in `native-cases.json`; Ergebnisse in `native.json`, `extra-native.json`, `boundary.json`, `sequence.json` und je eine msgpack-Datei.
- **Buchführung/Start/Abbruch wiederholt**: `basis.json`, `startpaths.json`, `cancel.json`. Drei Startpfade invalidieren weiterhin, Abbruch lässt keine alte Bestätigung zurück. Neue Remap-Buchführung besteht: tatsächlicher Handler, echte `_remap_env`-Funktion mit temporärem Körper und INI-Double; Interpreter-Double schreibt 4, Basis ist `assumed`, Rücklesen fällig. `remap-basis.json`.
- **Vier Client-Beobachtungen PASS**, `client.test.ts`/`client.txt`: Nah-Zahlen korrekt einzeln/ungebunden als Paar; erste Bewegung des fremden M600 weiterhin 10 s und Kollisionsbefund; zwei negative G-Ausdrücke verlieren die fortdauernde Unsicherheit; fremder Aufruf bekommt eine Zeile hinter M2. Die drei Fehlerbeobachtungen sind absichtlich positive Assertions auf den gemessenen Fehler, **keine Soll-Abnahme**. Entry bei unbekanntem ersten Punkt bleibt null.
- **Build PASS**, `build.txt`, übliche Vite-Warnung zu Chunks >500 kB.
- **Archivvergleich**: 3864 Dateien identisch zu Git-Blobs, 95 LFS-Dateien gegen Hash/Länge geprüft, nur vier lokale Cache-Pfadänderungen; Live-Baum vor Veröffentlichung sauber, HEAD unverändert. `validate.py`, `validate.txt`, `context.json`, `checks.json`.

## Reproduktion

Neue Archivkopie von `126aa64c`, LFS-Inhalte aus dem lokalen Objektstore anhand der Pointer-OIDs/Längen prüfen. Belege `viewer-palette-fest.r107.codex-*` in einen eigenen `evidence`-Ordner kopieren und das Präfix entfernen. Aus `archive/lcnc-gateway` (Gateway-Venv nur als Interpreter/Abhängigkeiten):

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/native.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/extra.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/boundary.py
PYTHONPATH=. nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/sequence.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/basis.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/startpaths.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/cancel.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/remap-basis.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /pfad/evidence/run_backend.py test_m600_preview_worker.py test_toolsetter_basis.py test_tool_touch_off_paths.py test_start_tlo_worker.py test_gateway_util.py test_command_dispatch.py
```

Reihenfolge der vier nativen Skripte beibehalten: Jedes erweitert `native-cases.json`. `native.py` unverändert aus R105/R106; fügt Fälle nur im Speicher in das aktuelle Harness ein. `extra.py` liest den Schreibsatz nun aus der Worker-Metadatenantwort, also mit den tatsächlich angelegten Remap-Dateien. `basis.py` übergibt die neue Env-Schnittstelle. `remap-basis.py` richtet die private INI/Körper-Umgebung ein, die der neue `_BasisCase` sonst durch eine leere Konfiguration ersetzt; die native Zuweisungssemantik ist unabhängig belegt. Start-/Abbruchsonden behalten ihre R106-Methodennamen-Korrektur. `run_backend.py` nutzt den bereits in R105 dokumentierten 10-ms-Timer gegen Sandbox-Selfpipe-Warteprobleme, keine ersetzte Produktlogik.

Client-Abhängigkeiten einzeln verlinken, Cache-Ordner nicht teilen. Archiv-eigene Vitest-Konfiguration: `environment:"node"`, `maxWorkers:1`, `testTimeout:240000`, Cache außerhalb der Quellen. `client.test.ts` nach `src/viewer/r107.codex.test.ts` kopieren, `ev` auf den eigenen Ordner setzen und ausführen. Vor dem Build wieder entfernen. Vier Cache-Pfadänderungen stehen in `validate.py`. Validierung vor Veröffentlichung ausführen.

## Diagnose und Grenzen

Die erste Client-Sonde übergab die WCS-Epochen nicht vollständig; das ist in der Endfassung mit `epochTermsFor`, wie in der Seite, korrigiert. `client-initial.txt` enthält diesen Harnessfehler sowie die schon rote Sollprüfung „fremdes M600 hat keine Zeit“. Nach Übergabe der Epochen bestehen die beiden negativen G-Code-Fehlerbeobachtungen, die M600-Sollprüfung bleibt rot (`client-epoch-corrected.txt`). Die Endfassung zeichnet auch die 10 s und die Kollision auf und assertiert explizit das gemessene Fehlverhalten. Keine Produktkorrektur während der Tests. Die erste temporäre Fassung des isolierten Env-Vergleichs in `sequence.py` übergab noch den INI-Schlüssel `REMAP=` statt der Werte von `findall`; der veröffentlichte Lauf verwendet die richtige Schnittstelle und zeigt `reaches` mit M200 **und** M600.

Aktive G92-/G54-Schreibzugriffe mit negativem G-Ausdruck bleiben dank Canon-Callback als unbekannt markiert; das sind Kontrollen, keine zusätzlichen Fehlbehauptungen. Der Befund betrifft insbesondere gespeicherte Positionen und inaktive WCS-Zeilen ohne solchen Callback.

Kein Gesamtgate/Browserlauf, kein nativer Task-Synch-Rücklesebeleg und keine Live-Parität; beide Paketnachweise bleiben offen. WRAPPED_ROTARY unverändert begrenzt. Keine vorherigen Belege überschrieben.
