# Viewer-Farben: Paletten, andere CNC-Oberflächen, Normen

**Recherche · 27. September 2026.** Anlass: die Fragen des Operators zur Viewer-Palette, nach
[viewer-kontrast.plan.md](viewer-kontrast.plan.md) umgesetzt:
- Sind Magenta und Cyan nicht der maximale Kontrast?
- Was ist üblich?
- Gibt es Normen?
- Was machen andere CNC-Oberflächen?

Belegart je Aussage:
- **[P]** Primärquelle gelesen (Quelltext, Handbuch, Normvorschau).
- **[S]** Sekundärquelle (Zusammenfassung, Herstellerabdruck).
- **[U]** Nicht verifiziert.
- **[C]** Eigene Rechnung: WCAG-Kontrast, OKLab-Abstand, Machado-2009-Simulation wie in
  `themeTokens.test.ts`.

Hintergründe in den Rechnungen:

| Kürzel | Farbe | Fläche |
|---|---|---|
| W | #FFFFFF | Weiß |
| K | #111111 | fast Schwarz |
| E0 | #E0E0E0 | beleuchtete Maschine |
| 80 | #808080 | Mittelgrau |

## Kurzantworten

- **Magenta/Cyan:** Beide sind im Farbton gut getrennt, auch bei Farbsehschwäche. „Maximaler
  Kontrast“ sind sie aber nicht:
  - Untereinander nur 2,5 : 1 Helligkeitskontrast, und 120° auseinander statt komplementär [C].
  - Cyan hat auf Weiß nur 1,25 : 1 und auf der beleuchteten Maschine 1,05 : 1; auf dem
    dunklen Hintergrund dagegen 15 : 1 [C].
  - Magenta fällt bei Protanopie mit Blau zusammen (OKLab 0,090) [C].
  - Das Cyan des Operators stammt vermutlich aus LinuxCNC AXIS: dort ist die ausgewählte Zeile
    Cyan, 3 px, auf schwarzem Hintergrund [P].
- **Normen:** Keine Norm legt Farben für Werkzeugbahnen fest (Eilgang, Vorschub).
  - Durchsucht: ISO 6983-1, ISO 14649-1, ISO 23218-1, ISO 16090-1 [P].
  - Es gelten nur die allgemeinen Regeln (Abschnitt 3).
- **Andere CNC-Oberflächen:** Für die Eilgang-Farbe gibt es keine Konvention; das häufigste
  Formmerkmal ist *gestrichelt*. Der Vorschub ist meist blau, die Auswahl ein eigener Farbton
  und dicker (Abschnitt 2).
- **Folgerung für die WebUI:** Die Palette entspricht dem Üblichen und den Regeln.
  - Der Eilgang ist grün gestrichelt, wie bei Haas NGC.
  - Der Vorschub ist blau.
  - Die Auswahl hat eine eigene Farbe, 3 px auf Halo.
  - Rot und Gelb bleiben Kollision und Grenze vorbehalten.
  - Farbe ist nie das einzige Merkmal.
  - Offen, als Vorschlag: im dunklen Theme die Auswahl AXIS-artig in Cyan zeichnen.

## 1. Paletten für Farbsehschwäche

| Palette | Farben (Auswahl) | Hinweise der Quelle |
|---|---|---|
| Okabe–Ito / Wong 2011 | #E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 | Zitat: „For thin lines … darker blue and orange is preferable to sky blue and yellow“; Linientypen zusätzlich zur Farbe [P, jfly.uni-koeln.de/color]. Hex-Werte [S]. |
| Paul Tol, *bright* | #4477AA #EE6677 #228833 #CCBB44 #66CCEE #AA3377 #BBBBBB | Zitat: „The main scheme for lines“; „Use different types of lines and symbols“ [P, sronpersonalpages.nl/~pault]. |
| Paul Tol, *high-contrast* | #004488 #DDAA33 #BB5566 | Funktioniert auch in Graustufen [P]. |
| IBM Carbon | eigene kategoriale Palette **je Theme** (hell/dunkel); Alarmfarben rot, orange, gelb, grün | Einzige Quelle mit einer eigenen Palette für dunkle Themes [P, carbondesignsystem.com]. |
| ColorBrewer (qualitativ) | Set2, Dark2, Paired | Laut eigener Bewertung über 4 Klassen hinaus nicht mehr farbsehschwäche-sicher [P, colorbrewer2.org]. |
| Tableau Color Blind 10 | #1170AA #FC7D0B + Grautöne | Zitat: „Blue-orange-gray are your safest colors“ (M. Stone) [S]. |

**Gerechnet [C]:**
- Nur wenige Farben erreichen 3 : 1 zugleich auf W, K und E0, zum Beispiel #0072B2, #4477AA,
  #228833, #AA3377 und #CC3311. Sie liegen alle in einem schmalen Helligkeitsband.
- Das beste Tripel daraus hält unter Simulation nur 0,111 OKLab, knapp unter unserer Regel
  0,12. **Eine** theme-unabhängige Palette kann Kontrast auf hellen, dunklen und grauen Flächen
  und Farbsehschwäche-Trennung nicht zugleich leisten. Rollenfarben je Theme plus Formmerkmale
  (unser Aufbau) sind der richtige Weg.
- Auf Mittelgrau (#808080) erreicht **keine** Buntfarbe 3 : 1 (alle 1,0–1,5 : 1). Dort trägt
  nur ein Rand oder Halo; das Beispiel in WCAG 1.4.11 macht es genauso.

## 2. Andere CNC- und CAM-Oberflächen

| Oberfläche | Eilgang | Vorschub | Ausgeführte Bahn | Ausgewählte Zeile | Beleg |
|---|---|---|---|---|---|
| LinuxCNC AXIS 2.9 (schwarzer Grund) | #4D8080 türkis; bis 2023 gestrichelt | weiß | eigene Farben: Vorschub #BF4040, Bogen #BF4080, Jog gelb; 3 px | Cyan #00FFFF, 3 px | [P] `rs274/glcanon.py`; Strichlierung entfernt in Commit f1c1209f52, weil `GL_LINE_STIPPLE` unzuverlässig war |
| AXIS, helles Theme | #0000F0 | schwarz | – | #08246B | [P] `axis_light_background` |
| gmoccapy, QtVCP | wie AXIS | | | | [P] Quelltext |
| QtPyVCP / probe_basic (VTK) | #C82323 rot | #D2D2FF | Cyan, 2,5 px, Deckkraft 0,5 | – | [P] vtk_backplot |
| CNCjs | grün | blau | ausgegraut #D3D3D3 | – | [P] GCodeVisualizer.js |
| CAMotics | rot | grün | noch nicht Ausgeführtes gedimmt | weiß | [P] ToolPathView.cpp |
| NC Viewer | orange #FB8C00 | blau | – | – | [P] Bundle |
| bCNC | wie Vorschub, **gestrichelt** | schwarz | grün, 2 px | blau, 2 px | [P] CNCCanvas.py |
| UGS | #CCCC00 | #00009E | ausgegraut #BEBEBE | #EDFF00 | [P] VisualizerOptions.java |
| Candle | wie Vorschub, **gestrichelt** | schwarz | #D9D9D9 | #9182E6 | [P] gcodedrawer.cpp |
| Mach3 | rot **gestrichelt** | blau | übermalt | – | [S] Forumsbeitrag (Setup eines Anwenders) |
| Fusion (CAM) | gelb | blau | – | – | [P] Autodesk-KB |
| Mastercam | gelb | blau | – | – | [S] |
| Sinumerik Operate | rot | grün | – | – | [P] Bedienhandbuch 08/2018 §7.7 |
| Heidenhain TNC | nicht angegeben; Eilgang im Werkstück rot markiert | | | | [P] TNC-640-Handbuch |
| Fanuc Manual Guide | **gepunktet** | durchgezogen | – | – | [P] B-63344EN/02 §4.5.1 |
| Haas NGC | **grün**, mit Setting 4 **gestrichelt** | schwarz | – | – | [P] Mill Operator's Manual 2022 §4.18 |

**Zusammengefasst:**
- **Eilgang-Farbe ohne Konvention:** rot (4 Fälle), gelb/orange (4), grün (2), türkis (1),
  wie Vorschub (2).
- **Formmerkmal Strichelung am häufigsten:** Mach3, bCNC, Candle, Fanuc, Haas, AXIS bis 2023.
- **Kein Viewer unterscheidet Eilgang und Vorschub über die Linienbreite.** Die Breite dient
  der ausgeführten Bahn und der Auswahl.
- **Ausgeführte Bahn:** entweder eine eigene Farbe (AXIS, probe_basic, bCNC) oder die Vorschau
  wird ausgegraut (CNCjs, UGS, Candle).
- **Grenzverletzungen:** Nur AXIS hat eine eigene Farbe dafür, rot.

## 3. Normen und Leitfäden

| Norm | Aussage zu Farben | Gilt für unsere Bahnlinien? | Beleg |
|---|---|---|---|
| IEC 60073:2002 | Gilt ausdrücklich auch für Bildschirmanzeigen. Zitat: „a single means of coding is often insufficient“ — Farbe mit Form, Position oder Blinken kombinieren. Bedeutungen: rot Gefahr/Not, gelb anormal/Warnung, grün normal, blau Pflichthandlung, weiß neutral. | indirekt | Geltungsbereich und 4.1 [P], iTeh-Vorschau; Farbtabelle nur [S] |
| IEC 60204-1:2016 §10.3 | Meldeleuchten und Anzeigen: rot Not, gelb anormal, blau Pflicht, grün normal, weiß neutral. Start nie rot. | nur sinngemäß (Leuchten und Taster) | [S] Rockwell- und Siemens-Abdruck; Gliederung [P] |
| ISO 3864-1 | Sicherheitszeichen und -markierungen | nein (nicht für Bildschirme) | [P] |
| ISO 9241-125 | redundante Farbkodierung, Farbsehschwäche, Farbzahl begrenzen, Warnfarben sparsam, nicht nur Farbe | indirekt | nur Kapitelüberschriften [P] |
| ISO 9241-112 | schreibt ausdrücklich **keine** Farbkonventionen vor | – | [P] |
| ANSI/ISA-101 / High-Performance HMI | graue Hintergründe; kräftige Farben nur für Abweichungen; Alarmfarben nur für Alarme; höchstens etwa 7 Farben; nie Farbe allein | indirekt | Praxisleitfäden ISA, ASM, Rockwell [P]; Normtext selbst [U] |
| VDI/VDE 3850 | Software-Ergonomie; das Farbkapitel war nicht einsehbar | – | Inhaltsverzeichnis [P] |
| WCAG 2.2, 1.4.11 / 1.4.1 | Linien 3 : 1 gegen ihren Hintergrund, untereinander nicht nötig; Farbe nie allein; dünne Linien möglichst vermeiden oder stärker kontrastieren | ja (unsere Messgrundlage) | [P] w3.org |

Nicht belegt: der wörtliche Text der Farbtabelle aus IEC 60073, die Inhalte der Farbkapitel
aus ISO 9241-125/-303 und EN 894-2 sowie der Normtext von ISA-101.

## 4. Abgleich mit der WebUI

| Regel | Umsetzung |
|---|---|
| Farbe nie allein (IEC 60073, WCAG 1.4.1) | Eilgang gestrichelt; Breiten 1 / 2 / 3 px; Glyphen ▲ × im Code-Panel und in der Zeitleiste |
| Alarmfarben reserviert (ISA-101-Praxis, IEC 60073) | rot = Kollision, Gelb/Ocker = Grenze, sonst nirgends in der Bahn |
| 3 : 1 gegen den Hintergrund (WCAG 1.4.11) | `themeTokens.test.ts` prüft jede Rollenfarbe gegen `--bg` und die beleuchtete Maschine |
| Farbsehschwäche | Paartabelle `viewer/palettePairs.ts`, Machado 2009, alle drei Typen |
| Mittelgrau (keine Buntfarbe trägt) | Halo nur für die Auswahl (bekannte, benannte Grenze) |

**Vorschlag, noch offen:** im dunklen Theme die Auswahl in Cyan (AXIS-Konvention, 15 : 1 auf
dunklem Grund). Vorher gegen Paartabelle und Halo-Regel prüfen.
