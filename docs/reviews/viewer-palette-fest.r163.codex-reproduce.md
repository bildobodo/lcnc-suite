# Codex R163: Reproduktion

Prüfstand `8265e1bb`, `git archive` nach `/tmp/codex-r163-ogu16214/repo`. Eigene Kopie der bereits vorhandenen node_modules aus dem R162-Prüfstand. Vor dem Einfügen eigener Sonden: `nice -n 15 npm run build` (PASS). Alle 378 verfolgten Dateien unter `lcnc-webui/src` gegen die Git-Blobs geprüft. Keine Produktänderung.

## Gezielte Prüfungen

Konfiguration `viewer-palette-fest.r163.codex-vitest.config.ts` ins UI-Verzeichnis als `vitest.codex-r163.config.ts`. Die elf früheren Sonden aus der [R162-Reproduktion](viewer-palette-fest.r162.codex-reproduce.md) unverändert kopieren, zusätzlich die dort separat ausgeführte `viewer-palette-fest.r162.codex-roundoff.probe.test.ts` nach `src/viewer/codexR162Roundoff.test.ts`. Die 24 Dateinamen stehen in `viewer-palette-fest.r163.codex-tests.txt`.

```sh
R158_OUT=/tmp/r163-out R159_OUT=/tmp/r163-out R160_OUT=/tmp/r163-out R161_OUT=/tmp/r163-out R162_OUT=/tmp/r163-out nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r163.config.ts $(cat /tmp/r163-tests.txt)
```

Ausgabeordner vorher anlegen, beiliegende Dateiliste als `/tmp/r163-tests.txt` ablegen. Ergebnis: 239/239 PASS in 24 Dateien, 121,01 s. Die unveränderte Rundungsprobe enthält bei `rounding.lower/upper` weiterhin die alte reine Radiusrechnung als Diagnose; das sind **nicht** die neuen begrenzten Produktgrenzen. Die Flags, Schlüssel und Zugriffszahlen stammen aus dem neuen Produkt.

## Zusätzliche Erhaltungsprobe

`viewer-palette-fest.r163.codex-points.probe.test.ts` nach `src/viewer/codexR163Points.test.ts`:

```sh
R163_OUT=/tmp/r163-out nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r163.config.ts src/viewer/codexR163Points.test.ts
```

724 Fälle: zwei gerichtete Rundungsformen über sieben Skalierungen, acht Verschiebungen und beide Generationen-Zuordnungen, dazu 500 deterministische Zufallsfälle. Keine nachgeschriebene Schnittregel: geprüft werden der Erhalt jedes bestätigten Punkts, freie Proben außerhalb des Kontakts (außer bei direktem Widerspruch durch einen bestätigten Punkt), exakte Struktur sowie die Übereinstimmung von aufgebauten Stücken mit `pieceFrom`, mit und ohne Zeugenfenster. 5.068 Punktprüfungen, 618 Freiproben, 2.684 abgefragte Stücke; PASS.

Gegenbeweis in eigener Minimal-Kopie `/tmp/codex-r163-ogu16214/before-ui`: identische Sonde, identische `steps.ts`, `contactUnion.ts` aus `git show 668b39f5:lcnc-webui/src/viewer/contactUnion.ts`. Rot am verlorenen bestätigten Punkt; keine Mutation im eigentlichen Prüfstand. Ausgabe `points-before.txt`.

## Browser

`viewer-palette-fest.r163.codex-roundoff.viewer.spec.ts` nach `e2e/codex-r163-roundoff.viewer.spec.ts`; beiliegende Playwright-Konfiguration als `playwright.codex-r163.config.ts`. Nur im Archiv `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen.

Spezifikation aus `viewer-palette-fest.r162.shapes-r160.viewer.spec.ts`, mit zusätzlicher Form `wideDecimal`: das Rundungspaar der Node-Probe ergänzt die große `widePair`-Form; vier Zusatzintervalle innerhalb der Grenze von 262.144 Intervallen der gehaltenen Generation. Skalierung der Dezimalwerte ausschließlich um eine Zweierpotenz, um in die Track-Achse zu passen; explizite Assertion, dass `p - (p - w) < w` bleibt. Das Produkt wird unverändert ausgeliefert. Ablauf: erste Generation, Rückfall/Vereinigung, öffentliche Abfragen.

```sh
LT_OUT=/tmp/r163-out/browser-metrics.json LT_KEYS=1 nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r163.config.ts
LT_OUT=/tmp/r163-out/browser-pointer-metrics.json LT_KINDS=wideDecimal nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r163.config.ts
```

Beide Ausgabedateien vorher nicht vorhanden (Spezifikation hängt an). Ein Chromium-Worker, Trace aus, kein paralleler CPU-Test. Eigener Mock ausschließlich auf `127.0.0.1:4188`; wegen des Sandbox-Bindeverbots freigegebene Ausführung außerhalb der Sandbox. Erster Lauf 2/2 PASS in 2,9 min, Vergleich ohne `LT_KEYS` 1/1 PASS in 9,9 s. `LT_KEYS=1` sendet zwischen den Zustandsabfragen fortlaufend Shift (keinen Maschinenbefehl). Der Vergleich wurde wegen der auffällig langen Aufbauzeiten unter diesen Eingaben ergänzt; diese Einzelmessungen weisen deren Ursache nicht abschließend nach.

Die Browser-Assertions sind Ablaufprüfungen, keine automatische 50-ms-Freigabe. Lange Aufgaben, Eingabelatenzen, Phasenschritte, Aufbauzeit und Speicher separat aus den JSON-Dateien beurteilen. Kein Programmwechsel und keine Prüfung eines realen E-Stop in dieser Messung; kein vollständiges Gate erneut ausgeführt. Claudes Gate-/Mutationsbelege nur gelesen. Im Live-Baum nur Review-Anhang, neue `r163.codex-*`-Belege und anschließend Handshake.
