# Codex R157: Reproduktion

Geprüfter Produktstand: `e45b223d267774ab0c0abf302d43ea65867258a8`.
Alle Prüfungen in `/tmp/codex-r157-83_h3jv8/repo`, einer `git archive`-Kopie. Keine Produktmutation. Vorhandene `node_modules` wurden in die Archivkopie kopiert. Die Live-Suite und ihre Ports wurden nicht verwendet.

## Gegenproben

Die Dateien `viewer-palette-fest.r157.codex-publisher.probe.test.ts` und `viewer-palette-fest.r157.codex-bounds.probe.test.ts` als `src/viewer/codexR157Publisher.test.ts` bzw. `src/viewer/codexR157Bounds.test.ts` in eine solche Kopie legen; die mitgelieferte `viewer-palette-fest.r157.codex-vitest.config.ts` als `vitest.codex-r157.config.ts` nach `lcnc-webui/`.

Im Ordner `lcnc-webui`:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r157.config.ts src/viewer/codexR157Publisher.test.ts src/viewer/codexR157Bounds.test.ts
```

Erwarteter Iststand: sechs fehlgeschlagene Vertragsassertionen, vier Befunde. Der Harness der Publisher-Probe beruht auf dem Harness von `src/viewer/contactPublisher.test.ts`; die Gegenfolgen sind eigene Tests. Die Grenzenprobe zählt Zugriffe auf Scratch-Arrays, keine Uhrzeit; ihre Proxy-Instrumentierung fügt keine künstliche Verzögerung ein. Timingwerte dieses instrumentierten Tests sind kein Browsernachweis.

## Gezielt wiederholte Bestandstests

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r157.config.ts src/viewer/contactPublisher.test.ts src/viewer/contactStore.test.ts src/viewer/steps.test.ts src/viewer/shownContacts.test.ts src/viewer/contactView.test.ts src/viewer/contactUnion.test.ts src/viewer/simWindow.test.ts src/viewer/checkWiring.test.ts src/stickyHead.test.ts src/scrollFade.test.ts src/glyphMarkup.test.ts
```

129/129 in 11 Dateien grün. Keine erneute vollständige Gate-Ausführung.

## Build und Browser

`npm run build` in der Archivkopie, danach die mitgelieferte Playwright-Konfiguration als `playwright.codex-r157.config.ts` verwenden. Ausschließlich in der Kopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen; `layout-fixtures.ts` übernimmt diesen Helfer. Der Mock wird durch Playwright selbst gestartet und beendet, ein Worker, Produktions-Build. Der Port muss frei sein. Alle Prozesse liefen mit `nice -n 15`.

```sh
node node_modules/@playwright/test/cli.js test --config playwright.codex-r157.config.ts sim-panel.viewer.spec.ts --grep 'a long list is a window|a moved window keeps the picture|the list follows the position|playback at|the summary line is always|the summary names each kind'
```

6/6 grün.

Für die Budgetmessung die unveränderte mitgelieferte Datei `viewer-palette-fest.r157.longtask.viewer.spec.ts` nach `e2e/codex-r157-longtask.viewer.spec.ts` kopieren. Den Ausgabepfad separat wählen; `LT_KEYS`, `LT_PROFILE` und `LT_TRACE` waren nicht gesetzt. Insbesondere den Profiler-Schalter nicht setzen: Er enthält einen fremden, absoluten Ausgabepfad.

```sh
LT_OUT=/tmp/codex-r157-longtask.json node node_modules/@playwright/test/cli.js test --config playwright.codex-r157.config.ts codex-r157-longtask.viewer.spec.ts --grep 'many pairs'
```

Ein Nachlauf, Standardbudget 65.536 Episoden / 262.144 Intervalle: vier Messphasen, keine Aufgabe >50 ms; Mauseingabeverzögerung maximal 70/21/36/22 ms. Keine Tastaturmessung in diesem Nachlauf. `byOwner` dieser Sonde misst nach Beruhigung; die fehlende Übergangskopie ist getrennt durch die Publisher-Probe belegt.
