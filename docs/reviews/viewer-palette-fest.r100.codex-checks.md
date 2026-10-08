# R100 · Prüfaufbau und Wiederholung

Produktstand `66e06d2f` (Produktcommit `9c205d34`), Basis `dc2b11e3`,
Anfrage `fa2d9d97`, 8. Oktober 2026. Archiv:
`/tmp/codex-r100-hqzf1vx1/archive`.

426 Frontend- und 87 Gateway-Dateien sind bytegleich mit Git; vier aufgelöste
LFS-Modelle stimmen nach Größe und SHA256 mit ihren Pointern überein.
Vier Anpassungen betreffen ausschließlich Cachepfade (`isolation.patch`).
Die Hashmanifeste R93–R99 bleiben unverändert. Keine Produktänderung,
Builds/Tests im Live-Baum, Maschinenbefehle oder Zugriffe auf :5173/:8000.
Python-Umgebung und Node-Pakete werden gelesen; Ausgaben und Caches liegen
im Archiv. CPU-Läufe mit `nice -n 19`, Vitest mit einem Worker.

## Native Fälle

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`. Alle Belege tragen
den Präfix `viewer-palette-fest.r100.codex-`. Prüfstände ins archivierte
Gateway kopieren:

| Beleg | Zielname | Fallliste | Ergebnis | Erfolgreich / abgelehnt |
|---|---|---|---|---|
| prior-native.py | r100.prior-native.py | prior-native-cases.json | prior-native.json/.txt | 11 / 0 |
| native_probe.py | r100.native_probe.py | native-cases.json | r93-native.json/.txt | 8 / 0 |
| edges.py | r100.edges.py | edges-cases.json | r94-native.json/.txt | 7 / 0 |
| offsets.py | r100.offsets.py | offset-cases.json | r95-native.json/.txt | 7 / 0 |
| scanner.py | r100.scanner.py | scanner-cases.json | r96-native.json/.txt | 7 / 0 |
| arc.py | r100.arc.py | arc-cases.json | arc-native.json/.txt | 1 / 0 |
| extra.py | r100.extra.py | extra-cases.json | r97-native.json/.txt | 15 / 0 |
| braking.py | r100.braking.py | braking-cases.json | braking-native.json/.txt | 1 / 0 |
| modes.py | r100.modes.py | modes-cases.json | modes-native.json/.txt | 7 / 0 |
| foreign.py | r100.foreign.py | foreign-cases.json | foreign-native.json/.txt | 3 / 0 |
| syntax.py | r100.syntax.py | syntax-cases.json | syntax-native.json/.txt | 5 / 3 |
| signed.py | r100.signed.py | signed-cases.json | signed-native.json/.txt | 6 / 0 |
| function.py | r100.function.py | function-cases.json | function-native.json/.txt | 1 / 0 |
| blocks.py | r100.blocks.py | blocks-cases.json | blocks-native.json/.txt | 7 / 3 |
| names.py | r100.names.py | names-cases.json | names-native.json/.txt | 2 / 2 |
| comments.py | r100.comments.py | comments-cases.json | comments-native.json/.txt | 2 / 0 |

Die ersten dreizehn Prüfstände sind bytegleiche R99-Kopien. Die drei neuen
ergänzen Programme. Jeder Fall läuft in einem eigenen Prozess durch
Produkt-Canon und den nativen Offline-Interpreter. `linuxcnc.stat` ist
synthetisch, `linuxcnc.command` wirft; INI, Parameterdatei, Unterprogramme
und Werkzeugtabelle liegen in temporären Verzeichnissen.

**90 erfolgreiche native Programmläufe:** alle 79 aus R99 und elf neue.
Zusätzlich acht vom Interpreter mit Parse- oder Auflösungsfehler beendete
Varianten: die drei M98-Formversuche aus R99, Kommentar vor O bzw. zwischen
N und O, sowie Versuche mit Klammern im o-Namen. Sie werden nicht als
erfolgreiche Programme oder als Befunde gewertet; ihre Ausgaben bleiben
vollständig erhalten. Die Zählung steht in `native-counts.json`.

Beispiele, aus dem archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r100.syntax.py r99_o_plus ../evidence/viewer-palette-fest.r100.codex-r99_o_plus.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r100.signed.py r99_plus_skip ../evidence/viewer-palette-fest.r100.codex-r99_plus_skip.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r100.function.py r99_o_function ../evidence/viewer-palette-fest.r100.codex-r99_o_function.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r100.blocks.py r100_delete_n_computed ../evidence/viewer-palette-fest.r100.codex-r100_delete_n_computed.msgpack
```

Die letzte stdout-Zeile enthält die Diagnose als JSON; das zweite Argument
schreibt den unverändert an die Client-Proben übergebenen MessagePack-Payload.
Neue Fälle verwenden TOOL_CHANGE_POSITION = 0 20 30. Bei den übernommenen
Positionskontrollen ersetzt ein sichtbares `G0 X0 Y20 Z30` ausschließlich
das M6. Das sind native Positionskontrollen, keine Motion-Controller-Läufe.
Die in R98 benannte Werkzeugtabellen-Lookup-Grenze wurde nicht erneut
getestet; keine zusätzliche native L10/L11-Abdeckung behauptet.

## Python und Client

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**431 Tests plus 24 Subtests grün.**

`vitest.config.ts` als `lcnc-webui/r100.vitest.config.ts`, die dreizehn
finalen eigenen `*.test.ts`-Belege als `src/viewer/r100.<Name>` kopieren.
`signed-initial.test.ts` ist nur die gesicherte Ausgangsfassung, nicht
zusätzlich auszuführen. Vom Frontend aus:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r100.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/simRows.test.ts src/viewer/r100.prior-payload.test.ts src/viewer/r100.recovery.test.ts src/viewer/r100.edges.test.ts src/viewer/r100.offsets.test.ts src/viewer/r100.scanner.test.ts src/viewer/r100.limit.test.ts src/viewer/r100.extra.test.ts src/viewer/r100.braking.test.ts src/viewer/r100.modes.test.ts src/viewer/r100.foreign.test.ts src/viewer/r100.signed.test.ts src/viewer/r100.function.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r100.vitest.config.ts src/viewer/r100.signed.test.ts src/viewer/r100.blocks.test.ts
```

Der tatsächlich ausgeführte erste Lauf nutzte die unveränderte Erwartung
der R99-Signed-Sonde (außer Belegpfaden): **287 grün / 1 rot** in
`core-initial.txt`. Alle drei roten R99-Gegenfälle waren darin bereits grün.
Der eine Unterschied ist gewollt: `r99_plus_run` wird jetzt als `foreign`
eingeordnet und liefert Herkunft **0 statt L5**, wie für nicht sicher
lesbare o-Namen vereinbart. Nur diese Erwartung wurde in der Sondenkopie
angepasst; die verlangte fortdauernde Unsicherheit und die Trefferprüfung
bleiben unverändert. `r99_plain_run` verlangt weiter L5. Ausgangsfassung
und kompletter Diff liegen bei (`signed-initial.test.ts`,
`probe-changes.patch`).

Der zweite Lauf prüft die angepasste Datei und die elf neuen Fälle:
**22/22 grün** in `final.txt`. Damit bestehen **299 unterschiedliche
Client-Prüfungen** am Ende, nicht 309: die elf Signed-Prüfungen wurden
erneut ausgeführt und werden nicht doppelt gezählt.

Die neuen Fälle prüfen N-Wörter und `/`, berechnete Fremdaufrufe mit diesen
Präfixen, eine lokale Subroutine mit tatsächlich ausgeführtem G92, einen
unabhängigen expliziten Offset darin, den übersprungenen präfigierten
IF-Zweig, eine fremde und eine lokale Namenskontrolle, nachgestellten
Kommentar und vollständig auskommentierten Aufruf. Die Sonden verwenden
echte Payloads, Dekodierung, Track, WCS-Auflösung und Sweep. Einfache
XYZ-Geometrie wie bisher, feste Box `(15,5,15)`, Kantenlänge 0,5 mm,
Marge 0,1 mm. Keine neue Geometrie- oder Leistungszusage für XYZAC.

## Build und Grenzen

Eigene `r100.*.test.ts` mit Node-Dateizugriffen vor dem Build aus
`src/viewer` nehmen; Repository-Tests bleiben unverändert.

```sh
nice -n 19 npm run build
```

Build und TypeScript grün. Browser nicht erneut ausgeführt: keine
Frontend-Produktänderung in diesem Paket; neue Backend-Payloads werden
durch den echten Clientpfad geprüft. Letzte eigene Browserprüfungen R98
(Chromium 3/3, Firefox 3/3), nicht als neue Läufe gezählt.

Kein vollständiges Offline-Gate, keine Live-Abnahme, Golden-Neuerstellung,
Deep-Hunt oder haus-Leistungsmessung. Agreement nur für die vorgelegte
VP-I53-Korrektur innerhalb des vereinbarten Herkunftsvertrags und seiner
benannten Einschränkungen. Die Innenprüfung gehört nicht zu R100.
