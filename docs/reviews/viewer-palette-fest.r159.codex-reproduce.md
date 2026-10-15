# Codex R159: Reproduktion

Produktstand `ac050872` aus `git archive`, Arbeitskopie `/tmp/codex-r159-_y__3tra/repo`. Basisvergleich in der vorhandenen Archivkopie von `3ada110a` (`/tmp/codex-r158-af75xrww/repo`). Vorhandene `node_modules` in die Kopie übernommen, keine Produktänderung. Alle Läufe `nice -n 15`, Browser allein und nur mit eigenem Mock.

## Build vor dem Hinzufügen der Review-Sonden

Im `lcnc-webui` der Archivkopie `nice -n 15 npm run build`. Die eigenen Node-Sonden und externen Browser-Messspezifikationen sind keine Produktdateien und gehören nicht in diesen TypeScript-Build: Im tatsächlich ausgeführten sauberen Build waren sie aus `src/viewer` beziehungsweise `e2e` ausgelagert. Der erste Versuch mit diesen zusätzlichen Dateien scheiterte an deren Node-Typen bzw. einem unbenutzten Messskript-Namen, nicht an eingechecktem Produktcode. Danach bestand der saubere Build.

## Gezielte Nachprüfung

`viewer-palette-fest.r159.codex-vitest.config.ts` als `vitest.codex-r159.config.ts` ins UI-Verzeichnis kopieren. Die unveränderten früheren Proben in die Kopie legen:

| Beleg in `docs/reviews/` | Ziel unter `lcnc-webui/src/viewer/` |
|---|---|
| `viewer-palette-fest.r158.codex-publisher.probe.test.ts` | `codexR157Publisher.test.ts` |
| `viewer-palette-fest.r158.codex-component.probe.test.ts` | `codexR157Bounds.test.ts` |
| `viewer-palette-fest.r158.codex-bands.probe.test.ts` | `codexR158Bounds.test.ts` |
| `viewer-palette-fest.r158.codex-memory.probe.test.ts` | `codexR158Memory.test.ts` |
| `viewer-palette-fest.r158.codex-sweep.probe.test.ts` | `codexR158Queries.test.ts` |

Im UI-Verzeichnis:

```sh
mkdir -p /tmp/codex-r159-repro
R158_OUT=/tmp/codex-r159-repro nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r159.config.ts src/viewer/codexR157Publisher.test.ts src/viewer/codexR157Bounds.test.ts src/viewer/codexR158Bounds.test.ts src/viewer/codexR158Memory.test.ts src/viewer/codexR158Queries.test.ts src/viewer/contactPublisher.test.ts src/viewer/contactStore.test.ts src/viewer/steps.test.ts src/viewer/shownContacts.test.ts src/viewer/contactView.test.ts src/viewer/contactUnion.test.ts src/viewer/contactMeter.test.ts src/viewer/contactViewIndexed.test.ts src/viewer/contactViewUnion.test.ts src/viewer/contactViewBudget.test.ts src/viewer/simWindow.test.ts src/viewer/checkWiring.test.ts
```

**194/194 PASS** in 17 Dateien, zehn eigene frühere Prüfungen und 184 Bestandstests. Der Blockindex-/Union-Gleichheitstest und die vollständigen Ableitungsbudgetformen sind enthalten. Kein vollständiges Gate erneut ausgeführt. Die geschriebenen Dateien `memory.json` und `query.json` wurden als `codex-memory.json` und `codex-sweep.json` gesichert.

## Neue Proben

`viewer-palette-fest.r159.codex-tint.probe.test.ts`, `.codex-bounds.probe.test.ts` und `.codex-scratch.probe.test.ts` nach `src/viewer/codexR159Tint.test.ts`, `codexR159Bounds.test.ts` und `codexR159Scratch.test.ts` kopieren.

```sh
R159_OUT=/tmp/codex-r159-repro nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r159.config.ts src/viewer/codexR159Tint.test.ts src/viewer/codexR159Bounds.test.ts src/viewer/codexR159Scratch.test.ts
```

Erwarteter Iststand: drei fehlgeschlagene Vertragsassertionen (Färbung hinter früherer Abdeckung; Wachstum der Kosten bei gleichen Zielpositionen; ungeteilte Wachstumskopien) und eine bestandene Kapazitäts-Gegenrechnung. JSON-Dateien `tint.json`, `keys.json`, `copies.json`, `scratch.json`. Der Kostenwächter verwendet die R159-Wachstumsregel; er zählt `ColumnTable.get` und die durch `viewWork` erfassten direkten Tabellenzugriffe. Die Kopierprobe zählt Elemente über den nativen TypedArray-`set`-Aufruf zwischen zwei Generatoraufrufen. Keine künstlichen Verzögerungen; diese Node-Zeiten sind kein Browser-Gate.

Für den Basisvergleich nur die Tint- und Bounds-Sonden in eine Archivkopie von `3ada110a` legen. Dort mit derselben Node-Konfiguration `codexR159Tint.test.ts` und `codexR159Bounds.test.ts -t 'growth copies'` ausführen. Beide bestehen; getrennte Ausgabe unter einem anderen `R159_OUT` verwenden. Die Suche bei Positionsgleichstand wurde damit nicht als neuer Rückschritt des Commits bezeichnet; sie bleibt ein Rest des vereinbarten vollständigen Abfragepfads.

## Browser

Die Konfiguration `.codex-playwright.config.ts` als `playwright.codex-r159.config.ts` ins UI-Verzeichnis kopieren. Nur in der Kopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen. Claudes **unveränderte** Spezifikationen `viewer-palette-fest.r159.longtask.viewer.spec.ts` und `viewer-palette-fest.r159.shapes.viewer.spec.ts` als `e2e/codex-r159-longtask.viewer.spec.ts` und `e2e/codex-r159-shapes.viewer.spec.ts` ablegen, nach dem Produkt-Build.

```sh
LT_OUT=/tmp/codex-r159-repro/browser-metrics.json nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r159.config.ts codex-r159-longtask.viewer.spec.ts codex-r159-shapes.viewer.spec.ts
```

Der Ausgabepfad soll noch nicht existieren: Die Sonde hängt Messungen an. `LT_KEYS`, Profiler- und Trace-Schalter waren nicht gesetzt; insbesondere Profiler-Schalter nicht setzen, da die Originalsonde dafür fremde absolute Ausgabepfade enthält. Ein Worker, eigener automatisch gestarteter/beendeter Mock auf freiem Port `127.0.0.1:4188`, keine Live-Suite.

**6/6 Ablaufprüfungen bestanden**, ein Messlauf. Die Sonde erfasst die Zeiten, setzt aber keine Assertion auf jede 50-ms-Überschreitung. Deshalb sind die bestandenen Abläufe kein bestandenes Zeit-Gate: erste Ankunft Ein-Paar und Kette je eine Aufgabe rund 52 ms, Programmwechsel zwei bis 72 ms. Maximaler Phasenschritt 5,0 ms, Mauseingabeverzögerung maximal 78 ms. Der Fehlerwächter filtert auf `contactView|no longer published|a pass failed`; keine Behauptung einer umfassend konsolenfehlerfreien Seite. Keine Tastaturmessung, keine Browsermessung der neuen Gleichstandsform.

## Integrität

Die 378 eingecheckten Dateien unter `lcnc-webui/src` der Archivkopie wurden gegen die Git-Blob-IDs des geprüften Commits verglichen. Eigene Sonden sind zusätzliche Dateien. Die Review-Eingaben samt uncommittiertem Plan und Claudes Belegen sind im Manifest mit Bytezahl und SHA-256 festgehalten. Im Live-Baum wurden nur der Review-Anhang und neue `r159.codex-*`-Belege geschrieben.
