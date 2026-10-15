# Codex R158: Reproduktion

Geprüfter Produktstand: `3ada110a13d10e19da38337c3b0621e645eb6a81` (`feat/step4-p2b`, ungemergt).
Prüfarchiv: `/tmp/codex-r158-af75xrww/repo`, aus `git archive 3ada110a`. Vorhandene `node_modules` wurden in die Kopie übernommen. Keine Produktmutation, keine Live-Verbindung. Die Datenform des neuen Sweep-Nachweises erzeugt ausschließlich die lokale Kollisionsbibliothek.

## Sonden und gezielter Nachlauf

Die mitgelieferte `viewer-palette-fest.r158.codex-vitest.config.ts` als `vitest.codex-r158.config.ts` nach `lcnc-webui/` legen. Die folgenden Belege nach `lcnc-webui/src/viewer/` kopieren:

| Beleg, Präfix `viewer-palette-fest.r158.codex-` | Zielname |
|---|---|
| `publisher.probe.test.ts` | `codexR157Publisher.test.ts` |
| `component.probe.test.ts` | `codexR157Bounds.test.ts` |
| `bands.probe.test.ts` | `codexR158Bounds.test.ts` |
| `memory.probe.test.ts` | `codexR158Memory.test.ts` |
| `sweep.probe.test.ts` | `codexR158Queries.test.ts` |

Die R157-Komponentenprobe ist unverändert. Im R157-Publisher-Harness kamen nur der Import `retireView` und `retire: v => retireView(v)` hinzu; die Assertions blieben gleich. Die neuen Sonden verändern keine Produktdateien; die Bandprobe zählt tatsächliche Tabellenzugriffe über Proxy und `ColumnTable.get`, keine Zeit. Der Speicherharness verwendet die Reihenfolge der realen `ThreeViewer`-Ableitungen und hält nur eine diagnostische Referenz; er fügt keine künstlichen Unterbrechungen hinzu.

Im Ordner `lcnc-webui`:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r158.config.ts src/viewer/codexR157Publisher.test.ts src/viewer/codexR157Bounds.test.ts src/viewer/contactPublisher.test.ts src/viewer/contactStore.test.ts src/viewer/steps.test.ts src/viewer/shownContacts.test.ts src/viewer/contactView.test.ts src/viewer/contactUnion.test.ts src/viewer/simWindow.test.ts src/viewer/checkWiring.test.ts
```

Ergebnis: **146/146 PASS**, davon sechs R157-Gegenproben und 140 Bestandstests.

```sh
mkdir -p /tmp/codex-r158-repro
R158_OUT=/tmp/codex-r158-repro nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r158.config.ts src/viewer/codexR158Bounds.test.ts src/viewer/codexR158Memory.test.ts src/viewer/codexR158Queries.test.ts
```

Erwarteter Iststand: **eine bestandene Sweep-Probe, drei fehlgeschlagene Vertragsassertionen** (zwei Bandformen, ein Aufbau-Speicherfall). `memory.json` und `query.json` erscheinen im angegebenen `R158_OUT`. Im Node-Test wird beim Import von `simWindow`/StatusStore das fehlende `localStorage` protokolliert; die Speicherprobe erreicht dennoch ihre vollständige fachliche Assertion. Der Fehler ist weder ein Browserbefund noch Ursache der fehlgeschlagenen Assertion.

## Build und Browser

`nice -n 15 npm run build` im UI-Verzeichnis der Archivkopie. Die mitgelieferte Playwright-Konfiguration als `playwright.codex-r158.config.ts` verwenden. Nur in der Archivkopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen. Die unveränderte Originalsonde `viewer-palette-fest.r158.longtask.viewer.spec.ts` nach `e2e/codex-r158-longtask.viewer.spec.ts` kopieren.

```sh
LT_OUT=/tmp/codex-r158-repro/longtask.json nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r158.config.ts codex-r158-longtask.viewer.spec.ts
```

`LT_OUT` soll noch nicht existieren, da die Sonde Ergebnisse anhängt. `LT_KEYS`, `LT_PROFILE`, `LT_TRACE` und `LT_TRACE1` waren nicht gesetzt. Profiler/Trace-Schalter nicht setzen: Die Originalsonde enthält dafür fremde absolute Ausgabepfade. Ausschließlich eigener Mock auf `127.0.0.1:4188`; der Port muss frei sein. Ein Browser-Worker, Trace aus. Playwright startet und beendet den Mock selbst.

Ergebnis: **2/2 PASS**, ein eigener Messlauf beider Formen. Der Fehlerwächter der unveränderten Sonde filtert auf `contactView`, `no longer published` und `a pass failed`; aus ihm wird kein umfassender Nachweis der Abwesenheit aller beliebigen Konsolenfehler abgeleitet. Keine neue Tastaturmessung. Die Browserformen sind die von Claude gelieferten Budgetformen, nicht die neuen Lücken-Gegenproben.

Der Produktions-Build ist grün. Das vollständige Frontend-Gate wurde nicht wiederholt. Alle eingecheckten Dateien in `lcnc-webui/src` wurden abschließend gegen die Git-Blob-IDs von `3ada110a` geprüft: 376 unverändert; eigene Tests sind zusätzliche Dateien.
