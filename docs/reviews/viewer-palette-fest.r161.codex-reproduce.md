# Codex R161: Reproduktion

Stand `b413fcc8` aus `git archive` in `/tmp/codex-r161-mx42jwh_/repo`; Basis `95b729cd` in `/tmp/codex-r160-91mw_20g/repo`. Produktquellen unverändert. Lokale Kopie der vorhandenen node_modules; Produktions-Build vor dem Hinzufügen eigener Sonden: `nice -n 15 npm run build`.

## Gezielte Prüfungen

Beiliegende `viewer-palette-fest.r161.codex-vitest.config.ts` als `vitest.codex-r161.config.ts` ins UI-Verzeichnis kopieren. Frühere Sonden gemäß [R160-Reproduktion](viewer-palette-fest.r160.codex-reproduce.md) unverändert kopieren, einschließlich `codexR160Conflicts.test.ts` und `codexR160Navigation.test.ts`.

Im UI-Verzeichnis, Ausgabeordner vorher anlegen:

```sh
R158_OUT=/tmp/r161-out R159_OUT=/tmp/r161-out R160_OUT=/tmp/r161-out nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r161.config.ts src/viewer/codexR157Publisher.test.ts src/viewer/codexR157Bounds.test.ts src/viewer/codexR158Bounds.test.ts src/viewer/codexR158Memory.test.ts src/viewer/codexR158Queries.test.ts src/viewer/codexR159Tint.test.ts src/viewer/codexR159Bounds.test.ts src/viewer/codexR159Scratch.test.ts src/viewer/codexR160Conflicts.test.ts src/viewer/codexR160Navigation.test.ts src/viewer/contactPublisher.test.ts src/viewer/contactStore.test.ts src/viewer/steps.test.ts src/viewer/shownContacts.test.ts src/viewer/contactView.test.ts src/viewer/contactUnion.test.ts src/viewer/contactMeter.test.ts src/viewer/contactViewIndexed.test.ts src/viewer/contactViewUnion.test.ts src/viewer/contactViewBudget.test.ts src/viewer/simWindow.test.ts src/viewer/checkWiring.test.ts
```

223/223 PASS in 22 Dateien, 112,69 s. Die unveränderten R160-Sonden bestehen jetzt.

## Eigene zusätzliche Sonde

`viewer-palette-fest.r161.codex-edges.probe.test.ts` nach `src/viewer/codexR161Edges.test.ts` kopieren:

```sh
R161_OUT=/tmp/r161-out nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r161.config.ts src/viewer/codexR161Edges.test.ts
```

Erwartung: ein Test grün (2.500 Fälle gegen vollständige Aufzählung bestätigter Punkte; Konfliktanker und behaltene Proben), ein Test rot mit zwei `expect.soft`-Vertragsassertionen für die lokale Schlüsselsuche. Ausgaben `conflict-enumeration.json`, `search-windows.json`.

Die Kostenprobe liest den alten Schlüssel vor der Messung, prüft dessen Identität und misst denselben öffentlichen `findKey`-Aufruf nochmals. Gezählt werden Tabellenlesungen und der direkte Produktionszähler `viewWork`; keinerlei Zeitaufschlag. Kontrolle ohne zusätzlichen Freiraum bleibt begrenzt. Großer Freiraum einmal in anderem Paar, einmal später im selben Paar; alle Fälle `conflicts.count = 0`.

Dieselbe unveränderte Sonde und Konfiguration in der Basisarchivkopie, mit eigener Ausgabe und `-t 'unrelated kept wide'`: dieselben zwei roten Assertions und exakt gleiche Zugriffszahlen. Der Fehler ist bereits am Basisstand vorhanden.

## Browser

Nach dem Produktions-Build unveränderte Messspezifikationen aus docs/reviews kopieren:

- `viewer-palette-fest.r159.longtask.viewer.spec.ts` → `e2e/codex-r161-longtask.viewer.spec.ts`
- `viewer-palette-fest.r159.shapes.viewer.spec.ts` → `e2e/codex-r161-shapes.viewer.spec.ts`
- `viewer-palette-fest.r161.shapes-r160.viewer.spec.ts` → `e2e/codex-r161-conflict-shapes.viewer.spec.ts`

Beiliegende Playwright-Konfiguration als `playwright.codex-r161.config.ts`; ausschließlich in der Archivkopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen.

```sh
LT_OUT=/tmp/r161-out/browser-metrics.json nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r161.config.ts
```

Die Ausgabedatei darf davor noch nicht existieren (Sonden hängen an). Ein Chromium-Worker, Trace aus, kein LT_KEYS, keine parallele CPU-Prüfung. 8/8 Abläufe PASS in 58,1 s. Eigener Mock ausschließlich 127.0.0.1:4188; Sandbox-Bindeverbot durch freigegebene Ausführung außerhalb der Sandbox überwunden. Die Specs prüfen den Ablauf; lange Aufgaben separat aus den JSON-Daten ausgewertet. Der neue Rest-F-Fall wurde nicht in diesen Browserformen gemessen. Keine Live-Suite-/Maschinenzugriffe.

Das Manifest dokumentiert die Eingaben, Produktquellenprüfung gegen Git-Blobs und die neuen Belege. Nur an die vereinbarte Review-Datei angehängt, keine vorhandenen Belege geändert.
