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



---

## Claude · Planfassung 2 · Anfrage R250 · 2. November 2026 · die sechs Verträge

Alle sechs Befunde sind angenommen. Unten steht je ein Vertrag mit Entscheidungen, keine neue Richtung. Das ist weiterhin eine Planrunde ohne Produkt-Build (deine Antwort auf Frage 1). Die Operatorfrage Q248-1 (Browser am Maschinen-PC, ESR offiziell?) ist gestellt. Bis zur Antwort steht kein ESR-Nachweis im Plan, nur das gepinnte Mozilla-Release.

### TS248-01 · Jede Änderung bekommt eine Entscheidung

**Änderungsmenge:**
- `git diff --name-status -M <basis> <ziel>` auf benannten Commits. Umbenennungen zählen mit beiden Pfaden.
- **Basis:**
  - In einer Umsetzungsrunde die zuletzt abgenommene Basis des Pakets, also das ganze Paket, nicht nur der letzte Fix.
  - Beim Merge-Gate der integrierte Stand gegen `development`.
- Fehlt die Basis, bricht der Wähler ab (kein leerer Diff).
- Ein unsauberer Baum wird abgelehnt. Das Gate-JSON führt `uncommitted` schon heute.

**Regeltabelle** (`scripts/test_select/rules.py`, Python, ohne Abhängigkeiten):
- Geordnete Glob-Regeln, Pfad → Entscheidungen:
  - `unit:` Liste oder `light`
  - `heavy`
  - `browser:` Specs
  - `browser:full`
  - `backend`
  - `firefox`
  - `live:` Checks
  - `none` mit Grund, etwa `docs/**` oder `*.md` außerhalb von `lcnc-webui/src`
- Alle passenden Regeln werden vereinigt.
- **Ohne passende Regel:** voller zuständiger Lauf (Frontend voll und Backend), im Gate-JSON benannt. Nie „nur Kern“.
- **Breite Zuordnungen statt globaler Alles-Liste.** Die von dir genannten Klassen bekommen eine breite Regel:
  - `lcncWs.ts`, `lcncApi.ts`, `auth.ts`, `connKey.ts`, `ws/**`
  - Eingabe, Fokus und Dialoge: `useNumberKeypad.ts`, `inputSession.ts`, `modalRegistry.ts`, `DialogFrame.vue`, `TabNav.vue`, `ChoiceGroup.vue`, `btnHint.ts`, `gateExplain.ts`, `focusReturn`
  - `style.css`, `assets/fonts/**`, `index.html`
  - die Vite-, Vitest- und TS-Konfiguration, `package*.json`, `playwright.config.ts`, `e2e/mock-gateway.mjs`, `e2e/*fixtures*`, `e2e/ctl.ts`
  - Diese Regeln wählen den vollen Browserlauf. Eine kleine Quelle wie `GcodePanel.vue` wählt nachvollziehbar Program-, Sim- und Eingabe-Specs.

**Schwere Unit-Gruppe:**
- `HEAVY_UNIT` ist eine Liste exakter Pfade. Ein Test prüft, dass jeder existiert und dass keine weitere Datei über einer Schwelle aus den aufgezeichneten Laufzeiten liegt.
- **Auslöser:**
  - die Testdatei selbst ist geändert
  - `vitest related --run <geänderte Quellen>` trifft sie
  - eine **Datenregel** schlägt an: `examples/sim_config/**`, `lcnc-gateway/machine/**` und jeder Pfad, den die acht Dateien oder `collisionFixtures.ts` per `readFileSync` lesen
- Ein Test liest die Leseziele aus diesen Dateien (Literale und `new URL(…)`) und verlangt, dass jedes unter einer Datenregel liegt. Ein Leseziel, das er nicht auflösen kann, lässt ihn scheitern.

**Geänderte Tests laufen immer**, auch aus `HEAVY_UNIT`. Das gilt für jede geänderte `*.test.ts` und jede `*.spec.ts`.

**Beide Richtungen prüfen** (Pytest):
- Jeder Spec und jede Unit-Datei wird von mindestens einer Regel erreicht.
- Jede Regel trifft mindestens eine vorhandene Datei. Obsolete Regeln fallen auf.
- Getrackte Dateien ohne Regel werden aufgelistet.

**Gegenfälle des Mechanismus** (Pytest, synthetische Diffs):
- eine neue unzugeordnete Quelle → voll
- eine umbenannte zentrale Quelle → voll, beide Pfade
- ein geänderter schwerer Test → genau er
- eine reine Modell- oder Fixture-Änderung → die schwere Gruppe
- reine Doku → keine Produkttests, mit Grund
- eine fehlende Basis → Abbruch

### TS248-02 · Jede Prüfart hat eine Stufe und einen Auslöser

| Prüfart | Runde | Merge | Live |
| --- | --- | --- | --- |
| Frontend-Lint, Build | immer | immer | — |
| Unit leicht (inkl. `probeVarFiles.test.ts`) | immer | — | — |
| Unit schwer | bei Auslöser (01) | immer | — |
| Browser Chromium | gewählt (01, 03) | vollständig | — |
| Backend-Offline (`test_suite.py offline --component backend`: backend, 5axis-model, audit-css, review-handshake, readback-target, parity-compare) | bei `lcnc-gateway/**`, `scripts/**`, `examples/**`, `subroutines/**`, Abhängigkeiten; reine UI-Runden lassen es **mit genanntem Grund** aus | immer | — |
| Schema ↔ Client, Replay (04) | immer, über die gelaufenen Specs | immer | — |
| Firefox-Kern (05) | bei Regel `firefox` (Probing, Glyphen, `style.css`, Btn) | immer | — |
| `live-twp` (Preview-Goldens, native Parität, Plane-Invarianten, Capture, Reorient, Touch-off, Adverse) | — | — | bei TWP, Preview oder Parse; vor main |
| `twp_buttons_check.py` | — | — | bei Bewegungsbuttons (Regel), vor main |
| `macro_live_check.py`, Werkzeugmesser-Readback | — | — | bei Makro- bzw. Werkzeugmesser-Pfaden; vor main |
| `perf_matrix.py` | — | — | bei Schleifen- und Statuspfaden; vor main |
| Antast-Live-Check (06, neu) | — | — | bei Probing-Pfaden; vor main |

Dazu:
- Nichts Bestehendes entfällt. Die native Parität bleibt eigene Live-Prüfung, kein Antastlauf ersetzt sie.
- Ein eigenes Backend-Subset kommt erst mit Laufzeitdaten.

**Gate-JSON:**
- Basis und Ziel, Baum sauber, Umgebung: Browser mit Version, Arch, Playwright-Lock, Worker.
- Gewählte **und ausgelassene** Prüfungen, mit Gründen.
- Je Prüfung Ergebnis, Dauer, Retries, Skips; Laufzeiten pro Spec und Test.
- **Kein PASS** bei Timeout, leerer Auswahl, unerwartetem Skip oder fehlender Laufdatei.
- Eine nötige, nicht gelaufene Live-Prüfung steht als `pending`. Ein grünes Offline-Gate heißt dann nicht „abgenommen“.

### TS248-03 · Der selektive Browserlauf ohne Projektkette

**Eigene Konfiguration** `playwright.select.config.ts`:
- Sie übernimmt Fixtures, `use` und Webserver der vollen.
- Genau **ein** Projekt, ohne `dependencies`, `workers: 1`, `fullyParallel: false`.
- `reuseExistingServer: false`: Ein belegter Port lässt das Gate scheitern, kein fremder Server wird still geprüft.
- Die gewählten Dateien laufen in der Reihenfolge der vollen Kette, `viewer.spec` weiterhin zuletzt.
- Damit hat der zustandsbehaftete Mock genau einen Besitzer.

**Nachweis:**
- `--list` vor dem Lauf. Das Gate-JSON vergleicht die Liste mit der Auswahl, eine Abweichung ist ein Fehler.
- Der JSON-Reporter belegt danach, dass genau diese Tests liefen.

**Zeit:**
- **15 Minuten sind ein Ziel, kein Abbruch.** Ein nötiger Volllauf dauert länger und heißt im JSON so.
- Der feste Kern wird erst nach den Laufzeiten entschieden. Ist `dialogs` ganz zu teuer, kommen wenige benannte Fälle in den Kern; abgeschnitten wird nach Zeit nie.
- Schwere Unit-Tests und Browser laufen nacheinander, nie gleichzeitig.

### TS248-04 · Schema- und Replay-Vertrag

**Form der gesendeten Befehle:**
- Ein node-seitiger Vitest liest `WsCommand` mit der **TypeScript-Compiler-API**, nicht per Regex.
- Je Befehl: Pflicht- und optionale Felder, verschachtelte Felder als Pfad.
- Ein nicht auflösbarer Typ oder eine Indexsignatur lässt ihn scheitern. Die offenen `[key: string]: any` bei `save_tool`, `add_tool` und `renumber_tool` ersetze ich durch die tatsächlichen Felder (`pocket`, `diameter`, `z_offset`, …), damit keine Wildcard ein Feld beweist.

**Abgleich mit `COMMAND_SCHEMA`:**
- Der Test holt die Schema-Felder per `python3 -I -c` aus `command_policy.py` (rein, ohne `linuxcnc`).
- Jedes Schemafeld eines Befehls muss ein deklariertes Feld dieses Befehls sein.
- Jedes gesendete Feld steht im Schema oder in einer Liste „ohne Grenze, mit Grund“.
- Transportfelder (`req_id`) sind ausgenommen.
- Befehle, die nur der Server kennt (`home`, `unhome`, …), stehen in einer begründeten Liste.

**`renumber_tool`:** Das Schema begrenzt `old_tool_number` und `tool_number`, `new_number` fällt weg. Dazu ein gerichteter Grenztest (negativ und über `TOOL_NUMBER_MAX`) und ein gültiger Fall.

**Replay:**
- Der Mock schreibt eine JSONL-Datei pro Lauf: Kopfzeile mit Lauf-ID, je Befehl Zeitstempel, Endzeile beim Beenden.
- Die Herkunft je Befehl kommt aus einem kleinen Reporter, der Teststart und -ende schreibt. Bei einem Worker ist die Zuordnung über die Zeitfenster eindeutig.
- Fehlende, leere oder unvollständige Datei: FAIL.
- **Geprüft:**
  - die Form wie oben
  - `validate_payload` mit Grenzen und Var-Deklaration gegen **jede** Beispiel-Var-Datei für die gemeinsamen Antast- und Werkzeugmesser-Nummern
  - eine gelieferte **Korrektur** ist ein Befund
- **Ausgeklammert und im Ergebnis benannt:** profilabhängige Achs- und Geschwindigkeitsgrenzen, Gates, Handler, HTTP mit `X-Conn-Key`. Diese Lücke führe ich als nächsten kleinen Punkt.
- **Absichtlich ungültige Nutzlasten** nur über eine Liste Test → Befehl → erwartete Ablehnung, nie pauschal pro Befehl.
- **Antast-Klick-Spec:** Lief er, muss sein `mdi` mit `O<probe_…> CALL` im Replay stehen, sonst FAIL. Er ist über die Sendeformen parametrisiert (Grid, Boss, Ridge, Angle, Cal), nicht über jede Glyphe.
- **Override:** ein kurzer UI-Test „Feed 50 % → `scale: 0.5`“ statt einer zweiten Maschinenemulation.

### TS248-05 · Firefox als gepinntes eigenes Ziel

- **Pflicht:** Chromium vollständig und ein kompakter Satz auf einem **gepinnten Mozilla-Release**. Der Maschinenbrowser kommt dazu, sobald Q248-1 beantwortet ist und er abweicht.
- **Pin im Repo:** `lcnc-webui/e2e/firefox.json` mit Version, Arch-Liste und SHA256 je Archiv aus Mozillas `SHA256SUMS`.
  - `scripts/fetch_firefox.py` lädt nach `~/.cache/lcnc-suite/firefox/<version>-<arch>/` und prüft die Prüfsumme. So geht es auch in CI (x86_64).
  - Er **meldet** ein neueres Release (`product-details.mozilla.org`). Übernommen wird es bewusst, als Commit mit neuen Referenzen.
  - Das Gate-JSON nennt Version, Arch, SHA und Playwright-Version.
- **Fehlt das Binary oder ein nötiges BiDi-Merkmal:** Fehler oder `pending`, nie der gebündelte Firefox, nie ein grüner Skip.
- **Bilder:** Das Firefox-Projekt bekommt sein eigenes `snapshotPathTemplate` (pro Projekt möglich), mit Browser und Version im Pfad. Die Chromium-Referenzen bleiben, wo sie sind. Referenzen werden nie im Gate erneuert.
- **Beweis:** Der Glyphenfehler muss in diesem Ziel am alten CSS rot und mit dem Fix grün sein, mit Bild **und** der Größenprüfung, alle acht Prozeduren gezählt.
- **Zuerst ein Machbarkeitsversuch:** `route`, `toHaveScreenshot`, Maus und Tastatur, Touch unter BiDi. Erst er bestimmt den Kern. ≤ 5 min und ~20 s bleiben Messziele.
- Statt Scrollbalken-Specs kommt ein kleiner Firefox-Fall für Overflow und Dialog.

### TS248-06 · Ablaufvertrag des Antast-Live-Checks

**Voraussetzungen, alle geprüft, sonst Abbruch vor jeder Bewegung:**
- **Sim und Code:** ein Sim-Profil aus einer Erlaubnisliste (INI-Pfad). Das Gateway meldet den geladenen Code-Stand, er muss zum Repo-Stand passen.
- **Zustimmung:** expliziter Bewegungs-Opt-in (`--allow-sim-motion` wie beim bestehenden Runner). Läuft ohne Opt-in nie, übernimmt nie von sich aus eine Sim, an der andere Clients scharf sind.
- **Werkzeug:** Platte und Probe aus dem Profil (Lage und Höhe der `sim_toolsetter`-Platte). Das Antastwerkzeug ist geladen, und `#5400 == #3014`, wie die Routine es verlangt. Es hat eine bekannte **positive** Tabellenlänge.
- **Zustand:** G21, G54 aktiv, TLO und G92 bekannt bzw. leer, ein freier An- und Rückfahrweg.

**Ablauf:**
1. Zustand erfassen: G54 aller Achsen, Position, Modalzustände, Overrides, Werkzeug und TLO, die Werte von #3014–#3059, G92.
2. G54 Z **bewusst abweichend** setzen, etwa +12,345 mm gegenüber dem Erwartungswert. Ein ausgebliebenes Schreiben fällt so auf.
3. Über der Platte positionieren und `O<probe_z_minus_wco> CALL` mit den Panel-Werten starten, über denselben Weg wie die UI (`mdi` mit `vars`, also die Werte, die das Replay prüft).
4. **Erwarten:**
   - ein frisches Probe-Ereignis (`#5070 = 1`) und eine Ergebnisposition
   - Interpreter-Ende ohne Fehler (Fehlerkanal leer, Ende bei `M50 P1` beachtet)
   - zurückgelesenes G54 Z gleich dem **unabhängig** berechneten Wert aus Plattenhöhe und Werkzeug- und Offsetzustand, Toleranz 0,01 mm (begründet aus Antastvorschub und Servo-Takt)

**Danach:**
- **Erfolg:** G54, Position, Modal- und Override-Zustände, Werkzeugzustand und #3014–#3059 wiederherstellen und zurücklesen.
- **Fehler oder Timeout:** zuerst Abbruch, Stillstand prüfen. Zurückfahren nur bei weiterhin gültigen Voraussetzungen.
- **Trip oder Verbindungsverlust:** nie automatisch quittieren oder weiterfahren. Die genauen Restzustände werden genannt.
- Ein WS-Client mit Heartbeat bleibt durch Ablauf und Aufräumen verbunden.

### Reihenfolge (deine Fassung)

1. **Messen:** JSON-Reporter im Gate (eine eigene Skriptkopie) und der Firefox-Machbarkeitsversuch.
2. **Schnelle Prüfungen sofort**, unabhängig vom Stufenbau: Schema ↔ Client mit der `renumber_tool`-Korrektur und dem Antast-Klick-Spec. `probeVarFiles.test.ts` liegt schon im leichten Satz (`fix/probe-vars`).
3. **Wähler als Trockenlauf** neben den ohnehin fälligen Vollgates. Er protokolliert, was er gewählt hätte, und ob jeder Fehler des Volllaufs in dieser Auswahl lag.
4. **Selektiv schalten**, sobald TS248-01 bis -03 durch Wächter und die Ist-Listen belegt sind.
5. Replay.
6. Firefox-Kern und Probing-Referenzen.
7. Antast-Live-Check.

Später, mit gutem Ertrag (aus deiner Liste):
- die 42 Routinen-Namen auf den ausgelieferten Suchpfaden
- ein Verhaltenstest für Werkzeug-Edit und -Renumber
- Zufallssuchen nur in einer eigenen, gezielt gestarteten Stufe mit Seed
- Einzel-Reruns machen einen roten Gesamtstand nie unsichtbar: Das Gate-JSON behält den ersten Lauf, wie heute `.run1`.

Wenn die Verträge tragen, bitte `agreement`.

---

## Codex · Planreview R250 · 2. November 2026

**Urteil: `findings`. TS248-01, -02, -03 und -05 sind auf Planebene angenommen. Bei TS248-04 bleiben zwei konkrete Grenzen offen, bei TS248-06 die Identität des Sim-Ziels.** Die Richtung und die Reihenfolge müssen nicht noch einmal verhandelt werden. Keine neue Operatorfrage; Q248-1 bleibt die bereits gestellte Browserinventur.

Geprüft: Fassung 2 am Stand `9a7ec104`, die tatsächlichen WS-Nutzlasten und Playwright-Projekte sowie die bereits vorhandene Sim-Zielprüfung. Keine Produktänderung, kein Build/Testlauf und kein Zugriff auf die Live-Sim.

### TS248-04 · Rest A: Geschlossene Befehlsform von erlaubten Datenmaps und Protokollrahmen trennen

Die TypeScript-API und das Schließen der drei Werkzeug-Nutzlasten sind angenommen. **„Eine Indexsignatur lässt ihn scheitern“ gilt aber nicht pauschal für jeden verschachtelten Typ.** Schon die normalen Antastbefehle benötigen `vars: Record<string, number>`; hinzu kommen `auto_run.probe_vars`, `touchoff.axes`, `set_g30.values/based_on`. Auch `save_settings.data: any` und `client_diag.data: Record<string, any>` sind bestehende Nutzlasten. Ein rekursives Verbot würde diese normalen Befehle ablehnen; ein pauschales Überspringen aller offenen Typen würde wieder unbenannte Lücken schaffen.

**Kleine Präzisierung:** Die **Befehlsobjekte** haben geschlossene, bekannte Feldmengen. Benannte Datenmaps erhalten ausdrücklich ihren Vertrag: etwa numerische Parameter-/Achsenwerte mit passender Schlüsselprüfung. Wirklich opake Teilobjekte erhalten einen genauen Pfad und eine begründete, im Ergebnis sichtbare Prüfgrenze. Diese Ausnahme darf niemals eine offene Menge von Top-Level-Befehlsfeldern legitimieren. Nicht auflösbar außerhalb dieser ausdrücklich benannten Fälle bleibt ein Fehler.

Zusätzlich beschreibt `WsCommand` nicht allein alles, was der Mock empfängt: `wsWorker.ts:284` sendet `hello` mit `session/resume_armed`, und `wsWorker.ts:135` sendet `heartbeat` mit `seq`; `hello` steht nicht in der Union und deren `heartbeat` nennt kein `seq`. `req_id` allein löst diese Grenze nicht.

**Bitte festlegen:** Auch die vom Worker gebauten Protokollrahmen sind explizit inventarisiert, mit eigener Formprüfung oder ausdrücklich benanntem Ausschluss vom Befehls-Replay. Kein allgemeines „unbekannt = Protokoll, daher ignorieren“. Gegenfälle: gültiges `mdi.vars` passiert, unbekanntes Top-Level-Feld scheitert, normale `hello`-/nummerierte Heartbeat-Rahmen werden korrekt klassifiziert, ein erfundener Befehl wird nicht still ausgelassen. Dafür ist weder eine neue Gateway-API noch ein vollständiges Settings-Schema nötig.

### TS248-04 · Rest B: Herkunft muss auch im Merge-Gate eindeutig bleiben

Die Begründung „bei einem Worker ist die Zuordnung über Zeitfenster eindeutig“ ist nur für die **neue Auswahlkonfiguration** vorgesehen. Der volle Lauf bleibt laut Plan bestehen; dort steht `fullyParallel: true`, und das erste Projekt `chromium` hat weiterhin keine Begrenzung auf einen Worker. Teststart/-ende können sich deshalb überlappen. Ein einzelner JSONL-Empfangszeitpunkt entscheidet dann nicht, welchem Test und welchem Retry der Befehl gehört. Genau davon hängen aber die Ausnahmen für absichtlich ungültige Nutzlasten und der Nachweis des Antast-Klicks ab.

**Bevorzugter Vertrag:** Lauf, Test-ID, Versuch/Projekt und Verbindung beim Mock-Empfang miteinander binden, etwa über testseitige Verbindungsmetadaten. Produktbefehle müssen dafür nicht verändert werden. Zeitstempel dienen der Diagnose, nicht als alleiniger Herkunftsbeweis. Alternativ ausdrücklich **alle Replay-Läufe einschließlich Merge** serialisieren und einen abgeschlossenen Verbindungs-/Log-Lebenszyklus zwischen den Tests garantieren; den Laufzeiteffekt dann messen.

Nicht zuordenbare Befehle bleiben Fehler oder ein explizit benannter Bootstrap-/Teardown-Fall. Ein verspäteter Befehl darf nicht die Ausnahme des nächsten Tests erben. Die Ausnahme muss zur konkreten ungültigen Nutzlast und erwarteten Ablehnung passen; „dieser Test darf diesen Befehl ungültig senden“ darf andere Fehler desselben Befehls nicht freistellen. Als Wächter genügen zwei überlappende Testherkünfte, ein Retry und ein nachlaufender Befehl. Das ist eine Absicherung des geplanten Replays, kein Ausbau zum Zustandsmock.

### TS248-06 · Rest: Ein erlaubter INI-Pfad ist noch kein verifiziertes Sim-Profil

Ablauf, unabhängiger Erwartungswert, absichtlich abweichender Ausgangsoffset, Aufräumen und Verhalten bei Trip/Verbindungsverlust sind angenommen. Die neue Zielprüfung nennt jedoch nur eine **Erlaubnisliste von INI-Pfaden** und den Gateway-Code-Stand. Dieselbe Datei kann andere HAL-/Remap-/Kinematik-Inhalte laden; derselbe Gateway-Code kann unterschiedliche Konfigurationen bedienen. Der Pfad und der Code-Stand belegen daher die Simulator-Eigenschaft nicht.

Hier muss nichts neu erfunden werden: `scripts/toolsetter_readback_check.py:115` hat bereits `validate_sim_target`. Diese prüft die tatsächlich laufende INI gegen das ausgelieferte Profil einschließlich der relevanten Inhalte und der von HAL gestarteten Dateien; die Fälle sind im bestehenden Backend-Gate abgesichert. **Diesen Vertrag wiederverwenden**, gegebenenfalls den reinen Helfer auslagern, damit beim Import kein Live-STAT geöffnet wird. Dazu die für den neuen Lauf erforderlichen Laufzustände ausdrücklich beibehalten: Leerlauf/Stillstand, kein unquittierter Trip, bekannte Machine-Kinematik und passender Platten-/Werkzeugzustand. Nicht allein aus „G21/G54“ auf den Bewegungsrahmen schließen.

Gegenfälle vor jeder Schreib-/Bewegungszulassung: angeforderte INI ist nicht die laufende; erlaubter Pfad mit veränderter HAL-/Kinematik-Konfiguration; zulässiges echtes Sim-Profil, aber falscher aktueller Kinematikmodus. Die übrigen neuen Wiederherstellungsregeln bleiben unverändert.

### Geschlossene Punkte und Umsetzungshinweise

- **TS248-01 geschlossen auf Planebene:** Basis/Ziel, sauberer Baum, beide Rename-Pfade, unbekannte Dateien, Teständerungen, Dateilesungen und Mechanismus-Gegenfälle sind jetzt als Vertrag benannt. Ein allgemeiner Resolver für beliebige `readFileSync(path.join(ROOT, rel))` ist dafür nicht nötig: Explizite konservative Datenregeln plus benannte dynamische Loader sind ausreichend, solange unbekannte Leseabhängigkeiten sichtbar scheitern. Das schützt den Umfang dieser Arbeit.
- **TS248-02 geschlossen:** Alle bestehenden Prüfarten bleiben erhalten, Backend-Auslöser und ausstehende Live-Nachweise sind ausdrücklich. Die Matrixzelle „Unit leicht / Merge: —“ bitte redaktionell zu „immer, im vollständigen Unit-Satz“ ändern; maßgeblich ist die Zusage „Nichts Bestehendes entfällt“. Bei reiner Doku ist `none` eine erfolgreiche **Auswahlentscheidung ohne Produkttestnachweis**, keine fälschlich grüne leere Testsuite. Damit sind „reine Doku → keine Produkttests“ und „leere Auswahl → kein Test-PASS“ vereinbar.
- **TS248-03 geschlossen:** Eigenes Projekt ohne Kette, ein Worker, kein fremder Server, Soll-/Ist-Discovery und gemessene statt abgeschnittene Laufzeit. Die gewünschte Dateireihenfolge muss der spätere Runner tatsächlich herstellen und belegen; die Reihenfolge von CLI-Dateiargumenten allein ist kein Nachweis. Das ist im Implementierungsreview zu prüfen.
- **TS248-05 geschlossen:** Gepinntes Release, Beschaffung/Hash, eigene Referenzen, keine Ersatzbrowser und ein echter Rot-/Grün-Nachweis sind hinreichend beschrieben. Die Machbarkeitsprobe und der später bestätigte Maschinenbrowser bleiben echte Abnahmen, keine bereits erledigten Zusagen.
- **Baufolge angenommen:** Reporter/Machbarkeit, schnelle Verträge, Auswahl im Trockenlauf, erst dann selektiv, anschließend Replay/Firefox/Live. Ein vorhandener vollständiger Lauf auf demselben integrierten Stand muss weiterhin nicht nur wegen des Handshakes wiederholt werden.

Bitte nur die drei obigen Reste konkret beantworten. Die vier geschlossenen Planpunkte brauchen keine neue Grundsatzrunde.

Belege: [Lesebefunde](test-strategy.r250.evidence.md), [Stand und unveränderter ursprünglicher Review-Inhalt](test-strategy.r250.metadata.json). Keine neuen Laufzeit- oder Maschinenmessungen behauptet.


---

## Claude · Planfassung 3 · Anfrage R251 · 2. November 2026 · die drei Reste aus R250

Die vier geschlossenen Punkte bleiben, wie sie sind. Die beiden redaktionellen Hinweise sind übernommen:
- „Unit leicht / Merge“ heißt jetzt: **immer, im vollständigen Unit-Satz**.
- `none` bei reiner Doku ist eine **erfolgreiche Auswahlentscheidung ohne Produkttestnachweis**. Sie ist kein grüner leerer Testlauf; eine leere Auswahl aus Produktpfaden bleibt FAIL.

### TS248-04 Rest A · Geschlossene Befehle, benannte Datenmaps, inventarisierte Rahmen

**Oberste Ebene geschlossen:** Jedes Befehlsobjekt hat eine feste Feldmenge, gelesen mit der TS-API aus `WsCommand`. Die drei offenen Werkzeugbefehle (`save_tool`, `add_tool`, `renumber_tool`) bekommen ihre tatsächlichen Felder. Ein unbekanntes Top-Level-Feld ist ein Fehler, ebenso ein Typ außerhalb der folgenden benannten Fälle.

**Benannte Datenmaps** mit eigenem Vertrag (Pfad → Schlüssel → Wert):

| Pfad | Schlüssel | Wert | im Replay zusätzlich |
| --- | --- | --- | --- |
| `mdi.vars`, `set_probe_vars.vars`, `auto_run.probe_vars` | `^\d+$` | endliche Zahl | `validate_payload` mit Var-Deklaration gegen jede Beispiel-Var-Datei |
| `touchoff.axes` | `TOUCHOFF_LETTERS` | endliche Zahl | — |
| `set_g30.values`, `set_g30.based_on` | Achsbuchstaben | endliche Zahl | — |
| `touchoff.expect` | `kins_type`, `g5x_index` | Ganzzahl oder `null` | — |

**Undurchsichtig, mit genauem Pfad und sichtbarer Grenze im Ergebnis:**
- `save_settings.data`: der Abschnitt; den prüft der Settings-Store je Abschnitt, nicht dieses Replay.
- `client_diag.data`: Diagnose ohne Wirkung.

Diese Ausnahme gilt nur für genau diese zwei Pfade, nie für Felder auf oberster Ebene.

**Protokollrahmen des Workers, inventarisiert:**
- `hello` {`session`, `resume_armed`}
- `tab_visibility` {`hidden`}
- `heartbeat` {`seq`}

Je mit eigener Formprüfung. Ein Test liest die `cmd`-Literale aus den eigenen `send`-Aufrufen von `wsWorker.ts` und verlangt genau diese drei. Ein neuer Rahmen des Workers lässt ihn scheitern. Alles andere sendet der Worker unverändert weiter: Das sind `WsCommand`s und gehen ins Befehls-Replay.

**Gegenfälle:**
- gültiges `mdi.vars` passiert
- unbekanntes Top-Level-Feld scheitert
- `hello` und ein nummerierter `heartbeat` werden als Rahmen klassifiziert und formgeprüft
- ein erfundener Befehl scheitert, er wird nicht ausgelassen
- ein falscher Schlüssel in `touchoff.axes` scheitert

### TS248-04 Rest B · Herkunft an die Verbindung gebunden, auch im parallelen Volllauf

**Bindung über ein Cookie, ohne Produktänderung:**
- Ein automatisches Playwright-Fixture (`e2e/test.ts`, erweitertes `test`) setzt vor jedem Test im eigenen Browser-Kontext ein Cookie `e2e_origin`. Es trägt Lauf-ID, Test-ID, Projekt und Retry und gilt für den Mock-Ursprung.
- Der Mock liest es beim WS-Upgrade und bei HTTP-Anfragen und bindet jede **Verbindung** an diese Herkunft.
- Jeder Befehl trägt damit die Herkunft seiner Verbindung, nicht die eines Zeitfensters.
- Parallel laufende Tests haben getrennte Kontexte, also getrennte Cookies. Ein nachlaufender Befehl auf einer alten Verbindung behält die alte Herkunft und erbt nie die Ausnahme des nächsten Tests.
- Zeitstempel bleiben nur zur Diagnose.

**Vollständigkeit:**
- Ein Test verlangt, dass jeder Spec `test` aus `e2e/test.ts` importiert. Ein Spec ohne Fixture scheitert.
- Ob der Worker das Cookie beim WS-Handschlag mitsendet, prüft ein Gegenfall im ersten Implementierungsschritt. Tut er es nicht, falle ich auf deinen Alternativvertrag zurück: alle Replay-Läufe seriell, der Laufzeiteffekt gemessen.

**Nicht zuordenbar:**
- Ein Befehl ohne Cookie ist ein Fehler.
- Ausnahme ist ein ausdrücklich benannter Bootstrap- oder Teardown-Fall: der Mock-Selbsttest, die Smoke-Specs ohne Mock.

**Ausnahmen für absichtlich ungültige Nutzlasten:** Schlüssel ist (Test-ID, Befehl, die konkrete ungültige Teil-Nutzlast, die erwartete Ablehnung). Ein anderer Fehler desselben Befehls im selben Test bleibt ein Befund.

**Wächter:**
- zwei überlappende Testherkünfte in zwei Workern
- ein Retry mit eigener Herkunft
- ein nachlaufender Befehl auf der Verbindung eines beendeten Tests, der dessen Herkunft behält

### TS248-06 Rest · Der vorhandene Zielvertrag statt einer Pfadliste

**Zielprüfung:** Der Antast-Live-Check nutzt `validate_sim_target` aus `toolsetter_readback_check.py`.
- Die Funktion prüft die laufende INI gegen das ausgelieferte Profil samt relevanten Inhalten und den von HAL gestarteten Dateien. Die Backend-Tests decken sie schon ab.
- Ich lagere sie in ein reines Modul aus (`scripts/sim_target.py`), damit der Import kein Live-STAT öffnet. Beide Checks nutzen sie, die bestehenden Tests ziehen mit um.
- Die Pfad-Erlaubnisliste entfällt.

**Dazu, vor jeder Schreib- oder Bewegungszulassung, aus frischem STAT und Reader:**
- Leerlauf und Stillstand
- kein unquittierter Trip
- die Kinematik bekannt und Machine (`kins_type` frisch)
- Platte und Werkzeug wie in TS248-06 (Plattenhöhe aus dem Profil, `#5400 == #3014`, positive Länge)

Nicht allein aus „G21/G54“ auf den Bewegungsrahmen geschlossen.

**Gegenfälle vor jeder Zulassung** (Pytest mit dem reinen Modul und einem gefälschten Zustand):
- die angeforderte INI ist nicht die laufende
- ein erlaubter Pfad mit veränderter HAL- oder Kinematik-Konfiguration
- das echte Sim-Profil, aber der falsche aktuelle Kinematikmodus

Die Wiederherstellungsregeln bleiben unverändert.

Wenn die drei Reste tragen, bitte `agreement`. Ich beginne dann mit Schritt 1 (Messreporter, Firefox-Machbarkeit) und Schritt 2 (Schema ↔ Client mit `renumber_tool`, Antast-Klick-Spec).

---

## Codex · Planreview R251 · 2. November 2026

**Urteil: `agreement` zur Teststrategie in Fassung 3, Stand `a2f1c910`.** Damit sind TS248-01 bis TS248-06 auf Planebene geschlossen. Claude kann mit der vereinbarten Reihenfolge beginnen; keine weitere Planrunde erforderlich.

### Die drei Reste aus R250

- **TS248-04 Rest A geschlossen:** Geschlossene Befehlsobjekte, ausdrücklich erlaubte Datenmaps und zwei genau benannte opake Datenpfade lösen den Widerspruch. `hello`, `tab_visibility` und nummerierte `heartbeat`-Rahmen erhalten eine eigene Formprüfung; unbekannte Befehle verschwinden nicht in einer Protokollausnahme. Die Gegenfälle prüfen sowohl gültige Nutzlasten als auch die geschlossene Grenze.
- **TS248-04 Rest B geschlossen:** Die Herkunft wird beim Verbindungsaufbau gebunden und bleibt für alle Befehle dieser Verbindung erhalten. Lauf/Test/Projekt/Retry unterscheiden auch parallele und wiederholte Versuche. Das trägt die vorgesehenen gezielten Ablehnungsausnahmen; die Zeitfenster sind nicht mehr der Herkunftsbeweis. Der angekündigte Cookie-Machbarkeitsnachweis und die Wächter für Parallelität, Retry und nachlaufende Befehle sind passende Implementierungsnachweise.
- **TS248-06 Rest geschlossen:** Die Wiederverwendung von `validate_sim_target` einschließlich der Inhalte und gestarteten Dateien ersetzt die unzureichende Pfadliste. Das reine gemeinsame Modul verhindert einen Live-STAT beim Import. Die zusätzlich benannten frischen Zustandsprüfungen schließen den falschen Bewegungsrahmen aus; die Wiederherstellungs- und Trip-Regeln bleiben erhalten.

### Hinweise für den Bau, keine neuen Planbefunde

1. **Alle Browser-Kontexte erfassen:** `scenes.viewer.spec.ts` erzeugt an sechs Stellen selbst `browser.newContext(...)` (u. a. Zeilen 228 und 410). Ein Import des erweiterten `test` allein stattet diese Kontexte noch nicht mit dem Cookie aus. Auch sie müssen die Herkunft vor der ersten Navigation/WS-Verbindung erhalten. Ein kleiner Wächter dafür ergänzt die bereits geplante Prüfung; ein fehlendes Cookie bleibt gemäß Vertrag ein Fehler.
2. **Teststeuerung sauber unterscheiden:** Der Node-seitige `/ctl`-Kanal aus `e2e/ctl.ts` ist eine eigene Mock-Steuerung ohne Browser-Cookie. Er darf nicht als Produktbefehl oder als pauschale Cookie-Ausnahme im Produkt-WS enden. Ebenso ist „Smoke ohne Mock“ die begründete Abwesenheit von Replay-Befehlen, keine Erlaubnis für unzuordenbare Produktbefehle. Das folgt aus der angenommenen Inventarisierung und Vollständigkeitsregel.
3. **Ein eventueller serieller Ersatz behält den vollständigen Vertrag:** Falls der Cookie-Nachweis scheitert, gilt die bereits in R250 benannte Alternative einschließlich abgeschlossenem Verbindungs-/Log-Lebenszyklus zwischen Tests, eigener Retry-Herkunft und gemessenem Laufzeiteffekt. Bloß `workers: 1` mit neuer Zeitfensterannahme wäre nicht dieser Ersatz. Im Implementierungsreview den tatsächlich gewählten Weg zeigen.

Die vier bereits angenommenen Punkte und die redaktionellen Klarstellungen bleiben geschlossen. Das Agreement nimmt **den Plan** ab: 15-Minuten-Ziel, Firefox/BiDi-Machbarkeit, Rot-/Grün-Wächter, selektiver Trockenlauf und Probe-Live-Ablauf sind noch zu erbringen. Q248-1 zur tatsächlichen Browserinstallation bzw. ESR-Unterstützung bleibt separat offen und blockiert den Start der Umsetzung nicht; ein Maschinenbrowser-Nachweis ist damit nicht vorweggenommen.

Prüfung ausschließlich lesend an Plan, WS-Formen, Mock-/Kontextaufbau und vorhandener Sim-Zielprüfung. Keine Produktänderung, kein Build/Test und kein Zugriff auf die Live-Sim. [Stand und gelesene Quellen](test-strategy.r251.evidence.json).


---

## Claude · Umsetzung Schritte 1–4 · Anfrage R256 · 3. November 2026

**Stand `08fb69d9`** (`feat/test-tiers`, Worktree `~/lcnc-suite-tiers`, von `development` `4ad87515`, mit `fix/probe-vars` bis `9d152d4e` zusammengeführt). Diff: `4ad87515..08fb69d9`.

### Schritt 1 · Messen

- **Reporter:** eine eigene Kopie des Gate-Skripts (`~/claude-work/gate-frontend2.sh`) schreibt Vitest- und Playwright-JSON und daraus `<gate>.timings.json`: Laufzeit je Unit-Datei, je Spec und je Test, mit Projekt, Retry und Status.
- **Erste vollständige Messung** (`fix/probe-vars` `9d152d4e`, 6 Kerne, Playwright allein):
  - Unit: 168 Dateien, 2291 s CPU, 467 s Wand. Die acht schweren Dateien: 2019 s (88 %), die übrigen 160: 272 s. Die neunte Datei liegt bei 44 s, Schwelle 60 s.
  - Browser: 831 Tests, **3236 s Wand bei 3242 s Testzeit** — der volle Lauf ist trotz drei Workern praktisch seriell (die Kette). `layout.spec` 796 s (Seitenbereich-Footprint 224, HUD-Spalte 142, Scrub-Bar 68, Bedienfelder 57 …), `collisions.viewer` 321, `bake-hold.viewer` 246, `contrast` 217, `setup-layout` 206, `sim-panel.viewer` 176, `dialogs` 156.
  - Kein Retry, kein Skip; die Unit-Suite hat keinen übersprungenen Test, also ist jeder Skip unerwartet.
- **Firefox-Machbarkeit:** Stock Firefox 159.0 aarch64 aus Mozillas Archiv, über Playwright 1.60 per BiDi (`moz-firefox` mit `executablePath`; `docs/reviews/test-tiers.firefox-feasibility.txt`, Spec und Konfiguration daneben):
  - **`route`:** trägt, auch ein Fetch aus einem Worker.
  - **`toHaveScreenshot`:** trägt. Der erste Lauf schreibt die Referenz, der zweite vergleicht grün; die Raster-Glyphe misst 80 × 80.
  - **Maus-Halten und Tastatur:** tragen (ein Halten → genau ein `mdi`, Escape → genau ein `estop`).
  - **Touch: nicht machbar.** Mit `hasTouch` meldet Firefox `maxTouchPoints 0`, kein `TouchEvent`, `(pointer: coarse)` falsch. `locator.tap()` und `touchscreen.tap()` liefern **gar kein** Ereignis, nicht einmal einen Klick. Ein `tap()` in einem Firefox-Spec täte still nichts.
  - **Folgerung für Schritt 6:** Der Firefox-Kern nutzt nur Maus und Tastatur; Touch bleibt ein Chromium-Ziel (CDP, wie heute). Ein Wächter verbietet `tap()` in den Kern-Dateien. 5 Tests liefen in 8–10 s Wand mit Browserstart; das 5-Minuten-Ziel bindet nicht.
  - Das Binary liegt noch im Scratchpad. Der Pin (`e2e/firefox.json`, `scripts/fetch_firefox.py`, SHA256 aus Mozillas `SHA256SUMS`) kommt mit Schritt 6.

### Schritt 2 · Schema ↔ Client, `renumber_tool`, Antast-Klick

- **`commandShapes.test.ts`** (node-seitig) liest die `WsCommand`-Union über die TypeScript-Compiler-API und `COMMAND_SCHEMA` / `COMMAND_GATES` per `python3 -I -c`. Geschlossene Befehle, benannte Datenmaps (die Multi-Jog-Einträge als OFFEN markiert), zwei opake Pfade (`save_settings.data`, `client_diag.data`), drei Worker-Rahmen (`hello`, `tab_visibility`, `heartbeat`) mit eigener Form. Rot zuerst an `4ad87515`: `docs/reviews/test-tiers.shapes-red.txt` (offene Indexsignaturen bei `save_tool`/`add_tool`/`renumber_tool`, `new_number` statt der gesendeten Nummern, vier fehlende Union-Einträge).
- **Korrekturen:** `ToolFields` statt `[key: string]: any`; `home`, `unhome`, `go_to_zero`, `run_macro` in der Union; `fire()` und `FireFn` nehmen `WsCommand`. `renumber_tool`: das Schema begrenzt `old_tool_number` und `tool_number` (0..`TOOL_NUMBER_MAX`, ganzzahlig), `pocket`, `diameter`; `test_renumber_bounds_both_numbers_the_ui_sends` mit negativem, zu großem und gültigem Fall.
- **Offen und benannt:** Die Multi-Jog-Einträge (`jog_multi`) begrenzen Achse und Geschwindigkeit je Eintrag nicht wie der Einzel-Jog; LinuxCNC kappt die Geschwindigkeit selbst. Eine Korrektur berührt einen Bewegungsbefehl und braucht `twp_buttons_check`. Ich schlage sie als eigenen kleinen Punkt vor, nicht in diesem Paket.
- **`probe-click.spec.ts`:** `e2e/probe-click.spec.ts`, über die Sendeformen parametrisiert (Grid, Boss/Pocket, Ridge/Valley, Angle, Calibrate): den ersten Button halten, genau ein `mdi` mit `O<probe_…> CALL`, genau die Nummern der Zuordnung, jeder Wert endlich, #3030 ein Modus. **Sein erster Lauf war rot in Calibrate:** `#3036` (die Achswahl der Kalibrierung) wurde neben `probeVarMap` gesetzt und war in keiner Var-Datei deklariert — **jede Kalibrierung wurde abgelehnt**, auch nach R252. Behoben auf `fix/probe-vars` `b9e29335` (`calibrationVarMap`, eigene Runde R254). Danach 5/5; zwei Panel-Mutanten jeweils genau in den berührten Formen rot (`docs/reviews/test-tiers.probe-click-red.txt`). In der Nachprüfung R254 fand Codex dahinter PF-01 (38 Aufrufe übergaben die Zahl 3017 als Verfahrvorschub; R255 geschlossen) — eine Klasse, die weder Klick noch Replay sieht, nur eine Prüfung der Routinen selbst; der neue NGC-Wächter deckt sie jetzt ab.

### Schritt 3 · Der Wähler im Trockenlauf

`scripts/test_select/` (Python, ohne Abhängigkeiten), im Offline-Gate als Komponente `test-select`:

- **`rules.py`:** geordnete Glob-Regeln, alle passenden vereinigt; eine Regel nennt Browser-Specs oder FULL, Backend, Firefox, Live-Prüfungen, `unit_only` oder `none` mit Grund (`final`: Doku entscheidet allein). Ohne besitzende Regel: voller Frontend- und Backend-Lauf, im Record benannt.
- **`selector.py`:** `git diff --name-status -M <basis> <ziel>` auf benannten Commits (Umbenennung mit beiden Pfaden; fehlende Basis = Abbruch, nie ein leerer Diff). Ein geänderter Spec oder Referenzbild wählt sich selbst, eine geänderte Unit-Datei läuft selbst, ein E2E-Helfer wählt die Specs, die ihn importieren (ein Helfer ohne Importeur: voller Browserlauf), eine Datendatei die Specs, die ihr Lesen deklarieren (`SPEC_READS`).
- **Schwere Gruppe:** `HEAVY_UNIT` (acht exakte Pfade). Ein geänderter schwerer Test läuft **genau selbst**, ein Treffer von `vitest list --changed <basis>` (Importgraph, 2,6 s) genau die erreichten Dateien; die **ganze** Gruppe bei einem Pfad unter `HEAVY_DATA` (`examples/sim_config/**`, `lcnc-gateway/machine/**`), ohne Regel oder ohne Vitest-Antwort.
- **Der Importgraph als Wächter** (`graph.py`) — der wichtigste Befund dieses Schritts. Ein Modul rendert und handelt durch die Komponenten, die es benutzen; seine Auswahl muss deren Auswahl enthalten, und ein Modul, das eine zentrale Komponente erreicht, muss FULL sein. Laufzeit-Importe (`import type` zählt nicht, `{ type A, b }` schon), Worker über `new URL(…, import.meta.url)`.
  - **Erster Lauf gegen meine handgeschriebene Tabelle:** 85 Module ohne den Sweep oder einen Bereich ihrer Komponenten, 46 erreichten eine zentrale Komponente. Die Ketten: `lcncWs → ws/bulkData → previewWorker (Worker) → viewer/scrubTrack → viewer/kins`, `lcncWs → defaults → probeVars`, `lcncWs → ws/statusStore → runBasis`, `App.vue → (Modul einer Funktion)`.
  - **Drei benannte Schnitte** (`graph.CUTS` und die Worker-Regel): App.vue setzt Funktionen zusammen (ihr direkter Import ist die Verdrahtung einer Funktion, deren Regel die Specs nennt); `defaults.ts` übernimmt Startwerte (die Regel des Moduls nennt seine Leser); ein Worker ist ein Endpunkt mit der Auswahl seiner eigenen Regel. Danach erreichen 9 Module auf dem Status- und Bulk-Pfad eine zentrale Komponente → FULL.
  - **Jedes Modul trägt den UI-Sweep** über eine **ergänzende** Regel: Sie besitzt keinen Pfad allein, ein neues Modul wählt also weiterhin voll (ein Gegenfall hat genau das rot gezeigt, als die Regel zunächst besaß). Acht Regeln für geteilte Module tragen die Bereiche, die der Graph nennt (`codeGlide`/`trackHighlight`/`limitMarks` → Programm + Viewer, die Werkzeugmesser-Werte → Werkzeugmesser + Werkzeuge + Programm + Viewer + Probing …). Wächter: 0 Befunde.
  - Der Einrasten-Zweig bringt `toolMarks.ts` (`GcodePanel → toolMarks → viewer/toolChangeScan`): Beim Zusammenführen verlangt der Wächter für `toolChangeScan` den Programm-Bereich — genau die Lücke, für die er da ist.
- **Lesepfade:** Die acht schweren Dateien und `collisionFixtures.ts` lesen nur unter `HEAVY_DATA` (Literale extrahiert, jedes existiert, jede Datenregel benutzt; eine Lesung ohne auflösbares Ziel lässt den Wächter scheitern). Die E2E-Lesungen außerhalb des Frontends stehen in `SPEC_READS`; der Wächter fand dabei `toolsetter.viewer` (liest das 5-Achs-Modell, war nicht deklariert).
- **Beide Richtungen:** jeder Spec von einer Regel genannt oder in `FULL_ONLY` mit Grund (`lifecycle`, `smoke`), jeder genannte Spec existiert, jede Glob trifft eine getrackte Datei, jede getrackte Quelle hat eine besitzende Regel.
- **Gegenfälle** (synthetisches Repo mit den echten Spec-Namen): neue Quelle ohne Regel → voll; umbenannte zentrale Quelle → voll, beide Pfade; geänderter schwerer Test → genau er; Modelländerung → schwere Gruppe und die lesenden Specs; Doku → keine Produkttests mit Grund; fehlende Basis → Abbruch; ohne Vitest-Antwort → ganze schwere Gruppe; eine Komponente → Bereich + Sweep; Helfer → Importeure, verwaister Helfer → voll; Spec und Referenzbild → sich selbst; Vitest nur bei sauberem `lcnc-webui`.
- **27 Wächter, 18 Mutationen** (je eine Regel oder ein Mechanismus gebrochen) alle rot, jede im eigenen Wächter: `docs/reviews/test-tiers.selector-red.txt`. Eine Falle dabei: Zwei gleich große Mutanten einer Datei in derselben mtime-Sekunde luden den `.pyc` des vorigen — das Skript läuft jetzt ohne Bytecode-Cache.
- **Trockenläufe gegen Volläufe:** Gegen echte Volläufe, mit `selector.py --historical` (eine ältere Spitze hat Specs, die die Regeln schon nennen, noch nicht):
  - **Die sechs früheren fehlgeschlagenen Frontend-Gates** (ihre Logs liegen noch): `fixed-highlight` run1 (`collisions.viewer`), `snap-highlight.r248` run1 (`layout`, Zeitüberschreitungen bei ausgehungerter VM), `button-gates` B run1 (`keyboard-guards`, `toolsetter-setup`), C run1 (`layout`, 16), D run1 (`smoke`), F run1 (`collisions.viewer`). Jede Runde gegen ihre Basis aus dem Handshake-Protokoll: **jeder Fehler lag in der Auswahl.** Fünf dieser Runden wären ohnehin voll gelaufen (`App.vue`, `mock-gateway.mjs`, `style.css`, `layout-fixtures.ts`, `controlInventory.ts`); nur die R249-Runde war schmal (17 Specs) und enthielt `layout`.
  - **`probe-fixes` run1** (`769760ce`, 18 Footprint-Fehler in `layout`): voll (`defaults.ts`); die Folgerunde nur mit `ProbePanel.vue` hätte `layout` gewählt.
  - **Einrasten-Volllauf `a507e238`** (839/839): das Paket seit der Abnahme R246 → voll (`style.css`, und `toolMarks.ts` ohne Regel — der sichere Weg); die Runde FH-07 allein → 17 Specs, 2250 von 3339 s, keine schwere Datei (Vitest erreicht keine), Unit-CPU 348 von 2586 s. Der Rot-Test von FH-07 lag in `layout.spec`, gewählt.

### Schritt 4 · Die Auswahl laufen lassen

- **`playwright.select.config.ts` — eine Abweichung vom Plan, mit Grund.** Vereinbart war ein Projekt mit `workers: 1`. Ein Projekt läuft aber in Pfadreihenfolge, und die ist nicht die der Kette (`viewer.spec.ts` sortiert vor `visual.spec.ts`, die `*.viewer.spec.ts` mitten zwischen den Guards). Die Konfiguration behält deshalb die **Projekte, die Kette und die Einstellungen des vollen Laufs** und verengt jedes Projekt auf die gewählten Dateien, die es ohnehin liefe (exaktes `testMatch`). Leere Projekte entfallen, die Kette schließt sich darüber, `reuseExistingServer: false`. Damit hat der Mock dieselben Besitzer wie im vollen Lauf, und die Reihenfolge ist die des vollen Laufs. Ein Name, der kein Spec der vollen Konfiguration ist, eine leere Auswahl oder „full“ sind Fehler, nie ein stiller Volllauf.
- **Nachweis** (`proof.py`): vor dem Lauf `--list` der Auswahl gegen `--list` der vollen Konfiguration (genau die Auswahl, jede Datei im Projekt der vollen Konfiguration); nach dem Lauf die Startzeiten im JSON-Bericht (Projekte in Kettenreihenfolge ohne Überlappung, in einem seriellen Projekt Datei nach Datei in Pfadreihenfolge). Am vollen Lauf `9d152d4e` (831 Tests) gilt beides.
- **`round_gate.py`:** Auswahl, Lint, Build, Unit leicht (`--exclude` der acht), die gewählten schweren Dateien, Backend falls gewählt, Browser (voll oder Auswahl zwischen Listen- und Reihenfolgenachweis). Das Record nennt gelaufene und ausgelassene Prüfungen mit Grund, Firefox und Live-Prüfungen als `pending`; PASS nur ohne Fehler, Skip, Retry oder leeren Lauf. **Erster echter Lauf** (`docs/reviews/test-tiers.round1.gate-round.json`, `156d7337..44624f2e`: die Kalibrier-Korrektur `b9e29335` und `probe-click.spec`): **PASS**.
  - Auswahl: 9 Specs (Layout, Kontrast, Dialoge, Visual, layout-audit aus dem Sweep; Formulare, Tabs, disarmed aus Probing; probe-click selbst), Backend wegen der Var-Dateien, keine schwere Datei (keine geändert, von Vitest erreicht oder gelesen — `HEAVY_DATA` ist auf die Modelle und die zwei INIs verengt, deren `setp`-Zeilen `collisionFixtures` liest; eine Var-Datei wählt die Gruppe nicht mehr, Gegenfall).
  - Lint 9 s, Build 18 s, **Unit leicht 2573 Tests in 69 s** (statt 467–529 s mit der schweren Gruppe), Backend 78 s, Listennachweis, **Browser 251/251 in 1289 s**, Reihenfolgenachweis — zusammen **≈ 24 min statt ≈ 65 min**.
  - Ausgelassen mit Grund: die schwere Gruppe. Ausstehend: Firefox-Kern, Antast-Live-Check.

### Was das an Zeit bedeutet

Über die letzten 60 Review-Runden mit den Spec-Zeiten von `9d152d4e` geschätzt:
- 2 reine Doku-Runden, **38 volle** (Auslöser: `App.vue` in 19, allein in 7; dann `lcncWs.ts`, `mock-gateway.mjs`, `style.css` je 8, `viewerPerf.ts` 7 …), 20 gewählte mit 27–44 min Browser.
- Browserzeit gesamt **2456 statt 3134 min (−22 %)**. Dazu der Unit-Teil: ohne die schwere Gruppe 272 statt 2291 s CPU, in den meisten Runden.
- **Das 15-Minuten-Ziel erreicht eine Runde mit Komponentenänderung nicht**: Layout, Kontrast, Dialoge und Visual allein sind 20 min. Zwei Hebel, beide außerhalb dieses Pakets, nach Ertrag geordnet:
  1. **Den vollen Browserlauf parallelisieren.** Er ist heute seriell (54 min Wand ≈ 54 min Testzeit), weil alle seriellen Projekte einen Mock teilen. Ein Mock je Worker (der Mock kennt `MOCK_PORT`; `ctl.ts` und sechs Specs nennen 4174 fest) würde jeden Lauf, voll und gewählt, auf etwa ein Drittel bringen — auch die 38 vollen Runden.
  2. **`layout.spec` nach Thema teilen** (Seitenbereich-Footprint 224 s, HUD-Spalte 142 s, Leiste …; jeder Test beginnt mit `openLayout`, eine Dateiteilung ist sicher). Hilft nur gewählten Runden.

### Belege

- `docs/reviews/test-tiers.shapes-red.txt` (Schritt 2, rot an `4ad87515`), `test-tiers.probe-click-red.txt` (erster Lauf, Mutanten)
- `docs/reviews/test-tiers.selector-red.txt` (Graph-Befund, 18 Mutationen, Nachweise an echten Berichten)
- `docs/reviews/test-tiers.gate-backend.txt` (`9906dae4` PASS; Lauf 1 fand den veralteten Komponentenzähler des Runner-Tests)
- `docs/reviews/test-tiers.round1.gate-round.json` (erster Rundengate-Lauf)
- `docs/reviews/test-tiers.firefox-feasibility.txt`
- Die Laufzeitdaten der Volläufe `9d152d4e` und `a507e238` liegen lokal (`~/claude-work/teststrat/timings/`, je ~200 KB); `scripts/test_select/times.json` hält die Unit- und Spec-Zeiten, gegen die der Wächter die schwere Gruppe prüft.

**Bitte prüfen:**
- Tragen die drei Schnitte des Graph-Wächters, oder ist einer davon zu großzügig?
- Ist die Kette mit verengten Projekten statt eines Projekts die richtige Umsetzung von TS248-03?
- Darf ich mit diesem Stand **selektiv schalten** (Plan-Schritt 4): Umsetzungsrunden mit dem Rundengate, Merge mit dem vollen Lauf auf dem integrierten Stand?
- Und als nächstes Paket, vor Replay und Firefox-Kern: **ein Mock je Worker**, damit der volle Lauf parallel läuft? Nach den Zahlen oben ist das der größte Hebel; die Reihenfolge der übrigen Schritte bliebe.

Wenn das trägt, bitte `agreement`.


---

## Codex · Implementierungsreview R256 · 3. November 2026

**Urteil: `findings` für `4ad87515..08fb69d9`. Noch nicht auf das selektive Rundengate als maßgeblichen Nachweis umschalten.** Die Reduktion bleibt ausdrücklich erwünscht; die fünf folgenden Lücken betreffen die Verlässlichkeit der Auswahl beziehungsweise ihres PASS, nicht das verfehlte 15-Minuten-Ziel. Keine neue Operatorfrage.

### TS256-01 · P1: E2E-Helfer und deren Daten erreichen nur direkte Importeure

`selector.py:80–91` durchsucht nur die Spec-Dateien nach dem Namen des geänderten Helfers. Eine tatsächliche Kette des vorgelegten Standes ist:

`probe-click.spec.ts → layout-fixtures.ts → macroFolder.ts → macro_refusals.json`.

`openLayout` verwendet den importierten `Folder`/`serveNow`; das ist eine Laufzeitabhängigkeit. Bei einer Änderung nur an **`macroFolder.ts`** wählt die echte Auswahlfunktion sechs Specs: dialogs, forms, keyboard-guards, layout, macros und run-hold. **probe-click fehlt**, ebenso weitere mittelbare Nutzer von layout-fixtures. Dasselbe passiert bei einer Änderung an **`scripts/test_fixtures/macro_refusals.json`**: `SPEC_READS` findet den Helfer, danach bleibt `helper_importers` wieder bei den direkten Importeuren stehen. Die Regel für den zentralen Helfer layout-fixtures kommt dabei nicht zum Zug, weil dieser selbst nicht geändert ist.

**Korrektur:** Abhängigkeiten der E2E-Helfer bis zu den Specs transitiv verfolgen, einschließlich Re-Exports und der Daten-Leser. Ein konservativer voller Lauf bei nicht auflösbarer Kette ist ebenfalls zulässig. Der rote Wächter muss die vorhandene obige Kette prüfen, jeweils für Helfer- und reine Datenänderung; nicht nur einen direkt importierten synthetischen Helfer.

### TS256-02 · P1: Eine bekannte Lesung deckt beliebige zusätzliche Lesungen zu

Die vereinbarte Grenze war: **Jede nicht auflösbare Leseabhängigkeit scheitert sichtbar.** `test_selector.py:99–109` verlangt jedoch nur irgendein Pfadliteral oder irgendeinen Aufruf von `shippedCases`/`loadShippedModel` pro schwerer Testdatei. Der E2E-Wächter `:112–131` betrachtet ausschließlich `new URL("../../…", import.meta.url)`; andere Lesungen bleiben unsichtbar.

Eigene Gegenproben in der Kopie:

- An `collisionContacts.test.ts` eine zusätzliche gültige Lesung `fs.readFileSync(path.join(ROOT, "scripts", "test_fixtures", "macro_refusals.json"), "utf8")` angehängt: **beide schweren Lese-Wächter bleiben grün**. Bei einer späteren Änderung dieser Datei bleibt die schwere Gruppe ungewählt.
- An `freecad-import.spec.ts` eine Lesung desselben Inputs mit `readFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8")` angehängt: **E2E-Lese-Wächter grün**, freecad-import bleibt bei einer Datenänderung ungewählt.

**Korrektur:** Alle Leseoperationen beziehungsweise ausdrücklich benannten Loader erfassen. Jede muss einer erklärten Datenabhängigkeit oder einer genau benannten Ausnahme wie einem Test-Download zugeordnet sein. Ein zweiter unbekannter Leseort darf nicht durch den ersten bekannten freigestellt werden. Dafür ist weiterhin kein universeller JavaScript-Pfadauswerter verlangt: unbekannte Formen ablehnen oder eine explizite konservative Deklaration verlangen genügt. Die Ausnahmen müssen an den jeweiligen Leseort/Loader gebunden sein.

### TS256-03 · P1: Die Auswahlsicherung läuft gerade bei UI-Runden nicht

Der Importgraph ist **nur ein Test** in `scripts/test_select/test_selector.py`. `selector.select` ruft ihn nicht auf. `round_gate.py:154–159` führt diesen Testsatz nur über den ausgewählten Backend-Offline-Lauf aus; eine reine Änderung an `probeVars.ts` hat `backend.run=false` und lässt ihn aus. Die leichten Vitest-Dateien entdecken diesen Python-Wächter ebenfalls nicht.

Eigene Gegenprobe: Ein zusätzlicher Laufzeitimport von `probeVars` in GcodePanel erzeugt beim echten Graph-Wächter korrekt die fehlenden Program-/Sim-Specs. Die Auswahl für eine anschließende reine probeVars-Änderung bleibt aber schmal und wählt den Backend-Lauf weiterhin nicht. Eine nach einem früheren Vollgate geänderte Importbeziehung wäre damit bis zum Merge-Gate ungeprüft; der Wähler verlässt sich auf eine nicht mehr bestätigte Tabelle.

**Korrektur:** Die schnellen Auswahl-Wächter als eigene verpflichtende Vorprüfung jedes produktbezogenen Rundengates ausführen, bevor ausgelassen werden darf, oder denselben Vertrag direkt im Wähler prüfen. Das braucht keinen vollständigen Backend-Lauf bei UI-Änderungen. Die 28 vorhandenen Wächter sind hier schnell. Gegenfall: eine UI-only-Runde mit neuer, von der Tabelle nicht gedeckter Beziehung muss scheitern oder voll auswählen.

### TS256-04 · P1: Aufgelistete Tests müssen nicht ausgeführt worden sein

`proof.check_listing` vergleicht nur **Datei → Projekt**, nicht die einzelnen Tests; `check_order` betrachtet nur die im Bericht vorhandenen Ergebnisse. `round_gate.judge` verlangt lediglich eine positive Anzahl ohne gemeldete Fehler/Skips. Es fehlt der Soll-/Ist-Abgleich **Discovery → tatsächliche Ausführung**.

Reale Playwright-Gegenprobe am vorgelegten Stand: Die fünf unveränderten probe-click-Tests um einen versehentlich fokussierten `test.only`-Sentinel ergänzt und nur probe-click ausgewählt. Beide Konfigurationen listen **sechs Tests**. Ausgeführt wird **nur der Sentinel: 1 PASS, 0 skipped**. **Listennachweis, Reihenfolgenachweis und judge melden alle PASS.** Für diese Gegenprobe waren die Server abgeschaltet; der Sentinel braucht keine Browser-Fixture. Das bildet die Auslassung tatsächlich ab und behauptet keinen Produkt-Browserlauf.

**Korrektur:** Fokus-Markierungen im Gate ausdrücklich verbieten; zusätzlich die entdeckten Testidentitäten mit den Ergebnissen abgleichen (Datei, Projekt und Testidentität einschließlich parametrisierter Fälle, keine fehlenden oder zusätzlichen Versuche). Discovery-Exitcode und -Fehler ebenfalls prüfen. Ein bloßes Verbot von `.only` ersetzt den vereinbarten Vollständigkeitsnachweis nicht. Wächter: fehlender Test derselben Datei, vollständig fehlende gewählte Datei, zusätzlicher Retry und der fokussierte Test. Die gleiche Fokus-Grenze gilt auch für den Unit-Aufruf.

### TS256-05 · P1: Die Vollauswahl darf einen fremden Server wiederverwenden

Die neue Auswahlkonfiguration setzt korrekt `reuseExistingServer: false`. Bei **FULL** wechselt `round_gate.py:164–166` jedoch zur unveränderten vollen Konfiguration ohne entsprechende Vorgabe. Deren beide Server setzen `reuseExistingServer: !process.env.CI` (`playwright.config.ts:136/143`). Der dokumentierte lokale Gate-Aufruf setzt CI nicht.

Die Auswertung der tatsächlichen Konfiguration ohne CI ergibt für **beide Server `true`**. Ein bereits laufender Mock/Vorschau-Server eines anderen Worktrees kann damit den gerade gebauten Stand ersetzen, während das Gate den eigenen HEAD als geprüft protokolliert. Der volle Ausweichweg braucht denselben Vertrag wie die schmale Auswahl.

**Korrektur:** Für jeden Gate-Browserlauf eigene Server verbindlich erzwingen, auch bei FULL. Ein bereits belegter Port muss vor den Tests scheitern; keine implizite Wiederverwendung. Die Entwicklerkonfiguration darf daneben weiterhin bewusstes Wiederverwenden erlauben. Gegenprobe nur mit einem eigenen fremden Testserver, nicht mit der LAN-Sim.

### Antworten auf die vier Fragen und angenommene Teile

1. **Die benannten Graph-Schnitte können bleiben.** App als Zusammensetzung, Defaults als Werteübernahme und Worker als eigene Testgrenze sind nachvollziehbare Vereinfachungen, solange die konkreten Verbraucher durch deren Regeln abgedeckt sind. Sie sind kein selbstständiger Beweis, dass jede Änderung folgenlos für andere Bereiche bleibt. Die bereits vorgesehenen expliziten Regeln plus die verbindliche Prüfung aus TS256-03 sind deshalb wesentlich. Die nachgewiesene E2E-Kette aus TS256-01 liegt außerdem außerhalb dieses Produkt-Importgraphen.
2. **Verengte Projekte mit geschlossener Kette sind als Planabweichung angenommen.** Sie bewahren die bisherigen Eigentümer und Einstellungen, ohne nicht gewählte Vorgänger-Specs mitzunehmen. Eigene Discovery am Zielstand: **836 Tests voll, genau 251 in den neun gewählten Specs**, jeweils im richtigen Projekt. Das ist ein tragfähiger Ersatz für ein einziges Projekt. Für die Abnahme des Ausführungsnachweises fehlen TS256-04/05.
3. **Selektiv schalten: nach den fünf Korrekturen, noch nicht mit diesem Stand.** Ein vorhandenes vollständiges Gate am identischen integrierten Stand darf weiterhin wiederverwendet werden. **24 Minuten statt ungefähr 65 sind ein brauchbarer Zwischenschritt**, auch wenn das Ziel von 15 Minuten nicht erreicht ist. Die Zielverfehlung allein verlangt weder eine Operatorentscheidung noch die Aufgabe der Stufung.
4. **Ein Mock je Worker ist als nächstes gesondertes Paket sinnvoll, nach der Korrektur der Auswahl.** Voraussetzung: eigener Port/Prozess/Zustand je tatsächlich laufendem Worker, sauberer Neustart bei Ersatzworker/Retry, alle ctl-Aufrufe und selbst erstellten Browser-Kontexte am richtigen Mock, weiterhin vollständiger Reset je Test und keine Wiederverwendung fremder Server. Der vereinbarte Herkunftsvertrag für Replay bleibt Lauf/Test/Projekt/Retry/Verbindung; ein Worker-Port ersetzt ihn nicht. Die bisherige globale Reihenfolge muss dabei ausdrücklich durch Unabhängigkeit zwischen Workern und erhaltene nötige Reihenfolge innerhalb einer Gruppe ersetzt werden. Vor Umschaltung denselben Testsatz seriell und parallel vergleichen, Kreuzkontamination gezielt provozieren und Zeit **sowie Ressourcenverbrauch** messen. „Ein Drittel“ bleibt bis dahin eine Schätzung. Replay, gepinnter Firefox-Kern, Referenzen und Probe-Live-Check bleiben sichtbar ausstehend; ihre Einführung darf dadurch nicht still entfallen.

**Schritt 2 angenommen im vorgelegten Umfang:** geschlossene deklarierte Werkzeugfelder und korrigierte tatsächliche Renumber-Felder; die negativen Policy-Fälle bestehen. Die statische Prüfung ist zunächst eine Feldinventur mit benannten Map-/Opaque-Grenzen, kein Nachweis jeder tatsächlich gesendeten Nutzlast; diesen übernimmt das noch ausstehende Replay. Die als OPEN benannten Multi-Jog-Eintragsgrenzen dürfen folglich auch nicht als bereits geprüft gelten. Probe-Klick und #3036-Zuordnung wurden in R254 unabhängig geprüft; PF-01 ist mit R255 geschlossen und muss beim Zusammenführen natürlich enthalten bleiben.

**Firefox-Machbarkeit:** Die benannte Touch-Grenze ist ehrlich; Maus/Tastatur im Firefox-Kern und Touch in Chromium sind für diesen Nachweis akzeptabel. Eine echte Touch-/Maschinenbrowser-Abnahme wird dadurch nicht behauptet. Versionspin, vollständiger Hash und eigener Referenzsatz bleiben Schritt 6. Die bisherige Operatorfrage Q248-1 zur tatsächlichen Browserinstallation bleibt separat, ohne neue Rückfrage für diese Runde.

### Eigene Prüfung

Eigene isolierte Kopie von `08fb69d9`: **Build PASS; 28 Auswahl-Wächter und 136 Policy-Tests grün (zusätzlich drei Subtests); 12/12 gezielte Unit-Tests grün; vollständige und selektive Discovery geprüft.** Die Gegenproben reproduzieren die obigen Lücken trotz grüner vorhandener Wächter. Anfangs blockierte die Sandbox die rein lesenden Python-Unterprozesse des Schema-Tests und der vollständigen Discovery; nach genehmigter Wiederholung grün, ohne Produktänderung. Die Kopie ist nach allen Gegenproben wieder sauber.

Kein vollständiger Gate-Neulauf, kein neuer Produkt-Browser- oder nativer Antastlauf, keine Server gestartet und kein Zugriff auf die LAN-Sim. Die Zeitwerte aus dem 24-Minuten-Lauf und den 60 historischen Runden sind Claudes Messung beziehungsweise Schätzung, keine eigene Wiederholung.

[Prüfprotokoll](test-strategy.r256.notes.md) · [Ergebnisse und Auswahlen](test-strategy.r256.results.json) · [Testausgaben](test-strategy.r256.checks.txt) · [Auswahl-Gegenproben](test-strategy.r256.probes.py) · [Fokus-Gegenprobe](test-strategy.r256.only-probe.py) · [Sechs aufgelistete Tests](test-strategy.r256.only-listed.json) · [Ein ausgeführter Test](test-strategy.r256.only-actual.json).
