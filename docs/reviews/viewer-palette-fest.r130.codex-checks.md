# R130 · Codex · Planprüfung E4a Fassung 6

Stand: `f4ebe4fc7356dffe6f3a5221d4793b793e9c37de`, Diff ab `20128e28`.
Nur Plan, Review und zwei Belegdateien geändert. Geprüft wurden E4a,
die R129-Antworttabelle und der vorhandene native Beleg. Die parallel
entstehende E-Implementierung gehört nicht zu dieser Prüfung.

## Eigene Probe

Ausführung in einer Archivkopie, mit den unveränderten fünf Suite-Python-
Dateien und der Beispiel-INI. `interpreter`, `emccanon` und `hal` wurden
vor dem Import durch leere Module ersetzt. Die Probe führt keine Remap-
Funktion aus und verwendet keine native Controller-Bindung. NumPy dient
nur dem Import des gebündelten Remap-Moduls.

```sh
mkdir /tmp/r130-source
git archive f4ebe4fc | tar -x -C /tmp/r130-source
nice -n 19 lcnc-gateway/.venv/bin/python docs/reviews/viewer-palette-fest.r130.codex-audit.py /tmp/r130-source
```

Die drei Bedingungen aus E4a wurden wörtlich als kleine Prüffunktion
nachgebildet: Funktionsdatei = Moduldatei, Moduldatei hat den erwarteten
Hash, vier Suite-Helfermodule haben ihre erwarteten Hashes. Das ist eine
Prüfung des Planvertrags, kein Test einer fertigen Produktfunktion.

Ergebnisse (`viewer-palette-fest.r130.codex-audit.json`):

- Alle sechs unveränderten Einstiegspunkte bestehen alle drei Bedingungen.
- Nach `remap.g682 = remap.g683` bestehen weiterhin alle Bedingungen.
  Tatsächlich liegt hinter dem Attribut `g682` der unveränderte Code von
  `g683` (Zeile 1621), mit Lesemaske ABC statt der leeren Maske für g682.
  Kein Dateibyte und kein Codeobjekt wurde verändert oder gefälscht.
- Auch eine Umbelegung eines Helfers innerhalb desselben Moduls bleibt
  unerkannt. Die ergänzende Probe ordnet `get_current_work_offset` dem
  vorhandenen `get_current_rotary_positions` zu. Der Einstiegspunkt g684
  heißt weiterhin g684; seine Globals zeigen auf den anderen Helfer.
  Diese zweite Probe behauptet nur eine Abweichung des Aufrufgraphen,
  keinen gültigen kompletten Maschinenablauf: Die Rückgabetypen wären bei
  Ausführung zusätzlich zu berücksichtigen.
- Die neue statische Rotary-Regel unterscheidet im kleinen Vertragsmodell
  keine Wechselposition / XYZ von XYZABC / XYZABCUVW / unzulässiger Anzahl.
  Das Modell bestätigt die Fallunterscheidung des Texts; es ist kein
  Implementierungstest. Die Quellstellen der bestehenden Unbekannt-
  Übergänge wurden erneut gegengelesen.

Alle Assertions bestanden. Die Gegenprobe zu VP129-02 zeigt, dass die
vorgeschlagenen Prüfbedingungen die falsche Zuordnung noch akzeptieren;
das ist ausdrücklich kein grüner Akzeptanztest einer Umsetzung.

## Claudes nativer Beleg

Der Bericht zeigt `remap_called=[7.0]` und `main_top_called=[]` für den
synthetischen M777-Fall. Das Skript erzeugt dazu einen Remap- und einen
TOPLEVEL-Einstieg gleichen Namens. Dieser Nachweis unterstützt die Suche
beim geladenen Remap-Modul; er prüft weder die drei Hash-Bedingungen noch
eine Umbelegung innerhalb desselben Moduls.

Nicht erneut ausgeführt: Das Belegskript bindet `HERE` fest an
`/home/cnc/lcnc-suite-stop/lcnc-gateway` und stammt laut Bericht aus
`fix/start-dep`. Für spätere reproduzierbare Implementierungstests bitte
auf einen angegebenen Snapshot beziehen. Der native Befund wird hier
als gelieferter Beleg eingeordnet, nicht als eigener nativer Lauf.

Kein Bedarf für breite Produktgates bei diesem Dokument-Diff. Keine
Live-Ports, HAL-Abfragen, Maschinenbefehle oder Produktänderungen. Im
Live-Baum nur der neue Review-Anhang und neue `r130.codex-*`-Belege;
bestehende Belege bleiben unverändert.
