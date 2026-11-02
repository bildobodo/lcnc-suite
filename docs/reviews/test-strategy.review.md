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

## Codex · Planreview R248 · 2. November 2026

**Urteil: `findings`.** Die drei Stufen, die Trennung der acht schweren Dateien und ein kleiner echter Firefox-Satz sind die richtige Richtung. Ich stimme der Reduktion der Rundenläufe ausdrücklich zu. Vor dem Bau fehlen sechs Verträge, damit „weniger Tests“ nicht zu „unbekannte Abdeckung, trotzdem grün“ wird. Das sind Planbefunde, keine Bewertung einer schon gebauten Auswahl.

Geprüft: `93e8ae29`, diese Datei, die Bestandsaufnahme und die tatsächlichen Konfigurationen, Testabhängigkeiten, Nutzlastprüfung und Antastroutine. Keine Builds, Browserläufe oder Maschinenzugriffe. Eine kleine Gegenprobe lief mit einer **Kopie** von `command_policy.py` unter `/tmp`; sechs Ergebnisse sind unten verlinkt. Die genannten Gate-Zeiten habe ich nicht neu gemessen.

### TS248-01 · Auswahl muss auch jede Änderung abdecken, einschließlich Dateilesungen

**Offen, P1 für die Aussage des Gates.** „Jeder Spec hat einen Eintrag“ sichert nur eine Richtung. Eine neue Quelldatei ohne passenden Bereich oder eine verschobene gemeinsame Datei kann weiterhin nur den Kern auslösen. Zudem ist der Importgraph für die schwere Gruppe nachweislich nicht vollständig: `collisionContacts`, `collisionRangeOracle`, `sweepShards`, `contactViewCross`, `collisionLineSample`, `collisionOracle` und `collisionBounds` lesen Dateien mit `fs.readFileSync`; `collisionFixtures.ts` lädt u. a. INI-Inhalte und Modellgeometrie unter `examples/sim_config/` und `lcnc-gateway/machine/`. Eine reine STL-/INI-Änderung erreicht diese Tests nicht über einen Import. Vitest beschreibt `related` als Auswertung statisch bestimmbarer Imports; gewöhnliche Dateilesungen sind kein solcher Import. [Vitest-4-CLI](https://v4.vitest.dev/guide/cli#vitest-related)

**Vertrag ergänzen:**

- Jede geänderte Datei erhält eine Entscheidung: konkrete Testbereiche, voller zuständiger Lauf oder ausdrücklich begründete Kategorie ohne Produkttests. Unbekannt bedeutet voller zuständiger Lauf oder Fehler vor dem Gate, niemals „nur Kern“. Zuordnung in beide Richtungen prüfen; obsolete Regeln und leere Treffer sichtbar machen.
- Die Änderungsmenge ist ein benannter Basis-/Zielstand. Für die Paketabnahme umfasst sie das ganze Paket seit der abgenommenen Basis, nicht nur den letzten Fix-Commit. Hinzufügen, Löschen und Umbenennen berücksichtigen; bei Umbenennen beide Pfade. Fehlende Git-Basis ist kein leerer Diff. Uncommittierte Eingaben entweder ablehnen oder samt Inhalt eindeutig protokollieren.
- Neue/geänderte Tests selbst laufen immer, auch aus `HEAVY_UNIT`; explizite Datenabhängigkeiten ergänzen `related --run`. Die acht Dateinamen sind eine überprüfte Liste, keine unscharfen Teilstrings. Für Modelle/Fixtures/INI/Var-Dateien und Generatoren gibt es Regeln außerhalb von `src/`.
- Auswahl-Wächter benötigen Gegenfälle: neue unzugeordnete Quelle, umbenannte zentrale Quelle, geänderter schwerer Test und reine Modell-/Fixture-Änderung. Das prüft den Mechanismus statt lediglich die Eintragszahl.

Zur Frage nach gemeinsamen Dateien: Es fehlen mindestens `lcncWs.ts` (liegt **nicht** unter `ws/**`), `lcncApi.ts`, `auth.ts`, `connKey.ts`, gemeinsame Eingabe-/Fokus-/Modalhelfer sowie `DialogFrame.vue`, `TabNav.vue`, `ChoiceGroup.vue`, Theme-/Font-Ressourcen und Vite-/Vitest-/TS-Konfiguration. Nicht jede dieser Dateien muss stets alles auslösen: Eine ausdrücklich breite Bereichszuordnung ist in Ordnung. Eine kurze Handliste allein trägt die Behauptung „fail-closed“ aber nicht.

### TS248-02 · Backend und bestehende Abnahmearten dürfen nicht zwischen die Stufen fallen

**Offen, P2.** Das Rundengate nennt nur Frontend-Lint/Build/Unit/Browser; Backend steht erst beim Merge. Damit hätte gerade die geplante Änderung an `command_policy.py` keine benannte Backend-Prüfung in ihrer Umsetzungsrunde. Der bisherige Runner enthält außerdem `5axis-model` und gesonderte Skript-Tests; die bestehende Live-Stufe enthält Preview-Goldens, native Parität und weitere TWP-Prüfungen. Die neue Aufzählung lässt offen, ob diese bestehen bleiben oder entfallen.

**Vorschlag:** Zunächst das vorhandene Backend-Offline-Gate bei Änderungen an Gateway, Backend-Abhängigkeiten und zugehörigen Skripten/Daten laufen lassen; reine UI-Runden können es mit genanntem Grund auslassen. Erst nach Laufzeitdaten ein eigenes abgesichertes Backend-Subset einführen. Alle bisherigen Gate-Arten einmal einer Stufe und einem Auslöser zuordnen. Insbesondere dürfen native Parse-/Paritätsnachweise nicht durch den Antastlauf oder `twp_buttons_check.py` ersetzt werden.

Die JSON-Abnahme nennt Basis/Ziel, tatsächlichen Baum, Konfiguration/Browser, gewählte **und ausgelassene** Prüfungen, Gründe, Ergebnis, Dauer und Skips. Ein nötiger, aber nicht ausführbarer Live-Test bleibt „ausstehend“; ein grünes Offline-Gate wird dadurch nicht zur vollständigen Abnahme. Ein Timeout, leere Testauswahl oder unerwarteter Skip darf kein PASS ergeben.

### TS248-03 · Der selektive Browserlauf muss die heutige Projektkette wirklich umgehen

**Offen, P2.** `playwright.config.ts` verkettet `serial-viewer → serial-visual → serial-layout → serial-guards → …`. Bei einer Dateiauswahl führt Playwright die Tests der abhängigen Projekte zusätzlich aus. Schon der feste Kern `tabs/dialogs` zieht mit der unveränderten Konfiguration Vorgänger mit; ein ausgewählter Viewer-Spec kann fast den gesamten Lauf zurückholen. Das ist kein theoretischer Importgraph-Einwand, sondern die gegenwärtige Startkonfiguration. [Playwright: Test filtering](https://playwright.dev/docs/test-projects#test-filtering)

**Festlegen:** Eigener selektiver Start ohne die Vollsuite-Abhängigkeiten, dabei weiterhin genau ein Besitzer des zustandsbehafteten Mocks. Beispielsweise eine ausgewählte Projektliste mit deaktivierten Abhängigkeiten und global einem Worker, oder eine eigene Konfiguration mit identischen Fixtures. `--list`/Discovery muss belegen, dass tatsächlich genau die gewählten Tests laufen. Keine parallelen Browserprojekte auf dem gemeinsamen Mock; kein fremder Vorschau-Server als still wiederverwendeter Prüfling.

**15 Minuten sind ein Ziel für selektive Runden, kein Abbruchbudget mit grünem Rest.** Ein durch gemeinsame Änderungen erforderlicher Volllauf darf länger dauern und wird als solcher benannt. Erst die Messung entscheidet, ob ganze `dialogs`-Dateien ein brauchbarer fester Kern sind. Wenn nicht, wenige benannte Kernfälle auslagern; nicht nach Zeit die restlichen Tests abschneiden. Pro Test/Spec und insgesamt Wandzeit, Retries sowie Umgebung/Workerzahl aufzeichnen. Schwerer Unit-Lauf und Browser-Messungen dürfen nicht gleichzeitig dieselbe VM belasten.

### TS248-04 · Schema- und Replay-Vertrag sind enger als „Schema-Konformität“

**Offen, P2.** Die Gegenprobe bestätigt: `validate_payload` lässt einen unbekannten Befehl, `mdi` ohne `text`, `mdi` mit zusätzlichem `vras` und eine negative `old_tool_number` ohne Ausnahme passieren. Das ist der dokumentierte Grenzprüfer-Vertrag, kein neuer Gateway-Handlerbefund. Bei einem überhöhten Feed-Override liefert er eine **Korrektur** zurück. Wer nur auf Exceptions prüft, bemerkt sie nicht. Die fehlende deklarierte Probe-Variable wird dagegen korrekt abgelehnt: Hier trifft das vorgeschlagene Replay den ursprünglichen Fehler.

Auch der statische Vergleich ist noch nicht ausführbar beschrieben: `save_tool`/`add_tool`/`renumber_tool` haben in `WsCommand` eine offene `[key: string]: any`-Signatur; `pocket` und `diameter` stehen im Schema, aber nicht explizit in diesen Typzeilen. Außerdem enthält das Backend Befehle wie `home`/`unhome`, die nicht als gleichnamige Varianten in dieser Union stehen. Ein Wildcard-Freipass würde gerade den `new_number`-Fehler wieder verdecken; pauschal jeder Schemaeintrag im Client wäre umgekehrt ein Fehlalarm.

**Mein kleinerer, konkreter Vertrag:**

- Testseitige, explizite Formbeschreibung der tatsächlich gesendeten Befehle: bekannte Befehle, Pflicht-/optionale Felder und benannte Erweiterungen für Werkzeugfelder sowie Transportfelder wie `req_id`. Server-only-Befehle separat begründen. Keine offene Indexsignatur als Beweis für ein bestimmtes Feld. Für TS ist die schon vorhandene TypeScript-API robuster als ein Zeilenregex; mindestens müssen verschachtelte Felder, optionale Felder und nicht auflösbare Typen definiert behandelt werden.
- Replay prüft diese Form **und** die vorgesehenen Grenzen/Var-Deklarationen. Es bleibt ausdrücklich kein Handler-/Gates-Test. Ausgeklammerte profilabhängige Grenzen nennen; gelieferte Korrekturen auswerten oder ausdrücklich als nicht geprüften Bereich ausweisen. Den von dir gefundenen Override-Faktor lieber mit einem kurzen UI-Verhaltenstest `50 % → scale: 0.5` prüfen als hierfür eine zweite Maschinenemulation bauen.
- Jede Logdatei gehört einem Lauf und muss vollständig geschrieben sein; fehlende/leere Datei ist kein erfolgreicher Replay. Test-/Fallherkunft mitführen. Absichtlich ungültige Nutzlasten nur mit konkreter Erwartung zulassen, keine globale Ausnahme pro Befehl. Der Antast-Klick muss tatsächlich vorhanden sein, wenn sein Spec lief; nicht nur sämtliche zufällig vorhandenen Zeilen abprüfen.
- Für die gemeinsame Menge geschriebener Probe-/Toolsetter-Variablen ist „gegen jede ausgelieferte Var-Datei“ sinnvoll. Beliebige maschinenspezifische Schreibvorgänge brauchen dagegen ihre deklarierte Fixture. Den neuen `probeVarFiles.test.ts` immer schnell laufen lassen; er schützt auch eine reine Var-Datei-Änderung ohne zufällig ausgewählten Antast-Browserfall.

Die `renumber_tool`-Korrektur an beiden tatsächlichen Nummern ist angenommen; dazu ein gerichteter negativer Grenztest und ein gültiger Renumber-Fall.

### TS248-05 · Firefox ist ein reproduzierbares eigenes Ziel, kein Ersatzbrowser bei Problemen

**Offen, P2.** Aktuelles Mozilla-Release statt lediglich des gebündelten Firefox ist für den beschriebenen Fehler plausibel. `moz-firefox` existiert als BiDi-Kanal bereits im Quelltext der hier angeforderten Playwright-Version 1.60.0; ich lehne den Vorschlag also nicht mit der alten pauschalen Aussage „nur gepatchter Firefox möglich“ ab. Die Eignung des konkreten Satzes und ESR ist damit noch nicht bewiesen. [Playwright 1.60.0: Registry](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/src/server/registry/index.ts)

**Festlegen:**

- Pflicht zunächst: Chromium vollständig und ein kompakter Satz auf einem **explizit gepinnten Mozilla-Release**. Dazu der tatsächliche Maschinenbrowser, falls er davon abweicht und unterstützt werden soll. „Debian, daher vermutlich ESR 140“ genügt nicht als Maschinenabnahme. Version aus dem laufenden Browser/Installation feststellen; `xdg-open` beweist sie nicht.
- Binary, Version, OS/Architektur, Playwright-Lock und Beschaffungsweg stehen im Beleg. `~/claude-work/ff/…` allein ist kein in CI reproduzierbares Setup. Neue Releases melden und kontrolliert übernehmen; ein Lauf ersetzt nicht unbemerkt seine Referenzumgebung. Fehlt das Pflicht-Binary oder ein benötigtes BiDi-Merkmal, ist der betreffende Nachweis offen/fehlgeschlagen, kein stiller Wechsel auf den gebündelten Firefox und kein grüner Skip.
- Pro Ziel eigene Bildpfade. Die heutige `snapshotPathTemplate` enthält **keinen Projektnamen**; bloß ein zweites Browserprojekt erzeugt deshalb noch keine getrennten Referenzen. Referenzen bewusst prüfen, nie beim Gate automatisch erneuern.
- Der echte Probing-Glyphenfehler muss mit der alten Darstellung in diesem Ziel rot und mit dem Fix grün werden. Bilder plus eine kleine Größen-/Inhaltsprüfung sind dafür sinnvoll. Die acht Prozeduren vollständig zählen. Erst ein kurzer Versuch mit `route`, Screenshot und den benötigten Eingabemitteln bestimmt den Kern; ≤ 5 min / ~20 s bleiben Messziele. Chromium-CDP-Touch ist kein Firefox-Nachweis. Scrollbar-Tests müssen nicht alle portiert werden; ein kleiner Firefox-Overflow-/Dialog-Fall ist sinnvoller als die pauschale Aussage, Scrollbarkeit sei dort durch den Kern geprüft.

### TS248-06 · Der Probe-Live-Check braucht einen abgeschlossenen Ablaufvertrag

**Offen, P2.** Die konkrete Routine prüft `#5400 == #3014`, führt `G92.1`, `M50 P0`, `G91/G90` und schließlich `G10 L2 P#5220` aus; am normalen Ende steht `M50 P1`. `sim_toolsetter` benötigt eine bekannte **positive Tabellenlänge**, um überhaupt automatisch auszulösen. „Über der Platte, Antwort ok, G54 geändert, Position zurück“ benennt diese Voraussetzungen und Nebenwirkungen nicht. Eine erfolgreiche Gateway-Antwort beweist außerdem die Zustellung, nicht das fehlerfreie Ende der Antastung.

**Ergänzen:** Unterstütztes Sim-Profil und geladener Code eindeutig prüfen, expliziter Bewegungs-Opt-in wie beim vorhandenen Live-Runner, bekannte Platte/Probe samt Werkzeugnummer und Länge, Einheiten, G54, TLO und G92 sowie freier Anfahr-/Rückzugsweg. Die gesendeten Panelwerte sind die durch den Replay geprüften Werte. Frisches Probe-Ereignis/#5070 und Ergebnisposition, Interpreter-Ende ohne Fehler sowie zurückgelesenes G54 Z mit begründeter Toleranz prüfen. Den erwarteten Offset unabhängig aus Platte und gewähltem Werkzeug-/Offsetzustand ableiten; vorhandenes G54 absichtlich davon verschieden wählen, sonst kann ein ausgebliebenes Schreiben grün aussehen.

Zustand vorab erfassen; auf dem erfolgreichen Pfad G54, Position **und die veränderten Modal-/Override-/Werkzeugzustände sowie Testparameter** wiederherstellen und zurücklesen. Auf Fehler/Timeout erst anhalten und Stillstand prüfen; eine Rückfahrt nur bei weiterhin gültigen Voraussetzungen. Bei Trip/Verbindungsverlust kein automatisches Quittieren oder Weiterfahren zur vermeintlichen Wiederherstellung, sondern genaue Restzustände nennen. Ein WS-Client mit Heartbeats bleibt durch Ausführung und Aufräumen verbunden. Der Lauf darf nie allein aus einem Bereichsmatch ungefragt die bereits benutzte Operatorsim übernehmen.

### Antworten auf die fünf Fragen und mein Gegenentwurf

1. **Ja, ein ausgewähltes Rundengate trägt die fachliche Runde**, wenn die obigen Auswahl-/Ergebnisverträge gelten und die Gegenprobe zum Befund darin enthalten ist. Ich würde **nicht** jede abschließende Codex-Runde pauschal nochmals zum Volllauf machen: Agreement zur Änderung und Merge-Gate sind getrennte Aussagen. Vor dem Merge muss der vollständige Lauf den tatsächlich integrierten Produktstand abdecken; ein bereits vorhandener Lauf auf identischem Stand und gleicher Umgebung wird wiederverwendet. Bei Integrationsänderungen, zentralen Änderungen oder unbekannter Zuordnung entsprechend erweitern. Reine Plan-/Textdiskussionen benötigen gar keinen Produkt-Build; „jede Codex-Runde“ bitte auf Umsetzungsrunden begrenzen.
2. **Die Liste ist nicht vollständig**; TS248-01 benennt die belegten Klassen. Vorrang hat die vollständige Entscheidung für jeden geänderten Pfad, nicht eine ständig längere globale Alles-Liste. Kleine Quellenänderungen wie `GcodePanel.vue` sollen nachvollziehbar Program-/Sim-/Eingabetests wählen können, ohne automatisch sämtliche Import- und Modelltests mitzunehmen.
3. **Mozilla-Release als Pflichtkern; tatsächlicher Maschinenbrowser zusätzlich, wenn verschieden.** Nicht zwei willkürlich vermutete Versionen. **Operatorfrage Q248-1:** Welcher Browser/Version läuft tatsächlich am Maschinen-PC, und soll ESR unabhängig davon offiziell unterstützt bleiben? Diese Inventur kann Claude zunächst durch vorhandene Maschinenangaben klären. Sie blockiert die übrigen Planentscheidungen nicht; eine ESR-Maschinenabnahme darf vorher nur nicht behauptet werden.
4. **Der enge Replay-Umfang reicht als zusätzliche Schicht**, mit TS248-04. Er ersetzt weder Handler-/Sitzungstests noch Live-Abläufe. Besonders HTTP-Schreibvorgänge samt `X-Conn-Key` bleiben außerhalb: Dafür gezielte bestehende Vertragstests erhalten und die belegte Lücke als nächsten kleinen Punkt führen, nicht heimlich in dieses Replay hineinbehaupten.
5. **Reihenfolge leicht ändern:** Messreporter und Firefox-Machbarkeitsprobe zuerst; danach die Auswahl zunächst im Trockenlauf neben einem ohnehin erforderlichen Vollgate prüfen. Sobald TS248-01..03 durch Wächter und eine Auswahl-/Ist-Liste belegt sind, selektiv schalten. Die schnelle Schema-/Var-Datei-Prüfung und den Antast-Klick nicht bis zur fertigen Stufeninfrastruktur aufschieben. Dann Referenzen/Firefox-Kern und der klar begrenzte Probe-Live-Check. So wird kein langer Zusatzlauf allein für die Planung nötig.

**Weitere kleine Verbesserungen mit gutem Ertrag:** Die in der Bestandsaufnahme gefundenen 42 Routine-Namen auf den tatsächlich ausgelieferten Suchpfaden prüfen; den Probe-Klick über die unterschiedlichen Sendeformen parametrisieren (nicht jede Glyphenvariante live fahren); für Werkzeug-Edit/Renumber und Feed-Skalierung je einen gezielten Verhaltenstest statt weiterer großer Screenshots. Längere Zufallssuchen gehören in eine getrennte, gezielt gestartete Stufe mit Seed/Abbruchgrund; die reproduzierbaren Regressionen daraus bleiben im regulären Satz. Einzeltest-Reruns dürfen einen vorangegangenen roten Gesamtstand nicht unsichtbar machen. Zusätzliche Hardware-Telemetrie ist für diesen Plan nicht nötig; eine kurze reale Touch-/Gamepad-/Browser-Checkliste ist hilfreicher.

### Belege und Abschluss

- [Gegenprobe](test-strategy.r248.policy-probe.py) und [sechs Ergebnisse](test-strategy.r248.policy-results.json): reine Nutzlastprüfung aus einer isolierten Kopie, keine Gateway-/Sim-Verbindung.
- [Lesebefunde und Reproduktion](test-strategy.r248.evidence.md), [Stand/Dateibindung](test-strategy.r248.metadata.json).

Bitte die sechs offenen Verträge in die nächste Planfassung übernehmen oder konkret beantworten. Keine Erweiterung zur vollständigen Browser-/Maschinenmatrix verlangt. Die Grundentscheidung **kurze gezielte Runden, vollständige Integration, getrennte Live-Abnahme** ist angenommen; das Gesamt-Agreement wartet auf diese Präzisierungen.
