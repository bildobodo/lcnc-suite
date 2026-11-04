# Funktionsinventar

Erzeugt von `scripts/inventory/functions.py` aus `functions.json` und den Atomen der Quellen — nicht von Hand ändern.

## Vollständigkeit der Quellen

- **Quellen vollständig erfasst:** ja (1147 Atome in 17 Quellen)
- **Ungelöste Stellen:** 0
- **Ausgeschlossen (außerhalb der Grenze, mit Grund):** 1
- **Familien mit offenen Varianten:** 45 — das Atom steht, seine Varianten sind nicht einzeln abgeleitet
- **Anzeigen** (was die Oberfläche zusagt, etwa „Kompensation bestätigt aktiv“) haben keine Quelle mit Atomen; ihr Katalog sichtbarer Zusagen folgt als eigener Schritt.
- **Belegt** heißt hier: ein benannter Test existiert mit diesem Titel. Ob er lief und bestand, kommt aus den Laufberichten (nächster Schritt).

## Sicherheit und Maschinenzustand

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Freigeben (Arm) und Sperren** `F-ARM` | Einstellungen, Leiste › Sicherheit | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Not-Halt auslösen und zurücksetzen** `F-ESTOP` | Leiste › Sicherheit | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Sicherheits-Auslösung quittieren, Sicherheitskette** `F-TRIP` | Banner | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Maschine ein und aus** `F-POWER` | Leiste › Sicherheit | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Abbrechen (Abort)** `F-ABORT` | Banner, Makro-Leiste, Tab „Macros“, Tab „Probing“, Tab „Program“, Tab-Kopf (Abort) | 9 | 0 | 0 | Aussagen noch nicht formuliert |
| **Betriebsart: Manuell, MDI, Automatik** `F-MODE` | Leiste › Jog | 4 | 0 | 0 | Aussagen noch nicht formuliert |
| **Herunterfahren** `F-SHUTDOWN` | Dialog, Kopfzeile | 4 | 0 | 0 | Aussagen noch nicht formuliert |
| **Antast-Auslösung simulieren (nur Sim)** `F-SIMTRIP` | Tab „Probing“ | 3 | 0 | 0 | Aussagen noch nicht formuliert |

## Referenzieren und Bewegen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Referenzieren und Referenz aufheben** `F-HOME` | Banner, Leiste › Setup | 11 | 0 | 0 | Aussagen noch nicht formuliert |
| **Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren** `F-JOG` | Leiste › Jog | 39 | 0 | 0 | Aussagen noch nicht formuliert |
| **Anfahren: G30, Maschinennull, Werkstücknull** `F-GOTO` | Leiste › Setup | 8 | 0 | 0 | Aussagen noch nicht formuliert |

## Spindel, Kühlmittel, Overrides

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Overrides: Vorschub, Eilgang, Spindel** `F-OVERRIDE` | Leiste › Overrides | 19 | 0 | 0 | Aussagen noch nicht formuliert |
| **Spindel von Hand: Rechts, Links, Stopp, Drehzahl** `F-SPINDLE` | Einstellungen, Leiste › Spindel | 25 | 0 | 0 | Aussagen noch nicht formuliert |
| **Kühlmittel: Flood und Mist** `F-COOLANT` | Leiste › Spindel | 8 | 0 | 0 | Aussagen noch nicht formuliert |

## Werkstück-Koordinaten und Ebenen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Antippen (Touch-off) und Nullen je Achse** `F-TOUCHOFF` | Leiste › Setup | 9 | 3 | 3 | 0 |
| **Nullpunkte: aktives System wählen (G54 …), Tabelle bearbeiten und löschen** `F-WCS` | Leiste › Setup, Tab „Offsets“ | 12 | 0 | 0 | Aussagen noch nicht formuliert |
| **Kinematik-Modus umschalten: Machine, TCP, Plane** `F-KINS` | Leiste › Jog | 3 | 1 | 1 | 0 |
| **Geschwenkte Ebene (TWP): erfassen, aufheben, neu ausrichten** `F-TWP` | Leiste › Setup | 31 | 0 | 0 | Aussagen noch nicht formuliert |

### Antippen (Touch-off) und Nullen je Achse

- **S1 (Daten):** Machine: lineare Achsen schreiben in G54–G58, Drehachsen nur in G54; die Hilfszeilen G59–G59.3 sind gesperrt. — gilt für: Machine
  - Beleg: gateway: `test_command_policy.py` — test_identity_linear_into_operator_fixtures; gateway: `test_command_policy.py` — test_rotary_identity_g54_only; gateway: `test_command_policy.py` — test_identity_reserved_rows_refused
- **S2 (Ablehnung):** TCP: Antippen nur bei Tisch in Nulllage (A = 0); geneigt abgelehnt, Hilfszeilen gesperrt. — gilt für: TCP
  - Beleg: gateway: `test_command_policy.py` — test_tcp_linear_at_datum_allowed; gateway: `test_command_policy.py` — test_tcp_tilted_table_refused; gateway: `test_command_policy.py` — test_tcp_reserved_rows_refused
- **S3 (Daten):** Plane: lineare Achsen gehen über G59 und das Remap in G54, nur mit aktiver Ebene; Drehachsen gesperrt. — gilt für: Plane
  - Beleg: gateway: `test_command_policy.py` — test_plane_mode_linear_routes_to_remap; gateway: `test_command_policy.py` — test_plane_mode_needs_active_plane_and_g59; gateway: `test_command_policy.py` — test_plane_mode_rotary_touchoff_refused; browser: `touchoff.spec.ts` — Plane mode: rotary touch-off closed, reserved fixtures disabled, Zero XYZ stays open

### Kinematik-Modus umschalten: Machine, TCP, Plane

- **S1 (Bedienbarkeit):** Die Kinematik-Auswahl zeigt den Rahmen, den der gemeldete Typ bedeutet, und sendet Rahmen. — gilt für: Machine, TCP, Plane
  - Beleg: browser: `touchoff.spec.ts` — kinematics selector shows the FRAME the raw type means, and emits frames

## Programm

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Programm laden, neu laden, entladen** `F-LOAD` | Banner, Tab „Program“, Tab „Program“ › Dateien | 16 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm hochladen (mit Umbenennen oder Ersetzen)** `F-UPLOAD` | Tab „Program“ | 8 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm bearbeiten und speichern** `F-EDIT` | Editor, Tab „Program“ | 10 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm herunterladen** `F-PROGDOWNLOAD` | Tab „Program“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm starten, pausieren, fortsetzen, Einzelschritt** `F-RUN` | Tab „Program“ | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Start ab Zeile (mit Vormessung, sicherem Z, Spindel)** `F-RFL` | Einstellungen, Tab „Program“ | 20 | 0 | 0 | Aussagen noch nicht formuliert |
| **Satz ausblenden und optionaler Halt** `F-OPTSTOP` | Tab „Program“ | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik** `F-GCODEVIEW` | G-Code-Referenz, Kopfzeile, Leiste › Sicherheit, Tab „Program“ | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Vorschau des Werkzeugwegs** `F-PREVIEW` | Einstellungen | 9 | 0 | 0 | Aussagen noch nicht formuliert |

## MDI

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **MDI-Befehl senden, Verlauf** `F-MDI` | Tab „MDI“ | 6 | 0 | 0 | Aussagen noch nicht formuliert |

## Werkzeuge

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Werkzeugtabelle ansehen, suchen, sortieren** `F-TOOLTABLE` | Leiste › Werkzeug, Tab „Tools“ | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeug anlegen, bearbeiten, löschen, umnummerieren** `F-TOOLEDIT` | Tab „Tools“ | 31 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugbibliothek importieren (Fusion 360, FreeCAD)** `F-TOOLIMPORT` | Tab „Tools“ | 17 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugtabelle herunterladen** `F-TOOLDOWNLOAD` | Tab „Tools“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugwechsel (M6) mit Bestätigung** `F-TOOLCHANGE` | Dialog, Einstellungen, Tab „Tools“ | 14 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeuglänge messen (M600) und Werkzeug entladen** `F-TOOLMEASURE` | Tab „Tools“ | 8 | 5 | 4 | 1 |
| **Toolsetter einrichten (Werkzeuglängen-Messung)** `F-TOOLSETTER` | Tab „Probing“ › Toolsetter | 36 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugwechselposition G30 lesen, übernehmen, speichern** `F-G30` | Tab „Probing“ › Toolsetter | 8 | 0 | 0 | Aussagen noch nicht formuliert |

### Werkzeuglänge messen (M600) und Werkzeug entladen

- **S1 (Daten):** Direkte Messung: Messen sendet EIN mdi mit den Toolsetter-Werten in vars (#3004–#3007, #3009, #3010, #3013, #3100–#3115).
  - Beleg: browser: `toolsetter-setup.spec.ts` — Measure Current is ONE command: the values ride the mdi
- **S2 (Daten):** Vormessung beim Start ab Zeile: EIN auto_run mit pre_tool und probe_vars aus derselben Abbildung.
  - Beleg: browser: `run-hold.spec.ts` — Run from line with a pre-measurement is ONE auto_run carrying the toolsetter's values
- **S3 (Ablehnung):** Ohne eingerichteten Toolsetter (Sektion vom Server bestätigt) bleiben Messen und Entladen aus — mit Grund.
  - Beleg: browser: `toolsetter-setup.spec.ts` — without the server's settings, and without a saved section, Measure Current and Unload (M600) stay off
- **S4 (Daten):** Die Var-Nummern sind die, die tool_touch_off.ngc liest.
  - Beleg: unit: `toolsetterSetup.test.ts` — writes the var numbers tool_touch_off.ngc reads
- **S5 (Wirkung):** Auf echtem LinuxCNC landet die gemessene Länge in der Werkzeugtabelle und im G43-Offset.
  - Beleg: **offen** — Lücke: nativer Lauf offen (nach Schritt 7)

## Antasten und Flächenkompensation

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut** `F-PROBE` | Tab „Probing“ | 87 | 3 | 2 | 1 |
| **Taster kalibrieren** `F-PROBECAL` | Tab „Probing“ | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Fläche abtasten (Surface-Scan)** `F-SURFACE` | Tab „Probing“ | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Flächenkompensation ein/aus und Interpolation umschalten** `F-COMP` | Dialog, Tab „Probing“ | 13 | 4 | 0 | 4 |

### Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut

- **S1 (Daten):** Ein Antast-Button sendet genau ein mdi mit O<probe_…> CALL und genau den Var-Nummern der Zuordnung; jeder Wert endlich.
  - Beleg: browser: `probe-click.spec.ts` — : a held probe button sends its routine with the panel's numbers
- **S2 (Daten):** Jede Var-Nummer, die das Panel schreibt, ist in jeder ausgelieferten Var-Datei deklariert.
  - Beleg: unit: `probeVarFiles.test.ts` — are found: one per example profile
- **S3 (Wirkung):** Auf echtem LinuxCNC setzt ein Z-Antasten G54 Z auf den erwarteten Wert (Platte, Werkzeug, Toleranz je Messgröße).
  - Beleg: **offen** — Lücke: Schritt 7, der Antast-Live-Check

### Flächenkompensation ein/aus und Interpolation umschalten

- **S1 (Unbekannt):** „AN“ erscheint nur aus einem gelesenen Pin; ein unbekannter Wert erscheint als unbekannt, nie als AUS.
  - Beleg: **offen** — Lücke: App.vue macht aus fehlendem eoffset_enabled mit !! ein AUS — das erste Lückenpaket
- **S2 (Unbekannt):** Die angezeigte Interpolation ist die, die der Status meldet; eine unbekannte erscheint nie als Cubic.
  - Beleg: **offen** — Lücke: ProbePanel.vue wählt mit compMethod ?? 2 Cubic — das erste Lückenpaket
- **S3 (Ablehnung):** Ein Umschalten, das HAL nicht zustellt, antwortet nicht ok.
  - Beleg: **offen** — Lücke: gateway.py ignoriert das Ergebnis von _hal_send — das erste Lückenpaket
- **S4 (Wirkung):** Auf echtem LinuxCNC wirkt AN/AUS, und die drei Methoden unterscheiden sich an bekannten Punkten einer nicht ebenen Fläche.
  - Beleg: **offen** — Lücke: nativer Lauf offen

## Makros

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen** `F-MACROFILES` | Tab „Macros“ | 33 | 2 | 2 | 0 |
| **Makro starten (Tab, Leiste, Parameter-Dialog)** `F-MACRORUN` | Dialog, Makro-Leiste, Tab „Macros“ | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Makro-Leiste einrichten** `F-MACROBAR` | Tab „Macros“ | 7 | 0 | 0 | Aussagen noch nicht formuliert |

### Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen

- **S1 (Ablehnung):** Speichern ist an die gelesene Revision gebunden; ein Konflikt oder eine Ablehnung zeigt ihren Grund, der Entwurf bleibt.
  - Beleg: browser: `macros.spec.ts` — Save's refusal: a conflict rebases Keep editing on the gateway's revision
- **S2 (Wirkung):** Umbenennen verschiebt die Datei und ihren Platz auf der Leiste in einem Schritt.
  - Beleg: browser: `macros.spec.ts` — a rename moves the file and its place on the bar

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
| **Einstellungen öffnen, speichern, verwerfen, zurücksetzen** `F-SETTINGS` | Dialog, Einstellungen, Kopfzeile | 26 | 0 | 0 | Aussagen noch nicht formuliert |
| **Darstellung: Farbschema, Vollbild, Bildschirm wach halten** `F-DISPLAY` | Einstellungen, Kopfzeile | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen** `F-MESSAGES` | Banner, Dialog, Kopfzeile, Meldungen | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Navigation: Tabs und Seitenleiste** `F-TABS` | Tabs | 3 | 0 | 0 | Aussagen noch nicht formuliert |
| **Diagnose: HAL-Anzeige, Timing, Telemetrie** `F-DIAG` | Banner, Einstellungen › Debug, Einstellungen › HAL | 23 | 0 | 0 | Aussagen noch nicht formuliert |

## Tastatur, Gamepad, Eingabehilfen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Tastatur-Bedienung und Tastenbelegung** `F-KEYBOARD` | Einstellungen, Einstellungen › Tastatur | 37 | 0 | 0 | Aussagen noch nicht formuliert |
| **Gamepad-Bedienung, Belegung und Einrichtungs-Assistent** `F-GAMEPAD` | Einstellungen, Einstellungen › Gamepad | 48 | 0 | 0 | Aussagen noch nicht formuliert |
| **Eingabehilfen: Zahlen- und Text-Tastatur am Bildschirm** `F-INPUTHELP` | Tastatur-Symbol am Feld, Texttastatur, Zahlentastatur | 52 | 0 | 0 | Aussagen noch nicht formuliert |

## Systemverträge (gemeinsame Mechanismen)

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Bedienelemente: Katalog, Freigaben, Erklärung am Element, Dialoge, Hilfe** `SYS-CONTROLS` | Auswahlgruppen, Detailkarte, Menü „More“, jeder Dialog, jedes Bedienelement, „?“-Hilfe | 190 | 0 | 0 | Aussagen noch nicht formuliert |
| **Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung** `SYS-CONN` | — | 26 | 1 | 0 | 1 |
| **Statusübertragung (Rahmen und gemeinsame Felder)** `SYS-STATUS` | — | 9 | 0 | 0 | Aussagen noch nicht formuliert |
| **Maschinenkonfiguration lesen: Achsen, Gelenke, Grenzen, Kinematik, Remaps, Profile** `SYS-CONFIG` | — | 19 | 0 | 0 | Aussagen noch nicht formuliert |

### Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung

- **S1 (Wirkung):** Mehrere Clients gleichzeitig: Nach dem Laden eines Programms holen mehrere Clients die Vorschau, und der Herzschlag-Abstand des Gateways bleibt sicher unter der Grenze von 500 ms.
  - Beleg: **offen** — Lücke: neues perf_matrix-Szenario mit Protokoll-Clients statt Browsern (deren Simulation läuft auf den Client-Geräten, nicht im Gateway); native Stufe. Vorhanden: fanout (8 Clients), reconnect_storm (12 Verbindungen), preview_publish (ein Client) — Operator 2026-11-04

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

