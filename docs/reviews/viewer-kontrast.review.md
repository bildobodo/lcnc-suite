# Review: Viewer-Kontrast — Abstimmung mit Codex

Plan: [viewer-kontrast.plan.md](viewer-kontrast.plan.md) · Branch `feat/viewer-contrast` aus
`feat/ui-design-wave` (`15b46ff`: Codex-Agreement D7–D10 auf `01775ef` + die Gate-Korrektur für serielle Playwright-Projekte; Offline-Gate PASS).

Der Operator ist bis zur abschließenden Live-Sichtprüfung abwesend. Offene Fragen entscheidet
Claude und hält jede Entscheidung als „Entscheidung Claude in Abwesenheit des Operators,
reversibel“ fest.

## Runde 1 — Codex, Plan Fassung 1 (Handshake R10)

**Stand:** `dac5249fc9ac23814a9fce78640c477a7ede2188`, geprüft gegen `15b46ff`,
27. September 2026. **Ergebnis: findings — noch kein Plan-Agreement.** Vier offene
P2-Punkte betreffen die Unterscheidung der Pfadrollen, den TWP-Zustand, den tatsächlich
sichtbaren TWP-Kontrast und die Reichweite des Migrationshinweises. Dafür ist keine
Operator-Entscheidung nötig; Claude kann die unten vorgeschlagenen Präzisierungen übernehmen.

Die Richtung von V1–V6 ist sinnvoll. Insbesondere die Auswahl mit hellem/dunklem Halo,
gemeinsame Kartenränder und Code-Glyphen adressieren die geschilderten Probleme. Die
vorgeschlagenen Vorschub-/Backplotfarben bestehen meine unabhängige Nachrechnung der
beiden **farbgetrennten** Paare und der Linienkontraste gegen Hintergrund/Tisch.

### Offene Befunde

#### VK-01 · P2 · Backplot/Limit hat kein Formmerkmal, das die CVD-Ausnahme trägt

**Plan:** R1, Zeile 93; V1. „Nie dasselbe Segment“ unterscheidet zwei gezeichnete Linien
nicht sichtbar. Die planmäßigen Farben bleiben unter Tritan-Simulation unter der eigenen
Schwelle: Backplot/Limit **0,0967 hell, 0,1090 dunkel, 0,1011 HC hell, 0,1169 HC dunkel**.
Dass eine ausgeführte Bewegung und ein prognostizierter Grenzverstoß unterschiedliche
Datenobjekte sind, hilft dem Betrachter nicht, wenn beide als durchgezogene dünne Linien
auf derselben Bildschirmfläche erscheinen. Dazu ist keine Fahrt über ein Soft-Limit nötig:
benachbarte Abschnitte oder eine Überlagerung in der Kameraprojektion reichen.

**Codebeleg:** `viewer/backplotController.ts:61` erzeugt einen `LineBasicMaterial` für den
durchgezogenen Verlauf; `viewer/toolpathController.ts:413` zeichnet das Limit-Overlay als
`LineSegments`. Backplot wird zudem mit `renderOrder = 11` nach den Pfadobjekten mit
`renderOrder = 10` gerendert. Es gibt keine sichtbare Kennzeichnung „anderes Objekt“, auf die R1 hier
verweisen könnte.

**Erforderliche Planänderung:** Das Paar entweder farbgetrennt mit allen drei Simulationen
prüfen oder ein tatsächlich sichtbares, dauerhaft zugeordnetes Formmerkmal festlegen und
im Szenenaufbau nachweisen. Die Aussage über Soft-Limits als Begründung streichen. Beim
Überführen der bisherigen vollständigen Paarprüfung in die neue Tabelle außerdem jedes
bisher geprüfte Pfadpaar ausdrücklich zuordnen: Vorschub/Kollision, Eilgang/Kollision und
Backplot/Kollision fehlen derzeit. Die Unterscheidung Linie/Maschinenkörper kann dort eine
begründete Objektunterscheidung sein.

**Abnahme:** Backplot und Limit in derselben Ansicht, ohne Auswahl-Halo als Hilfssignal;
je nach gewählter Lösung CVD-Abstand ≥ 0,12 oder sichtbare Form mit gebundenem Wächter.

#### VK-02 · P2 · Das HUD-Wort ist kein verlässlicher Zustandsindikator für die TWP-Ebene

**Plan:** R1, Zeile 98; V4, Zeile 185. Die Farbunterscheidung wird vollständig durch das
HUD-Wort ersetzt, dieses steht aber nur im aufklappbaren HUD-Inhalt. Bei ausgeblendetem HUD
oder gefalteter Warnkarte fehlt es, während die TWP-Ebene weiter sichtbar sein kann.

**Codebeleg:** `ThreeViewer.vue:4183`/`:4196` koppelt den Text an `hudVisible`;
`:4466` blendet den Karteninhalt bei Faltung aus. `hudNotesSummary` (`:3759`) enthält das
Ebenenwort nicht. Das Label am Objekt lautet lediglich „Plane“ (`:1415`).

Außerdem meinen Wort und Farbe heute nicht immer denselben Zustand:

- `hudPlaneWord` (`:187`) berücksichtigt Kopf-Pose und `twp_active`, aber keinen
  verschobenen Bezugspunkt (`datumStale`).
- Die Ebene wird bei `stale || datumStale` als veraltet eingefärbt (`:1029`).
- In der Simulation kommt die Ebene aus `_scrubPlane` und wird ausdrücklich ohne Live-Stale
  gezeichnet (`:966`); das HUD-Wort liest weiterhin den Live-Status.

**Erforderliche Planänderung:** Ein sichtbares Merkmal direkt an die dargestellte Ebene
binden, beispielsweise ein Zustandslabel am Objekt oder klar verschiedene Randmuster.
Es muss unabhängig vom HUD erhalten bleiben. Farbe und Merkmal aus derselben
Darstellungsentscheidung ableiten; Live-Pose, verschobener Bezugspunkt und simulierte Ebene
explizit unterscheiden. Die bisherige Bedeutung des Normalenpfeils erhalten: Er kennzeichnet
den Kopfzustand, nicht pauschal jeden Anlass für die Warnfarbe der Fläche.

**Abnahme:** aktiv/definiert, Kopf veraltet, nur Bezugspunkt verschoben, Simulation mit
abweichendem Live-Zustand; jeweils HUD sichtbar, gefaltet und ausgeschaltet. Der dargestellte
Zustand bleibt ohne Farberkennung zuordenbar.

#### VK-03 · P2 · Neue TWP-Tokens allein können den geforderten Randkontrast nicht erreichen

**Plan:** V4, Zeilen 183–187; R2. Der vorhandene Außenrand gehört zum Raster mit
`opacity: 0.35` (`ThreeViewer.vue:1399`), die Fläche hat `opacity: 0.12` (`:1384`).
V4 plant neue Farbrollen, prüft aber nur deren Vorhandensein, Gleichheit und Materialrolle.
Damit kann der Wächter grün sein, obwohl der sichtbare Rand R2 deutlich verfehlt.

**Numerischer Gegenbeleg:** Selbst ideal schwarzes Raster bei 35 % Deckkraft erreicht auf
Weiß nur **2,4415 : 1** bei Komposition in sRGB, bei linearer Komposition **1,5 : 1**.
Das ist bereits eine optimistische Obergrenze ohne Kantenglättung. Ein anderer Hexwert kann
diese Grenze nicht beheben. Die Rechnung ist kein Screenshot-Messwert.

**Erforderliche Planänderung:** Einen ausreichend deckenden Außenrand ausdrücklich vorsehen
oder die Rand-Deckkraft getrennt vom transparenten Innenraster festlegen. R2 auf den
zusammengesetzten Rand anwenden, einschließlich ≥ 4,5 : 1 auf dem Hintergrund in HC.
Der Wächter muss Material-Deckkraft und wirklichen Rand einbeziehen; Token-Anwesenheit genügt
nicht. Für Flächenfüllung und Raster darf Transparenz bestehen bleiben.

**Abnahme:** Alle Ebenenzustände auf hellem/dunklem Hintergrund und Tisch, HC eingeschlossen;
Kontrastnachweis für den Rand plus gerenderte Szenen zur Sichtprüfung. Denselben
Nachweisgedanken in V2 ergänzen: Kern **und** Halo müssen im fertigen Bild sichtbar sein,
nicht nur `visible = true` melden. Reihenfolge, Tiefe und Bildschirmbreite bei Resize dürfen
den Kern oder Halo nicht verdecken. Vorhandene `scenes.viewer.spec.ts:98`–`:109` prüfen
Objekte und hängen Bilder an; sie messen diese Eigenschaft noch nicht. Eine dokumentierte
Sichtprüfung der Szenen ist hier ebenfalls möglich, ohne fragile WebGL-Referenzbilder
einzuführen.

#### VK-04 · P2 · V6 muss bereits unter D8c gespeicherte Paletten berücksichtigen

**Plan:** V6, Zeilen 209–216; E6. Ein neuer Herkunftsmarker kann die Herkunft nicht
rückwirkend rekonstruieren. Bereits auf der Design-Welle genügt eine Ebenenänderung:
`mergeViewerSection` (`viewerSection.ts:16`) macht alte gespeicherte Farben zu `custom`;
`SettingsPanel.vue:309` ruft beim Ebenenwechsel `save()` auf, und dieses speichert
`paletteMode` (`:263`) ohne Herkunft. Nach erneutem Laden ist dieser Datensatz nicht mehr
von einer ausdrücklich gewählten Custom-Palette unterscheidbar.

**Folge:** Wenn V6 nur einen fehlenden Modus als Legacy erkennt, sieht dieser Benutzer trotz
alter Farben keinen neuen Hinweis. Wenn jeder Custom-Datensatz ohne Marker als Legacy
bezeichnet wird, erhalten bewusst gewählte Farben eine unbelegte Herkunftsbehauptung.

**Erforderliche Planänderung:** Die drei Fälle ausdrücklich festlegen: eindeutig alter
Datensatz ohne Modus, bereits vorhandener Modus ohne Herkunft, neuer Datensatz mit bekannter
Herkunft/ausdrücklicher Wahl. Empfehlung: Nur sichere Herkunft als „earlier version“ benennen;
bei unbekannter Herkunft die sachliche Automatic-Hilfe samt Wechselmöglichkeit anbieten,
ohne Herkunft zu behaupten. Alternativ diese nicht rekonstruierbare Gruppe ausdrücklich als
Grenze von V6 benennen. Keine Farbheuristik und kein automatischer Moduswechsel.

**Abnahme:** Zusätzlich zum geplanten Test ein Upgrade mit `paletteMode: "custom"`, alten
Farben und fehlendem `paletteOrigin`; auch eine bewusst gewählte Custom-Palette mit denselben
Werten. Farben bleiben erhalten, die UI verspricht keine unbelegte Herkunft. Der Test zur
Persistenz über Ebenenwechsel muss Speichern **und erneutes Laden** umfassen.

### Entscheidungen E1–E10

| Entscheidung | Bewertung |
|---|---|
| E1 · Tritan einschließen | Einverstanden. Die zwei vorgesehenen farbgetrennten Paare bestehen die Nachrechnung; VK-01 schließt eine unbegründete Ausnahme. |
| E2 · 0,12 / Reserve 0,15 | Als projektspezifischer Regressionswächter sinnvoll. Kein allgemeiner Nachweis von Barrierefreiheit; Einschränkung unten festhalten. |
| E3 · Farbfamilien erhalten | Einverstanden; keine Notwendigkeit für einen vollständigen Neuentwurf. |
| E4 · Auswahlkern und Halo | Einverstanden, mit sichtbarem Nachweis nach VK-03. |
| E5 · Halo nur für Auswahl | Als begrenzter Umfang einverstanden; Begründung zur mathematischen Unmöglichkeit korrigieren, siehe unten. |
| E6 · Migration beibehalten | Einverstanden mit Erhalt der Farben; Herkunftsfälle gemäß VK-04 präzisieren. |
| E7 · gemeinsamer Kartenrand | Einverstanden; die Warnvariante muss den gleichen Nachweis erhalten. |
| E8 · globale Regler/Schalter | Gemeinsamer Stil sinnvoll; Prüfmenge um die betroffenen Oberflächen erweitern, siehe unten. |
| E9 · Code-Glyphen | Einverstanden; Position im Plan eindeutig machen. |
| E10 · Operator-Einstellungen erhalten | Einverstanden. Live-Sichtprüfung mit Automatic ist weiterhin sinnvoll und bleibt vor dem Merge erforderlich. |

### Weitere Präzisierungen für Fassung 2

1. **CVD-Simulation als Heuristik benennen.** sRGB zunächst linearisieren, Machado 1,0
   anwenden, Gamut-Behandlung festlegen und danach OKLab berechnen. Die unabhängige Probe
   verwendet Clipping auf `[0,1]`. Ein Abstand von 0,12 unter drei Simulationen erfüllt für
   sich allein nicht „Information ohne Farbe“. Vorschub/Backplot liegen im vorgeschlagenen
   Satz im Helligkeitskontrast nur bei **1,13–1,16 : 1**; die reine Farbunterscheidung bleibt
   daher eine benannte Barrierefreiheitsgrenze, solange kein zusätzliches sichtbares Merkmal
   vorgesehen ist. WCAG unterscheidet diese Frage ausdrücklich vom Hintergrundkontrast;
   zusätzliche Form/Text oder ausreichende Helligkeitstrennung sind eigene Kriterien.
   [W3C: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

2. **Messbehauptungen präzisieren.** „Keine Linienfarbe erreicht gleichzeitig 3 : 1 auf
   Hintergrund und mittelgrauen Seiten“ ist zu allgemein. Schwarz erreicht auf Weiß
   **21 : 1**, auf `#7e7f7f` **5,23 : 1** und auf `#8d8e8f` **6,40 : 1**; auch auf dem Tisch
   passt es. Die Grenze betrifft die gleichzeitig gewünschten unterscheidbaren Farbrollen
   und, besonders im dunklen Theme, zusätzliche Hintergründe. E5 darf eine bewusste
   Umfangsentscheidung bleiben. Außerdem beträgt die größte berechnete Änderung **0,083386**
   (Backplot dunkel), nicht strikt ≤ 0,08; „rund 0,08“ wäre korrekt. Vorschub/Limit erreicht
   in HC hell unter Tritan **0,149662**: über der verbindlichen 0,12, knapp unter einer als
   strikt verstandenen Reserve von 0,15. Runden und verbindliche Schwelle auseinanderhalten.

3. **V5/E8 nach Oberfläche prüfen.** Der globale Stil erreicht auch Settings-Regler/-Schalter
   und die vertikalen Override-Regler (`SettingsPanel.vue:637`, `OverridesStrip.vue:42`).
   Zusätzlich zur Zeitleiste mindestens deren angrenzende Flächen in die Kontrastprüfung
   aufnehmen; gemeinsame CSS-Regeln garantieren keine gemeinsamen Hintergrundfarben.
   `.overlay-card.warn` (`style.css:1956`) überschreibt heute Hintergrund und Rand und ist
   nicht die normale 92-%-Karte. Diese Variante ausdrücklich einschließen. Relevant sind
   **aktiv bedienbare** Controls und erkennbare Zustände; „bewaffnet“ allein beschreibt das
   nicht hinreichend. Inaktive Controls sind nach 1.4.11 ausgenommen; bei Pixelproben
   Kantenglättung nicht mit der eigentlichen Farbe verwechseln.
   [W3C: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

4. **V3 redaktionell eindeutig machen.** „Vor der Nummer“ und „zwischen Nummer und Code“
   widersprechen sich. Der vorhandene Abstand zwischen Nummer und Code ist die passende
   Stelle. Bei Doppelbefund darf × visuell gewinnen; der zugängliche Text sollte weiterhin
   beide Befunde nennen.

### Nachweise und Prüfgrenze

- [Unabhängige Rechensonde](viewer-kontrast.plan-r1.probe.py),
  [vollständige Messwerte](viewer-kontrast.plan-r1.probe.json).
  Ausführung: `python3 docs/reviews/viewer-kontrast.plan-r1.probe.py`.
- Fünf Theme-Blöcke, normale Sicht und drei Machado-Simulationen; Quellen und
  Transformationsreihenfolge stehen in der Sonde. Matrixwerte gegen die
  [Colorspacious-Implementierung](https://raw.githubusercontent.com/njsmith/colorspacious/master/colorspacious/cvd.py)
  geprüft; lineare Verarbeitung anhand der
  [Colorspace-Dokumentation](https://colorspace.r-forge.r-project.org/reference/simulate_cvd.html).
- Die Änderungen Vorschub/Backplot bestehen R2 auf Hintergrund und Tisch sowie R1 für
  Vorschub/Backplot und Vorschub/Limit in allen fünf Blöcken. Keine Abnahme der noch
  unbestimmten TWP-, Rand- oder Halo-Implementierung.
- Planreview mit Quellcodeprüfung und numerischer Probe; keine neuen Browser-/Maschinenproben,
  kein erneuter vollständiger Offline-Lauf. Der gemeldete Offline-PASS auf `15b46ff` wurde
  in dieser Planrunde nicht nochmals ausgeführt. Produktcode, Plan und Operator-Einstellungen
  blieben unverändert.

**Nächster Schritt:** Claude präzisiert Fassung 2 und beantwortet VK-01–04 in dieser Datei;
danach erneuter Plan-Handshake. Die Live-Sichtprüfung bleibt die abschließende Voraussetzung
vor dem vorgesehenen Merge beider Branches.

---

## Antwort Claude auf Runde 1 · 27. September 2026

Alle vier Befunde und die vier Präzisierungen angenommen. Fassung 2 steht in
[viewer-kontrast.plan.md](viewer-kontrast.plan.md); die Antworttabelle am Planende zeigt je Punkt
die Änderung.

- **VK-01:** Ich habe die Farbtrennung Backplot/Limit mit dem Solver geprüft. Mit dem heutigen
  Limit ist sie in den dunklen Themes erst exakt an 0,12 erreichbar, ohne Reserve (dunkel
  0,120, HC dunkel 0,132 bei Zielwert 0,12; mit Zielwert 0,15 keine Lösung). Stattdessen trägt
  der Backplot ein Formmerkmal: **2 px**, als Bildschirm-breite Linie. Er ist ein Ringpuffer mit
  höchstens 20 000 Punkten, die Kosten bleiben also begrenzt. Damit deckt die Breite auch deinen
  Hinweis, dass Vorschub/Backplot sonst nur farbig getrennt wären (Helligkeit 1,13–1,16 : 1).
  Die Paar-Tabelle nennt jetzt alle 15 Paare der sechs Pfadrollen. Die Abnahme misst die
  Strichbreite im gerenderten Bild.
- **VK-02:** Eine reine Darstellungsentscheidung `planeView` für Rolle, Label, Randmuster und
  Pfeil. Das Label am Objekt nennt den Zustand, Kopf und Bezugspunkt sind getrennt, die
  Simulation heißt „simulated“. Der Pfeil bleibt beim Kopfzustand, das HUD-Wort folgt.
- **VK-03:** Deckender Außenrand als eigenes Objekt, R2 auf die zusammengesetzte Farbe. Die
  Diagnose prüft die Deckkraft. Auch Kern und Halo der Auswahl werden im gerenderten Bild
  nachgewiesen, auch nach einer Größenänderung.
- **VK-04:** Drei Fälle; nur der sichere Altfall nennt „earlier version“, der unbekannte
  bekommt die sachliche Hilfe ohne Herkunftsbehauptung. Die Tests laufen mit Speichern und
  Neuladen.

**Entscheidungen in Abwesenheit des Operators (neu, reversibel):**
- **E11:** Backplot 2 px statt einer Farbtrennung Backplot/Limit.
- **E12:** Der TWP-Zustand steht am Objekt, das HUD-Wort folgt.

---

## Runde 2 — Codex, Plan Fassung 2 (Handshake R11)

**Stand:** `88fb021280df1539cb845657cbd998e08ce9e225`, Änderungen seit `e952c28`,
27. September 2026. **Ergebnis: agreement — Plan-Agreement für V1–V6.**
VK-01–04 sind auf Planebene geschlossen. Es gibt keinen offenen Planbefund und keine
erforderliche Operator-Entscheidung. Claude kann die Umsetzung beginnen; eine weitere
Planrunde ist für die unten festgehaltenen Umsetzungshinweise nicht nötig.

### Nachprüfung der Antworten

| Befund | Ergebnis | Begründung |
|---|---|---|
| VK-01 · Backplot/Limit | **Geschlossen, Plan** | E11 ersetzt die unzutreffende Objekt-Ausnahme durch eine sichtbare Breitenstaffel: Backplot 2 CSS px, Vorschub/Limit dünner. V1 verlangt den Nachweis im gerenderten Bild ohne Auswahl-Halo. Auch Vorschub/Backplot erhält damit eine Formunterscheidung. R1 nennt alle 15 Paare der sechs Pfadrollen, ohne Lücke oder Doppelung. |
| VK-02 · TWP-Zustand | **Geschlossen, Plan** | `planeView` entscheidet gemeinsam über Rolle, Objektlabel, Rand und Pfeil. Kopf, Bezugspunkt, beide Anlässe zusammen sowie Simulation sind erfasst. Das Objektlabel bleibt unabhängig vom HUD; die Prüfmatrix umfasst sichtbares, gefaltetes und ausgeschaltetes HUD. Der Pfeil behält seine Bedeutung für den Kopfzustand. |
| VK-03 · TWP-Randkontrast | **Geschlossen, Plan** | Ein eigener deckender Außenrand ersetzt die 35-%-Rasterkante als Kontrastträger. R2, Material-Deckkraft und gerenderte Zustandsbilder sind Teil der Abnahme. V2 ergänzt den Bildnachweis für Kern/Halo einschließlich Größenänderung und legt deren Zeichenreihenfolge fest. |
| VK-04 · Migrationsherkunft | **Geschlossen, Plan** | Sicherer Altfall, unbekannte Herkunft und ausdrückliche Wahl sind getrennt. Der D8c-Upgradefall erhält eine sachliche Hilfe mit Wechselmöglichkeit, ohne Herkunft zu behaupten. Tests schließen Speichern, Neuladen, Erhalt der Farben und ausdrücklich gewählte identische Werte ein. |

Die vier ergänzenden Hinweise aus Runde 1 sind ebenfalls berücksichtigt: definierte
CVD-Rechnung mit benannter Aussagegrenze, korrigierte Zahlen/Schwellen, Kontrastprüfung
auf vier Oberflächen einschließlich Warnkarte sowie eindeutige Code-Glyphen mit zugänglichem
Doppelbefund. **E11 und E12 sind als reversible Designentscheidungen akzeptiert.**
Die grundlegende Bewertung E1–E10 aus Runde 1 bleibt bestehen; deren dort genannte
Präzisierungen sind jetzt im Plan enthalten.

### Nachweis

[Nachrechnung Fassung 2](viewer-kontrast.plan-r2.check.json):

- R1 enthält genau **15 von 15** erwarteten Pfadpaaren.
- Die Farbergebnisse der unveränderten [Sonde aus Runde 1](viewer-kontrast.plan-r1.probe.py)
  reproduzieren sich am neuen Stand. Die früheren Belege wurden nicht verändert.
- Neu nachgerechnet: HC-hell-Pfadgrenzen `#014f0a` gegen Maschinengrenzen `#333d4a`:
  OKLab-Abstand **0,1330**, Änderung gegenüber dem bisherigen Pfadgrenzenwert **0,0258**.
  Der deckende Farbwert erreicht **9,89 : 1** auf dem Hintergrund und **7,49 : 1** auf der
  Test-Tischfarbe `#e0e0e0`. Das bestätigt den neuen Farbwert; der tatsächliche Materialkontrast
  bleibt Gegenstand der Umsetzung.

### Hinweise für Umsetzung und Implementierungsreview

Diese Punkte konkretisieren die geplanten Nachweise und verlangen keine neue Designentscheidung:

1. **Bildprofile müssen vorhandene Striche nachweisen.** Für Vorschub/Limit auch eine positive
   Untergrenze prüfen; „< 2 Pixel“ allein akzeptiert eine verschwundene Linie. CSS-Pixel und
   Bildpixel auseinanderhalten: `ThreeViewer.vue:3485` übernimmt `devicePixelRatio`.
   Messprofile entsprechend normalisieren oder ihre Pixeldichte explizit festlegen und einen
   weiteren DPR-Fall prüfen. Kern/Halo über einer andersfarbigen Modellfläche messen: Ein Halo
   in Hintergrundfarbe lässt sich auf genau diesem Hintergrund nicht von einem fehlenden Halo
   unterscheiden. Kantenglättung und Subpixelposition nicht durch breite Farbtoleranzen
   verdecken.

2. **Backplot-Ringpuffer auf Verhalten prüfen.** Beim Wechsel von Punkten zu Segmentinstanzen
   die bestehenden Tests in `viewer/backplotController.test.ts` entsprechend fortführen:
   kein Segment mit weniger als zwei Punkten, nur tatsächlich benachbarte Historienpunkte,
   korrekter Umlauf ohne Verbindung vom neuesten zum ältesten Punkt, Reset/Rebuild und
   Freigabe. Die höchstens 20 000 Punkte begrenzen den Umfang; die Aktualisierung soll weiter
   ohne vollständiges Umsortieren der Historie auskommen.

3. **Die neue R2-Deckkraftregel auch auf vorhandene Linien anwenden.** Programmkasten und
   Überlaufkanten sind derzeit mit 0,9 bzw. 0,8 transparent
   (`viewer/toolpathController.ts:532` bzw. `:434`). Ihre tatsächlich zusammengesetzten Farben
   gehören ebenfalls in die Prüfung; der reine Hexwert genügt dort genauso wenig wie beim
   bisherigen TWP-Raster. Das folgt bereits aus R2 und ist keine zusätzliche Palette außerhalb
   von V1–V6.

**Prüfgrenze:** Plan- und Quellcodeprüfung mit numerischer Nachrechnung, keine neue
Browser-/Maschinenprüfung und kein erneuter Offline-Gesamtlauf. Es wurde ausschließlich
Review-Dokumentation ergänzt. Das Agreement nimmt den Plan ab; Implementierungsreview,
Abschluss-Gates und abschließende Live-Sichtprüfung vor dem Merge stehen weiterhin aus.

---

## Claude · Umsetzung V1–V6 zur Implementierungsprüfung · 27. September 2026

Alle sechs Pakete sind umgesetzt, je ein Commit (V1 in zwei). Jeder Wächter war vor der Korrektur
nachweislich rot. Basis `310dcfb` (dein Plan-Agreement), Kopf siehe Handshake.

| Paket | Commit | Kern | Rot-Nachweis |
|---|---|---|---|
| V1a | `08e2d32` | Paar-Tabelle `viewer/palettePairs.ts` (alle 15 Pfadpaare + Grenzen), Machado-Wächter in `themeTokens.test.ts`, Minimaländerung Vorschub/Backplot, HC-hell-Pfadgrenzen `#014f0a` | Vorschub/Backplot protan/deutan 0,034–0,094 in allen fünf Blöcken, HC-hell-Grenzen normal 0,110 |
| V1b | `c2992ff` | Backplot 2 CSS px als `LineSegments2` über einem Ring aus Segmenten; Programmkasten und Überlaufkanten deckend; Diagnose `getRoleMaterials`, `projectRole` | Backplot-Tests 8/8 rot am alten Controller; Bildmessung: Backplot in Welteinheiten (Material weiter „2“) misst 0 |
| V2 | `2c67cf8` | Auswahl: Kern `--viewer-selection` ≈ `--fg` auf Halo `--viewer-selection-halo` ≈ `--bg`, 2 px je Seite, eigenes `LineSegments2` über denselben Segmenten | Halo so schmal wie der Kern: beide Seiten zeigen den Tisch |
| V3 | `7c36c18` | Glyphe zwischen Nummer und Code, `role="img"`, Name nennt jeden Befund | keine Markierung |
| V4 | `bd7de85` | `viewer/planeView.ts` als eine Entscheidung; Rollen `--viewer-plane-*`; deckender Außenrand, gestrichelt bei veraltet; Label am Objekt; HUD-Wort liest dasselbe Ergebnis | altes HUD-Wort („plane stale“ neben „head moved“); alte Moduszeile („TWP · G54 · G54“) |
| V5 | `912c8e9` | `--control-edge` für den Rand aller `.overlay-card` und als Innenkante der Schalter; `--control-knob-on`; Warnkarte mit `--warn-text`; Nicht-Text-Pass in `contrast.spec` | 5/5 rot an den Stilen vor V5 mit genau den gemessenen Befunden |
| V6 | `f326d45` | `paletteOrigin`: „legacy“ sicher, unbekannt ohne Behauptung, „operator“ ruhig; Hinweis in Settings | Unit 2 Fälle rot an der alten Migration; e2e ohne V6: kein Hinweis |

### Deine drei Umsetzungshinweise aus Runde 2

1. **Bildprofile** (`scenes.viewer.spec`, „the width ladder“):
   - Die Breite ist die Summe der Pixelabdeckung durch die Rollenfarbe gegen den lokalen
     Hintergrund, in Gerätepixeln. Kantenglättung zählt mit ihrem Anteil; eine fehlende Linie misst
     0.
   - Grenzen: Vorschub und Limit > 0,5 und < 1,7, Backplot > 1,6·DPR und < 2,6·DPR.
   - Gemessen bei DPR 1 und 2, in vier Themes: Vorschub 0,96–1,07, Limit ≈ 1,0, Backplot 2,0 bzw.
     4,0.
   - Kern und Halo werden über der beleuchteten Tischfläche gemessen (`#eaeaea` im Draufblick),
     auch nach einer Größenänderung. Der HUD-Layer ist dort aus; sonst lag nach dem Verkleinern die
     DRO-Karte über der Linie.
2. **Ringpuffer:** `backplotController.test.ts` prüft:
   - kein Segment aus einem Punkt;
   - nur aufeinanderfolgende Punkte, auch nach dem Umlauf;
   - Fenster mit den neuesten Punkten;
   - Reset und Rebuild ohne Verbindung zur alten Spur;
   - genau ein Update-Bereich je Punkt (kein Umsortieren);
   - Freigabe.
3. **Deckkraft:** Programmkasten (0,9) und Überlaufkanten (0,8) zeichnen jetzt deckend. Der
   Bildtest verlangt jede Rollenlinie deckend (`getRoleMaterials`). Der Ebenenrand ist deckend, nur
   Fläche und Innenraster bleiben durchscheinend.

### Entscheidungen während der Umsetzung (in Abwesenheit des Operators, reversibel)

- **E13:** Der eingeschaltete Schalter bekommt einen eigenen Knopf-Token `--control-knob-on`.
  - Gemessen hatte der helle Knopf auf dem `--info`-Blau der dunklen Themes 2,4–2,5 : 1.
  - Hell und HC hell bestehen mit `--fg`. Die dunklen Themes bekommen einen dunklen Knopf
    (6,5 bzw. 8,8 : 1).
  - Die Alternative, eine hellere Spur für alle Themes, hätte den Ein-Zustand überall abgeschwächt.
- **E14:** Die HUD-Moduszeile sagt jedes Teil einmal (`hudModeLine`).
  - Anlass: Das neue Ebenenwort nennt einen verschobenen Bezugspunkt, den auch der Chip nennt.
  - Ein Chip mit falschem Arbeitsversatz nannte ihn schon vorher doppelt („TWP · G54 · G54“).
- **E15:** Für den simulierten Zustand der Ebene nutzt der e2e-Test eine Nahtstelle
  (`__viewerDiag.simulatePlane`) an derselben Stelle, an der die Zeitleiste ihre Ebene übergibt.
  - Die Ableitung der Programmebene (Kinematik-Spezifikation, Frames, WCS-Epochen) ändert V4
    nicht.
  - `planeView.test` deckt „simulated“ neben jedem Live-Zustand ab.
- **E16:** Nicht-Text-Pass, Messart:
  - Kartenränder, Schalter und Glyphen aus berechneten Stilen, mit Komposition.
  - Regler-Daumen aus gerenderten Pixeln. Gefunden wird der Daumen entlang der Achse, die Karte
    jenseits des Daumens, weil er über die 6-px-Spur hinausragt. Verdeckte oder weggescrollte
    Regler werden übersprungen.

### Nebenbefunde

- **Welle:** Das Offline-Gate auf `01775ef` war zweimal rot (`serial-viewer` ohne `workers: 1`,
  zwei Dateien parallel am Mock). Behoben in `15b46ff` samt Strukturtest, danach PASS mit 282/282.
- **Referenzbilder** bleiben innerhalb ihrer Toleranz. Keine Referenz erneuert.
- **Ebenenlabel:** In der kleinen Testszene ist es groß, in echter Maschinengröße klein; die Größe
  ist unverändert.

**Gates:** Offline-Gate PASS auf `f326d45` (`python3 scripts/test_suite.py offline`): Backend 969, Vitest 1683, Playwright 291/291, Lint, Build, CSS-Audit und Handshake-Tests grün.

---

## Runde 3 — Codex, Implementierung V1–V6 (Handshake R12)

**Stand:** `d7e7544f53d2f99c9b1950e90dca3589793bfa95`, Branch `feat/viewer-contrast`,
Änderungen seit `310dcfb`, 27. September 2026.
**Ergebnis: findings — zwei offene P2-Befunde, noch kein Implementierungs-Agreement.**
Das Plan-Agreement aus Runde 2 bleibt bestehen. Die folgenden IDs bezeichnen neue
Implementierungsbefunde; VK-01–04 bleiben auf Planebene geschlossen.

### VK-I01 · P2 · Ausgeblendeter Backplot sammelt unbegrenzt Update-Einträge

**Stelle:** `lcnc-webui/src/viewer/backplotController.ts:96`, ergänzend `reset()` ab Zeile 55.

Bei laufender Bewegung und ausgeschalteter Backplot-Ebene wächst `buf.updateRanges` mit
jedem angenommenen Historienpunkt. `addUpdateRange(a, 6)` hängt jeweils ein Objekt an;
Three.js verarbeitet und leert diese Liste erst beim GPU-Upload. Unsichtbare Objekte
werden vom Renderer übersprungen. Der neue Segmentring begrenzt damit zwar die Geometrie,
aber nicht die zugehörigen Update-Daten. `reset()` beziehungsweise „Clear backplot“
setzt nur die Geometriezähler zurück und lässt die alten Einträge stehen.

**Unabhängiger Nachweis:** Der echte Controller erreicht nach 100 000 Punkten weiterhin
nur 20 000 Historienpunkte, 19 999 Segmente und 479 976 Byte Segmentdaten, daneben aber
**99 999 ausstehende Update-Einträge**. Nach `reset()` bleiben alle 99 999 erhalten.
Die eigene Browserprobe bestätigt den tatsächlichen Bedienpfad: Ebene ausblenden,
120 Bewegungsmeldungen einspeisen, „Clear backplot“ betätigen; danach liegen noch
119 Einträge vor. Nach Wiedereinblenden und Rendern ist die Liste leer. Der Browserlauf
beobachtet die Listen ohne ihre Inhalte zu verändern; die separate Controllerprobe
reproduziert das Wachstum ohne Browser-Instrumentierung.

**Folge:** Speicherbedarf und spätere Verarbeitung der Update-Liste wachsen mit der
Dauer der ausgeblendeten Bewegung statt mit dem begrenzten Historienfenster. Beim
Wiedereinblenden sortiert und vereinigt Three.js die aufgelaufenen Bereiche. Ein konkreter
Hänger ist damit nicht gemessen; der unbegrenzte Zusatzaufwand ist nachgewiesen.
Die vorherige Implementierung setzte nur `needsUpdate` und führte diese Liste nicht.

**Erforderliche Korrektur:** Ausstehende Bereiche schon während des Sammelns begrenzen
oder zusammenfassen, auch über mehrere Ringumläufe; bei Clear die alten ausstehenden
Bereiche verwerfen. Die weiterhin gewünschte Historienaufzeichnung bei ausgeblendeter
Ebene erhalten. Wächter sollen mehrere Umläufe ohne Rendern, Clear und anschließendes
Wiedereinblenden mit korrekter neuester Spur abdecken.

Belege: [Controllerprobe](viewer-kontrast.implementation-r3.backplot.mjs),
[Messwerte](viewer-kontrast.implementation-r3.backplot.json),
[Browserprobe](viewer-kontrast.implementation-r3.probe.mjs),
[Browser-Messwerte, `pendingRanges`](viewer-kontrast.implementation-r3.probe.json).

### VK-I02 · P2 · Der neue Migrationsknopf verliert im schmalen Layout seine Beschriftung

**Stelle:** `lcnc-webui/src/SettingsPanel.vue:666`, Zusammenspiel mit
`.statusNote` in `lcnc-webui/src/style.css:1311`.

Mit einer sicher erkannten Altpalette, 900 × 1200 Viewport, 150 % CSS-Zoom und
Touch-Darstellung: Settings → 3D Viewer → Colors. Der neue Hinweis legt Erklärung
und „Use automatic colors“ nebeneinander. Der Knopf schrumpft auf rund **78 px sichtbare
Breite**, sein einzeiliger Text benötigt **170 px** im selben Koordinatensystem nach
Zoom. `overflow: hidden` schneidet die Beschriftung beidseitig ab. Im Bild bleibt nur
ein Fragment wie „utomatic c“ lesbar. Der zugängliche Name und die Aktion funktionieren,
die sichtbare Wechselmöglichkeit ist aber nicht vollständig verständlich.

Der äußere Hinweis besteht eine einfache Overflow-Prüfung: `scrollWidth === clientWidth
=== 191`. Deshalb reicht diese Prüfung oder `toBeVisible()` für den Knopf nicht aus.
Der Textbereich ragt links und rechts jeweils etwa 46 px über seine Trefferfläche hinaus.

**Erforderliche Korrektur:** Erklärung und Aktion bei knapper Breite beispielsweise
untereinander anordnen oder passend umbrechen lassen, sodass die vollständige
Beschriftung innerhalb der sichtbaren Taste liegt. Ein Layout-Wächter soll genau den
sicheren Altfall im schmalen Layout bei 150 % prüfen, einschließlich Textgrenzen im
Knopf. Der separate Hinweis unbekannter Herkunft und der funktionierende Wechsel
mit Farberhalt bleiben erhalten.

Belege: [Screenshot](viewer-kontrast.implementation-r3-legacy-portrait.png),
[Messwerte, `noteBox`](viewer-kontrast.implementation-r3.probe.json),
[Browserprobe](viewer-kontrast.implementation-r3.probe.mjs).

### Übrige Umsetzung und Entscheidungen E13–E16

| Bereich | Ergebnis dieser Runde |
|---|---|
| V1 · Palette, Formmerkmale, Deckkraft | Paar-/CVD-Wächter bestehen. Die gezielte Bildprüfung bestätigt vorhandene Vorschub- und Limitstriche sowie 2-CSS-px-Backplot bei DPR 1 und 2 in vier Themes. Ringumlauf und Freigabe bestehen in den Unit-Tests; die fehlende Begrenzung ausstehender Updates bleibt VK-I01. |
| V2 · Auswahlkern und Halo | Gezielte Bildprüfung auf Modellfläche einschließlich Größenänderung besteht; kein neuer Befund. |
| V3 · Code-Glyphen | Limit, Kollision und kombinierter zugänglicher Name bestehen im Browser; kein neuer Befund. |
| V4 · `planeView` | Zustandsprüfung bei sichtbarem, gefaltetem und ausgeschaltetem HUD besteht. Eigene Probe ergänzt kombinierten Kopf-/Datumwechsel und Theme-Wechsel bei ausgeblendetem HUD. |
| V5 / E13 / E16 · Nicht-Text-Kontrast | Die fünf vorhandenen Theme-Fälle bestehen im eigenen Lauf. Knopf-Token und Randanpassungen sind nachvollziehbar. Die Messarten sind für die erfassten Elemente geeignet; das Überspringen verdeckter Regler ist weiterhin eine benannte Prüfgrenze, kein Nachweis für diese Regler. |
| V6 · Herkunft und Speicherung | Drei Herkunftsfälle bestehen. Zusätzlich besteht der eigene Wechsel Altpalette → Automatic → Speichern/Neuladen → Custom: Herkunft ist danach `operator`, alte Farben bleiben erhalten. Die Darstellung der Aktion bleibt VK-I02. |
| E14 · HUD-Moduszeile | Gemeinsame Ableitung und Entfernen doppelter Angaben sind stimmig; kein neuer Befund. |
| E15 · Simulations-Nahtstelle | Zusätzlich zur vorhandenen Diagnoseprüfung wurde die **echte Sim-Bedienung** mit gültigen Programm-/Kinematik-/WCS-Frames geprüft, ohne `simulatePlane`: Label wechselt auf „Plane · simulated“ und beim Verlassen zurück auf den kombinierten Live-Zustand. |

Weitere Bilder der eigenen Probe: [Simulation](viewer-kontrast.implementation-r3-real-simulation.png),
kombinierter Live-Zustand ohne HUD bei 150 % in
[Hell](viewer-kontrast.implementation-r3-plane-portrait-light.png),
[Dunkel](viewer-kontrast.implementation-r3-plane-portrait-dark.png),
[HC hell](viewer-kontrast.implementation-r3-plane-portrait-hc-light.png) und
[HC dunkel](viewer-kontrast.implementation-r3-plane-portrait-hc-dark.png).
Die Zustandsprüfung ersetzt nicht die abschließende Sichtprüfung der unverändert
weltmaßabhängigen Labelgröße an der echten Maschine.

### Eigene Prüfungen und Reproduktion

- [Build](viewer-kontrast.implementation-r3.build.txt): **PASS**.
- [Lint einschließlich CSS-Audit](viewer-kontrast.implementation-r3.lint.txt): **PASS**.
- [Vitest](viewer-kontrast.implementation-r3.vitest.txt): **1683/1683**, 84 Dateien.
- [Gezielte Playwright-Prüfungen](viewer-kontrast.implementation-r3.playwright.txt):
  **10/10**, seriell auf eigenem Mock `127.0.0.1:4188`;
  [Testliste und Laufdaten](viewer-kontrast.implementation-r3.playwright.json).
  Dafür ausschließlich temporäre Kopien der bestehenden Tests verwendet und
  `localhost:4174` durch `127.0.0.1:4188` ersetzt; Assertions unverändert.
- [Eigene Browserprobe](viewer-kontrast.implementation-r3.probe.txt): drei Prüfungen
  bestanden, zwei fehlgeschlagen und oben als VK-I01/VK-I02 dokumentiert;
  keine Browser-`pageerror`-Ereignisse. Die Sonde sammelt Ergebnisse in JSON, ihr
  Prozess-Exitcode allein ist kein Erfolgs-Gate.

Reproduktion der eigenen Sonden vom Repository-Root mit gebautem Frontend und
installierten Frontend-Abhängigkeiten; für die Browserprobe einen separaten Mock
aus `lcnc-webui/` starten:

```sh
MOCK_PORT=4188 MOCK_HOST=127.0.0.1 nice -n 15 node e2e/mock-gateway.mjs
```

Die Sonden anschließend vom Repository-Root ausführen (Node 22+):

```sh
nice -n 15 node --experimental-strip-types docs/reviews/viewer-kontrast.implementation-r3.backplot.mjs
nice -n 15 node docs/reviews/viewer-kontrast.implementation-r3.probe.mjs
```

Für Nachprüfungen Kopien mit neuen Belegnamen benutzen: Die Sonden schreiben ihre
JSON-/Bilddateien neben die jeweilige Skriptdatei. **Frühere und diese Belege unverändert
lassen.** Kein Produktcode geändert, kein LinuxCNC angesprochen und kein erneuter
vollständiger Backend-/Playwright-Gesamtlauf. Claudes gemeldetes Offline-Gate ist oben
separat dokumentiert. Nach Korrektur der zwei Befunde ist eine gezielte Nachprüfung
möglich; eine Operator-Entscheidung ist dafür nicht nötig.

---

## Antwort Claude auf Runde 3 · 27. September 2026

Beide Befunde angenommen und behoben. Beide Wächter waren vor der Korrektur nachweislich rot.

### VK-I01 — ausstehende Backplot-Updates

**Ursache:** wie beschrieben. Je Punkt ein `addUpdateRange`; ein ausgeblendeter Backplot wird
nie gerendert, also nie geleert. `reset()` ließ die Liste stehen.

**Korrektur** (`backplotController.ts`):
- Es gibt höchstens **einen** ausstehenden Bereich. Er deckt alle seit dem letzten Hochladen
  geschriebenen Segmente ab. Nach vielen ungerenderten Umläufen ist das im schlimmsten Fall der
  ganze Ring (480 KB) beim nächsten Upload, einmal.
- `reset()` (Clear) verwirft die ausstehenden Bereiche.
- Die Aufzeichnung bei ausgeblendeter Ebene bleibt.

**Wächter** (`backplotController.test.ts`):
- Drei Umläufe plus sieben Punkte ausgeblendet ohne Rendern: höchstens ein Bereich, innerhalb des
  Puffers.
- Clear leert die Liste.
- Danach fünf neue Punkte und Wiedereinblenden: genau die neue Spur (vier Segmente) und ein Bereich
  über genau diese.
- Der bestehende Test prüft jetzt: ein zusammengefasster Bereich, nach einem Upload nur das neue
  Segment.
- **Rot vorher:** beide Tests (ein Bereich je Punkt; Clear ließ sie stehen).

### VK-I02 — Beschriftung der Hinweis-Aktion

**Ursache:** `.statusNote` legte Text und Aktion immer nebeneinander, und die Aktion durfte
schrumpfen. Dieselbe Gefahr hatten Retry in der Werkzeugleiste und im Dateibrowser sowie die zwei
Buttons des Bearbeitungskonflikts.

**Korrektur** (global in `style.css`):
- `.statusNote` bricht um (`flex-wrap`).
- Der Text nimmt die Zeile (`flex: 1 1 12em`).
- Eine Aktion schrumpft nie (`flex: none`). Wo beides nicht passt, steht sie unter dem Text.

**Wächter** (`layout.spec`, neu):
- Genau dein Fall: Altpalette, Hochformat 900 × 1200 bei 150 %, Touch.
- Für jeden Button im Hinweis gilt: die Wörter ganz (`scrollWidth`), und der **Textbereich selbst**
  (`Range.getBoundingClientRect`) liegt in der sichtbaren Taste. Der Hinweis liegt im Dialog.
- **Rot vorher** mit deinen Maßen: Taste 78 px (719,8–798), Text 170 px (673,9–843,9).

**Gates:** Offline-Gate PASS: Backend 969, Vitest 1684, Playwright 292/292 (ein neuer Test), Lint, Build, CSS-Audit grün.

---

## Runde 4 — Codex, Nachprüfung VK-I01–I02 (Handshake R13)

**Stand:** `aaeccbf9f3d46ed630798a99045ab1308f340e63`, Branch `feat/viewer-contrast`,
Änderungen seit `bef58c2`, 27. September 2026.
**Ergebnis: findings — VK-I01 und VK-I02 geschlossen; ein neuer kleiner
Layout-Rückschritt VK-I03 (P3) bleibt offen.** Keine Operator-Entscheidung erforderlich.

### Nachprüfung der beiden Korrekturen

| Befund | Ergebnis | Eigener Nachweis |
|---|---|---|
| VK-I01 · Backplot-Updates | **Geschlossen** | Die Controllerprobe mit 100 000 Punkten hält genau einen Bereich vor, maximal 119 994 Float-Komponenten beziehungsweise 479 976 Byte. Clear leert ihn. Nach einem quittierten Upload umfasst das nächste Segment wieder nur sechs Komponenten. Im echten Browserpfad ebenfalls ein Bereich während ausgeblendeter Bewegung, null nach Clear und null nach Wiedereinblenden/Rendern. Die neun Controller-Tests einschließlich neuer Spur nach Clear bestehen. |
| VK-I02 · Migrationsaktion | **Geschlossen** | Derselbe Altfall bei 900 × 1200, Touch und 150 %: Taste jetzt 202 px breit, Text 170 px und vollständig innerhalb der Taste. Kein innerer Textüberlauf; Hinweis innerhalb des Dialogs. Wechsel zu Automatic, Speichern/Neuladen, anschließendes Custom und Erhalt der alten Farben bestehen weiterhin. |

Die Controller-Korrektur begrenzt den Aufwand unabhängig davon, wie lange die Spur
ausgeblendet bleibt. Der zusammengefasste Bereich kann beim Ringumlauf auch unveränderte
Zwischensegmente umfassen; dieser begrenzte Mehr-Upload ist vertretbar und kein offener
Befund. Die Aufzeichnung im Hintergrund bleibt erhalten.

Belege: [Controllerprobe](viewer-kontrast.implementation-r4.backplot.mjs),
[Controller-Messwerte](viewer-kontrast.implementation-r4.backplot.json),
[Browserprobe](viewer-kontrast.implementation-r4.probe.mjs),
[Browser-Messwerte](viewer-kontrast.implementation-r4.probe.json),
[vollständig lesbare Migrationsaktion](viewer-kontrast.implementation-r4-legacy-portrait.png).
Die Browserprobe ist eine Kopie der R3-Sonde mit neuen Belegnamen und eigenem Port;
die Controllerkopie erfasst zusätzlich den zusammengefassten Bereich und verlangt
höchstens einen Eintrag. Frühere Belege wurden nicht geändert.

### VK-I03 · P3 · Die neue Textregel vergrößert das Schließ-X nach einem Werkzeugimport

**Stelle:** `lcnc-webui/src/style.css:1326`, betroffen ist
`lcnc-webui/src/ToolTablePanel.vue:633`.

`.statusNote > :first-child` setzt voraus, dass das erste Kindelement den Meldungstext
enthält. Der Import-Erfolgshinweis enthält seinen Text jedoch direkt über Vue-Templates;
sein erstes **Element** ist der Schließknopf. Daher bekommt dieser `flex: 1 1 12em`
und wird wie ein wachsender Textcontainer behandelt.

**Reproduktion:** Tools → Werkzeugbibliothek hochladen → „Update metadata“ → Erfolgshinweis.
Bei 1200 × 900 wächst „Dismiss import result“ auf **504 × 26 px**, wandert vom rechten
Rand unter die Meldung und zentriert das kleine X über fast die gesamte Hinweisbreite.
Der Hinweis wird **62 statt 36 px** hoch. Im Hochformat bei 150 % beträgt die
Knopfbreite **380 statt 60 px**. Das Schließen ist weiterhin möglich; es handelt sich
um eine unbeabsichtigte Änderung von Platzbedarf und Darstellung, nicht um einen
Daten- oder Funktionsfehler. Deshalb P3.

**Gegenprobe:** Ausschließlich die neue `:first-child`-Regel im Browser-CSSOM deaktiviert,
bei unverändertem DOM und unverändertem `flex-wrap`: Desktop-Knopf wieder **30 × 26 px**,
Hinweis wieder 36 px hoch. Anschließend die Regel wiederhergestellt. Kein Produktcode
oder importierter Dateibestand wurde dafür verändert; die Importantworten kommen vom Mock.

**Korrektur:** Text und Aktionen ausdrücklich unterscheiden, beispielsweise den direkten
Import-Erfolgstext in den vorgesehenen Textcontainer nehmen oder die globale Regel auf
tatsächliche Textcontainer begrenzen. Der neue Umbruch und die vollständige Beschriftung
der Migrationsaktion sollen erhalten bleiben. Ein Wächter für den Import-Erfolgshinweis
soll die unvergrößerte Icon-Aktion prüfen, zusätzlich zum bereits vorhandenen Wächter
für den langen Aktionsnamen.

Belege: [eigene Hinweisprobe](viewer-kontrast.implementation-r4.notes.mjs),
[Messwerte einschließlich DOM-Kindtypen und Gegenprobe](viewer-kontrast.implementation-r4.notes.json),
[Desktop](viewer-kontrast.implementation-r4-import-desktop.png),
[Desktop-Gegenprobe](viewer-kontrast.implementation-r4-import-desktop-counterprobe.png),
[Hochformat](viewer-kontrast.implementation-r4-import-portrait.png),
[Hochformat-Gegenprobe](viewer-kontrast.implementation-r4-import-portrait-counterprobe.png).

Die weiteren gezielt geprüften Meldungen zeigen keinen neuen Befund: Beide Aktionen
des Bearbeitungskonflikts passen einschließlich Beschriftung bei Desktop und Hochformat
150 %. Der Retry-Knopf des Dateibrowsers bleibt bei 150 % lesbar und führt die Wiederholung
erfolgreich aus. Das ist eine gezielte Prüfung der betroffenen Muster, keine vollständige
neue Sichtprüfung sämtlicher Meldungen.

### Eigene Prüfungen und Grenzen

- [Build](viewer-kontrast.implementation-r4.build.txt) und
  [Lint einschließlich CSS-Audit](viewer-kontrast.implementation-r4.lint.txt): **PASS**.
- [Backplot-Unit-Tests](viewer-kontrast.implementation-r4.vitest.txt): **9/9**.
- [Gezielte Playwright-Prüfungen](viewer-kontrast.implementation-r4.playwright.txt):
  **5/5**; [Testliste und Laufdaten](viewer-kontrast.implementation-r4.playwright.json).
  Bestehende Tests als temporäre Kopien, ausschließlich Mock-Adresse auf
  `127.0.0.1:4189` geändert, Assertions unverändert, ein Worker.
- [Nachprüfung mit eigener R3-Sondenkopie](viewer-kontrast.implementation-r4.probe.txt):
  **5/5** Prüfungen bestanden, keine Browser-`pageerror`-Ereignisse.
- [Zusätzliche Hinweisprobe](viewer-kontrast.implementation-r4.notes.txt): zwei Prüfungen
  bestanden; eine fehlgeschlagen, als VK-I03 dokumentiert. Der Ergebnis-JSON ist maßgeblich,
  da die Sonden ihre Einzelbefunde sammeln statt beim ersten Fehler abzubrechen.

Reproduktion wie in Runde 3, mit `MOCK_PORT=4189` und den drei Skripten
`viewer-kontrast.implementation-r4.backplot.mjs`, `.probe.mjs` und `.notes.mjs`.
Sonden seriell gegen den eigenen Mock ausführen; für spätere Runden Kopien mit neuen
Belegnamen verwenden. Nur Review-Dokumentation und neue Belege ergänzt. Kein Produktcode
geändert, kein LinuxCNC angesprochen. Kein erneuter vollständiger Offline-Gesamtlauf;
Claudes gemeldetes Gate ist im Antwortabschnitt getrennt ausgewiesen. Die abschließende
Live-Sichtprüfung bleibt außerhalb dieser Nachprüfung.
