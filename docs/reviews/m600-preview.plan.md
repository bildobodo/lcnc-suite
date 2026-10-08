# M600 in der Vorschau — die Werkzeugmessung, die das Programm selbst ausführt

**Plan, Fassung 1 · 8. Oktober 2026 · Kollisionsplan Schritt 3 (Operator 2026-10-06).**
Noch kein Code; Planprüfung durch Codex vor der Umsetzung.

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

**1. Eine Vorschau-Variante in der Routine, gleiche Positionierung.**

- **Gleicher Code:** Die Positionierungsabschnitte (−70 bis −120: `G53 Z0`, Wechselposition, M6, Messposition mit Durchmesserversatz und Kantentaster, Startposition für G38) laufen in Vorschau und Maschine **identisch**. Die Wache wandert vom ganzen Rumpf auf die Stellen, die die Vorschau nicht nachbilden kann.
- **Probe ersetzt:** In der Vorschau (`#<_task> EQ 0`) ersetzt eine Fahrt zum **berechneten Auslösepunkt** beide Proben. Der Kontrollpunkt löst aus, wenn die Werkzeugspitze die Plattenhöhe erreicht: `G53 Z = #3102 + L` (L = Tabellenlänge des neuen Werkzeugs; beim Kantentaster zusätzlich `#3115`). Fast: Fahrt dorthin, Rückzug um `#3009`. Slow: wieder hin, Rückzug. Es gelten dieselben Vorschübe wie in der Maschine.
- **Länge:** Die berechnete Länge ist dann exakt L; `G10 L1` schreibt denselben Wert, `G43 H` aktiviert ihn.
- **Unverändert in der Maschine:** Der Pfad `_task EQ 1` bleibt Zeichen für Zeichen, wie er ist: echte Proben, Abbrüche, Pausen, M50, LOG. Ein Test vergleicht die Maschinenzweige vor und nach der Änderung (Textgleichheit des `_task EQ 1`-Pfads).
- **Ohne Vorschau-Ersatz bleiben:** Abbruchprüfungen (`#5070`), Wiederholschleife bei Fehlschlag, M00/M01, M50, LOG laufen in der Vorschau nicht.

**2. Unbekannte Länge sagt die Vorschau, statt sie zu raten.**

- **Unbekannt:** Ist die Tabellenlänge des neuen Werkzeugs ≤ 0 oder fehlt die Zeile, kennt die Vorschau den Auslösepunkt nicht. Die Maschine tastet dann ab `#3010` (Spindelnase).
- **Vorschau in diesem Fall:** Die Fahrten bis zur Startposition für G38 sind bekannt. Der Probenweg und alles danach, was von der Länge abhängt, ist unbekannt. Die Routine setzt dann den Marker-Kommentar `(WEBUI_TOOLLEN_UNKNOWN)`. Der Canon setzt die Werkzeuglänge als unbekannt; die Bewegungen danach werden wie ein unbekannter Start benannt und nicht geprüft (Frage 3).
- **Bekannt:** Die Routine setzt `(WEBUI_TOOLLEN_TABLE)`. Der Wert kommt über ihr abschließendes `G43 H` als TLO-Ereignis (`tool_offset`) an. Der Sim-Tab zeigt die Basis: „T13 = 65.04 mm from the table“.
- **Kanal, gemessen** (8. Oktober 2026, Vorschau-Canon mit protokollierendem `message`):
  - `(DEBUG, …)` und `(MSG, …)` erreichen den Vorschau-Canon **nicht**, auch nicht aus einer Unterdatei.
  - `(PRINT, …)` schreibt auf die Standardausgabe des Interpreters, also in den Payload-Kanal des Workers: verboten.
  - Reine Kommentare erreichen `comment` in Ausführungsreihenfolge, so wie die `WEBUI_SUB`-Marker. Sie tragen aber keine ausgewerteten Parameter, deshalb sind die Marker wertlos und der Wert kommt aus dem G43.

**3. Die Parameter, mit denen die Vorschau misst.**

- **Quelle:** Die Vorschau liest die Var-Datei zur Parse-Zeit. Die WebUI setzt die Toolsetter-Werte aber mit jeder Messung per MDI (`vars`, Review R16). Die Datei hinkt dem Interpreter nach, bis Task synchronisiert.
- **Vorschlag:** Der Worker bekommt die vom Server bestätigte Toolsetter-Sektion (`confirmedSection`, dieselbe Quelle wie jede M600 der WebUI) und setzt `#3100`–`#3115` in der Vorschau. Ist die Sektion nicht vollständig eingerichtet (`toolsetterSetup.ts`), meldet die Vorschau „Toolsetter not set up — M600 motion not previewed“ und behandelt M600 wie heute, aber benannt.

**4. Nach der echten Messung im Lauf.**

- **Heute:** Die Mittellauf-Neuberechnung (`midrun_table_gate_open`, angeheftete Parse) veröffentlicht nach einer Tabellenänderung einen neuen Payload. Der Sweep wird während des Laufs angehalten und startet erst im Stillstand (`_colHeldByRun`).
- **Neu:** Nach einer Veröffentlichung im Lauf prüft der Sweep den **Rest des Programms ab der aktuellen Zeile**: ein Seitenlauf über den Track-Abschnitt ab der laufenden Position, Ergebnis als Vorausschau („next clash → L…“). Die Basisanzeige wechselt auf „T13 = 64.98 mm measured“.

**5. Was gleich bleibt.**

- Run-from-line-Wache (`#3116`), `M600`-Wrapper der 5-Achs-Konfiguration (Kinematik speichern und wiederherstellen), die Werkzeugwechselposition (`TOOL_CHANGE_POSITION`, Unbekannt-Regel).
- Im Pfad `_task EQ 1` ändert sich nichts.

## Prüfungen

- **Nativ** (`native_start_probe.py` mit der echten Routine als Unterdatei):
  - `T2 M600` mit bekannter Länge: die Fahrten der Routine in Maschinenkoordinaten, der Auslösepunkt `#3102 + L`, M6 als Werkzeugwechsel-Ereignis, G43 mit L.
  - Unbekannte Länge: Markierung, die Bewegungen danach benannt.
  - Kantentaster, Durchmesserversatz, `#3106` (Rückfahrt), `#3108` (ohne Wechselposition).
- **Payload → Track → Sweep:** die Fahrt zum Taster wird geprüft (ein Hindernis auf dem Weg wird gefunden), der Werkzeugkörper nach M600 ist der neue.
- **Textgleichheit** des Maschinenpfads der Routine gegen den bisherigen Stand.
- **Live:** ein M600-Programm im Sim-Parity-Korpus (`scripts/parity_corpus`); die Vorschau muss den echten Lauf bis zum Auslösepunkt nachzeichnen (Toleranz wie im Korpus; der Unterschied am Auslösepunkt ist die tatsächliche gegen die Tabellenlänge — im Sim gleich, weil der Sim-Taster die Tabellenlänge auslöst).

## Fragen an Codex

1. Ist die Vorschau-Variante **in** der gebündelten Routine der richtige Ort, oder soll der Worker die Routine durch eine eigene Vorschau-Datei ersetzen (z. B. per `SUBROUTINE_PATH` im temporären Arbeitsordner)?
2. Reicht die Kombination aus wertlosem Marker-Kommentar und dem Wert aus dem abschließenden `G43 H` (gemessen: DEBUG/MSG erreichen den Vorschau-Canon nicht), oder siehst du einen Fall, in dem das G43-Ereignis nicht die gemessene Länge trägt (z. B. Kantentaster mit `#3115`)?
3. Soll eine unbekannte Länge die Bewegungen danach **bis zum Programmende** unbekannt machen (wie ein aus unbekannter Position gesetzter Offset), oder bis zu einem späteren `G43` mit bekannter Länge?

## Reihenfolge

1. Var-Parameter in der Vorschau setzen (Kanal bereits gemessen).
2. Vorschau-Variante der Routine, Textgleichheit des Maschinenpfads, native Fälle.
3. Unbekannte Länge, Basis im Sim-Tab.
4. Payload → Track → Sweep; Korpus-Programm live.
5. Rest des Programms nach der echten Messung im Lauf.
