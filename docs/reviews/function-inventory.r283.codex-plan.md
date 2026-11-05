## Claude · Die native Stufe, Planfassung 2 · Anfrage R283 · 5. November 2026 · die Befunde aus R282

Nichts ist gebaut. Diese Fassung ersetzt die Abschnitte 1, 2 und 4 aus R282, soweit sie den Befunden widersprechen. Der Rest gilt weiter.

### FI282-01 · Der R268/R269-Vertrag gilt unverändert

Mein Satz in R282 („Launcher aus dem development-Baum“, „eine Kopie per `HOME=<scratch>`“) ist **zurückgenommen**. Es gilt der in R269 abgenommene Vertrag FI265-04 vollständig, ohne Abschwächung:
- **Laufbaum:** ein Worktree des geprüften Commits unter `~/claude-work/live-tier/<lauf>/tree`, mit eigenem `BASE_DIR` und eigener `settings.json`. Das Frontend wird darin gebaut, `node_modules` als Hardlink-Kopie.
- **Eigener Launcher:** über `PATH=<lauf>/bin:…`, wobei `<lauf>/bin/lcnc-suite` auf `<tree>/lcnc-suite` zeigt. Damit gehören auch die über PATH gestarteten HAL-Helfer zum geprüften Commit.
- **Konfiguration:** `install_examples.py --repo <tree> --destination <lauf>/config` mit den neuen Optionen für die veränderlichen Pfade (`--nc-files`, `--macro-dir`).
- **Prüfung vor dem ersten Schreiben:** `realpath` jedes veränderlichen Pfads, auch Position (`PARAMETER_FILE`), Logs und `settings.json`. Dazu `PYTHONPYCACHEPREFIX=<lauf>/pycache`, damit kein Python-Cache im Baum oder im LAN-Baum entsteht. Gegenfälle: ein Pfad nach außen und ein Symlink nach außen brechen vor dem Schreiben ab.
- **Nachweis der gestarteten Prozesse:** Kommandozeile und `cwd` von `linuxcncsvr`, Gateway, `hal_reader`, `hal_watchdog` und der Toolsetter-Feed liegen im Laufbaum bzw. in der Kopie-INI. Sonst ist der Lauf FAIL, bevor die erste Sequenz beginnt.
- **Die gemeinsame Sperre** (`flock` auf `~/claude-work/live-tier/heavy.lock`): Sie halten `round_gate.py` und `--merge` vom ersten schweren Abschnitt an, ebenso `perf_matrix`, `repro-load.sh` und die native Stufe. Ein Prozessblick ersetzt die Sperre nicht. Die Sperre baue ich in dieses Paket ein, die Gates nehmen sie im selben Commit.
- **Rückgabe:** als `finally` des Orchestrators und als `ExecStopPost` der Unit, das dasselbe Rückgabeskript startet, falls der Orchestrator stirbt. Gebunden an die vorher festgehaltenen Units (Name, ExecStart, WorkingDirectory), den INI-Pfad und den Code-Stand (HEAD) der LAN-Instanz. Nachweis:
  - dieselben Units laufen neu;
  - die Gateway-INI laut Kommandozeile ist die festgehaltene;
  - der HEAD ist der festgehaltene;
  - die neue LinuxCNC-Instanz ist gebunden (Session-Bindung: `linuxcncsvr`-PID und Startzeit neu, der Gateway-Prozess hängt an ihr);
  - der Keepalive ist verbunden, und sein Herzschlag kommt im Trace der **LAN**-Instanz an;
  - die Hashes der ursprünglichen Bestände sind unverändert (`~/linuxcnc/nc_files`, `macros`, die `settings.json` des LAN-Baums, dessen Konfigurationsverzeichnis).

  `/ready` allein ist kein Nachweis.
- **Ein unquittierter Trip** der LAN-Instanz vor der Übernahme: Der Lauf übernimmt nicht und bricht mit Beleg ab. Ein Trip, den die neu gestartete LAN-Instanz beim Boot meldet (`latch_faulted_on_connect`), wird nur protokolliert und nie quittiert.
- **Neue Abschluss-Gegenfälle (Fake-Sim, offline):**
  - ein Fehler gleich nach dem Stoppen der LAN-Sim;
  - ein `kill -9` des Orchestrators mitten im Lauf.

  In beiden muss die Rückgabe mit vollem Nachweis laufen bzw. als FAIL mit Grund enden, nie still.

### FI282-02 · Szenarioverträge für M6 und den Trip

**M6:** Der Client bestätigt nie von selbst (`auto_confirm=False`). Ein gemeinsamer Helfer `expect_tool_change(tool, deadline)` funktioniert so:
1. Er wartet auf eine **neue** Anforderung (`tool_change_seq` größer als der vorher gelesene Wert) mit `tool_prep_number == tool`.
2. Er bestätigt genau diese `seq` mit `confirm_tool_change {request: seq}`.
3. Er beobachtet den Abschluss: `tool_number == tool`, `tool_change_requested` falsch.

Jede Sequenz deklariert ihre erlaubten Wechsel als Liste:
- Messen `T<n> M600`: `[n]`, wegen `tool_touch_off.ngc:278`.
- Entladen `T0 M600`: `[0]`, Zeile 217.
- Start ab Zeile mit Vormessung: die Wechsel des Vorprogramms und des Programms, ausdrücklich aufgezählt.

Ein nicht deklarierter Wechsel, eine falsche Werkzeugnummer oder ein Timeout bestätigt **nichts**: Die Sequenz endet FAIL, die Instanz wird abgebaut.

Die **M6-Wartesequenz** hält die Bestätigung 5 s zurück und prüft über das ganze Intervall: `tool_change_requested` wahr, `interp_state` nicht idle, `tool_number` unverändert, Abtastung mit 20 Hz. Erst dann bestätigt sie.

**Nach der M600-Gegenprobe** (#3102 um 1 mm verschoben) setzt die Sequenz Tabellenlänge und #3102 auf den festgehaltenen Ausgangswert zurück und liest beide zurück. Grund: Die Sim benutzt die Tabellenlänge als physische Länge, ein falsches Ergebnis wirkte sonst auf den nächsten Versuch.

**Trip:** Die Regel steht im Helfervertrag (`test_support/trip.py`), nicht im Kommentar.
- Quittieren, Arm und Reset darf nur das Latch-Szenario, und nur für den Trip, den es selbst ausgelöst hat. Nachgewiesen wird das so: Latch vorher FALSE, SIGSTOP an den Gateway-Prozess **dieser** Instanz (PID aus dem Prozessnachweis), Latch danach TRUE, dieselbe `linuxcncsvr`-Identität.
- Ein vorher vorhandener oder unerwarteter Trip: Abbruch mit Beleg, nie quittiert, auch nicht im Abschluss.
- Wer SIGSTOP sendet, hält die PID im Laufdatensatz. `finally` und `ExecStopPost` senden SIGCONT an genau diese PID, falls sie noch lebt, bevor die Instanz abgebaut wird.
- Ein ausstehender M6 beim Abbruch wird nicht bestätigt. Die Testinstanz wird abgebaut, die LAN-Instanz ist davon nie betroffen.

### FI282-03 · Die Bindung sagt genau, was geprüft ist

| Aussage | Neue Fassung für den ersten Lauf |
|---|---|
| **F-HOME.S2c** | Home All referenziert alle drei Joints. Home je Achse wird für **jeden** Joint 0, 1, 2 einzeln geprüft: vorher Unhome All, dann Home j, danach nur j referenziert. `applies: ["3axis_xyz"]`. |
| **F-JOG.S5** | Wird geteilt: **S5** „Am echten Task bewegen die Jog-Befehle des Gateways (`jog_cont` / `jog_stop`) jede Achse in ihrem Vorzeichen und halten sie an“ (nativ, `3axis_xyz`). **S5b** „Jeder Jog-Knopf und sein Loslassen senden diese Befehle“ ist im Browser schon belegt (Strip- und Tastatur-Tests) und wird so zugeordnet. |
| **F-GOTO.S1c** | Die drei tatsächlichen Bedienwege, wie die UI sie auslöst (`App.vue:2716–2718`): `go_to_zero` (Gateway-Befehl), `O<go_to_home> CALL` und `O<go_to_g30> CALL` als `mdi`. Der Weg-Sampler ist vom Auslösen getrennt (`test_support/path.py`, Servo-Abtastung, siehe FI282-05). Kein Makro als Ersatz. |
| **F-OVERRIDE.S2** | Dreigeteilt: **S2** Feed-Override wirkt (nativ), **S2b** während M600 meldet der Status `feed_override_enabled` falsch (nativ), **S2c** dasselbe im Surface-Scan (offen bis zu seinem Lauf). |
| **SYS-CONN.S4** | Enger: „Trennt sich ein gearmter Client oder läuft sein Herzschlag ab, läuft ein AUTO-Programm weiter, und ein zweiter Client bleibt verbunden.“ Den Jog-Stopp beim Abgang belegt der vorhandene Gateway-Test (`test_the_disarm_stop`, SYS-CONN.S3). |

**`applies`:** Jede native Wirkung bekommt den tatsächlich geprüften Fall (`3axis_xyz`, Modus Machine). Das gilt auch für bisher mit „offen“ oder „alle“ geführte Aussagen. Andere Profile und Modi bleiben eigene, offene Zeilen.

**Belegbindung**, neue Schicht `native`:
- Die Evidenz trägt `file: "native_run.py"`, `title: <Fall-ID>`, `profile` und `variant`.
- Statisch prüft der Binder wie bisher nur, dass die Datei die Fall-ID enthält; die Tabelle zeigt das als „benannt“.
- „Belegt“ im Sinne eines Laufs heißt: Ein Laufbericht nennt **denselben Commit wie der geprüfte Stand**, dasselbe Profil, denselben Fall und dieselbe Variante mit `PASS`.
- Kein PASS ergeben: eine fehlende Zeile, `SKIP`, `incomplete`, ein Bericht eines anderen Commits, ein anderes Profil, eine andere Variante. Ein älterer Bericht erscheint als „gelaufen an <commit>“.
- Binder-Tests decken genau diese Gegenfälle ab.

### FI282-04 · S4b heißt „derselbe Servotakt“

- **Messposition:** In der Kopie (nie in der LAN-HAL) lädt der Lauf `sampler` mit `cfg=bb`: `oneshot.0.out` und `webui-hb-latch.fault-out`. `addf sampler.0 servo-thread` hängt ihn **ans Ende** des Servo-Threads, also nach `oneshot.0` und `webui-hb-latch` (`lcnc_webui.hal:26,49`). Er erfasst beide Zustände aus demselben Durchlauf. `halsampler -t` liest mit fortlaufenden Sample-Nummern. Ein Überlauf (`sampler.0.overruns > 0`) oder eine Lücke in den Nummern macht den Fall `incomplete`, nie PASS.
- **Entscheidung:** Im ersten Sample, in dem `oneshot.0.out` nach SIGSTOP FALSE ist, muss `fault-out` TRUE sein. Toleranz: keine.
- **Gegenprobe nativ:** dieselbe Kopie mit umgekehrter `addf`-Reihenfolge (`webui-hb-latch` vor `oneshot.0`). Damit sieht der Latch den Ablauf genau einen Takt später, und die Prüfung muss rot werden. Dazu offline ein synthetischer Strom mit einem Takt Verzug und einer mit Überlauf.
- S4 (Recovery: `sticky_ok`, `recovered_ok`) bleibt davon getrennt und wird jetzt entschieden statt nur aufgezeichnet.

### FI282-05 · Die Grenzen vor dem Lauf

Profil `3axis_xyz`, Werte aus der INI:
- **Wege:** X 0…685, Y 0…705, Z −190…0,1 mm.
- **Achsen:** `MAX_VELOCITY` 100/100/80 mm/s, `MAX_ACCELERATION` 750 mm/s².
- **Takt und Bahn:** Servotakt 1 ms; `[TRAJ] MAX_LINEAR_VELOCITY` 100 mm/s = **F6000** in G21/G94. `current_vel` ist in mm/s (Maschineneinheit je Sekunde).

| Messgröße | Aufbau | Erwartung und Grenze |
|---|---|---|
| **Feed-Override** | `G90 G21 G94`, Start G53 X100 Y300 Z−50, `G1 X500 F6000`. Plateau-Fenster: X 150…450, mit 50 Hz STAT abgetastet und nach Position gefiltert. Beschleunigungsweg 100²/(2·750) = 6,7 mm. | Ohne Override: Median 100 mm/s ± 5 %. Mit 0,5: 50 mm/s ± 5 %. Weniger als 20 Samples im Fenster heißt `incomplete`. |
| **M600-Sperre** | Während `T1 M600`. | `feed_override_enabled` falsch in jedem Sample zwischen Routinebeginn und -ende, zurück auf wahr danach. |
| **Jog** | Start G53 X300 Y300 Z−50, je Achse und Richtung `jog_cont` mit 50 mm/s für 0,3 s, dann `jog_stop`. | Weg ≥ 5 mm im Vorzeichen. Stillstand (`|current_vel|` ≤ 0,001) innerhalb 0,5 s; Modell v/a + 4 T = 0,071 s. Bremsweg ≤ v²/(2a) + 2·v·4T = 2,1 mm. |
| **Antasten Z** | Antast-Werkzeug T99 mit Tabellenlänge L₀ = 50,000 mm, **vor** dem Versuch gesetzt und zurückgelesen. G54 vorher alle 0, G92 aus, G43 H99 aktiv. Start G53 X10 Y10 Z−100. `probe_z_minus_wco`, `#3030` = 0 (Z setzen), langsam #3015 = 50 mm/min, schnell #3016 = 200. Erwartet wird aus dem unabhängigen Maß, nicht aus der Tabelle nach dem Versuch. | G54 Z = Platte −180,000. Toleranz aus dem F5-Modell: (1,67 T) · v_langsam = 1,67 ms · 0,833 mm/s = 1,4 µm, plus 1 µm Rundung → **±0,003 mm**. #5070 = 1 (Kontakt) ist Pflicht. Gegenprobe −179: weit außerhalb. |
| **M600** | `T1 M600`, Toolsetter-Werte der Kopie mit der Referenz auf der Platte (#3102 = −180), #3005 langsam = 20 mm/min. L₀ vorher festgehalten. | Tabellenlänge = L₀ ± (1,67 ms · 0,333 mm/s + 1 µm) = **±0,002 mm**, G43-Offset = dieselbe Länge. Gegenprobe #3102 = −179: Abweichung 1 mm, weit außerhalb. Danach Rücksetzen (FI282-02). |
| **Rückzugsweg** | `halsampler` auf `joint.0/1/2.pos-fb` am Ende des Servo-Threads (1 kHz, fortlaufende Nummern). **Beginn:** erstes Sample mit Bewegung > 0,005 mm. **Ende:** `inpos` und Interpreter idle. Start G53 X200 Y200 Z−60. | Bis Z ≥ −0,010 mm bewegen sich X/Y um höchstens 0,010 mm, dazu die G64-P-Toleranz der Routine aus ihrem Text. Ein Überlauf oder eine Lücke heißt `incomplete`. Gegenprobe: ein Testprogramm, das X/Y zuerst fährt, muss FAIL zeigen. |
| **Mehrere Clients** | Programm `perfmatrix-big.ngc` (die bekannte Last). 4 und 8 Protokoll-Clients holen nach dem Laden gleichzeitig `/preview`; Fenster: Laden bis zum letzten Abruf + 5 s. | Messgröße ist der **HAL-Herzschlag**: Abstand der Flanken von `webui-safety.heartbeat` (Signal `webui-heartbeat`, speist `oneshot.0.in`) per `halsampler -t`, dazu `webui-hb-latch.fault-out` nie gesetzt. Grenze: größter Abstand ≤ **250 ms**, die Hälfte des 0,5-s-Budgets. `HB-WAKE` (misst erst über 100 ms, vor dem Senden) wird nur zusätzlich als Sendeschleifen-Messung berichtet. Fehlende Samples heißen `incomplete`, nie 0. |

**Rote Gegenproben,** die die Aussage selbst treffen, nicht nur den Auswerter:
- **Nativ:** geplante falsche Werte (Platte, #3102, XY-zuerst-Programm, umgekehrte `addf`-Folge).
- **Offline am Auswerter:** fehlender Kontakt (#5070 = 0), kein Plateau, eine Weg-Abtastung mit Überlauf, ein fehlender Bericht. Keiner davon darf grün werden.

### Baufolge (Q282-1) und die Profile (Q282-3)

1. **Vertikaler Schnitt:** Sperre, Laufbaum und Kopie, Zielprüfung, Start mit Prozessnachweis, Home/Jog, Bericht, Rückgabe, mit den beiden Abschluss-Gegenfällen. Die Fake-Sim prüft Ablauf und Fehlerwege offline.
2. Antasten, M600, M6, Start ab Zeile.
3. Latch (S4/S4b), Abgang, mehrere Clients.

**`live-twp`:** ein eigener Profil-Lauf desselben Orchestrators, mit eigener Fallliste, eigenem Bericht und eigener Rückgabe. Seine Sitzung und sein Abschluss (`test_suite.py:245–292`) gehen in den Orchestrator über, kein zweiter Orchestrator. Ein ausgelassener TWP-Lauf bleibt offen.

### Q282-2 bleibt beim Operator

Deine Unterscheidung übernehme ich in die Frage an ihn:
- **F-SURFACE.S2** braucht keine gekrümmte Fläche. Ein 3×3-Raster in G53 X 3…17, Y 3…17 innerhalb des Plattenfensters prüft Raster und Punkte (alle bei Z −180) und ginge schon im ersten Lauf.
- **F-COMP.S4** braucht die gekrümmte Prüffläche, als eigenes Paket.

**Erbeten:** `agreement` oder `findings` zur Planfassung 2.
