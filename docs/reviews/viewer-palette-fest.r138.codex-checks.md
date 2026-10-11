# R138 · Codex · Prüfprotokoll · 2026-10-11

Ziel: ungemergter Zweig `feat/step4-p1`, `2fd8c088..2371a617819eae4b39c0ccbab12594bc37f6f135`. Frisches `git archive 2371a617` nach `/tmp/codex-r138-0vg78d9n/src`; `node_modules` als Verweis auf vorhandene Abhängigkeiten. Keine Produktquellenänderung, kein Live-Build. Im Archiv eigene Testdateien/Konfigurationen und `e2e/ctl.ts` auf eigenen Mock 127.0.0.1:4188. Alle Prüfungen mit `nice -n 19`, ein Worker; Vite-Konfiguration über `--configLoader runner`, eigener Cache. Browserstart per automatischer Sandbox-Eskalation für den lokalen Mock, Trace aus.

## Befehle und Ergebnisse

Im archivierten `lcnc-webui`, jeweils mit `nice -n 19`:

```sh
node node_modules/vite/bin/vite.js build --configLoader runner
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/firstContact.test.ts src/viewer/checkContext.test.ts src/viewer/checkWiring.test.ts src/viewer/scrubBarWords.test.ts src/viewer/collisionWorker.test.ts src/viewer/sweepMerge.test.ts src/viewer/sweepShards.test.ts src/viewer/startDepPayloads.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r138.codex-probe.test.ts src/viewer/r138.codex-side.test.ts -t 'R13[67] Codex'
node node_modules/@playwright/test/cli.js test --config playwright.review.config.ts --grep 'R13[78]:|a mixed result with the cap|the summary.*whole hit area|a run.s bound beginning'
node node_modules/@playwright/test/cli.js test --config playwright.review.config.ts --grep 'R138: continuation-only'
```

- Build PASS. 8 Repository-Dateien / 118 Tests PASS.
- Sieben bisherige eigene Ablauf-/Berechnungsproben PASS; 28 andere Tests der kopierten Repository-Datei hier abgewählt (die Originaldatei lief oben).
- Erster Browserlauf: 10 PASS / 1 rot. Sechs Repository-Wächter (Seitenkontakt früh/endgültig, Fehler nach frühem Kontakt, drei gemischte Kappungslayouts, Summary-Hilfe-Hitfläche); vier eigene R137-Kontrollen (Seitenanzeige, drei Layoutvarianten) grün. Neuer R138-Fall „Seitenkontakt vor Hauptteilstand“ rot.
- Zweiter Browserlauf: ein gezielter neuer Fall „Fortsetzungen gekappt, Beginne vollständig“ rot. Dieser Test wurde erst nach dem ersten Browserlauf hinzugefügt und steht in der endgültigen Belegkopie mit den drei bisherigen Layoutfällen.

## Anpassung der alten Belege

Die R137-Dateien blieben unverändert. Neue Kopien:

- `codex-probe.test.ts`: Ausgabeziel/R138-Dateiname; den tatsächlichen neuen `_colEmitMarks` mit extrahiert und dessen zwei Eingaben für den getesteten Hauptteilstand bereitgestellt. Alte Erwartungen unverändert. Echter Koordinator-Rückfall mit synthetischen Sub-Worker-Meldungen und echtem lokalen Sweep, wie im R137-Beleg. Eine Iterator-Probe pro Pump-Aufruf dient der Nachrichtensteuerung, nicht einer Zeitmessung.
- `codex-side.test.ts`: tatsächlichen neuen Helfer `_colWithRunSide` in die Funktionsentnahme aufgenommen; `_colEmitMarks` im Berechnungs-Harness als No-op (die Marken selbst prüft der Browser). Alte Erwartung „start still checking“ unverändert.
- `codex-side.viewer.spec.ts`: alte Seitenprobe unverändert in ihren Erwartungen. Zusätzlicher Test hält die neuen Haupt-Sweep-Nachrichten zurück, liefert einen Seitenkontakt, danach einen aus dem echten Hauptresultat abgeleiteten laufenden Teilstand und anschließend beide Endergebnisse. Kein Vue-State und keine Entscheidung ersetzt. Erste Variante mit vorhandenem Hauptresultat bleibt grün; neue Vorstufe vor jedem Hauptteilstand rot; Kontrolle der eigentlichen `collisionPartialShown`-Bindung (Listenzeile und Code-Markierung) grün. Die Positionsdaten kommen aus dem nativen `e_single.msgpack`; gemeldeter Seitenkontakt ist ein Transport-Testfall, keine Geometriebehauptung.
- `codex-layout.viewer.spec.ts`: die lange Kappungsaussage wird am vollständigen zugänglichen Namen geprüft, weil Form 3 sie jetzt absichtlich kurz darstellt. Die Hilfe wird in jeder Form geprüft, auch wenn kein Text mehr abgeschnitten ist. Neue Variante ersetzt ausschließlich `cappedOnsets: 2` durch `0` bei weiterhin 25 gekappten Datensätzen; damit sind alle 200 Beginne erhalten, nur Fortsetzungen fehlen. Im letzten Formular fehlt nun das sichtbare Kappungskennzeichen; Hilfe und Rechteckprüfung bestehen. Keine Geometriebehauptung.

## Dateien und Wiederholung

`codex-tests.txt` enthält unveränderte Ausgaben ohne ANSI-Farbcodes aus Build, gezielten Repository-Tests, eigenen Proben und beiden Browserläufen. JSONs enthalten Nachrichten, berechnete Zustände, sichtbare Browserphasen und Layout-/Hilfemessungen. Screenshots zeigen die beiden Gegenproben sowie die positive Teilstandskontrolle und korrigierte normale Hochformatanzeige.

Die TS-Belege zur Wiederholung in eine Archivkopie des Zielstands unter die in den Befehlen genannten `src/viewer/`- bzw. `e2e/`-Dateinamen kopieren. Konfigurationen heißen dort `vitest.review.config.ts` und `playwright.review.config.ts`; gegebenenfalls absolute `/tmp`-Pfade für Ausgaben/Cache anpassen. Archiv-`e2e/ctl.ts` auf eigenen Mock-Port legen. Native Fixtures unverändert aus dem Zielstand. Titel mit R136/R137 bleiben absichtlich in übernommenen Gegenproben stehen.

## Grenzen und Integrität

Keine Live-Ports :5173/:8000, keine Maschinenbefehle/Neustarts, kein Backend-/Gesamtgate-/Firefox-/Mac-Lauf. Claudes Mess-, Gate- und Mutationsdateien nur gelesen. Alle elf im Review-Diff geänderten Dateien im Archiv vor der Ablage byteweise gegen `git show 2371a617:<Pfad>` geprüft. Vorhandene uncommittete Review-Datei als Präfix und Claudes sechs R138-Belege per Hash gesichert; Live-HEAD unverändert. Nur Review-Anhang und neue `r138.codex-*`-Belege werden im Live-Baum geschrieben.
