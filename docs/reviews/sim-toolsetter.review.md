# Review: Sim-Werkzeugmesser · Werkzeugmesser im 3D-Viewer

## Anfrage R44 (Teil 2) · Claude · Implementierungsprüfung · 30. September 2026

Teil 1 derselben Runde (Paletten-Teil A) steht in
[viewer-palette-fest.ideen.md](viewer-palette-fest.ideen.md), Abschnitt
„Implementierungsrunde R44“. Dort auch Arbeitsort und Regeln.

**Umfang:**
- `b4ac6fc` Sim: the tool setter trips the probe where a real one would
- `7aad422` Viewer: the tool setter the WebUI measures on, as a puck whose top face is the contact height

### Anlass (Operator, 29. September)

In der Sim brauchte jede Werkzeugmessung einen manuellen „Simulate probe
trip“. Ein Trip zur falschen Zeit schrieb eine beliebige Länge in die
Tabelle; mein zeitgesteuerter Hilfsauslöser erzeugte T13 = 32 → 16 → 0,6 →
−15 mm, und der Operator sah das Werkzeug in der Spindelnase. Dazu die Frage
des Operators: „Ist die Position bekannt, wo er auslöst? … eine Anzeige der
Kontaktposition.“

### 1. Sim-Werkzeugmesser (`b4ac6fc`)

- **`sim_toolsetter.comp`** (Echtzeit, Servo-Thread): `contact` = Steuerpunkt
  (Gelenke 0..2) im X/Y-Fenster der Platte (± `radius`, in
  `hallib/sim_toolsetter.hal` 25 mm) UND Z − Tabellenlänge des
  Spindelwerkzeugs ≤ Plattenhöhe; `out` = `contact` ODER der manuelle Trip der
  WebUI. Werkzeug als senkrecht angenommen (3-Achs- und XYZAC-Sim; die TWP-Sim
  misst nur bei B0/C0).
- **`sim_toolsetter_feed.py`** (Userspace): Platte aus `#3100`–`#3102` der
  Var-Datei (neu gelesen bei Änderung), Tabellenlänge aus STAT. Ohne Platte,
  ohne Werkzeug oder ohne positive Länge kein automatischer Trip, Grund auf
  stderr. Reine Entscheidungen (`read_params`, `spindle_length`,
  `feed_values`), getestet in `lcnc-gateway/test_sim_toolsetter.py`.
- **Verdrahtung:** `hallib/sim_toolsetter.hal`, von allen `core_sim_*.hal`
  anstelle von `net probe-in => motion.probe-input` eingebunden. `hallib`
  ist in die installierten Konfigurationen verlinkt; `sim_toolsetter/` kam
  in die gemeinsame Liste. Keine INI-Änderung.
- **Installation:** `install.sh` baut die Komponente wie die
  TWP-Kinematik (`sudo halcompile --install`); `config_sync_check.py` nennt
  eine fehlende Komponente mit ihrem Befehl.
- **Absichtlich treu:** Ein Rückzug (`#3009`) kürzer als der Bremsweg der
  schnellen Tastung endet in „probe already tripped“, wie an der Maschine
  (README). Der Operator hatte 6000 mm/min eingestellt; mit seinem
  Einverständnis steht die schnelle Tastung jetzt auf 2000 mm/min (Settings,
  kein Code).
- **Warum die Tabellenlänge:** Sie ist die physische Länge des Sim-Werkzeugs.
  Eine Messung liefert sie zurück (auf eine Servo-Periode der Tastvorschübe
  genau), nichts driftet. `tool_touch_off.ngc` schreibt die Tabelle erst nach
  beiden Tastungen (Zeile 387), die Länge bleibt also während der Messung
  fest.

**Benannte Grenze, bitte bewerten:** Die Platte kommt aus der Var-Datei.
Die WebUI setzt die Werte vor jeder Messung im Interpreter (`vars`), die
Datei schreibt Task erst beim nächsten `Interp::synch()`. Ändert der
Operator die Position, kann die erste Messung danach noch an der alten Platte
auslösen bzw. ins Leere tasten. Eine echte Platte bewegt sich durch eine
Eingabe gar nicht; für die Sim halte ich die Verzögerung um eine Synchronisierung
für tragbar. Siehst du einen Weg, der ohne HAL-Zugriff des Gateways auskommt?

**Noch offen, live:** Ein `heavy_test.ngc`-Lauf ganz ohne Hilfsauslöser
(erwartet T13 ≈ 65,067 mm). Er wartet auf die Quittierung des Watchdog-Trips
durch den Operator.

### 2. Werkzeugmesser im Viewer (`7aad422`)

- `viewer/toolsetterMarker.ts`: ein Puck Ø 30 × 40 mm im Maschinenrahmen
  (`machineFrameGrp`, wie die Maschinenbox), Mitte `touchX`/`touchY`,
  **Oberseite = `touchZ`**. Das ist die Z des Steuerpunkts, wenn ein Werkzeug
  der Länge 0 berührt; eine Werkzeugspitze trifft die Oberfläche also genau
  dort, wo die Sim auslöst. In den Graustufen des Modells (Stahl, hellere
  Kontaktfläche).
- Nur bei eingerichtetem Messer (`confirmedToolsetter().ok`, die vom Server
  bestätigte Sektion; die Fallback-Nullen sind keine Position). Bei jeder
  Settings-Änderung neu platziert. Layer „Tool Setter“ (Standard an) mit
  kurzer Hilfe (113 Zeichen).
- **Benannte Entscheidung:** Der Durchmesser des Pucks sagt nichts über das
  Auslösefenster. Die Sim löst in einem ± 25-mm-Quadrat aus (seitliche
  Toleranz); reale Messer haben ihre eigene Größe. Der Puck zeigt Position
  und Kontakthöhe.
- **Wächter:** `toolsetterMarker.test.ts` (Platzierung, Ursprung =
  Kontaktfläche, Einheitenmaßstab, Grautöne); `e2e/toolsetter.viewer.spec.ts`
  (ohne Sektion verborgen, eingerichtet an Position, Layer blendet aus, folgt
  einem anderen Client, unvollständige Sektion verbirgt). Rot bewiesen mit
  ignorierter Platzierung („no saved section: nothing to show“) und
  ignoriertem Layer („the Tool Setter layer is off“).
