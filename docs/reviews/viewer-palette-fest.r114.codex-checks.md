# R114 · Codex · Prüfaufbau

Planfassung 3, Stand `60c888a6c4908882a4a534517f3e34054b34af0c`, Änderung `5252c37a..60c888a6`. Nur Plan und Anfrage geändert. Gegenstand: R113-Reste sowie die neu vorgeschlagene Naht zweier zeitlich getrennt gerechneter Bereiche.

## Isolation

Archiv `/tmp/codex-r114-aat3eisf`. Node-Abhängigkeiten als lesende Einzelsymlinks ohne `.tmp`, `.cache`, `.vite`, `.vite-temp`; eigener Vite-Cache, ein Worker, `nice -n 19`. Kein Browser, kein Server/Port, kein HAL/Controller, kein nativer Parse. Im Live-Baum nur Review-Anhang und neue R114-Belege. Frühere Belege unverändert.

## Tatsächlich ausgeführt

Drei Client-Proben **3/3 PASS** mit den echten Funktionen `sweepCollisions`, `pairDistance`, `sliceTrack` und `mergeEntryResult`:

- **feed-seam.json:** Feed in Stock, Schnitt im Kontakt, Rapid-Rückzug. Der volle Sweep meldet keinen Fehler; auch der Präfix meldet keinen Befund, obwohl die Entfernung am Schnitt 0 ist. Ein ausdrücklich synthetischer Grenzdatensatz gemäß dem Plan bleibt beim existierenden Entry-Merge stehen, weil es keinen Präfixbefund gibt, dessen Fortsetzung er werden könnte.
- **rapid-seam.json:** Rapid in Stock (L8), nach dem Schnitt Feed (L9), dann erneut Rapid ohne Trennung (L10/L11). Der Vollsweep meldet auch L10/L11 als Fortsetzungen des ursprünglichen Rapid-Kontakts. Der frische heutige Suffix-Sweep kennt dessen Herkunft nicht und meldet dort nichts. Ein synthetischer Grenzdatensatz plus Entry-Merge stellt diese Folgezeilen nicht wieder her.
- **two-phase-control.json:** Die neue Reihenfolge löst den R113-Mischfall: Der vor dem unzutreffenden Hinweis liegende bekannte Befund wird in Phase 2 gefunden; die unbekannte Anfangsfahrt bleibt benannt.

`range` und `boundary` sind noch NICHT implementiert. Die Grenzdatensätze sind als Plan-Eingaben gekennzeichnet. Die Stücke werden nur zur isolierten Prüfung der vorhandenen Kontaktsemantik geschnitten; daraus folgt keine Behauptung, dass ein korrekt implementierter neuer Bereichs-Sweep denselben Fehler machen muss. Der Befund zeigt, welche Information und Reklassifikation der neue Vertrag zusätzlich braucht. Diese Schneidpaare sind nie statisch ausgeschlossen, der R112-Baseline-Fehler spielt hier nicht mit.

**plan-checks.py PASS:** Per AST werden nur die vorhandenen reinen Helfer `pinned_ctx`, `preview_file_edge_action` und `program_source` geladen. Ein temporäres NC-Textfile innerhalb des Archivs erhält einen anderen mtime ohne Inhaltsänderung; die Source bleibt gleich und der echte File-Edge-Helfer verlangt einen Parse. Die beiden veröffentlichten Kontexte A/B sind explizite Modelleingaben. Der echte `pinned_ctx` liest B aus der jüngsten Veröffentlichung. Das Gegenmodell der aufgezählten Zulassungsregeln übernimmt dagegen `for_run` aus der alten verifizierten Laufbasis A und akzeptiert. Der ursprüngliche R113-Lauf-1-in-Lauf-2-Fall wird durch das neue Tupel korrekt abgelehnt.

Es wurde kein kompletter Gateway-Poller, Worker-Parse oder Maschinenablauf ausgeführt. Die Bedingung des gewöhnlichen Parses im laufenden Zustand stammt aus der Quellprüfung von `gateway.py:1638–1671`. Die Proben sind weder eine Implementierungsabnahme noch ein Lasttest. Keine Mutationen oder nachträglichen Erwartungsänderungen. Kein Gesamtgate oder Build wiederholt.

## Wiederholung

`git archive 60c888a6` in eine temporäre Kopie entpacken. Vorhandene Node-Abhängigkeiten ohne geteilte Caches bereitstellen. Die veröffentlichte `viewer-palette-fest.r114.codex-client.test.ts` nach `lcnc-webui/src/viewer/r114.codex.test.ts` kopieren; als `lcnc-webui/r114.vitest.config.ts` ablegen:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'../r114-vitest-cache',test:{environment:'node',maxWorkers:1,fileParallelism:false,testTimeout:240000,include:['src/**/*.test.ts']}});
```

Aus `lcnc-webui` mit zuvor angelegtem Ausgabeverzeichnis:

```sh
R114_EVIDENCE=/tmp/r114-evidence nice -n 19 node node_modules/vitest/vitest.mjs run --config r114.vitest.config.ts src/viewer/r114.codex.test.ts
```

Python-Sonde (Standardbibliothek genügt; schreibt nur `r114-input.ngc` in die angegebene Archivkopie und die Ergebnisdatei):

```sh
nice -n 19 python3 viewer-palette-fest.r114.codex-plan-checks.py /tmp/r114-archive /tmp/r114-evidence/plan-checks.json
```
