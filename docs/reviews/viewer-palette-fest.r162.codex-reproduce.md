# Codex R162: Reproduktion

Prüfstand `668b39f5`, `git archive` nach `/tmp/codex-r162-206v0cgx/repo`. Lokale Kopie vorhandener node_modules. Vor dem Hinzufügen eigener Prüfdateien: `nice -n 15 npm run build` (PASS). Keine Produktquelldatei verändert.

## Gezielter Lauf

Konfiguration `viewer-palette-fest.r162.codex-vitest.config.ts` als `vitest.codex-r162.config.ts` ins UI-Verzeichnis. Die zehn früheren Sonden gemäß [R161-Reproduktion](viewer-palette-fest.r161.codex-reproduce.md) unverändert kopieren, zusätzlich `viewer-palette-fest.r161.codex-edges.probe.test.ts` nach `src/viewer/codexR161Edges.test.ts`.

Im UI-Verzeichnis; Ausgabeordner vorher anlegen:

```sh
R158_OUT=/tmp/r162-out R159_OUT=/tmp/r162-out R160_OUT=/tmp/r162-out R161_OUT=/tmp/r162-out nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r162.config.ts src/viewer/codexR157Publisher.test.ts src/viewer/codexR157Bounds.test.ts src/viewer/codexR158Bounds.test.ts src/viewer/codexR158Memory.test.ts src/viewer/codexR158Queries.test.ts src/viewer/codexR159Tint.test.ts src/viewer/codexR159Bounds.test.ts src/viewer/codexR159Scratch.test.ts src/viewer/codexR160Conflicts.test.ts src/viewer/codexR160Navigation.test.ts src/viewer/codexR161Edges.test.ts src/viewer/contactPublisher.test.ts src/viewer/contactStore.test.ts src/viewer/steps.test.ts src/viewer/shownContacts.test.ts src/viewer/contactView.test.ts src/viewer/contactUnion.test.ts src/viewer/contactMeter.test.ts src/viewer/contactViewIndexed.test.ts src/viewer/contactViewUnion.test.ts src/viewer/contactViewBudget.test.ts src/viewer/simWindow.test.ts src/viewer/checkWiring.test.ts
```

233/233 PASS in 23 Dateien, 121,70 s. Enthält den neuen Inline-Wächter und dessen Gegenstück mit fortschreitender Uhr sowie die unveränderten R161-Such- und Aufzählungsproben.

## Rundungsprobe

`viewer-palette-fest.r162.codex-roundoff.probe.test.ts` nach `src/viewer/codexR162Roundoff.test.ts` kopieren:

```sh
R162_OUT=/tmp/r162-out nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r162.config.ts src/viewer/codexR162Roundoff.test.ts
```

Erwartung: eine rote Assertion bei der Dezimalvariante; Kontrolle ohne drittes Paar und Vergleich mit exakt binären Werten bleiben grün. JSON `roundoff.json` enthält Kosten, Schlüssel und die nur gelesenen Diagnoseflags sowie gespeicherten Radius und berechnete Grenzen. Alle Fälle verlangen null Konflikte und unveränderte Schlüsselidentität. Die Sonde zählt nur Zugriffe in der öffentlichen wiederholten Schlüsselsuche, keine künstlichen Wartezeiten.

## Browsermessung

Nach dem Produktions-Build unveränderte Messspezifikationen kopieren:

- `viewer-palette-fest.r159.longtask.viewer.spec.ts` → `e2e/codex-r162-longtask.viewer.spec.ts`
- `viewer-palette-fest.r159.shapes.viewer.spec.ts` → `e2e/codex-r162-shapes.viewer.spec.ts`
- `viewer-palette-fest.r162.shapes-r160.viewer.spec.ts` → `e2e/codex-r162-conflict-shapes.viewer.spec.ts`

Beiliegende `playwright.config.ts` als `playwright.codex-r162.config.ts`, `playwright-guards.config.ts` als `playwright.codex-r162-guards.config.ts`. Nur in der Archivkopie `localhost:4174` in `e2e/ctl.ts` auf `127.0.0.1:4188` ändern.

```sh
LT_OUT=/tmp/r162-out/browser-metrics.json nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r162.config.ts
nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r162-guards.config.ts --grep 'setup reads nothing|a preview published in the run names|the check basis card says|bound beginning: its contact reaches'
```

Ausgabe der Messung vorher noch nicht vorhanden (Specs hängen an). Ein Chromium-Worker, Trace aus, kein LT_KEYS, kein paralleler CPU-Lauf. Sandbox-Bindeverbot erforderte freigegebene Ausführung außerhalb der Sandbox, ausschließlich eigener Mock auf 127.0.0.1:4188. 9/9 Messabläufe PASS, anschließend 4/4 ausgewählte Bestandswächter PASS in 23,4 s. Der Prüfgrundlagen-Wächter prüft Escape gegen den Mock; keine reale Steuerung verwendet. Messspezifikationen behaupten keine allgemeine Fehlerfreiheit der Konsole; der separate Ladewächter prüft ReferenceError ausdrücklich. Lange Aufgaben separat ausgewertet. Die Rundungsform wurde nur in Node geprüft.

Git-Blob-Prüfung: 378 Produktquelldateien und die zwei unveränderten Browser-Wächterdateien am Prüfstand. Manifest mit Eingabehashes, Anhang und neuen Belegen; frühere Belege unverändert. Keine Builds oder Tests im Live-Baum.
