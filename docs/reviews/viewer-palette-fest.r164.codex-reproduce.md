# Codex R164: Reproduktion

Prüfstand `2f60ec1a`, `git archive` nach `/tmp/codex-r164-vcwdgmoa/repo`. Eigene Kopie vorhandener node_modules aus R163. Vor dem Einfügen der Sonden: `nice -n 15 npm run build` — PASS. Alle 378 verfolgten Produktquelldateien unter `lcnc-webui/src` stimmen mit den Git-Blobs überein. Keine Produktänderung.

## Gezielter Lauf

Beiliegende `vitest.config.ts` als `vitest.codex-r164.config.ts`; `schedule.probe.test.ts` als `src/viewer/codexR164Schedule.test.ts`. Unveränderte `viewer-palette-fest.r158.codex-publisher.probe.test.ts` als `src/viewer/codexR157Publisher.test.ts`. Ausgabeordner vorher anlegen.

```sh
R158_OUT=/tmp/r164-out R164_OUT=/tmp/r164-out nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r164.config.ts src/viewer/steps.test.ts src/viewer/contactPublisher.test.ts src/viewer/shownContacts.test.ts src/viewer/checkWiring.test.ts src/viewer/codexR157Publisher.test.ts src/viewer/codexR164Schedule.test.ts
```

83/83 PASS in sechs Dateien, 2,44 s. Die drei eigenen Prüfungen ergänzen:

- 200 deterministische Mischungen aus zurückgehaltenen Nachrichten und Frames, jeweils 80 rekursiv eingereihte Aufgaben: genau einmal, in Einreihungsfolge; höchstens eine ausstehende Nachricht und ein angeforderter Frame. Danach eine alte Nachricht nach leerer Warteschlange und Wiederverwendung ohne Frame-Lieferung. 16.000 Aufgaben plus 200 Wiederverwendungen.
- Abbruch nach Frame-Übernahme, neuer Lauf auf demselben Planer, verspätete Nachricht: der alte Generator läuft nicht weiter und veröffentlicht nichts; der neue beendet genau einmal.
- Fehler eines Generators beendet seinen Lauf genau einmal; ein zweiter Lauf auf demselben Planer bleibt ausführbar.

Der Test ohne Frame-Lieferung prüft die Ablaufregel für diesen Fall; er ist keine reale Messung eines verborgenen Browser-Tabs. Kein erneuter Lauf der unveränderten großen Kontaktgeometrie-Suiten.

## Browser

Unveränderte Messspezifikationen:

- `viewer-palette-fest.r159.longtask.viewer.spec.ts` als `e2e/codex-r164-longtask.viewer.spec.ts`;
- `viewer-palette-fest.r163.codex-roundoff.viewer.spec.ts` als `e2e/codex-r164-roundoff.viewer.spec.ts`.

Beiliegende `playwright.config.ts` als `playwright.codex-r164.config.ts`. Nur in der Archivkopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen.

```sh
LT_OUT=/tmp/r164-out/browser-keys.json LT_KEYS=1 nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r164.config.ts
LT_OUT=/tmp/r164-out/browser-pointer.json LT_KINDS=wideDecimal nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r164.config.ts e2e/codex-r164-roundoff.viewer.spec.ts
```

JSON-Ausgaben vorher nicht vorhanden (Spezifikationen hängen an). Ein Chromium-Worker, Trace aus, kein paralleler CPU-Lauf; eigener Mock ausschließlich auf `127.0.0.1:4188`, freigegebene Ausführung außerhalb der Sandbox wegen des Bindeverbots. 4/4 PASS mit Tasten in 54,5 s, 1/1 ohne Tasten in 7,9 s.

**`LT_KEYS=1` ruft wiederholt `page.keyboard.press("Shift")` auf:** Keydown und Keyup je Schleifendurchlauf, nicht eine durchgehend gehaltene Taste. Die Verzögerung von Keydown wird zwischen `event.timeStamp` und dem Capture-Handler gemessen. Keine Prüfung eines realen Maschinenbefehls und kein Nachweis seiner End-to-End-Latenz.

## Leistungsabnahme separat

Die Browser-Spezifikationen prüfen den Ablauf und schreiben Messwerte, ohne die 50-ms-Grenze durchzusetzen. Die beigefügte Auswertung macht diese Grenze explizit:

```sh
python3 acceptance.py browser-keys.json acceptance.json
```

Erwartung: **Exit 1**, weil die erste Ankunft in jeder der vier Formen eine 60–64-ms-Aufgabe meldet. Die JSON-Datei dokumentiert zusätzlich 59–64 ms maximale Shift-Verzögerung. Diese Auswertung ist ein Gegenbeleg zur vollständigen Leistungsabnahme, kein fehlgeschlagener Funktionstest.

Claudes vollständiges Gate und Mutationsergebnisse gelesen, nicht erneut vollständig ausgeführt. Im Live-Baum nur Review-Anhang, neue `r164.codex-*`-Belege und abschließend Handshake. Keine Live-Ports, keine realen Maschinenbefehle.
