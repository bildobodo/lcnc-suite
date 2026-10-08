# R96 · Prüfaufbau und Wiederholung

Produktstand `71558c9d`, Basis `8d26b6e0`, Anfrage und Plan `51ee829d`,
8. Oktober 2026. Archiv `/tmp/codex-r96-qtn1i4st/archive`. 425 Frontend-
und 87 Gateway-Dateien sind bytegleich mit Git; vier aufgelöste LFS-Modelle
stimmen nach Größe und SHA256 mit ihren Pointern überein. Fünf Änderungen
isolieren Cachepfade und den Mock-Port (isolation.patch). Die 47 R93-,
52 R94- und 66 R95-Belege ihrer Hashmanifeste sind unverändert.

Keine Produktänderung, Builds/Tests im Live-Baum, Maschinenbefehle oder
Zugriffe auf :5173/:8000. Vorhandene Node-Pakete und Python-Umgebung werden
gelesen; Ausgaben und Caches liegen im Archiv. CPU-Läufe mit `nice -n 19`,
je ein Vitest-/Playwright-Worker. Browser verwenden nur den eigenen Mock
auf `127.0.0.1:4188`; Chromium und Firefox laufen nacheinander.

## Native Fälle

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`. Die Dateien aus
diesem Belegsatz tragen den Präfix `viewer-palette-fest.r96.codex-`.
Prüfstände ins archivierte Gateway kopieren:

| Beleg | Zielname | Fallliste | Ergebnis |
|---|---|---|---|
| prior-native.py | r96.prior-native.py | prior-native-cases.json | prior-native.json/.txt |
| native_probe.py | r96.native_probe.py | native-cases.json | r93-native.json/.txt |
| edges.py | r96.edges.py | edges-cases.json | r94-native.json/.txt |
| offsets.py | r96.offsets.py | offset-cases.json | r95-native.json/.txt |
| scanner.py | r96.scanner.py | scanner-cases.json | scanner-native.json/.txt |
| arc.py | r96.arc.py | arc-cases.json | arc-native.json |

Die ersten vier Prüfstände sind bytegleiche R95-Kopien. Die beiden neuen
ergänzen Fälle und geben die neuen Offset-Metadaten aus. Jeder Fall läuft
in einem eigenen Prozess durch unveränderte Produkt-Canon und nativen
Parseworker. `linuxcnc.stat` ist synthetisch, `linuxcnc.command` wirft;
INI, Parameterdatei und Werkzeugtabelle liegen in temporären Verzeichnissen.
Alle **41 Programme** laufen ohne Parsefehler (33 übernommen, sieben
Scanner-Fälle, ein Bogen). Beispiel aus dem Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r96.scanner.py r96_g92_decimal ../evidence/viewer-palette-fest.r96.codex-r96_g92_decimal.msgpack
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r96.arc.py r96_arc_interior_limit ../evidence/viewer-palette-fest.r96.codex-r96_arc_interior_limit.msgpack
```

Die letzte stdout-Zeile ist die Diagnose als JSON; das zweite Argument
schreibt den unverändert an die Client-Proben übergebenen MessagePack-Payload.
Die Scanner-Gegenfälle nutzen `TOOL_CHANGE_POSITION = 0 20 30`.
Der Bogen braucht keinen Werkzeugwechsel; im Prüfstand ist max Z = 50.

## Python und Client

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**424 Tests plus 24 Subtests grün.**

vitest.config.ts als `lcnc-webui/r96.vitest.config.ts`, sechs `*.test.ts`-
Belege als `src/viewer/r96.<name>` kopieren. Vom Frontend aus:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r96.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/simRows.test.ts src/viewer/r96.prior-payload.test.ts src/viewer/r96.recovery.test.ts src/viewer/r96.edges.test.ts src/viewer/r96.offsets.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r96.vitest.config.ts src/viewer/r96.scanner.test.ts src/viewer/r96.limit.test.ts
```

Erster Lauf: **235/235 grün**, einschließlich aller bisherigen drei roten
Offset-Fälle und ihrer grünen Kontrollen. Die Sonden reichen jetzt
`staleOffsetLines` und `staleOffsetUntracked` weiter, wie die Seite.
Die seit R95 korrekte Übergabe `wcs: track.wcsEpoch` bleibt erhalten.
Sondenänderungen stehen vollständig in probe-changes.patch.

Zweiter Lauf: **6 rot / 2 grün**. Vier gültige G-Wort-Schreibweisen umgehen
die Erkennung. Ein nie ausgeführtes G92 im if-[0]-Zweig wird dagegen als
Ursache L5 genannt. Standard-G92 und konstantes G10.0 L2 sind grüne Kontrollen.
Die Scanner-Sonde verwendet echte Payloads, Dekodierung, WCS-Auflösung,
Track und Sweep mit derselben einfachen XYZ-Maschine wie R95.

Die Bogen-Sonde verwendet den nativen Limitbefund, den realen Track und
`lineFirstMoveCum` wie ScrubBar sowie das reale `buildSimRows`. Ein bewusst
synthetischer Kollisionsdatensatz bei t=1 s prüft ausschließlich dessen
neue Haltenotiz: Die Strecke liegt dort noch innerhalb des Limits
(Z≈40,1414); erster außerhalb liegender Track-Punkt bei ≈9,7183 s. Sie beweist
keine konkrete reale Kollisionsgeometrie und misst keinen Controller-Halt.
Die Aussage zum möglichen Halt während eines Bogens ist zusätzlich am
LinuxCNC-Quelltext geprüft (Links im Review). Der lokale Node-Lauf protokolliert
einen abgefangenen localStorage-Hinweis aus einem Browser-Modul; alle acht
Assertions werden ausgeführt, die sechs Fehler sind die genannten Erwartungen.

## Plan-Sonden

plan-probe.mjs als `lcnc-webui/r96.plan-probe.mjs` ablegen:

```sh
nice -n 19 node r96.plan-probe.mjs
```

Das Ergebnis steht in plan-geometry.json. Ein vollständig enthaltener
Quader scheitert am vorgeschlagenen Einschluss seiner transformierten
lokalen AABB. Drei nicht achsenparallele Strahlen durch Kanten einer
Box liefern je zwei Dreieckstreffer am selben Ort: reine Trefferparität
entscheidet dreimal falsch „außen“. Das sind Gegenbeispiele für den Plan,
kein Test einer bereits existierenden Innenprüfung.

## Build und Browser

Die eigenen `r96.*.test.ts` mit Node-Dateizugriffen vor dem Build aus
`src/viewer` nehmen. Repository-Tests bleiben unverändert.

```sh
nice -n 19 npm run build
```

Build und TypeScript grün. Die Browser-Konfigurationen als
`r96.chromium.config.ts` und `r96.firefox.config.ts` ablegen; e2e/ctl.ts
nur in der Kopie auf `127.0.0.1:4188` umstellen (isolation.patch).

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r96.chromium.config.ts --grep 'an offset set from the unknown position|the list is the timeline|the summary names each kind'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r96.firefox.config.ts --grep 'an offset set from the unknown position|the list is the timeline|the summary names each kind'
```

**Chromium 3/3, Firefox 3/3 grün**: Metadaten bis zur Seite, Listenmarkierung,
schmale Zeile mit sichtbarem Rapid und Zusammenfassung. Die bestehenden
Markierungstests bestätigen die Umsetzung, nicht die Vollständigkeit der
zugrunde gelegten Controller-Regel.

Kein vollständiges Offline-Gate, keine Live-Abnahme, keine neue
Werkzeugdatenbank und keine Golden-Neuerstellung. Remap- und
Positionsparameter-Grenzen sowie übersprungene M600-Fahrten wurden nicht
zusätzlich untersucht. Kein Deep-Hunt oder langer haus-Leistungslauf.
