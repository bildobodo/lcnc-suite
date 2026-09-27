# Viewer-Kontrast — Farben, Formmerkmale und Ränder im 3D-Viewer

**Fassung 1 · 27. September 2026 · Branch `feat/viewer-contrast` aus `feat/ui-design-wave`
(`15b46ff`: Codex-Agreement D7–D10 auf `01775ef` + die Gate-Korrektur für serielle Playwright-Projekte; Offline-Gate PASS).** Merge nach `development` erst nach der Live-Sichtprüfung des Operators,
gemeinsam mit der Design-Welle (erst die Welle, dann dieser Branch). Nie `main`.

Der Operator ist bis zur Sichtprüfung abwesend und hat angeordnet: offene Fragen entscheidet
Claude selbst und zieht bei Bedarf Codex hinzu. Solche Entscheidungen sind unten als **E1–E10**
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

Gegen die Seitenflächen hält **keine** Linienfarbe 3 : 1, die zugleich 3 : 1 auf dem Hintergrund
hält (≈ 2 : 1 für alle).

**Farbenblindheit:**
- Simuliert nach Machado et al. 2009, Schwere 1,0 (Protanopie, Deuteranopie, Tritanopie).
- Gemessen wird der OKLab-Abstand. Schwelle 0,12, dieselbe wie die D8c-Pfadregel in
  `themeTokens.test.ts`.

| Paar (Automatic, hell) | normal | protan | deutan | tritan | Formmerkmal heute |
|---|---|---|---|---|---|
| Vorschub / Backplot | 0,27 | **0,04** | **0,09** | 0,27 | keines, beide 1 px durchgezogen |
| Vorschub / Eilgang | 0,25 | 0,24 | 0,23 | **0,05** | gestrichelt |
| Eilgang / Limit | 0,17 | **0,03** | **0,08** | 0,21 | gestrichelt gegen durchgezogen |
| Limit / Kollision | 0,15 | **0,11** | **0,02** | **0,11** | 3D: Pfad gegen Maschinentönung; Zeitleiste ▲ / ×; **Code-Panel: nur Farbe** |
| Vorschub / Auswahl (dunkel) | 0,15 | 0,15 | 0,15 | **0,06** | 3 px breit |

Die Werte für die anderen Themes liegen gleich (dunkel: Vorschub/Backplot protan 0,04).

**Befund 3 — Karten über dem Viewer** (unbewaffnet gemessen, die Controls also gedimmt):
- Der Rand der `.overlay-card` hat gegen die Szene 1,43 : 1 (hell) bzw. 1,51 : 1 (dunkel).
- Der Kartenkörper hebt sich mit 1,07–1,08 : 1 vom Hintergrund ab.
- Über der hellen Tischfläche verschwimmt die helle Karte (1,2 : 1).
- Die Nicht-Text-Teile der Zeitleiste (Daumen, Spur, Schalter) werden heute nicht gemessen.
  `contrast.spec` misst nur Text.

**Befund 4 — feste Farben außerhalb der Palette.** Die TWP-Ebene (`_TWP_ACTIVE_HEX`
`#4aa3ff`, `_TWP_INACTIVE_HEX` `#ffb347`, `_TWP_STALE_HEX` `#cc3333` in `ThreeViewer.vue`) folgt
keinem Theme.

## Regeln

**R1 — Paar-Tabelle.** Jedes Paar von Rollen, das auf derselben Fläche gezeichnet wird, gehört
zu genau einer von zwei Arten:

- **Farbgetrennt:** Der OKLab-Abstand ist ≥ 0,12 bei normaler Sicht **und** unter Protan-,
  Deutan- und Tritan-Simulation (Machado 1,0).
- **Formgetrennt:** Das Paar trägt ein deklariertes, testgebundenes Form- oder Objektmerkmal.
  Dann gilt nur die D8c-Regel, also ≥ 0,12 bei normaler Sicht.

Die Tabelle ist die Spezifikation des Wächters und wird als Daten abgelegt
(`viewer/palettePairs.ts`, Name vorläufig):

| Paar | Wo | Art | Merkmal |
|---|---|---|---|
| Vorschub / Backplot | Backplot liegt auf dem Pfad | farbgetrennt | — |
| Vorschub / Limit | Overlay auf dem Pfad | farbgetrennt | — |
| Vorschub / Eilgang | benachbart | formgetrennt | Eilgang gestrichelt |
| Eilgang / Limit | Overlay auf einem Eilgang | formgetrennt | gestrichelt gegen durchgezogen |
| Backplot / Eilgang | ausgeführter Eilgang | formgetrennt | Eilgang gestrichelt |
| Backplot / Limit | selten benachbart: LinuxCNC fährt nicht über die Soft-Limits | formgetrennt | Objekt: nie dasselbe Segment |
| Auswahl / jede Pfadrolle | Auswahl auf dem Pfad | formgetrennt | 3 px breit + Halo (V2) |
| Limit / Kollision | 3D, Zeitleiste, Code-Panel | formgetrennt | Pfad gegen Maschinentönung; ▲ / ×; Code-Panel ▲ / × (V3) |
| Grenzen / Pfad-Grenzen | zwei durchgezogene Kästen | formgetrennt | Maßbeschriftung am Programmkasten („X: 300 mm“); farblich erreichen die dunklen Themes bei Farbenblindheit keine Trennung ohne Farbwechsel nach Violett (Solver). HC hell liegt heute sogar normal bei 0,11 und wird minimal verschoben |
| Pfad-Grenzen-Überlauf / Grenzen | Überlaufkanten des Programmkastens | formgetrennt | gestrichelt (Kollisionsrolle) |
| TWP aktiv / definiert / veraltet | Ebene + HUD-Wort | formgetrennt | HUD-Wort („plane active / defined / stale“) |

**R2 — Kontrast der Linien** (D8c, unverändert):
- Jede Linienrolle hält ≥ 3 : 1 auf `--bg` **und** auf der beleuchteten Tischfläche (`#e0e0e0`
  im Test, `#e1e1e1` gemessen), in beiden HC-Themes ≥ 4,5 : 1 auf `--bg`.
  Ausnahme ab V2: die Auswahl, für die Kern oder Halo gilt.
- **Benannte Grenze:** gegen die mittelgrauen Seitenflächen hält keine Farbe zugleich 3 : 1. Ein
  Halo für jede Pfadlinie scheidet aus (Millionen Segmente, Instanz-Linien). Nur die Auswahl
  bekommt einen (V2).

**R3 — Nicht-Text-Kontrast der Viewer-Karten** (WCAG 1.4.11):
- Der Umriss jeder `.overlay-card` hält ≥ 3 : 1 gegen die Szene dahinter, gegen `--bg` und die
  beleuchtete Tischfläche. Das leistet der Rand oder der Kartenkörper.
- Die erkennungsnotwendigen Teile bewaffneter Controls der Zeitleiste halten ≥ 3 : 1 gegen ihre
  Nachbarfarbe: Daumen von Zeitregler und Tempo, der Sim-Schalter in beiden Zuständen,
  Icon-Glyphen.

## Pakete (Reihenfolge = Commit-Reihenfolge, je Paket Wächter zuerst rot)

### V1 — Palette nach der Paar-Tabelle + Farbenblind-Wächter

- **Wächter:** Die Paar-Tabelle als Daten. `themeTokens.test.ts` simuliert Machado 1,0 und prüft
  jedes farbgetrennte Paar in allen fünf Theme-Blöcken (inkl. Auto-Dunkel) unter vier Sichten,
  jedes formgetrennte Paar bei normaler Sicht. Die Formmerkmale sind gebunden:
  - gestrichelt: der Eilgang hat `LineDashedMaterial` (Diagnose-Hook);
  - breit: `SELECTION_WIDTH_PX` ≥ 3.
- **Werte:** Minimaländerung per Solver, damit die gelernten Bedeutungen bleiben.
  - Nebenbedingungen: R1, R2, dazu Vorschub/Limit farbgetrennt.
  - Ziel: der kleinste OKLab-Weg von D8c, mit Reserve 0,15 statt 0,12.
  - Ergebnis:

| Theme | Vorschub | Backplot | min. Abstand (vorher → nachher) |
|---|---|---|---|
| hell | `#005dbd` → `#1663dc` | `#ba02b4` → `#b4098b` | 0,04 → 0,15 |
| dunkel (beide Blöcke) | `#0066cd` → `#066be3` | `#cd00c6` → `#be0692` | 0,04 → 0,15 |
| HC hell | `#003d82` → `#0238ab` | `#7d0079` → `#6f0b55` | 0,03 → 0,15 |
| HC dunkel | `#007af0` → `#057df3` | `#da08d3` → `#db11a3` | 0,09 → 0,15 |

  Die Farbfamilien bleiben: Vorschub blau, Backplot magenta/himbeer. Verschoben wird höchstens
  0,08 (OKLab).
- **Pfad-Grenzen:** HC hell auf ≥ 0,12 zu den Maschinengrenzen bei normaler Sicht, per
  Minimaländerung. Das Paar ist formgetrennt über die Maßbeschriftung; der Wächter bindet sie
  (Labels am Programmkasten).
- **Eilgang:** bleibt grün und gestrichelt (Antwort an den Operator). Gestrichelt ist das
  farbunabhängige Merkmal, Orange auf Weiß hielt nur 2 : 1.

### V2 — Auswahl mit Halo, in jedem Theme maximal

- **Regel:** Die Auswahl ist die Textfarbe auf einem Halo in Hintergrundfarbe.
  - Kern `--viewer-selection` ≈ `--fg`: hell `#111111`, dunkel `#e6edf3`, HC `#000000` /
    `#ffffff`.
  - Halo `--viewer-selection-halo` ≈ `--bg`.
  - Damit hält entweder der Kern oder der Halo gegen jede Fläche ≥ 3 : 1: Kern gegen `--bg`,
    Halo gegen die helle Tischfläche im dunklen Theme, Kern gegen die Tischfläche im hellen Theme.
- **Umsetzung:**
  - Ein zweites `LineSegments2` (Kernbreite + 2 × 2 px) hinter dem Kern, gleiche Segmente,
    Rolle `selectionHalo`.
  - Kosten: nur die Segmente der Auswahl.
  - Das Türkis im dunklen Theme entfällt (lag bei tritan 0,06 am Vorschub).
- **Wächter:**
  - `__viewerDiag.getSelection()` meldet Halo sichtbar, Breite > Kern, Rolle.
  - `themeTokens.test.ts`: Kern gegen `--bg` ≥ 3 : 1; Halo oder Kern gegen die Tischfläche
    ≥ 3 : 1; beide Werte in allen fünf Blöcken.

### V3 — Code-Panel: Befunde mit Form, nicht nur Farbe

- `.codeLine.violation` / `.collision` färben heute nur die Zeilennummer. Unter Deuteranopie
  liegen Warn- und Gefahrtext bei 0,02.
- Neu steht vor der Nummer eine Glyphe in einem festen Slot. Es sind dieselben lucide-Glyphen wie
  in der Zeitleiste:
  - ▲ `Triangle` für Limit;
  - × `X` für Kollision;
  - beides: ×, wie bisher „danger gewinnt“.
- Die Glyphe steht in einem festen Slot zwischen Nummer und Code. Der Slot nimmt den heutigen
  Abstand von 16 px ein, die Zeilengeometrie bleibt also gleich.
- Die Glyphe ist `role="img"` mit `aria-label` („Limit violation“ / „Collision“), damit ein
  Screenreader die Markierung nennt.
- **Wächter:** GcodePanel-e2e, Glyphen je Art. `layout.spec`: Der Slot kostet in der schmalen
  Seitenleiste (150 % hoch, `--code-line-h`) keine Zeile; die drei Codezeilen aus UI-DI09
  bleiben.

### V4 — TWP-Ebene in die Palette

- **Neue Rollen:** `planeActive`, `planeDefined`, `planeStale` →
  `--viewer-plane-active/-defined/-stale` in allen fünf Theme-Blöcken.
- **Anbindung:** `ROLE_TOKEN`, Auflösung (nicht `#rrggbb` ist laut), `refreshPalette`. Material,
  Rand, Label und Normalenpfeil lesen die Rolle.
- **Regel:** R2 für den Ebenenrand. Paare untereinander formgetrennt über das HUD-Wort.
- **Wächter:** `themeTokens.test.ts` (Rollen vorhanden, beide Dunkel-Blöcke gleich);
  Viewer-Diagnose meldet die Rolle der Ebenenmaterialien.

### V5 — Umriss der Viewer-Karten und Nicht-Text-Kontrast der Zeitleiste

- **Token:** `--overlay-edge` je Theme, als Rand der `.overlay-card` (eine Chrome: HUD,
  Warnkarte, Sim-Hinweis, PiP, Zeitleiste).
- **Werte:** hell ≥ 3 : 1 gegen `#ffffff` und `#e1e1e1`; dunkel ≥ 3 : 1 gegen `--bg`. Gegen die
  Tischfläche leistet es dort der dunkle Kartenkörper.
- Die 92 % Deckkraft und die Unschärfe bleiben: Die Textpässe von `contrast.spec` setzen genau
  diesen Hintergrund zusammen und laufen erneut.
- **Controls:** Daumen der Regler (global `input[type="range"]`), der Schalter (`input.toggle`)
  in beiden Zuständen und Icon-Glyphen erreichen ≥ 3 : 1 gegen ihre Nachbarfarbe. Die Korrektur
  wirkt global (ein Stil), gemessen wird in der Zeitleiste.
- **Wächter:** Neuer Nicht-Text-Pass in `contrast.spec`, fünf Themes.
  - **Zustände:** bewaffnet, Programm geladen, Simulation aus und an.
  - **Aufbau:** Modell hinter der Leiste, Hochformat 150 % (die Zustände des Operators).
  - **Messung:** gerenderte Pixel (Rand gegen Szene, Daumen gegen Spur und Karte, Schalter-Knopf
    gegen Spur, Spur gegen Karte).
  - **Rot zuerst** gegen den heutigen Stand.

### V6 — Hinweis bei einer Palette aus einer früheren Version

- Die Migration merkt sich die Herkunft: `paletteOrigin: "legacy"`, gespeichert, bis der
  Operator ausdrücklich einen Modus wählt. Kein heuristisches Umschalten, UI-D05 bleibt.
- Settings → 3D Viewer → Colors zeigt dann eine `.statusNote` (warn) mit Button: „Colors from an
  earlier version — Automatic uses the theme's checked colors“ · „Use automatic colors“.
- Der Wechsel behält die Custom-Werte (UI-D05).
- **Wächter:** `viewerSection.test.ts` (Herkunft bleibt über eine Ebenen-Speicherung erhalten,
  endet mit einer ausdrücklichen Wahl); Settings-e2e (Hinweis sichtbar, Button schaltet,
  gespeichert, Hinweis weg).

## Entscheidungen in Abwesenheit des Operators (reversibel)

- **E1:** Tritan ist für farbgetrennte Paare Pflicht. Das ist mit ≤ 0,08 Verschiebung erreichbar.
- **E2:** Schwelle 0,12 (D8c), Werte mit Reserve 0,15.
- **E3:** Minimaländerung statt Neuentwurf: Vorschub bleibt blau, Backplot magenta, Eilgang grün
  gestrichelt, Limit ocker.
- **E4:** Die Auswahl ist Kern in Textfarbe mit Halo in Hintergrundfarbe, in jedem Theme.
- **E5:** Ein Halo nur für die Auswahl. Ein Halo für alle Pfade ist eine benannte Grenze.
- **E6:** Die Migrationsregel UI-D05 bleibt; neu ist nur ein Hinweis.
- **E7:** Der neue Rand gilt für alle Viewer-Karten (eine Chrome).
- **E8:** Regler und Schalter werden global korrigiert (ein Stil), gemessen in der Zeitleiste.
- **E9:** Code-Panel-Glyphen wie in der Zeitleiste.
- **E10:** `settings.json` des Operators bleibt unberührt. Der erste Schritt der Sichtprüfung ist
  die Umstellung auf Automatic.

## Verifikation

- **Je Paket:** build, lint (CSS-Audit), Vitest, `scripts/test_audit_scoped_css.py`,
  `serial-viewer`, `serial-layout`, `serial-visual`, `contrast.spec`.
- **Referenzbilder** nur nach Sichtprüfung des Diffs erneuern, im Commit benannt. Erwartet
  betroffen: alle Bilder mit Viewer-Karten (V5) und Code-Panel-Befunden (V3).
- **Codex:** Planreview, danach ein Implementierungsreview über V1–V6.
- **Abschluss:** `python3 scripts/test_suite.py offline` PASS; Übergabe mit Checkliste für die
  Live-Sichtprüfung beider Branches.

## Risiken

- Sichtbare Farbänderungen des Vorschubs und Backplots sind klein (≤ 0,08 OKLab), in der
  Sichtprüfung benannt.
- Ein kräftigerer Kartenrand wirkt schwerer. Er ist Operator-Wunsch (Outline) und wird in der
  Sichtprüfung beurteilt.
- Globale Regler-/Schalter-Farben ändern alle Settings- und Leisten-Controls. Die Referenzbilder
  werden bewusst erneuert.

## Folge-Liste

- Halo für alle Pfadlinien (Kosten zuerst messen).
- Farben der Maschinenkörper je Theme (`viewer/palette.ts`) für mehr Kontrast der Pfade auf den
  Seitenflächen.
- Tastatur-Erfassung der Belegungen und Halte-Alternative (K13) bleiben aus der Welle offen.
