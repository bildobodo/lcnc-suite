# R144 · Codex · Prüfprotokoll · 13. Oktober 2026

## Stand und Grenzen

- Implementierung: `6d5e20f7..a81ac7d3bd393bc23f57ded04e000df086872bed`, `feat/step4-p2`, ungemergt.
- Live-HEAD beim Lesen und vor der Veröffentlichung: `23d55a0d2f6bd656ef7e8176278510ff8ee1208f`.
- Plan: Arbeitsbaumfassung 5, redaktionell nach R143; eingefroren als `viewer-palette-fest.r144.codex-plan-reviewed.md`, SHA256 `af8be63ad5280ba568630ab03fff355516ba9ecd1a5db563376401177618df90`.
- Die Anfrage R144 und alle sieben Claude-Belege wurden vor dem Review kopiert. Ihre Hashes, der Review-Präfix und der Anfangsstatus stehen in `viewer-palette-fest.r144.codex-context.json`.
- Tests nur in `/tmp/codex-r144-em325n6m/repo`, erzeugt mit `git archive a81ac7d3`; eigene Kopie der vorhandenen Abhängigkeiten. Kein Gateway, Browser, Live-Port oder Maschinenbefehl. Alle 20 im Review-Bereich geänderten Archivdateien wurden vor der Veröffentlichung bytegenau gegen den Commit geprüft: keine Produktänderung, auch im Archiv nicht.
- Im Live-Baum nur neue `r144.codex-*`-Belege und der Review-Anhang. Vorbestehende Änderungen an Plan, Review und Claudes Belegen bleiben erhalten.

## Eigene abgeschlossene Tests

Ausgeführt mit Node/Vitest, niedriger Priorität (`nice -n 15`), einem Thread, ohne `execArgv`:

| Prüfung | Ergebnis | Ausgabe |
|---|---|---|
| `contactStore.test.ts`, `contactMerge.test.ts`, `collisionWorker.test.ts`, `collisionInside.test.ts` vollständig | 53 bestanden, 4 Dateien | `viewer-palette-fest.r144.codex-repository-focused.txt` |
| `collision.test.ts`, Namensfilter `contact store` | 6 bestanden, 114 nicht ausgewählt | `viewer-palette-fest.r144.codex-repository-sink.txt` |
| Eigene Kern-Gegenproben, tatsächlicher Sweep bzw. Merge-Helfer | 6 erwartete Vertragsverletzungen | `viewer-palette-fest.r144.codex-counterexamples.txt` |
| Eigene Worker-Abläufe, tatsächlicher Koordinator, gefälschte Unter-Worker wie in der Repository-Suite | 5 erwartete Vertragsverletzungen | dieselbe Datei |

**59 bestehende Tests grün; 11 eigene Tests rot.** Die roten Tests enthalten die gewünschte Vertrags-Assertion, kein `it.fails`. Ihre Vorbedingungen bestehen. Im Werkzeugfall werden drei zeitlich geordnete Werkzeugereignisse T1/T3/T1 verwendet. Die Transportproben modellieren die Zustellreihenfolge mit Fake-Timern und Fake-Subworkern; sie sind keine Browsermessung. Der lokale Rückfall rechnet, soweit der Ablauf ihn erreicht, einen echten kleinen Sweep.

Die Konsolendaten stehen zusätzlich strukturiert in `viewer-palette-fest.r144.codex-results.json`. `null` in den ausgegebenen Tabellen steht dort auch für das als NaN gespeicherte offene Ende. Die Testquellen sind maßgeblich für Assertions und Ablauf.

## Reproduktion in einer isolierten Kopie

1. `git archive a81ac7d3` in ein eigenes temporäres Verzeichnis entpacken und dessen `lcnc-webui/node_modules` aus einer passenden Installation bereitstellen.
2. Die folgenden Belege an diese Stellen **der Kopie** kopieren:
   - `viewer-palette-fest.r144.codex-core.test.ts` → `lcnc-webui/src/viewer/r144.codex-core.test.ts`
   - `viewer-palette-fest.r144.codex-worker.test.ts` → `lcnc-webui/src/viewer/r144.codex-worker.test.ts`
   - `viewer-palette-fest.r144.codex-vitest.config.ts` → `lcnc-webui/vitest.codex-r144.config.ts`
3. Im kopierten `lcnc-webui`:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/r144.codex-core.test.ts src/viewer/r144.codex-worker.test.ts --config vitest.codex-r144.config.ts
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/contactStore.test.ts src/viewer/contactMerge.test.ts src/viewer/collisionWorker.test.ts src/viewer/collisionInside.test.ts --config vitest.codex-r144.config.ts
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/collision.test.ts --testNamePattern 'contact store' --config vitest.codex-r144.config.ts
```

Der erste Aufruf endet auf dem geprüften Stand mit Exit 1 und elf fehlgeschlagenen Tests, die anderen mit Exit 0. Der Kopf des Worker-Belegs nennt die Übernahme des vorhandenen Test-Harness; die fünf Abläufe darunter sind neue Gegenproben.

## Nicht als bestanden gewertet

Das Gesamtgate wurde nicht wiederholt. Die vorgelegten grünen Backend-/Frontend-Berichte und 34 roten Mutationen sind Claudes Belege, keine eigenen Läufe. Der kleine Fix in `e2e/run-hold.spec.ts` wurde gelesen, nicht im Browser erneut ausgeführt.

Breitere eigene Testaufrufe mit den teuren Modell-/Gegenvergleichsdateien lieferten zunächst nur den Vitest-Start und wurden abgebrochen (Exit 130); daraus wird weder ein bestandener Test noch ein Produktfehler abgeleitet. Ein früher Threads-Versuch mit der Repository-Konfiguration scheiterte an `--expose-gc` in `execArgv` (`ERR_WORKER_INVALID_EXEC_ARGV`); die mitgelieferte isolierte Konfiguration lässt dieses Argument weg. Die endgültigen 59 grünen Tests und elf roten Gegenproben liefen mit dieser Konfiguration regulär durch.

Die Abnahme der neuen Ansichten, ihre Ableitungen und die Kostenmessungen für Runde B bleiben separat. Die Befunde betreffen den neuen Speicher und seinen Transport. Eine bereits eingetretene Änderung der Live-Anzeige wird nicht behauptet: Die App liest in Runde A weiterhin die alte Senke.
