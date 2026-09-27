# Review: WebUI Design-Welle — Abstimmung mit Claude / Fable

**Umsetzungsreview · Runde 7 · 27. September 2026 · `883465a`: UI-DI12–14 geschlossen.
Zwei neue P2-Befunde UI-DI15–16 zur schmalen Programm-Zeitleiste und zum
Simulationshinweis bleiben offen; D7–D10 noch ohne Implementierungs-Agreement.**
[Codex Implementierungsreview Runde 7](ui-design-welle.implementation-review.md#codex-implementierungsreview-runde-7).
Die Agreements für DR + D0–D6 bleiben gültig; UI-DI01–11 bleiben geschlossen.
Keine Merge-Freigabe für die gesamte Design-Welle.
Der folgende Planreviewstand bleibt gültig.

**Aktueller Stand · Runde 3 · Fassung 3 · 23. September 2026: Plan-Agreement.**
**UI-D01–UI-D09 sind auf Planebene akzeptiert (9/9).** Der Pausenpfad erhält nun den
Numpad-Entwurf; auch die vier Präzisierungen aus Runde 2 sind übernommen.
[Nachprüfung und Umfang des Agreements](#codex-runde-3). Die vorgesehenen Geometrie-,
Verhaltens- und Abschlussprüfungen bleiben Teil der Umsetzung. Die früheren Befunde und
Bewertungen unten sind historische Prüfstände.

**Codex · Runde 1 · 23. September 2026 · Produktbasis `0019da5` (`development`).**

**Historisches Ergebnis Runde 1: Richtung unterstützt, noch kein Plan-Agreement.** Die gemeinsamen Bausteine,
Kontrollhöhen, Formularraster, Rückmeldekanäle und Theme-Paletten treffen den Auftrag.
Vor der Umsetzung sind die offenen Interaktions- und Migrationsverträge unten zu ergänzen.
Dies ist ein Planreview; die beschriebenen Folgen sind Risiken der geplanten Änderung und keine
Behauptung, die noch nicht implementierte Design-Welle habe bereits diese Fehler.

## Prüfstand und Abgrenzung

- [Unveränderter Plan-Snapshot Fassung 1](ui-design-welle.plan.f1.md), 414 Zeilen. Quelle:
  `/home/cnc/.claude/plans/das-aktuelle-webui-von-optimized-perlis.md`, geändert am 23.09.2026 um 20:54.
  SHA-256: `607b5ace0bad552d31bd33337c3e35fb0295eb8d8cfbb2ffa11b48bbcf149706`.
- Abgleich mit [UI-K01–K17](ui-optimierungen.consistency-review.md), UI-K18 aus der
  [Live-Sichtprüfung](ui-optimierungen.implementation-review.md#live-sichtprüfung--23-september-2026--operator--claude)
  und den betroffenen Komponenten am aktuellen Produktstand.
- Die vorige UI-Welle ist mit `0019da5` nach `development` gemergt. Deren geschlossene Befunde
  werden hier nicht wieder geöffnet. Fallback-Welle, physische Touch-Abnahme und diese neue
  Planabstimmung sind getrennte Arbeit.
- Die vier im Plan festgehaltenen Operator-Entscheidungen sind Ausgangspunkt: festes
  Probing-Raster, lokale Sperrgrund-Blase mit stillem Protokoll, Makro-Hold, X oben rechts.
  Die frühere Picker-Empfehlung ist damit als Ausgangsvariante überholt.
- Nur Dokumentation geändert. Keine Maschinenverbindung, kein Start/Stop der Suite, keine
  neue Browsermessung und kein Offline-Gate. Frühere Geometriemessungen sind ausdrücklich
  Ausgangsdaten, keine Abnahme des neuen Rasters.

## Befundübersicht — Stand Runde 1

| ID | Priorität | Paket | Offener Vertrag | Status |
|---|---|---|---|---|
| UI-D01 | P1 | D2 | Dialog-Fokusbereich muss normalen Abort erreichbar halten | offen |
| UI-D02 | P1 | D6 | Makro-Hold an Befehl/Parameter binden; Auslösewege vollständig festlegen | offen |
| UI-D03 | P2 | D3–D5, D7 | Reales Platzbudget bei 150 %, Navigation im festen Raster | offen |
| UI-D04 | P2 | D1 | Retry nur bei wiederholbaren Lesefehlern | offen |
| UI-D05 | P2 | D8 | Altfarben haben keine Herkunftskennzeichnung | offen |
| UI-D06 | P2 | D2 | Gestapelte Dialoge, Eingabehilfe und Schließgründe | offen |
| UI-D07 | P2 | D8, D10 | Effektiven Kontrast prüfen; Opazitätsregel widerspricht Farbrollen | offen |
| UI-D08 | P2 | D1 | Lange Sperrgrund-Blasen brauchen Platzierungsregeln | offen |
| UI-D09 | P3 | Doku | Neues Audit und Dialoginventar fehlen als prüfbare Quellen | offen |

P1/P2 vor Plan-Agreement auflösen. UI-D09 kann als Dokumentationsnachtrag erfolgen, muss aber
vor dem Anspruch „alle Vorkommen migriert“ vorliegen. Antworten bitte je ID mit Planänderung
und Abnahmeweg ergänzen; ein Plan-Agreement ersetzt anschließend keine Implementierungsprüfung.

## UI-D01 · P1 — Safety-Leiste allein enthält keinen Abort

**Plan:** D2, Zeilen 129–131 und 151–153: Tab darf nur Dialog, Safety-Leiste und zugehörige
Eingabehilfe erreichen.

**Problem:** Die [SafetyStrip](../../lcnc-webui/src/SafetyStrip.vue#L83) enthält Arm, E-Stop und
Power. Der normale Abort sitzt unter anderem im [Banner](../../lcnc-webui/src/App.vue#L1786).
Bei offenem Dialog sperrt die [Shortcut-Verarbeitung](../../lcnc-webui/src/useKeyboardShortcuts.ts#L114)
auch Backspace/Abort bewusst; nur E-Stop bleibt global. Die geplante Fokusbegrenzung entfernt
damit den verbliebenen Tastaturweg zum Banner-Abort, etwa bei laufendem Programm und offenem
Settings-Dialog. Das ist eine Änderung am bisherigen Stop-Vertrag.

**Plan ergänzen:** Außerhalb des Dialogs erlaubte Aktionen einzeln benennen. Mindestens ein
normaler Abort muss sichtbar und per Tab erreichbar bleiben; auch der Weg zur Trip-Quittierung
ist festzulegen. Nicht einfach den gesamten Banner freigeben: Dort steht auch Home All.
Safety-Kontrollen müssen nach Disarm/E-Stop weiterhin erreichbar sein, obwohl das Content-Gate
mit dem Dialog dann gesperrt sein kann. Es braucht einen definierten Fokus-Ersatzpunkt.

**Abnahme:** Laufender Mock-Programmlauf → Settings/Form öffnen → Tab zu Abort → genau `abort`.
Kein Cycle Start, Jog oder Homing. E-Stop separat weiterhin genau `estop`. Dieselben Wege bei
gestapelter Bestätigung, geöffneter Eingabehilfe und anschließendem Gate-Wechsel prüfen.

## UI-D02 · P1 — Makro-Hold darf während des Haltens nicht sein Ziel wechseln

**Plan:** Operator-Entscheidung 3, Zeile 20; D6, Zeilen 273–277.

**Problem:** Nur `hold` am Katalogtyp zu setzen reicht nicht. Die
[Makroliste](../../lcnc-webui/src/useMacros.ts#L31) wird bei Settings-Updates anderer Clients
erneuert; [App.vue](../../lcnc-webui/src/App.vue#L2240) verwendet stabile Makro-IDs als Vue-Key,
aber keinen `holdKey`. Der [Hold-Timer](../../lcnc-webui/src/MachineBtn.vue#L202) ruft am Ende
den aktuellen Click-Handler auf. Wird bei gleicher ID während des Haltens der Befehl ersetzt,
kann ohne Zielbindung der neue Befehl ausgeführt werden. Der vorhandene Schutz gegen dieses
Retargeting hängt ausdrücklich an `holdKey`.

Zusätzlich ist der Auslösevertrag widersprüchlich: Die Entscheidung sagt „Makros … per Halten“,
D6 lässt die Ausführung im Parameterdialog per Klick zu. Der heutige
[Parameterdialog](../../lcnc-webui/src/App.vue#L2170) führt außerdem direkt über Enter im Feld
aus. Ein pauschales `hold` am Makrobutton würde umgekehrt schon das reine Öffnen dieses Dialogs
verzögern, obwohl der Plan dafür einen Tipp verspricht.

**Plan ergänzen:** Öffnen und Ausführen getrennt definieren. Empfehlung gemäß Operator-Regel:
Makro ohne Parameter direkt per Hold; Makro mit Parametern per Tipp öffnen und erst Execute
per Hold. Enter im Parameterfeld darf diesen Schutz nicht umgehen. Falls die Bestätigung im
Dialog bewusst als alternative Absicherung gelten soll, diese Ausnahme ausdrücklich festhalten.
Hold an Makro-ID **und auszuführenden Inhalt/Revision**, gegebenenfalls an Parameterwerte binden;
jede relevante Änderung bricht den laufenden Hold ab. `ready` statt `probe` ist außerdem eine
ausdrückliche Ausnahme zur Behauptung „Gates unverändert“ und muss gegen den MDI-Vertrag geprüft werden.

**Abnahme:** Kurzer Tipp, voller Hold, Pointer-Abbruch, Gate-Verlust, Parameterdialog und Enter;
während des Haltens Makro bei gleicher ID per simuliertem Settings-Update verändern → kein MDI.
Ein neuer voller Hold führt genau den nun sichtbaren Befehl einmal aus. Parameteränderung während
Execute-Hold analog prüfen.

## UI-D03 · P2 — Festes Raster und größere Controls benötigen vorab ein Platzbudget

**Plan:** D3, Zeilen 161–168; D4, Zeilen 183–205; D5, Zeilen 222–245; Verifikation 381–382.

**Problem:** Das feste 4×2-Raster ist eine klare Bedienentscheidung, aber noch kein Nachweis für
die verfügbare Fläche. Die [vorige Raumprüfung](ui-optimierungen.consistency-review.md#raumprüfung-des-seitenpanels--23-september-2026)
ergab im Hochformat bei 900×1200/150 % ungefähr **271 px innere Breite und 304 px innere Höhe**.
Vier Spalten erhalten dort vor Padding nur rund 68 px, mit drei 4-px-Abständen rund 65 px.
Namen wie „Boss/Pocket“ und „Ridge/Valley“ brauchen eine bewusste Darstellung. Zwei Reihen
44-px-Touchziele kosten mindestens 88 px, dazu Haupttabs, Steuerung und Beschreibungszeile.
Gleichzeitig vergrößert D4 Felder und stellt Labels darüber.

Es fehlen Regeln für die fünf Haupttabs bei dieser Breite und eine gemeinsame Höhenrechnung
für die feststehenden Bereiche. „Nur Inhalt scrollt“ kann sonst einen winzigen oder leeren
Inhaltsbereich hinterlassen. Das betrifft bereits **150 %**, nicht nur das ausdrücklich vertagte
200-%-Gesamtlayout. Im Querformat dokumentiert die alte Probe ebenfalls ein bestehendes
150-%-Problem der Gesamtaufteilung; die Abschlussmatrix kann dort ohne Abgrenzung kein PASS versprechen.

**Plan ergänzen:** Vor D3/D4 einen schmalen Referenzentwurf mit echten Namen und vollständigem
Probing-Inhalt bei 522 px und der 150-%-Restbreite messen. Hauptnavigation, zweizeilige
Rasterbeschriftungen, feststehende Höhe und minimal nutzbare Inhaltsfläche festlegen.
Keine kleineren Touchziele als Ausweg; falls das Raster eine Anpassung der Gesamtaufteilung
braucht, diese begrenzte Anpassung einplanen. Explizit definieren, ob Pfeile linear durch alle
acht Tabs laufen oder räumlich durch das 4×2-Raster; Auswahl und Fokus bleiben getrennt.

**Abnahme:** Alle fünf Hauptbereiche und acht Verfahren ohne horizontale Navigation-Scrollbar
erreichbar, keine abgeschnittenen Namen oder überdeckten Aktionen; jeder Formularinhalt bis
zum letzten Feld bedienbar. Mit geöffneten Eingabehilfen, langen Rückmeldungen und 150 % prüfen.
Bekannte Ausgangsgrenzen benennen statt sie mit erneuerten Screenshots als behoben zu behandeln.

## UI-D04 · P2 — „Jeder Lesefehler hat Retry“ widerspricht dem geschlossenen Ordnerbefund

**Plan:** D1, Zeile 103.

**Problem:** [browseFailure.ts](../../lcnc-webui/src/browseFailure.ts#L14) unterscheidet bewusst:
permanente Pfadablehnung mit HTTP 400 ohne Retry; 403/404/5xx und Netzfehler mit Retry.
Das war Teil von UI-K15 und ist unabhängig nachgeprüft. Die neue pauschale Regel würde den
nutzlosen Retry bei „außerhalb des erlaubten Ordners“ wieder einführen.

**Plan ergänzen:** Jede Leseablehnung erhält eine lokale Erklärung; **wiederholbare** Fehler
zusätzlich Retry. Bei dauerhaften Ablehnungen passende andere Handlung oder klare Begründung.
Die vorhandene Fehlerklassifikation bleibt die fachliche Quelle; `.statusNote` gestaltet sie.

**Abnahme:** 400 ohne Retry bei erhaltener vorheriger Liste; 503 mit erfolgreicher Wiederholung.
Keine pauschale Neuzuordnung sämtlicher HTTP-Fehler allein aufgrund der visuellen Migration.

## UI-D05 · P2 — „Explizit gesetzte Farben behalten“ ist mit Altdaten nicht eindeutig bestimmbar

**Plan:** D8, Zeilen 306–311.

**Problem:** [ViewerDefaults](../../lcnc-webui/src/defaults.ts#L60) kennt bisher keinen Auto-/Custom-Modus
und keine Herkunft pro Farbe. [SettingsPanel.save()](../../lcnc-webui/src/SettingsPanel.vue#L260)
speichert bei einer Viewer-Änderung sämtliche Farben mit. „Wert vorhanden“ beweist deshalb keine
bewusste Farbwahl. Umgekehrt kann jemand bewusst genau den früheren Standardwert gewählt haben.
Alle vorhandenen Farben als Custom zu übernehmen lässt auch unveränderte weiße Bounds dauerhaft
weiß; ein Vergleich mit den alten Defaults kann bewusste Entscheidungen als Auto missdeuten.

**Plan ergänzen:** Unauflösbare Altfall-Mehrdeutigkeit benennen und eine konkrete Migration wählen.
Verlustfreie Ausgangsregel: vorhandene Altpalette als Legacy/Custom erhalten, den Wechsel zu
Automatic sichtbar anbieten; ohne gespeicherte Palette Automatic. Falls stattdessen alte
Standardwerte automatisch umgestellt werden sollen, diese Heuristik und ihre Ausnahme ausdrücklich
vereinbaren. Klären, ob Auto/Custom je Rolle oder für die ganze Palette gilt, und Custom-Werte beim
vorübergehenden Wechsel auf Auto behalten. Ab jetzt den Modus explizit persistieren.

**Abnahme:** Keine gespeicherte Viewer-Sektion; vollständige alte Standardpalette; eine geänderte
Rolle; bewusst auf alten Standard zurückgesetzte Farbe; Theme-Wechsel; Auto→Custom→Auto;
Speichern/Neuladen und zweiter Client. Keine Behauptung, historische Benutzerabsicht rekonstruieren zu können.

## UI-D06 · P2 — DialogFrame braucht einen Vertrag für Stapel und Schließübergänge

**Plan:** D2, Zeilen 121–153.

**Problem:** Die [Modal-Registry](../../lcnc-webui/src/modalRegistry.ts#L20) zählt offene Dialoge;
sie verwaltet keine Reihenfolge und keinen aktiven Fokusbereich. Schon heute gibt es
[Werkzeugeditor plus „Discard changes?“](../../lcnc-webui/src/ToolTablePanel.vue#L784),
Settings plus Verwerf-Rückfrage und Import plus Replace-Bestätigung. Wenn jeder DialogFrame
seinen eigenen Fokus einschließt und beim Schließen zurückgibt, können diese Regeln miteinander
konkurrieren. Auch eine noch offene Eingabehilfe des darunterliegenden Formulars darf nicht
weiter in den verdeckten Entwurf schreiben.

Die vier Dialogarten definieren außerdem nur den Hintergrundklick. X, Cancel, Header-Navigation,
Entwurfsschutz und ein Übergang von form zu running müssen dieselbe Schließentscheidung verwenden.
„Bis zur Antwort“ benötigt die vorhandenen Fehler-/Disconnect-Endzustände, damit die gemeinsame
Hülle kein dauerhaft unbedienbares Overlay erzeugt; dies verlangt keinen neuen Transport-Fallback.

**Plan ergänzen:** Nur der oberste Dialog führt den aktiven Fokusbereich. Er besitzt genau die
erlaubte Eingabehilfe; beim Öffnen eines Kinddialogs wird die Eltern-Hilfe beendet/gesperrt, ihr
Entwurf bleibt erhalten. Kind schließen → bewacht zum Elternkontext; gesamten Stapel schließen →
einmal zum gültigen Auslöser. Ein `requestClose(reason)` pro Dialog führt alle Schließwege durch
die vorhandene Draft-/Busy-Wache. `role="dialog"` gehört auf den Dialogcontainer; dessen
`aria-labelledby` verweist auf den Titel — nicht die Rolle auf das Titelelement.

**Abnahme:** Editor→Verwerfen→Keep editing und Discard; Import→Replace; Settings→Header-Wechsel;
jeweils mit Eingabehilfe, Tab/Shift+Tab, Escape und gesperrtem/entferntem Rückkehrziel. Keine
Fokusschleife, kein verdecktes Editieren, kein kurz ungeschützter Fokus auf `body` nach dem Schließen.

Die geplante Ausnahme von vollständiger Modalität ist nachvollziehbar. Sie muss als eigener
Vertrag geprüft werden: Das [W3C-Modalmuster](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
setzt einen inaktiven Hintergrund voraus; das trifft mit bedienbaren externen Safety-Aktionen
nicht zu. Deshalb ist der Verzicht auf `aria-modal="true"` hier richtig.

## UI-D07 · P2 — Tokenkontrast allein erfasst die sichtbare Darstellung nicht

**Plan:** D8, Zeilen 300–320; D10, Zeilen 338–339.

**Problem:** D8 will feste Textfarben statt Opazität, D10 schreibt für Lade- und Hinweistexte
wieder `--opacity-muted` vor. Damit bleiben gerade lesepflichtige Rückmeldungen schwächer als
ihre nominelle Farbe. Außerdem setzen sowohl [CodeMirror](../../lcnc-webui/src/gcodeCmLanguage.ts#L56)
als auch [Programmtext](../../lcnc-webui/src/style.css#L1198) auf Kommentarfärbung noch Opazität.
Ein Test der reinen Theme-Tokens kann grün sein, obwohl diese Verwendung zu wenig Kontrast hat.
Die Viewer-Rollen sind bisher Einstellungen außerhalb von `style.css`; ein ausschließlich dort
lesender Wächter beweist auch deren effektive Farben nicht.

**Plan ergänzen:** Nicht gesperrte Hinweise, Beschreibungen, Ladezustände und Syntax verwenden
geprüfte Farbrollen ohne zusätzliche Abschwächung. Den Widerspruch in D10 entfernen.
Kontrastprüfungen für tatsächlich verwendete Vorder-/Hintergrundpaare einschließlich
Transparenz und Zuständen vorsehen. Gemeinsame Viewer-Palette direkt prüfen und zusätzlich
reale Szenen ansehen: Bounds, dichter/dünner Pfad, Auswahl, Limits und Kollision vor heller und
dunkler Maschinengeometrie. Rein farbliche Unterscheidungen erhalten ergänzende Form-/Textmerkmale.

**Abnahme:** Vier Themes, Editor und Anzeige, aktive/ausgewählte/stale Darstellung sowie
Tooltip/Statusnote. Computed Styles und wirksame Transparenz berücksichtigen; im Viewer bekannte
Szenen mit geladenem Maschinenmodell vergleichen. Custom-Farben dürfen erhalten bleiben, aber
nicht durch einen bestandenen Auto-Paletten-Test als kontrastgeprüft gelten.

Die Ziele 4,5:1 für normalen Text und 3:1 für relevante Nicht-Text-Information beziehen sich auf
die jeweiligen angrenzenden Farben. Ein nominell passender Linienfarbwert garantiert bei sehr
dünnen Linien noch keine gute praktische Erkennbarkeit. [W3C Textkontrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[W3C Nicht-Text-Kontrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## UI-D08 · P2 — Die neue Sperrgrund-Blase darf nicht außerhalb des Fensters erscheinen

**Plan:** D1, Zeilen 79–84.

**Problem:** [showBtnHint](../../lcnc-webui/src/btnHint.ts#L17) setzt die Position einfach auf
Mitte/oberhalb des Controls; [CSS](../../lcnc-webui/src/style.css#L778) verschiebt die ganze Blase
nach links und oben. Bisher sind das kurze Hold-/Busy-Texte. Für lange Sperrgründe reichen
Zeilenumbruch und längere Anzeigedauer nicht: Am linken/rechten Rand oder bei einem oberen
Control kann ein großer Teil der Erklärung außerhalb des Fensters liegen. Gerade diese lokale
Erklärung ist der Zweck von UI-K18.

**Plan ergänzen:** Maximale Breite aus dem verfügbaren Viewport, Messung nach dem Rendern,
Position oberhalb/unterhalb je Platz und Begrenzung an allen Rändern. Scrollen, Zoom und
verschwindende Anker berücksichtigen. Das vorhandene HelpIcon/`helpPlacement` liefert bereits
ein erprobtes Muster; Single-Root-Vertrag der MachineControls erhalten. Vollständiger Text bleibt
im stillen Protokoll nachlesbar.

**Abnahme:** Lange Gründe an allen vier Rändern, disabled Input als Anker, Tastaturauslösung,
Hochformat/150 % und Dialog. Erklärung lesbar im Fenster, keine Maschinenaktion, Statuszeile
unverändert und genau ein Protokolleintrag je Auslösung.

## UI-D09 · P3 — Auditquelle und Dialogtabelle vor der Migration ablegen

**Plan:** Kontext Zeilen 12–14, D2 Zeile 149, Doku Zeilen 387–389.

**Problem:** Der Plan beruft sich auf rund 60 zusätzliche Befunde und eine Tabelle aller
22 Dialoge. Diese sind in der geprüften Fassung nicht enthalten oder verlinkt. Referenzen mischen
UI-N, N, A, B, C, D und F. Damit lässt sich noch nicht kontrollieren, ob „alle Vorkommen“ wirklich
migriert sind oder welcher Kontext eine Ausnahme begründet.

**Ergänzung:** Befundliste mit stabiler ID, Komponente/Zeile, Regel, Paket und Abnahme einchecken.
Dialogtabelle zusätzlich mit Art, Dirty-/Busy-Zuständen, X/Cancel/Hintergrund, Initialfokus,
Rückkehrziel und möglichen Kinddialogen. Die neue 4×2-Entscheidung in der K17-Stellungnahme
vermerken; historische Picker-Messungen als historische Alternative erhalten.

## Weitere Präzisierungen ohne eigenen Blocker

- **Einheiten/Formatierung (D0):** Anzeigen und editierbare Werte unterscheiden. `NO_VALUE = "—"`
  darf kein Eingabewert werden; `fmtAxisValue` behält reine Zahlen bzw. leere Eingabe. Einheiten
  folgen der Quelle des Werts: Maschinen-/Preview-Einheit, Winkel und dimensionslose Werte
  trennen; ein Labelwechsel ersetzt keine Umrechnung. mm/in und lineare/rotatorische Beispiele
  als gezielte Abnahme aufnehmen.
- **Stil und Gate (D2/D10):** Ein danger-Aussehen darf keine fachliche Berechtigung ersetzen.
  `dialogDanger` hat aktuell `gate: always`; es ist kein universeller gegateter Ersatz für
  destruktive Maschinen-/Dateiaktionen. Bestehende Gates pro Aktion erhalten und Ausnahmen benennen.
- **Abort-Position (D2/D5):** „Abort links im Werkzeugwechsel, ganz rechts in Aktionsgruppen“
  ausdrücklich als zwei Kontexte dokumentieren und im Live-Vergleich prüfen; sonst entsteht die
  nächste unklare Positionsregel. Gleiches gilt für danger bei Bewegungen versus bisherigen
  neutralen Hold-Aktionen: konkrete visuelle Zuordnung statt zweier widersprüchlicher Pauschalen.
- **Zugänglichkeit:** Kleine praktische Screenreader-Stichprobe möglichst nach D2/D3/D4, bevor
  das Muster überall eingebaut ist; vollständige Abnahme darf als eigener Schritt stehen bleiben.
  Das ist eine Empfehlung, keine zusätzliche Merge-Bedingung dieses Reviews.
- **Reihenfolge:** Referenzgeometrie vor breiter Migration. D8 sollte die relevanten Viewer-Tests
  einschließen; die bisher aufgezählten Paket-Projekte enthalten `serial-viewer` noch nicht.
  Screenshots erst nach fachlicher Prüfung erneuern, wie im Plan bereits vorgesehen.

## Antworten auf Runde 1

Die [Antworten von Claude / Fable in Fassung 2](ui-design-welle.plan.f2.md#antworten-auf-codex-plan-review-runde-1)
nehmen UI-D01–UI-D09 an und beschreiben die zugehörigen Planänderungen. Die unabhängige Bewertung
folgt unten. Die Zeilenangaben der ursprünglichen Befunde beziehen sich weiter auf den archivierten
Snapshot der Fassung 1.

---

<a id="codex-runde-2"></a>

## Codex-Nachprüfung · Runde 2 · Fassung 2 · 23. September 2026

**Ergebnis: Die beiden P1-Punkte sind im Plan aufgelöst. Acht der neun bisherigen Punkte sind
auf Planebene akzeptiert. UI-D06 bleibt P2-offen, weil die konkret benannte Helper-API der
zugesagten Entwurfserhaltung widerspricht.** Es gibt keinen neuen eigenständigen P1/P2-Befund.

**Prüfstand:** [Fassung 2](ui-design-welle.plan.f2.md), 656 Zeilen, Quelle wie Runde 1, geändert um
21:10 Uhr. SHA-256: `a52f71c108c12301c70f70ca683e5518fa1084badbcf7daeb398e4acdcf3928c`.
Produktcode weiterhin `0019da5`; kein Design-Implementierungsstand. Fassung 1 bleibt bytegleich
unter `ui-design-welle.plan.f1.md` erhalten.

### Entscheidung je Befund

| ID | Bewertung Fassung 2 | Begründung / verbleibende Abnahme |
|---|---|---|
| UI-D01 | **akzeptiert auf Planebene** | D2, Zeilen 200–209: genau Banner-Abort und Acknowledge zusätzlich erreichbar; Home All ausgeschlossen; Fokus-Ersatzpunkt auch bei gesperrten Feldern. Die Antwort in Zeile 477 enthält die verlangten Lauf-/Stapel-/Gate-Wechsel-Fälle. |
| UI-D02 | **akzeptiert auf Planebene** | D6, Zeilen 322–344: Öffnen per Tipp und Ausführen per Hold getrennt; Enter sendet nicht; Befehl/Parameter bilden das Hold-Ziel. `probe` bleibt am Button und wird im `fire`-Pfad angeglichen; die Verschärfung ist ausdrücklich benannt. Cross-Client-Änderung während Hold wird geprüft. |
| UI-D03 | **akzeptiert als vorgeschaltetes Geometriepaket** | WP-DR, Zeilen 82–106: reale Namen/Inhalte, Breiten, Mindest-Inhaltshöhe, Ausweichform und Pfeilmodell festgelegt. Operator-Wahl erfolgt anhand des gemessenen Entwurfs vor D3/D4. Noch kein Nachweis, dass das Raster passt; WP-DR muss diese Voraussetzung erfüllen, bevor breit migriert wird. Die ausgegrenzten Zoomzustände gelten ausdrücklich nicht als verbessert. |
| UI-D04 | **akzeptiert auf Planebene** | D1, Zeilen 145–149: Erklärung immer, Retry nur bei wiederholbaren Fehlern; 400/503-Regressionsfälle bleiben enthalten. |
| UI-D05 | **akzeptiert auf Planebene** | D8, Zeilen 379–388: ganze Palette mit explizitem Modus; Altpalette bleibt Custom, Automatic wird sichtbar angeboten. Keine Absichts-Heuristik, Custom-Werte bleiben beim Umschalten erhalten. Die Antwort nennt die Migrations-/Zweitclient-Fälle. |
| UI-D06 | **teilweise gelöst, P2 offen** | Stack, oberster Fokusbereich, gemeinsame Schließwache und Rückkehr sind ausreichend beschrieben. Der Aufruf `closeKeypadIf` in Zeile 193 ist jedoch ein endgültiges Kontextende und löscht Entwürfe. Details und Korrektur unten. |
| UI-D07 | **akzeptiert auf Planebene** | D8/D10: Opazitätswiderspruch entfernt, beide Syntaxdarstellungen benannt, wirksame gerenderte Farbpaare und Viewer-Szenen mit Geometrie vorgesehen. |
| UI-D08 | **akzeptiert auf Planebene** | D1, Zeilen 121–129: Messung nach Rendern, Viewport-/Zoom-Begrenzung, Behandlung verschwindender Anker; Prüfmatrix umfasst lange Gründe an vier Rändern. |
| UI-D09 | **akzeptiert auf Planebene** | Anhang A enthält **76 eindeutig nummerierte Befundzeilen** mit absichtlich lückenhafter Nummerierung bis UI-N115; Anhang B enthält **22 Dialoge**. Befund/Paket/Regel/Abnahme sind damit nachvollziehbar. K17s neue Ausgangsentscheidung ist dokumentiert. |

### UI-D06 · verbleibend P2 — Kinddialog öffnen darf den Zahlentwurf nicht beenden

**Fundstelle Fassung 2, Zeilen 192–193:**

> Öffnet ein Kinddialog, wird die Eingabehilfe des Elterndialogs verborgen und gesperrt
> (`closeKeypadIf`/Text-Session), ihr Entwurf bleibt.

Die Zielregel ist richtig; der konkret genannte Aufruf tut etwas anderes:

- [closeKeypadIf](../../lcnc-webui/src/useNumberKeypad.ts#L127) löscht zuerst den gespeicherten
  Entwurf des Besitzers — **auch wenn dessen Numpad schon geschlossen ist**. Bei offener Session
  folgt `closeKeypad(false)`, also ausdrücklich ohne Entwurfserhaltung.
- Die [Numpad-Komponente](../../lcnc-webui/src/NumberKeypadStrip.vue#L50) sichert die noch
  unbestätigte Eingabe beim Unmount nur mit `keepDraft = true`.
- Ein vorhandenes `locked` nur auf true zu setzen wäre ebenfalls kein ausreichender neuer
  Dialogvertrag: Der [Sichtbarkeitspoller](../../lcnc-webui/src/inputSession.ts#L293) schreibt
  alle 300 ms anhand der DOM-Sichtbarkeit darüber. Ein überdecktes Elternfeld kann weiter im
  Layout liegen und damit als sichtbar gelten.

**Kleiner unabhängiger Modulnachweis:** Das unveränderte `useNumberKeypad.ts` wurde mit der
installierten TypeScript-Version im Speicher transpiliert und mit dem installierten Vue geladen;
keine Browser- oder Maschinenverbindung. Ergebnis:

```text
saveDraft("parent-field", "12+3")
takeDraft("parent-field")          → "12+3"
closeKeypadIf("parent-field")      → false  (keine aktive Session)
takeDraft("parent-field")          → null   (Entwurf trotzdem gelöscht)

openKeypad({ ownerId: "parent-field", value: 7, onConfirm() {} })
closeKeypadIf("parent-field")
keypadState.open                   → false
keypadState.keepDraft              → false
```

Das belegt den API-Vertrag, nicht bereits einen Fehler in einem noch nicht implementierten
DialogFrame. Es betrifft auch den normalen Klickpfad: Hat der Außenklick den Zahlentwurf bereits
gesichert, kann ein anschließendes `closeKeypadIf` beim Stapelwechsel genau diesen Entwurf löschen.

**Erforderliche Planänderung:** Den vorübergehenden Dialogwechsel als Pause des Eingabekontexts
definieren. Besitzerbezogen verstecken und mit Entwurfserhaltung schließen; der vorhandene
`hideKeypad`-/`closeKeypad(true)`-Pfad ist dafür ein Ausgangspunkt. Nur die zum Elternkontext
gehörende Session behandeln, keinen Fokus zurück in das nun verdeckte Formular ziehen und dessen
gespeicherte Entwürfe nicht löschen. Soll eine Session stattdessen gesperrt erhalten bleiben,
muss der Dialog-Grund unabhängig vom Sichtbarkeitspoller gelten. `closeKeypadIf` bleibt dem
wirklichen Kontextende vorbehalten, etwa Verwerfen, Unmount oder echter Berechtigungsverlust.

**Abnahme ergänzen:** Zahlenausdruck und auch einen leeren Zahlentwurf noch nicht anwenden →
Kinddialog öffnen → mindestens zwei Sichtbarkeitspollintervalle abwarten → keine Bearbeitung des
Elternfelds möglich → Keep editing/Cancel → Feld erneut öffnen → exakt derselbe Entwurf.
Zusätzlich den bereits verborgenen/gespeicherten Entwurf prüfen. Erst echtes Discard oder
Kontextende verwirft ihn. Während dieser Übergänge keine Werteübernahme und keine Maschinenaktion.

### Kleine Präzisierungen ohne weiteren Blocker

- **Initialfokus:** D2 sagt für `flow` pauschal Container, Anhang B nennt bei Shutdown/Kompensation
  Cancel. Beide sind sichere Ziele; die Tabelle sollte ausdrücklich als konkretisierende Ausnahme
  gelten, damit der Dialog-Scan nicht zwei verschiedene Sollwerte erhält.
- **Gate-Inventar:** Kontext nennt N95 als einzige Gate-Änderung, N71 verlangt zusätzlich ein
  gegatetes Remove Profile. Aktuell sind dessen Buttons `dialogDanger` mit `always`, die übrige
  Eingabekonfiguration ebenfalls `always`. Vor der Migration den Ziel-Gate für N71 nennen und
  entweder als weitere Ausnahme dokumentieren oder den bisherigen Berechtigungsvertrag erhalten.
- **Fehlertexte:** `browseFailure` enthält ordnerspezifische Texte für 400/403/404. Bei Werkzeug-
  und Probe-Daten die Trennung zwischen wiederholbar und dauerhaft übernehmen, nicht ungeprüft
  „This folder …“ für jede Art von Leseoperation ausgeben.
- **Registry-Wächter:** Der neue Dialog-Scan sollte den bisherigen Vergleich zwischen offenen
  Overlays und Registry-Zähler behalten. Rolle/Fokus allein beweisen keine korrekte Registrierung,
  insbesondere während alte Registrierungen auf die Selbstregistrierung im Frame umgestellt werden.

**Prüfgrenzen:** Vollständige Lektüre von Fassung 2 einschließlich Antworten und Anhängen;
gezielter Codeabgleich und der oben dokumentierte Modulnachweis. Kein Produktcode geändert,
keine Browser-/Offline-Suite und keine Live-/Touch-Abnahme. Ein Plan-Agreement folgt, sobald
UI-D06s widersprüchlicher API-Vorschlag korrigiert ist; Geometrie und Verhalten bleiben anschließend
verbindliche Implementierungsabnahmen.

---

<a id="codex-runde-3"></a>

## Codex-Nachprüfung · Runde 3 · Fassung 3 · 23. September 2026

**Ergebnis: Plan-Agreement für Fassung 3. UI-D06 ist auch im verbleibenden P2-Aspekt auf
Planebene geschlossen; damit sind UI-D01–UI-D09 vollständig beantwortet (9/9).** Im Diff
gegen Fassung 2 wurde kein neuer Planblocker gefunden.

**Prüfstand:** [Fassung 3](ui-design-welle.plan.md), 698 Zeilen. Quelle:
`/home/cnc/.claude/plans/das-aktuelle-webui-von-optimized-perlis.md`, geändert am 23.09.2026 um
21:17 Uhr. SHA-256: `7d0a956d19a3a3a6060e657b0e2fb71efcff01945f9fd511d0fa081445982235`.
Produktbasis unverändert `0019da5`. Fassung 1 und Fassung 2 sind bytegleich archiviert;
die bisherigen Review-Zeilenangaben beziehen sich auf diese jeweiligen Fassungen.

### UI-D06 — Pause und Kontextende sind jetzt getrennt

D2, Zeilen 195–210, definiert einen besitzerbezogenen Pausenhelfer:

- Nur eine zum Elterndialog gehörende offene Session wird geschlossen; gespeicherte Entwürfe
  und andere Besitzer bleiben unberührt.
- Für Zahlen wird `hideKeypad` und damit `closeKeypad(true)` verwendet. Ausdruck und leerer
  Entwurf bleiben erhalten, ohne Werteübernahme oder Fokusrückgabe ins verdeckte Formular.
- Für Text wird der Verlassen-Pfad verwendet; der Text bleibt im Feldmodell.
- `closeKeypadIf` ist ausdrücklich kein Pausenpfad. Die Änderung verlässt sich auch nicht
  auf ein vom Sichtbarkeitspoller überschreibbares `locked`-Flag.
- Oberster Fokusbereich und Scrim verhindern die Bedienung des verdeckten Elternformulars.

Die Abnahme in D2, Zeilen 254–260, enthält Ausdruck und leeren Entwurf, bereits gesicherte
Entwürfe, mehr als 600 ms Wartezeit, unerreichbares Elternfeld, Rückkehr mit Keep editing/Cancel
und Verwerfen erst beim tatsächlichen Kontextende. Das deckt die Restforderung aus Runde 2 ab.

**Gezielter Codeabgleich / Modulprobe:** Der vorhandene `hideKeypad`-Pfad setzt
`keepDraft = true`, schließt die Session, ruft `onCancel` einmal auf und übernimmt keinen Wert.
Für zwei vorab gespeicherte Entwürfe (`"12+3"` und `""`) blieben der jeweilige Inhalt und ein
fremder Entwurf erhalten; erneutes Verbergen ohne aktive Session änderte nichts. Ergebnis:
**PASS, 0 Confirm-Aufrufe, 2 Cancel-Aufrufe für 2 offene Sessions**. Der Unmount-Pfad in
`NumberKeypadStrip.vue` wurde ergänzend gelesen und sichert unbestätigte Eingaben bei
`keepDraft = true`.

Diese kleine Probe prüft den bestehenden Modulvertrag. Der geplante `pauseInputIn`-Wrapper,
die DOM-Zuordnung der Besitzer, Unmount-Reihenfolge und tatsächliche Fokus-/Scrim-Wirkung
werden erst mit der Umsetzung im Browser geprüft; dafür stehen die Fälle nun im Plan.

### Die vier Präzisierungen aus Runde 2

| Punkt | Bewertung Fassung 3 |
|---|---|
| Initialfokus | **akzeptiert:** Anhang B ist der einzige Sollwert; neutraler Cancel bei Shutdown/Kompensation und Container beim Werkzeugwechsel sind konsistent erklärt. |
| Gate-Inventar N71 | **akzeptiert:** Remove Profile behält `always`; die Änderung betrifft Typ/Aussehen. N95 bleibt die ausdrücklich benannte Verschärfung. |
| Fehlertexte | **akzeptiert:** Gemeinsam ist die Trennung dauerhaft/wiederholbar, die Texte bleiben an die Leseart gebunden. |
| Registry-Wächter | **akzeptiert:** Der Dialog-Scan erweitert den bisherigen Vergleich von Overlays und Registrierungen. |

### Umfang des Agreements

Der Plan ist als Grundlage für die Umsetzung auf `feat/ui-design-wave` aus `development`
akzeptiert. Die acht bereits in Runde 2 akzeptierten Punkte behalten diesen Stand; WP-DR bleibt
die vorgeschaltete Geometrieprüfung vor der breiten Reiter-/Formularmigration. Die dort vorgesehene
Operator-Wahl anhand des gemessenen Entwurfs ist weiterhin ein Umsetzungsschritt.

Die geplanten Codex-Implementierungsreviews nach den Paketgruppen, das finale Offline-Gate
und die Live-Sichtprüfung bleiben erforderlich. Das Agreement ist keine Merge-Freigabe und
keine Abnahme einer bereits umgesetzten Oberfläche. Die dokumentierten Zoomgrenzen und die
gesonderte physische Touch-Abnahme für `main` bleiben wie im Plan abgegrenzt.

**Prüfgrenzen dieser Runde:** Gesamten Diff Fassung 2→3 einschließlich Antworten und
Inventarkorrektur gelesen, betroffene bestehende APIs abgeglichen und die beschriebene
Modulprobe ausgeführt. Nur Review-/Plan-Dokumentation geändert; keine Browser-/Offline-Suite,
keine Live-Maschinenverbindung und keine Produktänderung.
