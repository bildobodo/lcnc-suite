## Claude · Native Stufe Schritt 2c, Planfassung 2 · Anfrage R300 · 5. November 2026

Nichts gebaut. Diese Fassung ersetzt die Abschnitte 1, 2 und 3 der Planfassung R299 an den Stellen, die FI299-01 und FI299-02 betreffen. Die Anker-Regel und die Verschiebung des Startpunkts auf 2c-b sind angenommen und gelten unverändert. Ebenso unverändert gelten die Gegenprobe des Plateaus und die Phasen des Rückzugs.

### FI299-01 · Jeder Versuch ist ein abgeschlossener Messabschnitt

**Markerkanal.** Im selben Sample kommt ein eigener Kanal dazu: `cfg=ffffffsbs`.
- **Signal:** Der letzte Kanal hängt an einem eigenen, von keinem Ausgang getriebenen Signal (`newsig natv-mark s32`, `linksp natv-mark sampler.0.pin.8`). Der Lauf setzt es mit `halcmd sets`.
- **Kennungen:** Jeder Versuch k bekommt zwei eindeutige Marken, Anfang 2k+1 und Schluss 2k+2. Der Lauf zählt sie fortlaufend und vergibt jede genau einmal.

**Ablauf je Versuch:**
1. **Vorbereitung,** bestätigt: Startposition in Gelenkkoordinaten erreicht, Stillstand.
2. **Anfangsmarke:** Der Lauf setzt sie und wartet, bis der Leser eine Abtastung **mit** dieser Marke empfangen hat. Erst dann folgt der auslösende Befehl. Der Anfang liegt so nachweislich vor dem Befehl.
3. **Auslösen,** dann der fallbezogene Abschluss (Status idle mit `inpos`, Werte unten) und ein festes **Nachbeobachtungsfenster:**
   - Jog: 1,0 s ab der Antwort auf `jog_stop`;
   - Plateau und Rückzug: 0,5 s ab dem bestätigten Abschluss.
4. **Schlussmarke:** Der Lauf setzt sie und liest, bis eine Abtastung mit ihr **empfangen** ist.
5. **Ausgewertet** wird nur der Abschnitt zwischen der ersten Abtastung mit der Anfangsmarke und der ersten mit der Schlussmarke. Abtastungen mit einer fremden Marke gehören nicht dazu, etwa ein Strom eines früheren Versuchs.

**Unvollständig, nie PASS,** solange kein bewiesener Widerspruch vorliegt:
- die Schlussmarke binnen ihrer Frist nicht empfangen (abgeschnittener Schluss, Leser- oder Pipe-Rückstand);
- der Leser beendet;
- eine Lücke in den Abtastnummern im Abschnitt;
- ein nicht endlicher Kanalwert;
- `sampler.0.overruns` oder `curr-depth` am Schluss nicht auf dem Wert vom Anfang bzw. am Limit;
- eine `overrun`-Zeile des Lesers.

Ein bewiesener Widerspruch **im** gelesenen Abschnitt bleibt FAIL, wie vereinbart.

**Messintegrität im Bericht, je Versuch:**
- Sampler-Instanz, Versuch, Marken und Nummerngrenzen;
- `sampler.0.enable` = TRUE, gelesen am Anfang und am Schluss (`halcmd getp`);
- `overruns` am Anfang und am Schluss;
- die **gelesene wirksame Servo-Periode** (`halcmd show thread servo-thread`) neben der INI. Weichen sie ab, ist der Fall `incomplete`.
- die Funktionsreihenfolge und die Signalzuordnung der Kanäle (`show sig`), einmal je Instanz.

**Zeit aus Nummern** nur unter diesen Bedingungen: innerhalb eines lückenlosen Abschnitts mit bestätigter Periode T entspricht ein Nummernabstand n einer Servozeit n·T. Abtastnummern sind keine Uhrzeit; eine Zuordnung zur Uhr gibt es nur über die Empfangsregel.

**Plateau, Zuordnung vor dem Ortsfilter:**
- Die zwei Vorwärtsfahrten (Override 1,0 und 0,5) sind **zwei Versuche** mit eigenen Marken. Die Rückpositionierung dazwischen liegt außerhalb beider Abschnitte.
- **Erst danach** wird innerhalb jedes Abschnitts auf X 150…450 gefiltert.
- ΔX entsteht nur aus **benachbarten** Abtastungen (Nummer n und n+1) desselben Abschnitts, beide endlich.

**Offline-Gegenfälle** (synthetische Ströme, keiner darf seinen Nachweis bestehen lassen):
- abgeschnittener Schluss ohne Nummernlücke;
- Rückstand mit späterem Wiederanlauf hinter dem gelesenen Präfix;
- ein Strom des vorherigen Versuchs (fremde Marke);
- die Rückpositionierung im Plateau-Fenster;
- ein NaN-Kanalwert;
- `enable` = FALSE;
- eine abweichende wirksame Periode;
- ein erhöhter Überlaufzähler.

### FI299-02 · Die Servo-Zeilen tragen den ganzen Jog-Vertrag

`jog-x+.servo` usw. ergeben PASS nur mit **allen** Nachweisen:
1. **Vorbereitung:** Einheiten G21, G54, G92 aus, G49, Startposition X300 Y300 Z−50 in Gelenkkoordinaten erreicht, Stillstand. Die Anfangsmarke wird erst danach gesetzt.
2. **Bewegung im Vorzeichen:** Vom Anfang des Abschnitts bis zum Anker (der letzten vor der Antwort empfangenen Abtastung) bewegt sich die befohlene Achse um **mindestens 5 mm** in ihrem Vorzeichen. Die anderen Achsen bleiben innerhalb 0,01 mm.
3. **Weg ab der Antwort:**
   - **Obergrenze:** Anker bis zum weitesten erreichten Punkt, mit dem befohlenen Vorzeichen gerechnet.
   - **Grenze:** höchstens die unveränderte v²/2a + 2·v·4T.
   - **Rückwärts:** keine Bewegung über 1 µm gegen den weitesten Punkt.
4. **Stillstand nach dem beobachteten Jog:** der erste Block von zehn Abtastungen mit `vel-cmd` = 0 und `pos-fb` innerhalb 1 µm, **nach** der letzten Bewegungsabtastung hinter dem Anker. Ein alter Ruheblock vor dem Jog zählt nicht.
5. **Binnen 0,5 s:** Die erste Abtastung dieses Stillstands ist **nachweislich** innerhalb 0,5 s ab der Antwort aufgenommen. Der Nachweis gelingt, wenn
   - (a) sie innerhalb 0,5 s nach der Antwort **empfangen** wurde, oder
   - (b) ihr Nummernabstand zum Anker n·T ≤ 0,5 s ist. Der Anker ist vor der Antwort aufgenommen, also ist sie spätestens Antwort + n·T aufgenommen.

   Ein späterer Empfang oder ein größerer Abstand beweist weder Einhaltung noch Verletzung: `incomplete`.
6. **Kein Wiederanlauf** bis zur Schlussmarke. Bewegung nach dem Stillstand ist FAIL.

**Urteile:**
- FAIL nur aus einem bewiesenen Widerspruch: Bewegung gegen das Vorzeichen, Rückwärtsschritt, Bewegung nach dem Stillstand.
- Alles Übrige ohne vollen Nachweis ist `incomplete`, darunter auch der Weg unter 5 mm. Die Grenzen bleiben unverändert.

**Deine zwei Gegenfälle als Wächter:**
- **Keine Bewegung:** der Weg bis zum Anker ist 0. Ergebnis `incomplete`, nie PASS.
- **Kriechen mit 0,01 mm/s bis 1,0 s:** Der Stillstand beginnt erst nach 1,0 s, also ist n·T > 0,5. Ein Empfang binnen 0,5 s ist ausgeschlossen, weil die Abtastung zu diesem Zeitpunkt noch nicht aufgenommen war. Ergebnis `incomplete`, nicht PASS.

### Weitere Punkte aus R299

- **Gemeinsame Vorbereitung jedes 2c-Falls:** G21, G54 mit den Werten des Falls, G92.1, G49, Startgelenke erreicht, gelesen und im Bericht. Die Fälle übernehmen so keinen Zustand aus Antasten, M600 oder Start ab Zeile.
- **→ Home:** Das Ziel ist G53 X0 Y0 mit dem Z0-Rückzug aus `go_to_home.ngc`, nicht `JOINT_n.HOME`. Die Routine liest diese INI-Werte nicht.
- **→ G30:** #5183 = 0, der Abstieg entfällt, und die Zeile nennt das ausdrücklich. Ein späterer Fall mit abweichendem Z bleibt eine Ergänzung.

**Erbeten:** `agreement` oder `findings` zur Planfassung 2.
