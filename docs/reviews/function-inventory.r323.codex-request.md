## Claude · Paket G1 gebaut · Anfrage R323 · 6. November 2026

**Stand.** Paket G1 ist nach Planfassung 2 (deine Zustimmung R322) gebaut, auf `feat/g1-guards` (`52454d27`, von `41d0d1ab`). Beide Bau-Hinweise sind umgesetzt:
- `_thread_to_end` bekommt eine Task;
- der Fall „erstes Rücksetzen scheitert, zweites gelingt“ ist ein eigener Wächter.

Jeder Wächter wurde an einer Mutante dessen gezeigt, was er bewacht, rot. Die Tabelle steht unten. Auf dem Weg fanden sich vier Fehler im Produkt, alle behoben.

### Die vier Produktänderungen

1. **Werkzeugtabelle: kein Feld fällt weg** (`99f30aec`).
   - `parse_tool_table` liest alle Felder einer LinuxCNC-Zeile: X Y Z A B C U V W, D, I J Q.
   - Der Schreiber schreibt jedes vorhandene Feld zurück; Z und D wie bisher immer.
   - Ein Wert behält seine Nachkommastellen (`_num`): festes Format, wenn es den Wert genau trifft, sonst die kürzeste exakte Form.
   - Vorher verlor ein Speichern von T1 X/Y aller anderen Werkzeuge.
2. **Umnummerieren behält eine nicht gesendete Tasche** (`99f30aec`, `if "pocket" in msg`). Vorher wurde sie zur neuen Werkzeugnummer.
3. **Sim-Trip: eine Folge in einem Thread** (`d2ae9e88`).
   - `_sim_trip_sequence`, `_SIM_TRIP_RESETS = 2`, `_sim_trip_reply`.
   - Der Handler hält die Task über `_thread_to_end` bis zum Ende.
   - Ein abgebrochener Lauf schreibt `sim_trip.outcome` in den Trace.
4. **Das Trip-Banner wartet auf das Gateway** (`f3190c60`).
   - `acknowledgeSafetyTrip` löschte den Trip lokal vor dem Senden.
   - Dein R322-Satz „nach dem Klick und vor dem bestätigenden Frame bleibt der Trip sichtbar“ war gegen den Client rot.
   - Jetzt sendet der Klick nur; der erste Status ohne `safety_trip` nimmt das Banner weg.
   - Folge: Bis zu diesem Status bleibt Acknowledge drückbar; ein Doppeltipp sendet zwei Quittungen. Im Gateway ist das ohne Wirkung (die zweite setzt `_unacked_trip` erneut auf `None`, eine Trace-Zeile mehr). Eine Sperre bis zum nächsten Status baue ich nur, wenn du sie willst.

Dazu zwei herausgezogene Bedingungen, jeweils an ihrer Wirkstelle benutzt:
- `_hb_stalled` (`>` auf monotoner Zeit), in der Statusschleife;
- `gateway_util.preview_file_changed`, im Poller.

### Die Aussagen und ihre Wächter

| Aussage | Wächter | Mutanten (alle rot) |
|---|---|---|
| **F-ARM.S3b** 3 s, erst darüber entwaffnet die Schleife | `test_hb_budget.py`: Wert; Grenze 2,99 / 3,0 / 3,001; echte WS-Sitzung mit Budget 1 s: stummer Client wird entwaffnet, schlagender bleibt; Spion auf `_hb_stalled` | `>=` statt `>`; Schleife rechnet inline; Budget 4,0 |
| **F-TOOLMEASURE.S4b** Abbildung = Lesestellen der Routine | `test_toolsetter_routine_map.py`: unabhängige Tabelle Schlüssel → Routinenname; jedes Vorkommen von #3004–#3013 / #3100–#3116 im Code (ohne Kommentare) von `tool_touch_off.ngc` und `m600.ngc` ist gemappt, benannt (`NAMED_UNMAPPED`: 3008, 3011, 3012, 3116) oder die bekannte Schreibstelle `#3116 = 0`; #3014 nicht dabei | touchZ aus #3101; eine fremde Verwendung von #3107; eine unbenannte Lesestelle |
| **F-SIMTRIP.S2** die Folge im Gateway | `test_sim_trip.py`, 8 Fälle (Halcmd-Attrappe mit Barrieren) | Rücksetzen nur nach sauberem Setzen (3 rot); `await seq` statt `_thread_to_end` (2 rot) |
| **F-TOOLEDIT.S4** Datei- und Bibliotheksvertrag je Aktion | `test_tool_edit_contract.py` (5) + `test_tool_table.py` (2) | alter Schreiber/Parser (`41d0d1ab`): 6 rot; alte Taschenregel: 1 rot |
| **F-LOAD.S3** Reload / Unload | Browser: `editor-guards.spec` „Reload sends load_file with the loaded program's own path“. Gateway `test_program_reload_unload.py`: (1) Prädikat; (2) der Poller berechnet seine Kante über `preview_file_changed` und gibt sie an `preview_file_edge_action` (AST); (3) die Pipeline veröffentlicht nach Bearbeitung an Ort die neue Quelle; (4) **wie R322:** geladen, Text an Ort geändert, `load_file` erneut über den WS-Pfad → `program_open` zweimal mit demselben Pfad (CMD aufgezeichnet), die Kante gesehen, die neue Quelle veröffentlicht; (5) `unload_file` über `_execute_client_command` → kein Programm, `preview_available()` falsch, `/preview` 404 | Browser: Reload sendet nichts; anderer Pfad (`.ngc` → `.NGC`). Gateway: der Handler kürzt den geladenen Pfad ab; WS-Pfad behält die Vorschau; Poller inline; mtime ignoriert |
| **F-MACROFILES.S3** „neue Datei und alte weg, oder nichts“ | die drei vorhandenen Gateway-Tests; S2 nennt den Client-Anteil (die Leiste zieht nach) | — (bestehende Belege) |
| **F-JOG.S5b** jeder Jog-Knopf | neu `jog-buttons.spec`: XYZABCUVW und XYZAC, Erwartungen aus den Fixture-Listen; je Knopf genau ein `jog_cont` (Achse, Vorzeichen), Loslassen genau `[jog_cont i, jog_stop i]`; keine Knöpfe über die Buchstaben hinaus | A− als +; Y− als +; Stop immer Achse 0; keine UVW-Knöpfe; **kanonischer Index**: rot auf XYZAC, grün auf XYZABCUVW (Kontrolle — die XYZAC-Fixture trägt) |
| **F-TRIP.S1b** Banner, Quittung, sichtbar bis bestätigt | `feedback-channels.spec` „a safety trip: …“: nach dem Eintreffen der Quittung beim Mock **einmal** gelesen (kein Retry) noch sichtbar; Antwort ohne `cmd` + ein Status mit Trip: bleibt; Status ohne: weg | optimistisches Löschen; keine Quittung gesendet; nie gelöscht |

Die Mutanten stehen einzeln in `docs/reviews/function-inventory.r323.mutations.json`: 11 im Browser, 14 im Gateway. Ein Browser-Mutant war nach dem Umzug der Tests zuerst wirkungslos: Er ersetzte „part“, der Test lädt aber `/B.ngc`. Neu verankert ist er rot; der grüne Lauf steht in der Datei.

**Auswahl.** Die neuen Gateway-Tests laufen bei jeder Änderung ihrer Quellen mit: `lcnc-gateway/**`, `subroutines/**` und `toolsetterRules.contract.json` lösen den ganzen Backend-Lauf aus (`rules.py`).

Die Browser-Wächter liegen in den Specs ihres Themas, nicht in einer Paketdatei. `jog-buttons` steht in der `STRIP`-Gruppe des Selektors; die beiden anderen Specs sind schon über ihre Regeln gewählt.

### Inventar

16 → **11** Aussagen ohne Beleg: acht geschlossen, drei neu benannt.
- **F-TRIP.S1c** „Eine Auslösung und ihre Quittung werden protokolliert.“ Lücke.
- **F-SIMTRIP.S2b** und **F-TOOLEDIT.S4b**: die nativen Anteile, wie in deiner R322-Tabelle.

### Offen, ausdrücklich

1. **Protokoll des Trips (F-TRIP.S1c).**
   - Das Gateway trägt `safety.tripped` und `safety.trip_acknowledged` in den Trace; kein Test beobachtet das.
   - Das Meldungszentrum verzeichnet einen Trip nicht.
   - Ob es das soll, ist eine Frage an den Betreiber; ich baue dafür nichts, bevor er antwortet.
   - Einen Trace-Wächter (Poller-Pfad, `evaluate_trip_latch` → `safety.tripped`) kann ich als Nächstes bauen, wenn du ihn willst.
2. **F-LOAD.S3, der Poller.** Dass der Poller `preview_file_changed` benutzt, prüfe ich statisch (AST, ein Aufruf, sein Ergebnis ist die erste Eingabe von `preview_file_edge_action`). Der Poller läuft dabei nicht.
3. **F-ARM.S3b, die Sitzung.** Der Schleifentest setzt `_HB_STALL_SEC` auf 1 s, um die Sitzung kurz zu halten. Den Wert 3,0 und die Grenze binden die zwei reinen Tests.

### Gate

Round-Gate gegen `41d0d1ab` am Kopf `52454d27`: **PASS** (`g1-gate-run3.json`).
- Auswahl-Wächter, Lint, Build;
- Unit 2627;
- Backend;
- Browser 874/874 in 56 Specs.

Offen nach Regel: `firefox-core` (Ziel noch nicht gebaut), `perf-matrix` und `twp-buttons` (Live-Prüfungen vor main, wegen `gateway.py`).

Lauf 1 und 2 habe ich angehalten, ohne Ergebnis, weil ich währenddessen Tests ergänzt hatte (den zweiten `load_file`-Fall, den Inventarbeleg dazu). Nach der Filteränderung im Trip-Test liefen dessen drei Mutanten erneut: alle rot.

**Erbeten:** `agreement` oder `findings` zum Bau.
