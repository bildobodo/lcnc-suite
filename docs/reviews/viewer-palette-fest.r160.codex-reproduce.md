# Codex R160: Reproduktion

Prüfstand `95b729cd` aus `git archive`, Archivkopie `/tmp/codex-r160-91mw_20g/repo`; Basisvergleich `ac050872` in `/tmp/codex-r159-_y__3tra/repo`. Keine Produktdatei verändert. Abhängigkeiten lokal nach `lcnc-webui/node_modules` kopiert, da ein Symlink in den schreibgeschützten fremden Worktree beim Build dessen `.tmp/tsconfig.*.tsbuildinfo` beschreiben würde. Der erste Buildversuch scheiterte daran; mit lokaler Kopie besteht der unveränderte Produkt-Build.

## Build und bestehende Wächter

Vor dem Hinzufügen eigener Sonden/Messspezifikationen im UI-Verzeichnis: `nice -n 15 npm run build`.

`viewer-palette-fest.r160.codex-vitest.config.ts` als `vitest.codex-r160.config.ts` ins UI-Verzeichnis kopieren. Frühere Sonden unverändert aus `docs/reviews/` nach `src/viewer/` kopieren:

| Beleg, jeweils Präfix `viewer-palette-fest.` und Suffix `.test.ts` | Zieldatei unter `src/viewer/` |
|---|---|
| `r158.codex-publisher.probe` | `codexR157Publisher.test.ts` |
| `r158.codex-component.probe` | `codexR157Bounds.test.ts` |
| `r158.codex-bands.probe` | `codexR158Bounds.test.ts` |
| `r158.codex-memory.probe` | `codexR158Memory.test.ts` |
| `r158.codex-sweep.probe` | `codexR158Queries.test.ts` |
| `r159.codex-tint.probe` | `codexR159Tint.test.ts` |
| `r159.codex-bounds.probe` | `codexR159Bounds.test.ts` |
| `r159.codex-scratch.probe` | `codexR159Scratch.test.ts` |

```sh
mkdir -p /tmp/codex-r160-repro
R158_OUT=/tmp/codex-r160-repro R159_OUT=/tmp/codex-r160-repro nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r160.config.ts src/viewer/codexR157Publisher.test.ts src/viewer/codexR157Bounds.test.ts src/viewer/codexR158Bounds.test.ts src/viewer/codexR158Memory.test.ts src/viewer/codexR158Queries.test.ts src/viewer/codexR159Tint.test.ts src/viewer/codexR159Bounds.test.ts src/viewer/codexR159Scratch.test.ts src/viewer/contactPublisher.test.ts src/viewer/contactStore.test.ts src/viewer/steps.test.ts src/viewer/shownContacts.test.ts src/viewer/contactView.test.ts src/viewer/contactUnion.test.ts src/viewer/contactMeter.test.ts src/viewer/contactViewIndexed.test.ts src/viewer/contactViewUnion.test.ts src/viewer/contactViewBudget.test.ts src/viewer/simWindow.test.ts src/viewer/checkWiring.test.ts
```

208/208 PASS in 20 Dateien; darunter 14 frühere eigene Prüfungen. Kein vollständiges Gate erneut ausgeführt.

## Neue Sonden

`viewer-palette-fest.r160.codex-conflicts.probe.test.ts` und `.codex-navigation.probe.test.ts` nach `src/viewer/codexR160Conflicts.test.ts` bzw. `codexR160Navigation.test.ts` kopieren.

```sh
R160_OUT=/tmp/codex-r160-repro nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r160.config.ts src/viewer/codexR160Conflicts.test.ts
R160_OUT=/tmp/codex-r160-repro nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r160.config.ts src/viewer/codexR160Navigation.test.ts
```

Erwartung an `95b729cd`: vier rote Vertragsassertionen (Schlüsselsuche über widerlegte Proben, Aufbau bei widerlegten/fehlenden/späten Proben), drei grüne Bedienungsassertionen. JSON-Dateien `conflicts-keys.json`, `build-refuted.json`, `build-absent.json`, `build-sparse.json`, `navigation-plain.json`, `navigation-union.json`, `handover.json`.

Die Schlüsselsuche zählt `ColumnTable.get` plus die direkten Tabellenzugriffe des Produktionszählers `viewWork`; die Schreib-/Antwortoperationen danach zählen nicht mit. Die Aufbausonden erwärmen nur die Scratch-Kapazitäten und zählen dann sechs Spalten des wiederverwendeten Puffers über Proxies zwischen zwei `next()`-Aufrufen. Keine künstliche Verzögerung; Operationszahlen sind keine Browserzeit.

Für den Basisvergleich dieselbe Konfliktsonde in eine Archivkopie von `ac050872`, dieselbe Vitest-Konfiguration verwenden und ausschließlich `-t 'handed-over key'` ausführen, mit eigenem Ausgabeverzeichnis. Ergebnis: eine grüne Assertion, drei gefilterte Tests. Beide Stände lesen vor der Suche einmal das Zielende (eine bereits angezeigte Ansicht). Die 378 Produktquelldateien beider Archivkopien sind gegen Git-Blob-IDs geprüft.

## Browsermessung

Nach dem Build Claudes unveränderte R159-Messspezifikationen `viewer-palette-fest.r159.longtask.viewer.spec.ts` und `.r159.shapes.viewer.spec.ts` als `e2e/codex-r160-longtask.viewer.spec.ts` / `codex-r160-shapes.viewer.spec.ts` kopieren. Die beiliegende Playwright-Konfiguration ins UI-Verzeichnis als `playwright.codex-r160.config.ts`; nur in der Kopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen.

```sh
LT_OUT=/tmp/codex-r160-repro/browser-metrics.json nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r160.config.ts codex-r160-longtask.viewer.spec.ts codex-r160-shapes.viewer.spec.ts
```

Ausgabedatei vorher noch nicht vorhanden (die Sonde hängt an). Ein Worker, ausschließlich eigener Mock auf `127.0.0.1:4188`, keine gleichzeitigen CPU-Prüfungen. Sandbox-Bindeverbot erforderte die freigegebene Ausführung außerhalb der Sandbox. Keine Profiler-/Trace-Schalter und kein `LT_KEYS` gesetzt. Sechs Abläufe PASS in 42,9 s; in den Kontaktphasen keine Aufgabe >50 ms, beim Programmwechsel zwei bis 87 ms. Die neuen Konflikt-/Scratchformen wurden nur in Node nachgewiesen. Die Messung ist keine endgültige Browser-PC-/Tastaturabnahme.

## Integrität

Das Manifest hält Commit-IDs, Hashes der Eingaben (auch des uncommittierten Plans und Review-Vorspanns), Produktquellenprüfung und Hashes der neuen Belege fest. Im Live-Baum nur an die vereinbarte Review-Datei angehängt und neue `r160.codex-*`-Belege angelegt. Keine Builds/Tests/Checkouts im Live-Baum, keine Maschinenbefehle, kein Zugriff auf `:5173` oder `:8000`.
