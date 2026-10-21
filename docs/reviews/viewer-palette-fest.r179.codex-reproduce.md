# R179 · Codex · Reproduktion

Review `941dfe8e..7c034f9c`, `feat/step4-p2b`, 21.10.2026. Isolierte Archivkopie `/tmp/codex-r179-_0oxg34m/repo`, niedrig priorisierte Ausführung. Kein Zugriff auf die Live-Ports oder Maschinenbefehle.

## Aufbau

`git archive 7c034f9c` in ein eigenes Verzeichnis entpacken; `lcnc-webui/node_modules` als eigene Kopie aus `/home/cnc/lcnc-suite-p2/lcnc-webui/node_modules` übernehmen (`cp -a --reflink=auto`). Alle 480 verfolgten Dateien unter `lcnc-webui/src`, `lcnc-gateway` sowie `CLAUDE.md` gegen den Kopf verifiziert, ausgepackte LFS-Modelle gegen ihre SHA256. Details in `codex-source-verification.json` (gemeinsames Präfix aller neuen Belege: `viewer-palette-fest.r179.`).

## Repository-Prüfungen

Im archivierten `lcnc-webui`:

```sh
nice -n 10 npm run build
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/viewer/limitPlaces.test.ts src/viewer/limitOriginPayloads.test.ts src/viewer/simRows.test.ts src/viewer/scrubTrack.test.ts src/viewer/simWindow.test.ts --reporter=json --outputFile=/tmp/codex-r179-_0oxg34m/unit.json
```

Build und 120 Tests grün. Im archivierten `lcnc-gateway`:

```sh
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest test_limit_origin_worker.py test_preview_poll_chain.py -q --junitxml=/tmp/codex-r179-_0oxg34m/backend.xml
```

13 Tests grün: zehn native Herkunftsfälle und drei Poller-Prüfungen. Venv nur als Interpreter gelesen; Quellen und Tests aus dem Archiv.

## Native Payloads

Die bestehenden Belege `viewer-palette-fest.r177.codex-native.py` und `viewer-palette-fest.r178.codex-cap-native.py` unverändert nach `lcnc-gateway/r179_r177_native.py` bzw. `r179_r178_native.py` kopieren. Den neuen Beleg `codex-two-axes-native.py` nach `lcnc-gateway/r179_codex_native.py` kopieren. Er ergänzt den nativen Repository-Treiber um `r179_two_axes`: 80 Aufrufe derselben markierten Routine; ihre eine Bewegungszeile verletzt abwechselnd X und Y. Im archivierten Gateway:

```sh
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r179_r177_native.py r177_foreign_limit /tmp/codex-r179-_0oxg34m/native.msgpack > /tmp/codex-r179-_0oxg34m/native.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r179_r178_native.py r178_cap /tmp/codex-r179-_0oxg34m/cap.msgpack > /tmp/codex-r179-_0oxg34m/cap-native.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r179_codex_native.py r179_two_axes /tmp/codex-r179-_0oxg34m/two-axes.msgpack > /tmp/codex-r179-_0oxg34m/two-axes-native.json
```

Echter Offline-Interpreter und Worker, temporäre INI/Parameter/Werkzeugtabelle, synthetischer STAT; `linuxcnc.command` wirft. Alle drei Parses erfolgreich und Werkzeug-mmap unverändert. Die JSON-Ausgaben und Payloads liegen als neue Belege vor. Zwei Achsen: je `nruns=40`, je 32 gesendete Abschnitte, zusammen 80 Außenpunkte.

## Client und Browser

Beleg `codex-two-axes.test.ts` nach `src/viewer/r179.codex-cap.test.ts` kopieren. Im archivierten `lcnc-webui`:

```sh
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/viewer/r179.codex-cap.test.ts --reporter=json --outputFile=/tmp/codex-r179-_0oxg34m/two-axes-tests.json
```

Eine rote Assertion: Die Zeile hat 64 verschiedene Bänder, behauptet unqualifiziert 32. Die Rechnung steht in `codex-two-axes-track.json`.

Belege `codex-r178.viewer.spec.ts`, `codex-extra.viewer.spec.ts`, `codex-browser.config.ts`, `codex-own-browser.config.ts` nach `e2e/r179.codex-r178.viewer.spec.ts`, `e2e/r179.codex-extra.viewer.spec.ts`, `playwright.r179.config.ts`, `playwright.r179-own.config.ts` kopieren. Bei anderem Ausgabeverzeichnis den festen Pfad `/tmp/codex-r179-_0oxg34m` in den Sondenkopien ersetzen.

Nur im Archiv: beide URLs in `e2e/ctl.ts` auf `127.0.0.1:4188` ändern (HTTP und WS); in `e2e/mock-gateway.mjs` den Listen-Host explizit auf `127.0.0.1` setzen. Eigener Mock `MOCK_PORT=4188`, kein `reuseExistingServer`, ein Chromium-Worker, Trace aus. Der Mock liefert den Archiv-Build. Lokale Listener-Ausführung wurde genehmigt.

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r179.config.ts sim-panel.viewer.spec.ts -g 'code marks:|a row with more stretches|a limit row stands|the summary names'
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r179-own.config.ts r179.codex-r178.viewer.spec.ts r179.codex-extra.viewer.spec.ts
```

Sechs Repository-Fälle grün. Die R178-Sonde ist bis auf `DIR` unverändert: alle vier Assertions grün (Legacy, unmarkierte Routine, nativer L3-Fall, Kappung einer Achse). Der Legacy-Payload wird nur als Datei aus `/home/cnc/lcnc-suite/docs/reviews/viewer-palette-fest.r177.codex-native.msgpack` gelesen; keine laufende Suite. Der unmarkierte Payload stammt aus den Repository-Fixtures.

Die zusätzliche Spec liefert einen grünen Lebenszyklusfall (L3 → Legacy ohne Marke → L3 → leer ohne Marke) und eine rote Assertion zum Zwei-Achsen-Fall. JSON und Bild werden davor geschrieben. Diese numerischen Gegenproben diagnostizieren den aktuellen unqualifizierten Wortlaut; bei achsbezogener Formulierung sind ihre Erwartungen entsprechend diesem Vertrag anzupassen.

Keine Produktquelle verändert, vollständige Gates und historische Mutationen nicht wiederholt. Bestehende Belege und Plan unverändert. Die Browser-PC-Messung bleibt für nach dem Agreement und Merge vorgesehen.
