# R173 · Reproduktion der eigenen Prüfungen

Prüfstand: `git archive 97c98b5f`, isoliert unter `/tmp/codex-r173-a8l4sdqz/repo`. Produktbranch `feat/step4-p2b`, nicht gemergt. Vorhandene Node-Abhängigkeiten der isolierten R172-Kopie wiederverwendet. Keine Builds oder Tests im Live-Baum.

## Unit-Prüfungen

Im Archiv unter `lcnc-webui` die R172-Datei `viewer-palette-fest.r172.codex-side-notes.test.ts` unverändert nach `src/viewer/r172-codex-side-notes.test.ts` kopieren. Die neue Datei `viewer-palette-fest.r173.codex-origins.test.ts` nach `src/viewer/r173-codex-origins.test.ts` kopieren.

```sh
R172_OUT=/tmp/codex-r173-a8l4sdqz nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/contactView.test.ts src/viewer/shownContacts.test.ts src/viewer/scrubTrack.test.ts src/viewer/simRows.test.ts src/viewer/checkContext.test.ts src/viewer/checkWiring.test.ts src/viewer/contactMeter.test.ts src/viewer/r172-codex-side-notes.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r173-a8l4sdqz/unit.json
R173_OUT=/tmp/codex-r173-a8l4sdqz nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r173-codex-origins.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r173-a8l4sdqz/own.json
```

193 + 2 Prüfungen grün. Die neuen Proben umfassen 48 deterministische Varianten einer unabhängig berechneten Vereinigung je Quelle sowie Lesungen/Zuteilungen während der Ableitung bei bis zu 16.384 Hauptlauf- und 2.048 Seitenlauf-Lücken **je Generation** (zwei Generationen). Die erste Probe läuft durch den vollständigen Seitenaufbau. Die zweite misst die geänderte Ableitung; keine Aussage zur Browserlatenz.

## Browser

Nur im Archiv:

- In `e2e/ctl.ts` beide Adressen (HTTP und WebSocket) von `localhost:4174` auf `127.0.0.1:4188` ändern.
- `viewer-palette-fest.r173.codex-browser-config.ts` nach `playwright.codex.config.ts` kopieren.
- `viewer-palette-fest.r173.codex-browser-additions.spec.ts` an `e2e/collisions.viewer.spec.ts` anhängen. Das sind die finalen R172-Gegenproben mit ausschließlich angepassten JSON-Ausgabezielen; Assertions unverändert.
- Bei einem anderen Arbeitsordner die festen Ausgabeziele in Konfiguration/Sonden anpassen.

```sh
nice -n 10 node node_modules/vite/bin/vite.js build
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.codex.config.ts --grep 'R172 own:|VP-I125|VP-I126|a contact in a called file'
```

6/6 grün: vier Repository-Fälle und die beiden eigenen R172-Gegenproben. Die Kontaktliste und der Hinweis sagen jetzt L3; die Prüfbasis sagt vor und nach dem leeren Delta `touch`. Kontrollierter Worker-Transport für die Gegenproben, echte Seite/Dekodierung/Tabellenverwaltung/Veröffentlichung; Hauptprüfung bzw. anfängliche Modellprüfung auf XYZAC laufen wirklich. Eigener Mock 127.0.0.1:4188, keine Live-Ports, keine Maschinenbefehle.

## Belege

`codex-unit.json`, `codex-own.json`, `codex-browser.json` sind die vollständigen Berichte; `codex-unit-summary.json` fasst die Zahlen zusammen. `codex-origins.json`, `codex-bounded-reads.json`, `codex-browser-folded-state.json` und `codex-browser-boundary-state.json` halten die zusätzlichen Prüfungen und abgelesenen Zustände fest. `codex-manifest.json` enthält den Quellvergleich sowie die unveränderten Eingaben vor dem Review-Anhang.
