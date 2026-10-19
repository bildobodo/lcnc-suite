# R176 · Reproduktion

Geprüft `7726afe8`, Basis `118955dc`. Ausführung in der Archivkopie `/tmp/codex-r176-f1ztm26r/repo`; keine Produktänderungen. Abhängigkeiten unverändert aus der bestehenden Installation verlinkt, Ziel im Manifest.

Die fünf eigenen `.test.ts`-Belege nach `lcnc-webui/src/viewer/r176.codex-<Name>.test.ts` kopieren (jump, park, r174-near, boundaries, boundary-park). Die ersten drei sind die R175-Sonden mit lediglich angepasstem Ausgabeverzeichnis. Alle Belege schreiben Messwerte nach `/tmp/codex-r176-f1ztm26r`; für einen unabhängigen Lauf diese Pfade auf ein neues Verzeichnis ändern. Vorhandene Review-Belege nicht überschreiben.

Aus `lcnc-webui`:

```bash
nice -n 10 node node_modules/vitest/vitest.mjs run \
 src/viewer/collisionWindows.test.ts src/viewer/nearHistory.test.ts \
 src/viewer/collision.test.ts src/viewer/collisionRange.test.ts \
 src/viewer/collisionInside.test.ts src/viewer/r176.codex-jump.test.ts \
 src/viewer/r176.codex-park.test.ts src/viewer/r176.codex-r174-near.test.ts \
 --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r176-f1ztm26r/unit.json

nice -n 10 node node_modules/vitest/vitest.mjs run \
 src/viewer/r176.codex-boundaries.test.ts --maxWorkers=1 \
 --reporter=json --outputFile=/tmp/codex-r176-f1ztm26r/boundaries-tests.json

nice -n 10 node node_modules/vitest/vitest.mjs run \
 src/viewer/r176.codex-boundary-park.test.ts --maxWorkers=1 \
 --reporter=json --outputFile=/tmp/codex-r176-f1ztm26r/boundary-park-tests.json

COLLISION_GEN=50 COLLISION_STEP=0.05 COLLISION_SHORT_LINES=1 \
 COLLISION_HUNT_LOG=/tmp/codex-r176-f1ztm26r/oracle-counts.txt \
 nice -n 10 node node_modules/vitest/vitest.mjs run \
 src/viewer/collisionOracle.test.ts \
 -t 'generated machine (20261036|20261049|20261053|20261060):' \
 --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r176-f1ztm26r/oracle.json
```

Ergebnisse: 157 + 24 + 1 + 4 ausgeführte Tests PASS, beim Orakel 52 nicht ausgewählte Fälle. Davon 157 Repository-Prüfungen und 29 eigene. Das Manifest bindet getestete Quellen, ursprüngliche Eingaben und Belege an ihre Prüfsummen. Budget-/Fortsetzungsproben benutzen deterministische Uhren; keine reale Laufzeitbehauptung daraus. Keine eigene Wiederholung des vollständigen Gates oder `haus.ngc`, kein Browser und keine Maschinenbefehle.
