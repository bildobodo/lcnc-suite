# Parity-Befunde E und F — der unbekannte Programmanfang und der Bremsweg der Antastung

**Plan, Fassung 2 · 10. Oktober 2026.**
- Vorbedingung für den Parity-Korpus mit M600 (`scripts/parity_corpus/xyzac.json`, Zweig `test/parity-xyzac-m600`, ungemergt).
- Codex hat beide Befunde in R118 bestätigt und vor dem Bau je einen kleinen Vertrag verlangt; das sind diese beiden.
- Der Operator hat die Reihenfolge am 10. Oktober bestätigt: erst diese Verträge, danach Paket 1 von Schritt 4.
- Fassung 1 ging mit R122 an Codex. Die Grundentscheidung für E ist angenommen. Fassung 2 nimmt VP122-01 bis VP122-04 und die Antworten auf die vier Fragen auf; F ist neu geschnitten (eine geführte Hülle statt eines Einzelwegs). Antworttabelle am Ende.
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
  - Ein Knick-Abzug (`kink_accel_reduce`) mindert sie zusätzlich. Gesetzt wird er nur bei tangentialem Übergang mit Knick (`tp.c` `tpSetupTangent` → `tcSetKinkProperties`). Der Abzug ist `acc_scale_max` des Übergangs, begrenzt durch die einstellbare Knickgrenze (`tpGetTangentKinkRatio`, höchstens 0,7071). Bei **gleichgerichteten** Geraden sind beide Tangenten gleich, der Beschleunigungsunterschied ist 0 und der Abzug damit 0. Bei einer Umkehr („sharp corner“, unter 2°) setzt der Planer `TC_TERM_COND_STOP`; es gibt keinen Übergang und keinen Abzug.
- `control.c` `process_probe_inputs`:
  - Beim Auslösen wird die **Rückmeldeposition** gespeichert (`probedPos = carte_pos_fb`), danach folgt `tpAbort`.
  - Der Auslösepunkt P ist also die Position in dem Servotakt, in dem der Eingang gelesen wird. Q ist der Stillstand nach dem Abbremsen.
- **INI (Codex R122):** Alle drei Profile setzen unter `[AXIS_Z]` `OFFSET_AV_RATIO = 0.2`. Der Planer nutzt dann 80 % von `MAX_VELOCITY` und `MAX_ACCELERATION` (XYZAC: 80 mm/s, 400 mm/s²); der Rest bleibt externen Versätzen vorbehalten.
- **Gemessen** am 30. September (F2000, G64): 2,13 mm. Fassung 1 verglich das mit v²/a = 2,22 mm bei a = 500. Mit der wirksamen Beschleunigung 400 und halber Bremsbeschleunigung ergibt die Formel 2,78 mm, bei voller 1,39 mm.
  - Die Messung liegt dazwischen. Die Übereinstimmung in Fassung 1 war also Zufall.
  - Wahrscheinliche Ursache: Der Anlauf vor dem Auslösen war kürzer als der Weg zum vollen Vorschub. Das ist eine Vermutung, keine Messung.
  - Das bestätigt Codex' Einwand: Ein genauer Einzelweg Q ist ohne Anlauf, Übergang und wirksame Grenzen nicht zu haben.

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

- **Die Teilstücke von G28/G30** werden nach ihrer Reihenfolge im Satz unterschieden (Zähler je Satz, an `next_line` zurückgesetzt). Nativ belegt: in den Standardfällen genau zwei Eilgang-Rückrufe.
  - **Abweichende Folge** (Codex R122): Ein dritter Rückruf im selben Satz, ein Vorschub-Rückruf oder ein Rückruf mit unklarem Rahmen wird **nie** als gespeicherte Lage eingestuft. Die startabhängigen Achsen werden ab dort unbekannt.
  - Bleibt der zweite Rückruf aus, behält die Achse ihren Zustand. Das ist vorsichtig: keine Achse wird ohne den Rückruf „bekannt“.
- **Eine gespeicherte Lage**, die aus einer startabhängigen oder unbekannten Lage geschrieben wurde (G28.1/G30.1), fällt unter E3/E6: Die betroffenen Achsen werden unbekannt.
- **Der erste Endpunkt** bleibt wie heute ein Punkt mit unbekanntem Start (`rapid_ustart`) **und** trägt seine Maske. Ein alter Leser sieht also dasselbe wie heute.
  - **Art und Zeitbasis** der ersten Bewegung bucht der Canon dazu (E8; VP122-02). Ein erstes `G1` bleibt ein Vorschub mit seinem F und wird nicht pauschal zum Eilgang. Das zählt auch für die Kollisionsprüfung: Ein Kontakt, der in einem Eilgang beginnt, ist ein Fund; im Vorschub ist er Schneiden.

**Die Vereinfachung (RDP) darf keine Ecke löschen, die erst nach der Korrektur zählt** (VP122-01). Codex' Gegenprobe: Nach `G53 G0 Z0 / G0 X0 / G0 Y0 / G0 X10` liefert der heutige Worker nur zwei Punkte. Mit Start (100, 100, 0) müssten zwei Zwischenecken bleiben; die erste liegt 74,33 mm neben der Ersatzdiagonale.

- **Regel:** Jeder Punkt, dessen Maske sich gegenüber seinem Vorgänger ändert, und dieser Vorgänger sind **Anker** der Vereinfachung, wie die Kinematikwechsel heute (`mode_boundary_indices`: beide Punkte eines Wechsels). Dasselbe gilt für jeden Übergang zwischen startabhängig, bekannt und unbekannt sowie für SAVE und RETURN der Routine (E4).
- **Warum das genügt:** Zwischen zwei Ankern haben alle Punkte dieselbe Maske. Die Korrektur verschiebt sie also alle um denselben Vektor. Eine Verschiebung ändert keinen Abstand eines Punkts zu einer Sehne, und RDP auf den angenommenen Koordinaten ist für die korrigierten exakt.
- **Erste Umsetzung:** Wenn die Ankerregel zu viel Aufwand ist, darf der Worker den Anfang einschließlich seiner Übergänge ungekürzt übertragen. Der Anfang ist in Programmen wie dem Parity-Programm kurz; ein Programm, das eine Achse nie absolut befiehlt, hätte dann aber einen ungekürzten Weg. Deshalb ist die Ankerregel das Ziel.
- **Anzeige-LODs:** Sie berühren den Anfang nicht, weil der statische Weg ihn nicht zeichnet (E7). Wird er später gezeichnet, gilt dort dieselbe Ankerregel.

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
| −210, Rückfahrt zum Haltepunkt (nur `#3106 = 1` und Modus 1) | `(WEBUI_POS_RETURN)` | die folgenden zwei Sätze (`G1 X Y`, `G1 Z`) übernehmen für ihre Achsen den gemerkten Zustand statt „bekannt“, nach dem Vorrang unten |
| −70, `offset_z = #5422` nach `G53 G1 Z0` | `(WEBUI_POS_READ=Z)` | Z muss hier bekannt sein (das absolute G53 Z0 direkt davor); sonst Messung nicht vorhergesagt, Grund `position` |
| Auslösepunkt in o<520>/o<530>: `#5061…#5069 = #5420…#5428` | `(WEBUI_POS_READ=XYZ)` | X, Y, Z müssen hier bekannt sein (nach der absoluten Positionierung über den Taster); sonst Grund `position` |

- **Vorrang bei RETURN** (Codex R122, Antwort 1), je Achse:
  1. Unbekannt **bis zum Programmende** (`_frame_unknown`, eine nicht vorhergesagte Messung, eine Lesung aus unbekannter Lage) bleibt unbekannt. RETURN hebt das nie auf.
  2. War die Achse bei SAVE unbekannt, wird sie unbekannt.
  3. War sie bei SAVE startabhängig, wird sie startabhängig.
  4. Sonst wird sie bekannt: Der gesicherte Wert war echt.
- **Rückfahrt abgeschaltet:** Bei `#3106 = 0` läuft die Rückfahrt nicht, und die gesicherten Werte werden nie benutzt.
- **Fremde Lesungen** in Remap-Rümpfen, die der Text nicht auflöst, bleiben vorsichtig: Sie gelten als „liest jede Achse“. Die Herkunft der Aufrufzeile bleibt dabei wie heute erhalten.
- **Wächter am Text:** Ein Test verlangt, dass jede Positionslesung der Routine eine dieser Markierungen trägt. Eine spätere Lesung ohne Markierung ist dann ein Testfehler.
- **Vorgabe der R102-Planung:** Der Vergleich der task-Pfade (`test_tool_touch_off_paths.py`) bleibt grün; Kommentare ändern den Ablauf nicht.

### E5 · Die gebundene Startbasis

Nur der Programmanfang wird ergänzt, und nur aus der Basis, an die die Prüfung gebunden ist. Nie aus einer späteren Live-Position.

| Prüfung | Startbasis |
|---|---|
| Simulation und die Anfahrprüfung im Stillstand | die Gelenkposition, die die Anfahrspur heute schon fasst: beim Eintritt, beruhigt nach Bewegung (500 ms) |
| Prüfung im Lauf (voll ab 0 und Bereich) | **neu:** `run_basis.start.joints` (Bedingungen unten); `CheckBasis` trägt sie, `run_check_wire.json` bekommt das Feld auf beiden Seiten |
| Lauf ohne diese Position (Bedingungen nicht erfüllt, unbestätigte Basis, älteres Gateway) | keine: der startabhängige Anfang bleibt ungeprüft, benannt |
| Parity (`simDump`) | `header.start_joints` der Aufzeichnung, über `buildEntryTrack` wie der Browser |

**Die Startposition des Laufs ist eine beobachtete Basis, keine atomare Bestätigung des Controllers** (Codex R122, Antwort 2). Das Gateway trägt sie nur unter diesen Bedingungen ein:
- **Kopie sofort nach dem Poll:** Die Gelenkposition wird unmittelbar nach `STAT.poll()` als unveränderliche Kopie abgelegt, vor jedem `await`. Heute wartet `_begin_run_basis` zwischen Poll und `_start_snapshot(STAT)` auf `program_source`. Dort wird entweder vorher kopiert oder nach der Ein-/Ausgabe neu gepollt; die Position stammt dann aus dem neuen Poll.
- **Beobachteter Stillstand im selben Poll:** AUTO, Interpreter IDLE, `inpos`, |`current_vel`| ≤ 0,001.
- **Vollständige Werte:** alle Gelenkwerte endlich, in der Reihenfolge und Anzahl der Gelenke (`viewer_init.axes`).
- **Gebunden an genau den gesendeten Start:** dieselbe `run_id`, Zustand `sent`.
- Fehlt eine Bedingung, bleibt die Basis ohne Position. Das ist kein Fehler des Starts.
- **Benannte Grenze:** Ein fremder Befehlsgeber (eine zweite Oberfläche, halui) oder eine nicht beobachtete Bewegung zwischen Poll und Start wird nicht erkannt. Es kommt kein neuer Maschinenbefehl zur Absicherung dazu.

**Rechnung:**
- Δ = (Startbasis in Programmkoordinaten der Epoche 0, mit dem Werkzeugversatz vor dem ersten TLO-Ereignis; derselbe Weg wie heute die Anfahrbewegung, `machineJointsToProgram`) − `start_believed`.
- Jeder Punkt i des Anfangs bekommt `pos_i[a] += Δ[a]` für jede Achse a in `dep_i`. Die Rechnung gilt, weil E3 nur Rahmen zulässt, in denen Δ je Achse über alle Epochen konstant ist.
- **`start_believed`** liefert der Worker ausdrücklich mit: die Programmkoordinate der angenommenen Startlage am ersten Programmrückruf (`_begin_program`), in Epoche 0. Mit G92-Persistenz und `%`-Anfangsphase ist „Null“ eine Annahme, keine Konstante.

### E6 · Schreiben aus einer startabhängigen Lage

Die heutige Regel für unbekannte Achsen gilt auch für startabhängige: G92, G10 L20/L10/L11, G28.1 und G30.1 schreiben aus der Position. Bei einer betroffenen Achse ist der geschriebene Wert die Annahme der Vorschau, und die Achsen werden **bis zum Programmende unbekannt** (`_frame_unknown`). Ihre Zeile wird im Hinweis genannt.

Eine Korrektur des Versatzes um Δ wäre möglich, liegt aber außerhalb dieses ersten Umfangs.

### E7 · Client: Anfang, Grundspur, Anfahrspur

- **Ende des Anfangs:** K = der erste Punkt nach dem letzten Punkt mit `dep ≠ 0`. Ohne `dep` ist K = 0, und alles bleibt wie heute.
  - `dep` kann innerhalb des Anfangs wieder auftauchen: Die Rückfahrt der Routine übernimmt die Maske. K richtet sich deshalb nach dem **letzten** Punkt mit Maske. Das gilt auch, wenn dazwischen Punkte mit leerer Maske liegen.
  - **Ganz startabhängige Spur** (Codex R122, Antwort 4): Hält eine Maske bis zum letzten Punkt, ist K = n. Dann gehört die ganze Spur zur Anfahrspur, und die Grundspur prüft nichts. Ihr Ergebnis sagt „the whole program depends on where the machine stands“, nicht „Clear“.
  - Ein späterer unbekannter Start nach einem M6 an der Wechselposition oder nach einer Messung liegt nie im Anfang und wird nie aus Live-Koordinaten ergänzt (E1).
- **Grundspur** (Prüfung beim Laden, gezeichneter Weg):
  - Die Punkte vor K sind ohne Bindung nicht darstellbar. Sie werden wie ein Bruch behandelt: nicht gezeichnet, nicht geprüft, benannt („the start of the program depends on where the machine stands — checked from the machine's position in the simulation“).
  - Heute wird dort der angenommene Weg gezeichnet und geprüft, bei X0 Y0.
- **Anfahrspur** (`buildEntryTrack`): die Live-Position, dann die korrigierten Punkte 0 … K, dann der Rest.
  - Der Seiten-Sweep prüft `sliceTrack(entry, 0, K + 2)` statt zwei Punkten.
  - Die Verschiebung beim Zusammenführen (`mergeEntryResult`) ist die Länge bis K. Heute ist es die bis zum ersten Punkt.
  - **Einträge** des Seiten-Sweeps behalten ihre eigenen Zeilen, angezeigt mit `displayLineForPoint` (L6, in der Routine die Aufrufzeile). Sie tragen ihren Ursprung `E` und fallen mit der Startbasis weg.
  - Die Anzeige „→ entry“ bleibt der Bewegung von der Live-Position zum ersten Punkt. Heute sind alle Einträge der Anfahrt „line 0“; das wird mit dieser Änderung genauer.
- **Zeit** (VP122-02): Fassung 1 nahm die Rate aus angenommener Länge durch angenommene Dauer. Bei einem Nullweg ist das 0/0. Codex' Gegenprobe: `G1 X0 F100` und `G1 Y0 F200` geben dieselbe Nutzlast wie mit vertauschtem F; mit Start (100, 100, 0) dauern sie aber 60/30 s bzw. 30/60 s.
  - **Neu:** Jeder Punkt des Anfangs trägt Art und Zeitbasis der Bewegung, die an ihm endet (E8). Das Segment davor dauert dann:
    - **Eilgang:** max(linear / Eilganggeschwindigkeit, rotatorisch / Drehachsen-Eilgang), wie heute die Anfahrbewegung (`rapid_rate`, `rot_rapid_rate`).
    - **Vorschub, G94 mit F > 0:** max(lineare Länge, Drehwinkel) / F, die Regel des Workers.
    - **Vorschub mit nicht unterstützter Basis** (G93, G95, F fehlt oder ≤ 0): Die Zeit ist **unbekannt**. Damit die Spur eine Ordnung behält, sitzt das Segment auf der Zeitachse mit seiner kürzesten möglichen Dauer, der Länge bei Eilganggeschwindigkeit (kein Vorschub ist schneller als die Achsgrenze). Ab dort zeigt die Zeitanzeige eine Untergrenze („+“, wie nach einer nicht vorhergesagten Messung), und das „?“ nennt die Zeile. Nicht still, nicht 0.
  - **Die Bewegung von der Startposition zum ersten Punkt** ist die erste Bewegung des Programms. Sie hat deren Art und Zeitbasis, nicht pauschal Eilgang. Ein Programm, das mit `G1` beginnt, fährt dorthin im Vorschub.
- **Grenzprüfung:** Startabhängige Achsen eines Anfangssegments prüft der Worker nicht (sie wären bei X0 Y0 geprüft). Bekannte Achsen prüft er wie heute.
  - Unverändert ungeprüft bleibt nur der Fall, dass ein G91-Delta einer startabhängigen Achse über die Grenze führt. Benannt.
  - Heute kann der Endpunkt bei X0 Y0 eine falsche Grenzmeldung erzeugen oder eine echte verdecken.
- **Prüfung im Lauf:** Die volle Prüfung ab 0 baut ihren Anfang aus `run_basis.start.joints`. Ein Bereich, der im Anfang beginnt, ebenso. Ohne diese Position bleibt der Anfang ungeprüft, benannt (E5).

### E8 · Draht

- **Neu:** `feed_dep` / `rapid_dep` (u8 je Punkt, Bit 0 X, 1 Y, 2 Z; nur vorhanden, wenn ein Bit gesetzt ist) und `start_believed` [x, y, z].
- **Neu, nur für die Punkte des Anfangs** (0 … K, je Strom): `feed_dep_basis` / `rapid_dep_basis` (u8: 1 Eilgang, 2 Vorschub G94, 3 Vorschub mit nicht unterstützter Basis). Dazu `feed_dep_f` (f32, F in Maschineneinheiten pro Minute für Basis 2). Der erste Endpunkt steht als Nullweg im Eilgangstrom, trägt aber die Art seiner Bewegung.
- **Gewechselte Achsen:** Gründe `position_read` / `position` laufen in die vorhandenen `probe_unpredicted`-Zeilen. Die Zeile einer Schreib- oder Leseursache läuft in `stale_offset_lines` bzw. eine neue Liste `position_read_lines`.
- **Schema:** Die neuen Schlüssel werden ausgeliefert (alte Leser übergehen sie). Die Schemanummer wird **erst beim Suite-Stopp** erhöht; die Goldens werden dort neu erzeugt, nie live.

### E9 · Was benannt bleibt

- U, V, W werden nicht verfolgt (in der Vorschau ohnehin 0).
- Ein Anfang mit TCP, TWP, gedrehter Halterung, Bogen in der Ebene, Zyklus oder Antastung wird unbekannt statt korrigiert.
- `inline` / `foreign` mit möglicher Lesung: alles unbekannt ab Programmstart.
- G91-Deltas startabhängiger Achsen ohne Grenzprüfung.
- Vorschub mit G93 oder G95 im Anfang: Die Zeit ist eine Untergrenze („+“).
- Die Startposition des Laufs ist beobachtet, nicht vom Controller bestätigt (E5).
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
14. Die Prüfung im Lauf mit und ohne `run_basis.start.joints`. Das Gateway trägt keine Position ein bei Bewegung im Poll, bei nicht endlichen oder fehlenden Gelenkwerten und bei einem Poll vor einem `await` ohne neue Kopie.
15. **Codex' RDP-Gegenprobe** (VP122-01) über die ganze Kette, Canon → Worker/RDP → Client-Korrektur → Spur/Sweep: `G53 G0 Z0 / G0 X0 / G0 Y0 / G0 X10`, mit Δ = 0 und Δ = (100, 100, 0). Beide Zwischenecken bleiben erhalten. Dazu ein langer Anfang mit gleicher Maske, auf dem RDP weiter wirkt.
16. **Zeit** (VP122-02): `G1 X0 F100 / G1 Y0 F200` gegen die vertauschten F. Die Dauern unterscheiden sich wie 60/30 und 30/60 s. Ein erstes `G1` ist ein Vorschub. G93 und G95 im Anfang ergeben eine Untergrenze mit „+“.
17. G28/G30 mit einem dritten Rückruf oder einem Vorschub-Rückruf: Die Achsen werden unbekannt, nie „gespeicherte Lage“.
18. Eine ganz startabhängige Spur (K = n) und RETURN nach einer inzwischen dauerhaft unbekannten Achse.
19. **Parity:** `sim_parity.py gate` auf `m600_live` grün in beiden Richtungen bei Toleranz 0,5 (mit F6 für den Hüllenbereich). `simDump` bindet über `header.start_joints`.

Jeder Wächter wird mit einer kompilierenden Mutation rot geprüft.

---

## F · Vertrag: Auslösepunkt, Bremsbereich, Rückzug

Fassung 1 setzte Q als tiefsten Stillstand und rechnete von dort weiter, als wäre es der Weg der Maschine. Codex R122 (VP122-03): Eine obere Schranke ist kein Einzelweg, und der Rückzug von Q endet irgendwo in einem Bereich. Fassung 2 nimmt Codex' zweite Möglichkeit: eine **als solche geführte Hülle**, bis zur nächsten sicheren Position.

### F1 · Was bekannt ist und was ein Bereich ist

| Größe | Was | In der Vorschau |
|---|---|---|
| **P** | Auslösepunkt | wie heute: wo die Tabellenlänge des Werkzeugs den Taster berührt (`#3102 + L`, + `#3115` beim Kantentaster) — **bekannt** |
| **Q** | Stillstand nach dem Bremsen | ein **Bereich**: [P − h_max, P] entlang der Antastrichtung (F3) |
| Rückzug | die programmierte Bewegung ab Q | endet in [P − h_max + r, P + r] |
| langsame Antastung | ab dort bis P, Stillstand in [P − h_max,langsam, P], Rückzug | endet in [P − h_max,langsam + r, P + r] |
| nächste sichere Position | die nächste absolute Z-Bewegung der Routine: `G53 G1 Z0` (−200) | ab ihrem Ende wieder bekannt |

- **Die Unsicherheit ist eindimensional:** Zwischen dem schnellen Auslösen und `G53 G1 Z0` bewegt die Routine nur Z, bei festem X/Y. Ein Textwächter hält das fest; der G43 bei −190 bewegt nichts.
- **Der Hüllbereich** ist daher die Strecke H = [P − h_max, P + r] auf der Antastachse, bei festem X/Y. Jede Lage, die das Werkzeug dazwischen einnehmen kann, liegt in H.
- **Was an P bleibt:** `#5061…#5069` und `#5070` werden an P gesetzt. Die Längenformel (−170), `G10 L1`, `G43 H` und `toollen_table` rechnen aus P, unverändert. Codex R118: nie auf den Bremsendpunkt umbiegen.

### F2 · Wie die Vorschau den Bereich führt

**Der Weg:** Die Vorschau-Blöcke der Routine legen einen **Hüllweg**, der H ganz abfährt. Jeder Punkt darauf trägt die Markierung `probe_band`.

*Schnelle Antastung:*
1. `G1` bis P;
2. die Werte an P setzen;
3. `(WEBUI_PROBE_BAND)`, dann `G1` hinunter bis P − h_max (Bremsbereich);
4. der unveränderte Rückzug der Routine (endet bei P − h_max + r);
5. ein Vorschau-Schenkel hinauf bis P + r, das obere Ende des Bereichs.

*Langsame Antastung:*
1. von P + r hinunter bis P;
2. die Werte an P setzen;
3. hinunter bis P − h_max,langsam;
4. der Rückzug der Routine;
5. ein Schenkel hinauf bis P + r.

`(WEBUI_PROBE_BAND_END)` vor `G53 G1 Z0` beendet den Bereich.

**Die Kollisionsprüfung** fährt diesen Weg wie jeden anderen ab. Damit prüft sie jede Lage in H, auch den tieferen Bereich unter P, den sie heute nicht sieht. Ein Hindernis, das nur zwischen P und P − h_max liegt, wird gefunden.
- **Funde** mit einem Eintrag auf einem `probe_band`-Segment heißen „**possible**“: „may touch if the probe brakes the full distance“. Sie sind nie eine sicher eintretende Kollision (`band: true` am Eintrag; Sim-Tab und Code-Marken sagen es).
- Ein leerer Bereich ist eine echte Aussage der Hülle: Nirgends in H gibt es einen Kontakt.

**Zeit:** Die Zeiten im Bereich sind Schätzungen; die Schenkel laufen mit den Vorschüben der Routine. Das „?“ nennt den Bereich.

**Simulation:** Das Werkzeug fährt den Hüllweg, beschriftet „probe braking range“. Das ist keine Behauptung, dass die Maschine genau so fährt.

**Parity** (`sim_parity.py`):
- **Wahrheit → Sim** bleibt, wie es ist. Ein Wahrheitspunkt in H liegt auf dem Hüllweg, Abstand 0.
- **Sim → Wahrheit** lässt Proben auf `probe_band`-Punkten aus. Der Bericht nennt sie getrennt, mit ihrer größten Ausdehnung über die Wahrheit hinaus.
- Ein Bereich wird nur dort ausgelassen, wo die Nutzlast ihn markiert.
- Die globale Toleranz bleibt 0,5.

### F3 · Die obere Schranke h_max

h_max = v · t_kette + v² / (2 · a_boden)

| Größe | Wert | Begründung |
|---|---|---|
| ρ | `[AXIS_Z] OFFSET_AV_RATIO`, sonst 0 | Der Planer behält ρ für externe Versätze (Codex R122) |
| v | min(F_Antastung, (1 − ρ) · `[AXIS_Z] MAX_VELOCITY`, `[TRAJ] MAX_LINEAR_VELOCITY`) | obere Schranke der Geschwindigkeit beim Auslösen. Bei kurzem Anlauf ist sie kleiner, also innerhalb. Der Override ist aus: Die Routine schaltet ihn mit `M50 P0` ab (Zeile 143, nur task). Ein Übergang aus dem vorigen Segment ist durch dessen und F begrenzt |
| a_boden | ½ · min((1 − ρ) · `[AXIS_Z] MAX_ACCELERATION`, `[TRAJ] MAX_LINEAR_ACCELERATION`, falls vorhanden) | ½ ist die Halbierung eines parabolischen Übergangs (G64); unter G61 bremst das Segment mit der vollen Grenze, kürzer, also innerhalb |
| Knick-Abzug | 0 nach Konstruktion | Die schnelle Antastung folgt der gleichgerichteten `G53 G1 Z`-Fahrt zur Startlage (Abzug 0) oder einem Stillstand. Die langsame folgt dem Rückzug nach oben, einer Umkehr (STOP). Ein Textwächter hält beide Nachbarschaften fest; ändert sich die Routine, ist der Test rot |
| t_kette | aus der zugelassenen Tasterkette (F4) | im Sim: 2 · Servoperiode |

XYZAC mit F2000: v = 33,3 mm/s, a_boden = 200 mm/s², h_max = 0,07 + 2,78 = **2,84 mm**. Langsam mit F200: 0,04 mm.

**Rechnung in der Routine:** Sie rechnet h_max in ihren Blöcken nur für die Vorschau aus der INI, so wie sie schon `#<_ini[AXIS_Z]MIN_LIMIT>` liest. `[TRAJ]` und `OFFSET_AV_RATIO` sind mit `EXISTS[…]` geschützt.
- Den Vorschub bringt sie mit `#<_metric>` und `#<_metric_machine>` auf Maschineneinheiten.
- t_kette kommt **nicht** aus der INI, sondern aus der Zulassung (F4).
- Nativ zu belegen bei der Umsetzung: wie `EXISTS` und ein fehlender `_ini`-Wert im Vorschau-Interpreter antworten.

### F4 · Die Zulassung der Tasterkette (VP122-04)

INI-Zahlen unterscheiden die Sim nicht von einer echten Steuerung mit zusätzlicher Eingangsverzögerung. Und `#<_task> EQ 0` bezeichnet jeden Vorschau-Interpreter. Die Zulassung kommt deshalb aus der **laufenden HAL** und erreicht die Vorschau über den Worker:

- **Prüfung im Gateway** über den HAL-Leser. Zugelassen ist nur die ausgelieferte Kette:
  1. Der Treiber des Signals an `motion.probe-input` ist **unmittelbar** der Ausgang der ausgelieferten Komponente `sim-toolsetter.0`; keine andere Komponente liegt dazwischen.
  2. Ihre Positionseingänge hängen an `joint.N.pos-fb`, wie `hallib/sim_toolsetter.hal` sie verdrahtet.
  3. Ihre Funktion läuft im Servo-Thread (`halcmd show thread`, einmal je LinuxCNC-Instanz). Die Periode des Threads ist die Servoperiode.
- **Ergebnis im Parse-Kontext:** `probe_chain`.
  - Zugelassen: {model: "sim_toolsetter", t_chain_s: 2 · Periode}.
  - Sonst: {model: null, reason}.
  - Das Gateway liest die Kette zu jedem Parse-Start neu; eine Änderung der HAL bis dahin ist erfasst.
- **Worker:** Er setzt nur bei Zulassung `#<_webui_probe_tchain>` als Init-Parameter. Die Routine prüft `EXISTS[#<_webui_probe_tchain>]`.
- **Nicht zugelassen** sind jede andere Kette, ein fehlender oder veralteter Leser, ein gescheitertes `halcmd` und ein fehlender Pflichtwert der INI. Dann gilt:
  - **P, die Messung und alles danach bleiben vorhergesagt.** P hängt nicht vom Bremsen ab, und nach `G53 G1 Z0` ist Z wieder bekannt.
  - **Der Bremsbereich unter P ist unbekannt:** Es gibt keinen Bremsschenkel, und der Hüllweg deckt nur [P, P + r]. Die Prüfung nennt die Stelle ungeprüft („braking depth on this probe input not known — not checked below the trip point, L…“), und das Ergebnis ist für diese Strecke nicht zertifiziert (`uncertified`).
  - Ob der Rückzug den Taster freigibt, ist unbekannt und wird genannt.
  - Das weicht von Codex' Vorschlag ab, die Messung dann „nicht vorhergesagt“ zu nennen. Frage 1 begründet es.
- **Negativer Wächter:** gleiche Achs-, TRAJ- und Servo-Werte, aber eine Entprellkomponente zwischen Komponente und `motion.probe-input` oder ein anderer Treiber → nicht zugelassen.
- **Kein Regler in `[DISPLAY]`** (Codex R122, Antwort 3). Eine echte Maschine kommt später nur mit einem eigenen nachgewiesenen Vertrag für Maschine und Taster dazu.

### F5 · Zulassungen in o<510>

| Fall | Folge | Warum |
|---|---|---|
| r ≤ 0 | nicht vorhergesagt (`retract`), wie heute | — |
| P − r < `[AXIS_Z] MIN_LIMIT` | nicht vorhergesagt (`slow_limit`), wie heute | Das Ende der langsamen Antastung liegt sicher außerhalb; motion lehnt sie beim Einreihen ab (`command.c`) |
| r ≤ h_max (zugelassene Kette) | **Hinweis**, die Vorhersage läuft weiter | Der Rückzug gibt den Taster vielleicht nicht frei; dann startet G38.2 ausgelöst, und LinuxCNC hält das Programm an. Das ist keine Gewissheit (Codex R122) |
| P − h_max − r < MIN_LIMIT ≤ P − r | **Hinweis** | Die langsame Antastung kann abgelehnt werden |

**Warum ein Hinweis genügt:** Scheitert die Routine an der Maschine, läuft danach weniger, als die Vorschau zeigt, nie mehr. Eine Prüfung, die dann zu viel zeigt, verdeckt nichts.

Die Hinweise laufen über eine Vorschau-Markierung `(WEBUI_PROBE_NOTE=<grund>)` in die Notiz der Messung (Sim-Tab, Programmstatistik).

### F6 · Nachweis: eine Messreihe, vor der Parity-Abnahme

**Ziel:** zeigen, dass h_max auf der Sim eine Schranke ist. Verlangt ist in jedem Fall 0 ≤ h_max − h_gemessen; der Abstand wird berichtet. Eine Obergrenze für ihn verlangt der Vertrag nicht mehr, weil der Bereich eine Hülle ist.

**Liegt ein Fall darüber**, ist das Modell dort falsch. Die Bedingung wird nicht zugelassen, bis die Ursache verstanden ist; die Toleranz wird nicht angepasst.

**Fälle:**
- Vorschub 500, 1000, 2000 und 3000 mm/min;
- Z-Beschleunigung 500 und 250 mm/s²;
- ρ 0,2 und 0;
- ein kurzer Anlauf, bei dem der Taster vor dem vollen Vorschub auslöst;
- G61 und G64;
- die tatsächliche Folge der Routine: gleichgerichtete Anfahrt, dann Antastung.
- Gemessen werden P (`#5063`), der Stillstand und der Abstand von P zum geometrischen Auslösepunkt (t_kette).

**Wo:**
- Die Vorschubfälle laufen auf der laufenden XYZAC-Sim per MDI am Sim-Taster.
- Die INI-Varianten laufen in kopflosen Kopien beim nächsten erlaubten Neustart (Golden-Rezept, `DISPLAY = dummy`).

**Reihenfolge:** vor der Parity- und Korpusabnahme (Codex R122). Fassung 1 hatte sie danach.

### F7 · Benannt

- Echte Tastereingänge sind nicht zugelassen. Unter P bleibt dort ungeprüft (F4).
- Die Zeit im Bereich ist geschätzt.
- Der Bereich setzt voraus, dass die Routine zwischen den Antastungen nur Z bewegt. Ein Textwächter hält das fest.
- Eine Antastung in einem Benutzerprogramm (G38 außerhalb der Routine) bleibt wie heute: Die Vorschau fährt den ganzen Weg. Das ist ein eigener Punkt, nicht Teil davon.

### F8 · Wächter

Codex' Liste aus R118, angepasst; nativ mit der gebündelten Routine (`test_m600_preview_worker.py`), Client-Kette und Parity-Werkzeug:

1. Schnelle und langsame Antastung: Der Hüllweg deckt [P − h_max, P + r], die Werte stehen an P.
2. Kurzer Anlaufweg: dasselbe h_max, als Schranke.
3. Geänderte Beschleunigung, geänderter Vorschub, ρ: h_max nach der Formel.
4. Rückzug kleiner als h_max: Hinweis, die Vorhersage läuft weiter. r ≤ 0 bleibt nicht vorhergesagt.
5. Hindernis nur zwischen P und P − h_max: als „possible“ gefunden, nie als sicher. Hindernis unter P − h_max: nicht gefunden, es liegt außerhalb der Hülle. Gegenkontrolle mit nicht zugelassener Kette: genannt, ungeprüft, nicht zertifiziert.
6. `#5061…#5069`, die Länge in `toollen_table` und der G43-Versatz werden **getrennt** gegen P geprüft, unverändert gegenüber heute.
7. Zulassung (F4): die ausgelieferte Kette zugelassen; gleiche INI-Werte mit anderer Kette, fehlender Leser oder gescheitertes `halcmd` nicht zugelassen.
8. Textwächter: nur Z zwischen den Antastungen; gleichgerichtete Anfahrt vor der schnellen und Umkehr vor der langsamen Antastung; der Pfadvergleich der task-Zweige bleibt grün.
9. `slow_limit` sicher → nicht vorhergesagt; möglich → Hinweis.
10. Parity-Werkzeug: Proben im Bereich zählen nur Wahrheit → Sim, getrennt berichtet; ohne Markierung wird nichts ausgelassen.
11. Die Messreihe F6.

Jeder Wächter wird mit einer kompilierenden Mutation rot geprüft.

---

## Reihenfolge

1. **F** (eigener Zweig): Routine und o<510>, Zulassung der Kette im Gateway, Hüllmarkierung bis zum Client und zum Parity-Werkzeug.
2. **Messreihe F6:** die Vorschubfälle auf der laufenden Sim, die INI-Varianten beim nächsten erlaubten Neustart. **Vor** der Parity-Abnahme.
3. **E** (eigener Zweig): Canon, Worker, Draht, Client, `run_basis`.
4. **Parity:** `xyzac.json` mit `m600_live` neu gemessen.
5. **Korpus:** gemergt erst, wenn die Parity grün ist.
6. **Suite-Stopp:** Schemanummer und Goldens (haus und kontur rufen M600 auf; jede Golden mit startabhängigem Anfang ändert sich).

Danach Paket 1 von Schritt 4.

## Fragen an Codex (Fassung 2)

1. **F4, nicht zugelassene Kette:** Ich schlage vor, nur den Bereich unter P ungeprüft und nicht zertifiziert zu führen. Die Messung und alles danach bleiben vorhergesagt. Dein Vorschlag war, die Messung dann „nicht vorhergesagt“ zu nennen.
   - P und damit die Länge hängen nicht vom Bremsen ab.
   - Zwischen den Antastungen bewegt die Routine nur Z, und `G53 G1 Z0` beendet die Unsicherheit.
   - Scheitert die Maschine, läuft nur weniger.
   - „Nicht vorhergesagt“ würde auf jeder echten Maschine nach dem ersten M600 den ganzen Rest des Programms ungeprüft lassen.
   - Trägt dieser Schnitt?
2. **F2, Funde im Bereich:** Sie heißen „possible“, als Kennzeichen am Eintrag mit eigener Wortwahl in Liste und Marken. Genügt das, oder soll ein solcher Fund keine eigene Zeile bekommen, sondern nur in der Notiz stehen?
3. **F6:** Verlangt ist nur 0 ≤ h_max − h_gemessen, der Abstand wird berichtet. Brauchst du zusätzlich eine Obergrenze, damit die Hülle nicht beliebig grob wird? Sie wäre eine Güteaussage, keine Sicherheitsaussage.

## Antworten auf R122

| Punkt | Antwort | Änderung im Plan |
|---|---|---|
| VP122-01 (P1) | Angenommen. Die Gegenprobe ist richtig: Eine Maske bringt gelöschte Punkte nicht zurück. | E2: Jeder Maskenwechsel samt Vorgänger ist ein RDP-Anker. Innerhalb einer Maske ist die Korrektur eine Verschiebung, unter der RDP exakt bleibt. Erste Umsetzung darf den Anfang ungekürzt senden; LODs berühren den Anfang nicht. E10 Nr. 15 über die ganze Kette mit Δ = 0 und Δ ≠ 0 |
| VP122-02 (P2) | Angenommen. | E7/E8: Art und Zeitbasis je Punkt des Anfangs (`*_dep_basis`, `feed_dep_f`); G94 gerechnet. G93/G95 oder fehlendes F ergeben eine unbekannte Zeit mit kürzester möglicher Dauer und „+“, genannt. Die erste Bewegung behält ihre Art. E10 Nr. 16 |
| VP122-03 (P1) | Angenommen, in deiner zweiten Form: eine geführte Hülle. | F neu: H = [P − h_max, P + r] bis `G53 G1 Z0`, Hüllweg mit `probe_band`, Funde „possible“, Parity zählt im Bereich nur Wahrheit → Sim. h_max mit `OFFSET_AV_RATIO` (2,84 mm bei XYZAC F2000) und Knick 0 nach Konstruktion (Textwächter). Messreihe vor der Parity-Abnahme, nur noch als Schranke verlangt. `r ≤ h_max` ist ein Hinweis, keine Gewissheit |
| VP122-04 (P1) | Angenommen. | F4: Zulassung aus der laufenden HAL (Treiber von `motion.probe-input`, Verdrahtung, Thread), je Parse über `probe_chain` und `#<_webui_probe_tchain>`. Kein INI- oder Namensmerkmal; negativer Wächter. Abweichung beim Nicht-Zulassen: Frage 1 |
| Antwort 1 (E4) | Übernommen. | E4: alle Achsen bis zum Ende. Vorrang bei RETURN: Dauerhaft unbekannt wird nie aufgehoben. Fremde Lesungen bleiben vorsichtig |
| Antwort 2 (E5) | Übernommen. | E5: Kopie sofort nach dem Poll (vor `await`, sonst neuer Poll), beobachteter Stillstand, vollständige Werte, an den gesendeten Start gebunden; fremde Befehlsgeber benannt |
| Antwort 3 (F2) | Übernommen. | F4: kein Regler; später nur ein ganzer Maschinen-/Tastervertrag |
| Antwort 4 (E) | Übernommen. | E7: K = n für eine ganz startabhängige Spur; RETURN im Anfang; späte M6- und Mess-Unbekanntheit nie aus Live-Koordinaten. E2: abweichende G28/G30-Folgen nie als gespeicherte Lage |
