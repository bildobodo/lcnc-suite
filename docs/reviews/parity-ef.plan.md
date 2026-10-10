# Parity-Befunde E und F — der unbekannte Programmanfang und der Bremsweg der Antastung

**Plan, Fassung 3 · 10. Oktober 2026.**
- Vorbedingung für den Parity-Korpus mit M600 (`scripts/parity_corpus/xyzac.json`, Zweig `test/parity-xyzac-m600`, ungemergt).
- Codex hat beide Befunde in R118 bestätigt und vor dem Bau je einen kleinen Vertrag verlangt; das sind diese beiden.
- Der Operator hat die Reihenfolge am 10. Oktober bestätigt: erst diese Verträge, danach Paket 1 von Schritt 4.
- Fassung 1 ging mit R122 an Codex. Die Grundentscheidung für E ist angenommen. Fassung 2 nimmt VP122-01 bis VP122-04 und die Antworten auf die vier Fragen auf; F ist neu geschnitten (eine geführte Hülle statt eines Einzelwegs). Antworttabelle am Ende.
- Fassung 2 ging mit R123 an Codex. VP122-01 ist geschlossen; die Hülle, die Messreihe vor der Parity und „possible“ als eigener Eintrag sind angenommen. Die Ausnahme für nicht zugelassene Tasterketten ist abgelehnt. Fassung 3 gibt die Zulassung ganz auf: Der Bremsbereich ist modelliert und nicht zertifiziert, und die Bahn nach einer Messung trägt ihre Bedingung sichtbar am Ergebnis, auf jeder Maschine, auch auf der Sim. Antworttabelle am Ende.
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
    - **Vorschub mit nicht unterstützter Basis** (G93, G95, F fehlt oder ≤ 0): Die Zeit ist **unbekannt**. Damit die Spur eine Ordnung behält, sitzt das Segment auf der Zeitachse mit seiner kürzesten möglichen Dauer. Sie folgt aus den Grenzen der INI, die der Planer nie überschreitet (mit `OFFSET_AV_RATIO` fährt er noch langsamer): max(maxᵢ |Δᵢ| / `[AXIS_i] MAX_VELOCITY`, |Δ_linear| / `[TRAJ] MAX_LINEAR_VELOCITY`). Das ist eine eigene Rechnung aus diesen Grenzen, nicht die vorhandene Eilgang-Schätzung unter neuem Namen (Codex R123). Ab dort zeigt die Zeitanzeige eine Untergrenze („+“, wie nach einer nicht vorhergesagten Messung), und das „?“ nennt die Zeile. Nicht still, nicht 0.
  - **Die Bewegung von der Startposition zum ersten Punkt** ist die erste Bewegung des Programms. Sie hat deren Art und Zeitbasis, nicht pauschal Eilgang. Ein Programm, das mit `G1` beginnt, fährt dorthin im Vorschub.
- **Grenzprüfung:** Startabhängige Achsen eines Anfangssegments prüft der Worker nicht (sie wären bei X0 Y0 geprüft). Bekannte Achsen prüft er wie heute.
  - Unverändert ungeprüft bleibt nur der Fall, dass ein G91-Delta einer startabhängigen Achse über die Grenze führt. Benannt.
  - Heute kann der Endpunkt bei X0 Y0 eine falsche Grenzmeldung erzeugen oder eine echte verdecken.
- **Prüfung im Lauf:** Die volle Prüfung ab 0 baut ihren Anfang aus `run_basis.start.joints`. Ein Bereich, der im Anfang beginnt, ebenso. Ohne diese Position bleibt der Anfang ungeprüft, benannt (E5).

### E8 · Draht

- **Neu:** `feed_dep` / `rapid_dep` (u8 je Punkt, Bit 0 X, 1 Y, 2 Z; nur vorhanden, wenn ein Bit gesetzt ist) und `start_believed` [x, y, z].
- **Neu, nur für die Punkte des Anfangs** (0 … K, je Strom): `feed_dep_basis` / `rapid_dep_basis` (u8: 1 Eilgang, 2 Vorschub G94, 3 Vorschub mit nicht unterstützter Basis). Dazu `feed_dep_f` / `rapid_dep_f` (f32, F in Maschineneinheiten pro Minute für Basis 2), in **beiden** Strömen (Codex R123). Der erste Endpunkt steht als Nullweg im Eilgangstrom; ist seine Bewegung ein `G1`, trägt er dort Basis 2 und sein F.
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
16. **Zeit** (VP122-02): `G1 X0 F100 / G1 Y0 F200` gegen die vertauschten F; die Dauern unterscheiden sich wie 60/30 und 30/60 s. `G21 G90 / G1 X0 F100 / M2`: Das **F der ersten Bewegung** kommt über Worker → Draht → Client an und bestimmt deren Dauer. G93 und G95 im Anfang ergeben die Untergrenze aus den INI-Grenzen mit „+“.
17. G28/G30 mit einem dritten Rückruf oder einem Vorschub-Rückruf: Die Achsen werden unbekannt, nie „gespeicherte Lage“.
18. Eine ganz startabhängige Spur (K = n) und RETURN nach einer inzwischen dauerhaft unbekannten Achse.
19. **Parity:** `sim_parity.py gate` auf `m600_live` grün in beiden Richtungen bei Toleranz 0,5 (mit F6 für den Hüllenbereich). `simDump` bindet über `header.start_joints`.

Jeder Wächter wird mit einer kompilierenden Mutation rot geprüft.

---

## F · Vertrag: Kontakt, Meldung, Bremsbereich, Rückzug

Fassung 2 wollte das Bremsmodell für eine **zugelassene** Tasterkette zertifizieren und nach der Messung alles wieder als abgesichert führen. Codex R123 hat zwei Lücken gezeigt:
- Eine verzögerte Meldung verschiebt auch den **gemeldeten** Messpunkt und damit die Werkzeuglänge.
- Die Topologie der Kette belegt das Modell nicht (Platte, Längenversorgung, Freigabe, manueller Eingang).

Fassung 3 geht deshalb den zweiten der beiden Wege, die Codex in R118 genannt hat: eine Hülle mit ausdrücklich begrenzter Aussage. **Keine Kette wird zugelassen, und nichts in diesem Bereich wird zertifiziert**, auch nicht auf der Sim. Was nach einer Messung folgt, zeigt und prüft die Vorschau weiter, aber als **sichtbar bedingte** Vorschau; die Bedingung steht am Ergebnis (Codex R123, Antwort 1).

### F1 · Drei Punkte, getrennt benannt

| Größe | Was | Was die Vorschau weiß |
|---|---|---|
| **P_geo** | geometrischer Kontakt | wo die Tabellenlänge den Taster berührt (`#3102 + L`, + `#3115` beim Kantentaster). Das ist schon eine Annahme: physische Länge = Tabellenlänge |
| **P_rep** | gemeldeter Punkt: die Rückmeldeposition in dem Servotakt, in dem motion das Signal liest (`probedPos = carte_pos_fb`, dann `tpAbort`) | P_rep ∈ [P_geo − v · t_in, P_geo]. t_in ist die Zeit vom Kontakt bis zum Lesen; im Allgemeinen unbekannt |
| **Q** | Stillstand nach dem Bremsen ab P_rep | Q ∈ [P_rep − v² / (2 · a_boden), P_rep] |

- **Was die Vorschau setzt:** `#5061…#5069` und `#5070` an **P_geo**, also mit t_in = 0. Damit ist die Länge die Tabellenlänge.
- **Was die Maschine misst:** eine um δ = P_geo − P_rep **kürzere** Länge, mit 0 ≤ δ ≤ v_letzt · t_in. v_letzt ist der Vorschub der Antastung, deren `#5063` die Längenformel (−170) zuletzt liest; mit langsamer Antastung die langsame.
- **Folge:** Mit `G10 L1` / `G43 H` läuft die Werkzeugspitze danach bis zum nächsten Werkzeugwechsel um δ **tiefer** als die Vorschau zeigt. Codex' Rechnung: 100 ms bei F600 ergeben 1 mm.

### F2 · Der Bremsbereich: modelliert, nicht zertifiziert

**Bereich:** Zwischen dem schnellen Auslösen und der nächsten absoluten Z-Fahrt der Routine (`G53 G1 Z0`, −200) bewegt die Routine nur Z, bei festem X/Y; ein Textwächter hält das fest. Die Vorschau führt die Lage dort als Bereich:

H = [P_geo − h_model, P_geo + r]
- h_model = max(h_schnell, h_langsam). Beide Antastungen sind eingeschlossen, auch wenn der „langsame“ Vorschub größer ist (Codex R123).
- h = v · t_model + v² / (2 · a_boden)
- v = min(F, (1 − ρ) · `[AXIS_Z] MAX_VELOCITY`, `[TRAJ] MAX_LINEAR_VELOCITY`)
- a_boden = ½ · min((1 − ρ) · `[AXIS_Z] MAX_ACCELERATION`, `[TRAJ] MAX_LINEAR_ACCELERATION`, falls vorhanden)
- ρ = `[AXIS_Z] OFFSET_AV_RATIO`, sonst 0. Der Override ist aus (`M50 P0`, Zeile 143).
- **½:** die Halbierung bei parabolischem Übergang (`tcGetOverallMaxAccel`). Der Knick-Abzug ist 0 nach Konstruktion: gleichgerichtete Anfahrt vor der schnellen Antastung, Umkehr (STOP) vor der langsamen; ein Textwächter hält beides fest.
- **t_model = 2 · Servoperiode:** ein idealer Tastereingang, der im nächsten Takt gelesen wird.
- XYZAC mit F2000: **2,84 mm**.

**Der Hüllweg:** Die Vorschau-Blöcke der Routine legen einen Weg, der H ganz abfährt (`probe_band` je Punkt; Ablauf wie in Fassung 2):
- schnell: bis P_geo, die Werte setzen, `(WEBUI_PROBE_BAND)`, hinunter bis P_geo − h_schnell, der Rückzug der Routine, ein Schenkel hinauf bis P_geo + r;
- langsam: bis P_geo, die Werte setzen, hinunter bis P_geo − h_langsam, der Rückzug der Routine, ein Schenkel hinauf bis P_geo + r;
- `(WEBUI_PROBE_BAND_END)` vor `G53 G1 Z0`.

**Was die Prüfung sagt:**
- **Funde** mit einem Eintrag auf `probe_band` heißen „**possible**“: ein eigener Eintrag mit Paar, Aufrufzeile und Bereich (Codex R123, Antwort 2). Das Kennzeichen bleibt beim Zusammenführen, Filtern, Navigieren und an den Code-Marken erhalten.
  - Ein „possible“-Kontakt begründet **nie** eine sichere Trennung und **nie** einen statischen Ausschluss.
  - Wird dasselbe Paar außerhalb des Bereichs sicher getroffen, ist dieser Fund ein gewöhnlicher Eintrag.
- **Ohne Fund im Bereich** heißt das Ergebnis nicht „Clear“ für ihn. Der Bereich ist **nicht zertifiziert**, mit dem Grund im „?“: „braking modeled for this machine's limits and an ideal probe input — a slower input brakes deeper; not certified“.
- **Unter P_geo − h_model** wird nichts behauptet.

### F3 · Die Bahn nach einer Messung: sichtbar bedingt

Die Vorschau setzt voraus, dass die Messung so abläuft, wie sie modelliert ist:
- Der Taster löst an P_geo aus.
- Er meldet sofort.
- Der Stillstand liegt in H.
- Der Rückzug gibt den Taster frei, und die langsame Antastung startet und endet zulässig.

Trifft das nicht zu, macht die Maschine etwas anderes. **Fassung 2 sagte hier „dann läuft nur weniger“. Das ziehe ich ausdrücklich zurück:**
- Löst die schnelle G38.3 nicht aus (Codex' Fall `enable = false`), fährt sie bis zum befohlenen Ende. Dann positioniert die Wiederholung der Routine neu (`o<106> … OR #<fastprobefailed> EQ 1`) und tastet erneut. Das sind Fahrten, die die Vorschau nicht zeigt.
- Eine langsame Antastung, die ausgelöst startet oder deren Ende außerhalb liegt, bricht dagegen ab.

**Am Ergebnis**, je M600-Aufrufzeile:
- Die Bahn ab dem Auslösen ist bedingt: der vorhandene Stern „*“ (`uncertified`), und das „?“ nennt die Bedingung mit Zahl:
  > „assumes the probe at L7 trips at the table length and reports within 60 ms (F2000; slower, the tool runs deeper than the 2 mm clearance) — not verified on this machine“
- **Die Zahl:** t_max = m / v_letzt, m die Prüfzone (2 mm). Grundlage: „Clear“ heißt, kein Paar außer statischen Kontakten und Vorschub ins Rohteil kommt näher als m (Schneidpaare zählen im Eilgang schon in der Zone als Kontakt; `collision.ts`).
  - Eine starre Verschiebung der Werkzeugseite um δ < m kann also keinen ungemeldeten Kontakt erzeugen.
  - Gemeldete Abstände verschieben sich um bis zu δ.
  - Bei F200: 600 ms; bei F2000 ohne langsame Antastung: 60 ms.
- **Hinweise zur Messung** (Sim-Tab, Programmstatistik), über `(WEBUI_PROBE_NOTE=<grund>)`:
  - r ≤ h_model: „the retract r may not clear the probe after braking (modeled up to h): the slow probe may start tripped and LinuxCNC stops“;
  - P_geo − h_model − r < MIN_LIMIT ≤ P_geo − r: „the slow probe may end below the Z limit“.
  - Beide sind Teil derselben Bedingung, kein eigener Freispruch.
- **Wie heute nicht vorhergesagt:** r ≤ 0 und P_geo − r < MIN_LIMIT (sicher abgelehnt).

**Externe Versätze:** Zeigt die Prüfbasis `axis.z.eoffset-enable` oder einen Versatz ≠ 0 (der Leser liefert beide), liegen Bereich und Folgebahn außerhalb des Modells; das ist ein weiterer genannter Grund (Codex R122/R123).

**Sim und echte Maschine** werden gleich behandelt. Auf der Sim ist die Bedingung erfüllt (t_in ≈ 2 Servotakte, δ ≈ 0,007 mm bei F200). Die Vorschau weiß das aber nicht verbindlich, und die Parity misst es nur.
- **Folge, sichtbar für den Bediener:** Jedes Programm mit einer vorhergesagten M600-Messung zeigt künftig „Clear*“ statt „Clear“. Das gilt so lange, bis ein nachgewiesener Vertrag für Maschine und Taster die Bedingung belegt (Codex R123, Antwort 3: später nur als ganzer Vertrag).
- Fassung 2 wollte das mit einer HAL-Zulassung für die Sim lösen. Das ist in dieser Fassung bewusst nicht enthalten.

### F4 · Parity: Abdeckung statt Weggleichheit

Codex R123, Antwort 3, angenommen:
- **Wahrheit → Sim** wird überall verlangt (≤ 0,5). Ein Wahrheitspunkt in H liegt auf dem Hüllweg.
- **Sim → Wahrheit** lässt `probe_band`-Proben aus und berichtet sie getrennt: als **Abdeckungsnachweis** mit der Breite der Hülle und ihrem Überschuss über die Wahrheit. Außerhalb markierter Bereiche bleibt der beidseitige Vergleich bei 0,5.
- **Mutationen:** eine fehlende Abdeckung (Hüllweg ohne den Bremsschenkel) und eine Markierung über `(WEBUI_PROBE_BAND_END)` hinaus sind rot.
- Die Hülle wird nie unter die verlangte Schranke gekappt, um die Anzeige zu verbessern. Die globale Toleranz bleibt 0,5.

### F5 · Messreihe, vor der Parity-Abnahme

Die Parity stützt sich auf die Abdeckung durch H. Die Messreihe zeigt, dass h_model auf **dieser** Sim eine Schranke ist: in jedem Fall 0 ≤ h_model − h_gemessen, der Abstand berichtet. Sie zertifiziert nichts für das Produkt.

- **Fälle:**
  - Vorschub 500, 1000, 2000 und 3000 mm/min;
  - Z-Beschleunigung 500 und 250 mm/s²;
  - ρ 0,2 und 0;
  - kurzer Anlauf;
  - G61 und G64;
  - die tatsächliche Folge der Routine.
  - Gemessen werden P_rep (`#5063`), der Stillstand und P_geo − P_rep (das gemessene t_in).
- **Protokoll der Konfiguration**, auf der sie lief:
  - `validate_sim_target` (die ausgelieferte INI-, HAL- und `loadusr`-Kette, R119–R121);
  - die Plattenparameter der Komponente gegen `#3100`–`#3102`;
  - `enable`, kein manuelles Auslösen, `eoffset` aus, ρ.
- **Ort:**
  - Die Vorschubfälle laufen auf der laufenden XYZAC-Sim per MDI.
  - Die INI-Varianten laufen in kopflosen Kopien beim nächsten erlaubten Neustart.
- **Ein Fall über h_model:** Das Modell ist dort falsch und wird korrigiert, nicht die Toleranz.

### F6 · Benannt

- Der Bremsbereich ist modelliert, nicht zertifiziert. Unter ihm wird nichts behauptet.
- Die Bahn nach jeder Messung ist bedingt (t_in, Tabellenlänge, Ablauf wie modelliert), auf jeder Maschine.
- Die Zeit im Bereich ist geschätzt.
- Eine Antastung in einem Benutzerprogramm (G38 außerhalb der Routine) bleibt wie heute. Eigener Punkt.
- **Späterer Schritt, nicht Teil davon:** ein nachgewiesener Vertrag für Maschine und Taster. Er müsste Kette, Platte, Längenversorgung, Freigabe, manuellen Eingang, externe Versätze und Gültigkeit über die Zeit belegen, wie Codex in R123 aufzählt. Er könnte die Bedingung für eine bestimmte Maschine aufheben.

### F7 · Wächter

Nativ mit der gebündelten Routine (`test_m600_preview_worker.py`), Client-Kette und Parity-Werkzeug:

1. Schnelle und langsame Antastung: Der Hüllweg deckt H, die Werte stehen an P_geo. Mit schnellem < langsamem Vorschub ist h_model = h_langsam.
2. Kurzer Anlauf, geänderte Beschleunigung, Vorschub und ρ: h nach der Formel.
3. Hindernis nur zwischen P_geo und P_geo − h_model: „possible“, nie sicher, nie als Trennung oder statischer Ausschluss. Dasselbe Paar später außerhalb sicher getroffen: ein gewöhnlicher Eintrag. Hindernis unter dem Bereich: nicht gefunden, nichts behauptet.
4. „possible“ übersteht Zusammenführung (Shards, Anfahrt), Filter, Navigation und Code-Marken.
5. Die Bedingung am Ergebnis: Stern und „?“ mit Aufrufzeile und t_max je Messung. Ohne M600 kein Stern.
6. Die Hinweise r ≤ h_model und die mögliche Grenzverletzung; r ≤ 0 und die sichere Grenzverletzung bleiben nicht vorhergesagt.
7. `#5061…#5069`, die Länge in `toollen_table` und der G43-Versatz werden **getrennt** gegen P_geo geprüft, unverändert gegenüber heute.
8. Externe Versätze in der Prüfbasis: genannt, außerhalb des Modells.
9. Textwächter: nur Z zwischen den Antastungen; gleichgerichtete Anfahrt und Umkehr; der Pfadvergleich der task-Zweige bleibt grün.
10. Parity-Werkzeug: Abdeckung (F4) mit beiden Mutationen.
11. Die Messreihe F5.

Jeder Wächter wird mit einer kompilierenden Mutation rot geprüft.

---

## Reihenfolge

1. **F** (eigener Zweig): die Routine (Hüllweg, Hinweise), der Canon (`probe_band`, Bedingung je Messung), die Kennzeichnung „possible“ und der Stern im Client sowie die Abdeckung im Parity-Werkzeug.
2. **Messreihe F5:** die Vorschubfälle auf der laufenden Sim, die INI-Varianten beim nächsten erlaubten Neustart. **Vor** der Parity-Abnahme.
3. **E** (eigener Zweig): Canon, Worker, Draht, Client, `run_basis`.
4. **Parity:** `xyzac.json` mit `m600_live` neu gemessen.
5. **Korpus:** gemergt erst, wenn die Parity grün ist.
6. **Suite-Stopp:** Schemanummer und Goldens (haus und kontur rufen M600 auf; jede Golden mit startabhängigem Anfang ändert sich).

Danach Paket 1 von Schritt 4.

## Fragen an Codex (Fassung 3)

1. **F3, die Bedingung als Stern:** Genügt der vorhandene Stern mit einer Zeile je Messung im „?“ als „Abhängigkeit am Ergebnis“? Oder sollen die Zeilen der Sim-Liste nach der Messung zusätzlich gekennzeichnet werden, wie nach dem ersten Grenzübertritt („after the measurement at L7 — conditional“)?
2. **F3, die Zahl t_max = m / v_letzt:** Trägt das Argument über die Prüfzone (eine starre Verschiebung der Werkzeugseite um δ < m erzeugt keinen ungemeldeten Kontakt)? Ich habe es an der Melderegel in `collision.ts` geprüft, nicht an einer Umsetzung.

## Antworten auf R122 (in Fassung 2; F4 dort ist durch Fassung 3 ersetzt)

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

## Antworten auf R123 (Fassung 3)

| Punkt | Antwort | Änderung im Plan |
|---|---|---|
| VP122-01 | Geschlossen (Codex R123). | — ; der Kettentest bleibt Umsetzungsgate (E10 Nr. 15) |
| VP122-02, Rest (P2) | Angenommen. | E8: `*_dep_f` in **beiden** Strömen; ein erstes `G1` trägt im Eilgangstrom Basis 2 und sein F. E7: Die Untergrenze für G93/G95 kommt aus den INI-Grenzen (Achsen und `[TRAJ]`), nicht aus der Eilgang-Schätzung. E10 Nr. 16 prüft das F der ersten Bewegung über die ganze Kette |
| VP122-03, Rest (P1) | Angenommen. | F1: P_geo, P_rep und Q getrennt; die Vorschau setzt P_geo (t_in = 0), die Maschine misst um δ ≤ v · t_in kürzer, und die Spitze läuft danach um δ tiefer. F3: Die Folgebahn ist auf jeder Maschine bedingt, Stern mit t_max = m / v_letzt. Externe Versätze sind ein genannter Grund. Die Begründung „dann läuft nur weniger“ ist zurückgezogen (Wiederholzweig `o<106>`) |
| VP122-04, Rest (P1) | Angenommen, durch Verzicht. | Keine Zulassung einer Kette in diesem Plan; der Bereich ist modelliert, nicht zertifiziert (F2). Die Konfiguration der Messreihe wird protokolliert, statt das Produkt zu zertifizieren (F5). Ein Vertrag für Maschine und Taster mit Codex' Liste ist als späterer Schritt genannt (F6) |
| Antwort 1 | Angenommen. | F3: sichtbar bedingte Folgevorschau mit der Abhängigkeit am Ergebnis, auf jeder Maschine |
| Antwort 2 | Angenommen. | F2/F7: „possible“ als eigener Eintrag, erhalten durch Zusammenführung, Filter, Navigation und Marken; nie Trennung oder statischer Ausschluss; später sicherer Treffer außerhalb ist ein gewöhnlicher Eintrag |
| Antwort 3 | Angenommen. | F4: Abdeckungsnachweis, Rückrichtung getrennt ausgewiesen, beidseitig 0,5 außerhalb, zwei Mutationen; keine Kappung der Hülle |
| Beide Antastungen | Angenommen. | F2: h_model = max(h_schnell, h_langsam) |
