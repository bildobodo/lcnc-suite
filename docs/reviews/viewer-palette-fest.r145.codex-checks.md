# R145 · Codex · Prüfprotokoll · 13. Oktober 2026

## Stand und Schutz des Live-Baums

- Prüfumfang: `a81ac7d3..0426c923`, `feat/step4-p2`, ungemergt.
- Isolierte Archivkopie: `/tmp/codex-r145-mkz1nrvc/repo`, aus `git archive 0426c923`. Vorhandene Abhängigkeiten in die Kopie übernommen, ein Vitest-Thread, `nice -n 15`.
- Live-HEAD: `3f64fe7b8fa21897547505988b61a45467118820`.
- Eingefroren: vollständiger Reviewtext vor dem Anhang, Plan Fassung 5 und alle vier Claude-Belege für R145. Hashes/Anfangsstatus: `viewer-palette-fest.r145.codex-context.json`.
- Alle zehn im Codebereich geänderten Archivdateien wurden vor der Veröffentlichung bytegenau gegen den Commit geprüft. Keine Produktänderungen, auch nicht im Testarchiv. Im Live-Baum nur Anhang und neue `r145.codex-*`-Belege; keine Builds, Browser, Live-Ports oder Maschinenbefehle.

## Abgeschlossene eigene Tests

| Auswahl | Ergebnis | Protokoll |
|---|---|---|
| R144-Proben als angepasste Kopien (6 Kern-, 5 Worker-Fälle) + `contactStore`, `contactMerge`, `collisionWorker`, `collisionInside` vollständig | 71 bestanden = 11 Gegenproben + 60 Repositorytests | `viewer-palette-fest.r145.codex-regressions.txt` |
| `collision.test.ts`, Namensfilter `contact store` | 11 bestanden, 114 nicht ausgewählt | `viewer-palette-fest.r145.codex-repository-sink.txt` |
| `sweepShards.test.ts`, Namensfilter `mergeShardResults` | 8 bestanden, 5 nicht ausgewählt | `viewer-palette-fest.r145.codex-repository-shards.txt` |
| Neue Übergangsproben: Pool-Drain und Budgetfehler in `finish` | 2 rot, 1 positive Kontrolle bestanden | `viewer-palette-fest.r145.codex-rest-probes.txt` |

**Insgesamt 91 bestanden, zwei neue Gegenproben rot.** Davon 79 Repositorytests, alle elf bisherigen R144-Gegenproben und eine neue positive Transportkontrolle grün. Kein eigenes Gesamtgate. Die vorgelegten 2263 Vitest-/521 Browserergebnisse, 48 roten Mutationen und der Korpusvergleich sind Claudes Belege, wurden gelesen und nicht erneut als Gesamtpaket ausgeführt.

## Anpassungen der bisherigen Proben

Die R144-Belege bleiben unverändert. Nur neue Kopien wurden auf die neuen Schnittstellen umgestellt:

- `entryJoins` erhält statt der Anfahrtlänge jetzt `baseStart`. In den beiden R144-Fällen ist der Basispunkt 0; deshalb wurde das dritte Argument weggelassen.
- Die bisherigen Bestätigungen im Worker-Beleg erhalten `generation: 0`.
- Keine Erwartung/Assertion der elf R144-Fälle wurde geändert.

Die vollständigen Kopien sind `viewer-palette-fest.r145.codex-r144-core.test.ts` und `viewer-palette-fest.r145.codex-r144-worker.test.ts`.

## Neue Gegenproben und Aussagegrenze

**Pool:** Der echte Koordinator wird mit demselben Fake-Worker-Harness wie die Repositorytests ausgeführt. Bei zwei schon übernommenen Zeilen, verzögertem Besitzer-ACK und Workerfehler sendet er Generationen `[0,1,0]`. Vor dem ersten ACK stehen zwei Besitzer-Nachrichten aus. Ein kleiner Empfänger nach Plan 3.1/3.5 (alte Generation nach Wechsel verwerfen, bereits gelieferte alte Belege behalten) verwirft dadurch eine nachgereichte alte Zeile. Das ist eine Vertragsprobe des neuen Transports, keine Behauptung über einen bereits umgestellten Viewer. Die Kontrolle ohne Ausfall hat nur ein ausstehendes Delta und liefert beide Zeilen.

**Abschlussbudget:** Echter Sweep eines 1-mm-Körpers durch einen hohlen 60-mm-Körper mit 40-mm-Hohlraum, X = `[40,30,19]`. Die bestehende `insideCheck`-Testnaht gibt an einer Zwischenstelle der Abschlussbisektion `undecidable` zurück (Repräsentantenkoordinate `19.7 < x < 19.9`); die Endpose bleibt entschieden frei. Ein beobachtender Wrapper um `store.gaps.append` protokolliert die Stelle und den Aufruf aus `finish`, ändert aber weder Argumente noch Rückgabewert. Mit Platz wird die Lücke bei cum 20.75 gespeichert; mit künstlich vollem Lückenbudget wird genau derselbe Schreibversuch abgewiesen. Trotzdem bleibt `truncated = null`, und `incompleteFrom` fehlt. Die positiven Vorbedingungen der roten Assertion bestehen. Das ist keine Messung der Häufigkeit solcher Innenantworten auf realen Modellen.

Eine erste Suchfassung dieser Abschlussprobe traf die unentscheidbare Zwischenstelle nicht und scheiterte deshalb an ihrer eigenen Vorbedingung; sie wurde verworfen und zählt nicht als Produktbefund. Veröffentlicht ist nur die oben beschriebene reproduzierende Fassung mit erfolgreicher Kontrollausführung.

## Reproduktion

Die Belege ausschließlich in eine neue Archivkopie von `0426c923` kopieren, mit passenden `node_modules`:

- `codex-r144-core.test.ts` → `lcnc-webui/src/viewer/r145.codex-r144-core.test.ts`
- `codex-r144-worker.test.ts` → `lcnc-webui/src/viewer/r145.codex-r144-worker.test.ts`
- `codex-worker-rest.test.ts` → `lcnc-webui/src/viewer/r145.codex-worker-rest.test.ts`
- `codex-finish.test.ts` → `lcnc-webui/src/viewer/r145.codex-finish.test.ts`
- `codex-vitest.config.ts` → `lcnc-webui/vitest.codex-r145.config.ts`

Die linken Namen sind jeweils um `viewer-palette-fest.r145.` zu ergänzen. Im kopierten `lcnc-webui`:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/r145.codex-r144-core.test.ts src/viewer/r145.codex-r144-worker.test.ts src/viewer/contactStore.test.ts src/viewer/contactMerge.test.ts src/viewer/collisionWorker.test.ts src/viewer/collisionInside.test.ts --config vitest.codex-r145.config.ts
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/collision.test.ts --testNamePattern 'contact store' --config vitest.codex-r145.config.ts
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/sweepShards.test.ts --testNamePattern 'mergeShardResults' --config vitest.codex-r145.config.ts
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/r145.codex-worker-rest.test.ts src/viewer/r145.codex-finish.test.ts --config vitest.codex-r145.config.ts
```

Auf dem geprüften Stand: die ersten drei Aufrufe Exit 0; der letzte Exit 1 mit zwei roten Tests und einer grünen Kontrolle. Die Pool-Probe enthält zwei `expect.soft`-Assertions; deshalb erscheinen im Log drei fehlgeschlagene Assertions bei zwei fehlgeschlagenen Tests. Der normale Vitest-Reporter blendet Konsolenausgaben bestandener Tests aus. Die Daten der beiden roten Proben stehen zusätzlich in `viewer-palette-fest.r145.codex-results.json`.
