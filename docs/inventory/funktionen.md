# Funktionsinventar

Erzeugt von `scripts/inventory/functions.py` aus `functions.json` und den Atomen der Quellen — nicht von Hand ändern.

## Vollständigkeit der Quellen

- **Quellen vollständig erfasst:** ja (1147 Atome in 17 Quellen)
- **Ungelöste Stellen:** 0
- **Ausgeschlossen (außerhalb der Grenze, mit Grund):** 1
- **Familien mit offenen Varianten:** 44 — das Atom steht, seine Varianten sind nicht einzeln abgeleitet
- **Anzeigen** (was die Oberfläche zusagt, etwa „Kompensation bestätigt aktiv“) haben keine Quelle mit Atomen; ihr Katalog sichtbarer Zusagen folgt als eigener Schritt.
- **Belegt** heißt hier: ein benannter Test existiert mit diesem Titel. Ob er lief und bestand, kommt aus den Laufberichten (nächster Schritt).

## Offene Aussagen

22 Aussagen ohne Beleg — die Lücken, mit der Schicht, die den Bruch sehen würde.

| Funktion | Aussage | Art | gilt für | Lücke |
|---|---|---|---|---|
| Freigeben (Arm) und Sperren | Das Herzschlag-Budget eines Clients ist 3 s. | Daten | alle | Gateway: kein Test bindet den Standardwert _HB_STALL_SEC |
| Not-Halt auslösen und zurücksetzen | Läuft das Budget des Oneshots (0,5 s) ohne Herzschlag ab, verriegelt der Latch im selben Servotakt. | Wirkung | alle | nicht gemessen: der Abstand zwischen dem Ablauf von oneshot.0.out und fault-out im Servotakt (halsampler) |
| Sicherheits-Auslösung quittieren, Sicherheitskette | Eine gemeldete Auslösung erscheint im Banner mit Quittieren und wird protokolliert. | Bedienbarkeit | alle | Browser/Gateway: Versand, Banner und Protokolleintrag beobachtet kein Test |
| Antast-Auslösung simulieren (nur Sim) | Sim-Trip pulst den Antast-Eingang probe-in kurz; eine fehlgeschlagene Zustellung wird gemeldet. | Wirkung | alle | Gateway: kein Test des Handlers (halcmd sets probe-in); nativ in der Sim |
| Referenzieren und Referenz aufheben | Home je Achse sendet den Joint seiner Achse. | Daten | 3axis_xyz, 5axis_xyzac, 6axis_twp_xyzabc | Browser: sendet die Achsposition als Joint (SetupStrip a.index) und liest homed_joints an derselben Stelle — richtig, wo Joint = Achsposition (alle ausgelieferten Konfigurationen), falsch, wo nicht (Gantry, eigene Kinematik); braucht eine Achse→Joint-Zuordnung vom Gateway |
| Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren | Jeder Jog-Knopf und sein Loslassen senden jog_cont / jog_stop seiner Achse und Richtung (die Diagonalen als Mehrfach-Jog sind eine eigene Aussage). | Daten | alle | Browser: je Bildschirm-Knopf Achse und Richtung, parametrisiert; belegt sind bisher die Tastatur je Belegung und der Knopf X+ |
| Anfahren: G30, Maschinennull, Werkstücknull | Z ist oben, bevor X/Y fahren (→ Zero, → Home, → G30). | Wirkung | Machine | nativ: Verlauf oder Befehlsfolge (die Endpositionen belegen die Reihenfolge nicht) |
| Overrides: Vorschub, Eilgang, Spindel | Auf echtem LinuxCNC ändert der Feed-Override die Bahngeschwindigkeit (G1 F6000: Plateau 100 mm/s, mit 0,5 dann 50 mm/s, je ± 5 %). | Wirkung | 3axis_xyz | nativ: die Plateau-Messung (STAT mit 50 Hz) — noch keinem Bauschritt zugeordnet |
| Overrides: Vorschub, Eilgang, Spindel | Während des Surface-Scans meldet der Status den Feed-Override gesperrt; nach dem Ende ist er wieder freigegeben. | Wirkung | offen | nativ: der Surface-Scan-Lauf (Q282-2) |
| Kühlmittel: Flood und Mist | Auf echtem LinuxCNC schalten Flood und Mist ihre HAL-Ausgänge. | Wirkung | offen | nativ (native Stufe) |
| Antippen (Touch-off) und Nullen je Achse | Plane: das Remap schreibt den angetippten Wert in G54. | Wirkung | Plane | kein Test liest G54 nach dem Remap; nativ (scripts/twp_touchoff_plane_check.py, Laufbindung offen) |
| Geschwenkte Ebene (TWP): erfassen, aufheben, neu ausrichten | Erfassen, Ausrichten und Aufheben ändern Ebene und Nullpunkt, wie die Anzeige es sagt. | Wirkung | Machine, Plane | nativ: scripts/twp_capture_check.py und twp_reorient_check.py (Laufbindung offen) |
| Programm laden, neu laden, entladen | Neu laden übernimmt die neue Revision; Entladen leert Programm und Vorschau. | Wirkung | alle | Browser/Gateway: Reload und Unload als Ergebnis nicht belegt |
| Start ab Zeile (mit Vormessung, sicherem Z, Spindel) | Auf echtem LinuxCNC startet der Lauf ab der gewählten Zeile mit dem richtigen Werkzeug, Spindel und Startpunkt. | Wirkung | offen | nativ: ein Testprogramm ab Zeile mit Vormessung (native Stufe) |
| Werkzeug anlegen, bearbeiten, löschen, umnummerieren | Anlegen, Ändern, Löschen und Umnummerieren ändern genau ihren Datensatz, erhalten die übrigen Werte und laden die Tabelle neu. | Wirkung | alle | Gateway: kein Test vergleicht die Tabelle vor und nach je Aktion; nativ |
| Werkzeuglänge messen (M600) und Werkzeug entladen | Jede Nummer der Abbildung ist die, die tool_touch_off.ngc für ihren Wert liest. | Daten | alle | Unit: kein Test gleicht die Abbildung mit den Lesestellen der Routine ab |
| Fläche abtasten (Surface-Scan) | Auf echtem LinuxCNC tastet der Scan das Raster ab und liefert die Punkte für die Kompensation. | Wirkung | 3axis_xyz | nativ (native Stufe, mit hohem Antastvorschub über die Scan-Variablen) |
| Flächenkompensation ein/aus und Interpolation umschalten | Auf echtem LinuxCNC wirkt AN/AUS, und die drei Methoden unterscheiden sich an bekannten Punkten einer nicht ebenen Fläche. | Wirkung | 3axis_xyz | nativer Lauf offen |
| Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen | Im Gateway ist eine Umbenennung ein Schritt: neue Datei, alte weg, Leiste umgezogen, oder nichts. | Wirkung | alle | Gateway: Atomarität der Umbenennung nicht belegt |
| Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung | Mehrere Clients gleichzeitig: Nach dem Laden eines Programms holen mehrere Clients die Vorschau, und der Herzschlag-Abstand des Gateways bleibt sicher unter der Grenze von 500 ms. | Wirkung | alle | neues perf_matrix-Szenario mit Protokoll-Clients statt Browsern (deren Simulation läuft auf den Client-Geräten, nicht im Gateway); native Stufe. Vorhanden: fanout (8 Clients), reconnect_storm (12 Verbindungen), preview_publish (ein Client) — Operator 2026-11-04 |
| Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung | Trennt sich ein Client oder läuft sein Herzschlag ab: der passende Jog-Stopp, kein pauschaler Abort eines laufenden Programms (Armed ist Autorisierung, kein Totmann); ein anderer Client bleibt verbunden. Fehlt der letzte Client oder der Gateway-Herzschlag, greift die HAL-Kette (F-ESTOP.S4). | Abbruch | alle | Integrationsbeleg offen: WS-Abgang und Timeout mit laufendem Programm und zweitem Client |
| Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung | Ein Befehl, dessen Wert die Handlung bestimmt, wird ohne diesen Wert abgelehnt: home ohne joint, set_optional_stop / set_block_delete ohne Wahrheitswert, ein Override ohne scale, spindle_forward / spindle_reverse ohne speed; wo ein Standard die sichere Richtung ist (arm ohne armed → entwaffnen), ist er ausdrücklich so entschieden. | Ablehnung | alle | Gateway: heute führt es diese Befehle mit einem Standard aus (home ohne joint referenziert alle, "false" schaltet M01 ein, ein Override ohne scale setzt 100 %); 24 finite_*(msg.get(…, Standard)) und 9 bool(msg.get(…)) sind je Befehl zu sichten, bevor ein Standard entfällt — ein eigenes Gateway-Paket (F-COMP S3 war der erste Fall); der WebUI-Client sendet jedes Feld (commandShapes.test.ts) |

**Ohne formulierte Aussagen:** 18 Funktionen ohne eigene Maschinenwirkung — Programm herunterladen `F-PROGDOWNLOAD`, G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik `F-GCODEVIEW`, Vorschau des Werkzeugwegs `F-PREVIEW`, Werkzeugtabelle ansehen, suchen, sortieren `F-TOOLTABLE`, Werkzeugtabelle herunterladen `F-TOOLDOWNLOAD`, Makro-Leiste einrichten `F-MACROBAR`, Simulation: Zeitleiste, Abspielen, Kollisions- und Grenzprüfung, Sim-Tab `F-SIM`, 3D-Ansicht bedienen: Ansichten, Würfel, Spur löschen, Hinweise `F-VIEW`, 3D-Ansicht einstellen: Ebenen, Farben, Projektion, Verfolgung, HUD `F-VIEWSET`, Kamerabild (Bild im Bild) und Überlagerung `F-CAMERA`, Darstellung: Farbschema, Vollbild, Bildschirm wach halten `F-DISPLAY`, Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen `F-MESSAGES`, Navigation: Tabs und Seitenleiste `F-TABS`, Diagnose: HAL-Anzeige, Timing, Telemetrie `F-DIAG`, Eingabehilfen: Zahlen- und Text-Tastatur am Bildschirm `F-INPUTHELP`, Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS`, Statusübertragung (Rahmen und gemeinsame Felder) `SYS-STATUS`, Maschinenkonfiguration lesen: Achsen, Gelenke, Grenzen, Kinematik, Remaps, Profile `SYS-CONFIG`

## Sicherheit und Maschinenzustand

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Freigeben (Arm) und Sperren** `F-ARM` | Einstellungen, Leiste › Sicherheit | 6 | 4 | 3 | 1 |
| **Not-Halt auslösen und zurücksetzen** `F-ESTOP` | Leiste › Sicherheit | 6 | 5 | 4 | 1 |
| **Sicherheits-Auslösung quittieren, Sicherheitskette** `F-TRIP` | Banner | 6 | 2 | 1 | 1 |
| **Maschine ein und aus** `F-POWER` | Leiste › Sicherheit | 6 | 1 | 1 | 0 |
| **Abbrechen (Abort)** `F-ABORT` | Banner, Makro-Leiste, Tab „Macros“, Tab „Probing“, Tab „Program“, Tab-Kopf (Abort) | 9 | 1 | 1 | 0 |
| **Betriebsart: Manuell, MDI, Automatik** `F-MODE` | Leiste › Jog | 4 | 1 | 1 | 0 |
| **Herunterfahren** `F-SHUTDOWN` | Dialog, Kopfzeile | 4 | 1 | 1 | 0 |
| **Antast-Auslösung simulieren (nur Sim)** `F-SIMTRIP` | Tab „Probing“ | 3 | 2 | 1 | 1 |

### Freigeben (Arm) und Sperren

- **S1 (Ablehnung):** Ohne Arm lehnt das Gateway eine arm-pflichtige Aktion ab, mit dem Grund „Not armed“ (geprüft an Cycle Start). Stopps und die Anzeige-Settings sind eigene Regeln ohne Arm. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_not_armed_denied
- **S2 (Ablehnung):** Arm geht erst, wenn eine Sicherheits-Auslösung quittiert ist; der Grund steht am Knopf. — gilt für: alle
  - Beleg: gateway: `test_button_gates_d.py` — test_arming_waits_for_the_acknowledgement; browser: `setup-gates.spec.ts` — the recovery order: E-Stop Reset and arming wait for the trip's acknowledgement — the reason at the button (BG-11)
- **S3 (Wirkung):** Ein Client, der länger als sein Herzschlag-Budget schweigt, verliert seine Freigabe (geprüft mit verkürztem Budget). — gilt für: alle
  - Beleg: gateway: `test_ws_command_worker.py` — test_hb_stall_disarms_silent_client
- **S3b (Daten):** Das Herzschlag-Budget eines Clients ist 3 s. — gilt für: alle
  - Beleg: **offen** — Lücke: Gateway: kein Test bindet den Standardwert _HB_STALL_SEC

### Not-Halt auslösen und zurücksetzen

- **S1 (Bedienbarkeit):** Escape löst genau einen Not-Halt aus, auch bei offener Zahlentastatur, und nie ein Zurücksetzen. — gilt für: alle
  - Beleg: browser: `keyboard-guards.spec.ts` — number keypad open: Space/Backspace send nothing, Escape sends exactly estop; browser: `keyboard-guards.spec.ts` — repeated Escape in E-Stop never sends estop_reset
- **S2 (Daten):** Eine offene Sicherheitskette in HAL gilt als Not-Halt, auch wenn LinuxCNC selbst keinen meldet. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_safety_chain_open_forces_estop_and_disables
- **S3 (Ablehnung):** Zurücksetzen braucht Arm und die quittierte Auslösung. — gilt für: alle
  - Beleg: gateway: `test_button_gates_d.py` — test_reset_needs_arm_and_the_acknowledgement
- **S4 (Wirkung):** Bleibt der Herzschlag des Gateways aus (SIGSTOP), verriegelt HAL den Not-Halt und hält ihn, bis die Wiederherstellung (Quittieren, Arm, Zurücksetzen) ihn löst. — gilt für: alle
  - Beleg: script: `perf_matrix.py` — sigstop_trip (live, nicht im Gate)
- **S4b (Wirkung):** Läuft das Budget des Oneshots (0,5 s) ohne Herzschlag ab, verriegelt der Latch im selben Servotakt. — gilt für: alle
  - Beleg: **offen** — Lücke: nicht gemessen: der Abstand zwischen dem Ablauf von oneshot.0.out und fault-out im Servotakt (halsampler)

### Sicherheits-Auslösung quittieren, Sicherheitskette

- **S1 (Daten):** Die Entscheidung über eine Auslösung: nach sauberem Start wird sie genau einmal gemeldet; ein schon beim Start gesetzter Latch gilt als beim Start gesetzt, nicht als neue Auslösung. — gilt für: alle
  - Beleg: gateway: `test_gateway_util.py` — test_sustained_latch_banners_only_once; gateway: `test_gateway_util.py` — test_boot_faulted_does_not_banner
- **S1b (Bedienbarkeit):** Eine gemeldete Auslösung erscheint im Banner mit Quittieren und wird protokolliert. — gilt für: alle
  - Beleg: **offen** — Lücke: Browser/Gateway: Versand, Banner und Protokolleintrag beobachtet kein Test

### Maschine ein und aus

- **S1 (Ablehnung):** Maschine ein wird im Not-Halt abgelehnt. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_machine_on_denied_in_estop

### Abbrechen (Abort)

- **S1 (Abbruch):** Abort ist in jedem Zustand offen: ohne Arm, im Not-Halt, bei unbekanntem Zustand und im Lauf; ohne Arm erreicht er die Steuerung. — gilt für: alle
  - Beleg: gateway: `test_button_gates.py` — test_abort_in_any_state; gateway: `test_button_gates.py` — test_abort_disarmed_reaches_the_controller

### Betriebsart: Manuell, MDI, Automatik

- **S1 (Ablehnung):** MANUAL ist in E-Stop und unreferenziert wählbar; MDI und AUTO brauchen die Referenz (oder die deklarierte Ausnahme ohne Referenzierpflicht) und sind referenziert auch in E-Stop und ausgeschaltet wählbar; gesperrt mit Grund; die gewählte Betriebsart sendet nichts. — gilt für: alle
  - Beleg: browser: `setup-gates.spec.ts` — the task mode per target: MANUAL in E-Stop and unhomed, MDI / AUTO dimmed with the reason; the checked mode sends nothing (BG-04); gateway: `test_button_gates_d.py` — test_coord_needs_homing_unless_declared; gateway: `test_button_gates_d.py` — test_coord_homed_in_estop_and_off

### Herunterfahren

- **S1 (Ablehnung):** Herunterfahren braucht Arm; ein freigegebener Client fährt die Suite herunter. — gilt für: alle
  - Beleg: gateway: `test_button_gates_c.py` — test_the_policy_names_arm; gateway: `test_button_gates_c.py` — test_a_disarmed_client_cannot_shut_down; gateway: `test_button_gates_c.py` — test_an_armed_client_shuts_down

### Antast-Auslösung simulieren (nur Sim)

- **S1 (Ablehnung):** Sim-Trip braucht nur Arm. — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_simulate_probe_trip_requires_armed_only
- **S2 (Wirkung):** Sim-Trip pulst den Antast-Eingang probe-in kurz; eine fehlgeschlagene Zustellung wird gemeldet. — gilt für: alle
  - Beleg: **offen** — Lücke: Gateway: kein Test des Handlers (halcmd sets probe-in); nativ in der Sim

## Referenzieren und Bewegen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Referenzieren und Referenz aufheben** `F-HOME` | Banner, Leiste › Setup | 11 | 4 | 3 | 1 |
| **Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren** `F-JOG` | Leiste › Jog | 39 | 6 | 5 | 1 |
| **Anfahren: G30, Maschinennull, Werkstücknull** `F-GOTO` | Leiste › Setup | 8 | 5 | 4 | 1 |

### Referenzieren und Referenz aufheben

- **S1 (Bedienbarkeit):** Unhome All ist eine Haltegeste: ein kurzes Tippen sendet nichts und sagt warum, ein vollständiges Halten genau einen Befehl. — gilt für: alle
  - Beleg: browser: `touch-hold.spec.ts` — a short tap sends nothing and says why; a complete hold sends exactly one command
- **S2 (Daten):** Home All sendet home_all auf ein Halten; ein Tippen sendet nichts. — gilt für: alle
  - Beleg: browser: `strip-actions.spec.ts` — Home All sends home_all on a hold — a tap sends nothing
- **S2b (Daten):** Home je Achse sendet den Joint seiner Achse. — gilt für: 3axis_xyz, 5axis_xyzac, 6axis_twp_xyzabc
  - Beleg: **offen** — Lücke: Browser: sendet die Achsposition als Joint (SetupStrip a.index) und liest homed_joints an derselben Stelle — richtig, wo Joint = Achsposition (alle ausgelieferten Konfigurationen), falsch, wo nicht (Gantry, eigene Kinematik); braucht eine Achse→Joint-Zuordnung vom Gateway
- **S2c (Wirkung):** Auf echtem LinuxCNC (3 Achsen, Modus Machine) referenziert Home All alle drei Joints; Home je Achse referenziert nach Unhome All genau seinen Joint (0, 1, 2), erst nach bestätigtem Abschluss. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — home-all; native: `native_run.py` — home-joint-0; native: `native_run.py` — home-joint-1; native: `native_run.py` — home-joint-2 — Lücke: der native Lauf steht aus (gebaut: Schritt 1)

### Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren

- **S1 (Abbruch):** Die Geste merkt sich beim Drücken ihren Stopp: das Loslassen liefert genau den Stopp, den das Drücken gestartet hat, auch wenn Schritt oder Belegung sich inzwischen ändern (Entscheidung, ohne Browser). — gilt für: alle
  - Beleg: unit: `jogGesture.test.ts` — ends a gesture with the stop recorded at its start, whatever changed since
- **S2 (Abbruch):** Ein Jog-Stopp wird von der Zulassung nie abgelehnt, auch ohne Arm und im Not-Halt (die Zustellung ist eine eigene Aussage). — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_jog_stop_always_allowed; gateway: `test_command_dispatch.py` — test_jog_stop_never_policy_denied
- **S3 (Daten):** Eine negative Jog-Geschwindigkeit bleibt erhalten: das Vorzeichen ist die Richtung. — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_jog_velocity_is_SIGNED_and_must_survive_the_clamp
- **S4 (Ablehnung):** Vor dem Referenzieren joggt jede Achse ihr deklariertes Gelenk; eine Gantry-Achse und die Diagonalen sind gesperrt, mit Grund (Entscheidung und Anzeige). — gilt für: alle
  - Beleg: gateway: `test_button_gates_e.py` — test_a_gantry_letter_is_closed; browser: `joint-jog.spec.ts` — before homing every open axis jogs in amber, the diagonals are closed with their reason; homed both are back (package F); gateway: `test_button_gates_e.py` — test_the_declared_joint_not_the_index; gateway: `test_button_gates_e.py` — test_a_diagonal_is_refused_before_homing
- **S5 (Wirkung):** Auf echtem LinuxCNC bewegen die Jog-Befehle des Gateways (jog_cont / jog_stop) jede Achse in ihrem Vorzeichen und halten sie an: Weg ab der Antwort auf jog_stop höchstens v²/2a + 2·v·4T (X/Y 2,1 mm, Z 2,5 mm bei 50 mm/s), Stillstand binnen 0,5 s. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — jog-x+; native: `native_run.py` — jog-x-; native: `native_run.py` — jog-y+; native: `native_run.py` — jog-y-; native: `native_run.py` — jog-z+; native: `native_run.py` — jog-z- — Lücke: der native Lauf steht aus (gebaut: Schritt 1); der Bremsweg bleibt aus Statusbildern oft unvollständig, bis die Servo-Abtastung (Q288-1) ihn auflöst
- **S5b (Daten):** Jeder Jog-Knopf und sein Loslassen senden jog_cont / jog_stop seiner Achse und Richtung (die Diagonalen als Mehrfach-Jog sind eine eigene Aussage). — gilt für: alle
  - Beleg: **offen** — Lücke: Browser: je Bildschirm-Knopf Achse und Richtung, parametrisiert; belegt sind bisher die Tastatur je Belegung und der Knopf X+

### Anfahren: G30, Maschinennull, Werkstücknull

- **S1 (Wirkung):** Von über Z0: → Home senkt Z nie (das kleinste gesehene Z ist der Start); → Zero endet mit demselben Z und X/Y am Werkstücknullpunkt. — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → Zero from ABOVE Z0 (G53 Z+50): Z unchanged (never lowered), X/Y at work zero (live, nicht im Gate); script: `twp_buttons_check.py` — → Home from ABOVE Z0: min Z seen >= +50 (never lowered), X/Y to machine zero (live, nicht im Gate)
- **S1b (Wirkung):** Von unter Z0 fahren → Zero und → Home Z auf die Maschinen-Oberkante. — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → Zero from BELOW Z0 (G53 Z-60): Z at machine top exactly, X/Y at work zero, A back to the stamp (0) (live, nicht im Gate); script: `twp_buttons_check.py` — → Home from BELOW Z0: Z to machine top, X/Y to machine zero, A 0 (live, nicht im Gate)
- **S1c (Wirkung):** Z ist oben, bevor X/Y fahren (→ Zero, → Home, → G30). — gilt für: Machine
  - Beleg: **offen** — Lücke: nativ: Verlauf oder Befehlsfolge (die Endpositionen belegen die Reihenfolge nicht)
- **S1d (Wirkung):** → G30 von unter Z0 erreicht unterwegs ungefähr Z0 und endet auf #5181–#5183 (die Reihenfolge: S1c). — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → G30 from BELOW Z0: retracts to the top first (max Z seen ~ 0), then lands on #5181..#5183 (live, nicht im Gate)
- **S2 (Wirkung):** → Zero nach einem Jog der Drehachse bringt den Tisch auf den Stempelwinkel zurück, X/Y lesen null. — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → Zero after jogging A away: table returns to A 20 and X/Y read zero (tip on the datum) (live, nicht im Gate)

## Spindel, Kühlmittel, Overrides

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Overrides: Vorschub, Eilgang, Spindel** `F-OVERRIDE` | Leiste › Overrides | 19 | 4 | 2 | 2 |
| **Spindel von Hand: Rechts, Links, Stopp, Drehzahl** `F-SPINDLE` | Einstellungen, Leiste › Spindel | 25 | 4 | 4 | 0 |
| **Kühlmittel: Flood und Mist** `F-COOLANT` | Leiste › Spindel | 8 | 2 | 1 | 1 |

### Overrides: Vorschub, Eilgang, Spindel

- **S1 (Daten):** Ein Schieber sendet seinen Faktor für genau seinen Override (50 % → 0,5); sein 100-%-Knopf sendet 1,0. — gilt für: alle
  - Beleg: browser: `strip-actions.spec.ts` — each override slider sends its own factor; its 100 % button sends 1.0
- **S2 (Wirkung):** Auf echtem LinuxCNC ändert der Feed-Override die Bahngeschwindigkeit (G1 F6000: Plateau 100 mm/s, mit 0,5 dann 50 mm/s, je ± 5 %). — gilt für: 3axis_xyz
  - Beleg: **offen** — Lücke: nativ: die Plateau-Messung (STAT mit 50 Hz) — noch keinem Bauschritt zugeordnet
- **S2b (Wirkung):** Während der Messphase von M600 meldet der Status den Feed-Override gesperrt; nach dem Ende der Routine ist er wieder freigegeben (frisch empfangen, binnen 2 s). — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m600-t1-override-lock — Lücke: der native Lauf steht aus (gebaut: Schritt 2a)
- **S2c (Wirkung):** Während des Surface-Scans meldet der Status den Feed-Override gesperrt; nach dem Ende ist er wieder freigegeben. — gilt für: offen
  - Beleg: **offen** — Lücke: nativ: der Surface-Scan-Lauf (Q282-2)

### Spindel von Hand: Rechts, Links, Stopp, Drehzahl

- **S1 (Abbruch):** Spindel-Stopp ist im Leerlauf ohne Arm und ohne Referenz offen; im Lauf gehört die Spindel dem Programm, der Grund nennt die wirksamen Stopps. — gilt für: alle
  - Beleg: gateway: `test_button_gates.py` — test_spindle_stop_at_idle_without_arm_or_homing; gateway: `test_button_gates.py` — test_spindle_stop_closed_while_the_program_owns_the_spindle
- **S2 (Ablehnung):** Die Spindel von Hand vor dem Referenzieren nur, wo die Maschine es deklariert (WEBUI_SPINDLE_BEFORE_HOMING = 1), und nur in MANUAL. — gilt für: alle
  - Beleg: browser: `setup-gates.spec.ts` — the manual spindle unhomed where the machine declares it, MANUAL only (Q1); gateway: `test_button_gates_d.py` — test_the_switch_opens_manual_only; gateway: `test_button_gates_d.py` — test_unhomed_without_the_switch_keeps_the_homing_rule; gateway: `test_button_gates_d.py` — test_spindle_switch
- **S3 (Daten):** Rechts und Links senden auf ein Halten die Drehzahl der Vorwahl, ein Tippen nichts; ± ändern im Stand die Vorwahl und senden nichts, bei drehender Spindel senden sie Erhöhen und Verringern. — gilt für: alle
  - Beleg: browser: `strip-actions.spec.ts` — Fwd and Rev send the preselected speed on a hold — a tap sends nothing; browser: `strip-actions.spec.ts` — ± move the preselection while the spindle stands, and send increase / decrease while it turns
- **S4 (Wirkung):** Vor dem Referenzieren mit dem Schalter läuft die Spindel in MANUAL; ohne den Schalter wird sie abgelehnt. — gilt für: alle
  - Beleg: gateway: `test_button_gates_d.py` — test_unhomed_with_the_switch_in_manual_runs; gateway: `test_button_gates_d.py` — test_unhomed_without_the_switch_is_refused

### Kühlmittel: Flood und Mist

- **S1 (Daten):** Flood und Mist senden Ein gegen das gemeldete Aus und Aus gegen das gemeldete Ein; der Schalter zeigt den gemeldeten Zustand, nie den Klick. — gilt für: alle
  - Beleg: browser: `strip-actions.spec.ts` — Flood and Mist send on against the reported off, off against the reported on — the switch shows the status
- **S2 (Wirkung):** Auf echtem LinuxCNC schalten Flood und Mist ihre HAL-Ausgänge. — gilt für: offen
  - Beleg: **offen** — Lücke: nativ (native Stufe)

## Werkstück-Koordinaten und Ebenen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Antippen (Touch-off) und Nullen je Achse** `F-TOUCHOFF` | Leiste › Setup | 9 | 4 | 3 | 1 |
| **Nullpunkte: aktives System wählen (G54 …), Tabelle bearbeiten und löschen** `F-WCS` | Leiste › Setup, Tab „Offsets“ | 12 | 3 | 3 | 0 |
| **Kinematik-Modus umschalten: Machine, TCP, Plane** `F-KINS` | Leiste › Jog | 3 | 1 | 1 | 0 |
| **Geschwenkte Ebene (TWP): erfassen, aufheben, neu ausrichten** `F-TWP` | Leiste › Setup | 31 | 3 | 2 | 1 |

### Antippen (Touch-off) und Nullen je Achse

- **S1 (Daten):** Machine: lineare Achsen schreiben in G54–G58, Drehachsen nur in G54. Auf einer TWP-fähigen Maschine sind G59–G59.3 Hilfszeilen und gesperrt; ohne TWP sind sie gewöhnliche Nullpunkte. — gilt für: Machine
  - Beleg: gateway: `test_command_policy.py` — test_identity_linear_into_operator_fixtures; gateway: `test_command_policy.py` — test_rotary_identity_g54_only; gateway: `test_command_policy.py` — test_identity_reserved_rows_refused; gateway: `test_command_policy.py` — test_non_switchable_g59_to_g59_3_linear_touchoff_is_mdi; gateway: `test_command_policy.py` — test_switchable_non_twp_machine_admits_reserved_fixtures
- **S2 (Ablehnung):** TCP: Antippen nur bei Tisch in Nulllage (A = 0), geneigt abgelehnt; auf einer TWP-fähigen Maschine sind die Hilfszeilen gesperrt. — gilt für: TCP
  - Beleg: gateway: `test_command_policy.py` — test_tcp_linear_at_datum_allowed; gateway: `test_command_policy.py` — test_tcp_tilted_table_refused; gateway: `test_command_policy.py` — test_tcp_reserved_rows_refused
- **S3 (Daten):** Plane: lineare Achsen gehen über G59 an das Remap, nur mit aktiver Ebene; Drehachsen gesperrt (Route und Anzeige). — gilt für: Plane
  - Beleg: gateway: `test_command_policy.py` — test_plane_mode_linear_routes_to_remap; gateway: `test_command_policy.py` — test_plane_mode_needs_active_plane_and_g59; gateway: `test_command_policy.py` — test_plane_mode_rotary_touchoff_refused; browser: `touchoff.spec.ts` — Plane mode: rotary touch-off closed, reserved fixtures disabled, Zero XYZ stays open
- **S3b (Wirkung):** Plane: das Remap schreibt den angetippten Wert in G54. — gilt für: Plane
  - Beleg: **offen** — Lücke: kein Test liest G54 nach dem Remap; nativ (scripts/twp_touchoff_plane_check.py, Laufbindung offen)

### Nullpunkte: aktives System wählen (G54 …), Tabelle bearbeiten und löschen

- **S1 (Unbekannt):** Unbekannt ist nie null: die Zusammenfassung nennt, was unbekannt ist, und sagt „none“ nur, wenn alles bekannt ist. — gilt für: alle
  - Beleg: browser: `offsets.spec.ts` — unknown is never zero: the summary names what is unknown, and says 'none' only when all is known
- **S2 (Ablehnung):** Ein Nullpunkt wird bei aktiver Flächenkompensation nicht geschrieben. — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_touchoff_blocked_with_eoffset
- **S3 (Bedienbarkeit):** Die aktive Zeile ist benannt, nicht nur gefärbt; ein Klick auf eine Zeile wählt sie für Löschen und wechselt nie das System. — gilt für: alle
  - Beleg: browser: `offsets.spec.ts` — the active fixture is named, not only tinted; a row click selects for Clear and never switches the WCS

### Kinematik-Modus umschalten: Machine, TCP, Plane

- **S1 (Bedienbarkeit):** Die Kinematik-Auswahl zeigt den Rahmen, den der gemeldete Typ bedeutet, und sendet Rahmen. — gilt für: Machine, TCP, Plane
  - Beleg: browser: `touchoff.spec.ts` — kinematics selector shows the FRAME the raw type means, and emits frames

### Geschwenkte Ebene (TWP): erfassen, aufheben, neu ausrichten

- **S1 (Ablehnung):** Das Erfassen einer Ebene startet aus Machine oder TCP auf einer TWP-fähigen Maschine; abgelehnt, solange schon eine Ebene definiert ist; ohne TWP-Fähigkeit gibt es kein Erfassen. — gilt für: Machine, TCP
  - Beleg: gateway: `test_command_policy.py` — test_refuses_plane_already_defined; gateway: `test_command_policy.py` — test_switchable_non_twp_machine_cannot_capture
- **S2 (Ablehnung):** Plane läuft nur mit seiner Ebene und G59. — gilt für: Plane
  - Beleg: gateway: `test_command_policy.py` — test_plane_kins_with_its_plane_and_g59_runs; gateway: `test_command_policy.py` — test_plane_kins_without_a_plane_refuses; gateway: `test_command_policy.py` — test_plane_kins_with_g54_selected_refuses_the_post_m2_state; gateway: `test_button_gates.py` — test_unknown_current_fixture_cannot_reuse_old_g59
- **S3 (Wirkung):** Erfassen, Ausrichten und Aufheben ändern Ebene und Nullpunkt, wie die Anzeige es sagt. — gilt für: Machine, Plane
  - Beleg: **offen** — Lücke: nativ: scripts/twp_capture_check.py und twp_reorient_check.py (Laufbindung offen)

## Programm

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Programm laden, neu laden, entladen** `F-LOAD` | Banner, Tab „Program“, Tab „Program“ › Dateien | 16 | 3 | 2 | 1 |
| **Programm hochladen (mit Umbenennen oder Ersetzen)** `F-UPLOAD` | Tab „Program“ | 8 | 2 | 2 | 0 |
| **Programm bearbeiten und speichern** `F-EDIT` | Editor, Tab „Program“ | 10 | 2 | 2 | 0 |
| **Programm herunterladen** `F-PROGDOWNLOAD` | Tab „Program“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm starten, pausieren, fortsetzen, Einzelschritt** `F-RUN` | Tab „Program“ | 15 | 4 | 4 | 0 |
| **Start ab Zeile (mit Vormessung, sicherem Z, Spindel)** `F-RFL` | Einstellungen, Tab „Program“ | 20 | 3 | 2 | 1 |
| **Satz ausblenden und optionaler Halt** `F-OPTSTOP` | Tab „Program“ | 6 | 1 | 1 | 0 |
| **G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik** `F-GCODEVIEW` | G-Code-Referenz, Kopfzeile, Leiste › Sicherheit, Tab „Program“ | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Vorschau des Werkzeugwegs** `F-PREVIEW` | Einstellungen | 9 | 0 | 0 | Aussagen noch nicht formuliert |

### Programm laden, neu laden, entladen

- **S1 (Bedienbarkeit):** Ein Programm lädt in E-Stop, ausgeschaltet und unreferenziert: nur Arm und Leerlauf zählen. — gilt für: alle
  - Beleg: browser: `setup-gates.spec.ts` — a program loads in E-Stop, off and unhomed: programLoad, no power or homing (BG-03); gateway: `test_button_gates_d.py` — test_open_in_estop_off_and_unhomed; gateway: `test_button_gates_d.py` — test_closed_disarmed_running_or_unread
- **S2 (Ablehnung):** Laden und Entladen werden abgelehnt, solange ein Start in Arbeit ist. — gilt für: alle
  - Beleg: gateway: `test_button_gates_d.py` — test_a_start_in_progress_refuses_load_and_unload
- **S3 (Wirkung):** Neu laden übernimmt die neue Revision; Entladen leert Programm und Vorschau. — gilt für: alle
  - Beleg: **offen** — Lücke: Browser/Gateway: Reload und Unload als Ergebnis nicht belegt

### Programm hochladen (mit Umbenennen oder Ersetzen)

- **S1 (Ablehnung):** Ein Upload ersetzt ein vorhandenes Programm nie ohne ausdrückliches Ersetzen (409); das Original bleibt unberührt; mit Ersetzen wird es ersetzt. — gilt für: alle
  - Beleg: gateway: `test_upload_conflict.py` — test_same_name_without_flag_is_409_and_original_untouched; gateway: `test_upload_conflict.py` — test_same_name_with_flag_replaces
- **S2 (Ablehnung):** Ein nicht freigegebener Schreiber lädt nichts hoch; geprüft im Moment des Veröffentlichens. — gilt für: alle
  - Beleg: gateway: `test_button_gates_b.py` — test_a_disarmed_writer_uploads_nothing; gateway: `test_button_gates_b.py` — test_a_disarm_while_the_body_arrives_refuses_at_the_publish

### Programm bearbeiten und speichern

- **S1 (Daten):** Der Editor bleibt an die Datei gebunden, auf der er geöffnet wurde: eine Änderung von außen zeigt den Konflikt, Speichern schreibt nur diese Datei. — gilt für: alle
  - Beleg: browser: `editor-guards.spec.ts` — external program change keeps buffer A, shows the conflict, saves A only
- **S2 (Ablehnung):** Verwerfen schließt einen sauberen Editor sofort, einen geänderten erst nach Rückfrage; „Weiter bearbeiten“ behält die Änderung. — gilt für: alle
  - Beleg: browser: `editor-guards.spec.ts` — discard: clean closes at once, dirty asks and Keep editing keeps the edit

### Programm starten, pausieren, fortsetzen, Einzelschritt

- **S1 (Bedienbarkeit):** Pause wirkt ohne Arm auf ein laufendes Programm; Fortsetzen braucht Arm. — gilt für: alle
  - Beleg: gateway: `test_button_gates.py` — test_pause_of_a_running_sequence_without_arm; gateway: `test_button_gates.py` — test_resume_still_needs_arm; gateway: `test_button_gates.py` — test_pause_disarmed_pauses_a_running_program; gateway: `test_button_gates.py` — test_resume_disarmed_is_refused
- **S2 (Bedienbarkeit):** Start über die Tastatur wartet auf den Programmtext wie der Knopf: eine Zulassung, nur die Geste unterscheidet sich. — gilt für: alle
  - Beleg: browser: `setup-gates.spec.ts` — Start by the shortcut waits for the program text like the button (one admission, BG-10)
- **S3 (Bedienbarkeit):** Die Knöpfe Start, Einzelschritt und Fortsetzen lösen nur nach vollständigem Halten aus, ein Tippen sagt warum; Pause bleibt ein Tippen. Die Leertaste bleibt sofort (S2). — gilt für: alle
  - Beleg: browser: `run-hold.spec.ts` — Start, Step and Resume fire on a complete hold only — a tap says why; Pause stays a tap
- **S4 (Abbruch):** Eine neue Revision desselben Programms bricht ein laufendes Halten ab; solange ihr Text lädt, startet ein Halten nichts. — gilt für: alle
  - Beleg: browser: `run-hold.spec.ts` — a new revision of the same program cancels a Start, Step or Resume hold — at its arrival, the text still loading; browser: `run-hold.spec.ts` — while a revision's text is still loading, Start and Step wait — a hold there runs nothing

### Start ab Zeile (mit Vormessung, sicherem Z, Spindel)

- **S1 (Daten):** Start ab Zeile ist EIN auto_run, gebunden an das gezeigte Programm, seine Version und die Zeile; die Aktion im Dialog ist ein Halten. — gilt für: alle
  - Beleg: browser: `run-hold.spec.ts` — Run from line: Start only opens the dialog on a tap; the dialog's action is a hold bound to the program and the line; browser: `run-hold.spec.ts` — Run from line with a pre-measurement is ONE auto_run carrying the toolsetter's values and its program — nothing waits in the browser (Codex R16 XZ-07)
- **S2 (Wirkung):** Der sichere Z-Schritt vor dem Start hebt Z von unten auf Maschinen-Oberkante und senkt es nie; liegt Z schon oben, entfällt er (die gesendete Befehlsfolge gegen ein simuliertes STAT). — gilt für: Machine
  - Beleg: gateway: `test_rfl_guard.py` — test_safe_z_reached_from_below_starts; gateway: `test_rfl_guard.py` — test_safe_z_above_zero_skips_mdi
- **S3 (Wirkung):** Auf echtem LinuxCNC startet der Lauf ab der gewählten Zeile mit dem richtigen Werkzeug, Spindel und Startpunkt. — gilt für: offen
  - Beleg: **offen** — Lücke: nativ: ein Testprogramm ab Zeile mit Vormessung (native Stufe)

### Satz ausblenden und optionaler Halt

- **S1 (Daten):** Satz ausblenden und optionaler Halt senden das Gegenteil des gemeldeten Schalters; die Anzeige folgt dem gemeldeten Zustand, nie dem Klick. — gilt für: alle
  - Beleg: browser: `strip-actions.spec.ts` — M01 and /BD send the opposite of the reported switch; the switch shows the status

## MDI

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **MDI-Befehl senden, Verlauf** `F-MDI` | Tab „MDI“ | 6 | 1 | 1 | 0 |

### MDI-Befehl senden, Verlauf

- **S1 (Ablehnung):** MDI wird abgelehnt, solange ein Programm läuft; ein zu langer Befehl wird abgelehnt, nicht abgeschnitten. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_mdi_denied_while_running; gateway: `test_command_policy.py` — test_mdi_length_rejected_not_truncated

## Werkzeuge

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Werkzeugtabelle ansehen, suchen, sortieren** `F-TOOLTABLE` | Leiste › Werkzeug, Tab „Tools“ | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeug anlegen, bearbeiten, löschen, umnummerieren** `F-TOOLEDIT` | Tab „Tools“ | 31 | 4 | 3 | 1 |
| **Werkzeugbibliothek importieren (Fusion 360, FreeCAD)** `F-TOOLIMPORT` | Tab „Tools“ | 17 | 4 | 4 | 0 |
| **Werkzeugtabelle herunterladen** `F-TOOLDOWNLOAD` | Tab „Tools“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugwechsel (M6) mit Bestätigung** `F-TOOLCHANGE` | Dialog, Einstellungen, Tab „Tools“ | 14 | 2 | 2 | 0 |
| **Werkzeuglänge messen (M600) und Werkzeug entladen** `F-TOOLMEASURE` | Tab „Tools“ | 8 | 8 | 7 | 1 |
| **Toolsetter einrichten (Werkzeuglängen-Messung)** `F-TOOLSETTER` | Tab „Probing“ › Toolsetter | 36 | 1 | 1 | 0 |
| **Werkzeugwechselposition G30 lesen, übernehmen, speichern** `F-G30` | Tab „Probing“ › Toolsetter | 8 | 2 | 2 | 0 |

### Werkzeug anlegen, bearbeiten, löschen, umnummerieren

- **S1 (Ablehnung):** Werkzeug bearbeiten wird abgelehnt, solange ein Programm läuft. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_tool_edit_denied_while_running
- **S2 (Daten):** Anlegen lehnt eine unsinnige oder negative Werkzeugnummer ab. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_add_tool_garbage_number_rejected; gateway: `test_command_dispatch.py` — test_add_tool_negative_number_rejected
- **S3 (Daten):** Umnummerieren begrenzt beide Nummern, die die Oberfläche sendet. — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_renumber_bounds_both_numbers_the_ui_sends
- **S4 (Wirkung):** Anlegen, Ändern, Löschen und Umnummerieren ändern genau ihren Datensatz, erhalten die übrigen Werte und laden die Tabelle neu. — gilt für: alle
  - Beleg: **offen** — Lücke: Gateway: kein Test vergleicht die Tabelle vor und nach je Aktion; nativ

### Werkzeugbibliothek importieren (Fusion 360, FreeCAD)

- **S1 (Daten):** Vorhandene Werkzeuge werden standardmäßig nur in den Metadaten aufgefrischt; die gemessene Länge bleibt. — gilt für: alle
  - Beleg: browser: `tool-import.spec.ts` — existing tools default to reviewed metadata refresh, not full replacement; gateway: `test_tool_refresh.py` — test_real_preview_and_refresh_preserve_exact_table_bytes
- **S2 (Ablehnung):** Vollständiges Ersetzen erfordert die ausdrückliche Wahl dieser Art und zeigt die Längen, die ersetzt werden; eine veraltete Prüfung fällt nie auf Ersetzen zurück. — gilt für: alle
  - Beleg: browser: `tool-import.spec.ts` — full replacement requires selecting that mode and shows length replacement; browser: `tool-import.spec.ts` — stale review stays visible as an error and never falls back to replacement
- **S3 (Daten):** Die FreeCAD-Vorschau behält gemessene Offsets, zeigt eine eigene Form und erklärt neue Längen. — gilt für: alle
  - Beleg: browser: `freecad-import.spec.ts` — FreeCAD preview retains measured offsets, renders a custom shape, and explains new lengths
- **S4 (Ablehnung):** Ein Import schreibt die Tabelle nicht, solange ein Werkzeugwechsel angefordert ist (409), und nicht für einen nicht freigegebenen Schreiber. — gilt für: alle
  - Beleg: gateway: `test_button_gates_b.py` — test_a_pending_tool_change_replaces_nothing; gateway: `test_button_gates_b.py` — test_a_disarmed_writer_replaces_nothing

### Werkzeugwechsel (M6) mit Bestätigung

- **S1 (Ablehnung):** Bestätigen ist nur offen für einen freigegebenen Client mit einer offenen Anforderung; ohne Anforderung mit dem Grund „No tool change pending“. — gilt für: alle
  - Beleg: gateway: `test_button_gates.py` — test_open_for_an_armed_client_with_a_pending_request; gateway: `test_button_gates.py` — test_closed_without_a_request; gateway: `test_button_gates.py` — test_closed_disarmed
- **S2 (Wirkung):** Auf echtem LinuxCNC wartet M6 bis zur ausdrücklichen Bestätigung (5 s gehalten: Anforderung offen, Interpreter nicht idle, Werkzeug unverändert, mit 20 Hz geprüft) und läuft dann mit dem neuen Werkzeug und seiner Länge weiter. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m6-hold — Lücke: der native Lauf steht aus (gebaut: Schritt 2a)

### Werkzeuglänge messen (M600) und Werkzeug entladen

- **S1 (Daten):** Direkte Messung: Messen sendet EIN mdi mit den Toolsetter-Werten in vars (der Sendevertrag; Werte exemplarisch geprüft). — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — Measure Current is ONE command: the values ride the mdi
- **S2 (Daten):** Vormessung beim Start ab Zeile: EIN auto_run mit pre_tool und probe_vars (der Sendevertrag; Werte exemplarisch geprüft). — gilt für: alle
  - Beleg: browser: `run-hold.spec.ts` — Run from line with a pre-measurement is ONE auto_run carrying the toolsetter's values
- **S3 (Ablehnung):** Ohne eingerichteten Toolsetter (Sektion vom Server bestätigt) bleiben Messen und Entladen aus — mit Grund. — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — without the server's settings, and without a saved section, Measure Current and Unload (M600) stay off
- **S4 (Daten):** Die Abbildung nennt genau 23 Var-Nummern: #3004–#3007, #3009, #3010, #3013, #3100–#3115. — gilt für: alle
  - Beleg: unit: `toolsetterSetup.test.ts` — writes the var numbers tool_touch_off.ngc reads
- **S4b (Daten):** Jede Nummer der Abbildung ist die, die tool_touch_off.ngc für ihren Wert liest. — gilt für: alle
  - Beleg: **offen** — Lücke: Unit: kein Test gleicht die Abbildung mit den Lesestellen der Routine ab
- **S5 (Wirkung):** Auf echtem LinuxCNC landet die gemessene Länge in der Werkzeugtabelle (die Länge vor der Messung ± 0,002 mm) und als derselbe Wert im G43-Offset; ein um 1 mm versetztes #3102 fällt durch. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m600-t1; native: `native_run.py` — m600-t1.counter-3102 — Lücke: der native Lauf steht aus (gebaut: Schritt 2a)
- **S6 (Daten):** Entladen sendet im M600-Modus EIN mdi T0 M600 mit den Toolsetter-Werten in vars, im Standardmodus tool_change 0. — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — Unload is ONE command: T0 M600 with the setter's values in M600 mode, tool_change 0 in the standard mode
- **S6b (Wirkung):** Auf echtem LinuxCNC entlädt T0 M600 das Werkzeug: die Spindel leer, keine Länge mehr aktiv. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m600-unload — Lücke: der native Lauf steht aus (gebaut: Schritt 2a)

### Toolsetter einrichten (Werkzeuglängen-Messung)

- **S1 (Daten):** Die Einrichtung zählt erst, wenn der Server die Sektion bestätigt hat; eine Teil-Sektion nennt, was fehlt, und eine Änderung speichert nur dieses Feld. — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — a save the server never confirmed is no setup; its confirmation is; browser: `toolsetter-setup.spec.ts` — a partial section: the form names what is missing, shows unset fields empty, and a change saves only that field

### Werkzeugwechselposition G30 lesen, übernehmen, speichern

- **S1 (Ablehnung):** Speichern prüft das Fenster, bevor sich etwas bewegt, und verlangt die Basis, auf der der Entwurf beruht. — gilt für: alle
  - Beleg: gateway: `test_g30.py` — test_out_of_the_window_is_refused_before_anything_moves; gateway: `test_g30.py` — test_a_write_without_its_basis_is_refused
- **S2 (Ablehnung):** Hat der Interpreter G30 inzwischen geändert, ist das ein Konflikt („G30 changed meanwhile — reload“); ein anders zurückgelesener Wert ist nicht bestätigt. — gilt für: alle
  - Beleg: gateway: `test_g30.py` — test_a_value_the_interpreter_changed_meanwhile_is_a_conflict; gateway: `test_g30.py` — test_a_value_read_back_differently_is_not_confirmed

## Antasten und Flächenkompensation

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut** `F-PROBE` | Tab „Probing“ | 87 | 4 | 4 | 0 |
| **Taster kalibrieren** `F-PROBECAL` | Tab „Probing“ | 15 | 1 | 1 | 0 |
| **Fläche abtasten (Surface-Scan)** `F-SURFACE` | Tab „Probing“ | 6 | 2 | 1 | 1 |
| **Flächenkompensation ein/aus und Interpolation umschalten** `F-COMP` | Dialog, Tab „Probing“ | 13 | 4 | 3 | 1 |

### Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut

- **S1 (Daten):** Ein Antast-Button sendet genau ein mdi mit O<probe_…> CALL und genau den Var-Nummern der Zuordnung; jeder Wert endlich. — gilt für: alle
  - Beleg: browser: `probe-click.spec.ts` — ${form.sub}: a held probe button sends its routine with the panel's numbers (je: Outside, Boss/Pocket, Ridge/Valley, Angle, Calibrate)
- **S2 (Daten):** Jede Var-Nummer, die das Panel und der Toolsetter schreiben, ist in der Var-Datei jedes Beispielprofils deklariert. — gilt für: alle
  - Beleg: unit: `probeVarFiles.test.ts` — ${rel} declares every number the probe panel and the toolsetter write (je: xyz3/sim.var, xyzabc6/sim.var, xyzac5/sim.var)
- **S2b (Daten):** Mindestens drei Var-Dateien der Beispielprofile werden gefunden (die Bedingung des Deklarationstests). — gilt für: alle
  - Beleg: unit: `probeVarFiles.test.ts` — are found: one per example profile
- **S3 (Wirkung):** Auf echtem LinuxCNC setzt Z-Antasten (probe_z_minus_wco, #3030 = 0) G54 Z auf die Platte aus der HAL der Kopie (−180 ± 0,003 mm, Kontakt #5070 = 1); eine um 1 mm versetzte Erwartung fällt durch; ohne Kontakt in der Suchtiefe meldet es keinen Kontakt, setzt nichts, und LinuxCNC meldet den Fehler. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — probe-z; native: `native_run.py` — probe-z.counter-plate-1; native: `native_run.py` — probe-z-miss — Lücke: der native Lauf steht aus (gebaut: Schritt 2a)

### Taster kalibrieren

- **S1 (Daten):** Kalibrieren sendet seine Routine mit der Achswahl #3036 und den Zahlen der Kalibrier-Zuordnung. — gilt für: alle
  - Beleg: browser: `probe-click.spec.ts` — ${form.sub}: a held probe button sends its routine with the panel's numbers (je: Calibrate)

### Fläche abtasten (Surface-Scan)

- **S1 (Daten):** Der Surface-Scan sendet auf ein Halten EIN mdi O<surface_scan> CALL mit den Werten des Panels in vars (ein vom Server gehaltener Wert kommt an). — gilt für: alle
  - Beleg: browser: `probe-click.spec.ts` — Surface: a held Start Scan sends O<surface_scan> CALL with the panel's numbers
- **S2 (Wirkung):** Auf echtem LinuxCNC tastet der Scan das Raster ab und liefert die Punkte für die Kompensation. — gilt für: 3axis_xyz
  - Beleg: **offen** — Lücke: nativ (native Stufe, mit hohem Antastvorschub über die Scan-Variablen)

### Flächenkompensation ein/aus und Interpolation umschalten

- **S1 (Unbekannt):** „AN“ erscheint nur aus einem gelesenen Pin; ein unbekannter Wert erscheint als unbekannt, nie als AUS. — gilt für: alle
  - Beleg: browser: `compensation.spec.ts` — unread pins are never OFF or Cubic: the state reads —, no method is checked, the switch is not on; browser: `compensation.spec.ts` — the reported state: ON with its method checked, OFF once the status says so
- **S2 (Unbekannt):** Die angezeigte Interpolation ist die, die der Status meldet; eine unbekannte erscheint nie als Cubic. — gilt für: alle
  - Beleg: browser: `compensation.spec.ts` — unread pins are never OFF or Cubic: the state reads —, no method is checked, the switch is not on; browser: `compensation.spec.ts` — a chosen method is sent once and pending; the reported one stays checked, 'Not confirmed' after 5 s
- **S3 (Ablehnung):** Ein Umschalten, das HAL nicht zustellt, antwortet nicht ok; ein fehlender Wert schickt nichts (kein stilles AUS, kein stilles Cubic). — gilt für: alle
  - Beleg: gateway: `test_compensation.py` — test_nothing_written_is_not_sent; gateway: `test_compensation.py` — test_an_unclear_send_is_never_ok; gateway: `test_compensation.py` — test_a_missing_value_sends_nothing
- **S4 (Wirkung):** Auf echtem LinuxCNC wirkt AN/AUS, und die drei Methoden unterscheiden sich an bekannten Punkten einer nicht ebenen Fläche. — gilt für: 3axis_xyz
  - Beleg: **offen** — Lücke: nativer Lauf offen

## Makros

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen** `F-MACROFILES` | Tab „Macros“ | 33 | 3 | 2 | 1 |
| **Makro starten (Tab, Leiste, Parameter-Dialog)** `F-MACRORUN` | Dialog, Makro-Leiste, Tab „Macros“ | 6 | 2 | 2 | 0 |
| **Makro-Leiste einrichten** `F-MACROBAR` | Tab „Macros“ | 7 | 0 | 0 | Aussagen noch nicht formuliert |

### Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen

- **S1 (Ablehnung):** Speichern ist an die gelesene Revision gebunden; ein Konflikt oder eine Ablehnung zeigt ihren Grund, der Entwurf bleibt. — gilt für: alle
  - Beleg: browser: `macros.spec.ts` — Save's refusal: a conflict rebases Keep editing on the gateway's revision
- **S2 (Wirkung):** Umbenennen verschiebt in der Oberfläche Datei und Platz auf der Leiste in einem Schritt (gegen den Ordner-Mock). — gilt für: alle
  - Beleg: browser: `macros.spec.ts` — a rename moves the file and its place on the bar
- **S3 (Wirkung):** Im Gateway ist eine Umbenennung ein Schritt: neue Datei, alte weg, Leiste umgezogen, oder nichts. — gilt für: alle
  - Beleg: **offen** — Lücke: Gateway: Atomarität der Umbenennung nicht belegt

### Makro starten (Tab, Leiste, Parameter-Dialog)

- **S1 (Bedienbarkeit):** Ein Makro auf der Leiste läuft auf ein Halten, gebunden an seine Revision; ein ungespeicherter Entwurf sperrt genau dieses Makro. — gilt für: alle
  - Beleg: browser: `macros.spec.ts` — the Macros tab lists the folder; a file put on the bar runs on a hold bound to its revision; browser: `macros.spec.ts` — an unsaved draft blocks the run of THAT macro on the bar and in the tab; Save restores it at the new revision
- **S2 (Daten):** Ein Makro mit Parametern öffnet seinen Dialog mit den Feldern des Kopfs; Ausführen ist ein Halten und sendet Zahlen. — gilt für: alle
  - Beleg: browser: `macros.spec.ts` — a macro file with parameters opens its dialog with the header's fields; Execute holds and sends numbers

## 3D-Ansicht, Simulation, Kamera

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Simulation: Zeitleiste, Abspielen, Kollisions- und Grenzprüfung, Sim-Tab** `F-SIM` | 3D-Ansicht › Zeitleiste, Tab „Sim“ | 10 | 0 | 0 | Aussagen noch nicht formuliert |
| **3D-Ansicht bedienen: Ansichten, Würfel, Spur löschen, Hinweise** `F-VIEW` | 3D-Ansicht, 3D-Ansicht › Würfel | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **3D-Ansicht einstellen: Ebenen, Farben, Projektion, Verfolgung, HUD** `F-VIEWSET` | Einstellungen | 31 | 0 | 0 | Aussagen noch nicht formuliert |
| **Kamerabild (Bild im Bild) und Überlagerung** `F-CAMERA` | 3D-Ansicht, 3D-Ansicht › Kamerabild, Einstellungen | 29 | 0 | 0 | Aussagen noch nicht formuliert |

## Oberfläche, Einstellungen, Meldungen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Einstellungen öffnen, speichern, verwerfen, zurücksetzen** `F-SETTINGS` | Dialog, Einstellungen, Kopfzeile | 26 | 1 | 1 | 0 |
| **Darstellung: Farbschema, Vollbild, Bildschirm wach halten** `F-DISPLAY` | Einstellungen, Kopfzeile | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen** `F-MESSAGES` | Banner, Dialog, Kopfzeile, Meldungen | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Navigation: Tabs und Seitenleiste** `F-TABS` | Tabs | 3 | 0 | 0 | Aussagen noch nicht formuliert |
| **Diagnose: HAL-Anzeige, Timing, Telemetrie** `F-DIAG` | Banner, Einstellungen › Debug, Einstellungen › HAL | 23 | 0 | 0 | Aussagen noch nicht formuliert |

### Einstellungen öffnen, speichern, verwerfen, zurücksetzen

- **S1 (Ablehnung):** Eine geschützte Sektion speichert nur ein freigegebener Schreiber (403 sonst); Anzeige-Sektionen brauchen kein Arm. — gilt für: alle
  - Beleg: gateway: `test_button_gates_b.py` — test_a_protected_section_needs_an_armed_writer; gateway: `test_button_gates_b.py` — test_a_display_section_needs_no_arm

## Tastatur, Gamepad, Eingabehilfen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Tastatur-Bedienung und Tastenbelegung** `F-KEYBOARD` | Einstellungen, Einstellungen › Tastatur | 37 | 3 | 3 | 0 |
| **Gamepad-Bedienung, Belegung und Einrichtungs-Assistent** `F-GAMEPAD` | Einstellungen, Einstellungen › Gamepad | 48 | 3 | 3 | 0 |
| **Eingabehilfen: Zahlen- und Text-Tastatur am Bildschirm** `F-INPUTHELP` | Tastatur-Symbol am Feld, Texttastatur, Zahlentastatur | 52 | 0 | 0 | Aussagen noch nicht formuliert |

### Tastatur-Bedienung und Tastenbelegung

- **S1 (Bedienbarkeit):** Die Leertaste startet auf der freien Seite das Programm (Cycle Start); aus einem fokussierten Bedienelement, einem offenen Editor oder durch die Fokus-Rückgabe der Zahlentastatur nie. — gilt für: alle
  - Beleg: browser: `keyboard-guards.spec.ts` — positive control: Space on the bare page sends cycle_start; browser: `touchoff.spec.ts` — Space on a focused control never reaches the Cycle Start shortcut; browser: `keyboard-guards.spec.ts` — editor open: Space never starts the program; browser: `keyboard-guards.spec.ts` — keypad OK: Space through the whole focus return never starts the program; Escape still E-Stops
- **S2 (Ablehnung):** Hinter einem Dialog geht nur Escape (E-Stop) durch; Space, Enter und Backspace erreichen die Maschine nicht. — gilt für: alle
  - Beleg: browser: `keyboard-guards.spec.ts` — settings dialog and key capture: only Escape passes, and it cancels the capture; browser: `keyboard-guards.spec.ts` — tool dialog, messages and reference dialogs block Space/Enter/Backspace
- **S3 (Daten):** Eine belegte Jog-Taste sendet jog_cont für ihre Achse (ihre Stelle in der Achsliste) in ihre Richtung und beim Loslassen jog_stop derselben Achse; die Taste einer fehlenden Achse sendet nichts (die Wirkung am Task: F-JOG S5). — gilt für: alle
  - Beleg: browser: `keyboard-guards.spec.ts` — every bound jog key jogs its own axis in its direction and stops it on release; a key of an absent axis sends nothing

### Gamepad-Bedienung, Belegung und Einrichtungs-Assistent

- **S1 (Abbruch):** Ein Gamepad-Jog stoppt beim Loslassen mit seinem eigenen Stopp — auch wenn Schritt oder Z-Umschalter sich während des Haltens ändern; ein Schritt-Jog sendet keinen Stopp. — gilt für: alle
  - Beleg: unit: `useGamepad.test.ts` — a continuous D-pad jog stops on release, the stick at rest does not stop it; unit: `useGamepad.test.ts` — a step changed mid-hold still stops the continuous jog on release; unit: `useGamepad.test.ts` — a Z jog whose modifier is let go first stops Z, not Y; unit: `useGamepad.test.ts` — a step jog sends no stop at its release
- **S2 (Ablehnung):** Vor dem Referenzieren startet eine gesperrte Achse weder vom D-Pad noch vom Stick etwas; eine offene joggt. — gilt für: alle
  - Beleg: unit: `useGamepad.test.ts` — an axis closed before homing starts nothing from the D-pad or the stick; an open one jogs
- **S3 (Daten):** Eine belegte Gamepad-Taste löst genau ihre Aktion aus (Start, Pause, Fortsetzen, Abort, E-Stop, Spindel-Stopp, Kühlmittel, Home All) über dieselbe Zulassung wie der Knopf. — gilt für: alle
  - Beleg: unit: `useGamepad.test.ts` — $action ($want.cmd): exactly its command under its control's gate; closed, nothing (je: start, pause, resume, abort, spindle_stop, flood_toggle, mist_toggle, home_all); unit: `useGamepad.test.ts` — E-Stop goes out with every gate closed, and with the buttons switched off

## Systemverträge (gemeinsame Mechanismen)

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe** `SYS-CONTROLS` | Auswahlgruppen, Detailkarte, Menü „More“, jeder Dialog, jedes Bedienelement, „?“-Hilfe | 190 | 0 | 0 | Aussagen noch nicht formuliert |
| **Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung** `SYS-CONN` | — | 26 | 5 | 2 | 3 |
| **Statusübertragung (Rahmen und gemeinsame Felder)** `SYS-STATUS` | — | 9 | 0 | 0 | Aussagen noch nicht formuliert |
| **Maschinenkonfiguration lesen: Achsen, Gelenke, Grenzen, Kinematik, Remaps, Profile** `SYS-CONFIG` | — | 19 | 0 | 0 | Aussagen noch nicht formuliert |

### Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung

- **S1 (Wirkung):** Mehrere Clients gleichzeitig: Nach dem Laden eines Programms holen mehrere Clients die Vorschau, und der Herzschlag-Abstand des Gateways bleibt sicher unter der Grenze von 500 ms. — gilt für: alle
  - Beleg: **offen** — Lücke: neues perf_matrix-Szenario mit Protokoll-Clients statt Browsern (deren Simulation läuft auf den Client-Geräten, nicht im Gateway); native Stufe. Vorhanden: fanout (8 Clients), reconnect_storm (12 Verbindungen), preview_publish (ein Client) — Operator 2026-11-04
- **S2 (Abbruch):** Trennt sich ein Client, bricht das Gateway die Bearbeitung seines laufenden Befehls ab (ein angefangenes Schreiben endet zuerst; einen schon zugestellten CNC-Befehl nimmt das nicht zurück) und verwirft die wartenden. — gilt für: alle
  - Beleg: gateway: `test_ws_command_worker.py` — test_disconnect_cancels_inflight_and_traces_drops
- **S3 (Abbruch):** Beim Disarm durch Trennen oder Herzschlag-Ablauf stoppt der Helfer die gebuchten Jogs, ohne Moduswechsel; bei laufendem AUTO sendet er nichts. — gilt für: alle
  - Beleg: gateway: `test_button_gates_e.py` — test_the_disarm_stop; gateway: `test_button_gates_e.py` — test_auto_running_sends_nothing
- **S4 (Abbruch):** Trennt sich ein Client oder läuft sein Herzschlag ab: der passende Jog-Stopp, kein pauschaler Abort eines laufenden Programms (Armed ist Autorisierung, kein Totmann); ein anderer Client bleibt verbunden. Fehlt der letzte Client oder der Gateway-Herzschlag, greift die HAL-Kette (F-ESTOP.S4). — gilt für: alle
  - Beleg: **offen** — Lücke: Integrationsbeleg offen: WS-Abgang und Timeout mit laufendem Programm und zweitem Client
- **S5 (Ablehnung):** Ein Befehl, dessen Wert die Handlung bestimmt, wird ohne diesen Wert abgelehnt: home ohne joint, set_optional_stop / set_block_delete ohne Wahrheitswert, ein Override ohne scale, spindle_forward / spindle_reverse ohne speed; wo ein Standard die sichere Richtung ist (arm ohne armed → entwaffnen), ist er ausdrücklich so entschieden. — gilt für: alle
  - Beleg: **offen** — Lücke: Gateway: heute führt es diese Befehle mit einem Standard aus (home ohne joint referenziert alle, "false" schaltet M01 ein, ein Override ohne scale setzt 100 %); 24 finite_*(msg.get(…, Standard)) und 9 bool(msg.get(…)) sind je Befehl zu sichten, bevor ein Standard entfällt — ein eigenes Gateway-Paket (F-COMP S3 war der erste Fall); der WebUI-Client sendet jedes Feld (commandShapes.test.ts)

## Nach Bedienort

Dieselben Funktionen, geordnet nach dem Ort, an dem man sie bedient.

| Bedienort | Funktionen |
|---|---|
| 3D-Ansicht | 3D-Ansicht bedienen: Ansichten, Würfel, Spur löschen, Hinweise `F-VIEW`<br>Kamerabild (Bild im Bild) und Überlagerung `F-CAMERA` |
| 3D-Ansicht › Kamerabild | Kamerabild (Bild im Bild) und Überlagerung `F-CAMERA` |
| 3D-Ansicht › Würfel | 3D-Ansicht bedienen: Ansichten, Würfel, Spur löschen, Hinweise `F-VIEW` |
| 3D-Ansicht › Zeitleiste | Simulation: Zeitleiste, Abspielen, Kollisions- und Grenzprüfung, Sim-Tab `F-SIM` |
| Auswahlgruppen | Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS` |
| Banner | Sicherheits-Auslösung quittieren, Sicherheitskette `F-TRIP`<br>Abbrechen (Abort) `F-ABORT`<br>Referenzieren und Referenz aufheben `F-HOME`<br>Programm laden, neu laden, entladen `F-LOAD`<br>Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen `F-MESSAGES`<br>Diagnose: HAL-Anzeige, Timing, Telemetrie `F-DIAG` |
| Detailkarte | Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS` |
| Dialog | Herunterfahren `F-SHUTDOWN`<br>Werkzeugwechsel (M6) mit Bestätigung `F-TOOLCHANGE`<br>Flächenkompensation ein/aus und Interpolation umschalten `F-COMP`<br>Makro starten (Tab, Leiste, Parameter-Dialog) `F-MACRORUN`<br>Einstellungen öffnen, speichern, verwerfen, zurücksetzen `F-SETTINGS`<br>Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen `F-MESSAGES` |
| Editor | Programm bearbeiten und speichern `F-EDIT` |
| Einstellungen | Freigeben (Arm) und Sperren `F-ARM`<br>Spindel von Hand: Rechts, Links, Stopp, Drehzahl `F-SPINDLE`<br>Start ab Zeile (mit Vormessung, sicherem Z, Spindel) `F-RFL`<br>Vorschau des Werkzeugwegs `F-PREVIEW`<br>Werkzeugwechsel (M6) mit Bestätigung `F-TOOLCHANGE`<br>3D-Ansicht einstellen: Ebenen, Farben, Projektion, Verfolgung, HUD `F-VIEWSET`<br>Kamerabild (Bild im Bild) und Überlagerung `F-CAMERA`<br>Einstellungen öffnen, speichern, verwerfen, zurücksetzen `F-SETTINGS`<br>Darstellung: Farbschema, Vollbild, Bildschirm wach halten `F-DISPLAY`<br>Tastatur-Bedienung und Tastenbelegung `F-KEYBOARD`<br>Gamepad-Bedienung, Belegung und Einrichtungs-Assistent `F-GAMEPAD` |
| Einstellungen › Debug | Diagnose: HAL-Anzeige, Timing, Telemetrie `F-DIAG` |
| Einstellungen › Gamepad | Gamepad-Bedienung, Belegung und Einrichtungs-Assistent `F-GAMEPAD` |
| Einstellungen › HAL | Diagnose: HAL-Anzeige, Timing, Telemetrie `F-DIAG` |
| Einstellungen › Tastatur | Tastatur-Bedienung und Tastenbelegung `F-KEYBOARD` |
| G-Code-Referenz | G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik `F-GCODEVIEW` |
| Kopfzeile | Herunterfahren `F-SHUTDOWN`<br>G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik `F-GCODEVIEW`<br>Einstellungen öffnen, speichern, verwerfen, zurücksetzen `F-SETTINGS`<br>Darstellung: Farbschema, Vollbild, Bildschirm wach halten `F-DISPLAY`<br>Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen `F-MESSAGES` |
| Leiste › Jog | Betriebsart: Manuell, MDI, Automatik `F-MODE`<br>Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren `F-JOG`<br>Kinematik-Modus umschalten: Machine, TCP, Plane `F-KINS` |
| Leiste › Overrides | Overrides: Vorschub, Eilgang, Spindel `F-OVERRIDE` |
| Leiste › Setup | Referenzieren und Referenz aufheben `F-HOME`<br>Anfahren: G30, Maschinennull, Werkstücknull `F-GOTO`<br>Antippen (Touch-off) und Nullen je Achse `F-TOUCHOFF`<br>Nullpunkte: aktives System wählen (G54 …), Tabelle bearbeiten und löschen `F-WCS`<br>Geschwenkte Ebene (TWP): erfassen, aufheben, neu ausrichten `F-TWP` |
| Leiste › Sicherheit | Freigeben (Arm) und Sperren `F-ARM`<br>Not-Halt auslösen und zurücksetzen `F-ESTOP`<br>Maschine ein und aus `F-POWER`<br>G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik `F-GCODEVIEW` |
| Leiste › Spindel | Spindel von Hand: Rechts, Links, Stopp, Drehzahl `F-SPINDLE`<br>Kühlmittel: Flood und Mist `F-COOLANT` |
| Leiste › Werkzeug | Werkzeugtabelle ansehen, suchen, sortieren `F-TOOLTABLE` |
| Makro-Leiste | Abbrechen (Abort) `F-ABORT`<br>Makro starten (Tab, Leiste, Parameter-Dialog) `F-MACRORUN` |
| Meldungen | Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen `F-MESSAGES` |
| Menü „More“ | Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS` |
| Tab „MDI“ | MDI-Befehl senden, Verlauf `F-MDI` |
| Tab „Macros“ | Abbrechen (Abort) `F-ABORT`<br>Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen `F-MACROFILES`<br>Makro starten (Tab, Leiste, Parameter-Dialog) `F-MACRORUN`<br>Makro-Leiste einrichten `F-MACROBAR` |
| Tab „Offsets“ | Nullpunkte: aktives System wählen (G54 …), Tabelle bearbeiten und löschen `F-WCS` |
| Tab „Probing“ | Abbrechen (Abort) `F-ABORT`<br>Antast-Auslösung simulieren (nur Sim) `F-SIMTRIP`<br>Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut `F-PROBE`<br>Taster kalibrieren `F-PROBECAL`<br>Fläche abtasten (Surface-Scan) `F-SURFACE`<br>Flächenkompensation ein/aus und Interpolation umschalten `F-COMP` |
| Tab „Probing“ › Toolsetter | Toolsetter einrichten (Werkzeuglängen-Messung) `F-TOOLSETTER`<br>Werkzeugwechselposition G30 lesen, übernehmen, speichern `F-G30` |
| Tab „Program“ | Abbrechen (Abort) `F-ABORT`<br>Programm laden, neu laden, entladen `F-LOAD`<br>Programm hochladen (mit Umbenennen oder Ersetzen) `F-UPLOAD`<br>Programm bearbeiten und speichern `F-EDIT`<br>Programm herunterladen `F-PROGDOWNLOAD`<br>Programm starten, pausieren, fortsetzen, Einzelschritt `F-RUN`<br>Start ab Zeile (mit Vormessung, sicherem Z, Spindel) `F-RFL`<br>Satz ausblenden und optionaler Halt `F-OPTSTOP`<br>G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik `F-GCODEVIEW` |
| Tab „Program“ › Dateien | Programm laden, neu laden, entladen `F-LOAD` |
| Tab „Sim“ | Simulation: Zeitleiste, Abspielen, Kollisions- und Grenzprüfung, Sim-Tab `F-SIM` |
| Tab „Tools“ | Werkzeugtabelle ansehen, suchen, sortieren `F-TOOLTABLE`<br>Werkzeug anlegen, bearbeiten, löschen, umnummerieren `F-TOOLEDIT`<br>Werkzeugbibliothek importieren (Fusion 360, FreeCAD) `F-TOOLIMPORT`<br>Werkzeugtabelle herunterladen `F-TOOLDOWNLOAD`<br>Werkzeugwechsel (M6) mit Bestätigung `F-TOOLCHANGE`<br>Werkzeuglänge messen (M600) und Werkzeug entladen `F-TOOLMEASURE` |
| Tab-Kopf (Abort) | Abbrechen (Abort) `F-ABORT` |
| Tabs | Navigation: Tabs und Seitenleiste `F-TABS` |
| Tastatur-Symbol am Feld | Eingabehilfen: Zahlen- und Text-Tastatur am Bildschirm `F-INPUTHELP` |
| Texttastatur | Eingabehilfen: Zahlen- und Text-Tastatur am Bildschirm `F-INPUTHELP` |
| Zahlentastatur | Eingabehilfen: Zahlen- und Text-Tastatur am Bildschirm `F-INPUTHELP` |
| jeder Dialog | Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS` |
| jedes Bedienelement | Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS` |
| „?“-Hilfe | Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS` |

**Ohne eigenes Bedienelement** (über Befehle, Tasten, Einstellungen oder das Gateway): Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung `SYS-CONN`, Statusübertragung (Rahmen und gemeinsame Felder) `SYS-STATUS`, Maschinenkonfiguration lesen: Achsen, Gelenke, Grenzen, Kinematik, Remaps, Profile `SYS-CONFIG`

