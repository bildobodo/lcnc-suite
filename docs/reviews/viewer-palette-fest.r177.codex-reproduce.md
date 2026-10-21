# R177 · Codex · Reproduktion

Geprüft: `7726afe8..e8bc45fe` (`feat/step4-p2b`). Ergebnis `findings`, VP-I130.
Ausführung am 21.10.2026, niedrig priorisiert in `/tmp/codex-r177-1dohjpbu/repo`.
Live-Baum, Live-Ports und Maschine wurden nicht zur Ausführung benutzt.

## Aufbau

1. `git archive e8bc45fe` in ein eigenes Verzeichnis entpacken. Verwendet wurde `/tmp/codex-r177-1dohjpbu/repo`.
2. `lcnc-webui/node_modules` aus dem vorhandenen Paket-2-Worktree als eigene Kopie übernehmen (hier `cp -a --reflink=auto`), keine gemeinsam beschreibbare Verknüpfung.
3. Die neuen Belege aus `docs/reviews/` in die Archivkopie kopieren:

| Beleg (Präfix `viewer-palette-fest.r177.codex-`) | Ziel im Archiv |
|---|---|
| `lines.test.ts` | `lcnc-webui/src/viewer/r177.codex-lines.test.ts` |
| `native-limit.test.ts` | `lcnc-webui/src/viewer/r177.codex-native-limit.test.ts` |
| `native.py` | `lcnc-gateway/r177_codex_native.py` |
| `poller.py` | `lcnc-gateway/r177_codex_poller.py` |
| `viewer.spec.ts` | `lcnc-webui/e2e/r177.codex.viewer.spec.ts` |
| `browser.config.ts` | `lcnc-webui/playwright.r177.config.ts` |
| `own-browser.config.ts` | `lcnc-webui/playwright.r177-own.config.ts` |

Die Sonden enthalten den tatsächlichen Ausgabepfad dieses Laufs. Bei einem neuen Verzeichnis ausschließlich `/tmp/codex-r177-1dohjpbu` in den Sonden/Konfigurationen ersetzen. Alternativ kann der gespeicherte `native.msgpack` als `native-marked.msgpack` im Ausgabeverzeichnis verwendet werden.

## Frontend

Im archivierten `lcnc-webui`:

```sh
nice -n 10 npm run build
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 src/viewer/scrubTrack.test.ts src/viewer/contactView.test.ts src/viewer/shownContacts.test.ts src/viewer/checkWiring.test.ts src/viewer/scrubBarWords.test.ts src/viewer/simRows.test.ts src/viewer/simWindow.test.ts src/viewer/contactPublisher.test.ts src/viewer/contactViewUnion.test.ts --reporter=json --outputFile=/tmp/codex-r177-1dohjpbu/unit.json
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 src/viewer/r177.codex-lines.test.ts --reporter=json --outputFile=/tmp/codex-r177-1dohjpbu/lines-tests.json
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 src/viewer/r177.codex-native-limit.test.ts --reporter=json --outputFile=/tmp/codex-r177-1dohjpbu/native-track-tests.json
```

243 Repository-Tests grün. Die zwei eigenen Fallback-Fälle und der native Payload-Fall sind durch Assertions rot; sie zeigen VP-I130. Die Daten werden vor der Assertion geschrieben. Beim nativen Fall den Payload zuerst wie unten erzeugen oder den gespeicherten verwenden.

## Backend und nativer Offline-Interpreter

Im archivierten `lcnc-gateway`, Interpreter aus der vorhandenen venv (nur lesen; Quellen/Tests aus dem Archiv):

```sh
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest test_bulk_pipeline.py test_gateway_util.py -q --junitxml=/tmp/codex-r177-1dohjpbu/backend.xml
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r177_codex_native.py r177_foreign_limit /tmp/codex-r177-1dohjpbu/native-marked.msgpack > /tmp/codex-r177-1dohjpbu/native-marked.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r177_codex_poller.py
```

487 Repository-Prüfungen plus 1944 Untertests grün (2431 JUnit-Fälle). Der erste Backend-Versuch in der eingeschränkten Sandbox blieb nach drei Tests stehen und wurde beendet; derselbe Befehl lief mit genehmigter Ausführung außerhalb dieser Einschränkung durch. Kein laufendes Gateway wird importiert oder angesprochen.

`native.py` ist die vorhandene `native_start_probe.py` dieses Kopfes mit einem zusätzlichen Fall `r177_foreign_limit` und Ausgabe von `feed_lineok`/`feed_cline`. Echter nativer Offline-Interpreter und echter Worker, synthetischer STAT, temporäre INI/Parameter/Werkzeugtabelle, X-Fenster ±500 mm. `linuxcnc.command` wirft, die Werkzeug-mmap bleibt unverändert. Der Unterprogramm-Marker sichert die Herkunft: rohe L5 der Unterroutine wird an der Spur als Aufrufzeile L3 angezeigt. Die Grenzliste selbst enthält dennoch L5.

`poller.py` extrahiert die tatsächliche If-Kette vom Dateiwechsel bis einschließlich `pinned_parse_outlived` aus `gateway.py` per AST und führt sie mit echter `BulkPipeline.cancel_inflight` aus. Fake-Worker und Fake-Timer, sechs Fälle: Laufende, Pause, nicht gepinnt, kein aktiver Refresh, Vorrang des Dateiwechsels, wiederholtes Idle. Die späteren Zweige und die anschließende Idle-Neuplanung sind ausdrücklich nicht Teil dieser Sonde.

## Browser

Nur in der Archivkopie: `e2e/ctl.ts` von `http://localhost:4174` auf `http://127.0.0.1:4188` umstellen; `e2e/mock-gateway.mjs` mit `server.listen(PORT, '127.0.0.1', …)` binden. Die beiden eigenen Konfigurationen starten diesen Mock mit `MOCK_PORT=4188`, einem Worker, ohne Trace und ohne Wiederverwendung eines fremden Servers. Der Mock liefert den oben gebauten Archivstand. Die Ausführung mit lokalem Listener wurde genehmigt; keine Nutzung von :8000, :5173 oder :4174.

Im archivierten `lcnc-webui`:

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r177.config.ts sim-panel.viewer.spec.ts -g 'a new result keeps|a limit row stands|the timeline:|the spacers|a moved window keeps'
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r177-own.config.ts r177.codex.viewer.spec.ts
```

Fünf Repository-Browserprüfungen grün. Der eigene Browserfall nutzt den nativen Payload und einen synthetischen XYZ-Zustand. Einzige Payload-Änderung: Dateiname `/sim.ngc` für den Mock. Er ist durch die erwartete L3-Assertion rot: tatsächlich `L5 · X 600 mm > max 500 mm · 12:00`, Sprung auf `cum=720.001`, Band bei `[720,726]`. Der verletzende Zug liegt dagegen bei `[6,360]` und gehört zur Aufrufzeile L3. `native-browser.png` zeigt den Zustand nach dem Sprung; native Modell- und Mock-Koordinatenbasis sind verschieden, für die Positionszuordnung werden deshalb die unveränderten Track-Zeiten verglichen.

## Grenzen und Unverändertheit

Keine Wiederholung des kompletten Gates, der historischen Mutationen, des langen haus.ngc-Laufs oder der Browser-PC-Abnahme. Claudes Live-Beleg zum genau einen Parse nach dem Lauf bleibt fremder Beleg. Die sechs eigenen Poller-Fälle behaupten dies nicht.

474 verfolgte Dateien unter `lcnc-webui/src`, `lcnc-gateway` sowie `CLAUDE.md` gegen `e8bc45fe` geprüft; Git-LFS-Modelle gegen ihre LFS-SHA256. Neue Sonden sind zusätzliche Dateien, die beiden Browsertransport-Anpassungen liegen außerhalb des Produkts. Das Manifest nennt die Einzelprüfsummen und die ursprünglichen Live-Eingaben. Im Live-Baum ausschließlich neue Belege und der Review-Anhang; die vorhandenen Belege bleiben unverändert.
