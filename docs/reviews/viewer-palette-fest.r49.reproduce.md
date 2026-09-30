# R49 · Codex · isolierte Nachprüfung · 30. September 2026

Archiv von `a614c701799cf76ac0ecc60f1ed349c36146d737`, Bereich
`45661ab..a614c70`, Arbeitskopie `/tmp/codex-r49-qw4bi884`.
Im Live-Baum nur Review-Anhang und neue R49-Belege; keine Produktänderungen,
Builds, Tests, Checkouts, Zugriffe auf :5173/:8000, Maschinenbefehle oder
Trip-Quittierung. Beide eigenen Mock-Läufe beenden ihren Server im `finally`.

## Vorbereitung und bestehende Tests

Frische Archivkopie mit `git archive a614c70` erstellen. Installierte
`lcnc-webui/node_modules` verknüpfen; Vite/Vitest-Cache in der Kopie auf
`./.review-cache` und tsconfig-Buildinfo auf `./.review-tsbuildinfo/`
umleiten. `e2e/ctl.ts` auf `127.0.0.1:4188` richten. Die Kopie hat keine
Git-Metadaten; ihr Build meldet `__APP_COMMIT__: unknown`. Der geprüfte
Commit ist oben festgehalten, nicht im Mock ersetzt.

Im WebUI-Verzeichnis, vor dem Einfügen der zusätzlichen Review-Sonden:

```sh
nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b
nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner
nice -n 19 node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers 1 src/viewer/fatPaths.test.ts src/viewer/toolpathController.test.ts src/viewer/abRun.test.ts src/viewer/abHistogram.test.ts src/viewer/allocMeter.test.ts src/viewer/lineChunks.test.ts src/viewer/cameraFraming.test.ts src/viewer/boxLines.test.ts
```

Aus der Archivwurzel:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B -m pytest -q -p no:cacheprovider scripts/test_viewer_ab_report.py
```

**Typecheck/Build PASS, bestehende Viewer-Unit-Tests 124/124, Report-Tests
32/32.** Kein erneutes vollständiges Offline-Gate und keine Mac-Messung.

## Eigene Sonden

Die Belege als `evidence/<Belegname>` in der Archivkopie ablegen.

- `python3 -B evidence/viewer-palette-fest.r49.report-probe.py` und
  `python3 -B evidence/viewer-palette-fest.r49.report-rest-probe.py`:
  R48-Sonden, nur Dateinamen, Commit und Beschreibung geändert. Die
  JSON-Dateien enthalten die Ausgaben. Beide vollständigen Kontrollen PASS;
  fehlende Pflichtwerte INCOMPLETE, hohe Reveal-/Release-Peaks FAIL, die
  vollständigen 300/10/300-ms-Histogramme auch ohne Phasen-Maximum FAIL.
- `viewer-palette-fest.r49.controller-probe.ts` als
  `src/viewer/r49.probe.test.ts` ablegen; derselbe Vitest-Aufruf mit diesem
  Pfad. **1/1 PASS.** R48-Sonde angepasst: Der volle temporäre Index wurde
  entfernt, deshalb verlangt der 4096-Abschnitte-Fall nur noch mindestens
  4096 Byte Break-Maske in Allokation und Peak. Rebuild, Kapazität eines
  kleinen Views, Reveal-Wiederholung, tatsächliche Instanzen und Freigabe
  werden weiter geprüft. Änderungen stehen in `r49.probe-adaptations.patch`.
- `viewer-palette-fest.r49.ledger-probe.ts` als
  `src/viewer/r49.ledger-probe.test.ts` ablegen. Dazu ausschließlich in der
  Archivkopie `toolpathController.ts` nach `r49.instrumented-controller.ts`
  kopieren und die zwei Beobachtungsstellen aus
  `viewer-palette-fest.r49.ledger-observation.patch` übernehmen. Sie geben
  `sets` und die vom unveränderten Ledger gezählten Buffer-Identitäten heraus;
  sie ändern weder Berechnung noch Besitz/Freigabe der Produktobjekte.
  Vitest mit diesem Sondenpfad: **1/1 PASS als Fehlernachweis**. Die Sonde
  verlangt, dass wirklich gehaltene Vorbereitungsbuffer nicht in der Bilanz
  stehen. 100.000 nicht degenerierte, markierte Feed-Paare, eine LOD-Stufe,
  acht Chunks: GL lässt 256 Byte aus, fat 800.256 Byte. Die JSON-Datei zeigt
  Array-Namen, Kapazitäten und die ursprüngliche Bilanz. Nach `release()`
  sind die Sets leer, die Bilanz enthält nur noch die Programmlast.
  Es ist eine Prüfung erreichbarer Typed-Array-Buffer, keine Heap-Messung.

## Browser

`viewer-palette-fest.r49.browser-probe.ts` als `e2e/r49.viewer.spec.ts`,
`viewer-palette-fest.r49.playwright.config.ts` als
`playwright.r49.config.ts`, die Kamera-Konfiguration als
`playwright.r49-camera.config.ts` ablegen. Dann aus der Archivwurzel
nacheinander:

```sh
python3 evidence/viewer-palette-fest.r49.browser-run.py
python3 evidence/viewer-palette-fest.r49.camera-run.py
```

Eigener Mock auf `127.0.0.1:4188`, Chromium, ein Worker, `nice -n 19`.
**10/10 + 2/2 PASS**: vier originale A/B-Tests, eigene Befund-Sonde, fünf
Szenentests und zwei Framing-/Rastertests. Beim ersten Lauf war zusätzlich
ein Kamera-Projekt mit einem nicht passenden Pfadfilter konfiguriert; es
führte keinen Test aus. Die Kamera wurde deshalb anschließend separat mit
passendem Filter geprüft. Die beigefügten Konfigurationen enthalten genau
die tatsächlich gelaufenen Gruppen, die Logdateien und Zusammenfassungen
beide vollständigen Ergebnisse.

Die eigene Browser-Sonde ist die R48-Sonde mit korrigierter Erwartung:
vorher/nachher L14, Slider `182.001291915894`, Reveal 64 CPU-/32 GPU-Byte,
Rapid-Abschnitt sichtbar. Der End-Datensatz bestätigt `sim/pos/found: true`.
Die originalen Wächter prüfen vollständigen Lauf und Abbruch zusätzlich.
Telemetrie und Zustände sind unverändert gespeichert; `restored.sim` ist
ein Gleichheitsnachweis, nicht der absolute Simulationszustand.

Die vier PNG-Dateien sind unveränderte Attachments des Szenentests (zwei
Modellszenen, zwei Box-Szenen). Die Assertions messen Pfade mit 2 CSS px und
Boxkanten mit 1 CSS px bei DPR 1/2; die Kameratests prüfen 26 Richtungen,
Presets/Reset und Projektionswechsel sowie das gesamte Raster zwischen
Near/Far bei zwölf flachen Azimuten und vier Presets.
