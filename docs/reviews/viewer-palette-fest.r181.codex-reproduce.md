# R181 · Codex · Reproduktion

Review `f507a0bf..3bed80f9`, `feat/step4-p2b`, 22.10.2026. Isoliertes Archiv `/tmp/codex-r181-mxspmf64/repo`. Live nur Review-Anhang, neue Belege und Handshake. Keine Maschinenbefehle, Live-Ports, Builds oder Tests im Live-Baum.

## Quellstand und Tests

`git archive 3bed80f9` in die eigene Kopie entpacken. Abhängigkeiten als eigene Kopie (`cp -a --reflink=auto`) aus `/home/cnc/lcnc-suite-p2/lcnc-webui/node_modules` übernehmen. 480 verfolgte Dateien unter `lcnc-webui/src`, `lcnc-gateway` sowie `CLAUDE.md` gegen den Kopf verifiziert; hydratisierte LFS-Modelle gegen ihre SHA256. Keine Produktquelle verändert.

Im archivierten `lcnc-webui`:

```sh
nice -n 10 npm run build
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/viewer/limitPlaces.test.ts src/viewer/limitOriginPayloads.test.ts src/viewer/simRows.test.ts src/viewer/scrubTrack.test.ts src/viewer/simWindow.test.ts --reporter=json --outputFile=/tmp/codex-r181-mxspmf64/unit.json
```

Build und 121 Unit-Tests grün. Kein neuer Backend-Lauf: der R181-Commit ändert keinen Gateway-Produktcode. Die Browser-Gegenproben verwenden die bereits gespeicherten nativen R180-Payloads, keine neu behaupteten Parses.

## Browser

Neue Belege mit Präfix `viewer-palette-fest.r181.codex-`:

| Beleg | Ziel im archivierten `lcnc-webui` |
| --- | --- |
| `r178.viewer.spec.ts` | `e2e/r181.codex-r178.viewer.spec.ts` |
| `r179.viewer.spec.ts` | `e2e/r181.codex-r179.viewer.spec.ts` |
| `reasons.viewer.spec.ts` | `e2e/r181.codex-reasons.viewer.spec.ts` |
| `browser.config.ts` | `playwright.r181.config.ts` |
| `own-browser.config.ts` | `playwright.r181-own.config.ts` |

Die ersten beiden Specs sind die R180-Belege mit ausschließlich neuem Ausgabepfad. Die neue Spec prüft beide Gründe für einen Datensatz ohne Ort: `runs` fehlt bzw. `runs=[[90000,90001]]` liegt außerhalb der Spur. Grundlage ist der gespeicherte native R180-Payload. Notiz einschließlich vollständigem Titel, Summary-Hilfe, keine Bänder, kein Sim-Start beim Klicken und keine Code-Markierung werden geprüft.

`viewer-palette-fest.r180.codex-native.msgpack`, `…cap.msgpack`, `…two-axes.msgpack` nach `/tmp/codex-r181-mxspmf64/native.msgpack`, `cap.msgpack`, `two-axes.msgpack` kopieren. Legacy wird weiterhin ausschließlich als Datei aus `viewer-palette-fest.r177.codex-native.msgpack` gelesen.

Nur im Archiv: beide HTTP/WS-URLs in `e2e/ctl.ts` auf `127.0.0.1:4188` ändern; `e2e/mock-gateway.mjs` mit Listen-Host `127.0.0.1`. Eigener Mock, `reuseExistingServer:false`, ein Chromium-Worker, Trace aus. Lokale Listener-Ausführung genehmigt. Bei anderem Pfad den festen Ausgabepräfix in den Kopien ersetzen.

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r181.config.ts sim-panel.viewer.spec.ts -g 'code marks:|a row with more stretches|a row of two capped|a limit row stands|the summary names'
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r181-own.config.ts r181.codex-r178.viewer.spec.ts r181.codex-r179.viewer.spec.ts r181.codex-reasons.viewer.spec.ts
```

Sieben Repository- und acht eigene Browserfälle grün, keine Wiederholung oder Flakes. Vollständiges Frontend-Gate und Mutationen nur anhand von Claudes Belegen geprüft, nicht erneut ausgeführt.

## Prüfung der Browser-PC-Messung: nur gespeicherte Daten gelesen

`codex-audit-measurement.py` liest die originalen Marken aus `/home/cnc/claude-work/bpc/marks.json` und die noch verfügbaren `runlogs/trace.ndjson*` bis zur jeweils aufgenommenen Dateigröße. Kein Import/Aufruf des Maschinentreibers. Nur Ereignisse im ursprünglichen Messzeitraum werden verarbeitet. Exportiert werden numerische Felder, Ereignisnamen, die Sichtbarkeit und eine grobe lokale/entfernte Hostklasse; keine IPs, Tokens, Programmtexte oder Dateipfade aus Ereignissen.

```sh
nice -n 10 python3 /tmp/codex-r181-mxspmf64/audit-measurement.py
```

Neue Belege: `codex-measurement-marks.json`, `codex-measurement-events.json` (1236 reduzierte Ereignisse), `codex-measurement-audit.json`. Die Phase wird nach Empfangszeit zugeordnet, wie bei Claude; die dreisekündigen Fenster können an der Phasengrenze überlappen. Die nachträgliche Marke am Ende von B bleibt als solche benannt. Die 584-/206-ms-Maxima, Fensterzahlen und Parse-Zählungen sind reproduziert. Zusätzlich ausgewertet: `apply_max_ms` und vorhandene Heap-Messwerte (keine).

Die Reduktion archiviert keinen vollständigen Rohtrace. Für eine erneute Auswertung ohne die inzwischen rotierenden Runlogs genügen die gespeicherten Marken und reduzierten Ereignisse; die Schleife über `marks` und `records` im Skript ist die Aggregation. Gateway-Heartbeat-Logintervalle wurden nicht unabhängig rekonstruiert; die entsprechenden Nullzählungen stammen aus Claudes Bericht. Weder ein gemeinsames Phasen-p95 aus Fenster-p95 berechnen noch aus Ereignis-Endzahlen eine Speicher-/Queue-Obergrenze ableiten.

Messvertrag gegengeprüft mit `git show 50013713:docs/reviews/restpruefung-lauf.plan.md` (Fassung 2, Paket 4) und der weiterhin geltenden Fassung 4. `viewerPerf.recordApply` misst die Zeit zwischen Aufrufen von `ThreeViewer.applyState` separat von dessen gemessener Ausführungsdauer; weder Feld ist automatisch Ende-zu-Ende-Statuslatenz oder Eingabelatenz.

## CI nur zur Einordnung

Diff `b3d63d44..49256f8e` gelesen, keinen GitHub-Lauf gestartet oder aktuellen GitHub-Status behauptet. Die drei neuen historischen XYZAC-Fixtures sind bytegleich mit `3e501ed:examples/sim_config/xyzac5/{sim.var,position.txt,demo.ngc}`; SHA256 und Vergleich in `codex-ci-fixtures.json`. Kein vollständiges separates CI-Review oder Gate auf diesem anderen Branch.
