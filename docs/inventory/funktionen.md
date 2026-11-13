# Funktionsinventar

Erzeugt von `scripts/inventory/functions.py` aus `functions.json` und den Atomen der Quellen — nicht von Hand ändern.

## Vollständigkeit der Quellen

- **Quellen vollständig erfasst:** ja (1182 Atome in 17 Quellen)
- **Ungelöste Stellen:** 0
- **Ausgeschlossen (außerhalb der Grenze, mit Grund):** 1
- **Familien mit offenen Varianten:** 47 — das Atom steht, seine Varianten sind nicht einzeln abgeleitet
- **Anzeigen** (was die Oberfläche zusagt, etwa „Kompensation bestätigt aktiv“) haben keine Quelle mit Atomen; ihr Katalog sichtbarer Zusagen folgt als eigener Schritt.
- **Belegt** heißt hier: ein benannter Test existiert mit diesem Titel. Ob er lief und bestand, kommt aus den Laufberichten (nächster Schritt).

## Offene Aussagen

5 Aussagen ohne Beleg — die Lücken, mit der Schicht, die den Bruch sehen würde.

| Funktion | Aussage | Art | gilt für | Lücke |
|---|---|---|---|---|
| Antast-Auslösung simulieren (nur Sim) | In der Sim kommt der Puls am HAL-Pin probe-in an. | Wirkung | alle | Nativ: der HAL-Puls an probe-in in der Sim nicht belegt |
| Kühlmittel: Flood und Mist | Auf echtem LinuxCNC schalten Flood und Mist ihre HAL-Ausgänge. | Wirkung | offen | nativ (native Stufe) |
| Antippen (Touch-off) und Nullen je Achse | Plane: das Remap schreibt den angetippten Wert in G54. | Wirkung | Plane | kein Test liest G54 nach dem Remap; nativ (scripts/twp_touchoff_plane_check.py, Laufbindung offen) |
| Geschwenkte Ebene (TWP): erfassen, aufheben, neu ausrichten | Erfassen, Ausrichten und Aufheben ändern Ebene und Nullpunkt, wie die Anzeige es sagt. | Wirkung | Machine, Plane | nativ: scripts/twp_capture_check.py und twp_reorient_check.py (Laufbindung offen) |
| Werkzeug anlegen, bearbeiten, löschen, umnummerieren | LinuxCNC übernimmt die geschriebene Tabelle. | Wirkung | alle | Nativ: das Neuladen in LinuxCNC nicht belegt |

**Ohne formulierte Aussagen:** 18 Funktionen ohne eigene Maschinenwirkung — Programm herunterladen `F-PROGDOWNLOAD`, G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik `F-GCODEVIEW`, Vorschau des Werkzeugwegs `F-PREVIEW`, Werkzeugtabelle ansehen, suchen, sortieren `F-TOOLTABLE`, Werkzeugtabelle herunterladen `F-TOOLDOWNLOAD`, Makro-Leiste einrichten `F-MACROBAR`, Simulation: Zeitleiste, Abspielen, Kollisions- und Grenzprüfung, Sim-Tab `F-SIM`, 3D-Ansicht bedienen: Ansichten, Würfel, Spur löschen, Hinweise `F-VIEW`, 3D-Ansicht einstellen: Ebenen, Farben, Projektion, Verfolgung, HUD `F-VIEWSET`, Kamerabild (Bild im Bild) und Überlagerung `F-CAMERA`, Darstellung: Farbschema, Vollbild, Bildschirm wach halten `F-DISPLAY`, Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen `F-MESSAGES`, Navigation: Tabs und Seitenleiste `F-TABS`, Diagnose: HAL-Anzeige, Timing, Telemetrie `F-DIAG`, Eingabehilfen: Zahlen- und Text-Tastatur am Bildschirm `F-INPUTHELP`, Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe `SYS-CONTROLS`, Statusübertragung (Rahmen und gemeinsame Felder) `SYS-STATUS`, Maschinenkonfiguration lesen: Achsen, Gelenke, Grenzen, Kinematik, Remaps, Profile `SYS-CONFIG`

## Sicherheit und Maschinenzustand

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Freigeben (Arm) und Sperren** `F-ARM` | Einstellungen, Leiste › Sicherheit | 6 | 4 | 4 | 0 |
| **Not-Halt auslösen und zurücksetzen** `F-ESTOP` | Leiste › Sicherheit | 6 | 5 | 5 | 0 |
| **Sicherheits-Auslösung quittieren, Sicherheitskette** `F-TRIP` | Banner | 7 | 4 | 4 | 0 |
| **Maschine ein und aus** `F-POWER` | Leiste › Sicherheit | 6 | 1 | 1 | 0 |
| **Abbrechen (Abort)** `F-ABORT` | Banner, Makro-Leiste, Tab „Macros“, Tab „Probing“, Tab „Program“, Tab-Kopf (Abort) | 9 | 1 | 1 | 0 |
| **Betriebsart: Manuell, MDI, Automatik** `F-MODE` | Leiste › Jog | 4 | 1 | 1 | 0 |
| **Herunterfahren** `F-SHUTDOWN` | Dialog, Kopfzeile | 4 | 1 | 1 | 0 |
| **Antast-Auslösung simulieren (nur Sim)** `F-SIMTRIP` | Tab „Probing“ | 3 | 3 | 2 | 1 |

### Freigeben (Arm) und Sperren

- **S1 (Ablehnung):** Ohne Arm lehnt das Gateway eine arm-pflichtige Aktion ab, mit dem Grund „Not armed“ (geprüft an Cycle Start). Stopps und die Anzeige-Settings sind eigene Regeln ohne Arm. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_not_armed_denied
- **S2 (Ablehnung):** Arm geht erst, wenn eine Sicherheits-Auslösung quittiert ist; der Grund steht am Knopf. — gilt für: alle
  - Beleg: gateway: `test_button_gates_d.py` — test_arming_waits_for_the_acknowledgement; browser: `setup-gates.spec.ts` — the recovery order: E-Stop Reset and arming wait for the trip's acknowledgement — the reason at the button (BG-11)
- **S3 (Wirkung):** Ein Client, der länger als sein Herzschlag-Budget schweigt, verliert seine Freigabe (geprüft mit verkürztem Budget). — gilt für: alle
  - Beleg: gateway: `test_ws_command_worker.py` — test_hb_stall_disarms_silent_client
- **S3b (Daten):** Das Herzschlag-Budget eines Clients ist 3 s auf monotoner Zeit; erst darüber entwaffnet die Statusschleife. — gilt für: alle
  - Beleg: gateway: `test_hb_budget.py` — test_the_budget_is_three_seconds; gateway: `test_hb_budget.py` — test_its_boundary_on_monotonic_time; gateway: `test_hb_budget.py` — test_a_silent_armed_client_is_disarmed_by_the_loop; gateway: `test_hb_budget.py` — test_a_beating_client_stays_armed

### Not-Halt auslösen und zurücksetzen

- **S1 (Bedienbarkeit):** Escape löst genau einen Not-Halt aus, auch bei offener Zahlentastatur, und nie ein Zurücksetzen. — gilt für: alle
  - Beleg: browser: `keyboard-guards.spec.ts` — number keypad open: Space/Backspace send nothing, Escape sends exactly estop; browser: `keyboard-guards.spec.ts` — repeated Escape in E-Stop never sends estop_reset
- **S2 (Daten):** Eine offene Sicherheitskette in HAL gilt als Not-Halt, auch wenn LinuxCNC selbst keinen meldet. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_safety_chain_open_forces_estop_and_disables
- **S3 (Ablehnung):** Zurücksetzen braucht Arm und die quittierte Auslösung. — gilt für: alle
  - Beleg: gateway: `test_button_gates_d.py` — test_reset_needs_arm_and_the_acknowledgement
- **S4 (Wirkung):** Bleibt der Herzschlag des Gateways aus (SIGSTOP), verriegelt HAL den Not-Halt und hält ihn, bis die Wiederherstellung (Quittieren, Arm, Zurücksetzen) ihn löst. — gilt für: alle
  - Beleg: script: `perf_matrix.py` — sigstop_trip (live, nicht im Gate); native: `native_run.py` — latch-sticky; native: `native_run.py` — latch-recovered
- **S4b (Wirkung):** Läuft das Budget des Oneshots (0,5 s) ohne Herzschlag ab, verriegelt der Latch im selben Servotakt: im Servo-Strom ist fault-out im Sample TRUE, in dem oneshot.0.out fällt (die Gegenprobe mit dem Latch vor oneshot.0 zeigt genau einen Takt Verzug). — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — latch-same-cycle; native: `native_run.py` — latch-same-cycle.delayed-order

### Sicherheits-Auslösung quittieren, Sicherheitskette

- **S1 (Daten):** Die Entscheidung über eine Auslösung: nach sauberem Start wird sie genau einmal gemeldet; ein schon beim Start gesetzter Latch gilt als beim Start gesetzt, nicht als neue Auslösung. — gilt für: alle
  - Beleg: gateway: `test_gateway_util.py` — test_sustained_latch_banners_only_once; gateway: `test_gateway_util.py` — test_boot_faulted_does_not_banner
- **S1b (Bedienbarkeit):** Eine gemeldete Auslösung erscheint im Banner mit Quittieren; der Klick sendet die Quittung, und die Auslösung bleibt sichtbar, bis ein Status ohne sie kommt. — gilt für: alle
  - Beleg: browser: `feedback-channels.spec.ts` — a safety trip: the banner with Acknowledge; the click sends the ack, the trip stays until a status without it (F-TRIP.S1b)
- **S1c (Daten):** Das Gateway protokolliert Auslösung und Quittung im Trace (safety.tripped einmal mit dem Forensik-Bündel, safety.trip_acknowledged mit Client und Trip-Id); jede Auslösung trägt ihre Id, nach der Quittung trägt jeder Status safety_trip_acked mit dieser Id und keine Auslösung mehr, der noch gesetzte Latch löst keine zweite aus. — gilt für: alle
  - Beleg: gateway: `test_trip_trace.py` — test_trip_and_ack_along_the_poller_and_the_reader
- **S1d (Bedienbarkeit):** Das Meldungszentrum verzeichnet eine Auslösung und ihre bestätigte Quittung je einmal, nach ihrer Id: wiederholte Frames, der Klick, das bloße Fehlen der Auslösung und ein Neuladen fügen nichts hinzu (Betreiber Q323-1). — gilt für: alle
  - Beleg: browser: `feedback-channels.spec.ts` — a safety trip and its confirmed acknowledgement each stand ONCE in the message center (operator Q323-1); unit: `ws/statusStore.test.ts` — one entry per trip and one per confirmed acknowledgement, whatever the frames repeat; unit: `ws/statusStore.test.ts` — an acknowledgement of a trip this tab did not record is not recorded; unit: `ws/statusStore.test.ts` — a cleared history in this page records the same trip no second time; unit: `ws/statusStore.test.ts` — a reload finds the events in the history and records none twice; gateway: `test_ws_fanout.py` — test_safety_trip_acked_attached_only_when_present

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
- **S2 (Wirkung):** Sim-Trip pulst probe-in in einer Folge in einem Thread: das Rücksetzen folgt jedem versuchten Setzen (höchstens zwei Versuche), das Ergebnis wird getrennt gemeldet, ein Abbruch wartet bis zum Ende. — gilt für: alle
  - Beleg: gateway: `test_sim_trip.py` — test_a_pulse_sets_then_resets; gateway: `test_sim_trip.py` — test_a_timeout_after_the_effect_is_still_reset; gateway: `test_sim_trip.py` — test_a_failed_set_is_reset_anyway; gateway: `test_sim_trip.py` — test_a_first_reset_that_fails_and_a_second_that_takes; gateway: `test_sim_trip.py` — test_two_failed_resets_say_the_pin_may_still_be_true; gateway: `test_sim_trip.py` — test_a_cancel_while_the_set_runs_waits_for_the_reset; gateway: `test_sim_trip.py` — test_a_cancel_while_the_reset_runs_lets_it_end; gateway: `test_sim_trip.py` — test_the_handler_answers_the_outcome
- **S2b (Wirkung):** In der Sim kommt der Puls am HAL-Pin probe-in an. — gilt für: alle
  - Beleg: **offen** — Lücke: Nativ: der HAL-Puls an probe-in in der Sim nicht belegt

## Referenzieren und Bewegen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Referenzieren und Referenz aufheben** `F-HOME` | Banner, Leiste › Setup | 12 | 4 | 4 | 0 |
| **Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren** `F-JOG` | Leiste › Jog | 39 | 6 | 6 | 0 |
| **Anfahren: G30, Maschinennull, Werkstücknull** `F-GOTO` | Leiste › Setup | 8 | 5 | 5 | 0 |

### Referenzieren und Referenz aufheben

- **S1 (Bedienbarkeit):** Unhome All ist eine Haltegeste: ein kurzes Tippen sendet nichts und sagt warum, ein vollständiges Halten genau einen Befehl. — gilt für: alle
  - Beleg: browser: `touch-hold.spec.ts` — a short tap sends nothing and says why; a complete hold sends exactly one command
- **S2 (Daten):** Home All sendet home_all auf ein Halten; ein Tippen sendet nichts. — gilt für: alle
  - Beleg: browser: `strip-actions.spec.ts` — Home All sends home_all on a hold — a tap sends nothing
- **S2b (Daten):** Home je Achse sendet die Achse; das Gateway nennt den deklarierten Joint und sperrt eine unklare Zuordnung und — für Home — eine Home-Gruppe (negative HOME_SEQUENCE), mit Grund am Knopf; der Zustand wird am Joint gelesen. — gilt für: alle
  - Beleg: gateway: `test_home_axis.py` — test_the_target_sets; gateway: `test_home_axis.py` — test_a_swapped_joint_order_sends_the_declared_joint; gateway: `test_home_axis.py` — test_a_group_appearing_during_the_wait_sends_no_home; browser: `strip-actions.spec.ts` — Home per axis sends the axis and reads its homed state at the joint the gateway names; browser: `strip-actions.spec.ts` — a home group closes Home per axis with its reason; Unhome and Home All stay open
- **S2c (Wirkung):** Auf echtem LinuxCNC (3 Achsen, Modus Machine) referenziert Home All alle drei Joints; Home je Achse referenziert nach Unhome All genau seinen Joint (0, 1, 2), erst nach bestätigtem Abschluss. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — home-all; native: `native_run.py` — home-joint-0; native: `native_run.py` — home-joint-1; native: `native_run.py` — home-joint-2

### Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren

- **S1 (Abbruch):** Die Geste merkt sich beim Drücken ihren Stopp: das Loslassen liefert genau den Stopp, den das Drücken gestartet hat, auch wenn Schritt oder Belegung sich inzwischen ändern (Entscheidung, ohne Browser). — gilt für: alle
  - Beleg: unit: `jogGesture.test.ts` — ends a gesture with the stop recorded at its start, whatever changed since
- **S2 (Abbruch):** Ein Jog-Stopp wird von der Zulassung nie abgelehnt, auch ohne Arm und im Not-Halt (die Zustellung ist eine eigene Aussage). — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_jog_stop_always_allowed; gateway: `test_command_dispatch.py` — test_jog_stop_never_policy_denied
- **S3 (Daten):** Eine negative Jog-Geschwindigkeit bleibt erhalten: das Vorzeichen ist die Richtung. — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_jog_velocity_is_SIGNED_and_must_survive_the_clamp
- **S4 (Ablehnung):** Vor dem Referenzieren joggt jede Achse ihr deklariertes Gelenk; eine Gantry-Achse und die Diagonalen sind gesperrt, mit Grund (Entscheidung und Anzeige). — gilt für: alle
  - Beleg: gateway: `test_button_gates_e.py` — test_a_gantry_letter_is_closed; browser: `joint-jog.spec.ts` — before homing every open axis jogs in amber, the diagonals are closed with their reason; homed both are back (package F); gateway: `test_button_gates_e.py` — test_the_declared_joint_not_the_index; gateway: `test_button_gates_e.py` — test_a_diagonal_is_refused_before_homing
- **S5 (Wirkung):** Auf echtem LinuxCNC bewegen die Jog-Befehle des Gateways (jog_cont / jog_stop) jede Achse in ihrem Vorzeichen (mindestens 5 mm) und halten sie an: Weg ab der Antwort auf jog_stop höchstens v²/2a + 2·v·4T (X/Y 2,1 mm, Z 2,5 mm bei 50 mm/s), Stillstand nachweislich binnen 0,5 s, danach keine Bewegung — aus der Servo-Abtastung. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — jog-x+.servo; native: `native_run.py` — jog-x-.servo; native: `native_run.py` — jog-y+.servo; native: `native_run.py` — jog-y-.servo; native: `native_run.py` — jog-z+.servo; native: `native_run.py` — jog-z-.servo
- **S5b (Daten):** Jeder Jog-Knopf und sein Loslassen senden jog_cont / jog_stop seiner Achse und Richtung (die Diagonalen als Mehrfach-Jog sind eine eigene Aussage). — gilt für: alle
  - Beleg: browser: `jog-buttons.spec.ts` — every jog button on ${name}: its press starts exactly its axis and direction, its release stops exactly it (F-JOG.S5b) (je: XYZABCUVW, XYZAC)

### Anfahren: G30, Maschinennull, Werkstücknull

- **S1 (Wirkung):** Von über Z0: → Home senkt Z nie (das kleinste gesehene Z ist der Start); → Zero endet mit demselben Z und X/Y am Werkstücknullpunkt. — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → Zero from ABOVE Z0 (G53 Z+50): Z unchanged (never lowered), X/Y at work zero (live, nicht im Gate); script: `twp_buttons_check.py` — → Home from ABOVE Z0: min Z seen >= +50 (never lowered), X/Y to machine zero (live, nicht im Gate)
- **S1b (Wirkung):** Von unter Z0 fahren → Zero und → Home Z auf die Maschinen-Oberkante. — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → Zero from BELOW Z0 (G53 Z-60): Z at machine top exactly, X/Y at work zero, A back to the stamp (0) (live, nicht im Gate); script: `twp_buttons_check.py` — → Home from BELOW Z0: Z to machine top, X/Y to machine zero, A 0 (live, nicht im Gate)
- **S1c (Wirkung):** Z ist oben, bevor X/Y fahren (→ Zero, → Home, → G30). — gilt für: Machine
  - Beleg: native: `native_run.py` — goto-zero; native: `native_run.py` — goto-home; native: `native_run.py` — goto-g30; native: `native_run.py` — goto-zero.counter-xy-first — Lücke: → G30 ohne Abstieg: #5183 = 0 in der Kopie, der Abstieg auf #5183 nach X/Y nicht ausgeübt
- **S1d (Wirkung):** → G30 von unter Z0 erreicht unterwegs ungefähr Z0 und endet auf #5181–#5183 (die Reihenfolge: S1c). — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → G30 from BELOW Z0: retracts to the top first (max Z seen ~ 0), then lands on #5181..#5183 (live, nicht im Gate)
- **S2 (Wirkung):** → Zero nach einem Jog der Drehachse bringt den Tisch auf den Stempelwinkel zurück, X/Y lesen null. — gilt für: Machine
  - Beleg: script: `twp_buttons_check.py` — → Zero after jogging A away: table returns to A 20 and X/Y read zero (tip on the datum) (live, nicht im Gate)

## Spindel, Kühlmittel, Overrides

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Overrides: Vorschub, Eilgang, Spindel** `F-OVERRIDE` | Leiste › Overrides | 19 | 4 | 4 | 0 |
| **Spindel von Hand: Rechts, Links, Stopp, Drehzahl** `F-SPINDLE` | Einstellungen, Leiste › Spindel | 25 | 4 | 4 | 0 |
| **Kühlmittel: Flood und Mist** `F-COOLANT` | Leiste › Spindel | 8 | 2 | 1 | 1 |

### Overrides: Vorschub, Eilgang, Spindel

- **S1 (Daten):** Ein Schieber sendet seinen Faktor für genau seinen Override (50 % → 0,5); sein 100-%-Knopf sendet 1,0. — gilt für: alle
  - Beleg: browser: `strip-actions.spec.ts` — each override slider sends its own factor; its 100 % button sends 1.0
- **S2 (Wirkung):** Auf echtem LinuxCNC ändert der Feed-Override die Bahngeschwindigkeit (G1 F6000: Plateau 100 mm/s, mit 0,5 dann 50 mm/s, je ± 5 %). — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — override-plateau-100; native: `native_run.py` — override-plateau-50; native: `native_run.py` — override-plateau.counter-75
- **S2b (Wirkung):** Während der Messphase von M600 meldet der Status den Feed-Override gesperrt; nach dem Ende der Routine ist er wieder freigegeben (frisch empfangen, binnen 2 s). — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m600-t1-override-lock
- **S2c (Wirkung):** Während des Surface-Scans einschließlich seiner Rückfahrt meldet der Status den Feed-Override gesperrt; nach dem Ende ist er wieder freigegeben. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — surface-override-lock

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
| **Programm laden, neu laden, entladen** `F-LOAD` | Banner, Tab „Program“, Tab „Program“ › Dateien | 16 | 3 | 3 | 0 |
| **Programm hochladen (mit Umbenennen oder Ersetzen)** `F-UPLOAD` | Tab „Program“ | 8 | 2 | 2 | 0 |
| **Programm bearbeiten und speichern** `F-EDIT` | Editor, Tab „Program“ | 10 | 2 | 2 | 0 |
| **Programm herunterladen** `F-PROGDOWNLOAD` | Tab „Program“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm starten, pausieren, fortsetzen, Einzelschritt** `F-RUN` | Tab „Program“ | 15 | 4 | 4 | 0 |
| **Start ab Zeile (mit Vormessung, sicherem Z, Spindel)** `F-RFL` | Einstellungen, Tab „Program“ | 20 | 3 | 3 | 0 |
| **Satz ausblenden und optionaler Halt** `F-OPTSTOP` | Tab „Program“ | 6 | 1 | 1 | 0 |
| **G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik** `F-GCODEVIEW` | G-Code-Referenz, Kopfzeile, Leiste › Sicherheit, Tab „Program“ | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Vorschau des Werkzeugwegs** `F-PREVIEW` | Einstellungen | 9 | 0 | 0 | Aussagen noch nicht formuliert |

### Programm laden, neu laden, entladen

- **S1 (Bedienbarkeit):** Ein Programm lädt in E-Stop, ausgeschaltet und unreferenziert: nur Arm und Leerlauf zählen. — gilt für: alle
  - Beleg: browser: `setup-gates.spec.ts` — a program loads in E-Stop, off and unhomed: programLoad, no power or homing (BG-03); gateway: `test_button_gates_d.py` — test_open_in_estop_off_and_unhomed; gateway: `test_button_gates_d.py` — test_closed_disarmed_running_or_unread
- **S2 (Ablehnung):** Laden und Entladen werden abgelehnt, solange ein Start in Arbeit ist. — gilt für: alle
  - Beleg: gateway: `test_button_gates_d.py` — test_a_start_in_progress_refuses_load_and_unload
- **S3 (Wirkung):** Neu laden übernimmt die neue Revision; Entladen leert Programm und Vorschau. — gilt für: alle
  - Beleg: browser: `editor-guards.spec.ts` — Reload sends load_file with the loaded program's own path (F-LOAD.S3); gateway: `test_program_reload_unload.py` — test_a_reload_after_an_in_place_edit_is_published_by_the_poller; gateway: `test_program_reload_unload.py` — test_an_in_place_edit_of_the_same_path_is_an_edge; gateway: `test_program_reload_unload.py` — test_the_poller_decides_its_edge_with_it; gateway: `test_program_reload_unload.py` — test_an_edited_file_reloaded_publishes_its_new_source; gateway: `test_program_reload_unload.py` — test_unload_through_the_websocket_path

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
- **S3 (Wirkung):** Auf echtem LinuxCNC startet Start ab Zeile mit Vormessung das Programm an der gewählten Zeile: seine erste Bewegung ist diese Zeile, mit dem gemessenen Werkzeug, seiner Länge und dem Spindel-Sollwert; die Zeile und das Programm laufen bis zu ihrem Ende; keine frühere Zeile bewegt sich; der Einstieg beginnt in Ruhe am Einfahrpunkt auf sicherer Höhe, ohne Absenken davor — aus dem Servo-Strom, je Abtastung über die Zeilen der Texte zugeordnet (G61.1 im Testprogramm; Sätze ohne Bewegung sieht dieser Kanal nicht). — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — rfl-line; native: `native_run.py` — rfl-line.counter-line+1; native: `native_run.py` — rfl-no-earlier-line; native: `native_run.py` — rfl-start-point; native: `native_run.py` — rfl-start-point.counter-entry-x+1

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
| **Werkzeug anlegen, bearbeiten, löschen, umnummerieren** `F-TOOLEDIT` | Tab „Tools“ | 31 | 5 | 4 | 1 |
| **Werkzeugbibliothek importieren (Fusion 360, FreeCAD)** `F-TOOLIMPORT` | Tab „Tools“ | 17 | 4 | 4 | 0 |
| **Werkzeugtabelle herunterladen** `F-TOOLDOWNLOAD` | Tab „Tools“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugwechsel (M6) mit Bestätigung** `F-TOOLCHANGE` | Dialog, Einstellungen, Tab „Tools“ | 14 | 2 | 2 | 0 |
| **Werkzeuglänge messen (M600) und Werkzeug entladen** `F-TOOLMEASURE` | Tab „Tools“ | 10 | 9 | 9 | 0 |
| **Toolsetter einrichten (Werkzeuglängen-Messung)** `F-TOOLSETTER` | Tab „Probing“ › Toolsetter | 36 | 5 | 5 | 0 |
| **Werkzeugwechselposition G30 lesen, übernehmen, speichern** `F-G30` | Tab „Probing“ › Toolsetter | 8 | 2 | 2 | 0 |

### Werkzeug anlegen, bearbeiten, löschen, umnummerieren

- **S1 (Ablehnung):** Werkzeug bearbeiten wird abgelehnt, solange ein Programm läuft. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_tool_edit_denied_while_running
- **S2 (Daten):** Anlegen lehnt eine unsinnige oder negative Werkzeugnummer ab. — gilt für: alle
  - Beleg: gateway: `test_command_dispatch.py` — test_add_tool_garbage_number_rejected; gateway: `test_command_dispatch.py` — test_add_tool_negative_number_rejected
- **S3 (Daten):** Umnummerieren begrenzt beide Nummern, die die Oberfläche sendet. — gilt für: alle
  - Beleg: gateway: `test_command_policy.py` — test_renumber_bounds_both_numbers_the_ui_sends
- **S4 (Wirkung):** Anlegen, Ändern, Löschen und Umnummerieren ändern genau ihren Datensatz, erhalten die übrigen Werte (alle Felder in jeder Spaltenfolge, Kommentar, Metadaten) und lassen LinuxCNC die geschriebene Tabelle einmal neu laden; eine nicht verstandene Zeile stoppt die Bearbeitung, nichts wird geschrieben. — gilt für: alle
  - Beleg: gateway: `test_tool_edit_contract.py` — test_the_fixture_reads_as_written; gateway: `test_tool_edit_contract.py` — test_save_changes_only_the_sent_fields_of_its_tool; gateway: `test_tool_edit_contract.py` — test_add_adds_one_record_and_keeps_every_other; gateway: `test_tool_edit_contract.py` — test_delete_removes_one_record_and_keeps_every_other; gateway: `test_tool_edit_contract.py` — test_renumber_moves_the_number_and_keeps_an_unsent_pocket; gateway: `test_tool_edit_contract.py` — test_renumber_takes_a_sent_pocket; gateway: `test_tool_edit_contract.py` — test_each_order_survives_save_delete_and_renumber_of_another_tool; gateway: `test_tool_edit_contract.py` — test_every_edit_refuses_and_writes_nothing; gateway: `test_tool_edit_contract.py` — test_comment_and_blank_lines_are_no_tool_and_stop_nothing; gateway: `test_tool_edit_contract.py` — test_shown_whole_edited_and_normalized; gateway: `test_tool_table.py` — test_every_field_of_a_linuxcnc_line_survives_a_rewrite; gateway: `test_tool_table.py` — test_a_value_with_more_decimals_is_not_rounded_by_a_rewrite; gateway: `test_tool_table.py` — test_any_order_either_case_and_crlf_read_alike; gateway: `test_tool_table.py` — test_a_whole_decimal_in_an_integer_field_reads_as_the_number; gateway: `test_tool_table.py` — test_orientation_is_written_as_the_integer_linuxcnc_reads; gateway: `test_tool_table.py` — test_a_line_not_read_exactly_is_skipped_or_refused_by_its_number
- **S4b (Wirkung):** LinuxCNC übernimmt die geschriebene Tabelle. — gilt für: alle
  - Beleg: **offen** — Lücke: Nativ: das Neuladen in LinuxCNC nicht belegt

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
  - Beleg: native: `native_run.py` — m6-hold

### Werkzeuglänge messen (M600) und Werkzeug entladen

- **S1 (Daten):** Direkte Messung: Messen sendet EINEN Auftrag tool_measure mit der Werkzeugnummer und ohne Werte der Seite — die Toolsetter-Werte nimmt das Gateway aus der bestätigten Sektion, die es hält (der Sendevertrag). — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — Measure Current is ONE command: the tool_measure job
- **S2 (Daten):** Vormessung beim Start ab Zeile: EIN auto_run mit pre_tool und probe_vars (der Sendevertrag; Werte exemplarisch geprüft). — gilt für: alle
  - Beleg: browser: `run-hold.spec.ts` — Run from line with a pre-measurement is ONE auto_run carrying the toolsetter's values
- **S3 (Ablehnung):** Ohne eingerichteten Toolsetter (Sektion vom Server bestätigt) bleiben Messen und Entladen aus — mit Grund. — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — without the server's settings, and without a saved section, Measure Current and Unload (M600) stay off
- **S4 (Daten):** Die Abbildung nennt genau 23 Var-Nummern: #3004–#3007, #3009, #3010, #3013, #3100–#3115. — gilt für: alle
  - Beleg: unit: `toolsetterSetup.test.ts` — writes the var numbers tool_touch_off.ngc reads
- **S4b (Daten):** Jede Nummer der Abbildung ist die, die tool_touch_off.ngc für ihren Wert liest; jede andere Verwendung der Bereiche im Code der Routine, gelesen wie LinuxCNC liest (Leerraum ignoriert), ist benannt oder abgelehnt. — gilt für: alle
  - Beleg: gateway: `test_toolsetter_routine_map.py` — test_every_mapped_number_is_read_into_the_keys_own_variable; gateway: `test_toolsetter_routine_map.py` — test_every_use_of_the_ranges_is_its_own_read_or_the_known_write; gateway: `test_toolsetter_routine_map.py` — test_the_probe_number_is_not_a_toolsetter_field; gateway: `test_toolsetter_routine_map.py` — test_a_read_spelled_with_spaces_or_split_digits_is_seen; gateway: `test_toolsetter_routine_map.py` — test_an_unknown_parameter_form_fails; gateway: `test_toolsetter_routine_map.py` — test_comments_and_the_routines_own_spellings_pass
- **S5 (Wirkung):** Auf echtem LinuxCNC landet die gemessene Länge in der Werkzeugtabelle (die Länge vor der Messung ± 0,002 mm) und als derselbe Wert im G43-Offset; ein um 1 mm versetztes #3102 fällt durch. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m600-t1; native: `native_run.py` — m600-t1.counter-3102
- **S6 (Daten):** Entladen sendet im M600-Modus EINEN Auftrag tool_unload_measure, im Standardmodus tool_change 0. — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — Unload is ONE command: the tool_unload_measure job in M600 mode, tool_change 0 in the standard mode
- **S6b (Wirkung):** Auf echtem LinuxCNC entlädt T0 M600 das Werkzeug: die Spindel leer, keine Länge mehr aktiv. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m600-unload
- **S7 (Wirkung):** Mit Rückfahrt (#3106 = 1) endet M600 oben an X/Y des Aufrufs, auch von der obersten Lage auf ein längeres Werkzeug: kein Endlagenfehler, kein eigener Abstieg. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — m600-t1-return; native: `native_run.py` — m600-t1-return.counter-x+1; gateway: `test_m600_preview_worker.py` — test_the_return_from_the_top_with_a_longer_tool_stays_inside_the_travel

### Toolsetter einrichten (Werkzeuglängen-Messung)

- **S1 (Daten):** Die Einrichtung zählt erst, wenn der Server die Sektion bestätigt hat; eine Teil-Sektion nennt, was fehlt, und eine Änderung speichert nur dieses Feld. — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — a save the server never confirmed is no setup; its confirmation is; browser: `toolsetter-setup.spec.ts` — a partial section: the form names what is missing, shows unset fields empty, and a change saves only that field
- **S2 (Wirkung):** Jeder Programmstart aus Idle (Cycle Start, der erste Schritt, auto_run und Start ab Zeile) übernimmt zuerst die vom Server bestätigte Sektion in den Interpreter, gebunden an Sektion und INI; ohne vollständige Übernahme kein Start; sind alle Zahlen schon als übernommen oder rückgelesen gebucht, wird nichts geschrieben; MDI, Werkzeugwechsel, pausierter Schritt und Resume gleichen nicht ab. — gilt für: alle
  - Beleg: gateway: `test_toolsetter_sync.py` — test_cycle_start_applies_the_saved_section_first; gateway: `test_toolsetter_sync.py` — test_the_first_step_from_idle_syncs; gateway: `test_toolsetter_sync.py` — test_a_direct_run_from_line_syncs; gateway: `test_toolsetter_sync.py` — test_a_chunk_not_taken_refuses_the_start; gateway: `test_toolsetter_sync.py` — test_a_section_changed_between_choice_and_write_refuses; gateway: `test_toolsetter_sync.py` — test_a_booked_basis_writes_nothing_and_a_change_between_starts_writes_again; gateway: `test_toolsetter_sync.py` — test_a_confirmed_read_back_with_the_sections_numbers_writes_nothing; gateway: `test_toolsetter_sync.py` — test_a_paused_step_and_a_resume_never_sync; gateway: `test_toolsetter_sync.py` — test_mdi_and_a_tool_change_never_sync
- **S2b (Ablehnung):** Start ab Zeile mit Dialogwerten, die nicht die bestätigte Sektion sind, wird vor jeder Wirkung abgelehnt — nicht einmal das Skip-Flag wird geschrieben. — gilt für: alle
  - Beleg: gateway: `test_toolsetter_sync.py` — test_run_from_line_with_other_client_values_is_refused_before_any_effect
- **S2c (Wirkung):** Auf echtem LinuxCNC erreicht eine bei ausgeschalteter Maschine gespeicherte Sektion den Interpreter beim Programmstart: das M600 des Programms misst mit dem neuen #3102 (Länge = Tabelle vorher + Delta ± 0,002; die alte Basis fällt durch), die Buchung zeigt danach jede Zahl der Sektion als übernommen, ein zweiter Start schreibt nichts. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — ts-sync-program-m600; native: `native_run.py` — ts-sync-program-m600.counter-old-basis; native: `native_run.py` — ts-sync-booking; native: `native_run.py` — ts-sync-stable
- **S3 (Daten):** Das Formular zeigt, was die Maschine hält — aus der Buchung des Gateways je Verbindung: im Interpreter bestätigt, gespeichert und noch nicht übernommen, nicht bestätigt (n von 23), noch nicht bekannt; ohne Einrichtung kein Abgleich; ein Speichern, das die Rücklesung schon bestätigt, sendet nichts. — gilt für: alle
  - Beleg: browser: `toolsetter-setup.spec.ts` — the machine line follows the gateway's booking: not known, confirmed, pending, not confirmed; browser: `toolsetter-setup.spec.ts` — not set up: no machine line beyond the setup note, which says nothing is written; browser: `toolsetter-setup.spec.ts` — a save while the machine is not ready sends nothing; the line says it is not yet in the machine; browser: `toolsetter-setup.spec.ts` — a save the read-back already confirms pushes nothing; one it does not gets the convenience push (Codex R309); unit: `toolsetterState.test.ts` — equal numbers only assumed: not confirmed — the file's numbers are no proof; unit: `toolsetterState.test.ts` — one key unknown beside taken ones: not confirmed, the part named; unit: `ws/statusStore.test.ts` — belongs to its connection — a new one shows none until its own arrives

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
| **Fläche abtasten (Surface-Scan)** `F-SURFACE` | Tab „Probing“ | 7 | 2 | 2 | 0 |
| **Flächenkompensation ein/aus und Interpolation umschalten** `F-COMP` | Dialog, Tab „Probing“ | 13 | 4 | 4 | 0 |

### Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut

- **S1 (Daten):** Ein Antast-Button sendet genau einen Auftrag probe_run mit seiner probe_…-Routine und genau den Var-Nummern der Zuordnung (Zweck probe); jeder Wert endlich; kein mdi. — gilt für: alle
  - Beleg: browser: `probe-click.spec.ts` — ${form.sub}: a held probe button sends its routine with the panel's numbers (je: Outside, Boss/Pocket, Ridge/Valley, Angle, Calibrate)
- **S2 (Daten):** Jede Var-Nummer, die das Panel und der Toolsetter schreiben, ist in der Var-Datei jedes Beispielprofils deklariert. — gilt für: alle
  - Beleg: unit: `probeVarFiles.test.ts` — ${rel} declares every number the probe panel and the toolsetter write (je: xyz3/sim.var, xyzabc6/sim.var, xyzac5/sim.var)
- **S2b (Daten):** Mindestens drei Var-Dateien der Beispielprofile werden gefunden (die Bedingung des Deklarationstests). — gilt für: alle
  - Beleg: unit: `probeVarFiles.test.ts` — are found: one per example profile
- **S3 (Wirkung):** Auf echtem LinuxCNC setzt Z-Antasten (probe_z_minus_wco, #3030 = 0) G54 Z auf die Platte aus der HAL der Kopie (−180 ± 0,003 mm, Kontakt #5070 = 1); eine um 1 mm versetzte Erwartung fällt durch; ohne Kontakt in der Suchtiefe meldet es keinen Kontakt, setzt nichts, und LinuxCNC meldet den Fehler. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — probe-z; native: `native_run.py` — probe-z.counter-plate-1; native: `native_run.py` — probe-z-miss

### Taster kalibrieren

- **S1 (Daten):** Kalibrieren sendet seine Routine mit der Achswahl #3036 und den Zahlen der Kalibrier-Zuordnung. — gilt für: alle
  - Beleg: browser: `probe-click.spec.ts` — ${form.sub}: a held probe button sends its routine with the panel's numbers (je: Calibrate)

### Fläche abtasten (Surface-Scan)

- **S1 (Daten):** Der Surface-Scan sendet auf ein Halten EINEN Auftrag surface_scan_run mit genau den Werten seines Zwecks aus dem Panel (ein vom Server gehaltener Wert kommt an). — gilt für: alle
  - Beleg: browser: `probe-click.spec.ts` — Surface: a held Start Scan sends the surface_scan_run job with the panel's numbers
- **S2 (Wirkung):** Auf echtem LinuxCNC tastet der Scan das Raster ab und liefert die Punkte für die Kompensation: 5 × 5 Punkte auf dem gewölbten Werkstück der 3-Achs-Sim in der Schlangenfolge, jeder auf der Fläche ± 0,005 mm; danach lädt die Kompensation die neue Karte. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — surface-scan; native: `native_run.py` — surface-scan.counter-node+1; native: `native_run.py` — surface-scan.counter-xy-swapped; native: `native_run.py` — surface-scan.map

### Flächenkompensation ein/aus und Interpolation umschalten

- **S1 (Unbekannt):** „AN“ erscheint nur aus einem gelesenen Pin; ein unbekannter Wert erscheint als unbekannt, nie als AUS. — gilt für: alle
  - Beleg: browser: `compensation.spec.ts` — unread pins are never OFF or Cubic: the state reads —, no method is checked, the switch is not on; browser: `compensation.spec.ts` — the reported state: ON with its method checked, OFF once the status says so
- **S2 (Unbekannt):** Die angezeigte Interpolation ist die, die der Status meldet; eine unbekannte erscheint nie als Cubic. — gilt für: alle
  - Beleg: browser: `compensation.spec.ts` — unread pins are never OFF or Cubic: the state reads —, no method is checked, the switch is not on; browser: `compensation.spec.ts` — a chosen method is sent once and pending; the reported one stays checked, 'Not confirmed' after 5 s
- **S3 (Ablehnung):** Ein Umschalten, das HAL nicht zustellt, antwortet nicht ok; ein fehlender Wert schickt nichts (kein stilles AUS, kein stilles Cubic). — gilt für: alle
  - Beleg: gateway: `test_compensation.py` — test_nothing_written_is_not_sent; gateway: `test_compensation.py` — test_an_unclear_send_is_never_ok; gateway: `test_compensation.py` — test_a_missing_value_sends_nothing
- **S4 (Wirkung):** Auf echtem LinuxCNC wirkt AN/AUS, und die drei Methoden unterscheiden sich an bekannten Punkten einer nicht ebenen Fläche: am Prüfpunkt trägt jede ihren Referenzwert aus den aufgezeichneten Punkten (± 0,002 mm), AN hält die Spitze 12 mm über dem Werkstück, AUS lässt den Offset ablaufen; nach einer XY-Verfahrt erreicht die eingeschwungene Kompensation den neuen Kartenwert. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — comp-nearest; native: `native_run.py` — comp-nearest.counter-linear; native: `native_run.py` — comp-linear; native: `native_run.py` — comp-linear.counter-cubic; native: `native_run.py` — comp-cubic; native: `native_run.py` — comp-cubic.counter-nearest; native: `native_run.py` — comp-on-off; native: `native_run.py` — comp-on-off.counter-gap+0.05; native: `native_run.py` — comp-after-xy; native: `native_run.py` — comp-after-xy.counter-frozen

## Makros

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen** `F-MACROFILES` | Tab „Macros“ | 33 | 3 | 3 | 0 |
| **Makro starten (Tab, Leiste, Parameter-Dialog)** `F-MACRORUN` | Dialog, Makro-Leiste, Tab „Macros“ | 6 | 2 | 2 | 0 |
| **Makro-Leiste einrichten** `F-MACROBAR` | Tab „Macros“ | 7 | 0 | 0 | Aussagen noch nicht formuliert |

### Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen

- **S1 (Ablehnung):** Speichern ist an die gelesene Revision gebunden; ein Konflikt oder eine Ablehnung zeigt ihren Grund, der Entwurf bleibt. — gilt für: alle
  - Beleg: browser: `macros.spec.ts` — Save's refusal: a conflict rebases Keep editing on the gateway's revision
- **S2 (Wirkung):** Nach einer gelungenen Umbenennung zieht die Oberfläche den Platz auf der Leiste nach (gegen den Ordner-Mock). — gilt für: alle
  - Beleg: browser: `macros.spec.ts` — a rename moves the file and its place on the bar
- **S3 (Wirkung):** Im Gateway ist eine Umbenennung ein Schritt: neue Datei und alte weg, oder nichts. — gilt für: alle
  - Beleg: gateway: `test_macros_gateway.py` — test_a_rename_is_one_step_bound_to_the_old_revision; gateway: `test_macros_gateway.py` — test_a_rename_whose_old_name_cannot_leave_renames_nothing; gateway: `test_macros_gateway.py` — test_a_cancelled_rename_keeps_a_second_writer_out_until_it_ended

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
| **Einstellungen öffnen, speichern, verwerfen, zurücksetzen** `F-SETTINGS` | Dialog, Einstellungen, Kopfzeile | 28 | 1 | 1 | 0 |
| **Geräteprofile: dieses Gerät benennen, Simulation schalten, andere Geräte verwalten** `F-DEVICES` | Einstellungen › Geräte | 16 | 3 | 3 | 0 |
| **Funktionen abschalten (Antasten, Toolsetter, Surface-Map, Kamera, Makros, Gamepad)** `F-FEATURES` | Einstellungen | 8 | 4 | 4 | 0 |
| **Darstellung: Farbschema, Vollbild, Bildschirm wach halten** `F-DISPLAY` | Einstellungen, Kopfzeile | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen** `F-MESSAGES` | Banner, Dialog, Kopfzeile, Meldungen | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Navigation: Tabs und Seitenleiste** `F-TABS` | Tabs | 3 | 0 | 0 | Aussagen noch nicht formuliert |
| **Diagnose: HAL-Anzeige, Timing, Telemetrie** `F-DIAG` | Banner, Einstellungen › Debug, Einstellungen › HAL | 23 | 0 | 0 | Aussagen noch nicht formuliert |

### Einstellungen öffnen, speichern, verwerfen, zurücksetzen

- **S1 (Ablehnung):** Eine Maschinen-Sektion speichert nur ein freigegebener Schreiber (403 sonst); die Sektionen des eigenen Geräts brauchen kein Arm. — gilt für: alle
  - Beleg: gateway: `test_button_gates_b.py` — test_a_protected_section_needs_an_armed_writer; gateway: `test_button_gates_b.py` — test_a_device_section_goes_to_the_tokens_device_without_arm

### Geräteprofile: dieses Gerät benennen, Simulation schalten, andere Geräte verwalten

- **S1 (Ablehnung):** Ein verbundenes Gerät wird nie gelöscht; ein anderes Gerät ändert nur ein freigegebener Schreiber, das eigene braucht kein Arm. — gilt für: alle
  - Beleg: gateway: `test_button_gates_b.py` — test_a_connected_device_is_never_deleted; gateway: `test_button_gates_b.py` — test_another_device_needs_an_armed_writer; gateway: `test_device_profiles.py` — test_a_connected_device_is_never_deleted_and_an_offline_one_only_armed
- **S2 (Wirkung):** Eine Verbindung wird mit ihrem ersten hello an ihr Gerät gebunden; ihre ersten Einstellungen sind die ihres Geräts, eine Geräteänderung erreicht nur dieses Gerät. — gilt für: alle
  - Beleg: gateway: `test_device_profiles.py` — test_no_settings_before_the_hello_then_the_own_devices; gateway: `test_device_profiles.py` — test_a_devices_change_reaches_only_its_own_connections; gateway: `test_device_profiles.py` — test_a_later_hello_never_swaps_the_binding
- **S3 (Wirkung):** Ein neues Gerät startet mit Simulation aus; ein kurzer erster Besuch behält seine bestätigten Einstellungen. — gilt für: alle
  - Beleg: gateway: `test_settings_store.py` — test_an_unknown_token_makes_a_new_profile_from_the_template_simulation_off; gateway: `test_settings_store.py` — test_a_short_visit_keeps_its_profile_and_values

### Funktionen abschalten (Antasten, Toolsetter, Surface-Map, Kamera, Makros, Gamepad)

- **S1 (Ablehnung):** Ein ausgeschalteter Schalter lehnt die Aufträge und Routen seiner Funktion ab, beim Dispatch und bei jedem Schreiben; der benachbarte Weg bleibt erlaubt (Probing aus: Toolsetter und Surface laufen; Toolsetter aus: normaler Werkzeugwechsel; Makros aus: MDI; Gamepad aus: Bildschirm-Jog und die Stopps des Pads). — gilt für: alle
  - Beleg: gateway: `test_feature_switches.py` — test_probing_off_refuses_its_routines_and_parameters_only; gateway: `test_feature_switches.py` — test_surface_off_refuses_the_scan_and_switching_compensation_on; gateway: `test_feature_switches.py` — test_toolsetter_off_refuses_m600_jobs_the_normal_tool_change_stays; gateway: `test_feature_switches.py` — test_macros_off_refuses_the_run_and_the_writes_mdi_stays; gateway: `test_feature_switches.py` — test_gamepad_off_refuses_what_the_gamepad_starts_never_its_stops; gateway: `test_feature_switches.py` — test_a_switch_turned_off_meanwhile_stops_the_job_at_its_write; gateway: `test_feature_switches.py` — test_an_open_stream_ends_when_the_camera_goes_off
- **S2 (Ablehnung):** Umschalten nur armed, bei bekannt ruhendem Interpreter, ohne laufenden Befehl oder Jog und bei stehender Maschine; Surface-Map aus nur mit bekannt ausgeschalteter Kompensation; Toolsetter aus und Werkzeugwechsel M600 ist in keiner Reihenfolge speicherbar; kein Schalter sendet einen Maschinenbefehl. — gilt für: alle
  - Beleg: gateway: `test_feature_switches.py` — test_an_armed_writer_on_a_standing_idle_machine_switches; gateway: `test_feature_switches.py` — test_not_armed_refused; gateway: `test_feature_switches.py` — test_a_moving_machine_refused; gateway: `test_feature_switches.py` — test_a_command_in_flight_refused; gateway: `test_feature_switches.py` — test_surface_off_needs_the_compensation_known_off; gateway: `test_feature_switches.py` — test_toolsetter_off_with_m600_is_no_state_either_way
- **S3 (Daten):** Ein Satz außerhalb seines Zwecks (probe, surface, toolsetter) wird ganz abgelehnt, bevor etwas geschrieben ist; die Werkzeugmessung nimmt die Werte der Sektion, die der Server hält. — gilt für: alle
  - Beleg: gateway: `test_feature_switches.py` — test_a_set_outside_its_purpose_is_refused_whole; gateway: `test_feature_switches.py` — test_measuring_takes_the_servers_toolsetter_section
- **S4 (Bedienbarkeit):** Eine ausgeschaltete Funktion verschwindet aus der Oberfläche, schon ab dem ersten Bild; der Tab in Benutzung bleibt mit Hinweis, bis man ihn verlässt; das Gamepad wird aus nicht gelesen und wirkt nach dem Einschalten erst nach einer Ruhelage. — gilt für: alle
  - Beleg: browser: `feature-switches.spec.ts` — a first start with functions off never shows them: no Probing, no Macros, no macro bar, no Measure; browser: `feature-switches.spec.ts` — the tab in use stays with a note until it is left; browser: `feature-switches.spec.ts` — gamepad: its commands say so; off, the pad is not read; on again, a held button acts only after a release

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
| **Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe** `SYS-CONTROLS` | Auswahlgruppen, Detailkarte, Menü „More“, jeder Dialog, jedes Bedienelement, „?“-Hilfe | 194 | 0 | 0 | Aussagen noch nicht formuliert |
| **Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung** `SYS-CONN` | — | 26 | 5 | 5 | 0 |
| **Statusübertragung (Rahmen und gemeinsame Felder)** `SYS-STATUS` | — | 9 | 0 | 0 | Aussagen noch nicht formuliert |
| **Maschinenkonfiguration lesen: Achsen, Gelenke, Grenzen, Kinematik, Remaps, Profile** `SYS-CONFIG` | — | 19 | 0 | 0 | Aussagen noch nicht formuliert |

### Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung

- **S1 (Wirkung):** Mehrere Clients gleichzeitig: Während 4 bzw. 8 ungearmte Clients nach dem Laden eines großen Programms gleichzeitig die Vorschau holen, bleibt jeder Abstand der HAL-Herzschlagflanken nachweislich ≤ 250 ms (die Hälfte des 0,5-s-Budgets, aus den Perioden des Servo-Threads), ohne Trip. — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — clients-4; native: `native_run.py` — clients-8
- **S2 (Abbruch):** Trennt sich ein Client, bricht das Gateway die Bearbeitung seines laufenden Befehls ab (ein angefangenes Schreiben endet zuerst; einen schon zugestellten CNC-Befehl nimmt das nicht zurück) und verwirft die wartenden. — gilt für: alle
  - Beleg: gateway: `test_ws_command_worker.py` — test_disconnect_cancels_inflight_and_traces_drops
- **S3 (Abbruch):** Beim Disarm durch Trennen oder Herzschlag-Ablauf stoppt der Helfer die gebuchten Jogs, ohne Moduswechsel; bei laufendem AUTO sendet er nichts. — gilt für: alle
  - Beleg: gateway: `test_button_gates_e.py` — test_the_disarm_stop; gateway: `test_button_gates_e.py` — test_auto_running_sends_nothing
- **S4 (Abbruch):** Trennt sich ein gearmter Client oder läuft sein Herzschlag ab, läuft ein AUTO-Programm weiter, und ein zweiter Client bleibt verbunden — ab dem Ereignis des Gateways für genau diesen Client mindestens 2 s, ohne Trip. Fehlt der letzte Client oder der Gateway-Herzschlag, greift die HAL-Kette (F-ESTOP.S4). — gilt für: 3axis_xyz
  - Beleg: native: `native_run.py` — disconnect-close; native: `native_run.py` — disconnect-heartbeat
- **S5 (Ablehnung):** Ein Befehl, dessen Wert die Handlung bestimmt, wird ohne diesen Wert abgelehnt — fehlend, null, falscher Typ oder außerhalb des Bereichs —, vor jedem Schreiben und jeder Buchung; ein Stopp wird nie wegen seiner Nutzlast abgelehnt, sondern erweitert; ein Rahmen, den der Reader nicht lesen kann, wird beantwortet und der Socket liest weiter. — gilt für: alle
  - Beleg: gateway: `test_payload_contract.py` — test_every_required_field_fault_writes_nothing_and_books_nothing; gateway: `test_payload_contract.py` — test_the_old_defaults_act_no_more; gateway: `test_payload_contract.py` — test_a_malformed_jog_stop_stops_every_booked_jog_gatewayweit; gateway: `test_payload_contract.py` — test_each_malformed_frame_keeps_the_socket; gateway: `test_payload_scan.py` — test_the_gateway_holds_the_contract

## Abschaltbare Funktionen

Je Schalter (Einstellungen › Features) die Funktionen und was mit ihren Atomen geschieht: geschaltet = verschwindet aus der Oberfläche oder das Gateway lehnt ab; nach Inhalt = der Auftrag entscheidet (Zweck, nur Einschalten, Vormessung); bleibt lesbar / bleibt = Daten, Einstellungen, allgemeine NC-Wege; gemeinsam = mit einer anderen Funktion geteilt.

| Schalter | Funktion | Rollen | Hinweis |
|---|---|---|---|
| camera | Kamerabild (Bild im Bild) und Überlagerung `F-CAMERA` | geschaltet 14, bleibt lesbar 15 | — |
| gamepad | Gamepad-Bedienung, Belegung und Einrichtungs-Assistent `F-GAMEPAD` | geschaltet 40, bleibt lesbar 8 | — |
| macros | Makro-Leiste einrichten `F-MACROBAR` | geschaltet 5, bleibt lesbar 2 | — |
| macros | Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen `F-MACROFILES` | geschaltet 30, bleibt lesbar 3 | — |
| macros | Makro starten (Tab, Leiste, Parameter-Dialog) `F-MACRORUN` | geschaltet 6 | — |
| keiner (Ausnahme) | Antast-Auslösung simulieren (nur Sim) `F-SIMTRIP` | bleibt 3 | Diagnose des Taster-Eingangs, nur in Dev-Builds sichtbar, serverseitig nur Arm — benannte Ausnahme (R336), kein Schalter |
| probing | Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut `F-PROBE` | geschaltet 39, nach Inhalt 1, bleibt lesbar 38, gemeinsam 9 | — |
| probing | Taster kalibrieren `F-PROBECAL` | geschaltet 15 | — |
| surfaceMap | Flächenkompensation ein/aus und Interpolation umschalten `F-COMP` | geschaltet 2, nach Inhalt 4, bleibt lesbar 7 | Kompensation AUS ist immer zugelassen; EIN und die Methode gehören zum Schalter |
| surfaceMap | Fläche abtasten (Surface-Scan) `F-SURFACE` | geschaltet 6, bleibt lesbar 1 | — |
| toolsetter | Werkzeuglänge messen (M600) und Werkzeug entladen `F-TOOLMEASURE` | geschaltet 4, bleibt lesbar 3, bleibt 3 | Unload bleibt: mit Toolsetter aus ist der Werkzeugwechsel M6 G43 (ein gespeichertes M600 verweigert das Ausschalten) |
| toolsetter | Toolsetter einrichten (Werkzeuglängen-Messung) `F-TOOLSETTER` | geschaltet 13, bleibt lesbar 23 | — |

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
| Einstellungen | Freigeben (Arm) und Sperren `F-ARM`<br>Spindel von Hand: Rechts, Links, Stopp, Drehzahl `F-SPINDLE`<br>Start ab Zeile (mit Vormessung, sicherem Z, Spindel) `F-RFL`<br>Vorschau des Werkzeugwegs `F-PREVIEW`<br>Werkzeugwechsel (M6) mit Bestätigung `F-TOOLCHANGE`<br>3D-Ansicht einstellen: Ebenen, Farben, Projektion, Verfolgung, HUD `F-VIEWSET`<br>Kamerabild (Bild im Bild) und Überlagerung `F-CAMERA`<br>Einstellungen öffnen, speichern, verwerfen, zurücksetzen `F-SETTINGS`<br>Funktionen abschalten (Antasten, Toolsetter, Surface-Map, Kamera, Makros, Gamepad) `F-FEATURES`<br>Darstellung: Farbschema, Vollbild, Bildschirm wach halten `F-DISPLAY`<br>Tastatur-Bedienung und Tastenbelegung `F-KEYBOARD`<br>Gamepad-Bedienung, Belegung und Einrichtungs-Assistent `F-GAMEPAD` |
| Einstellungen › Debug | Diagnose: HAL-Anzeige, Timing, Telemetrie `F-DIAG` |
| Einstellungen › Gamepad | Gamepad-Bedienung, Belegung und Einrichtungs-Assistent `F-GAMEPAD` |
| Einstellungen › Geräte | Geräteprofile: dieses Gerät benennen, Simulation schalten, andere Geräte verwalten `F-DEVICES` |
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

