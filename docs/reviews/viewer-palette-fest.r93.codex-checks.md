# R93 · Prüfaufbau und Wiederholung

Produktstand `6e498e6c`, Basis `35a3afa2`, Anfrage `06097a83`, 8. Oktober
2026. Archiv `/tmp/codex-r93-gwy9_721/archive`. 425 Frontend- und 87
Gateway-Dateien sind bytegleich zum Produktstand; vier aufgelöste
LFS-Modelle stimmen nach Größe und SHA256 mit ihren Git-Pointern überein.
Fünf isolierende Änderungen betreffen ausschließlich Cachepfade und den
Mock-Port (isolation.patch). Keine Produktänderung, keine Builds/Tests im
Live-Baum, keine Maschinenbefehle und keine Zugriffe auf Live-Ports.
Eigene Testläufe mit `nice -n 19`, ein Vitest-/Playwright-Worker; die
Browserläufe nacheinander. Die 38 R92-, 24 R91- und 37 R90-Belege sind
gegen ihre veröffentlichten Hashmanifeste unverändert.

## Native Programme

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`. `native_probe.py`
als `lcnc-gateway/r93.native_probe.py` ablegen. Es ist der native
Repository-Prüfstand mit acht zusätzlichen Programmen (native-cases.json)
und zusätzlichen Feed-Ausgabefeldern. Der Worker und die Canon sind
unverändert. `linuxcnc.stat` ist synthetisch, `linuxcnc.command` wirft;
INI, Parameter und Werkzeugtabelle liegen in temporären Verzeichnissen.
Jeder Fall läuft in einem eigenen Prozess. Beispiel im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r93.native_probe.py r93_inline_g91_cycle ../evidence/viewer-palette-fest.r93.codex-r93_inline_g91_cycle.msgpack
```

Die acht Fälle und vollständigen Payloads sind publiziert. native.json
enthält die dekodierte Diagnose, native.txt die Prozessausgaben. Für die
elf übernommenen R92-Fälle gilt dasselbe mit `prior-native.py` als
`r93.prior-native.py` und prior-native-cases.json. Der übernommene
Prüfstand ist bytegleich zum R92-Beleg. Die Payload-Sonde aus R92 wurde nur
auf neue R93-Dateinamen umgestellt; keine Erwartung wurde geändert.

## Python und Client-Kern

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**414 Tests und 24 Subtests grün.**

vitest.config.ts als `lcnc-webui/r93.vitest.config.ts`, prior-payload.test.ts
als `src/viewer/r93.prior-payload.test.ts`, recovery.test.ts als
`src/viewer/r93.recovery.test.ts` ablegen; aus `lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r93.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/r93.prior-payload.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r93.vitest.config.ts src/viewer/r93.recovery.test.ts
```

Erster Lauf: **201/201 grün**, einschließlich sieben übernommener
Payload-Fälle. Zweiter Lauf: **vier rot / vier grün**. Die zweite Sonde
nimmt die echten nativen Payloads über `decodePreviewStreams`,
`buildScrubTrack` und `epochTermsFor` in den echten `sweepCollisions`.
Eine einfache gültige Geometrie (bewegter Kopf, feste Box bei Z39) macht
den aus veralteten Positionen erzeugten Treffer im G91-Zyklus sichtbar.
Die erste Assertion eines roten Falls schlägt bereits am `ustart` fehl;
recovery.json enthält daneben alle Zeiten, Positionen und Sweep-Ergebnisse.
Keine Flags oder Zeiten der Payloads wurden für den Test erfunden.

Beim zusätzlichen G28-Fall ist die Assertion bewusst nur auf die
Rückkehrstrecke ab dem unbekannten relativen Zwischenpunkt gerichtet:
Dass G28 am Ende einen festen Referenzpunkt erreicht, wird nicht bestritten.
Die erste Sondenfassung verlangte dort pauschal unbekannte Starts auch
nach der Rückkehr; der publizierte Lauf verwendet die engere Erwartung.
Die übrigen Fälle und Ergebnisse sind unverändert.

## Build und Browser

Eigene `src/viewer/r93.*.test.ts` vor dem Build aus dem Typprüfungsbereich
nehmen (Node-Dateizugriffe); Repository-Tests bleiben enthalten.

```sh
nice -n 19 npm run build
nice -n 19 node node_modules/@playwright/test/cli.js test --config r93.chromium.config.ts --grep 'a move whose start no parse can know|a finding shows its own move of a hidden layer'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r93.firefox.config.ts --grep 'a move whose start no parse can know|a finding shows its own move of a hidden layer'
```

Build/TypeScript grün. Ein erster Aufbau scheiterte nur an zwei unbenutzten
Imports in der eigenen Readiness-Sonde (build-setup.txt); sie wurden vor
dem publizierten erfolgreichen Build entfernt. Keine Produktkorrektur.
Die beiden unveränderten Repository-Wächter bestehen in Chromium **2/2**
und Firefox **2/2**.

readiness.spec.ts nach `e2e/r93.readiness.spec.ts`, die drei Browser-Konfigurationen
unter ihren `r93.<name>.config.ts`-Namen ins Frontend kopieren:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r93.readiness.config.ts
```

Die R92-Gegenprobe wurde nur an den neuen Hinweistext angepasst; außerdem
wurden die beiden unbenutzten Imports entfernt. Sie verzögert STL-Antworten
um 1,5 s. **In beiden Browsern ist der alte ungeschützte Aufruf rot, der
neue optionale Aufruf grün** — einschließlich exaktem Warntext, Marker
und sichtbarer Hilfe. Diese zwei roten Negativkontrollen sind erwartet.
Ausschließlich eigener Mock auf `127.0.0.1:4188`, keine Wiederverwendung
eines laufenden Servers. Die Mock-Server wurden von Playwright beendet.

Kein vollständiges Offline-Gate, keine Live-Sim-Prüfung, keine neue
Werkzeugdatenbank, keine Neuerstellung der Goldens. Übersprungene
M600-Fahrten bleiben außerhalb dieser Runde.
