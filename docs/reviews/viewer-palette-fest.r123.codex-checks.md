# R123 · Codex · Planprüfung Fassung 2

Geprüft: `3e34a4e6..b8bd2c60`. Eigene Archivkopie per `git archive b8bd2c60` unter `/tmp/codex-r123-m4umumed`. Im angefragten Bereich ändern sich nur Plan und Review-Anfrage. Vorhandene R122-Belege unverändert gelesen.

## Reproduzierbare Sonde

Vom Repository-/Archivwurzelverzeichnis aus:

```bash
nice -n 19 env PYTHONPYCACHEPREFIX=/tmp/codex-r123-pycache /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python docs/reviews/viewer-palette-fest.r123.codex-contract-probe.py .
```

Für die Prüfung lag die Sonde als `r123.contract-probe.py` im Archiv; Ergebnis `r123.contract-probe.json`, mit diesen Namen anschließend als neue R123-Belege veröffentlicht. Anforderungen: Python, NumPy, C-Compiler `cc` und Standardbibliothek. Der Compiler baut ausschließlich eine temporäre lokale Bibliothek aus der Rechenfunktion der archivierten `sim_toolsetter.comp`; keine HAL-Module werden geladen oder installiert. Temporäre C-/Bibliotheksdateien werden entfernt.

Die Sonde führt aus:

- Die unveränderten reinen Repository-Funktionen `_rdp_keep` und `mode_boundary_indices`, per AST aus den archivierten Quellen entnommen. Der Plan liefert die Masken; eine künftige Maskenimplementierung wird damit nicht vorgetäuscht. Die R122-Ecken bleiben erhalten, 1001 kollineare Punkte gleicher Maske bleiben vereinfachbar und translationsinvariant.
- Den exakten C-Körper von `FUNCTION(_)` der mitgelieferten Tasterkomponente mit sieben Eingangskombinationen. Eine geänderte Plattenhöhe, fehlende Freigabe und manueller Eingang werden als reine Werte eingespeist. Die Topologie ist dabei vorausgesetzt gleich; keine HAL-Inspektion oder -Änderung. Die Ergebnisse belegen, dass die drei Topologiekriterien des Plans diese Modelle nicht unterscheiden.
- 101 mögliche Bremsendpunkte und deren relativen Rückzug: die erweiterte Hülle schließt beide ein.
- Eine ausdrücklich analytische Eingangslatenz von 100 ms bei F600. Der Unterschied zwischen geometrischem und gemeldetem Punkt geht über die vorhandene Längenformel in G43 ein und bleibt bei einer Folgebewegung nach G53 Z0 wirksam. Kein gemessener Servo-/Bremsverlauf.
- Das vorgeschlagene E8-Drahtbeispiel eines ersten G1: Rate wird benötigt, der Endpunkt liegt nach dem Plan im Rapid-Strom, während nur `feed_dep_f` beschrieben ist. Kein produktiver Serializer wurde dafür verändert.

Alle Assertions PASS. Ausgabe: `viewer-palette-fest.r123.codex-contract-probe.json`.

## Quellen und Grenzen

Für die Probe-Semantik wurde die Primärquelle [LinuxCNC v2.9.4, control.c, process_probe_inputs](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/motion/control.c#L678-L710) geprüft, ergänzt durch die [G38-Dokumentation](https://linuxcnc.org/docs/2.9/html/gcode/g-code.html#gcode:g38). Die Funktion liest den Eingang, übernimmt bei Auslösung die Rückmeldeposition und fordert dann den Abbruch an. Die Längenverwendung stammt aus der archivierten `tool_touch_off.ngc`, Abschnitte −170 bis −200.

Quellhashes und Archivkontext liegen in den gleichnamigen R123-Dateien. Es wurde keine F6-Messreihe, kein Parity-Live-Lauf und kein Controllerstart durchgeführt. Keine Maschinenbefehle, keine Live-Ports, kein Quittieren und kein Suite-Stopp. Keine Produktänderung. Interpreter-, Browser- und Backend-Gesamtgates wurden für die reine Planänderung nicht erneut ausgeführt.
