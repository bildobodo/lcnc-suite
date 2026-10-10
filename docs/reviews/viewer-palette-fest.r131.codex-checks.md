# R131 · Codex · Planprüfung E4a Fassung 7

Geprüft: `223bdbfe..7990c6a2`, vollständiger HEAD
`7990c6a21dfc6a04eb8990fbd10ddd734f78176b`. Der Diff ändert ausschließlich
Plan und Review. Keine Abnahme der parallel entstehenden Implementierung.

## Reproduktion

```sh
mkdir /tmp/r131-source
git archive 7990c6a2 | tar -x -C /tmp/r131-source
nice -n 19 lcnc-gateway/.venv/bin/python docs/reviews/viewer-palette-fest.r131.codex-audit.py /tmp/r131-source
```

Die Probe verwendet NumPy für den Import der unveränderten Suite-Quellen.
Vorher werden `interpreter`, `emccanon` und `hal` durch leere Module ersetzt.
Sie führt keine Remap-Funktion und keinen nativen Interpreter aus.

Für jede der fünf Dateien werden dieselben gelesenen Bytes gehasht,
geparst und kompiliert. Die Referenz wird nicht ausgeführt. Der bekannte
Suite-Aufrufgraph folgt direkten Funktionsnamen und den Importaliasen
zwischen den Suite-Modulen. Verglichen werden echte Python-Funktionen,
Codeobjekt-Gleichheit, die Herkunftsdatei und der Funktionsnamensraum.
Der Namensraum wird an jedem Glied verfolgt: Ein Helfer ruft aus seinen
eigenen `__globals__` weiter, nicht aus einem beliebigen gleichnamigen
Modul-Dictionary. Das setzt die Zusage „jedes Glied“ konkret um.

Dies ist ein kleines Modell des neuen Planvertrags auf den echten
Suite-Funktionen, kein Test der Produktimplementierung und kein allgemeiner
Python-Analysator. Fremdobjektmethoden und externe Bibliotheken sind gemäß
der Planabgrenzung nicht Gegenstand dieser Probe.

## Ergebnisse

Alle Assertions bestanden. Vollständige Ergebnisse einschließlich der
geprüften Definitionen und Hashes in `viewer-palette-fest.r131.codex-audit.json`.

| Fall | Ergebnis |
|---|---|
| g682 unverändert, 23 erreichte Definitionen | angenommen |
| g684 unverändert, 10 erreichte Definitionen | angenommen |
| g69_core unverändert, 4 erreichte Definitionen | angenommen |
| g683 unverändert, 30 erreichte Definitionen | angenommen |
| g53x_core unverändert, 40 erreichte Definitionen | angenommen |
| twp_touchoff unverändert, 27 erreichte Definitionen | angenommen |
| R130: g682 wird auf g683 umgebunden | am falschen Codeobjekt abgelehnt |
| R130: get_current_work_offset wird auf get_current_rotary_positions umgebunden | am falschen Codeobjekt abgelehnt |
| importierter Alias _active_fixture_index wird auf fixture_base umgebunden | am falschen Codeobjekt abgelehnt |
| _rot_x im Modul twp_transform wird auf to_table_frame_vector umgebunden | an zwei erreichten Aufrufstellen abgelehnt |
| nach Wiederherstellung aller Bindungen | alle sechs Einstiegspunkte wieder angenommen |

Die vier Umbelegungen ändern keine Datei und kein Codeobjekt. Die
Hash-Prüfung allein könnte sie deshalb weiterhin nicht sehen; der neue
Vergleich bindet nun die erwartete Definition an den tatsächlich
erreichten Namen. Die Gegenfälle werden vor jeder Ausführung ihrer Rümpfe
abgewiesen. Aus den synthetischen Umbelegungen wird kein vollständiger
Maschinenablauf oder Kollisionsbefund abgeleitet.

## Umfang und Grenzen

VP129-01 und die Hook-/Routine-Abgrenzung waren bereits auf Planebene
angenommen und sind unverändert. Der ergänzte Text-/Parameterwächter
adressiert die im Plan ausdrücklich aus dem Funktionsgraphen ausgeklammerten
G-code-Textaufrufe; seine Produktumsetzung ist später zu prüfen.

Keine breite Testsuite für diesen Plan-Diff erforderlich. Kein nativer
Live-Lauf, keine Live-Ports, HAL-Abfragen, Maschinenbefehle, Builds oder
Produktänderungen. Im Live-Baum ausschließlich der neue Review-Anhang
und neue `r131.codex-*`-Belege. Vorhandene Belege unverändert.
