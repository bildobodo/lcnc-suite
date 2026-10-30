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


---

## Codex · Implementierungsreview · R228 · 30. Oktober 2026

**Ergebnis: `findings` — drei offene P2-Befunde SB-01 bis SB-03.** Die Geschwindigkeit neben Play, die gemeinsame Zustandsquelle beider Auswahlen und der Sim-Tab-Link sind angenommen. Der Bezug auf das angezeigte Prüfergebnis ist richtig; dessen Prozent-Erklärung, der tatsächliche Spurkontrast und das Breitenbudget längerer Programme brauchen Korrekturen.

### Eigene Prüfung

Stand `729a7f4a..1b532a3a`, Archivkopie `/tmp/codex-r228-3gw0n9w2/repo`, eigener Mock ausschließlich `127.0.0.1:4188`, ein Browser-Worker. Keine Produktänderungen, keine Tests/Builds in den ausgelieferten Worktrees, keine Zugriffe auf die LAN-Testsim. Der eigene Mock ist beendet. Die Basis vor Safety during edit wurde wie angefragt geprüft; daraus folgt keine Integrationsabnahme mit diesem separaten Zweig.

- Build **PASS**.
- `controlInventory.test.ts`, `simPanelStore.test.ts`, `themeTokens.test.ts`: **63/63 PASS**.
- Gezielte vorhandene Browserwächter: **14/14 PASS**. Enthalten sind VP-I68/I69, die sieben Select-Schreibprüfungen, Zeitleistenmarken, Layout beim Durchsteppen und die vier neuen Scrub-Bar-Fälle.
- Eigene Gegenproben: **1 grün / 4 rot**. Die kurze Vorschau ist die Layout-Kontrolle; rot sind Kontrast über Geometrie, zwei längere Laufzeiten und die Erklärung der vorläufigen Prozentzahl.

Belege: [Build, Unit- und vorhandene Browserprüfungen](scrub-bar.r228.checks.txt), [Gegenproben-Protokoll](scrub-bar.r228.probes.txt), [Messwerte](scrub-bar.r228.results.json), [Kontrast-/Layoutsonde](scrub-bar.r228.probe.spec.ts), [Coverage-Sonde](scrub-bar.r228.coverage.spec.ts), [Konfiguration](scrub-bar.r228.playwright.config.ts). Claudes vollständiges Gate mit 612 Browserfällen wurde nicht vollständig wiederholt.

### SB-01 · P2 · Die transparente Karte unterschreitet im hellen Theme die versprochenen 3:1

**Orte:** `style.css:221–224`, `ScrubBar.vue:1522–1528`; neuer Wächter in `sim-panel.viewer.spec.ts:1291–1302`.

Der Wächter vergleicht die RGB-Kanäle von Spur und Karte und verwirft dabei den Alphakanal der Karte. `.overlay-card` ist aber nur zu 92 % deckend. Der gemessene Kartenwert ist `[245,245,245,235]`; hinter dunkler Geometrie ist der sichtbare Hintergrund entsprechend dunkler.

Die eigene Probe verwendet die bereits in `contrast.spec.ts` vereinbarte Zusammensetzung einer schwebenden Karte über Seitenhintergrund **und** Geometrie in `--fg`, mit den tatsächlich vom Browser aufgelösten Farben:

| Theme | Ohne Zusammensetzen, wie neuer Wächter | Über Seitenhintergrund | Über Geometrie |
|---|---:|---:|---:|
| Hell | 3,02:1 | 3,04:1 | **2,63:1** |
| Dunkel | 4,10:1 | 4,13:1 | 3,38:1 |
| HC Hell | 5,78:1 | 5,84:1 | 4,86:1 |
| HC Dunkel | 4,48:1 | 4,50:1 | 3,81:1 |

Die Probe läuft bei aktivierter Simulation, also mit bedienbarem Schieber. Dies ist eine Zusammensetzung gemessener CSS-Farben nach dem bestehenden Prüfvertrag, keine als WebGL-Pixelmessung ausgegebene Rechnung.

**Erforderlich:** Die gewählte Füllung auch gegen den zusammengesetzten Kartenhintergrund auf mindestens 3:1 bringen und den Wächter entsprechend erweitern. Ein etwas kräftigerer, ausgemessener Füllton oder ein deckender lokaler Hintergrund unter der Spur sind mögliche Wege. Die Operator-Entscheidung für die Füllung muss dafür nicht zurückgenommen werden.

### SB-02 · P2 · Die erreichte Endposition wird als geprüfter Anteil des ganzen Programms erklärt

**Ort:** `ScrubBar.vue:1283–1293`, insbesondere `checkPctTitle`.

Im bestehenden VP-I68-Fall beginnt die angezeigte vorläufige Prüfung bei `fromCum=280` von 800, also bei **35 % / L7**, und endet bei **75 %**. Die Zahl `sweptFrac=0.75` ist dafür richtig: Sie beschreibt, **bis wohin** diese Prüfung reicht. Sie bedeutet nicht, dass 75 % des gesamten Programms geprüft wurden.

Die neue Anzeige hat dennoch den Titel:

> Collision check: 75 % of the program checked

Gleichzeitig nennt die korrekte Sim-Zusammenfassung `provisional from L7, stopped at 75 % (not certified)`. Die eigene Coverage-Sonde wiederholt denselben Ablauf, lässt alle bisherigen Aussagen weiter prüfen und wird nur an dieser zusätzlichen Titelprüfung rot. Die spätere vollständige Prüfung ersetzt das vorläufige Ergebnis weiterhin korrekt.

**Erforderlich:** Endposition, Umfang und Einschränkung getrennt benennen. Bei beibehaltenem `sweptFrac` muss die Erklärung „bis …“ bzw. „gestoppt bei …, vorläufig ab L7“ aussagen; sie darf keinen geprüften Anteil des Gesamtprogramms behaupten. Auch „bis 100 %“ eines vorläufigen Suffixes ist keine Vollprüfung. Nicht auf den Fortschritt der im Hintergrund laufenden Vollprüfung zurückwechseln: Der richtige Bezug zum angezeigten Ergebnis muss erhalten bleiben.

**Antwort auf Frage 1:** Eine dauerhaft stehende nackte Prozentzahl unterscheidet laufend, pausiert und abgebrochen nicht. Ich empfehle eine kompakte Zustandskennung für pausiert/abgebrochen sowie eine ehrliche Erklärung des Prüfabschnitts, mit den Details über den Sim-Link erreichbar. Die Zahl kann bleiben; sie sollte als Prüfstand erkennbar sein. Die irreführende aktuelle Erklärung ist unabhängig von der Wahl dieser Kurzform zu korrigieren.

### SB-03 · P2 · Das Zweizeilenbudget hält die 120-px-Untergrenze nur bei kurzen Programmen

**Orte:** `ScrubBar.vue:675–676` (`posSlotCh`), `1482–1487` und `1557–1580` (feste Plätze und flexible Spur); bestehender Mindestbreiten-Wächter `sim-panel.viewer.spec.ts:718–749`.

Der neue Wächter prüft nur eine Vorschau von 116 Sekunden. Mit derselben Geometrie und lediglich längeren `feed_tcum`-Werten, Hochformat 900 × 1200, Touch und 150 %, ergibt sich:

| Vorschauzeit | Zeitleiste in CSS-px, Zoom herausgerechnet | Zeilen |
|---|---:|---:|
| 1:56 | **122,0** | 2 |
| 6:00:00 | **92,7** | 2 |
| 30:00:00 | **78,0** | 2 |

Die erste Zeile bleibt in allen drei Fällen stabil. Das Problem sitzt in der zweiten: `posSlotCh` reserviert mit der Programmdauer immer mehr Breite, dazu kommen die festen 5 ch der Prüfanzeige; `.sliderWrap` darf bis auf null schrumpfen. Damit fällt gerade die vom vorhandenen Wächter verlangte Untergrenze von 120 CSS-px. Der Reglerweg ist nach Abzug des Daumens noch kürzer. Das ist keine geänderte Geometrie oder künstliche Schriftvergrößerung, sondern die bereits unterstützte 150-%-Ansicht mit einer längeren Vorschau.

[Bild kurze Kontrolle](scrub-bar.r228.duration-116.png), [Bild sechs Stunden](scrub-bar.r228.duration-21600.png), [Bild 30 Stunden](scrub-bar.r228.duration-108000.png).

**Erforderlich:** Den festen Zeit-/Abdeckungsplätzen ein Budget geben, das die Mindestbreite der Zeitleiste auch für Stundenprogramme hält, und diese Fälle in den Wächter aufnehmen. Ein stabiles kompaktes Zeitformat in der schmalen Form wäre ein Gegenentwurf; der Sim-Tab zeigt bereits die vollständige Zeit. Falls die vollständige Doppelzeit zwingend auch in der Leiste bleiben soll, braucht es eine andere Aufteilung. Nur `min-width:120px` hinzuzufügen wäre unvollständig: Das darf weder eine dritte Zeile noch einen abgeschnittenen Wert erzeugen. Den leeren Prozentplatz während einer abgeschlossenen Prüfung einfach zu entfernen würde wiederum die Spur beim Zustandswechsel verschieben.

### Antworten auf die übrigen Fragen und angenommene Teile

**Frage 2 — Container-Query:** Angenommen. Die Breite kommt von der übergeordneten unteren Spalte; die Query ändert deren Inhalt, nicht deren verfügbare Breite. In den geprüften Wechseln ist keine Rückkopplung aufgetreten. Die 7 px Reserve der ersten Zeile lösen allerdings das separate Zeitbudget aus SB-03 nicht. Beide Zeilen müssen geprüft werden, einschließlich längerer Zeitdarstellungen.

**Frage 3 — zwei Geschwindigkeitsauswahlen:** Technisch unbedenklich. Beide lesen und schreiben denselben Wert; meine Probe ändert erst in der Leiste auf ×100, dann im Sim-Tab auf ×0,1 und bestätigt die Rückrichtung. Die vorhandene Mutation-Überwachung beider Selects ist ebenfalls grün. Die bereits offene Operator-Entscheidung zur dauerhaften Doppelung bleibt eine Gestaltungsentscheidung und blockiert diese Korrekturen nicht.

Der Sim-Link benutzt `requestTab('sim')` und damit den bestehenden Schutz ungespeicherter Makro-Entwürfe. Der gewählte Symboltyp entspricht der Operator-Vorgabe. Die neue Klassifikation im Control-Inventar passt zu Navigation bzw. lokaler Wiedergabe.

Nicht blockierender Hinweis zur schmalen Form: CSS `order` setzt den Link optisch vor die Zeitleiste, die Tastaturfolge bleibt Geschwindigkeit → Zeitleiste → Link. Die eigene Probe protokolliert diesen Sprung. Bei einer ohnehin nötigen Layoutkorrektur sollte auch diese Reihenfolge möglichst der sichtbaren Anordnung folgen.

**Kein Agreement vor SB-01 bis SB-03. Keine zusätzliche Operator-Entscheidung für die belegten Fehler erforderlich.** Für die Wiederholung die beiden Sonden als `e2e/scrub-r228.codex.spec.ts` und `e2e/scrub-r228.coverage.spec.ts` sowie die Konfiguration in einer eigenen Archivkopie ablegen, die Mock-URLs in `e2e/*.ts` auf `127.0.0.1:4188` umstellen und nach dem Build dort mit `-g R228` ausführen. Frühere Belege bleiben unverändert.


---

## Claude · Antwort auf R228 · 30. Oktober 2026

**Stand `e2a660f5`**: Produkt, Wächter und Doku in `6242812e` und `52714b63`, Gate-Beleg in `e2a660f5`. SB-01 bis SB-03 sind angenommen und behoben.

### SB-01: Die Füllung hält 3 : 1 durch die Karte über Geometrie und gegen den Daumen

- Zuerst habe ich einheitlich 40 % Panel gesetzt. Gate-Lauf 4 fiel daraufhin an `contrast.spec`: Der Regler-Daumen (`--fg`) stand auf der dunkleren Spur nur noch bei 2,96 : 1 (hell), auch dunkel und HC hell lagen darunter.
- Die Spur muss also zwei Regeln zugleich halten: 3 : 1 gegen die zusammengesetzte Karte und 3 : 1 gegen ihren Daumen. Beides geht nur in einem Fenster je Theme: hell 42–44 %, dunkel 44–52 %, HC hell ≥ 49 %. Einen gemeinsamen Anteil gibt es nicht.
- `--scrub-track` ist deshalb pro Theme definiert, in jedem Theme-Block (`themeTokens.test` 54/54). Das bleibt die Füllung, die der Operator gewählt hat.

| Theme | Panel-Anteil | gegen Karte (ungünstiger: über Seite / über Geometrie) | Daumen auf Spur |
|---|---:|---:|---:|
| hell | 43 % | 3,14 : 1 | 3,21 : 1 |
| dunkel | 48 % | 3,56 : 1 | 3,48 : 1 |
| HC hell | 54 % | 4,10 : 1 | 3,77 : 1 |
| HC dunkel | 48 % | 4,05 : 1 | 4,12 : 1 |

- **Wächter** (`sim-panel.viewer.spec`): Die Kartenfarbe wird mit ihrem Alpha über die aufgelösten Rollen `--bg` und `--fg` zusammengesetzt, wie im Vertrag aus `contrast.spec`. Dazu kommt der Daumen (`--fg`) auf der Spur. Geprüft wird in vier Themes, jeweils in und außerhalb der Simulation, und die Spur ist nie gedimmt. `contrast.spec` (15/15) prüft den Daumen ohnehin.
- Gegen `1b532a3a` ist das helle Theme rot. Dunkel und HC waren schon vorher über 3 : 1, wie in deiner Tabelle.

### SB-02: Die Zahl ist, wohin die angezeigte Prüfung reicht

- Der Wert bleibt `sweptFrac`, also das angezeigte Ergebnis (VP-I68).
- Der Titel ist jetzt die Abdeckungsformulierung der Sim-Zusammenfassung selbst: `Collision check: ${sweepView.coverage}`.
  - Im VP-I68-Fall: „Collision check: provisional from L7, stopped at 75 %“.
  - Im normalen Lauf: „Collision check: 30 % checked“. Hier beginnt die Prüfung beim Programmstart.
  - „of the program checked“ steht nirgends mehr.
- **Kompakte Zustandskennung:**
  - Pausiert (Rundachs-Jog) und vorzeitig gestoppt zeigen hinter der Zahl ein Zeichen (`Pause` bzw. `Square`, 10 px, `aria-hidden`), dazu die Zahl in der Warnrolle (`.text-warn`).
  - Der feste Platz hält den Raum des Zeichens immer frei (`5ch + 10px + --gap-micro`). Nichts verschiebt sich beim Zustandswechsel.
  - Laufend steht die Zahl allein, abgeschlossen ist der Platz leer.
- **Wächter** (`collisions.viewer.spec`):
  - VP-I68: Titel genau wie oben.
  - C2-Zustände für alle drei Arten: „30 %“ ohne Zeichen mit „30 % checked“; pausiert „40 %“ mit Zeichen, Warnrolle, Titel „paused at 40 %“; am Ende leer.
  - Gegen `1b532a3a` sind diese vier Fälle rot.

### SB-03: Die Zeitleiste behält 120 px auch bei Stundenprogrammen

- Du hast den Gegenentwurf genannt, und so ist es umgesetzt: In der schmalen Form zeigt der Zeitplatz nur die abgelaufene Zeit (mit dem „~“ des Laufs).
  - Die ganze Doppelzeit steht im Titel des Platzes und im Sim-Tab.
- Der Platz hat zwei feste Breiten pro Programm, `--slot-w-wide` und `--slot-w-narrow` (Länge der Gesamtzeit + 1 ch).
  - Die Container-Query wählt zwischen beiden; nichts hängt vom laufenden Text ab.
- Der Prüfplatz bleibt fest, auch wenn er leer ist, wie von dir verlangt.
- **Wächter** (`sim-panel.viewer.spec`): 2 min, 6 h und 30 h bei Hochformat-Touch 150 %.
  - Geprüft: zweizeilig, Zeitleiste ≥ 120 CSS-px (Zoom herausgerechnet), Zeit nur abgelaufen und ganz, Titel mit „/“.
  - Gegen `1b532a3a` sind alle drei rot.
- `posTitle` mit dem Messhinweis bleibt der bisherige kurze Text (≤ 90 Zeichen, Audit `LONG_TITLE`). Ohne Messhinweis ist er jetzt die ganze Anzeige.

### Tastaturreihenfolge in der schmalen Form

Angenommen als Hinweis, bewusst nicht umgestellt:

- Würde der Link im DOM vor die Zeitleiste rücken, entstünde derselbe Sprung in der breiten Form, wo er hinter der Zeit steht.
- Die breite Form ist die häufigere: Querformat, auch Touch 1280 × 800.
- In der schmalen Form folgt die Tastatur der Lesefolge der breiten: Geschwindigkeit → Zeitleiste → Link.

### Gate

Lauf 5 PASS auf `52714b63`: Lint, Build, 2630 Unit-Tests, 617/617 Browser (`docs/reviews/scrub-bar.gate-frontend.run5.json`). Lauf 4 (`6242812e`) fiel an `contrast.spec` (Daumen, siehe SB-01).

**Bitte prüfen:** den zusammengesetzten Kontrast, den Titel und das Zustandszeichen, das Zeitbudget. Wenn das trägt, bitte `agreement`.
