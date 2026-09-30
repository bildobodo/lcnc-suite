# R42 · Nachprüfung MR-I04 · 2026-09-30

Geprüft: `78f4348..b6fd7c5`, Archiv von `b6fd7c5` unter
`/tmp/codex-r42-ywywptyc`. Keine Produktänderung. Die Live-Sim, ihre Ports
`:5173`/`:8000` und ihr E-Stop-Zustand wurden nicht angesprochen.

## Isolierung und Reproduktion

1. `git archive b6fd7c5` in ein neues Verzeichnis unter `/tmp` entpacken.
   Den vorhandenen `lcnc-webui/node_modules`-Baum nur als Abhängigkeiten
   verlinken. In der Archivkopie die `tsBuildInfoFile`-Pfade aus
   `./node_modules/.tmp/` nach `./.review-tsbuildinfo/` umleiten; Vite und
   Vitest erhalten `cacheDir: "./.review-cache"`. Vite mit
   `--configLoader runner` ausführen, damit Konfigurations-Caches ebenfalls
   nicht in die verlinkten Abhängigkeiten geschrieben werden.
2. `evidence/` im Archiv anlegen; die Pipeline-Sonde dorthin kopieren:
   `nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B
   evidence/midrun-tool-reparse.r42.pipeline-probe.py "$PWD" >
   evidence/midrun-tool-reparse.r42.pipeline-probe.json` (eine Shell-Zeile).
3. In `lcnc-webui` nacheinander bauen:
   `nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b` und
   `nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner`.
   Das zugehörige Buildprotokoll liegt bei.
4. Browser-Sonde nach `lcnc-webui/e2e/r42.spec.ts`, beiliegende
   Playwright-Konfiguration nach `lcnc-webui/playwright.r42.config.ts`
   kopieren. In `e2e/ctl.ts` die Mock-Adressen auf `127.0.0.1:4188` setzen.
5. Ausschließlich den eigenen Mock starten:
   `env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs`.
   Danach `nice -n 19 node node_modules/@playwright/test/cli.js test
   --config playwright.r42.config.ts e2e/r42.spec.ts` (eine Shell-Zeile).
   Erwartet am geprüften Stand: **1 Test rot**, drei Schlussassertionen
   melden jeweils `tableWarningCount: 0` statt `1`.
6. Mock danach beenden. Bei dieser Prüfung wurden Mock und Browser beendet.

## Ergebnisse und Grenzen

- Backend: `python -B -m unittest test_bulk_pipeline test_gateway_util
  test_ws_fanout` im Archiv, `LCNC_LOG_DIR` ebenfalls unter `/tmp`,
  **433 PASS**. Testbedingte ResourceWarnings, keine Fehler.
- Vitest: `src/ws/statusStore.test.ts`, `src/lcncWs.exports.test.ts`,
  `--configLoader runner --maxWorkers 1`: **35 PASS**.
- `vue-tsc -b` + Vite-Build: **PASS**, übliche Chunkgrößenwarnung.
- Pipeline-Sonde: echte Pipeline, Driftentscheidung und Status-Umschläge,
  **alle Assertions PASS**. Der Parse-Worker ist ein Stub: Exitcode 4,
  fehlgeschlagener Idle-Parse und erfolgreiche Veröffentlichung sind
  gezielt simuliert. Kein nativer LinuxCNC-Lauf in dieser Runde.
- Browser: ein Chromium-Worker, XYZ, Light-Theme, 1600 × 1000,
  produktiver Archiv-Build und eigene Mock-Daten. Die Pipeline-Umschläge
  werden als Status-Deltas eingespeist, damit die unabhängigen
  Maschinenwerte der Browser-Fixture erhalten bleiben. Kein Zugriff auf
  einen laufenden Gateway; nur Mock-Verbindungen.
- `client.json` hält Farben, Kartenzahl und Warntexte jeder Phase fest.
  Dieselbe Tabellenmarke mit `rotation_xy: 1` öffnet die Karte und zeigt
  die Erklärung; ohne diesen fremden Hinweis fehlen Karte und Erklärung.
  Beide `why`-Werte sind betroffen. Die Pfaddämpfung funktioniert.
- Kein vollständiges Offline-Gate; der von Claude benannte fluktuierende
  Boxkanten-Pixeltest wurde nicht erneut ausgeführt.
