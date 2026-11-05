## Claude · Native Stufe Schritt 2c, Planfassung · Anfrage R299 · 5. November 2026

Danke für die Abnahme von 2a/2b (R298). Nichts aus 2c ist gebaut. Diese Fassung schlägt den Messvertrag vor, den Q288-1 als eigenen späteren Schritt vereinbart hat. Ich baue erst nach deiner Zustimmung.

### 1 · Das Messgerät (gemeinsam mit Schritt 3, S4b)

**Laden zur Laufzeit,** in der eigenen Testinstanz, nach der Zielprüfung. Die Kopie bleibt bytegleich, der Bericht hält die genauen `halcmd`-Änderungen fest (wie FI282-04):
- `loadrt sampler depth=65536 cfg=ffffffsb` mit diesen Kanälen:
  - `joint.0..2.pos-fb`, `joint.0..2.vel-cmd`;
  - `motion.program-line`;
  - `motion.in-position`.
- Ist ein Pin schon auf einem Signal, kommt `linksp` dazu, sonst `net` mit einem eigenen Signal.
- `addf sampler.0 servo-thread` am Ende; die danach **gelesene** Funktionsreihenfolge steht im Bericht.

**Der Leser:**
- `stdbuf -oL halsampler -c 0 -t`, damit die Zeilen ohne Blockpuffer kommen.
- Ein Lesethread versieht jede Zeile mit ihrer **Empfangszeit** auf derselben monotonen Uhr wie Statusbilder und Antworten.
- Der Servotakt T kommt aus der INI der Kopie (`[EMCMOT] SERVO_PERIOD`, 1 ms).

**Unvollständig, nie PASS:** eine Lücke in den Abtastnummern, `sampler.0.overruns` > 0 oder ein voller FIFO im ausgewerteten Abschnitt. Der Abschnitt wird erst nach seinem Ende beurteilt.

**Die Zuordnung zur Antwort folgt derselben Regel wie bei den Statusbildern:** Eine Abtastung, die **vor** einer Antwort empfangen wurde, ist vor ihr aufgenommen. Eine später empfangene beweist das Gegenteil nicht.

### 2 · Jog-Bremsweg (F-JOG.S5, Q288-1)

**Anker:**
- **Warum kein Verzögerungsbeginn:** Der Gateway schreibt `jog_stop` ohne zu warten (`_send_jog_stop`: `wait=None`). Der Beginn der Verzögerung liegt deshalb **nicht** nachweislich vor der Antwort und taugt nicht als Anker.
- **Der Anker** ist die **letzte vor der Antwort empfangene Abtastung**.
- **Grenze:** Der Weg von dort bis zum Stillstand ist eine Obergrenze des Wegs ab der Antwort. Die Leselatenz kann ihn nur vergrößern, also strenger machen, nie lockern.

**Stillstand:** `vel-cmd` = 0 und `pos-fb` unverändert (Abweichung höchstens 1 µm) über 10 aufeinanderfolgende Abtastungen.

**Urteil:**
- **PASS:** Obergrenze ≤ v²/2a + 2·v·4T, also unverändert 2,067 mm für X/Y und 2,48 mm für Z.
- **FAIL:** Rückwärtsbewegung über 1 µm gegen den weitesten erreichten Punkt, oder Bewegung nach dem Stillstand.
- **Sonst `incomplete`.**

Rein beschreibend, ohne Einfluss auf das Urteil, berichte ich den Weg ab dem Verzögerungsbeginn und den Abstand der Anker-Abtastung zu ihm.

**Bindung:** Die Fälle heißen `jog-x+.servo` usw. **F-JOG.S5** wird an diese sechs Servo-Fälle gebunden. Die Statusbild-Zeilen bleiben als Information im Bericht.

### 3 · Override-Plateau (F-OVERRIDE.S2)

**Aufbau wie R283:** `G90 G21 G94`, Start G53 X100 Y300 Z−50, `G1 X500 F6000`.
- **Erster Lauf:** Override 1,0.
- **Zweiter Lauf:** Override 0,5, gesetzt über `set_feed_override` und im Status (`feed_override` = 0,5) **vor** der Bewegung bestätigt.

**Messung:** Geschwindigkeit je Abtastung als Δ`pos-fb`(X) / T, im Fenster X 150…450, nach Position gefiltert und damit ohne Zeitzuordnung.

**Urteil:**
- Median 100 mm/s ± 5 % bzw. 50 mm/s ± 5 %.
- Weniger als 20 Abtastungen im Fenster, eine Lücke oder ein Überlauf ergeben `incomplete`.

**Gegenprobe:** dieselben Abtastungen gegen gepflanzte 75 mm/s, an der bestandenen Basis (`counter(…, base)`).

Fälle: `override-plateau-100`, `override-plateau-50` und die Gegenprobe.

### 4 · Rückzugsweg (F-GOTO.S1c, wie R284)

**Vorbereitung:**
- Start G53 X200 Y200 Z−60.
- `G64 P0.001` wird gesetzt und protokolliert.
- G54 = X100 Y100 Z0, damit → Zero ein eigenes Ziel hat.

**Auslösen,** wie die UI es tut: `go_to_zero` (Gateway-Befehl), `O<go_to_home> CALL` und `O<go_to_g30> CALL` (mdi), jeweils vom Start aus.

**Ziele,** vor dem Lauf aus der Kopie gelesen und im Bericht genannt:
- → Zero: X/Y = der G54-Nullpunkt (100/100), Z = Maschinen-Oberkante;
- → Home: die `HOME`-Positionen der Gelenke aus der INI der Kopie;
- → G30: #5181–#5183 aus der Var-Datei der Kopie, über `read_g30` bestätigt.

**Weg:**
- **Beginn:** die erste Abtastung mit mehr als 0,005 mm Abstand vom Start. Die Maschine steht vorher, also gehört jede Bewegung danach der Routine.
- **Phasen,** auf den Servo-Abtastungen:
  1. Z steigt auf ≥ −0,010 mm; X/Y bleiben dabei innerhalb 0,010 mm ihres Starts.
  2. X/Y fahren zum Ziel; Z bleibt dabei ≥ −0,010 mm.
  3. Nur bei G30: der Abstieg auf #5183, erst nachdem X/Y ihr Ziel innerhalb 0,010 mm erreicht haben. Mit #5181–#5183 = 0 der Kopie entfällt Phase 3; das steht in der Zeile.
- **Ende:** Stillstand in den Abtastungen und, im Status, Interpreter idle mit `inpos`. Die Endposition ist das Ziel ± 0,010.

**Urteil:** Ein Weg, der eine Phase nicht zeigt, ist `incomplete`. Ein beobachteter Verstoß ist FAIL.

**Gegenprobe:** ein MDI-Paar, das X/Y zuerst und dann Z fährt, ausgewertet mit derselben Regel gegen das → Zero-Ziel. Es muss FAIL ergeben und ist an einen bestandenen → Zero-Lauf gebunden.

Fälle: `goto-zero`, `goto-home`, `goto-g30` und die Gegenprobe.

### 5 · Der Startpunkt von Start ab Zeile (F-RFL.S3)

**Offene Frage:** Den Wegphasen der Servo-Abtastungen kann ich nur über `motion.program-line` zuordnen. Wie dieser Pin MDI-Zeilen und Remap-Körper zählt (die Vormessung), weiß ich nicht aus der Quelle. Ich will es nicht annehmen.

**Mein Vorschlag:**
- Der erste native Lauf zeichnet beim Fall `rfl-*` den Servo-Strom samt `program-line` mit auf.
- Der Auswerter für den Startpunkt (sichere Z-Stufe monoton steigend, XY-Fahrt auf sicherer Höhe, Endstillstand am Einstieg) entsteht danach als **Schritt 2c-b**, gegen die beobachtete Bedeutung, und wieder mit deiner Prüfung.
- Bis dahin bleibt `rfl-start-point` `incomplete`.

### 6 · Grenzen

- Alle Grenzen stehen fest, bevor gemessen wird. Keine wird nachträglich erweitert.
- **Messbasis:** Die Sim spiegelt `pos-cmd` als `pos-fb` zurück. Gemessen wird also die kommandierte Bahn, und genau die ändern Override und Routine.

**Erbeten:**
- `agreement` oder `findings` zur Planfassung 2c.
- Ausdrücklich zur Anker-Regel in Abschnitt 2 und zur Verschiebung des Startpunkts in Abschnitt 5.
