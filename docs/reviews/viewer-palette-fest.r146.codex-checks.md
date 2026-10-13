# R146 · Codex · Prüfprotokoll · 13. Oktober 2026

## Stand und Arbeitsgrenzen

- Umfang: `0426c923..e24f4b14`, `feat/step4-p2`, ungemergt.
- Archivkopie aus `git archive e24f4b14`: `/tmp/codex-r146-uj9v3tcf/repo`; Abhängigkeiten als eigene Kopie. Ein Vitest-Thread, niedrige Priorität (`nice -n 15`).
- Live-HEAD: `7fc341e6d23b2aa965549dd23e74fb72ba3107ce`.
- Eingaben vor dem Review eingefroren: Reviewtext, unveränderte Planfassung 5 und vier Claude-Belege. Hashes und Anfangsstatus stehen in `viewer-palette-fest.r146.codex-context.json`.
- Alle sieben im Prüfbereich geänderten Archivdateien vor Veröffentlichung bytegenau gegen den Commit geprüft: keine Produktänderungen im Archiv. Im Live-Baum nur der Review-Anhang und neue `r146.codex-*`-Belege; keine Builds, Browser, Live-Ports oder Maschinenbefehle.

## Eigene Ausführung

| Prüfung | Ergebnis | Ausgabe |
|---|---|---|
| Unveränderte R145-Worker-Probe (Restfall + positive Kontrolle), unveränderte R145-Abschlussprobe, sechs Kernproben aus der schon in R145 angepassten R144-Kopie; dazu `contactStore`, `contactMerge`, `collisionWorker`, `collisionInside` vollständig | 71 bestanden in 7 Dateien (62 Repositorytests + 9 eigene Proben) | `viewer-palette-fest.r146.codex-regressions.txt` |
| `collision.test.ts`, Filter `contact store`, einschließlich neuer Erwartung zum tatsächlichen Anhalten | 11 bestanden, 114 nicht ausgewählt | `viewer-palette-fest.r146.codex-repository-sink.txt` |
| `sweepShards.test.ts`, Filter `mergeShardResults` | 8 bestanden, 5 nicht ausgewählt | `viewer-palette-fest.r146.codex-repository-shards.txt` |

**90 bestanden, kein Fehler:** 81 Repositorytests und neun eigene Proben. Die drei übernommenen Probe-Dateien wurden bytegenau mit den R145-Belegen verglichen; keine Anpassung von Ablauf oder Erwartungen. Der Vitest-Reporter zeigt Konsolenausgaben bestandener Tests standardmäßig nicht an; die erfolgreichen Assertions sind in den beigelegten Quellen nachlesbar.

Die bestehenden und erweiterten Worker-Tests schließen den Weg bis zum neuen Endergebnis ein: Generationenfolge `[0,0,1]`, zwei alte Zeilen erhalten, neue Veröffentlichung erst nach dem zweiten alten ACK. Ein bereits fertiger lokaler Lauf liefert dann sein Ergebnis; ein noch rechnender liefert zunächst seinen Teilstand. Frühe ACKs der neuen und verspätete ACKs der alten Generation geben den falschen Stand nicht frei. Die vorhandenen Pausen-, Abbruch- und Seitenlauf-Tests sind in der vollständig ausgeführten Worker-Datei enthalten.

Die Abschlussprobe benutzt wie in R145 den echten Sweep und die bestehende Testnaht für eine unentscheidbare Innenantwort bei der abschließenden Bisektion. Kontrolllauf mit Platz: Lücke gespeichert, vollständig. Voller Lückenspeicher: `truncated.reason = budget` und `incompleteFrom` spätestens an der nicht gespeicherten Stelle. Zusätzlich ist im Quelltext geprüft, dass das finale `yield` aus diesem korrigierten `truncated.covered` folgt.

## Vorgelegte Gates

Claudes Bericht nennt Lint, Build, 521 Browserprüfungen und die gesamte `collision.test.ts` (125 Tests) am Stand `e24f4b14`; der volle Vitest-Lauf mit 2265 Tests lief auf `ca18d3e3`. Der Diff zwischen diesen beiden Ständen enthält ausschließlich den zusätzlichen Budget-Stopp-Wächter in `collision.test.ts`, keine Produktänderung. Mutationsbericht und unveränderter Gegenvergleichskorpus wurden gelesen. Sie sind vorgelegte Belege; kein eigenes Gesamtgate, eigener Browserlauf oder eigene Mutation behauptet.

## Reproduktion

In einer separaten Archivkopie von `e24f4b14` mit passenden `node_modules` die neuen Belege kopieren:

- `viewer-palette-fest.r146.codex-r145-worker.test.ts` → `lcnc-webui/src/viewer/r146.codex-r145-worker.test.ts`
- `viewer-palette-fest.r146.codex-r145-finish.test.ts` → `lcnc-webui/src/viewer/r146.codex-r145-finish.test.ts`
- `viewer-palette-fest.r146.codex-r144-core.test.ts` → `lcnc-webui/src/viewer/r146.codex-r144-core.test.ts`
- `viewer-palette-fest.r146.codex-vitest.config.ts` → `lcnc-webui/vitest.codex-r146.config.ts`

Im kopierten `lcnc-webui`:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/r146.codex-r145-worker.test.ts src/viewer/r146.codex-r145-finish.test.ts src/viewer/r146.codex-r144-core.test.ts src/viewer/contactStore.test.ts src/viewer/contactMerge.test.ts src/viewer/collisionWorker.test.ts src/viewer/collisionInside.test.ts --config vitest.codex-r146.config.ts
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/collision.test.ts --testNamePattern 'contact store' --config vitest.codex-r146.config.ts
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/sweepShards.test.ts --testNamePattern 'mergeShardResults' --config vitest.codex-r146.config.ts
```

Alle drei Aufrufe enden auf dem geprüften Stand mit Exit 0.
