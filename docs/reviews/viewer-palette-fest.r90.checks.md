# R90 · Prüfaufbau und Grenzen

Code `aa250780..5af78ad1`, Anfrage `f7ebef8e`, 7. Oktober 2026.
Archiv `/tmp/codex-r90-9a989x_7/archive` aus `git archive 5af78ad1` mit
`lcnc-webui`, `examples`, `lcnc-gateway/machine`, `test-fixtures`, `scripts`.
423 Frontend-Dateien stimmen mit ihren Git-Blobs überein. Fünf Abweichungen
isolieren TypeScript-/Vite-Caches und den eigenen Mock (ctl.ts). Die
Änderungen sind in isolation.patch dokumentiert. Abhängigkeiten einzeln
verlinkt; Cacheverzeichnisse ausgeschlossen.

Keine Produktänderung, Builds oder Tests im Live-Arbeitsbaum. Keine
Maschinenbefehle und keine Live-Ports. Neue Belege und Review-Anhang sind
die einzigen versionierbaren Änderungen. Die 18 R89-Belege wurden gegen
ihr Hashmanifest geprüft. CPU-Läufe mit nice 19, ein Testworker; eigene
Läufe nacheinander. Keine fremden Prozesse beendet oder verändert.

## Unit- und Geometrieprüfungen

Neben `lcnc-webui` den Ausgabeordner `evidence` anlegen. Die Konfiguration
als `r90.vitest.config.ts` nach `lcnc-webui`, die Sonden als
`src/viewer/r90.<name>.test.ts` ablegen.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r90.vitest.config.ts src/viewer/collision.test.ts src/viewer/clashTint.test.ts src/viewer/bvhBoxDistance.test.ts src/viewer/collisionHorizon.test.ts src/viewer/sweepMerge.test.ts src/viewer/sweepPump.test.ts src/viewer/sweepEntry.test.ts src/viewer/sweepShards.test.ts src/viewer/r90.recontact.test.ts src/viewer/r90.boundaries.test.ts src/viewer/r90.facets.test.ts src/viewer/r90.touching.test.ts src/viewer/r90.edges.test.ts
COLLISION_HUNT_BUDGET=0 nice -n 19 node node_modules/vitest/vitest.mjs run --config r90.vitest.config.ts src/viewer/collisionOracle.test.ts src/viewer/collisionBounds.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r90.vitest.config.ts src/viewer/r90.coordinator.test.ts
```

Recontact, Boundaries, Facets, Touching und Edges sind bytegleich zu R89.
Die Ausgabenamen im Test bleiben teilweise R86/R87/R88/R89. Nur neue
Ausgaben in der Archivkopie werden zur Veröffentlichung als R90 kopiert;
alte Repository-Belege bleiben unberührt.

Orakel im kurzen Standardmodus mit Standardsaaten; nur sein Zeitbudget ist
wegen der gemeinsam genutzten VM aufgehoben. Kein neuer Deep-Hunt. Die
Schrankenprüfung läuft mit ihrem unveränderten aktuellen Repository-Budget.

Die Koordinator-Sonde lädt collisionWorker.ts und mergeShardResults
unverändert. Sie ersetzt untergeordnete Worker durch kontrollierte
Nachrichtenquellen, um Abschluss, Zwischenstände und Fehler in eindeutiger
Reihenfolge auszulösen. Die ersten sechs Fälle verwenden beim lokalen
Rückfall den echten Sweep auf einer kleinen Geometrie. Für den siebten Fall
(ID −1) wird ausschließlich runSweepSlice ersetzt: Der reale Worker bleibt
am ersten Slice stehen und muss sein echtes Cancel-Flag im nächsten Pump
setzen. Sonst könnte die kleine Einfahrprüfung vor dem Cancel schon enden.

Ergebnis: 138 Kern-/Shard-/übernommene Prüfungen grün; sieben Orakel- und
Schrankenprüfungen grün; Koordinator sechs rot, eine normale Ablaufkontrolle
grün. Die absichtlich roten Sollwerte wurden nicht an die Fehler angepasst.

## Build und Browser

Alle zusätzlichen Unit- und Browser-Sonden vor `npm run build` aus src/e2e
nehmen; Repository-Quellen einschließlich ihrer Tests bleiben vollständig
in der TypeScript-Prüfung. Anschließend dev.spec.ts für den Browser wieder
in e2e ablegen.

```sh
nice -n 19 npm run build
nice -n 19 node node_modules/@playwright/test/cli.js test --config r90.chromium.config.ts --grep 'the sweep runs on several workers|entry-move and program contacts'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r90.firefox.config.ts --grep 'the sweep runs on several workers|entry-move and program contacts'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r90.dev.config.ts
```

Chromium/Firefox am gebauten dist: unveränderte Repository-Tests, eigener
Mock auf 127.0.0.1:4188, keine Serverübernahme. 2/2 je Browser.

Dev: r90.dev.vite.config.ts startet einen isolierten Vite auf 127.0.0.1:4189
mit eigenem Cache und OHNE Live-Proxies. Die separate leere Testseite
public/r90-worker.html lädt nur den Test-Worker; keine App und kein Gateway.
Die Sonde lädt `/src/viewer/collisionWorker.ts?worker_file&type=module`
als echten ES-Worker. Dieser lädt seine Kinder selbst, erhält eine einfache
Boxgeometrie und beantwortet Haupt- und Seitenanfrage. Beide Browser melden
vier Kerne, drei Shards und jeweils einen Kontakt auf L2 in beiden Ergebnissen.
2/2 bestanden. Konfigurationen und leere Testseite sind beigefügt.

Lokales Binding und Browser liefen nach automatischer Freigabe außerhalb
der Sandbox. Die Server wurden durch Playwright wieder beendet. Keine
zusätzliche Live-Abnahme und kein vollständiges Offline-Gate.

## Vorhandene Leistungsmessung

Die Dateien `r90.claude-*` sind unveränderte Kopien bereits vorhandener
Claude-Belege. Die ursprünglichen Pfade und SHA-256-Werte stehen in
performance-check.json. Die Pool-Onset-Datei enthält zwei direkt angehängte
JSON-Arrays; deshalb trägt ihre Kopie `.raw.txt`. Die eigene Auswertung
liest beide mit JSONDecoder.raw_decode und vergleicht sie separat mit der
Einzellauf-Liste.

Kein neuer haus.ngc-Leistungslauf; keine eigenen Belege für Bildzeiten am
Mac oder die zeitliche/geometrische Lage der acht geänderten Onset-Zeilen.
Die Wandzeit-Verhältnisse wurden aus den vorhandenen Logs berechnet. Die
geometrischen Vergleiche der Repository-Tests wurden separat ausgeführt.
