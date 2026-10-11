# R135 · Codex · Prüfprotokoll

Geprüft: `fix/start-dep`, `52f7b49c..b3a20a2f0a61acc030816ada80f512b510931290`, nicht gemergt. Export per `git archive` nach `/tmp/codex-r135-k3ccqqc4/src`. Live-HEAD bei Beginn: `e97cf9e239aa71212bd32aa7233d881ea1ceeb51`.

Nur Offline-Prüfungen, mit `nice -n 19`; Vitest ein Worker. Keine Live-Ports, Maschinenbefehle, Builds/Tests/Checkouts im Live-Baum. Node-Abhängigkeiten per Leselink wiederverwendet, Cache ausdrücklich unter `/tmp`, Konfiguration mit `--configLoader runner`. Produktdateien im Export unverändert; hinzugefügt nur eigene Tests und Konfiguration.

## Bisherige Gegenproben

Der native Generator aus R134 wurde unverändert gegen den neuen Export ausgeführt: **13 Programme**, jedes in eigenem Prozess durch `native_start_probe.py`, mit privater INI, Parameter-/Werkzeugdatei und privatem mmap. Der Harness weist Maschinenbefehle ab. Alle Parsefehler leer, Werkzeug-mmap jeweils unverändert. Programme, Rohdaten und Msgpack-Payloads liegen bei.

Die R133-Nachprüfung ist bytegleich zur angepassten Kopie aus R134 (`r134.codex-rerun.test.ts`, einschließlich der damals offengelegten Existenzregel): **15/15 PASS**.

Die R134-Ablaufprobe ist eine Kopie mit genau zwei Kontextanpassungen, im beiliegenden Diff offengelegt:

- Zusätzlich die neuen produktiven Funktionen `_colRunSideFailed`, `_colCancelSide`, `_colDropEntry` und `runBeginNow` aus `ThreeViewer.vue` extrahieren.
- `collisionRunSideState` als Ref im Ausführungskontext ergänzen.

Alle acht Tests und ihre Erwartungen bleiben unverändert: **8/8 PASS**, zuvor vier grün/vier rot. Die Funktionstexte werden aus dem geprüften Produktstand entnommen, nicht nachgebaut. Die Probe verbindet den realen Decode-/Track-/Sweep-/Merge-Pfad mit den realen Koordinator-Funktionen und den Computed-Rümpfen der Leiste. Ersetzt ist die Umgebung eines zugelassenen Laufs sowie Modell-/Worker-Transport. Das ist kein Vue-Mount, WebGL- oder Browsertest. Die Fehlerantworten sind gezielte Injektionen, keine behaupteten Live-Ausfälle.

## Bestandstests

Aus `ARCHIVE/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -q test_start_dep_worker.py
```

**60 Tests PASS, Exit 0**; Collection mitprotokolliert. Der Produktcode des Backends wurde in diesem Bereich nicht geändert, die beiden neuen nativen Fälle sind als Wächter ergänzt. Keine Wiederholung des gesamten Backend-Gates.

Aus `ARCHIVE/lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r135.rerun.test.ts src/viewer/r135.wiring.test.ts src/viewer/startDepPayloads.test.ts src/viewer/checkBasis.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/sweepMerge.test.ts
```

**98 Tests PASS in sechs Dateien, Exit 0**: 75 Repository-Tests plus 23 eigene Prüfungen. Darunter die übernommenen und erweiterten Wächter der neuen Fehlerpfade; die eigenen acht Ablaufprüfungen werden nicht noch einmal als Bestandstests gezählt.

## Dokumente und Codeprüfung

- Anfrage R135 und Diff vollständig gelesen; Datenfluss für `startUnbound`, `RunBegin` und den Seitenauftragszustand bis zur Leiste geprüft. Die Zusatzinformation bleibt auch im Shard-Merge erhalten.
- `b3a20a2f` ändert gegenüber `59f48c61` ausschließlich `e2e/toolsetter.viewer.spec.ts`. Der neue Wait beobachtet die Interp-Zeile. Alte/neue G30-Antworten, ungültige Werte und Stecknadelposition werden weiterhin geprüft. Keine Produktänderung an Status-Store oder G30-Watcher; deren bestehendes Zusammenfassen pro Frame und der bestätigte G30-Wertepfad wurden gelesen.
- Gate-JSONs am Zielcommit gelesen, ebenso der Nachweis der **81/81 roten Mutationen** am Korrekturcommit. Keine eigene Wiederholung der Mutationensuite, des Gesamtlaufs oder der G30-Browsertests. Die gemeldeten 1474/2124/505 sind Claudes Gate-Zahlen, nicht eigene Läufe.

## Reproduktion

```sh
# ARCHIVE ist der Export von b3a20a2f, nicht der Live-Baum.
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python viewer-palette-fest.r135.codex-native.py ARCHIVE > native.json
# Payloads entstehen in ARCHIVE/../payloads; alternativ das beigefügte ZIP dort entpacken.
# Sonden nach ARCHIVE/lcnc-webui/src/viewer/r135.rerun.test.ts und r135.wiring.test.ts kopieren.
# Konfiguration nach ARCHIVE/lcnc-webui/vitest.review.config.ts kopieren;
# bei anderem Exportpfad cacheDir auf ein eigenes temporäres Verzeichnis setzen.
cd ARCHIVE/lcnc-webui
nice -n 19 node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r135.rerun.test.ts src/viewer/r135.wiring.test.ts
```

`REVIEW_OUT` überschreibt bei Bedarf das Payload-/Ausgabeverzeichnis (Standard `ARCHIVE/..`). Die Sonden schreiben `client.json` und `wiring.json`; im Belegpaket heißen diese `r135.codex-rerun.json` und `r135.codex-wiring.json`.

Vor Ablage werden alle zwölf Dateien des Review-Diffs gegen `git show b3a20a2f` verglichen. Der vorherige Review-Präfix bleibt nach Längen-/SHA256-Prüfung bytegleich; ältere Belege bleiben unverändert. Nur Anhang und neue `r135.codex-*`-Dateien im Live-Baum; Handshake erst nach Ablage und `git diff --check`.
