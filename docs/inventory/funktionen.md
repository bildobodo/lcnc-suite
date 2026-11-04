# Funktionsinventar

Erzeugt von `scripts/inventory/functions.py` aus `functions.json` und den Atomen der Quellen — nicht von Hand ändern.

## Vollständigkeit der Quellen

- **Quellen vollständig erfasst:** ja (1143 Atome in 17 Quellen)
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
| **Sicherheits-Auslösung quittieren, Sicherheitskette** `F-TRIP` | Hauptfenster (Kopf, Banner, MDI, Dialoge) | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Maschine ein und aus** `F-POWER` | Leiste › Sicherheit | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Abbrechen (Abort)** `F-ABORT` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Makro-Leiste, Tab „Macros“, Tab „Probing“, Tab „Program“ | 9 | 0 | 0 | Aussagen noch nicht formuliert |
| **Betriebsart: Manuell, MDI, Automatik** `F-MODE` | — | 3 | 0 | 0 | Aussagen noch nicht formuliert |
| **Herunterfahren** `F-SHUTDOWN` | Hauptfenster (Kopf, Banner, MDI, Dialoge) | 4 | 0 | 0 | Aussagen noch nicht formuliert |
| **Antast-Auslösung simulieren (nur Sim)** `F-SIMTRIP` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Probing“ | 3 | 0 | 0 | Aussagen noch nicht formuliert |

## Referenzieren und Bewegen

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Referenzieren und Referenz aufheben** `F-HOME` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Leiste › Setup | 11 | 0 | 0 | Aussagen noch nicht formuliert |
| **Tippbetrieb (Jog): Taste, Schritt, Geschwindigkeit, vor dem Referenzieren** `F-JOG` | Leiste › Jog | 38 | 0 | 0 | Aussagen noch nicht formuliert |
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
| **Antippen (Touch-off) und Nullen je Achse** `F-TOUCHOFF` | Leiste › Setup | 9 | 0 | 0 | Aussagen noch nicht formuliert |
| **Nullpunkt-Tabelle (Offsets) bearbeiten und löschen** `F-WCS` | Tab „Offsets“ | 11 | 0 | 0 | Aussagen noch nicht formuliert |
| **Geschwenkte Ebene (TWP) und Kinematik-Modus** `F-TWP` | Leiste › Setup | 33 | 0 | 0 | Aussagen noch nicht formuliert |

## Programm

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Programm laden, neu laden, entladen** `F-LOAD` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Program“, Tab „Program“ › Dateien | 16 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm hochladen (mit Umbenennen oder Ersetzen)** `F-UPLOAD` | Tab „Program“ | 8 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm bearbeiten und speichern** `F-EDIT` | Editor, Tab „Program“ | 10 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm herunterladen** `F-PROGDOWNLOAD` | Tab „Program“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Programm starten, pausieren, fortsetzen, Einzelschritt** `F-RUN` | Tab „Program“ | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Start ab Zeile (mit Vormessung, sicherem Z, Spindel)** `F-RFL` | Einstellungen, Tab „Program“ | 20 | 0 | 0 | Aussagen noch nicht formuliert |
| **Satz ausblenden und optionaler Halt** `F-OPTSTOP` | Tab „Program“ | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **G-Code ansehen, aktive Codes, Codewort-Referenz, Statistik** `F-GCODEVIEW` | G-Code-Referenz, Hauptfenster (Kopf, Banner, MDI, Dialoge), Leiste › Sicherheit, Tab „Program“ | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Vorschau des Werkzeugwegs** `F-PREVIEW` | Einstellungen | 9 | 0 | 0 | Aussagen noch nicht formuliert |

## MDI

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **MDI-Befehl senden, Verlauf** `F-MDI` | Hauptfenster (Kopf, Banner, MDI, Dialoge) | 6 | 0 | 0 | Aussagen noch nicht formuliert |

## Werkzeuge

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Werkzeugtabelle ansehen, suchen, sortieren** `F-TOOLTABLE` | Leiste › Werkzeug, Tab „Tools“ | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeug anlegen, bearbeiten, löschen, umnummerieren** `F-TOOLEDIT` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Tools“ | 31 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugbibliothek importieren (Fusion 360, FreeCAD)** `F-TOOLIMPORT` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Tools“ | 17 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugtabelle herunterladen** `F-TOOLDOWNLOAD` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Tools“ | 2 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugwechsel (M6) mit Bestätigung** `F-TOOLCHANGE` | Einstellungen, Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Tools“ | 14 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeuglänge messen (M600) und Werkzeug entladen** `F-TOOLMEASURE` | Hauptfenster (Kopf, Banner, MDI, Dialoge) | 8 | 5 | 4 | 1 |
| **Toolsetter einrichten (Werkzeuglängen-Messung)** `F-TOOLSETTER` | Tab „Probing“ › Toolsetter | 36 | 0 | 0 | Aussagen noch nicht formuliert |
| **Werkzeugwechselposition G30 lesen, übernehmen, speichern** `F-G30` | Tab „Probing“ › Toolsetter | 8 | 0 | 0 | Aussagen noch nicht formuliert |

### Werkzeuglänge messen (M600) und Werkzeug entladen

- **S1 (Daten):** Direkte Messung: Messen sendet EIN mdi mit den Toolsetter-Werten in vars (#3004–#3007, #3009, #3010, #3013, #3100–#3115).  
  Beleg: browser: `toolsetter-setup.spec.ts` — Measure Current is ONE command: the values ride the mdi
- **S2 (Daten):** Vormessung beim Start ab Zeile: EIN auto_run mit pre_tool und probe_vars aus derselben Abbildung.  
  Beleg: browser: `run-hold.spec.ts` — Run from line with a pre-measurement is ONE auto_run carrying the toolsetter's values
- **S3 (Ablehnung):** Ohne eingerichteten Toolsetter (Sektion vom Server bestätigt) bleiben Messen und Entladen aus — mit Grund.  
  Beleg: browser: `toolsetter-setup.spec.ts` — without the server's settings, and without a saved section, Measure Current and Unload (M600) stay off
- **S4 (Daten):** Die Var-Nummern sind die, die tool_touch_off.ngc liest.  
  Beleg: unit: `toolsetterSetup.test.ts` — writes the var numbers tool_touch_off.ngc reads
- **S5 (Wirkung):** Auf echtem LinuxCNC landet die gemessene Länge in der Werkzeugtabelle und im G43-Offset.  
  Beleg: **offen** — Lücke: nativer Lauf offen (nach Schritt 7)

## Antasten und Flächenkompensation

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut** `F-PROBE` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Probing“ | 87 | 3 | 2 | 1 |
| **Taster kalibrieren** `F-PROBECAL` | Tab „Probing“ | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Fläche abtasten (Surface-Scan)** `F-SURFACE` | Tab „Probing“ | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Flächenkompensation ein/aus und Interpolation umschalten** `F-COMP` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Tab „Probing“ | 13 | 4 | 0 | 4 |

### Antasten: Kanten, Ecken, Bohrung, Zapfen, Winkel, Steg und Nut

- **S1 (Daten):** Ein Antast-Button sendet genau ein mdi mit O<probe_…> CALL und genau den Var-Nummern der Zuordnung; jeder Wert endlich.  
  Beleg: browser: `probe-click.spec.ts` — : a held probe button sends its routine with the panel's numbers
- **S2 (Daten):** Jede Var-Nummer, die das Panel schreibt, ist in jeder ausgelieferten Var-Datei deklariert.  
  Beleg: unit: `probeVarFiles.test.ts` — are found: one per example profile
- **S3 (Wirkung):** Auf echtem LinuxCNC setzt ein Z-Antasten G54 Z auf den erwarteten Wert (Platte, Werkzeug, Toleranz je Messgröße).  
  Beleg: **offen** — Lücke: Schritt 7, der Antast-Live-Check

### Flächenkompensation ein/aus und Interpolation umschalten

- **S1 (Unbekannt):** „AN“ erscheint nur aus einem gelesenen Pin; ein unbekannter Wert erscheint als unbekannt, nie als AUS.  
  Beleg: **offen** — Lücke: App.vue macht aus fehlendem eoffset_enabled mit !! ein AUS — das erste Lückenpaket
- **S2 (Unbekannt):** Die angezeigte Interpolation ist die, die der Status meldet; eine unbekannte erscheint nie als Cubic.  
  Beleg: **offen** — Lücke: ProbePanel.vue wählt mit compMethod ?? 2 Cubic — das erste Lückenpaket
- **S3 (Ablehnung):** Ein Umschalten, das HAL nicht zustellt, antwortet nicht ok.  
  Beleg: **offen** — Lücke: gateway.py ignoriert das Ergebnis von _hal_send — das erste Lückenpaket
- **S4 (Wirkung):** Auf echtem LinuxCNC wirkt AN/AUS, und die drei Methoden unterscheiden sich an bekannten Punkten einer nicht ebenen Fläche.  
  Beleg: **offen** — Lücke: nativer Lauf offen

## Makros

| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |
|---|---|---|---|---|---|
| **Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen** `F-MACROFILES` | Tab „Macros“ | 33 | 2 | 2 | 0 |
| **Makro starten (Tab, Leiste, Parameter-Dialog)** `F-MACRORUN` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Makro-Leiste, Tab „Macros“ | 6 | 0 | 0 | Aussagen noch nicht formuliert |
| **Makro-Leiste einrichten** `F-MACROBAR` | Tab „Macros“ | 7 | 0 | 0 | Aussagen noch nicht formuliert |

### Makros verwalten: anlegen, bearbeiten, umbenennen, löschen, importieren, herunterladen

- **S1 (Ablehnung):** Speichern ist an die gelesene Revision gebunden; ein Konflikt oder eine Ablehnung zeigt ihren Grund, der Entwurf bleibt.  
  Beleg: browser: `macros.spec.ts` — Save's refusal: a conflict rebases Keep editing on the gateway's revision
- **S2 (Wirkung):** Umbenennen verschiebt die Datei und ihren Platz auf der Leiste in einem Schritt.  
  Beleg: browser: `macros.spec.ts` — a rename moves the file and its place on the bar

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
| **Einstellungen öffnen, speichern, verwerfen, zurücksetzen** `F-SETTINGS` | Einstellungen, Hauptfenster (Kopf, Banner, MDI, Dialoge) | 26 | 0 | 0 | Aussagen noch nicht formuliert |
| **Darstellung: Farbschema, Vollbild, Bildschirm wach halten** `F-DISPLAY` | Einstellungen, Hauptfenster (Kopf, Banner, MDI, Dialoge) | 13 | 0 | 0 | Aussagen noch nicht formuliert |
| **Meldungen: Nachrichtenzentrale, Filter, Kopieren, Löschen** `F-MESSAGES` | Hauptfenster (Kopf, Banner, MDI, Dialoge), Meldungen | 15 | 0 | 0 | Aussagen noch nicht formuliert |
| **Navigation: Tabs und Seitenleiste** `F-TABS` | Tabs | 3 | 0 | 0 | Aussagen noch nicht formuliert |
| **Diagnose: HAL-Anzeige, Timing, Telemetrie** `F-DIAG` | Einstellungen › Debug, Einstellungen › HAL, Hauptfenster (Kopf, Banner, MDI, Dialoge) | 23 | 0 | 0 | Aussagen noch nicht formuliert |

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
| **Verbindung: Anmeldung, Herzschlag, Wiederverbindung, Auslieferung** `SYS-CONN` | — | 26 | 0 | 0 | Aussagen noch nicht formuliert |
| **Statusübertragung (Rahmen und gemeinsame Felder)** `SYS-STATUS` | — | 9 | 0 | 0 | Aussagen noch nicht formuliert |
| **Maschinenkonfiguration lesen: Achsen, Gelenke, Grenzen, Kinematik, Remaps, Profile** `SYS-CONFIG` | — | 19 | 0 | 0 | Aussagen noch nicht formuliert |

