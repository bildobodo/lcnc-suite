# Viewer-Kontrast — Farben, Formmerkmale und Ränder im 3D-Viewer

**Fassung 2 · 27. September 2026 · Branch `feat/viewer-contrast` aus `feat/ui-design-wave`
(`15b46ff`: Codex-Agreement D7–D10 auf `01775ef` + die Gate-Korrektur für serielle
Playwright-Projekte; Offline-Gate PASS).** Merge nach `development` erst nach der
Live-Sichtprüfung des Operators, gemeinsam mit der Design-Welle (erst die Welle, dann dieser
Branch). Nie `main`.

Fassung 2 beantwortet Codex' Planreview Runde 1 (VK-01–04 und vier Präzisierungen); die
Antworten stehen am Ende und in `viewer-kontrast.review.md`.

Der Operator ist bis zur Sichtprüfung abwesend und hat angeordnet: offene Fragen entscheidet
Claude selbst und zieht bei Bedarf Codex hinzu. Solche Entscheidungen sind unten als **E1–E12**
geführt und reversibel.

## Kontext

**Operator-Fragen vom 27. September 2026:**
- Kommt die Farbwahl für Backplot, Vorschau und Maschinengrenzen noch? Die Grenzen seien weiß.
- Welche Farben erzielen im Zusammenspiel von Backplot und Vorschau den höchsten Kontrast?
- Ist der Eilgang als gestrichelte orange Linie richtig?
- Die aktive Zeile ist rot; der Kontrast ist vermutlich nicht optimal.
- Die Zeitleiste ist mit dem transparenten HUD teils schlecht erkennbar. Braucht sie eine Outline?
- Gibt es ähnliche Punkte, auch bei Farbenblindheit?

**Befund 1 — die gesehenen Farben sind die gespeicherten alten.**
- `lcnc-gateway/settings.json` enthält für sechs von sieben Konfigurationen, darunter die
  XYZAC-Sim, die alten Standardfarben ohne `paletteMode`: Vorschub `#22b8cf`, Eilgang `#f5a623`,
  Backplot `#ff00ff`, Grenzen `#ffffff`.
- Nach UI-D05 zählen sie als *Custom* (`viewerSection.ts`), und Settings bietet nur die zwei
  Radios Automatic / Custom. Der Operator hat nicht bemerkt, dass eine neue Palette existiert.
- Das rote Hervorheben ist der Stand von `development` (`0xff3333`). Auf diesem Branch ist die
  Auswahl `#111111` (hell) bzw. `#008b96` (dunkel), 3 px breit (UI-DI14).

**Befund 2 — Messungen.** Die Pixel stammen aus gerenderten Szenen (Modell, dichter Pfad,
Backplot, Auswahl, Limit-Overlay, Grenzen; `scenes.viewer.spec`-Aufbau bei 1600 × 1000).
- Beleuchtete Tischfläche `#e1e1e1`, Seitenflächen `#7e7f7f`–`#8d8e8f`.
- Hintergrund: hell `#ffffff`, dunkel `#0b0f14`.

Kontrast gegen den Viewer-Hintergrund, helles Theme:

| Rolle | alte gespeicherte Farben | Automatic (D8c) |
|---|---|---|
| Vorschub | 2,4 : 1 | 6,4 : 1 |
| Eilgang | 2,0 : 1 | 5,9 : 1 |
| Backplot | 3,1 : 1 | 5,6 : 1 |
| Maschinengrenzen | **1,0 : 1** | 7,6 : 1 |

Gegen die mittelgrauen Seitenflächen erreichen die **unterscheidbaren Farbrollen** (die
Pfadrollen außer der Auswahl) nur rund 2 : 1. Das ist eine Grenze der gewünschten
Farbunterscheidung, keine allgemeine Unmöglichkeit: Schwarz hält auf Weiß 21 : 1 und auf den
Seitenflächen 5,2–6,4 : 1. Im dunklen Theme schränkt der zusätzliche dunkle Hintergrund die
Wahl weiter ein.

**Farbenblindheit:**
- Simuliert nach Machado et al. 2009, Schwere 1,0 (Protanopie, Deuteranopie, Tritanopie).
- Berechnet wird: sRGB linearisieren, Machado-Matrix anwenden, auf `[0, 1]` abschneiden, dann
  OKLab. Gemessen wird der OKLab-Abstand. Die verbindliche Schwelle ist 0,12, dieselbe wie die
  D8c-Pfadregel in `themeTokens.test.ts`.
- Diese Simulation ist eine **projektspezifische Heuristik** und ein Regressionswächter, kein
  allgemeiner Nachweis von Barrierefreiheit. Ein Farbabstand erfüllt für sich allein nicht die
  WCAG-Regel „Information nicht allein über Farbe“ (1.4.1). Dafür sorgen die Formmerkmale in R1.

| Paar (Automatic, hell) | normal | protan | deutan | tritan | Formmerkmal heute |
|---|---|---|---|---|---|
| Vorschub / Backplot | 0,27 | **0,04** | **0,09** | 0,27 | keines, beide 1 px durchgezogen |
| Vorschub / Eilgang | 0,25 | 0,24 | 0,23 | **0,05** | gestrichelt |
| Eilgang / Limit | 0,17 | **0,03** | **0,08** | 0,21 | gestrichelt gegen durchgezogen |
| Backplot / Limit | — | — | — | **0,10** (Codex) | keines, beide durchgezogen |
| Limit / Kollision | 0,15 | **0,11** | **0,02** | **0,11** | 3D: Pfad gegen Maschinentönung; Zeitleiste ▲ / ×; **Code-Panel: nur Farbe** |
| Vorschub / Auswahl (dunkel) | 0,15 | 0,15 | 0,15 | **0,06** | 3 px breit |

Die Werte für die anderen Themes liegen gleich (dunkel: Vorschub/Backplot protan 0,04).

**Befund 3 — Karten über dem Viewer** (unbewaffnet gemessen, die Controls also gedimmt):
- Der Rand der `.overlay-card` hat gegen die Szene 1,43 : 1 (hell) bzw. 1,51 : 1 (dunkel).
- Der Kartenkörper hebt sich mit 1,07–1,08 : 1 vom Hintergrund ab.
- Über der hellen Tischfläche verschwimmt die helle Karte (1,2 : 1).
- `.overlay-card.warn` (Sim-Hinweis, STL-Fehlerchip) überschreibt Hintergrund und Rand; sie ist
  nicht die normale 92-%-Karte.
- Die Nicht-Text-Teile der Zeitleiste (Daumen, Spur, Schalter) werden heute nicht gemessen.
  `contrast.spec` misst nur Text.

**Befund 4 — die TWP-Ebene.**
- Ihre Farben (`_TWP_ACTIVE_HEX` `#4aa3ff`, `_TWP_INACTIVE_HEX` `#ffb347`, `_TWP_STALE_HEX`
  `#cc3333` in `ThreeViewer.vue`) folgen keinem Theme.
- Die Fläche hat 12 % Deckkraft, das Raster samt Außenkante 35 %. Selbst schwarz erreicht ein
  35-%-Rand auf Weiß höchstens 2,4 : 1 (Codex' Rechnung).
- Das Label am Objekt heißt nur „Plane“. Das HUD-Wort („plane active / defined / stale“) fehlt
  bei ausgeblendetem HUD und gefalteter Warnkarte. Es kennt keinen verschobenen Bezugspunkt,
  und in der Simulation beschreibt es den Live-Zustand statt der gezeichneten Ebene.

## Regeln

**R1 — Paar-Tabelle.** Jedes Paar von Rollen, das auf derselben Fläche gezeichnet wird, gehört
zu einer oder beiden von zwei Arten:

- **Farbgetrennt:** Der OKLab-Abstand ist ≥ 0,12 bei normaler Sicht **und** unter Protan-,
  Deutan- und Tritan-Simulation.
- **Formgetrennt:** Das Paar trägt ein deklariertes, **im gerenderten Bild sichtbares** und
  testgebundenes Form-, Objekt- oder Textmerkmal. Dann gilt für die Farbe nur die D8c-Regel
  (≥ 0,12 bei normaler Sicht).

Die Breitenstaffel ist das zentrale Formmerkmal: **Pfad 1 px, Backplot 2 px, Auswahl 3 px mit
Halo** (V1, V2). Die Tabelle nennt jedes Paar der sechs Pfadrollen, die `themeTokens.test.ts`
heute prüft. Sie ist die Spezifikation des Wächters und wird als Daten abgelegt
(`viewer/palettePairs.ts`):

| Paar | Wo | Art | Merkmal |
|---|---|---|---|
| Vorschub / Eilgang | benachbart | formgetrennt | Eilgang gestrichelt |
| Vorschub / Backplot | Backplot liegt auf dem Pfad | **farb- und formgetrennt** | Backplot 2 px gegen 1 px |
| Vorschub / Limit | Overlay auf dem Pfad | farbgetrennt | — |
| Vorschub / Auswahl | Auswahl auf dem Pfad | formgetrennt | 3 px + Halo |
| Vorschub / Kollision | Linie gegen Maschinenkörper | formgetrennt | Objekt: Tönung eines Körpers, keine Linie; Überlaufkanten gestrichelt |
| Eilgang / Backplot | ausgeführter Eilgang | formgetrennt | gestrichelt gegen 2 px durchgezogen |
| Eilgang / Limit | Overlay auf einem Eilgang | formgetrennt | gestrichelt gegen durchgezogen |
| Eilgang / Auswahl | Auswahl auf einem Eilgang | formgetrennt | 3 px + Halo |
| Eilgang / Kollision | Linie gegen Maschinenkörper | formgetrennt | Objekt, wie oben |
| Backplot / Limit | benachbart oder in der Projektion überlagert | formgetrennt | 2 px gegen 1 px |
| Backplot / Auswahl | Auswahl auf dem ausgeführten Pfad | formgetrennt | 2 px gegen 3 px + Halo |
| Backplot / Kollision | Linie gegen Maschinenkörper | formgetrennt | Objekt, wie oben |
| Limit / Auswahl | Auswahl auf dem Overlay | formgetrennt | 3 px + Halo |
| Limit / Kollision | 3D, Zeitleiste, Code-Panel | formgetrennt | 3D Objekt (Linie gegen Körper); Zeitleiste ▲ / ×; Code-Panel ▲ / × (V3) |
| Auswahl / Kollision | Linie gegen Maschinenkörper | formgetrennt | Objekt, wie oben |
| Grenzen / Pfad-Grenzen | zwei durchgezogene Kästen | formgetrennt | Maßbeschriftung am Programmkasten („X: 300 mm“) |
| Pfad-Grenzen-Überlauf / Grenzen | Überlaufkanten des Programmkastens | formgetrennt | gestrichelt (Kollisionsrolle) |
| TWP-Zustände untereinander | die Ebene | formgetrennt | Zustandslabel am Objekt + Randmuster (V4) |

Die Paare Grenzen / Pfad-Grenzen trennen sich farblich in den dunklen Themes bei
Farbenblindheit nur mit einem Wechsel nach Violett (Solver); HC hell liegt heute sogar normal
bei 0,11 und wird minimal verschoben.

**R2 — Kontrast der Linien** (D8c):
- Jede Linienrolle hält ≥ 3 : 1 auf `--bg` **und** auf der beleuchteten Tischfläche (`#e0e0e0`
  im Test, `#e1e1e1` gemessen), in beiden HC-Themes ≥ 4,5 : 1 auf `--bg`.
- Maßgeblich ist die **zusammengesetzte** Farbe: Eine Rolle mit Material-Deckkraft < 1 wird mit
  ihrer Deckkraft über den Hintergrund gerechnet. Der Ebenenrand ist deshalb deckend (V4).
- Ausnahme ab V2: die Auswahl, für die Kern oder Halo gilt.
- **Benannte Grenze:** Gegen die mittelgrauen Seitenflächen erreichen die unterscheidbaren
  Farbrollen rund 2 : 1 (Kontext). Ein Halo für jede Pfadlinie scheidet als Umfang aus (bis zu
  Millionen Segmente als Instanz-Linien); nur die Auswahl bekommt einen (V2).

**R3 — Nicht-Text-Kontrast der Viewer-Karten und Controls** (WCAG 1.4.11):
- Der Umriss jeder `.overlay-card`, **auch `.overlay-card.warn`**, hält ≥ 3 : 1 gegen die Szene
  dahinter, gegen `--bg` und die beleuchtete Tischfläche. Das leistet der Rand oder der
  Kartenkörper.
- Die erkennungsnotwendigen Teile **aktiv bedienbarer** Controls halten ≥ 3 : 1 gegen ihre
  Nachbarfarbe: Daumen der Regler, Schalter in beiden Zuständen, Icon-Glyphen. Inaktive Controls
  sind nach 1.4.11 ausgenommen.

## Pakete (Reihenfolge = Commit-Reihenfolge, je Paket Wächter zuerst rot)

### V1 — Palette nach der Paar-Tabelle, Backplot 2 px, Farbenblind-Wächter

- **Backplot 2 px:**
  - Der Backplot wird eine Bildschirm-breite Linie (`LineSegments2`/`LineMaterial`, 2 CSS px)
    statt der 1-px-`Line`.
  - Er ist ein Ringpuffer mit höchstens 20 000 Punkten (`BACKPLOT_MAX`). Ein Ring aus Segmenten
    braucht keine Linearisierung mehr, die Kosten sind begrenzt.
  - Tiefentest und Farbwechsel bleiben wie bisher.
- **Werte:** Minimaländerung per Solver, damit die gelernten Bedeutungen bleiben.
  - Nebenbedingungen: R1, R2.
  - Ziel: der kleinste OKLab-Weg von D8c, Zielwert 0,15 für Vorschub/Backplot (verbindlich
    bleibt 0,12).
  - Codex hat das Ergebnis unabhängig nachgerechnet. Die größte Verschiebung ist 0,083
    (Backplot dunkel), also rund 0,08.

| Theme | Vorschub | Backplot | Vorschub/Backplot (vorher → nachher) |
|---|---|---|---|
| hell | `#005dbd` → `#1663dc` | `#ba02b4` → `#b4098b` | 0,04 → 0,15 |
| dunkel (beide Blöcke) | `#0066cd` → `#066be3` | `#cd00c6` → `#be0692` | 0,04 → 0,15 |
| HC hell | `#003d82` → `#0238ab` | `#7d0079` → `#6f0b55` | 0,03 → 0,15 |
| HC dunkel | `#007af0` → `#057df3` | `#da08d3` → `#db11a3` | 0,09 → 0,15 |

  Vorschub/Limit bleibt farbgetrennt ≥ 0,12. In HC hell liegt es unter Tritan bei 0,1497, also
  über der verbindlichen Schwelle und knapp unter dem Zielwert.
- **Pfad-Grenzen HC hell:** `#004b1e` → `#014f0a` (0,025). Damit ≥ 0,12 zu den
  Maschinengrenzen bei normaler Sicht.
- **Eilgang:** bleibt grün und gestrichelt (Antwort an den Operator). Gestrichelt ist das
  farbunabhängige Merkmal, Orange auf Weiß hielt nur 2 : 1.
- **Grenze, benannt:**
  - Vorschub und Backplot unterscheiden sich in der Helligkeit nur um 1,13–1,16 : 1.
  - Ohne die Breite wäre die Unterscheidung allein farbig. Deshalb trägt der Backplot die
    2-px-Form; der Farbabstand ist die zweite Absicherung.
- **Wächter:**
  - `themeTokens.test.ts` liest die Paar-Tabelle und simuliert wie oben:
    - jedes farbgetrennte Paar in allen fünf Theme-Blöcken (inkl. Auto-Dunkel) unter vier
      Sichten ≥ 0,12;
    - jedes Paar bei normaler Sicht ≥ 0,12;
    - für jedes formgetrennte Paar muss sein Merkmal in der Merkmalsliste stehen.
  - Merkmale gebunden über die Viewer-Diagnose:
    - Eilgang `LineDashedMaterial`;
    - Backplot `LineMaterial` mit `linewidth` 2;
    - Auswahl ≥ 3 + Halo;
    - Limit-Overlay `LineBasicMaterial`;
    - Kollision nur auf Meshes und gestrichelten Überlaufkanten;
    - Maßlabels am Programmkasten.
  - **Im Bild nachgewiesen** (`scenes.viewer.spec`):
    - Backplot und Limit-Overlay in derselben Ansicht, ohne Auswahl-Halo als Hilfe.
    - Gemessen wird die Strichbreite senkrecht zur Linie. Die Diagnose liefert den
      Bildschirmpunkt und die Richtung eines Segments. Gezählt werden die Pixel nahe der
      Rollenfarbe mit Toleranz für Kantenglättung: Backplot ≥ 2, Vorschub/Limit < 2.
    - Das gilt in allen vier Themes.

### V2 — Auswahl mit Halo, in jedem Theme maximal

- **Regel:** Die Auswahl ist die Textfarbe auf einem Halo in Hintergrundfarbe.
  - Kern `--viewer-selection` ≈ `--fg`: hell `#111111`, dunkel `#e6edf3`, HC `#000000` /
    `#ffffff`.
  - Halo `--viewer-selection-halo` ≈ `--bg`.
  - Damit hält entweder der Kern oder der Halo gegen jede Fläche ≥ 3 : 1: Kern gegen `--bg`,
    Halo gegen die helle Tischfläche im dunklen Theme, Kern gegen die Tischfläche im hellen Theme.
- **Umsetzung:**
  - Ein zweites `LineSegments2` (Kernbreite + 2 × 2 px) hinter dem Kern, dieselbe
    Segmentgeometrie, Rolle `selectionHalo`.
  - `renderOrder` Halo < Kern, beide ohne Tiefenschreiben, die Bildschirmauflösung vor jedem
    Zeichnen (wie heute der Kern).
  - Kosten: nur die Segmente der Auswahl. Das Türkis im dunklen Theme entfällt (lag bei tritan
    0,06 am Vorschub).
- **Wächter:**
  - `__viewerDiag.getSelection()` meldet Halo sichtbar, Breite > Kern, Rolle.
  - `themeTokens.test.ts`: Kern gegen `--bg` ≥ 3 : 1; Halo oder Kern gegen die Tischfläche
    ≥ 3 : 1; beide Werte in allen fünf Blöcken.
  - **Im Bild** (`scenes.viewer.spec`):
    - Durch die Mitte eines ausgewählten Segments zeigt das Profil senkrecht zur Linie den Kern
      (Kernfarbe in der Mitte) und beidseitig den Halo (Halofarbe außerhalb).
    - Das gilt in vier Themes und auch nach einer Größenänderung des Viewers.

### V3 — Code-Panel: Befunde mit Form, nicht nur Farbe

- `.codeLine.violation` / `.collision` färben heute nur die Zeilennummer. Unter Deuteranopie
  liegen Warn- und Gefahrtext bei 0,02.
- **Neu:** Eine Glyphe steht in einem festen Slot **zwischen Nummer und Code**. Der Slot nimmt
  den heutigen Abstand von 16 px ein, die Zeilengeometrie bleibt gleich. Es sind dieselben
  lucide-Glyphen wie in der Zeitleiste:
  - ▲ `Triangle` für Limit;
  - × `X` für Kollision;
  - beides: × sichtbar (wie bisher „danger gewinnt“).
- Die Glyphe ist `role="img"` mit `aria-label`, das jeden Befund der Zeile nennt: „Limit
  violation“, „Collision“ oder „Limit violation, collision“.
- **Wächter:** GcodePanel-e2e, Glyphen und Namen je Art einschließlich Doppelbefund.
  `layout.spec`: Der Slot kostet in der schmalen Seitenleiste (150 % hoch, `--code-line-h`)
  keine Zeile; die drei Codezeilen aus UI-DI09 bleiben.

### V4 — TWP-Ebene: Palette, Zustand am Objekt, deckender Rand

- **Eine Darstellungsentscheidung:** `planeView(input)` (rein, getestet) liefert für die
  gezeichnete Ebene Rolle, Labeltext, Randmuster und Pfeilzustand. Farbe, Label und Rand kommen
  aus diesem einen Ergebnis. Das HUD-Wort liest dasselbe Ergebnis.

| Zustand | Rolle | Label am Objekt | Rand | Normalenpfeil |
|---|---|---|---|---|
| aktiv | `planeActive` | „Plane · active“ | durchgezogen | Z-Achsfarbe |
| definiert, nicht aktiv | `planeDefined` | „Plane · defined“ | durchgezogen | Z-Achsfarbe |
| Kopf veraltet | `planeStale` | „Plane · head moved“ | gestrichelt | Stale-Farbe (wie heute) |
| Bezugspunkt verschoben | `planeStale` | „Plane · datum moved“ | gestrichelt | Z-Achsfarbe (Kopfzustand gilt) |
| Simulation (`_scrubPlane`) | `planeActive` | „Plane · simulated“ | durchgezogen | Z-Achsfarbe |

  Treffen Kopf und Bezugspunkt zusammen, zeigt das Label beides.
- **Rollen:** `planeActive`, `planeDefined`, `planeStale` → `--viewer-plane-active/-defined/-stale`
  in allen fünf Theme-Blöcken. Anbindung über `ROLE_TOKEN`, Auflösung (nicht `#rrggbb` ist laut)
  und `refreshPalette`.
- **Deckender Außenrand:**
  - Ein eigener `LineLoop` mit Deckkraft 1, gestrichelt je Zustand.
  - Fläche (12 %) und Innenraster (35 %) bleiben durchscheinend.
  - R2 gilt für den Rand, einschließlich ≥ 4,5 : 1 auf dem Hintergrund in HC.
- **Wächter:**
  - `planeView.test.ts` deckt alle Zustände ab, auch Simulation mit abweichendem Live-Zustand
    und beide Anlässe zugleich.
  - `themeTokens.test.ts`: Rollen in allen Blöcken, beide Dunkel-Blöcke gleich, R2 für die
    Randfarbe.
  - Viewer-Diagnose: Randmaterial deckend (`opacity` 1, nicht transparent), Rolle, Muster.
  - e2e mit TWP-Profil: jeder Zustand, jeweils mit HUD sichtbar, gefaltet und ausgeschaltet.
    Geprüft werden Labeltext und Randmuster am Objekt; das HUD-Wort stimmt überein, wo es
    sichtbar ist.
  - Gerenderte Szenen je Zustand und Theme als Anhang zur Sichtprüfung (keine
    WebGL-Referenzbilder).

### V5 — Umriss der Viewer-Karten und Nicht-Text-Kontrast der Controls

- **Token:** `--overlay-edge` je Theme, als Rand der `.overlay-card` (eine Chrome: HUD,
  Warnkarte, Sim-Hinweis, PiP, Zeitleiste).
- **Warnvariante:** `.overlay-card.warn` bekommt denselben Nachweis. Ihr Rand hält R3 in der
  Warnfarbe, ihr Körper bleibt die Warn-Tönung.
- **Werte:** hell ≥ 3 : 1 gegen `#ffffff` und `#e1e1e1`; dunkel ≥ 3 : 1 gegen `--bg`. Gegen die
  Tischfläche leistet es dort der dunkle Kartenkörper.
- Die 92 % Deckkraft und die Unschärfe bleiben: Die Textpässe von `contrast.spec` setzen genau
  diesen Hintergrund zusammen und laufen erneut.
- **Controls:** Daumen der Regler (global `input[type="range"]`), Schalter (`input.toggle`) in
  beiden Zuständen und Icon-Glyphen erreichen ≥ 3 : 1 gegen ihre Nachbarfarbe. Die Korrektur
  wirkt global (ein Stil).
- **Prüfung je Oberfläche,** denn gemeinsame Regeln garantieren keine gemeinsamen Hintergründe:
  - die Zeitleiste (Simulation aus und an);
  - ein Settings-Regler und -Schalter (`SettingsPanel`);
  - die senkrechten Override-Regler (`OverridesStrip`);
  - der Jog-Tempo-Regler in der Leiste.
- **Wächter:** Neuer Nicht-Text-Pass in `contrast.spec`, fünf Themes.
  - **Aufbau:** nur aktiv bedienbare Controls, Programm geladen, Modell hinter der Zeitleiste,
    Hochformat 150 %.
  - **Messung:** gerenderte Pixel aus der Mitte der Flächen (Daumenmitte, Knopfmitte,
    Spurmitte, Kartenrand-Mitte). Kanten werden nicht gemessen, damit die Kantenglättung nicht
    als Farbe zählt.
  - **Paare:** Rand gegen Szene, Daumen gegen Spur und Karte, Knopf gegen Spur, Glyphe gegen
    Karte.
  - **Rot zuerst** gegen den heutigen Stand.

### V6 — Hinweis bei einer Palette aus einer früheren Version

Die Herkunft einer Custom-Palette ist nicht immer rekonstruierbar (VK-04). Drei Fälle:

| Fall | Erkennung | Settings zeigt |
|---|---|---|
| Alter Datensatz, **kein** `paletteMode`, Farben gespeichert | sicher | `.statusNote` (warn): „Colors from an earlier version — Automatic uses the theme's checked colors“ · Button „Use automatic colors“ |
| `paletteMode: "custom"` **ohne** Herkunft (auch unter D8c gespeicherte alte Farben) | unbekannt | sachliche Hilfe ohne Herkunftsbehauptung: „Custom colors are not checked against the theme“ · Button „Use automatic colors“ |
| Neuer Datensatz mit Herkunft (`paletteOrigin: "operator"`, gesetzt durch eine ausdrückliche Wahl) | sicher | nichts Zusätzliches |

- Die Migration setzt beim ersten Fall `paletteOrigin: "legacy"`. Das wird gespeichert und
  übersteht jede spätere Speicherung (Ebenenwechsel), bis der Operator ausdrücklich wählt
  (Radio oder Farbwähler → `"operator"`).
- Keine Farbheuristik, kein automatischer Moduswechsel (UI-D05). Der Wechsel behält die
  Custom-Werte.
- **Wächter:**
  - `viewerSection.test.ts` deckt alle drei Fälle ab. Dazu kommt das Upgrade
    `paletteMode: "custom"` mit alten Farben ohne `paletteOrigin` sowie eine bewusst gewählte
    Custom-Palette mit denselben Werten.
  - Geprüft wird: Farben erhalten, keine unbelegte Herkunft. Jeweils **speichern und neu laden**
    (Round-Trip über `saveSection`/`mergeViewerSection`).
  - Settings-e2e: Hinweis je Fall sichtbar bzw. nicht; der Button schaltet, speichert, der
    Hinweis verschwindet und die Custom-Werte bleiben.

## Entscheidungen in Abwesenheit des Operators (reversibel)

- **E1:** Tritan ist für farbgetrennte Paare Pflicht. Es ist mit rund 0,08 Verschiebung erreichbar.
- **E2:** Schwelle 0,12 (D8c) als projektspezifischer Regressionswächter; Zielwert 0,15, wo
  erreichbar. Kein allgemeiner Nachweis von Barrierefreiheit.
- **E3:** Minimaländerung statt Neuentwurf: Vorschub bleibt blau, Backplot magenta, Eilgang grün
  gestrichelt, Limit ocker.
- **E4:** Die Auswahl ist Kern in Textfarbe mit Halo in Hintergrundfarbe, in jedem Theme.
- **E5:** Ein Halo nur für die Auswahl, als bewusste Umfangsentscheidung (Kosten für
  Millionen-Segment-Pfade).
- **E6:** Die Migrationsregel UI-D05 bleibt; neu sind die drei Hinweisfälle.
- **E7:** Der neue Rand gilt für alle Viewer-Karten (eine Chrome), die Warnvariante eingeschlossen.
- **E8:** Regler und Schalter werden global korrigiert (ein Stil), gemessen auf vier Oberflächen.
- **E9:** Code-Panel-Glyphen wie in der Zeitleiste, zwischen Nummer und Code.
- **E10:** `settings.json` des Operators bleibt unberührt. Der erste Schritt der Sichtprüfung ist
  die Umstellung auf Automatic.
- **E11 (neu):** Backplot 2 px als Formmerkmal gegen Vorschub und Limit (VK-01), statt einer
  Farbtrennung Backplot/Limit. Die bräuchte in den dunklen Themes exakt 0,12 ohne Reserve.
- **E12 (neu):** Der TWP-Zustand steht am Objekt (Label + Randmuster) und kommt aus einer
  Darstellungsentscheidung; das HUD-Wort folgt ihr (VK-02).

## Verifikation

- **Je Paket:** build, lint (CSS-Audit), Vitest, `scripts/test_audit_scoped_css.py`,
  `serial-viewer`, `serial-layout`, `serial-visual`, `contrast.spec`.
- **Referenzbilder** nur nach Sichtprüfung des Diffs erneuern, im Commit benannt. Erwartet
  betroffen: alle Bilder mit Viewer-Karten (V5), Reglern/Schaltern (V5) und
  Code-Panel-Befunden (V3).
- **Codex:** erneutes Planreview (Fassung 2), danach ein Implementierungsreview über V1–V6.
- **Abschluss:** `python3 scripts/test_suite.py offline` PASS; Übergabe mit Checkliste für die
  Live-Sichtprüfung beider Branches.

## Risiken

- Sichtbare Farbänderungen des Vorschubs und Backplots sind klein (rund 0,08 OKLab), in der
  Sichtprüfung benannt.
- Der 2-px-Backplot wirkt kräftiger. Das ist gewollt, weil er das Ausgeführte über dem Geplanten
  kennzeichnet; er wird in der Sichtprüfung beurteilt.
- Ein kräftigerer Kartenrand wirkt schwerer. Er ist Operator-Wunsch (Outline) und wird in der
  Sichtprüfung beurteilt.
- Globale Regler-/Schalter-Farben ändern alle Settings- und Leisten-Controls. Die Referenzbilder
  werden bewusst erneuert.

## Folge-Liste

- Halo für alle Pfadlinien (Kosten zuerst messen).
- Farben der Maschinenkörper je Theme (`viewer/palette.ts`) für mehr Kontrast der Pfade auf den
  Seitenflächen.
- Tastatur-Erfassung der Belegungen und Halte-Alternative (K13) bleiben aus der Welle offen.

## Antworten auf Codex' Planreview Runde 1

| Punkt | Antwort | Planänderung / Abnahme |
|---|---|---|
| VK-01 | Angenommen. Die Soft-Limit-Begründung ist gestrichen. | Backplot 2 px als sichtbares Formmerkmal (E11, V1). Farbtrennung Backplot/Limit ginge in den dunklen Themes nur exakt an 0,12 ohne Reserve (Solver). Die Paar-Tabelle nennt alle 15 Paare der sechs Pfadrollen, auch Vorschub/Eilgang/Backplot gegen Kollision (Objekt). Abnahme: Strichbreite im gerenderten Bild, Backplot und Limit in einer Ansicht ohne Halo. |
| VK-02 | Angenommen. | `planeView` als eine Darstellungsentscheidung für Farbe, Label, Rand und Pfeil; Zustandslabel am Objekt; Simulation, Kopf und Bezugspunkt getrennt; Pfeil nur für den Kopf; HUD-Wort folgt (E12, V4). Abnahme: alle Zustände mit HUD sichtbar, gefaltet und aus. |
| VK-03 | Angenommen, Rechnung nachvollzogen. | Deckender Außenrand als eigenes Objekt, R2 auf die zusammengesetzte Farbe, Diagnose prüft die Deckkraft. V2: Kern und Halo im gerenderten Bild nachgewiesen, auch nach Größenänderung. |
| VK-04 | Angenommen. | Drei Fälle mit sicherer bzw. unbekannter Herkunft; keine unbelegte Herkunftsbehauptung; Tests mit Speichern und Neuladen, inklusive D8c-Upgrade und bewusster Custom-Palette mit gleichen Werten. |
| Präzisierung 1 | Angenommen. | Simulation als Heuristik benannt (Linearisierung, Machado, Abschneiden, OKLab); Helligkeitsgrenze Vorschub/Backplot benannt und durch die 2-px-Form gedeckt. |
| Präzisierung 2 | Angenommen. | Seitenflächen-Aussage auf die unterscheidbaren Farbrollen eingeschränkt; „rund 0,08“; verbindliche Schwelle 0,12 und Zielwert 0,15 getrennt, HC-hell-Tritan 0,1497 benannt. |
| Präzisierung 3 | Angenommen. | V5 prüft vier Oberflächen, nur aktive Controls, `.overlay-card.warn` eingeschlossen, Pixel aus Flächenmitten. |
| Präzisierung 4 | Angenommen. | V3: Glyphe zwischen Nummer und Code; Name nennt beide Befunde. |
