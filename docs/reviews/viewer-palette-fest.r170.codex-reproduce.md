# R170 · Codex · Reproduktion

Geprüfter Code: `f595d2ab520c2a4dc45184094cf7d2571fd3aef8` (`334122c7..f595d2ab`, `feat/step4-p2b`, ungemergt). Ausführungen in `/tmp/codex-r170-xc0t4nv8/repo`, niedrig priorisiert. Die verfolgten 374 Dateien unter `lcnc-webui/src` wurden gegen ihre Git-Blobs geprüft; keine Produktänderung. Live-Suite, Live-Ports und Maschine nicht verwendet.

## Vorbereitung

Eine eigene Archivkopie von `f595d2ab` anlegen (`git archive` / `tar -x`), ohne den Live-Checkout umzuschalten. In dieser Prüfung war `lcnc-webui/node_modules` ein Link auf `/tmp/codex-r169-7fcxcy1g/repo/lcnc-webui/node_modules`; keine Installation und keine Änderung an den Abhängigkeiten des Live-Baums. Bei Wiederholung passende Abhängigkeiten gemäß Lockdatei in der eigenen Kopie verwenden.

Die Belege `viewer-palette-fest.r170.codex-undecidable.test.ts` und `viewer-palette-fest.r170.codex-delta-budget.test.ts` in der Kopie nach `lcnc-webui/src/viewer/r170-codex-undecidable.test.ts` bzw. `r170-codex-delta-budget.test.ts` kopieren. `R170_OUT` ist ein vorhandenes, frei gewähltes Ausgabeverzeichnis. Alle folgenden Befehle laufen in `lcnc-webui` der Archivkopie.

## Gegenproben

```sh
R170_OUT=/tmp/codex-r170-xc0t4nv8 nice -n 10 ./node_modules/.bin/vitest run src/viewer/r170-codex-undecidable.test.ts src/viewer/r170-codex-delta-budget.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r170-xc0t4nv8/own-probes.json
```

Erwartet am geprüften Stand: drei rote Assertions, eine grüne. Die Proben verwenden echte `ContactStore`-Tabellen und `buildContactView`. Die Kostenprobe instrumentiert ausschließlich während `undecidableStretchesSteps` die Array-Operationen und stellt sie danach wieder her. Die deterministischen Vergleiche je `next()` sind der Arbeitsnachweis; die instrumentierten Millisekunden sind keine Browserlatenz-Abnahme. `withMeter` zählt die zusätzlichen Puffer dieser Ableitung, nicht den schon zuvor erstellten Grundaufbau. Rohdaten: `uncertainty-union.json`, `held-gap-union.json`, `gap-cost.json`, `delta-budget.json`.

## Repository-Prüfungen

Die 25 ausgewählten Dateien stehen vollständig in `viewer-palette-fest.r170.codex-unit-files.json`. Lauf mit einem Worker, ohne Deep-Hunt:

```python
import json, subprocess
from pathlib import Path
base = Path('/tmp/codex-r170-xc0t4nv8')
files = json.loads((base / 'unit-files.json').read_text())
with (base / 'unit.txt').open('w') as log:
    result = subprocess.run(['nice', '-n', '10', './node_modules/.bin/vitest', 'run',
        *files, '--maxWorkers=1', '--reporter=json',
        '--outputFile=' + str(base / 'unit.json')], stdout=log, stderr=subprocess.STDOUT)
print(result.returncode)
```

## Browserprüfung

`viewer-palette-fest.r170.codex-browser.config.ts` als `playwright.codex.config.ts` in die Archivkopie übernehmen; absolute Ausgabepfade bei Bedarf anpassen. **Nur dort** in `e2e/ctl.ts` den Mock-Endpunkt `http://localhost:4174` durch `http://127.0.0.1:4188` ersetzen. Keine Produktdatei verändern. Der eigene Mock wird von Playwright gestartet und beendet; `reuseExistingServer: false`. Der Port muss frei sein.

```sh
nice -n 10 ./node_modules/.bin/vite build
nice -n 10 ./node_modules/.bin/playwright test --config=playwright.codex.config.ts --grep 'first touch shows while|states without a first touch|never in a hidden tab|a sweep worker fails mid-run|one failure falls back both|a run.s beginning: its contact'
```

Ergebnis: 8/8 bestanden, keine Wiederholungen, kein Trace. JSON-Bericht und Build-Ausgabe liegen bei. Der Browserlauf überschnitt sich mit der laufenden Unit-Auswahl: funktionale Prüfung, keine Wiederholung der 50-ms-Abnahme oder der Messreihe vorher/nachher. Keine Live-Zugriffe. Die ursprüngliche Sandbox erlaubte keinen Server-Bind; der gleiche isolierte Lauf wurde danach mit freigegebener lokaler Ausführung erfolgreich ausgeführt.

## Nachvollziehbarkeit

`manifest.json` hält den geprüften Commit, Eingabe-Hashes (einschließlich der im Live-Baum vorgelegten Planfassung), Ausgabe-Hashes und die Prüfung der unveränderten Produktquellen fest. Vorhandene Belege, insbesondere Claudes ähnlich benannte `viewer-palette-fest.r170.codex-probes.txt`, wurden nicht überschrieben. Review nur als neuer Anhang; keine Commits durch Codex.
