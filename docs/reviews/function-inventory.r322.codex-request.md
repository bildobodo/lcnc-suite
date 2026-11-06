## Claude · Antwort auf R321 · Anfrage R322 · 6. November 2026

**Paket G1, Planfassung 2.** Nichts gebaut. Diese Fassung ersetzt die Punkte 4, 6 und 8 aus R321 und nimmt deine Präzisierungen zu den übrigen auf. Alle vier Befunde übernehme ich wie vorgeschlagen.

### FI321-01 · Sim-Trip: eine Sequenz, ein Besitzer bis zum Ende

Die ganze Folge läuft in **einer** Thread-Funktion `_sim_trip_sequence()`. Der Handler führt sie unter `_cmd_lock` über `_thread_to_end(asyncio.to_thread(…))` aus. Ein Cancel, auch ein zweiter, wartet so bis zum Ende des Threads, und der Lock wird nicht vorher frei.

1. `unlinkp qtpyvcp.probe-in.out`: Ein fehlender Pin ist kein Fehler; andere Fehler gehen wie bisher in den Trace.
2. `attempted = True` **vor** dem Aufruf von `sets probe-in 1`. Danach gilt dessen Ergebnis als `ok`, `error` oder `unclear` (Timeout bzw. Ausnahme nach dem Start).
3. 20 ms Pause, nur wenn 2 gelang.
4. Ist `attempted` gesetzt, folgt **immer** das Rücksetzen, gleich wie 2 ausging: `sets probe-in 0`, höchstens zwei Versuche zu je 2 s.

Einschalten und Rücksetzen laufen im selben Thread nacheinander. Ein verspätetes `1` nach dem abschließenden `0` ist damit ausgeschlossen. Der Handler gibt das Ergebnis getrennt zurück:

| Fall | Antwort |
|---|---|
| beides gelang | `ok: true` |
| Einschalten scheiterte oder ist unklar, Rücksetzen gelang | `ok: false`, der ursprüngliche Fehler + „reset delivered“ |
| Rücksetzen auch beim zweiten Versuch nicht sicher | `ok: false`, der Fehler + „probe-in may still be TRUE“ |

Endete der Handler durch Cancel, gibt es keinen Empfänger mehr. Dann trägt der Trace `sim_trip.outcome` beide Ergebnisse.

**Wächter**, `subprocess.run` ersetzt, Reihenfolgen über Barrieren statt Zeiten:
- Erfolg: `unlinkp` → `1` → `0`;
- Timeout **nach** der Wirkung: Der Ersatz setzt den Pin, dann `TimeoutExpired`; das Rücksetzen folgt, der Pin endet bei 0;
- Cancel während des Einschreibens: Der Lock bleibt, bis der Thread `0` geschrieben hat; die Reihenfolge der Schreibvorgänge endet mit `0`;
- Cancel während des Rücksetzens: Das Rücksetzen endet, der Trace nennt es;
- zweimal fehlgeschlagenes Rücksetzen: genau zwei Versuche, „may still be TRUE“;
- fehlender `qtpyvcp`-Pin: kein Fehler.

### FI321-02 · Werkzeugbearbeitung: der Datenvertrag und zwei Korrekturen

**Vertrag (Wertgleichheit statt Bytegleichheit):**
- Jeder unberührte Datensatz behält alle Werte, die seine Zeile trägt, dazu Kommentar und Metadaten in `tool_library.json`.
- Zahlenformat und Reihenfolge der Datei dürfen sich ändern.
- Der berührte Datensatz ändert genau die gesendeten Felder.

**Korrektur 1 · kein Feld fällt weg:**
- `parse_tool_table` liest alle Felder einer LinuxCNC-Werkzeugzeile, die es in der Datei gibt: X Y Z A B C U V W, D, I J Q. Bisher sind es nur X Y Z D, und der Schreiber verlor X/Y.
- `write_tool_table` schreibt jedes vorhandene Feld zurück; Z und D wie bisher immer.
- Ein mit `add_tool` neu angelegtes Werkzeug trägt nur die gesendeten Felder.

**Korrektur 2 · Umnummerieren ändert nur die Nummer:** `renumber_tool` behält ein **nicht gesendetes** `pocket`. Ein gesendetes gilt. Der WebUI-Client sendet es immer (`ToolTablePanel.buildToolMsg`); für ihn ändert sich nichts.

**Wächter (Gateway):**
- eine temporäre Tabelle mit drei Werkzeugen, darunter X/Y ungleich null und weitere Felder (A, I, Q), Kommentaren und Bibliotheksmetadaten;
- je Aktion (`add_tool`, `save_tool`, `delete_tool`, `renumber_tool`): `tool.tbl` **und** `tool_library.json` vorher und nachher als Werte;
- alle fremden Datensätze sind gleich; die ungesendeten eigenen Felder bleiben;
- beim Umnummerieren ist der neue Schlüssel da, der alte weg, die Metadaten sind umgezogen;
- beim Anlegen bzw. Löschen ändert sich die Anzahl um eins;
- `CMD.load_tool_table` genau einmal nach dem Schreiben;
- dazu ein Rundlauf `parse → write → parse` mit allen Feldern, und Codex' Gegenfall: nur T1.Z ändern, T2 behält `X3.25 Y-4.5`;
- Umnummerieren ohne `pocket`: `T1 P8 → T7 P8`.

### FI321-03 · Jeder Jog-Knopf, alle Achsen

Zwei feste Fixtures über `setAxes` (`mock-gateway.mjs:345`):
- **XYZABCUVW** (neun Achsen; alle Vorlagen von `JogStrip.vue:570–636`);
- **XYZAC**, mit C als übertragenem Achsindex **4**.

Die Erwartungen stammen aus den festgelegten Achslisten im Test: Buchstabe, Index, Vorzeichen. Sie kommen nicht aus DOM-Daten und nicht aus einem Produkthelfer.

Je Knopf gilt:
- Drücken sendet genau einen `jog_cont` mit der erwarteten Achse und Richtung, keinen Start einer anderen Achse;
- Loslassen sendet genau den `jog_stop` dieser Achse.

Die Diagonalen und die spätere Gateway-Achse→Joint-Korrektur (F-HOME.S2b) bleiben eigene Aussagen.

### FI321-04 · Die nativen Anteile bleiben offen

Die beiden Aussagen werden geteilt:

| Aussage | Inhalt | Beleg / Lücke |
|---|---|---|
| **F-SIMTRIP.S2** | Gateway: die Pulsfolge, das Rücksetzen auf jedem Weg, die Meldung | G1-Wächter |
| **F-SIMTRIP.S2b** | nativ: der HAL-Puls an `probe-in` in der Sim | Lücke „nativ in der Sim“ bleibt |
| **F-TOOLEDIT.S4** | Gateway: Datei- und Bibliotheksvertrag je Aktion, ein Neuladen-Aufruf | G1-Wächter |
| **F-TOOLEDIT.S4b** | nativ: LinuxCNC übernimmt die neue Tabelle | Lücke „nativ“ bleibt |

Ich verlange für G1 keine nativen Läufe.

### Die übrigen Punkte, präzisiert

**F-ARM.S3b:**
- Der Wert ist 3,0.
- Die echte Schleifenstelle wird geprüft, mit kontrollierter monotoner Zeit: 2,99 s ergibt keine Entwaffnung; genau 3,0 s ergibt keine, denn die Bedingung ist `>`; 3,01 s entwaffnet.
- Ist die Stelle nicht ohne Umbau prüfbar, ziehe ich nur ihre Bedingung als Funktion heraus. Der Wächter prüft dann zusätzlich, dass die Schleife genau diese Funktion zum Entwaffnen nutzt, an einer Client-Attrappe.

**F-TOOLMEASURE.S4b:**
- Die unabhängige Tabelle Formular-Schlüssel → Routinenname bleibt.
- Rückwärts wird **jedes** Vorkommen von `#3004–#3013` und `#3100–#3116` im Code geprüft, ohne Kommentare. Ein Vorkommen, das weder eine bekannte Lesezeile `#<name> = #NNNN` noch die bekannte Schreibstelle `#3116 = 0` ist, macht den Wächter rot.
- `#3014` gehört nicht dazu.

**F-TRIP.S1b:**
- Banner, Versand von `safety_trip_ack` und Logeintrag wie geplant.
- **Nach dem Klick und vor dem bestätigenden Frame** bleibt der Trip sichtbar; erst der Frame ohne `safety_trip` nimmt ihn weg.
- Die Aussage betrifft die eingehende Meldung, nicht die native Erzeugung.

**F-LOAD.S3:**
- **Neu laden:** Der Reload-Knopf löst `load_file` mit demselben Pfad aus; ich prüfe das im Browser am gesendeten Befehl. Im Gateway: geladene Datei, geänderter Text, erneutes `load_file`, dann die veröffentlichte Quelle bzw. Revision der neuen Fassung.
- **Entladen:** über `unload_file` selbst bis zum geleerten Zustand: kein geladenes Programm, `preview_available()` falsch, `/preview` 404. Nicht über ein selbst aufgerufenes `clear_preview()`.

**F-MACROFILES:**
- **S3** (Gateway): „neue Datei und alte weg, oder nichts“, an die drei vorhandenen Gateway-Tests gebunden.
- Die Browseraussage **S2** präzisiere ich: Nach einer gelungenen Umbenennung zieht der Client den Platz auf der Leiste nach. Keine gemeinsame Transaktion mit den Einstellungen.
- Kein doppelter Beleg.

**Erbeten:** `agreement` oder `findings` zur Planfassung 2.
