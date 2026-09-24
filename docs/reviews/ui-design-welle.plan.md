# WebUI Design-Welle — eine Bedienführung, gleiche Muster überall

**Fassung 3 · 23. September 2026 · neuer Branch `feat/ui-design-wave` aus `development`
(`0019da5`), Merge zurück nach `development`, nie `main`.** Fassung 2 beantwortete Codex'
Plan-Review Runde 1 (UI-D01–D09, `docs/reviews/ui-design-welle.review.md`). Fassung 3 korrigiert
nach Runde 2 den Pausenpfad der Eingabehilfe (UI-D06) und nimmt die vier Präzisierungen auf. Die
Antworten stehen je Runde am Ende.

Keine Grundüberarbeitung: Viewer links, Seitenpanel mit Tabs rechts, Leiste unten, Kopfzeile und
Makroleiste bleiben. Ziel: gleiche Dinge sehen gleich aus, stehen am gleichen Platz und verhalten
sich gleich.

## Kontext

- **Quellen:**
  - Codex' Konsistenz-Review UI-K01–K17 (`docs/reviews/ui-optimierungen.consistency-review.md`).
  - Die Operator-Beobachtung **UI-K18** aus der Live-Sichtprüfung (drei Rückmeldewege).
  - Ein Audit am Stand `0019da5` (drei Durchgänge: Hauptpanels, Leisten/Kopf/Dialoge,
    Settings/Viewer/Begriffe). Seine Befunde stehen mit stabiler ID **UI-N01–UI-N115** im
    **Anhang A**, die 22 Dialoge im **Anhang B**.
- **Operator-Entscheidungen 23.09.:**
  1. **Probing-Unterreiter** als festes 4×2-Raster in Reiter-Optik. Alle acht bleiben sichtbar,
     keine Auswahlliste. Die Picker-Messungen im Konsistenz-Review bleiben als historische
     Alternative stehen.
  2. **Sperrgrund** erscheint als Blase am Control und wird still in der Meldungsliste protokolliert.
  3. **Makros** lösen wie jeder andere Bewegungsbutton per Halten aus.
  4. **Eingabehilfen:** X immer oben rechts, bei beiden Tastaturen und in beiden Ausrichtungen. Die
     Code-Seite bekommt einen räumlichen Ziffernblock.
- **Leitprinzip je Paket:** zuerst die Regel bzw. den Baustein festlegen, dann alle Vorkommen laut
  Anhang A/B migrieren, dann einen Wächter einbauen.
- **Unverändert:**
  - Escape = E-Stop.
  - Die Gates jeder Aktion; die einzige Ausnahme ist N95, sie verschärft.
  - Hold-Verträge, Fokusrückgabe, Entwurfsschutz, Modal-Registry.
  - `fire()`-Latch, Jog-Keyup- und Stop-Regeln.
  - `browseFailure`-Klassifikation (UI-K15).
  - Das 264-px-Budget der Leiste.
- **Farbregel für Buttons** (ersetzt die Pauschale aus Fassung 1):
  - `danger` nur für unumkehrbaren Datenverlust und für Stopps (Abort, E-Stop).
  - Bewegungen bleiben neutral bzw. `ready` und sind durch Halten oder eine Bestätigung geschützt.
  - Das Aussehen ersetzt nie das Gate: `dialogDanger` hat `gate: always`, destruktive Aktionen mit
    Berechtigung bekommen gegatete danger-Typen (z. B. `dialogDangerSetup`).

## Arbeitspakete (Reihenfolge = Commit-Reihenfolge, je Paket ein Commit mit Gates)

### WP-D0 — Begriffe, Einheiten, Platzhalter

**Glossar** (neu: `docs/ui-glossary.md`, in CLAUDE.md verlinkt), N07–N16:
- Tools / Tool table / Tool library.
- Program (nie „file“ im Programmkontext).
- Work offset (G54…), WCS nur als Kurzform.
- Collision statt „clash“.
- Soft limit.
- Rapid, nie „Fast Feed“ für Eilgang; die Probe-Parameter heißen „Probe feed“.
- Gleiche Parameternamen in Probing und Toolsetter.
- „None“ für unbelegte Tasten.

**Schreibweise** (N13, N43):
- Title Case für Buttons, Reiter, Abschnitts- und Arbeitsdialog-Titel.
- Bestätigungsfragen als Satz mit Objekt.
- Hilfe und Beschreibungen in Satzform.
- Statuswörter in Großbuchstaben.
- Immer „…“ (N01).

**Formate** (`format.ts`):
- `fmtPct` mit „120 %“ (N03).
- `NO_VALUE = "—"` **nur für Anzeigen** (N05). Editierbare Werte behalten Zahl oder leere Eingabe;
  `fmtAxisValue` und Eingabefelder bleiben unberührt.
- `ms` mit Leerzeichen (N04).
- **Einheiten folgen der Quelle des Werts** (N02):
  - Maschinenlänge aus `linearUnit`, Preview-Längen aus der Preview-Einheit.
  - Winkel in ° bzw. °/min.
  - Dimensionslose Werte ohne Einheit.
  - Ein Labelwechsel ersetzt keine Umrechnung.

**Zustandswörter** (N06): ESTOP / CLEAR, ON / OFF, HOMED / NOT HOMED.

**Wächter:**
- Audit-Kategorien `ELLIPSIS` und `UNIT_LITERAL` (Allowlist).
- Vitest für `fmtPct` und `NO_VALUE`.
- Gezielte Abnahme mm und in, linear und rotatorisch.

### WP-DR — Referenzgeometrie vor Reitern und Formularen (UI-D03)

Vor D3/D4 wird ein schmaler Referenzstand im Produkt mit **echten Namen und vollständigem
Probing-Inhalt** gemessen:
- Landscape 1600×1000 und 1280×800 mit Seitenpanel 522 px innen.
- Hochformat 900×1200 bei 100 % und 150 % (etwa 271 px Breite und 304 px Höhe innen).
- Jeweils Desktop und Touch.
- Werkzeug: das bestehende `layout.spec`/`layout-fixtures.ts`, erweitert.

**Festzulegen und im Plan-Dokument zu protokollieren:**

- **Hauptreiter:** fünf gleich breite Spalten ohne horizontales Scrollen. Wenn die Namen bei der
  engsten Breite nicht voll passen, gilt eine vorab vereinbarte Ausweichform: Icon mit Kurzlabel,
  kein Schrumpfen der Trefferfläche. Die Wahl trifft der Operator anhand der Messung.
- **Probing-Raster:** 4 × 65 px bei 271 px. Namen dürfen am „/“ zweizeilig umbrechen
  („Boss/⏎Pocket“); die Reiterhöhe bleibt 32 px Desktop bzw. 44 px Touch und fasst zwei Zeilen.
- **Höhenrechnung** der feststehenden Bereiche (Hauptreiter + Raster + Steuerleiste +
  Beschreibungszeile) gegen die **minimal nutzbare Inhaltshöhe**: mindestens drei Formularzeilen
  bei 150 % im Hochformat. Reicht das nicht, scrollt die Steuerleiste mit dem Inhalt; die Reiter
  bleiben fest.
- **Pfeiltasten im Raster:** Links/Rechts laufen linear in Leserichtung durch alle acht, Home/End
  springen an die Enden, Hoch/Runter wechseln die Rasterzeile. Alle vier werden lokal abgefangen.
  Auswahl erst mit Enter/Leertaste.
- **Bekannte Ausgangsgrenzen** werden benannt und nicht als behoben dargestellt: Querformat ab 150 %
  (Gesamtaufteilung) und 200 %. Die Abschlussmatrix grenzt sie aus.

### WP-D1 — Rückmeldekanäle (UI-K18 + Banner + Inline-Meldungen)

**Kanalregel** (Doku + CLAUDE.md):
- **Am Control** erscheint alles, was eine Berührung auslöst.
- **Inline im Panel** stehen die Ergebnisse eines Vorgangs dort, wo er begann.
- **Banner** ist für Maschinen- und Systemzustand da.
- **Meldungsliste** ist das Protokoll.

**Sperrgrund** (N20, N21):
- `gateExplain.explain()` zeigt `showBtnHint(anchor, reason)` und protokolliert mit einem neuen
  `quiet`-Flag in `pushMessage`: genau ein Eintrag je Auslösung, die Statuszeile bleibt unberührt.
- SetupStrip-WCS-Radios laufen über `useGateExplain`.

**Platzierung der Blase** (UI-D08):
- `btnHint` misst nach dem Rendern und platziert über `placePopover`
  (`lcnc-webui/src/helpPlacement.ts`, erprobt in HelpIcon): oberhalb, sonst unterhalb.
- Maximale Breite aus dem Viewport, an allen Rändern begrenzt, geteilt durch den CSS-Zoom wie in
  HelpIcon.
- Schließt bei Scrollen und bei verschwundenem Anker.
- Anzeigedauer skaliert mit der Textlänge (1,5–6 s).
- Bleibt ein App-weites Element in `FloatingOverlays.vue`; der Single-Root-Vertrag der
  Machine-Controls bleibt gewahrt.

**Banner:**
- Die Statuszeile übernehmen nur noch Fehlermeldungen (N22).
- Zwei Stufen: rot für Sicherheit, Maschine und Verbindung; warn für Programm, Vorschau und
  Konfiguration (N23).
- Jede Zeile hat einen Wiederherstellungs-Button oder sagt im Text, was zu tun ist (N24).
- Details sind per Tipp in der Meldungsliste erreichbar statt nur im `title` (N26).
- Buttons aus der `banner*`-Familie, neu ist `bannerAck` (N25).
- `openMessages()`/`closeMessages()` sind der einzige Weg; jeder Schließweg markiert als gelesen
  (N27).

**Inline-Meldungen:**
- Ein Muster `.statusNote` (error/warn/ok): `role="alert"` bei error/warn, optionale Aktion, X bei
  dauerhaften Meldungen (N30). Es ersetzt `.errorBanner`, `.warnBanner`, `.noteWarn`,
  `.importBanner` und `importWarn`.
- **Lesefehler** (UI-D04, N28): Jede Ablehnung bekommt eine lokale Erklärung; **nur wiederholbare**
  Fehler zusätzlich ein Retry mit ungegatetem Typ `retry`.
  - Die Klassifikation bleibt fachlich bei `browseFailure.ts` (400 ohne Retry, 403/404/5xx/Netz
    mit Retry).
  - Für Tool-Tabelle und Probe-Daten wird nur die **Trennung** übernommen, dauerhaft gegen
    wiederholbar. Die Texte sind je Leseart eigen; die ordnerspezifischen Texte („This folder …“)
    bleiben dem Browser vorbehalten.
- **Speicherfehler** stehen inline, sonst `OPERATOR_ERROR` (N29).
- **„Discard“** ist überall danger (N31).

**Hilfe-Kanäle** (N32–N34):
- Abschnittsbeschreibung inline (`.settingDesc` wird global).
- Feldhilfe über `HelpIcon` mit `label`.
- `title` nur als Kurzname oder Hover-Ergänzung; keine Doppeltexte.
- Probe-Operationen zeigen ihre Beschreibung sichtbar unter dem Raster.

**Wächter:**
- e2e Sperrgrund: lange Gründe an allen vier Rändern, gesperrtes Input als Anker,
  Tastaturauslösung, Hochformat/150 %, im Dialog. Die Blase liegt ganz im Fenster, keine
  Maschinenaktion, die Statuszeile bleibt, genau ein Protokolleintrag.
- e2e Banner-Stufen.
- e2e Lesefehler (400 ohne Retry mit alter Liste; 503 mit erfolgreichem Retry).
- Audit `LONG_TITLE`.

### WP-D2 — Dialogvertrag (UI-K11, K16(3), Anhang B)

**`DialogFrame.vue`:**
- **Stufen** `confirm` (sm) / `md` / `lg`.
- **Arten** `info | confirm | form | host | flow | running`:
  - `host` ist Settings: Container mit eigener Entwurfswache.
  - `flow` ist ein Maschinenablauf: Werkzeugwechsel, Kompensation, Shutdown.
- **Rolle:** `role="dialog"` am Dialog-Container, `aria-labelledby` zeigt auf den Titel. Kein
  `aria-modal`; die Ausnahme vom W3C-Modalmuster ist gewollt, weil die externen Safety-Aktionen
  bedienbar bleiben.
- Teleport immer nach `#content-dialog-area` (N46).
- Registriert sich selbst mit `registerModal`.
- **Ein Schließweg** `requestClose(reason)`, mit `reason` = x | cancel | backdrop | navigation |
  parent. Er läuft durch die vorhandene Draft- und Busy-Wache:
  - `info`/`confirm`: Hintergrund schließt.
  - `form`: Hintergrund wirkungslos (N41).
  - `host`: fragt die Wache (heutiges `guardSettingsClose`).
  - `flow`: nur über die eigenen Buttons.
  - `running`: gesperrt bis zur Antwort. Endet der Vorgang mit Fehler oder Verbindungsabbruch,
    gibt der Frame den Dialog wieder frei. Kein neuer Transport-Fallback, kein dauerhaft
    unbedienbares Overlay.

**Stapel** (UI-D06):
- Ein neuer `dialogStack` in `modalRegistry.ts` führt die Reihenfolge; nur der **oberste** Dialog
  hat den aktiven Fokusbereich.
- **Kinddialog öffnen = Pause des Eingabekontexts, kein Kontextende** (UI-D06, Runde 2):
  - **Keypad:** Neuer besitzerbezogener Helfer `pauseInputIn(parentEl)` in `inputSession.ts`.
    Gehört die offene Keypad-Session zum Elterndialog (ihr `trigger` liegt in `parentEl`), wird sie
    über `hideKeypad("child dialog opened")` geschlossen. Das ist `closeKeypad(true)`: Der Entwurf
    wird gesichert, auch ein leerer, `onCancel` läuft, kein Wert wird übernommen.
  - **Text:** Eine Text-Session des Elterndialogs endet über den Verlassen-Pfad
    `closeTextSession(reason)`. Der Text bleibt im Feldmodell, kein Fokus wird zurückgezogen.
  - **Nie `closeKeypadIf`/`closeTextSessionIf`:** Sie bleiben dem echten Kontextende vorbehalten
    (Discard, Unmount, Berechtigungsverlust). `closeKeypadIf` löscht den Entwurf auch ohne offene
    Session.
  - **Andere Besitzer** bleiben unberührt. Ist der Entwurf des Elternfelds schon gesichert (nach
    einem Außenklick), rührt die Pause ihn nicht an.
  - **Keine Sperre über `locked`:** Der Sichtbarkeitspoller überschreibt es alle 300 ms. Dass das
    Elternfeld währenddessen nicht bedienbar ist, sichern der Fokusbereich des obersten Dialogs
    (Tab erreicht es nicht) und der Scrim (Zeiger erreicht es nicht). Der Fokus wird nicht in das
    verdeckte Formular gezogen.
- Kind schließen → bewachte Rückkehr in den Elternkontext.
- Ganzen Stapel schließen → einmal zum gültigen Auslöser; ist er gesperrt oder entfernt, zum
  Dialog-Ersatzpunkt des nächsten Elternteils bzw. zum Panel.
- Nie ungeschützt `body`: die Fokus-Rückgabe hält den Modal-Guard bis zur Landung, wie
  `focusReturn.pending`.

**Fokusbereich** (UI-D01) — Tab erreicht nur:
1. den obersten Dialog;
2. seine eigene Eingabehilfe;
3. die Safety-Leiste (Arm, E-Stop, Power);
4. aus dem Banner genau **Abort** (`bannerAbort`, sichtbar während Lauf oder Pause) und
   **Acknowledge** (Trip-Quittierung).

Nicht Home All, nicht Messages/Refresh. Der **Fokus-Ersatzpunkt** ist der Dialog-Container
(`tabindex="-1"`, bleibt fokussierbar, auch wenn das Content-Gate nach Disarm/E-Stop die Felder
sperrt).

**Initialfokus:** **Anhang B ist der einzige Sollwert je Dialog**; der Dialog-Scan liest ihn. Die
Grundregeln:
- `form`: erstes Feld.
- `confirm`: die sichere Aktion.
- `flow`: die neutrale Abbruch-Aktion, wo es eine gibt (Shutdown, Kompensation: Cancel). Sonst der
  Container, damit kein Button unter Enter/Leertaste liegt (Werkzeugwechsel: beide Buttons sind
  Maschinenaktionen).
- `info`: X bzw. Suchfeld.

**Regeln:**
- Abbrechen links, Vorwärts rechts (N40: Werkzeugwechsel Abort links, Confirm rechts).
- **Abort-Position in zwei dokumentierten Kontexten:** in Dialogen links als Abbruch-Seite, in
  Aktionsgruppen ganz rechts (D5). Beides wird im Live-Vergleich geprüft.
- Destruktiv mit danger-Typ plus dem **bisherigen** Gate der Aktion (N42).
- Der Bestätigungsbutton wiederholt das Verb; „This cannot be undone“ bei allen unumkehrbaren
  Aktionen (N44).
- Das kleine `.dialog` ist nur für Ja/Nein da, Formulare kommen auf `md` (N45).
- Meldungsliste: Clear All danger mit Rückfrage, lucide-X (N47).
- „Keep editing“ in jeder Verwerfen-Rückfrage (N49).

**Wächter:**
- Der Dialog-Scan **erweitert** den Registry-Selbsttest; der Vergleich offene Overlays = Registry
  bleibt, gerade während der Umstellung auf die Selbstregistrierung im Frame.
- Er prüft außerdem Rolle am Container, Namen, Initialfokus laut Anhang B, Tab/Shift+Tab nur in
  den erlaubten Bereichen und Escape = genau `estop`.
- Dazu die Abnahmefälle von UI-D01 und D06 (siehe Antworten), einschließlich des Pausenfalls:
  - Zahlenausdruck **und** leerer Zahlentwurf, jeweils noch nicht angewendet → Kinddialog öffnen →
    mindestens zwei Pollintervalle (über 600 ms) abwarten.
  - Das Elternfeld ist per Tab und Zeiger nicht erreichbar.
  - Keep editing bzw. Cancel → Feld erneut öffnen → exakt derselbe Entwurf.
  - Dasselbe mit einem bereits per Außenklick gesicherten Entwurf.
  - Erst Discard bzw. Kontextende verwirft ihn.
  - Keine Werteübernahme, keine Maschinenaktion.

**Stichprobe:** eine praktische Screenreader-Stichprobe nach D2 (VoiceOver am Operator-Mac, sofern
möglich). Empfehlung, keine Merge-Bedingung.

### WP-D3 — Reiter und Fokusanzeige (UI-K17, K12)

**`TabNav.vue`** mit den Darstellungen `main` und `sub`:
- `tablist`/`tab`/`tabpanel`, `aria-selected`, ein Tab-Stopp, manuelle Aktivierung.
- Tastenregel aus WP-DR, alle Pfeile lokal abgefangen. Keyup- und Jog-Stop-Guards bleiben.
- Keine Maschinenaktion durch einen Tabwechsel.
- **Hauptreiter** oben gerundet und mit dem Inhalt verbunden; **Unterreiter** mit Unterstrich.

**Migration:**
- TabPanel.
- Probing als 4×2-Raster nach der WP-DR-Geometrie.
- Settings.
- HAL Pins/Signals/Params (N51).
- Off/FWD/REV wird eine Optionsgruppe in der Reihenfolge Rev / Stop / Fwd (N50, N14).

**Fokusanzeige:** ein globaler `:focus-visible`-Ring auch für Slider (`style.css:341`); Auswahl und
Fokus getrennt, Auswahl nicht nur über Farbe.

**Wächter:** e2e Tab-Semantik: kein Jog-Befehl über Pfeiltasten, ein laufender Jog stoppt beim
Tabwechsel, verborgene Panels sind nicht fokussierbar.

### WP-D4 — Kontrollen und Formulare (UI-K03, K04, K10, N60–N71)

**Kontrollhöhen:** `--control-h` (32/44) und `--control-h-compact` (28/36); `INPUT_SIZE_STYLES`
begradigen.

**`FormField.vue` + `.formGrid`:**
- Label über dem Feld mit `for`/`id`, Einheit, HelpIcon und Fehler über `aria-describedby`.
- Zwei gleich breite Spalten nach der WP-DR-Breite, sonst eine.
- Zahlen rechtsbündig, Einheit sichtbar.
- Eine Label-Klasse (N60, N61).

**Migration:**
- Werkzeugeditor (K04).
- Settings-Tabs (N62–N64, N66).
- Toolsetter, Probe-Parameter, Makro-Editor, Makro-Parameter, Upload-Umbenennen.

**Zurücksetzen** (N65): ein Platz, **das bisherige Gate der jeweiligen Aktion**, eine Rückfrage.

**Listen-Editoren** (N67–N71):
- Stift/`Trash2` als `listAction`.
- Rückfrage nur bei schwer Wiederherstellbarem.
- Aktion | Belegung.
- Gamepad-Invert aus `useAxes`.
- Gleiche Hinzufügen-Größe, gemeinsame Aktionsliste.
- „Remove Profile“ wird ein danger-Typ **mit dem heutigen Gate `always`**, wie die übrige
  Gamepad-Konfiguration. Das Berechtigungsverhalten ändert sich nicht, nur Aussehen und Größe.

**Wächter:** Feldnamen-Scan für jedes sichtbare Input, jeden Select und jeden Slider (K10);
`layout.spec` misst Kontrollhöhen je Dichte.

### WP-D5 — Bereichsmuster der Tabs (UI-K05, K06, K07, N80–N85)

**Panelaufbau** (`.panelHead`, `.actionGroup`):

1. Objekt-/Statuszeile.
2. Maschinenaktionen, **Abort ganz rechts** dieser Gruppe (N80).
3. Verwaltung.
4. Suche/Filter.
5. Inhalt (scrollt).
6. Inline-Rückmeldung.

**Migration je Tab** (N81, N82):
- **Program:** ohne „File:“.
- **Tools:** „Werkzeug in der Spindel · T…“ mit Measure/Unload/Abort, dann Verwaltung.
- **MDI.**
- **Offsets.**
- **Probing:** Steuerleiste mit Abort rechts.
- Ein eindeutiger Umschalter „Files“.

**Leer-, Lade- und Fehlerzustände:** `.emptyState` mit den Varianten `empty`, `noMatch`, `loading`
und `error` (N83, N84).

**Werkzeugtabelle** (K07):
- T# und Beschreibung zuerst, Typfilter in der Suchzeile, seltene Spalten in den Editor.
- Aktuelles Werkzeug mit Text-/Zeichenmarke, `aria-sort`, Bearbeiten am Zeilenende.

**Kopfzeile** (K06): gleiche Buttonhöhe und Icongröße, Shutdown mit Icon und Text nebeneinander,
Net/Ping/Clients in einen Detail-Popover.

### WP-D6 — Leisten und Makroleiste (N90–N95, K13-Teil)

- **Zurücksetzen** mit sichtbarem Zielwert und dem Namen „Reset <X> to <Y>“ (N90).
- **Titel nie in einem Gate**; gemeinsame Modifier-Klasse für feste Breite (N91).
- **Beschriftungen:** `.sub` und `.label-muted` in einer Größe, ohne Doppelpunkt (N92).
- **`.sectionHelp`** wird global, der Hochformat-Umbruch aus `776ee69` bleibt (N93).
- **Plane-Radio** nur mit Farbmodifikatoren (N94).
- **HelpIcon-Trefferfläche** unsichtbar auf mindestens 24 × 24 px vergrößert.

**Makros** (Operator-Entscheidung 3, UI-D02, N95):

- **Ohne Parameter:** Der Makrobutton ist Hold-to-fire.
  - `holdKey` = Makro-ID + Revision des auszuführenden Befehls (Hash des Befehlstexts).
  - Jede Änderung während des Haltens bricht den Hold ab, mit Hinweis „Selection changed — hold
    again“ über den vorhandenen `holdKey`-Watcher in `MachineBtn.vue:220`.
  - Die Bindung an Revision und Parameterwerte stellt sicher, dass der Hold nie ein anderes Ziel
    ausführt.
- **Mit Parametern:** Ein Tipp öffnet den Parameterdialog (Öffnen ist keine Bewegung).
  - **Execute im Dialog ist Hold-to-fire**, `holdKey` = Makro-Revision + Parameterwerte.
  - **Enter im Parameterfeld führt nicht aus**, sondern springt zum nächsten Feld bzw. auf Execute.
- **Gate:**
  - Bleibt `probe`, wie in der Rechte-Tabelle in CLAUDE.md dokumentiert.
  - Der `fire`-Aufruf in `useMacros.ts:53/71` wird von `ready` auf `probe` angeglichen, damit Button
    und Prüfung dieselbe Regel haben.
  - Das verschärft nur; der MDI-Vertrag bleibt erfüllt, weil `probe` `ready` enthält.

**Wächter** (e2e):
- Kurzer Tipp, voller Hold, Pointer-Abbruch, Gate-Verlust.
- Parameterdialog und Enter.
- Befehl bei gleicher ID während des Haltens per simuliertem `settings_changed` ändern → kein MDI;
  ein neuer voller Hold führt genau den sichtbaren Befehl einmal aus.
- Parameteränderung während des Execute-Holds analog.

### WP-D7 — Eingabehilfen (UI-K01, K02; Operator-Entscheidung 4)

**X oben rechts:**
- Gilt für Zahlenfeld und Texttastatur, in Quer- und Hochformat.
- 44 × 44 px, im Aktionsraster reserviert.
- Verhalten wie UX-01.

**Code-Seite:**
- Räumliche Gruppen: Ziffernblock 7-8-9 / 4-5-6 / 1-2-3, Befehls-/Achsblock, Satzzeichen.
- Innere Reihenfolge in beiden Ausrichtungen gleich.
- ABC bleibt alphabetisch.

**Wächter:**
- Abdeckungstest.
- e2e X-Anker in vier Kombinationen.
- `layout.spec` im 264-px-Budget.
- 150 % im Hochformat verdeckt das Besitzerfeld nicht.

### WP-D8 — Farben, Kontrast, Themes (UI-K08, K09, K13-Teil)

**Textrollen als feste Farben je Theme, keine Opazität für lesepflichtigen Text** (UI-D07):
- Beschreibungen, Hinweise, Ladezustände, Syntax und Kommentare verwenden geprüfte Rollen **ohne**
  zusätzliche Opazität.
- Das trifft auch `style.css:1198` (Kommentare) und `gcodeCmLanguage.ts:56` (CodeMirror).
- Opazität bleibt nur für wirklich gesperrte Controls und Dekoration.
- `--focus-ring` ist getrennt von `--info`.

**Syntaxpalette je Theme.** Die HC-Themes decken Syntax, Viewer und Fokus ab.

**Viewer-Palette aus Rollen je Theme** (Ausgangspalette K08): Die gelbe Limit-Markierung bekommt
eine kontrastfähige Rolle. Rein farbliche Unterscheidungen bekommen ein Form- oder Textmerkmal:
Eilgang gestrichelt, Auswahl breiter, Kollision mit Marker, Legende im Layer-Menü.

**Migration der Farben** (UI-D05, verlustfrei):
- Der Modus `paletteMode: "auto" | "custom"` gilt **für die ganze Palette** und wird ab jetzt
  explizit gespeichert.
- **Keine gespeicherte Viewer-Sektion** → `auto`.
- **Eine gespeicherte Altpalette**, egal ob sie den alten Standardwerten gleicht → `custom` (Legacy).
  Settings bieten „Use automatic colors“ sichtbar an.
- Beim Wechsel `custom → auto → custom` bleiben die Custom-Werte erhalten.
- Die Mehrdeutigkeit wird benannt: Aus Altdaten lässt sich nicht erkennen, ob eine Farbe bewusst
  gewählt wurde. Deshalb werden keine Standardwerte heuristisch umgestellt.
- Custom-Farben gelten nicht als kontrastgeprüft.

**Bewegung und Kontrastmodi:**
- `prefers-reduced-motion` schaltet den Puls ab; der Sicherheitszustand bleibt als Text sichtbar.
- `forced-colors`: Fokus, Auswahl und Warnungen bleiben sichtbar.

**Wächter:**
- **Kontrast-Test auf gerenderte Paare:** Ein Playwright-Scan liest die berechneten Stile der
  tatsächlich verwendeten Vorder-/Hintergrundpaare, einschließlich wirksamer Transparenz.
  - Abgedeckt: aktive, ausgewählte und stale Zustände, Statusnote, Tooltip.
  - In vier Themes, Editor und Anzeige.
  - Grenzwerte: Text 4,5:1, informative Grafik 3:1.
- **Viewer:** Die Palette wird direkt geprüft, dazu Sichtvergleich bekannter Szenen mit geladenem
  Maschinenmodell (Bounds, dichter und dünner Pfad, Auswahl, Limits, Kollision, vor heller und
  dunkler Geometrie) im Projekt `serial-viewer`.

### WP-D9 — Viewer-Overlays (N100–N102, N15)

- CameraPip auf `.overlay-card`.
- lucide-Icons statt Text-Glyphen.
- `aria-label` für die Icon-Buttons im Quick-Grid.
- Ein Chip-Stil für Warnungen in Satzform, ohne „(see console)“.
- Begriffe und Einheiten aus WP-D0.

### WP-D10 — Aufräumen und Wächter (UI-K14, N110–N115)

- **Tote Reste entfernen** (N110). Die K14-Token-Kandidaten erst nach einer Verwendungsprüfung.
- **Einzeiler-Kopien durch globale Utilities ersetzen** (N112): `.text-muted`, `.text-ok`,
  `.text-warn`, `.text-danger`, `.text-error`. Dabei ist **`.text-muted` eine Farbrolle aus D8,
  keine Opazität** (UI-D07; der Widerspruch aus Fassung 1 ist entfernt).
- **`--opacity-disabled`** nur noch für gesperrte Controls (N111). Lade- und Hinweistexte bekommen
  die D8-Rolle.
- **Hart codierte Werte** durch Tokens ersetzen (N113). Benannte Tönungs-Tokens (N114). Pixelbreiten
  prüfen (N115).
- **Button-Achsen** (K14): primary und ok begrifflich trennen, Maschinenrollen bleiben.
- **Neue Audit-Kategorien:** `DIALOG_FRAME`, `EMPTYSTATE_COPY`.

## Verifikation

**Je Paket:**
- build, lint (inkl. CSS-Audit), vitest.
- Die betroffenen Playwright-Projekte (`serial-guards`, `serial-tools`, `serial-touchoff`,
  `serial-layout`, **`serial-viewer` für D8/D9**).
- `test:visual`: Referenzbilder erst nach fachlicher Sichtprüfung erneuern, im Commit-Text benannt.
- Die Suite darf dafür beendet werden (Operator 23.09.).

**Codex-Reviewrunden:** nach WP-DR + D0–D2, nach D3–D6 und nach D7–D10.

**Abschluss:**
- `python3 scripts/test_suite.py offline` PASS.
- **Live-Sichtprüfung am XYZAC-Sim** mit Checkliste je Paket: Hell/Dunkel/HC, 100/150 %, Quer- und
  Hochformat. Die Ausgangsgrenzen aus WP-DR sind ausgenommen und benannt.
- Merge nach `development`. Der physische Touchscreen bleibt Bedingung der `main`-Promotion.

## Doku

- `docs/reviews/ui-design-welle.plan.md` (diese Fassung mit Anhang A/B).
- Antworten in `ui-design-welle.review.md`.
- Die K17-Stellungnahme im Konsistenz-Review vermerkt die 4×2-Entscheidung.
- CLAUDE.md:
  - Kanalregel, Dialogvertrag inkl. Stapel und Fokusbereich, TabNav, FormField/`.formGrid`,
    Panelaufbau, Makro-Hold, Glossar-Verweis.
- `docs/decisions.md` und `docs/testing.md`.

## Risiken

- **Referenzbilder und e2e-Selektoren ändern sich pro Paket:** jede Referenz nur nach Sichtprüfung
  erneuern.
- **Werkzeugwechsel-Buttons, Tastaturlayouts und Makro-Hold** verändern eingeübte Handbewegungen. Sie
  sind entschieden und werden live geprüft.
- **Fokusbereich im Dialog:** Safety, Abort und Acknowledge bleiben erreichbar, kein pauschales
  `inert`.
- **Pfeiltasten** in Reiterleisten dürfen nie als Jog ankommen.
- **Farbmigration:** Benutzerpaletten bleiben (Legacy = custom).
- **Leistenbudget** und **150-%-Hochformat**: WP-DR legt die Zahlen fest, bevor gebaut wird.

## Folge-Liste (eigene Branches)

- Fallback-Welle FA-01–FA-04 (`feat/ui-fallbacks`).
- Tastaturalternative für Hold-Aktionen (K13).
- Gesamtaufteilung bei 200 % bzw. Querformat ab 150 %.
- Vollständige Screenreader-Abnahme.

---

## Antworten auf Codex' Plan-Review Runde 1

| ID | Antwort | Planänderung / Abnahme |
|---|---|---|
| UI-D01 | Angenommen. | D2 „Fokusbereich“: Tab erreicht Dialog, eigene Eingabehilfe, Safety-Leiste und aus dem Banner genau Abort (während Lauf/Pause) und Acknowledge; Ersatzpunkt Dialog-Container. Abnahme: Mock-Lauf → Settings/Formular → Tab zu Abort → genau `abort`, kein Cycle Start/Jog/Homing; E-Stop genau `estop`; dasselbe mit gestapelter Bestätigung, offener Eingabehilfe und anschließendem Gate-Wechsel. |
| UI-D02 | Angenommen. | D6 „Makros“: Öffnen und Ausführen getrennt; ohne Parameter Hold am Button, mit Parametern Tipp öffnet und Execute per Hold; Enter führt nicht aus. `holdKey` = ID + Befehlsrevision (+ Parameterwerte). Gate bleibt `probe`, `fire` wird angeglichen (verschärft). Abnahme wie vorgeschlagen, inkl. simulierter Änderung bei gleicher ID. |
| UI-D03 | Angenommen. | Neues WP-DR vor D3/D4: Messung mit echten Namen und vollem Probing bei 522 px und 150 % im Hochformat; Hauptreiter-Ausweichform (Operator-Wahl nach Messung), zweizeilige Rasternamen, Höhenrechnung mit Mindest-Inhaltshöhe, Pfeilregel im Raster; Ausgangsgrenzen benannt statt als behoben dargestellt. |
| UI-D04 | Angenommen. | D1: Erklärung für jede Ablehnung, Retry nur bei wiederholbaren Fehlern; `browseFailure.ts` bleibt die Quelle. Abnahme: 400 ohne Retry mit erhaltener Liste, 503 mit erfolgreichem Retry. |
| UI-D05 | Angenommen. | D8 „Migration“: ganze Palette `auto`/`custom`, explizit gespeichert; keine gespeicherte Sektion → auto, jede Altpalette → custom (Legacy) mit sichtbarem Angebot für auto; custom-Werte überleben den Wechsel; keine Heuristik. Abnahme: die sieben Fälle aus dem Review plus zweiter Client. |
| UI-D06 | Angenommen. | D2 „Stapel“ und `requestClose(reason)`: nur der oberste Dialog hat den Fokusbereich; die Eingabehilfe des Elterndialogs wird beim Kinddialog gesperrt (Entwurf bleibt); Rückkehr Kind → Elternteil bzw. Stapel → Auslöser; `running` endet bei Fehler oder Abbruch; `role` am Container. Abnahme: Editor→Verwerfen (Keep/Discard), Import→Replace, Settings→Header-Wechsel, je mit Eingabehilfe, Tab/Shift+Tab, Escape und entferntem Rückkehrziel. |
| UI-D07 | Angenommen. | D8: keine Opazität für lesepflichtigen Text (Kommentare in `style.css:1198` und `gcodeCmLanguage.ts:56` eingeschlossen); D10 widerspruchsfrei. Wächter prüft gerenderte Paare mit wirksamer Transparenz; Viewer-Szenen im Projekt `serial-viewer`. |
| UI-D08 | Angenommen. | D1 „Platzierung“: Messen nach dem Rendern, `placePopover`, Viewport-Begrenzung, Zoom, Schließen bei Scrollen oder verschwundenem Anker; Abnahme an vier Rändern, mit gesperrtem Input, Tastatur, 150 % und Dialog. |
| UI-D09 | Angenommen. | Anhang A (Befunde mit stabiler ID, Komponente:Zeile, Regel, Paket, Abnahme) und Anhang B (Dialogtabelle mit Art, Wachen, Schließwegen, Initialfokus, Rückkehr, Kinddialogen); die 4×2-Entscheidung kommt in die K17-Stellungnahme. |
| Präzisierungen | Angenommen. | `NO_VALUE` nur für Anzeigen, Einheiten nach Quelle (D0); danger ersetzt kein Gate (Kontext); Abort-Position in zwei Kontexten (D2); danger nur für Datenverlust und Stopps; Screenreader-Stichprobe nach D2 als Empfehlung; `serial-viewer` in D8. |

## Antworten auf Codex' Plan-Review Runde 2

| Punkt | Antwort | Planänderung / Abnahme |
|---|---|---|
| UI-D06 (P2) | Angenommen, der Modulnachweis ist am Code bestätigt: `closeKeypadIf` löscht den Entwurf auch ohne offene Session und schließt mit `keepDraft = false`; der Poller überschreibt `locked`. | D2 „Stapel“: Kinddialog öffnen = Pause. `pauseInputIn(parentEl)` schließt nur die Session des Elterndialogs über `hideKeypad` (`closeKeypad(true)`) bzw. `closeTextSession(reason)`, ohne Fokusrückgabe. `closeKeypadIf` nur beim echten Kontextende; kein `locked`-Trick, die Unerreichbarkeit sichern Fokusbereich und Scrim. Abnahme wie gefordert: Ausdruck und leerer Entwurf, über 600 ms warten, Feld unerreichbar, Keep editing/Cancel → derselbe Entwurf, bereits gesicherter Entwurf, erst Discard/Kontextende verwirft. |
| Initialfokus | Angenommen. | Anhang B ist der einzige Sollwert; die D2-Grundregel für `flow` nennt die Ausnahme (Cancel, wo neutral; sonst Container). |
| Gate-Inventar N71 | Angenommen. | „Remove Profile“ behält `always`, nur Typ/Aussehen ändern sich; N95 bleibt die einzige (verschärfende) Gate-Änderung. |
| Fehlertexte | Angenommen. | D1: nur die Trennung dauerhaft/wiederholbar übernehmen, eigene Texte je Leseart. |
| Registry-Wächter | Angenommen. | D2: Der Dialog-Scan erweitert den Registry-Vergleich, er ersetzt ihn nicht. |

---

## Anhang A — Befundinventar (Stand `0019da5`)

Zeilen sind Ausgangspunkte am Audit-Stand. „Abnahme“ nennt den Wächter oder die Prüfung.
Das Paket ist in der jeweiligen Tabellenüberschrift angegeben.

### D0 — Begriffe, Einheiten, Platzhalter

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N01 | „...“ statt „…“ · KeyboardTab.vue:167,179,200; HalshowTab.vue:134; GcodePanel.vue:902; ToolTablePanel.vue:712,867 | nur „…“ | Audit ELLIPSIS |
| UI-N02 | Einheit fehlt oder ist hart codiert · ScrubBar.vue:1024 („mm“); App.vue:2215 („mm“); JogStrip.vue:412,418 (Jog-Speed ohne bzw. nur „°“); JogStrip.vue:104–125 (Schritte); ToolStrip.vue:64–65; Probe-/Toolsetter-Felder | Einheit nach Quelle des Werts | Audit UNIT_LITERAL; e2e mm/in, linear/rotatorisch |
| UI-N03 | Prozent uneinheitlich · OverridesStrip.vue:40 vs :54; SettingsPanel.vue:610; GamepadTab.vue:191; ScrubBar.vue:730 | `fmtPct` „120 %“ | Vitest `fmtPct` |
| UI-N04 | „ms“ ohne Leerzeichen · DebugTab.vue:54–58 vs App.vue:1702 | „12 ms“ | Sichtprüfung |
| UI-N05 | Fünf Platzhalter für fehlende Werte · SafetyStrip.vue:145–149; ToolStrip.vue:63–67; ThreeViewer.vue:3649,3875,3896; App.vue:2031,2033; ToolTablePanel.vue:840,851; format.ts:45; GamepadTab.vue:124 | `NO_VALUE` nur in Anzeigen | Vitest; Feldwerte unverändert |
| UI-N06 | TRUE/FALSE, ON/OFF und Freitext gemischt · SafetyStrip.vue:142–145; ProbePanel.vue (Kompensation); App.vue:1700,1705 | Zustandswörter | Sichtprüfung |
| UI-N07 | Tools / Tool Table / Tool library · App.vue:304; ToolStrip.vue:58; ToolTablePanel.vue:605 | Glossar | Sichtprüfung |
| UI-N08 | Offsets / Work Coordinate Offsets / fixture / WCS · OffsetPanel.vue:116,127; ThreeViewer.vue:3931 | Glossar | Sichtprüfung |
| UI-N09 | „No file loaded“ vs „No program loaded“ · GcodePanel.vue:146 vs :955 | „Program“ | Sichtprüfung |
| UI-N10 | „Fast Feed“ mit zwei Bedeutungen · SettingsPanel.vue:470 vs ToolsetterSettings.vue:157 | Rapid / Probe feed | Sichtprüfung |
| UI-N11 | Parameternamen zwischen Probing und Toolsetter verschieden · ToolsetterSettings.vue:157ff, 165 („2×“ vs „2x“ in ProbePanel.vue:1234); ProbePanel.vue:1132–1138 (X0/X1 vs Hilfetext X Max/Min) | Glossar | Sichtprüfung |
| UI-N12 | „None“ vs „Unassigned“; totes `ACTION_LABELS` · defaults.ts:727, :520, :555 | „None“; tote Liste entfernen | Vitest Defaults |
| UI-N13 | Schreibweise der Schalter gemischt · SettingsPanel.vue:282–302; ToolsetterSettings | Title Case für Controls | Sichtprüfung |
| UI-N14 | FWD/REV vs Fwd/Rev · SettingsPanel.vue:735; SpindleStrip.vue:7,14 | Rev / Stop / Fwd | D3-e2e (Optionsgruppe) |
| UI-N15 | clash vs collision, limits vs violations, „(see console)“ · ScrubBar.vue:1010–1021; ThreeViewer.vue:3935,3984 | Glossar | Sichtprüfung (D9) |
| UI-N16 | Reiter „Halshow“ vs Suche „Search HAL“ | „HAL“ | Sichtprüfung |

### D1 — Rückmeldekanäle

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N20 | Sperrgrund landet in der Meldungsliste · gateExplain.ts:43 | Blase + stilles Protokoll | e2e Sperrgrund |
| UI-N21 | WCS-Sperrgrund von Hand gebaut, auch disarmed · SetupStrip.vue:245–246 | `useGateExplain` | e2e |
| UI-N22 | Jede Meldung übernimmt die Statuszeile für 5 s · App.vue:288–295 | nur Fehler übernehmen | e2e |
| UI-N23 | Alle Bannerzustände rot · App.vue:1737–1773 | zwei Stufen | e2e Banner-Stufen |
| UI-N24 | Wiederherstellung nur als Text, Refresh ohne Grund · App.vue:1746,1753,1756,1760,1764,1794 | Button oder Text | Sichtprüfung |
| UI-N25 | Banner-Buttons aus fremden Familien · App.vue:1789–1790 | `banner*`, neu `bannerAck` | Katalog-Vitest |
| UI-N26 | Banner-Details nur im `title` · App.vue:1745–1774 | per Tipp in der Liste | e2e |
| UI-N27 | Meldungsliste mit mehreren Öffnungs-/Schließwegen · App.vue:1732,1791,2124,2131; useDialogState.ts:48–67 | ein Helfer | e2e (gelesen-Markierung) |
| UI-N28 | Lesefehler Werkzeugtabelle zweifach gestaltet, Retry-Gates verschieden · ToolStrip.vue:59; ToolTablePanel.vue:629–632; ProbePanel.vue:1158–1173 | `.statusNote` + Klassifikation + `retry` | e2e Lesefehler |
| UI-N29 | Speicherfehler auf drei Wegen, einer mit DISPLAY-Schwere · GcodePanel.vue:767–768; SettingsPanel.vue:514; ToolTablePanel.vue:679 | inline, sonst ERROR | e2e |
| UI-N30 | `role="alert"` und X uneinheitlich · GcodePanel.vue:850,887; ToolTablePanel.vue:657,679,822–828; FileBrowser.vue:80 | `.statusNote` | Audit + e2e |
| UI-N31 | Inline-Discard nicht danger · GcodePanel.vue:893–898 | danger | Sichtprüfung |
| UI-N32 | Hilfe auf drei Wegen, HelpIcons ohne Namen · SettingsPanel.vue:522ff; ProbePanel.vue:839ff; HelpIcon.vue:88; ScrubBar-/Viewer-`title` | Kanalregel | Audit LONG_TITLE; AX-Namen |
| UI-N33 | Hilfetext doppelt im `title` · SetupStrip.vue:198–200,213–221; JogStrip.vue:477–478 | eine Quelle | Audit LONG_TITLE |
| UI-N34 | Probe-Operationen nur im `title` erklärt · ProbePanel.vue:726,748,770,861,1059 | sichtbare Beschreibungszeile | e2e Touch |

### D2 — Dialoge (siehe Anhang B)

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N40 | Werkzeugwechsel mit Confirm links, Abort rechts · App.vue:2161–2165 | Abort links, Confirm rechts | Dialog-Scan + Live-Prüfung |
| UI-N41 | Formulare schließen per Hintergrund · Anhang B #6, #12, #13, #17 | `form` ignoriert Hintergrund | Dialog-Scan |
| UI-N42 | Destruktiv als `reset` bzw. `fileSave` · #12, #14, #17, #18 | danger + bisheriges Gate | Katalog-Vitest |
| UI-N43 | Titel in zwei Grammatiken · Anhang B | Frage vs. Nomen | Sichtprüfung |
| UI-N44 | „Confirm“ ohne Verb, danger-Farbe falsch verteilt, „cannot be undone“ lückenhaft · #8, #12, #14, #18 | Verb, Farbregel | Sichtprüfung |
| UI-N45 | Formulare im kleinen zentrierten Dialog · #6, #12, GamepadMapWizard.vue:268–271 | `md` | Dialog-Scan (Stufe) |
| UI-N46 | Scrim nur über dem Seitenpanel · #1, #10–#13 | Teleport | Audit DIALOG_FRAME |
| UI-N47 | Clear All ohne Rückfrage, „×“ als Text · App.vue:2129–2140 | danger + Rückfrage, lucide-X | e2e |
| UI-N48 | Verschachtelte Bestätigungen nur teilweise teleportiert · GamepadTab.vue:152 vs SettingsPanel.vue:883,894 | DialogFrame | Dialog-Scan |
| UI-N49 | „Cancel“ statt „Keep editing“ · GcodePanel.vue:966 | „Keep editing“ | Sichtprüfung |

### D3 — Reiter

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N50 | Off/FWD/REV als Reiter, andere Reihenfolge · GcodePanel.vue:1049–1054 | Optionsgruppe Rev / Stop / Fwd | e2e |
| UI-N51 | HAL Pins/Signals/Params als Inline-Buttons · HalshowTab.vue | Unterreiter | e2e Tab-Semantik |

### D4 — Formulare und Listen

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N60 | Vier Label-Größen und -Helligkeiten · style.css:518,596,997; SettingsPanel.vue:739,965,995; GcodePanel.vue:1059 | eine Label-Klasse | `layout.spec` + Sichtprüfung |
| UI-N61 | Label-Breiten verschieden, „Grid“ doppelt belegt · SettingsPanel.vue:596–613,1100; App.vue:2738 | FormField | Sichtprüfung |
| UI-N62 | `.settingDesc` dreifach, `okText` zweifach kopiert · SettingsPanel.vue:1020; KeyboardTab.vue:266; GamepadTab.vue:240,250,413–418; App.vue:2718 | global | Audit |
| UI-N63 | Drei gleiche Zwei-Spalten-Raster, eines mit anderem Abstand · SettingsPanel.vue:972,978,987; ToolsetterSettings.vue:231 | `.formGrid` | Sichtprüfung |
| UI-N64 | `.sliderRow` ohne CSS, eigene Slider-Klassen · GamepadTab.vue:184; SettingsPanel.vue:1008–1018 | Slider-Zeile mit `.sliderVal` | Sichtprüfung |
| UI-N65 | Zurücksetzen an verschiedenen Orten mit verschiedenen Gates · SettingsPanel.vue:898; ToolsetterSettings.vue:222; ProbePanel.vue:1335 | ein Platz, bisheriges Gate | e2e |
| UI-N66 | Inline-Warnung mit `.dialogBody` · SettingsPanel.vue:723 | `.statusNote` | Sichtprüfung |
| UI-N67 | Zeilenaktionen uneinheitlich · SettingsPanel.vue:799–800; ToolTablePanel.vue:928–936; KeyboardTab.vue:170 | `listAction` Stift/`Trash2` | Sichtprüfung |
| UI-N68 | Spaltenreihenfolge der Belegungstabellen gegenläufig · KeyboardTab.vue:163 vs GamepadTab.vue:196 | Aktion \| Belegung | Sichtprüfung |
| UI-N69 | Aktionsaufteilung und Schalternamen verschieden · defaults.ts:509–512,670; KeyboardTab.vue:151; GamepadTab.vue:135 | gemeinsame Liste | Vitest Defaults |
| UI-N70 | Gamepad-Invert hart auf X/Y/Z · GamepadTab.vue:174–176 | `useAxes` | Vitest/e2e |
| UI-N71 | Hinzufügen-Buttons verschieden groß; „Remove Profile“ nutzt den Dialog-Typ `dialogDanger` außerhalb eines Dialogs · SettingsPanel.vue:836; GamepadTab.vue:151 | gleiche Größe; eigener danger-Typ mit unverändertem Gate `always` | Katalog-Vitest |

### D5 — Bereichsmuster

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N80 | Abort je Tab an anderer Stelle · GcodePanel.vue:822; App.vue:1914 (MDI), 1955 (Tools); ProbePanel.vue:710 | ganz rechts der Aktionsgruppe | `layout.spec` Position |
| UI-N81 | Kopfbereiche verschieden · GcodePanel.vue:778–804; OffsetPanel.vue:115–130; ToolTablePanel.vue:605 + App.vue:1940ff; MDI ohne Kopf | `.panelHead` | Sichtprüfung |
| UI-N82 | Umschalter „Browse“ / „Hide Files“ · GcodePanel.vue:792; ToolTablePanel.vue:609; App.vue:1960 | eindeutiger „Files“-Umschalter | e2e |
| UI-N83 | Zehn lokale Kopien von `.emptyState` · SettingsPanel.vue:908,1045; HalshowTab.vue:265; FileBrowser.vue:143; CameraPip.vue:293; App.vue:2784,2827; GcodeReferenceDialog.vue:162; GcodePanel.vue:1243 | Varianten | Audit EMPTYSTATE_COPY |
| UI-N84 | „No tools loaded“ auch ohne Suchtreffer · ToolTablePanel.vue:940 | `noMatch` | e2e |
| UI-N85 | „+ Add“ mit Pluszeichen im Text statt Icon · ToolTablePanel.vue:607; App.vue:1958 | Icon + Text | Sichtprüfung |

### D6 — Leisten und Makros

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N90 | Reset-Buttons verschieden beschriftet · JogStrip.vue:414,420 vs OverridesStrip.vue:42–54 | Zielwert sichtbar, „Reset X to Y“ | Sichtprüfung |
| UI-N91 | Titel dimmen je nach Gate-Ebene; 280-px-Regel kopiert · OverridesStrip.vue:35; SpindleStrip.vue:37; ToolStrip.vue:50–51,70–77; SafetyStrip.vue:165–172 | Titel außerhalb des Gates, Modifier-Klasse | Sichtprüfung |
| UI-N92 | `.label` vs `.label-muted` vs `.md`, Doppelpunkte · style.css:905,922; ProbePanel.vue:1308–1322; GcodePanel.vue:801; SafetyStrip.vue:142; ToolStrip.vue:62 | eine Klasse | Sichtprüfung |
| UI-N93 | `.sectionHelp` doppelt und verschieden · SetupStrip.vue:281–282; JogStrip.vue:497ff | global | Hilfe-Geometrie-e2e |
| UI-N94 | Plane-Radio mit Wertklasse · JogStrip.vue:479 | nur Farbmodifikatoren | Sichtprüfung |
| UI-N95 | Makro startet mit Einzeltipp, Enter im Parameterdialog führt aus, `fire`-Gate ≠ Button-Gate · machineControls.ts:124; useMacros.ts:53,71; App.vue:2181,2240 | WP-D6 „Makros“ | e2e Makro-Hold |

### D9 — Viewer-Overlays

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N100 | CameraPip mit eigener Rahmung und Text-Glyphen · CameraPip.vue:218–221,259 | `.overlay-card`, lucide | Sichtprüfung |
| UI-N101 | Text-Glyphen, Icon-Buttons ohne Namen · ScrubBar.vue:984–993; HalshowTab.vue:160; ThreeViewer.vue:3946–3953 | lucide, `aria-label` | AX-Scan |
| UI-N102 | Drei Warnstile, Kleinschreibung · ThreeViewer.vue:3910–3935,4018; ScrubBar.vue:1030–1047 | ein Chip, Satzform | Sichtprüfung |

### D10 — Aufräumen

| ID | Befund · Fundstelle | Regel | Abnahme |
|---|---|---|---|
| UI-N110 | Tote CSS-Regeln · SettingsPanel.vue:944 (`.wpColumns`), :1050 (`.macroSettingsList {}`) | entfernen | Audit |
| UI-N111 | `--opacity-disabled` für Lade- und Hinweistext · SettingsPanel.vue:910,932,1046; HalshowTab.vue:267,319,369; CameraPip.vue:299; GcodePanel.vue:1240 | D8-Rolle | Kontrast-Scan |
| UI-N112 | Einzeiler-Kopien · `.muted` DebugTab.vue:120; `.okText` ×2; `.errorText` ToolsetterSettings.vue:236 = `.kbCaptureError` KeyboardTab.vue:257; `.mutedText`, `.auxLabel`, `.kbAlways`, `.halCount`, `.compValue`, `.importExists` | globale Utilities | Audit |
| UI-N113 | Hart codierte Paddings und Letter-Spacing · App.vue (`.pill`, `.statusBanner`); ProbePanel.vue; HalshowTab.vue; GamepadLiveInput.vue; TabPanel.vue | Tokens | Audit |
| UI-N114 | Tönungen freihändig · 85/70/50/80/92 %; fg 4 vs 5 %; border 30 % ×2 | benannte Tönungs-Tokens | Audit |
| UI-N115 | 46 hart codierte Pixelbreiten (HalshowTab.vue 7; je 5 in SettingsPanel, ToolTablePanel, ProbePanel, GcodePanel, GcodeReferenceDialog, App) | prüfen, wo nötig Token | Audit-Bericht |

Die K-IDs (UI-K01–K18) bleiben im Konsistenz-Review die Quelle. Ihre Paketzuordnung:
- K01, K02 → D7
- K03, K04, K10 → D4
- K05, K06, K07 → D5
- K08, K09 → D8
- K11, K16(3) → D2
- K12, K17 → D3
- K13 → D6 / D8
- K14 → D10
- K18 → D1

## Anhang B — Dialoginventar (22 Overlays, Stand `0019da5`)

Art: i = info, c = confirm, f = form, h = host, fl = flow, r = running (Übergang).
**Heute** beschreibt X / Cancel / Hintergrund. **Ziel-Hg** ist das Hintergrund-Verhalten nach
DialogFrame.

| # | Dialog · Fundstelle | Art | Heute X / Cancel / Hg | Wache heute | Ziel-Hg | Initialfokus | Rückkehr | Kind |
|---|---|---|---|---|---|---|---|---|
| 1 | Program Stats · App.vue:1986 | i | X / – / schließt | – | schließt | X | Stats-Button | – |
| 2 | Settings · App.vue:2081 | h | X / – / schließt über Wache | `guardSettingsClose` (Makro-Entwurf, Assistent) | Wache | aktiver Unterreiter | Settings-Button im Kopf | 3, 19, 20, 21, 22 |
| 3 | Settings „Discard changes?“ · App.vue:2109 | c | – / Keep editing / schließt | – | schließt (= Keep editing) | Keep editing | Fokus in Settings bzw. Ziel der Navigation | – |
| 4 | Messages · App.vue:2124 | i | X (markiert gelesen) / – / schließt (markiert nicht) | – | schließt, markiert gelesen | X | Auslöser (Kopf oder Banner) | neu: Clear-All-Rückfrage |
| 5 | Werkzeugwechsel · App.vue:2148 | fl | – / Confirm, Abort / nein | Maschinenablauf | nein | Container | Fokus vor dem Öffnen (Panel) | – |
| 6 | Makro-Parameter · App.vue:2170 | f | – / Cancel, Execute / schließt | – | nein | erstes Feld | Makrobutton | – |
| 7 | Shutdown · App.vue:2194 | fl | – / Cancel, Shut Down / nein | – | nein | Cancel | Shutdown-Button | – |
| 8 | Kompensation · App.vue:2205 | fl | – / Cancel, Confirm / nein | – | nein | Cancel | Kompensationsschalter | – |
| 9 | G-code Reference · GcodeReferenceDialog.vue:51 | i | X / – / schließt | – | schließt | Suchfeld | Reference-Button | – |
| 10 | Probe-Reset · ProbePanel.vue:1330 | c | – / Cancel, Reset / schließt | – | schließt | Cancel | Reset-Button | – |
| 11 | G-code „Discard changes?“ · GcodePanel.vue:961 | c | – / Cancel, Discard / schließt | – | schließt (= Keep editing) | Keep editing | Editor | – |
| 12 | Upload-Konflikt · GcodePanel.vue:973 | f | – / Cancel, Rename, Replace / schließt | – | nein | Namensfeld | Upload-Button | – |
| 13 | Run from line · GcodePanel.vue:992 | f | X / Cancel, Run… / schließt | – | nein | erste Option | RFL-Auslöser | – |
| 14 | Werkzeug löschen · ToolTablePanel.vue:651 | c → r | – / Cancel, Delete / schließt außer beim Löschen | `cancelDelete` (laufend) | schließt, gesperrt während r | Cancel | Löschen-Button bzw. Tabelle, falls die Zeile weg ist | – |
| 15 | Werkzeugeditor · ToolTablePanel.vue:671 | f → r | X, Cancel (Dirty-Prüfung) / nein | Dirty + `saving` | nein | erstes Feld | Add- bzw. Edit-Button | 16 |
| 16 | Editor „Discard changes?“ · ToolTablePanel.vue:784 | c | – / Keep editing, Discard / schließt | – | schließt (= Keep editing) | Keep editing | Editorfeld | – |
| 17 | Import-Vorschau · ToolTablePanel.vue:798 | f → r | X / Cancel, Preview again, Replace… / schließt (gesperrt bei `importBusy`) | `importBusy` | nein | erste Option | Dateizeile bzw. Upload | 18 |
| 18 | Tabelle ersetzen · ToolTablePanel.vue:872 | c | – / Cancel, Replace table / schließt | – | schließt | Cancel | Import-Vorschau | – |
| 19 | Gamepad-Profil entfernen · GamepadTab.vue:153 | c | – / Cancel, Remove / schließt | – | schließt | Cancel | Remove-Profile-Button | – |
| 20 | Makro löschen · SettingsPanel.vue:883 | c | – / Cancel, Delete / schließt | – | schließt | Cancel | Löschen-Button | – |
| 21 | Settings zurücksetzen · SettingsPanel.vue:894 | c | – / Cancel, Reset / schließt | – | schließt | Cancel | Reset-Button | – |
| 22 | Gamepad-Zuordnungsassistent · GamepadMapWizard.vue:238 | f (live) | – / Cancel, Restart, Skip/Save / nein | `unsavedDraft` (Settings) | nein | Container | „Map Buttons…“ | – |
