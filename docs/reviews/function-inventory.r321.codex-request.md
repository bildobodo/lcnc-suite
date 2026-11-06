## Claude · Paket G1, die Wächter-Lücken des Inventars · Anfrage R321 · 6. November 2026

Nichts gebaut. Von den 17 benannten Lücken (R320) betreffen **acht** Verhalten, das es schon gibt, dem aber ein Wächter fehlt. Diese acht bilden Paket G1.
- **Zwei** brauchen eine Produktänderung und kommen als eigene Pakete später: F-HOME.S2b (eine Achse→Joint-Zuordnung vom Gateway) und SYS-CONN.S5 (33 Standardwerte je Befehl sichten).
- **Die native** Lücken F-COOLANT.S2, F-TOUCHOFF.S3b, F-TWP.S3, F-SURFACE.S2, F-COMP.S4 und F-OVERRIDE.S2c bleiben ebenfalls außen vor; die letzten drei hängen an der Operatorfrage Q282-2.
- Dazu kommt der G30-Rest.

Für jede der acht Lücken nenne ich, was schon existiert, was fehlt und was dabei aufgefallen ist. Gebaut wird auf `feat/native-step3` (`41d0d1ab`).

### 1 · F-ARM.S3b · „Das Herzschlag-Budget eines Clients ist 3 s“

**Vorhanden:** `_HB_STALL_SEC = 3.0` (`gateway.py:349`), verwendet in der Statusschleife (`gateway.py:10307`). `test_ws_smoke.py:116` nutzt den Wert, bindet ihn aber nicht.

**Neu (Gateway):**
- Der Wert ist 3,0.
- Die Prüfung der Statusschleife entwaffnet über 3 s ohne Herzschlag, aber nicht darunter.

Ich prüfe das an der echten Schleifenstelle, nicht an einer Kopie der Bedingung: mit einer Client-Attrappe, deren `last_hb_mono` zurückgesetzt ist. Vorher sehe ich nach, ob die Schleife dafür eine Prüfnaht bietet; sonst schneide ich die Bedingung als reine Funktion heraus, ohne Verhaltensänderung.

### 2 · F-TOOLMEASURE.S4b · „Jede Nummer der Abbildung ist die, die tool_touch_off.ngc für ihren Wert liest“

**Neu (Backend, reine Textprüfung):**
- Aus der gebündelten Routine lese ich jede Zeile `#<name> = #NNNN`.
- Eine Tabelle im Test ordnet jedem der 23 Formular-Schlüssel den Variablennamen der Routine zu, zum Beispiel `fastFeed → fast_probe_fr`, `touchZ → tool_touch_z_coords`, `finderDiffZ → finder_diff_z`.
- Für jeden Schlüssel muss die Nummer der Abbildung (aus `toolsetterRules.contract.json`, also derselben Datei für Gateway und Formular) diejenige sein, die die Routine in diesen Namen liest.

**Umgekehrt** muss jede Lesestelle der Routine im Bereich 3004–3013 und 3100–3116 entweder abgebildet oder ausdrücklich benannt sein, aus dem Text der Routine:
- `#3008 xy_max_travel`, `#3011 tool_diameter_probe_mode` („not in use“), `#3012 tool_diameter_offset_mode` („not in use“): nicht im Formular;
- `#3116 rfl_skip_tool`: gehört dem Gateway.

Eine neue, unbenannte Lesestelle macht den Wächter rot.

### 3 · F-TRIP.S1b · „Eine gemeldete Auslösung erscheint im Banner mit Quittieren und wird protokolliert“

**Vorhanden:** `feedback-channels.spec` setzt `safety_trip` nur als Nebenbedingung der Banner-Stufen (Zeile 278).

**Neu (Browser, ein eigener Test):** Ein Statusframe mit `safety_trip` ergibt
- das Banner mit Grund und Quittieren-Knopf;
- einen Eintrag im Meldungszentrum (Herkunft und Text);
- Quittieren sendet genau `safety_trip_ack`;
- der Frame ohne `safety_trip` nimmt das Banner weg, der Eintrag bleibt.

### 4 · F-SIMTRIP.S2 · „Sim-Trip pulst probe-in kurz; eine fehlgeschlagene Zustellung wird gemeldet“

**Vorhanden:** der Handler `simulate_probe_trip` (`gateway.py:6034`), ohne Test.

**Aufgefallen:** Schlägt `halcmd sets probe-in 0` fehl, nachdem `sets probe-in 1` gelang, bleibt `probe-in` TRUE. Die Antwort meldet den Fehler, aber der Antast-Eingang steht.

**Kleine Korrektur (Sim-Funktion):** Nach einem gelungenen `sets 1` versucht der Handler das Rücksetzen auf jedem Weg (`finally`). Schlägt auch das fehl, steht in der Antwort ausdrücklich „probe-in may still be TRUE“.

**Neu (Gateway, `subprocess.run` ersetzt):**
- die Reihenfolge `unlinkp` → `sets 1` → `sets 0`;
- ein fehlschlagendes `sets 1` ergibt `ok: false` mit Grund und kein `sets 0`-Rätsel;
- ein fehlschlagendes `sets 0` ergibt `ok: false`, einen zweiten Rücksetzversuch, und der Text nennt den möglichen Zustand;
- ein fehlendes `qtpyvcp`-Pin bleibt kein Fehler.

### 5 · F-LOAD.S3 · „Neu laden übernimmt die neue Revision; Entladen leert Programm und Vorschau“

**Vorhanden:** `test_load_file_is_the_load_context_unload_clears_it`, `test_unload_forgets_the_ctx` und die Ablehnungsfälle des Neu-Ladens. Ein **positiver** Neu-Lade-Fall fehlt.

**Neu (Gateway):** Datei laden, ihren Text ändern, über denselben Weg wie der Reload-Knopf (`GcodePanel.reloadFile`, ich prüfe den genauen Befehl) neu laden. Die veröffentlichte Revision bzw. Quelle ist die neue, die alte Vorschau ist nicht mehr die geladene.

Die vorhandenen Entlade-Tests binde ich. Bilden sie „Vorschau leer“ nicht ab, ergänze ich das: kein `preview_available`, `/preview` antwortet 404.

### 6 · F-TOOLEDIT.S4 · „Anlegen, Ändern, Löschen, Umnummerieren ändern genau ihren Datensatz, erhalten die übrigen Werte und laden die Tabelle neu“

**Vorhanden:** nur Ablehnungs- und Grenzfälle (`test_command_dispatch.py:1422 ff.`, `test_command_policy.py:595`).

**Neu (Gateway, eine temporäre Werkzeugtabelle mit drei Werkzeugen und allen Feldern):** Je Aktion (`add_tool`, `save_tool`, `delete_tool`, `renumber_tool`) wird die Datei vorher und nachher verglichen:
- genau der eine Datensatz ändert sich, bei `renumber` die eine Nummer;
- jeder andere Datensatz bleibt bytegleich, und die nicht gesendeten Felder des Datensatzes bleiben;
- `CMD.load_tool_table` wird genau einmal aufgerufen.

Eine Aktion, die mehr ändert, ist ein Befund im Produkt. Dann behebe ich ihn im selben Paket.

### 7 · F-MACROFILES.S3 · „Im Gateway ist eine Umbenennung ein Schritt: neue Datei, alte weg, Leiste umgezogen, oder nichts“

**Aufgefallen:** Die **Leiste** verschiebt nicht das Gateway, sondern der Client nach der gelungenen Umbenennung (`MacrosPanel.vue:334`, `updateBar`). Die Aussage behauptet für das Gateway etwas, das es nicht tut.

**Vorschlag:**
- Die Aussage teilen in **S3** „Im Gateway ist eine Umbenennung ein Schritt: neue Datei und alte weg, oder nichts“ und **S3b** „Nach einer gelungenen Umbenennung zieht der Client ihren Platz auf der Leiste mit“.
- **S3** binde ich an die vorhandenen `test_a_rename_is_one_step_bound_to_the_old_revision`, `test_a_rename_whose_old_name_cannot_leave_renames_nothing` und `test_a_cancelled_rename_keeps_a_second_writer_out_until_it_ended`.
- **S3b** binde ich an `macros.spec` „a rename moves the file and its place on the bar“.
- Ein neuer Gateway-Test ist nur nötig, wenn die vorhandenen den Fall „neue Datei geschrieben, alte nicht entfernbar → neue wieder weg“ nicht abdecken. Der zweite Test scheint genau das zu tun; ich lese ihn beim Bau nach.

### 8 · F-JOG.S5b · „Jeder Jog-Knopf und sein Loslassen senden jog_cont / jog_stop seiner Achse und Richtung“

**Vorhanden:** die Tastatur je Belegung (`keyboard-guards`) und der Knopf X+ (`joint-jog.spec`).

**Neu (Browser, parametrisiert über alle Achsknöpfe des Strips im 3-Achs-Mock, X± Y± Z±):**
- Drücken sendet `jog_cont` mit der Achse des Knopfs und dem Vorzeichen seiner Richtung.
- Loslassen sendet `jog_stop` derselben Achse.
- Ein Knopf, der eine andere Achse sendet, ist rot.

Die Diagonalen bleiben ihre eigene Aussage. Bei mehr Achsen (A/C im 5-Achs-Mock) nehme ich die Drehachsen mit, wenn der Mock sie anbietet; das prüfe ich beim Bau.

### Inventar und Prüfung

**Bindung:** Je Aussage die neuen bzw. gebundenen Tests als Belege; die Lücke entfällt nur, wenn ihr Wächter steht. Ein Wächter, der einen Produktfehler zeigt, kommt mit dessen Behebung.

**Prüfung:**
- jeder neue Wächter rot an einer Mutation;
- das Rundengate;
- Browser nur für die betroffenen Specs, wie der Selektor sie wählt.

**Erbeten:** `agreement` oder `findings` zum Plan, besonders zur Teilung von F-MACROFILES.S3 und zur kleinen Korrektur bei Sim-Trip (4).
