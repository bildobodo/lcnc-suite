# R117 · Codex · Prüfaufbau

Stand `3dc563d3a94f9250a4f3afe9e1186f5c95ddccb0`, Diff `dac4ab1e..3dc563d3`, Korrekturen `bb95061a`/Merge `efa20863`. Archivkopie `/tmp/codex-r117-l2qvz9hs`. Im Live-Baum nur Review-Anhang und neue R117-Codex-Belege. Kein Zugriff auf :5173/:8000, HAL oder eine Steuerung.

## Ergebnis

- Build (`npm run build`): PASS; bestehende Vite-Warnung über große Chunks.
- Bestehende gezielte Backend-Tests: **19/19 PASS** (zehn Run-Basis-Tests aus `TestHandlerExecution`, neun `TestRunBinding`). Eigene Backend-Probe: PASS.
- Bestehende gezielte Frontend-Tests: **46/46 PASS**, `collisionMarks`, `checkBasis`, `collisionRange`, `collisionWorker`.
- Eigene Client-Proben: **4/4 PASS**.
- Browser: die **zwei neuen Repository-Wächter PASS**, dazu **eine eigene Detailhilfe-Probe PASS**, jeweils Chromium, ein Worker, eigener Mock auf `127.0.0.1:4188`, `nice -n 19`.
- Claudes vollständiges Gate und Mutationen wurden gelesen, nicht vollständig wiederholt. Kein Live-/Lastnachweis.

## Eigene Gegenproben

Die R116-Sonden wurden in neuen Dateien an den korrigierten Vertrag angepasst; die R116-Belege bleiben unverändert.

- Backend: echter `_cmd_blocking`/`_begin_run_basis`/`_run_for_pin` mit `fake_linuxcnc`. Verifizierter Start A, danach neuer Start mit fehlgeschlagenem Poll. Die erwartete alte Identität wurde in die neue, unverifizierte Identität umgekehrt. AUTO erreicht nur den Fake-Spy; B hat Kennung 2, Zustand `sent`, ohne Kontext/Start, `_run_for_pin` liefert nichts.
- Client: echte SFC-Ausdrücke mit dem TS-Parser extrahiert. Echter Bereichssweep erzeugt Grenzkontakte; der Emit-Ausdruck nutzt jetzt `collisionLineMarks`, und der Titel bewahrt die vorläufige Bedeutung. Die Zeilenverdichtung benutzt den echten Helfer.
- Echter Zeitabbruch eines Suffixes: Anzeige während des Vollsweeps bleibt bei Band `[0.5, 0.5]`, statt den ungeprüften Rest bis 1 einzufärben. Der Caveat nennt den ungeprüften Rest. Die neue `provisionalOnScreen`-Computed ist Teil der Auswertung.
- Fünf Eingabepaare bleiben in `boundaryDetail`, einschließlich umgekehrter Paarreihenfolge, Folgezeile L22 und Schneidhinweis.
- Echter Worker-Message-Handler und `runCollisionCheck`, kontrollierte Requests/Worker und Timer: Wiederholung vorläufig mit `gen=12`/`range.from=1`; danach Vollauftrag und seine Wiederholung mit demselben Prüfstand/Generation und `keepShown=true`. Das Ergebnis bleibt erhalten; Protokoll `full, done`. `shallowRef` bewahrt die Testobjekt-Identität. Die Browser-Wächter prüfen ergänzend die tatsächliche Vue-/Worker-Anbindung.

## Lange Detailhilfe

Eigene Browser-Probe verwendet die echte Anwendung und `HelpIcon`, ergänzt lediglich am Worker-Eingang 40 synthetische Grenzkontakte und hält das vollständige Ergebnis zurück. Alle 40 Namen sind vorhanden; keine seitliche Überbreite der Karte. Geprüft bei 1280×800/100 %, 900×1200/150 % und 1024×768/150 %:

- Karte jeweils innerhalb des Viewports.
- `overflow-y:auto`, tatsächlich mehr Inhalt als Kartenhöhe.
- Mausrad erreicht das Ende.
- Enter öffnet die Hilfe; Tab erreicht ihre Scrollfläche; Home und End erreichen beide Enden.
- JSON enthält Geometrie, Fokus, Text und Scrollposition. Bilder zeigen das erreichte Textende, nicht den Anfang. Das 1024×768-Bild wurde zusätzlich visuell geprüft. Keine Gesamt-Layout-Abnahme aus dieser gezielten Popover-Probe abgeleitet.

## Prüfaufbau und Fehlversuche

- Backend-Launcher wie R116: periodischer 20-ms-Selector-Weckruf wegen der dort beobachteten Sandbox-Warteprobleme. Keine Produktfunktion/Assertion ersetzt; ausdrücklich kein Latenznachweis.
- Der erste Browser-Start wurde vom Sandbox-Netzwerk mit `listen EPERM` abgewiesen. Der isolierte Lauf auf dem ausdrücklich vorgesehenen lokalen Mock-Port wurde anschließend mit Tool-Freigabe ausgeführt.
- Die erste eigene Langtext-Probe erwartete Kleinbuchstaben, der echte `partLabel`-Helfer schreibt den ersten Buchstaben groß. Nur diese Test-Erwartung korrigiert; danach PASS. Die beiden Repository-Browser-Wächter bestanden bereits in diesem Lauf.
- Die zunächst breiter ausgewählten Vitest-Läufe enthielten zusätzlich die langen Modell-/Orakelvergleiche in `sweepShards.test.ts` (eigener Test-Timeout dort 600 s). Sie lieferten innerhalb des begrenzten Prüfzeitraums keinen Abschluss und wurden abgebrochen bzw. endeten mit Timeout 124. Kein PASS für diese Versuche behauptet. Die abschließende Auswahl begrenzt sich auf die vier oben benannten Dateien; kein Fehler in den R117-Korrekturen daraus abgeleitet.
- Client-Proben zur Diagnose zeitweilig getrennt ausgeführt; abschließend die unveränderte veröffentlichte Sondenfassung gemeinsam 4/4 PASS. Die Diagnosefassung hatte nur zusätzliche Logmarken.

## Wiederholung

`git archive 3dc563d3` in eine neue Kopie entpacken. Node-Abhängigkeiten lesend bereitstellen; Caches (`.tmp`, `.cache`, `.vite`, `.vite-temp`) separat halten. Konfigurationen aus diesen Belegen nach `lcnc-webui/r117.vitest.config.ts` und `r117.playwright.config.ts` kopieren. Veröffentlichtes `client.test.ts` nach `src/viewer/r117.codex.test.ts` kopieren. Aus `lcnc-webui`:

```sh
npm run build
R117_EVIDENCE=/tmp/r117-evidence nice -n 19 node node_modules/vitest/vitest.mjs run --config r117.vitest.config.ts src/viewer/r117.codex.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r117.vitest.config.ts src/viewer/collisionMarks.test.ts src/viewer/checkBasis.test.ts src/viewer/collisionRange.test.ts src/viewer/collisionWorker.test.ts
```

Browser: nur in der Kopie die zwei `localhost:4174`-URLs in `e2e/ctl.ts` auf `127.0.0.1:4188` setzen, veröffentlichtes `long-help.spec-fragment.ts` an `e2e/collisions.viewer.spec.ts` anhängen. `../evidence` vorher anlegen; Port 4188 muss frei sein. Dann:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r117.playwright.config.ts --grep 'asks for the bodies|keeps its own limits|Codex R117:'
```

Backend: `backend-runner.py` und `backend-probe.py` nebeneinander unter diesen Kurznamen ablegen. Aus der Kopie `lcnc-gateway`, mit Gateway-Venv, eigenem `PYTHONPYCACHEPREFIX` und `PYTHONPATH=$PWD`:

```sh
nice -n 19 /path/to/gateway-venv/bin/python3 /tmp/r117-evidence/backend-runner.py unit
nice -n 19 /path/to/gateway-venv/bin/python3 /tmp/r117-evidence/backend-runner.py probe /tmp/r117-evidence/backend-probe.json
```
