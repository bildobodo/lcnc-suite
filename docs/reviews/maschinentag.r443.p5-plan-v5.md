
---

## Claude · P5-Detailplan v5 (Kalibrier-Kandidat, Feldzustände) nach R442 · 23. November 2026

**Grundlage:**
- der vereinbarte P5-Umfang (R418/R419, MT418-06; W1 und W3 vom Maschinentag);
- Codestellen an development `594e333c`;
- Codex R439 bis R442, jeweils der P5-Teil.
  - In R440 angenommen: die Schreibzuständigkeit, der Datensatz `probeCalibration`, der Laufvertrag und das Zustandsmodell.
  - In R441 geschlossen bzw. angenommen: die Feldänderungs-IDs, MT440-01, die Reservierung vor dem Start, die Chunk-Zustände und `write_pending`.
  - In R442 geschlossen: MT439-07 und die Wirkungsklassifikation von MT439-08.
  - v5 schließt MT439-05 A/B und übernimmt Codex' Bauhinweise zu MT439-08.

**Stand:** Planfreigabe erbeten, noch kein Code. Gebaut wird erst nach der Freigabe der Renderings durch den Operator (`~/claude-work/p5/renderings/`, Prototyp `proto/p5-renderings`, wird nie gemergt).

**Was sich gegenüber v1 bis v4 ändert:**

| Befund | Änderung |
|---|---|
| **MT439-05** | Eine Laufmarke reist vom Auftrag als Routinenargument in die Routine und kommt in ihrer Ergebnismeldung zurück (P5-1 b). Angeboten wird erst, wenn Zulassung, belegter Start, Ergebnis und sauberes Ende **desselben** Laufs vorliegen; dazu gehört eine Fehlerkanal-Lesung nach dem Idle. |
| **MT439-06** | `#3032` hat **einen** Schreiber, das Gateway (P5-1 c). Der Kalibrieraufruf schreibt den aktiven Offset nie. Normale Antastaufträge bekommen `#3032` aus dem serverseitig aktiven Kalibrierwert, nie aus dem Formular. Der Kalibrierwert verlässt die Probe-Sektion: Er wird ein eigener, nur vom Gateway geschriebener Datensatz. BG-19 bleibt für alle übrigen Parameter unverändert. |
| **MT439-07** | Übernehmen, Verwerfen, Reset und ein neuer Kalibrierstart entscheiden atomar unter **einer** Kandidatensperre (P5-1 d). Speichern und Controller-Schreibung haben fünf getrennte Ausgänge aus `_apply_probe_vars_detail`. Nach dem Speichern ist die Übernahme gebucht. Der Zustand bleibt nach Antwortverlust rekonstruierbar. |
| **MT439-08** | Feldzustände beruhen auf feldbezogenen Daten (P5-2 a). Die Maschinenbuchung trägt die wirklich gesendeten Schlüssel und Werte samt Ausgang und Link (P5-2 b). Texte nennen nur, was eine gültige Buchung belegt; sonst „unknown“. |
| **MT439-05 Rest (R440)** | Die Laufmarke ist ein **dauerhaft reservierter, nie wiederverwendeter Zähler** mit benannter Grenze (1 … 9 999 999), keine Zufallsbasis plus Zähler. Ohne Reservierung wird nicht gestartet. Die verlustfreie Rückkehr durch CALL, Parameter und DEBUG ist ein Golden-Wächter an der Grenze (P5-1 b). |
| **MT439-07 Rest (R440)** | Der Vertrag von `_apply_probe_vars_detail` wird erweitert: je Chunk **nachweislich nicht geschrieben**, **geschrieben mit unbekanntem Ausgang** oder **übernommen**, belegt am `written`-Haken von `_cmd_blocking`, nie an einem Text oder frühen Schnappschuss. Ein Cancel hinterlässt den geschuldeten Maschinenzustand (P5-1 d). |
| **MT439-08 Rest (R440)** | Der Feldzustand bindet die lokale **Feldänderung** (Änderungs-ID) und ihren eigenen Sende- bzw. Ablehnungsstand, nicht nur den Wert (P5-2 a). Die Probe-Buchung wird **neu aufgebaut**: `_ts_book` verwirft alles außerhalb `TOOLSETTER_BASIS_KEYS`. Grenzen für unbeobachtbare Schreibungen sind benannt (P5-2 b). |
| **MT439-05 Rest (R441)** | *(Der Speicherort wurde in R442 ersetzt, siehe A.)* Der Zähler liegt nicht mehr im Log-Ordner, sondern im **Parameterbestand der Maschine**: der deklarierte Parameter `#3037` in ihrer var-Datei. Ein Wechsel von Log-Ordner oder Installation berührt ihn nicht. Initialisierung und Reset, und dazu **jeder** Kalibrierstart, verlangen eine **Leerungsprobe**: Interpreter idle und danach ein vollständig gelesener Fehlerkanal. So kann keine Meldung eines früheren Laufs mehr ankommen (P5-1 b). |
| **MT439-07 Rest (R441)** | Je Parameter-Chunk zählt der **Beginn** der möglichen Wirkung, ein `began`-Haken unmittelbar vor `cmd.mdi`, wie in P2b vereinbart. `not_written` gilt nur, wenn die Verweigerung nachweislich vor diesem Beginn lag. Ab dem Beginn ohne positives Ende ist es `written_unknown`, auch wenn `written` nie erreicht wurde (P5-1 d). |
| **MT439-08 Rest (R441)** | Die Wirkungsklassifikation hat drei Ausgänge: belegte Schlüsselmenge, belegt keine, **unbekannt**. Sie spiegelt `toolsetter_assigned_keys` und wird auf einen Schlüsselbereich verallgemeinert. Unbekannt entwertet **vor** der möglichen Wirkung alle Probe-Schlüssel. Eigene Aufträge buchen danach genau ihre positiv belegten Chunk-Werte (P5-2 b). |
| **MT439-05 A (R442)** | `#3037` ist **belegt**: `tool_setter_param_update.ngc:15,39` schreibt dort `breakage_tolerance`; `decisions.md` führt `#3037–#3039`. Der Zähler wird deshalb **kein Parameter**. Er wird eine Zustandsdatei im **Konfigurationsordner der sitzungsgebundenen LinuxCNC-Instanz** (Ordner ihrer INI), die nur das Gateway schreibt. Das ist einfacher zu beweisen als eine freie Nummer, die jede gebündelte, künftige oder eigene Routine des Operators verschonen müsste. Gelesen wird streng: vorhanden, endlich, ganzzahlig, im Bereich; sonst benannte Verweigerung (P5-1 b). |
| **MT439-05 B (R442)** | Die Leerungsprobe wird ausdrücklich definiert: zuerst Ruhe ohne alte offene Arbeit, nach dem gemeinsamen Abschlussentscheid aus P2b v4; dann eine **nach** ihr begonnene Lesung desselben Links in Paketen ≤ 50 bis zu einem **tatsächlich beobachteten leeren** Poll, durch den Status-Poller als einzigen Leser; die Meldungen werden vor dem neuen Lauf verarbeitet. Sie läuft unter derselben Sperre wie der Start. Dieselbe Probe belegt das saubere Ende (P5-1 b). |
| **MT440-01** | Die Migration nennt die Herkunft von Wert **und** Einheit (deklarierte Altbasis aus `[TRAJ] LINEAR_UNITS`, benannt als solche), atomar und einmalig. Jeder Antast- und Kalibrierauftrag verlangt **Programmeinheit = Formulareinheit**, auf aktuellem Read an jeder Schreibung, sonst benannte Verweigerung vor jeder Wirkung; nie still umgerechnet (P5-1 c). |

### P5-1 · Kalibrieren liefert einen Kandidaten (MT418-06, MT439-05/06/07)

**Heute:**

*Die gebündelten Routinen setzen `#3032` zu Beginn auf 0 und schreiben am Ende den neuen Wert:*
- `probe_cal_round_pocket.ngc:38`, `probe_cal_round_boss.ngc:39`, `probe_cal_square_boss.ngc:40`, `probe_cal_square_pocket.ngc:40`: zu Beginn `#3032 = 0` samt `(DEBUG, EVAL[…calibration_offset_3032…setValue{#3032}])`.
- Ende: `#3032 = [ABS[…]]` (`round_pocket:194–203`, `round_boss:301–309`, `square_boss:195–203`, `square_pocket:150–158`).
- **Die Messung braucht die Null wirklich:** Die XY-Antastunterprogramme verrechnen ihr 7. Argument als Offset (`probe_x_plus.ngc:20,37`). Die Kalibrierung übergibt dort `[#3032]`.
  - Aufrufe: `round_pocket:67,72,88,93,109,114,138,143`; `round_boss:74,93,120,139,169,187,227,245`; `square_boss:75,94,130,149`; `square_pocket:69,74,99,104`.
  - `probe_z_minus_sub` liest sein 8. Argument nicht.

*Die Seite schreibt und speichert den Offset an mehreren Stellen:*
- **Der Aufrufer schreibt `#3032` selbst, aus dem Entwurf:** `calibrationVarMap` enthält `probeVarMap` mit `"3032": p.calOffset` (`probeVars.ts:43`, `:75–77`). `_feature_job` schreibt diese Werte vor dem Aufruf (`gateway.py:6450ff.`, `_apply_probe_vars`), und zwar aus dem **Entwurf** (`loadProbeDraft`, `ProbePanel.vue:186–191`). Codex' Probe: bestätigt 0,20, Entwurf 0,05 → der Kalibrierauftrag sendet `#3032=0.05`.
- **Jede `cal_offset`-Meldung wird sofort übernommen:** Sie geht an jeden Client (`gateway.py:1748`, `1866–1885`, `12426`); jeder `ProbePanel` übernimmt sie sofort und speichert die ganze Probe-Sektion (`ProbePanel.vue:210–216`), auch die Null vom Anfang.
- **Eine reine Wertmeldung trägt keine Laufkennung:** Ein später Wert von Lauf A ist von einem Wert von Lauf B nicht zu unterscheiden (MT439-05).
- **Reset** startet `probe_cal_reset.ngc` (`ProbePanel.vue:96–101`). Der Offset ist nur als Ausgabe am Ende der Parameterliste sichtbar (`:1251`). Der Operator fand „Reset Calibration“ (`:1063`) nicht (W3).

**Vertrag:**

*(a) Routinen (gebündelte probe_basic-Kopie, GPL v3; kleinster benannter Unterschied, dokumentiert in einem README-Abschnitt „suite changes“ samt Diff):*
- `#3032 = 0` und seine DEBUG-Zeile am Anfang entfallen.
- Die XY-Antastaufrufe übergeben `[0]` statt `[#3032]`. Die Messung rechnet so ohne Offset, mit lokalen Werten.
- Die Routine erhält die Laufmarke als **erstes Argument**: `O<probe_cal_round_pocket> CALL [<token>]`. Am Anfang schreibt sie `#1014 = #1`, am Ende `#1013 = [ABS[…]]`; beide sind flüchtig wie die Ergebnisse `#1000–#1012` und in keiner var-Datei deklariert.
- Die Ergebnismeldung ist eine eigene, eindeutige Zeile:
  `(DEBUG, LCNC_CAL_CANDIDATE run=#1014 value=#1013 axis=#3036)`
  Sie folgt dem Muster der bestehenden Zeile `LCNC_SURFACE_SCAN_DONE`; das Gateway verbraucht sie und leitet sie nie als Meldung weiter.
- `#3032` wird von keiner Routine geschrieben.
- Ein Upstream-Original früher im `SUBROUTINE_PATH` ignoriert das Argument und sendet die alte `calibration_offset_3032`-Form. Daraus wird **nie** ein Kandidat; es erscheint als Warnung „Calibration routine is not the suite's — no result offered“.

*(b) Lauf und Laufmarke (MT439-05):*
- **Marke (R440):** Ein Kalibrierauftrag (`probe_run` mit einer `probe_cal_*`-Routine außer `reset`) bekommt vom Gateway eine Laufmarke.
  - **Quelle (R442):** ein dauerhaft fortgeschriebener, nie wiederverwendeter Zähler als **Zustandsdatei im Konfigurationsordner der sitzungsgebundenen LinuxCNC-Instanz**, d. h. im Ordner der INI, mit der diese Instanz läuft (`_current_ini_path()`): `lcnc-suite-cal-runs.json`, `{"next": N, "ini": <INI-Name>, "updated": …}`.
    - **Stabil:** Ein Wechsel von `LCNC_LOG_DIR`, `[DISPLAY] LOG_DIR` oder des Installationsorts ändert diesen Ordner nicht. Eine kopierte Konfiguration trägt den Zähler mit; er bleibt monoton.
    - **Schreibbar:** LinuxCNC schreibt dort ohnehin seine Laufzeitdateien. Eine nicht schreibbare Datei verweigert den Start.
    - **Kein Parameter (Inventur R442):** `#3037` ist belegt (`subroutines/probe_basic/tool_setter_param_update.ngc:15,39`, `breakage_tolerance`, ebenso unter `examples/sim_config/subroutines/probe_basic/`; `docs/decisions.md` führt `#3037–#3039` als von dort geschrieben). Eine „freie“ Nummer müsste jede gebündelte, künftige Upstream- und eigene Routine des Operators im `SUBROUTINE_PATH` verschonen; das ist nicht belegbar. Die Datei schreibt nur das Gateway. `install_examples.py` deklariert deshalb nichts Neues.
  - **Strenges Lesen vor jeder Reservierung:**
    - Die Datei muss lesbar sein, gültiges JSON, `next` eine **endliche Ganzzahl** in 1 … 9 999 999 (kein Bruch, kein Vorzeichen, kein String) und `ini` gleich dem gebundenen INI-Namen.
    - Sonst wird benannt verweigert: „Calibration run counter unreadable — <Datei>: <Grund>“. Nie gerundet, nie still 0.
    - **Fehlt die Datei**, ist das eine Initialisierung: zulässig nur nach der Leerungsprobe (unten), dann `next = 1`, protokolliert als `cal.run_counter_created`. Ein ausdrücklicher Reset ist dasselbe: Datei entfernen, protokolliert, dann Initialisierung mit Leerungsprobe.
  - **Reservierung, vor dem Routinenaufruf:**
    1. Das Gateway liest den Zähler (streng, oben) und nimmt das Maximum mit seiner eigenen letzten Reservierung im Speicher. Daraus wird `N = max + 1`.
    2. Es schreibt `next = N + 1` atomar (tmp-Datei im selben Ordner, fsync, rename, fsync des Ordners).
    3. Erst dann folgen die Vorlaufwerte und der `CALL` mit `[N]`.
    - Scheitert Schritt 2, wird der Start verweigert („Calibration run id not reserved“), vor jeder Controller-Schreibung. Eine reservierte, nie gesendete Marke bleibt verbraucht.
  - **Leerungsprobe (R442)** vor jedem Kalibrierstart, also auch vor Initialisierung und Reset, gebunden an den **Link** (Controller-Instanz und `link_seq`):
    1. **Ruhe ohne alte offene Arbeit:** ein frischer Poll desselben Links nach dem **gemeinsamen Abschlussentscheid** aus P2b v4 (`controller_done`, ausgelagert aus `_release_start_claims`). Verlangt werden: RCS `DONE`, Interpreter idle, `queued_mdi_commands == 0`, `exec_state == EXEC_DONE`. Ein Pflichtfeld `None` gibt keine Probe. **Idle allein genügt nicht:** Nach einem Gateway-Neustart kann ein eingereihtes MDI noch im Controller liegen.
    2. **Leerung durch den einzigen Leser:** Die Probe ist eine Anforderung an den **Status-Poller**, den einzigen Leser des Fehlerkanals. Die Anforderung hält die Zykluszahl bei ihrer Abgabe; nur ein Zyklus, der **danach** beginnt, bedient sie. Ein schon laufender älterer Zyklus zählt nicht.
       - Dieser Zyklus liest in Paketen von ≤ 50 (`read_errors_nonblocking`), so lange, bis ein `err.poll()` **tatsächlich leer** zurückkommt.
       - Begrenzt: höchstens 20 Pakete (1 000 Meldungen) bzw. 500 ms.
       - Er verarbeitet jede Meldung wie sonst, eine alte Kandidatenmeldung als stale, und meldet dann `proven`.
    3. **Keine Probe**, also benannte Verweigerung „Earlier run not settled — wait and calibrate again“:
       - kein ERR-Kanal (`_get_err()` ist `None`);
       - ein Lesefehler (heute nur protokolliert, dann eine Liste);
       - ein Linkwechsel während der Lesung;
       - die Grenze ausgeschöpft, ohne leeren Poll;
       - keine Ruhe nach Schritt 1.
       - Heute liefern ein fehlender Kanal und ein Lesefehler ebenfalls eine Liste und lassen den Zyklus weiterzählen. Die Anforderung liest deshalb ein eigenes Ergebnisfeld (`drained: proven | why`), nicht die Liste.
    4. **Nichts dazwischen:** Probe, Reservierung und die erste Schreibung des Auftrags laufen unter **einer** Entscheidung: der Kandidatensperre `_cal_lock` und dem `_cmd_lock` des Auftrags, den `_feature_job` für seine Schreibungen ohnehin hält. Kein eigener Start eines anderen Clients kann sich zwischen Probe und Auftrag schieben.
    - **Warum das genügt:** Nach Ruhe und belegtem leerem Kanal kann keine Meldung eines früheren Laufs mehr ankommen. Deshalb darf ein Zähler neu beginnen (Initialisierung, Reset), und ein protokollierter Reset **allein** entwertet keine alte Meldung.
    - **Dieselbe Probe belegt das saubere Ende** eines Laufs (Schritt 4 oben): Ruhe nach dem Lauf und danach ein belegt leerer Kanal ohne Fehler- oder Abbruchmeldung im Laufzeitfenster.
  - **Grenze:** 1 … 9 999 999. Diese Ganzzahlen sind als `double` exakt und überstehen die Wege des Interpreters verlustfrei; der Golden-Wächter belegt das an der Grenze. Ist die Grenze erreicht, wird benannt verweigert („Calibration run ids used up“).
  - **Weg und Rückkehr:** Die Marke reist als ganzzahliges Literal im `CALL` (`[1234567]`) und als `#1` in die Routine, dann über `#1014 = #1` in den DEBUG-Text (`run=#1014`). Das Gateway nimmt sie nur an, wenn der gedruckte Wert eine **exakte** Ganzzahl in der Grenze ist (Nachkommastellen alle 0). Sonst ist die Meldung ungültig und wird protokolliert, nie gerundet.
- **Lauf eröffnet erst nach der Schreibung:** Der Lauf ist eröffnet, wenn die Schreibung des `CALL` gebucht ist (Serial, Zeit, Link über `_cmd_blocking(written=…)`). Er hält: Marke, Routine, Starter (`conn_key`), Link, die **tatsächlich übergebene Messbasis** (siehe c) und die Revision des aktiven Kalibrierwerts beim Start.
- **Kandidat** wird ein Lauf erst, wenn **alles davon für dieselbe Marke** vorliegt:
  1. **Zulassung:** Der Auftrag wurde zugelassen und geschrieben (eröffneter Lauf).
  2. **Belegter Start:** ein Poll desselben Links nach der Schreibung mit `echo_serial ≥ serial` **und** einem nicht-idle Interpreter. Alternativ belegt die Ergebnismeldung mit dieser Marke die Ausführung. Ein Interpreter, der nur idle bleibt, ist **kein** Erfolg: „Calibration did not start“.
  3. **Ergebnis:** eine `LCNC_CAL_CANDIDATE`-Meldung mit **dieser** Marke und einem endlichen Wert, auf demselben Link.
  4. **Sauberes Ende:** Ruhe nach dem gemeinsamen Abschlussentscheid und danach eine Leerungsprobe (unten, R442) ohne Fehler- oder Abbruchmeldung im Laufzeitfenster. Kein Abort oder E-Stop wurde vom Gateway für diesen Lauf gebucht.
- **Anders endende Läufe:** Ein Lauf, der anders endet, liefert **keinen** Kandidaten, auch wenn sein Wert schon gemeldet war: „Result not offered — the run did not complete (…)“.
- **Späte und doppelte Meldungen:**
  - Eine Meldung mit einer **älteren** Marke ist stale; sie wird protokolliert und ersetzt nie einen neueren Kandidaten.
  - Eine zweite Meldung derselben Marke nach der Entscheidung wird ignoriert und protokolliert.
- **Linkwechsel:** Ein Linkwechsel während des Laufs macht ihn unvollständig.

*(c) Eine Schreibzuständigkeit für den Kalibrierwert (MT439-06):*
- **Eigener Datensatz:** Der aktive Kalibrierwert wird ein eigener Datensatz im Settings-Store: Maschinensektion `probeCalibration` mit `{value, unit, rev, at, source: {run, routine, basis}}`.
  - **Schreiber:** **nur** das Gateway (`cal_apply`, `cal_reset`). Eine Client-Speicherung dieser Sektion verweigert der Store mit „Set by Apply or Reset“.
  - **Migration (R440, MT440-01):**
    - **Wert:** `probe.calOffset` aus der Probe-Sektion des Stores zum Zeitpunkt der Migration.
    - **Einheit:** die **deklarierte Altbasis**, d. h. die Maschineneinheit aus `[TRAJ] LINEAR_UNITS`. In ihr zeigte das Formular den Wert (`linearUnit`, `App.vue:1213`). Der Datensatz nennt sie ausdrücklich als `unit_basis: "declared_legacy"`; sie ist kein Messnachweis. Ist `LINEAR_UNITS` nicht lesbar, bleibt die Einheit `unknown`: Wert erhalten, aber keine Maschinenübernahme daraus, bis Calibrate oder Reset (die Seite fällt heute dort still auf „mm“ zurück; die Migration tut das nicht). Nie die gerade aktive Programmeinheit.
    - **Zeitpunkt und Einmaligkeit:** beim ersten Gateway-Start mit dem neuen Code, unter der Store-Sperre in **einer** Speicherung: Datensatz samt `migrated: {from_rev, at}`. Ein vorhandener Datensatz wird nie wieder migriert.
    - **Fehlender oder ungültiger Altwert** (fehlt, nicht endlich): Datensatz `{value: null, state: "none"}`. Antastaufträge, deren Routine `#3032` liest, werden dann benannt verweigert („No calibration offset — calibrate or Reset“); Reset setzt 0 in der Maschineneinheit.
    - **Keine erneute Migration** durch eine alte Client-Speicherung: Ein mitgesendeter `calOffset` wird verworfen (unten) und löst nichts aus.
  - **Bereinigung:** Danach fehlt `calOffset` im Schema der Probe-Sektion. Eine Probe-Speicherung, die ihn noch trägt (eine alte Seite), wird ohne diesen Schlüssel gespeichert und als `settings.probe_cal_offset_dropped` protokolliert. Ein alter Wert kommt so nicht zurück, auch nicht über den offenen Entwurf eines anderen Clients (Codex' Fall: Client B bearbeitet nur Feed).
- **`#3032` hat einen Schreiber, das Gateway:**
  - **Kalibrieraufruf:** Zweck `calibration` (`features.purpose_refusal`) mit einer eigenen Schlüsselmenge **ohne** 3032. Die Seite sendet `calibrationVarMap` ohne 3032; ein mitgesendetes 3032 verweigert das Gateway („The calibration offset is set by Apply or Reset“). Vorlauf und Aufruf schreiben den aktiven Offset nie.
  - **Normale Antastaufträge und `set_params`:** Die Seite sendet 3032 nicht mehr (`probeVarMap` ohne 3032; für jeden Zweck gilt dieselbe Verweigerung). Das Gateway fügt bei einem Auftrag, dessen Routine `#3032` liest, den **aktiven** Wert aus `probeCalibration` hinzu. Das ist kein Formularentwurf: **BG-19 bleibt für alle übrigen Parameter** wie heute (ein Probe läuft mit dem, was sein Formular zeigt), nur der Kalibrierwert ist ausgenommen.
  - **Einheiten (R440, MT440-01):**
    - **Für alle Werte:** Die Seite zeigt **alle** Längen und Vorschübe in der Maschineneinheit (`ProbePanel.vue:52, 996, 1041, 1244`), die Routinen erzwingen kein G20/G21. Deshalb verlangt **jeder** Antast-, Kalibrier- und Scan-Auftrag sowie `set_params`: **Programmeinheit des Interpreters = Maschineneinheit des Formulars**.
    - **Prüfort:** die `admit`-Prüfung des Auftrags, auf einem **aktuellen** Read an jeder Schreibung (Moduswechsel, jeder Chunk, `CALL`). Sonst wird vor jeder Wirkung benannt verweigert: „Probing values are in mm — the interpreter is in inch (G20): switch to G21“.
    - **Nie umgerechnet.**
    - **Der Datensatz** trägt die geprüfte Einheit des Kalibrierlaufs. Ein Antastauftrag schreibt `#3032` nur, wenn diese Einheit gleich der geprüften Auftragseinheit ist; sonst benannte Verweigerung.
- **Messbasis:** Der Lauf hält die **tatsächlich gesendeten** kanonischen Werte (`#3014–#3031`, `#3033–#3036`, wie `_apply_probe_vars_detail` sie formatiert), ihren Ausgang (übernommen ja/nein) und die Programmeinheit. Diese Basis steht beim Kandidaten.
- **Geänderte Bezugsbasis:** Der Kandidat nennt „was …“ = den aktiven Wert **beim Start**. Hat sich der aktive Datensatz seitdem geändert (Apply oder Reset eines anderen Laufs oder Clients), wird der Kandidat nicht mehr angeboten: „The active offset changed since this run — calibrate again“. Er gibt nie still einen alten „was“-Wert als aktuellen aus.

*(d) Eine atomare Kandidatenentscheidung und getrennte Ausgänge (MT439-07):*
- **Eine Kandidatensperre (`_cal_lock`)** für Übernehmen (`cal_apply {run, value}`), Verwerfen (`cal_discard {run}`), Reset (`cal_reset`) und den Start einer neuen Kalibrierung.
- **Am Commit unter der Sperre prüfen:** Verbindung offen und **jetzt** bewaffnet (`conn_key`, wie BG-14), Funktion `probing` an, Kandidat mit dieser Marke `pending`, Bezugsrevision unverändert, Link unverändert. Zwei Clients können denselben Kandidaten so nicht beide übernehmen; der zweite bekommt „Already applied“ bzw. „Discarded meanwhile“.
- **Übernehmen in zwei Schritten:**
  1. **Speichern** von `probeCalibration` im Store, mit `admit` = dieselben Prüfungen unter der Store-Sperre.
     - Verweigert → Ausgang **`refused`**. Nur hier gilt „the active offset stays …, the result stays open“.
     - Gespeichert → Kandidat **`applied`**, gebucht. Eine Wiederholung mit derselben Marke antwortet „Already applied“, ohne erneut zu übernehmen.
  2. **Controller-Schreibung** `#3032` über `_apply_probe_vars_detail` (nicht den vereinfachten Wrapper), nur wenn `ready` und idle.
     - **Erweiterung des Helfervertrags (R440, R441):** Heute kommt eine `_WriteRefused` am Moduswechsel oder unmittelbar vor der Parameterschreibung mit `refused: None` zurück, genau wie eine Zeitüberschreitung nach dem Senden (Codex' Tabelle). Der Haken `written` läuft erst **nach** der Rückkehr von `cmd.mdi` (`gateway.py:4139–4148`) und belegt deshalb kein Ausbleiben.
       - **Neu: der Haken `began`** in `_cmd_blocking`, unmittelbar **vor** `getattr(conn.cmd, command.name)(*args)`, nach Zulassung und Linkprüfung; derselbe Haken ist in P2b vereinbart.
       - **Je Parameter-Chunk** liefert der Helfer `{keys, state}`:
         - `not_written`: nur, wenn die Verweigerung **vor** `began` nachweislich lag (Zulassung, Linkprüfung, Zeilenprüfung) oder ein eigens belegter wirkungsloser Fehler.
         - `written_unknown`: `began` ist ausgelöst, aber kein positives Ende (kein `RCS_DONE`, Zeitüberschreitung, Linkwechsel, eine Ausnahme **im** Aufruf, Cancel). Das gilt auch, wenn `written` nie erreicht wurde.
         - `taken`: `began`, Rückkehr (`written`), `RCS_DONE` und derselbe Link.
         - Dazu `persisted` und `file_error` wie bisher. Kein früher Readiness-Schnappschuss, kein Textvergleich.
       - **Der Moduswechsel** ist ein eigener `_cmd_blocking`-Aufruf. Sein `began` bucht keinen Parameter-Chunk.
     - **Cancel:** Vor dem Abwarten bucht `cal_apply` den Maschinenzustand `write_pending`.
       - `_cmd_blocking` hält `_cmd_lock` weiter bis zum Ende der nicht abbrechbaren Schreibung (`_thread_to_end`); der Befehls-Lock wird nicht früher freigegeben.
       - Erst danach übernimmt der Cancel-Pfad (`finally`) den tatsächlichen Phasenstand: `saved_not_written` nur vor `began`, sonst `saved_write_unknown`. Nie der Ausgangszustand, nie `saved_not_written` nur aus dem fehlenden `written`.
     - Die bestehenden Aufrufer bekommen dieselbe Antwort wie bisher; die neuen Felder sind zusätzlich.
     - Die Ausgänge stehen im Datensatz (`machine: {outcome, value, link, at, why}`):
     - **`saved_not_written`**: nicht versucht (nicht bereit) oder Chunk `not_written`. Text „Saved — written to the machine with the next probe“. Das stimmt, weil jeder Antastauftrag den aktiven Wert schreibt.
     - **`saved_write_unknown`**: Chunk `written_unknown`. Text „Saved — machine value unknown: …“.
     - **`taken`**: übernommen und in die var-Datei geschrieben (`mdi_set` und `persisted`).
     - **`taken_persist_unconfirmed`**: übernommen, die Datei nicht (`file_error`).
- **Reset** hat denselben Vertrag mit dem Wert 0. Ein offener Kandidat wird dabei atomar `superseded`.
- **Ein neuer Kalibrierstart** setzt einen offenen Kandidaten unter derselben Sperre auf `superseded`.
- **Rekonstruierbar:** Kandidat und Datensatz samt Maschinenausgang sind Gateway-Zustand und stehen im Status jedes Clients. Antwortverlust, Cancel und Linkwechsel ändern nichts daran, was danach angezeigt wird.
- **Entwaffnen oder Funktion aus während des Wartens:** Die `admit`-Prüfung jeder MDI-Schreibung greift. Nach erfolgreichem Speichern endet das als `saved_not_written` („not armed“), nie als „unverändert“.

*(e) Seite:*
- Die Übernahme in `ProbePanel.vue:210–216` entfällt; kein Offset wird aus einer Meldung gespeichert.
- **Block „Calibration Offset“ unter dem Kasten der Zellen** (W3; `.gridSection` bleibt fest 360 / 368 px, die Zellen stehen in jeder Prozedur gleich):
  - aktiver Wert aus `probeCalibration` und sein Maschinenausgang als neutrale `.statusNote`, Reset daneben;
  - ein offener Kandidat als `.statusNote.warn` („New … — was … · Routine, Größe, Achse, Uhrzeit“) mit **Apply** und **Discard**;
  - die Ausgänge oben, jeweils mit ihrem eigenen Text;
  - der Reset unten im Kasten (`:1061–1064`) entfällt.
- **Katalogtypen:** `calApply` und `calDiscard` (Gate `armed`; Discard ändert gemeinsamen Zustand); Reset behält `probeReset`.

**Wächter (Codex' Gegenfälle eingeschlossen):**
- **Laufidentität:**
  - A abgebrochen, B gestartet, dann kommt A's Meldung mit **demselben** Wert auf demselben Link → stale, B unberührt.
  - Ergebnis vor dem Rückzug, danach Abort bzw. Fehler → nicht angeboten.
  - Start verweigert, Interpreter bleibt idle → kein Kandidat, „did not start“.
  - Ergebnis während eines Linkwechsels → nicht angeboten.
  - Doppelte Meldung derselben Marke → ignoriert.
  - Alte `calibration_offset_3032`-Form → Warnung, nie ein Kandidat.
  - **Codex' Fall (R441):** derselbe Controller, Gateway-Neustart mit **anderem Log-Ordner**, beide alten Log-Dateien noch vorhanden. Der Zähler liegt im Konfigurationsordner und vergibt keinen alten Wert neu. Eine verspätete Meldung des alten Laufs ist stale.
  - **Codex' Fälle (R442):**
    - Der Wert von `tool_setter_param_update` (`#3037`) bleibt unberührt; Zähler und Toleranz sind unabhängig, auch nach einem Gateway-Neustart.
    - Ein alter Zählerstand mit Bruch, negativ, als String bzw. eine unlesbare Datei → benannte Verweigerung **vor** der Reservierung.
    - Leerungsprobe:
      - eine alte Kandidatenmeldung an Position 51 → im zweiten Paket gelesen und als stale verarbeitet;
      - genau 50 Meldungen ohne leeren Poll → keine Probe aus dem ersten Paket, weiterlesen;
      - Lesefehler bzw. kein ERR-Kanal → keine Probe;
      - ein älterer laufender Statuszyklus bedient die Anforderung nicht;
      - Linkwechsel während der Lesung → keine Probe;
      - idle mit eingereihtem MDI nach einem Gateway-Neustart → keine Ruhe, keine Probe;
      - belegt leerer Kanal → Probe;
      - begrenzt geleerter Kanal → Probe;
      - Grenze ausgeschöpft → Verweigerung.
    - Initialisierung bzw. Reset vergeben Marken neu erst nach dieser Probe.
  - Reservierung scheitert (Datei nicht schreibbar) → Start verweigert, nichts an den Controller geschrieben.
  - Die Darstellungsgrenze und die Golden-Fälle bleiben.
  - Golden auf dem echten Interpreter: Marke 1, 4 194 304 und 9 999 999 kommen exakt zurück; ein Wert mit Nachkommastellen wird verworfen.
- **Schreibzuständigkeit:**
  - Ausgangslage: gespeicherter Wert 0,20, Controller 0,20, lokaler Entwurf 0,05.
  - Kalibrieren + Abort → Controller bleibt 0,20; der Kalibrierauftrag sendet kein 3032.
  - Ein 3032 von der Seite wird für jeden Zweck verweigert.
  - A übernimmt; B bearbeitet nur Feed, speichert und startet einen Probe → der Offset bleibt A's Wert; B's Speicherung trägt keinen `calOffset`, und B's Auftrag bekommt `#3032` vom Gateway.
  - Kandidat bei inzwischen geänderter Bezugsrevision → nicht angeboten.
  - Einheitenwechsel → benannte Verweigerung.
  - Metrisches Formular unter G20: Kalibrierung verweigert vor jeder Schreibung, auch beim ersten Kalibrieren ohne Datensatz. Ein normaler Antastauftrag nach einem Wechsel auf G20 wird ebenso verweigert; der Wechsel zwischen Zulassung und `CALL` (ein anderer Client sendet G20) wird an der Schreibung erkannt.
  - Migration bei anderer aktueller Programmeinheit: Der Datensatz trägt die deklarierte Altbasis, nicht die Programmeinheit.
  - `LINEAR_UNITS` nicht lesbar: Einheit `unknown`, keine Maschinenübernahme.
  - Fehlender bzw. ungültiger Altwert: `state: none`, benannte Verweigerung.
  - Eine alte Client-Speicherung mit `calOffset` nach der Migration: verworfen, keine erneute Migration.
- **Ausgänge:**
  - Store verweigert → `refused`, Kandidat offen.
  - Store erfolgreich, danach NML verweigert bzw. Zeitüberschreitung → `saved_not_written` bzw. `saved_write_unknown`.
  - **Am echten Helfer (fake linuxcnc), Codex' drei Fälle:**
    - Zulassung am Moduswechsel verweigert → Chunk `not_written`, 0 Schreibungen;
    - Zulassung unmittelbar vor `#3032` verweigert → `not_written`;
    - `#3032` gesendet, dann Zeitüberschreitung → `written_unknown`, 1 Schreibung.
    - Dazu (R441):
      - Schreibaufruf begonnen und wirft → `written_unknown`, obwohl `written` nie lief.
      - Cancel während eines blockierten Aufrufs → wartet das Ende ab, dann `saved_write_unknown`.
      - Aufruf kehrt zurück und das Warten läuft ab → `written_unknown`.
      - Positives Ende → `taken`.
      - Ein Moduswechsel bucht keinen Chunk.
  - NML übernommen, danach Dateifehler → `taken_persist_unconfirmed`.
  - Apply gegen Apply, Discard und Reset aus zwei Clients → genau eine Entscheidung.
  - Antwortverlust nach dem Speichern → der Status zeigt `applied`, eine Wiederholung sagt „Already applied“.
  - Entwaffnen bzw. Funktion aus während des Wartens.
  - Für keinen dieser Fälle wird ein unbewiesen unveränderter Maschinenwert angezeigt.
- **Interpreter:**
  - Golden auf dem echten Interpreter: Die geänderten Routinen schreiben `#3032` nicht und liefern Marke und Wert. Am simulierten Ring der Sim rechnen sie mit `[0]` exakt wie das Original mit `#3032 = 0` (Vergleich alt/neu).
  - Native Fälle (`p5`-Variante):
    - Kalibrierung → Kandidat → Apply → `#3032` per Synch gelesen;
    - Kalibrierung → Abort mitten in der Messung → Controller und Datensatz unverändert.

### P5-2 · W1 Feldzustände und Maschinenzeile (MT439-08)

**Heute:**
- **Speicherstand:** Der Ledger (`settingsSaveStatus.ts:35–55`) kennt je Sektion Revisionen (`rev`, `sentRev`, `ackedRev`, `failedRev`), aber **keine Feldmenge und keine gesendeten Werte**.
- **Entwürfe:** `updateServerCache` erhält Entwürfe je Sektion (`defaults.ts:280–288`).
- **Schreiben zur Maschine:** `saveParams` sendet bei `ready` sofort `set_params` an die Maschine (`ProbePanel.vue:196–207`); sonst schreibt erst der nächste Antastauftrag.
- **Buchung:** Die Gateway-Buchung `_ts_book` **verwirft** jeden Schlüssel außerhalb `TOOLSETTER_BASIS_KEYS` (`gateway.py:5914–5916`). Von den Probe-Nummern enthält diese Liste nur 3014 (`gateway_util.py:6117`). Für die Probe-Parameter gibt es heute **keine** Buchung; v2 behauptete das Gegenteil, R440 hat es korrigiert.

**Vertrag:**

*(a) Feldbezogene Daten (Seite, ein Helfer `fieldStates(section, form)`):*
- **Je Sektion und Feld:**
  - der lokale Wert;
  - der vom Server **gehaltene** Wert (`_confirmed[section][key]`, nach jedem Server-Blob, auch nach fremden Clients und bestätigten Beacons);
  - je gesendeter Speicherung ihr **Schnappschuss** der kanonischen Feldwerte, nach `req_id` und Revision;
  - ihr Ausgang (Ack, Ablehnung samt Grund).
- **Feldänderung als Identität (R440):**
  - Jede lokale Bearbeitung eines Feldes erzeugt eine neue **Änderungs-ID** (`change` je Feld, monoton), auch wenn ihr Wert einem früheren gleicht.
  - Der Schnappschuss einer gesendeten Speicherung hält je Feld die Änderungs-ID, die er trägt.
  - Ein Ausgang (Ack, Ablehnung, Blockade vor dem Senden durch `noteSaveBlocked`) gehört genau den Änderungs-IDs seines Schnappschusses bzw. der blockierten offenen Änderung.
- **Zustand eines Feldes:**
  - **neutral**: lokaler Wert gleich gehaltener Wert. Gilt auch bei Rückkehr zum alten Wert und auch, wenn ein anderer Client oder ein Beacon ihn gesetzt hat.
  - **refused**: Die **aktuelle** Änderungs-ID des Feldes hat einen Ablehnungs- bzw. Blockadeausgang, und der Server hält einen anderen Wert. Eine frühere Änderung mit gleichem Wert vererbt ihren Ausgang nie. Die Änderung eines anderen Feldes löscht einen Feed-Fehler nicht.
  - **draft**: sonst, wenn lokaler und gehaltener Wert verschieden sind (pending, unterwegs, offline).
- **Ein Ack** macht nur die Felder neutral, deren Wert es tatsächlich bestätigt; maßgeblich ist der Server-Blob, nie das Ack allein. Ein schon bestätigtes Feld bleibt neutral, auch wenn ein anderes noch offen ist.

*(b) Maschinenbuchung je Schlüssel (Gateway, `probe_booking` im Status), **neu aufgebaut** (`_probe_book`, gefüttert vom erweiterten `_apply_probe_vars_detail` je Chunk-Zustand); keine bloße Veröffentlichung von `_ts_book`:*
- **Inhalt je geschriebenem Schlüssel:** kanonischer Wert, Ausgang (`applied` / `unknown` / `refused` / `read`), Zeit, **Link**, Auftragsart (`probe`, `calibration` mit `#3036`, `surface` `#3050–3059` + `#3014/#3021`, `set_params`, `cal_apply`).
- **„Gelesen“ und „gebucht übernommen“ bleiben unterscheidbar:** `read` stammt nur aus einer bestätigten Synch-Lesung.
- **Gültigkeit:** Ein Linkwechsel macht alle Einträge ungültig: Sie gelten dann als „unknown“, nie als „on the machine“.
- **Wirkungsklassifikation jedes Textes, den das Gateway sendet (R441):** MDI-Zeile, Makro, Programmstart, Routinenaufruf. Es gibt drei Ausgänge:
  - **belegte Schlüsselmenge**: genau diese Probe-Schlüssel werden „unknown“, **vor** dem Senden;
  - **belegt keine**: die Buchung bleibt;
  - **unbekannt**: **alle** Probe-Schlüssel werden vor der möglichen Wirkung „unknown“.
- **Der Klassifikator** ist `toolsetter_assigned_keys` (`gateway_util.py:6121ff.`), verallgemeinert auf einen Schlüsselbereich (`param_assigned_keys(text, env, keys)`). Ein Leser, zwei Bereiche.
  - **Bauhinweis (R442):** Die Verallgemeinerung reicht bis in `RemapEnv` und seine Ergebnisse und Caches; heute filtert es auf `TOOLSETTER_BASIS_KEYS` (`gateway_util.py:~5185`). Wächter: ein Remap, dessen Rumpf `#3015` schreibt.
  - Seine Regeln gelten unverändert:
  - **Berechnete Ziele** sind unbekannt: `#[3000+15]=30`, `##1=30` nach `#1=3015`, `#ABS[…]=`.
  - Ein **Aufruf in eine andere Datei** (o-word ohne eigene Definition im Text, M98) ist unbekannt, auch wenn die Datei gefunden wird; eine auflösbare Datei ist kein Negativbeweis. Das gilt auch für ein per generischem MDI gesendetes `o<shop_probe> call`.
  - Ein **remappter Code** trägt die Wirkung seines Rumpfs über `RemapEnv`.
  - Ein Programmstart ist unbekannt (das ganze Programm wird nicht als Nachweis analysiert).
- **Eigene Antast- und Kalibrieraufträge:**
  - Ihr Routinenaufruf trägt eine **belegte Schlüsselmenge** nur, wenn der Interpreter genau die **gebündelte** Datei auflöst (derselbe Pfad wie die Makro-Auflösung) und ihre erreichbaren Schreibungen über alle Unteraufrufe festgehalten sind: eine Tabelle je Routine, ein Repo-Wächter liest die gebündelten Dateien nach. Die Menge ist nicht immer leer: `touch_probe_param_update.ngc` schreibt `#3014–#3017…`, `surface_scan_param_update.ngc` `#3050–#3054`, `probe_spindle_nose.ngc` `#3010` (außerhalb des Probe-Bereichs).
  - Die geprüfte Routine umfasst ihre **tatsächlich aufgelösten** Unteraufrufe (Bauhinweis R442).
  - Diese Schlüssel werden vor dem Aufruf unknown.
  - Ist eine Routine nicht belastbar auszuwerten oder kommt die Datei woanders her, ist der Aufruf unbekannt.
  - Danach buchen sie genau ihre positiv belegten Chunk-Werte (`taken`), aber **nur für Schlüssel außerhalb** der Wirkungsmenge der Routine.
  - Eine **spätere** Entwertung macht kein alter Chunk-Wert von vor dem `CALL` rückgängig, nur eine spätere eigene Schreibung oder eine bestätigte Lesung (Bauhinweis R442).
- **Eine alte Kalibrierroutine**, deren direkte `#3032`-Schreibung nur noch als Warnung hereinkommt, macht `#3032` unknown.
- **Wiederhergestellt** wird ein Eintrag durch die nächste eigene Schreibung oder eine bestätigte Synch-Lesung.
- **Benannte Grenze:** Schreibungen, die das Gateway nicht sieht, kann die Buchung nicht erkennen: andere GUIs bzw. NML-Clients, `halcmd`, eine Routine, die außerhalb jedes vom Gateway gesendeten Auftrags läuft. „On the machine — written 05:12“ heißt deshalb: **so von diesem Gateway geschrieben und seitdem durch nichts überschrieben, was es gesehen hat.**
- **Die Sektionszeile** vergleicht die Werte, die der nächste Auftrag dieses Formulars schreiben würde, mit der Buchung, Schlüssel für Schlüssel. Ein neuer Entwurf, ein neuer gespeicherter Wert, eine fremde Schreibung oder ein Linkverlust verwendet keinen alten Vollständigkeitsnachweis weiter.

*(c) Texte (nur was eine gültige Buchung bzw. der tatsächlich ausstehende Schritt belegt):*

| Lage | Zeile |
|---|---|
| alle gemeinten Schlüssel `applied`/`read` mit diesen Werten auf dem aktuellen Link | „On the machine — written 05:12“ |
| gespeichert, `set_params` unterwegs (bereit) | „Writing to the machine…“ |
| gespeichert, nicht bereit (kein Schreibweg jetzt) | „Saved — written to the machine with the next probe“ |
| ein gemeinter Schlüssel `unknown` oder ohne Buchung nach einem Versuch | „Saved — machine value unknown for Slow Feed“ |
| teils übernommen | „Partly on the machine — Slow Feed not written“ |
| Entwurf bzw. Ablehnung **mit** gültiger Buchung des Feldes | „… not saved … · on the machine: 25.0 (written 05:12)“ |
| Entwurf bzw. Ablehnung **ohne** gültige Buchung | „… not saved … · machine value unknown“ |

*(d) Das globale Muster (neu, Form zur Freigabe durch den Operator):*
- `FormField` bekommt `state: "draft" | "refused" | null`.
- **Entwurf** = 3-px-Balken in `--warn` an der Vorderkante plus `--tint-faint`.
- **Abgelehnt** = Balken in `--danger`, der Grund als Fehler unter dem Feld.
- **Gespeichert = neutral** (Operatorentscheidung).
- Der Zustand steht zusätzlich im `aria-describedby`.
- **Einführung:**
  1. Probing-Parameter (P5);
  2. Toolsetter und G30 in einer zweiten Stufe;
  3. danach Einstellungsformulare und Werkzeugeditor.

**Wächter:**
- **Feldzustände:**
  - Feed geändert und gesendet, danach Clearance geändert, das erste Ack kommt → Feed neutral, Clearance bleibt Entwurf.
  - Eine ältere Ablehnung für Feed markiert einen späteren Feed-Entwurf nicht als abgelehnt.
  - Codex' Gegenfälle (R440):
    - Server 25; Feed 50 abgelehnt → 60 → 50 ungesendet → **draft**, nicht refused;
    - dieselbe Folge mit inzwischen geändertem Arm-Zustand;
    - verspätete Ablehnung der ersten 50 nach dem Versand der zweiten 50 → betrifft nur Änderung 1;
    - Clearance geändert, Feed unverändert, Speicherung abgelehnt → Feed neutral;
    - ein bestehender Feed-Fehler bleibt, wenn danach Clearance geändert wird.
  - Zurück zum alten Wert → neutral.
  - Ein fremder Client setzt denselben Wert → neutral.
  - Ein Beacon gilt erst nach dem Server-Blob.
  - Eine alte Antwort nach einer neueren Speicherung ändert nichts.
- **Buchung:**
  - normale Probe ohne `#3036`, Kalibrierung mit `#3036`, Scan nur mit seinen Schlüsseln;
  - teilweise übernommen;
  - `unknown` nach einem Chunk-Fehler;
  - Linkwechsel → unknown;
  - `read` gegen `applied` unterscheidbar.
  - Eine direkte MDI-Zeile `#3015=30` → dieser Schlüssel unknown.
  - Codex' Fälle (R441): `#[3000+15]=30` → alle unknown; `#1=3015` dann `##1=30` → alle unknown; generisches `o<shop_probe> call` mit gefundener Datei → alle unknown, **vor** dem Senden.
  - Ein Makro, ein Programmstart bzw. ein nicht auflösbarer Aufruf → alle unknown.
  - Die Warnung einer alten Kalibrierroutine → `#3032` unknown.
  - Ein eigener Antastauftrag mit einer gebündelten, geprüften Routine → nur seine Chunk-Werte; dieselbe Routine aus einer anderen Datei im `SUBROUTINE_PATH` → alle unknown.
  - Ein Remap-Rumpf, der `#3015` schreibt → `#3015` unknown (bzw. alle, wenn er nicht auswertbar ist).
  - Ein Chunk-Wert von vor dem `CALL` hebt eine spätere Entwertung nicht auf.
  - Der Repo-Wächter über die gebündelten Routinen hält die Schreibtabelle je Routine. Eine neue oder geänderte Zuweisung an `#3014–#3059` lässt ihn scheitern, bis die Tabelle nachgezogen ist.
- **Texte:** je Zeile der Tabelle; „machine keeps …“ ohne gültige Buchung → unknown.
- **Muster:** Kontrast (Balken 3 : 1 gegen das Feld), `forced-colors`, die Audits; die Referenzbilder der Probe-Ansichten neu erzeugt.

### P5-3 · W3 Kalibrier-Offset präsent

Ist in P5-1 (e) enthalten. Die Ausgabe am Ende der Parameterliste zeigt jetzt den Datensatz `probeCalibration`, nicht mehr das Formular.

**Wächter:**
- Der Block steht in jeder Breite direkt unter den Zellen.
- Kandidat samt Apply/Discard ist ganz sichtbar, auch im schmalen Seitenbereich; Reset ist erreichbar.
- Der Block läuft nicht seitlich über (`sidewaysOverflow`).

**Nebenbefund (vorbestehend, nicht P5):** Die Kalibrieransicht läuft im schmalen Seitenbereich bei 150 % schon heute seitlich über, gemessen 356 statt 272 CSS-px ohne die Prototyp-Blöcke. Der Layout-Audit erfasst das bisher nicht. Es wird im Bau mit behoben oder als eigener Punkt geführt; keine bestandene Layoutabnahme.

### Reihenfolge im Bau

1. P5-1 (a)–(d): Routinen mit Laufmarke, Gateway-Lauf, Datensatz `probeCalibration` samt Migration, Schreibzuständigkeit, Kandidatensperre und Ausgänge, Golden-Test und native Fälle.
2. P5-1 (e) + P5-3: die Seite.
3. P5-2: feldbezogene Daten, `probe_booking`, Texte, Muster für die Probing-Parameter.
4. P5-2 zweite Stufe (Toolsetter, G30) als eigenes Teilpaket.

**Erbeten:** `agreement` zum Plan v5 oder `findings`. Die Bedienfragen O-1 bis O-4 stelle ich dem Operator zusammen mit den Renderings.

### Fragen an den Operator (nur Claude fragt)

- **O-1 (Renderings):** Gefällt das Feldmuster? Entwurf = Amber-Balken + leichte Tönung, abgelehnt = roter Balken + Grund, gespeichert = neutral. Steht der Maschinenzustand **einmal** pro Abschnitt?
- **O-2:** Darf ein zweiter (bewaffneter) Client den Kandidaten übernehmen oder verwerfen, oder nur der Client, der die Kalibrierung gestartet hat? Empfehlung: jeder bewaffnete Client; Arm ist die Berechtigung, und es ist eine Maschine.
- **O-3:** Wurde der Lauf nach der Messung abgebrochen (im Rückzug), wird das Ergebnis **nicht** angeboten. Einverstanden? Empfehlung: ja, nur ein vollständiger Lauf liefert einen Kandidaten.
- **O-4:** Soll der Block „Calibration Offset“ unter den Zellen stehen (Rendering)? Die Zellen bleiben dort in jeder Prozedur an ihrem Platz. Oder darüber, dann rutschen die Zellen in dieser Ansicht nach unten?
