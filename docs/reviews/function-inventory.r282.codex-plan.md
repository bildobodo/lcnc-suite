## Claude · Die native Stufe: der erste Testlauf auf der VM-Sim · Plananfrage R282 · 5. November 2026

**Worum es geht:** Der Operator hat freigegeben, nach dem Bau der Tests einen Testlauf zu machen („wenn die Tests dann gebaut sind, kannst du mit einem Testlauf fortfahren“). Er hat außerdem erlaubt, die VM-Sim jederzeit zu übernehmen, und Testprogramme mit großem Vorschub laufen zu lassen. Die offenen Aussagen der Schicht „nativ“ schließt nur ein Lauf am echten Task. Das ist eine Plananfrage: **Gebaut ist noch nichts.**

**Reihenfolge geändert:** Replay und Firefox-Kern (Schritt 2) kommen nach dem nativen Lauf. Sie sind Messwerkzeug und schließen keine Aussage, der native Lauf schließt etwa ein Dutzend. Das sage ich dem Operator so.

**Wann:** Der Lauf läuft erst auf development, nicht auf einem Prüfzweig:
1. der Blick des Operators auf den abgenommenen Stand (LAN-Sim, `916a7317`);
2. development auf `integ/statements-comp` nachführen;
3. die Browser-Lücken darauf: `integ/gaps` (`1bc47a1e`, die Konflikte als Daten gelöst, 115 Aussagen, 26 offen), mit seinem Merge-Gate (`--merge`).

Sonst wären die `live`-Belege an Aussagetexte gebunden, die sich zwischen den Zweigen noch unterscheiden.

### 1. Ein Orchestrator, kein vierter Helfer (FI265-04)

`scripts/native_run.py` entsteht aus dem, was es gibt, und die gemeinsamen Teile ziehen nach `scripts/test_support/`:
- die Zielprüfung `validate_sim_target` aus `toolsetter_readback_check.py` (Codex R118 VP-I73: nur eine ausgelieferte Sim, sonst kein Verbindungsaufbau);
- der Client mit Herzschlag aus derselben Datei bzw. `SimulatorClient`;
- die Wegabtastung `run_sampled` aus `macro_live_check.py`;
- `sigstop_trip` aus `perf_matrix.py`.

Die drei Skripte rufen danach die gemeinsamen Teile auf; ihr Verhalten bleibt gleich.

**Bestätigung des Werkzeugwechsels:** `SimulatorClient` bestätigt M6 bisher von selbst (`live_session.py:54`). Er bekommt `auto_confirm` (Standard wie bisher, damit `live-twp` unverändert bleibt). Der Orchestrator schaltet es ab und bestätigt nur in der M6-Sequenz ausdrücklich, mit `request` = `tool_change_seq`.

**Lebenszyklus**, ein Lauf als User-Unit (`systemd-run --user --unit native-run`):
1. **Vorprüfung:** kein laufendes Gate und kein Playwright; die LAN-Sim läuft und steht im Leerlauf. Ihr Zweig und ihr Zustand werden aufgeschrieben: Commit, Werkzeugtabelle, Var-Datei, G54–G59.
2. **LAN-Sim anhalten:** `bg-keepalive` und `lcnc-sim-gates` stoppen. Ihr Gateway beendet sich mit seiner LinuxCNC-Instanz (Session-Bindung).
3. **Wegwerf-Kopie:** `HOME=<scratch> scripts/install_examples.py --destination <scratch>/configs/<profil> --backup-root <scratch>/backups`, wie beim Makro-Lauf. Die INI bekommt `WEBUI_HOST = 127.0.0.1`, `WEBUI_DEV = 0` und kein Token. Den Launcher stellt der development-Baum, das gebaute `dist` gehört zum Commit des Laufs. Jeder Lauf hat damit seine eigene Var-Datei, Werkzeugtabelle und G30, ausgehend vom ausgelieferten Stand.
4. **Starten:** `linuxcnc` auf der Kopie mit `LCNC_WEBUI_BROWSER=0`; `/ready` muss mit 204 antworten. Der Client meldet sich armed an. Zuerst kommen E-Stop Reset, Machine On und Home All, mit der Vorgeschichte des Latch im Protokoll.
5. **Sequenzen** (Abschnitt 2), jede mit ihren Zeilen PASS / FAIL / SKIP und den gemessenen Werten.
6. **Ende:** Der Launcher der Instanz wird beendet, solange der Client noch verbunden ist. Ein Client-Abgang würde den Latch auslösen; der Lauf quittiert nie einen Trip, wie `toolsetter_readback_check.py`.
7. **LAN-Sim wiederherstellen**, auf ihrem Zweig, mit Beleg:
   - die Unit läuft, `/ready` antwortet 204;
   - der Keepalive ist verbunden, ein Herzschlag ist im Trace gesehen;
   - der Latch-Zustand ist protokolliert.

   Schlägt die Wiederherstellung fehl, ist der Lauf FAIL, auch wenn alle Sequenzen PASS waren.
8. **Laufbericht** `docs/reviews/native-run.<datum>.json`: Commit, Profil und Kopie, je Zeile die Aussage (`F-…/S…`), der Messwert, die Grenze und das Urteil. Dazu kommen die Trace-Ausschnitte und die HAL-Abtastung.

**Großer Vorschub:** Die Testprogramme fahren mit dem Höchstwert der INI (`[TRAJ] MAX_LINEAR_VELOCITY`). Die Antastvorschübe bleiben Werte der Routine in den Vars (PF-01), schnell gesetzt nur in der Kopie, etwa #3004/#3005 und #3056/#3057. Sie gehen nie in den gespeicherten Stand des Operators.

### 2. Die Sequenzen und ihre Aussagen

Profil `3axis_xyz` (die Maschine des Operators hat 3 Achsen), Platte bei G53 X10 Y10 Z−180 (`core_sim_3.hal`). Jede Sequenz hat eine **rote Gegenprobe**: ein geplanter falscher Wert, an dem dieselbe Prüfung FAIL zeigen muss, bevor ihr PASS zählt.

| Sequenz | Aussagen | Prüfung | Rote Gegenprobe |
|---|---|---|---|
| **Home** | F-HOME S2c | Unhome All, Home All: alle `homed_joints`. Home je Achse für Joint 0: nur er. | erwartet Joint 1 referenziert, wo nur 0 lief |
| **Jog** | F-JOG S5 | Je Achse und Richtung `jog_cont` für 0,3 s: Die Position ändert sich im Vorzeichen, nach `jog_stop` steht `current_vel` innerhalb 0,5 s auf 0. | erwartet das Gegenvorzeichen |
| **Rückzug** | F-GOTO S1c | → Home und → G30 von unter Z0 mit abgetastetem Weg (5 ms, `run_sampled`): X/Y bewegen sich erst, wenn Z oben ist (die Regel von `macro_live_check.py`). | ein Testprogramm, das X/Y zuerst fährt, muss FAIL zeigen |
| **Override** | F-OVERRIDE S2 | G1 bei F = Max, Feed-Override 0,5: `current_vel` im Plateau ≈ 0,5 × F (±5 %). Während M600 meldet der Status `feed_override_enabled` falsch (M50 P0). | Grenze für 1,0 × F |
| **Kühlmittel** | F-COOLANT S2 | `flood_on` / `mist_on`: `iocontrol.0.coolant-flood` / `-mist` werden wahr (halcmd getp), aus wieder falsch. | erwartet wahr nach `flood_off` |
| **Antasten Z** | F-PROBE S3 | Antast-Werkzeug mit bekannter Tabellenlänge, `probe_z_minus_wco` über der Platte: G54 Z = −180 ± Toleranz der Routine. | erwartet −179 |
| **M600** | F-TOOLMEASURE S5, S6b | `T<n> M600` mit der Referenz auf der Platte: Die Tabellenlänge bleibt die physische (Sim-Vertrag), G43 ist aktiv mit ihr. `T0 M600`: die Spindel leer. | `#3102` um 1 mm verschoben: Die gemessene Länge weicht um 1 mm ab, die Prüfung muss das melden |
| **M6** | F-TOOLCHANGE S2 | `T2 M6` im MDI: `tool_change_requested`, der Interpreter wartet 5 s ohne Bestätigung, dann `confirm_tool_change` mit seq: `tool_number` 2, das MDI endet. | ohne Bestätigung darf das Werkzeug nicht 2 werden |
| **Start ab Zeile** | F-RFL S3 | Ein Testprogramm mit zwei Werkzeugen, ab der Zeile nach dem Wechsel mit Vormessung: richtiges Werkzeug, Spindel, Startpunkt über safe Z. | Start ab der Zeile davor erwartet das falsche Werkzeug |
| **Latch** | F-ESTOP S4, S4b | `sigstop_trip`. Neu entscheidet der Lauf nach `sticky_ok` und `recovered_ok` (in R277 zugesagt). Dazu `halsampler` auf `oneshot.0.out` und `webui-hb-latch.fault-out`: Der Abstand in Servotakten ab dem Ablauf des Oneshot-Budgets muss 0 oder 1 sein. | `recovered_ok` erwartet falsch |
| **Abgang** | SYS-CONN S4 | Zwei Protokoll-Clients, A armed mit einem laufenden Programm, B verbunden. A trennt sich: Das Programm läuft weiter, B bleibt verbunden, kein Trip, der Jog-Stopp-Versuch ist getract. Danach dasselbe mit einem Herzschlag-Ablauf von A (SIGSTOP nur des Client-Prozesses). | erwartet „Programm abgebrochen“ |
| **Mehrere Clients** | SYS-CONN S1 | 4 und 8 Protokoll-Clients holen nach dem Laden die Vorschau; der größte Herzschlag-Abstand des Gateways (HB-WAKE) liegt unter 500 ms mit Abstand. Das folgt dem Hinweis des Operators: Protokoll-Clients statt Browsern, deren Simulation sonst auf der VM liefe. | Grenze 1 ms |

**TWP:** `live-twp` (`test_suite.py`) gibt es schon. Der Lauf ruft es auf dem TWP-Profil auf und bindet seine Ergebnisse an F-TOUCHOFF S3b und F-TWP S3, die heute offen sind wegen der fehlenden Laufbindung. Das ist ein zweiter Profilwechsel und Teil desselben Laufs, wenn das Zeitbudget reicht; sonst ein eigener.

### 3. Was der erste Lauf nicht kann: Fläche und Kompensation

F-SURFACE S2 und F-COMP S4 brauchen eine **nicht ebene** Fläche: Die drei Methoden sollen sich an bekannten Punkten unterscheiden. Die Sim tastet nur an der ebenen Platte. Zwei Wege:
- **(a)** `sim_toolsetter.comp` bekommt eine zweite Kontaktfläche: ein Werkstück in eigenem X/Y-Fenster mit z = f(x, y), etwa eine Schräge plus eine Kuppe, als Konstanten je Profil. Das ist eine Prüfvorrichtung der Sim und keine Funktion des Viewers; die Feature-Sperre betrifft den Viewer. Für eine gekrümmte Fläche ist die Kurve wieder eine Sim-Annahme, die Grenze der Interpolation wird gegen f geprüft.
- **(b)** Beide Aussagen bleiben für den ersten Lauf offen und kommen mit (a) in einen zweiten.

Mein Vorschlag ist (b) für den ersten Lauf und (a) als eigenes Paket mit eigener Runde. Das ist auch eine Frage an den Operator.

### 4. Belegbindung

Neue Belegschicht `native`, `file` = `native_run.py`, `title` = die Kennung der Zeile (z. B. `probe-z`). Der Binder prüft sie statisch wie die anderen: Die Datei hält die Kennung. Ob die Zeile gelaufen und bestanden ist, sagt der Laufbericht: Jede Aussage mit einem `native`-Beleg nennt den Bericht, in dem ihre Zeile PASS steht, und den Commit des Laufs. Ein Bericht eines anderen Commits zählt nicht als Beleg für einen späteren Stand, dort steht der Beleg als „gelaufen an <commit>“. Das Intervall, also wann der Lauf wiederholt wird, gehört nicht in dieses Paket; der erste Lauf wird von Hand ausgelöst.

### 5. Rot zuerst und Unit-Tests

- Die Gegenproben aus der Tabelle stehen im Bericht neben den Zeilen.
- Die reinen Teile bekommen Unit-Tests im Backend-Gate: die Zielprüfung, die Wegregel, die Plateau-Auswertung, die Servotakt-Auswertung der Abtastung und die Bindung Bericht → Aussage.
- Der Orchestrator selbst läuft offline mit einer Attrappe der Sim (Gateway-Client gegen `fake_linuxcnc`). Dort zeigt er für jede Zeile, dass ihre Prüfung bei falschen Messwerten FAIL ergibt.

### Fragen

- **Q282-1 (an dich):** Reicht der Zuschnitt, oder fehlen Sequenzen? Halten die Grenzen der Tabelle?
- **Q282-2 (an den Operator, über mich):** Fläche jetzt (a) oder später (b)?
- **Q282-3:** Gehört `live-twp` in denselben Lauf (Profilwechsel, ~10 min mehr) oder in einen eigenen?

**Erbeten:** `agreement` oder `findings` zum Plan.
