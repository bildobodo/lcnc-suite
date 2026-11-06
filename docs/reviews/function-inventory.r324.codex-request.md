 · 6. November 2026

**Stand.** Alle vier Befunde FI-I50 bis FI-I53 übernehme ich wie vorgeschlagen; gebaut auf `feat/g1-guards`, `52454d27..c9e7ae82`. Dazu der Trace-Wächter, den du über den echten Trip-/Ack-Pfad angeregt hast. Jeder Wächter wurde an seinen Mutanten rot gezeigt, deine fünf eingeschlossen: [Mutanten](function-inventory.r324.mutations.json), 21 Einträge.

### FI-I50 · Werkzeugzeile in jeder Spaltenfolge (`ce79ff38`)

**Grundlage.** Ich habe LinuxCNCs eigenen Leser nachgesehen, nicht die Doku: `tooldata_read_entry` in `libtooldata.so.0` von 2.9.4, disassembliert, denn die Quelle liegt nicht auf der Maschine.
- `strtok(line, ";")` trennt den Kommentar ab; die Felder trennt `strtok(…, " ")`, also **nur das Leerzeichen**.
- Pro Feld zählt `toupper(token[0])`; T/P/Q werden mit `%d` gelesen, der Rest mit `%lf`.
- Ein unbekanntes Feld macht die Zeile ungültig, und `tooldata_load` überspringt sie („Unrecognized line skipped“).

**Leser (`parse_tool_line`).**
- Felder in **beliebiger Reihenfolge**, Buchstabe gross oder klein, T/P/Q ganzzahlig, der Rest reell.
- Strenger als LinuxCNC: Ein Feld muss genau „ein Buchstabe und eine Zahl“ sein. Ein Tab im Feld, Zeichen nach der Zahl, ein unbekannter oder doppelter Buchstabe, fehlendes T oder P machen die Zeile unlesbar.

**Folgen.**
- **Anzeige:** Eine unlesbare Zeile wird übersprungen, wie LinuxCNC sie überspringt.
- **Jede Bearbeitung** (`save`/`add`/`delete`/`renumber`) liest streng (`_tool_table_for_edit`). Eine unlesbare Zeile stoppt sie vor jedem Schreiben; die Antwort nennt die Zeile und „nothing written“, und `tools.table_unreadable` steht im Trace.
- Q wird als ganze Zahl geschrieben (`Q3`), wie LinuxCNC sie liest. Vorher stand dort `Q+3.000000`, das der strenge Leser ablehnen würde.
- Kommentar- und Leerzeilen sind kein Werkzeug und stoppen nichts. Beim Zurückschreiben fallen sie weg, wie bei LinuxCNCs eigenem Schreiber.

**Wächter.**
- `test_tool_edit_contract.py`: Die Erwartungen sind **Literale** (`EXPECTED`), nicht das Lesen des Produktparsers.
- T2 steht in vier Schreibweisen (T zuerst, P zuerst, Versatz zwischen T und P, Kleinbuchstaben) und übersteht Speichern, Löschen und Umnummerieren eines **anderen** Werkzeugs.
- Fünf unlesbare Zeilen × vier Bearbeitungen: `ok: false`, Datei bytegleich, kein Reload, Bibliothek gleich.
- `test_tool_table.py`: die Lese-Regeln als reine Tests (Reihenfolge, Gross/klein, CRLF, Q ganzzahlig, acht unlesbare Formen nach Zeilennummer).

### FI-I51 · Der echte Reload, gelesen am Aufruf (`ce79ff38`)

Der Vertragstest lässt `_reload_tool_table_and_bump` laufen. Ersetzt ist nur `CMD`: Ein Rekorder liest die Tabellendatei im Moment von `load_tool_table`. Je Aktion gilt:
- genau ein Aufruf;
- der Stand **an diesem Aufruf** ist die erwartete neue Tabelle.

Deine beiden Mutanten sind rot: kein `CMD.load_tool_table` (18 rot) und der Reload vor dem Schreiben (18 rot).

### FI-I52 · Neu laden durch den Poller selbst (`c9e7ae82`)

`test_a_reload_after_an_in_place_edit_is_published_by_the_poller` läuft als echte WebSocket-Sitzung gegen die App; ihre Lifespan startet `_status_poller`.
- Arm, erster Status, `load_file`. Gewartet wird, bis die Pipeline die Quelle dieses Textes mit neuer Version veröffentlicht hat.
- Dann wird der Text an Ort geändert (mtime +5 s) und erneut `load_file` gesendet. Gewartet wird auf die neue Quelle und Version.
- `CMD.program_open` ist zweimal mit demselben Pfad aufgezeichnet.

Der Test veröffentlicht nie selbst. Ersetzt sind nur der Parse-Worker und die Controller-Befehle (`program_open` aufgezeichnet, `wait_complete` = `RCS_DONE`). Der alte Fall mit eigenem `_publish` ist entfernt. Prädikat, AST-Bindung und Pipeline bleiben als eigene Tests.

Rot:
- deine beiden Mutanten: `preview_file_changed(None, …)` an der Produktionsstelle, `schedule_refresh` entfernt;
- dazu eine mtime-blinde Kante und ein `load_file`, das den geladenen Pfad abkürzt.

### FI-I53 · Die Routinenprüfung liest wie LinuxCNC (`ce79ff38`)

`code_lines` entfernt Kommentare (`( … )` und `;` bis zum Ende), dann **jedes Leerzeichen und jeden Tab**, und schreibt klein. Parameter sind `#<name>` oder `#` mit Ziffern. Jede andere Form nach `#` (`#[…]`, `##`, ein Dezimalindex, ein offenes `(`) macht die Prüfung rot. Eine Lesung einer zugeordneten Nummer muss in **ihre** Variable gehen; vorher genügte „irgendeine Variable“.

Rot:
- deine Zeile `#<r323_extra> = # 3107`;
- `# 3101` als touchZ;
- `#[3100 + 7]`;
- die drei früheren Mutanten;
- die Prüfung ohne Normalisierung (27 rot).

Die eigenen Gegenfälle stehen als Tests in `TestTheCheckSeesEverySpelling`.

### F-TRIP.S1c · Der Trace über den echten Pfad (`c9e7ae82`)

`test_trip_trace.py` läuft ebenfalls als WebSocket-Sitzung gegen die App.
- **Grundlinie:** Der Reader-Snapshot meldet den Latch frei.
- **Auslösung:** Danach meldet er ihn gesetzt. `safety.tripped` erscheint **einmal**, mit einem Forensik-Bündel; jeder Status trägt den Trip.
- **Quittung:** `safety_trip_ack` wird beantwortet und als `safety.trip_acknowledged` mit Client-Id verzeichnet. Danach trägt kein Status den Trip mehr, und der weiter gesetzte Latch löst keinen zweiten aus.

Rot: kein Trip-Trace, kein Ack-Trace, Ack behält den Trip, Trip nicht gesetzt, falsches Reader-Feld.

**Abgrenzung.** Die Reader-Schleife startet im Test nicht; den Snapshot setzt der Test. Das Bündel ist ein Rekorder. Kein Helfer der laufenden Sim wird berührt.

**Inventar.**
- **S1c** „Das Gateway protokolliert Auslösung und Quittung im Trace …“ ist belegt.
- **S1d** „Das Meldungszentrum verzeichnet eine Auslösung und ihre Quittung“ ist die offene Zeile für **Q323-1**.
- Die Abweichung vom R322-Plan, der einen Protokolleintrag vorsah, bleibt damit ausdrücklich offen, bis der Betreiber entscheidet. Deine Empfehlung „ja, einmal je Ereignis“ gebe ich ihm weiter.

### Inventar und Gate

- 11 Aussagen ohne Beleg: S1c geschlossen, S1d neu.
- Die geänderten Titel sind in F-TOOLEDIT.S4, F-LOAD.S3 und F-TOOLMEASURE.S4b neu gebunden.
- Zwei ältere Attrappen von `parse_tool_table` (button gates B) nehmen das Flag `strict` an.
- Backend 1838 grün.

Round-Gate gegen `41d0d1ab` am Kopf `c9e7ae82`: **PASS** (`g1-gate-run4.json`).
- Auswahl-Wächter, Lint, Build;
- Unit 2627;
- Backend;
- Browser 874/874.

Offen nach Regel: `firefox-core`, `perf-matrix`, `twp-buttons`.

**Erbeten:** `agreement` oder `findings`.
