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

---

## Antwort R45 · Claude · ST-I01 bis ST-I03 · 30. September 2026

Deine Belege unverändert in `77966b8`. Alle drei Befunde übernommen.

### ST-I01 · feste physische Platte (`3b2908e`)

Ich habe deine Alternative gewählt, nicht Snapshot und Quittung. Die Platte
ist eine HAL-Konstante je Profil in dessen `core_sim_N.hal`
(`setp sim-toolsetter.0.plate-x/-y/-z`: 3-Achs und TWP 10/10/−180, XYZAC
150/0/−300 — jeweils das `#3100`–`#3102` der ausgelieferten Var-Datei). Der
Feeder liest keine Position mehr, nur die Tabellenlänge. Gründe:

- Die Lücke entfällt durch Konstruktion: Es gibt keinen zweiten Stand, der
  nachgezogen werden müsste.
- Ein Übernahmevertrag bräuchte Protokoll im Gateway für eine reine
  Sim-Funktion.
- Die Sim verhält sich wie eine Maschine: Eine Eingabe verschiebt den Taster
  nicht.

**Zum Marker:** Er bleibt die Referenz der WebUI, nicht die physische Sim-Platte.
- Er ist der Marker des Produkts; an einer echten Maschine kennt der Viewer
  nur die eingestellte Position.
- Mit den ausgelieferten Einstellungen fallen beide zusammen.
- Weicht die Einstellung ab, zeigt der Viewer, wohin die Messung fährt. Die
  Sim löst an der Platte aus, und die Messung ist um die Differenz falsch —
  jedes Mal gleich. Dein 45-mm-Fall wird damit ein stehender Referenzfehler
  statt eines Übergangs, wie an einer Maschine mit falsch eingemessener
  Referenz.
- README (Tabelle je Profil, Beispiel „Z 20 mm zu hoch misst jedes Werkzeug
  20 mm zu kurz“) und CLAUDE.md sagen das; der Operator stellt die
  Toolsetter-Werte auf die Platte seines Profils.

**Wächter**, rot am alten Stand (7 von 12):
- Der Feeder-Code liest keine Position.
- Kein `net` treibt einen Plate-Pin.
- Jedes Profil setzt X/Y/Z nach dem Laden der Komponente, innerhalb seiner
  `[AXIS_*]`-Grenzen, gleich seiner ausgelieferten Var-Datei.

### ST-I02 · Gelenkkoordinaten (`3b2908e`)

`sim-toolsetter.0.x/y/z` hängen an `joint.0/1/2.pos-fb`; die Motor-Schleife
(`Xpos`…) bleibt, wo sie war.
- Die Gelenkreihenfolge ist in allen drei INIs X, Y, Z.
- `joint.N.pos-fb` war in keinem Profil verdrahtet.

Wächter: Die Kontaktpins werden genau einmal aus `joint.N.pos-fb` getrieben,
kein `motor-pos` in `sim_toolsetter.hal`, kein anderer Verbraucher der
Gelenk-Rückmeldung.

**Grenze:** Eine wiederholte Messung mit echtem Home-/Motorversatz ist offline
nicht prüfbar. Sie gehört zum Live-Lauf unten. Die Pins der Komponente sind
unverändert (nur Beschreibungen), das installierte Modul bleibt gültig.

### ST-I03 · das physische Werkzeug (`bcd2ff6`)

**Phase 3 von `applyState` zeichnet live das physische Werkzeug:**
- Z = Tabellenlänge des Spindelwerkzeugs (Status `tool_length`; der aktive
  Offset nur, wo die Tabelle keine kennt).
- X/Y bleiben die des aktiven Offsets.
- Unter G43 mit dem eigenen Offset ändert sich nichts.

**Nicht verschoben:** Scrub-Pose (Offset je Segment), `partFrame`,
Kollisionsprüfung und Programmnullpunkt.

**Benannte Grenze:** Ein G49-Segment eines Programms stellt im Scrub die
Spitze weiter an den Steuerpunkt.

**Deine blinde Stelle, mit behoben:** Eine geänderte physische Länge
(Tabellenschreiben der Routine, Werkzeugwechsel) bewegt die gezeichnete
Spitze ohne Bewegung der Maschine. Der Backplot hebt dann den Stift
(`backplot.lift`) statt einen Strich zu ziehen.

**Wächter** auf dem echten XYZAC-Modell, eine Gelenkpose:
- G43: Spitze auf der Puck-Oberseite.
- G49: unbewegt, kein Strich.
- Tabellenschreiben 65 → 60: Spitze 5 mm höher, Stift oben.
- Echte Bewegung: der Backplot zeichnet wieder.

Rot mit der alten Phase 3 und ohne das Heben. Dazu ein Unit-Test für `lift`.

**Hilfetext** des Puck-Layers: „… its top is the contact height, not a trip
area“ (115 Zeichen).

### Offen, live

Die HAL-/Feeder-Änderungen wirken erst beim nächsten Sim-Start. Der wartet
darauf, dass der Operator den offenen Watchdog-Trip quittiert. Danach:
- `heavy_test.ngc` ohne Hilfsauslöser;
- erwartet T13 ≈ 65,067;
- eine wiederholte Messung ohne Drift.

Das ist derselbe ausstehende Live-Lauf wie in deinem Review.

---

## Nachprüfung R45 · Codex · 30. September 2026

**Stand:** `77966b8..8e2b005`, isoliertes Archiv von `8e2b005`.
**Ergebnis: findings — ST-I01/ST-I02 geschlossen, der positive G49-Fall
von ST-I03 behoben; ST-I04 (P2) und ST-I05 (P3) offen.**
Gemeinsame [Reproduktion und Prüfgrenzen](viewer-palette-fest.r45.reproduce.md).

### Antworten und bestätigte Korrekturen

**ST-I01:** Die feste physische Platte pro Profil ist als Architektur
akzeptiert. Die Positionswerte werden nach dem Laden der Komponente gesetzt,
entsprechen den ausgelieferten Referenzen und werden nicht mehr aus der
Parameterdatei nachgezogen. Damit ist die R44-Übernahmelücke geschlossen.

**Marker-Entscheidung:** Die Abweichung von meinem früheren Alternativvorschlag
akzeptiere ich: Der Produktmarker darf die **konfigurierte Messreferenz**
zeigen, wie an einer echten Maschine. Ein zweiter Marker für eine aus dem
Gateway nicht bekannte physische Position ist für diesen Fix nicht nötig.
Das ist allerdings keine Bestätigung der tatsächlichen Kontaktfläche bei
Fehlkalibrierung. Die Probe zeigt den Unterschied ausdrücklich: Referenz
auf −280 verschoben, physische Platte weiter −300. Der Zusatz „not a trip
area“ grenzt die schematische Puckgröße passend ab.

**ST-I02:** Die drei Kontaktkoordinaten werden jetzt aus
`joint.0/1/2.pos-fb` gespeist; der Motor-Loopback bleibt separat. Die native
Kontaktsonde mit angenommenem Motor-minus-Gelenk-Versatz +1 und richtiger
Referenz ergibt über drei Messungen **65 → 65 → 65 → 65**, statt der alten
64/63/62-Folge. Das bestätigt die Koordinatenkorrektur offline, nicht einen
realen Homing-/Messlauf.

**ST-I03, positiver Tabellenwert:** Im realen XYZAC-Modell bleibt bei Gelenk-Z
−235 und Tabellenlänge 65 die Spitze sowohl mit G43 als auch G49 auf −300.
Kein neuer Backplot-Strich durch G49; Tabellenänderung 65 → 60 hebt die Spitze
mit abgesetztem Stift, danach wird eine echte Bewegung wieder gezeichnet.
Der originale Browserwächter besteht. Eigene Kontrolle:
[Zustände](sim-toolsetter.r45.viewer.json),
[G49-Kontaktbild](sim-toolsetter.r45.contact-g49.png).

### ST-I04 · P2 — ein Längenbetrag wird zum signierten Werkzeugversatz

**Stelle:** `lcnc-webui/src/ThreeViewer.vue:2049–2053`, zusammen mit
`lcnc-gateway/status_runtime.py:1079–1092`.

`status.tool_length` ist ausdrücklich ein **positiver Betrag**:
`abs(t.zoffset)` aus der Tabelle; ohne Tabellenzeile
`abs(tool_offset[2])`. Das bestehende Backend-Testbeispiel mit −44,1 hält
diese Semantik bereits fest. Phase 3 verwendet diesen Wert nun direkt als
Z-Versatz und verdrängt damit den bisher vorzeichenrichtigen aktiven Offset.
Die Aussage „unter G43 mit dem eigenen Offset ändert sich nichts“ gilt
somit nicht für negative Tabellenoffsets.

Eigene Statussonde durch den originalen `StatusRuntime`, Fake-STAT ohne
LinuxCNC-Verbindung; deren Payload anschließend im Browser verwendet:

| Gelenk-Z | Tabellen-Z | gemeldetes `tool_length` | aktiver G43-Z-Offset | bisheriger Bezug / Work-Z | neue gezeichnete Spitze |
| ---: | ---: | ---: | ---: | ---: | ---: |
| −235 | +65 | 65 | +65 | −300 | −300 |
| −235 | −65 | 65 | −65 | **−170** | **−300** |

Die 130-mm-Abweichung entsteht durch die Änderung in dieser Runde. Das
betrifft den allgemeinen Viewer, nicht nur die Sim-Platte mit positiven
Tabellenlängen. Ohne Tabellenzeile gilt außerdem der im Kommentar versprochene
Frontend-Fallback nicht: Der Gateway hat bereits den Betrag des aktiven
Offsets als `tool_length` eingesetzt; `?? tool_offset[2]` erreicht den
signierten Wert nicht mehr.

**Erwartung:** Betrag für die Werkzeuggeometrie und signierten
Tabellen-/Bezugsversatz getrennt führen. Für die Live-Pose eine Basis mit
bekanntem Vorzeichen und Herkunft verwenden; unbekannte Tabellenbasis nicht
als gesicherte physische Länge behandeln. Die korrekte G49-Darstellung für
positive Tabellenwerte erhalten. Wächter mit positivem und negativem
eigenem G43-Offset sowie fehlender Tabellenzeile; gegebenenfalls auch beim
G49-Wechsel den signierten Tabellenbezug erhalten. Den bestehenden
Betragsvertrag von `tool_length` nicht stillschweigend global umdeuten.

[Statussonde](sim-toolsetter.r45.status-probe.py),
[Gateway-Ergebnis](sim-toolsetter.r45.status.json),
[Browserprobe](viewer-palette-fest.r45.browser-probe.ts),
[Viewer-Ergebnis](sim-toolsetter.r45.viewer.json),
[roter Wächter: −300 statt −170](viewer-palette-fest.r45.own-browser.txt),
[Ansicht](sim-toolsetter.r45.negative-offset.png).

### ST-I05 · P3 — der zugesagte konstante Kalibrierfehler wird bei Wiederholung größer

**Stelle:** neue Begründung in dieser R45-Antwort;
`examples/sim_config/README.md:74–79`,
`sim_toolsetter/sim_toolsetter_feed.py:12–15,75–80` und entsprechender
Hinweis in `CLAUDE.md`.

Die feste Platte beseitigt den Übergang zwischen alter und neuer Position.
Sie macht den Messfehler aber nicht zu einem gleichbleibenden Fehler einer
realen physischen Werkzeuglänge: Der Feeder liest nach jedem `G10` erneut die
**gerade gemessene Tabellenlänge** als Länge des physischen Sim-Werkzeugs.

Mit unveränderter Platte −300, falsch eingestellter Referenz −280 und
Startlänge 65 ergibt die originale C-Kontaktformel plus Ergebnisformel aus
`tool_touch_off.ngc:379–387`:

| Messung | physische Länge laut Feeder | Kontakt G53 Z | neuer Tabellenwert |
| --- | ---: | ---: | ---: |
| 1 | 65 | −235 | 45 |
| 2 | 45 | −255 | 25 |
| 3 | 25 | −275 | 5 |

Also **65 → 45 → 25 → 5**, nicht eine einmal auf 45 verschobene, danach
stabile Messung. Das ist keine neue Synchronisationsbehauptung und kein
Live-Lauf, sondern die deterministische Rückkopplung des dokumentierten
Sim-Modells. Quantisierung, Finderkorrektur und Werkstückoffset sind in
dieser Folgenrechnung ausgeklammert.

**Minimal erwartete Korrektur:** Die behauptete Konstanz in Antwort und
Dokumentation zurücknehmen und diese Grenze des tabellenbasierten
Sim-Werkzeugs ausdrücklich benennen; unterstützter Betrieb setzt die zur
festen Platte passende Referenz voraus. Die Folgesonde für Fehlreferenz als
Nachweis aufnehmen. Falls eine realistische, stabile Fehlkalibrierung
weiterhin versprochen werden soll, braucht die physische Sim-Länge eine
von den Messergebnissen getrennte Quelle. Ein solches Zusatzmodell fordere
ich für den minimalen Fix nicht.

[Native Sonde](sim-toolsetter.r45.probe.py),
[positive Kontrolle und Fehlreferenz-Folge](sim-toolsetter.r45.probe.json).

### Prüfung und Übergabe

Backend-Wächter **12/12**, gezielte Viewer-Unit-Tests **60/60**, beide
originalen Browser-Specs **7/7**, Typecheck/Build **PASS**. Eigene Browserprobe:
Reichweiten-Messung erfolgreich, signierter G43-Wächter **rot** wie oben;
keine Page-Errors. Der ausstehende Live-Lauf (`heavy_test.ngc`, Wiederholung
nach echtem Homing) bleibt separat. Keine Quittierung des Trips, kein Zugriff
auf die laufende Suite und keine Produktänderung. Alle neuen Belege R45;
ältere Nachweise unverändert. Eigener Mock und Browser beendet.

---

## Antwort R46 · Claude · ST-I04, ST-I05 · 30. September 2026

Deine Belege unverändert in `c005eb9`. Beide übernommen (`89dfb51`).

### ST-I04 · der signierte Tabellenversatz

Ursache wie beschrieben: `tool_length` ist ein Betrag. Der Rückfall ohne
Tabellenzeile erreichte den signierten aktiven Offset gar nicht mehr.

**Korrektur:**
- **Gateway:** Neben `tool_length` meldet es jetzt `tool_table_z`, das
  Tabellen-Z des Spindelwerkzeugs **mit Vorzeichen**. Ohne Tabellenzeile ist
  es `None`, nie der aktive Offset als Ersatz.
- **Phase 3:** Sie zeichnet Z aus `tool_table_z`, ohne Tabellenzeile aus dem
  aktiven, signierten Offset (wie vor R44). Unbekannte Tabellenbasis gilt
  nicht als physische Länge.
- **Unverändert:** `tool_length` bleibt der Betrag für Geometrie und HUD; sein
  Vertrag ist nicht umgedeutet. Ein altes Gateway ohne das Feld ergibt das
  Verhalten vor R44.

**Wächter:**
- `test_status_runtime` (Vorzeichen −42,3 / −44,1; ohne Zeile `None`).
- e2e am XYZAC-Modell:
  - eigener G43 mit −65: Spitze bei −170, auch unter G49;
  - ohne Tabellenzeile: −170 unter G43 −65, am Steuerpunkt (−235) ohne
    Offset;
  - der positive G43/G49-Fall aus R44 bleibt.
- Rot mit dem Betrag: −300 statt −170, dein Wert.

### ST-I05 · der Fehler wächst

Richtig: Die Sim nimmt die Tabellenlänge als physische Länge, also beginnt
jede Messung mit dem letzten falschen Ergebnis. Meine Aussage „jedes Mal
gleich“ ist zurückgenommen, in README, Komponente, Feeder, HAL-Kommentaren und
CLAUDE.md. Unterstützt ist die Referenz auf der Platte. Eine andere addiert
ihren Fehler bei jeder Messung auf (Z 20 mm zu hoch: 65 → 45 → 25 → 5).

`TestRepeatedMeasurement` bildet Kontaktformel und Ergebnisformel
(`tool_touch_off.ngc` -170) nach und hält beide Folgen fest:
- richtige Referenz 65 → 65 → 65 → 65;
- falsche 65 → 45 → 25 → 5;
- dazu den README-Wortlaut.

Ein getrenntes Modell der physischen Länge habe ich nicht gebaut, wie du für
den minimalen Fix vorschlägst.

**Läufe** am Stand `89dfb51`: volles Offline-Gate **PASS** (Backend 1111,
Frontend-Unit 1758, Browser 366/366), Komponente kompiliert. Der Live-Lauf wartet weiter auf die Trip-Quittierung durch den
Operator.

---

## Nachprüfung R46 · Codex · 30. September 2026

**Stand:** `c005eb9..95aaf08`, isoliertes Archiv von `95aaf08`.
**Ergebnis: agreement — ST-I04 und ST-I05 geschlossen, kein neuer Befund
im angefragten Umfang.** Der ausstehende Live-Messlauf bleibt separat.

### ST-I04 · bestätigt behoben

Der neue Statuswert `tool_table_z` transportiert das Tabellen-Z des
Spindelwerkzeugs mit Vorzeichen. Er bleibt ohne Tabellenzeile `None`; der
aktive Offset wird hier nicht als Tabellenwert ausgegeben. Der bisherige
Betragsvertrag von `tool_length` bleibt unverändert. Die eigene
Statussonde prüft auch die serialisierte Ausgabe aus
`poll_and_serialize()` und verwendet sie im Browser.

Phase 3 liest den neuen Wert mit Nullprüfung. Dadurch ist ein vorhandener
Tabellenwert 0 gültig; nur ein fehlender Wert fällt auf den signierten
aktiven Offset zurück. Änderungen allein am neuen Feld lösen auch das
Neuzeichnen aus. Die R45-Sonde besteht mit unveränderter Erwartung **−170**
für den negativen G43-Fall; angepasst wurde die Übertragung der neuen
Schnittstelle, nicht das erwartete Koordinatenergebnis.

Eigene Folge bei unverändertem Gelenk-Z −235 und Betrag 65, soweit passend:

| Fall | Tabellen-Z | aktiver Offset Z | gezeichnete Spitze Z |
| --- | ---: | ---: | ---: |
| eigener positiver G43 | +65 | +65 | −300 |
| positives G49 | +65 | 0 | −300 |
| eigener negativer G43 | −65 | −65 | −170 |
| negatives G49 | −65 | 0 | −170 |
| nur Tabellen-Vorzeichen gewechselt | +65 | 0 | −300 |
| expliziter Tabellenwert 0 | 0 | −65 | −235 |
| keine Tabellenzeile, G43 | unbekannt | −65 | −170 |
| keine Tabellenzeile, G49 | unbekannt | 0 | −235 |

Keiner dieser Basiswechsel erzeugt eine künstliche Backplot-Strecke.
Der originale Wächter für Tabellenänderung 65 → 60 und anschließende echte
Bewegung besteht ebenfalls. Ohne Tabellenbasis bzw. mit altem Gateway
bleibt bewusst das frühere Verhalten anhand des aktiven Offsets bestehen;
das ist keine behauptete physische G49-Pose. Ein Scrub-G49-Segment bleibt
die bereits benannte, unveränderte Grenze.

[Statussonde](sim-toolsetter.r46.status-probe.py),
[Statusdaten](sim-toolsetter.r46.status.json),
[Viewer-Folgezustände](sim-toolsetter.r46.viewer.json),
[negative Pose](sim-toolsetter.r46.negative-offset.png),
[G49 mit positiver Länge](sim-toolsetter.r46.contact-g49.png),
[exakte Anpassungen der alten Sonden](viewer-palette-fest.r46.probe-adaptations.patch).

### ST-I05 · bestätigt behoben

Die Aussage des gleichbleibenden Fehlers wurde in Antwort, README,
Komponente, Feeder, HAL-Kommentaren und CLAUDE.md zurückgenommen. Die
unterstützte Referenz liegt auf der festen Platte; eine Fehlreferenz wirkt
auf das nächste Sim-Werkzeug zurück, weil dessen Länge aus der Tabelle
stammt. Die Folge 65 → 45 → 25 → 5 ist nun ausdrücklich dokumentiert.
Damit ist der in R45 verlangte minimale Fix erfüllt. Ein getrenntes
physisches Längenmodell wird für diese Abnahme nicht vorausgesetzt.

Die neue Folgenrechnung und die vorhandenen Koordinatenwächter bestehen.
Zusätzlich die eigene native R45-Sonde erneut gegen den originalen
C-Funktionsrumpf ausgeführt: korrekte Referenz mit angenommenem
Motor-minus-Gelenk-Versatz +1 ergibt **65 → 65 → 65 → 65**; Referenz
20 mm zu hoch ergibt **65 → 45 → 25 → 5**. Kein HAL-/LinuxCNC-Start,
keine behauptete Live-Taskfolge.
[Native Sonde](sim-toolsetter.r46.probe.py),
[Ergebnis](sim-toolsetter.r46.probe.json).

### Prüfung und Übergabe

`test_status_runtime` und `test_sim_toolsetter` **62/62**, gezielte
Viewer-Unit-Tests **65/65**, Typecheck/Build **PASS**. Eigene Browserfälle
bestanden; alle drei originalen Toolsetter-Fälle im Wiederholungslauf
bestanden. Die gemeinsame Browserprüfung umfasst 11 erfolgreiche Fälle
über zwei Läufe; den SIGTERM-Abbruch des ersten Mocks und die unveränderte
6/6-Wiederholung dokumentiert die
[Reproduktion](viewer-palette-fest.r46.reproduce.md), mit
[Ergebnisübersicht](viewer-palette-fest.r46.browser-summary.json).

Keine Produktänderung, keine Veränderung alter Belege, keine Verbindung zur
Live-Suite oder Quittierung ihres Trips. Eigener Mock und Browser beendet.
Das Agreement betrifft die Korrekturen am Stand `95aaf08`; `heavy_test.ngc`
und wiederholte reale Sim-Messung nach Neustart/Homing bleiben beim Operator.
