# R175 · Codex · Reproduktion

Review `9fda6d45..118955dc`, ausgeführt in `/tmp/codex-r175-27668dv6/repo` aus `git archive 118955dc`. Abhängigkeiten aus der vorherigen isolierten Review-Kopie verlinkt, passend zum unveränderten Lockfile. Ein Worker, `nice -n 10`. Kein Build/Test im Live-Baum, keine Ports oder Maschinenbefehle. 377 verfolgte Dateien unter `lcnc-webui/src` und `CLAUDE.md` bytegleich zum Commit; zusätzliche eigene Sonden gesondert.

Alle folgenden Befehle laufen im `lcnc-webui` einer **isolierten** Kopie. Die eigenen Sonden speichern ihre Messwerte unter `/tmp/codex-r175-27668dv6`; bei anderer Ablage ausschließlich diese Ausgabepfade anpassen.

## Repository-Prüfungen

```bash
LINE_SAMPLE_LOG=/tmp/codex-r175-27668dv6/compare.jsonl nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/collisionLineSample.test.ts src/viewer/collisionWindows.test.ts src/viewer/nearHistory.test.ts src/viewer/simRows.test.ts src/format.test.ts src/viewer/collision.test.ts src/viewer/collisionRange.test.ts src/viewer/collisionInside.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r175-27668dv6/unit.json
COLLISION_GEN=50 COLLISION_STEP=0.05 COLLISION_SHORT_LINES=1 COLLISION_HUNT_LOG=/tmp/codex-r175-27668dv6/oracle.txt nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/collisionOracle.test.ts -t 'generated machine (20261036|20261049|20261053|20261060):' --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r175-27668dv6/oracle.json
```

185/185 sowie vier gezielt gewählte feine Orakelfälle grün. Keine vollständige Wiederholung des Gates oder der feinen Suche, keine Wiederholung des privaten Fall-B-Payloads oder historischer Mutationen.

## VP-I127 und VP-I128

Die vier Belegsonden nach `src/viewer/` kopieren:

- `viewer-palette-fest.r175.codex-r174-near.test.ts` → `r175.codex-r174-near.test.ts`
- `viewer-palette-fest.r175.codex-cover.test.ts` → `r175.codex-cover.test.ts`
- `viewer-palette-fest.r175.codex-park.test.ts` → `r175.codex-park.test.ts`
- `viewer-palette-fest.r175.codex-jump.test.ts` → `r175.codex-jump.test.ts`

```bash
nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r175.codex-r174-near.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r175-27668dv6/r174-rerun.json
nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r175.codex-cover.test.ts -t 'Codex R175:' --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r175-27668dv6/cover-own.json
nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r175.codex-park.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r175-27668dv6/park-tests.json
```

Die R174-Nachabtastungsprobe hat unveränderte Assertions; angepasst sind nur ihre Ausgabepfade. Beide grün, Nachproben 5/6/7 bei 360/3600/36000 Grad, Budgetprobe beendet sich nach 6 Arbeitseinheiten regulär.

Die Vergleichssonde kopiert den neuen Vergleichstest und ergänzt einen eigenen Test, der ausschließlich über `-t` gewählt wird. Sie bestimmt die tatsächlichen Ausnahmen des vorhandenen Falls 20261014, entfernt wie in R174 drei `IV_RAPID`-Flags genau dieser Paare, baut die Ansicht neu und verlangt, dass der Vergleich den Verlust erkennt. Nun grün: Der Vergleich wirft die erwartete Assertion zum breiten Eilgangkontakt von `work_x_1/work_0` auf L14. Keine künstliche pauschale Freistellung und keine Änderung von Produktcode.

Die Parksonde nutzt die Stufengeometrie des neuen Repository-Wächters. Während der Rückwärtssuche werden Metadaten-Snapshots gelesen und 19 vollständige Seiten-Sweeps auf demselben Modell ausgeführt. Alle Spalten aller drei Tabellen stimmen anschließend mit einem ununterbrochenen Lauf überein. Die erste Sondenausführung hatte noch Vitests Standard-Testfrist von 5 s; maßgeblich ist der gespeicherte erfolgreiche Lauf mit einer expliziten 60-s-Testfrist. Kein Produktbefund aus diesem anfänglichen Sonden-Timeout.

## VP-I129: Rückwärtsschranke über einen Positionssprung

```bash
nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r175.codex-jump.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r175-27668dv6/jump-tests.json
```

Erwartet an `118955dc`: **rot**. Dieselbe Sonde an einer Archivkopie von `9fda6d45`: **grün**; nur den Ausgabe-Dateinamen von `jump.json` auf `jump-parent.json` ändern, damit beide Ergebnisse erhalten bleiben. Tatsächlich ausgeführt in der vorhandenen R174-Archivkopie. Die vorherige Zeilenregel ist zusätzlich über `lineSample: true` im selben Test gemessen.

Geometrie: zwei Quader, jeweils 2×20×20, ein Körper entlang X verschiebbar, Abstand in Y 1,9 bei Prüfabstand 2. X kommt von −8, fährt auf 0,5 langen Zeilen bis 1 beziehungsweise 2,5. Dann ein `brk`-Punkt bei X100, anschließend bekannte Bewegung bis X110. Der Sprung hat wie im Produkt keine Sweep-Länge. Bis zum Sprung liegt die gesamte letzte Zeile sicher im Nähebereich: dessen Grenze ist X = 2 + sqrt(2²−1,9²) ≈ 2,6245.

Für Ende X1: letzte bekannte Zeile L17, Achse [8,5;9]. Der Vorgänger hält den Aufenthalt bis 8,75, der neue Kopf nur bis 7,75; `lineMark` ist vorher gesetzt, jetzt `null`. Für Ende X2,5: L20 [10;10,5], vorher Ende 10,25, jetzt 9,75 und ebenfalls keine Marke. Beide Varianten sind in den JSON-Dateien gespeichert; die eine Assertion des Tests wird bereits an der ersten Variante rot.

Die Rückwärtssuche startet mit dem **neuen** Abstand nach dem Sprung und wendet dessen Spielraum auf die **alte** Schrankengeschichte an. Ein Positions-/Geometriesprung ist keine durch diese Bewegungsschranke begrenzte Änderung. Die Suche darf deshalb ihre Aussage nicht über diese Grenze zurücktragen. Dieser Nachweis behauptet nichts über die unbekannte Bewegung selbst; verloren geht die bekannte Bewegung davor.
