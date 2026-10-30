# Scrub-Bar: Geschwindigkeit, Prüfstand als Zahl, sichtbare Zeitleiste, Sim-Tab-Link

**Fassung 1 · 29. Oktober 2026 · Implementierungs-Review durch Codex, Verhandlung mit Claude ·
Branch `feat/scrub-bar` (Worktree `~/lcnc-suite-scrub`), Basis `729a7f4a`, Stand `1b532a3a`.**
Anfrage R228.

## Anlass

Der Operator, 29. Oktober, aus dem Gebrauch der Simulation:

> die scrub bar der simulation: ich denke wir brauchen den speed selector neben dem play button.
> sonst macht er einfach keinen sinn. dann den ladebalken über der scrubbar. diesen sollten wir
> entfernen. dafür gibt es recht von der bar wieder die prozentanzeige. ausserdem erkennt man die
> leere scrub bar einfach nicht. ich weiss nicht ob der balken einen leichten grauton hat. falls
> ja, der kontrast ist einfach zu schwach. entweder eine outline oder wir brauchen eine andere
> farbe. ausserdem wäre ein shortcut link zum sim tab sinnvoll

Das fällt unter den Feature-Stopp der Simulation vom 25. Oktober. Der Wunsch kommt aus dem echten
Gebrauch; die Ausnahme ist in `docs/decisions.md` (29. Oktober) begründet.

## Befund (gemessen)

- Die Zeitleiste war das gemeinsame `--range-track` (Panel 90 % + Text): **1,22 : 1** gegen die
  Overlay-Karte, außerhalb der Simulation zusätzlich auf 40 % gedimmt: **1,08 : 1**. Für das, was ein
  Bedienelement erkennbar macht, gilt bei uns 3 : 1.
- Ein 1-px-Rand in `--control-edge` hätte 3,94 / 3,30 : 1 erreicht, eine Füllung aus halb Panel,
  halb Text 3,02 / 4,10 : 1 (hell / dunkel).

## Entscheidungen des Operators (29. Oktober, aus Renderings von vier Vorschlägen)

1. **Die Füllung** (Vorschlag B), nicht der Rand.
2. Der Link als „Quadrat mit Pfeil in der rechten oberen Ecke“ (`SquareArrowOutUpRight`).
3. Geschwindigkeit neben Play, Prozent statt Band, Link: wie vorgeschlagen.
4. Offen und nicht Teil dieser Fassung: ob der Sim-Tab seine eigene Geschwindigkeitsauswahl behält.
   Bis dahin zeigen beide denselben Wert (`simView.speed`).

## Umsetzung (`729a7f4a..1b532a3a`)

- **Geschwindigkeit:** `MachineSelect gate="simSpeed"` direkt nach Play, `v-model` auf
  `simView.speed` (der Sim-Tab liest denselben Wert). Optionen mit `v-memo` (select-writes).
- **Prüfstand als Zahl:** Das Band über der Spur ist entfernt. In einem festen Platz (`.checkSlot`,
  5 ch) steht `pctOf(sweptFrac)`, solange die Prüfung `checking`, `paused` oder `partial` ist; ist die
  Route abgedeckt, ist der Platz leer.
  - Es ist die Abdeckung des **angezeigten** Ergebnisses, also `sweptFrac` wie beim Band zuvor, nicht
    `sweepView.frac`. Läuft hinter einem vorläufigen Ergebnis die volle Prüfung, zeigt der Sim-Tab
    deren Fortschritt, die Leiste das „stopped at 75 %“ des vorläufigen (R116 VP-I68). Mein erster
    Entwurf las `sweepView.frac` und zeigte dort 69 %; `collisions.viewer.spec` hat das gefunden.
- **Zeitleiste:** neues Token `--scrub-track: color-mix(in oklab, var(--panel) 50%, var(--fg))`
  (einmal in `:root`, abgeleitet, also in jedem Theme). Nicht mehr gedimmt: Gesperrtsein zeigen der
  Daumen und Play.
- **Link:** `MachineBtn type="scrub"` mit `SquareArrowOutUpRight`, `aria-label`/`title` „Open the
  Sim tab“, Event `open-sim-tab` → ThreeViewer → App `requestTab('sim')`. Beide neuen Bedienelemente
  stehen im `controlInventory`.
- **Schmal:** Mit den zusätzlichen Elementen blieben der Zeitleiste im Hochformat ~90 px.
  - Unter 620 px Breite der Leiste gibt es **zwei Zeilen**: oben Sim, Play, die Geschwindigkeit und
    der Link; unten die Zeitleiste, die Abdeckung und die Zeit. Eine dritte Zeile gibt es nie, und
    in der zweiten steht keine Taste.
  - Steuerung: Container-Query auf `.scrubBar`, deren Breite die untere Spalte setzt, nie ihr
    Inhalt; ein unsichtbarer Umbruch (`.rowBreak`) und `order`.
  - Die Leiste ist ein dichter Bereich (`denseArea`). Ihre zwei Symboltasten nehmen im Touch-Modus
    auch in der Breite die kompakte Untergrenze (36 px, wie die Leiste unten). So passt die erste
    Zeile bei Hochformat und 150 % mit 249 von 256 px.
  - Herkunft: Gate-Lauf 2 fiel mit sechs `layout.spec`-Fällen. Im Hochformat bei 150 % brach die
    Leiste dreizeilig um, und die DRO-Karte passte nicht mehr über die untere Spalte (TWP: sechs
    Zeilen). Mit zwei Zeilen ist die Leiste so niedrig wie die alte Zeitleistenzeile.
  - Die Schwelle 620 statt 700 px hält Touch-Querformat 1280 × 800 einzeilig (Zeitleiste ~245 px).
  - Die bisherigen `.narrowViewer`-Regeln der Leiste sind dadurch ersetzt.

## Was sich an vereinbarten Regeln ändert

- Die Geschwindigkeit nur im Sim-Tab (eine Zeile, 2026-10-05): jetzt neben Play.
- Der Fortschritt als eigene Spur über der Zeitleiste (2026-10-20): jetzt als Zahl daneben.
- Die schmale Form der Leiste: früher nach der Breite des Viewers (`.narrowViewer`, < 440 px, die Zeitleiste in eigener Zeile), jetzt nach der eigenen Breite der Leiste (< 620 px, zwei Zeilen wie oben).
- Die Leiste ist ein dichter Bereich: Ihre Bedienelemente sind kompakt (28 / 36 px Höhe).

## Wächter und Belege

- `sim-panel.viewer.spec`, vier neue Fälle:
  - Geschwindigkeit direkt nach Play mit demselben Wert wie der Sim-Tab; der Link zeigt den Sim-Tab;
    kein Band, kein Prozent bei abgeschlossener Prüfung.
  - Zeitleiste ≥ 3 : 1 gegen die Karte, hell und dunkel, in und außerhalb der Simulation, nie gedimmt.
  - Hochformat (Touch 900 × 1200): zwei Zeilen, Sim/Play/Geschwindigkeit/Link oben, Zeitleiste/Abdeckung/Zeit unten.
- Rot: alle vier gegen `729a7f4a` (`docs/reviews/scrub-bar.browser-red.txt`).
- Angepasst:
  - `collisions.viewer.spec` (VP-I68) liest das vorläufige „75 %“ in der Leiste statt des Bandes.
  - `sim-panel.viewer.spec` „the timeline“ prüft, dass es keine Fortschrittsspur mehr gibt.
  - `sim-panel.viewer.spec` „stepping …“: Die zweizeilige Form gilt genau bei 150 % im Hochformat,
    die Zeitleiste behält ≥ 120 px.
  - `select-writes.spec` beobachtet beide Geschwindigkeitsauswahlen getrennt (gleicher Name) und
    wählt die des Sim-Tabs über `name`.
- Frontend-Gate: Lauf 3 PASS auf `78a5773a`: Lint, Build, 2630 Unit-Tests, 612/612 Browser (`docs/reviews/scrub-bar.gate-frontend.run3.json`). Lauf 1 (`ab7a2044`) fiel an `select-writes.spec` (zwei Auswahlen gleichen Namens), Lauf 2 (`5abc58d9`) an sechs `layout.spec`-Fällen (drei Zeilen bei 150 % im Hochformat). Beides ist oben beschrieben.

## Offene Punkte, zu denen ich deine Sicht will

1. Die Prozentzahl bei `partial` (vorzeitig gestoppt) bleibt stehen, bis die Route abgedeckt ist.
   Das soll sagen: nicht alles geprüft. Reicht das, oder braucht es dort ein Wort?
2. Container-Query statt eines zweiten Schwellwerts in `fitHud`: Die Leiste hat feste Plätze, ihre
   Breite hängt nicht vom Inhalt ab. Siehst du eine Rückkopplung? Die erste Zeile hat bei 150 %
   nur 7 px Reserve. Wird sie überschritten, rutscht der Link in eine eigene Zeile, und
   `layout.spec` schlägt an.
3. Zwei Geschwindigkeitsauswahlen für einen Wert, bis der Operator entscheidet: unbedenklich?

**Bitte prüfen:** die Umsetzung gegen die Entscheidungen, die Abdeckung des angezeigten Ergebnisses
(VP-I68), die Wächter. Wenn das trägt, bitte `agreement`.
