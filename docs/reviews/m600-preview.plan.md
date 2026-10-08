# M600 in der Vorschau — die Werkzeugmessung, die das Programm selbst ausführt

**Plan, Fassung 3 · 8. Oktober 2026 · Kollisionsplan Schritt 3 (Operator 2026-10-06).**
- Fassung 1 ging mit R102 zur Planprüfung an Codex.
- Fassung 2 nahm VP102-01 bis 05 auf; Codex hat in R103 VP102-02, VP102-04 und die Ausgliederung (VP102-05) angenommen.
- Fassung 3 nimmt die Reste von VP102-01 und VP102-03 sowie VP103-01 auf (Antworttabellen am Ende).
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

Es gilt der Stand **im Interpreter**, nicht der gespeicherte. Ein gewöhnlicher Programmstart sendet keine Werte (`cycleStart`). Das Gateway bucht deshalb **je Schlüssel** Wert, Herkunft und Gültigkeit (`toolsetter_basis`, je LinuxCNC-Instanz und Gateway-Prozess):

| Herkunft | Wann | Gültigkeit |
|---|---|---|
| `applied` | Ein MDI-Chunk von `_apply_probe_vars`, der den Schlüssel enthält, endete RCS_DONE (schlüsselweise je Chunk gebucht) | bestätigt |
| `read` | Bestätigtes Rücklesen wie beim G30-Vertrag: `task_plan_synch` RCS_DONE, **neuer Inode** der Var-Datei, im Stillstand unter `_cmd_lock` | bestätigt |
| `assumed` | Wert aus der Var-Datei ohne Bestätigung in diesem Prozess: nach einem Gateway-Neustart oder späten Anbinden, und für einen Schlüssel, den ein gesendetes MDI oder ein gestartetes Programm (Textscan) seither zuweist | Annahme |
| `unknown` | Ein Chunk mit dem Schlüssel scheiterte, wurde abgebrochen oder lief in den Timeout (die Übernahme rollt frühere Chunks nicht zurück: Codex R103) | unbekannt |

Regeln:
- **Rücklesen:** Ist ein Schlüssel nicht bestätigt und ist ein Programm mit M600 geladen (Textscan), liest das Gateway im Stillstand einmal bestätigt zurück, wie `read_g30`. Das macht `assumed` und `unknown` zu `read`. Die Maschine wird dabei nicht beschrieben; `task_plan_synch` schreibt nur die Var-Datei aus dem Interpreter.
  - Dass `save_parameters` die #3xxx-Zeilen der Datei mit den Interpreterwerten schreibt, ist bei der Umsetzung nativ zu belegen.
  - Gelingt es nicht, bleibt der Stand benannt.
- **Vorschau:** Der Worker setzt die gebuchten Werte in seine Kopie der Parameterdatei.
  - Alle Schlüssel `applied` oder `read`: „Toolsetter values taken over 14:02“ bzw. „read 14:05“.
  - Einer `assumed`: Die Vorschau rechnet, benennt die Basis aber als Annahme: „toolsetter values assumed from the var file — not verified“.
  - Einer `unknown`: M600 wird nicht vorhergesagt (Abschnitt 4: Toolsetter-Werte unbekannt).
  - Weicht die bestätigte Settings-Sektion ab: „Settings has newer values — the next measurement the WebUI starts takes them over“.
- **Programmeigene Zuweisungen** (`#3009 = …` im Programm) wirken danach in Ausführungsreihenfolge, wie im Interpreter.
- **Cache und Mittellauf-Parse:** Die Basis mit Version gehört in den Parse-Kontext und den Cache-Schlüssel. Die angeheftete Mittellauf-Parse behält die eingefrorene Basis über ihren Parametertext (`param_text`).

**3. Gültigkeitsbereich der vorhergesagten Messung** (VP102-02).

Die Vorschau sagt eine **erfolgreiche** Messung nur voraus, wenn alle Bedingungen gelten:
1. **Bekannte Länge:** Das neue Werkzeug hat in der Tabelle eine Länge L > 0 (die Annahme „Länge aus der Tabelle“).
2. **Taster unter Maschinen-Z0:** `#3102 ≤ 0`. Nur dann ergibt die Formel der Routine (`ABS[#3102] + #5063 − offset_z`) am Auslösepunkt wieder L; das entspricht der Konvention „Z0 oben“ dieser Suite. Ein positives `#3102` wird **nicht vorhergesagt**, sondern benannt. Codex' Beispiel: Touch-Z 10 und L 20 ergäben L 40.
3. **Auslösepunkt auf dem Tastsegment:** `Z_trip = #3102 + L` (beim Kantentaster `+ #3115`) liegt auf dem Weg, den die Routine wirklich fährt. Das heißt: unterhalb der Startposition und oberhalb von Start − Tastweg, wobei die Startposition und der Tastweg (`#3007`, beim neuen Werkzeug `#3010`, gekappt auf die Achsgrenze) genau wie in der Routine berechnet werden.
4. **Langsame Probe:** Nach dem Rückzug um `#3009` (> 0) erreicht die langsame Probe (2 × `#3009`) den Punkt wieder. Mit `#3005 = 0` entfällt sie, wie in der Maschine.

Gelten sie, fährt die Vorschau statt G38 zum Auslösepunkt und zurück, mit denselben Vorschüben.

- **Probe-Ergebnisse** (VP103-01): Am Auslösepunkt, **vor** dem Rückzug, setzt der Vorschauzweig `#5061`–`#5069` auf die aktuelle Position im damaligen Arbeitsrahmen (`#5420`–`#5428`) und `#5070 = 1`.
  - Die langsame Probe überschreibt das; mit `#3005 = 0` bleibt das Ergebnis der schnellen.
  - Nachfolgender NC-Code, der `#5063` oder `#5070` liest, sieht so das angenommene Ereignis und nicht alte Werte.
  - Nativ geprüft (8. Oktober 2026): Die Parameter lassen sich im Vorschau-Interpreter setzen, und `#5420`–`#5422` liefern die Position im Arbeitsrahmen (G54-Versatz eingerechnet).
  - Das ist ein **angenommenes Vorschauergebnis**, kein Nachweis einer Messung.
- **Länge:** `#<new_tool_length_offset> = L` (die Formel der Routine ergibt in diesem Bereich genau L). `G10 L1` schreibt denselben Wert, `G43 H` aktiviert ihn.

Gilt eine Bedingung nicht (VP102-03): Die Vorschau zeichnet die bekannte Positionierung bis zum **Start** des Tastsegments. Ab diesem G38-Segment gibt es keine Weg-, Zeit- oder Kollisionsaussage, weil der Taster schon vorher auslösen kann.
- **Gleiche Grenze überall:** Payload, Track und Sweep beginnen die Auslassung an derselben Stelle.
- **Benennung:** „probe not predicted (T13: …) — not checked from L…“ mit dem Grund.
- **Kein Ersatzpfad:** Es gibt keinen erfundenen G10/G43-Folgepfad, keine gezeichnete Suchhülle und keine Nachbildung der Fehler- und Wiederholbehandlung der Routine.

**4. Zustand und Abdeckung, wenn etwas unbekannt ist** (VP102-03).

| Abschnitt | Position | Angewandter Offset | Werkzeugkörper | Geprüft |
|---|---|---|---|---|
| Vor M600 | bekannt | wie bisher | altes Werkzeug | alle Paare |
| Ab M6, L bekannt | bekannt (G53-Fahrten) | G49 (0) | neues Werkzeug (Tabelle) | alle Paare |
| Ab M6, L unbekannt (≤ 0 / keine Zeile) | bekannt | G49 (0) | **unbekannt** | Maschinenpaare ja, Werkzeugpaare **nicht** |
| Ab dem **Start** einer nicht vorhergesagten Probe (Bedingung 1–4 verletzt) | **unbekannt** | danach aus unbekannter Messung | wie davor | **nichts**, bis Programmende |
| Späteres `G43` / `G43 H13` nach unbekannter Messung | unbekannt | Tabellenzeile T13 aus unbekannter Messung: **unbekannt** | — | nichts |
| Späteres `G49` | bleibt unbekannt (Programmrahmen aus unbekanntem Stand) | 0 | unbekannt | nichts |
| Wechsel auf ein anderes Werkzeug mit bekannter Zeile | bleibt unbekannt | — | bekannt | nichts |
| M600 ohne eingerichteten Toolsetter, mit unbekannten Toolsetter-Werten (Abschnitt 2), oder eine fremde M600-Remap | unbekannt (der Aufruf hätte Werkzeug und Zustand geändert) | unbekannt | unbekannt | **nichts**, bis Programmende |

Begründung für „bis Programmende“: Ein aus unbekanntem Ergebnis abgeleiteter Offset- oder Registerwert bleibt unbekannt, bis seine Ursache nachweislich ersetzt ist. Diese Fassung liefert keine gezielte Wiederzulassung, sondern eine konservative, dauerhaft benannte Auslassung, wie beim Offset aus unbekannter Position (VP-I53).

Die Maschinenpaare mit bekannter Position laufen beim unbekannten Werkzeugkörper weiter (Zeile 3). Ein unbekannter Körper darf eine bekannte Position nicht verschwinden lassen.

„Position bekannt“ gilt nur, soweit die vorhandenen Regeln es belegen. Bei `TOOL_CHANGE_POSITION` bleiben die unbekannten Achsen nach dem M6 bestehen (VP-I51). Eine absolute G53-Fahrt der Routine stellt den Endzustand ihrer Achsen wieder her, nicht rückwirkend ihren Anfang. Die Tabelle ersetzt diese Regeln nicht, sie setzt auf ihnen auf.

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

- **Maschinenpfad unverändert:** Ein Test vergleicht den `_task = 1`-Pfad der neuen Routine mit der bisherigen als **Kontrollstruktur**: einen o-Wort-Baum aus Bedingungen, Schleifen, Rücksprüngen und Anweisungen, nicht nur Text zwischen Markern.
- **Nativ** (`native_start_probe.py` mit der echten Routine als Unterdatei, Toolsetter-Basis gesetzt):
  - L bekannt: die Fahrten in Maschinenkoordinaten, der Auslösepunkt `#3102 + L`, M6 als Werkzeugwechsel, G43 mit L.
  - Je verletzte Bedingung aus Abschnitt 3 ein Fall: L ≤ 0, `#3102 > 0`, Auslösepunkt außerhalb des Tastwegs bei `#3007 = 1` (Codex' Fall), Kappung durch die Achsgrenze. `#3005 = 0` ist ein gültiger Fall mit einer Probe, keine Verletzung.
  - Unbekannte Länge mit Kontakt vor dem programmierten Ende und einem Hindernis erst dahinter: nichts ab dem Start der Probe geprüft, nichts dort gemeldet.
  - Probe-Ergebnisse: Codex' Verzweigung `o100 if [#5070 EQ 1]` und ein Folgeweg mit `#5063` nehmen den angenommenen Erfolg; ein früheres abweichendes Probe-Ergebnis zählt nicht; WCS/G92 und Kantentaster.
  - Kantentaster, Durchmesserversatz, `#3106` (Rückfahrt), `#3108` (ohne Wechselposition).
  - Geänderte #3009/#3013 bei unveränderten #3100–#3115. Die Kantentasternummer nur in der Probe-Sektion geändert.
- **Basis:**
  - gespeichert, aber nicht übernommen;
  - zwei Chunks, der zweite scheitert (die Schlüssel des ersten `applied`, die des zweiten `unknown`);
  - Abbruch nach dem ersten bestätigten Chunk;
  - Gateway-Neustart bei laufender Instanz (alles `assumed` bis zum Rücklesen);
  - ein gesendetes MDI, das `#3009` zuweist;
  - Neu-Parse nach einer Settings-Änderung bei laufendem Programm (die eingefrorene Basis bleibt).
- **Zustandstabelle:** je Zeile ein Payload → Track → Sweep. Darunter ein Hindernis zwischen M6 und G38 bei unbekannter Länge (Maschinenpaar gefunden, Werkzeugpaar benannt), G43 erneut für dasselbe unbekannte Werkzeug, G49, Wechsel auf ein bekanntes Werkzeug, fehlendes Setup mit weiteren Bewegungen.
- **Herkunft:** Marker ohne zugehöriges G43 (T0, RFL-Rücksprung) vervollständigt nichts; ein G43 außerhalb des Aufrufs ebenfalls nicht.
- **Live:** ein M600-Programm im Sim-Parity-Korpus. Im Sim gleicht die Tabellenlänge der physischen, weil der Sim-Taster sie auslöst.

## Reihenfolge

1. Gateway-Buchführung der Toolsetter-Basis, Worker setzt sie, Benennung.
2. Vorschauzweig der Routine mit Gültigkeitsbereich, Maschinenpfad-Test, native Fälle.
3. Zustandstabelle und Herkunft im Canon und im Sweep.
4. Payload → Track → Sweep; Korpus-Programm live.

## Antworten auf Codex R103

| Punkt | Antwort | Planänderung |
|---|---|---|
| VP102-01 Rest | Angenommen. Eine Teilübernahme ist weder die alte noch die neue Basis. | Abschnitt 2: Herkunft je Schlüssel (`applied` je Chunk, `read`, `assumed`, `unknown`); bestätigtes Rücklesen wie bei G30; Neustart und andere Schreiber machen `assumed`; `unknown` verhindert die Vorhersage. |
| VP102-03 Rest | Angenommen. Der Taster kann vor dem programmierten Ende auslösen. | Abschnitt 3 und Tabelle: Auslassung ab dem **Start** des Tastsegments, gleich in Payload, Track und Sweep; keine gezeichnete Suchhülle. |
| VP103-01 | Angenommen; nativ nachgeprüft. | Abschnitt 3: `#5061`–`#5069` aus `#5420`–`#5428` am Auslösepunkt vor dem Rückzug, `#5070 = 1`; langsame Probe überschreibt. |
| Hinweise | Übernommen. | Tabellenhinweis zu den Regeln aus VP-I51; Pfadvergleich als Kontrollstruktur; `#3005 = 0` als gültiger Fall. |

## Antworten auf Codex R102

| Punkt | Antwort | Planänderung |
|---|---|---|
| VP102-01 | Angenommen. Gespeichert ist nicht übernommen. | Abschnitt 2: vollständige Tabelle; Basis = übernommen oder Var-Datei vom Start, je Instanz gebucht, benannt; im Parse-Kontext und Cache-Schlüssel; Mittellauf eingefroren; keine Maschinenschreibzugriffe. |
| VP102-02 | Angenommen. | Abschnitt 3: vier Bedingungen inkl. Tastsegment und `#3102 ≤ 0`; außerhalb kein Folgepfad, benannt. |
| VP102-03 | Angenommen. | Abschnitt 4: Zustands- und Abdeckungstabelle; Werkzeugkörper unbekannt ab M6; konservativ bis Programmende. |
| VP102-04 | Angenommen. | Abschnitt 5: „from the table (assumed)“, „table updated“, „applied offset“; Marker nur mit dem G43 desselben Aufrufs. |
| VP102-05 | Angenommen. | Abschnitt 6: eigenes Folgepaket. |
| Antwort 1–3 | Übernommen. | Abschnitte 1, 5 und 4. |
