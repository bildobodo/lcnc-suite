# R44 · Sim-Werkzeugmesser · Belege und Grenzen

Stand `f82c323`. Keine Maschinenverbindung, keine Quittierung des E-Stops.
Alle Ausführungen im Archiv `/tmp/codex-r44-eq2f3y85`.

## Native Kontakt-Sonde

`nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B
evidence/sim-toolsetter.r44.probe.py /tmp/codex-r44-eq2f3y85` (eine Shell-Zeile).

Die Sonde importiert nur die reinen Funktionen aus `sim_toolsetter_feed.py`.
Sie extrahiert den unveränderten `FUNCTION`-Rumpf aus `sim_toolsetter.comp`,
kompiliert ihn mit `cc` als kleine C-Bibliothek in einem temporären Verzeichnis
und ruft ihn mit numerischen Werten auf. Keine HAL-Komponente wird geladen,
kein `linuxcnc.stat()` erzeugt und kein Interpreter gestartet.

Der numerische Messfall setzt WCS/G92 Z und Finderkorrektur auf null. Dann ist
der Tabellenwert aus `tool_touch_off.ngc:381,387` gleich
`abs(touchZ) + contact_G53`. Servoquantisierung/Bremsweg werden in dieser
Rechnung weggelassen. Die Werte sind Beispiele, keine Messwerte der Live-Sim:

- Gleiche Platte/Referenz −300, Länge 65, Motorversatz 0: Kontakt −235,
  neues Z65 (positive Kontrolle).
- Feeder noch −300, Routine/Marker bereits −280: Kontakt weiterhin −235,
  neues Z45. Die Sonde prüft die Folge der in der Übergabe benannten
  Verzögerung; sie behauptet keinen reproduzierten Task-Zeitablauf.
- Platte/Referenz −300, Motorposition = Gelenkposition +1: Kontakt bei
  G53 Z−236, neues Z64. Mit dem Tabellenwert als nächster physischer Länge
  entsteht in fünf idealisierten Messungen Z64, 63, 62, 61, 60.
- Manueller Trip bei fehlender Einrichtung bleibt möglich; automatischer
  Trip ohne Einrichtung bleibt aus.

Die Pin-Semantik ist in der offiziellen
[LinuxCNC-Dokumentation zu motion](https://linuxcnc.org/docs/html/man/man9/motion.9.html)
beschrieben: Motor- und Gelenkkoordinaten können sich durch Home- und weitere
Korrekturen unterscheiden; `joint.N.pos-fb` liefert die um diese Offsets
bereinigte Gelenkposition. Die Repository-Verdrahtung liest dagegen die
Signale `Xpos/Ypos/Zpos`, deren Quelle `joint.N.motor-pos-cmd` ist.
Das mitgelieferte XYZ-Profil verwendet simulierte Referenzschalter; insbesondere
liegt der Z-Schalter bei Motor-Z2 und `HOME_OFFSET` bei 1. Der exakte
resultierende Live-Versatz wurde nicht abgefragt.

`test_sim_toolsetter` im Archiv: **10 PASS**, siehe `unit.txt`.

## Viewer-Kontrolle

Quellsonde: `viewer-palette-fest.r44.browser-probe.ts`; Ablauf und Konfiguration
in `viewer-palette-fest.r44.reproduce.md`. Produktiver Archiv-Build, eigener
Mock, echtes XYZAC-Modell. Gelenk-Z bleibt −235, Tabellenlänge 65,
Plattenoberseite −300. Zwischen den Bildern ändert sich nur `tool_offset.z`
von 65 auf 0 (G43 → G49).

Die Plattenposition bleibt gleich. Die gezeichnete Werkzeugspitze wandert
nach oben; eine magenta Backplot-Strecke zeichnet die Änderung sogar nach.
`ThreeViewer.vue:2049–2051` erklärt die 65-mm-Differenz: Das Tool-Objekt
folgt dem aktiven Offset, seine Geometriespitze liegt lokal bei Z0. Die
Kontaktprüfung verwendet dagegen die unveränderte Tabellenlänge. Dieser
Werkzeug-Transform bestand schon vor R44; der neue Marker macht seine
Integrationsgrenze während der Messung sichtbar.

Bilder `contact-g43.png` / `contact-g49.png`, Zustände `marker.json`.
Kein vollständiger Werkzeugmesslauf und keine Bestätigung des noch offenen
`heavy_test.ngc`-Laufs. Die Ausrichtung des TWP-Kopfes außerhalb der genannten
B0/C0-Voraussetzung wurde nicht als unterstützter Fall geprüft.
