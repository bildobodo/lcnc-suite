# Live-Sichtprüfung — Design-Welle, Viewer-Kontrast, Operator-Punkte, Palette, Pakete 2–5

**Für den Operator · Stand 4. Oktober 2026.** Diese Prüfung ist der letzte Schritt vor dem
Merge nach `development`. Du prüfst alles zusammen auf `feat/backlog-integration`, dem
Live-Baum; er enthält jeden Branch dieser Liste. Nur `fix/example-tool-numbers` steht für sich
und kommt beim Merge zum Schluss dazu.

- **Codex:**
  - Design-Welle: Implementierungs-Agreement DR + D0–D10 (Runde 10,
    [Review](ui-design-welle.implementation-review.md)).
  - Viewer-Kontrast: Plan-Agreement (Runde 2) und Implementierungs-Agreement V1–V6 (Runde 5,
    [Review](viewer-kontrast.review.md)).
  - XYZAC-Z-Nullpunkt und M600 (`fix/xyzac-z0-m600`): Review R15 mit fünf Befunden und zwei
    Regelfragen, alles behoben; Review R16 mit fünf Befunden, R17 mit drei, R18 mit zwei und
    R19 mit einem Befund, alles behoben; Implementierungs-Agreement in Runde R20 (XZ-01 bis
    XZ-11 geschlossen, [Review](xyzac-z0-m600.review.md)). Gilt nur zusammen mit
    `feat/viewer-contrast`.
  - Operator-Punkte P1–P7 (`feat/operator-backlog`): Plan-Agreement R24; Implementierung mit
    Befunden in R25 (sechs), R26 (drei Reste) und R27 (ein Rest), alles behoben;
    Implementierungs-Agreement in Runde R28 (OP-I01 bis OP-I06 geschlossen,
    [Review](operator-punkte.ideen.md)); Nachtrag P6 (Werkzeugzeile „G43“, Hilfe im
    Tabellenkopf) mit einem Textbefund in R36 (OP-I07, behoben), Agreement in R37.
  - Feste Viewer-Palette (`feat/viewer-palette`): Ideenrunde R29, Plan-Agreement R30,
    Implementierungsreview R31 (vier Befunde, behoben), Nachprüfung R32 (zwei Befunde zur
    Befundnavigation, behoben), Nachprüfung R33 (drei Befunde zur Befundnavigation, behoben),
    Nachprüfung R34 (ein Befund zu Wiederkontakten, behoben), **Agreement in R35**
    ([Review](viewer-palette-fest.ideen.md)).
  - **Neue Palette nach deiner Rückmeldung vom 29. September** (dieselbe Datei): Ideenrunde R38
    (VP38-01 bis -03, mit deinen Entscheidungen beantwortet), Planrunde Teil B R39.
  - **Seit dem 30. September** (dieselbe Datei, alles auf `feat/viewer-palette`):
    - Neu-Parse während eines Laufs: Befunde MR-I01 bis MR-I04 in R40–R42, **Agreement R43**.
    - Sim-Toolsetter und Strichmuster der Grenzen: Befunde in R44 und R45, **Agreement R46**.
    - Teil B (alle Pfade 2 px) mit dem A/B-Messwerkzeug: Befunde VP-I13 bis -I17 in R47–R49;
      Pins für Toolsetter und G30 mit der Spalte „On top“: VP-I18/-I19 in R50; **Agreement R51**.
    - Settings breiter und gleitender Code: Settings in R52 abgenommen, VP-I21 in R53 geschlossen.
    - Start-Werkzeugoffset der Vorschau (VP-I20): Planrunden R52–R56, **Plan-Agreement R57**;
      Umsetzung mit Befunden VP-I22 bis -I24 in R58 und R59, **Agreement R60**.
  - **Keypad** (`feat/keypad-keys`, eigener Branch auf `feat/viewer-palette`): deine Wahl nach
    den Renderings vom 1. Oktober; ohne Codex-Runde (Aussehen und Beschriftung).
  - **Deine Liste vom 1. Oktober, Pakete 2–5** (dieselbe Datei):
    - Pakete 2 und 3 (Settings › 3D Viewer, Jog und Setup kompakter): in R62 ohne Befund.
    - Paket 4 (Strichmuster, Endmarken, Typlabels, Nadelfarbe): Plan R62–R65, Umsetzung mit
      Befunden in R66 und R67, **Agreement R68**.
    - Paket 5 (Makros als `.ngc`-Dateien, Tab „Macros“, Makroleiste): Plan R69/R70, Umsetzung
      mit Befunden VP-I29 bis -I34 in R70 und R71, **Agreement R72**.
    - Seit R72 (G-code-Referenz, Menüs in Firefox, Werkzeugtabelle, Meldungsliste, Dialoge
      im Hochformat): **Agreement R73** ohne Befund. Codex nennt die bekannte Grenze erneut:
      Im Querformat bei 150 % mit Safety-Trip-Banner bleibt der Meldungsliste keine
      Tabellenhöhe (die Gesamtaufteilung ab 150 % quer ist ausgenommen, Folgearbeit).
- **Offline-Gates** (`python3 scripts/test_suite.py offline`):
  - Welle auf `15b46ff`: PASS, Playwright 282/282.
  - Kontrast auf `82418a7`: PASS, Backend 969, Vitest 1684, Playwright 292/292.
  - Kontrast mit dem XYZAC-Fix (R16) auf `d615f5d`: PASS, Backend 1003, Vitest 1691,
    Playwright 301/301.
  - Operator-Punkte auf `219106d`: PASS, Backend 1069, Vitest 1710, Playwright 340/340.
  - Feste Palette mit den R32-Korrekturen: PASS auf `ce0d048`, Backend 1069, Vitest 1728,
    Playwright 349/349.
  - Feste Palette mit den R33-Korrekturen: PASS auf `daa988b`, Backend 1069, Vitest 1730,
    Playwright 353/353.
  - Feste Palette mit der R34-Korrektur: PASS auf `9ac6b3f`, Backend 1069, Vitest 1732,
    Playwright 355/355.
  - Stand R60 (Teil B, Neu-Parse im Lauf, Sim-Toolsetter, Pins, Settings, Gleiten, VP-I20):
    PASS auf `6222310`, Backend 1145, Vitest 1838, Playwright 382/382.
  - Keypad mit Schema 10: PASS auf `7c7971b`, Backend 1145, Vitest 1838, Playwright 383/383.
  - Makros mit den R70-Korrekturen: PASS auf `698b1f9`, Playwright 423/423.
  - Meldungsliste: PASS auf `be29a8b`, Playwright 440/440.
  - Dialoge im Hochformat: PASS auf `1aa33cf`, Backend 1245, Vitest 1888, Playwright 465/465.

## Vorbereitung

1. Die Suite läuft im Dev-Modus (Vite auf `:5173`) und zeigt den ausgecheckten Branch. Ausgecheckt
   ist `feat/backlog-integration`; er enthält `feat/keypad-keys`, `feat/viewer-palette`,
   `feat/operator-backlog`, `feat/viewer-contrast`, die ganze Design-Welle, den XYZAC-Fix und
   alle Pakete seit dem 1. Oktober.
   - Die **A/B-Messung** auf deinem Mac ist am 1. Oktober bestanden (Abschnitt „Vor der
     Abnahme“).
2. Den Browser-Tab **einmal hart neu laden** (Strg+Umschalt+R), damit alte Paletten und Stile
   sicher weg sind.
3. **Settings → 3D Viewer → Colors:** Dort steht „Colors from an earlier version“. Auf **„Use
   automatic colors“** tippen.
   - Das gilt je Maschinenkonfiguration; für die XYZAC-Sim reicht diese.
   - Die alten Farben bleiben gespeichert: „Custom“ holt sie zurück.

## Wo prüfen

- **Maschine:** XYZAC-Sim, dazu für die TWP-Ebene die TWP-Konfiguration.
- **Themes:** Hell, Dunkel, HC hell, HC dunkel.
- **Zoom:** 100 % und 150 %.
- **Ausrichtung:** Querformat (Desktop) und Hochformat (Tablet oder schmales Fenster).
- **Simulation:** aus und an (Maschine aus, Schalter „Sim“ an der Zeitleiste).

## Design-Welle (D0–D10)

| Bereich | Worauf achten |
|---|---|
| Begriffe, Einheiten | „Program“, „Work offset“, „Collision“; Prozent als „120 %“; „—“ nur für fehlende Anzeigewerte |
| Rückmeldungen | Grund eines gedimmten Controls erscheint als Blase **am Control**, verschwindet beim nächsten Tipp; Banner in zwei Stufen (rot Sicherheit/Maschine, gelb Programm/Vorschau); Ergebnisse als Hinweis im Panel |
| Dialoge | Escape ist immer E-Stop; Fokus bleibt im obersten Dialog; Safety-Leiste und Abort bleiben erreichbar; Abbrechen links, Verb rechts |
| Reiter | fünf Hauptreiter; Probing als 4×2-Raster; im schmalen Seitenpanel (150 % hoch) zwei Auswahlfelder |
| Formulare | Label über dem Feld, Einheit rechts; einheitliche Feldhöhe (44 px auf Touch) |
| Panel-Aufbau | Abort ganz rechts in der Aktionsgruppe; „Files“ als ein Umschalter |
| Leisten, Makros | Start/Step/Resume/Run-from-line und Makros **halten** zum Auslösen; Reset-Buttons nennen ihren Zielwert |
| Eingabehilfen | X oben rechts bei Zahlenfeld und Tastatur; Code-Seite mit Ziffernblock |
| Farben, Themes | alle Texte gut lesbar in allen vier Themes; Fokusring deutlich |
| Viewer-Overlays | DRO-Karte passt sich an; Warnkarte unten links, bei wenig Platz eingeklappt; Zeitleiste im schmalen Viewer kompakt mit „More“; Simulationshinweis über der DRO, nie verdeckt |

## Viewer-Kontrast (V1–V6)

| Paket | Worauf achten |
|---|---|
| V1 Palette | **Ersetzt** durch die neue Palette (Abschnitt unten). Geblieben: Eilgang gestrichelt, Backplot 2 px breit |
| V2 Auswahl | **Entfallen:** Die aktuelle Zeile wird im 3D-Viewer nicht mehr hervorgehoben (deine Entscheidung vom 28. September) |
| V3 Code-Panel | Zeilen mit Limit-Verstoß ▲, mit Kollision × vor dem Code |
| V4 TWP-Ebene | die Ebene nennt ihren Zustand am Objekt („Plane · active / defined / head moved / datum moved / simulated“), veraltet mit gestricheltem Rand; HUD-Zeile ohne Doppelungen |
| V5 Ränder | Karten über dem Viewer (DRO, Warnkarte, Zeitleiste, Simulationshinweis) mit klar sichtbarem Rand, auch über dem hellen Tisch; Schalter mit sichtbarer Kante, im dunklen Theme eingeschaltet mit dunklem Knopf |
| V6 Palette | der Hinweis aus der Vorbereitung erscheint nur bei den alten Farben und verschwindet nach der Wahl |
| Hinweise (global) | Hinweise mit Button (Retry, Schließen, Keep editing / Discard, Use automatic colors): der Button ist nie abgeschnitten und bei Platzmangel unter dem Text; das Schließ-X bleibt klein am rechten Rand |

## Bekannte, benannte Grenzen (nicht Teil dieser Abnahme)

- Querformat ab 150 % und 200 % (Gesamtaufteilung).
- Die Pfadfarben erreichen auf den grauen Flächen von Rohteil und Planscheibe rund 1,9–2,3 : 1
  (hell) bzw. 1,9–5,5 : 1 (dunkel); in den HC-Themes weniger. Das ist deine gewählte Abstufung;
  die zweifarbigen Grenzen lesen auf jedem Grau.
- Neun Achsen im Hochformat bei 150 % in der Setup-Leiste.
- Tastatur-Erfassung der Belegungen per Tastatur; Tastatur-Alternative zu Halte-Aktionen (K13).
- Ebenenlabel: in kleinen Szenen groß, in echter Maschinengröße klein.
- Deine neue Liste vom 1. Oktober (Strichmuster der Grenzen, Pin-Farbe, Settings-Sektionen,
  geteilte Jog-Buttons, Setup-Symbole, Makros): eigene Branches nach dieser Abnahme. Nur das
  Keypad ist schon dabei.

## Entscheidungen in deiner Abwesenheit (alle reversibel)

- **E1:** Tritan ist für farbgetrennte Paare Pflicht. (Abgelöst am 29.09.: Farbschwäche ist kein
  Kriterium mehr, deine Entscheidung.)
- **E2:** Schwelle 0,12 als Regressionswächter; Zielwert 0,15.
- **E3:** Minimaländerung der Farben statt Neuentwurf.
- **E4, E5:** Auswahl mit Halo — entfallen mit der Hervorhebung (feste Palette).
- **E6:** Migrationsregel bleibt, neu ist nur ein Hinweis.
- **E7:** Ein Rand für alle Viewer-Karten.
- **E8:** Regler und Schalter werden global korrigiert.
- **E9:** Code-Glyphen wie in der Zeitleiste.
- **E10:** `settings.json` bleibt unberührt, du stellst auf Automatic um.
- **E11:** Backplot 2 px als Formmerkmal.
- **E12:** Der TWP-Zustand steht am Objekt.
- **E13:** Eigener Knopf-Token für den eingeschalteten Schalter.
- **E14:** HUD-Zeile ohne Doppelungen.
- **E15:** Diagnose-Nahtstelle für die simulierte Ebene im Test.
- **E16:** Die Nicht-Text-Prüfung misst Daumen aus Pixeln.
- **Welle:** `serial-viewer` läuft auf einem Worker (`15b46ff`). Sonst war das Offline-Gate rot.
- **Touch-Korrekturen** (`abf0a6a`, Kontextmenü nach langem Druck, Tipp-Blitz, Icons) kommen mit
  der Welle nach `development`, kein Vorab-Cherry-Pick.

## XYZAC-Sim: Z-Nullpunkt oben, M600 eingerichtet (neu, 27. September)

**Was sich geändert hat:**
- Maschinen-Z0 ist die Oberkante des Verfahrwegs, wie bei TWP und DMU. Der A/C-Schnittpunkt liegt
  bei Maschinen-Z −500, der Z-Bereich ist −400…0.
- Deine installierte Konfiguration wurde einmal migriert. Die Sicherung liegt unter
  `~/linuxcnc/config-backups/lcnc_suite_sim/20260927T132644.739785Z/`.
  - G54 Z: 280 → −220. Der Werkstücknullpunkt bleibt physisch am selben Ort.
  - G30 Z: 473,725 → −26,275.
  - G55–G59.3 Z und die gespeicherte Z-Position sind um −500 verschoben.
- M600/M601 sind eingerichtet. M600 misst in Identität und kehrt nach TCP zurück, wenn das
  Programm in TCP war.
- **Toolsetter** (Probing → Toolsetter) ist für diese Konfiguration eingetragen: X 150, Y 0, Z −300
  (G53), „Return to start position“ aus. „Reset Toolsetter“ nimmt das zurück.

| Prüfung | Erwartung |
|---|---|
| Nach Home All | Z steht auf 0, alle Z-Werte der Maschine sind ≤ 0 |
| → Home, → G30, → Zero | Z fährt zuerst nach oben, nie nach unten |
| Tools → Measure Current | misst am Sim-Toolsetter: die Sonde löst an der Platte aus, ohne „Simulate probe“; die Länge wird gespeichert, eine zweite Messung gibt dieselbe Länge |
| Probing → Toolsetter | Felder zeigen 150 / 0 / −300; nach „Reset Toolsetter“ sind die Pflichtfelder leer, der Hinweis nennt, was fehlt, und Measure Current ist gedimmt mit Grund („Toolsetter not set up“) |
| Ohne Programm ein MDI-M600, das abbricht | kein Unterprogramm erscheint als geladenes Programm |
| Programm mit M600 laden | keine Meldung „M-code greater than 199“ mehr |
| Measure Current, Abort, solange die Messung läuft | die Messung endet; danach startet nichts mehr |
| Run from line ab einer Zeile, deren Werkzeug erst gemessen wird | misst, fährt nach oben, positioniert und startet ab der Zeile |
| Dasselbe, Abort während der Messung | die Folge endet, das Programm startet nicht |
| Programm im Editor ändern und speichern, dann Run from line mit dem noch offenen Dialog | abgewiesen („Program changed …“); nach der neuen Vorschau erneut bestätigen, dann läuft es |
| Run from line mit Vormessung, zweimal Abort während des Positionierens | die Folge endet; die nächste Vormessung misst wirklich (die Sonde fährt an) |
| Run from line mit Vormessung, Abort beim Positionieren, sofort Cycle Start | abgewiesen („Run from line is ending — wait“); kurz danach startet das Programm und misst sein Werkzeug wirklich |
| Oben im Banner „Program not confirmed“ | erscheint nur, wenn ein neu gestartetes Gateway keinen eigenen Ladeeintrag hat; „Load program“ lädt die genannte Datei und das Banner verschwindet |

**Hinweise:**
- Die M600-Programme in `nc_files` (kontur, haus, basify …) sind 3-Achs-Programme. T8 fehlt in der
  XYZAC-Werkzeugtabelle, und X reicht bis 346 bei ±250 Verfahrweg. Die Vorschau meldet deshalb jetzt
  „Requested tool 8 not found in the tool table“. Das ist die ehrliche nächste Meldung, kein
  Remap-Fehler. Geladen ist `kontur.ngc`.
- Ein M600, der unter TCP mit Fehler oder Abbruch endet, bleibt in Identität; der Chip zeigt
  „Machine“.
- Behoben nach Codex' Regeln (R15):
  - Toolsetter-Werte gehen nur noch eingerichtet und vom Server bestätigt an die Maschine;
    jedes M600 aus der WebUI wartet auf ihre Übernahme.
  - Ein abgebrochenes MDI-Unterprogramm wird nicht mehr zum geladenen Programm.
  - Die Migration folgt der Herkunft, nicht den Zahlen. Dein G28 Z (aus meiner ersten
    Migration −500) steht jetzt auf 0, die Demo ist aktuell.
- Behoben nach Codex' Regeln (R16):
  - Messen und Probe-Aufrufe sind ein Befehl: Werte und M600 gehen zusammen ans Gateway, ein
    Abort von irgendwo erreicht sie.
  - Run from line ist an das angezeigte Programm gebunden und nimmt die Toolsetter-Werte mit;
    während der Folge wird kein anderes Programm geladen.
  - Ein neu gestartetes Gateway übernimmt nur sein eigenes geladenes Programm; eine fremde offene
    Datei nennt es im Banner, lädt sie aber nicht.
- Behoben nach Codex' Regeln (R17):
  - Run from line ist an den Text gebunden, den der Dialog zeigte (sein Fingerabdruck), nicht nur
    an die Vorschau-Version.
  - Laden und Entladen machen den gespeicherten Nachweis erst ungültig und schreiben den neuen
    erst, wenn die Änderung beobachtet ist.
  - Ein Abbruch hinterlässt keine hängende Sperre, und ein altes Überspringen-Flag kann keine
    Messung mehr überspringen.
- Behoben nach Codex' Befunden (R18):
  - Auch ein normaler Start (Cycle Start, Step, MDI, Werkzeugwechsel) übernimmt kein altes
    Überspringen-Flag: Solange Run from line endet, wartet er; sonst setzt er das Flag zuerst
    zurück, wenn das Gateway nicht sicher weiß, dass es 0 ist.
  - Ein abgebrochenes oder nicht beobachtetes Laden oder Entladen bestätigt nie mehr das alte
    Programm; die offene Datei steht dann als unbestätigt im Banner („Load program“).
- Behoben nach Codex' Befund (R19):
  - Ein Neuladen, das LinuxCNC ablehnt, bestätigt das Programm nicht mehr über den alten
    Dateinamen: Die Meldung sagt „LinuxCNC did not open the program“, die Datei steht als
    unbestätigt im Banner, bis ein Laden gelingt.
- Farben, Normen und andere CNC-Oberflächen: [Recherche](viewer-farben.recherche.md).

## Operator-Punkte P1–P7 (`feat/operator-backlog`, neu 28. September)

Der Branch baut auf `feat/viewer-contrast` auf und ist ausgecheckt. Plan und Reviews:
[operator-punkte.ideen.md](operator-punkte.ideen.md) (Plan-Agreement R24, Implementierungs-Agreement
R28).

| Punkt | Worauf achten |
|---|---|
| P1 Tools | Suchzeile mit normalem Abstand unter dem Kopf, in allen Zuständen |
| P2 Tabellen | Beim Scrollen bleibt der **ganze** Tabellenkopf oben (Tools, G-code-Referenz), keine Zelle schiebt sich darüber, die Kopflinie bleibt; per Tab fokussierte Zeilen landen unter dem Kopf |
| P3 Viewer-Farben | Umgesetzt als **feste Palette**, siehe den Abschnitt unten. |
| P4 G30 | Probing → Toolsetter → G30: „Use Current Position“ übernimmt die aktuelle Position in den Entwurf (nur wenn die Maschine steht, sonst gedimmt mit „Machine moving …“), „Save G30“ schreibt und bestätigt, die gespeicherte Zeile nennt Werte und Zeit; ein Wert außerhalb der Verfahrwege wird mit Grund abgelehnt; was du tippst, während eine Antwort aussteht, bleibt Entwurf; nach einem Verbindungsabbruch steht kurz „Stored: unknown“, dann liest die Seite G30 neu (Save wartet so lange) |
| P5 Offsets | Werte per Tab erreichbar, Enter öffnet das Zahlenfeld; aktives Offset mit Balken am Zeilenanfang, bearbeitete Zelle mit Innenrand; A/B/C und R in Grad; gesperrt (z. B. im Lauf) bleiben die Werte voll lesbar, eine Zeile unter dem Titel sagt „Read-only — <Grund>“, sonst „Select a value to edit it“ |
| P6 Offsets | Auf XYZAC zeigt die C-Spalte von G52/G92 und G43 den C-Wert; die Werkzeugzeile heißt „G43“ (die wirksame Korrektur, nicht die Tabellenlänge); das „?“ oben links im Tabellenkopf erklärt G52/G92 und G43, auch per Tipp; eine Zeile „No G52/G92, G43 or comp offset in effect“ bzw. „Offset status unknown — …“ |
| P7 Leiste | Mode, Kinematics Frame und WCS sind Segmentgruppen mit großen Trefferflächen; Pfeiltasten bewegen nur den Fokus (kein Jog, kein Befehl), Enter/Leertaste/Tipp wählt; eine gewählte Option zeigt einen gelben Balken bis die Maschine bestätigt, nach 5 s „Not confirmed — …“, eine Ablehnung sofort mit Grund an der Option; Step im Querformat in zwei Reihen (TWP auf Touch: Auswahlfeld), im Hochformat als eine Reihe; ein Fenster-Wechsel quer ↔ hoch lässt den Fokus in der Step-Gruppe (die nächste Pfeiltaste wählt, joggt nie); WCS quer 2 × 5, hoch 3 × 3 |

**Beim Ansehen:** Die Schrittweite ist im Querformat jetzt eine direkte Wahl in zwei Reihen
(Codex R25: direkte Wahl, solange die Leiste im Budget bleibt). Eine einzelne Reihe wäre breiter
als die Mode-Reihe und würde die 3-Achs-Leiste über ihre Basislinie schieben.

## Viewer-Palette (`feat/viewer-palette`, neu 29. September)

Deine Entscheidungen nach den Renderings: zwei Schemen mit gleichem Farbton je Rolle, Pfad grün,
Graustufen-Modelle, zweifarbige Grenzen, alle Pfade 2 px. Plan, Rechnung und Codex-Runden:
[viewer-palette-fest.ideen.md](viewer-palette-fest.ideen.md).

**Vorher:** Deine gespeicherte eigene Palette (die alten Farben) überdeckt die neuen Pfadfarben.
Settings → 3D Viewer → „Automatic“ zeigt sie; „Custom“ holt deine alten zurück.

| Prüfung | Worauf achten |
|---|---|
| Theme-Wechsel Hell ↔ Dunkel | Pfad grün (hell `#00a83c`, dunkel hellgrün `#5cff5c`), Backplot magenta, Eilgang blau **gestrichelt**, Überschreitung orange (hell `#e66b00`, dunkel `#ff7a00`), Kollision rot. Jede Rolle behält ihren Farbton, nur die Helligkeit passt sich an. HC: dieselben Farbtöne, kräftiger |
| Maschinenmodell | nur Graustufen: Säule, Schlitten und Kopf hell, Führungen mittel, Rohteil und Planscheibe in der Mitte, Bett, Abdeckungen und Wiege dunkel; kein Türkis, kein Gold. Die Pfade stehen vor der Maschine |
| Linien auf- und nebeneinander | Programm mit engen Bahnen, Eilgängen und Backplot: Pfad, Eilgang, Backplot und Überschreitung klar auseinander, auf dem Rohteil und vor dem Hintergrund |
| Grenzen | Maschinen-Box und Werkzeugbahn-Box **zweifarbig** (dunkel mit hellen Strichen, keine Umrandung), **1 px**: lange Striche an der Maschine, kurze an der Werkzeugbahn mit Maßen. Vor jedem Grau sichtbar; die Strichlänge bleibt auf dem Bildschirm gleich, auch an schräg weglaufenden Kanten. Der Teil außerhalb des Maschinenfensters orange gestrichelt. Machine Reach / Part Reach (Layers): dieselben zwei Töne, gepunktet |
| Kollision | Programm `xyzac_collision_check.ngc` laden (absichtliche Kollision, **nie fahren**; laden geht nur referenziert, dann Maschine aus), „Next collision“: der erste Klick landet auf L8, die A-Wiege leuchtet rot; in Zeitleiste und Code-Panel ×, die Grenze ▲ |
| Keine Zeilen-Hervorhebung | im Lauf und in der Simulation keine hervorgehobene Linie im 3D; die Zeile zeigt das Code-Panel, die Position das Werkzeug |
| Backplot über einer Überschreitung | die orange Markierung bleibt sichtbar |
| Settings → 3D Viewer → Layers | Ebene **Rapids**; neben jeder Ebene eine Strichprobe in ihrer Farbe (gestrichelt bzw. zweifarbig wie gezeichnet), darunter Grenze ▲ und Kollision × |
| Rapids aus, dann in der Simulation zu einer Grenzverletzung auf einem Eilgang springen | **nur** die Bewegung des Befunds erscheint (nicht alle Eilgänge), im Viewer steht „Rapids shown for this finding — hidden in Layers“, auch bei ausgeschaltetem HUD; ein Theme-Wechsel lässt sie stehen; nach einem Ziehen an der Zeitleiste ist sie wieder aus, die Ebene bleibt aus |
| Sprung zu einer Grenzverletzung | die Zeitleiste und das Code-Panel zeigen die Zeile des Befunds; der Knopf der Zeitleiste steht auf der Markierung des Befunds, auch beim ersten Sprung mit Anfahrweg |
| Befunde durchblättern | „Next“/„Previous“ erreichen jeden Befund einmal; Kontakte auf dem Anfahrweg heißen „→ entry“; nach einem Ziehen an der Zeitleiste geht „Next“ von der neuen Position aus |
| Custom-Farben | Settings zeigt unter den Farben den Kontrast „On background“ und „On the machine“ (gegen die grauen Flächen des Modells) und eine Tabelle „Lines / Apart“: welche Linienpaare zu nah beieinander liegen („close“) |

**Beim Ansehen:**
- Die Werte sind gegen Weiß, den dunklen Grund und die gerenderten Flächen von Rohteil und
  Planscheibe gerechnet. Die Rechnung ist ein Filter, keine Sichtabnahme; was zählt, ist dein
  Eindruck an dichten Bahnen.
- Alle Pfadlinien sind seit Teil B 2 px breit (Abschnitt unten).
- Ausgegraut wird die gefahrene Bahn noch nicht. Das kommt als eigener Schritt mit eigener
  Ideenrunde (Codex R29: Vertrag für Schleifen, Run from line, Abbruch).

## Vor der Abnahme: A/B-Messung auf deinem Mac (Teil B)

Seit Teil B zeichnet der Viewer alle Pfadlinien mit einer neuen Zeichenart 2 px breit. Die
Messung vergleicht sie auf deinem Mac mit der bisherigen 1-px-Linie: Bildrate, Ruckler,
Blockaden, GPU-Rückstand und Speicher. Besteht B, entfallen die alte Linie und der
Debug-Schalter.

1. Ein großes Programm laden, zum Beispiel `heavy_test`.
2. Settings → Debug → **„Run A/B measurement“**, Settings schließen.
3. Etwa 10 Minuten nichts anfassen: keine Maus über dem Viewer, kein Tab-Wechsel. Der Ablauf
   kalibriert, fährt sechs Durchgänge (A, B, B, A, A, B) und stellt am Ende Kamera, Zeitleiste
   und Simulation wieder her.
4. Mir Bescheid sagen. Ich werte den Trace mit `scripts/viewer_ab_report.py` aus; die
   Grenzwerte stehen vorher fest (Codex R47–R49).

## Seit dem 30. September (`feat/viewer-palette`)

| Bereich | Worauf achten |
|---|---|
| Pfade 2 px (Teil B) | Pfad, Eilgang, Überschreitung, Backplot und die eingeblendete Befundbewegung alle 2 px, in jeder Zoomstufe gleich breit; keine Lücken an Segmentgrenzen; ein Pfad, der durch die Kamera-Nahebene läuft, bleibt ein Band |
| Werkzeug | Schneide hell (Stahl), Schaft mittelgrau; das Werkzeug wird in seiner echten Länge gezeichnet, auch unter G49; eine neue Länge hebt den Backplot-Stift (kein Strich zum neuen Ort) |
| Kamera | In der Parallelansicht beim Drehen nie ein abgeschnittenes Bodenraster |
| Toolsetter- und G30-Pin | Layers „Tool Setter“ und „Tool Change (G30)“: je eine beschriftete Nadel („tool setter“, „tool change (G30)“), gleich groß in jeder Zoomstufe, die Beschriftung über dem Punkt. In Probing › Toolsetter G30 speichern oder neu lesen: die G30-Nadel springt sofort an den neuen Ort |
| Layers → On top | Spalte „On top“ je Ebene: Pfade, Marker und Grenzen über der Maschine zeichnen; die beiden Nadeln stehen ab Werk oben |
| Neu-Parse im Lauf | Ein Programm, das sein Werkzeug selbst misst (`T13 M600`): Während des Laufs erscheint **eine** Zeile „Preview re-parsing“ mit Balken, der Pfad ist gedämpft, danach steht er mit der neuen Länge; der Kollisions-Sweep wartet, bis die Maschine steht |
| Start-Werkzeugoffset (VP-I20) | Die Vorschau rechnet ab dem Werkzeugoffset, der beim Start gilt. Nach einer neuen Messung im Stillstand prüft sie nach: „Preview re-parsing“, der Grund steht im „?“ („tool offset changed — checking“); meist ist alles gleich, dann gibt es keinen neuen Download und nur die Bewegungen vor dem ersten eigenen G43 des Programms rücken nach. Ist der Start nicht bekannt, sagt die Statistik „Not validated (start tool offset unknown)“ |
| Programm mit eigenem G43 | Nach dem Lauf kein Neu-Parse allein wegen des angewendeten Offsets |
| Code-Panel im Lauf | Die laufende Zeile gleitet: Der Code scrollt gleichmäßig unter einer mittigen Markierung, auch bei schnellen kurzen Sätzen bleibt die Zeile immer im Bild; „Bewegung reduzieren“ springt statt zu gleiten |
| Settings | So breit wie der Werkzeugeditor (760 px); im 3D Viewer Layers in vier Gruppen. Die Anordnung der Sektionen änderst du gerade (Paket 2 deiner neuen Liste): hier noch der Stand vom 30. September |
| Zahlenfelder | Ein Doppelklick oder Ziehen auf einem Zahlenfeld markiert nichts mehr; danach geht die echte Tastatur weiter ins Zahlen-Keypad |

## Keypad (`feat/keypad-keys`, neu 1. Oktober)

| Prüfung | Worauf achten |
|---|---|
| Zahlen-Keypad | X oben rechts rot, Discard rot, Apply grün; X schließt und behält die Eingabe (beim nächsten Öffnen als Entwurf), Discard wirft sie weg |
| Texttastatur | X rot; die Bestätigung heißt „Apply“: in der MDI-Zeile sendet sie den Befehl, in einem Textfeld schließt sie; der Editor behält sein Zeilenumbruch-Symbol; der Send-Button der MDI-Zeile selbst heißt weiter „Send“ |
| Echte Tastatur | Tippen leuchtet keine Bildschirmtaste auf (deine Entscheidung) |

## Seit dem 2. Oktober (`feat/backlog-integration`)

| Bereich | Worauf achten |
|---|---|
| Settings › 3D Viewer (Paket 2) | Die Abschnitte stehen untereinander, jeder über die ganze Breite; innen zwei Spalten, wo sie passen (Layers als zwei Tabellen, die Legende darunter). Bei 150 % im Hochformat steht alles einspaltig, nichts läuft seitlich hinaus |
| Jog und Setup (Paket 3) | Im Querformat teilen sich zwei Drehachsen eine Spalte: je Achse + über −. Setup zeigt Symbole statt Wörter (Haus = Home, durchgestrichenes Haus = Unhome, Bezugszeichen = Zero), ihr Tooltip nennt die Aktion |
| Grenzen und Nadeln (Paket 4) | Die Striche der Maschinen- und Programmbox und der Reichweiten-Umrisse kleben an der Geometrie: Beim Zoomen wandern sie nicht. Die Programmbox hat Endmarken an jeder Kante; „Machine bounds“ und „Program bounds“ stehen an ihrer Box und folgen deren „On top“. Die Nadeln sind cyan |
| Makros (Paket 5) | Tab „Macros“ wie die Werkzeugtabelle: Suche, Filter (All / On the bar / Not on the bar), nach Name sortierbar. Ein Tipp auf die Zeile wählt das Makro, Run im Kopf läuft per Halten (mit Parametern öffnet ein Tipp den Dialog). Der Stift öffnet den Editor als Dialog mit File name, Title und Description über dem Code; ein anderer Name benennt die Datei um. Die Makroleiste liegt quer über der Leiste, im Hochformat zwischen Viewer und Seitenpanel, Abort steht rechts außerhalb des Scrollbereichs |
| Köpfe der Tabs | Program, Tools und Macros: links die Maschinenaktionen mit Abort, rechts „More“ mit der Verwaltung (New, Files, Upload, Download …). More behält seine Breite, auch mit „· M01“ und offen |
| Download | In More: das geladene Programm, die Werkzeugtabelle (die Datei, wie LinuxCNC sie liest), das gewählte Makro |
| Scrollbalken | In jedem Dialog und in beiden Code-Editoren der dünne Balken der App, nie der breite schwarze des Browsers |
| G-code-Referenz | So breit wie Settings. Der Codeblock in der Safety-Leiste ist ein Knopf und öffnet die Referenz auf „Active now“; ein Tipp auf einen Code im Programm springt zu seinem Eintrag (markiert). Im Hochformat bei 150 % Karten. In Firefox (Mac und Linux) reagiert die Gruppenauswahl und flackert nicht |
| Menüs | Kein Auswahlmenü flackert oder verliert die Wahl, während die Maschine läuft (Firefox); auch die Tastenbelegung im Gamepad-Tab mit angeschlossenem Pad |
| Werkzeugtabelle | Nie mehr dauerhaft „Loading tools…“: Nach 8 s ohne Antwort steht dort „No reply from the gateway yet — retry“, Retry ist immer bedienbar |
| Meldungsliste | Suche, ein Filter für Typ und Herkunft, sortierbarer Kopf (Time, Type, Source), Kopieren und Papierkorb je Zeile, die Zahl im Titel („Messages (7 of 12)“). Im Hochformat bei 150 % Karten, Copy / Clear All als Symbole. Ältere Meldungen zeigen bei Source „—“ |
| Dialoge im Hochformat | Bei 150 % passt jeder Dialog in den Inhaltsbereich: Program Stats und Run from line ragten links und rechts hinaus |
| Hinweisblase | Ein Tipp auf eine halb verdeckte Option am Rand der Leiste (z. B. die reservierte G59 auf der TWP-Maschine): Die Leiste scrollt sie ins Bild, und der Hinweis bleibt an ihr stehen |

**Noch deine Entscheidung:** der Program-Kopf im schmalen Panel (Hochformat 150 %). Heute drei
Zeilen (Start · Step / Pause · Abort / More), Alternative zwei Zeilen (Start · Step · Pause /
Abort … More), sofern „Start L123“ darin Platz hat.

## Wenn alles passt — Merge (nur `development`, nie `main`)

```bash
cd ~/lcnc-suite
git checkout development
git merge --no-ff feat/backlog-integration
git merge --no-ff fix/example-tool-numbers
```

`feat/backlog-integration` enthält alle Branches dieser Liste in der richtigen Reihenfolge, auch
`fix/xyzac-z0-m600` zusammen mit dem Frontend auf `feat/viewer-contrast`, das er braucht. Einzeln
gemergt würde das Gateway des Fix-Branches jedes Run from line ablehnen („Program changed —
confirm Run from line again“).

`fix/example-tool-numbers` (Werkzeugnummern der Beispieltabellen, T2… neben der Bibliothek ab
T1001) steht eigenständig auf `development`, kommt zum Schluss und lässt sich konfliktfrei
dazumergen (geprüft am 4. Oktober).

Danach die Suite neu starten. Ein `git push` ist deine Entscheidung; die bisherigen Merges nach
`development` waren lokal. Wenn etwas nicht passt: kurz notieren, was und wo (Theme, Zoom,
Ausrichtung). Ich korrigiere auf dem Branch, Codex prüft nach.
