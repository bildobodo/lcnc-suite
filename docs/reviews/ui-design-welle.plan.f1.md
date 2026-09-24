# WebUI Design-Welle — eine Bedienführung, gleiche Muster überall

**23. September 2026 · neuer Branch `feat/ui-design-wave` aus `development` (`0019da5`), Merge zurück
nach `development`, nie `main`.** Keine Grundüberarbeitung: Viewer links, Seitenpanel mit Tabs rechts,
Leiste unten, Kopfzeile und Makroleiste bleiben. Ziel: gleiche Dinge sehen gleich aus, stehen am
gleichen Platz und verhalten sich gleich.

## Kontext

- **Quellen:** Codex' Konsistenz-Review UI-K01–K17 (Befund, Vorschlag, Abnahme je ID,
  `docs/reviews/ui-optimierungen.consistency-review.md`, Entwurf `…design-proposal.html`), die
  Operator-Beobachtung **UI-K18** aus der Live-Sichtprüfung (drei Rückmeldewege) und ein neues Audit
  (drei Durchgänge: Hauptpanels, Leisten/Kopf/Dialoge, Settings/Viewer/Begriffe) mit rund 60
  zusätzlichen Befunden, hier als **UI-N01…** geführt.
- **Operator-Entscheidungen 23.09.:**
  1. **Probing-Unterreiter** als festes 4×2-Raster in Reiter-Optik. Alle acht bleiben sichtbar, die
     Plätze wandern nicht. Keine Auswahlliste.
  2. **Sperrgrund** erscheint als Blase am Control und wird zusätzlich still in der Meldungsliste
     protokolliert.
  3. **Makros** lösen wie jeder andere Bewegungsbutton per Halten aus.
  4. **Eingabehilfen:** X immer oben rechts, bei beiden Tastaturen und in beiden Ausrichtungen. Die
     Code-Seite bekommt einen räumlichen Ziffernblock.
- **Leitprinzip je Paket:** zuerst die Regel bzw. den Baustein festlegen (global in `style.css`, einer
  Komponente oder einem reinen Modul), dann alle Vorkommen migrieren, dann einen Wächter einbauen
  (Audit-Kategorie, e2e-Scan oder Unit-Test), damit die Regel hält.
- **Unverändert:**
  - Escape = E-Stop.
  - Gates und Hold-Verträge aus dem Maschinenkatalog.
  - Fokusrückgabe, Entwurfsschutz, Modal-Registry.
  - `fire()`-Latch, Jog-Keyup- und Stop-Regeln.
  - Das 264-px-Budget der Leiste.

## Arbeitspakete (Reihenfolge = Commit-Reihenfolge, je Paket ein Commit mit Gates)

### WP-D0 — Begriffe, Einheiten, Platzhalter (Fundament, geringes Risiko)

**Glossar** (neu: `docs/ui-glossary.md`, in CLAUDE.md verlinkt):
- Tools / Tool table / Tool library.
- Program (nie „file“ im Programm-Kontext): „No program loaded“ statt „No file loaded“.
- Work offset (G54…) für den Begriff, WCS nur als Kurzform.
- Collision statt „clash“ (ScrubBar).
- Soft limit.
- Rapid, nie „Fast Feed“ für Eilgang; die Probe-Parameter heißen „Probe feed“.
- Gleiche Namen in Probing und Toolsetter (Fast/Traverse feed, Max Z travel), keine Abkürzungen wie
  „Dist“ oder „Pre-Pos“.
- „None“ für unbelegte Tasten; das tote `ACTION_LABELS` entfällt (N11, N24, N25).

**Schreibweise** (N16, N25, C4):
- Title Case für Buttons, Reiter, Abschnitts- und Dialogtitel von Arbeitsdialogen.
- Bestätigungsfragen als Satz mit Objekt, z. B. „Delete macro "X"?“.
- Hilfe und Beschreibungen in Satzform.
- Statuswörter in Statuszeilen in Großbuchstaben.
- Immer „…“, nie „...“ (N23).

**Formate** (`format.ts`, N26/N27/A2/A4):
- Neues `fmtPct` mit „120 %“.
- Eine Konstante `NO_VALUE = "—"` für jede fehlende Anzeige.
- Einheiten immer aus `linearUnit`: ScrubBar-Distanz, Kompensationsdialog, Jog-Geschwindigkeit in
  mm/min bzw. °/min, Jog-Schritte, ToolStrip-Ø/Z, Probe-/Toolsetter-Felder.
- `ms` mit Leerzeichen.
- Handgeschriebene `toFixed`/`Math.round(…)+"%"` in Templates ersetzen.

**Zustandswörter** (A3): ESTOP / CLEAR, ON / OFF, HOMED / NOT HOMED statt TRUE/FALSE.

**Wächter:**
- `audit-scoped-css.py` bekommt die Template-Kategorie `ELLIPSIS` („...“ im sichtbaren Text) und
  `UNIT_LITERAL` („mm“ als Literal neben einer Zahl in Templates, mit Allowlist).
- Vitest für `fmtPct` und `NO_VALUE`.

### WP-D1 — Rückmeldekanäle (UI-K18 + Banner + Inline-Meldungen)

**Kanalregel** (Doku + CLAUDE.md):
- **Am Control** erscheint alles, was eine Berührung auslöst: Hold abgebrochen, Busy, Sperrgrund.
- **Inline im Panel** stehen Fehler, Warnungen und Ergebnisse eines Vorgangs dort, wo er begann.
- **Banner** ist nur für Maschinen- und Systemzustand da.
- **Meldungsliste** ist das Protokoll von allem.

**Sperrgrund** (Operator-Entscheidung 2):
- `gateExplain.explain()` (`lcnc-webui/src/gateExplain.ts`) ruft `showBtnHint(anchor, reason)` auf
  und protokolliert den Grund mit einem neuen „quiet“-Flag in `pushMessage`, das die Statuszeile
  nicht übernimmt.
- `btnHint.ts`: Anzeigedauer skaliert mit der Textlänge (mindestens 1,5 s, etwa 60 ms pro Zeichen,
  höchstens 6 s); die Blase bricht um.
- Der Tap-Anker für Input-Roots ist das Feld selbst.
- SetupStrip-WCS-Radios laufen über `useGateExplain` (A7).

**Banner:**
- Die Statuszeile übernehmen nur noch Fehlermeldungen (B5).
- Zwei Stufen: rot für Sicherheit, Maschine und Verbindung, warn für Programm, Vorschau und
  Konfiguration (B1).
- Jede Bannerzeile hat einen Wiederherstellungs-Button oder sagt im Text, was zu tun ist; kein Button
  ohne Grundzeile (B2).
- Wesentliche Details nie nur im `title`: ein Tipp aufs Banner öffnet die Meldungsliste am passenden
  Eintrag (B4).
- Die Buttons stammen aus einer `banner*`-Familie, neu ist `bannerAck` (B3).
- `openMessages()`/`closeMessages()` sind der einzige Weg; jeder Schließweg markiert als gelesen
  (B6).

**Inline-Meldungen** (D1–D4):
- Ein Muster `.statusNote` (error/warn/ok) mit `role="alert"` bei error/warn, optionaler Aktion und
  X bei dauerhaften Meldungen. Es ersetzt `.errorBanner`, `.warnBanner`, `.noteWarn`, `.importBanner`
  und `importWarn`.
- Ein Lesefehler zeigt immer die Inline-Meldung mit einem ungegateten „Retry“ (neuer Typ `retry`).
- Ein fehlgeschlagenes Speichern steht inline, sonst `OPERATOR_ERROR`, nie DISPLAY-Schwere.
- „Discard“ ist überall danger-gestylt.

**Hilfe-Kanäle** (D5, A6, N3):
- Abschnittsbeschreibung inline (`.settingDesc` wird global).
- Feldhilfe über `HelpIcon` mit `label` (Probe/Toolsetter-HelpIcons bekommen ihren Parameternamen).
- `title` nur als Kurzname oder Hover-Ergänzung; keine Doppeltexte neben einem HelpIcon.
- Wesentliche ScrubBar- und Viewer-Erklärungen werden sichtbar oder bekommen ein HelpIcon.

**Wächter:**
- e2e „gesperrter Button antippen“: Blase am Control, Eintrag in der Liste, Statuszeile unverändert.
- e2e Banner-Stufen.
- Audit-Kategorie `LONG_TITLE` (title über 80 Zeichen an einem Control, Allowlist für Hover-Ergänzung
  neben HelpIcon).

### WP-D2 — Dialogvertrag (UI-K11, K16(3), Dialogtabelle C1–C8)

**Neuer Baustein `DialogFrame.vue`:**
- Stufen `confirm` (sm) / `md` / `lg` und Art `info | confirm | form | running`.
- Titel mit `role="dialog"` und `aria-labelledby`.
- Optionales X (Muster aus UX-05) und `#actions`-Slot.
- Registriert sich selbst mit `registerModal`.
- Teleportiert immer nach `#content-dialog-area` (C7).
- Setzt beim Öffnen den Fokus auf das erste Feld bzw. die sichere Aktion und gibt ihn beim Schließen
  bewacht zurück (`returnFocusTo`-Muster).
- **Fokusbereich:** Tab bleibt im Dialog und in den ausdrücklich erlaubten Bereichen, nämlich der
  Safety-Leiste und der Eingabehilfe des Dialogs. Kein pauschales `inert`, kein `aria-modal`, solange
  die Safety-Leiste bedienbar ist (K11).
- **Hintergrund:**
  - `info` und `confirm` schließen per Hintergrundklick.
  - `form` schließt nie per Hintergrund (C2: Makro-Parameter, Upload-Umbenennen, Run-from-line).
  - `running` sperrt das Schließen bis zur Antwort.

**Regeln:**
- Abbrechen links, Vorwärts-Aktion rechts, auch beim Werkzeugwechsel: Abort links, Confirm rechts
  (C1). Das verändert eine eingeübte Handbewegung und wird in der Abnahme ausdrücklich geprüft.
- Destruktiv immer `dialogDanger` bzw. `dialogReadyDanger` mit Gate (C3); „Replace table“ nicht auf
  primary.
- Der Bestätigungsbutton wiederholt das Verb, z. B. „Enable compensation“ statt „Confirm“.
- Danger-Farbe nur für Unumkehrbares oder Bewegungen; „This cannot be undone“ bei allen
  unumkehrbaren Aktionen (C5).
- Das kleine `.dialog` ist nur für Ja/Nein da; Formulare kommen auf `md` (C6: Makro-Parameter,
  Upload-Konflikt, Gamepad-Assistent).
- Meldungsliste: „Clear All“ danger-gestylt mit Rückfrage, lucide-X statt „×“ (C8).

**Migration:** alle 22 Dialoge (Tabelle im Audit).

**Wächter:** Die Registry-Selbstprüfung in `keyboard-guards.spec.ts` wird zum Dialog-Scan. Jeder
offene Dialog hat Rolle und Namen und den Fokus innerhalb, Tab/Shift+Tab verlässt die erlaubten
Bereiche nicht, und Escape löst weiterhin nur `estop` aus.

### WP-D3 — Reiter und Fokusanzeige (UI-K17, K12)

**Neuer Baustein `TabNav.vue`** mit den Darstellungen `main` und `sub`:
- `tablist`/`tab`/`tabpanel` mit `aria-selected`, ein Tab-Stopp, manuelle Aktivierung.
- Pfeiltasten und Home/End bewegen den Fokus lokal (propagation gestoppt, damit sie nie als Jog oder
  Shortcut ankommen); Enter/Leertaste wählen. Keyup- und Jog-Stop-Guards bleiben.
- **Hauptreiter** Program/MDI/Probing/Offsets/Tools: oben gerundet und mit dem Inhalt verbunden.
- **Unterreiter:** Unterstrich statt Buttonrahmen.
- Keine Maschinenaktion durch einen Tabwechsel.

**Migration:**
- `TabPanel.vue` wird intern zu TabNav.
- **Probing** als festes 4×2-Raster (Operator-Entscheidung 1; Raster ohne Umbruchwandern).
- **Settings-Unterreiter** über TabNav.
- **HAL** Pins/Signals/Params werden Unterreiter.
- **Off/FWD/REV** im Run-from-line-Dialog wird eine Optionsgruppe (Radio-Muster). Reihenfolge und
  Schreibweise wie in der Spindelleiste: Rev / Stop / Fwd (K17, A10).

**Fokusanzeige:**
- Ein globaler `:focus-visible`-Ring für Buttons, Inputs, Slider, Farbwähler und Tabellenaktionen
  (`style.css:341` nimmt ihn Slidern heute weg).
- Auswahl und Fokus getrennt markiert; Auswahl nicht nur über Farbe.

**Wächter:** e2e Tab-Semantik. Pfeiltasten wechseln den Fokus ohne Jog-Befehl, ein laufender Jog
wird beim Tabwechsel per Keyup gestoppt, verborgene Panels sind nicht fokussierbar.

### WP-D4 — Kontrollen und Formulare (UI-K03, K04, K10 + Settings/Listen-Befunde)

**Kontrollhöhen:**
- Token `--control-h` (32 px Desktop / 44 px Touch) und `--control-h-compact` (28/36 px) für Input,
  Select und benachbarte Buttons.
- `INPUT_SIZE_STYLES` (`machineControls.ts:270`) auf diese Achsen begradigen.
- Kein Größenwechsel je Tab (K03).

**`FormField.vue` + `.formGrid`** (liegen außerhalb der Single-Root-Controls):
- Label mit `for`/`id`, Einheit, Hilfe (HelpIcon) und Fehler über `aria-describedby`.
- **Label über dem Feld.**
- Zwei gleich breite Spalten ab ausreichender Breite, sonst eine.
- Zahlen rechtsbündig, Einheit immer sichtbar.
- Eine Label-Klasse und ein Label-Größensatz statt vier (N1, N2).

**Migration:**
- Werkzeugeditor (K04): die 100-px-Grenze entfällt, Vorschau rechts bzw. einklappbar, Kopf und Fuß
  fest.
- Settings-Tabs: Kamera-Overlay; eine Zwei-Spalten-Klasse statt `.layerGrid`/`.colorGrid`/
  `.toggleGrid`; Slider-Zeile mit `.sliderVal` (das undefinierte `.sliderRow` wird repariert).
- Toolsetter, Probe-Parameter, Makro-Editor, Makro-Parameter, Upload-Umbenennen.
- Run-from-line-Warnung als `.statusNote` statt `.dialogBody` (N8).

**Zurücksetzen** (N7): ein Platz (unten rechts im Abschnitt), ein Gate (`setup`) und eine Rückfrage
für „Restore defaults“ in Settings, Toolsetter und Kalibrierung.

**Listen-Editoren** (N10–N15):
- Zeilenaktionen einheitlich: Bearbeiten = Stift, Löschen = `Trash2`, beide `listAction`.
- Rückfrage nur bei schwer Wiederherstellbarem (Makro, Werkzeug ja; Tastenbelegung nein).
- Belegungstabellen in der Reihenfolge Aktion | Belegung.
- Gamepad-Invert aus `useAxes`.
- Gleiche Größe für Hinzufügen-Buttons.
- „Remove Profile“ mit gegatetem Typ.
- Tastatur und Gamepad teilen dieselbe Aktionsliste (Cycle Start / Pause / Resume).

**Wächter:** Der Feldvertrag-Scan (`input-session.spec.ts`) prüft jedes sichtbare Input, jeden Select
und jeden Slider auf einen Namen im Accessibility-Tree und ein verknüpftes Label (K10).
`layout.spec` misst Kontrollhöhen je Dichte.

### WP-D5 — Bereichsmuster der Tabs (UI-K05, K06, K07 + Panel-Befunde)

**Panelaufbau** (globale Klassen `.panelHead` und `.actionGroup`, keine neue Tokenskala):

1. Objekt-/Statuszeile (Programm, Werkzeug in der Spindel, aktives Bezugssystem).
2. Maschinenaktionen, **Abort immer ganz rechts** dieser Gruppe.
3. Verwaltung.
4. Suche/Filter.
5. Inhalt (nur er scrollt).
6. Inline-Rückmeldung.

**Migration je Tab:**
- **Program:** Dateizeile ohne „File:“, Dateiaktionen, Laufgruppe.
- **Tools:** „Werkzeug in der Spindel · T…“ (Measure/Unload/Abort), Verwaltung (Add/Browse/Upload),
  Suche mit Typfilter.
- **MDI:** Eingabezeile (Send, Abort) und Verlauf.
- **Offsets:** Titel und Aktionen.
- **Probing:** Raster, dann die Steuerleiste (Schalter links, Status und Abort rechts).
- „Browse / Hide Files“ wird ein eindeutiger Umschalter „Files“ mit Auswahlzustand.

**Leer-, Lade- und Fehlerzustände** (F-Befund): `.emptyState` mit den Varianten `empty`, `noMatch`,
`loading` und `error` ersetzt zehn lokale Kopien. „No tools loaded“ und „No matching tools“ werden
getrennt.

**Probe-Operationen:** Die Beschreibung steht sichtbar in einer Zeile unter dem Raster für die
fokussierte oder zuletzt berührte Operation (heute nur `title`, am Touchscreen unsichtbar).

**Werkzeugtabelle** (K07):
- T# und Beschreibung zuerst, dann Ø und Z.
- Typfilter in der Suchzeile.
- Pocket und Flutes in der Detailansicht (Editor).
- Aktuelles Werkzeug zusätzlich mit Text oder Zeichen markiert.
- `aria-sort` an den Spaltenköpfen.
- Bearbeiten am festen Zeilenende; kein Zeilenklick, der eine Maschinenaktion auslöst.

**Kopfzeile** (K06):
- Einheitliche Buttonhöhe und Icongröße.
- Shutdown mit Icon und Text nebeneinander (die Beschriftung bleibt, Touch-Erkennungsfix).
- Net/Ping/Clients in eine beschriftete Detailansicht (Popover); Connected und Armed bleiben sichtbar.

### WP-D6 — Leisten und Makroleiste (Strip-Befunde A1–A11, D6, K13-Teil)

- **Zurücksetzen** nach einem Muster: sichtbarer Zielwert („100 %“, Standard-Jog-Speed mit Einheit),
  Name „Reset <X> to <Y>“ (A1).
- **Abschnittstitel** (`.sub`) liegen nie in einem Gate, Gates umschließen nur die Controls.
- **Feste Breite** über eine gemeinsame Modifier-Klasse statt der kopierten 280-px-Regeln
  (ToolStrip/SafetyStrip, A9).
- **Beschriftungen:**
  - `.sub` für Titel, `.label-muted` in einer Größe für Feldlabel.
  - `.label` geht in `.label-muted` auf, Statuszeilen ohne Doppelpunkt (A11).
  - Das Plane-Radio nur mit Farbmodifikatoren (A8).
- **`.sectionHelp`** wird eine globale Utility mit einer dokumentierten Position (A5). Der
  Hochformat-Umbruch aus `776ee69` bleibt erhalten.
- **Makros halten** (Operator-Entscheidung 3):
  - `machineControls.ts` Typ `macro` bekommt `hold`.
  - Das Gate passt zur Ausführung (`ready` statt `probe`, D6).
  - Makros mit Parametern öffnen weiterhin ihren Dialog per Tipp; das Ausführen im Dialog bleibt ein
    Klick.
- **Trefferflächen** (K13): 44/36-px-Regel prüfen. Das HelpIcon bekommt eine unsichtbar vergrößerte
  Trefferfläche von mindestens 24 × 24 px, ohne Nachbarn zu überlappen.

### WP-D7 — Eingabehilfen (UI-K01, K02; Operator-Entscheidung 4)

**X immer oben rechts**, bei Zahlenfeld und Texttastatur, in Quer- und Hochformat:
- 44 × 44 px wie die Tasten, im vorhandenen Aktionsraster reserviert (keine zusätzliche Kopfzeile).
- Verhalten wie UX-01: Eingabe behalten, bewachte Fokusrückgabe.

**Code-Seite** (`textKeyboardPages.ts`):
- Räumliche Gruppen: Ziffernblock 7-8-9 / 4-5-6 / 1-2-3, Befehls-/Achsblock, Satzzeichen.
- Innere Reihenfolge in beiden Ausrichtungen gleich.
- ABC bleibt ausdrücklich alphabetisch in Leserichtung.

**Wächter:**
- Der Unit-Test hält die vollständige ASCII- und Umlaut-Abdeckung.
- Neuer e2e: X-Position relativ zur Hilfe in allen vier Kombinationen gleich.
- `layout.spec` im 264-px-Budget.
- Keine kleineren Tasten, 150 % im Hochformat verdeckt das Besitzerfeld nicht.

### WP-D8 — Farben, Kontrast, Themes (UI-K08, K09, K13-Teil)

**Textrollen als feste Farben statt Opazität** (`--fg-secondary`, `--fg-warn-text`), abgeleitet je
Theme. `--focus-ring` getrennt von `--info`.

**Syntaxpalette je Theme** (hell dunkler, dunkel heller). Die HC-Themes decken Syntax, Viewer und
Fokus ab.

**Viewer-Palette aus Rollen je Theme:**
- Ausgangspalette aus K08: Begrenzung, Vorschub, Eilgang gestrichelt, gefahrener Pfad, Auswahl,
  Kollision.
- Die gelbe Limit-Markierung bekommt im hellen Theme eine kontrastfähige Rolle.
- Settings unterscheiden „Automatic“ (folgt dem Theme) und „Custom“. Die Migration behält explizit
  gesetzte Benutzerfarben (`defaults.ts` Viewer-Sektion, `ThreeViewer.vue:3382`).
- Kleine Legende der Pfadarten im HUD-Layer-Menü.

**Bewegung und Kontrastmodi:**
- `prefers-reduced-motion` schaltet nicht wesentliche Animationen ab (Puls). Der Sicherheitszustand
  bleibt zusätzlich als Text sichtbar.
- `forced-colors` hält Fokus, Auswahl und Warnungen sichtbar.

**Wächter:** Ein Vitest liest die Theme-Tokens aus `style.css` und prüft die Kontraste je Theme: Text
mindestens 4,5:1, informative Grafik und Konturen mindestens 3:1.

### WP-D9 — Viewer-Overlays (N19–N22)

- **CameraPip** auf `.overlay-card`.
- **lucide-Icons** statt der Text-Glyphen ◀ ▶ □ − ▼ ▶ (ScrubBar, PIP, HAL-Baum).
- Die Icon-Buttons im Quick-Grid bekommen `aria-label`.
- **Warnungen:** ein Chip-Stil, Satzform, keine Entwickler-Wörter wie „(see console)“.
- **Begriffe** aus dem Glossar (Collision, Soft limit), Einheiten aus WP-D0.

### WP-D10 — Aufräumen und Wächter (UI-K14 + CSS-Schulden)

**Tote Reste entfernen:** `.wpColumns`, leeres `.macroSettingsList`, `ACTION_LABELS`. Die
Token-Kandidaten aus K14 werden erst nach einer Verwendungsprüfung entfernt.

**Einzeiler-Kopien durch globale Utilities ersetzen:** `.text-muted`, `.text-ok`, `.text-warn`,
`.text-danger`, `.text-error`.

**`--opacity-disabled`** nur noch für wirklich gesperrte Controls; Lade- und Hinweistexte nutzen
`--opacity-muted`.

**Hart codierte Werte durch Tokens ersetzen:** Paddings, Letter-Spacing (App.vue-Pills,
`.statusBanner`, ProbePanel, HalshowTab). Durchscheinende Flächen bekommen benannte Tönungs-Tokens.

**Visuelle Button-Achsen** (K14):
- Primary (Hauptaktion) und ok (positiver Zustand) werden begrifflich getrennt.
- Die Maschinenrollen im Katalog bleiben unangetastet.

**`audit-scoped-css.py` bekommt neue Kategorien:**
- `DIALOG_FRAME`: ein `.dialogOverlay` außerhalb von `DialogFrame.vue`.
- `EMPTYSTATE_COPY`: lokale Klasse mit `text-align:center` + `opacity`.
- Die Kategorien aus WP-D0 und WP-D1.

## Verifikation

**Je Paket:**
- `npm run build`, `npm run lint` (inkl. CSS-Audit), `npx vitest run`.
- Die betroffenen Playwright-Projekte (`serial-guards`, `serial-tools`, `serial-touchoff`,
  `serial-layout`).
- `npm run test:visual`: Referenzbilder erst nach meiner Sichtprüfung der Diffs erneuern; die
  Referenzänderungen stehen im Commit-Text.
- Die Suite darf dafür beendet werden (Operator 23.09.).

**Neue Wächter:**

| Wächter | Paket |
|---|---|
| Dialog-Scan (Rolle, Name, Fokus, Tab-Bereich, Escape = nur E-Stop) | D2 |
| Tab-Semantik ohne Jog-Befehl | D3 |
| Feldnamen-Scan für alle Controls | D4 |
| Sperrgrund-Blase + Protokoll + Statuszeile unverändert | D1 |
| Banner-Stufen | D1 |
| X-Anker in vier Kombinationen | D7 |
| Kontrast-Unit-Test je Theme | D8 |
| Audit-Kategorien ELLIPSIS, UNIT_LITERAL, LONG_TITLE, DIALOG_FRAME, EMPTYSTATE_COPY | D0, D1, D10 |
| `fmtPct`/`NO_VALUE` | D0 |

**Codex-Reviewrunden** nach D0–D2, nach D3–D6 und nach D7–D10.

**Abschluss:**
- `python3 scripts/test_suite.py offline` PASS auf dem letzten Produkt-Commit.
- **Live-Sichtprüfung am XYZAC-Sim** mit Checkliste je Paket: Hell/Dunkel/HC, 100/150 %, Quer- und
  Hochformat.
- Danach Merge nach `development`. Der physische Touchscreen bleibt Bedingung der `main`-Promotion.

## Doku

- **Neuer Plan:** `docs/reviews/ui-design-welle.plan.md` (diese Fassung auf Deutsch, mit
  UI-N-Befundliste und Operator-Entscheidungen).
- **Stellungnahme** in `consistency-review.md` je K-ID mit Paketzuordnung.
- **`CLAUDE.md`:**
  - Kanalregel, Dialogvertrag, TabNav, FormField/`.formGrid`, Panelaufbau, Glossar-Verweis.
  - Neue globale Klassen im Key-Patterns-Block.
- **`docs/decisions.md`:** vier Operator-Entscheidungen und die Dialog-Modalität.
- **`docs/testing.md`:** neue Wächter.

## Risiken

- **Viele Referenzbilder und e2e-Selektoren ändern sich** (Namen, Reihenfolgen). Pro Paket nur die
  zugehörigen Referenzen, jede nach Sichtprüfung.
- **Werkzeugwechsel-Buttons und Tastaturlayouts** verändern eingeübte Handbewegungen. Beides ist
  ausdrücklich entschieden und wird in der Live-Sichtprüfung geprüft.
- **Fokusbereich im Dialog:** Die Safety-Leiste muss erreichbar bleiben; kein pauschales `inert`.
- **Pfeiltasten in Reiterleisten** dürfen nie als Jog ankommen; die Keyup-Stop-Regel bleibt.
- **Viewer-Palette:** Die Migration darf Benutzerfarben nicht überschreiben.
- **264-px-Leistenbudget** bei X-Anker, Ziffernblock und 44-px-Kontrollen; `layout.spec` entscheidet.

## Folge-Liste (eigene Branches)

- Fallback-Welle FA-01–FA-04 + Telemetrie-Kommentare (`feat/ui-fallbacks`, kann vor oder nach dieser
  Welle laufen).
- Tastaturalternative für Hold-Aktionen (K13, eigene Sicherheitsentscheidung).
- Gesamtaufteilung bei 200 % Zoom (K17-Raumprüfung) — das wäre eine Layout-Grundänderung und ist nicht
  Teil dieser Welle.
- Screenreader-Abnahme (NVDA/VoiceOver).
