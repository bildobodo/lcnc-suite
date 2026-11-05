## Claude · Antwort auf R308 · Anfrage R309 · 5. November 2026

Zwei Pläne, nichts gebaut. **Teil A** ist P2 in Planfassung 2 mit FI308-01 bis FI308-04 und dem nativen Rot-Nachweis. **Teil B** ist der Plan für 2c-b.

**Zur Eingrenzung aus R308:**
- `m600-unload` prüft T0, den entfernten Versatz und die bestätigten Werkzeuganforderungen, **nicht** die G30-Endlage. Mein Satz „getrennt gegen seinen G30-Vertrag bewertet“ ging zu weit.
- `m600-t1-return` ist ein Endlagen-Nachweis. Dass kein eigener Z-Abstieg mehr stattfindet, belegt der in R307 geprüfte Routinecode, keine Wegmessung.

**Die LAN-Sim** läuft seit 21:48 auf `3e4f7c80`, umgestellt mit derselben Aufnahme und Rückgabe wie der native Lauf: `complete`, Isolation leer. Sie hat damit die neue Routine für den Blick des Operators. Der Merge der M600-Korrektur nach `development` wartet auf diesen Blick.

### Teil A · P2, Planfassung 2

**Der native Rot-Fall, vor dem Bau** ([function-inventory.r309.p2-red.json](function-inventory.r309.p2-red.json), Skript [.py](function-inventory.r309.p2-red.py)). Eigene 3-Achs-Kopie über `run()`, Stand `3e4f7c80`, Rückgabe `complete`, Isolation leer.

| Schritt | Ergebnis |
|---|---|
| Interpreter nach dem Referenzieren (DEBUG) | `#3102 = −180`, `#3106 = 1`, T1-Tabelle 50,0 |
| Maschine aus; **vollständige** Taster-Sektion gespeichert, alle 23 Felder aus den Interpreterwerten, `touchZ = −179` | gespeichert; kein Formular, also auch kein Nachsenden |
| Maschine ein (DEBUG) | Interpreter **hält −180** |
| Programm `G21 G90 / T1 M600 / M2` per Cycle Start | gemessen **49,995217 mm**: gegen −180, nicht gegen die gespeicherten −179 (dann rund 48,995) |

**A-1 · Was abgeglichen wird:**
- die vom Server bestätigte Taster-Sektion der aktuellen INI, geprüft nach der Einrichtungsregel;
- nur die 23 Taster-Nummern (#3004–#3013, #3100–#3115). Nicht #3014 und die übrigen Antastparameter, nicht frei angegebene MDI- oder Probing-Werte.

Abbildung und Regel (Pflichtfelder, Bereiche aus `probeFields`, Optionswerte, fehlende Sektion) bekommt das Gateway in Python. Ein Vertragstest gleicht sie mit `toolsetterSetup.ts` ab.

**A-2 · Wann, zu FI308-01:**
- Der Abgleich ist eine **eigene** Voraussetzung jedes Programmstarts aus Idle, unabhängig vom Skip-Flag. Das sind Cycle Start, der erste `auto_step` aus Idle und `auto_run` mit und ohne Vormessung oder Einfahrt.
- Er läuft nach `_start_guard(..., program=True)` und vor dem Wechsel nach AUTO, in derselben Befehlssequenz.
- Es wird **immer** geschrieben, auch wenn die Buchung schon gleich wäre. Der Aufwand ist eine MDI in zwei Blöcken.
- Kein Abgleich: pausierter Step und Resume, MDI, Makro, Werkzeugwechsel. Ein gewöhnliches MDI schreibt nie nebenbei gespeicherte Taster-Werte.
- **Ist die Sektion nicht eingerichtet,** wird nichts geschrieben, der Start läuft wie heute, und die Anzeige sagt „kein Abgleich“.
- **Ist sie eingerichtet und die Übernahme nicht vollständig bestätigt** (ein Block nicht `RCS_DONE`, Abbruch, Zeitüberlauf), wird der Start verweigert: „Toolsetter values not taken — nothing started“. Es gibt keinen AUTO-Wechsel.
- Die bestehenden Prüfungen am Moduswechsel und am Schreiben bleiben, ebenso die Abbruchwirkung.

**A-3 · Eine Basis pro Start, zu FI308-02:**
- **Auswahl:** Der Handler wählt die Basis **einmal**, bei der Zulassung des Starts: die Sektion und die Fassung der Settings-Ablage, unter deren Sperre gelesen.
- **Keine fremde Basis:** Vormessung und Programmstart verwenden dieselbe Basis.
  - Die Taster-Schlüssel der `probe_vars` im `auto_run` müssen ihr nach der Rundung auf sechs Stellen gleichen. Sonst lehnt der Start **vor jeder Wirkung** ab: „Toolsetter values changed — confirm Run from line again“.
  - Die Client-Basis überschreibt die Serverbasis nie nachträglich.
- **Bindung bis zum Schreiben:** Unmittelbar vor jedem schreibenden Block prüft eine Zulassung (der vorhandene `admit`-Weg), dass die Sektion noch dieselbe Fassung hat. Hat sich die Fassung geändert, lehnt der Start ab: „Toolsetter settings changed meanwhile — start again“.
- **Zwei Fälle getrennt:** Eine fehlende oder ungültige Sektion bedeutet „kein Abgleich“. Eine gültige Sektion, die nicht übernommen wurde, bedeutet Ablehnung.
- **Beleg:** Der Start schreibt die ausgewählten Werte und ihre Herkunft (Fassung) in Antwort und Trace.

**A-4 · Übernahme und Persistenz, zu FI308-03:**
- **Eine kanonische Zahl:** die gesendete, also die MDI-Zeichenkette auf sechs Stellen. Sie gilt für Buchung, Vergleich und Datei. Ein ungerundeter Wunsch heißt nie „exakt übernommen“.
- **Reihenfolge:**
  - Zuerst die MDI-Blöcke, je Block gebucht wie heute (`applied` bzw. `unknown`; keine Rückabwicklung durch ein einzelnes `false`).
  - **Danach** schreibt die Datei nur die Schlüssel der übernommenen Blöcke, mit ihren gesendeten Werten.
  - Ohne übernommenen Block gibt es kein Dateischreiben. Der alte Gegenfall `file_saved: true, mdi_set: false` ist damit durch die Konstruktion ausgeschlossen und bleibt als Gegenfall benannt.
- **Ergebnisse getrennt:**
  - `mdi_set`: alle Blöcke übernommen;
  - `applied_keys`: die Schlüssel der übernommenen Blöcke;
  - `persisted`: die Datei für genau diese Schlüssel geschrieben.
  - Ein Dateifehler nach der Übernahme ergibt „übernommen, Persistenz nicht bestätigt“. Den Übernahmestand ändert er nicht.
- **Der Start:** Er verlangt `mdi_set`. Ein Dateifehler hält ihn nicht auf; der Interpreter hat die Werte, LinuxCNC speichert sie bei `synch` und beim Beenden, und Antwort sowie Trace nennen den Fehler.
- **Unverändert:** die Sperrreihenfolge (`_cmd_lock`, dann `_var_file_lock`) und das Abwarten begonnener Schreibthreads bei Abbruch.
- **Reichweite:** Der Start stellt nur die Taster-Basis wieder her, nicht #3014 und die anderen Werte dieses Helfers.

**A-5 · Der Stand im Formular, zu FI308-04:**
- **Die Quelle:** Das Gateway veröffentlicht im Status seine **Taster-Buchung** (`_ts_basis`): je Schlüssel Wert und Herkunft (`applied` / `assumed` / `unknown`), dazu die Fassung, aus der zuletzt übernommen wurde. Das Formular leitet seinen Stand aus zwei Serverdaten ab, der bestätigten Sektion und dieser Buchung. Es leitet ihn nicht aus einer Antwort und nicht aus einer lokalen Warteliste ab.
- **Die Zustände:**
  - „Saved — not yet in the machine (applied at the next program start or measurement)“: Sektion eingerichtet, die Buchung weicht ab.
  - „In the machine“: alle 23 Schlüssel `applied` mit den gerundeten Werten der Sektion.
  - „Not known“: keine Buchung.
  - „Not set up — nothing is applied“.
  - „Save failed“.
- **Was das sichert:** Eine späte Antwort auf Wert A nach dem Speichern von B ändert nichts, denn A ≠ B. Reconnect, Schließen und Wiederöffnen verlieren keine Kenntnis. Eine Übernahme durch Cycle Start bei geschlossenem Formular zeigt sich beim nächsten Öffnen.
- **Nachsenden** beim Bereitwerden nur als Komfort: bei offenem Formular, eingerichteter Sektion, abweichender Buchung, mit dem vorhandenen Gate. Nach einer Ablehnung kommt kein erneuter Versuch, bis sich Sektion oder Bereitschaft ändern. Dein Gegenvorschlag, zuerst Abgleich und Anzeige zu bauen, ist die Reihenfolge des Baus. Das Nachsenden bleibt nur, wenn es einen sofortigen Nutzen zeigt, etwa „Measure Current“ ohne vorherigen Start.

**A-6 · `get_probe_vars` entfernen:** Handler, Policy-Liste, TypeScript-Befehlsform, `commandShapes`/`commandPath`-Tests, Inventar (Atom und Funktion) und README `:737` zusammen. Ein alter Aufruf bekommt die vorhandene Antwort für unbekannte Befehle. In `decisions.md` steht die Entfernung als Protokolländerung.

**A-7 · Wächter, zuerst rot:**
- **Gateway-Unit:**
  - die Startmatrix (Cycle Start, erster Step aus Idle, `auto_run` ohne und mit Vormessung und mit Einfahrt);
  - pausierter Step/Resume ohne zusätzliche MDI; MDI, Makro und Werkzeugwechsel ohne Taster-Schreiben;
  - zwei Starts mit einer gespeicherten Änderung dazwischen, das Flag bekannt gelöscht;
  - Client A gegen Server B im `auto_run`;
  - eine Änderung zwischen Auswahl und Schreiben;
  - eine eingerichtete Sektion mit fehlgeschlagenem zweitem Block (Fehler, Zeitüberlauf, Abbruch);
  - eine fehlende Sektion ohne Nullwert-Schreiben;
  - eine Zahl mit mehr als sechs Stellen;
  - ein Dateifehler nach der Übernahme;
  - eine verweigerte erste MDI ohne Dateischreiben.
- **Vertragstest Python ↔ TypeScript** für Regel und Abbildung.
- **Browser:**
  - die Zustände aus Sektion und Buchung;
  - eine späte Antwort A nach B;
  - Reconnect mit ausstehender Übernahme, Schließen und Öffnen;
  - Übernahme durch Cycle Start bei geschlossenem Formular;
  - nicht eingerichtet, Speichern fehlgeschlagen.
- **Nativ:** der Rot-Fall oben als fester Fall der Stufe (`toolsetter-sync-program-m600`). Er misst nach dem Bau gegen −179 (rund 48,995) und belegt die Basis im Trace. Die Persistenz nach `synch` wird über den bestätigten G30-/Taster-Synch-Lesevertrag geprüft.

### Teil B · 2c-b, der Startpunkt aus der Servo-Aufzeichnung

**Grundlage:** `servo-rfl.jsonl` aus Lauf 9 (`20261105T212704`, `3e4f7c80`), 50 356 Abtastungen von n 300 170 bis 350 525, lückenlos. Der Abschnitt reicht vom `auto_run` bis zum Programmende. Kanäle: `pos-fb` X/Y/Z, `vel-cmd` X/Y/Z, `motion.program-line`, `motion.in-position`, die Marke.

**Gemessene Bedeutung von `motion.program-line`:** Es ist die Zeile des Segments, das der Bahnplaner gerade ausführt.

| Phase | program-line | Weg (Gelenk) |
|---|---|---|
| Vormessung `T1 M600` (MDI, Routinendatei) | Zeilen der Routine, 308 … 601, dazwischen 0 | Taster, Messung, Freifahren, X/Y zurück |
| Einfahrt `G0 X100 Y100` (MDI) | 0 | (0, 0, 0) → (100, 100, 0) |
| Zeile 7 `G1 X200` | 7 | ab n 345 641 bei (100,000, 100,000, 0,000), nur X |
| Zeile 8 `G1 Y200` | 8 | Y; X endet im Überschleif 199,995 → 200,000 |
| Zeile 9 `G0 Z-80` | 9 | Z 0 → −30 |
| Programmende | 0 | Ruhe |

Daraus folgen drei Regeln:
- Ein MDI-Satz der Einfahrt zeigt 0.
- Eine Routine zeigt ihre eigenen Dateizeilen.
- Die erste Abtastung einer Zeile kann im Überschleif schon während der vorigen Bewegung liegen. Ihre **Achsen** beginnen dort; die Achsen der vorigen Zeile laufen höchstens im Überschleif nach.

**Der Auswerter `rfl-start-point`** urteilt an jeder Abtastung des Abschnitts, nur aus bekannten Werten.

**FAIL bei einem bekannten Widerspruch:**
1. **Eine frühere Zeile:** eine Abtastung mit `program-line` zwischen 1 und L−1 nach dem `auto_run`. Programmzeilen und Routinenzeilen lassen sich an der Phase trennen: Die Vormessung endet vor der Einfahrt (Phasenverlauf `measuring` → `positioning` → `running`). Gewertet werden nur Abtastungen nach der letzten Abtastung der Vormessung.
2. **Ein Abstieg vor Zeile L:** Z bekannt unter der sicheren Höhe (Gelenk-Z ≥ −0,010) zwischen dem Ende der Vormessung und der ersten Abtastung von Zeile L.
3. **Der Start nicht an der Einfahrt:** Die erste Abtastung von Zeile L liegt bekannt mehr als 0,010 von (X, Y) der Einfahrt oder von der sicheren Höhe entfernt.
4. **Eine Bewegung zwischen Einfahrt und Start:** Nach der letzten Bewegung der Einfahrt bewegt sich vor Zeile L eine Achse bekannt (`vel-cmd` ≠ 0 oder Lage > 0,001 von der Ruhelage).
5. **Zeile L bewegt eine fremde Achse:** Y oder Z bekannt außerhalb von 0,010 um ihren Startwert, solange `program-line` = L ist. Die Überschleif-Toleranz gilt nur für die Achsen der **vorigen** Zeile am Übergang; Zeile L ist die erste und hat keine vorige.

**`incomplete`:**
- ein Mangel im Abschnitt (die Integrität aus 2c);
- keine Abtastung von Zeile L;
- eine ungelesene Lage an der Startstelle;
- keine erkennbare Ruhe nach der Einfahrt.

**PASS:** keine der Bedingungen, Start an der Einfahrt, in Ruhe davor, nur X in Zeile L.

**Selbstprüfung der Bedeutung:** Im selben Strom bewegt Zeile L+1 nur Y, abgesehen vom Überschleif-Rest der X-Achse höchstens 0,05 mm vor ihrem Ziel, und Zeile L+2 nur Z. Weicht das ab, ist `incomplete` mit „program-line nicht wie erwartet“ angebracht. Es ist kein FAIL des Starts, denn dann trägt die Zuordnung nicht.

**Gegenfälle als Wächter, zuerst rot gegen einen Auswerter, der immer PASS sagt:**
- Zeile 6 bewegt sich zuerst;
- Z sinkt vor Zeile 7 auf −20;
- Zeile 7 startet bei X 99,5;
- eine Bewegung zwischen Einfahrt und Start (Wiederanlauf);
- Zeile 7 bewegt Z;
- eine Nummernlücke an der Startstelle;
- `program-line` springt nie auf 7;
- ein Strom, in dem Zeile 8 X um 2 mm bewegt (die Selbstprüfung).

**Gegenprobe im Lauf:** derselbe Strom gegen eine Einfahrt 1 mm versetzt in X (`rfl-start-point.counter-entry-x+1`), nach dem Muster der anderen Gegenproben.

**F-RFL.S3:** Die Lücke „2c-b“ fällt weg. Die Aussage bindet `rfl-start-point` und die Gegenprobe.

**Erbeten:** `agreement` oder `findings` zu beiden Plänen. Gebaut wird erst danach; Teil A und Teil B kommen in eigenen Runden.
