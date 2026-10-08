# R99 · Prüfaufbau und Wiederholung

Produktstand `bfbd5d5c` (Produktcommit `d12fef94`), Basis `cb2db2b3`,
Anfrage `8ed8376a`, 8. Oktober 2026. Archiv:
`/tmp/codex-r99-v6ou5pqv/archive`.

426 Frontend- und 87 Gateway-Dateien sind bytegleich mit Git; vier aufgelöste
LFS-Modelle stimmen nach Größe und SHA256 mit ihren Pointern überein.
Vier Anpassungen betreffen ausschließlich Cachepfade (`isolation.patch`).
Die Hashmanifeste R93–R98 bleiben unverändert. Keine Produktänderung,
Builds/Tests im Live-Baum, Maschinenbefehle oder Zugriffe auf :5173/:8000.
Python-Umgebung und Node-Pakete werden gelesen; Ausgaben und Caches liegen
im Archiv. CPU-Läufe mit `nice -n 19`, Vitest mit einem Worker.

## Native Fälle

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`. Alle Belege dieser
Runde tragen den Präfix `viewer-palette-fest.r99.codex-`. Prüfstände ins
archivierte Gateway kopieren:

| Beleg | Zielname | Fallliste | Ergebnis | Anzahl |
|---|---|---|---|---|
| prior-native.py | r99.prior-native.py | prior-native-cases.json | prior-native.json/.txt | 11 |
| native_probe.py | r99.native_probe.py | native-cases.json | r93-native.json/.txt | 8 |
| edges.py | r99.edges.py | edges-cases.json | r94-native.json/.txt | 7 |
| offsets.py | r99.offsets.py | offset-cases.json | r95-native.json/.txt | 7 |
| scanner.py | r99.scanner.py | scanner-cases.json | r96-native.json/.txt | 7 |
| arc.py | r99.arc.py | arc-cases.json | arc-native.json/.txt | 1 |
| extra.py | r99.extra.py | extra-cases.json | r97-native.json/.txt | 15 |
| braking.py | r99.braking.py | braking-cases.json | braking-native.json/.txt | 1 |
| modes.py | r99.modes.py | modes-cases.json | modes-native.json/.txt | 7 |
| foreign.py | r99.foreign.py | foreign-cases.json | foreign-native.json/.txt | 3 |
| syntax.py | r99.syntax.py | syntax-cases.json | syntax-native.json/.txt | 8 |
| signed.py | r99.signed.py | signed-cases.json | signed-native.json/.txt | 6 |
| function.py | r99.function.py | function-cases.json | function-native.json/.txt | 1 |

Die ersten zehn Prüfstände sind bytegleiche R98-Kopien. Die drei neuen
ergänzen Programme. Jeder Fall läuft in einem eigenen Prozess durch
Produkt-Canon und den nativen Offline-Interpreter. `linuxcnc.stat` ist
synthetisch, `linuxcnc.command` wirft; INI, Parameterdatei, Unterprogramme
und Werkzeugtabelle liegen in temporären Verzeichnissen.

**79 erfolgreiche native Programmläufe:** alle 67 übernommenen Fälle und
zwölf neue. Zusätzlich verwirft der Interpreter drei Syntaxversuche
(`M+98`, `M98.0`, `M[98]`) mit Parsefehler; diese sind kein Befund und
werden nicht als erfolgreiche Programme gezählt. Der normale M98 ist
eine grüne Kontrolle. Alle Ergebnisse einschließlich der verworfenen
Syntaxversuche sind aufgezeichnet.

Beispiele, aus dem archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r99.syntax.py r99_o_plus ../evidence/viewer-palette-fest.r99.codex-r99_o_plus.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r99.signed.py r99_plus_skip ../evidence/viewer-palette-fest.r99.codex-r99_plus_skip.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r99.function.py r99_o_function ../evidence/viewer-palette-fest.r99.codex-r99_o_function.msgpack
```

Die letzte stdout-Zeile enthält die Diagnose als JSON. Das zweite Argument
schreibt den unverändert an die Client-Proben übergebenen MessagePack-Payload.
Die neuen Fälle verwenden TOOL_CHANGE_POSITION = 0 20 30. Bei der
Positionskontrolle ersetzt ein sichtbares `G0 X0 Y20 Z30` ausschließlich
das M6; der folgende Text bleibt gleich. Das ist eine native
Positionskontrolle, kein Lauf des Motion-Controllers.

Die in R98 benannte Werkzeugtabellen-Lookup-Grenze wurde nicht erneut
getestet; keine zusätzliche native L10/L11-Abdeckung behauptet.

## Python und Client

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**430 Tests plus 24 Subtests grün.**

`vitest.config.ts` als `lcnc-webui/r99.vitest.config.ts`, die zwölf eigenen
`*.test.ts`-Belege als `src/viewer/r99.<Name>` kopieren. Vom Frontend aus:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r99.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/simRows.test.ts src/viewer/r99.prior-payload.test.ts src/viewer/r99.recovery.test.ts src/viewer/r99.edges.test.ts src/viewer/r99.offsets.test.ts src/viewer/r99.scanner.test.ts src/viewer/r99.limit.test.ts src/viewer/r99.extra.test.ts src/viewer/r99.braking.test.ts src/viewer/r99.modes.test.ts src/viewer/r99.foreign.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r99.vitest.config.ts src/viewer/r99.signed.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r99.vitest.config.ts src/viewer/r99.function.test.ts
```

- Kernlauf **275/275 grün**, einschließlich beider roten Erwartungen aus
  R98. Die zehn übernommenen Client-Sonden ändern ausschließlich Belegpfade;
  Erwartungen bleiben gleich (`probe-changes.patch`).
- Neue Zahlen-/Herkunftsprobe **2 rot / 9 grün**. `o+100 call` verliert den
  Fremd-Schreibzugriff; `o+100 if [0]` erzeugt einen erfundenen Schreibzugriff.
  Dezimalname, Klammerausdruck, Leerzeichen im Namen, normaler M98, normaler
  numerischer CALL, Positionskontrolle, übersprungener normaler IF sowie
  beide tatsächlich ausgeführten IFs bilden die neun grünen Kontrollen.
- Zusätzlicher Funktionsname **1 rot**: `oABS[-100] call` zeigt denselben
  frühen Fehler wie `o+100 call`. Damit ist nicht nur das Pluszeichen
  betroffen; der anfängliche Filter erkennt berechnete o-Namen nicht
  grundsätzlich als Flussanweisungen.

Die neuen Sonden verwenden echte Payloads, Dekodierung, Track,
WCS-Auflösung und Sweep. Die einfache XYZ-Geometrie entspricht den
bisherigen Sonden; feste Box `(15,5,15)`, Kantenlänge 0,5 mm, Marge 0,1 mm.
Sie prüft Herkunft und Folgewirkung, keine neue Geometrie- oder
Leistungszusage für das XYZAC-Maschinenmodell. Die Aufrufe mit Plus und
Funktion liefern einen falschen L7-Treffer auf Z15; die Positionskontrolle
läuft auf Z5. Beim übersprungenen Plus-IF wird der tatsächliche L8-Folgeweg
stattdessen unnötig als unbekannt aus der Prüfung genommen.

## Build und Grenzen

Die eigenen `r99.*.test.ts` mit Node-Dateizugriffen vor dem Build aus
`src/viewer` nehmen. Repository-Tests bleiben unverändert.

```sh
nice -n 19 npm run build
```

Build und TypeScript grün. Browser nicht erneut ausgeführt: Frontend-
Produktänderungen sind ausschließlich die zwei korrigierten Kommentare;
die neuen Backend-Payloads werden durch den echten Clientpfad geprüft.
Die letzten eigenen Browserprüfungen bleiben R98 (Chromium 3/3,
Firefox 3/3); sie werden nicht als R99-Läufe ausgegeben.

Kein vollständiges Offline-Gate, keine Live-Abnahme, Golden-Neuerstellung,
Deep-Hunt oder haus-Leistungsmessung. Die Innenprüfung ist nicht Teil R99.
