## Claude · Antwort auf R309 Teil B · Anfrage R310 · 5. November 2026

**2c-b, Planfassung 2.** Nichts gebaut. Was aus R309 nicht angesprochen wird, gilt weiter. Teil A von R309 (P2) baue ich nach deiner Projektionstabelle aus FI308-04; das kommt in einer eigenen Runde.

### FI309-01 · Die Phasen aus einer festen Zuordnung im Strom selbst

Ich nehme deine zweite Möglichkeit: eine Zuordnung, die nur für diesen festen Programm- und Routinenstand gilt und aus deren **Texten** abgeleitet ist, nicht aus dem geprüften Weg. Empfangszeiten (`rfl_history`, WS) spielen für die Phasen keine Rolle mehr.

- **Programm:** das eigene `RFL_PROGRAM`, beim Laden über seinen SHA-256 gebucht, mit den Zeilen 1…N (N = 11).
- **Messphase:** die gebündelte Routine des Laufbaums, über ihren SHA-256 festgelegt (`MARKED_POS_ROUTINES`). R ist die Menge ihrer Zeilen mit Fahrsätzen, aus dem Text: 28 Zeilen, 211…601. Der Wrapper `m600.ngc` hat keinen Fahrsatz.
- **Vorab-Prüfung:** R ∩ [1, N] = ∅ und beide Hashes stimmen. Sonst wertet der Auswerter nicht aus, sondern meldet `incomplete` mit Grund.

**Die Zuordnung je Abtastung, nach `program-line` = v:**
- **v ∈ R:** Messphase.
- **v ∈ [1, N]:** Programm.
- **v = 0:** MDI ohne Datei oder Ruhe. Liegt die Abtastung nach der **letzten** Abtastung mit v ∈ R und vor der ersten mit v ∈ [1, N], gehört sie zur Einfahrt (sichere Höhe, Positionierung).
- **jeder andere Wert:** nicht zuzuordnen. Eine solche Abtastung mit Bewegung ergibt `incomplete`.

Die Grenze zwischen Messung und Einfahrt ist damit die letzte Abtastung mit einer Routinenzeile im selben Strom. Die Routine fährt nach ihrem letzten Fahrsatz nicht mehr; die Sätze danach sind `M50`, Pause und Log.

**Wächter:**
- derselbe Strom mit verschobenen Empfangszeiten ergibt dasselbe Urteil;
- ein Abstieg unmittelbar nach der letzten Routinenabtastung ist FAIL;
- eine fehlende Zwischenphase (keine Einfahrtsbewegung, Ruhe am Ziel) wird regulär bewertet;
- eine Programmzeilennummer innerhalb von R führt zur Ablehnung der Auswertung;
- eine Bewegung mit fremder Zeilennummer ergibt `incomplete`.

### FI309-02 · G61.1 im Testprogramm

Zeile 7 wird `G61.1 G1 X200 F3000`; G61.1 ist modal, also halten auch 8 und 9 genau an. Ich setze es in Zeile 7 selbst, weil Start ab Zeile die übersprungenen Zeilen nicht wirken lässt (Lauf 6). Die Zeilennummern bleiben gleich. Einfahrt, Werkzeug und Z-Erwartung (Zeile 7 auf sicherer Höhe, Zeile 9 `G0 Z-80`) sind unverändert. Der G64-Lauf 9 bleibt der Untersuchungsbeleg.

Mit genauem Halt gilt je Zeile eine **exakte** Achsentrennung:
- Solange v = L, bewegen sich Y und Z nicht mehr als 0,001 mm von ihrem Wert an der ersten Abtastung von L.
- Für L+1 gilt dasselbe für X und Z, für L+2 für X und Y.

Die Prüfung für L ist eine Regel des Starts (FAIL). Die Prüfung für L+1 und L+2 ist eine **Selbstprüfung** der Zuordnung: Schlägt sie fehl, ergibt das `incomplete`, aber nur ohne einen unabhängig schon bewiesenen FAIL. Einen FAIL stuft sie nie herab.

Nötig ist ein neuer nativer Lauf mit dem geänderten Programm. Der Wächter für die Programmkonstanten wird angepasst.

### FI309-03 · Der erste Ruheblock an der Einfahrt ist der feste Anker

**Der Anker:** der **erste** Block aus zehn Abtastungen nach der letzten Routinenabtastung, für den alles bekannt ist und gilt:
- `vel-cmd` aller drei Achsen ist 0;
- `in-position` ist wahr;
- die Lage weicht höchstens 0,001 mm von der ersten Abtastung des Blocks ab;
- X/Y liegen höchstens 0,010 von der Einfahrt entfernt, Z liegt auf sicherer Höhe (≥ −0,010).

Diese Werte entsprechen den Servo-Konstanten des Jogs. Ein späterer Ruheblock ersetzt den Anker nicht.

**Danach bis zur ersten Abtastung von L:** jede bekannte Geschwindigkeit ≠ 0 oder Lage mehr als 0,001 vom Anker ist FAIL („moved after reaching the entry“). Eine unbekannte andere Spalte verdeckt den bekannten Widerspruch nicht.

**Ohne Anker vor L:** `incomplete`, außer L startet bekannt nicht an der Einfahrt; dann gilt FAIL nach Regel 3 unten.

**Wächter:** Einfahrt erreicht, Ruhe, Ausflug um 0,020 mm, Rückkehr, Ruhe, korrekter Start von L. Das ist FAIL, auch mit einer ungelesenen anderen Achse im Ausflug und mit einer fehlenden späteren Abtastung.

### Die Regeln zusammen

**FAIL bei bekanntem Widerspruch:**
1. eine Programmzeile 1…L−1 mit Bewegung nach der letzten Routinenabtastung;
2. in der Einfahrt ein bekannter Abfall von Z um mehr als 0,001 (ein Rückzug senkt Z nie);
3. die erste Abtastung von L mehr als 0,010 von X/Y der Einfahrt oder unter der sicheren Höhe;
4. eine Bewegung nach dem Anker vor L;
5. L bewegt Y oder Z.

**`incomplete`:**
- ein Mangel im Abschnitt;
- die Vorab-Prüfung schlägt fehl;
- keine Abtastung von L;
- kein Anker;
- eine nicht zuzuordnende Bewegung;
- die Selbstprüfung von L+1 und L+2 schlägt fehl, ohne dass ein FAIL feststeht.

**Gegenprobe im Lauf:** derselbe Strom gegen eine Einfahrt 1 mm in X versetzt (`rfl-start-point.counter-entry-x+1`).

**Die Reichweite der Aussage:** Sie beruht auf beobachteten Bewegungsabtastungen. Übersprungene Sätze ohne Bewegung beobachtet dieser HAL-Kanal nicht; der Text von F-RFL.S3 sagt das. Die Lücke „2c-b“ fällt erst mit dem positiven nativen Beleg **und** den negativen Wächtern weg.

**Erbeten:** `agreement` oder `findings` zur Planfassung 2.
