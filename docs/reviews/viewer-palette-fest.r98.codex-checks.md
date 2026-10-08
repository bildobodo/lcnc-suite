# R98 · Prüfaufbau und Wiederholung

Produktstand `f196f8ec` (Produktcommit `ae99ec4d`), Basis `6b367399`,
Anfrage `b53b7316`, 8. Oktober 2026. Archiv:
`/tmp/codex-r98-9k3yqhs1/archive`.

425 Frontend- und 87 Gateway-Dateien sind bytegleich mit Git; vier aufgelöste
LFS-Modelle stimmen nach Größe und SHA256 mit ihren Pointern überein.
Fünf Anpassungen betreffen ausschließlich Cachepfade und den Mock-Port
(`isolation.patch`). Die Hashmanifeste R93–R97 bleiben unverändert.
Keine Produktänderung, Builds/Tests im Live-Baum, Maschinenbefehle oder
Zugriffe auf :5173/:8000. Python-Umgebung und Node-Pakete werden gelesen;
Ausgaben und Caches liegen im Archiv. CPU-Läufe mit `nice -n 19`, jeweils
ein Vitest-/Playwright-Worker; Browser nacheinander am eigenen Mock auf
`127.0.0.1:4188`.

## Native Fälle

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`. Alle Belege dieser
Runde tragen den Präfix `viewer-palette-fest.r98.codex-`. Die folgenden
Prüfstände ins archivierte Gateway kopieren:

| Beleg | Zielname | Fallliste | Ergebnis | Anzahl |
|---|---|---|---|---|
| prior-native.py | r98.prior-native.py | prior-native-cases.json | prior-native.json/.txt | 11 |
| native_probe.py | r98.native_probe.py | native-cases.json | r93-native.json/.txt | 8 |
| edges.py | r98.edges.py | edges-cases.json | r94-native.json/.txt | 7 |
| offsets.py | r98.offsets.py | offset-cases.json | r95-native.json/.txt | 7 |
| scanner.py | r98.scanner.py | scanner-cases.json | r96-native.json/.txt | 7 |
| arc.py | r98.arc.py | arc-cases.json | arc-native.json/.txt | 1 |
| extra.py | r98.extra.py | extra-cases.json | r97-native.json/.txt | 15 |
| braking.py | r98.braking.py | braking-cases.json | braking-native.json/.txt | 1 |
| modes.py | r98.modes.py | modes-cases.json | modes-native.json/.txt | 7 |
| foreign.py | r98.foreign.py | foreign-cases.json | foreign-native.json/.txt | 3 |

Die ersten acht Prüfstände sind bytegleiche R97-Kopien. Die zwei neuen
ergänzen Programme und die Diagnose `position_write_lines(program)`.
Jeder Fall läuft in einem eigenen Prozess durch Produkt-Canon und den
nativen Offline-Interpreter. `linuxcnc.stat` ist synthetisch,
`linuxcnc.command` wirft; INI, Parameterdatei, Unterprogramme und
Werkzeugtabelle liegen in temporären Verzeichnissen. **67 Programme ohne
Parsefehler**: 57 übernommen, sieben Modusfälle und drei Herkunftsproben.

Beispiel, aus dem archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r98.foreign.py r98_foreign_collision_spaced ../evidence/viewer-palette-fest.r98.codex-r98_foreign_collision_spaced.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r98.foreign.py r98_foreign_collision_plain ../evidence/viewer-palette-fest.r98.codex-r98_foreign_collision_plain.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r98.foreign.py r98_foreign_collision_position_control ../evidence/viewer-palette-fest.r98.codex-r98_foreign_collision_position_control.msgpack
```

Die letzte stdout-Zeile enthält die Diagnose als JSON. Das zweite Argument
schreibt den unverändert an die Client-Proben übergebenen MessagePack-Payload.
Die neuen Fälle verwenden TOOL_CHANGE_POSITION = 0 20 30. Bei der
Positionskontrolle ersetzt ein sichtbares `G0 X0 Y20 Z30` ausschließlich
das M6; der folgende Text bleibt gleich. Das ist eine native
Positionskontrolle, kein Lauf des Motion-Controllers.

**Prüfgrenze:** Eine zusätzliche Sonde `r98_inline_tool_l10` mit
`G10 L10 P1 Z40` und späterem `G43 H1` endet nativ mit SIGSEGV (Exit −11).
Dieselbe Sonde endet auch auf der Basis `6b367399` mit −11; kein
R98-Rückschritt nachgewiesen (`native-probe-limit.json`). Der bestehende
Prüfstand benennt seine Grenze bei Werkzeugtabellen-Lookups bereits im
Quelltext. Die endgültige `modes-cases.json` enthält nur die sieben
erfolgreich ausgeführten Fälle; aus diesem Lauf wird keine native
L10/L11-Abdeckung abgeleitet. Zur Wiederholung der Grenze ist der
zusätzliche Fall in `modes.py` enthalten (für `_tool_` mit `T1 M6`).

## Python und Client

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**429 Tests plus 24 Subtests grün.**

`vitest.config.ts` als `lcnc-webui/r98.vitest.config.ts`, die zehn eigenen
`*.test.ts`-Belege als `src/viewer/r98.<Name>` kopieren. Vom Frontend aus:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r98.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/simRows.test.ts src/viewer/r98.prior-payload.test.ts src/viewer/r98.recovery.test.ts src/viewer/r98.edges.test.ts src/viewer/r98.offsets.test.ts src/viewer/r98.scanner.test.ts src/viewer/r98.limit.test.ts src/viewer/r98.extra.test.ts src/viewer/r98.braking.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r98.vitest.config.ts src/viewer/r98.modes.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r98.vitest.config.ts src/viewer/r98.foreign.test.ts
```

- Kernlauf **264/264 grün**, einschließlich aller sechs roten Erwartungen
  aus R97. Die acht übernommenen Client-Sonden ändern ausschließlich ihre
  Belegpfade; Erwartungen bleiben gleich (`probe-changes.patch`).
- Modus-Kontrollen **6/6 grün**: G55-Wechsel ohne Schreibzugriff, explizites
  L2, G55 mit G92 im selben Satz sowie die entsprechenden Fremdaufrufe.
  Ein Fremd-G92 mit numerisch unverändertem Vorschauwert wird hier erkannt.
- Fremdaufruf-Gegenprobe **2 rot / 2 grün**. Der auseinandergezogene
  CALL wird als `inline` gelesen. Die fremde L2 trifft auf die explizite
  Hauptdatei-L2 und der echte G92-Schreibzugriff wird ignoriert. Der echte
  Clientpfad meldet einen falschen L7-Treffer auf Maschinen-Z15; die native
  Positionskontrolle läuft auf Z5. Bei normalem CALL bleibt L7 unbekannt,
  aber die Ursache wird fälschlich Hauptdatei-L2 zugeschrieben. Vollständige
  Track-, WCS- und Sweep-Werte stehen in `foreign-sweep.json`.

Die neue Sonde verwendet echte Payloads, Dekodierung, Track,
WCS-Auflösung und Sweep. Die einfache XYZ-Geometrie entspricht den
bisherigen Sonden; die feste Box liegt bei `(15,5,15)`, Kantenlänge
0,5 mm, Marge 0,1 mm. Sie prüft Herkunft und Folgewirkung, keine neue
Geometrie- oder Leistungszusage für das XYZAC-Maschinenmodell.

## Build und Browser

Die eigenen `r98.*.test.ts` mit Node-Dateizugriffen vor dem Build aus
`src/viewer` nehmen. Repository-Tests bleiben unverändert.

```sh
nice -n 19 npm run build
```

Build und TypeScript grün. Browser-Konfigurationen als
`r98.chromium.config.ts` und `r98.firefox.config.ts` ablegen;
`e2e/ctl.ts` nur in der Kopie auf `127.0.0.1:4188` umstellen
(`isolation.patch`).

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r98.chromium.config.ts --grep 'an offset set from the unknown position|the list is the timeline|the summary names each kind'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r98.firefox.config.ts --grep 'an offset set from the unknown position|the list is the timeline|the summary names each kind'
```

**Chromium 3/3 und Firefox 3/3 grün.** Metadaten auf der Seite,
Listenmarkierung und schmale Zusammenfassung bestehen.

Kein vollständiges Offline-Gate, keine Live-Abnahme, Golden-Neuerstellung,
Deep-Hunt oder haus-Leistungsmessung. Der Innenprüfungsplan bleibt auf dem
in R97 abgenommenen Stand; seine Umsetzung gehört nicht zu R98.
