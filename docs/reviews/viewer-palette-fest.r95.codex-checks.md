# R95 · Prüfaufbau und Wiederholung

Produktstand `e18fc0e0`, Basis `2e20faa0`, Anfrage `5af81306`, 8. Oktober
2026. Archiv `/tmp/codex-r95-zrkk6jln/archive`. 426 Frontend- und 87
Gateway-Dateien stimmen bytegleich mit Git überein; vier aufgelöste
LFS-Modelle sind nach Größe und SHA256 gegen ihre Pointer geprüft.
Vier Änderungen betreffen nur Cachepfade (isolation.patch). Die 47 Belege
im R93- und 52 im R94-Hashmanifest bleiben unverändert.

Keine Produktänderung, keine Builds/Tests im Live-Baum, keine
Maschinenbefehle, Netzwerkzugriffe oder Browserläufe. Vorhandene
Node-Pakete und Python-Umgebung werden gelesen; Ausgaben und Caches
liegen in der Archivkopie. CPU-Läufe mit `nice -n 19`, ein Vitest-Worker.

## Native Fälle

Neben `lcnc-webui` und `lcnc-gateway` liegt `evidence`.

- prior-native.py als `lcnc-gateway/r95.prior-native.py`: elf ältere Fälle,
  prior-native-cases.json; Laufdaten prior-native.json/.txt.
- native_probe.py als `lcnc-gateway/r95.native_probe.py`: acht R93-Fälle,
  native-cases.json; Laufdaten r93-native.json/.txt.
- edges.py als `lcnc-gateway/r95.edges.py`: sieben R94-Fälle,
  edges-cases.json; Laufdaten r94-native.json/.txt.
- offsets.py als `lcnc-gateway/r95.offsets.py`: sieben neue Programme,
  offset-cases.json; Laufdaten offset-native.json/.txt.

Die ersten drei Prüfstände sind bytegleiche Kopien der R94-Belege. Der
vierte ergänzt nur neue Programme vor deren Auswahl. Unveränderte
Produkt-Canon und nativer Parseworker; jeder Fall läuft in einem eigenen
Prozess. `linuxcnc.stat` ist synthetisch, `linuxcnc.command` wirft, INI,
Parameterdatei und Werkzeugtabelle liegen in temporären Verzeichnissen.
Alle **33 Programme** laufen ohne Parsefehler. Beispiel aus dem Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r95.offsets.py r95_g92_from_stale ../evidence/viewer-palette-fest.r95.codex-r95_g92_from_stale.msgpack
```

Das zweite Argument schreibt den nativen MessagePack-Payload; die letzte
stdout-Zeile ist die Diagnose als JSON. Die publizierten Payloads sind
unverändert an die Client-Proben übergeben.

**Neue Positionskontrollen:** M6 wird auf derselben Zeile durch ein
sichtbares `G0 X0 Y20 Z30` ersetzt, das die konfigurierte Wechselposition
für den Offline-Interpreter herstellt. Der folgende G-Code bleibt gleich.
Kein Zugriff auf eine Maschine. Drei Gegenfälle: G92 auf Z, G10 L20 auf die
aktive Vorrichtung, G10 L20 auf eine später aktivierte Vorrichtung. Drei
entsprechende Positionskontrollen und ein G10-L2-Fall mit konstantem,
unabhängig von der aktuellen Position bestimmtem Offset.

## Korrektur der WCS-Übergabe in den bisherigen Sonden

Claudes Hinweis ist richtig: Der ScrubTrack trägt `wcsEpoch`; die Seite
übergibt dem Sweep diese Daten als `wcs` (`ThreeViewer.vue:3257`). Die
R93-/R94-Rotationssonden gaben zwar `epochTerms` mit, ließen aber die
Zuordnung zum jeweiligen Track-Punkt unter dem falschen Namen stehen.

Nur neue Sondenkopien wurden berichtigt: `{...track, wcs: track.wcsEpoch}`.
Sämtliche bisherigen Erwartungen bleiben erhalten. Dazu zwei neue
Kontrollen im R94-Sondennachlauf: Auf der bekannten R45-Folgefahrt wird
die Box mit korrekter Übergabe gefunden; ohne Übergabe wird sie verfehlt.
Beide Ergebnisse sind in edges-sweep.json enthalten (`_without_wcs` als
Negativkontrolle). Die Änderungen sind in probe-changes.patch vollständig
sichtbar. Die älteste Sonde prior-payload.test.ts verwendet ausschließlich
ungedrehte Null-WCS-Fälle und bleibt abgesehen von Ausgabedateinamen gleich.

Die Korrektur ändert keinen früheren gemeldeten Zeit- oder ustart-Befund.
Der falsche Treffer in R94 war der ungedrehte G98-Fall. Für den gedrehten
Fall wurde damals ausdrücklich kein Treffer behauptet. Die Produktseite
hatte die korrekte Feldzuordnung bereits.

## Python und Client-Kern

Im archivierten Gateway:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_gateway_util.py test_start_tlo_worker.py test_tool_change_motion_worker.py
```

**419 Tests plus 24 Subtests grün**, einschließlich der neuen nativen
G98-Unter-R-/G18-, G76-, Vorrichtungswechsel- und Zeilennummern-Fälle.

vitest.config.ts als `lcnc-webui/r95.vitest.config.ts`, die vier
`*.test.ts`-Belege als `src/viewer/r95.<name>` ablegen. Aus dem Frontend:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r95.vitest.config.ts src/viewer/collision.test.ts src/viewer/collisionWorker.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/tloEvents.test.ts src/viewer/r95.prior-payload.test.ts src/viewer/r95.recovery.test.ts src/viewer/r95.edges.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r95.vitest.config.ts src/viewer/r95.offsets.test.ts
```

Erster Lauf: **222/222 grün**, einschließlich aller übernommenen
Erwartungen und der zwei WCS-Kontrollen. Zweiter Lauf: **3 rot / 4 grün**.

Die neue Offset-Sonde nimmt echte Payloads über `decodePreviewStreams`,
`buildScrubTrack`, `epochTermsFor` und die jetzt korrekte Track-Übergabe in
den realen `sweepCollisions`. Eine einfache gültige XYZ-Maschine hat einen
bewegten Kopf und eine feste Box (ein bewegtes Prüfpaar). Die roten Fälle
lassen die letzte Fahrt als bekannt gelten und nennen im Ergebnis nur die
frühere ungeklärte Positionierung L5; an den falschen Höhen werden Treffer
auf L6 beziehungsweise L8 erzeugt. Die drei Positionskontrollen erzeugen
an denselben Boxen keinen Treffer. Die konstante L2-Variante findet den
Treffer berechtigt; ihre Position ist unabhängig von der veralteten Basis.

Die rote Erwartung lässt zwei Korrekturen zu: Die letzte Fahrt bleibt als
unbekannt markiert, oder das Ergebnis benennt ausdrücklich eine fortdauernde
Offset-/Bezugseinschränkung. Ein allgemeiner Hinweis nur auf L5 erfüllt
das nicht. Sie schreibt keine bestimmte Rekonstruktion vor. Vollständige
Positionen, Epochen, Zeiten, Flags und Resultate stehen in offset-sweep.json;
die letzte Maschinenposition wird mit dem Produkthelfer programToMachine
berechnet (in diesen Fällen ohne Werkzeugkorrektur).

## Build und Grenzen

Die eigenen Sonden mit Node-Dateizugriffen vor dem Build aus `src/viewer`
nehmen; Repository-Tests bleiben unverändert:

```sh
nice -n 19 npm run build
```

Build und TypeScript grün. Keine Produktänderung dafür nötig.
Kein vollständiges Offline-Gate, keine erneute Browserrunde (keine neue
Browser- oder UI-Implementierung), keine Live-Abnahme und keine neue
Werkzeugdatenbank. Golden-Aktualisierung und übersprungene M600-Fahrten
bleiben die benannten separaten Arbeiten.
