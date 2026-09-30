# R47 · Codex · isolierte Implementierungsprüfung · 30. September 2026

Stand `43943e46f24240848e60ba011b4a8271b1c72f50`, Bereich
`d540442..43943e4`, Archivkopie `/tmp/codex-r47-s0oaw6vh`.
Keine Produktänderung oder Tests im Live-Baum, keine Zugriffe auf
`:5173`/`:8000`, keine LinuxCNC-/HAL-Verbindung oder Maschinenbefehle.
Eigener Mock auf `127.0.0.1:4188`, ein Browserworker, `nice -n 19`.

## Aufbau und Originalprüfungen

`git archive 43943e4` in eine temporäre Arbeitskopie entpacken.
`lcnc-webui/node_modules` auf die installierten Abhängigkeiten verweisen;
Vite/Vitest `cacheDir` in der Kopie auf `./.review-cache`,
tsconfig-Buildinfo von `./node_modules/.tmp/` auf `./.review-tsbuildinfo/`
umstellen. `e2e/ctl.ts` auf `127.0.0.1:4188` richten.
Nur Prüfkonfiguration und Caches werden geändert. Im Archiv fehlen Git-
Metadaten; Vite meldet dies und setzt `__APP_COMMIT__` auf `unknown`.
Der geprüfte Commit wird deshalb hier angegeben, nicht im Mock gefälscht.

Im WebUI-Verzeichnis:

```sh
nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b
nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner
nice -n 19 node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers 1 src/viewer/fatPaths.test.ts src/viewer/toolpathController.test.ts src/viewer/backplotController.test.ts src/viewer/boxLines.test.ts src/viewer/abRun.test.ts src/viewer/abHistogram.test.ts
```

Aus der Archivwurzel, mit den installierten Python-Testabhängigkeiten:

```sh
/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B -m pytest -q -p no:cacheprovider scripts/test_viewer_ab_report.py
```

Typecheck und Build PASS; **87/87 Viewer-Unit-Tests**, **14/14 Report-Tests**.
Kein vollständiges Offline-Gate, keine Backend-Produktprüfung nötig: der
R47-Bereich ändert keinen Gateway-Produktcode.

Die originale Browserauswahl umfasst `abrun.viewer.spec.ts`,
`fatpaths.viewer.spec.ts` und `scenes.viewer.spec.ts`: **7/7 PASS**.
[Protokoll](viewer-palette-fest.r47.browser-tests.txt),
[kompakte Ergebnisse](viewer-palette-fest.r47.browser-summary.json).
Playwright-Konfiguration: `testDir: './e2e'`, passende `testMatch`-Regex,
`workers: 1`, `fullyParallel: false`, Timeout 60 s, Expect-Timeout 10 s,
Chromium headless, Locale `en-GB`, Zeitzone `UTC`, DPR 1,
`launchOptions.ignoreDefaultArgs: ['--hide-scrollbars']`,
BaseURL `http://127.0.0.1:4188`; kein automatischer Live-/Preview-Server.
Die Specs setzen DPR 2 selbst, wo benötigt.

[Browser-Startskript](viewer-palette-fest.r47.browser-run.py) hält den Mock
und Playwright in einem Prozessverbund und beendet den Mock im `finally`.
Als `evidence/viewer-palette-fest.r47.browser-run.py` ablegen, die
[Konfiguration](viewer-palette-fest.r47.playwright.config.ts) als
`lcnc-webui/playwright.r47.config.ts` ablegen und aus der Archivwurzel
aufrufen. Mock-Protokolle stehen ebenfalls bei den R47-Belegen.

## Eigene Gegenproben

Alle Proben und Ergebnisse stammen aus unverändertem Produktcode. Die
Test-Assertions bestätigen die dokumentierten Beobachtungen; ein grüner
Probenlauf bedeutet hier nicht, dass die beobachteten Fehler behoben sind.

1. [Report-Probe](viewer-palette-fest.r47.report-probe.py) als
   `evidence/viewer-palette-fest.r47.report-probe.py` ablegen, aus Archivwurzel
   `python3 -B evidence/viewer-palette-fest.r47.report-probe.py` ausführen.
   Sie verwendet die Fixture des originalen Report-Tests und `analyse()`
   aus dem Original, mit vollständiger Kontrollgruppe und benannten
   Einzeländerungen. Kein Zugriff auf echte Trace-Dateien.
   [Ergebnis](viewer-palette-fest.r47.report-probe.json): falsches PASS bei
   fehlenden Messpunkten/Wiederholungen, 1.500-ms-Aufbaublockade und ungleichen
   Stichproben; TypeError bei fehlendem `mt`-Histogramm. Das 1.500-ms-Beispiel
   hat einen entsprechend längeren 1.600-ms-Aufbauzeitraum.
2. [Controller-Probe](viewer-palette-fest.r47.controller-probe.ts) nach
   `lcnc-webui/src/viewer/r47.test.ts` kopieren, denselben Vitest-Aufruf
   mit diesem Dateinamen ausführen. Die Helfer `program()`/`build()` stammen
   aus `fatPaths.test.ts`; die Beobachtungen sind eigene. Prüft Objektidentität
   über ABBAAB, wiederholte gleich große Reveal-Geometrie, eine gültige
   12-Byte-Ansicht in einem gehaltenen 1-MiB-Puffer und einen degenerierten
   Pfadabschnitt. [Ergebnis](viewer-palette-fest.r47.controller-probe.json),
   [Protokoll](viewer-palette-fest.r47.controller-probe.txt).
3. [Browser-Probe](viewer-palette-fest.r47.browser-probe.ts) nach
   `lcnc-webui/e2e/r47.viewer.spec.ts` kopieren. Dieselbe Konfiguration mit
   `testMatch: /r47\.viewer\.spec\.ts/` unter `playwright.r47probe.config.ts`;
   [Konfiguration](viewer-palette-fest.r47.playwright-probe.config.ts),
   [Startskript](viewer-palette-fest.r47.browser-probe-run.py).
   Kleine Mock-Vorschau, drei Befundziele L4/L7/L14, Vorschau-Simulation
   vorher aktiv, Position manuell bei 13 % der Strecke. Sechs vollständige
   Wiederholungen, verkürzte Haltezeiten, ein Sprung je Navigationsphase;
   keine Produktinstrumentierung. **1/1 PASS**: 42 Phasen, 12 Sprünge,
   wechselnde Zielpaare je Wiederholung und veränderte Endposition.
   [Ergebnis](viewer-palette-fest.r47.browser-probe.json),
   [Telemetrie](viewer-palette-fest.r47.browser-telemetry.json),
   [Protokoll](viewer-palette-fest.r47.browser-probe.txt).

Der erste Versuch der eigenen Browserprobe endete vor dem A/B-Lauf wegen
meines mehrdeutigen Selektors `input[type=range]` (Position und Tempo).
Er wurde auf `input.rangeOverlayTrack` eingeschränkt. Kein Produktfehler;
[Setup-Protokoll](viewer-palette-fest.r47.browser-probe-setup.txt) erhalten.
Die sieben Original-Browserprüfungen liefen davor in einem grünen Gesamtlauf.

## Grenzen

Die kleinen Mock-Szenen prüfen Darstellung und Ablauf, keine Mac-Leistung.
Kein Nachweis für das 128-MiB-Budget großer CAM-Dateien; gerade dessen
Bilanzierung und Bewertung werden beanstandet. Originalwächter für Breite
bei DPR 1/2 und Near-Plane-Clipping bestanden. Seitenrand-Culling wurde in
dieser Runde nicht zusätzlich als Browser-Rasterprobe erweitert.
Eigene Mock-Prozesse sind beendet; Live-Sim und unquittierter Trip unverändert.
