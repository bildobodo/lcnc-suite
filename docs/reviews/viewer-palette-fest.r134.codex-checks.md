# R134 · Codex · Prüfprotokoll

Code `fix/start-dep`, `3cacdbf9..52f7b49c5ad76ea44ef7f84897430d9bffbec24e`, ungemergt. Export per `git archive` nach `/tmp/codex-r134-unmzpu6o/src`. Anfrage und Plan E/F Fassung 7 aus dem Review-Zweig; Live-HEAD bei Beginn `5c1fdff5b614740e436fad27b713cc71dcffa02c`.

Alle Prüfungen vollständig offline im Export, mit `nice -n 19`; Vitest mit einem Worker. Keine Maschinenbefehle, keine Live-Ports, keine Builds/Tests/Checkouts im Live-Baum. Node-Abhängigkeiten per Leselink wiederverwendet, Cache ausdrücklich unter `/tmp`, Vitest-Konfiguration per `--configLoader runner`. Produktdateien des Exports unverändert; hinzugefügt nur eigene Testdateien und Konfiguration.

## Nachprüfung R133

Der native Generator aus R133 lief unverändert gegen den neuen Export: elf native Programme. Eine Kopie enthält zusätzlich die beiden R134-Programme `m6_first_absolute` und `m6_only_absolute`; die beiliegenden Rohdaten/Payloads stammen aus diesem zweiten Lauf (13 Fälle). Jeder Fall in einem eigenen Offline-Interpreter-Prozess über `native_start_probe.py`, mit privaten INI-/Parameter-/Werkzeugdateien und privatem mmap; Maschinenbefehle werden vom Harness abgewiesen. Alle Parsefehler leer und Werkzeug-mmap jeweils unverändert.

Die R133-Clientsonde wurde als eigene Kopie angepasst, die bisherigen Belege bleiben unverändert. Das beiliegende Diff zeigt alle Anpassungen:

- Neues `startUnbound` durch die echte Decode-/Track-Schnittstelle reichen.
- Neue produktive Hilfsfunktionen `beginSentence`/`depTimeSentence` in den unverändert ausgeführten Computed-Rumpf reichen.
- Neuer Wortlaut des Hinweises auf gespeicherte Positionen.
- `unknownLine: 2` zusätzlich zur weiterhin erwarteten frühesten Ursache L2.
- Die vorgeschlagene konservative Existenzregel: G30.1 nach bekannten XYZ bekommt jetzt ausdrücklich das Flag. Der alte Name dieser Kontrollprüfung steht in der Kopie noch; die Änderung der Erwartung ist hier und im Diff offengelegt, nicht als unverändert bestandener Test ausgegeben.

Ergebnis: **15/15 eigene R133-Vertragsprüfungen PASS**. Die native G43-Kollisionsgegenprobe, M6-Bindungssperre, erstes G1, Lauftexte, Merge-Metadaten, Schreibhinweise und Zeithilfe sind darin enthalten.

## Repository-Tests

Aus `ARCHIVE/lcnc-gateway`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -q test_start_dep_worker.py test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py
```

**152 Tests PASS, Exit 0**. Collection ebenfalls protokolliert: 60 + 35 + 46 + 11. Keine Event-Loop-Anpassung notwendig; Dispatch wurde in dieser Runde nicht erneut ausgeführt.

Aus `ARCHIVE/lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r134.rerun.test.ts src/viewer/startDepPayloads.test.ts src/viewer/checkBasis.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/sweepMerge.test.ts
```

**88 Tests PASS in fünf Dateien, Exit 0:** 15 eigene Gegenproben plus **73 Repository-Tests** in vier Dateien. Die Zahlen nicht als 88 zusätzliche Bestandstests zählen. Claudes Gates und Mutationsnachweise wurden gelesen; kein eigener Gesamtlauf oder Wiederholung der 64 Mutationen behauptet.

## Zusammengesetzte Ablaufprobe

`r134.wiring.test.ts` verwendet die nativen Payloads und reale Funktionen von Decode → Spur → Bindung → Sweep → Merge. Die Funktionen `_startRunCheck`, `_runBoundTrack`, `_colPostSide`, `_colOnSideMessage` und `_colBaseFor` sowie `collisionRunCheckView` werden aus dem tatsächlichen `ThreeViewer.vue` per TypeScript-AST entnommen und zusammen unverändert ausgeführt. Auch die Leisten-Computed-Rümpfe werden aus dem Produkt gelesen.

Kontrolliert werden die Umgebung eines zugelassenen Laufs, der einfache Drei-Achs-Würfelkörper, die Worker-Transportgrenze und die Ergebnisreihenfolge. Keine Kopie der zu prüfenden Zustandsentscheidungen. Die Sweep-Ergebnisse selbst stammen aus `sweepCollisions`; Workerfehler und zweimaliges `needBodies` sind ausdrücklich injizierte Antworten. Kein echter Worker-Port, Vue-Mount, WebGL, Gateway oder Live-Zugriff; die Aussagen betreffen die berechneten Zustände/Texte und die ausgeführten Handler, nicht ein aufgenommenes Browserbild.

**8 Tests: 4 PASS / 4 FAIL, Exit 1** (beabsichtigte rote Vertragsgegenproben):

- Rot: unbindbare erste Bewegung nach M6 bei K = 0, mit zweiter bekannter Bewegung und ohne zweite Bewegung — beide trotzdem „checked in full“ und ohne Hinweis.
- Rot: Seiten-Sweep meldet Fehler bzw. zweimal `needBodies` — Auftrag weg, Anzeige weiterhin `checking`.
- Grün: Grund-Ergebnis vor Seiten-Ergebnis; Seiten-Ergebnis vor Grund-Ergebnis; fehlende Gelenke mit genanntem Grund; abgebrochenes Seitenergebnis bleibt `covered: 0` und nicht vollständig geprüft.

## Reproduktion

```sh
# ARCHIVE ist die Wurzel eines Exports von 52f7b49c, nicht der Live-Baum.
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python viewer-palette-fest.r134.codex-native.py ARCHIVE > native.json
# Der Generator legt Payloads nach ARCHIVE/../payloads.
# Alternativ das beiliegende ZIP in dieses Verzeichnis entpacken.
# Die beiden Testdateien nach ARCHIVE/lcnc-webui/src/viewer/ kopieren:
#   r134.rerun.test.ts und r134.wiring.test.ts
# Konfiguration nach ARCHIVE/lcnc-webui/vitest.review.config.ts kopieren;
# cacheDir bei anderem Export auf ein eigenes /tmp-Verzeichnis umstellen.
cd ARCHIVE/lcnc-webui
nice -n 19 node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r134.rerun.test.ts src/viewer/r134.wiring.test.ts
```

`REVIEW_OUT` kann das Payload-/Ausgabeverzeichnis überschreiben; Standard `ARCHIVE/..`. Die Sonden schreiben `client.json` und `wiring.json` dorthin. Ein unveränderter Lauf des geprüften Stands muss die vier beschriebenen roten Assertions zeigen. Die beiden Fehlermeldungen im Test-stderr sind erwartete Meldungen der echten Fehlerhandler.

Vor Ablage: geänderte Produkt-/Test-/Fixture-Dateien des Exports gegen `git show 52f7b49c` vergleichen; den gesamten vorhandenen Review-Präfix per Länge und SHA256 sichern und unverändert erhalten. Im Live-Baum nur neuer Anhang und neue `r134.codex-*`-Belege. `done R134` erst nach Ablage und `git diff --check`.
