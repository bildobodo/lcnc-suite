## Claude · Native Stufe Schritt 2c, Planfassung 3 · Anfrage R301 · 5. November 2026

Nichts gebaut. Diese Fassung ändert nur die Punkte aus R300. Alles andere aus den Planfassungen R299 und R300 ist angenommen und gilt.

### FI299-01 Rest · Keine Zeit aus Nummern; der Sampler gehört dem Lauf

**Zeitnachweis nur über den Empfang.** Punkt 5(b) aus R300 und der Absatz „Zeit aus Nummern“ sind **gestrichen**.
- Der Stillstand gilt als nachweislich binnen 0,5 s ab der Antwort aufgenommen, wenn seine erste Abtastung binnen 0,5 s nach der Antwort **empfangen** wurde. Das ist die kausal sichere Richtung.
- Ein späterer Empfang bleibt zeitlich `incomplete`.
- Der Schwellwert bleibt 0,5 s.
- Nummernabstände nenne ich im Bericht nur beschreibend, nie als Zeitbeleg.

Dein Gegenfall (67 Schritte mit 480 ms Verzögerung dazwischen) ist damit `incomplete`; ein Wächter prüft das.

**Ununterbrochene Erfassung durch einen Besitzvertrag.**
- Der Lauf lädt die Sampler-Instanz selbst und **besitzt** sie.
- Während ein Abschnitt offen ist, ändert kein eigener Ablauf `sampler.0.enable`, die Funktionszuordnung (`addf`/`delf`) oder die Kanalsignale. Es gibt keine Pause als Puffersteuerung.
- Diese Regel steht im Code als ein einziger Zugangspunkt: Alle `halcmd`-Aufrufe der Messung laufen durch ihn. Er lehnt jeden ändernden Befehl ab, solange ein Abschnitt offen ist; nur `sets natv-mark` und lesende `getp`/`show` sind dann erlaubt.
- Am Anfang und am Schluss liest der Lauf `enable` = TRUE und die Funktionsreihenfolge, als Beleg für den Rahmen. Eine Unterbrechung dazwischen schließt dieser Beleg ausdrücklich **nicht** aus; das leistet nur der Besitzvertrag.
- Eine fremde Änderung durch einen anderen Prozess erkennt der Lauf nicht unabhängig. Das steht als Grenze im Bericht.

Ein Wächter prüft, dass der Zugangspunkt einen ändernden Befehl im offenen Abschnitt ablehnt. Für deine Sonde mit einer Pause in der Mitte des Abschnitts und zweimal `enable` = TRUE gilt das Gleiche: Diese Pause kann nur durch eine Verletzung des Vertrags entstehen, und die verhindert der Zugangspunkt.

**FIFO-Integrität, getrennt formuliert:**
- `sampler.0.overruns` ist am Schluss **unverändert** gegenüber dem Anfang.
- `curr-depth` steht am Schluss nicht am Limit (`depth`). Seine normale Schwankung ist kein Datenverlust.
- Den Abschluss durch die ganze Ausgabekette belegt die **empfangene Schlussmarke**.

### FI299-02 Rest · Der erste bestätigte Stillstand ist die feste Referenz

Punkt 4 aus R300 lautet jetzt:
- Nach dem nachgewiesenen Jog wird der **erste** vollständig bestätigte Block von zehn Abtastungen gemerkt: `vel-cmd` = 0 und `pos-fb` innerhalb 1 µm.
- Er darf auch schon vor der Antwort liegen; dafür wird keine neue Bewegung hinter dem Anker verlangt.
- Seine erste Abtastung ist die **feste** Stillstandsreferenz. Es gibt kein Zurücksetzen auf einen späteren Ruheblock.
- Jeder spätere bekannte Widerspruch bis zur Schlussmarke ergibt FAIL, auch wenn danach wieder ein gültiger Ruheblock folgt. Als Widerspruch gilt eine bekannte Geschwindigkeit ≠ 0 oder eine bekannte Position mehr als 1 µm von der Referenz.
- Eine unbekannte andere Spalte verdeckt den bekannten Widerspruch nicht (wie FI-I30).

Der Zeitnachweis aus Punkt 5 gilt für **diese** erste Abtastung.

**Wächter:** dein Gegenfall in beiden Richtungen. Stillstand ab 67, Wiederanlauf ab 100, neuer Ruheblock ab 120, Weg rund 1,701 mm, ergibt FAIL („moved again after its standstill“).

**Erbeten:** `agreement` oder `findings` zur Planfassung 3.
