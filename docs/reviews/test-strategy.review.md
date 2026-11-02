# Teststrategie — Stufen und vier neue Wächter

## Claude · Planrunde · 2. November 2026 · Design-Frage, kein Code-Review

### Anlass

Zwei Fehler kamen an jedem Gate vorbei. Beide liegen auf `fix/probe-vars` (769760ce, Gate läuft):

1. **Probing-Glyphen in Firefox 159:** neun 10-px-Punkte statt Glyphen.
   - Alle Browser-Tests laufen in Chromium.
   - Kein Test sah die Glyphen an.
   - Der in Playwright mitgelieferte Firefox 150 zeigt den Fehler nicht.
2. **Jeder Antastlauf abgelehnt:** Die Beispiel-Var-Dateien deklarierten #3015–#3059 nicht (W3).
   - Der Mock-Gateway prüft keine deklarierten Nummern.
   - Die Gateway-Tests nutzen erfundene Mengen.
   - Die Live-Abnahme prüft beim Antasten nur das Gate.

Eine Bestandsaufnahme (`test-strategy.coverage.md`) findet weitere Lücken derselben Klassen.

**Der Operator dazu:** „Aufwand und Ertrag muss stimmen. Die Tests dürfen nicht ewig dauern, damit wir noch vorankommen … ich weiss auch nicht ob immer alle Tests ablaufen müssen oder gewisse aufwendige Tests einfach in bestimmten grösseren Intervallen durchgeführt werden oder wenn der Code sie berührt.“ Er hat mich gebeten, das mit dir abzustimmen.

### Heute gemessen

| Schritt | Dauer pro Gate | Bemerkung |
| --- | ---: | --- |
| Lint | 8 s | |
| Build | 16 s | |
| Unit | 420–549 s | 2117 s Testzeit, davon **88 %** in acht Dateien |
| Browser | 2700–3181 s | 839 Tests, Chromium, allein |

Jede Codex-Runde wartet damit rund eine Stunde, auch für eine CSS-Zeile.

**Die acht schweren Unit-Dateien:** collisionContacts 357 s, collisionRangeOracle 337 s, sweepShards 255 s, contactViewCross 244 s, collisionLineSample 226 s, collisionOracle 169 s, collisionBounds 166 s, contactViewIndexed 106 s.

**Browser:** Laufzeiten pro Spec gibt es noch nicht, das Gate nutzt `--reporter=line`. Vorhanden sind nur die Anzahlen: layout 123, setup-layout 114, sim-panel.viewer 58, dialogs 57, collisions.viewer 50, safety-during-edit 48, keyboard-guards 30, bake-hold 27, touchoff 26 … (51 Dateien, 827 Tests auf development). Ich verspreche hier keine Browser-Zahlen. Der nächste volle Lauf zeichnet sie auf (JSON-Reporter), und mit ihnen wird die Stufung nachgeschärft.

### 1 · Drei Stufen

#### Runden-Gate

**Wann:** jede Codex-Runde. **Ziel:** ≤ 15 Minuten.

- Lint und Build.
- **Unit ohne die schwere Gruppe.** Die acht Dateien stehen in einer Liste (`HEAVY_UNIT`). Sie laufen trotzdem, wenn `vitest related <geänderte Dateien>` sie erreicht.
  - Unit-Tests importieren den Quellcode direkt, dieser Importgraph ist also verlässlich.
  - Erwartete Wandzeit ohne die Gruppe: rund 260 s Testzeit auf 4–6 Worker, also etwa 1–1,5 min. Das messe ich und lege es nicht fest.
- **Browser:** die Specs der berührten Bereiche plus ein fester Kern (smoke, tabs, dialogs).
  - **Auswahl** über eine Zuordnung Spec → Quellbereiche (`e2e/specAreas.ts`). Sie ist im Zweifel streng: Ein Vitest schlägt fehl, wenn ein Spec keinen Eintrag hat (Muster `tsconfigCoverage.test.ts` / `controlInventory.test.ts`).
  - **Gemeinsame Dateien erzwingen den vollen Lauf:** `style.css`, `App.vue`, `Btn.vue`, `MachineBtn.vue` und die übrigen `Machine*`, `permissions.ts`, `machineControls.ts`, `lcnc.ts`, `ws/**`, `defaults.ts`, `main.ts`, `e2e/mock-gateway.mjs`, `e2e/*fixtures*`/`ctl.ts`, `playwright.config.ts`, `package*.json`.
  - **Warum nicht Playwrights `--only-changed`:** Die Specs testen das gebaute `dist`, ihr Importgraph erreicht den Quellcode nicht.
- Die neuen schnellen Prüfungen aus Abschnitt 2a und 2b, über die Specs, die gelaufen sind.
- **Gate-JSON:** nennt die Stufe, die gewählten Specs und für jeden den Grund.

#### Merge-Gate

**Wann:** vor jedem Merge nach `development`, einmal pro Merge. **Dauer:** etwa 60–70 Minuten.

- Alles wie heute: Unit vollständig, Browser vollständig in Chromium, Backend.
- Dazu der Firefox-Kern (2c).
- Laufzeiten pro Spec werden aufgezeichnet.

#### Live-Stufe

**Was:** gegen die laufende Sim:
- der Antast-Live-Check (neu, 2e)
- `twp_buttons_check.py`
- `macro_live_check.py`
- der Werkzeugmesser-Readback
- `perf_matrix.py`

**Wann, als Regel:**
- wenn ihr Bereich berührt ist (dieselbe Zuordnung)
- immer vor einer main-Promotion
- sonst in einem festen Takt, den der Operator bestimmt. Mein Vorschlag: vor jedem Termin an der echten Maschine.

### 2 · Vier Wächter und eine Korrektur

#### a) Schema ↔ Client

**Statisch, Sekunden, Runden-Gate.**

**Prüfung:**
- Jedes Feld in `COMMAND_SCHEMA[cmd]` (`command_policy.py`) muss ein Feld sein, das der Client für diesen Befehl sendet. Quelle ist die `WsCommand`-Union in `lcnc.ts`: 70 einzeilige Einträge `| { cmd: "…"; feld: typ }`, per Regex verlässlich lesbar. Ein Lesefehler lässt den Test laut scheitern.
- Jedes gesendete Feld steht im Schema oder in einer Liste „ohne Grenze, mit Grund“.

**Rot:** `renumber_tool`. Das Schema begrenzt `new_number`, das nie gesendet wird. `old_tool_number` hat keine Obergrenze. Harmlos (ein falscher Wert ergibt „not found“), aber genau die Drift, die der Wächter fangen soll.

**Korrektur in derselben Welle:** Das Schema begrenzt `old_tool_number` und `tool_number`. `new_number` fällt weg.

#### b) Mock-Replay

**Sekunden nach dem Browser-Lauf, beide Gates.**

**Ablauf:**
1. Der Mock hängt jeden empfangenen Befehl an eine JSONL-Datei (Umgebungsvariable).
2. Ein Pytest schickt jeden durch `validate_payload`.

**Umfang mit Absicht eng:**
- Schema-Konformität.
- Deklarierte Var-Nummern gegen **jede** Beispiel-Var-Datei.
- **Keine Achs- und Geschwindigkeitsgrenzen:** Die Specs fahren erfundene Profile (9 Achsen, TWP), das würde falsch auslösen.
- **Keine Gates:** Das ist Zustand, keine Nutzlast.

**Rot-Beweis:**
- Die echte, abgelehnte `mdi` des Operators aus dem Trace (19:39:27) gegen die alte Var-Datei.
- Neu ein kleiner Spec, der einen Antast-Button klickt und das gesendete `mdi` mit `O<probe_…> CALL` und den Werten prüft. Das schließt zugleich die Lücke „kein Test klickt einen Antast-Button“. Am alten Stand muss das Replay ihn ablehnen.

#### c) Firefox-Kern

**Merge-Gate, Ziel ≤ 5 min.**

**Welcher Firefox:** Der mitgelieferte 150 hätte den Fehler nicht gezeigt, ein Projekt darauf wäre grün ohne Aussage. Vorschlag:
- **Aktuelles Release**, über Playwrights Kanal `moz-firefox` mit `executablePath`. Heute hier bewiesen mit 159.0 aarch64. Das Binary liegt fest unter `~/claude-work/ff/<version>`. Ein Skript meldet beim Merge-Gate, wenn Mozilla ein neueres Release hat; dann wird ersetzt.
- **Debians `firefox-esr` 140:** vermutlich der Browser des Maschinen-PCs, denn der Launcher öffnet den Standardbrowser per `xdg-open`.

**Satz:** smoke, tabs, dialogs, der Raster-Größen-Test (`fix/probe-vars`), die Probing-Referenzbilder (d).

**Vorher zu prüfen, nicht versprochen:**
- ob `route()`, `hasTouch` und `toHaveScreenshot` unter BiDi tragen
- `ignoreDefaultArgs: --hide-scrollbars` gilt nur für Chromium, deshalb bleiben Specs mit Scrollbalken-Band aus dem Firefox-Satz heraus.

#### d) Probing-Referenzbilder

**Etwa 20 s.** Ein Bild pro Prozedur (8), in Chromium und im Firefox-Kern, jeweils mit eigenen Referenzen (`visual.spec`-Muster).

#### e) Antast-Live-Check

**Live-Stufe, etwa 2 min.** `scripts/probe_live_check.py` nach dem Muster von `macro_live_check.py`:

1. Maschine an, referenziert, Machine-Kinematik.
2. Über der Platte von `sim_toolsetter` stehen; die Sim löst dort physisch aus.
3. `O<probe_z_minus_wco> CALL` mit den Werten des Panels starten.
4. Erwarten: Antwort ok, Antastung ausgelöst, G54 Z an der bekannten Plattenhöhe.
5. Danach G54 und Position wiederherstellen.

### 3 · Was ich nicht vorschlage

- **Den ganzen Satz in Firefox:** verdoppelt den längsten Schritt.
- **Hardware** (Touch-Panel, Gamepad, Kamera, echter HAL-Latch): gehört auf die Checkliste für den Maschinen-PC. Billig wäre höchstens, den ersten `pointerType` und das Gamepad-Mapping in den Trace zu schreiben. Das ist optional, sag, ob es sich lohnt.

### Reihenfolge des Baus (Vorschlag)

1. Die Stufen. Das ist der größte Zeitgewinn, und erst dann kosten die neuen Wächter keine Rundenzeit.
2. a mit der `renumber_tool`-Korrektur.
3. b mit dem Antast-Klick-Spec.
4. d.
5. c.
6. e.

### Fragen an dich

1. **Runden-Gate als Beleg:** Trägt ein Runden-Gate mit ausgewählten Specs als Beleg einer Runde, wenn der volle Lauf vor dem Merge kommt? Wann muss eine Runde trotzdem den vollen Lauf verlangen? Mein Vorschlag: bei gemeinsamen Dateien (Liste oben) und bei jeder Runde, die eine Abnahme schließt.
2. **Liste der gemeinsamen Dateien:** Ist sie vollständig, oder fehlt etwas, das still viele Specs trägt?
3. **Firefox:** Beide (aktuelles Release und ESR) oder einer?
4. **Replay-Umfang:** Reichen Schema und deklarierte Var-Nummern?
5. **Reihenfolge:** Stimmt sie?

Wenn der Plan trägt, bitte `agreement`, gern mit Änderungen. Dann baue ich in dieser Reihenfolge.
