# R48 · Codex · isolierte Nachprüfung · 30. September 2026

Archiv von `8624ade61d378dd601511905f835f39a489bef8c`, Bereich
`a353236..8624ade`, Arbeitskopie `/tmp/codex-r48-p_ixwviq`.
Im Live-Baum nur Review-Anhang und neue R48-Belege; keine Builds, Tests,
Produktänderungen, Zugriffe auf :5173/:8000, LinuxCNC-/HAL-Verbindung,
Maschinenbefehle oder Trip-Quittierung.

## Reproduktion

Frische Archivkopie mit `git archive 8624ade` erstellen. Installierte
`lcnc-webui/node_modules` verknüpfen; Vite/Vitest-Cache in der Kopie auf
`./.review-cache` und tsconfig-Buildinfo auf `./.review-tsbuildinfo/`
umleiten. `e2e/ctl.ts` auf `127.0.0.1:4188` richten. Die Kopie hat keine
Git-Metadaten; ihr Build meldet `__APP_COMMIT__: unknown`. Der geprüfte
Commit ist oben festgehalten, nicht im Mock ersetzt.

Im WebUI-Verzeichnis:

```sh
nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b
nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner
nice -n 19 node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers 1 src/viewer/fatPaths.test.ts src/viewer/toolpathController.test.ts src/viewer/abRun.test.ts src/viewer/abHistogram.test.ts
```

Aus der Archivwurzel:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B -m pytest -q -p no:cacheprovider scripts/test_viewer_ab_report.py
```

**Typecheck/Build PASS, Viewer-Unit-Tests 74/74, Report-Tests 23/23.**
Kein vollständiges Offline-Gate; keine Gateway-Produktänderung im Bereich.

## Eigene Gegenproben

Die Dateien als `evidence/<Belegname>` in der Archivkopie ablegen.

- [R47-Reportprobe am neuen Stand](viewer-palette-fest.r48.report-probe.py):
  `python3 -B evidence/viewer-palette-fest.r48.report-probe.py`.
  Identische Eingriffe wie R47, jetzt auf der aktualisierten Original-Fixture
  (mit Kalibrierung, Freigabe, Generation und Peak). Nur Commit-/Dateinamen
  im Probeskript geändert. [Ergebnis](viewer-palette-fest.r48.report-probe.json):
  alle ursprünglichen Gegenbeispiele werden korrekt abgewiesen.
- [Weitere Pflichtwerte](viewer-palette-fest.r48.report-rest-probe.py), ebenso
  ausführen. Original-`analyse()`, keine Produktänderung. Vollständige
  Kontrollgruppe PASS; ohne Peaks ebenfalls PASS; ohne `gpu.total` KeyError;
  B-Reveal-Peak 512 MiB PASS. Die weitere Kontrollgruppe hat echte
  Hauptthread-Maxima B `[300,10,300]` ms und A jeweils 110 ms: FAIL.
  Entfernt man nur eines der 300-ms-Maxima aus der Phasen-Zusammenfassung,
  bleiben die Histogramme vollständig, aber das Ergebnis wird PASS.
  [Ergebnis](viewer-palette-fest.r48.report-rest-probe.json).
- [Controller-Probe](viewer-palette-fest.r48.controller-probe.ts) als
  `lcnc-webui/src/viewer/r48.test.ts`, derselbe Vitest-Aufruf mit diesem Pfad.
  R47-Probe an die neue Rebuild-/Bilanzschnittstelle angepasst:
  alle sechs Aufbauten ersetzen Geometrie, volle Pufferkapazität, gehaltene
  Bytes und kumulierte Allokation getrennt, `pairs.drawn`, `release()`.
  [Anpassungen gegenüber R47](viewer-palette-fest.r48.probe-adaptations.patch).
  Die alten Belegdateien bleiben unverändert.

Die Controller-Probe ergänzt einen kleinen Fall mit **4.096 einzelnen
Abschnitten**, also ohne verbindende Segmente. Gehaltene Programmpuffer:
65.536 Byte. `buildFrameIndex()` erzeugt trotzdem `isBreak` (4.096 Byte)
und die ursprüngliche `table` (32.760 Byte); im Schleifenrumpf werden beide
benötigt. Diese **36.856 Byte** sind eine direkt aus den Kapazitäten
abgeleitete Mindestmenge gleichzeitig benötigter temporärer Puffer, keine
Heap-Profiler-Messung. Der Controller meldet `allocated`-Differenz **0**
und `peak` **65.536**, obwohl schon Programmpuffer plus diese zwei Arrays
**102.392 Byte** ergeben. Dieser Fall isoliert die fehlende Erfassung;
er soll keine typische CAM-Datei oder eine Budgetüberschreitung darstellen.
[Ergebnis](viewer-palette-fest.r48.controller-probe.json),
[Protokoll](viewer-palette-fest.r48.controller-probe.txt).

## Browser

[Konfiguration](viewer-palette-fest.r48.playwright.config.ts) als
`lcnc-webui/playwright.r48.config.ts`,
[Startskript](viewer-palette-fest.r48.browser-run.py) unter `evidence/`.
Es startet ausschließlich den archivierten Mock auf `127.0.0.1:4188`,
führt Playwright mit einem Worker aus und beendet den Mock im `finally`.
`nice -n 19`, Chromium headless, DPR 1, en-GB/UTC.
Die [eigene Spec](viewer-palette-fest.r48.browser-probe.ts) unter
`lcnc-webui/e2e/r48.viewer.spec.ts` ablegen.

Zwei Originalfälle aus `abrun.viewer.spec.ts` und die eigene Probe:
**3/3 PASS** in einem Gesamtlauf. Der erste eigene Lauf protokollierte die
Befundansicht vor/nachher. Danach nur Beobachtungen für Werkzeugspitze und
Kalibrierphase ergänzt; mit [separater Konfiguration](viewer-palette-fest.r48.playwright-probe.config.ts)
als `playwright.r48probe.config.ts` und
[Startskript](viewer-palette-fest.r48.browser-probe-run.py) die eigene Probe
erneut ausgeführt: **1/1 PASS**.
[Gesamtlauf](viewer-palette-fest.r48.browser-tests.txt),
[ergänzte Probe](viewer-palette-fest.r48.browser-probe.txt),
[kompakte Ergebnisübersicht](viewer-palette-fest.r48.browser-summary.json).

Die eigene Probe beginnt bei ausgewähltem L14-Befund und ausgeblendeten
Rapids, führt alle 49 Phasen inklusive Kalibrierung aus und prüft ausdrücklich
den beobachteten Restfehler: Reveal verschwindet, Anzeige wird L12.
Ihre grünen Assertions bedeuten **reproduzierter Befund**, keine Behebung.
[Zustände](viewer-palette-fest.r48.browser-probe.json),
[Rohtelemetrie](viewer-palette-fest.r48.browser-telemetry.json).
Das Zahlenfeld der Timeline bleibt gleich. `getToolTip` liefert in dieser
Fixture vor/nachher `[0,0,0]` und dient nicht als Nachweis einer Poseänderung.
Die Kalibrierproben sehen keinen Rapid-Pfad; daraus entsteht kein zusätzlicher
Kalibrierbefund. Die Beanstandung betrifft die verlorene Befundansicht.

## Grenzen

Kleine Mock-Szenen prüfen Ablauf und Zustandsrückgabe; keine Mac-Leistungs-
oder große CAM-Speichermessung. Kein neues Raster-/Near-Plane-Gate: der
Zeichenweg wurde gegenüber R47 nicht geändert. Alle eigenen Mock-Prozesse
sind beendet; Live-Sim und unquittierter Trip unverändert.
