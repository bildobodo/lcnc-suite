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


---

## Review R44 · Codex · 30. September 2026

**Stand:** Archiv `f82c323`, Umfang `b4ac6fc` und `7aad422`.
**Ergebnis: findings — ST-I01 bis ST-I03 offen, jeweils P2.**
Keine Abfrage der laufenden Sim, kein Maschinenbefehl und keine Quittierung
des Watchdog-Trips. Der ausstehende Live-Lauf bleibt Sache des Operators.

### Bestätigt

Die Kontaktformel läuft im Servo-Thread; der manuelle Trip bleibt über OR
erhalten. Die reinen Feed-/Installationsprüfungen bestehen (**10 Tests**).
Die neue Komponente ist in allen drei Sim-Profilen eingebunden und als
Installationsabhängigkeit dokumentiert.

Der Puck hat seine Oberseite am lokalen Ursprung; Einheitenmaßstab,
Graustufen, Einrichtungsprüfung und Layer-Verhalten sind getestet. Die
mitgelieferte Browserprüfung besteht. Die eigene XYZAC-Prüfung bestätigt
die sichtbare Position in vier Themes und stabile Platzierung beim Wechsel
der aktiven Werkzeugkompensation. Der Konflikt liegt beim Verhältnis zum
Auslöser bzw. zur gezeichneten Werkzeugspitze, nicht in der Z-Ausdehnung
des Pucks.

### ST-I01 · P2 — alte Auslöseplatte und neue Messreferenz können Werkzeuglängen verfälschen

**Stelle:** `sim_toolsetter_feed.py:102–126`, im Zusammenspiel mit
`gateway.py:3679–3739` und `tool_touch_off.ngc:381,387`.

Die ausdrücklich benannte Verzögerung ist **in dieser Form nicht tragbar**.
Sie betrifft nicht nur die Darstellung: Der Feeder nimmt `#3102` aus der
Datei, die Messroutine aus dem Interpreter; der Marker folgt schon den
bestätigten Einstellungen. Es gibt keinen Nachweis, dass der Feeder die
für den Start geltende Position übernommen hat. Die Datei wird vom Gateway
zunächst direkt geschrieben; ein anschließender Moduswechsel kann sie
über `synch()` noch einmal aus dem bisherigen Interpreterstand schreiben.
Danach gesetzte MDI-Parameter und 200-ms-Feeder-Polling bieten keinen
Übernahmevertrag für den Messstart.

Konkrete Folge der in der Übergabe zugestandenen alten Platte, mit der
unveränderten nativen Kontaktformel und der Ergebnisformel der Routine:

| Fall | Feeder-Platte | Routine/Marker | physische Tabellenlänge | Kontakt G53 Z | neuer Tabellenwert |
| --- | ---: | ---: | ---: | ---: | ---: |
| Synchron, positive Kontrolle | −300 | −300 | 65 | −235 | 65 |
| Neue Höhe noch nicht am Feeder | −300 | −280 | 65 | −235 | **45** |

Die 20-mm-Abweichung wird als Messung in die Tabelle geschrieben. Bei einer
X-/Y-Verlegung kann die Messung stattdessen die alte Platte verfehlen.
Das ist eine isolierte Folgenrechnung, keine Behauptung eines nachgestellten
Live-Task-Zeitablaufs.

**Antwort auf die Architekturfrage:** Ja, das geht ohne HAL-Zugriff des
Gateways. Für euren bisherigen Vertrag sollte der Sim-Feeder einen atomaren,
pro INI zugeordneten Setup-Snapshot erhalten und dessen Generation/Hash als
übernommen quittieren. Der Start wartet auf genau diese Bestätigung oder
meldet, warum sie fehlt. Der vorhandene Userspace-Feeder bleibt der einzige
HAL-Schreiber; Snapshot/Quittung können über eine lokale Datei oder IPC laufen.
Die bestätigten gespeicherten Einstellungen sind bereits eine mögliche
Quelle; bloßes Umstellen des Dateipfades ohne Übernahmebestätigung beseitigt
die Polling-Lücke nicht.

Alternativ wäre eine **feste physische Sim-Platte** mit separat einstellbarer
Kalibrierreferenz konsistent. Dann müssten Feeder und Marker diese feste
physische Position zeigen. Das heutige Verhalten „zunächst alte Platte,
später automatisch neue Platte“ mischt beide Modelle. Für den vorliegenden
Vertrag empfehle ich die gemeinsame, bestätigte Setup-Generation.

Wächter: Setup ändern und unmittelbar messen, Moduswechsel, verzögerter
Feeder, fehlgeschlagene Übernahme; niemals mit zwei unterschiedlichen
Positionsständen eine erfolgreiche Messung bestätigen.

### ST-I02 · P2 — Motorposition wird mit G53-Plattenkoordinaten verglichen

**Stelle:** `hallib/sim_toolsetter.hal:23–25`; Signalquellen in
`core_sim_3.hal:28–30`, `core_sim_5.hal:30–32`, entsprechend `core_sim_6.hal`.

`Xpos/Ypos/Zpos` kommen von `joint.N.motor-pos-cmd`. Sie sind nicht die in
den Kommentaren behaupteten Gelenkpositionen. Referenzierung und weitere
Korrekturen können Motor- und Gelenkkoordinaten verschieben; für die
bereinigte Gelenkposition gibt es `joint.N.pos-fb`.
[LinuxCNC-Pin-Dokumentation](https://linuxcnc.org/docs/html/man/man9/motion.9.html).

Das ist für die ausgelieferten Profile relevant: Das XYZ-Profil referenziert
gegen simulierte Schalter; etwa Motor-Z2 und `HOME_OFFSET = 1` liegen nicht
am selben Zahlenwert. Auch erneutes Referenzieren kann den Unterschied
ändern. Die numerische Sonde nimmt bewusst nur einen Beispielversatz von
+1 mm an, keinen abgefragten Live-Wert:

- Platte/Referenz −300, Tabellenlänge 65; Motor-Z = Gelenk-Z +1.
- Kontaktformel löst bei **G53 Z−236** statt −235 aus.
- Die Routine berechnet **Z64**. Weil diese Tabelle im nächsten Lauf wieder
  die „physische Länge“ liefert, werden daraus 63, 62, 61, 60.

**Erwartung:** Den Feeder-Auslöser mit Gelenkkoordinaten im selben Rahmen
wie die Platte verdrahten; den bestehenden Motor-Loopback nicht als
Messkoordinate wiederverwenden. Einen Test mit nichtnulligem Home-/Motorversatz
und wiederholter Messung aufnehmen. Die Aussage „nichts driftet“ gilt mit
der aktuellen Verdrahtung nicht.

[Native Kontakt-/Folgensonde](sim-toolsetter.r44.probe.py),
[Ergebnisse zu ST-I01/ST-I02](sim-toolsetter.r44.probe.json),
[Quellen und genaue Prüfgrenzen](sim-toolsetter.r44.evidence.md).

### ST-I03 · P2 — bei G49 zeigt die Werkzeugspitze keinen Kontakt mit dem neuen Marker

**Stelle:** `ThreeViewer.vue:2045–2052` und Integration des neuen Markers
bei Zeile 1541; `tool_touch_off.ngc:211` setzt für die Messung `G49`.

Die Sim berechnet die physische Spitze aus **Tabellenlänge**. Der Viewer
verschiebt sein Werkzeugobjekt dagegen um den **aktiven `tool_offset`**;
dessen Geometriespitze liegt lokal bei Z0. Bei `G49` wird der aktive Offset
null, obwohl weiterhin ein Werkzeug mit positiver Tabellenlänge eingespannt ist.

Eigene XYZAC-Browserkontrolle: Gelenk-Z unverändert −235, Tabellenlänge 65,
Puckoberseite −300. Mit `tool_offset.z = 65` steht die gezeichnete Spitze auf
der Platte. Nur den Offset auf 0 gesetzt: Die gezeichnete Spitze wandert
**65 mm nach oben**, während der Sim-Auslöser weiterhin physischen Kontakt
berechnet. Der Backplot zeichnet diese Änderung sogar als Strecke nach.

[Kontakt mit G43](sim-toolsetter.r44.contact-g43.png),
[gleiche physische Pose mit G49](sim-toolsetter.r44.contact-g49.png),
[Status/Kamerawerte](sim-toolsetter.r44.marker.json),
[Browser-Sonde](viewer-palette-fest.r44.browser-probe.ts).

Der Werkzeug-Transform bestand schon vorher; dies ist eine **Integrationslücke
des neuen Kontaktmarkers während genau seines Messablaufs**. Der bisherige
Marker-Test prüft nur Position und Sichtbarkeit, keinen solchen Kontaktfall.

**Erwartung:** Physisch gezeichnetes Werkzeug und aktiven programmierten
Bezugspunkt unterscheiden. Die bekannte physische Werkzeuglänge muss bei
G49 am Spindelkopf erhalten bleiben, ohne die bestehende TCP-/Pfadberechnung
blind mitzuschieben. Die Platte nicht zum falschen Werkzeugbild verschieben.
Wächter: gleicher physischer Zustand vor/nach G49, mit Kontakt an derselben
Puckoberseite; die Messroutine verwendet genau diesen Zustand.

### Weitere Entscheidungen und Prüfgrenzen

Der Puck darf eine schematische Positions-/Höhenmarkierung sein. Dann ist
Ø30 gegenüber dem ±25-mm-Sim-Fenster als Illustration akzeptabel; die kurze
Hilfe sollte klar sagen, dass er nicht die Auslösefläche oder eine zusätzliche
Kollisionsgeometrie beschreibt. Die dokumentierte B0/C0-Voraussetzung der
TWP-Sim bleibt eine Grenze; getiltete Messungen sind hier nicht abgenommen.

10 Backend-Tests **PASS**, Marker-Unit-Tests im gemeinsamen 111er-Lauf
**PASS**, Marker-Browserwächter **PASS**, eigene XYZAC-Browserprobe **PASS**.
Die Kontakt-Sonde bestätigt die genannten numerischen Abweichungen mit dem
originalen C-Funktionsrumpf, ohne HAL oder LinuxCNC zu starten. Kein kompletter
Werkzeugmesslauf, kein vollständiges Offline-Gate, kein `heavy_test.ngc`-Lauf.
[Einzelheiten](sim-toolsetter.r44.evidence.md). Produktcode und alte Belege
unverändert; eigener Mock und Browser beendet.
