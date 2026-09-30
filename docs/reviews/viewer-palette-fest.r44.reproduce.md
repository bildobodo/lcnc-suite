# R44 · Prüfung und Reproduktion · 2026-09-30

Stand `f82c323`, Archiv `/tmp/codex-r44-eq2f3y85`.
Geprüft wurden Teil A (`ee28e66`, `4bb4ff1`, `ee05e20`, `87ff644`) und
Sim-Werkzeugmesser/Marker (`b4ac6fc`, `7aad422`). Teil B ist ausgeschlossen.

## Isolation

`git archive f82c323` unter `/tmp` entpackt; vorhandene `node_modules` nur
als Abhängigkeiten verlinkt. In den Archiv-`tsconfig*.json` wurden
`./node_modules/.tmp/`-Pfade nach `./.review-tsbuildinfo/` umgeleitet;
Vite/Vitest bekamen `cacheDir: "./.review-cache"`. Build und Tests mit
`nice -n 19`, Browser seriell mit einem Worker. Eigener Mock:
`env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs`.
`e2e/ctl.ts` nur im Archiv auf `127.0.0.1:4188` umgestellt.
Kein Zugriff auf Live-Sim, `:5173` oder `:8000`, kein LinuxCNC-/HAL-Aufruf.
Eigener Mock und Browser nach der Prüfung beendet.

## Läufe

In `lcnc-webui`, nacheinander:

- `nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b`
- `nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner`
- `nice -n 19 node node_modules/vitest/vitest.mjs run src/themeTokens.test.ts src/viewer/palette.test.ts src/viewer/boxLines.test.ts src/viewer/customContrast.test.ts src/viewer/toolpathController.test.ts src/viewer/toolsetterMarker.test.ts src/viewerSection.test.ts --configLoader runner --maxWorkers 1`

Build/Typecheck **PASS**, sieben Testdateien, **111 Tests PASS**.

Beiliegende Playwright-Konfiguration ins WebUI-Archiv kopieren. Die eigenen
Browser-Probe nach `e2e/r44.spec.ts` kopieren, `evidence/` neben `lcnc-webui`
anlegen. Mit `nice -n 19 node node_modules/@playwright/test/cli.js test
--config playwright.r44.config.ts ...` (eine Shell-Zeile) liefen:

1. `scenes.viewer.spec.ts toolsetter.viewer.spec.ts`: **2 PASS / 2 FAIL**.
   Boxkante an DPR 1/2 und Marker bestanden; zwei Szenen griffen während
   eines neuen Modellaufbaus auf noch fehlende Diagnosefunktionen zu.
2. Archivkopie der Szenen um Bereitschaftswarten ergänzt:
   `--grep 'the palette in four|the width ladder'`: Palette **PASS**;
   die Breitenprüfung hatte noch vor dem Warten ihre Backplot-Punkte geschickt.
3. Warten vor diese Bewegung gesetzt, `--grep 'the width ladder'`:
   Breitenmessungen DPR 1 in allen vier Themes bestanden; danach roter
   Farbklassifikator auf der Halbmischung aus Limit und Backplot.
4. `r44.spec.ts`: **PASS**. Echtes ausgeliefertes XYZAC-Modell, vier Themes,
   beide Reichweiten, Marker an Kontaktposition, G43/G49-Kontrolle bei
   unveränderten Gelenken und unveränderter Tabellenlänge, keine Page-Errors.

Alle Änderungen des Szenentests stehen in `scene-wait.patch`; Produktcode
blieb auch im Archiv unverändert. Originale Assertions wurden nicht geändert.
Die Texte der Läufe und eine Zusammenfassung ihrer JSON-Berichte sind
abgelegt. Die großen Rohberichte mit eingebetteten Testbildern bleiben im
Archiv; eigene relevante Bilder liegen als neue Review-Belege vor.
Kein vollständiges Offline-Gate; die Breitenprüfung ist nicht als grün gewertet.

## Strichlänge

`viewer-palette-fest.r44.dashes.test.ts` nach
`lcnc-webui/src/viewer/r44.probe.test.ts` kopieren und mit demselben
Vitest-Aufruf gezielt ausführen. Die Sonde nutzt den produktiven
`makeBoxEdges`-Helper und seinen Render-Hook; sie projiziert einen Abstand in der Material-Strichlänge
an der Mitte einer X-, Y- und Z-Kante einer 500 × 400 × 310-Box.
800 × 600 CSS px, Orthokamera und Perspektivkamera, Blickrichtungen
`[1,2,0.7]` und `[1,0.12,0.25]`. Ergebnis: `dashes.json`.
Das ist eine geometrische Projektionsmessung, keine weitere Pixelmessung.
Der Vitest-Lauf schreibt Daten; er ist kein bestandener Vertragswächter.

Die Sim-Prüfung ist in `sim-toolsetter.r44.evidence.md` beschrieben.
