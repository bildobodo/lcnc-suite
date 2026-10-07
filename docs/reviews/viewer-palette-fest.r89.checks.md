# R89 · Prüfaufbau und Grenzen

Code `c62ae3c9..53d32dc5`, Anfrage `77c9092e`, 7. Oktober 2026.
Archiv `/tmp/codex-r89-wl82mchr/archive` aus `git archive 53d32dc5` mit
`lcnc-webui`, `examples`, `lcnc-gateway/machine`, `test-fixtures`, `scripts`.
420 Frontend-Dateien stimmen mit ihren Git-Blobs überein. Die vier
Abweichungen sind ausschließlich eigene Cachepfade in drei TypeScript-
Konfigurationen und `vite.config.ts`; siehe isolation.patch. Abhängigkeiten
sind einzeln verlinkt, ihre Cacheverzeichnisse ausgeschlossen.

Keine Tests oder Builds im Live-Arbeitsbaum, keine Browser, Ports oder
Maschinenbefehle. Live nur Review-Anhang, neue R89-Belege und Handshake.
Die 29 R88-Belege wurden gegen ihr Hashmanifest geprüft und nicht geändert.
Alle eigenen CPU-Läufe nacheinander mit `nice -n 19` und einem Testworker.
Keine Prozesse anderer Arbeitsschritte verändert oder beendet.

## Wiederholung

Neben `lcnc-webui` den Ausgabeordner `evidence` anlegen. Konfiguration als
`r89.vitest.config.ts` nach `lcnc-webui`, Sonden als
`src/viewer/r89.<name>.test.ts` ablegen.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r89.vitest.config.ts src/viewer/collision.test.ts src/viewer/clashTint.test.ts src/viewer/bvhBoxDistance.test.ts src/viewer/collisionHorizon.test.ts src/viewer/sweepMerge.test.ts src/viewer/r89.recontact.test.ts src/viewer/r89.boundaries.test.ts src/viewer/r89.facets.test.ts src/viewer/r89.touching.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r89.vitest.config.ts src/viewer/r89.edges.test.ts
COLLISION_HUNT_BUDGET=0 nice -n 19 node node_modules/vitest/vitest.mjs run --config r89.vitest.config.ts src/viewer/collisionOracle.test.ts
```

Recontact, Boundaries, Facets und Touching sind bytegleich zu den abgelegten
R88-Sonden. Ihre Ausgabenamen im Test bleiben R86/R87/R88; in der Archivkopie
entstandene Ergebnisse werden zur Veröffentlichung unter R89-Namen kopiert.
Alte Belege im Repository werden dadurch nicht überschrieben.

Die neue Edges-Sonde verwendet dasselbe einfache Rotationsmodell wie die
R88-Gegenprobe. Die 130 Kombinationen bestehen aus zwei Drehrichtungen,
fünf Startlagen (4,5°–5,5°) und 13 Positionen des zweiten Quaders
(13°–16°). Der Standardlauf wird jeweils mit einer 0,25-Abtastung
verglichen. Zusätzlich acht Vorschub-/Rückzugkombinationen, acht Fälle
Eilgang mit anschließendem Vorschub und vier Fälle mit kurzen bzw.
längenlosen Segmenten und gleichen/verschiedenen Zeilennummern.

Das Orakel läuft im kurzen Standardmodus mit den Standardsaaten. Nur das
Zeitbudget ist wegen der gemeinsam genutzten VM aufgehoben; kein
`COLLISION_HUNT=deep`. Orakel und feinere Kontrollabtastung teilen die
Pose-/Abstandsberechnung mit dem Sweep. Sie sind Gegenproben für den
Abtast- und Kontaktzustand, kein unabhängiger Geometriebeweis.

Vor dem Build die fünf eigenen Sonden aus `src` nehmen. Repository-Quellen
und Tests bleiben vollständig in der TypeScript-Prüfung.

```sh
nice -n 19 npm run build
```

Keine Wiederholung des vollständigen Offline-Gates oder der unveränderten
Browseranzeigen, kein neuer Deep-Hunt und keine Leistungsmessung. Das
Agreement bezieht sich ausschließlich auf den angefragten VP-I45-Rest;
die geplante Parallelisierung ist nicht Gegenstand dieser Runde.
