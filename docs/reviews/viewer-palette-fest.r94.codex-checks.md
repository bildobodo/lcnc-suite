# R94 · Prüfaufbau und Wiederholung

Produktstand `3cc603cb`, Basis `1083235b`, Anfrage `b970fc1f`, 8. Oktober
2026. Archiv `/tmp/codex-r94-cnzsibv4/archive` aus Git mit Frontend,
Gateway, Beispielen, Testvorlagen und Skripten. 426 Frontend- und 87
Gateway-Dateien sind bytegleich zu Git; vier aufgelöste LFS-Modelle sind
gegen Größe/SHA256 ihrer Pointer geprüft. Nur vier Cachepfade wurden zur
Isolation angepasst (isolation.patch). Node-Pakete und Python-Umgebung
wurden aus dem bestehenden Checkout gelesen; erzeugte Dateien liegen in
der Archivkopie. Die 47 Belege im R93-Hashmanifest bleiben unverändert.

Keine Produktänderung, keine Builds/Tests im Live-Baum, keine
Maschinenbefehle, keine Netzwerkzugriffe und kein Browserlauf. Eigene
CPU-Läufe mit `nice -n 19`, ein Vitest-Worker. Kein vollständiges
Offline-Gate, keine Golden-Neuerstellung, kein Suite-Stopp, keine neue
Werkzeugdatenbank. Die bereits in R93 geprüften Browser-Wächter wurden
nicht erneut ausgeführt; die einzige neue Client-Änderung dedupliziert
Zeilennummern im Kollisionshinweis und ist durch Payload-Tests abgedeckt.

## Native Programme

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`.

- native_probe.py als `lcnc-gateway/r94.native_probe.py`: bytegleiche Kopie
  der R93-Sonde; acht Programme aus native-cases.json.
- prior-native.py als `lcnc-gateway/r94.prior-native.py`: bytegleiche Kopie
  des übernommenen R92-Prüfstands; elf Programme aus prior-native-cases.json.
- edges.py als `lcnc-gateway/r94.edges.py`: derselbe Prüfstand mit sieben
  zusätzlichen Programmen aus edges-cases.json. Zwei Gegenfälle, drei
  Varianten mit tatsächlich bestimmter Folgeposition, zwei Positionskontrollen.

Alle verwenden den **unveränderten nativen Parseworker**. Synthetisches
`linuxcnc.stat`, `linuxcnc.command` wirft; temporäre INI, Parameter und
Werkzeugtabelle. Jeder Fall läuft in einem eigenen Prozess. Beispiel aus
dem archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r94.edges.py r94_g98_cycle ../evidence/viewer-palette-fest.r94.codex-r94_g98_cycle.msgpack
```

Entsprechend alle Namen der drei JSON-Programmlisten ausführen. Der zweite
Parameter schreibt den echten MessagePack-Payload; die letzte stdout-Zeile
enthält die JSON-Diagnose. Die drei Laufgruppen sind als prior-native,
r93-native und edges-native (je JSON/TXT) abgelegt. Alle 26 Programme
laufen ohne Parsefehler.

**Positionskontrollen:** Für G98 und die nachträgliche Drehung wird nur M6
auf derselben Zeile durch ein sichtbares `G0` auf die konfigurierte
TOOL_CHANGE_POSITION ersetzt. Dadurch kennt der Offline-Interpreter die
Position, die ihm bei der unsichtbaren Task-Fahrt fehlt. Das übrige
Programm und die Zeilennummern sind gleich. Dies ist keine Live-Messung:
Es ist eine unabhängige Prüfung der Folgebewegungen ab einer ausdrücklich
vorgegebenen Position. G98 endet dann bei Z30 statt Z40; nach der Drehung
hat die letzte X-Fahrt 0,121320 s statt 1,292893 s.

## Repository-Tests und übernommene Gegenproben

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**416 Tests plus 24 Subtests grün.**

vitest.config.ts als `lcnc-webui/r94.vitest.config.ts`, prior-payload.test.ts
und recovery.test.ts als `src/viewer/r94.<name>` ablegen. Beide Sonden sind
gegenüber R93 ausschließlich auf R94-Belegnamen umgestellt; sämtliche
Erwartungen bleiben erhalten. Aus dem archivierten Frontend:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r94.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/r94.prior-payload.test.ts src/viewer/r94.recovery.test.ts
```

**210/210 grün**, darunter alle acht R93-Programme durch die eigene
Payload-Kette, alle sieben älteren Payload-Kontrollen und die erweiterten
Repository-Fixtures. Die korrigierten Hinweise behalten die Anzahl der
Bewegungen, nennen aber jede betroffene Zeile nur einmal.

## Neue Gegenfälle durch den Client

edges.test.ts als `src/viewer/r94.edges.test.ts` ablegen:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r94.vitest.config.ts src/viewer/r94.edges.test.ts
```

**Zwei rot / fünf grün.** Echte native Payloads → `decodePreviewStreams` →
`buildScrubTrack` → WCS-Resolver `epochTermsFor` → `sweepCollisions`.
Keine ersetzten ustart-Flags oder Zeitwerte. Die einfache gültige
Geometrie hat einen XYZ-bewegten Kopf, eine feste Box und ein bewegtes
Prüfpaar. Im G98-Gegenfall liegt die Box bei (15,5,40), mitten auf der
falsch als bekannt eingestuften Folgefahrt. Diese meldet einen Treffer
auf L6. Die Positionskontrolle mit korrektem Zyklusstart Z30 und die
G99-Variante finden dort keinen Treffer.

Die roten Assertions scheitern schon am fehlenden ustart der Folgefahrt;
alle weiteren Werte, Hinweise, Zeiten und Treffer stehen unabhängig davon
in edges-sweep.json. Die Rotationsgegenprobe meldet keinen Treffer an der
gewählten Box, aber eine bekannte, falsch berechnete Folgefahrt und einen
Hinweis, der L7 nicht mehr einschließt. Für diesen Befund wird kein
Kollisionstreffer behauptet.

## Build

Eigene `src/viewer/r94.*.test.ts` mit Node-Dateizugriffen vor dem Build aus
dem Typprüfungsbereich nehmen; Repository-Tests bleiben unverändert:

```sh
nice -n 19 npm run build
```

Build und TypeScript grün. Kein Produktfix zur Durchführung nötig.
