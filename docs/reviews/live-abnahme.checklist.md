# Live-Sichtprüfung — Design-Welle, Viewer-Kontrast, Operator-Punkte, feste Palette

**Für den Operator · Stand 28. September 2026.** Diese Prüfung ist der letzte Schritt vor dem
Merge aller Branches nach `development`. Du prüfst alles zusammen auf `feat/viewer-palette`; er
enthält jeden anderen Branch.

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
    [Review](operator-punkte.ideen.md)).
  - Feste Viewer-Palette (`feat/viewer-palette`): Ideenrunde R29, Plan-Agreement R30,
    Implementierungsreview R31 (vier Befunde, behoben), Nachprüfung R32 (zwei Befunde zur
    Befundnavigation, behoben), Nachprüfung R33 (drei Befunde zur Befundnavigation, behoben),
    Nachprüfung R34 (ein Befund zu Wiederkontakten, behoben), Nachprüfung R35 läuft
    ([Review](viewer-palette-fest.ideen.md)).
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
  - Danach kamen nur noch Review-Dokumente dazu.

## Vorbereitung

1. Die Suite läuft im Dev-Modus (Vite auf `:5173`) und zeigt den ausgecheckten Branch. Ausgecheckt
   ist `feat/viewer-palette`; er enthält `feat/operator-backlog`, `feat/viewer-contrast`, die
   ganze Design-Welle und den XYZAC-Fix.
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
| V1 Palette | **Ersetzt** durch die feste Palette (Abschnitt unten). Geblieben: Eilgang gestrichelt, Backplot 2 px breit |
| V2 Auswahl | **Entfallen:** Die aktuelle Zeile wird im 3D-Viewer nicht mehr hervorgehoben (deine Entscheidung vom 28. September) |
| V3 Code-Panel | Zeilen mit Limit-Verstoß ▲, mit Kollision × vor dem Code |
| V4 TWP-Ebene | die Ebene nennt ihren Zustand am Objekt („Plane · active / defined / head moved / datum moved / simulated“), veraltet mit gestricheltem Rand; HUD-Zeile ohne Doppelungen |
| V5 Ränder | Karten über dem Viewer (DRO, Warnkarte, Zeitleiste, Simulationshinweis) mit klar sichtbarem Rand, auch über dem hellen Tisch; Schalter mit sichtbarer Kante, im dunklen Theme eingeschaltet mit dunklem Knopf |
| V6 Palette | der Hinweis aus der Vorbereitung erscheint nur bei den alten Farben und verschwindet nach der Wahl |
| Hinweise (global) | Hinweise mit Button (Retry, Schließen, Keep editing / Discard, Use automatic colors): der Button ist nie abgeschnitten und bei Platzmangel unter dem Text; das Schließ-X bleibt klein am rechten Rand |

## Bekannte, benannte Grenzen (nicht Teil dieser Abnahme)

- Querformat ab 150 % und 200 % (Gesamtaufteilung).
- Linienfarben auf mittelgrauen Maschinenflächen erreichen rund 2 : 1; nur die beiden Boxen haben
  einen Saum.
- Neun Achsen im Hochformat bei 150 % in der Setup-Leiste.
- Tastatur-Erfassung der Belegungen per Tastatur; Tastatur-Alternative zu Halte-Aktionen (K13).
- Ebenenlabel: in kleinen Szenen groß, in echter Maschinengröße klein.

## Entscheidungen in deiner Abwesenheit (alle reversibel)

- **E1:** Tritan ist für farbgetrennte Paare Pflicht.
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
| Tools → Measure Current | misst mit „Simulate probe“; die Länge wird gespeichert |
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
| P6 Offsets | Auf XYZAC zeigt die C-Spalte von G92/Tool den C-Wert; eine Zeile „No G52/G92, tool or comp offset in effect“ bzw. „Offset status unknown — …“ |
| P7 Leiste | Mode, Kinematics Frame und WCS sind Segmentgruppen mit großen Trefferflächen; Pfeiltasten bewegen nur den Fokus (kein Jog, kein Befehl), Enter/Leertaste/Tipp wählt; eine gewählte Option zeigt einen gelben Balken bis die Maschine bestätigt, nach 5 s „Not confirmed — …“, eine Ablehnung sofort mit Grund an der Option; Step im Querformat in zwei Reihen (TWP auf Touch: Auswahlfeld), im Hochformat als eine Reihe; ein Fenster-Wechsel quer ↔ hoch lässt den Fokus in der Step-Gruppe (die nächste Pfeiltaste wählt, joggt nie); WCS quer 2 × 5, hoch 3 × 3 |

**Beim Ansehen:** Die Schrittweite ist im Querformat jetzt eine direkte Wahl in zwei Reihen
(Codex R25: direkte Wahl, solange die Leiste im Budget bleibt). Eine einzelne Reihe wäre breiter
als die Mode-Reihe und würde die 3-Achs-Leiste über ihre Basislinie schieben.

## Feste Viewer-Palette (`feat/viewer-palette`, neu 28. September)

Dein Auftrag: Linien müssen **untereinander** unterscheidbar sein, und die wichtigen Farben
dürfen sich beim Theme-Wechsel nicht ändern. Plan, Recherche und Rechnung:
[viewer-palette-fest.ideen.md](viewer-palette-fest.ideen.md).

| Prüfung | Worauf achten |
|---|---|
| Theme-Wechsel Hell ↔ Dunkel | Vorschub blau `#0f86ba`, Eilgang magenta **gestrichelt** `#ef0197`, Grenzverletzung ocker `#b06c02`, Backplot violett (2 px) `#7c0bfa`, Kollision rot `#c8102e` — **dieselben Farben** in beiden Themes. HC-Hell und HC-Dunkel: dieselben Farbtöne, kräftigere Helligkeit |
| Linien auf- und nebeneinander | Ein Programm mit engen Bahnen, Eilgängen und Backplot: Vorschub, Eilgang, Backplot und Grenzverletzung klar auseinander, auch vor dem hellen Tisch |
| Eilgang-Farbe | **Deine Wahl:** Magenta `#ef0197` (jetzt) oder Purpur `#d422e5`. Magenta liegt weiter vom Vorschub, Purpur weiter von der Kollision |
| Boxen | Maschinen-Box und Werkzeugbahn-Box: heller Kern mit dunklem Saum, die Werkzeugbahn-Box gestrichelt mit Maßen; der Teil außerhalb des Maschinenfensters ocker gestrichelt |
| Kollision | Programm `xyzac_collision_check.ngc` laden (absichtliche Kollision, **nie fahren**; laden geht nur referenziert, dann Maschine aus), „Next collision“: der erste Klick landet auf L8, die A-Wiege leuchtet rot; in Zeitleiste und Code-Panel ×, die Grenze ▲ |
| Keine Zeilen-Hervorhebung | im Lauf und in der Simulation keine hervorgehobene Linie im 3D; die Zeile zeigt das Code-Panel, die Position das Werkzeug |
| Backplot über einer Grenzverletzung | die ockerfarbene Markierung bleibt sichtbar |
| Settings → 3D Viewer → Layers | neue Ebene **Rapids**; neben jeder Ebene eine Strichprobe in ihrer Farbe (gestrichelt, gesäumt wie gezeichnet), darunter Grenze ▲ und Kollision × |
| Rapids aus, dann in der Simulation zu einer Grenzverletzung auf einem Eilgang springen | **nur** die Bewegung des Befunds erscheint (nicht alle Eilgänge), im Viewer steht „Rapids shown for this finding — hidden in Layers“, auch bei ausgeschaltetem HUD; ein Theme-Wechsel lässt sie stehen; nach einem Ziehen an der Zeitleiste ist sie wieder aus, die Ebene bleibt aus |
| Sprung zu einer Grenzverletzung | die Zeitleiste und das Code-Panel zeigen die Zeile des Befunds (vorher landete der Sprung eine Zeile zu spät); der Knopf der Zeitleiste steht auf der Markierung des Befunds, auch beim ersten Sprung mit Anfahrweg |
| Befunde durchblättern | „Next“/„Previous“ erreichen jeden Befund einmal; Kontakte auf dem Anfahrweg heißen „→ entry“; nach einem Ziehen an der Zeitleiste geht „Next“ von der neuen Position aus |
| Custom-Farben | Settings zeigt unter den Farben den Kontrast, für die Boxen mit eigener Spalte „On its casing“, und neu eine Tabelle „Lines / Apart / Color-blind“: welche Linienpaare zu nah beieinander liegen („close“) |

**Beim Ansehen:**
- Die Werte sind gegen Weiß, den dunklen Grund und den hellen Tisch gerechnet. Die Rechnung ist ein
  Filter, keine Sichtabnahme (Codex R29) — was zählt, ist dein Eindruck an dichten Bahnen.
- Ausgegraut wird die gefahrene Bahn noch nicht. Das kommt als eigener Schritt mit eigener
  Ideenrunde (Codex R29: Vertrag für Schleifen, Run from line, Abbruch).

## Wenn alles passt — Merge (nur `development`, nie `main`)

```bash
cd ~/lcnc-suite
git checkout development
git merge --no-ff feat/ui-design-wave
git merge --no-ff feat/viewer-contrast
git merge --no-ff feat/operator-backlog
git merge --no-ff feat/viewer-palette
```

`feat/viewer-contrast` enthält auch `fix/xyzac-z0-m600`; der XYZAC-Fix kommt also mit. **Nie
einzeln mergen:** Das Frontend zu Run from line und Messen liegt nur auf `feat/viewer-contrast`.
Allein würde das Gateway des Fix-Branches jedes Run from line ablehnen („Program changed — confirm
Run from line again“).

Danach die Suite neu starten. Ein `git push` ist deine Entscheidung; die bisherigen Merges nach
`development` waren lokal. Wenn etwas nicht passt: kurz notieren, was und wo (Theme, Zoom,
Ausrichtung). Ich korrigiere auf dem Branch, Codex prüft nach.
