# R137 · Codex · Prüfprotokoll · 2026-10-11

Ziel: `feat/step4-p1`, `c8dc258b..2fd8c08862755fc03197adeba64d24bf16d6da48`, ungemergt. Live-Reviewbaum beim Beginn: `5fee11ddf89ea77e88c2fc0bb8e5f811be2d677b`. Nur Review-Anhang und neue Belege im Live-Baum.

## Isolation

`git archive 2fd8c088` wurde nach `/tmp/codex-r137-0s9wgq_s/src` entpackt. Dessen `lcnc-webui/node_modules` verweist auf die vorhandenen Abhängigkeiten. Eigener Vite-Cache, Konfigurationsladen mit `--configLoader runner`; Build ausschließlich im Archiv. Kein Produktcode im Archiv verändert. Nur neue Testdateien/Konfigurationen und `e2e/ctl.ts` auf `127.0.0.1:4188` umgestellt. Chromium/Mock mit automatischer Sandbox-Eskalation nach lokalem `listen EPERM`, ein Worker, `nice -n 19`, Trace aus. Keine Verbindung zur laufenden Suite :5173/:8000 und keine Maschinenbefehle.

## Ausgeführte Prüfungen

Alle folgenden Befehle im archivierten `lcnc-webui`; vorne jeweils `nice -n 19`:

```sh
node node_modules/vite/bin/vite.js build --configLoader runner
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/firstContact.test.ts src/viewer/checkContext.test.ts src/viewer/checkWiring.test.ts src/viewer/scrubBarWords.test.ts src/viewer/collisionWorker.test.ts src/viewer/sweepMerge.test.ts src/viewer/sweepShards.test.ts src/viewer/startDepPayloads.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r137.codex-probe.test.ts src/viewer/r137.codex-side.test.ts -t 'R13[67] Codex'
node node_modules/@playwright/test/cli.js test --config playwright.review.config.ts --grep 'R137:|a mixed result with the cap|the summary.*whole hit area'
node node_modules/@playwright/test/cli.js test --config playwright.review.config.ts --grep 'R137: mixed summary,'
```

- Build grün; 8 Repository-Testdateien / 115 Tests grün.
- `codex-probe.test.ts`: R136-Beleg als neue Kopie; `_colFirstHeld` und neue Helfer ergänzt, Emissionen aufgezeichnet. Alte vier Erwartungen unverändert grün. Zwei neue rote Prüfungen: Code-Markierung nach älterem Teilstand; Pool-Ausfall nach bestätigendem Teilstand. Letztere benutzt produktiven Koordinator und echten lokalen Sweep, synthetische Shard-Nachrichten; eine Probe je Pump-Aufruf zur deterministischen Nachrichtensteuerung, keine Zeitmessung. Der erste Entwurf mit zwei kontaktfreien Punkten erzeugte keinen lokalen Teilstand und wurde deshalb **nicht** als Befund verwendet; endgültig 2001 Punkte mit lokalem Beinahekontakt, Vorbedingung tatsächlicher Teilstand grün, danach Verlust des zuvor berichteten Kontakts rot.
- `codex-side.test.ts`: Kopie von `startDepPayloads.test.ts` am Zielstand mit einer zusätzlichen Prüfung. Verwendet unveränderte extrahierte Viewer-Funktionen und `sweepView`; statt der leeren Zielliste des ursprünglichen Testhelfers liest diese Kopie `clashTargets(result.hits)`. Native Nutzlast `e_single.msgpack`, keine Produktänderung. 28 andere Tests hier absichtlich abgewählt (Originaldatei lief bereits oben). Früher Kontakt + `begin: checking`, aber `checked in full` → rot.
- Vier Repository-Browserwächter grün: drei gemischte/Kappungs-Layouts und die Trefferfläche des Summary-„?“.
- `codex-side.viewer.spec.ts`: reale Vue-Seite, echtes natives Payload, Decode und Hauptprüfung, Mock-Laufstart mit Gelenken. Der Seitenauftrag wird am Worker-Transport gehalten und mit einem bekannten Testkontakt, später einem passenden Endergebnis beantwortet. Sichtbare Liste und Übersicht bleiben ohne den Kontakt; protokolliertes `beginning` beweist die Annahme. Keine Behauptung einer geometrischen Kollision des Fixtures; dies prüft die Übergabe eines Befunds.
- `codex-layout.viewer.spec.ts`: R136-Darstellungsfixture (200 aufbewahrte Beginne, 25 gekappte Einträge, davon 2 Beginne). Keine Geometriebehauptung. Endgültige drei Varianten: Desktop/Querformat grün; 150 % Hochformat mit normalen Zählern rot, weil die abgeschnittene Aussage im zugehörigen „?“ fehlt. Vorher bestand die unveränderte breite R136-Rechteckprüfung bereits.

## Artefakte

`codex-tests.txt` vereinigt Build, Repository-Tests und endgültige Probeausgaben (einschließlich erstem Browserlauf mit ursprünglicher breiter Layoutprobe; deren erweiterte Endfassung lief anschließend separat). Die ersten Entwürfe mit ungenügenden Vorbedingungen sind dort nicht als endgültige Prüfungen enthalten.

`codex-probe.json` enthält die Original-R136-Folgen plus die neuen Markierungs- und Rückfallfolgen. `codex-side-words.json` enthält den tatsächlichen berechneten Zustand. `codex-side-browser.json` hält drei Phasen des Browserablaufs fest. `codex-summary-{desktop,touch-landscape,touch-portrait}.json` enthält Rechtecke, CSS-Maße des Texts, zugänglichen Namen und geöffneten Hilfeinhalt. Bilder: breite positive Kontrolle, Touch-Gegenprobe, frühe und endgültige Seitenanzeige.

Die abgelegten TS-Dateien sind Review-Belege: zum Wiederholen in einer neuen Archivkopie an die hier genannten `src/viewer/`- bzw. `e2e/`-Pfade kopieren. Konfigurationen heißen dort `vitest.review.config.ts` und `playwright.review.config.ts`. Absolute `/tmp`-Ausgabe-/Cachepfade gegebenenfalls auf das neue Verzeichnis ändern. `e2e/ctl.ts` des Archivs ebenfalls auf den eigenen Mock-Port legen. Referenzierte native Fixtures kommen unverändert aus dem Ziel-Commit.

## Grenzen

Kein Gesamtgate erneut gefahren, kein Python geändert/geprüft, kein Firefox-/Mac-/Live-Test. Claudes bestehende Gate- und Mutationsbelege nur gelesen. Eigene Proben sind Funktions-/Darstellungsnachweise, keine Reaktionszeitmessung. Prüfpunkt-Abstände aus Claudes Messdatei sind nicht gleich einer gemessenen Stop/Cancel-Nachricht-bis-Bestätigung-Latenz.
