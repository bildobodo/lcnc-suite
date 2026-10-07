# R88 · Prüfaufbau und Grenzen

Code `53261fc0..a288433d`, Anfrage `a242980e`, 7. Oktober 2026.
Archiv `/tmp/codex-r88-t1l6uwzb/archive` aus `git archive a288433d` mit
`lcnc-webui`, `examples`, `lcnc-gateway/machine`, `test-fixtures`, `scripts`.
419 Frontend-Dateien stimmen mit ihren Git-Blobs überein; fünf enthalten
nur die dokumentierten eigenen Caches und die Mockadresse 127.0.0.1:4188.
Abhängigkeiten einzeln verlinkt, Cache-Verzeichnisse ausgeschlossen.

Live-Arbeitsbaum nur für Review-Anhang, neue Belege und Handshake benutzt.
Keine Maschinenbefehle, keine Live-Ports, keine privaten Operator-Eingaben.
26 R87-Belege gegen ihr Hashmanifest verifiziert. Claudes parallelen
Deep-Hunt weder verändert noch beendet. Alle eigenen schweren Läufe
nacheinander, ein Worker und `nice -n 19`; Browser erst danach.

## Reproduktion

Neben `lcnc-webui` den Ausgabeordner `evidence` anlegen. Konfigurationen
als `r88.<name>.config.ts` nach `lcnc-webui`, Unit-Sonden als
`src/viewer/r88.<name>.test.ts` ablegen. Die Namen im Testinhalt und die
Ausgaben der übernommenen Sonden bleiben absichtlich R86/R87; sie schreiben
nur in die Archivkopie. Die veröffentlichten Ergebnisse tragen R88-Namen.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r88.vitest.config.ts src/viewer/collision.test.ts src/viewer/clashTint.test.ts src/viewer/bvhBoxDistance.test.ts src/viewer/collisionHorizon.test.ts src/viewer/sweepMerge.test.ts src/viewer/r88.recontact.test.ts src/viewer/r88.boundaries.test.ts src/viewer/r88.facets.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r88.vitest.config.ts src/viewer/r88.touching.test.ts
COLLISION_HUNT_BUDGET=0 nice -n 19 node node_modules/vitest/vitest.mjs run --config r88.vitest.config.ts src/viewer/collisionOracle.test.ts
```

Recontact und Boundaries sind bytegleich zu R87. Facets ändert ausschließlich
`unusableNote` in `geometryNote`; Sollwerte und Assertions sind unverändert.
Die neue Touching-Sonde verändert nur den Winkel des zweiten Stock-Quaders:
13°, 14,5°, 15°, 15,5°. Alle acht Kontrollen (feinere Abtastung und Restbahn
je Variante) bestehen vor dem absichtlichen Fehler des Standardlaufs.

Abstände aus `pairDistance` über der Marge können konservative Schranken
sein. Die Angabe 27,4906 mm bei A = 12,5° wird daher als UNTERE Schranke
verwendet, nicht als exakter Oberflächenabstand. Sie genügt zum Nachweis
der Trennung über 4 mm. Beide Kontakte selbst ergeben 0.

Das Orakel läuft im kurzen Modus mit seinen Standardsaaten; nur das
Zeitbudget ist wegen der gleichzeitig genutzten VM aufgehoben, kein
`COLLISION_HUNT=deep`. Ergebnis: vier Fälle bestanden, 140,26 s.

## Build und Browser

Zusätzliche Review-Quellen vor `npm run build` aus `src`/`e2e` genommen;
alle Repository-Quellen einschließlich ihrer Tests typgeprüft und gebaut.
Übliche Bundle-Größenwarnung, kein Buildfehler. Browserprobe anschließend
als `e2e/r88.uncertified.spec.ts` wieder eingefügt.

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r88.chromium.config.ts --grep 'a part left out|missing body remains'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r88.firefox.config.ts --grep 'a part left out|missing body remains'
```

Die eigene Browserprobe ist bytegleich zu R87 und verwendet dessen
Worker-Nachrichten-Injektion: ein bzw. kein verbleibendes Paar mit demselben
Grund für nicht prüfbare Geometrie. Keine Änderung des Bundles oder des
Produktcodes, keine Verwendung der neu hinzugefügten Diagnoseschnittstelle
in der eigenen Sonde. Der zusätzliche Repository-Test prüft außerdem den
gültigen neutralen Fall ohne fehlende Geometrie.

Die Browserprobe schreibt feste R87-Ausgaben in die Archivkopie. Diese
werden nach jedem Browser unter R88 plus Browsernamen gesichert, bevor der
nächste Browser läuft. Mock ausschließlich 127.0.0.1:4188, eigener Start,
kein Übernehmen vorhandener Server. Das Binding lief nach automatischer
Freigabe außerhalb der Sandbox.

Kein vollständiges Offline-Gate, keine neue Leistungsmessung von haus.ngc,
keine zusätzliche Live-Abnahme und kein Vorgriff auf die Parallelisierung.
