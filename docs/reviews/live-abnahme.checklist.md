# Live-Sichtprüfung — Design-Welle und Viewer-Kontrast

**Für den Operator · Stand 27. September 2026.** Diese Prüfung ist der letzte Schritt vor dem
Merge beider Branches nach `development`.

- **Codex:**
  - Design-Welle: Implementierungs-Agreement DR + D0–D10 (Runde 10,
    [Review](ui-design-welle.implementation-review.md)).
  - Viewer-Kontrast: Plan-Agreement (Runde 2) und Implementierungs-Agreement V1–V6 (Runde 5,
    [Review](viewer-kontrast.review.md)).
  - XYZAC-Z-Nullpunkt und M600 (`fix/xyzac-z0-m600`): Review R15 angefragt.
- **Offline-Gates** (`python3 scripts/test_suite.py offline`):
  - Welle auf `15b46ff`: PASS, Playwright 282/282.
  - Kontrast auf `82418a7`: PASS, Backend 969, Vitest 1684, Playwright 292/292.
  - Danach kamen nur noch Review-Dokumente dazu.

## Vorbereitung

1. Die Suite läuft im Dev-Modus (Vite auf `:5173`) und zeigt den ausgecheckten Branch. Ausgecheckt
   ist `feat/viewer-contrast`; er enthält die ganze Design-Welle.
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
| V1 Palette | Eilgang **grün gestrichelt**; Backplot **2 px breit**, himbeerfarben; Vorschub blau; Maschinengrenzen dunkelgrau statt weiß |
| V2 Auswahl | aktive Zeile im 3D-Viewer: hell schwarz, dunkel hell, jeweils mit einem schmalen Rand in Hintergrundfarbe (Halo), gut sichtbar auch über dem Tisch |
| V3 Code-Panel | Zeilen mit Limit-Verstoß ▲, mit Kollision × vor dem Code |
| V4 TWP-Ebene | die Ebene nennt ihren Zustand am Objekt („Plane · active / defined / head moved / datum moved / simulated“), veraltet mit gestricheltem Rand; HUD-Zeile ohne Doppelungen |
| V5 Ränder | Karten über dem Viewer (DRO, Warnkarte, Zeitleiste, Simulationshinweis) mit klar sichtbarem Rand, auch über dem hellen Tisch; Schalter mit sichtbarer Kante, im dunklen Theme eingeschaltet mit dunklem Knopf |
| V6 Palette | der Hinweis aus der Vorbereitung erscheint nur bei den alten Farben und verschwindet nach der Wahl |
| Hinweise (global) | Hinweise mit Button (Retry, Schließen, Keep editing / Discard, Use automatic colors): der Button ist nie abgeschnitten und bei Platzmangel unter dem Text; das Schließ-X bleibt klein am rechten Rand |

## Bekannte, benannte Grenzen (nicht Teil dieser Abnahme)

- Querformat ab 150 % und 200 % (Gesamtaufteilung).
- Linienfarben auf mittelgrauen Maschinenflächen erreichen rund 2 : 1; nur die Auswahl hat einen
  Halo.
- Neun Achsen im Hochformat bei 150 % in der Setup-Leiste.
- Tastatur-Erfassung der Belegungen per Tastatur; Tastatur-Alternative zu Halte-Aktionen (K13).
- Ebenenlabel: in kleinen Szenen groß, in echter Maschinengröße klein.

## Entscheidungen in deiner Abwesenheit (alle reversibel)

- **E1:** Tritan ist für farbgetrennte Paare Pflicht.
- **E2:** Schwelle 0,12 als Regressionswächter; Zielwert 0,15.
- **E3:** Minimaländerung der Farben statt Neuentwurf.
- **E4:** Auswahl = Textfarbe auf Halo in Hintergrundfarbe.
- **E5:** Halo nur für die Auswahl.
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
| Programm mit M600 laden | keine Meldung „M-code greater than 199“ mehr |

**Hinweise:**
- Die M600-Programme in `nc_files` (kontur, haus, basify …) sind 3-Achs-Programme. T8 fehlt in der
  XYZAC-Werkzeugtabelle, und X reicht bis 346 bei ±250 Verfahrweg. Die Vorschau meldet deshalb jetzt
  „Requested tool 8 not found in the tool table“. Das ist die ehrliche nächste Meldung, kein
  Remap-Fehler. Geladen ist `kontur.ngc`.
- Ein M600, der unter TCP mit Fehler oder Abbruch endet, bleibt in Identität; der Chip zeigt
  „Machine“.
- Zwei Befunde gehen an Codex (R15), bevor ich sie behebe:
  - Ohne gespeicherte Toolsetter-Werte schreibt die WebUI Nullen in die Maschine.
  - Nach einem Fehler in einem MDI-Unterprogramm ohne geladenes Programm zeigt die WebUI das
    Unterprogramm als geladenes Programm.

## Wenn alles passt — Merge (nur `development`, nie `main`)

```bash
cd ~/lcnc-suite
git checkout development
git merge --no-ff feat/ui-design-wave
git merge --no-ff feat/viewer-contrast
```

`feat/viewer-contrast` enthält auch `fix/xyzac-z0-m600`; der XYZAC-Fix kommt also mit. Willst du
ihn schon vorher allein in `development` haben: `git merge --no-ff fix/xyzac-z0-m600`.

Danach die Suite neu starten. Ein `git push` ist deine Entscheidung; die bisherigen Merges nach
`development` waren lokal. Wenn etwas nicht passt: kurz notieren, was und wo (Theme, Zoom,
Ausrichtung). Ich korrigiere auf dem Branch, Codex prüft nach.
