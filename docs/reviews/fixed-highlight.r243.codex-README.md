# R243 · FH-04-Nachprüfung

Archiv `4ad87515`, `/tmp/codex-r243-jzy7bm44/repo`; eigener Mock `127.0.0.1:4188`, beendet. Kein Live-Zugriff, kein Produktcode geändert. Die R242-Belege bleiben unverändert.

## Reproduktion

In einer eigenen Archivkopie mit passenden Abhängigkeiten zuerst `npm run build` in `lcnc-webui`. Anschließend `probe.spec.ts` als `e2e/r243.codex.spec.ts` und `config.ts` als `playwright.r243.config.ts` ablegen. Die Browserprobe ist die R242-Probe mit lediglich neuem `OUT`-Verzeichnis; ausschließlich die zwei FH-04-Fälle wurden ausgewählt. Beim Wiederholen `OUT` an ein vorhandenes temporäres Verzeichnis anpassen. Die Testhelfer der Archivkopie verwenden `127.0.0.1:4188` anstelle von `localhost:4174`.

- Mock: `MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs`.
- Browser: `npx playwright test -c playwright.r243.config.ts e2e/r243.codex.spec.ts e2e/layout.spec.ts --grep 'run subroutine name|a run in a subroutine names it|in an expanded subroutine the highlight'`.
- Unit: `npx vitest run src/propShadow.test.ts src/tsconfigCoverage.test.ts src/codeGlide.test.ts src/subRows.test.ts`.

`guard-probe.mjs` im Archiv neben `package.json` ablegen und mit Node ausführen; seinen Ausgabepfad bei Bedarf anpassen. Es verwendet die Funktionen des eingereichten Scanners und den installierten Vue-Compiler. Die frühere FH-04-Bindung wird nur in einem String wiederhergestellt, keine Komponentendatei geändert. Weitere In-Memory-Fälle prüfen Computed, Runtime-Objekt, direkten Prop-Alias und zwei Grenzen der Syntaxabdeckung.

## Ergebnis

Build grün, 18 Unit-Tests grün, fünf Browserfälle grün (drei Repository-Wächter und zwei unveränderte Gegenproben). `name-cases.json` zeigt den Unterprogrammhinweis in beiden Herkunftsfällen. `guard-probe.json` belegt den Compiler-Bindungstyp `props` am neuen Namen sowie die Erkennung von `setup-ref` beim in-memory wiederhergestellten FH-04. Der Scan liest aktuell 56 Komponenten auf der obersten src-Ebene, davon 51 mit insgesamt 329 aufgelösten Props.

Benannte, nicht blockierende Reichweitengrenzen des zusätzlichen Scans: Runtime-Props als Array werden nicht erfasst; `toRefs(props)` wird als gesamte Deklaration ausgenommen, auch bei einem umbenannten Alias einer anderen Prop. Diese Formen erzeugen in den isolierten Beispielen keine Meldung. Sie sind keine verbliebenen FH-04-Produktbefunde; die vorhandenen Alias-Stellen verwenden die gleichnamige Prop. Bei Einführung solcher Formen muss der Scan entsprechend erweitert werden. Er ersetzt die Browserprüfung des sichtbaren Herkunftshinweises nicht.

`metadata.json` dokumentiert den Quellenvergleich und den unveränderten Review-Präfix; `validation.txt` enthält die Laufprotokolle. Bereits abgenommene, unveränderte Full-HD-/Perf-/Scroll-Pakete und das gesamte Gate wurden nicht erneut ausgeführt.
