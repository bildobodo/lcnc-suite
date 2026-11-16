# R383 · Codex · Belege

Prüfstand `be5dd91f`, gegenüber R382 `e743061a`; Gesamtbasis `cad9ac77`. Archivkopie `/tmp/codex-r383`. Kein Live-Zugriff, keine Maschinenbefehle und kein Browserlauf. Die vier geänderten Quelldateien sind unverändert gegenüber ihren Git-Blobs: [Metadaten und Hashes](vor-maschine.p3b.r383.codex-meta.json).

## Ausgeführte Prüfungen

- Vollständige `scripts/test_native_stage.py` und die **unveränderten** acht R382-Proben: **628/628 PASS in 54,47 s**. Darin 620 Repository-Fälle einschließlich der Latch-Wächter. [Log](vor-maschine.p3b.r383.codex-tests.txt). Die AST-Auswahl der zehn neu hinzugekommenen/geänderten Testfunktionen steht zusätzlich [hier](vor-maschine.p3b.r383.codex-test-selection.txt); ausgeführt wurde die ganze Datei.
- [Neue Probe](vor-maschine.p3b.r383.codex-probes.py): **ein roter Vertragsgegenfall, eine grüne Kontrolle**, [Log](vor-maschine.p3b.r383.codex-probes.txt). Kein Import-/Aufbaufehler.

Die neue Probe benutzt den echten `SimulatorClient` mit einem lokalen Socket-Objekt, `_finish`, `_plant`, `_short`, `_routine`, den M6-/Ende-Wächter und das tatsächliche DEBUG-Zurücklesen. Nur die Gateway-Gegenstelle und `_standstill` sind ersetzt; letzteres liefert hier eine zugelassene Ausgangslage und ist nicht Gegenstand der Probe. Es gibt keine Netzwerkverbindung.

Im ersten Wiederherstellungsblock für `#3014` bis `#3035` empfängt der Client einen Trip. Die Busy-/Idle-Frames lassen den einzelnen kurzen Auftrag enden. Danach kennt `c.safety_trip` die Auslösung, dennoch folgen ein zweiter Parameterblock und zwei DEBUG-Zeilen. Alle drei Sendeversuche sind im Log mit `true` (Trip beim Senden bereits bekannt) markiert. Erst nach Rückkehr aus dem gesamten `_plant` meldet `_finish` `stopped: a safety trip waits`. Die Gegenstelle nimmt diese Aufträge synthetisch an, damit der vollständige Ablauf sichtbar wird. Das ist **kein Beleg**, dass ein echtes Gateway die Folgeaufträge annimmt; schon der erste Versuch bei bekanntem Trip verletzt die vereinbarte Abschlussregel. Die ansonsten identische Kontrolle ohne Trip beendet die Wiederherstellung erfolgreich.

Reproduktion ausschließlich in einer Archivkopie:

```sh
cd /tmp/codex-r383
cp /home/cnc/lcnc-suite/docs/reviews/vor-maschine.p3b.r382.codex-probes.py r382_probe.py
cp /home/cnc/lcnc-suite/docs/reviews/vor-maschine.p3b.r383.codex-probes.py r383_probe.py
LCNC_HEAVY_LOCK=/tmp/r383-review-heavy.lock PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q -p no:cacheprovider scripts/test_native_stage.py r382_probe.py
LCNC_HEAVY_LOCK=/tmp/r383-review-heavy.lock PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q -p no:cacheprovider r383_probe.py
```

## Gespeicherte Artefakte

Round-Gate an `be5dd91f`, unveränderter Baum: alle ausgewiesenen Schritte PASS, 2657 Unit-/924 Browserfälle. Der Browserlauf wurde nicht wiederholt. Die 34 Offline-Mutationen und die zwei Browser-Mutationen sind Claudes Belege; die neue Probe ergänzt eine darin nicht getroffene Stelle innerhalb des Schritts `values`.

Die drei nativen `report.json` und die gesamten zugehörigen `trace.ndjson` wurden gelesen. Ein separater JSON-Durchgang prüfte je sechs Markenpaare auf Reihenfolge und gemeinsame Gateway-PID/Prozessname, sowie bei vorhandenen Jobs genau eine Parameterlieferung einschließlich `3116=0` und eine bestätigte Übernahme derselben Schlüssel. [Audit mit Hashes, Pfaden, Fensterzeilen, Fallzeilen und Surface-Abschluss](vor-maschine.p3b.r383.codex-artifact-audit.json).

`main1` und `main2`: je 22 Antast-/Surface-Zeilen PASS; `mdi-driver`: genau `probe-run` und `surface-scan.job` FAIL. Alle drei Berichte nennen vollständige Rückgabe und keine Crashes. Surface meldet jeweils alle sechs Wiederherstellungsschritte ohne Abbruch der Schleife. Diese Erfolgsbelege sagen nichts über den neu injizierten Trip innerhalb eines Mehrfachschritts aus. Wie von Claude benannt ist der vorgelagerte Abbruch/Stillstand im nativen Datensatz nicht eigens protokolliert; dessen Reihenfolge wird durch Code und Offline-Gegenfälle gehalten.
