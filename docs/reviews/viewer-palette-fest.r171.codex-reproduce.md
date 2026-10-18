# R171 · Codex · Reproduktion

Code: `fe1a153e6d9a5ef06c1522bffebc50eef210fbe6`, `f595d2ab..fe1a153e`, `feat/step4-p2b`, ungemergt. Archivkopie `/tmp/codex-r171-0leq1zyt/repo`. Live-Suite und Maschine nicht verwendet.

## Vorbereitung

Eine isolierte Kopie mit `git archive fe1a153e` auspacken. In dieser Prüfung zeigte `lcnc-webui/node_modules` auf `/tmp/codex-r170-xc0t4nv8/repo/lcnc-webui/node_modules`; keine Installation im Live-Baum. Bei Wiederholung Abhängigkeiten gemäß Lockdatei in der Kopie bereitstellen.

Die beiden **unveränderten** R170-Belege `viewer-palette-fest.r170.codex-undecidable.test.ts` und `viewer-palette-fest.r170.codex-delta-budget.test.ts` nach `lcnc-webui/src/viewer/r170-codex-undecidable.test.ts` bzw. `r170-codex-delta-budget.test.ts` kopieren. Den neuen Beleg `viewer-palette-fest.r171.codex-notes.test.ts` nach `src/viewer/r171-codex-notes.test.ts` kopieren. Ausgabeverzeichnis bei Bedarf anpassen. Alle folgenden Befehle in `lcnc-webui` der Kopie.

## Unit-Prüfungen

`unit-files.json` enthält die acht Dateien (sechs Repository-Dateien und zwei R170-Sonden). Die neue Sonde wurde getrennt ausgeführt. Insgesamt 130/130 bestanden.

```python
import json, os, subprocess
from pathlib import Path
out = Path('/tmp/codex-r171-0leq1zyt')
files = json.loads((out / 'unit-files.json').read_text())
env = dict(os.environ, R170_OUT=str(out))
with (out / 'unit.txt').open('w') as log:
    subprocess.run(['nice', '-n', '10', './node_modules/.bin/vitest', 'run', *files,
        '--maxWorkers=1', '--reporter=json', '--outputFile=' + str(out / 'unit.json')],
        env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
```

```sh
R171_OUT=/tmp/codex-r171-0leq1zyt nice -n 10 ./node_modules/.bin/vitest run src/viewer/r171-codex-notes.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r171-0leq1zyt/own.json
```

Die erste neue Probe prüft 48 Varianten über den vollständigen `buildShownSteps` gegen eine unabhängige Vereinigung. Die zweite zählt zwischen Yields Lesungen sowohl aus `ColumnTable` als auch aus den temporären `Grow`-Blöcken, daneben native Array-Sortierungen und die mit `withMeter` gezählten Allokationen. Alle Instrumentierungen werden wiederhergestellt. Diese Proben sind keine Browserlatenz-Messung. Die R170-Kostenprobe steht als `r171.codex-r170-gap-cost.json` bei, damit Claudes vorhandene ähnlich benannte Datei unverändert bleibt.

## Browser

`browser.config.ts` als `playwright.codex.config.ts` in die Kopie übernehmen, Ausgabepfade bei Bedarf anpassen. **Beide Konstanten** in `e2e/ctl.ts` auf den eigenen Mock umstellen:

```ts
export const MOCK = 'http://127.0.0.1:4188/';
export const CTL = 'ws://127.0.0.1:4188/ctl';
```

Der erste eigene Lauf hatte nur die HTTP-Adresse geändert und scheiterte im Testaufbau zweimal mit `AggregateError`, bevor Produkt-Assertions erreicht wurden. Der WebSocket zeigte noch auf den unbesetzten Standardport 4174. Nach Korrektur nur dieses Archiv-Helfers bestanden beide Tests; keine Produktänderung, keine Assertion abgeschwächt. Beide Berichte und Logs sind beigelegt (`browser-setup-error.*` und `browser.*`). Die anfänglichen Screenshots enthielten nur den fehlgeschlagenen Seitenaufbau und sind nicht als UI-Beleg verwendet.

```sh
nice -n 10 ./node_modules/.bin/vite build
nice -n 10 ./node_modules/.bin/playwright test --config=playwright.codex.config.ts --grep 'an undecidable gap alone|a sweep worker fails mid-run'
```

Eigener Mock 127.0.0.1:4188, `reuseExistingServer: false`, ein Worker, headless Chromium, kein Trace. Der lokale Serverlauf war für diese Archivkopie freigegeben. Kein Zugriff auf :5173/:8000, keine Maschinenbefehle. Nach Korrektur 2/2 grün; funktionale Prüfung, keine neue 50-ms-Abnahme.

## Integrität

`source-check.json`: 374 verfolgte Dateien unter `lcnc-webui/src` gegen ihre Git-Blobs am geprüften Commit unverändert. Nur zusätzliche Sonden und ein angepasster Browser-Helfer/Config in der Archivkopie. `manifest.json` erfasst Eingabe- und Ausgabe-Hashes einschließlich des unverändert übernommenen Plans aus dem Live-Baum. Review nur angehängt; kein Produktcode, keine vorhandenen Belege verändert, keine Commits durch Codex.
