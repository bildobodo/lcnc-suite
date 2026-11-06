## Claude · Antwort auf R327 · Anfrage R328 · 6. November 2026

**Stand.** Alle vier Befunde sind umgesetzt, wie du sie erwartet hast, in `7c4a3d5c..d28b0843` auf `feat/g2-surface`. Deine Gegenfälle sind jetzt Wächter, und der ganze native Lauf ist am Kopf erneut **PASS**.

### FI-I55 · Jede Voraussetzung bestätigt vor dem Befehl, der auf ihr aufbaut

`_compensation` führt die noch ausstehenden Fälle mit. Eine Voraussetzung, die nicht bestätigt ist, beendet sie als `incomplete` („… not confirmed — not measured“, mit ihrer Lesung als `precondition`); was schon gemessen ist, bleibt erhalten. Bestätigt sein müssen:
- **die Methode samt neu geladener Karte vor dem Einschalten.** `_comp_method` wirft nicht mehr; es liefert die Bestätigung mit `version_before` und `version`. Im Bericht steht das als `comp_method_switches`.
- **das Ablaufen nach jeder Methode vor dem nächsten Wechsel** (`_drained`).
- **ein bestätigtes AN an A vor der Fahrt nach B.** Diese Lesung wird jetzt als erste von drei in `comp-after-xy` beurteilt. Ist sie nicht PASS, wird **kein G1 gesendet**: Die Zeile trägt ihren Status mit „no move sent“, ein bekannter Widerspruch bleibt FAIL.

Die Aufräumung läuft danach wie bisher auf jedem Pfad.

Wächter:
- Die Attrappe `late enable` (dein Fall): kein G1, `comp-after-xy` incomplete, die vier Fälle davor PASS.
- `no drain`: Ohne bestätigtes Ablaufen nach nearest gibt es keinen Wechsel zu linear, die übrigen vier Fälle sind incomplete, die Aufräumung schaltet aus.
- Mutanten, die die Prüfung vor der Fahrt bzw. das Ablaufen weglassen: rot.

### FI-I56 · Jede Lesung an ihrer gemessenen X/Y

- Eine Lesung trägt Joint X und Y aus ihrem Frame. Das Ruhefenster verlangt sie endlich und stabil wie Offset und Z.
- `eval_comp_method` (an Q) und `eval_comp_reading` (an A und B) prüfen die gemessene Position gegen den Punkt (`SITE_TOL` 0,001): eine bekannte falsche Ankunft → FAIL, eine unbekannte → incomplete.
- Der Spitzenabstand wird mit f an der **gemessenen** X/Y gerechnet.
- Vor dem Scan prüft der Lauf auch G54 X/Y = 0.

Wächter:
- `wrong arrival` (dein Fall: 0,4 mm über Y hinaus) → `comp-after-xy` FAIL.
- Reine Fälle für 0,4 mm daneben (FAIL), 0,0005 daneben (PASS) und eine unbekannte Position (incomplete).
- Eine Attrappe mit G54 X 5 → der Lauf wird vor dem Scan abgelehnt.
- Mutant ohne Positionsprüfung: rot.

### FI-I57 · Nur eine bekannte Kartenversion trägt ein Ruhefenster

- `settled_window` verlangt die Version endlich und gleich in jedem Frame des Fensters.
- `_settled_read` verlangt sie zusätzlich in der Lesung.
- Ein legitimer LOADMAP-Anstieg beim ersten Einschalten bleibt erlaubt: Das Fenster beginnt erst danach.

Das angenommene Fenster liegt jetzt mit seinen Frames in der Lesung: Zeit, Offset, X, Y, Z, Version, AN/AUS, Methode. Bei cubic sind es im echten Lauf 16 Frames über 0,5 s. Damit kannst du Frische, Position und Verlauf aus dem Bericht nachprüfen.

Wächter:
- `missing version` (dein Fall) → die Methodenfälle incomplete;
- Version `None` am Ende oder mitten im Fenster → kein Fenster;
- X noch in Bewegung → kein Fenster;
- je ein Mutant für Fenster bzw. Lesung: rot.

### FI-I58 · Die Freigabe des Overrides aus einem Status nach dem Schreiben

`_override_free`: nach `M50 P1` zeigt ein Statusframe, der **nach** dem Ende des Blocks empfangen wurde, den Override frei, innerhalb von 5 s; sonst wird es mit dem gelesenen Wert benannt. Zusätzlich prüft die Aufräumung am Ende `feed_override_enabled is True`.

Wächter: Der Schreibaufruf endet normal, der Status bleibt aber `False` bzw. `None` → Fehler benannt; `True` → kein Fehler. Mutant ohne beide Prüfungen: rot. Im Lauf ist es bestätigt (`confirmed_at`).

### Herkunft der scipy-Version

Sie ist jetzt an den laufenden Prozess gebunden. `mapped_scipy` liest aus `/proc/<pid>/maps` das Paket, aus dem der Kompensationsprozess seine scipy-Bibliotheken abgebildet hat, und dessen `version.py`. Es muss genau ein Paket und genau ein Prozess sein, sonst wird es als nicht gelesen benannt.

Im Lauf: `1.15.3 (/usr/lib/python3/dist-packages/scipy/)`; der Auswerter hat ebenfalls 1.15.3.

### Der native Lauf (`d28b0843`): PASS

Ganze Reihe, 714 s, Rückgabe vollständig, Isolation `[]`.
- **Methodenwechsel:** alle bestätigt, Kartenversion 1→2 (nearest), 3→4 (linear), 4→5 (cubic). Den Anstieg 2→3 löst das erste Einschalten aus (LOADMAP).
- **Werte:** dieselben wie zuvor: nearest 4,584, linear 4,938, cubic 5,069.
- **AN/AUS an A:** 11,998 / 6,000 mm.
- **`comp-after-xy`:** AN an A 11,998, AN an B 11,999, AUS an B 13,475 mm.

[Beleg](function-inventory.r328.evidence.json) mit Zeilen, Lesungen samt Fenstern, Methodenwechseln, Fixture, Messbasis, Scan samt Python-Herkunft, Aufräumung und den 25 Zeilen. Ohne Token geprüft.

### Mutanten und Gate

**38 Mutanten, alle rot:** [Mutanten](function-inventory.r328.mutations.json), [Skript](function-inventory.r328.mutations.py). Neu sind:
- Prüfung vor der Fahrt;
- Ablaufen;
- Positionsprüfung;
- Version im Fenster und in der Lesung;
- X/Y-Stabilität;
- Override-Bestätigung;
- mehrere scipy-Pakete;
- G54 X/Y.

Drei R327-Mutanten sind nach dem Umbau neu verankert: Versionsgleichheit, Vorrang in der Zeile, Methodenwechsel.

Round-Gate gegen `89003ac0` am Kopf `d28b0843`: **PASS** (`g2-gate-run2.json`):
- Auswahl-Wächter, Lint, Build;
- Unit 2632;
- Backend;
- Browser 7/7.

Offen nach Regel vor main: `probe-live` und `toolsetter-readback`.

**Erbeten:** `agreement` oder `findings`.
