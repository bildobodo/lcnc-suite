# R183 · Reproduktion der Codex-Prüfung

Kopf `417c149e`, isoliertes Archiv `/tmp/codex-r183-j66_w2sq/repo`.
Live-Baum `698d9f96` wurde nur für den Review-Anhang und neue Belege beschrieben.
Keine Live-Ports, Treiber-Hauptprogramme oder Maschinenbefehle.

## Aufbau und Repository-Tests

`git archive 417c149e` in ein neues `/tmp`-Verzeichnis unter `repo/` entpacken; passende vorhandene Frontend-`node_modules` verlinken. Hier wurde die isolierte R182-Kopie wiederverwendet. Die vier aufgelösten STL-Objekte wurden gegen die Git-LFS-SHA-256 geprüft.

Im isolierten `repo/lcnc-webui/`, vor Anlage der eigenen Testdatei:

```sh
nice -n 10 npm run build
nice -n 10 node node_modules/vitest/vitest.mjs run src/statusAge.test.ts src/viewerPerf.test.ts src/ws/statusStore.test.ts src/wsWorker.test.ts src/ws/wsTransport.test.ts src/lcncWs.exports.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/r183-unit.json
```

Build und 83 Tests grün. Keine Backend-Produktänderung gegenüber R182; dessen Backend-Prüfung wurde nicht wiederholt.

Die beigelegte `viewer-palette-fest.r183.codex-playwright.config.ts` als `r183.playwright.config.ts` in das isolierte Frontend kopieren; den JSON-Ausgabepfad auf das eigene `/tmp`-Verzeichnis anpassen. Nur im Archiv `e2e/ctl.ts` von `localhost:4174` auf `127.0.0.1:4188` ändern.

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=r183.playwright.config.ts
```

Die Konfiguration startet nur den eigenen Mock auf Loopback 4188. Vier Fälle in `frames.spec.ts` grün; Browser und Mock anschließend beendet. Für den lokalen Browser-/Mock-Lauf wurde die bestehende Freigabe außerhalb der Netzbeschränkung verwendet.

## Eigene Zeitproben

`viewer-palette-fest.r183.codex-clock.test.ts` nach `repo/lcnc-webui/src/r183.codex-clock.test.ts` kopieren, absoluten Ausgabepfad anpassen. Erst nach dem Build anlegen.

```sh
nice -n 10 node node_modules/vitest/vitest.mjs run src/r183.codex-clock.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/r183-clock-tests.json
```

Drei angepasste R182-Fälle PASS; der neue Folgefall mit noch unterwegs befindlicher H2-Antwort nach einer mehrdeutigen H1-Antwort FAIL. Messwerte in `codex-clock-evidence.json`. Reale Store-/Vue-/Messmodule, kontrollierte Uhr und rAF-Reihenfolge; der kleine Viewer-Verbraucher ist nachgebildet. Dies ist kein vollständig gerenderter Zeitnachweis. Der separate Browsertest prüft die tatsächliche Verdrahtung.

## Werkzeugtests und eigene Gegenproben

Unter derselben `/tmp`-Wurzel `measurement-tools/` anlegen und unveränderte Belege kopieren:

| Beleg | Kopiename |
| --- | --- |
| `viewer-palette-fest.r182.browser-pc-bpc.py` | `bpc.py` |
| `viewer-palette-fest.r182.browser-pc-drive.py` | `drive.py` |
| `viewer-palette-fest.r183.browser-pc-drive2.py` | `drive2.py` |
| `viewer-palette-fest.r183.browser-pc-report2.py` | `bpc2.py` |
| `viewer-palette-fest.r183.browser-pc-tracetail.py` | `tracetail.py` |
| `viewer-palette-fest.r183.browser-pc-tools-test.py` | `test_bpc_tools.py` |

Nur im kopierten `test_bpc_tools.py` den Importpfad `~/lcnc-suite-c2/lcnc-gateway` auf das isolierte `repo/lcnc-gateway` ändern. Alle 15 mitgelieferten Tests bestehen:

```sh
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m unittest discover -s /tmp/codex-r183-j66_w2sq/measurement-tools -p 'test_bpc_tools.py' -v
```

Eigene Sonde:

```sh
R183_PROBE_ROOT=/tmp/codex-r183-j66_w2sq nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python /home/cnc/lcnc-suite/docs/reviews/viewer-palette-fest.r183.codex-tools.py
```

Pfade auf die eigene `/tmp`-Wurzel anpassen. Die Sonde importiert Module, ruft **keine** `main()` auf und verbindet sich nicht. Nachrichteniterator, Uhr, Logs und Maschinenkommandos sind künstlich. Der Fake für `anchored_reset` zeichnet nur den ersten verlangten Befehl auf und wirft sofort `Stop`; nichts wird versandt. Der Trace-Leser erhält nur ein temporäres Verzeichnis.

Erwartet am Review-Kopf: 13 Testmethoden, davon sechs PASS und sieben FAIL; die zwei Stillstands-Unterfälle ergeben zusammen acht rote Assertions. Zusammen mit den vier Zeitproben: 17 Methoden, neun PASS, acht FAIL, neun rote Assertions. Die eigenen positiven Kontrollen bestätigen Hüllen-/Trip-Regeln, ursprüngliche Watchdog-/RSS-Korrekturen, normale S-/R-Schemafälle, Abweisung des alten S-Falls ohne Ersetzung und Lesen eines umbenannten Trace-Inodes. Ergebnisse stehen in `codex-tools-evidence.json` und `codex-tools-tests.txt`.

## Integrität

`codex-manifest.json` hält die vorhandenen Belege und den Plan mit SHA-256 fest. Das ursprüngliche Review ist nach dem Anhängen als unverändertes Bytepräfix geprüft. 563 Quell-/Test-/Instruktionsdateien und vier LFS-Objekte sind am Archiv gegen den Kopf verifiziert. Einzige Anpassung an einer verfolgten Archivdatei: der Mock-Endpunkt in `ctl.ts`. Eigene Sonden/Konfiguration und Build-Ausgaben existieren ausschließlich im Archiv und als neue Review-Belege. Keine alten Belege überschrieben.
