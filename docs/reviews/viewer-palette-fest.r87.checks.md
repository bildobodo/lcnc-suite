# R87 · Prüfaufbau und Grenzen

Code `6dc05030..39023b64`, Anfrage `e5dad958`, 7. Oktober 2026.
Archiv `/tmp/codex-r87-o7nuff94/archive` aus `git archive 39023b64` mit
`lcnc-webui`, `examples`, `lcnc-gateway/machine`, `test-fixtures`, `scripts`.
Abhängigkeiten einzeln verlinkt, Cache-Verzeichnisse ausgeschlossen.
419 Frontend-Dateien entsprechen ihren Git-Blobs, fünf haben nur die
beigefügten Änderungen für eigene Caches und Mock `127.0.0.1:4188`.

Keine Maschinenbefehle, keine Live-Ports, keine Verwendung privater R84-
Eingaben, keine Änderungen oder Signale an Claudes parallelen Deep-Hunt.
Alle eigenen schweren Prüfungen nacheinander, `nice -n 19`, ein Worker.
24 vorhandene R86-Belege gegen das Hashmanifest verifiziert.

## Unit-Prüfungen

In der Archivkopie neben `lcnc-webui` den Ordner `evidence` anlegen.
Die beigefügte Vitest-Konfiguration als `r87.vitest.config.ts` unter
`lcnc-webui`, die Sonden als `src/viewer/r87.<name>.test.ts` ablegen.
Die Recontact-Sonde ist bytegleich zum R86-Beleg; sie schreibt in der
Archivkopie weiterhin `evidence/viewer-palette-fest.r86.recontact.json`.
Das hier gespeicherte Ergebnis trägt zur Unterscheidung den R87-Namen.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r87.vitest.config.ts src/viewer/collision.test.ts src/viewer/clashTint.test.ts src/viewer/bvhBoxDistance.test.ts src/viewer/collisionHorizon.test.ts src/viewer/sweepMerge.test.ts src/viewer/r87.recontact.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r87.vitest.config.ts src/viewer/r87.boundaries.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r87.vitest.config.ts src/viewer/r87.facets.test.ts
COLLISION_HUNT_BUDGET=0 nice -n 19 node node_modules/vitest/vitest.mjs run --config r87.vitest.config.ts src/viewer/collisionOracle.test.ts
```

Das Orakel lief im kurzen Modus mit den unveränderten Standardsaaten.
Nur sein Zeitbudget wurde wegen des parallelen Deep-Hunts angehoben;
`COLLISION_HUNT=deep` wurde nicht gesetzt. Ergebnis: 4/4, 97,58 s.

Die Grenzsonde prüft zuerst eine einfache Translation mit kleiner Marge,
dann normale Zeilen/Brüche, zuletzt den maßgeblichen Rotationsfall mit der
Produktmarge 2 mm. Beide negativen Fälle scheitern erst nach erfolgreichen
Kontrollen an der fehlenden Standardmeldung. Die Rotationsprobe ist echte
`rotate z`-Kinematik mit A in Joint 3; keine manipulierte Bewegungsgeschwindigkeit.

Die Facettensonde prüft den neuen Vertrag für leere Körper einschließlich
frühem Init-Abbruch. Der echte Worker wird mit einem lokalen `self`-Objekt
aufgerufen (keine Ports, keine Maschine). Das negative Ergebnis für eine
nur teilweise beschädigte Geometrie bleibt `uncertified: null`.

## Kosten und ausgelieferte Geometrie

Für `r87.cost.test.ts` zusätzlich den alten Modulstand als
`src/viewer/r87.old-collision.ts` extrahieren, ausschließlich in der Kopie:

```sh
git -C /home/cnc/lcnc-suite show 6dc05030:lcnc-webui/src/viewer/collision.ts > src/viewer/r87.old-collision.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r87.vitest.config.ts src/viewer/r87.cost.test.ts
```

Die sonstigen verwendeten Module sind am verglichenen Stand unverändert.
Die Reihenfolge ist alt/neu je Größe, eine Messung je Fall, nicht aufgewärmt
und nicht statistisch geglättet. Laufzeiten auf der geteilten VM sind daher
nur Größenordnungen. Die Probenzahlen sind deterministisch: Mehrarbeit
19 × Kontaktzahl. Der Bericht ist keine Behauptung über die Vollständigkeit
des alten Verfahrens oder über reale Programme. Die 16-Intervallgrenze einer
Zeile ist hier nicht Gegenstand der Kostenmessung.

Der zweite Test liest für alle drei ausgelieferten Modelle die tatsächlich
benutzten Kollisions-Proxys/STLs und ruft den neuen Filter auf: keine der
1.477.314 Facetten entfernt. Die dünnen Zufallspaare sind eine separate
zusätzliche Prüfung; kein allgemeiner Robustheitsbeweis.

## Build und Browser

Vor `npm run build` nur die eigenen Review-Quellen aus `src` und `e2e`
herausgenommen. Repository-Code und Repository-Tests wurden vollständig
typgeprüft und gebaut. Zusätzliche Browserprobe danach wieder eingefügt.
Übliche Warnung zur Bundle-Größe, kein Buildfehler.

Browserkonfiguration als `r87.browser.config.ts`, Sonde als
`e2e/r87.uncertified.spec.ts` ablegen:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r87.browser.config.ts
```

Der Mock startet selbst auf `127.0.0.1:4188`, übernimmt keinen laufenden
Server. Das Binding erforderte automatische Freigabe außerhalb der Sandbox.
Die Sonde verändert nur empfangene Collision-Worker-Ergebnisse im eigenen
Browser: Name eines fehlenden Körpers, leere Befunde, ein bzw. null bewegte
Paare. Keine Änderung am Bundle oder an den Produktquellen. Der tatsächliche
Worker-Vertrag ohne Paar ist separat in der Unit-Sonde bestätigt. Der
Anzeigefall mit einem Paar besteht; bei null Paaren fehlen Marker und
zugänglicher Warntext, während der Grund weiterhin in der Hilfe steht.

Keine neue Firefox-Runde: betroffen ist ein deterministischer Vue-Zweig,
keine Browser-Geometrie. Kein vollständiges Offline-Gate und keine Aussage,
dass der parallel laufende Deep-Hunt beendet sei.
