# R66 – Reproduktion und Prüfgrenzen (Codex, 2026-10-02)

Prüfstand: `git archive 9001850`, Branch `feat/viewer-marks`, Vergleich
`aa3bdb8..9001850`. Archiv unter `/tmp/codex-r66-zbzn8dd_`.
Live-Checkout: `63ec25b` auf `feat/keypad-keys`; Produktstände nicht
gleichsetzen. Dort nur der Review-Anhang und neue `r66.*`-Belege.

## Isolierter Aufbau

Im Archiv `lcnc-webui/node_modules` auf die installierten Dependencies
verknüpft. Ausschließlich in den kopierten `tsconfig*.json` die
`tsBuildInfoFile`-Pfade von `./node_modules/.tmp/` nach
`../r66-ts-cache/` umgeleitet. In der kopierten `e2e/ctl.ts` nur
`localhost:4174` durch `127.0.0.1:4188` ersetzt. Produktfunktionen unverändert.

Die beiliegenden Configs nach `lcnc-webui/r66.vitest.config.ts`,
`lcnc-webui/r66.probe.vitest.config.ts` und
`lcnc-webui/r66.playwright.config.ts` kopieren. Die eigene Probe liegt
unter `evidence/viewer-palette-fest.r66.probe.test.ts` neben `lcnc-webui`.
Alle folgenden Kommandos laufen im kopierten `lcnc-webui`:

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r66.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test \
  --config r66.playwright.config.ts \
  --grep 'the palette in four themes|the box edge alone|the box cells hang|an edge cut by|the toolpath box.s end marks|the three pins'
nice -n 19 node node_modules/vitest/vitest.mjs run --config r66.probe.vitest.config.ts
```

## Ergebnisse

- Typecheck und Produktionsbuild: **PASS**. Nur die bekannte Vite-Warnung
  zu Chunkgrößen über 500 kB.
- Vorhandene Unit-Tests: **169/169**, sechs Dateien (`geoDash`, `boxLines`,
  `toolpathController`, `fatPaths`, `themeTokens`, `viewerSection`).
- Vorhandene Browserprüfungen: **6/6**, ein Worker, eigener Mock auf
  `127.0.0.1:4188`, automatisch durch Playwright gestartet und beendet.
  Browserlauf nach automatischer Freigabe außerhalb der Sandbox;
  weiterhin nur Archiv und eigener Mock, keine Live-Ports.
- Eigene Gegenproben: **2/2 erwartungsgemäß rot am Prüfstand**:
  - Zwei Konturen mit gemeinsamem Verzweigungspunkt: reine Umkehr der
    Segment-Speicherreihenfolge vertauscht bei N=16 die Farbe an allen
    acht verglichenen Weltpunkten. `chains.json` enthält beide Zuordnungen.
  - Perspektivische Endmarken im sichtbaren Randbereich: alle 24 Balken
    vollständig im Viewport, geometrische Länge 10,619–11,948 CSS px
    statt 10 px. `tick-size.json` enthält projizierte Endpunkte.
    Gemessen wird zwischen den Geometrie-Endpunkten, ohne Rundkappen;
    die akzeptierte Breite 2/4 px erklärt diese Längenabweichung nicht.

Die Sonde ruft die unveränderten Produktfunktionen auf. Sie schreibt JSON
vor den Soll-Assertions; ihre roten Ergebnisse sind die Review-Befunde,
keine Infrastrukturfehler. Kein Fix im Produkt oder in der Sonde, um die
Assertions grün zu bekommen.

## Visuelle Belege

Die drei `claude-*.png` wurden aus dem vom Auftrag genannten
Renderverzeichnis unverändert übernommen; Herkunft und SHA-256 stehen in
`render-provenance.json`. Sie sind **Claudes Renderings**, keine eigenen
Screenshots. Ich habe Übersicht, Endmarken vor Modell und deckungsgleiche
Boxen visuell geprüft. Die eigene Browser-Nachprüfung des Endmarken-Tests
bestätigt zusätzlich seine Kontrast-Assertions in allen vier Themes vor
Hintergrund und Modell bei DPR 1.

Die Browserprüfungen messen außerdem die Boxlinien bei DPR 1/2, die
Weltverankerung in paralleler/perspektivischer Ansicht, Near-Clipping sowie
Cyan-Nadeln nach Themewechsel und Neuaufbau. Die offenen Gegenproben sind
gezielte Unit-/Projektionsprüfungen; keine Aussage, dass die Live-Maschine
diese Geometrien bereits gezeigt hätte.

Kein vollständiges Offline-Gate erneut ausgeführt, kein Backendlauf für
den reinen Frontend-Diff. Keine Maschinenbefehle, keine Zugriffe auf
`5173`/`8000`, keine Produktänderung im Live-Checkout, kein Commit.
Vorherige Belege unverändert; keine eigenen Server laufen weiter.
