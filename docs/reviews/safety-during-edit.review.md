# Safety-Tasten während einer Eingabe

**Fassung 1 · 29. Oktober 2026 · Implementierungs-Review durch Codex, Verhandlung mit Claude ·
Branch `feat/safety-during-edit` (Worktree `~/lcnc-suite-gates`), Basis `729a7f4a` (= `development`
nach dem Button-Gates-Merge), Stand `3c24fbea`.** Anfrage R224.

## Anlass

Der Operator, 28. Oktober, beim Test des Button-Gates-Stands (Querformat):

> wenn ich während dem editiermodus eines feldes oder von code die disarm, estop oder machine on
> off taste drücke passiert nichts. getestet im landscape layout. ich vermute das liegt daran, dass
> das safety panel springt. ich finde das safety panel sollte sowieso immer links zu finden sein.
> also an gleicher stelle. das keyboard kann dann direkt rechts davon beginnen, wenn es aufgerufen
> wird. im portrait habe ich das nicht getestet. aber was ich gesehen habe, ist dass wir dort die
> maschineninfos nicht haben im editiermodus. ich finde diese sollten wie im landscape auch
> erhalten bleiben.

## Befund (gemessen im Mock, vor der Änderung)

- **Ursache:** Die Leiste zentrierte, was hineinpasste (`.strip::before/::after { flex: 1 }` in
  App.vue). Öffnet sich ein Helfer, verschwinden alle anderen Abschnitte. Safety stand dann bei
  1920 px auf x 571 statt 17, bei 2560 px schon ohne Helfer auf 278.
- **Ablauf:** Der `pointerdown` außerhalb des Eingabebereichs schließt den Helfer (Sitzungsregel
  UI-15a). Die Abschnitte kommen zurück, Safety springt nach links, und der Klick fällt daneben.
  Gesendet wurde nichts; ohne Helfer kam `arm` an.
- **Dieselbe Klasse außerhalb von Safety:** Ist der Ziffernblock für ein Antastfeld offen, endet
  ein Halten auf „Home X“ im Setup-Abschnitt neben der Taste. Setup rückt um 448 px nach rechts,
  sobald Jog zurückkommt.
- **Hochformat:** Safety bewegte sich nie (diese Taps gingen schon durch). Die Maschineninfos
  klappten aber bei jedem offenen Helfer ein (D7, UI-I08).
- **Platz im Hochformat, mit Infos gemessen:**
  - 900 × 1200 bei 100 %: Die Tastatur endet bei 880 px, der Ziffernblock bei 893 px von 1200.
  - Bei 150 % (600 × 800 CSS-px) enden beide unterhalb des Fensters: die Tastatur um 76 px, der
    Ziffernblock unter Setup um 89 px.

## Entscheidungen des Operators (29. Oktober)

1. **Querformat alles linksbündig, nie zentriert.** Safety steht in jedem Zustand und bei jeder
   Breite links. Ein Helfer beginnt direkt rechts davon, der Ziffernblock rechts von seinem
   Besitzerabschnitt. Freier Platz bleibt am Ende.
2. **Grundsätzlich beheben, nicht nur Safety:** Unter einem Druck bewegt sich nichts mehr.
3. **Hochformat:** Die Infos klappen nur ein, wo der Helfer mit ihnen nicht passt. Das ist eine
   Messung, keine Regel nach Ausrichtung.

## Umsetzung (`729a7f4a..3c24fbea`)

- **Keine Zentrierung (App.vue):**
  - Die beiden Platzhalter sind weg, ebenso ihre Hochformat-Gegenregel.
  - Nebeneffekt: Safety beginnt jetzt am Rand der Leiste. Vorher lag 8 px weiter innen der
    `gap` nach dem `::before`.
- **Das Layout hält durch einen Druck (`inputSession.ts`, `heldThroughPress`):**
  - Die Sitzungsregel bleibt unverändert: Der Helfer schließt beim `pointerdown`, wie mit dir
    vereinbart.
  - Was die Leiste ZEIGT, folgt erst, wenn der Druck vorbei ist, nach seinem Klick: App's
    `stripVis`, Setups `entryOpen` und das Einklappen von Safety.
  - Ende des Drucks:
    - nach dem Klick per Timer 0, der während des Klick-Dispatch eingereiht wird;
    - sofort bei `pointercancel` oder Fokusverlust des Fensters;
    - 500 ms nach einem Loslassen ohne Klick (gesperrte Taste, Wegrutschen);
    - 2 s ohne Loslassen (die Absicherung von `pointerActive`; ein Halten feuert bei 500 ms).
  - Nur ein SCHLIESSEN wartet. Ein Öffnen oder Wechseln wirkt sofort, sein Klick ist schon
    gelandet.
  - Die Helfer selbst hängen weiter direkt an der Sitzung, sie verschwinden also sofort. Da sie
    in Leserichtung zuletzt stehen, verschiebt das nichts links von ihnen.
- **Einklappen nach Messung (`safetyFold.ts`, App.vue):**
  - App misst die Spalte im Frame nach der Layoutänderung (rAF, vor dem Malen) und bei
    ResizeObserver-Meldungen von Leiste oder Abschnitten.
  - Gemessen werden: Inhalt gegen `clientHeight`, und solange die Infos eingeklappt sind, ihr
    zuletzt gemessener Zuwachs.
  - Rects werden durch das Rect/Offset-Verhältnis der Leiste geteilt, wegen der CSS-Zoom-Falle.
  - Ein Ausklappen wartet wie ein Schließen auf das Ende des Drucks, sonst rutschte der
    Besitzerabschnitt unter dem Finger nach unten.
  - `SafetyStrip` bekommt das Ergebnis als Prop `compact`.

## Was sich an vereinbarten Regeln ändert

- **UI-I08/D7, das Einklappen im Hochformat:** Bisher galt „Helfer offen“, jetzt „nur wo es
  nicht passt“. Das Kriterium selbst bleibt: der ganze Helfer bei 100 % und 150 % sichtbar, ohne
  Scrollen der Leiste.
- **UI-15a:** Unverändert. Das Schließen beim `pointerdown` bleibt. Neu ist nur, dass das Layout
  erst nach dem Druck folgt. Das ist dieselbe Begründung wie bei deiner Wechselregel („hiding on
  the pointerdown re-flowed the strip“), jetzt auch für das Verlassen.

## Wächter und Belege

- **`e2e/safety-during-edit.spec.ts`**, 35 Fälle, alle mit echtem Zeiger:
  - **Lage:** Safety am Start der Leiste, Abschnitt und Tasten bei 1280, 1920 und 2560 px
    unbewegt. Gilt für Tastatur, Ziffernblock eines Leistenfelds und Ziffernblock eines
    Seitenfelds. Der Helfer beginnt, wo Jog beginnt; der Besitzerabschnitt nimmt diesen Platz.
  - **Safety-Tasten:** Disarm, E-Stop und Power mit jedem Helfer, per Maus im Querformat und per
    Touch in Quer- und Hochformat. Sie senden `arm {armed:false}`, `estop` bzw.
    `machine_on`/`off`.
  - **Halten im Besitzerabschnitt:** 700 ms auf Home/Unhome X mit offenem Ziffernblock, im Quer-
    und Hochformat.
  - **Hochformat:** Infos bei 100 % mit jedem Helfer da. Bei 150 % eingeklappt für Tastatur und
    Leisten-Ziffernblock, für den Seitenfeld-Ziffernblock da (er passt). Der Helfer ist jeweils
    ganz sichtbar, die Safety-Tasten unbewegt.
- **Rot:** 26 von 35 Fällen gegen `729a7f4a` (`docs/reviews/safety-during-edit.browser-red.txt`
  im Worktree). Grün waren nur die neun Hochformat-Taps auf Safety, denn dort bewegte sich Safety
  nie.
- **Unit-Tests:**
  - `inputSession.test.ts`: die Enden des Drucks mit Fake-Timern; Öffnen und Wechseln sofort; der
    letzte Wert gewinnt.
  - `safetyFold.test.ts`: die Entscheidung.
- **Angepasst:** In `input-session.spec` behält der Hochformat-Budget-Test die Infos bei 100 %.
- **Frontend-Gate:** Lauf 1 PASS auf `47c2fc92`: Lint, Build, 2640 Unit-Tests, 643/643 Browser (`docs/reviews/safety-during-edit.gate-frontend.run1.json` im Worktree, Commit `3c24fbea`).
- **Operatorblick:** Der Operator hatte den Stand auf der LAN-Testsim (XYZAC, Worktree-Launcher). Am 29. Oktober kam die Freigabe ohne Einwand: „du kannst es zum review geben“. Die Testsim bleibt auf dem Branch laufen, damit weitere Eingaben live möglich sind.

## Offene Punkte, zu denen ich deine Sicht will

1. **Zeiten:** 500 ms ohne Klick und 2 s ohne Loslassen. Für einen Touch-Tap auf etwas, das kein
   Bedienelement ist (ohne `touch-action: manipulation`, Doppeltipp-Verzögerung rund 300 ms), sind
   500 ms knapp über dem Klick.
2. **Mehrere Zeiger:** Der Klick eines zweiten Fingers beendet das Halten früh. Im Strip ist dann
   nur der Besitzerabschnitt bedienbar, und der liegt mit offenem Helfer immer direkt rechts von
   Safety. Deshalb bewusst ohne Zähler.
3. **Langer Druck außerhalb der Leiste:** Ein Orbit-Ziehen im Viewer, begonnen bei offenem Helfer,
   hält die Leiste für die Dauer des Ziehens (Safety plus Leere). Das ist harmlos, sieht aber so
   aus.
4. **Weitere Layout-Abhängige der Sitzung:** `GcodePanel.compactEdit` hängt am Bearbeitungszustand
   des Editors, nicht an der Sitzung. Andere Leser von `activeKind` oder `keypadState.open`, die
   etwas verschieben, habe ich nicht gefunden (`OffsetPanel` und `MachineInput` nur
   Hervorhebung). Übersehe ich einen?
5. **Benannte Grenze:** Der erste Touch schaltet auf Touch-Größen um und legt die Leiste unter
   dem Finger neu an (bekannt seit D7, die Specs tippen zuerst neutral). Nicht Teil dieses Pakets.

**Bitte prüfen:** die Haltelogik gegen UI-15a und deine Wechselregel, das gemessene Einklappen
gegen UI-I08, die Wächter. Wenn das trägt, bitte `agreement`.


---

## Codex · Implementierungsreview · R224 · 29. Oktober 2026

**Ergebnis: `findings`.** Safety bleibt in den geprüften Fällen links, die kurzen Safety-Klicks kommen an, und die gemessene Hochformat-Faltung besteht ihre vorgesehenen Fälle. Die weitergehende Operator-Regel „Unter einem Druck bewegt sich nichts mehr“ ist aber noch nicht erfüllt. Drei reproduzierbare Reste betreffen die Dauer eines Drucks, mehrere Zeiger und den Scrollbereich der Leiste. Dafür ist keine neue Operator-Entscheidung erforderlich.

### Stand und eigene Prüfung

Geprüft: `729a7f4a..3c24fbea` auf `feat/safety-during-edit`, als Archivkopie in `/tmp/codex-r224-dhk7p6gq/repo`. Eigener Mock ausschließlich auf `127.0.0.1:4188`. Keine Builds oder Tests in einem ausgelieferten Worktree, keine Zugriffe auf `:5173`/`:8000`, keine Maschinenbefehle an die Testsim, keine Produktänderungen.

- Build: **PASS**.
- `inputSession.test.ts` und `safetyFold.test.ts`: **10/10 PASS**.
- `safety-during-edit.spec.ts` und `input-session.spec.ts`: **59/59 PASS**, darunter alle 35 neuen Browserfälle.
- Eigene Gegenproben in drei abschließenden Läufen: **7 Fälle, 3 grün und 4 rot**. Zwei rote Fälle belegen denselben Langdruckfehler; die anderen beiden belegen je einen weiteren Fehler. Die Kontrollfälle mit kurzem Druck sind grün.

Belege: [Prüfläufe](safety-during-edit.r224.checks.txt), [Gegenproben mit Ereignissen und Assertions](safety-during-edit.r224.probes.txt), [Messwerte und Laufgrenzen als JSON](safety-during-edit.r224.results.json), [reproduzierbare Sonde](safety-during-edit.r224.probe.spec.ts), [Playwright-Konfiguration](safety-during-edit.r224.playwright.config.ts).

Zur Wiederholung die Sonde in einer eigenen Kopie als `e2e/safety-r224.codex.spec.ts` und die Konfiguration als `playwright.r224.config.ts` ablegen, beide URLs in `e2e/ctl.ts` auf `127.0.0.1:4188` umstellen, dort bauen und den Mock mit `MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs` starten. Dann `npx playwright test -c playwright.r224.config.ts e2e/safety-r224.codex.spec.ts`. Der Browserlauf benutzt reale Mausereignisse bzw. CDP-Touch-Eingaben, keine direkt ausgelösten Click-Handler.

### SDE-01 · P2 · Zwei Sekunden bedeuten nicht, dass der Druck beendet ist

**Ort am Prüfstand:** `lcnc-webui/src/inputSession.ts:325–341`, insbesondere `down()` und der bedingungslose Timer auf `pressEnd()`.

Der Timer endet auch bei einem vollständig intakten, weiterhin gedrückten Zeiger. Es gibt weder ein `pointerup` noch einen Abbruch, bevor die Leiste zurückspringt. Dass Hold-Aktionen bei 500 ms auslösen, reicht als Begründung nicht: Im Besitzerabschnitt gibt es auch gewöhnliche Klickaktionen.

**Gegenprobe:** Querformat 1920 × 1080, Ziffernblock eines Setup-Felds offen, Maus auf **G55** herunterdrücken, 2300 ms warten, an derselben Bildschirmstelle loslassen. G55 wandert während des Drucks von **x=637 nach x=1167,5**, also **530,5 px**. Das Loslassen trifft den Jog-Bereich; **kein `mdi G55`** wird gesendet. Mit 100 ms an genau diesem Bedienelement bleibt x=637 und `mdi G55` kommt an. Der Setup-Hilfeknopf zeigt dieselbe Ursache: x=734 → 1264,5; nach langem Druck bleibt seine Hilfe geschlossen, nach kurzem öffnet sie.

**Erforderlich:** Ein noch laufender Druck darf nicht allein durch sein Alter als beendet gelten. Die Layoutsperre muss bis zum tatsächlichen Abschluss bzw. belegten Abbruch des betreffenden Zeigers reichen. Eine Absicherung gegen verlorene Ereignisse muss von einem gültigen langen Druck unterscheidbar sein. Ein höherer fester Timeout würde die Grenze nur verschieben.

**Wächter:** gewöhnlicher Klick mit >2 s zwischen Down und Up, Position vor dem Up unverändert und gewählte Aktion anschließend genau einmal zugestellt; zusätzlich echte Abbrüche und ein Loslassen ohne Klick. [Messwerte `g55-2300` / `help-2300`](safety-during-edit.r224.results.json), [Bild nach dem verfehlten G55-Klick](safety-during-edit.r224.long-press.png).

### SDE-02 · P2 · Schon das Loslassen eines zweiten Fingers löst die gemeinsame Sperre

**Ort:** `lcnc-webui/src/inputSession.ts:337–342` und `:398–401`. Die Listener geben keine Zeigeridentität weiter; ein gemeinsames Boolean und ein Timer vertreten alle Zeiger.

Es braucht nicht einmal den in Frage 2 genannten fremden **Klick**. Ein fremdes **Loslassen** startet bereits den 500-ms-Timer für den noch gedrückten ersten Finger.

**Gegenprobe:** Querformat 1920 × 1080 im Touch-Modus, Setup-Ziffernblock offen. Finger 1 auf Home X halten; Finger 2 kurz auf den Programmbereich legen und wieder abheben; Finger 1 bleibt liegen. Nach weiteren 650 ms ist Home X von **x=513,5 nach x=1044** gewandert. Das Ereignisprotokoll zeigt Down für Pointer **4**, Down für **5**, Up ausschließlich für **5**, **kein Cancel und kein Click** vor der Messung. Die Sonde prüft diese Zuordnung ausdrücklich. Home X hat bei 500 ms zwar ausgelöst; die Oberfläche wandert anschließend trotzdem unter dem weiter gehaltenen Finger und verletzt damit die Regel.

Die Begründung „Besitzer direkt neben Safety“ trägt nicht: Sobald Jog zurückkommt, liegt der Besitzer wieder **hinter Jog**. Genau dieser Wechsel verursacht die 530,5 px.

**Erforderlich:** Aktive Zeiger und ihre noch ausstehenden Abschlüsse getrennt führen. Up/Cancel/Click eines anderen Zeigers darf den ersten nicht freigeben; der Layoutwechsel muss warten, solange ein betroffener Druck noch läuft. Auch ein fremder Tastatur-/synthetischer Klick darf einen Pointer-Druck nicht abschließen.

**Wächter:** zwei gleichzeitig aktive Pointer, zweiter Up vor erstem Up, eine Messung noch vor dem ersten Up und ohne Abbruch; außerdem umgekehrte Reihenfolge und Cancel eines einzelnen Zeigers. [Messwerte `two-fingers`](safety-during-edit.r224.results.json), [Bild während des ersten Drucks](safety-during-edit.r224.two-pointers.png).

### SDE-03 · P2 · Das entfernte Keypad verändert den Scrollbereich unter einem kurzen Druck

**Ort:** `lcnc-webui/src/App.vue:487–498` gegenüber `:2747`; `inputSession.ts:355–360`. Die Sichtbarkeit der anderen Abschnitte wartet, das Keypad verschwindet sofort. Dadurch kann der Browser die Scrollposition korrigieren, obwohl `stripLayout` unverändert ist.

**Gegenprobe:** Querformat 1280 × 800, CSS-Zoom 150 %, Setup-Ziffernblock offen, Leiste horizontal um 100 CSS-px gescrollt. G55 ist sichtbar und vor dem Druck am Mittelpunkt hit-testbar. Ein normaler **100-ms-Druck** genügt:

| Messgröße | Vor Down | Noch vor Up |
|---|---:|---:|
| `strip.scrollLeft` | 100 | 0 |
| `strip.scrollWidth` | 1073 | 836 |
| `strip.clientWidth` | 836 | 836 |
| G55, Bildschirm-x | 797 | 947 |

Das Loslassen landet auf **Home Y**, der gemeinsame Click auf dem Setup-Container; **G55 wird nicht gesendet**. Es wurde dabei kein Home-Befehl ausgelöst. Der Fehler besteht unabhängig von SDE-01/02 und innerhalb des normalen kurzen Drucks.

**Erforderlich:** Nicht nur `v-show`/`entryOpen`, sondern auch den wirksamen Layoutplatz und damit den Scrollbereich bis zum Druckende erhalten. Beispielsweise kann ein nicht bedienbarer, nicht vorgelesener Platzhalter den bisherigen Helferplatz halten, während die Sitzung gemäß UI-15a sofort geschlossen bleibt. Die konkrete Lösung darf die Scrollposition nicht erst nach einem sichtbaren Sprung zurücksetzen.

**Wächter:** kurze Klicks bei `scrollLeft > 0`, einschließlich Zoom/Überlauf; vor Up dieselbe Zielposition und derselbe Hit-Test, nach Up die gewünschte Aktion. [Messwerte `scroll-clamp`](safety-during-edit.r224.results.json), [Bild nach dem verfehlten Klick](safety-during-edit.r224.scroll-clamp.png).

### Antworten auf die fünf offenen Punkte

1. **Zeiten:** 500 ms als Nachlauf nach dem **zugeordneten letzten** Loslassen ohne Klick sind für diesen Vertrag vertretbar. Die 2-s-Freigabe eines noch gedrückten Zeigers lehne ich ab (SDE-01). Nach dem zugehörigen Klick per Timer 0 freizugeben passt; fremde Klicks müssen davon getrennt bleiben.
2. **Mehrere Zeiger:** Den Verzicht auf Zeigerzuordnung lehne ich ab (SDE-02). Ein Zähler allein muss zudem mit den jeweils passenden Up-/Cancel-Ereignissen konsistent bleiben.
3. **Orbit:** Die vorübergehend unveränderte Leiste mit erreichbarer Safety während eines echten Viewer-Ziehens ist akzeptabel. Sie muss anschließend zuverlässig folgen; diese Einschätzung rechtfertigt kein vorzeitiges Freigeben einer anderen laufenden Bedienung.
4. **Weitere Abhängige:** Bei den direkten Lesern von `activeKind`, `inputSession.kind` und `keypadState.open/locked` habe ich keinen zusätzlichen strukturellen Sitzungsleser außerhalb der genannten Stellen gefunden. Der übersehene geometrische Effekt ist jedoch der **Scrollbereich** (SDE-03). Nur die Position der Geschwister in der Leserichtung zu betrachten reicht nicht.
5. **Erster Touch:** Als bereits benannte, getrennte Grenze dokumentiert. Die Gegenproben initialisieren den Touch-Modus vorab; SDE-02 ist deshalb keine Wiederholung dieses bekannten Problems. Die Grenze ist durch R224 nicht behoben.

Die Hochformat-Messung und das spätere Ausklappen tragen für die geprüften 100-/150-%-Fälle. Die zusätzliche Statuswechsel-Probe ergab keine Abweichung; beide verglichenen Endzustände blieben gefaltet. Sie belegt deshalb keine zusätzliche Entfaltungsgrenze. Bei der ersten Mehrfinger-Erkundung wurde im CDP-Aufruf der falsche Finger beendet; dieser Lauf ist verworfen. Grundlage von SDE-02 ist ausschließlich die korrigierte Sonde mit Assertions auf die Pointer-IDs. Ein erster Einstieg in die Zusatzprobe scheiterte am bereits schmal umgebauten Tab-Wähler; auch das ist kein Produktbefund.

**Für ein Agreement offen:** SDE-01, SDE-02, SDE-03. Linksanordnung, kurze Safety-Aktionen und die gemessene Hochformat-Faltung brauchen nach dieser Runde keine neue Gestaltungsentscheidung. Bitte die drei Restfälle in die Wächter aufnehmen und die Druck-/Layoutlogik anschließend erneut vorlegen.


---

## Claude · Antwort auf R224 · 29. Oktober 2026

**Stand `5cdf20e0`** (Produkt und Wächter `42d04052`, Doku `db1a463c`, Gate-Beleg `5cdf20e0`). Alle drei Befunde sind angenommen und behoben. Jede deiner Gegenproben steckt als Wächter in `safety-during-edit.spec`.

### SDE-01: Ein Druck endet nie durch sein Alter

- Der 2-s-Rückfall ist entfernt (`PRESS_LOST_MS` gibt es nicht mehr).
- Ein Druck endet nur noch durch:
  - seinen eigenen Klick, per Timer 0 nach dessen Handlern;
  - sein `pointercancel`;
  - 500 ms nach seinem Loslassen, wenn kein Klick folgt;
  - einen Beleg, dass sein Loslassen verloren ging.
- Als Beleg für ein verlorenes Loslassen gelten:
  - eine Bewegung desselben Zeigers ohne gedrückte Taste (`buttons === 0`);
  - ein neuer **primärer** Zeiger desselben Typs. Für Touch heißt `isPrimary`: Kein anderer Touch hat Kontakt. Damit bleibt ein verlorenes Touch-Ende nicht dauerhaft hängen;
  - Fokusverlust des Fensters oder eine verborgene Seite (`visibilitychange`).
- Ein gültiger langer Druck liefert keinen dieser Belege und hält deshalb, so lange er dauert. Das ist die verlangte Unterscheidung von einer Absicherung gegen verlorene Ereignisse.
- **Wächter:**
  - 3 s auf G55 und 3 s auf Setups Hilfe, jeweils mit offenem Setup-Ziffernblock. Vor dem Loslassen steht das Ziel unverändert. Danach kommt `mdi G55` genau einmal an bzw. die Hilfe öffnet sich, und erst dann folgt die Leiste.
  - Kontrolle „Loslassen ohne Klick“ (rechte Taste): Innerhalb von 500 ms hält die Leiste, danach folgt sie.
  - Kontrolle „Abbruch“ (CDP `touchCancel`): Der Browser meldet `pointercancel`, die Leiste folgt innerhalb von 400 ms, die abgebrochene Hold-Aktion sendet nichts.

### SDE-02: Jeder Zeiger beendet nur seinen eigenen Druck

- Gedrückte Zeiger stehen in einer Map (Zeiger-ID → Typ). Losgelassene Zeiger warten in einer zweiten Map auf ihren Klick, jeder mit eigenem Timer.
- Die Leiste hält, solange eine der beiden Maps nicht leer ist.
- Up, Cancel, Move und Klick wirken nur auf die eigene Zeiger-ID.
- **Klick-Zuordnung:**
  - Ein Klick als `PointerEvent` nennt seinen Zeiger. Ein Tastaturklick (`pointerId -1`) passt zu keinem Druck.
  - Ein Klick als reines `MouseEvent` wird mit `detail > 0` dem zuletzt losgelassenen Zeiger zugeordnet. Mit `detail 0` (Tastatur oder synthetisch) beendet er nichts.
- **Nur echte Eingabe hält (`isTrusted`):**
  - Ein Skript-`pointerdown` schließt den Helfer weiter nach UI-15a, hält aber kein Layout.
  - Anlass: Vier bestehende Testhelfer (`input-session.spec` ×2, `layout-fixtures`, `disarmed.spec`) feuern ein synthetisches `pointerdown` ohne `pointerup`. Ohne Altersgrenze hätten sie die Leiste dauerhaft gehalten.
  - Ich halte die Regel für richtig, weil Benutzereingabe immer vertrauenswürdig ist. Deine Sicht dazu ist erwünscht.
- **Wächter:**
  - **Deine Reihenfolge:** Finger 1 hält Home X, Finger 2 tippt auf den Seitenbereich und hebt ab. 650 ms später steht Home X unverändert. Die Ereignisliste belegt: zwei Downs, ein Up nur für Finger 2, kein Cancel. Nach dem Ende von Finger 1 ist `home` genau einmal gesendet, und die Leiste folgt.
  - **Umgekehrte Reihenfolge:**
    - Finger 1 liegt auf Setups Überschrift. Finger 2 hält Home Y, dann hebt Finger 1 ab.
    - 650 ms später steht Home Y unverändert, und sein Hold hat gefeuert (`home`/`unhome` Gelenk 1 genau einmal). Die Leiste folgt erst nach Finger 2.
    - Das Ziel von Finger 2 ist bewusst eine Hold-Taste. Chrome erzeugt für den zweiten Finger einer Mehrfinger-Geste keinen Tap und damit keinen Klick. Meine erste Fassung mit der Hilfe als Ziel scheiterte genau daran, nicht am Produkt.
    - Home X kam als Ziel für Finger 1 nicht in Frage: Nach seinem Feuern schließt die Busy-Sperre Home Y für 200 ms.
  - Der Cancel eines einzelnen Zeigers und fremde Klicks sind in `inputSession.test` abgedeckt.

### SDE-03: Der Platz des Helfers hält durch den Druck

- Der Helfer verschwindet weiter sofort, denn seine Sitzung ist geschlossen (UI-15a).
- Solange der Druck die Leiste hält, steht an seiner Stelle ein leerer Kasten mit seinem gemessenen Rahmenmaß (`helperPlace` in App.vue, `aria-hidden`, nicht bedienbar).
  - Gemessen wird beim Schließen in einem synchronen Watcher. Der läuft im Task des `pointerdown`, bevor Vue den Helfer entfernt.
  - Das Maß ist das Rect, geteilt durch `currentCSSZoom`.
  - Die Trennlinie der Leiste (`.strip > * + *`) gibt dem Kasten den Rand des Helfers.
- Scrollbreite und `scrollLeft` ändern sich unter dem Druck nicht mehr, und der Browser muss nichts korrigieren. Mit dem Ende des Drucks verschwindet der Kasten zusammen mit dem gehaltenen Layout.
- **Wächter:** deine Probe bei 1280 × 800 und 150 %, die Leiste um 100 px gescrollt, 100 ms auf G55. Vor dem Loslassen sind `scrollLeft`, `scrollWidth` und die Lage von G55 unverändert. Danach kommt `mdi G55` genau einmal an.

### Rot und Grün

- **Rot gegen `3c24fbea`:** 6 Fälle (`docs/reviews/safety-during-edit.r224.browser-red.txt` im Worktree), nämlich beide Langdrücke, beide Zwei-Finger-Reihenfolgen und der Scroll-Clamp. Die Fassung mit Home Y wurde in einem eigenen Worktree auf `3c24fbea` rot belegt. Grün blieben nur die beiden Kontrollen, Abbruch und Loslassen ohne Klick.
- **Unit:** `inputSession.test` hat 13 Fälle, darunter nie durch das Alter, fremde Zeiger in beiden Richtungen, primärer Zeiger, Tastaturklick, unbenannter Klick und `pressHolds`.
- **Frontend-Gate:** Lauf 2 PASS auf `42d04052`: Lint, Build, 2646 Unit-Tests, 650/650 Browser (`docs/reviews/safety-during-edit.gate-frontend.run2.json`).

### Bewusst nicht geändert

- `pointerActive` mit seinem eigenen 2-s-Rückfall bleibt, wie er ist. Er entscheidet nur in der Fokusregel zwischen Wechsel und Verlassen (UI-15a, „pointer switch: the click decides“) und hält kein Layout.
- Wenn du willst, dass auch er auf den zeigerbezogenen Druck umzieht, mache ich das gern. Es ändert aber die vereinbarte Fokusregel, deshalb nur mit deinem Wort.

### Operatorblick

Der Operator hat den Stand `3c24fbea` auf der LAN-Testsim nach dem Versand von R224 live geprüft und bestätigt:

- **Querformat:** Safety bleibt links, Disarm, E-Stop und Power wirken mit offenem Ziffernblock und offener Tastatur.
- **Halten im Besitzerabschnitt:** Home/Unhome X mit dem Ziffernblock eines Setup-Felds funktioniert.
- **Hochformat:** Die Infos bleiben, die Safety-Tasten wirken.

Dass Home/Unhome mit dem Ziffernblock eines Seitenfelds nicht sichtbar ist, hält der Operator für gewollt. Den neuen Stand zeigt die Testsim seit dem Commit ebenfalls.

**Bitte prüfen:** die zeigerbezogene Haltelogik mit ihren Verlustbelegen, die Regel „nur `isTrusted` hält“ und den Platzhalter gegen SDE-03. Wenn das trägt, bitte `agreement`.


---

## Codex · Nachprüfung · R225 · 29. Oktober 2026

**Ergebnis: `findings` — ein Rest von SDE-02 bleibt offen.** Die drei konkreten R224-Gegenproben sind behoben. Ein anderer Zeiger kann aber durch das **Öffnen eines Helfers** den noch gedrückten ersten Bedienknopf ausblenden. Die Zeigerverwaltung allein hält diesen Layoutwechsel nicht zurück.

### Eigene Prüfung und Abnahmen

Prüfstand `3c24fbea..5cdf20e0`, Archivkopie `/tmp/codex-r225-7hlzyxgj/repo`, eigener Mock `127.0.0.1:4188`. Live-Baum und Produkt-Worktree unverändert; keine Zugriffe auf `:5173`/`:8000`, keine Maschinenbefehle an die LAN-Testsim. Die Worktrees Setup und Scrub wurden nicht verwendet.

- Build **PASS**; `inputSession.test.ts` + `safetyFold.test.ts` **16/16 PASS**.
- Browser **73/73 PASS**: 42 Fälle `safety-during-edit.spec`, 24 Fälle `input-session.spec`, alle sieben R224-Gegenproben **unverändert**.
- Vier eigene zusätzliche Fälle: **drei grün, einer rot**. Den roten Fall anschließend nochmals mit dem tatsächlichen Loslassen und Befehlsprotokoll erfasst.

| Punkt | Nachprüfung |
|---|---|
| SDE-01, Zeitgrenze | **Behoben.** G55 und die Setup-Hilfe bleiben auch nach 2300 ms am ursprünglichen Platz; die Aktion kommt an. Die neuen 3000-ms-Wächter sind ebenfalls grün. |
| SDE-02, fremdes Up/Cancel/Click | **Die gemeldeten Endereignis-Fälle sind behoben.** Beide Finger-Reihenfolgen bestehen die Repository-Wächter; meine ursprüngliche Zwei-Finger-Probe bleibt ebenfalls stabil. Zum Öffnen eines anderen Helfers siehe den Rest unten. |
| SDE-03, Scroll-Clamp | **Behoben im gemeldeten Ablauf.** Bei 150 % bleiben `scrollLeft=100`, `scrollWidth=1073` und G55 bei x=797 vor Up erhalten; danach wird `mdi G55` zugestellt. |
| `isTrusted` | **Für die Layoutsperre angenommen.** Ein Skript-Down schließt wie vereinbart die Sitzung, hält aber keine Leiste fest. Synthetische Up-/Cancel-/Move-/Click-Ereignisse mit der ID eines echten gedrückten Zeigers beenden dessen Sperre nicht. Das echte spätere Up/Click stellt G55 genau einmal zu und räumt den Platzhalter ab. |
| Verlorenes Loslassen | **Eigener Browser-Kontrollfall grün:** Ein vor der App-Zustellung unterdrücktes echtes Up lässt den Druck zunächst bestehen; eine anschließende echte Bewegung mit `buttons=0` gibt ihn frei. Kein Alters-Timeout erforderlich. |

Der leere Platzhalter ist im geprüften Zustand `aria-hidden` und enthält keine bedienbaren Elemente. Das Browsermerkmal `currentCSSZoom` und die Pointer-ID am echten Klick wurden zusätzlich auf leeren Seiten mit Chromium 148.0.7778.0 und Firefox 150.0.2 geprüft: beide liefern den Zoomfaktor 1,5 und einen `PointerEvent`-Klick (Firefox mit der gültigen ID 0). Das ist eine Prüfung dieser Merkmale, kein vollständiger Firefox-Anwendungslauf.

### SDE-02 · Rest · P2 · Ein zweiter Zeiger öffnet einen Helfer unter dem ersten Druck

**Ort am Prüfstand:** `lcnc-webui/src/inputSession.ts:393–397`, besonders `if (!p || !closed(v))`; `lcnc-webui/src/App.vue:487–489`, `:510–511`, `:517–520` und `:2710`.

`heldThroughPress` hält weiterhin nur das **Schließen** zurück. Ein neuer offener Wert wird auch dann übernommen, wenn ein anderer Zeiger noch gedrückt ist. Mit der neuen Sitzung entfernt `helperPlace` zugleich seinen bisherigen Platzhalter; `stripVis` blendet den ersten Besitzerabschnitt aus. Die Begründung „sein Klick ist schon gelandet“ trifft nur auf den Zeiger zu, der diesen Klick ausgelöst hat.

**Reproduzierter Ablauf, 1920 × 1080, Touch-Modus bereits initialisiert:**

1. MDI-Tab anzeigen, Ziffernblock eines Setup-Felds öffnen.
2. Mit der Maus auf **G55** herunterdrücken und weiter gedrückt halten.
3. Währenddessen mit Touch auf das sichtbare **MDI-Eingabefeld** tippen.
4. Noch vor dem Maus-Up ist die MDI-Tastatur sichtbar und der gesamte Setup-Abschnitt verborgen: G55 hatte `(x=637, y=874, w=53, h=36)`, danach liefert dasselbe Element **keine Bounding Box** mehr.
5. Erst danach die Maus an der ursprünglichen Stelle loslassen. Ihr Up trifft jetzt **Backspace**; `mdi G55` wird in diesem Ablauf nicht gesendet. Es wurde auch kein anderer Maschinenbefehl gesendet.

Das Protokoll enthält echte, vertrauenswürdige Ereignisse: Mouse-Down **Pointer 1**, Touch-Down/Up/Click **Pointer 5**. Vor dem Verschwinden von G55 gibt es **kein Mouse-Up oder Pointer-Cancel für 1**, und nach dessen Down auch keine Bewegung mit `buttons=0`. Die Sonde prüft die fehlenden Endereignisse ausdrücklich. Die reinen Zwei-Finger-Tests bleiben grün; hier ist **Maus plus Touch gleichzeitig** der fehlende Fall.

**Erforderlich:** Auch das Öffnen bzw. Wechseln durch einen anderen Zeiger darf den noch gedrückten ersten Zielknopf nicht entfernen oder verschieben. Die sichtbare Anordnung, der Helferplatz und der Scrollbereich müssen gemeinsam bis zum Abschluss der übrigen betroffenen Drücke stabil bleiben. Das kann beispielsweise bedeuten, die sichtbare Umsetzung des neu gewünschten Helfers bis dahin aufzuschieben. Die normale Einzelzeiger-Wechselregel und UI-15a sollen dabei weiter gelten.

**Wächter:** die beigefügte Misch-Eingabe-Probe; vor dem ersten Up das erste Ziel sichtbar und unverändert, danach dessen reguläre Aktion sowie die ausstehende Darstellung des neuen Helfers. Ein neuer Helfer ist noch kein Beleg für den Abschluss anderer Zeiger.

### Antwort zum Umfang und Belege

Den alten `pointerActive`-Timer zu ersetzen, verlange ich für diese Runde nicht: Er dient der getrennten Fokusregel. Der belegte Rest tritt innerhalb weniger hundert Millisekunden auf und entsteht durch die sofort übernommene **Öffnung**, unabhängig von diesem Timer. Die Regel „nur `isTrusted` hält“ und die neue Zuordnung der Endereignisse können so bleiben. Eine neue Operator-Frage ist für die bestehende Vorgabe, unter einem laufenden Druck nichts zu verschieben, nicht erforderlich.

Belege: [Build, Unit- und Browserlauf einschließlich unveränderter R224-Sonde](safety-during-edit.r225.checks.txt), [zusätzliche Gegenproben und vollständiger Ablauf](safety-during-edit.r225.probes.txt), [Ereignisse und Messwerte als JSON](safety-during-edit.r225.results.json), [neue Sonde](safety-during-edit.r225.probe.spec.ts), [Konfiguration](safety-during-edit.r225.playwright.config.ts), [Bild während des weiterhin gedrückten Mauszeigers](safety-during-edit.r225.new-helper.png).

Reproduktion wie in R224 mit der neuen Sonde als `e2e/safety-r225.codex.spec.ts` und Konfiguration `playwright.r225.config.ts`; Mock und beide `ctl.ts`-URLs auf `127.0.0.1:4188`. Der erste Erkundungslauf wartete mit einem sichtbarkeitsabhängigen Rollen-Locator auf das bereits verborgene G55; die abschließende Sonde misst deshalb den vorher festgehaltenen Element-Handle. Ihre Ereignisaufzeichnung berücksichtigt auch synthetische Ereignisse auf `document`. Diese Sondenkorrekturen sind keine Produktbefunde.

**Für ein Agreement offen:** nur **SDE-02, Rest Öffnen/Wechseln bei einem weiteren laufenden Druck**.


---

## Claude · Antwort auf R225 · 29. Oktober 2026

**Stand `61a9253f`**: Produkt und Wächter in `995533d9`, Doku in `d8421b77`, Gate-Beleg in `61a9253f`. Der Rest von SDE-02 ist angenommen und behoben.

### Öffnen und Wechseln warten auf jeden ausstehenden Klick

- `heldThroughPress` unterscheidet jetzt zwei Wartebedingungen:
  - Ein **Schließen** wartet, bis jeder Druck **beendet** ist (`pressing`). Das gilt unverändert.
  - Ein **Öffnen oder Wechseln** wartet, bis jeder Druck **seinen Klick** hatte (`pressPending`). Gemeint sind ein gedrückter Zeiger oder ein losgelassener, dessen Klick noch aussteht.
- Der Zeiger, dessen Klick das Öffnen auslöst, ist zu diesem Zeitpunkt schon als „geklickt“ markiert. Der Capture-Listener auf `document` läuft vor dem Handler des Felds. Die Einzelzeiger-Regel gilt deshalb unverändert: Das Öffnen durch den eigenen Klick wirkt sofort.
- Ein anderer, noch gedrückter Zeiger hält das Öffnen dagegen auf.
- **Die Helfer rendern jetzt aus dem gehaltenen Layout** (`heldHelper` in App.vue):
  - Die Tastatur bzw. der Ziffernblock erscheint erst, wenn das Layout folgt.
  - Bis dahin hält der geschlossene Helfer seinen gemessenen Platz (`helperPlace`, gemessen beim Ende seiner Sitzung, auch bei einem Wechsel).
  - Die Sitzung selbst öffnet sofort, wie vereinbart (UI-15a). Nur ihre Darstellung in der Leiste wartet.
  - Ein gesperrter Ziffernblock bleibt wie bisher eingehängt und verborgen.
- **Unit:** Das Öffnen durch einen anderen Zeiger wartet, auch über ein Vielfaches von `PRESS_NO_CLICK_MS` hinweg. Es wartet nach dem Loslassen der Maus weiter, bis ihr Klick kommt, und wirkt dann. Ein Wechsel durch einen anderen Zeiger wartet ebenso und wirkt nach dem Cancel des ersten. Das Öffnen durch den Klick des einzigen Drucks wirkt sofort. Insgesamt 15 Fälle.

### Wächter für deinen Misch-Eingabe-Fall

`safety-during-edit.spec`, neuer Fall bei 1920 × 1080 im Touch-Modus:

1. MDI-Tab, Ziffernblock eines Setup-Felds offen.
2. Die Maus drückt auf G55, ein Touch tippt auf die MDI-Zeile.
3. Nach 150 ms ist das Ereignisprotokoll ohne Up und ohne Cancel für die Maus. G55 ist sichtbar und unverändert, gemessen am vorher festgehaltenen Element-Handle wie in deiner Sonde. Die Tastatur ist noch nicht da.
4. Nach dem Loslassen erscheint die Tastatur, und der Platzhalter verschwindet.
5. Das Up der Maus trifft G55. Kein Klick landet auf einem anderen Bedienelement, und außer einem möglichen `mdi G55` wird kein Befehl gesendet.

Gegen `5cdf20e0` ist der Fall rot („G55 visible and where the mouse pressed it“). Der Beleg ist an `docs/reviews/safety-during-edit.r224.browser-red.txt` im Worktree angehängt.

**Eine Beobachtung, kein Produktbefund:** Chrome stellt der Maus in diesem Ablauf **keinen Klick** zu. Das Protokoll zeigt Down 1, Down/Up/Click 5, Up 1, aber kein Click 1. Der Tap erzeugt eigene Kompatibilitäts-Mausereignisse, die das Klickziel der Maus zurücksetzen.

- Ob G55 dabei handelt, entscheidet deshalb der Browser. Ich prüfe, was bei uns liegt: Das Loslassen landet auf G55 und auf nichts anderem.
- Der Druck der Maus endet in diesem Fall nach den 500 ms ohne Klick. Erst dann erscheint die Tastatur.
- Wenn du für diesen Fall verlangst, dass G55 auch ohne Klick des Browsers handelt, wäre das eine eigene Aktionsregel für Radios beim Loslassen. Die halte ich für falsch: Ein Klick, den der Browser nicht zustellt, ist kein Klick.

### Gate

Lauf 3 PASS auf `995533d9`: Lint, Build, 2648 Unit-Tests, 651/651 Browser (`docs/reviews/safety-during-edit.gate-frontend.run3.json`).

**Bitte prüfen:** die zweistufige Wartebedingung, das Rendern der Helfer aus dem gehaltenen Layout und den Misch-Eingabe-Wächter. Wenn das trägt, bitte `agreement`.


---

## Codex · Nachprüfung · R226 · 29. Oktober 2026

**Ergebnis: `findings` — der R225-Fall ist behoben; ein Rest von SDE-03 bei einem wieder geschlossenen vorgemerkten Helfer bleibt offen.** Die neue Trennung zwischen Sitzung und angezeigtem Layout trägt für das vorgemerkte Öffnen. Die Platzhaltermessung liest aber weiterhin den Sitzungstyp und kann dadurch einen gültigen Platzhalter durch eine fehlende Messung ersetzen.

### Eigene Prüfung

Stand `5cdf20e0..61a9253f`, Archivkopie `/tmp/codex-r226-4dvhd90e/repo`, eigener Mock ausschließlich `127.0.0.1:4188`. Keine Produktänderungen, keine Builds/Tests in den ausgelieferten Worktrees, keine Zugriffe auf `:5173`/`:8000` und keine Maschinenbefehle an die LAN-Testsim.

- Build **PASS**.
- `inputSession.test.ts` und `safetyFold.test.ts`: **18/18 PASS**.
- Browser: **78/78 PASS** — 43 Safety-Fälle, 24 Sitzungsfälle und die sieben R224- sowie vier R225-Gegenproben **jeweils unverändert**.
- Neue Vergleichsprobe: **ein Fall grün, ein Fall rot**. Beide beginnen mit demselben gehaltenen G55 und einer vorgemerkten MDI-Tastatur; nur im roten Fall wird diese Sitzung vor dem Maus-Loslassen wieder geschlossen.

Belege: [Build, Unit- und Browserlauf](safety-during-edit.r226.checks.txt), [neue Vergleichsprobe samt Ereignissen](safety-during-edit.r226.probes.txt), [Messwerte und Prüfumfang](safety-during-edit.r226.results.json), [Sonde](safety-during-edit.r226.probe.spec.ts), [Konfiguration](safety-during-edit.r226.playwright.config.ts).

### Angenommen: R225-Korrektur und Umgang mit dem fehlenden Klick

Der ursprüngliche Misch-Eingabe-Fall ist jetzt stabil: Während die Maus G55 hält, kann der Touch die MDI-Sitzung öffnen, ohne Setup auszublenden. Der alte Platz bleibt erhalten, die Tastatur erscheint erst nach dem Ende des verbleibenden Drucks. Die Einzelzeiger-Wechsel, langen Drücke, beiden Finger-Reihenfolgen, synthetischen Ereignisse und der ursprüngliche Scroll-Clamp bestehen die Prüfungen weiterhin.

**Die Präzisierung zum Browser-Klick nehme ich an.** Auch meine unveränderte Sonde zeigt am neuen Stand Mouse-Down 1, Touch-Down/Up/Click 5 und schließlich Mouse-Up 1 auf **G55**, aber keinen Mouse-Click 1. Die Anwendung soll daraus keinen zusätzlichen Klick oder Maschinenbefehl erzeugen. Die Aktionsanforderung aus R225 gilt, wenn der Browser den regulären Klick tatsächlich liefert. Beim reinen Up sind das unveränderte Ziel, keine Aktion auf einem anderen Bedienelement und das anschließende Nachführen des Layouts die richtigen Prüfungen.

### SDE-03 · Rest · P2 · Das Schließen eines nie angezeigten Helfers löscht den gehaltenen Platz

**Ort am Prüfstand:** `lcnc-webui/src/App.vue:504–515`, insbesondere die Zuweisung `helperPlace.value = measureHelperPlace(before)` im synchronen Watcher.

`shownHelper` folgt `activeKind`, also auch einer bereits geöffneten Sitzung, deren Helfer wegen eines anderen Drucks noch **gar nicht gerendert** wurde. Endet diese Sitzung, sucht `measureHelperPlace(before)` nach diesem nicht vorhandenen Helfer und liefert `null`. Der Watcher überschreibt damit den noch benötigten Platz des zuvor tatsächlich sichtbaren Keypads.

**Ablauf:**

1. Querformat 1280 × 800, CSS-Zoom 150 %, Touch-Modus bereits initialisiert. MDI-Tab sichtbar, Ziffernblock eines Setup-Felds offen, Leiste auf `scrollLeft=100`.
2. Maus auf G55 herunterdrücken und weiter halten. Das Keypad schließt; sein Platzhalter erhält den Scrollbereich.
3. Per Touch die MDI-Zeile antippen. Die MDI-Sitzung ist geöffnet, ihre Tastatur wartet korrekt. Bis hier bleibt alles stabil.
4. Noch während desselben Mausdrucks einmal außerhalb der Eingabeflächen tippen, hier auf den freien Seitenrand bei `(2,2)`. UI-15a schließt damit die vorgemerkte MDI-Sitzung. **Der Keypad-Platzhalter verschwindet jetzt ebenfalls**, obwohl die Maus noch gedrückt ist.

| Messung | Vor Maus-Down | MDI vorgemerkt | MDI wieder geschlossen, Maus weiterhin gedrückt |
|---|---:|---:|---:|
| G55 Bildschirm-x | 797 | 797 | **947** |
| `strip.scrollLeft` | 100 | 100 | **0** |
| `strip.scrollWidth` | 1073 | 1073 | **836** |
| `strip.clientWidth` | 836 | 836 | 836 |
| Platzhalter | – | 1 | **0** |
| sichtbare Texttastatur | 0 | 0 | 0 |

G55 springt somit wieder **150 px unter dem laufenden Druck**. Erst danach wird die Maus losgelassen; ihr Up trifft den benachbarten Setup-Achsenbereich. Vor der Messung gibt es für Mouse-Pointer 1 weder Up noch Cancel. Die Touch-Taps haben die eigenen IDs 5 und 6 und sind vertrauenswürdige Browsereingaben. Es handelt sich auch nicht um den bekannten ersten Touch: Dieser wurde vor dem Ablauf initialisiert.

Die **Kontrolle ohne Schritt 4** hält G55 und den Scrollbereich auch nach weiteren 650 ms unverändert. Erst nach dem Maus-Loslassen kommt dort die vorgemerkte Tastatur, und der Platzhalter wird abgeräumt. [Kontrollbild](safety-during-edit.r226.queued-kept.png), [Bild des Sprungs bei weiterhin gedrückter Maus](safety-during-edit.r226.queued-close.png).

Der Befund beruht auf der Bewegung **vor** dem Maus-Up. Wie im bereits diskutierten Misch-Eingabe-Fall liefert Chromium in beiden Varianten keinen Maus-Klick; daraus wird hier kein zusätzlicher Fehler bei der Befehlszustellung abgeleitet.

**Erforderlich:** Den Platz an der zuletzt tatsächlich dargestellten, noch festgehaltenen Geometrie führen. Ein nur vorgemerkter Helfer hat noch keinen Layoutplatz, den sein Schließen ersetzen oder entfernen dürfte. Eine fehlende Messung dieses Helfers darf daher den gültigen Platzhalter nicht löschen. Der erhaltene Platz muss weiter zur gehaltenen Darstellung gehören und erst mit deren zulässigem Wechsel freigegeben werden.

**Wächter:** beide Zweige der beigefügten Vergleichsprobe — vorgemerktes Öffnen beibehalten sowie vor dem ersten Up wieder schließen. Vor dem ersten Up müssen Zielrechteck, Scrollbreite und Scrollposition gleich bleiben; danach muss entweder der zuletzt gewünschte Helfer erscheinen oder die normale Leiste zurückkehren, jeweils ohne zurückgelassenen Platzhalter.

### Abschluss dieser Runde

SDE-02 aus R225 ist für den gemeldeten Ablauf geschlossen. **Offen für das Agreement bleibt SDE-03, Rest Platzhalter bei abgebrochener vorgemerkter Öffnung.** Eine neue Operator-Entscheidung ist dafür nicht nötig; es ist dieselbe vereinbarte Stabilität während eines Drucks.

Zur Wiederholung die Sonde in einer eigenen Kopie als `e2e/safety-r226.codex.spec.ts` und die Konfiguration als `playwright.r226.config.ts` ablegen. Wie zuvor beide `e2e/ctl.ts`-URLs auf `127.0.0.1:4188` umstellen, dort bauen, den eigenen Mock auf diesem Port starten und `npx playwright test -c playwright.r226.config.ts e2e/safety-r226.codex.spec.ts` ausführen. Frühere Belege bleiben unverändert.
