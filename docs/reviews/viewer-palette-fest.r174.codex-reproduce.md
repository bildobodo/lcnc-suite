# R174 · Codex · Reproduktion

Stand: `9fda6d45` auf `feat/step4-p2b`, nicht gemergt. Geprüft in `/tmp/codex-r174-lvzu29b5/repo`, aus `git archive`; keine Tests oder Änderungen am Produkt im Live-Baum, keine Ports oder Maschinenbefehle. Die 375 verfolgten Dateien unter `lcnc-webui/src` sowie `CLAUDE.md` und die beiden geänderten tsconfig-Dateien stimmen mit dem Commit überein (Manifest). Die beiden eigenen Sonden sind zusätzliche Dateien.

Voraussetzung: Archivkopie dieses Commits mit den zum Lockfile passenden installierten Abhängigkeiten. Für die tatsächlichen Läufe wurden die vorhandenen Abhängigkeiten einer früheren Review-Kopie verlinkt. Node/Vitest aus diesen Abhängigkeiten, ein Worker, `nice -n 10`.

## Repository-Prüfungen

Im `lcnc-webui` der isolierten Kopie:

```bash
LINE_SAMPLE_LOG=/tmp/codex-r174-lvzu29b5/compare.jsonl nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/collisionLineSample.test.ts src/viewer/collisionWindows.test.ts src/viewer/collision.test.ts src/viewer/collisionRange.test.ts src/viewer/collisionInside.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r174-lvzu29b5/unit.json
COLLISION_GEN=50 COLLISION_STEP=0.05 COLLISION_SHORT_LINES=1 COLLISION_HUNT_LOG=/tmp/codex-r174-lvzu29b5/oracle-short.txt nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/collisionOracle.test.ts -t 'generated machine (20261036|20261049|20261053|20261060):' --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r174-lvzu29b5/oracle-short.json
```

Ergebnis: 157/157 und 4/4 ausgeführte Tests grün; beim Orakel 52 bewusst nicht gewählte Tests. Keine vollständige Wiederholung von Claudes Gate oder der 112 feinen Orakelprüfungen. `haus.ngc` Fall B und die historischen Mutationen wurden als eingereichte Belege geprüft, nicht erneut ausgeführt; keine privaten Programmdaten kopiert.

## VP-I127: Unterbrechungs- und Budgetgrenze

`viewer-palette-fest.r174.codex-near.test.ts` nach `src/viewer/r174.codex-near.test.ts` in der isolierten Kopie kopieren. Die Ausgabedateien der Sonde liegen absichtlich unter dem oben genannten `/tmp`-Verzeichnis; bei anderer Ablage diese reinen Ausgabepfade anpassen.

```bash
nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r174.codex-near.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r174-lvzu29b5/near-tests.json
```

Erwartet am Review-Kopf: **zwei rote Assertions**. Erste Probe: zwei Boxen, X fährt von −8 nach 3,5, dann nach 5,5; im zweiten Abschnitt läuft eine vom Paar unabhängige A-Achse 360/3600/36000 Grad mit. Verglichen werden alte Zeilenprobe und Vorgabe B8. Gemessen werden Wandzeit und, unabhängig davon, die Anzahl der Nachproben zwischen Iterator-Checkpoints. `yieldMs=2`; bei 3600 Grad 6666 Nachproben in einem Aufruf statt höchstens 512.

Zweite Probe: derselbe 3600-Grad-Fall, eine Nachprobe = eine virtuelle Millisekunde. `maxMs=64`, `yieldMs=8`. Die Uhr bleibt sonst stehen. Der Sweep prüft das Budget erst nach 6666 virtuellen Millisekunden; Assertion verlangt spätestens 96 (64 + Abfragequantum 32). Dies ist ein deterministischer Arbeitsnachweis, keine Aussage über reale Millisekunden. Reale Zeiten separat in `codex-near.json`.

## VP-I128: Der Vergleich lässt einen nicht gleichwertigen Mutanten durch

`viewer-palette-fest.r174.codex-cover.test.ts` nach `src/viewer/r174.codex-cover.test.ts` kopieren. Dies ist eine Kopie des neuen Vergleichstests mit einer ausdrücklich markierten zusätzlichen Instrumentierung. **Kein Produktcode verändert.** Nur erzeugte Maschine 20261014 wird gewählt.

```bash
CODEX_REMOVE_RAPID=1 nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r174.codex-cover.test.ts -t 'generated machine 20261014:' --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r174-lvzu29b5/cover-mutant.json
CODEX_REMOVE_RAPID=1 CODEX_ENFORCE_RAPID=1 nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r174.codex-cover.test.ts -t 'generated machine 20261014:' --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r174-lvzu29b5/cover-control.json
```

Die Instrumentierung entfernt nach der Intervall-/Aufenthaltsprüfung aus dem B8-Ergebnis die `IV_RAPID`-Flags der pauschal ausgenommenen Paare und baut dessen Kontaktansicht ordnungsgemäß neu. Sie belegt, dass drei Flags entfernt werden, zwei veröffentlichte Ziele dadurch ihr Eilgang-Merkmal verlieren und mindestens eines tatsächlich einen Eilgangkontakt breiter als MIN_ADV enthält. Alle bestehenden Vergleichsassertions bleiben erhalten.

Erster Lauf: **grün**, 1/1 gewählt (13 nicht gewählt). Gegenbeweis zur Empfindlichkeit des Vergleichs. Zweiter Lauf: **rot** durch die zusätzliche Aussage, dass eine kurze Ausnahme an anderer Stelle keinen solchen breiten Eilgangkontakt entschuldigen darf. Die konkrete verlorene Aussage betrifft `C67|0|0`, `work_x_1/work_0`, L14 bei 2,25221758 innerhalb des Eilgangsegments [2,20221758; 3,08172917]. Ergebnis in `codex-exemption.json`.

Bei der Entwicklung der Sonde wurde zunächst die notwendige Neuerzeugung der Kontaktansicht nach einer Tabellenänderung ergänzt; dieser anfängliche Fehler der Sonde ist kein Produktbefund. Maßgeblich sind die hier gespeicherten finalen Läufe.
