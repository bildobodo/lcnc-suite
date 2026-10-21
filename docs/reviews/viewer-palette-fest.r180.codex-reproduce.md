# R180 · Codex · Reproduktion

Review `7c034f9c..f507a0bf`, `feat/step4-p2b`, 21.10.2026. Isolierte Kopie `/tmp/codex-r180-97htg9m6/repo`, niedrige Priorität, eigener Mock auf `127.0.0.1:4188`. Keine Live-Ports oder Maschinenbefehle.

## Aufbau und Build

`git archive f507a0bf` in ein eigenes Verzeichnis entpacken. `lcnc-webui/node_modules` als eigene Kopie aus dem R179-Archiv übernehmen (`cp -a --reflink=auto`); keine schreibbare Verknüpfung. Alle 480 verfolgten Dateien unter `lcnc-webui/src`, `lcnc-gateway` sowie `CLAUDE.md` gegen den Kopf geprüft, LFS-Modelle gegen SHA256. Im archivierten `lcnc-webui`, ohne zusätzliche Codex-Unit-Datei im `src`-Verzeichnis:

```sh
nice -n 10 npm run build
```

Build grün. Die Browserprüfungen verwenden diesen Build.

## Native Payloads und Backend

Diese vorhandenen Belege unverändert ins archivierte `lcnc-gateway` kopieren:

| Beleg in `docs/reviews/` | Name in der Archivkopie |
| --- | --- |
| `viewer-palette-fest.r177.codex-native.py` | `r180_r177_native.py` |
| `viewer-palette-fest.r178.codex-cap-native.py` | `r180_r178_native.py` |
| `viewer-palette-fest.r179.codex-two-axes-native.py` | `r180_codex_native.py` |

```sh
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r180_r177_native.py r177_foreign_limit /tmp/codex-r180-97htg9m6/native.msgpack > /tmp/codex-r180-97htg9m6/native.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r180_r178_native.py r178_cap /tmp/codex-r180-97htg9m6/cap.msgpack > /tmp/codex-r180-97htg9m6/cap-native.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r180_codex_native.py r179_two_axes /tmp/codex-r180-97htg9m6/two-axes.msgpack > /tmp/codex-r180-97htg9m6/two-axes-native.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest test_limit_origin_worker.py test_preview_poll_chain.py -q --junitxml=/tmp/codex-r180-97htg9m6/backend.xml
```

14 Backend-Tests grün. Drei erfolgreiche eigene Parses mit echtem Offline-Interpreter und Worker; temporäre INI/Parameter/Werkzeugtabelle, synthetischer STAT, `linuxcnc.command` wirft. Werkzeug-mmap jeweils unverändert. Kein Live-Gateway importiert oder angesprochen.

## Unit-Prüfungen

Beleg `viewer-palette-fest.r180.codex-two-axes.test.ts` nach `lcnc-webui/src/viewer/r180.codex-cap.test.ts` kopieren. Er ist die R179-Sonde mit ausschließlich geändertem Ausgabepfad. Nach Erzeugung der nativen Payloads im archivierten `lcnc-webui`:

```sh
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/viewer/limitPlaces.test.ts src/viewer/limitOriginPayloads.test.ts src/viewer/simRows.test.ts src/viewer/scrubTrack.test.ts src/viewer/simWindow.test.ts src/viewer/r180.codex-cap.test.ts --reporter=json --outputFile=/tmp/codex-r180-97htg9m6/unit.json
```

122 grün (121 Repository-Tests und eine eigene Gegenprobe). Die unveränderte eigene Gegenprobe erlaubt eine achsbezogene Aussage; die neuen Repository-Assertions prüfen zusätzlich die exakten Zahlen beider Achsen. Ihr alter Diagnosezugriff auf `cut` trägt keine Assertion und wird nach der Umstellung auf `cuts` nicht mehr ins JSON geschrieben.

**Zwei korrigierte Einrichtungsfehler:** Der erste eigene Unit-Lauf startete vor Erzeugung seines Payloads (`ENOENT`); nach Erzeugung alle 122 grün. Der erste Build enthielt die zusätzliche alte Codex-Sonde, deren `node:fs`-Import und Diagnosezugriff `cut` der Produkt-Typecheck ablehnte. Die Sonde wurde vor dem erneuten Produkt-Build aus `src` herausgenommen; Build grün. Kein Produktcode geändert. Die Erstläufe liegen als `codex-unit-setup.json` und `codex-build-with-probe-setup.txt` bei und sind keine Produktbefunde.

## Browser

Belege mit Präfix `viewer-palette-fest.r180.`:

| Beleg | Ziel im archivierten `lcnc-webui` |
| --- | --- |
| `codex-r178.viewer.spec.ts` | `e2e/r180.codex-r178.viewer.spec.ts` |
| `codex-extra.viewer.spec.ts` | `e2e/r180.codex-extra.viewer.spec.ts` |
| `codex-browser.config.ts` | `playwright.r180.config.ts` |
| `codex-own-browser.config.ts` | `playwright.r180-own.config.ts` |

Nur in der Archivkopie beide URLs von `e2e/ctl.ts` auf `127.0.0.1:4188` setzen; in `e2e/mock-gateway.mjs` `server.listen(PORT, '127.0.0.1', callback)` verwenden. Ein Chromium-Worker, `MOCK_PORT=4188`, kein `reuseExistingServer`, Trace aus; lokale Listener-Ausführung genehmigt. Bei anderem Ausgabeverzeichnis den festen Präfix in den Sondenkopien ersetzen.

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r180.config.ts sim-panel.viewer.spec.ts -g 'code marks:|a row with more stretches|a row of two capped|a limit row stands|the summary names'
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r180-own.config.ts r180.codex-r178.viewer.spec.ts r180.codex-extra.viewer.spec.ts
```

Sieben Repository-Browserfälle und sechs eigene Fälle grün, keine Wiederholungen oder Flakes. Eigene Assertions unverändert gegenüber R178/R179, lediglich der Ausgabepfad ersetzt: Legacy/unmarkierte Routine ohne Code-Marke, belegte L3 mit Sprung `cum=6.001`, Ein-Achsen-Kappung, Zwei-Achsen-Kappung sowie Ersetzung/Leeren der Code-Marken. Der Legacy-Payload wird nur als Datei aus dem Live-Repository gelesen; die übrigen Payloads stammen aus dem Archiv oder den eigenen Offline-Parses.

Vollständige Gates und historische Mutationen nicht selbst wiederholt. Plan und bestehende Belege unverändert; nur Review-Anhang, neue Belege und abschließend Handshake. Browser-PC-Messung bleibt nach dem vereinbarten Merge vorgesehen.
