# R139 · Codex · Prüfprotokoll · 2026-10-12

Teil A: `feat/step4-p1`, `2371a617..6d5e20f7f9518b093cdd8060a3ee12f3543c8618`, ungemergt. Teil B: separat vorliegender, uncommitteter Plan `kollision-paket2.plan.md`, Fassung 1, SHA256 im Kontext und im Review. Die beigefügte eingefrorene Planfassung dient als unveränderliche Referenz für die Zeilenangaben.

Arbeitskopie: `git archive 6d5e20f7` nach `/tmp/codex-r139-p56dtkmu/src`. Vorhandene Abhängigkeiten als `node_modules`-Symlink. Kein Checkout/Build/Test im Live-Baum. Eigene Konfigurationen und Tests ausschließlich in der Archivkopie; ihr `e2e/ctl.ts` ist auf `127.0.0.1:4188` umgestellt. Alle Prozesse mit `nice -n 19`, maximal ein Testworker. Keine Live-Ports, Maschinenbefehle oder Neustarts. Playwright durfte per automatischer Sandbox-Eskalation den eigenen lokalen Mock binden; Trace aus.

## Ausführung und Ergebnisse

Im archivierten `lcnc-webui`, jeweils mit `nice -n 19`:

```sh
node node_modules/vite/bin/vite.js build --configLoader runner
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/firstContact.test.ts src/viewer/checkContext.test.ts src/viewer/checkWiring.test.ts src/viewer/scrubBarWords.test.ts src/viewer/collisionWorker.test.ts src/viewer/sweepMerge.test.ts src/viewer/sweepShards.test.ts src/viewer/startDepPayloads.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r139.codex-probe.test.ts src/viewer/r139.codex-side.test.ts -t 'R13[67] Codex'
node node_modules/@playwright/test/cli.js test --config playwright.review.config.ts --grep 'R13[78]:|Codex R13[78] VP-I93|a mixed result with the cap|continuation-only|uncapped|whole hit area'
node node_modules/@playwright/test/cli.js test --config playwright.review.config.ts --grep 'records cut, every beginning kept|nothing cut'
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r139.codex-plan.test.ts
```

- Build PASS (bestehende Größenwarnung der Bundles).
- Acht Repository-Dateien: 120 Tests PASS.
- Sieben eigene Ablauf-/Berechnungsproben PASS; 28 weitere Tests der kopierten Originaldatei hier abgewählt, ihre Originaldatei lief oben vollständig.
- Erster Browserlauf: 17 PASS. Sieben Repository-Wächter der Seitenanzeige (einschließlich der neuen R139-Fälle), sechs eigene R137/R138-Browserprüfungen, Summary-Hitfläche und drei Repository-Kappungslayouts.
- Zweiter Browserlauf: vier PASS, neue Repository-Kontrollen mit ausschließlich gekappten Fortsetzungen bzw. ohne Kappung, jeweils Desktop und Hochformat 150 %.
- Drei kleine Planproben PASS: Sie bestätigen die jeweils ausdrücklich behauptete Gegenbeobachtung. Kein eingebautes Paket 2 und kein roter Produkttest vorgetäuscht. Die Intervalle-/Rasterbeispiele sind analytisch; die Transportrechnung illustriert eine ohne Warteschlangenvertrag mögliche Pufferzahl, sie ist kein gemessener Heap.

Die Browserläufe liefen nacheinander und nach Abschluss der 120 Repositorytests. Kein Gesamtgate, kein Backend-, Firefox-, Live- oder Mac-Lauf. Claudes vorhandene Gate-/Mutationsbelege wurden gelesen, nicht verändert oder als eigene Ausführung ausgegeben.

## Alte Gegenproben

R138-Belege bleiben unverändert. Kopien heißen R139; Titel mit R136/R137/R138 bleiben absichtlich stehen. Ausgabepfade zeigen in das neue Arbeitsverzeichnis. Erwartungen der alten Gegenfälle bleiben erhalten.

Die Berechnungsprobe `codex-side.test.ts` benötigt die neue Schnittstelle: `startDependentOf` importiert; den tatsächlich geschriebenen `_colRunSideBase` zusätzlich aus `ThreeViewer.vue` entnommen; `collisionProgress` und `_colPendingTrack` im Harness gesetzt. Das sind Änderungen am Testaufbau, keine ersetzten Produktentscheidungen. Die übrige Ablaufprobe benutzt weiterhin den produktiven Koordinator mit synthetischen Sub-Worker-Meldungen und echtem lokalem Sweep. Eine Iterator-Probe je Pump-Aufruf steuert den Ablauf und misst keine Produktlatenz.

Die Seiten-Browserprobe benutzt das native `e_single.msgpack`, echten Decode und Haupt-Sweep. Die Seitenantwort und die Zustellreihenfolge sind kontrolliert; der erfundene Seitenkontakt ist ein Transport-Testfall. Keine Aussage, dass dieses Testprogramm dort tatsächlich kollidiert. Die Layoutprobe variiert allein die Datensatzkappung und misst Text, Geometrie und Touch-Hilfe.

## Belege und Wiederholung

`codex-tests.txt` enthält die vollständigen Ausgaben der obigen Schritte (nur ANSI-Farbcodes entfernt). Die JSONs enthalten die Ablaufmeldungen, berechneten Zustände und Browser-/Layoutbeobachtungen. Zwei ausgewählte Screenshots belegen die früher roten Fälle; beide wurden zusätzlich visuell geprüft.

Die vier kopierten TS-Testbelege in einer Archivkopie unter `src/viewer/r139.codex-probe.test.ts`, `src/viewer/r139.codex-side.test.ts`, `e2e/r139.codex-side.viewer.spec.ts` und `e2e/r139.codex-layout.viewer.spec.ts` ablegen; die Planprobe unter `src/viewer/r139.codex-plan.test.ts`. Konfigurationen auf `vitest.review.config.ts` bzw. `playwright.review.config.ts` kopieren. Absolute Ausgabe-/Cache-Pfade nötigenfalls ersetzen, `e2e/ctl.ts` auf denselben eigenen Mock einstellen. Die nativen Fixtures bleiben die des Zielstands.

## Integrität

Vor Ablage wurden alle neun im Review-Diff geänderten Dateien der Archivkopie byteweise gegen `git show 6d5e20f7:<Pfad>` geprüft. Sie sind unverändert. Nur Testaufbau, eigene Belege und die isolierte Mock-Port-Konfiguration wurden hinzugefügt/angepasst.

Im Live-Baum vor dem Anhängen geprüft: HEAD wie bei Beginn; Review-Präfix bytegleich; separat vorliegender Plan und alle vier R139-Belege Claudes per Hash unverändert. Der abschließende Status darf zusätzlich zum Anfangsstatus ausschließlich den Review-Anhang und neue `viewer-palette-fest.r139.codex-*`-Dateien enthalten. Der Handshake wird erst nach Ablage und Prüfung dieses Anhangs abgeschlossen.
