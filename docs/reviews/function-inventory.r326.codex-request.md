## Claude · Plan Paket G2 (Fläche und Kompensation) · Anfrage R326 · 6. November 2026

**Operatorentscheidung Q282-2 (6. November): „alles jetzt“.** In einem Paket entstehen die Rasterpunkte (F-SURFACE.S2), die Override-Sperre während des Scans (F-OVERRIDE.S2c) und die gewölbte Prüffläche für die Kompensationsmethoden (F-COMP.S4). Grundlage ist `feat/g1-guards` `89003ac0`, gebaut wird auf `feat/g2-surface`. Dies ist ein Plan, noch nichts gebaut.

### 1. Die Prüfvorrichtung: ein Werkstück in der 3-Achs-Sim

**Ohne Neuinstallation.** `sim_toolsetter.so` liegt systemweit in `/usr/lib/linuxcnc/modules` (Stand 29. September), und `sudo` verlangt ein Passwort. Ich ändere deshalb `sim_toolsetter.comp` nicht. `sim_toolsetter.hal` lädt die vorhandene Komponente mit `count=2`; sie deklariert kein `singleton`.
- **Instanz 0** bleibt die Platte, unverändert.
- **Instanz 1** ist das Werkstück. Ihr Fenster ergibt sich aus `plate-x/-y` und `radius`: ±40 um X 550, Y 550. Ihre Höhe `plate-z` ist nicht gesetzt, sondern **verdrahtet**. Eine Kette aus Standardbausteinen (`sum2` ×5, `mult2` ×2, `names=surf-…`) berechnet sie im Servotakt aus `joint.0/1.pos-fb`:

  f(x, y) = −169 + 0,05·(x−550) − 0,03·(y−550) − 0,0024·((x−550)² + (y−550)²)

  Das ist ein geneigtes Paraboloid. Die Kuppe liegt 6 mm über der Basis −175, und über das Raster beträgt der Höhenunterschied rund 7,7 mm.

**Verkettung.**
- `probe-in → sim-toolsetter.1.manual`
- `sim-toolsetter.1.out → sim-toolsetter.0.manual`
- `sim-toolsetter.0.out → motion.probe-input`

`or2_0` ist im 3-Achs-Profil schon belegt; die Kette braucht kein weiteres `or2`.

**Freigabe nur im 3-Achs-Profil.** Instanz 1 wird in allen Profilen geladen. Freigegeben ist sie nur über die neue Datei `hallib/sim_surface.hal`, die allein `core_sim_3.hal` einbindet; sie verdrahtet `enable`, `tool-length`, Fenster und Höhe. In den 5- und 6-Achs-Profilen bleibt `enable` = 0, und Instanz 1 reicht nur den Handauslöser durch. Das ist dieselbe Semantik wie heute.

**Takt.** Die Kette kann höchstens eine Servoperiode hinter Instanz 1 liegen. Beim Antasten steht X/Y still, f ist also konstant, und der Verzug wirkt nicht. Die Kontaktprüfung bleibt servogenau wie an der Platte.

**Im Betrieb.** Das Werkstück ist wie die Platte ein physisches Hindernis: Bringt eine MDI-Bewegung oder ein Jog die Spitze im Fenster unter f, meldet LinuxCNC „Probe tripped during non-probe MDI command“ bzw. „… joint jog“. Kein bisheriger Fall fährt dorthin, das Fenster liegt in Y 510…590. Geprüft habe ich:
- Plateau: X 100…500 bei Y 300
- → Zero / → G30: Start bei 200/200
- Jog: 300/300
- Start ab Zeile: G54 100…200
- Platte: 10/10
- Abgang: Y 300

Der 3D-Viewer zeichnet das Werkstück nicht (Feature-Sperre); das README nennt es.

**Lesen und Vorbedingung.**
- `plate_from_hal` liest künftig nur Instanz 0; heute gewinnt der letzte Treffer.
- Vor dem Scan prüft der Lauf, dass die laufende Instanz das Werkstück trägt: `sim-toolsetter.1.enable` ist verdrahtet, und die Konstanten der Kette stimmen mit den Literalen überein, gelesen per `halcmd getp`. Sonst `Refused`.

### 2. Native Fälle (3axis_xyz), nach `probe_cases`

**Vorbereitung.**
- T99 wird auf die Art der UI geladen (Helfer aus `probe_cases`), L0 = 50.
- `G10 L2 P1 X0 Y0 Z−175`: G54 Z steht auf der Basis, damit die Karte nur Abweichungen hält. Mit Z0 würde die Kompensation einen Offset von rund −170 anfahren und in `eoffset-limited` laufen.
- Raster 5×5 über X/Y 518…582, Abstand 16. Die Koordinaten sind ganzzahlig, denn `compensation.py` rundet auf 0,1, nimmt `int()` der Grenzen und tastet ein 1-mm-Raster ab; ganzzahlige Punkte treffen dessen Knoten genau.
- Scan-Variablen #3050–#3059: die Grenzen, 5/5 Punkte, schnell 1500 mm/min, langsam 50 mm/min, sichere Höhe 15 (WCS), Suchtiefe 25. Dazu #3014 aus der Var-Datei und #3021 = 1.
- Start wie die UI: EIN `mdi O<surface_scan> CALL` mit `vars`.

**`surface-scan` (F-SURFACE.S2).**
- `probe-results.txt` der Kopie hat genau 25 Zeilen. X/Y sind die Rasterknoten in Schlangenfolge.
- Z = f(x, y) + 175 ± 0,005. Bei der langsamen Antastung (50 mm/min) sind das 0,8 µm je Servotakt.
- f ist ein **Literal im Auswerter**, nicht aus der HAL gelesen. Ein statischer Wächter hält die HAL-Konstanten gleich diesen Literalen.
- „liefert die Punkte für die Kompensation“: `comp_grid_version` im Status steigt nach dem Ende. Der Weg dahin: DONE → `reload-req` → `compensation.py` lädt.
- Gegenproben:
  - ein Knoten 1 mm versetzt erwartet → FAIL;
  - X/Y vertauscht erwartet → FAIL. Die Fläche ist in X und Y verschieden geneigt; auf der ebenen Platte bliebe ein Vertauschen unsichtbar.
- R283 nannte für S2 das ebene 3×3-Raster auf der Platte. Die gewölbte Fläche belegt S2 strenger, weil jeder Punkt seinen eigenen Wert hat; das ebene Raster entfällt.

**`surface-override-lock` (F-OVERRIDE.S2c).**
- Ausgewertet mit `eval_override_lock` (aus M600) über die Frames des Scans: frei vor dem Start, gesperrt durch die Bewegung, frei höchstens 2 s nach dem Ende.
- `M50 P1` steht im `finally`.
- Gegenprobe wie bei M600: erwartet „frei während“ → FAIL.

**`comp-*` (F-COMP.S4).** Die Kompensation wird über die Befehle der UI geschaltet: `set_compensation` und `set_compensation_method`. Das Gate `probe` der Methodenwahl ist bei eingeschaltetem eoffset zu. Je Methode deshalb:
1. AUS und ablaufen lassen (`eoffset_enabled` False, |eoffset| < 0,001);
2. Methode setzen;
3. AN und warten, bis eingeschwungen: `eoffset_z` und Joint Z ±0,0005 über 0,5 s, kein `eoffset-limited`;
4. lesen.

Die Fälle:
- **`comp-on-off`** an den Knoten A (550, 550) und B (518, 582), bei WCS Z 12:
  - AN: Joint Z − eoffset = kommandiert, eoffset = Kartenwert ± 0,002. Der Abstand Spitze–Fläche (Joint Z − L − f) ist 12 ± 0,01 an A und an B.
  - AUS: eoffset 0, Abstand = 12 − (f + 175), also 6,000 mm an A und 13,475 mm an B.
- **`comp-follows`**: AN an A, dann G1 nach B (F1000) mit eingeschalteter Kompensation, eingeschwungen. Der Abstand an B ist gleich dem Abstand an A ± 0,01: Die Spitze folgt der Fläche.
- **`comp-nearest` / `comp-linear` / `comp-cubic`** am Prüfpunkt Q = (538, 550). Q liegt auf der Kante (534, 550)–(550, 550) bei einem Viertel, also auf keinem Knoten; an Knoten stimmen alle drei Methoden überein. Die Erwartungen stammen aus den **aufgezeichneten** Punkten:
  - nearest = z(534, 550), exakt;
  - linear = 0,75·z(534, 550) + 0,25·z(550, 550). Eine achsparallele Kante eines regelmäßigen Rasters liegt in jeder Delaunay-Triangulierung; die Erwartung ist also unabhängig von scipy;
  - cubic: |cubic − linear| ≥ 0,05 UND |cubic − f_dev| < |linear − f_dev|. Cubic folgt der Krümmung, linear schneidet die Sehne.

  Die Toleranz ist 0,002: `counts` × 0,001, abgeschnitten. Vorab mit scipy 1.15.3 auf idealen Punkten gerechnet, auch über den Weg von `compensation.py` (1-mm-Raster, nächster Knoten):

  | | Wert an Q |
  |---|---|
  | nearest | 4,586 |
  | linear | 4,939 |
  | cubic | 5,070 |
  | f_dev | 5,054 |

- Liegen die Methoden am Prüfpunkt nicht mindestens 0,05 auseinander, ist der Fall ungültig (`incomplete`), nie PASS.
- Gegenproben:
  - der Wert einer anderen Methode erwartet → FAIL;
  - Abstand um 0,05 versetzt erwartet → FAIL;
  - eine ebene f erwartet → die Unterscheidungsprüfung schlägt an.

**Abschluss.**
- Kompensation AUS und abgelaufen; sonst schließt das `probe`-Gate den Werkzeugwechsel im folgenden M600-Fall.
- Methode zurück auf den zu Beginn gelesenen Wert, G54 Z0, `M50 P1`.
- Es läuft die ganze native Reihe, nicht der neue Schritt allein.

### 3. Wächter im Gate

- **Reine Auswerter** `eval_surface_scan` und `eval_comp_*`: Unit-Tests auch für die Wege „unvollständig“ und „ungültig“: fehlender Punkt, zusätzlicher Punkt, falsche Reihenfolge, nicht eingeschwungen, nicht unterscheidender Punkt.
- **Statisch für `sim_surface.hal`:**
  - die Konstanten der Kette sind gleich den Literalen;
  - das Fenster enthält das Raster;
  - die Kontakthöhen mit L0 liegen im Joint-Fenster;
  - nur `core_sim_3.hal` bindet die Datei ein;
  - Instanz 0 bleibt die Platte (`plate_from_hal`).
- **`rules.py`** bekommt die neue HAL-Datei und den Test.
- **Inventar:** Die drei Aussagen bekommen `native`-Belege; F-OVERRIDE.S2c gilt dann für `3axis_xyz`.

### 4. Nicht in diesem Paket

- die Zeichnung des Werkstücks im 3D-Viewer;
- ein Werkstück in den 5- und 6-Achs-Profilen. Die Surface-Map ist eine 3-Achs-Funktion; der Scan bricht bei gedrehten Achsen ab;
- der Hinweis auf unlesbare Werkzeugzeilen im Werkzeug-Tab.

### Fragen

- **Q326-1:** Soll cubic nur über die beiden Ungleichungen geprüft werden oder zusätzlich auf Gleichheit mit scipy aus den aufgezeichneten Punkten (± 0,002)? Mein Vorschlag ist beides: Die Gleichheit prüft die Verdrahtung von `compensation.py` (Kartenlesen, Transponieren, 1-mm-Raster, Knotenwahl); die Ungleichungen sind das unabhängige Orakel.
- **Q326-2:** Die HAL-Kette mit `count=2` statt einer geänderten Komponente. Das kommt ohne Neuinstallation und ohne sudo aus, und jede Branch-Sim bleibt lauffähig. Einverstanden?

**Erbeten:** `agreement` oder `findings` zum Plan.
