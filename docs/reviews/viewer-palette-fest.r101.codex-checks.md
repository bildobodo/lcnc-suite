# R101 · Codex · Prüfnachweis

Stand: Produkt `71724fc4`, Anfrage `334b3d15`, Basis `c5f22dad`. Archiv `/tmp/codex-r101-oqls9rbo/archive`, keine Live-Ports und keine Maschinenbefehle. Alle Läufe `nice -n 19`, Vitest mit einem Worker. Kein Deep-Hunt.

## Archiv und Isolation

`git archive 71724fc4 lcnc-webui lcnc-gateway examples test-fixtures scripts` wurde in `/tmp` entpackt. Abhängigkeiten: einzelne Verweise auf die vorhandenen `lcnc-webui/node_modules`-Einträge, **ohne** `.tmp`, `.vite`, `.vite-temp`, `.cache`. Die drei TypeScript-Buildcaches und der Vite-Cache liegen im Archiv; siehe `codex-isolation.patch`. Vitest verwendet `cacheDir: "../r101-vitest-cache"`, `environment: "node"`, `maxWorkers: 1`, `testTimeout: 240000`, `include: ["src/**/*.test.ts"]`.

Die Abschlussprüfung vergleicht alle archivierten Git-Blobs: 856 Dateien/Links unverändert, vier Änderungen ausschließlich für Cache-Isolation. Die vom Archivfilter ausgegebenen 95 LFS-Dateien stimmen mit SHA256 und Größe ihrer Git-Pointer überein. Keine Produktdatei für einen Test überschrieben. Die beiden Zertifikatskontrollen sind **zusätzliche Module**, jeweils mit genau einer geänderten Anweisung, siehe `codex-noCert.patch` und `codex-speedBound.patch`. Sie und die Sonden wurden vor dem Produktbuild aus `src/` entfernt.

## Ausgeführte Prüfungen

Aus `archive/lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r101.config.ts src/viewer/collision.test.ts src/viewer/collisionInside.test.ts src/viewer/insideCheck.test.ts src/viewer/sweepShards.test.ts src/viewer/sweepMerge.test.ts src/viewer/collisionWorker.test.ts src/viewer/collisionBounds.test.ts src/viewer/machineTrsrn.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r101.config.ts src/viewer/collisionOracle.test.ts
```

Ergebnis: **155 + 5 = 160 Repository-Prüfungen grün**. Das Orakel lief im normalen Gate-Modus mit den vier Maschinen-/Kinematikfällen; der fünfte Test bestätigt Kontaktabdeckung. Keine stundenlange Suche.

Eigene Sonden:

- `contracts.test.ts`: **4 grün** — 257 Komponenten trotz Boxkappung; offene Geometrie in beiden Richtungen; Vereinigung von Shard-/Einfahrthinweisen einschließlich Legacy-Ergebnis; analytische Abstände eingeschlossener Boxen, auch jenseits des Horizonts.
- `certificate.test.ts`: **2 grün** — mit/ohne Innenzertifikat identische Datensätze, Intervalle und Probenzahlen über 90 lineare bzw. rotatorische Abschnitte unter Identitätskinematik. Die kleinen Laufzeiten sind **kein** Performancebenchmark.
- `refine.test.ts`: **1 grün / 1 rot** — analytischer Hohlraum als Kontrolle; positionsabhängig unentscheidbare Stelle nur in der Verfeinerung bleibt ohne Hinweis. Das Mock entscheidet ausschließlich anhand der Position, die Stack-Auswertung protokolliert nur den Aufrufer.
- `bulge.test.ts`: **3 grün / 2 rot** — analytische TCP-Gelenkbewegung, Kontrolle ohne Innenzertifikat, Kontrolle mit Ableitungsschranke; falsches erstes Kontaktende und fehlender zweiter Kontakt im Produkt. Der Innenzertifikat-Effekt und die bereits vorhandene gemeinsame Schranke sind im Review getrennt beschrieben.

Die Sonden lassen sich mit `codex-reproduce.py /tmp/.../archive` wiederholen. Das Hilfsskript legt die zusätzlichen Module anhand der beiden dokumentierten Ein-Zeilen-Änderungen an, kopiert die Sonden neben die Produktmodule, führt sie aus und entfernt nur diese neu angelegten Dateien wieder. Es erwartet die Belege in seinem eigenen Verzeichnis. Ergebnis am geprüften Stand: **10 grün / 3 rot**. Es setzt keine Maschine und keinen Browser voraus.

```sh
nice -n 19 npm run build
```

Build/TypeScript: **PASS**. Bestehender Hinweis auf große JavaScript-Bundles. Kein Python-Lauf, da keine Gateway-Änderung; kein erneuter Browserlauf, da die Produktänderungen ausschließlich den Geometriekern und die Ergebniszusammenführung betreffen. Die Warnlücke ist bereits im von der UI gelesenen `uncertified`-Feld belegt. Das vollständige Offline-Gate und der haus-Lauf sind Claudes Belege, nicht eigene Wiederholungen.

R93–R100-Belege vor dem Publizieren gegen ihre jeweiligen Hashmanifeste geprüft: unverändert. Kontext und SHA256-Manifest liegen daneben.

## Quellenabgleich

Die Abnahme der Fassung 3 setzt die ausdrücklich eingeschränkte Oberflächenprüfung offener Netze voraus; keine allgemeine Innen-/Außengarantie für diese Netze. Ein solcher Unterschied ist auch im [libigl-Tutorial zur Windungszahl](https://libigl.github.io/tutorial/#generalized-winding-number) benannt. Maßgebend für die verwendete BVH-Abfrage waren zusätzlich der installierte Quelltext und die [Dokumentation zu three-mesh-bvh 0.9.14](https://github.com/gkjohnson/three-mesh-bvh/tree/v0.9.14). Die konkrete V-Gegenprobe und die fehlende Warnung sind lokale Code-/Testergebnisse.
