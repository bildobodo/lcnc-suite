# M600 in der Vorschau — die Werkzeugmessung, die das Programm selbst ausführt

**Plan, Fassung 2 · 8. Oktober 2026 · Kollisionsplan Schritt 3 (Operator 2026-10-06).**
- Fassung 1 ging mit R102 zur Planprüfung an Codex.
- Fassung 2 nimmt VP102-01 bis 05 auf (Antworttabelle am Ende).
- Noch kein Code.

## Befund

Ein Programm mit `T13 M600` misst sein Werkzeug selbst: Die M600-Remap ruft `tool_touch_off.ngc`. Diese Routine fährt zur Werkzeugwechselposition, wechselt das Werkzeug (M6), fährt über den Messtaster und tastet zweimal an (G38.3, G38.2). Danach schreibt sie die gemessene Länge in die Tabelle (`G10 L1`), aktiviert sie (`G43 H`), fährt frei (`G53 Z0`) und optional zurück zur Startposition.

**Heute** überspringt die Vorschau den ganzen Rumpf: `o<400> if [#<_task> EQ 1]` (`tool_touch_off.ngc:20`). Folgen in der Vorschau:

1. **Kein Werkzeugwechsel:** Der Canon sieht kein M6. Der Werkzeugkörper im Sweep, die TLO-Ereignisse und die Werkzeugwechsel-Marke bleiben beim alten Werkzeug. Die Marke kommt nur aus dem Textscan (`toolChangeScan.ts`).
2. **Keine Fahrten:** Die Wege zum Wechselplatz und zum Messtaster sind unsichtbar, also weder zeitlich erfasst noch gegen Grenzen oder Kollisionen geprüft. Gerade sie laufen in Maschinenkoordinaten quer durch den Arbeitsraum.
3. **Länge:** Ein späteres `G43 H13` des Programms nimmt die Tabellenlänge. Nach einer echten Messung weicht die wirkliche Länge davon ab; die Vorschau zeigt weder diese Basis noch den Unterschied.

## Messung: was G38 in der Vorschau liefert

Nativ gemessen (Vorschau-Interpreter mit `native_start_probe.py`, 8. Oktober 2026): `G38.2 Z-50` von Z0 fährt den **vollen** Weg. `#5063` ist der Endpunkt (−50), `#5070` ist **0** (nicht ausgelöst); dasselbe gilt für G38.3. Der Vorschau-Interpreter beantwortet die Probe in C (`GET_EXTERNAL_PROBE_*`), der Python-Canon hat darauf keinen Einfluss.

Den Wache-Block einfach zu entfernen, würde also eine **falsche Länge** berechnen (`ABS[#3102] + #5063 − offset_z` mit dem vollen Probeweg) und per `G10 L1` in die Tabelle der Vorschau schreiben.

## Vorgehen

**1. Eine Vorschau-Variante in der gebündelten Routine, gleiche Positionierung** (Codex R102, Antwort 1: der richtige Ort).

- **Gleicher Code:** Die Positionierungsabschnitte (−70 bis −120: `G49`, `G53 Z0`, Wechselposition, M6, Messposition mit Durchmesserversatz und Kantentaster, Startposition für G38) laufen in Vorschau und Maschine **identisch**.
- **Wache verschoben:** Die Wache wandert vom ganzen Rumpf auf die Stellen, die die Vorschau nicht nachbilden kann: beide Proben, die Abbruchprüfungen über `#5070`, die Wiederholschleife bei Fehlschlag, M00/M01, M50 und LOG.
- **Unverändert in der Maschine:** Der Pfad `_task EQ 1` bleibt als Folge ausgeführter Anweisungen gleich, und die Zweig- und Aufrufstruktur auch.
  - Ein Test streicht die `_task EQ 0`-Zweige aus der neuen Routine und vergleicht das Ergebnis mit der bisherigen Routine.
  - Dazu kommen die nativen Fälle und das Korpus-Programm live.
- **Nur die gebündelte Routine:** Benutzerdefinierte M600-Remaps werden nicht still übernommen. Sie bleiben, wie heute, ohne Vorschau des Rumpfs (Abschnitt 4: dann benannt).

**2. Die Parameterbasis: was der Interpreter beim nächsten Start liest** (VP102-01).

| Parameter | Bedeutung | Quelle der Vorschau |
|---|---|---|
| #3004–#3007, #3009, #3010, #3013 | Vorschübe, Tastweg, Rückzug, Spindelnasenhöhe, Versatzrichtung | Toolsetter-Basis (unten) |
| #3100–#3115 | Tasterposition, Optionen, Kantentaster-Referenz | Toolsetter-Basis (unten) |
| #3014 | Kantentasternummer | Probe-Basis: dieselbe Regel, eigene Sektion |
| #3116 | Run-from-line-Wache | **0**: Jeder Start aus dem Stillstand löscht sie vorher (`_start_guard`) |
| #5181–#5183 | G30-Position | Var-Datei wie heute (Stand der letzten Synchronisation) |
| #5400, #5403, #5410 | Werkzeugnummer, Länge, Durchmesser | Werkzeugtabelle wie heute (`tool_table_z`, Tabellendatei) |
| `[AXIS_Z] MIN_LIMIT` | Begrenzung des Tastwegs | INI wie heute |
| #2000 | Modus (`m600.ngc` setzt 1) | der Aufruf selbst |

Es gilt, was **übernommen** ist, nicht was gespeichert ist:
- **Basis:** Der Interpreter liest die Toolsetter-Werte aus seinem Speicher. Das sind die zuletzt per MDI übernommenen (`_apply_probe_vars` mit `mdi_set = true`) oder, ohne Übernahme in dieser LinuxCNC-Instanz, die Var-Datei vom Start.
- **Kein Push beim Start:** Ein gewöhnlicher Programmstart sendet keine Werte (`cycleStart`).
- **Gateway-Buchführung:** Je Instanz ein Eintrag `toolsetter_basis` mit Werten, Herkunft (`applied` um Zeit X / `boot file`) und Version. Der Worker setzt genau diese Werte in seine Kopie der Parameterdatei; die Maschine wird nicht beschrieben.
- **Benennen:** Die Vorschau sagt, worauf sie steht: „Toolsetter values taken over 14:02“ bzw. „as LinuxCNC read them at start“. Weicht die bestätigte Sektion ab, steht dabei: „Settings has newer values — the next measurement the WebUI starts takes them over“.
- **Programmeigene Zuweisungen** (`#3009 = …` im Programm) wirken danach in Ausführungsreihenfolge, wie im Interpreter.
- **Cache und Mittellauf-Parse:** Die Basis mit Version gehört in den Parse-Kontext und den Cache-Schlüssel. Die angeheftete Mittellauf-Parse behält die eingefrorene Basis über ihren Parametertext (`param_text`).

**3. Gültigkeitsbereich der vorhergesagten Messung** (VP102-02).

Die Vorschau sagt eine **erfolgreiche** Messung nur voraus, wenn alle Bedingungen gelten:
1. **Bekannte Länge:** Das neue Werkzeug hat in der Tabelle eine Länge L > 0 (die Annahme „Länge aus der Tabelle“).
2. **Taster unter Maschinen-Z0:** `#3102 ≤ 0`. Nur dann ergibt die Formel der Routine (`ABS[#3102] + #5063 − offset_z`) am Auslösepunkt wieder L; das entspricht der Konvention „Z0 oben“ dieser Suite. Ein positives `#3102` wird **nicht vorhergesagt**, sondern benannt. Codex' Beispiel: Touch-Z 10 und L 20 ergäben L 40.
3. **Auslösepunkt auf dem Tastsegment:** `Z_trip = #3102 + L` (beim Kantentaster `+ #3115`) liegt auf dem Weg, den die Routine wirklich fährt. Das heißt: unterhalb der Startposition und oberhalb von Start − Tastweg, wobei die Startposition und der Tastweg (`#3007`, beim neuen Werkzeug `#3010`, gekappt auf die Achsgrenze) genau wie in der Routine berechnet werden.
4. **Langsame Probe:** Nach dem Rückzug um `#3009` (> 0) erreicht die langsame Probe (2 × `#3009`) den Punkt wieder. Mit `#3005 = 0` entfällt sie, wie in der Maschine.

Gelten sie, fährt die Vorschau statt G38 zum Auslösepunkt und zurück, mit denselben Vorschüben. Sie setzt `#<new_tool_length_offset> = L` (die Formel der Routine ergibt in diesem Bereich genau L); `G10 L1` schreibt denselben Wert, `G43 H` aktiviert ihn. Der Arbeitskoordinatenrahmen bleibt, wie die Routine ihn hat; die Ersatzfahrt setzt keine Probe-Parameter.

Gilt eine Bedingung nicht: Die Vorschau zeichnet die bekannten Wege bis zum Ende des Tastsegments (die Probe läuft voll durch, wie es die Maschine ohne Auslösung täte). Ab dort sagt sie „probe not predicted (T13: …) — not checked from L…“ mit dem Grund. Es gibt keinen erfundenen G10/G43-Folgepfad, und die Fehler- und Wiederholbehandlung der Routine wird nicht nachgebildet.

**4. Zustand und Abdeckung, wenn etwas unbekannt ist** (VP102-03).

| Abschnitt | Position | Angewandter Offset | Werkzeugkörper | Geprüft |
|---|---|---|---|---|
| Vor M600 | bekannt | wie bisher | altes Werkzeug | alle Paare |
| Ab M6, L bekannt | bekannt (G53-Fahrten) | G49 (0) | neues Werkzeug (Tabelle) | alle Paare |
| Ab M6, L unbekannt (≤ 0 / keine Zeile) | bekannt | G49 (0) | **unbekannt** | Maschinenpaare ja, Werkzeugpaare **nicht** |
| Ab der Probe ohne Vorhersage (Bedingung 1–4 verletzt) | **unbekannt** (Z nach der Probe) | danach aus unbekannter Messung | wie davor | **nichts**, bis Programmende |
| Späteres `G43` / `G43 H13` nach unbekannter Messung | unbekannt | Tabellenzeile T13 aus unbekannter Messung: **unbekannt** | — | nichts |
| Späteres `G49` | bleibt unbekannt (Programmrahmen aus unbekanntem Stand) | 0 | unbekannt | nichts |
| Wechsel auf ein anderes Werkzeug mit bekannter Zeile | bleibt unbekannt | — | bekannt | nichts |
| M600 ohne eingerichteten Toolsetter, oder eine fremde M600-Remap | unbekannt (der Aufruf hätte Werkzeug und Zustand geändert) | unbekannt | unbekannt | **nichts**, bis Programmende |

Begründung für „bis Programmende“: Ein aus unbekanntem Ergebnis abgeleiteter Offset- oder Registerwert bleibt unbekannt, bis seine Ursache nachweislich ersetzt ist. Diese Fassung liefert keine gezielte Wiederzulassung, sondern eine konservative, dauerhaft benannte Auslassung, wie beim Offset aus unbekannter Position (VP-I53).

Die Maschinenpaare mit bekannter Position laufen beim unbekannten Werkzeugkörper weiter (Zeile 3). Ein unbekannter Körper darf eine bekannte Position nicht verschwinden lassen.

**5. Herkunft der Länge: nie „gemessen“ ohne Nachweis** (VP102-04).

- **Vorschau:** „T13 = 65.04 mm from the table (assumed)“. Sie stammt aus dem Marker-Kommentar `(WEBUI_TOOLLEN_TABLE)` im Vorschauzweig und dem **zugehörigen** `G43 H` derselben Routine. Gezählt wird nur ein G43 vor dem `(WEBUI_SUB_END)` desselben Aufrufs. Der RFL-Rücksprung, der T0-Zweig und ein späteres G43 vervollständigen keinen offenen Marker.
- **Im Lauf:** Eine Tabellenänderung heißt „table updated“, ein G43 „applied offset“. „Measured“ zeigt die Oberfläche nicht, solange es keinen bestätigten Messnachweis (Werkzeug, Aufruf, Lauf) gibt. Den baut diese Fassung nicht.
- **Kanal, gemessen** (8. Oktober 2026):
  - `(DEBUG, …)` und `(MSG, …)` erreichen den Vorschau-Canon nicht, auch nicht aus einer Unterdatei.
  - `(PRINT, …)` schreibt auf die Standardausgabe des Interpreters, also in den Payload-Kanal des Workers: verboten.
  - Reine Kommentare erreichen `comment` in Ausführungsreihenfolge, so wie die `WEBUI_SUB`-Marker. Sie tragen aber keine Werte; den Wert trägt das G43.

**6. Die Restprüfung im Lauf: ein eigenes Folgepaket** (VP102-05).

Nach einer echten Messung im Lauf den Rest des Programms ab der laufenden Stelle zu prüfen, braucht mehr als hier steht: Start im konkreten Track-Vorkommen, Bindung an Datei, Version, Basis und Lauf, Kontaktzustand am Schnitt, Gültigkeit veralteter Antworten, CPU-Budget und Darstellung. Es wird ein eigener Plan. Bis dahin bleibt es beim heutigen Verhalten: Der Sweep ist im Lauf angehalten und läuft im Stillstand neu.

## Prüfungen

- **Maschinenpfad unverändert:** Ein Test streicht die `_task EQ 0`-Zweige und vergleicht mit der bisherigen Routine (Anweisungen und Zweigstruktur).
- **Nativ** (`native_start_probe.py` mit der echten Routine als Unterdatei, Toolsetter-Basis gesetzt):
  - L bekannt: die Fahrten in Maschinenkoordinaten, der Auslösepunkt `#3102 + L`, M6 als Werkzeugwechsel, G43 mit L.
  - Je verletzte Bedingung aus Abschnitt 3 ein Fall: L ≤ 0, `#3102 > 0`, Auslösepunkt außerhalb des Tastwegs bei `#3007 = 1` (Codex' Fall), Kappung durch die Achsgrenze, `#3005 = 0`.
  - Kantentaster, Durchmesserversatz, `#3106` (Rückfahrt), `#3108` (ohne Wechselposition).
  - Geänderte #3009/#3013 bei unveränderten #3100–#3115. Die Kantentasternummer nur in der Probe-Sektion geändert.
- **Basis:** gespeichert, aber nicht übernommen (`mdi_set = false`). Neu-Parse nach einer Settings-Änderung bei laufendem Programm (die eingefrorene Basis bleibt).
- **Zustandstabelle:** je Zeile ein Payload → Track → Sweep. Darunter ein Hindernis zwischen M6 und G38 bei unbekannter Länge (Maschinenpaar gefunden, Werkzeugpaar benannt), G43 erneut für dasselbe unbekannte Werkzeug, G49, Wechsel auf ein bekanntes Werkzeug, fehlendes Setup mit weiteren Bewegungen.
- **Herkunft:** Marker ohne zugehöriges G43 (T0, RFL-Rücksprung) vervollständigt nichts; ein G43 außerhalb des Aufrufs ebenfalls nicht.
- **Live:** ein M600-Programm im Sim-Parity-Korpus. Im Sim gleicht die Tabellenlänge der physischen, weil der Sim-Taster sie auslöst.

## Reihenfolge

1. Gateway-Buchführung der Toolsetter-Basis, Worker setzt sie, Benennung.
2. Vorschauzweig der Routine mit Gültigkeitsbereich, Maschinenpfad-Test, native Fälle.
3. Zustandstabelle und Herkunft im Canon und im Sweep.
4. Payload → Track → Sweep; Korpus-Programm live.

## Antworten auf Codex R102

| Punkt | Antwort | Planänderung |
|---|---|---|
| VP102-01 | Angenommen. Gespeichert ist nicht übernommen. | Abschnitt 2: vollständige Tabelle; Basis = übernommen oder Var-Datei vom Start, je Instanz gebucht, benannt; im Parse-Kontext und Cache-Schlüssel; Mittellauf eingefroren; keine Maschinenschreibzugriffe. |
| VP102-02 | Angenommen. | Abschnitt 3: vier Bedingungen inkl. Tastsegment und `#3102 ≤ 0`; außerhalb kein Folgepfad, benannt. |
| VP102-03 | Angenommen. | Abschnitt 4: Zustands- und Abdeckungstabelle; Werkzeugkörper unbekannt ab M6; konservativ bis Programmende. |
| VP102-04 | Angenommen. | Abschnitt 5: „from the table (assumed)“, „table updated“, „applied offset“; Marker nur mit dem G43 desselben Aufrufs. |
| VP102-05 | Angenommen. | Abschnitt 6: eigenes Folgepaket. |
| Antwort 1–3 | Übernommen. | Abschnitte 1, 5 und 4. |
