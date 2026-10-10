# R133 · Codex · Prüfprotokoll

Code: `fix/start-dep`, `9bb093de..3cacdbf9e0e31da9d5322ba7f71a6a552b903976`, ungemergt. Export per `git archive` nach `/tmp/codex-r133-d06eos78/src`. Plan E/F Fassung 7 und Anfrage R133 aus dem Review-Zweig. Live-HEAD bei Beginn: `f4ebe5c927ee94cc4a6ae9ce2a8b98dcd299cad6`.

Keine Live-Ports, Builds oder Tests im Live-Baum; keine Maschinenbefehle. Alle Produktquellen des Exports bleiben unverändert. Hinzu kommen nur eigene Testdatei und Vitest-Konfiguration in der Archivkopie. Node-Abhängigkeiten wurden über einen Leselink wiederverwendet; Cache liegt ausdrücklich im eigenen `/tmp`-Verzeichnis, Konfiguration mit `--configLoader runner` geladen. Ein Vitest-Worker, Prozesse mit `nice -n 19`.

## Nachprüfung R132

Die unveränderten Dateien `viewer-palette-fest.r132.codex-audit.py` und `viewer-palette-fest.r132.codex-contracts.py` gegen diesen Export: **17 native Prozesse, 33/33 Vertragsbedingungen PASS**, Exit 0. Ergebnis in `r133.codex-r132-rerun.json`. Keine Anpassung der damaligen Erwartungen. Damit sind VP-I78–VP-I82 im Canon/Worker in den belegten Gegenfällen geschlossen. Punkt 8 wurde separat weitergeprüft: VP-I88.

## Bestandstests

Aus `ARCHIVE/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -q test_start_dep_worker.py test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py
```

**145 Testfunktionen PASS**, Exit 0 (53 + 35 + 46 + 11). Collection mitprotokolliert.

Aus `ARCHIVE/lcnc-webui`, mit der beigelegten Vitest-Konfiguration:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/startDepPayloads.test.ts src/viewer/checkBasis.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/simRows.test.ts src/viewer/sweepMerge.test.ts src/runBasis.test.ts
```

Vitest findet **5 Dateien, 75 Tests PASS**, Exit 0. Nicht jeder Filtername bezeichnet eine vorhandene Datei; die tatsächlich ausgeführte Zahl steht im Ergebnis.

**E3-Gateway-Wächter:** Der normale Dispatch-Lauf blieb im neuen `test_the_start_joints_are_this_poll_s` hängen; abgebrochen. Derselbe Test allein blieb ebenfalls stehen (60-s-Timeout); ein zusätzlicher Lauf lieferte den Stack nach 8 s und endete nach 20 s per Timeout. Eine unabhängige Minimalprobe `asyncio.run(... await asyncio.to_thread(lambda: 42))` gab sogar `after asyncio.to_thread: 42` aus, beendete sich aber nicht (5-s-Timeout). Daher kein Produktbefund aus diesem Stillstand abgeleitet.

Mit dem beigelegten `r133.codex-async-pytest.py` wird der echte Event-Loop alle 50 ms per `call_later` geweckt. Threadarbeit, Await, Assertions und Produktcode bleiben unverändert. Der E3-Wächter läuft damit **PASS, Exit 0**:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python viewer-palette-fest.r133.codex-async-pytest.py ARCHIVE -q test_command_dispatch.py -k start_joints
```

Normallauf, Timeout-Stack, Minimalprobe und Lauf mit periodischem Wecken sind im Testprotokoll getrennt. Insgesamt 221 gezielt bestandene Repository-Testfunktionen, davon einer unter dieser offen benannten Umgebungsanpassung. Claudes Gesamtgates/42 Mutationen wurden gelesen; kein eigener Gesamtlauf, Browser- oder Live-/Parity-Gate behauptet.

## Neue Gegenproben

```sh
# ARCHIVE ist die Wurzel des Git-Exports, nicht der Live-Baum.
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python viewer-palette-fest.r133.codex-native.py ARCHIVE > native.json
# Die Probe legt ihre .msgpack-Dateien in ARCHIVE/../payloads ab.
# Alternativ das beigefügte Payload-ZIP dort entpacken.
# Client-Test nach ARCHIVE/lcnc-webui/src/viewer/r133.review.test.ts kopieren;
# Konfiguration nach ARCHIVE/lcnc-webui/vitest.review.config.ts kopieren.
cd ARCHIVE/lcnc-webui
nice -n 19 node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r133.review.test.ts
```

`REVIEW_OUT` kann das Ausgabe-/Payload-Verzeichnis des Client-Tests überschreiben; Standard ist `ARCHIVE/..`. Die mitgelieferte Konfiguration muss bei einem anderen Exportpfad nur ihren `cacheDir` auf ein eigenes temporäres Verzeichnis setzen.

- **11 eigene native Fälle**, jeder in einem frischen Prozess über das bestehende `native_start_probe.py`: synthetischer STAT, private INI/Parameter-/Werkzeugdateien, privates mmap, echte Offline-Interpreter-/Worker-Ausführung. `linuxcnc.command` wirft. Keine Parsefehler, Werkzeug-mmap jeweils unverändert. Die Programme werden im Speicher in die Falltabelle eingefügt; keine Änderung an Produktquellen.
- **15 Client-Vertragsprüfungen: 12 FAIL, 3 PASS**, gruppiert in sieben Befunde VP-I83–VP-I89. Die drei positiven Kontrollen sind erstes G1 mit verbleibender Maske, G43 erst nach der ersten Bewegung und G30.1 nach zuvor bestimmten XYZ.
- Decode → Track → `buildEntryTrack` → echter Collision-Sweep, mit minimalem Drei-Achs-Modell und Würfelhindernis. VP-I83 hat eine analytische Referenz: Nur Z des ersten Zielpunkts wird auf den befohlenen horizontalen Verlauf gesetzt; dort trifft der Sweep das Hindernis, auf der Produktspur nicht.
- Für VP-I86 und VP-I89 werden die **tatsächlichen** Computed-Rümpfe `sweepView` und `verdictDetail` aus `ScrubBar.vue` extrahiert und mit deterministischen Ref-/Prop-Eingaben ausgeführt. Kein nachgebauter Entscheidungsalgorithmus; zugleich kein Browser-/Renderingtest. Die Ergebnisse belegen die berechneten UI-Texte, nicht ein visuell aufgenommenes Live-Bild.
- VP-I87 testet den echten Merge eines echten Bereichsergebnisses. VP-I88 prüft sowohl die native Erzeugung des Flags als auch seine Verarbeitung mit ausdrücklich gesetztem Flag und beim tatsächlichen `sliceTrack`-Pfad des Seiten-Sweeps. Diese Fälle im JSON unterscheiden, nicht als drei verschiedene Maschinenläufe ausgeben.
- Neue Rohdaten, nativer Generator, ursprüngliche Msgpack-Payloads, Client-Test und Ergebnisse liegen als getrennte Dateien bei. Ein roter Vertragslauf ist hier das beabsichtigte Ergebnis der Gegenprobe, kein grünes Gate.

Vor dem Review-Anhang wird der vollständige vorhandene Dateipräfix per SHA256 und Länge geprüft. Nur Anhang und neue `r133.codex-*`-Dateien im Live-Baum. Produktquellen und bisherige Belege bleiben unverändert; `done R133` folgt nach der Ablage.
