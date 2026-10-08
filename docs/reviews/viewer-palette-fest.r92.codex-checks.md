# R92 · Prüfaufbau und Grenzen

Produktstand `760ecf9b`, Basis `8d0db725`, Anfrage `234a2968`, 8. Oktober
2026. Archiv `/tmp/codex-r92-zvt_163_/archive` aus Git mit Frontend, Gateway,
Beispielen, Testvorlagen und Skripten. 424 Frontend- und 87 Gateway-Dateien
sind bytegleich zu Git. Vier im Archiv aufgelöste LFS-Modelle stimmen nach
SHA256 und Größe mit ihren Pointern überein. Fünf isolierende Änderungen
betreffen nur Cachepfade und den eigenen Mock-Port (isolation.patch).

Keine Produktänderung, keine Builds/Tests im Live-Arbeitsbaum, keine
Maschinenbefehle oder Zugriffe auf Live-Ports. Eigene CPU-Läufe mit nice 19,
ein Vitest-/Playwright-Worker. Der kurze Python-Lauf überlappte mit dem Ende
des Shard-Vergleichs; Browserläufe nacheinander. Kein Deep-Hunt und keine
neue haus.ngc-/Mac-Leistungsmessung. R90- und R91-Belege gegen ihre
Hashmanifeste unverändert (37 und 24 Dateien).

## Bestehende Tests und R91-Gegenproben

Neben `lcnc-webui` und `lcnc-gateway` einen Ordner `evidence` anlegen.
vitest.config.ts als `r92.vitest.config.ts` nach `lcnc-webui` kopieren;
coordinator.test.ts und edges.test.ts als `src/viewer/r92.<name>.test.ts`.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r92.vitest.config.ts src/viewer/collisionWorker.test.ts src/viewer/r92.coordinator.test.ts src/viewer/r92.edges.test.ts src/viewer/collision.test.ts src/viewer/sweepPump.test.ts src/viewer/sweepEntry.test.ts src/viewer/sweepMerge.test.ts src/viewer/sweepShards.test.ts
```

**142/142 grün.** Coordinator ist bytegleich zur R91-Kopie. Edges hat genau
eine sachliche Anpassung: Der Stop-Fall erwartet `m.error` statt `m.stopped`,
wie in R91 ausdrücklich als Alternative angeboten; der Assertion-Text
benennt das. Alle übrigen Erwartungen bleiben erhalten. Die Ausgabe zeigt
20 % äußeren Fortschritt, den expliziten Stop-Fehler und **null Resttimer**.
Die Sonden behalten ihre alten Ausgabenamen innerhalb der Archivkopie;
zur Veröffentlichung werden neue R92-Dateien angelegt.

Im archivierten Gateway mit der bestehenden Python-Umgebung:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**410/410 grün**, einschließlich nativer Offline-Interpreter-Proben in
separaten Prozessen. Die Projektkonfiguration ergänzt selbst `-q`; deshalb
enthält das Laufprotokoll nur Fortschrittszeilen. Das separate
collection-Protokoll bestätigt die Anzahl (keine erneute Testausführung).

## Eigene native Programme und Übergabe an den Client

native_probe.py als `r92.native_probe.py` in den archivierten Gateway legen.
Die Datei übernimmt den Repository-Prüfstand; hinzu kommen nur elf
Testprogramme und zusätzliche Ausgabefelder. Der echte Canon und Parseworker
bleiben unverändert. Eine temporäre INI, Parameterdatei und Werkzeugtabelle
ersetzen die Live-Eingaben; `linuxcnc.stat` ist synthetisch,
`linuxcnc.command` wirft. Jeder Fall läuft in einem eigenen Prozess.

Die elf Programme stehen zusätzlich in native-cases.json. Von
`lcnc-gateway` aus kann run-native.py alle nativen Fälle wiederholen und die
vollständigen MessagePack-Payloads in `../evidence` ablegen. native.json
enthält alle elf Ergebnisse; native.txt ist das Rohprotokoll der ersten
neun Fälle, die zwei zusätzlichen Positivkontrollen kamen danach hinzu.

native-payload.test.ts als `src/viewer/r92.native-payload.test.ts` ablegen:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r92.vitest.config.ts src/viewer/r92.native-payload.test.ts
```

Der Test dekodiert die **nativen Payloads**, löst die TLO-Ereignisindizes
mit dem Produktresolver auf, baut den Track mit `buildScrubTrack` und
prüft ihn mit `sweepCollisions` auf einfacher Boxgeometrie. Keine erfundenen
ustart-/brk-Flags im Gegenfall. Vier rote Fälle (G1, G1 mit folgendem G0,
G2, G43 + G1 nach M6 mit TOOL_CHANGE_POSITION), drei grüne Kontrollen
(bekannte G43-Bewegung mit Hindernis in ihrer Mitte, unbekannter G0-Start,
wiederholtes G49). Im ersten Aufbau wurde Node-Buffers `slice().buffer`
fälschlich als Bytekopie behandelt; die Sonde verwendet jetzt
`Uint8Array.from(...).buffer`. Das war ein Fehler der Sonde, keine
Produktabweichung. Alle gemeldeten Gegenfälle stammen aus dem korrigierten Lauf.

Native Positivkontrollen zusätzlich: Quill-up, wiederholtes G30 am M6 und
Quill-up plus G30; Fahrten und Zeilen bleiben erhalten. Kein Live-M6, kein
Werkzeugwechsel an der Maschine. Die schon benannte Prüfstandgrenze für
Tabellen-Lookups über H/T bleibt: Diese Runde erweitert den nativen
Prüfstand nicht um eine laufende Werkzeugdatenbank.

## Build und Browser

Eigene Review-Sonden vor dem Build aus `src`/`e2e` nehmen; sämtliche
Repository-Tests bleiben in der Typprüfung.

```sh
nice -n 19 npm run build
nice -n 19 node node_modules/@playwright/test/cli.js test --config r92.chromium.config.ts --grep 'a move whose start no parse can know|the sweep runs on several workers'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r92.firefox.config.ts --grep 'a move whose start no parse can know|the sweep runs on several workers'
```

Build/TypeScript grün. Unveränderte Repository-Tests: Chromium **1 rot / 1
grün**, Firefox **2 grün**. Der rote Fall ist der fehlende Readiness-Guard
des neuen Tests, noch vor der Prüfung des eigentlichen Hinweises.

readiness.spec.ts nach `e2e/r92.readiness.spec.ts`, readiness.config.ts nach
`r92.readiness.config.ts`. Diese Sonde kopiert nur den neuen Repository-Test
mit seinem Aufbau, verzögert die STL-Antworten um 1,5 s und stellt die
unveränderte Abfrage einer Abfrage mit Optional-Chaining auf Objekt und
Methode gegenüber. Produktcode und fertiger Build bleiben unverändert.

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r92.readiness.config.ts
```

**Je Browser ein roter Original- und ein grüner Kontrollfall.** Die grüne
Kontrolle prüft weiter den exakten Ergebnistext, den Marker und die sichtbare
Hilfe; sie überspringt keine Assertion. Port ausschließlich 127.0.0.1:4188,
eigener Mock, keine Wiederverwendung eines laufenden Servers. Playwright
beendet seinen Server nach jedem Lauf. Kein vollständiges Offline-Gate,
keine Live-Abnahme oder Neuerstellung der Goldens.
