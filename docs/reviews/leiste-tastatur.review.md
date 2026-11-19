# Leiste und Tastatur · Plan für zwei Wünsche des Operators

Review-Datei vom 19. November 2026. Basis ist development `5c48a7e1` (CI grün, 44455146016).

---

## Claude · Planvorschlag · Anfrage R405 · 19. November 2026

### Auftrag des Operators

Zwei Wünsche vom 16. November, am 19. November freigegeben: „können wir schon die Tastaturanpassung und die Aktionsleistenverbesserungen angehen? Implementierung und Merge kann auch nach dem Maschinentag stattfinden. Aber dann ist es schonmal bereit.“

- **Paket S, Leiste:** „zum Überlaufen der Aktionsleiste … zumindest bis 3 Achsen sollten wir uns überlegen, wie wir das ohne Überlaufen hinkriegen.“ Die Maschine des Operators hat 3 Achsen und einen Full-HD-Touchschirm im Querformat. Das Paket betrifft also die Maschine und kommt zuerst.
- **Paket K, Tastatur:** „im Portrait-Modus verwendet die Tastatur und das Keypad nicht die Breite des Action Strips richtig? Können wir die Buttons gleichmäßig in der Breite anpassen, damit das etwas besser aussieht.“

**Ablauf:**
- Zwei Zweige von development: `feat/strip-fit` und, sobald S steht, `feat/portrait-keys`.
- Je Zweig ein Round-Gate und eine Codex-Runde.
- Gemergt wird erst nach dem Maschinentag, es sei denn, der Operator will S vorher. Das Merge-Go der Reihe „vor der Maschine“ gilt hier **nicht**; ich frage ihn vor jedem Merge.

**Erbeten:** `agreement` zum Plan, gern mit Änderungen, oder `findings`. Die Fragen an den Operator stehen unten; ich stelle sie ihm.

### Gemessen an `5c48a7e1`

Messproben: [Leiste](leiste-tastatur.plan.probe-leiste.spec.ts), [Werkzeug](leiste-tastatur.plan.probe-werkzeug.spec.ts), [Tasten](leiste-tastatur.plan.probe-tasten.spec.ts). Alle Zahlen stehen in der [Messung](leiste-tastatur.plan.messung.json). Gemessen wurde im Playwright-Chromium und im angehefteten Firefox 160, beide auf der VM (aarch64). Werte in CSS-px.

**1920 × 1080, Touch-Größen, 3 Achsen.** Die Leiste ist 1902 px breit (innen).

| | Überlauf | Safety | Jog | Setup | Overrides | Spindle | Tool |
|---|---:|---:|---:|---:|---:|---:|---:|
| Chromium | **29** | 280 | 522,5 | 367 | 192 | 233 | 280 |
| Chromium, Lauf oder Pause | **30** | 280 | 523,5 | 367 | 192 | 233 | 280 |
| Chromium, Zoll | **32**, im Lauf **33** | 280 | 525,5 | 367 | 192 | 233 | 280 |
| Firefox 160 | **11**, Zoll 12 | 280 | 522,3 | 360,9 | 184,9 | 228,9 | 280 |

- **Die beiden Browser liegen 18 px auseinander**, bei gleichem CSS. Die textbreiten Teile (Setup, Overrides, Spindle) sind in Chromium breiter. Das Budget ist also ein Ergebnis der Schrift. Wie das Chromium und der Firefox ESR am Maschinen-PC messen, weiß ich nicht. Darum kommt ein Messschritt auf die Checkliste des Maschinentags (S6).
- **Sonst ändert kein Zustand eine Breite:** homed, unhomed, disarmed, aus, E-Stop, Lauf, Pause, Jog vor dem Homen, Spindel-Vorwahl, Werkzeug geladen in jedem Offset-Zustand, Fehlernotiz der Werkzeugtabelle. Zwei Ausnahmen:
  - **Lauf und Pause: Jog +1 px.** Die gewählte Option einer Auswahlgruppe ist halbfett (`.choice.checked`). „Auto“ halbfett ist 1 px breiter als „Manual“ halbfett, und die Mode-Zeile bestimmt die Breite der Spalte. Das ist ein Klassenfehler: Jede Auswahlgruppe ändert ihre Breite mit der Wahl.
  - **Zoll: Jog +3 px.** In Zoll ist der Schritt ein `select`. Seine eigene Breite bestimmt die Spalte mit.
- **Am Ende der Leiste stehen 8 px mehr als nötig.** Die Summe der Abschnitte, Lücken und Ränder ist 1922,5 px, `scrollWidth` aber 1931. Die Differenz ist die Flex-Lücke vor dem null breiten, klebenden `.stripFade`.
- **Desktop-Größen bei 1920 px:** Bis zur ersten Berührung zeigt auch der Maschinen-PC sie. Aus 1600 px gerechnet laufen sie 20 px über; die Overrides sind dort 183 px breit. Gemessen wird das erst der Wächter (S5).
- **Mehr Achsen laufen weiter über:** XYZAC 264 px, TWP 426 px. Das bleibt, wie vom Operator gesagt.
- **Tool lässt sich nicht einfach schmaler machen.** Die breiteste Zeile ist „Z Offset −1234.5670 mm · Other offset“: 244 von 255 px in Chromium, 241 in Firefox.
- **Bestehender Fehler, gefunden beim Messen:** Eine lange Fehlernotiz der Werkzeugtabelle schiebt die Werkzeugdaten im festen Abschnitt nach unten. Type ist dann abgeschnitten, Description weg ([Bild](leiste-tastatur.plan.vorher-fehlernotiz.png)).

**Hochformat, 900 × 1200, Touch.** Die Leistenspalte ist 280 px breit und innen 252 px. Die Tasten beider Helfer sind 5 × 44 px plus 4 × 4 px = 236 px breit. Rechts bleiben 16 px leer, sichtbar als Versatz gegen die Safety- und Setup-Zeilen darüber ([Ziffern](leiste-tastatur.plan.k-ziffern-vorher-nachher.png), [Tastatur](leiste-tastatur.plan.k-tastatur-vorher-nachher.png), je links vorher).

### Paket S · Die Leiste passt bis 3 Achsen

**S1 · Keine Lücke vor der Ausblendung.** `.stripFade` hebt die Flex-Lücke vor sich mit einem negativen Rand in Höhe des Tokens auf. Gewinn 8 px. Zu prüfen ist, dass die Ausblendung bei Überlauf weiter an der rechten Kante sitzt; beim XYZAC-Profil läuft die Leiste weiterhin über.

**S2 · Eine gewählte Option behält ihre Breite** (Klasse, alle Auswahlgruppen). Jede Option reserviert ihre halbfette Breite mit einem unsichtbaren, null hohen `::after` aus `data-label`. Für die Messzeilen des Schritts gilt dasselbe.
- Kosten: Jog +1 px, Setup +2 px (WCS), dafür in keinem Zustand mehr eine Änderung.
- Dazu ein Wächter: Jeder Abschnitt ist in jedem Zustand gleich breit.

**S3 · Der Schritt-`select` bestimmt die Spalte nicht.** Er füllt die Breite, die die Mode-Zeile setzt, wie das Raster des Schritts (`width: 0; min-width: 100%`).

**S4 · Der eigentliche Schnitt: Variante A oder B.** Der Operator wählt; ich empfehle A. Mit S1 bis S3 ergeben beide Prototypen gleich viel Luft ([Skript](leiste-tastatur.plan.prototyp-s.py), [Bildprobe](leiste-tastatur.plan.prototyp-s-bild.spec.ts)):

| | Chromium | Firefox 160 |
|---|---:|---:|
| vorher, frei bis zur Kante | −11 (Überlauf 29) | 6 (Überlauf 11) |
| Variante A | **42** | **59** |
| Variante B | **42** | **59** |

Die Zahlen sind gemessen bis zur äußeren Kante der Leiste; davon gehen 8 px Rand und 1 px Linie ab. Homed und Lauf sind gleich breit. Bei passender Leiste zeichnet Chromium keine leere Scroll-Spur; ein ständig reservierter Platz bleibt.

- **Variante A · Tool kompakter** ([Chromium](leiste-tastatur.plan.variante-a-chromium.png), [Firefox](leiste-tastatur.plan.variante-a-firefox.png), [vorher](leiste-tastatur.plan.vorher-chromium.png)):
  - Der Offset-Zustand bekommt eine eigene Zeile, **„In effect“**: G43, G43.1, Off (G49) oder Other offset, ohne Aussage „—“; die Warnfarbe bleibt.
  - Die Zeile „Z Offset“ zeigt nur noch die Zahl. Die breiteste Zeile ist dann „Z Offset −1234.5670 inch“ mit etwa 176 px.
  - Tool bekommt im Querformat ein eigenes Token, `--strip-tool-w` 224 px, also −56 px. `--strip-fixed-w` bleibt für Safety und die Hochformat-Spalte, an der Paket K hängt.
  - Der Abschnitt hat dann 7 statt 6 Zeilen. Im Touch-Budget von 264 px passen sie (Bild).
  - Nur dieser eine, rein lesende Abschnitt ändert sich. Jede Schaltfläche und jeder Abstand bleibt.
- **Variante B · Engere Abstände** ([Chromium](leiste-tastatur.plan.variante-b-chromium.png)):
  - Die Trenner zwischen den Abschnitten werden 4 | 4 statt 8 | 8 px (−40).
  - Die Gruppenabstände in Jog, Setup und Overrides werden 8 statt 12 px (−24).
  - Tool bleibt 280 px. Das ändert den Rhythmus der ganzen Leiste.
- **Warum A:** B nimmt allen Abschnitten Luft, damit ein rein lesender Abschnitt seine Breite behält. A nimmt sie genau dort, und die Offset-Aussage steht dann für sich statt hinter einem Mittelpunkt. Für A spricht auch die Reserve: Falls die Maschine mehr braucht, kann B später einzeln dazukommen.

**S4a · Die Fehlernotiz verdeckt nichts mehr** (der bestehende Fehler oben). Der Bereich mit den Werkzeugdaten scrollt im festen Abschnitt (`.scroll-thin`). Der Wächter verlangt: Jede Zeile ist erreichbar und nichts seitlich abgeschnitten.

**S5 · Wächter** in `layout.spec`, für das 3-Achs-Profil:
- **Ansichten:** `touch-fullhd` (1920 × 1080), `touch-fullhd-window` (1920 × 940) und neu `fullhd-desktop` (1920 × 1080, Desktop-Größen vor der ersten Berührung).
- **Zustände:** jeder `LayoutState`, die Leistenzustände `joint-jog`, `spindle-preselect`, die Banner, Werkzeug geladen in jedem Offset-Zustand mit den längsten Werten, die Fehlernotiz, Zoll.
- **Verlangt wird:**
  - kein Überlauf, und mindestens **24 px** frei zwischen dem letzten Abschnitt und der Inhaltskante;
  - jeder Abschnitt in allen Zuständen einer Ansicht gleich breit;
  - kein Bedienelement und keine Tool-Zeile seitlich abgeschnitten (`scrollWidth ≤ clientWidth`).
- **Firefox:** derselbe Test in `firefox-core.json` (homed, Lauf, Werkzeug „Other offset“, Zoll).
- **Rot zuerst** an `5c48a7e1`: der Überlauf, die Zustandsbreite, die Fehlernotiz.
- **Nicht abgedeckt, benannt:**
  - andere Achszahlen (4 und mehr laufen weiter über);
  - 150 % Zoom;
  - die Schrift-Einstellungen des Maschinen-PCs, siehe S6.

**S6 · Kalibrierung am Maschinentag** (neuer Schritt auf der Checkliste). In beiden Browsern am Maschinen-PC, mit dem dann laufenden Stand:
- `strip.scrollWidth − clientWidth` und die sechs Abschnittsbreiten, über eine Zeile in der Konsole, die ich in die Checkliste schreibe;
- dazu die Fensterbreite.

Liegt der Maschinen-PC breiter als die VM, wird die Reserve von 24 px vor dem Merge daran angepasst.

**S7 · Dokumentation:**
- `CLAUDE.md`: die Zeile zur Leiste und `ToolStrip.vue`;
- `ui-patterns.md`: eine gewählte Option behält ihre Breite;
- `decisions.md`: das Tool-Token neben `--strip-fixed-w`, die neue Zeile „In effect“ und die Reserve.

### Paket K · Gleich breite Tasten im Hochformat

**K1 · Spuren.** Im Hochformat nutzen beide Helfer `repeat(5, minmax(var(--key-size), 1fr))`:
- das Ziffernfeld (`.nkGrid`);
- alle vier Raster der Tastatur (Seiten, Aktionen, Navigation, Inhalt), damit sie dieselben Spalten teilen.

Die Zeilen bleiben `--key-size` hoch, wegen des Höhenbudgets bei 150 %. Das Querformat bleibt unverändert. Die Breite der Spalte hängt am Scrollbalken des Browsers; darum Bruchteile statt einer neuen Tastengröße.
- **Gemessen am Prototyp** ([Skript](leiste-tastatur.plan.prototyp-k.py)): Die Tasten gehen bis 252 statt 236 px und sind 47,2 statt 44 px breit.

**K2 · Entscheidung geändert:**
- Bisher galt „quadratische Tasten, in beiden Ausrichtungen gleich“ (`NumberKeypadStrip.vue`), und der Test hält „das X ist 44 × 44 in beiden Ausrichtungen“ fest (`input-session.spec`).
- Neu: Im Hochformat teilen sich die Tasten die Spalte zu gleichen Teilen, jede mindestens 44 px breit; das X ist eine ganze Spur. Im Querformat bleiben sie 44 × 44.
- Eintrag in `decisions.md`, die Kommentare und der Test folgen.

**K3 · Wächter**, im Hochformat bei 100 % und 150 %, für beide Helfer und jede Seite der Tastatur:
- Die Tasten einer Spalte teilen x und Breite.
- Die rechte Kante der äußersten Taste liegt auf der Inhaltskante des Helfers (±0,5 px).
- Jede Taste ist mindestens 44 px breit.

Die bestehenden Prüfungen bleiben: 44 px im Querformat, das X oben rechts, kein Überlauf und erreichbar ohne Scrollen.
- **Unter einem Druck bewegt sich nichts:** Der Kasten des Helfers war schon 252 px breit. `helperPlace` misst ihn unverändert; nur die Tasten darin werden breiter.

### Fragen an den Operator

- **Q405-1:** Variante A (Tool kompakter, eigene Zeile „In effect“) oder B (engere Abstände)? Empfohlen ist A.
- **Q405-2:** Paket S schon vor dem Maschinentag mergen, oder wie geplant danach?

### Erbeten

`agreement` oder `findings` zum Plan, Basis `5c48a7e1`. Noch kein Code; die Prototypen sind Skripte, nicht eingecheckt.
