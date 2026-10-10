# Parity-Befunde E und F — der unbekannte Programmanfang und der Bremsweg der Antastung

**Plan, Fassung 1 · 10. Oktober 2026.**
- Vorbedingung für den Parity-Korpus mit M600 (`scripts/parity_corpus/xyzac.json`, Zweig `test/parity-xyzac-m600`, ungemergt).
- Codex hat beide Befunde in R118 bestätigt und vor dem Bau je einen kleinen Vertrag verlangt; das sind diese beiden.
- Der Operator hat die Reihenfolge am 10. Oktober bestätigt: erst diese Verträge, danach Paket 1 von Schritt 4.
- Noch kein Code.

## Befund

Erster Parity-Lauf mit M600 (`webui_m600_live`, XYZAC-Sim): FAIL. Wahrheit → Sim max 16,8 mm, Sim → Wahrheit max 84,9 mm, Toleranz 0,5 ([Belege](viewer-palette-fest.r118.parity.txt)).

- **E:** Das Programm beginnt mit `G53 G0 Z0` und befiehlt damit nur Z. Die Vorschau bucht den Endpunkt mit ihrem **angenommenen** X/Y (Programm 0/0). Die Anfahrbewegung führt von der Maschinenposition schräg dorthin, 150 mm weit; die Maschine fährt nur Z hoch.
  - Auch alle folgenden Bewegungen, die X/Y nicht nennen, laufen in der Vorschau bei X0 Y0.
  - Die Anfahrprüfung prüft damit einen Weg, den die Maschine nie fährt, und den echten nicht.
- **F:** Am Toolsetter fährt die Maschine 2,13 mm unter den Auslösepunkt (Bremsweg der schnellen Antastung). Die Vorschau endet am Auslösepunkt.
  - Die Kollisionsprüfung sieht diesen tieferen Bereich nicht.

## Was belegt ist

**Nativ** ([Probe](viewer-palette-fest.r122.native-flags.py), [Ergebnis](viewer-palette-fest.r122.native-flags.txt), Vorschau-Interpreter 2.9.4, offline):
- **Achsworte:** In jedem Bewegungsrückruf des Canons sind `interpreter.this.blocks[0].x_flag` … `z_flag` lesbar, im Satz einer Unterroutine die des Unterroutinen-Satzes.
  - `G0 X0` setzt `x_flag`, auch wenn die Vorschau schon X 0 annimmt. Die heutige Wiederherstellungsregel („die Programmkoordinate hat sich geändert“) sieht das nicht.
- **Rahmen und Modus:** `g_modes[0]` nennt G53 (530), G28 (280) und G30 (300); `distance_mode` ist der Modus des Satzes selbst.
- **G28/G30:** Ein Satz liefert immer zwei Rückrufe.
  - Zuerst kommt der Zwischenpunkt: Achsworte nach Abstandsmodus, ohne Worte der Ausgangspunkt.
  - Dann kommt die gespeicherte Lage, für die genannten Achsen bzw. ohne Worte für alle.
  - Codex' R118-Fälle (`G30`, `G91 G30 Z0`, `G30 Z400`) stimmen damit überein.

**LinuxCNC-Quelltext 2.9.4:**
- `tc.c` `tcGetOverallMaxAccel`:
  - Ein Segment mit parabolischem Übergang (`TC_TERM_COND_PARABOLIC` oder `blend_prev`) bremst mit der **halben** Beschleunigung.
  - Ein Knick-Abzug (`kink_accel_reduce`) mindert sie zusätzlich. Gesetzt wird er nur bei tangentialem Übergang mit Knick (`tp.c` `tpSetupTangent` → `tcSetKinkProperties`).
- `control.c` `process_probe_inputs`:
  - Beim Auslösen wird die **Rückmeldeposition** gespeichert (`probedPos = carte_pos_fb`), danach folgt `tpAbort`.
  - Der Auslösepunkt P ist also die Position in dem Servotakt, in dem der Eingang gelesen wird. Q ist der Stillstand nach dem Abbremsen.
- Gemessen am 30. September (F2000, Z 500 mm/s², G64): 2,13 mm. Das Modell v²/a ergibt 2,22 mm.

---

## E · Vertrag: der Programmanfang hängt vom Start ab

### E1 · Zwei Arten von „unbekannt“, getrennt geführt

| Zustand | Bedeutung | Woher der Wert kommt |
|---|---|---|
| **startabhängig** (neu, Menge `dep`) | Die Achse wurde seit dem **Programmstart** nicht absolut befohlen. Ihr Wert ist der Startwert plus die seither verbuchten Deltas. | aus der **gebundenen Startbasis** (E5); nur am Programmanfang |
| **unbekannt** (heute: `stale`, `_frame_unknown`, unvorhergesagte Messung) | Die Steuerung hat die Achse bewegt, wo die Vorschau es nicht sieht (Werkzeugwechselposition, Messung nicht vorhergesagt), oder ein Wert wurde aus einer unbekannten Lage geschrieben bzw. gelesen | **nie** ergänzt, auch nicht aus der inzwischen gemeldeten Live-Position |

- Am Programmstart sind X, Y und Z startabhängig.
  - **Drehachsen nicht:** Sie sind aus der Live-Lage gesetzt (`rotary_sync_initcode`), und eine Drift löst eine neue Analyse aus.
  - **U, V, W nicht:** Sie sind in der Vorschau heute ohnehin 0. Benannt.
- Eine startabhängige Achse wird **nie** von selbst „bekannt“. Sie wird es nur durch einen absoluten Befehl (E2), oder sie wird unbekannt (E3, E4).

### E2 · Was der Canon je Bewegung bucht

Für jeden Punkt einer Bewegung bucht der Canon die Maske `dep` der Achsen, deren Wert dort vom Start abhängt. Die Koordinate selbst bleibt der angenommene Wert, wie heute. Die Regeln je Satz lesen die Achsworte des Interpreters (`blocks[0].*_flag`), seinen Rahmen (`g_modes[0]`) und seinen Abstandsmodus (`distance_mode`), jeweils im Rückruf selbst. Sie lesen nie die Koordinatenänderung.

| Satz | Achse mit Wort | Achse ohne Wort |
|---|---|---|
| G0 / G1, G90 (Programmrahmen) | bekannt | unverändert (bleibt `dep`, wenn sie es war) |
| G0 / G1, G91 | unverändert: das Delta ist im angenommenen Weg enthalten | unverändert |
| G53 G0 / G1 (Maschinenrahmen, nur absolut; G91 G53 lehnt der Interpreter ab) | bekannt | unverändert |
| G28 / G30, 1. Rückruf (Zwischenpunkt) | G90: bekannt; G91: unverändert | unverändert |
| G28 / G30, 2. Rückruf (gespeicherte Lage) | bekannt | unverändert; **ohne jedes Achswort: alle bekannt** |
| G43 / G49 / G43.1, Wechsel der Halterung ohne Drehung, Satz ohne Bewegung | — (die Maschine steht, der Wert wird nur neu ausgedrückt; der Umbenennungspunkt trägt `dep` weiter) | unverändert |

- **Die Teilstücke von G28/G30** werden nach ihrer Reihenfolge im Satz unterschieden (Zähler je Satz, an `next_line` zurückgesetzt). Nativ belegt: immer genau zwei.
- **Eine gespeicherte Lage**, die aus einer startabhängigen oder unbekannten Lage geschrieben wurde (G28.1/G30.1), fällt unter E3/E6: Die betroffenen Achsen werden unbekannt.
- **Der erste Endpunkt** bleibt wie heute ein Punkt mit unbekanntem Start (`rapid_ustart`) **und** trägt seine Maske. Ein alter Leser sieht also dasselbe wie heute.

### E3 · Der Geltungsbereich: gerade Bewegungen in benannten Rahmen

Die Korrektur gilt, solange `dep` nicht leer ist, nur in diesem Bereich:

- **Kinematik:** Die Beschriftung ist die Identität (trivkins oder Typ 0 einer umschaltbaren Kinematik). Den Typ kennt der Canon aus dem Kontext und aus den Markierungen; ist er unbekannt, gilt der Bereich nicht.
- **Drehung:** Für X/Y keine XY-Drehung (`rotation_xy = 0`); für Z gilt die Drehung nicht (sie liegt um Z).
- **Bewegungen:** G0, G1, G53, die Teilstücke von G28/G30, Sätze ohne Bewegung (Modi, F, S, M3/M5, Kühlmittel, G4, Kommentare). Dazu G43/G49 und Wechsel der Halterung (siehe E2).

**Warum dort eine Maske genügt:** In diesem Bereich ist Programm = Maschine − Versatz **je Achse**. Ein Halterungswechsel, ein G43 oder ein G91-Delta verschiebt den angenommenen und den wirklichen Weg gleich. Der Unterschied je Achse ist deshalb über die ganze Strecke derselbe: Δ = Startbasis − angenommener Start (E5).

**Außerhalb des Bereichs** werden die startabhängigen Achsen ab diesem Satz **unbekannt** (`stale`), mit der heutigen Maschinerie: Endpunkte mit unbekanntem Start, Wiederherstellung durch einen absoluten Satz, im Sweep benannt. Das betrifft:
- einen Bogen, dessen Ebene eine startabhängige Achse enthält (sein Mittelpunkt ist relativ zum Start);
- einen Bohrzyklus, G33, G76, eine Antastung oder ein Spline;
- eine Drehung ≠ 0 bei startabhängigem X oder Y;
- einen Wechsel in eine Welt-Kinematik (TCP) oder eine TWP-Ebene.

Ein Bogen außerhalb seiner Ebene (eine Helix ohne Wort für Z bei startabhängigem Z) bleibt im Bereich: Z ist auf dem ganzen Bogen der Startwert.

### E4 · Gelesene Positionen

Ein Wert, der aus der Position gelesen wird, während die gelesene Achse startabhängig oder unbekannt ist, ist die Annahme der Vorschau. Er kann ein späteres absolutes Ziel werden, ein Versatz oder eine Verzweigung. Ein absoluter Satz, der ihn benutzt, sähe für den Canon wie „bekannt“ aus. Codex R118: Eine Maske allein macht das nicht richtig.

**Regel:** Eine solche Lesung ist ab ihrer Stelle eine Vermutung. Von dort sind **alle Achsen bis zum Programmende unbekannt**, mit dem Grund `position_read` und der Zeile. Das ist dieselbe Klasse wie eine nicht vorhergesagte Messung.

- Alle Achsen, nicht nur die gelesene: Der Wert kann den Programmfluss steuern.
- Das schließt dieselbe Lücke auch für Achsen, die nach einem Werkzeugwechsel an der Wechselposition unbekannt sind. Dort gibt es sie heute; ich nenne sie, statt sie stehen zu lassen.

**Was als Lesung gilt** (ein Wortleser, `gateway_util.nc_block_norm`, wie bei den Schreibzugriffen):
- `#5420`–`#5428`, `#<_x>` … `#<_w>` und `#<_abs_x>` … `#<_abs_w>` für die jeweilige Achse.
- Ein berechneter Parameter (`#[…]`, `##…`) und eine Zeile, die der Leser nicht lesen kann, gelten als „jede Achse“.

**Wo die Vorschau eine Lesung findet:**
- **Hauptprogramm, Textordnung `ordered`** (keine o-Worte, kein M98; so sind das Parity-Programm und CAM-Ausgaben):
  - Jede Zeile, die lesen kann, wird über denselben Gang wie die Schreibzugriffe zeitlich eingeordnet (`next_line`, die seither gelaufenen Hauptzeilen).
  - Ein Rumpf hinter einem neu belegten Code, der lesen kann (`RemapEnv`, um „liest die Position“ erweitert), wird zusätzlich ab dem ersten Rückruf erkannt, den der Interpreter in ihm zeigt (Remap-Stapel). Ein Rumpf ohne Rückruf zählt an seiner Aufrufzeile.
- **`inline` / `foreign`:** Hier kann der Text Lesungen nicht einordnen.
  - Kann irgendein erreichbarer Text die Position lesen, sind ab dem Programmstart alle Achsen unbekannt, benannt.
  - Das folgt dem Vorbild eines fremden M600.
- **Die gebündelte Routine** `tool_touch_off.ngc` ist vom Textscan ausgenommen. Sie markiert jede ihrer Lesungen selbst, mit Markierungen nur für die Vorschau, die in task stumm bleiben:

| Stelle | Markierung | Wirkung im Canon |
|---|---|---|
| −20, Haltepunkt `#5420`–`#5422` sichern (bei **jedem** Aufruf) | `(WEBUI_POS_SAVE)` | merkt sich die Maske `dep` / unbekannt von X, Y, Z in diesem Moment |
| −210, Rückfahrt zum Haltepunkt (nur `#3106 = 1` und Modus 1) | `(WEBUI_POS_RETURN)` | die folgenden zwei Sätze (`G1 X Y`, `G1 Z`) übernehmen für ihre Achsen die gemerkte Maske statt „bekannt“; eine damals unbekannte Achse wird unbekannt |
| −70, `offset_z = #5422` nach `G53 G1 Z0` | `(WEBUI_POS_READ=Z)` | Z muss hier bekannt sein (das absolute G53 Z0 direkt davor); sonst Messung nicht vorhergesagt, Grund `position` |
| Auslösepunkt in o<520>/o<530>: `#5061…#5069 = #5420…#5428` | `(WEBUI_POS_READ=XYZ)` | X, Y, Z müssen hier bekannt sein (nach der absoluten Positionierung über den Taster); sonst Grund `position` |

- **Rückfahrt abgeschaltet:** Bei `#3106 = 0` läuft die Rückfahrt nicht, und die gesicherten Werte werden nie benutzt.
- **Wächter am Text:** Ein Test verlangt, dass jede Positionslesung der Routine eine dieser Markierungen trägt. Eine spätere Lesung ohne Markierung ist dann ein Testfehler.
- **Vorgabe der R102-Planung:** Der Vergleich der task-Pfade (`test_tool_touch_off_paths.py`) bleibt grün; Kommentare ändern den Ablauf nicht.

### E5 · Die gebundene Startbasis

Nur der Programmanfang wird ergänzt, und nur aus der Basis, an die die Prüfung gebunden ist. Nie aus einer späteren Live-Position.

| Prüfung | Startbasis |
|---|---|
| Simulation und die Anfahrprüfung im Stillstand | die Gelenkposition, die die Anfahrspur heute schon fasst: beim Eintritt, beruhigt nach Bewegung (500 ms) |
| Prüfung im Lauf (voll ab 0 und Bereich) | **neu:** `run_basis.start.joints`. Das Gateway nimmt die Gelenkposition aus demselben frischen Poll wie den übrigen Start, vor dem Schreiben; `CheckBasis` trägt sie, `run_check_wire.json` bekommt das Feld auf beiden Seiten |
| Lauf ohne diese Position (unbestätigte Basis, älteres Gateway) | keine: der startabhängige Anfang bleibt ungeprüft, benannt |
| Parity (`simDump`) | `header.start_joints` der Aufzeichnung, über `buildEntryTrack` wie der Browser |

**Rechnung:**
- Δ = (Startbasis in Programmkoordinaten der Epoche 0, mit dem Werkzeugversatz vor dem ersten TLO-Ereignis; derselbe Weg wie heute die Anfahrbewegung, `machineJointsToProgram`) − `start_believed`.
- Jeder Punkt i des Anfangs bekommt `pos_i[a] += Δ[a]` für jede Achse a in `dep_i`. Die Rechnung gilt, weil E3 nur Rahmen zulässt, in denen Δ je Achse über alle Epochen konstant ist.
- **`start_believed`** liefert der Worker ausdrücklich mit: die Programmkoordinate der angenommenen Startlage am ersten Programmrückruf (`_begin_program`), in Epoche 0. Mit G92-Persistenz und `%`-Anfangsphase ist „Null“ eine Annahme, keine Konstante.

### E6 · Schreiben aus einer startabhängigen Lage

Die heutige Regel für unbekannte Achsen gilt auch für startabhängige: G92, G10 L20/L10/L11, G28.1 und G30.1 schreiben aus der Position. Bei einer betroffenen Achse ist der geschriebene Wert die Annahme der Vorschau, und die Achsen werden **bis zum Programmende unbekannt** (`_frame_unknown`). Ihre Zeile wird im Hinweis genannt.

Eine Korrektur des Versatzes um Δ wäre möglich, liegt aber außerhalb dieses ersten Umfangs.

### E7 · Client: Anfang, Grundspur, Anfahrspur

- **Ende des Anfangs:** K = der erste Punkt nach dem letzten Punkt mit `dep ≠ 0`. Ohne `dep` ist K = 0, und alles bleibt wie heute.
  - `dep` kann innerhalb des Anfangs wieder auftauchen: Die Rückfahrt der Routine übernimmt die Maske. K richtet sich deshalb nach dem **letzten** Punkt mit Maske.
- **Grundspur** (Prüfung beim Laden, gezeichneter Weg):
  - Die Punkte vor K sind ohne Bindung nicht darstellbar. Sie werden wie ein Bruch behandelt: nicht gezeichnet, nicht geprüft, benannt („the start of the program depends on where the machine stands — checked from the machine's position in the simulation“).
  - Heute wird dort der angenommene Weg gezeichnet und geprüft, bei X0 Y0.
- **Anfahrspur** (`buildEntryTrack`): die Live-Position, dann die korrigierten Punkte 0 … K, dann der Rest.
  - Der Seiten-Sweep prüft `sliceTrack(entry, 0, K + 2)` statt zwei Punkten.
  - Die Verschiebung beim Zusammenführen (`mergeEntryResult`) ist die Länge bis K. Heute ist es die bis zum ersten Punkt.
  - **Einträge** des Seiten-Sweeps behalten ihre eigenen Zeilen, angezeigt mit `displayLineForPoint` (L6, in der Routine die Aufrufzeile). Sie tragen ihren Ursprung `E` und fallen mit der Startbasis weg.
  - Die Anzeige „→ entry“ bleibt der Bewegung von der Live-Position zum ersten Punkt. Heute sind alle Einträge der Anfahrt „line 0“; das wird mit dieser Änderung genauer.
- **Zeit:** Die Dauer eines korrigierten Segments ist seine korrigierte Länge geteilt durch die Rate des Segments aus der Nutzlast (angenommene Länge durch angenommene Dauer). Die Anfahrbewegung bleibt bei der Eilgangrate.
- **Grenzprüfung:** Startabhängige Achsen eines Anfangssegments prüft der Worker nicht (sie wären bei X0 Y0 geprüft). Bekannte Achsen prüft er wie heute.
  - Unverändert ungeprüft bleibt nur der Fall, dass ein G91-Delta einer startabhängigen Achse über die Grenze führt. Benannt.
  - Heute kann der Endpunkt bei X0 Y0 eine falsche Grenzmeldung erzeugen oder eine echte verdecken.
- **Prüfung im Lauf:** Die volle Prüfung ab 0 baut ihren Anfang aus `run_basis.start.joints`. Ein Bereich, der im Anfang beginnt, ebenso. Ohne diese Position bleibt der Anfang ungeprüft, benannt (E5).

### E8 · Draht

- **Neu:** `feed_dep` / `rapid_dep` (u8 je Punkt, Bit 0 X, 1 Y, 2 Z; nur vorhanden, wenn ein Bit gesetzt ist) und `start_believed` [x, y, z].
- **Gewechselte Achsen:** Gründe `position_read` / `position` laufen in die vorhandenen `probe_unpredicted`-Zeilen. Die Zeile einer Schreib- oder Leseursache läuft in `stale_offset_lines` bzw. eine neue Liste `position_read_lines`.
- **Schema:** Die neuen Schlüssel werden ausgeliefert (alte Leser übergehen sie). Die Schemanummer wird **erst beim Suite-Stopp** erhöht; die Goldens werden dort neu erzeugt, nie live.

### E9 · Was benannt bleibt

- U, V, W werden nicht verfolgt (in der Vorschau ohnehin 0).
- Ein Anfang mit TCP, TWP, gedrehter Halterung, Bogen in der Ebene, Zyklus oder Antastung wird unbekannt statt korrigiert.
- `inline` / `foreign` mit möglicher Lesung: alles unbekannt ab Programmstart.
- G91-Deltas startabhängiger Achsen ohne Grenzprüfung.
- Der Anfang wird im statischen Weg nicht gezeichnet; er erscheint in der Simulation ab der Maschinenposition.
- Run from line behält seine eigene Anfahrt; dieser Vertrag betrifft den Programmstart.
- **Folgearbeit, nicht Teil davon:** Die Wiederherstellung unbekannter Achsen nach einem Werkzeugwechsel könnte ebenfalls die Achsworte lesen statt der Koordinatenänderung. Heute bleibt `G0 X0` bei angenommenem X0 dort unbekannt; das ist vorsichtig, nicht falsch.

### E10 · Wächter

Codex' Liste aus R118, nativ (`native_start_probe.py`) und über die Client-Kette (`toolChangePayloads`-Muster):

1. Das G53-Programm aus verschiedenen Start-X/Y, darunter Start = angenommener Start (Δ = 0) und weit entfernt: Der Weg fährt senkrecht, X/Y bleiben auf der Startbasis.
2. Folgebewegungen mit einzelnen Achsen: `G0 X10` mit startabhängigem Y, dann `G0 Y20`, dann `G1 Z−5`.
3. Gedrehter Nullpunkt: X/Y werden unbekannt, Z wird weiter korrigiert.
4. G91 bei startabhängiger Achse: Startbasis plus Delta.
5. G28/G30 mit und ohne Achsworte, G90 und G91, darunter `G28 G91 Z0` (Fusion).
6. Ein späterer unbekannter Start (M6 an einer Werkzeugwechselposition nach dem Anfang) bleibt unbekannt und wird nie aus der Live-Position ergänzt.

Zusätzlich:

7. `G0 X0` bei angenommenem X0 wird bekannt (Achswort, nicht Wertänderung).
8. G43 und ein Halterungswechsel im Anfang: Δ unverändert.
9. G92 aus startabhängiger Lage: unbekannt bis zum Ende.
10. Positionslesungen:
    - eine Hauptzeile mit `#5420` bei startabhängigem X: ab dort alles unbekannt;
    - dieselbe Zeile bei bekanntem X: nichts;
    - ein `inline`-Programm mit möglicher Lesung.
11. Die Routine mit `#3106 = 1` und `= 0`: Die Rückfahrt übernimmt die Maske, und `offset_z` sowie der Auslösepunkt verlangen bekannte Achsen.
12. Ein Remap-Rumpf, der liest.
13. Ein Wechsel nach TCP bei startabhängigem X/Y: unbekannt.
14. Die Prüfung im Lauf mit und ohne `run_basis.start.joints`.
15. **Parity:** `sim_parity.py gate` auf `m600_live` grün in beiden Richtungen bei Toleranz 0,5. `simDump` bindet über `header.start_joints`.

Jeder Wächter wird mit einer kompilierenden Mutation rot geprüft.

---

## F · Vertrag: Auslösepunkt, Bremsende, Rückzug

### F1 · Drei getrennte Größen

| Größe | Was | Woher in der Vorschau |
|---|---|---|
| **P** | Auslösepunkt | wie heute: wo die Tabellenlänge des Werkzeugs den Taster berührt (`#3102 + L`, + `#3115` beim Kantentaster) |
| **Q** | Stillstand nach dem Bremsen | **neu:** P + h · d, mit d der Antastrichtung und h der Bremsweg (F2); höchstens bis zum Ende des befohlenen Tastwegs |
| Rückzug | die programmierte Bewegung **ab Q** | die Routine selbst: `G91 G1 Z[#3009]` startet in der Vorschau dann von Q, ohne Zutun |

- **`#5061` … `#5069` und `#5070`** werden weiter **an P** gesetzt, vor dem Weiterfahren nach Q.
- **Die Längenformel** (−170), `G10 L1`, `G43 H` und `toollen_table` rechnen aus P, unverändert. Codex R118: nie auf den Bremsendpunkt umbiegen.

### F2 · Das Bremsmodell und sein Geltungsbereich

h = v · t_lat + v² / a_line

| Größe | Wert | Begründung |
|---|---|---|
| v | min(F_Antastung, `[AXIS_Z] MAX_VELOCITY`, `[TRAJ] MAX_LINEAR_VELOCITY`), in Maschineneinheiten | obere Schranke: Bei kurzem Anlauf ist die Geschwindigkeit beim Auslösen kleiner. Der Vorschub-Override ist aus: Die Routine schaltet ihn mit `M50 P0` ab (Zeile 143, nur task) |
| a_line | min(`[AXIS_Z] MAX_ACCELERATION`, `[TRAJ] MAX_LINEAR_ACCELERATION`, falls vorhanden) | die Tangentialgrenze einer reinen Z-Geraden |
| v² / a_line | = v² / (2 · ½ a_line) | Bremsen mit der halben Beschleunigung, der kleinsten Skala, die `tcGetOverallMaxAccel` einer Geraden ohne Knick gibt. Ein Segment ohne Übergang (G61) bremst mit a_line, also kürzer, innerhalb der Hülle |
| t_lat | 2 · `[EMCMOT] SERVO_PERIOD` | der Weg vom Taster zum Abbruch im Sim: Der Eingang wird im nächsten Servotakt gelesen, P ist die Rückmeldeposition (`carte_pos_fb`) dieses Takts |

**Aussage:** Q ist der **tiefste** Stillstand, den dieses Modell zulässt. Der wirkliche liegt zwischen P und Q. Die Kollisionsprüfung prüft den ganzen Weg P → Q, also auch den tieferen Bereich, den sie heute nicht sieht.

**Gilt für:**
- die beiden Antastungen der gebündelten Routine: eine Gerade entlang −Z;
- auf einer Geraden ohne Knick-Abzug (die Antastung folgt einer gleichgerichteten `G53 G1 Z`-Bewegung oder einem Stillstand);
- bei abgeschaltetem Override;
- im Sim-Signalweg.

**Benannt, außerhalb:**
- Ein echter Tastereingang mit Entprellung oder Feldbus verlängert t_lat um eine Zeit, die die Vorschau nicht kennt (× v).
- Ein Knick-Abzug würde weiter mindern.
- Die Zeitachse rechnet P → Q mit dem Antastvorschub statt mit der Bremsrampe; die wirkliche Dauer ist bis zu doppelt so lang, im Beispiel 0,07 statt 0,13 s.
- Eine Antastung in einem Benutzerprogramm (G38 außerhalb der Routine) bleibt wie heute: Die Vorschau fährt den ganzen Weg. Eigener Punkt, nicht Teil davon.

### F3 · Wo es gerechnet wird

**Rechnung in der Routine:** In ihren Blöcken nur für die Vorschau, so wie sie heute schon `#<_ini[AXIS_Z]MIN_LIMIT>` liest.
- Werte: `#<_ini[AXIS_Z]MAX_VELOCITY>`, `…MAX_ACCELERATION>`, `#<_ini[EMCMOT]SERVO_PERIOD>`, `[TRAJ]` mit `EXISTS[…]` geschützt (die XYZAC-INI hat kein `MAX_LINEAR_ACCELERATION`).
- **Einheiten:** Der Vorschub der Routine wird mit `#<_metric>` und `#<_metric_machine>` auf Maschineneinheiten pro Sekunde gebracht.
- **Kein Worker-Kanal:** Es gibt keine neue Leitung vom Worker, und der task-Pfad bleibt gleich. Der Pfadvergleich streicht die `_task EQ 0`-Zweige, wie bisher.
- **Nativ zu belegen bei der Umsetzung:** Wie `EXISTS` und ein fehlender `_ini`-Wert im Vorschau-Interpreter antworten. Fehlt ein Pflichtwert, ist die Messung nicht vorhergesagt (Grund `brake`).

**o<520>, schnelle Antastung, Vorschau:**
1. `G1` mit dem schnellen Vorschub bis P;
2. `#5061…#5070` an P;
3. `(WEBUI_PROBE_BRAKE)`;
4. `G1` weiter bis Q (am Ende des Tastwegs begrenzt);
5. danach der unveränderte Rückzug der Routine.

**o<530>, langsame Antastung, Vorschau:**
1. von Q_schnell + r hinunter bis P (Weg r − h_schnell);
2. `#5061…#5070` an P;
3. weiter bis Q_langsam (h aus dem langsamen Vorschub, hier 0,03 mm);
4. Rückzug ab dort.

### F4 · Neue Zulassungen in o<510>

Neue Gründe für „nicht vorhergesagt“, vor dem Start der schnellen Antastung geprüft. Alle anderen o<510>-Gründe bleiben unverändert.

| Grund | Bedingung | Warum |
|---|---|---|
| `retract` (erweitert) | r ≤ h_schnell | Nach dem Rückzug kann der Taster noch ausgelöst sein; G38.2 startet dann „already tripped“, und die Steuerung bricht ab. Das Verhalten der Maschine, kein Fehler der Vorschau |
| `slow_limit` (geändert) | Q_schnell + r − 2r = P − h_schnell − r < `[AXIS_Z] MIN_LIMIT` | Das Ende der langsamen Antastung liegt beim tiefsten Q außerhalb; Bewegungen mit Ende außerhalb lehnt motion beim Einreihen ab (`command.c`). Ersetzt die heutige Prüfung mit P − r |
| `brake` (neu) | ein Pflichtwert der INI fehlt oder ist ≤ 0 | h unbekannt |

### F5 · Nachweis: eine Messreihe statt eines Einzelwerts

**Aufbau:**
- Kopflose Sim-Kopien (das Golden-Rezept: `DISPLAY = dummy`, INI-Kopie). Sie laufen beim Suite-Stopp, weil HAL nur eine Instanz zulässt.
- Je Fall MDI `G38.3` am Sim-Taster.
- Gemessen werden P (`#5063`) und die Stillstandsposition, dazu die Abweichung zum Modell.

**Fälle:**
- Vorschub 500, 1000, 2000 und 3000 mm/min;
- Z-Beschleunigung 500 und 250 mm/s²;
- ein kurzer Anlauf, bei dem der Taster vor dem vollen Vorschub auslöst;
- G61 und G64.

**Verlangt:** In jedem Fall 0 ≤ h_Modell − h_gemessen < 0,5 mm (die Parity-Toleranz). Liegt ein Fall außerhalb, gilt das Modell dort nicht; der Fall wird benannt, und die Grenze wird nicht angepasst.

Die globale Toleranz bleibt 0,5 (Codex R118).

### F6 · Wächter

Codex' Liste aus R118, nativ mit der gebündelten Routine (`test_m600_preview_worker.py`):

1. Schnelle und langsame Antastung: Der Weg führt über P hinaus bis Q.
2. Kurzer Anlaufweg: Es gilt dasselbe h, als obere Schranke.
3. Geänderte Beschleunigung bzw. geänderter Vorschub: h ändert sich nach der Formel.
4. Rückzug kleiner als der Bremsweg: Die Messung ist nicht vorhergesagt (`retract`).
5. Ein Hindernis, das nur zwischen P und Q liegt: Der Sweep findet es (Client-Kette).
6. `#5061…#5069`, die Länge in `toollen_table` und der G43-Versatz werden **getrennt** gegen P geprüft, unverändert gegenüber heute.

Zusätzlich:

7. Der Pfadvergleich der task-Zweige bleibt grün.
8. `slow_limit` am tiefsten Q.
9. Die Messreihe F5.
10. Die Parity mit beiden Korrekturen.

Mutationen rot, wie bei E.

---

## Reihenfolge

1. **F zuerst** (eigener Zweig): kleiner, nur die Routine und o<510>, ohne neuen Draht.
2. **Dann E** (eigener Zweig): Canon, Worker, Draht, Client, `run_basis`.
3. **Parity:** der Korpus `xyzac.json` mit `m600_live` neu gemessen.
4. **Korpus:** gemergt erst, wenn die Parity grün ist.
5. **Suite-Stopp:** Schemanummer, Goldens (haus und kontur rufen M600 auf; jede Golden mit startabhängigem Anfang ändert sich) und die Messreihe F5.

Danach Paket 1 von Schritt 4.

## Fragen an Codex

1. **E4:** Ist „alle Achsen unbekannt ab einer Lesung aus unbekannter Lage“ die richtige Grenze, oder reicht „die gelesenen Achsen unbekannt“, wenn die Zeile keine Verzweigung trägt? Ich habe alle gewählt, weil ein gelesener Wert auch über einen Parameter später den Fluss steuern kann.
2. **E5:** Genügt die Gelenkposition aus dem Poll vor dem Schreiben als Startbasis des Laufs? Zwischen Poll und Start bewegt das Gateway nichts. Ein Jog eines anderen Bedieners lässt task den Moduswechsel ablehnen.
3. **F2:** Soll t_lat für eine echte Maschine einstellbar werden (`[DISPLAY]`-Schlüssel), oder genügt im ersten Schritt die benannte Grenze?
4. **Umfang E:** Ist der Ausschluss von Bogen und Zyklen im Anfang (unbekannt statt korrigiert) für den ersten Schritt richtig geschnitten?
