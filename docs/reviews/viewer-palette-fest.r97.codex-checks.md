# R97 · Prüfaufbau und Wiederholung

Produktstand `621eb25d`, Basis `e8b2f912`, Anfrage und Plan `118696b6`,
8. Oktober 2026. Archiv `/tmp/codex-r97-smu4q27y/archive`. 425 Frontend-
und 87 Gateway-Dateien sind bytegleich mit Git; vier aufgelöste LFS-Modelle
stimmen nach Größe und SHA256 mit ihren Pointern überein. Fünf Änderungen
isolieren Cachepfade und den Mock-Port (isolation.patch). Die Hashmanifeste
R93 (47 Dateien), R94 (52), R95 (66) und R96 (91) bleiben unverändert.

Keine Produktänderung, Builds/Tests im Live-Baum, Maschinenbefehle oder
Zugriffe auf :5173/:8000. Node-Pakete und Python-Umgebung werden gelesen;
Ausgaben und Caches liegen im Archiv. CPU-Läufe mit `nice -n 19`, jeweils
ein Vitest-/Playwright-Worker. Browser nacheinander am eigenen Mock auf
`127.0.0.1:4188`.

## Native Fälle

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`. Alle Belege dieser
Runde tragen den Präfix `viewer-palette-fest.r97.codex-`. Prüfstände ins
archivierte Gateway kopieren:

| Beleg | Zielname | Fallliste | Ergebnis |
|---|---|---|---|
| prior-native.py | r97.prior-native.py | prior-native-cases.json | prior-native.json/.txt |
| native_probe.py | r97.native_probe.py | native-cases.json | r93-native.json/.txt |
| edges.py | r97.edges.py | edges-cases.json | r94-native.json/.txt |
| offsets.py | r97.offsets.py | offset-cases.json | r95-native.json/.txt |
| scanner.py | r97.scanner.py | scanner-cases.json | r96-native.json/.txt |
| arc.py | r97.arc.py | arc-cases.json | arc-native.json/.txt |
| extra.py | r97.extra.py | extra-cases.json | extra-native.json/.txt |
| braking.py | r97.braking.py | braking-cases.json | braking-native.json/.txt |

Die ersten sechs Prüfstände sind bytegleiche R96-Kopien. Die beiden neuen
ergänzen Fälle; braking.py setzt zusätzlich MAX_ACCELERATION = 10 an den
drei Achsen der temporären INI. Das beeinflusst keine simulierte Bremsung:
der native Vorschauworker simuliert keinen Controller-Bremsvorgang.

Jeder Fall läuft in einem eigenen Prozess durch unveränderte Produkt-Canon
und nativen Parseworker. `linuxcnc.stat` ist synthetisch, `linuxcnc.command`
wirft; INI, Parameterdatei und Werkzeugtabelle liegen in temporären
Verzeichnissen. **57 Programme ohne Parsefehler**: 41 übernommen, 15 neue
Offset-/Kontrollfälle und ein F300-Bogen. Beispiel aus dem Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r97.extra.py r97_l_plus_active ../evidence/viewer-palette-fest.r97.codex-r97_l_plus_active.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r97.braking.py r97_arc_braking ../evidence/viewer-palette-fest.r97.codex-r97_arc_braking.msgpack
```

Die letzte stdout-Zeile ist die Diagnose als JSON; das zweite Argument
schreibt den unverändert an die Client-Proben übergebenen MessagePack-Payload.
Die Offsetfälle verwenden TOOL_CHANGE_POSITION = 0 20 30. Bei den fünf
Positionskontrollen ersetzt ein sichtbares `G0 X0 Y20 Z30` nur das M6;
der folgende Programmtext bleibt gleich. Kein Maschinenzugriff.

## Python und Client

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**428 Tests plus 24 Subtests grün.**

vitest.config.ts als `lcnc-webui/r97.vitest.config.ts`, die acht `*.test.ts`-
Belege als `src/viewer/r97.<name>` kopieren. Vom Frontend aus:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r97.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/simRows.test.ts src/viewer/r97.prior-payload.test.ts src/viewer/r97.recovery.test.ts src/viewer/r97.edges.test.ts src/viewer/r97.offsets.test.ts src/viewer/r97.scanner.test.ts src/viewer/r97.limit.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r97.vitest.config.ts src/viewer/r97.extra.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r97.vitest.config.ts src/viewer/r97.braking.test.ts
```

Erster Lauf: **246/246 grün**, einschließlich der sechs in R96 roten
Erwartungen. Die einzige Schnittstellenanpassung außer Belegpfaden:
Die alte Limit-Sonde reicht jetzt `stop: limitStopOf(t)` weiter, genau wie
ScrubBar. Erwartungen bleiben gleich. Alle Änderungen der Sondenkopien
stehen in probe-changes.patch.

Zweiter Lauf: **5 rot / 10 grün**. Drei gültige Formen mit Pluszeichen und
zwei wirklich ausgeführte, numerisch unveränderte Offset-Schreibzugriffe
werden übersehen. Drei erkannte Schreibzugriffe, zwei unabhängige
Kontrollen und fünf sichtbare Positionskontrollen bestehen. Die Sonde
verwendet echte Payloads, Dekodierung, Track, WCS-Auflösung und Sweep.
Die einfache XYZ-Geometrie entspricht der bisherigen Sonde. Bei den
beiden Nullwert-Schreibfällen liegt die feste Box bei (15,5,15), bei der
inaktiven Vorrichtung bei (25,5,55), sonst bei (15,5,45). Die vollständigen
Resultate stehen in extra-sweep.json.

Dritter Lauf: **1 rot**. Beweisart klar getrennt:

1. Native Geometrie: R96-Bogen mit F300, max Z50, Radius10. Der erste
   gesetzte outside-Punkt liegt bei ca. 3,23944 Vorschausekunden.
2. Produktpfad: limitStopOf und buildSimRows kennzeichnen einen synthetischen
   Befund bei ca. 3,24944 s / Z50,54054 als nach dem Halt.
3. Analytische Gegenbedingung: Ein zulässiger Zustand beim erstmaligen
   Kreuzen von Z50 hat vZ=5 mm/s (F300, Tangente dort entlang +Z, normale
   Beschleunigung 2,5 mm/s²). Bei |aZ|≤10 mm/s² braucht bereits sofortige
   maximale Verzögerung mindestens vZ²/(2aZ)=1,25 mm, also Stillstand erst
   ab Z51,25. Die gekennzeichnete Position ist damit nicht durch diesen
   crossing-Punkt als unerreichbar erwiesen. Controller-Latenz ist für
   dieses Gegenargument nicht erforderlich und würde den Weg vergrößern.

Das ist **kein Lauf von LinuxCNC Motion und keine gemessene Bremskurve**.
Die Zeitangaben dienen der Zuordnung im Preview-Track, nicht als behauptete
reale Stoppuhrzeiten. Gezeigt wird ein Gegenbeispiel zur universellen
Stillstandsobergrenze aus Geometrieflags. Die Abbremsphase bei `tpAbort`
ist zusätzlich im LinuxCNC-Quelltext belegt (Links im Review).

## Build und Browser

Die eigenen `r97.*.test.ts` mit Node-Dateizugriffen vor dem Build aus
`src/viewer` nehmen. Repository-Tests bleiben unverändert.

```sh
nice -n 19 npm run build
```

Build und TypeScript grün. Der erste Aufruf fand in der frisch isolierten
Kopie `vue-tsc` nicht, weil der Verweis auf node_modules/.bin fehlte
(build-initial.txt). Nach Ergänzen dieses Verweises auf die vorhandenen
Werkzeuge lief derselbe Build durch; keine Produktänderung.

Browser-Konfigurationen als `r97.chromium.config.ts` und
`r97.firefox.config.ts` ablegen; e2e/ctl.ts nur in der Kopie auf
127.0.0.1:4188 umstellen (isolation.patch).

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r97.chromium.config.ts --grep 'an offset set from the unknown position|the list is the timeline|the summary names each kind'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r97.firefox.config.ts --grep 'an offset set from the unknown position|the list is the timeline|the summary names each kind'
```

**Chromium 3/3 und Firefox 3/3 grün**: Metadaten auf der Seite, Listenmarkierung
und schmale Zeile mit sichtbarem Rapid. Diese Tests bestätigen die Umsetzung,
nicht die Behauptung eines garantierten Controller-Stillstands.

Plan Fassung2 ist als Vertrag geprüft, noch keine Innenprüfung implementiert
oder als Implementierung abgenommen. Kein vollständiges Offline-Gate,
keine Live-Abnahme, keine neue Werkzeugdatenbank oder Golden-Neuerstellung,
kein Deep-Hunt und kein haus-Leistungslauf.
