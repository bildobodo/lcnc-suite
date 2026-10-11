# R136 · Codex · Prüfprotokoll

Geprüft: `feat/step4-p1`, `813f1e36..c8dc258b`, Plan `kollision-schritt4.plan.md`, Paket 1. Keine Produktkorrektur. Archiv unter `/tmp/codex-r136-bapg7k2b/src`; alle 35 im Commitbereich geänderten Dateien anschließend bytegleich mit `git show c8dc258b:<Datei>` geprüft. Live-HEAD blieb `813f1e36`. Claudes bereits vorhandener Review-Text und fünf R136-Belege waren beim Schreiben unverändert.

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Neun Repository-Dateien: `checkContext`, `checkWiring`, `scrubBarWords`, `sweepWords`, `collision`, `collisionWorker`, `sweepMerge`, `sweepShards`, `startDepPayloads` | 218 Tests PASS, 160 s |
| Eigene Ablaufprobe, produktiver Worker-Koordinator und aus `ThreeViewer.vue` extrahierte unveränderte Funktionsrümpfe | Drei rote Vertragsprüfungen: doppelter Kontakt, Zurückstufung durch Pool-Zwischenstand, kein früher Seitenbefund. Eine positive Kontrolle PASS: anderer Beinahekontakt bleibt, reine Fortschrittsmeldung und fremde Request-ID löschen den ersten Kontakt nicht. |
| Karte im Browser: eingefrorene Grundlage, Statuswechsel, Enter/Escape; Touch und Schließen | Zwei vorhandene Tests PASS |
| Karte und Befunde beim Wechsel vom vorläufigen zum vollständigen Laufergebnis | Vorhandener Browser-Test PASS |
| Eigene Darstellung eines gemischten, gekappten Ergebnisses bei 1600 × 1000 | Rot: erstes Übersichtsitem 709 px, sichtbare Übersicht 495,5 px; zwei weitere Kategorien außerhalb. Screenshot und JSON abgelegt. |
| Vite-Build in der Archivkopie | PASS; kein eigener Typecheck-/Gesamtgate-Lauf |

Die Seitenprobe bindet eine Spur mit 2001 Punkten und `depEnd = 2001` über das produktive `buildEntryTrack` und schneidet sie wie der Viewer: 2002 Punkte im Seitenauftrag. Der echte Sweep findet eine Kollision. Von 135 Meldungen enthält erst das Endergebnis den Befund. Die Probe ersetzt ausschließlich die Zeitscheibe durch einen Iterator-Schritt, damit die Zwischenzustände deterministisch beobachtbar sind; sie ist **keine Laufzeitmessung**.

Die Poolprobe betreibt den echten Koordinator mit nachgebildeten Unterworkern: erster Zwischenstand bei t=0, zurückgehaltener Stand eines weiteren Shards bei t=100 ms, erster bestätigter Kontakt bei t=600 ms. Alle ausgehenden Nachrichten gehen anschließend durch den tatsächlichen Viewer-Handler. Der Befund wird wieder zum Beinahekontakt. Die Ausgabe enthält die Nachrichtenfolge und die daraus abgeleiteten Benutzertexte.

Die Browserprobe ersetzt nur das Worker-Endergebnis durch einen Darstellungstestfall: 200 erhaltene Kontaktbeginne (197 Kollisionen, eine Anfahrkollision, ein möglicher Kontakt, ein Beinahekontakt), 25 ausgelassene Einträge, darunter zwei weitere Beginne. Sie behauptet keine solche Geometrie im Layout-Mock. Der erste explorative Versuch hatte dessen `pairCount = 0` beibehalten und zeigte deshalb korrekt „No moving pairs“; er war kein Layoutnachweis. Das vollständige Testprotokoll trennt diesen Versuch vom abschließenden, konsistenten Fall.

## Wiederholung

Archiv von `c8dc258b` in einem separaten Verzeichnis erstellen; Abhängigkeiten installieren oder vorhandene `lcnc-webui/node_modules` verwenden. Keine Prüfung im Live-Checkout starten.

1. `codex-probe.test.ts` als `lcnc-webui/src/viewer/r136.codex-probe.test.ts` ablegen; `codex-vitest.config.ts` als `lcnc-webui/vitest.review.config.ts`. Die Ausgaben nutzen `/tmp/codex-r136-bapg7k2b`; Verzeichnis vorher anlegen oder den Ausgabepfad in der Sondenkopie ändern.
2. Aus `lcnc-webui`: `nice -n 19 node node_modules/vitest/vitest.mjs run --config vitest.review.config.ts --configLoader runner src/viewer/r136.codex-probe.test.ts`. Erwartet am Review-Stand: 3 FAIL, 1 PASS.
3. Browserprobe als `e2e/r136.codex.viewer.spec.ts`, Browserkonfiguration als `playwright.review.config.ts` ablegen. In der **Archivkopie** `e2e/ctl.ts` von `localhost:4174` auf `127.0.0.1:4188` umstellen. Build: `nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner`.
4. `nice -n 19 node node_modules/@playwright/test/cli.js test --config playwright.review.config.ts --grep 'R136: mixed'`. Erwartet: eine rote Layoutprüfung. Die Konfiguration startet und beendet ihren eigenen Mock auf `127.0.0.1:4188` und benutzt keine vorhandene Instanz.
5. Positive Browserfälle: dieselbe Konfiguration mit `--grep 'check basis card|the provisional result keeps its own limits'` (drei Tests).

Die Sandbox untersagte zunächst das Binden des Mock-Ports (`EPERM`); die automatische Freigabe erlaubte die isolierten Browserläufe anschließend. Keine Ablehnung offen. Kein Zugriff auf :5173/:8000, keine Maschinenbefehle, kein Sim-Neustart. Escape wurde ausschließlich gegen den Mock geprüft.

## Aussagegrenzen

Claudes Gate-Berichte (Backend `20713c8a`, Frontend `c8dc258b`) und die 59 roten Mutationen wurden gelesen, nicht selbst als Gesamtgate wiederholt. Die Vorher-/Nachher-Messung belegt den synthetischen frühen Kontakt sowie gleiche Proben-/Abfragezahlen bei `haus.ngc`; sie enthält keine Stop-/Cancel-Latenzen. Die separate Browser-PC-/Mac-Messung bleibt offen. Die Zahl 200 bleibt bis Paket 2 eine ausdrücklich benannte Listengrenze; dieses Review nimmt Paket 2 nicht vorweg.
