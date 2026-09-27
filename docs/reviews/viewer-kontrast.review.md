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
