# Ein Mock je Worker — der volle Browserlauf parallel

## Claude · Planrunde · Anfrage R261 · 3. November 2026 · Design-Frage, kein Code-Review

### Anlass

Der Operator (2026-11-02): „die tests dürfen nicht ewig dauern“. Codex hat in R256 einen **Mock je Worker als nächstes eigenes Paket** angenommen, mit klaren Bedingungen. Die Messung dazu:
- Der volle Browserlauf ist **seriell**: 54 min Wandzeit bei 54 min Testzeit trotz drei Workern.
- Grund ist die Projektkette. Sie gibt dem einen, zustandsbehafteten Mock genau einen Besitzer.
- Von den letzten 60 Review-Runden wären auch mit dem Rundengate 38 voll gelaufen.
- Ein paralleler voller Lauf beschleunigt jede volle Runde und jedes Merge-Gate, und auch gewählte Läufe mit mehreren Dateien.

### Ist (gemessen am Stand `012cf3d5`)

- **`ctl.ts` ist die eine Stelle:** Alle 876 `ctl()`-Aufrufe in 46 Dateien gehen über `CTL = "ws://localhost:4174/ctl"`. `MOCK = "http://localhost:4174/"` steht 117-mal in 34 Dateien; die meisten importieren es aus `ctl.ts`. Sechs Specs definieren es selbst (`armed` fest, fünf Werkzeug-Specs mit Override `TOOL_IMPORT_TEST_URL`).
- **Die App liefert der Mock aus** (`dist/`), und ihr WebSocket verbindet sich zum eigenen Ursprung. Eine Seite folgt also dem Mock, von dem sie geladen wird; die sechs eigenen Kontexte in `scenes.viewer` navigieren ebenfalls zu `MOCK`.
- **Kein Spec startet einen eigenen Mock.** Er ist ein `webServer` der Konfiguration (`MOCK_PORT` kennt er schon). Die Vorschau auf 4173 ist zustandslos und dient nur `smoke`.
- **Die Kette** `chromium → serial-tools → … → serial-viewer` dient laut ihren Kommentaren allein dem einen Mock: `nine-axis`/`touchoff` tauschen den Achssatz global, `lifecycle` schließt Verbindungen global, der Leck-Prüfer in `viewer.spec` braucht einen ruhigen Renderer.

### Entwurf

1. **Port je Worker.** Playwright setzt in jedem Worker-Prozess `TEST_PARALLEL_INDEX`: 0 bis Worker−1, stabil auch für einen Ersatzworker, anders als `workerIndex`. `ctl.ts` berechnet daraus beim Import `MOCK` und `CTL` (Port `4500 + Index`). Die sechs eigenen Konstanten fallen weg; der Override für einen echten Gateway bleibt in `ctl.ts` als **eine** Stelle.
2. **Der Mock als Worker-Fixture.** `e2e/test.ts` erweitert `test` um eine automatische Worker-Fixture:
   - Sie startet `mock-gateway.mjs` mit `MOCK_PORT`, wartet auf Bereitschaft und beendet ihn beim Abbau.
   - **Ein belegter Port ist ein Fehler, nie ein fremder Mock.**
   - Der Mock beendet sich selbst, wenn sein Elternprozess endet (stdin geschlossen). Ein abgestürzter Worker hinterlässt also keinen Mock, der den Port seines Ersatzes belegt.
   - Jeder Spec importiert `test`/`expect` aus `./test`, nie direkt aus `@playwright/test` (ein Wächter prüft das). Dieselbe Datei trägt später das Cookie `e2e_origin` des Replays (Plan-Schritt 5, R251) — beide Pakete teilen diese Umstellung.
3. **Konfiguration.**
   - Die Kette fällt weg; an ihre Stelle tritt **Unabhängigkeit zwischen Workern**, und die nötige Reihenfolge **innerhalb einer Datei** bleibt (`fullyParallel: false`).
   - Ein Projekt verteilt die Dateien auf N Worker, jeder mit eigenem Mock, Achssatz und Verbindungen.
   - Der Leck-Prüfer läuft in seinem Worker; ob er dort ruhig genug ist, entscheidet die Messung (Frage 2).
   - `playwright.gate.config.ts` und `playwright.select.config.ts` folgen derselben Struktur. Der Reihenfolgenachweis wird zu: in jedem Worker Datei nach Datei ohne Überlappung, zwischen Workern keine Forderung.
   - Die Ports-frei-Prüfung des Rundengates deckt den ganzen Bereich ab.
4. **Reset bleibt je Test.** `openLayout` und die Specs setzen den Mock heute schon zurück (`ctl reset`). Innerhalb eines Workers gilt also dasselbe wie heute in der Kette: Eine Datei findet, was die vorige ihres Workers hinterließ, und setzt zurück.

### Nachweise vor dem Umschalten (deine R256-Bedingungen)

- **Derselbe Testsatz seriell (1 Worker) und parallel (2 und 3 Worker):** gleiche Testidentitäten, alle grün, `check_executed` je Lauf. Gemessen werden Wandzeit, CPU und Spitzenspeicher (cgroup `MemoryPeak` der Gate-Unit). „Ein Drittel“ bleibt bis dahin eine Schätzung; die VM hat 6 Kerne, und die Viewer-Specs rendern per SwiftShader.
- **Kreuzkontamination gezielt provoziert:** Ein Sentinel-Spec setzt in Worker A einen Mock-Zustand (Achssatz, ein Programm), ein zweiter in Worker B prüft dessen Abwesenheit. Rot am heutigen geteilten Mock, grün mit Mock je Worker.
- **Ersatzworker:** Ein Test beendet seinen Worker hart. Der Ersatz bekommt denselben Index, findet den Port frei (der alte Mock hat sich beendet) und einen frischen Zustand.
- **Fremder Server:** Ein belegter Worker-Port bricht die Fixture mit Grund ab.
- **Retry und Herkunft:** keine Änderung. Retries sind 0, und der Replay-Herkunftsvertrag (Lauf/Test/Projekt/Retry/Verbindung) bleibt Schritt 5; ein Worker-Port ersetzt ihn nicht.

### Was ich nicht vorschlage

- `layout.spec` zu teilen. Das ist ein eigener, späterer Schritt und hilft vor allem gewählten Läufen.
- Die Worker-Zahl über das Gemessene hinaus. Sie wird aus den Messungen gewählt, nicht geschätzt.

### Fragen an dich

1. Trägt `TEST_PARALLEL_INDEX` plus eine Worker-Fixture in `e2e/test.ts` (ein Import-Wechsel in allen Specs, mit Wächter) als Bindung, oder siehst du eine engere Form?
2. Soll der Leck-Prüfer (`viewer.spec`) vorsorglich in ein eigenes, nachgelagertes Projekt mit einem Worker? Oder entscheidet die Messung, ob er im parallelen Lauf stabil ist?
3. Reichen die Nachweise oben, um danach den parallelen Lauf zum vollen Lauf zu machen?

Wenn der Plan trägt, bitte `agreement`, gern mit Änderungen. Dann baue ich auf einem Zweig von `feat/test-tiers`.


---

## Codex · Planprüfung R261 · 3. November 2026

**Urteil: `findings`. Ein Mock je Worker und eine gemeinsame Worker-Fixture sind die richtige Grundlage. Vor dem Bau bitte die vier Verträge PM261-01 bis -04 ergänzen. Keine Operatorentscheidung erforderlich. Das Agreement R260 zum selektiven Rundengate bleibt bestehen.**

### Antworten auf die drei Fragen

1. **Ja zu `TEST_PARALLEL_INDEX` und einer automatischen Worker-Fixture**, mit der unten präzisierten Zielbindung und Portübergabe. Playwright hält den `parallelIndex` beim Ersatzworker stabil und vergibt einen neuen `workerIndex`; beide zusammen mit einer Laufkennung sind deshalb nützlich. Eine Worker-Fixture ist für einen solchen Dienst vorgesehen. [Playwright: Worker-Indizes](https://playwright.dev/docs/test-parallel#worker-index-and-parallel-index), [Worker-Fixtures](https://playwright.dev/docs/test-fixtures#worker-scoped-fixtures).
2. **Den Leck-Prüfer zunächst parallel messen.** `renderer.info` gehört zum jeweiligen Renderer; der bisherige fremde Achs-/Programmbroadcast entfällt durch die Mock-Trennung. CPU-/SwiftShader-Konkurrenz bleibt und kann die Beruhigungszeit beeinflussen. Deshalb zusätzlich gezielt `viewer.spec` zusammen mit den schweren Viewer-Specs wiederholen. Wenn die unveränderten Aussagen dann unzuverlässig werden, zunächst die Worker-Zahl reduzieren; ein eigener nachgelagerter Lauf nur für diesen Prüfer ist die begründete zweite Option. Keine breitere Toleranz und kein Retry zur Kaschierung.
3. **Die genannten Nachweisarten passen, sind aber noch nicht vollständig festgelegt.** Es fehlen die Isolation aufeinanderfolgender Tests, eine garantierte Gleichzeitigkeit des Kontaminationssentinels, die Übergabe bei verzögertem Mock-Ende und der Abgleich beim Wechsel der Projektidentitäten. Diese Ergänzungen stehen unten.

### PM261-01 · Reset als Fixture-Vertrag statt Annahme über alle Specs

„Reset bleibt je Test“ ist im Bestand nicht durchgehend wahr. `armed.spec.ts:13–21` navigiert direkt und erwartet die bereite Maschine, ohne Reset. `frames.spec.ts:21–37` erwartet zunächst X=`12.345`, setzt X=`99.125` und stellt danach nur `quiet` zurück. Auch hier gibt es keinen Reset-Hook. Die neue Dateizuteilung darf nicht davon abhängen, ob zufällig ein anderer Spec zuvor aufgeräumt hat.

**Eigene Probe am unveränderten Mock, eigener Port:** erster Client `{armed:true, x:12.345}`; nach Kontrolländerung und Schließen der alten Clients erhält ein neuer Client `{armed:false, x:99.125}`. Erst explizites `reset` stellt die Ausgangswerte wieder her. Ein frischer Browser-Kontext allein genügt also nicht.

**Vorschlag als Vertrag:** Eine automatische Test-Fixture stellt vor dem jeweiligen Test-Setup den bestätigten Mock-Grundzustand her. Sie hängt von der Worker-Fixture ab; Seiten/Verbindungen des Vorgängers müssen geschlossen sein. Vorhandene zusätzliche Resets dürfen zunächst bleiben. Einstellungen aus `beforeAll` gesondert inventarisieren: Ein automatischer Reset darf sie nicht still löschen; nötige Zustände gehören dann in das Setup jedes Tests. Die Fixture-Reihenfolge lässt sich über ausdrückliche Abhängigkeiten festlegen. [Playwright: Fixture-Reihenfolge](https://playwright.dev/docs/test-fixtures#execution-order).

**Wächter:** Auf demselben Worker lässt ein Test absichtlich veränderte Achsen, Status und Antwortskripte zurück; der nächste Test beziehungsweise die nächste Datei sieht trotzdem die vereinbarte Basis. Dieser Nachweis ergänzt den Sentinel zwischen zwei Workern.

### PM261-02 · Alle Zugriffe an denselben eigenen Mock binden

Der heute auf fünf Werkzeug-Specs begrenzte `TOOL_IMPORT_TEST_URL` darf durch seine Zentralisierung **nicht alle Worker auf denselben externen Ursprung lenken**. Dann liefen die neuen eigenen Mocks zwar, wären aber nicht die geprüften Dienste; die Isolation wäre aufgehoben. Der Vorschlag „Override für einen echten Gateway bleibt“ braucht deshalb eine klare Trennung.

**Vorschlag:** Im Runden- und Merge-Gate ist ein gesetzter Ziel-Override ein verständlicher Fehler. Ein gezielter Entwicklerlauf mit fremdem Ziel bleibt ein eigener, ausdrücklich gewählter Modus mit einem Worker und zählt nicht als Mock-Gate. HTTP, `/ws` und `/ctl`, Werkzeughelfer und manuell angelegte Browser-Kontexte müssen aus derselben bestätigten Endpoint-Bindung stammen. `smoke` behält ausdrücklich den gatewaylosen Ursprung auf 4173.

Zusätzlich festlegen: `--list` läuft ohne Worker-Index und darf weder Dienste starten noch Sockets öffnen. Beim tatsächlichen Testlauf darf ein fehlender/ungültiger Index nicht auf 4174 oder einen gemeinsamen Port zurückfallen; die Fixture prüft den berechneten Slot gegen `workerInfo.parallelIndex`. Wächter für fehlenden/falschen Index, Override im Gate und verbliebene feste Mock-Adressen vorsehen. Der Import-Wächter allein beweist diese Zielbindung noch nicht.

### PM261-03 · EOF räumt auf, garantiert aber keine abgeschlossene Portübergabe

Dass der alte Mock bei geschlossenem stdin endet, ist sinnvoll. Daraus folgt jedoch nicht, dass er den Port bereits freigegeben hat, wenn der Ersatzworker ihn benötigt. Die Verarbeitung des EOF und der neue Prozessstart sind getrennte Abläufe. Der Plan verlangt derzeit zugleich „belegter Port immer Fehler“ und „Ersatzworker findet den Port frei“, ohne deren Übergang zu definieren.

**Erforderlicher Vertrag:** Bereitschaft bedeutet eine bestätigte erfolgreiche Bindung des **eigenen** Kindprozesses, nicht bloß eine erreichbare HTTP-Seite. Normaler Abbau wartet begrenzt auf das Ende dieses Kindes; unerwartetes Ende während des Tests macht den Nachweis rot. Bei Ersatz entweder die Freigabe des nachweislich eigenen Vorgängers begrenzt abwarten oder einen neuen eigenen Endpoint verwenden. Ein fremder Prozess wird weder übernommen noch beendet. Nur „Port gerade frei“ ist keine Besitzerkennung.

Mein engerer Gegenentwurf wäre ein vom Kind bestätigter freier Port und ein von der Fixture gelieferter Endpoint. Die feste Slot-Adresse ist ebenfalls akzeptabel, wenn die Übergabe ausdrücklich gelöst wird. Bitte eine Variante festlegen. Die Bindung kann `(runId, parallelIndex, workerIndex, mockInstance, endpoint)` protokollieren; sie ersetzt weiterhin nicht die spätere Verbindungsherkunft des Replays.

**Wächter:** Neben normalem Abbau, hartem Worker-Ende und fremdem Server auch einen absichtlich verzögerten Abschluss des eigenen Mocks prüfen; der Ersatz übernimmt nie dessen alten Zustand. Die Crash-Probe gehört in einen eigenen Prüfharness: Der absichtlich abgebrochene innere Lauf darf einen Fehler liefern, und der äußere Wächter prüft anschließend den Ersatzworker. Das normale Gate behält seine Regel „kein PASS nach Fehler/Retry“. Playwright startet auch bei deaktivierten Retries nach einem fehlgeschlagenen Test einen neuen Worker für Folgetests. [Playwright: Worker nach Fehlern](https://playwright.dev/docs/test-retries#failures).

### PM261-04 · Den neuen Nachweis konkret an die neue Struktur binden

Die Kette darf nach bewiesener Isolation entfallen; eine globale Dateireihenfolge ist dann keine Anforderung mehr. Der neue Nachweis braucht aber mehr als drei grüne Gesamtzahlen:

- **Bestand gegen neue Konfiguration:** Die bisherige Testidentität enthält `(Datei, Projekt, Titelpfad)` (`proof.py:152–163`). Mehrere bisherige Projekte werden zu einem; wörtlich „gleiche Identitäten“ geht über diesen Umbau hinweg also nicht. Einmalig die Projektumbenennung ausdrücklich abbilden und die Fälle bijektiv abgleichen. Innerhalb der neuen seriellen/2-/3-Worker-Läufe sowie zwischen Full und Selected bleibt die vollständige Identität einschließlich Projekt erhalten. Keine allgemeine Entfernung des Projekts aus `check_executed`.
- **Ausführung:** `fullyParallel:false`, kein übersteuernder Parallelmodus innerhalb der Specs; pro konkretem Worker-Prozess nacheinander ausgeführte Tests/Dateien. Bericht und Fixture-Ereignisse verbinden Ergebnisse mit Slot, Worker-Generation und Mock. Zwei gleichzeitig aktive Besitzer verwenden nie dieselbe Mock-Instanz. Fehlende Zuordnungen sind ein Fehler, kein ausgelassener Nachweis.
- **Kontaminationssentinel:** Zwei Specs allein garantieren weder unterschiedliche Worker noch Gleichzeitigkeit. Eine Barriere hält A im veränderten Zustand, bis B dessen Abwesenheit geprüft hat; verschiedene aktive Worker werden belegt. Auch B setzt zurück, während A seinen Zustand weiter behalten muss. Gegen denselben gemeinsamen Mock muss diese Probe rot werden.
- **Selektiver Lauf:** Zusätzlich zu den drei Voll-Läufen mindestens einen Mehrdateien-Auswahllauf samt vollständigem Discovery-/Ausführungsabgleich prüfen. Die neue Fixture und ihre Prozess-/Endpoint-Helfer müssen in der zentralen Testauswahl und den Leseort-Deklarationen erfasst sein. Die bisherige Verweigerung fremder Server und fokussierter Tests bleibt in Full und Selected wirksam.

### Messung und Umfang

Ein Vergleich mit **1, 2 und 3 Workern am selben Quellstand** ist angemessen: Wandzeit, gesamte CPU-Zeit und Speichermaximum einschließlich Browsern und Mock-Kindern aus derselben Gate-Unit, identische Assertionen/Referenzen und keine Wiederholungen fehlgeschlagener Tests als PASS. Die günstigste gemessene Worker-Zahl wählen; drei Worker sind kein Ziel an sich. Zusätzliche Stabilitätsläufe zunächst auf die bekannten empfindlichen Viewer-Specs begrenzen, statt pauschal weitere vollständige Läufe anzuhängen.

Das Teilen von `layout.spec` und der eigentliche Replay-Ausbau bleiben separate Pakete. Für diese Planrunde wurden Quellen am Stand `012cf3d5`, die installierte Playwright-Version 1.60.0 und offizielle Dokumentation geprüft. Die kleine Protokollprobe lief ausschließlich in einer isolierten Kopie; kein Browserlauf, kein Live-Sim-Zugriff, keine Produktänderung. Der eigene Mock ist beendet.

[Quellinventur](per-worker-mock.r261.inventory.json) · [Prüfprotokoll](per-worker-mock.r261.notes.md) · [Reset-Sonde](per-worker-mock.r261.reset-probe.mjs) · [Ergebnis](per-worker-mock.r261.reset-result.json).


---

## Claude · Planfassung 2 · Anfrage R262 · 3. November 2026 · PM261-01 bis -04

Die Grundlage bleibt wie angenommen: Port je `TEST_PARALLEL_INDEX`, eine automatische Worker-Fixture, der Leck-Prüfer zunächst parallel gemessen. Zu den vier Verträgen je eine Festlegung.

### PM261-01 · Reset als Fixture-Vertrag

- **`mockBaseline`**: eine automatische **Test**-Fixture, die von der Worker-Fixture `mock` abhängt. Vor jedem Test, nach dem Abbau von Seite und Kontext des Vorgängers (Playwright baut die Test-Fixtures am Testende ab), schickt sie `ctl reset` an den **eigenen** Mock und wartet auf die bestätigte Antwort.
  - Der Reset stellt den ganzen beim Start eingefrorenen Ausgangszustand wieder her: Zustand, Achsen, Kinematik, `replies`, `envelope`, `quiet`, `refuseWs`, Einstellungen, `hellos`, `cmds`.
  - Vorhandene Resets in den Specs bleiben; sie sind ab dann doppelt, aber harmlos.
- **`beforeAll`-Inventur:** Kein Spec nutzt `beforeAll` oder `describe.configure` (Stand `012cf3d5`). Ein Wächter verbietet beides in `e2e/`, solange der Reset je Test gilt. Der Zustand eines Tests gehört in sein eigenes Setup.
- **Wächter, im selben Worker:** Ein Test lässt einen veränderten Achssatz (9 Achsen), ein `status_delta`, ein `replyFor`-Skript und `quiet` zurück. Der nächste Test derselben Datei und die nächste Datei desselben Workers sehen trotzdem den Ausgangszustand.
  - Dafür bekommt der Mock eine lesende ctl-Op `snapshot` (Achsen, `armed`, ausgewählte Statusfelder, `replies`-Schlüssel, `quiet`, `refuseWs`).
  - Rot ohne die Fixture.

### PM261-02 · Eine Zielbindung

- **`ctl.ts` berechnet `MOCK`/`CTL` beim Import aus `TEST_PARALLEL_INDEX`** (Port `4500 + Index`). Fehlt der Index oder ist er ungültig (`--list` im Hauptprozess), wird die Adresse `http://mock-unbound.invalid/`.
  - Es gibt **keinen Rückfall auf 4174** und keinen gemeinsamen Port. Beim Import startet nichts und öffnet sich nichts; eine Verwendung ohne Bindung scheitert sichtbar.
- **Die Worker-Fixture prüft** `TEST_PARALLEL_INDEX === workerInfo.parallelIndex` und dass `MOCK`/`CTL` auf genau ihren Slot zeigen. Sonst bricht sie mit Grund ab.
- **`TOOL_IMPORT_TEST_URL` entfällt ersatzlos.** Er steht nur in den fünf Werkzeug-Specs, nirgends in Doku, CI oder Skripten. Es gibt also keinen Override, weder im Gate noch daneben. Ein Lauf gegen einen echten Gateway wäre später ein eigener Modus.
- **Eine Bindung für alles:** HTTP, `/ws` und `/ctl` aller Specs, Helfer (`publishToolTable` u. a. erhalten ihre Basis aus `ctl.ts`) und die eigenen Kontexte in `scenes.viewer` nutzen dieselbe Adresse aus `ctl.ts`. `smoke` behält ausdrücklich den gatewaylosen Ursprung `baseURL` 4173.
- **Wächter:**
  - Keine Mock-Adresse (`4174`, `localhost:45…`) außerhalb von `ctl.ts`, kein `TOOL_IMPORT_TEST_URL`.
  - Jeder Spec importiert `test` aus `./test`, kein Spec aus `@playwright/test`.
  - Die reine Port-Funktion liefert bei fehlendem, nicht numerischem oder negativem Index die ungebundene Adresse.
  - Die Fixture bricht bei einem falschen Index ab.

### PM261-03 · Portübergabe · Festlegung: feste Slot-Adresse mit nachgewiesener Übergabe

- **Bereitschaft ist die bestätigte Bindung des eigenen Kindes.** Der Mock schreibt nach dem `listen`-Callback `MOCK-BOUND <port> <instance>` auf stdout, mit einer Instanz-ID, die die Fixture vergibt. Die Fixture wartet auf genau diese Zeile ihres Kindes; eine erreichbare HTTP-Seite zählt nicht.
- **Besitzregister:** Die Fixture schreibt nach der Bestätigung `<tmp>/lcnc-e2e-mock/<runner-pid>-<slot>.json` mit `runner-pid` (dem Elternprozess der Worker: eine Kennung je Lauf), `slot`, `workerIndex`, Instanz, Kind-PID und Port. Beim Abbau entfernt sie es.
- **Normaler Abbau:** stdin schließen, dann begrenzt warten (5 s) bis zum Ende des **eigenen** Kindes; danach SIGTERM, 2 s, SIGKILL, warten. Endet das Kind unerwartet während eines Tests, lässt die Test-Fixture diesen Test rot werden („mock died“), geprüft vor und nach jedem Test.
- **Ersatzworker:**
  - Ist der Slot-Port belegt, liest die Fixture das Register. Steht dort ein lebender Vorgänger **desselben Laufs und Slots**, wartet sie begrenzt (5 s) auf die Freigabe; dieser Vorgänger endet ohnehin, weil seine stdin mit dem alten Worker zu ist. Danach bindet sie mit neuer Instanz und frischem Zustand.
  - Bleibt der Port belegt, oder fehlt ein Registereintrag dieses Laufs: Abbruch mit Grund.
  - Ein fremder Prozess wird nie übernommen und nie beendet.
- **Ereignisprotokoll:** `mock-events.jsonl` im Ausgabeordner mit `(run, slot, workerIndex, instance, endpoint)` und je Test `test-start`/`test-end` (Datei, Projekt, Titelpfad). Es belegt die Ausführung (PM261-04), ersetzt aber nicht die Verbindungsherkunft des Replays (Schritt 5).

### PM261-04 · Nachweise an die neue Struktur gebunden

- **Einmalige Abbildung alt → neu:**
  - `--list` der alten Gate-Konfiguration (Kette) gegen die neue (ein Projekt `e2e`). Die alten Projekte werden ausdrücklich auf `e2e` abgebildet, und die Fälle `(Datei, Titelpfad)` werden bijektiv abgeglichen.
  - Danach behalten alle Läufe die volle Identität mit Projekt: seriell, 2 und 3 Worker, Full und Selected. `check_executed` bleibt unverändert.
- **Ausführung:**
  - `fullyParallel: false`; ein Wächter verbietet `describe.parallel`/`describe.configure` in `e2e/`.
  - Aus dem Ereignisprotokoll: In jedem Worker-Prozess laufen die Tests nacheinander, ohne Überlappung. Jede Mock-Instanz hat genau einen Besitzer, und zwei gleichzeitig aktive Worker teilen nie eine Instanz.
  - Jeder Test des Berichts hat seine Ereignisse mit Slot und Instanz; ein fehlendes Ereignis ist ein Fehler. Das wird `proof.check_workers`, mit eigenen synthetischen Gegenfällen.
- **Kontaminationssentinel mit Barriere**, als eigener Prüfharness (`e2e-proof/`, eigene Konfiguration mit 2 Workern, nicht im normalen Lauf):
  - Spec A setzt auf seinem Mock 9 Achsen, ein `replyFor`-Skript und `quiet`, meldet sich an einer Dateisystem-Barriere und wartet, bis B geprüft hat.
  - B wartet auf A, setzt den eigenen Mock zurück und prüft dessen Ausgangszustand; danach meldet B.
  - A prüft zuletzt, dass sein Zustand **noch** steht. Belegt werden verschiedene `parallelIndex`, Gleichzeitigkeit per Barriere und Zeitstempel.
  - **Gegenprobe gegen einen gemeinsamen Mock:** Eine Harness-Variable legt beide auf Slot 0, dann sieht B A's Zustand, oder A verliert ihn durch B's Reset. Das muss **rot** werden.
- **Weitere Harness-Fälle**, jeweils als innerer Lauf, der scheitern darf, mit äußerer Auswertung der Ereignisse:
  - **Hartes Worker-Ende** (`process.exit` in einem Test): Der Ersatz mit demselben Slot und neuem `workerIndex` bindet nach der Freigabe und findet den Ausgangszustand.
  - **Verzögertes Ende des eigenen Mocks** (ein Testhaken im Mock verzögert das Beenden nach EOF): bei 3 s wartet der Ersatz und bindet, bei 8 s bricht er mit Grund ab.
  - **Fremder Server** auf einem Slot-Port: Abbruch, der fremde Prozess lebt weiter.
  - Das normale Gate behält „kein PASS nach Fehler oder Retry“.
- **Selektiver Lauf:** mindestens ein Auswahllauf über mehrere Dateien mit vollständigem Discovery- und Ausführungsabgleich. `e2e/test.ts` und der Fixture-Helfer sind zentrale Regeln (FULL); der Start des Mocks per `spawn` steht in `READ_SITES`. Fremde Server und fokussierte Tests bleiben in Full und Selected verweigert, die Ports-frei-Prüfung deckt `4500…4500+N`.
- **Messung:**
  - Am selben Quellstand 1, 2 und 3 Worker, jeder Lauf als eigene Gate-Unit. Gemessen werden Wandzeit, `CPUUsageNSec` und `MemoryPeak` der Unit (Browser und Mock-Kinder eingeschlossen), bei identischen Assertionen und Referenzen und ohne Retry-PASS.
  - Gewählt wird die günstigste gemessene Worker-Zahl.
  - Danach `viewer.spec` gezielt mit den schweren Viewer-Specs wiederholt. Wird der Leck-Prüfer unzuverlässig, sinkt zuerst die Worker-Zahl; ein eigener nachgelagerter Lauf ist die zweite Option. Keine breitere Toleranz.

### Reihenfolge des Baus

1. Fixture, Bindung, Register, Reset, Wächter. Die Kette bleibt dabei zunächst (1 Worker je Projekt); das ist der serielle Referenzlauf.
2. Der Prüfharness mit Sentinel, Ersatzworker, Verzögerung und fremdem Server, rot gegen gemeinsamen Mock bzw. alten Stand.
3. Die neue Konfiguration mit der einmaligen Abbildung alt → neu.
4. Die Messung 1/2/3 und die Wahl der Worker-Zahl.
5. Die Implementierungsprüfung bei dir.

Wenn die vier Festlegungen tragen, bitte `agreement`.


---

## Codex · Planprüfung R262 · 3. November 2026

**Urteil: `agreement` für Planfassung 2 mit den beiden unten konkretisierten Harness-Abnahmekriterien. PM261-01 bis -04 sind damit auf Planebene geschlossen. Der Bau kann in der vorgeschlagenen Reihenfolge beginnen; eine weitere Planrunde ist dafür nicht nötig. Keine Operatorfrage.**

### Die vier Festlegungen sind angenommen

- **PM261-01:** `mockBaseline` als automatische Test-Fixture mit bestätigtem Reset und Abhängigkeit vom eigenen Worker-Mock löst den Befund. Die Wächter für den Folgetest und die nächste Datei sowie die `beforeAll`-Inventur decken den zuvor fehlenden Vertrag ab.
- **PM261-02:** Die ungebundene Adresse für Discovery, die Prüfung gegen `workerInfo.parallelIndex` und das ersatzlose Entfernen des ungenutzten Overrides sind schlüssig. HTTP, App-WebSocket und Kontrollkanal bleiben an denselben Endpoint gebunden; `smoke` behält seinen getrennten Ursprung. Bei der Ausführung zählt nur ein gültiger ganzzahliger Slot im konfigurierten Bereich.
- **PM261-03:** Die feste Slot-Adresse ist mit eigener `MOCK-BOUND`-Bestätigung, Besitzregister und begrenzter Übergabe akzeptiert. Das Abwarten eines belegten Ports ist nur beim nachgewiesenen eigenen Vorgänger zulässig; ein fremder Prozess bleibt unangetastet. Unerwartetes Kind-Ende muss den Nachweis wie beschrieben rot machen.
- **PM261-04:** Einmalige explizite Projektabbildung, danach unverändert vollständige Testidentitäten, Worker-Zuordnung aus dem Ereignisprotokoll und ein eigener negativer Prüfharness passen zusammen. Die Messungen 1/2/3, der Mehrdateien-Auswahllauf und die gezielten Leck-Prüfer-Wiederholungen bleiben Teil der Implementierungsabnahme.

### Zwei verbindliche Präzisierungen für die Harness-Abnahme

**1. Die gemeinsame-Mock-Gegenprobe muss an der Zustandsprüfung scheitern.** Die Formulierung „beide auf Slot 0“ allein genügt nicht: Worker B hat weiterhin einen anderen `parallelIndex`; die neue Fixture könnte bereits dessen falschen Slot oder den belegten Port ablehnen. Ein roter Lauf aus diesem Grund beweist nicht die Empfindlichkeit des Kontaminationssentinels.

Im ausschließlich negativen Harness deshalb **einen gemeinsamen Mock bereitstellen und beide tatsächlichen Worker daran anbinden**, mit derselben Zustands- und Barrierenprüfung wie im positiven Fall. Dafür darf der Harness seine eigene Fixture/Transportbindung verwenden; die normale E2E-Fixture erhält keinen Schalter zum Umgehen ihrer Besitzerprüfung. Die äußere Auswertung verlangt, dass beide Teilnehmer die vorgesehenen Phasen erreicht haben und genau die erwartete Zustandsabweichung festgestellt wurde — insbesondere A verliert seinen Zustand nach B's bestätigtem Reset. Slotfehler, Bindefehler und Barrieren-Timeout zählen hierfür nicht als erfolgreicher Gegenbeweis. Die eigenen Negativtests dieser Schutzmechanismen bleiben davon getrennt.

**2. Die Verzögerungsprobe muss relativ zum Übergabewarten gesteuert werden.** Die 5-s-Grenze beginnt beim Ersatzworker, die vorgeschlagenen 3/8 s bislang beim EOF des alten Workers. Startet der Ersatz etwa erst vier Sekunden nach EOF, ist ein nach acht Sekunden endender Mock noch innerhalb des zulässigen Wartens weg. Ein langer Worker-Start darf den erwarteten Ausgang nicht umkehren.

Der Harness hält den Vorgänger deshalb bis zum belegten Beginn des Übergabewartens und steuert seine Freigabe von dort: einmal sicher innerhalb der Grenze, einmal sicher darüber. Ein Marker/Handshake ist dafür geeigneter als eine Annahme über die Startdauer. Der Fall innerhalb der Grenze muss eine neue Instanz mit sauberem Zustand nachweisen; der andere die benannte Übergabe-Zeitüberschreitung. Diese kontrollierte Verzögerung bleibt ausschließlich im Prüfharness.

### Umsetzung und nächste Abnahme

Die vorgeschlagene Reihenfolge — zunächst Fixture und Reset bei bestehender Kette, dann Harness, Konfigurationswechsel und Messung — ist angenommen. Bei N Workern ist der tatsächlich genutzte inklusive Portbereich `4500` bis `4500 + N - 1`; die Vorprüfung muss dieselbe aufgelöste Worker-Zahl verwenden wie der Lauf. Das Besitzregister bitte atomisch schreiben und beim Entfernen an die eigene Instanz binden. Diese Details ändern die gewählte Architektur nicht.

Das Agreement gilt für den Plan, **noch nicht für das Umschalten auf den parallelen vollen Lauf**. Dafür folgen die benannten Nachweise und das Implementierungsreview. R260 zum selektiven Rundengate bleibt unverändert; Replay und das Teilen großer Specs bleiben eigene Pakete.

Reine Planprüfung, keine erneute Ausführung der unveränderten R261-Probe und keine Produktänderung. [Abgleich und Herleitung](per-worker-mock.r262.notes.md).



---

## Claude · Implementierungsprüfung · Anfrage R263 · 3. November 2026

**Stand `e7634da3`** (`feat/per-worker-mock`, Worktree `~/lcnc-suite-pwm`, von `feat/test-tiers` `012cf3d5`). Diff: `012cf3d5..e7634da3`. Der Code steht seit `eecabc56`; `e7634da3` fügt nur die Records der Nachweisläufe an `eecabc56` hinzu.

### Schritt 1 · Fixture, Bindung, Register, Reset (`6d025e1a`)

- **`e2e/mockSlot.mjs`:** rein, ohne Ein-/Ausgabe. Ein Slot ist nur ein ganzzahliger `TEST_PARALLEL_INDEX` in 0…15, sein Port `4500 + Slot`. Ohne gültigen Index ist die Adresse `http://mock-unbound.invalid/`. **Gemessen:** `--list` und der Runner laden die Dateien ohne Index, jeder Worker hat seinen Index schon beim Import, und sein Elternprozess ist der Runner.
- **`ctl.ts`** bindet `MOCK`/`CTL` beim Import an den Slot. HTTP, App-WS und `/ctl` aller Specs und Helfer kommen von hier, die sechs eigenen Adressen und `TOOL_IMPORT_TEST_URL` sind entfernt.
- **`e2e/test.ts`, Worker-Fixture `mock` (auto):**
  - Sie prüft den Slot gegen `workerInfo.parallelIndex` und `MOCK` gegen dessen Port.
  - `mockFixture.startMock` startet den eigenen Mock mit Instanz-ID. **Bereit** ist er erst bei der Zeile `MOCK-BOUND <port> <instance>` dieses Kindes.
  - Das Besitzregister wird atomar geschrieben (Temp-Datei, dann `rename`) und nur von der eigenen Instanz entfernt.
  - Bei belegtem Port wartet die Fixture nur auf den lebenden Vorgänger **desselben Laufs und Slots**, begrenzt auf 5 s. Alles andere ist ein Abbruch; ein fremder Prozess wird nie benutzt oder beendet.
  - Abbau: stdin schließen, 5 s, dann TERM, 2 s, KILL.
- **Mock:** `snapshot` (lesend, zählt die App-Sockets), `MOCK-BOUND` und ein Abbruch mit Grund bei belegtem Port. Er endet bei stdin-EOF, aber nur mit `MOCK_EXIT_ON_STDIN_EOF=1`; ein manueller Start bleibt unverändert. Der Haltehaken `MOCK_EXIT_HOLD_UNTIL` dient allein dem Harness.
- **Test-Fixture `mockBaseline` (auto):** keine App-Verbindung des Vorgängers mehr offen (gepollt), dann `reset`, dann der Snapshot gleich dem beim Start des Mocks. Am Testende schließt sie jeden noch offenen Kontext; die sechs eigenen Kontexte in `scenes.viewer` schließen nicht im `finally`. Ein gestorbener Mock macht den Test rot.
- **Ereignisprotokoll** je Lauf mit `bound`/`handoff-wait`/`handoff-timeout`/`stopped` und `test-start`/`test-end` (Datei, Projekt, Titelpfad, Retry, Slot, Worker, Instanz).
- **Inventur:** Kein `beforeAll`. Die zwei `afterAll` (`nine-axis`, `setup-layout`) setzten nur zurück und sind entfernt. Ein Wächter verbietet Datei-Hooks und `describe.parallel`/`configure`.
- **Rundengate:**
  - Die Worker-Zahl kommt aus `LCNC_E2E_WORKERS`, und die Ports-Vorprüfung prüft `4173` und `4500…4500+N−1`.
  - `proof.check_workers` läuft über das Ereignisprotokoll: Jeder Test hat Start und Ende auf einem Worker und Mock, in jedem Worker laufen die Tests nacheinander, jede Instanz hat einen Besitzer.
  - CPU und Spitzenspeicher der eigenen Unit-cgroup stehen im Record.

### Schritt 2 · Prüfharness (`9f3fe7ad`, Korrektur `6a4b356a`)

`scripts/test_select/proof_harness.py` startet jeden Fall als inneren Lauf (`playwright.proof.config.ts`, `e2e-proof/`) und urteilt von außen über Bericht, Marken und Ereignisse. **7/7 PASS** (`per-worker-mock.harness.json`):
- **Eigene Mocks:** Zwei Worker laufen gleichzeitig (Barriere, überlappende Zeiten, verschiedene `parallelIndex`), und A behält seinen Zustand über B's Reset.
- **Ein gemeinsamer Mock (negativ, deine Präzisierung 1):**
  - Der Harness startet ihn selbst und bindet beide Worker mit **eigenem Transport** daran. Die E2E-Fixture bleibt ohne Schalter.
  - Er gilt nur als Gegenbeweis, wenn alle Phasen erreicht sind, B besteht, A **an seiner Zustandsprüfung** scheitert und `A-final` den zurückgesetzten Zustand zeigt. Ein Fehler an Barriere, Slot oder Bindung zählt nicht.
- **Datei nach Datei** im selben Worker: die zweite Datei sieht den Ausgangszustand derselben Instanz.
- **Hartes Worker-Ende:** Der Ersatz bekommt denselben Slot, einen neuen Worker, einen neuen Mock und den Ausgangszustand.
- **Verzögerte Übergabe (deine Präzisierung 2):**
  - Der Vorgänger wird über `MOCK_EXIT_HOLD_UNTIL` gehalten. Der Harness gibt ihn **ab dem protokollierten `handoff-wait`** frei, nicht ab dem EOF.
  - Nach 1 s: neue Instanz am Ausgangszustand. Nach 7,5 s: „handoff timed out“ plus `handoff-timeout`-Ereignis.
- **Fremder Server** auf 4500: verweigert, und er läuft weiter.
- **Lauf 1** (`harness.run1.json`): 6/7. Der Fremdserver-Fall lief ohne seinen Server, weil der gehaltene Mock des Verzögerungsfalls 4500 noch hielt. Die Korrektur: Jeder Fall beginnt auf freien Ports, und der Fremdserver-Fall weist nach, dass sein Server lauscht.

### Schritt 3 · Ein Projekt statt der Kette (`ed8e83ef`)

- **`playwright.config.ts`:** ein Projekt `e2e`, `fullyParallel: false`, `workers` aus `LCNC_E2E_WORKERS` (Vorgabe 3), keine Abhängigkeiten. Die Gate- und die Auswahl-Konfiguration erben das.
- **Einmalige Abbildung** (`per-worker-mock.identity-map.txt`): 838 Fälle aus neun Projekten, jeder genau einmal in `e2e`. Keiner fehlt, keiner kommt hinzu, bijektiv.
- **`playwrightProjects.test`** schreibt jetzt die neue Invariante fest, wo es acht serielle Projekte festhielt; der Grund steht im Kopf. Der Kettenbeweis (`full_chain`/`check_order`) entfällt, `check_workers` übernimmt.

### Schritt 4 · Messung, sieben Lastrennen, ihre Korrektur (`07a7c4f4`, `eecabc56`)

**Die Messung** an `cb4e45b4` (FULL über `round_gate`, je Worker-Zahl eine eigene Unit; `per-worker-mock.measure-w{1,2,3}.gate-round.json`):

| Worker | Urteil | Browser | ganze Runde | CPU | Spitze | Mocks |
|---|---|---|---|---|---|---|
| seriell (Kette, `6d025e1a`) | Browser PASS | 3259 s | 3441 s | 6334 s | 2247 MB | 11 |
| 1 | PASS 838/838 | 3242 s | 3414 s | 6274 s | 2358 MB | 1 |
| 2 | FAIL 2 | 1979 s | 2152 s | 6948 s | 2726 MB | 4 |
| 3 | FAIL 5 | 1705 s | 1876 s | 7352 s | 3493 MB | 8 |

`browser-executed` und `browser-workers` sind in allen drei PASS: Jeder Test lief genau einmal, auf einem Worker und dessen Mock, und jede Instanz hatte einen Besitzer. Die Fehlschläge verteilen sich auf mehrere Slots (0 und 1). Die zusätzlichen Mocks sind Ersatzworker nach den Fehlschlägen. **Keiner ist ein Isolationsfehler.** Alle sieben (sechs Tests, `sim-panel:317` in beiden Läufen) sind Lesestellen, deren Vorbedingung nur eine feste Wartezeit oder ein veralteter Treffer annahm. Die serielle Kette hat sie nie belastet.

**Die Ursachen und Korrekturen** (`per-worker-mock.load-races.txt`):
- **`sim-panel` 249 und 317:** `complete` traf die Liste **vor** der neuen; die alte ist sofort vollständig, eine leere ebenso. Gelesen wurde mitten im Füllen: 160 von 400 Zeilen, 2 von 9 Frames. `filled` wartet jetzt auf den letzten Frame der beobachteten Liste, die zwei Stellen ohne Beobachter auf die 400 Zeilen der neuen Liste.
- **`collisions` 990:** Die Position des Laufs ging einmal raus, und zwar nach einem Poll, der bis zu 500 ms zwischen seinen Lesungen wartet. Der Auto-Prüf-Timer steht auf 400 ms, also kam „start full“. Jetzt geht sie im Takt des Gateways (30 je Sekunde), bis die Version angezeigt ist. Die Produktregel „ohne Position die volle Prüfung“ bleibt.
- **`scenes` 990 und `toolsetter` 208:** Die Abbildung wurde 400 bzw. 800 ms nach dem Start einer 300-ms-Drehung gelesen, unter Last also mitten in der Drehung. `viewerSettle.ts` wartet, bis die Draufsicht steht (Achsen ausgerichtet, zwei Lesungen einen Frame auseinander gleich), und auf zwei gezeichnete Frames. `toolsetter` hat in der Messung nicht versagt, folgt aber demselben Muster.
- **`macros` 242 und `run-hold` 302:** Die 500 ms des Haltens laufen auf der Uhr des Tests (`page.clock`).
  - Die Uhr wird vor dem Laden installiert und eine Sekunde voraus angehalten, während das abbrechende Ereignis eintrifft.
  - Dann folgt `runFor(HOLD_MS)` mit gedrücktem Finger, erst danach das Loslassen und 300 ms für das, was ein gefeuertes Halten gesendet hätte.

**Rot vor, grün nach der Korrektur, unter derselben Last** (3 Worker, 3 CPU-Brenner, `--repeat-each`):
- **Rot:** `sim-panel:317` 4/4, `scenes` 3/4, `collisions` 1/4.
- **Grün:** jeder der vier 0/6.
- **Die Halte-Tests** zeigten sich unter dieser Last in der alten Form nicht; ihre Endform läuft dort 0/6 je Test (Belege, Punkt 2). Ihr Nachweis:
  - **Verzögerung:** Die Liste, die die App nach `macros_changed` liest, kommt 700 ms spät. Die alte Form fällt dann mit dem Symptom der Messung, die neue besteht.
  - **Mutation M1** (die Halteschlüssel-Beobachtung zeigt den Hinweis, behält das Halten): **rot**.
  - **Mein Fehler im ersten Durchgang:** M1 und M2 überlebten, weil meine Uhrform **vor** `runFor` losließ. Ein Loslassen vor der Haltezeit ist ein Tippen und beendet jedes Halten; der Test bewies also nichts. Die Mutationsprobe hat das gefunden.
  - **M2b** (ohne `clearTimeout` beim Unmount, ohne `pointerleave`- und `blur`-Abbruch) überlebt **zu Recht**. Ein dritter Wächter beendet das Halten auf der alten Leiste: Vue verwirft ein `emit` einer ausgehängten Komponente (`if (instance.isUnmounted) return`, 3.5.27), und die Leiste startet ihr Makro über `emit('run')`.
  - Im Protokoll der Seite endet das Halten ohne Mutation an `pointerleave`.
  - Die Kontrolle C1 zeigt, dass die Zählung lebt: dasselbe Halten ohne Orientierungswechsel, durch `runFor` gehalten, läuft genau einmal.

**Doku:** `testing.md` beschreibt den Browserlauf als ein Projekt auf N Workern mit je eigenem Mock und dazu die Signalregel samt Reproduktion eines Lastrennens; der Kurztext steht in `CLAUDE.md`. Die Spec-Köpfe nennen die serielle Kette nicht mehr.

### Der Referenzlauf und mein Fehler

**Der serielle Referenzlauf** lief an `6d025e1a`: per-Worker-Mocks unter der alten Kette (`per-worker-mock.step1.gate-round.json`). Browser **838 gelistet = 838 einmal gelaufen, 11 Mocks, Kettenreihenfolge gehalten, 3259 s**; CPU 6334 s, Spitze 2247 MB.

**Der Record ist FAIL, und zu Recht.** Ich habe während des Laufs im selben Baum Schritt 2 gebaut und dabei einen Testtitel in `tsconfigCoverage.test.ts` geändert. Der Unit-Abgleich je Test meldete „gelistet, nie gelaufen“ und „gelaufen, nie gelistet“, also genau den Fall, für den TS256-04 gebaut wurde. Seitdem arbeite ich während eines Gates in einem zweiten Worktree.

### Belege

Alle Läufe an `eecabc56`, jeder als eigene Unit, nacheinander, nie neben einem anderen Playwright-Lauf; die Records liegen in `docs/reviews/`.

1. **Ein gewählter Lauf über mehrere Dateien** (`per-worker-mock.r263-selected.gate-round.json`, `--base 07a7c4f4`, 3 Worker): **PASS**.
   - 24 Specs, **484/484**, `failed 0`, `flaky 0`; Browser 880 s, Runde ≈ 956 s, CPU 4115 s, Spitze 3391 MB.
   - `browser-listing`, `browser-executed` und `browser-workers` PASS, 3 Mocks.
   - Backend und `unit-heavy` sind mit Grund ausgelassen (eine reine UI-Runde).
2. **Die Halte-Tests in ihrer Endform unter Last** (`per-worker-mock.r263-load.txt` §1, 3 Worker, 3 CPU-Brenner, `--repeat-each 6`, `--retries 0`):
   - `macros:242` 0/6, `run-hold:303` 0/6.
   - Das ist dieselbe Last, unter der die anderen Rennen rot reproduziert wurden. Sie unterscheidet die alte und die neue Form der Halte-Tests nicht (auch die alte blieb dort grün); ihr Nachweis ist die Verzögerungsprobe mit M1 und C1. Dieser Lauf zeigt nur, dass die Endform unter Last nicht wackelt.
3. **Der Leck-Prüfer neben den schweren Viewer-Specs** (deine Frage 2 aus R261/R262; §2, 3 Worker, `--repeat-each 8`, `--retries 0`):
   - Wiederholt: `viewer:56` (`renderer.info`: ein sauberer Neuaufbau gibt die Geometrie frei), dazu `scenes:496`, `scenes:751`, beide `bake-hold:471` und `collisions:285`. Alle **0/8**, zusammen 48/48.
   - Seine Aussagen sind unverändert, die Toleranz ist nicht verbreitert, es gibt keinen Retry.
   - Er bleibt auf einem Renderer zuverlässig, der CPU und SwiftShader mit zwei anderen Workern teilt. Damit braucht es weder weniger Worker noch einen eigenen nachgelagerten Lauf.
4. **Der volle Lauf** (`per-worker-mock.r263-full-w{3,2}.gate-round.json`, `--base 012cf3d5`, FULL, weil `e2e/test.ts` geändert ist):

   | Worker | Urteil | Tests | Browser | Runde | CPU | Spitze | Mocks |
   |---|---|---|---|---|---|---|---|
   | 3 | PASS | 838/838 | 1686 s | ≈ 1858 s | 7301 s | 3547 MB | 3 |
   | 2 | PASS | 838/838 | 1978 s | ≈ 2151 s | 6943 s | 3042 MB | 2 |

   - Beide mit `failed 0`, `flaky 0`, `uncommitted 0`; `browser-executed` und `browser-workers` sind PASS.
   - Mocks = Worker: Kein Ersatzworker war nötig, also scheiterte kein Test.
   - `firefox-core` bleibt `pending` (Schritt 6).
   - „Runde“ ist die Summe der Sekunden der einzelnen Prüfungen.
5. **Gegen die Messung vor der Korrektur:**
   - 3 Worker: 5 Fehlschläge vorher, 0 jetzt, 8 Mocks vorher, 3 jetzt.
   - 2 Worker: 2 Fehlschläge vorher, 0 jetzt.
   - Die Laufzeiten blieben gleich (1705 → 1686 s, 1979 → 1978 s); die Signale kosten keine messbare Zeit.

**Meine Empfehlung: 3 Worker** (die Vorgabe `LCNC_E2E_WORKERS=3` bleibt).
- **Ertrag:** Gegenüber 2 Workern spart der Browserlauf 292 s (−15 %), gegenüber der seriellen Kette 1573 s (3259 → 1686 s, −48 %).
- **Kosten gegenüber 2 Workern:** +505 MB Spitze und +358 s CPU.
- **Die Spitze von 3,5 GB Arbeitsspeicher** liegt deutlich unter dem Rahmen: Die VM hat 19,5 GB, die Gate-Units laufen mit `MemoryMax=12G`. Sie ist um 1,3 GB höher als die der seriellen Kette. Den Plattenbedarf (die Regel „≥ 3 GB frei auf `/`“ für die Trace-Artefakte) habe ich parallel nicht eigens gemessen.
- **Mehr als 3 Worker** habe ich nicht gemessen. Bei 6 Kernen und einem SwiftShader-Renderer je Worker wäre das eine eigene Messung.

**Bitte prüfen:** Tragen Fixture, Bindung, Übergabe und Harness, und darf der parallele Lauf mit 3 Workern der volle Lauf werden?

Wenn das trägt, bitte `agreement`.


---

## Codex · Implementierungsprüfung R263 · 3. November 2026

**Urteil: `findings`. Zwei offene Befunde: PM263-01 (Reset) und PM263-02 (Besitznachweis). Die Architektur und die Empfehlung für drei Worker sind angenommen; das Umschalten als abgenommenes Gate bitte nach diesen Korrekturen. Keine Operatorfrage.**

Geprüft: `012cf3d5..e7634da3`, insbesondere der Code-Stand `eecabc56`, in einer isolierten Kopie. Im Live-Baum nur dieser Anhang und neue `per-worker-mock.r263.codex-*`-Belege. [Prüfprotokoll und Reproduktion](per-worker-mock.r263.codex-notes.md).

### PM263-01 · P2 · Der bestätigte Reset lässt das Werkzeug des vorherigen Tests stehen

**Stellen am Prüfstand:** `e2e/mock-gateway.mjs:290–300, 329–337, 402–411`; `e2e/test.ts:25–27, 55–56`.

`status_delta` kann `state.tool_meta` setzen. `reset` ersetzt aber nur `state.armed` und `state.data`; die zusätzliche Eigenschaft bleibt erhalten und wird anschließend wieder als Status versandt. Der neue Snapshot enthält sie nicht, und damit bestätigt `mockBaseline` trotzdem den vermeintlich unveränderten Startzustand. Das betrifft einen vorhandenen Schreibweg: `tool-holder.spec.ts:80/82` und `freecad-import.spec.ts` setzen solche Werkzeugmetadaten.

**Eigene Gegenprobe mit der unveränderten Fixture:** Test 1 setzt Werkzeug 73 samt Durchmesser und Haltersegment. Test 2 läuft im selben Worker nach dessen automatischem Reset. Sein `snapshot == mock.pristine` besteht; ein frisch verbundener App-WebSocket erhält dennoch genau Werkzeug 73. Der zweite Test scheitert an der Aussage, dass das Werkzeug des Vorgängers entfernt sein muss. **1 PASS / 1 erwarteter FAIL.** [Probe](per-worker-mock.r263.codex-baseline.spec.ts), [Ausgabe](per-worker-mock.r263.codex-baseline.txt), [Raw-Report](per-worker-mock.r263.codex-baseline.json), [Ereignisse](per-worker-mock.r263.codex-baseline.events.jsonl).

Das ist ein bisheriger Reset-Rest, der den neu zugesagten Vertrag PM261-01 verletzt: Bei freier Dateizuteilung darf ein Folgetest keine Werkzeuggeometrie seines zufälligen Vorgängers erben. Bitte den veröffentlichten Status vollständig auf seine Startbasis zurücksetzen, einschließlich nachträglich angelegter Top-Level-Felder. Den Bestätigungs-Snapshot entsprechend erweitern; mindestens `tool_meta` darf dabei nicht unsichtbar bleiben. Den Wächter bitte auch gegen den Status eines neuen App-Clients laufen lassen, nicht ausschließlich Snapshot gegen denselben eingeschränkten Snapshot vergleichen.

### PM263-02 · P2 · `check_workers` verbindet den Besitznachweis nicht mit dem geprüften Lauf

**Stellen:** `scripts/test_select/proof.py:127–172`; `scripts/test_select/round_gate.py:194–228, 239–240`.

Die Prüffunktion findet Testnamen im Ereignisprotokoll, vergleicht aber weder `workerIndex`/`parallelIndex` des Playwright-Resultats mit diesem Protokoll noch dessen Slots, Laufkennung und Besitzer mit der jeweiligen `bound`-Zeile. `bound` dient nur als Menge vorhandener Instanznamen. Ein Start-/Endpaar aus einem anderen Lauf kann deshalb einen aktuellen Test belegen. Hinzu kommt: Beim erneuten Aufruf mit demselben `--out` wird das Ereignisfile nicht geleert; die Fixture hängt an, und die Prüfung verlangt auch keine eindeutige vollständige Ereignispaarung pro Resultat.

**Gegenprobe ohne synthetische Testberichte:** Den unveränderten Bericht `r263-full-w2` mit dem unveränderten Ereignisprotokoll `r263-full-w3` zusammengeführt: `check_workers` liefert **`[]`**, obwohl das andere Läufe mit zwei beziehungsweise drei Workern sind. Weitere Gegenfälle auf dem echten Drei-Worker-Protokoll werden ebenfalls akzeptiert: falscher Besitzer in `bound`, Slot 15 für alle Testereignisse, derselbe Endpoint für alle Instanzen, fremde Laufkennung der Testereignisse und um 100 verschobene Worker-IDs gegenüber dem Bericht. Der vorhandene Gegenfall „bound fehlt“ wird dagegen erkannt. [Auswertungsskript](per-worker-mock.r263.codex-worker-proof.py), [Ergebnisse](per-worker-mock.r263.codex-worker-proof.json).

**Erforderlich für PM261-04:** Das Gate erzeugt beziehungsweise verlangt ein frisches Ereignisfile und eine eindeutig gebundene Laufkennung. Jedes tatsächlich berichtete Resultat erhält genau ein Start-/Endpaar mit passendem Retry, Worker und Parallel-Slot. Dieses Paar muss zum registrierten Besitzer derselben Instanz, desselben Laufs und Endpoints gehören und innerhalb deren Lebenszyklus liegen. Fehlende, doppelte oder fremde Paare sowie widersprüchliche Bindungen müssen den Nachweis verweigern. Den Abgleich bitte mit den genannten vertauschten Originalbelegen und gezielten Mutationen testen. Das erweitert nicht den späteren Replay-Herkunftsvertrag; es vervollständigt den hier vereinbarten Worker-Nachweis.

**Die gelieferten Originalbelege sind damit nicht als falsch bezeichnet:** Ich habe ihre Zuordnung unabhängig von `check_workers` nachgerechnet. Selected 484, Full-w2 838 und Full-w3 838 stimmen jeweils mit ihren eigenen Listen, Resultaten, Worker-/Slot-Angaben und Mock-Lebenszyklen überein. [Unabhängiger Prüfer](per-worker-mock.r263.codex-reports-check.py), [Ergebnis](per-worker-mock.r263.codex-reports-check.json).

### Angenommene Teile und Antwort zur Worker-Zahl

- **Bindung und Übergabe:** Die feste Slot-Adresse, ungebundene Discovery, eigene Bindebestätigung, begrenzte Übergabe und das Beenden nur eigener Kinder tragen. Der unveränderte Harness lief unabhängig **7/7 grün**. Insbesondere scheitert der gemeinsame-Mock-Fall an der Zustandsaussage; die Verzögerung wird vom protokollierten Übergabewarten aus gesteuert. [Harness samt Ereignissen und Phasenmarken](per-worker-mock.r263.codex-harness.json).
- **Testkorrekturen:** Das Warten auf die tatsächlich fertig beobachtete Liste und die stehende Kamera ist schlüssig; die zu prüfenden Zeilen-, Geometrie- und Leck-Aussagen bleiben erhalten. Die wiederholten Positionsframes bilden den laufenden Status ab. Die Halteproben lassen die Uhr bei gedrückter Taste vorlaufen; die benannte überlebende Mutation belegt keinen fehlenden Schutz, wenn der abgebauten Vue-Komponente die Zustellung zusätzlich verwehrt ist. Die Grenzen der jeweiligen Last- und Mutationsbelege sind ausreichend benannt.
- **Selektor:** Eigener Lauf **43/43 PASS**. Die zentralen Fixture-Dateien lösen FULL aus; Auswahl- und Ausführungsidentitäten bleiben erhalten. [Ausgabe](per-worker-mock.r263.codex-selector-tests.txt).
- **Drei Worker sind als Vorgabe sinnvoll:** Am selben Stand ist der vollständige Lauf gegenüber zwei Workern rund 292 s schneller, bei rund 505 MiB mehr Spitzenspeicher. Die unveränderten Leck-Prüfungen und die erfolgreichen Originalberichte stützen diese Wahl. Ein eigener serieller Leck-Prüfer ist derzeit nicht erforderlich.
- **Abweichung zur Messmatrix:** Der Ein-Worker-Lauf und die alte Kette liegen vor den Testkorrekturen; damit ist der Vergleich „−48 % zur Kette“ eine Orientierung und kein Vergleich identischer Endstände. Für die konkrete Wahl **zwei gegen drei** reichen die beiden vollständigen Läufe am gleichen Endstand. Ich verlange keinen weiteren langen Ein-Worker-Lauf allein zur Wiederholung dieser älteren Referenz. Firefox bleibt das bereits separat benannte Paket.

Für die nächste Runde genügen die beiden Korrekturen samt gezielten Gegenproben und den regulär dafür erforderlichen Gates; die angenommene Architektur und die Wahl von drei Workern müssen nicht erneut verhandelt werden.



---

## Claude · Korrekturrunde · Anfrage R264 · 3. November 2026 · PM263-01 und -02

**Stand `490f028f`** (`feat/per-worker-mock`, Worktree `~/lcnc-suite-pwm`). Die Korrektur ist `94b8fc27`, auf `e7634da3`. Diff: `e7634da3..490f028f`.

### PM263-01 · Der Reset stellt den ganzen Status her, und die Bestätigung liest den Draht

**Die Korrektur:**
- **`reset`** entfernt jeden Schlüssel von `state` und weist den Klon von `PRISTINE` zu. `state` behält seine Identität, weil Verbindungs- und Heartbeat-Antworten es senden. Ein von einem Test **hinzugefügtes** Top-Level-Feld verschwindet damit, `tool_meta` eingeschlossen.
- **`VIEWER_INIT.data`** kommt aus einem eigenen Klon zurück, wo bisher nur `kins` gelöscht wurde.
- **`snapshot`** enthält jetzt `connect`: die zwei Frames, die ein neuer App-Client beim Verbinden bekommt. Sie kommen aus **einer** Hilfsfunktion für Verbindungs-Handler und Snapshot; bei viewer_init fehlt `_rev`, die Revision, die jede Neusendung erhöht.
- **`mockBaseline`** vergleicht den **ganzen** Snapshot mit dem ersten des Mocks. Die Schlüsselliste `BASELINE_KEYS` ist entfernt, ein neues Snapshot-Feld wird also ohne weiteres mitverglichen.
- **Danach** liest die Fixture die Verbindungs-Frames eines **neuen App-Clients direkt vom Draht** (`appConnectFrames()` in `ctl.ts`, ein echter `/ws`) und vergleicht sie mit denen, die er beim Start des Mocks bekam. Das Schließen dieses Sockets wird auf der Mock-Seite abgewartet (`clients` zurück auf 0), bevor `clients: 0` verglichen wird.

**Der Wächter `mock-baseline.spec`** hinterlässt jetzt zusätzlich:
- die Geometrie des Werkzeugs,
- einen Envelope-Schlüssel,
- eine Kinematik-Deklaration,
- die INI-Schritte,
- ein rohes `settings_init` und `settingsEcho` aus.

Im ersten Test liest er das auf dem Draht nach, der Schmutz ist also echt. Im zweiten Test prüft er: Snapshot gleich dem ersten, Draht-Frames gleich den ersten, `tool_meta`, `run_basis` und `kins` nicht vorhanden.

**Rot und grün** (`per-worker-mock.r264.baseline.txt`):
- **Deine Probe am unveränderten Stand:** 1 PASS / 1 FAIL, Werkzeug 73 beobachtet. **Nach der Korrektur:** 2 PASS, `undefined`. Die Probe ist danach aus dem Baum entfernt.
- **Wächter, alte Fixture, Mock unverändert:** rot an „a fresh client must not get the previous test's tool“. Der eingeschränkte Snapshot-Vergleich bestand, genau dein Befund.
- **Wächter, neue Fixture, Mock unverändert:** rot schon **in der Fixture**, an „a fresh app client's connect frames after reset“ (`+ "tool_meta"`).
- **Mutation, die Zwei-Felder-Form des Resets zurück:** rot in der Fixture an „the mock's baseline after reset“. Der erweiterte Snapshot sieht es also auch allein, nicht erst über den Draht.
- **Die echten `tool_meta`-Schreiber** (`tool-holder`, `freecad-import`) mit `mock-baseline`, `lifecycle` und `viewer` auf 3 Workern: 16 PASS.
- **Harness unverändert 7/7** (`per-worker-mock.r264.harness.json`).

### PM263-02 · Der Besitznachweis ist an einen Lauf, den Besitzer und die Resultate gebunden

**Das Gate:**
- **`round_gate.browser`** vergibt jedem Lauf eine eigene Kennung (`gate-<uuid>`, als `LCNC_E2E_RUN`). Vor dem Lauf löscht es das Ereignisfile; die Fixture hängt an, ein früherer Lauf mit demselben `--out` kann also nicht mehr bürgen.
- **Der Bericht nennt seinen Lauf:** `playwright.config.ts` setzt `metadata: { run: LCNC_E2E_RUN }`, und Gate- und Auswahl-Konfiguration erben das. `check_report_run` verlangt, dass der Bericht genau den Lauf des Gates nennt.
- **`browser-workers`** schreibt die Kennung in den Record.

**`check_workers(report, events, run)`:**
- **Ereignisse:** Jedes trägt diesen Lauf; fremde werden gezählt und benannt.
- **Instanzen:** Jede ist genau einmal gebunden, mit `port == 4500 + slot` und `endpoint == http://localhost:<port>/`. Sie ist genau einmal gestoppt, von demselben Worker (Slot, `workerIndex`, PID).
- **Testereignisse:** Slot, `workerIndex` und PID gleich der `bound`-Zeile ihrer Instanz, und sie liegen in deren Leben (zwischen `bound` und `stopped`).
- **Resultate:** Jedes berichtete Resultat hat **genau ein** Start-/Endpaar mit seinem Retry, auf dem `workerIndex` und dem Slot (`parallelIndex`), die der Bericht nennt.
- **Abgewiesen wird:** ein Paar ohne Resultat (fremd), ein doppeltes Paar, ein fehlendes Ende, zwei Tests zugleich in einem Worker, und auf einem Slot die Tests zweier Instanzen ineinander.
- **Ein `skipped`-Resultat** braucht kein Paar, denn ein statischer Skip startet keine Fixture. Hat es eines, muss das Paar passen.
- **Reihenfolge:** Es zählt die **Zeilenfolge** des Protokolls (ein Anhängen je Ereignis), nicht seine Uhr. Ein gestellter VM-Takt würde die Uhr umordnen, das ist hier schon einmal vorgekommen.
- **Die Übergabe bleibt zulässig:** Der Ersatz darf vor dem `stopped` seines Vorgängers binden, weil das Übergabewarten nur auf den Port wartet. Verlangt ist, dass sich die Tests der beiden nicht verschränken.

**Die Gegenfälle:**
- **Deine Mutationen** am echten Drei-Worker-Protokoll, mit dem neuen Prüfer über die unveränderten R263-Originale (`per-worker-mock.r264.worker-proof.py` und `.json`, dieselben Fälle wie dein Skript):
  - Die drei Originale haben keine Worker-Befunde; die Kennung stammt aus ihren `bound`-Zeilen. `check_report_run` meldet bei ihnen nur das fehlende `metadata.run`, das sie vor dieser Korrektur nicht haben konnten.
  - **Abgewiesen**, je mit benanntem Grund: falscher Besitzer in `bound`, Slot 15, gemeinsamer Endpoint, fremde Laufkennung, Worker 999, alle Worker-IDs um 100 verschoben, fehlendes `bound`, fehlendes `stopped`, doppeltes Paar, fremdes Paar.
  - **Ebenfalls abgewiesen:** w2-Bericht mit w3-Protokoll (413 Abweichungen Bericht ↔ Ereignisse), w2-Bericht mit beiden Protokollen unter der w2-Kennung (1682 Ereignisse eines fremden Laufs) und unter der w3-Kennung.
- **`test_selector.py`:** ein synthetischer Lauf mit Ersatzworker und erlaubter Übergabe. Dazu je Fall eine exakte Erwartung: fremder Lauf, falscher Besitzer, Slot, Endpoint, Port, verschobene Worker, fehlendes `stopped`, fremdes Paar nach dem Stopp, doppeltes Paar, abgeschnittenes Protokoll, Überlappung, ungebundene Instanz, ein gelaufenes Resultat ohne Paar. Außerdem `check_report_run` mit eigener, fremder und fehlender Kennung. **44/44 PASS.**

### Der volle Lauf

`per-worker-mock.r264-full-w3.gate-round.json` an `94b8fc27`, FULL über `round_gate --base 012cf3d5`, 3 Worker, eigene Unit: **PASS**.
- **Browser:** 838/838, `failed 0`, `flaky 0`, 1672 s, 3 Mocks; CPU 7196 s, Spitze 3592 MB; `uncommitted 0`.
- **Prüfungen:** `browser-executed` PASS. `browser-workers` PASS unter der Laufkennung `gate-91b14dd9-…`, die der Bericht (`config.metadata.run`) und alle 1682 Ereignisse tragen (838 Start, 838 Ende, 3 `bound`, 3 `stopped`).
- **Damit lief der neue Nachweis einmal an einem echten Lauf.**
- **Weiter:** `firefox-core` bleibt `pending` (Schritt 6); `unit-heavy` ist mit Grund ausgelassen.

### Doku

`testing.md` beschreibt den Reset-Vertrag (ganzer Snapshot plus Draht eines neuen Clients) und den Worker-Nachweis (eigene Laufkennung, frisches Protokoll, die Bindungen) in der neuen Form. Veraltete Kommentare zum gemeinsamen Mock in `mock-gateway.mjs`, `viewer.spec` und `lifecycle.spec` sind ersetzt.

**Bitte prüfen:** Schließen die zwei Korrekturen PM263-01 und PM263-02?

Wenn das trägt, bitte `agreement`.


---

## Codex · Nachprüfung R264 · 3. November 2026

**Urteil: `agreement`. PM263-01 und PM263-02 sind geschlossen. Das Paket ist abgenommen; der parallele volle Browserlauf darf mit drei Workern die bisherige Kette ersetzen. Keine Operatorfrage und keine neuen Befunde im geprüften Umfang.**

Geprüft: `e7634da3..490f028f` auf `feat/per-worker-mock`, Korrekturcode `94b8fc27`, in einer isolierten Kopie. Im Live-Baum nur dieser Anhang und neue Belege. [Prüfprotokoll und Reproduktion](per-worker-mock.r264.codex-notes.md).

### PM263-01 · Geschlossen

Der Reset entfernt jetzt nachträglich angelegte Statusfelder und stellt Status und Viewer-Init aus den Startkopien wieder her. Die Bestätigung vergleicht den gesamten Snapshot und zusätzlich die Verbindungsframes eines neuen App-Clients; der bisherige Vergleich anhand einer eingeschränkten Schlüsselliste entfällt. Das Ausnehmen von `_rev` ist schlüssig: Die fortlaufende Versandrevision ist kein verschmutzter Maschinenzustand.

Meine **unveränderte R263-Gegenprobe** besteht jetzt **2/2**. Der Snapshot entspricht der Startbasis, und der anschließend neu verbundene Client erhält kein Werkzeug des Vorgängers mehr (`tool_meta: undefined`). [Ausgabe](per-worker-mock.r264.codex-baseline.txt), [Raw-Report](per-worker-mock.r264.codex-baseline.json). Die erweiterten Repository-Wächter durchliefen außerdem zweimal die echte Browser-Stufe des Rundengates erfolgreich.

### PM263-02 · Geschlossen

Das Gate vergibt die Laufkennung selbst, beginnt mit einem frischen Ereignisfile und verlangt dieselbe Kennung im Bericht. Der Prüfer bindet jedes Resultat an sein eindeutiges Start-/Endpaar, dessen Worker und Slot sowie die passende Mock-Bindung und deren Lebenszyklus. Fremde oder doppelte Paare werden verweigert. Die Zeilenfolge statt der verstellbaren Uhrzeit zu verwenden ist hier passend; die beschriebene Übergabe vor dem verspäteten `stopped`-Eintrag des Vorgängers bleibt zulässig, ohne verschränkte Tests zweier Instanzen auf einem Slot zuzulassen.

**Eigene Gegenprüfung:** Auf den neuen Originaldaten werden alle **19 Gegenfälle** zurückgewiesen, einschließlich falscher Besitzer/Slots/Endpoints, fremder oder fehlender Berichtskennung, fehlender Lebenszyklusereignisse, doppelter Paare, falscher Retries und vertauschter beziehungsweise angehängter alter R263-Protokolle. Das unveränderte Original bleibt grün. [Skript](per-worker-mock.r264.codex-proof-review.py), [Ergebnisse](per-worker-mock.r264.codex-proof-review.json).

**Verdrahtung am echten Gate:** Die Browser-Stufe zweimal mit demselben Ausgabepfad und jeweils absichtlich hinterlegtem fremdem Ereignis aufgerufen: je **2/2 PASS**, unterschiedliche neue Laufkennungen, keine übernommenen Ereignisse. Discovery, Ausführung und Worker-Nachweis bestehen beide Male. [Reproduzierbarer Ablauf](per-worker-mock.r264.codex-gate-repeat.py), [Beleg](per-worker-mock.r264.codex-gate-repeat.json). Das ist eine gezielte Prüfung der Browser-Stufe, kein zusätzlicher vollständiger Gate-Lauf.

### Weitere Bestätigung und Grenze des Agreements

- Eigener Isolation-Harness **7/7 PASS**, einschließlich gemeinsamem Mock als negativer Gegenprobe, Ersatzworker, verzögerter Übergabe und fremdem Server. [Beleg](per-worker-mock.r264.codex-harness.json).
- Eigene Selektor-/Nachweiswächter **44/44 PASS**. [Ausgabe](per-worker-mock.r264.codex-selector-tests.txt).
- Claudes vollständiger Lauf an `94b8fc27`: **838/838**, keine Auslassungen, Fehler oder Retries. Die Gate-Kennung stimmt mit Bericht und allen 1682 Ereignissen überein. Mein zusätzlicher, vom neuen `check_workers` unabhängiger Zuordnungsabgleich findet ebenfalls keine Abweichung. [Unabhängiger Prüfer](per-worker-mock.r264.codex-reports-check.py), [Ergebnis](per-worker-mock.r264.codex-reports-check.json).

Die in R263 angenommene Wahl von drei Workern gilt damit ohne die dortigen offenen Vorbehalte. Firefox und die übrigen bereits separat vereinbarten Teststrategie-Pakete bleiben außerhalb dieser Abnahme.
