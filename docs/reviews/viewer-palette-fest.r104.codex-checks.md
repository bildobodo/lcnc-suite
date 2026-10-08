# R104 · Codex · Planprüfung Fassung 3

Geprüft: `3059001d..5903b870`, Anfrage `9dff8814`. Beide Änderungen betreffen nur Markdown-Dateien. Kein M600-Produktcode wurde gebaut oder verändert. Review der drei offenen Planpunkte VP102-01, VP102-03 und VP103-01 aus R103.

## Geprüfter Vertrag

- Herkunft je Schlüssel mit `applied`, `read`, `assumed`, `unknown`; Teilübernahmen werden nicht zu einem gemeinsamen Erfolg erklärt. Neustart/spätes Anbinden ohne Beleg ist keine behauptete Boot-Datei. Fehlgeschlagene oder unklare Übernahmen sperren die Vorhersage; Dateiannahmen bleiben als Annahmen sichtbar.
- „Wie beim G30-Vertrag“ verweist auf den bestehenden vollständigen Vertrag (`gateway.py:1286ff`, `:8224ff`): `_cmd_lock` vor `_var_file_lock`, beide über Synchronisation und Snapshot; `RCS_DONE`; neuer Inode; zusammengehöriges `fstat` und Lesen; alle verlangten Werte vorhanden und endlich; Dateithreads enden vor Freigabe der Sperre. Ein fehlender Wert wird nicht 0. Externe Schreiber sind durch diese lokalen Sperren nicht kontrolliert.
- Auslassung beginnt einheitlich am Start des nicht vorhergesagten G38-Segments. Weder volle Suchfahrt noch bestimmte Zeit oder Kontakte dahinter werden erfunden.
- Erfolgreicher Vorschauzweig schreibt die angenommenen Probe-Ergebnisse vor dem Rückzug fort. Ergebnisse gehören zum Arbeitsrahmen am Auslösepunkt, nicht zu den Maschinenkoordinaten oder zum späteren Rückzugsort.

## Native Prämissenprüfung

`codex-native.py` verwendet `native_start_probe.py` aus einer Archivkopie, mit synthetischem `linuxcnc.stat()`, verbotenem `linuxcnc.command()` und separater temporärer INI-/Var-/Werkzeugtabellendatei pro Prozess. Nur die vorhandene Python-Umgebung dient als Abhängigkeit. Keine Ports, kein Task-Synch auf der laufenden Instanz, keine Maschinenbefehle.

Die Programme expandieren **nur das im Plan vorgeschlagene Prinzip**, nicht die noch ungeschriebene M600-Umsetzung:

1. zum angenommenen Auslösepunkt fahren;
2. #5061–#5069 aus #5420–#5428, danach #5070=1;
3. zurückziehen;
4. nach G43 und neutralisiertem Koordinatenrahmen die gespeicherten Werte über Diagnose-Endpunkte lesen.

Sieben Fälle, alle Erwartungen grün:

| Fall | Erwartetes gespeichertes XYZ |
|---|---|
| einzelne Probe / langsame Probe ausgelassen | 20, 30, −90 |
| zuvor abweichendes altes G38-Ergebnis | 20, 30, −90 |
| G54 X5 Y7 Z10 | 15, 23, −100 |
| zusätzlich G92 X1 Y2 Z3 als Versatz | 14, 21, −103 |
| G54 X5 Y7 Z10, R90 | 23, −15, −100 |
| zweite Probe überschreibt zwischenzeitlich abweichendes Ergebnis | 20, 30, −90 |
| A=25° | 20, 30, −90; gespeichertes A=25 |

Alle Fälle lesen #5070=1; nicht belegte Achsen bleiben 0. Das sind Prämissenproben für den geplanten Koordinatentransfer, keine Live-Parität und kein Test des künftigen vollständigen Aufrufs.

Bei der Sondenentwicklung musste die **Auslese** die vorhandene Payload-Aufbereitung berücksichtigen: Ein Koordinatenwechsel kann einen zusätzlichen Bezugspunkt derselben Zeile erzeugen; Nullbewegungen und kollineare Zwischenpunkte können entfallen. Die endgültigen Diagnosebewegungen sind deshalb ein Zickzack mit bekannten, wieder abgezogenen Additionen und lesen den tatsächlichen Endpunkt der jeweiligen eindeutigen Programmzeile. Die ersten drei Auslesefehler bleiben als `native-initial.txt`, `native-noop.txt` und `native-collinear.txt` erhalten. Weder die erwarteten Probe-Koordinaten noch Produktcode wurden dafür geändert.

## Wiederholung

Git-Archiv von `9dff8814` mit `lcnc-gateway/`, Belegskript im Unterordner `evidence/`. Nur in `/tmp`:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python evidence/viewer-palette-fest.r104.codex-native.py
```

Neue Dateien nur im Archiv; die temporäre native Sondendatei wird wieder entfernt. Bestehende Review-Belege nicht als Ausgabepfad verwenden.

## Grenzen und Implementierungsprüfung

Kein erneuter Build, Gate-, Browser- oder Live-Lauf bei einer reinen Planänderung. Das geplante Zurückschreiben vorhandener #3xxx-Zeilen durch `task_plan_synch` bleibt der im Plan ausdrücklich verlangte native Implementierungsnachweis. Hier wurde weder ein echter Synch ausgelöst noch eine neue Gateway-Buchführung implementiert. Bei ausbleibendem Nachweis darf keine Herkunft `read` entstehen.

In der Umsetzung muss der Textscan konservativ bleiben: aus indirekten/unklaren Parameterschreibern oder nicht analysierbaren Aufrufen nicht die Unverändertheit bestimmter Schlüssel ableiten. Dann den betroffenen Satz als nicht bestätigt behandeln; externe Schreiber nicht als von Gateway-Sperren überwacht ausgeben. Die einfachere breite Invalidierung passt in den angenommenen Herkunftsvertrag.

Quelle für die Probe-Ergebnissemantik: [LinuxCNC 2.9, G38](https://linuxcnc.org/docs/2.9/html/gcode/g-code.html#gcode:g38), am 8. Oktober 2026 geprüft.

Archivdateien gegen Git/LFS validiert. R102-/R103-Belege gegen ihre Hashmanifeste unverändert. Einzelheiten in `context.json`, neue Belege im SHA256-Manifest.
