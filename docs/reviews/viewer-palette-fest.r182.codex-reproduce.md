# R182 · Reproduktion der Codex-Prüfung

Review-Kopf: `99fce612`, isoliertes Archiv `/tmp/codex-r182-kw9jm2wo/repo`.
Live-Baum: `ba122782`; dort nur Review-Anhang und neue `r182.codex-*`-Belege.
Keine Maschinenverbindung, keine Treiber-`main()` und keine Live-Ports.

## Aufbau

Ein neues Verzeichnis unter `/tmp` anlegen und `git archive 99fce612` dort in `repo/` entpacken. Vorhandene passende `node_modules` nur verlinken (hier aus der isolierten R181-Kopie). Das Archiv enthält die aufgelösten STL-LFS-Objekte; deren SHA-256 ist gegen die Git-LFS-Zeiger geprüft.

Alle folgenden Frontend-Befehle im Archiv unter `repo/lcnc-webui/`, alle Backend-Befehle unter `repo/lcnc-gateway/` ausführen. Ein Browser-Worker, `nice -n 10`.

## Repository-Prüfungen

```sh
nice -n 10 npm run build
nice -n 10 node node_modules/vitest/vitest.mjs run src/viewerPerf.test.ts src/ws/statusStore.test.ts src/wsWorker.test.ts src/ws/wsTransport.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/r182-unit.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest test_bulk_pipeline.py test_ws_fanout.py -q
```

Ergebnisse: Build PASS, 75 Unit-Tests, 78 Backend-Tests. Der erste Backend-Versuch mit System-Python hatte kein pytest. Der Lauf im vorhandenen venv blieb innerhalb der eingeschränkten Sandbox nach den drei synchronen Tests beim ersten asynchronen Thread-Rückruf stehen und wurde mit SIGINT beendet. Derselbe gezielte Offline-Testlauf außerhalb dieser Einschränkung bestand; kein Produktcode wurde dafür verändert.

Browser: `viewer-palette-fest.r182.codex-playwright.config.ts` als `r182.playwright.config.ts` ins Frontend-Archiv kopieren. Den absoluten JSON-Ausgabepfad auf das eigene `/tmp`-Verzeichnis setzen. **Nur im Archiv** `e2e/ctl.ts` von `localhost:4174` auf `127.0.0.1:4188` umstellen. Die Konfiguration startet ausschließlich den eigenen Mock dort, keine Vite-/Gateway-Live-Ports.

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=r182.playwright.config.ts
```

Ergebnis: vier Fälle in `frames.spec.ts` PASS, einschließlich des neuen Messwert-Wächters. Mock und Browser wurden anschließend beendet.

## Eigene Zeit-Gegenproben

`viewer-palette-fest.r182.codex-clock.test.ts` nach `repo/lcnc-webui/src/r182.codex-clock.test.ts` kopieren; den einen absoluten Ausgabepfad auf das eigene `/tmp`-Verzeichnis umstellen. Erst **nach** dem Repository-Build anlegen.

```sh
nice -n 10 node node_modules/vitest/vitest.mjs run src/r182.codex-clock.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/r182-clock-tests.json
```

Erwartet am Review-Kopf: eine Kontrolle PASS, zwei Vertrags-Assertions FAIL. Reale Module `statusStore`, `viewerPerf` und Vue; eine kontrollierte Uhr/rAF-Reihenfolge und der kleine aus `ThreeViewer` nachgebildete Watcher/Verbraucher. Kein vollständiger gerenderter Zeitnachweis. Die separate Browserprüfung bestätigt die tatsächliche Worker-/Status-/Telemetrie-Verdrahtung, aber prüft gerade nicht diese Identitäts- und Lastfälle.

## Eigene Treiber-/Berichtproben

Unter dem `/tmp`-Prüfverzeichnis `measurement-tools/` anlegen und Claudes unveränderte Belege umbenannt kopieren:

- `viewer-palette-fest.r182.browser-pc-bpc.py` → `bpc.py`
- `viewer-palette-fest.r182.browser-pc-drive.py` → `drive.py`
- `viewer-palette-fest.r182.browser-pc-drive2.py` → `drive2.py`
- `viewer-palette-fest.r182.browser-pc-report2.py` → `report2.py`

Die Codex-Sonde importiert diese Module, **ruft ihre Hauptprogramme nicht auf**. Sie füttert den Client über einen künstlichen Iterator mit der echten Gateway-Hülle, ersetzt alle Treiber-Kommandos durch AsyncMocks und verwendet ausschließlich eigene temporäre Logs. `repo/lcnc-gateway/` muss das isolierte Archiv enthalten.

```sh
R182_PROBE_ROOT=/tmp/codex-r182-kw9jm2wo nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /home/cnc/lcnc-suite/docs/reviews/viewer-palette-fest.r182.codex-tools.py
```

Den Pfad der Umgebungsvariablen auf die eigene Archivwurzel setzen. Erwartet am Review-Kopf: zehn Fälle, fünf PASS und fünf Vertrags-Assertions FAIL. Zwei rote Fälle zur Client-Erkennung, drei zur Watchdog-Auswertung. Die supersede-Probe ohne tatsächlichen Abbruch ist bewusst eine **grüne Charakterisierung** des dokumentierten Weiterlaufens und kein zusätzlicher blockierender Befund. Die Sonde speichert `tools-evidence.json` unter der angegebenen `/tmp`-Wurzel.

## Integrität

`codex-manifest.json` enthält die SHA-256 der bereits vorhandenen Eingaben sowie der neuen Ergebnisdateien, die Liste der 562 geprüften Quell-/Test-/Instruktionsdateien, vier LFS-Objekte und die einzige Anpassung an einer verfolgten Archivdatei (`ctl.ts`, Test-Port). Der ursprüngliche Review-Inhalt wurde als unverändertes Bytepräfix geprüft; der Plan und sämtliche vorhandenen R182-Belege blieben unverändert. `codex-summary.json` trennt grüne Repository-Tests und gezielt rote Vertragsproben.
