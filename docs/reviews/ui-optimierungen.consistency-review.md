# WebUI — Layoutkonsistenz, Standards und Barrierefreiheit

**Codex · 22. September 2026 · Produktstand `691e642`, Branch `feat/ui-review-wave`.** Während der Prüfung kamen ausschließlich die Dokumentations-Commits `930352c` und `f608f38` hinzu. Neuer Prüfauftrag des Operators: einheitliche Bedienführung, Formulare, Aktionsgruppen, Buttons/Tokens sowie Kontraste und Barrierefreiheit einschließlich 3D-Viewer.

**Bewertung:** Die Beispiele sind berechtigt. Zentrale Komponenten und Tokens existieren bereits; es fehlen vor allem verbindliche Regeln, wie daraus ganze Bedienbereiche zusammengesetzt werden. Dazu kommen nachgewiesene Kontrast- und Zugänglichkeitslücken. Das gehört fachlich zur UI. Dieser Nachtrag erweitert den bisherigen Auftrag; er ist kein bereits vereinbarter oder umgesetzter Plan und keine Rücknahme der früheren, engeren Nachweise.

**Anschaulicher Vorschlag:** [Interaktiver Layout- und Farbentwurf](ui-optimierungen.design-proposal.html) mit Hell/Dunkel, größeren Bedienelementen, Graustufen und drei beispielhaften Arbeitsbereichen. Ein Diskussionsentwurf ohne Maschinenverbindung; die SVG-Pfade sind keine neue 3D-Implementierung.

**Raumprüfung · 23. September 2026:** Der erste Tab-Entwurf war für das echte Seitenpanel zu großzügig. UI-K17 enthält jetzt Messungen der tatsächlichen Panelbreite/-höhe und eine verdichtete Fassung. Der Entwurf startet mit **522 px nutzbarer Panelbreite** und bietet den Vergleich zur großzügigen Fassung. Bei starkem Zoom braucht zusätzlich die Gesamtaufteilung eine Anpassung; die Tab-Gestaltung allein ist keine vollständige Lösung.

**Aktuelle Navigationsempfehlung · 23. September 2026:** Nach dem Operator-Einwand gegen die Scrollleiste zeigt der Entwurf standardmäßig **fünf sichtbare Haupttabs plus eine beschriftete Verfahrensauswahl**. Der Scrollentwurf bleibt ausdrücklich eine frühere Vergleichsvariante. Alternativen und Abwägung stehen am Ende von UI-K17; kein Produktumbau und noch kein vereinbartes Umsetzungspaket.

## Nachweise und Prüfgrenzen

- Frischer Produktionsbuild erfolgreich. Lokaler, isolierter Mock-Gateway auf Port 4186; keine LinuxCNC-Kommandos und keine Produktänderungen durch diesen Review.
- **21 UI-Aufnahmen:** Program, MDI, Texttastatur, Tools, Werkzeugeditor, Numpad und Settings bei **1600 × 1000 Desktop**, **1280 × 800 Touch** und **900 × 1200 Touch**, jeweils 100 %. Touch-Klasse ausdrücklich gesetzt; der erste physische Touch ist damit nicht geprüft.
- Zusätzlich vier Viewer-Themes, Syntaxdarstellung, Chromium-Accessibility-Tree und Fokusproben. Viewer-Fixture ohne STL-Modell; sie enthält eine sichtbare Preview-Versionswarnung. Die Bilder belegen Farben und Rahmen, keine Maschinengeometrie-/Kollisionsabnahme.
- [Messwerte und AX-Nachweise](ui-optimierungen.consistency.evidence.json), [Inventar und Kontrastrechnung](ui-optimierungen.design-inventory.json). Reproduktion: [Layoutprobe](ui-optimierungen.consistency.probe.mjs), [Accessibility-Probe](ui-optimierungen.accessibility.probe.mjs), [Inventarskript](ui-optimierungen.design-inventory.py). Vollständige lokale Aufnahmen unter `runlogs/ui-consistency-20260922/`.
- Keine vollständige Testsuite, keine erneute Abnahme des Beacon-Fixes, keine Screenreader-Abnahme mit NVDA/VoiceOver, kein Nachweis für alle Browser, 150/200 % oder physische Touchscreens. Der HTML-Entwurf wurde auf Theme-Wechsel, Tabs per Tastatur, große Kontrollen und eine 600-px-Ansicht ohne Seitenüberlauf geprüft.

## Konkrete Befunde und Änderungen

### UI-K01 — Schließen hat keinen festen Platz

[NumberKeypadStrip.vue:298](../../lcnc-webui/src/NumberKeypadStrip.vue#L298) platziert X im Querformat oben rechts und im Hochformat unten links. [TextKeypadStrip.vue:95](../../lcnc-webui/src/TextKeypadStrip.vue#L95) platziert X im Querformat unten rechts, im Hochformat oben rechts. Die gemessene Taste ist außerdem beim Numpad im Querformat **70 × 44**, bei der Texttastatur **44 × 44 px**. Gleiches Symbol und gleiche Bedeutung reichen damit nicht für dieselbe Bedienführung.

**Vorschlag:** Eine gemeinsame Hülle für Eingabehilfen mit einem festen Schließanker **oben rechts**, identischem Trefferbereich und identischer Semantik: X verbirgt die Hilfe und behält die Eingabe; Verwerfen und Anwenden bleiben eigene Aktionen. Seitenwahl gehört zur Tastatur, Schließen zur Hülle. Der Schließplatz darf bei Rotation nicht wechseln. Er soll im vorhandenen Aktionsraster reserviert werden; eine zusätzliche 44-px-Kopfzeile ohne Neuberechnung des knappen Strip-Budgets wäre kein fertiger Fix.

**Abnahme:** Gleicher relativer Schließanker bei beiden Hilfen in beiden Ausrichtungen; Größe mindestens der normalen Tasten; Verhalten und bewachte Fokusrückgabe bleiben erhalten. Kein Verdecken der Besitzer-Eingabe bei 150 %.

### UI-K02 — Tasten sind vollständig, aber räumlich schwer wiederzuerkennen

[TextKeypadStrip.vue:120](../../lcnc-webui/src/TextKeypadStrip.vue#L120) ordnet dieselbe flache Tastenliste im Querformat spaltenweise, im Hochformat zeilenweise an. Die Code-Seite beginnt im Querformat sichtbar mit **`7 6 . F I Q`**, dann **`8 1 - S J ;`**. Die Daten heißen „numpad order“, bilden jedoch keinen räumlichen Numpad-Block. [Aufnahme](ui-optimierungen.consistency-touch-landscape-keyboard.png), [Daten](../../lcnc-webui/src/textKeyboardPages.ts#L16).

**Vorschlag:** Tasten als räumliche Gruppen definieren: Ziffernblock 7–8–9 / 4–5–6 / 1–2–3, Befehls-/Achsblock und Satzzeichen. Bei wenig Platz Gruppen untereinander stellen, ihre innere Reihenfolge erhalten. ABC darf bewusst alphabetisch sein; dann in normaler Leserichtung und ausdrücklich so bezeichnet. Eine volle QWERTZ-Tastatur im 280-px-Strip würde erneut zu kleinen Tasten führen und ist keine pauschale Lösung. Die erreichbaren Zeichen und die Seiten Code/ABC/123/#+= bleiben Anforderungen.

**Abnahme:** Gleiche Nachbarschaft der Ziffern und logische Fokusreihenfolge bei Rotation; sämtliche bisherigen Zeichen weiter erreichbar, ohne kleinere Tasten.

### UI-K03 — Feldhöhen entstehen aus dem jeweiligen Container

Am Desktop misst MDI **32 px**, die Werkzeugsuche **28 px**, normale Editorfelder **28 px**, der Type-Select **26 px**. Im Touch-Modus werden diese Fälle bereits auf **36 px** angeglichen. MDI hat keinen anderen Basistoken; es wird in `.mdiRow` auf die Buttonhöhe gestreckt. Die Suchzeile steht alleine. [App.vue:2766](../../lcnc-webui/src/App.vue#L2766), [style.css:411](../../lcnc-webui/src/style.css#L411).

Zusätzlich gibt es neben der unbenannten Basis drei `INPUT_SIZE_STYLES`; `md` verwendet mehr vertikales Padding als `lg`. Eingabe- und Buttongrößen haben keinen gemeinsamen Vertrag. [machineControls.ts:270](../../lcnc-webui/src/machineControls.ts#L270).

**Vorschlag:** Gemeinsame Kontrollhöhen für Input, Select und benachbarte Buttons: als Ausgangspunkt **32 px Standard am Desktop**, **44 px bei Touch**; **28/36 px kompakt** nur für ausdrücklich dichte Bereiche wie Tabellen und Strip. Kein tababhängiger Größenwechsel. Gleiche Höhe bedeutet nicht gleiche Breite: MDI darf den Platz neben Send/Abort nutzen, die Suche ihre ganze Zeile.

**Abnahme:** MDI, Suche, Texteingabe, Zahlenfeld und Select derselben Dichte haben dieselbe Höhe, Baseline, Kontur und denselben Fokusindikator. Änderungen sind gemeinsam mit dem Layoutbudget zu prüfen, nicht durch globales Hochsetzen aller Mindesthöhen allein.

### UI-K04 — Werkzeugeditor mischt zwei Formularraster

„General“ verwendet ein Label/Feld-Paar je Zeile, „Dimensions“ zwei Paare. `.paramGrid input { max-width: 100px }` begrenzt Zahlen, `.full` nimmt die Begrenzung für Text/Select wieder zurück. Gemessen stehen **100 px** breite Zahlenfelder neben **465 px** breiten Textfeldern; unten beginnen andere Spaltenachsen. Im Hochformat wandert die große Vorschau unter das Formular. [Aufnahme](ui-optimierungen.consistency-desktop-tool-editor.png), [ToolTablePanel.vue:683](../../lcnc-webui/src/ToolTablePanel.vue#L683), [style.css:988](../../lcnc-webui/src/style.css#L988).

**Vorschlag:** Ein gemeinsames Feldraster mit Label über dem Feld, zwei gleich breiten Spalten bei ausreichender Breite, sonst einer Spalte. Dasselbe Raster für alle Abschnitte. Typ, Beschreibung und Halter dürfen bewusst über beide Spalten gehen; Zahlen füllen ihre Feldspur und bleiben rechtsbündig. Keine globale 100-px-Grenze für sämtliche Formulare. Einheiten stehen dauerhaft neben dem Wert oder im Label, nicht ausschließlich als Platzhalter, der beim Eingeben verschwindet. Vorschau rechts; bei wenig Platz einklappbar unter den Feldern. Feste Kopf-/Fußbereiche, nur der Inhalt scrollt. Cancel links vom Save, Aktionsgruppe rechts ausgerichtet.

**Abnahme:** Gleiche Spaltenachsen, keine zufälligen Restflächen, alle Einheiten bei gefüllten Feldern sichtbar, kein abgeschnittenes Label. Preview und Formular dürfen sich bei Zoom nicht gegenseitig unbenutzbar machen.

### UI-K05 — Tabs haben unterschiedliche Regeln für Aktionsgruppen

Program rahmt die Dateiverwaltung lokal mit `.header` ein. Tools setzt Maschinenaktionen, Verwaltung und Probe-Status als lose Zeilen davor. MDI verwendet wieder eine eigene Struktur. Das gemeinsame `.row-tight` regelt nur den Abstand, keine Informationshierarchie. [GcodePanel.vue:777](../../lcnc-webui/src/GcodePanel.vue#L777), [App.vue:1926](../../lcnc-webui/src/App.vue#L1926).

**Vorschlag:** Gemeinsames Bereichsmuster: **Objekt/Datei und Verwaltung → Ausführung/Maschinenaktion → Suche/Filter → Inhalt → bereichsbezogene Rückmeldung**. Gleiche Containerkontur, Innenabstände, Gruppentitel und Umbruchregeln. Tools bekommt getrennte Gruppen „Werkzeugverwaltung“ und „Werkzeug in der Spindel · T…“. Measure/Unload/Abort gehören zusammen; Add/Browse/Upload in die Verwaltung. Abort bleibt direkt bei den laufenden Aktionen und erreichbar. Keine dekorative Karte um jeden einzelnen Button.

**Abnahme:** Program und Tools sehen wie zwei Anwendungen desselben Musters aus; Bedienelemente bleiben auch bei gesperrten Aktionen und mehrzeiligen Meldungen an vorhersehbaren Stellen.

### UI-K06 — Header gewichtet Diagnose und Shutdown zu stark

Gemessen: vier normale Kopfaktionen **38 × 34 px**, Shutdown **86 × 47 px**. Ursache ist die nur dort gestapelte Beschriftung. Im Portrait brechen Statuspills und Aktionszeile um; Net/Ping/Clients stehen optisch neben wesentlichen Betriebszuständen. [App.vue:1690](../../lcnc-webui/src/App.vue#L1690), [App.vue:2540](../../lcnc-webui/src/App.vue#L2540).

**Vorschlag:** Eine gemeinsame Höhe und Icongröße. Shutdown, falls direkt angezeigt, als Icon und Text **nebeneinander**. Eine platzsparende System-Menüvariante ist möglich, muss „Shut down“ dort ausgeschrieben zeigen. E-Stop gehört weiterhin in die jederzeit erreichbare Sicherheitsbedienung. Verbunden/Armed bleiben sichtbar; technische Diagnosewerte dürfen in eine beschriftete Detailansicht. Die Beschriftung von Shutdown einfach wieder zu entfernen würde den früher behobenen Touch-Erkennungsfehler zurückbringen.

### UI-K07 — Die Werkzeugtabelle priorisiert technische Spalten vor Erkennung

In der 540-px-Seitenfläche sind T#, Pocket, Durchmesser, Z, langer Typtext und Flutes vor der Beschreibung angeordnet; zum Lesen der Beschreibung muss horizontal gescrollt werden. Ein Select ist zugleich die Überschrift „Type“, während andere Überschriften sortieren. „No tools loaded“ wird auch bei einer Suche ohne Treffer verwendet. [ToolTablePanel.vue:883](../../lcnc-webui/src/ToolTablePanel.vue#L883).

**Vorschlag:** T# und Beschreibung zuerst, danach Durchmesser/Z; Typfilter in die Such-/Filterzeile, seltene Spalten in eine Detailansicht oder explizite Spaltenauswahl. Editieren an einem festen Zeilenende, Laden weiterhin als eigenständige, geschützte Aktion. Keine Zeilenaktivierung, die unbemerkt eine Maschinenaktion auslöst. Leere Tabelle, keine Suchtreffer, Laden und Fehler getrennt benennen. Aktuelles Werkzeug zusätzlich mit Text/Zeichen markieren, nicht nur mit Zeilenfarbe. Sortierrichtung am Spaltenkopf auch semantisch als `aria-sort` bekanntgeben.

### UI-K08 — Viewer-Farben sind nicht vollständig themeabhängig

[defaults.ts:225](../../lcnc-webui/src/defaults.ts#L225) setzt Bounds auf Weiß, Feed auf Cyan und Rapid auf Orange. [ThreeViewer.vue:3382](../../lcnc-webui/src/ThreeViewer.vue#L3382) passt Hintergrund, Grid und Maschinenkanten an das Theme an, nicht diese drei Standardfarben. **High Contrast Light löst das Problem daher ebenfalls nicht.** [Heller Viewer](ui-optimierungen.consistency-viewer-light.png), [dunkler Viewer](ui-optimierungen.consistency-viewer-dark.png).

| Element | Aktuelle Farbe | Kontrast auf Weiß |
|---|---|---:|
| Maschinenbegrenzung | `#ffffff` | **1,00:1** |
| Vorschub | `#22b8cf` | **2,38:1** |
| Eilgang / Toolpath Bounds | `#f5a623` | **2,03:1** |
| Gelbe Limitverletzungsmarkierung | `#ffcc00` | **1,51:1** |

Das sind Berechnungen der Ausgangsfarben. Kantenglättung, Transparenz und eine Maschinenoberfläche hinter der Linie können die Erkennbarkeit weiter verändern. Die gelbe Markierung für Segmente außerhalb der Achsgrenzen stammt aus [toolpathController.ts:366](../../lcnc-webui/src/viewer/toolpathController.ts#L366). Die aktuelle Zeilen-/Scrub-Auswahl ist separat rot (`#ff3333`), nicht gelb. Eilgang ist bereits gestrichelt — diesen guten Unterschied beibehalten.

**Vorschlag:** Viewer-Palette aus semantischen Rollen und Theme ableiten, zusätzlich eine ausdrücklich gewählte benutzerdefinierte Palette erlauben. Gespeicherte Benutzerfarben nicht bei jedem Theme-Wechsel überschreiben; „Automatisch“ und „Benutzerdefiniert“ unterscheiden, beim Migrieren alte explizite Entscheidungen erhalten. HC-Themes müssen auch Syntax, Viewer und Fokus abdecken. Sichtbare Legende und zusätzliche Linien-/Markierungsmerkmale; bei Linien auf Geometrie kontrastierende Kontur prüfen. Farbe darf die Bedeutung nicht allein tragen. [W3C: Verwendung von Farbe](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

**Konkrete Ausgangspalette, noch keine Abnahme auf realen Maschinenoberflächen:**

| Rolle | Hell auf `#fff` | Kontrast | Dunkel auf `#0b0f14` | Kontrast | Zusätzliches Merkmal |
|---|---|---:|---|---:|---|
| Maschinenbegrenzung | `#475569` | 7,58 | `#cbd5e1` | 12,94 | Geschlossener Rahmen, Legende |
| Vorschub | `#0072b2` | 5,19 | `#56b4e9` | 8,33 | Durchgezogene Linie |
| Eilgang | `#9a6700` | 4,87 | `#e69f00` | 8,53 | Gestrichelt |
| Gefahrener Pfad | `#007f75` | 4,89 | `#2dd4bf` | 10,32 | Zeitlicher Verlauf; zusätzliches Linienmerkmal prüfen |
| Auswahl | `#7e22ce` | 6,98 | `#d8b4fe` | 10,87 | Breitere Kontur und markierte Programmzeile |
| Kollision | `#b91c1c` | 6,47 | `#ff8585` | 8,19 | Marker, Meldung und Zeilenbezug |

Blau und Ocker liefern einen brauchbaren Ausgangspunkt für zwei wichtige Pfadarten. Kein Farbset ist allein eine Garantie für alle Farbsehschwächen; Graustufen und Farbsehschwächen-Simulation gehören zur Abnahme. Der Graustufen-Schalter im Entwurf ersetzt Letztere nicht.

### UI-K09 — Helles Theme: auch Text und Syntax zu kontrastarm

Die vier Syntaxfarben bleiben in allen Themes gleich. Auf Weiß erreichen Parameter **1,49:1**, Koordinaten **2,04:1**, M-Code **2,78:1**, Kommentare vor zusätzlicher Opazität **3,33:1**. [Syntax-Aufnahme](ui-optimierungen.consistency-syntax-light.png), [style.css:1192](../../lcnc-webui/src/style.css#L1192). Die echte Codefläche ist leicht getönt; die genannten Zahlen sind die nachvollziehbare Weiß-Referenz, keine Messung jedes zusammengesetzten Textpixels. Kommentare werden zusätzlich auf 0,8 Opazität gesetzt.

`--fg` mit `opacity: .6` auf `--panel` ergibt im normalen hellen Theme **3,61:1**. Das betrifft auch aktive Beschriftungen und Überschriften, nicht nur inaktive Controls. Warntext verwendet das helle Orange ebenfalls direkt. Die Fokusfarbe `--info` hat auf Weiß nur **2,95:1**.

**Vorschlag:** Getrennte Textrollen für normalen Text, sekundären Text, Warntext und dekorative Symbole; keine pauschale Opazität zur Textabstufung. Helle Syntaxpalette mit dunkleren Farben, dunkle Palette mit helleren Farben. Fokusfarbe getrennt von dekorativem Info-Blau. Weniger Typografierollen: z. B. 14 px Fließ-/Bedientext, 12 px Beschriftung, 16 px Abschnittstitel; dichte Tabellen dürfen eine bewusst geprüfte Variante behalten. 9/10 px nicht für wesentliche Informationen bei Touch.

**Abnahmeziel:** Normaler Text mindestens **4,5:1**; große Schrift hat eine separate 3:1-Regel. Notwendige Bedienelement-Konturen und informative grafische Objekte mindestens **3:1** zu angrenzenden Farben, soweit das Kriterium anwendbar ist. Dekoration und tatsächlich inaktive Controls sind nicht pauschal gleich zu behandeln. [W3C: Textkontrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C: Nicht-Text-Kontrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

### UI-K10 — Sichtbare Beschriftungen sind nicht überall zugängliche Namen

Die AX-Probe findet unbenannte Regler, ein unbenanntes Spindelfeld, den Werkzeugtyp-Select und Typfilter sowie zahlreiche Probing-Eingaben. Im Werkzeugeditor tragen viele Zahlenfelder inzwischen `aria-label`; der Select hat jedoch nur ein benachbartes `<label>` ohne Verknüpfung. In Probing fehlen an mehreren Stellen sowohl die Verknüpfung als auch die `label`-Prop. Die gemessenen Listen enthalten auch den weiterhin zugänglichen Hintergrund/Strip; die Summen sind keine reine Dialogstatistik.

**Vorschlag:** Gemeinsames FormField-Muster: sichtbares Label mit eindeutiger ID-Verknüpfung, optionale Einheit/Hilfe/Fehler über `aria-describedby`, gegebenenfalls `aria-invalid`. Gleiche Namen für Zahlenhilfe und zugänglichen Feldnamen. Regler benennen und Einheit/Wert sinnvoll ausgeben. Wiederholte Hilfen wie „Show help“ sollen den zugehörigen Parameter nennen. Die Hülle gehört außerhalb der bestehenden einzelnen Root-Elemente von `MachineInput`/`MachineSelect`, damit die schon behobenen Scoped-CSS-/Fokusprobleme nicht zurückkehren.

**Abnahme:** Jedes sichtbare bedienbare Feld hat im Accessibility-Tree einen verständlichen Namen; sichtbare Labels fokussieren das richtige Feld. Namen enthalten Kontext, wenn derselbe Parameter mehrfach vorkommt.

### UI-K11 — Dialogoptik ist noch keine Dialog-Fokusführung

Bei „Add Tool“ bleibt `document.activeElement` auf **+ Add** hinter dem Overlay; der nächste Tab erreicht **Browse**, ebenfalls außerhalb. Im AX-Tree wird der sichtbare Dialog nicht als `dialog` ausgewiesen. [App.vue:2058](../../lcnc-webui/src/App.vue#L2058), [ToolTablePanel.vue:668](../../lcnc-webui/src/ToolTablePanel.vue#L668). Die Modalregistry schützt Shortcuts, stellt aber keine Dialogsemantik oder Fokusführung her.

**Vorschlag:** Benannte Dialogoberfläche, gezielter Fokus beim Öffnen und nachvollziehbare Rückkehr beim Schließen. Die Modalität ausdrücklich entscheiden: Werkzeugeditor mit externer Eingabehilfe und weiter erreichbarer Safety-Leiste ist kein gewöhnlicher vollständig modaler Seitendialog. `aria-modal="true"` darf nicht einfach ergänzt werden, während der Rest bedienbar bleibt. Arbeitsdialoge können bewusst nichtmodal sein, mit klarer Fokusnavigation zwischen Dialog und Hilfsbereich; echte Bestätigungsdialoge brauchen ein vollständiges modales Konzept. Dabei die Safety-Bedienung nicht durch pauschales `inert` auf App/Body entfernen.

Das allgemeine WAI-ARIA-Dialogmuster beschreibt Fokusführung und Semantik; die projektspezifische **Escape = E-Stop**-Belegung bleibt eine ausdrücklich erklärte Abweichung von dessen Close-Konvention. Sie darf nicht beiläufig in Escape = Schließen geändert werden. [W3C: Dialogmuster](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

### UI-K12 — Ausgewählte Tabs und Fokus nicht durchgängig erkennbar

[TabPanel.vue](../../lcnc-webui/src/TabPanel.vue) rendert gewöhnliche Buttons mit `.selected`, ohne Tablist/Tabpanel-Verknüpfung oder `aria-selected`. Der AX-Tree enthält keine Tabs. Ein geprüfter Slider hat trotz `:focus-visible` **`outline-style: none` und keinen Box-Shadow**; [style.css:341](../../lcnc-webui/src/style.css#L341) entfernt die Kontur.

**Vorschlag:** Ein vollständiges Tab-Muster mit ausgewähltem Zustand, zugeordnetem Panel, Pfeiltasten und einem regulären Tab-Stopp. Pfeiltasten lokal behandeln, damit sie nicht als Jog durchgereicht werden; Keyup-/Stop-Guards erhalten. Ein gemeinsamer sichtbarer Fokusindikator für Buttons, Inputs, Regler, Farbwähler und Tabellenaktionen. Die Form des Auswahlzustands zusätzlich zur Farbe zeigen. [W3C: Tab-Muster](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [W3C: Sichtbarer Fokus](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)

Der Operator-Nachtrag **UI-K17** konkretisiert zusätzlich die sichtbare Unterscheidung zwischen Haupttabs, Untertabs, Optionen und Aktionen. Die semantische Korrektur und die visuelle Gestaltung gehören in dieselbe Umsetzung.

### UI-K13 — Touch-Ziele, Hold-Aktionen und Bewegung brauchen eine explizite Zugänglichkeitsregel

Die globale Touch-Schicht setzt meist **36 px**, Hilfe-Symbole bewusst **20 × 20 px**; mehrere Beschriftungen sind nur 9/10/11 px groß. Die aktuelle Hold-Aktivierung ist absichtlich pointergebunden. `prefers-reduced-motion` und `forced-colors` werden in den geprüften UI-Styles nicht gesondert behandelt. Das ist kein durchgeführter Test aller Betriebssystem-Hilfen.

**Vorschlag:** 44 px als eigener Touch-Komfortstandard für normale Aktionen, 36 px nur bei begründet dichtem Layout. Kleine Hilfesymbole mit ausreichend großem, nicht überlappendem Trefferbereich. WCAG 2.2 AA fordert für Targets grundsätzlich 24 × 24 CSS-px oder passende Ausnahmen/Abstände; ein 20-px-Symbol ist deshalb nicht automatisch ein Verstoß, und 44 px ist keine pauschale AA-Pflicht. [W3C: Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

Für Hold-Aktionen ist ein bewusst abgesicherter Tastaturalternativweg zu entwerfen, etwa gezielte Bestätigung mit benanntem Ziel und erneuter Gate-Prüfung. Nicht einfach jeden Enter auf eine Bewegungsaktion legen, aber den dokumentierten Pointer-Zwang auch nicht als vollständige Barrierefreiheit ausweisen. Tastaturbedienung soll keine zeitkritischen Tastensequenzen voraussetzen. [W3C: Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)

Nicht wesentliche Animationen bei reduzierter Bewegung abstellen; Sicherheitszustand zusätzlich durch bleibenden Text/Symbol kenntlich machen. Sichtbarkeit von Fokus, Auswahl und Warnungen in Betriebssystem-Kontrastmodi gesondert prüfen. Für den Viewer textuelle Alternativen zu wesentlichen Ergebnissen erhalten: Positionen, Grenzen, betroffene Zeilen und Kollisionen dürfen nicht ausschließlich im Canvas stehen.

### UI-K14 — Inventar vereinfachen, ohne Maschinenrollen zu vermischen

| Bestand | Einordnung |
|---|---|
| 73 Button-Katalogeinträge, 241 statische MachineBtn-Verwendungen | Überwiegend fachliche Rollen mit Gates/Hold-Verträgen. **Keine 73 unterschiedlichen Designs.** |
| Btn: 3 Formen, 4 Größen, 6 Farbvarianten plus Zustände | Hier liegt die visuelle API. Standard/Icon/Inline und Größe/Variante/Zustand überlappen teilweise. |
| 90 Properties im Basis-`:root`, 93 unterschiedliche in `style.css` insgesamt | Enthält Farben, Typografie, Abstände, Layoutmaße, Z-Index und Viewer-Werte. Die Zahl allein belegt keinen Überbau. |
| 9 Schriftgrößen, 8 Radius-Namen, 5 Abstände | Schrift- und Radiusrollen können klarer werden. Die fünf Abstände sind überschaubar und brauchbar. |
| 4 statisch unreferenzierte Kandidaten | `--active-tool`, `--fs-3xl`, `--panel-h-portrait`, `--panel-min-h`; vor Entfernung dynamische/externe Verwendung ausschließen. |

**Vorschlag:** Gates, Ziele und Hold-Verträge im Maschinenkatalog erhalten. Visuelle Darstellung separat auf klare Achsen beschränken: Standard/Kompakt, Text/Icon, Hervorhebung und semantischer Zustand. „Primary“ und „ok“ teilen derzeit fast dieselbe Farbdefinition; Hauptaktion und positiver Zustand sollten begrifflich getrennt sein. Nicht die 73 Rollen per Gleichheit ihrer heutigen CSS-Werte zusammenlegen — z. B. Arm und Numpad-Delete sehen im Katalog ähnlich aus, bedeuten aber etwas völlig anderes.

Tokens in Basiswerte und semantische Rollen gliedern; bestehende Abstands-/Z-Index-Skalen behalten. Statt pro Sonderfall einen neuen Token einzuführen, wenige gemeinsame Bausteine ergänzen: **Control**, **FormField/FormGrid**, **ActionGroup**, **DialogFrame**, **InputHelperFrame**. Größen zuerst über diese Bausteine steuern. Globale `.paramGrid`-Breiten, lokale Button-/Input-Paddings und implizites Stretching schrittweise ablösen. Der vorhandene CSS-Linter prüft Werte und Leaks, beweist aber keine konsistente Zusammenstellung oder ausreichenden Kontrast.

### UI-K15 — Programmbrowser bietet Ordner an, die er grundsätzlich nicht öffnen darf

**Operator-Nachtrag, 22. September 2026:** Im Programm-Browser lassen sich Unterordner von `nc_files` anklicken, danach erscheint lediglich „Invalid directory“.

**Auf diesem System reproduziert:** `examples`, `gcmc_lib`, `gladevcp_lib`, `ngcgui_lib` und `remap_lib` unter `/home/cnc/linuxcnc/nc_files` sind symbolische Links auf `/usr/share/linuxcnc/ncfiles` bzw. dessen Unterordner. Alle fünf werden von der originalen `list_files`-Funktion als Verzeichnis gelistet; derselbe Funktionskörper wirft beim Aufruf mit dem zurückgegebenen Pfad **HTTP 400 / Invalid directory**. [Ausgeführte Probe](ui-optimierungen.file-browser.probe.py), [Ergebnis](ui-optimierungen.file-browser.evidence.json). Die Probe führt den unveränderten Funktionskörper isoliert aus; kein laufender Gateway, keine LinuxCNC-Imports oder Maschinenaktionen.

**Ursache:** [gateway.py:6493](../../lcnc-gateway/gateway.py#L6493) prüft den gerade geöffneten Ordner mit `validate_path_within`, aber nicht jedes aufgelistete Kind. `entry.is_dir()` folgt Symlinks. Die [Pfadprüfung](../../lcnc-gateway/gateway_util.py#L90) löst dagegen das tatsächliche Ziel auf und erlaubt nur Ziele innerhalb des konfigurierten Programmordners. Deshalb wird ein externer Link erst beim Hineinwechseln abgelehnt. [FileBrowser.vue:45](../../lcnc-webui/src/FileBrowser.vue#L45) stellt jeden gelieferten Verzeichniseintrag als öffnungsfähigen Button dar und zeigt anschließend den technischen Fehler samt sinnlosem Retry für diese dauerhafte Ablehnung.

Die Verzeichnisse selbst sind vorhandene Verknüpfungen auf die installierten Beispiele und Bibliotheken. Der Fehler liegt in der widersprüchlichen Präsentation des erlaubten Dateibaums. Echte Unterverzeichnisse und Links auf Ziele **innerhalb** des Programmordners funktionieren in der Vergleichsprobe. Im Tools-Browser ist das Filtern externer Links bereits umgesetzt: [tool_files.py:19](../../lcnc-gateway/tool_files.py#L19).

**Vorschlag für diese UI-Welle:** Dieselbe Freigaberegel beim Auflisten und Öffnen verwenden, auch für verlinkte Dateien. Nicht erlaubte Ziele in der normalen Programmauswahl auslassen; falls ihre Existenz bewusst erklärt werden soll, als gesperrte Verknüpfung mit Grund „Ziel liegt außerhalb des Programmordners“ zeigen, ohne Öffnen/Retry anzubieten. Ordner, Verknüpfung und Datei durch verständliche Symbole unterscheiden. Fehlende oder vorübergehend nicht lesbare Ordner bekommen dagegen ihre passende Meldung; die bereits erhaltene letzte gültige Ansicht bleibt erhalten.

**Kein bloßer Browse-Bypass:** Sollen die Systembeispiele nutzbar sein, braucht es ausdrücklich konfigurierte weitere Lesewurzeln bzw. einen eigenen Beispiele-Bereich. Auflisten, Lesen/Vorschau und `load_file` müssen dieselben Ziele erlauben; Schreib-/Upload-Rechte sind getrennt zu behandeln. Nur den `Invalid directory`-Check zu entfernen würde anschließend an den ebenfalls begrenzten Lese-/Ladepfaden scheitern.

**Abnahme:** Normales Unterverzeichnis und interner Link öffnen; externer Ordner-/Dateilink wird nicht als nutzbarer Eintrag angeboten; direkter Zugriff und `..` bleiben abgewiesen. Zusätzlich verschwundener Ordner und fehlendes Leserecht mit verständlicher Rückmeldung. Der Programmbrowser hat für den beobachteten Symlink-Fall bisher keinen entsprechenden Test; die Tool-Dateitests haben bereits Vergleichsfälle.

### UI-K16 — Fokus, Außenklick und Navigation haben keinen gemeinsamen Schließvertrag

**Operator-Nachtrag, 22. September 2026:** Welche Dialoge schließen beim Fokuswechsel, und ist das konsistent?

**Ergebnis:** Tastatur und Numpad teilen inzwischen dieselbe Regel für das Verlassen ihres aktiven Eingabebereichs. Die **21 `.dialogOverlay`-Stellen** haben dagegen keinen eigenen Fokusverlust-Schließhandler: **16** besitzen einen Hintergrundklick-Handler, **5** nicht. Die Modal-Registry sperrt globale Maschinen-Shortcuts, regelt aber weder Dialogfokus noch Schließen. Fokuswechsel, Hintergrundklick, Header-Navigation und Ende eines Maschinenvorgangs sind deshalb getrennt zu betrachten.

| Bereich / Dialog | Fokus wechselt auf ein anderes Element | Klick auf den eigenen abgedunkelten Hintergrund | Besonderheit |
| --- | --- | --- | --- |
| Texttastatur und Numpad | Hilfe schließt beim Verlassen des aktiven Besitzerbereichs | Kein eigener Dialoghintergrund; Klick außerhalb schließt die Hilfe | Wechsel zu anderem Eingabefeld übernimmt dessen Sitzung; bloßes Verlassen bestätigt keinen Wert. Feld, Öffnungssymbol und Hilfstasten zählen zusammen. |
| Settings, Messages, G-code Reference, Program Stats | Bleibt offen | Schließt | Settings enthalten auch Formulare mit explizitem Save, nicht nur automatisch gespeicherte Einstellungen. |
| Makro-Parameter vor Execute | Bleibt offen | Schließt | Das Parameterobjekt wird verworfen; erneutes Öffnen beginnt mit den Makro-Defaults. |
| Upload-Namenskonflikt „Program exists“ | Bleibt offen | Schließt | Auch der noch nicht übernommene neue Dateiname wird verworfen. |
| Run from Line | Bleibt offen | Schließt | Führt nichts aus; die Optionen liegen separat im weiterhin montierten GcodePanel und werden beim Schließen nicht zurückgesetzt. |
| Werkzeugeditor Add/Edit | Bleibt offen | Bleibt offen | X und Cancel prüfen Änderungen; bei Änderungen folgt „Keep editing / Discard“. Während eines laufenden Speicherns wird das Schließen abgewehrt. |
| Werkzeug-Importvorschau | Bleibt offen | Schließt | **Auch bei laufendem Import-Request**; Schließen ist kein Abbruch des Requests. |
| „Discard changes?“ für Programm bzw. Werkzeug | Bleibt offen | Rückfrage schließt | Der ursprüngliche Entwurf bleibt erhalten. Das entspricht Cancel bzw. Keep editing. |
| Werkzeug löschen | Bleibt offen | Rückfrage schließt, solange keine Löschantwort aussteht | `cancelDelete` schützt den laufenden Request. |
| Makro löschen, Settings zurücksetzen, Probe zurücksetzen, Gamepad-Profil entfernen, Werkzeugtabelle ersetzen | Bleibt offen | Rückfrage schließt | Verwirft die Bestätigungsfrage, führt die Aktion nicht aus. |
| Gamepad-Zuordnungsassistent | Bleibt offen | Bleibt offen | Eigener Cancel; der Assistent hängt jedoch am Lebenszyklus der Settings. |
| Shutdown, Compensation bestätigen, manueller Werkzeugwechsel | Bleibt offen | Bleibt offen | Shutdown/Compensation haben Cancel. Ein angeforderter Werkzeugwechsel wird bestätigt oder über Abort abgebrochen; er ist kein frei wegklickbarer Hinweis. |
| Hilfe-Popover „?“ | Bleibt in der Chromium-Probe auch nach Tab und externem Fokus offen | Klick außerhalb schließt | Native `popover="auto"`-Bedienung, kein `.dialogOverlay`. |

**„Außerhalb“ bezeichnet bisher keine einheitliche Fläche:** Die Dialog-Overlays liegen im Inhaltsbereich. Ein Klick auf dessen abgedunkelten Hintergrund schließt z. B. Settings; ein Klick auf die freie Headerfläche lässt denselben Dialog offen. Die Headerbuttons Settings/Reference/Messages schließen über `openDialog` dagegen jeweils die anderen beiden Navigationsdialoge. Andere Dialoge werden dabei nicht generell geschlossen. Ein bloßer Wechsel in ein anderes Browserfenster hat ebenfalls keinen allgemeinen Dialog-Schließhandler; der `window.blur`-Handler der Eingabesitzung setzt nur den Pointer-Zwischenzustand zurück. Verbindungs-/Berechtigungsänderungen sind eigenständige Ursachen für das Ende einer Eingabesitzung. Die obige Helferregel gilt für aktive, sichtbare Besitzer; versteckte Besitzer können gesperrt bleiben.

**Nachgewiesene Lücken:**

1. **Ungespeicherte Settings-Makros gehen ohne Rückfrage verloren.** Im Browser „Add Macro“ geöffnet, Name und Command ausgefüllt, dann einmal Hintergrundklick und einmal Header-Wechsel zur Referenz. Beide Wege schließen Settings ohne Verwerfen-Frage; nach Wiederöffnung fehlt der Entwurf. `editingMacro` ist lokaler Zustand des unmontierten SettingsPanel. X nimmt denselben ungeschützten Elternpfad. Das widerspricht dem bereits geschützten Werkzeugeditor. Der Gamepad-Assistent kann aus demselben strukturellen Grund über das Schließen seines Settings-Elternteils verschwinden; dieser Assistentenfall ist hier nur am Quellcode geprüft.
2. **Laufender Import verliert seinen Dialog, ohne den Request abzubrechen.** Mit vollständig simuliertem, bewusst zurückgehaltenem HTTP-Import: „Importing...“ sichtbar, Hintergrundklick, Dialog weg, Request weiterhin offen. `cancelImport()` hat weder Busy-Prüfung noch Request-Abbruch; auch X/Cancel rufen es auf. Ein geschlossener Dialog ist damit keine Bestätigung, dass ein bereits gestarteter Import gestoppt wurde. Werkzeug-Speichern und -Löschen haben die entsprechende Schließsperre bereits.
3. **Der Fokus kann hinter den offenen Dialog wandern.** Beim Add-Tool-Dialog bleibt er zunächst auf „+ Add“ und springt mit Tab zu „Browse“ hinter dem Dialog. Der Dialog bleibt sichtbar. Damit ist „schließt nicht bei Fokusverlust“ allein noch kein korrektes modales Verhalten. Siehe auch UI-K11; Safety-Bereich und Eingabehilfen müssen bei der Festlegung der erlaubten Fokusbereiche ausdrücklich berücksichtigt werden.

**Nachweis:** [Ausgeführte Browserprobe](ui-optimierungen.dialog-close.probe.mjs), [Ergebnis](ui-optimierungen.dialog-close.evidence.json). Isolierter Mock, Chromium, Desktop 1600 × 1000; keine Verbindung zu LinuxCNC. Browsergeprüft sind Settings/Messages/Reference/Shutdown/Tool-Editor, beide Eingabehilfen, Hilfe-Popover, Makroentwurfsverlust über zwei Wege sowie die Import-Schließlücke. Die restlichen Tabellenzeilen stammen aus den Handlern im Quellcode; keine Behauptung einer vollständigen Browser- oder Screenreader-Abnahme.

**Quellen im Produkt:** [inputSession.ts:241](../../lcnc-webui/src/inputSession.ts#L241), [useDialogState.ts:39](../../lcnc-webui/src/useDialogState.ts#L39), [modalRegistry.ts:1](../../lcnc-webui/src/modalRegistry.ts#L1), [App.vue:2058](../../lcnc-webui/src/App.vue#L2058), [App.vue:2134](../../lcnc-webui/src/App.vue#L2134), [GcodePanel.vue:961](../../lcnc-webui/src/GcodePanel.vue#L961), [ToolTablePanel.vue:190](../../lcnc-webui/src/ToolTablePanel.vue#L190), [ToolTablePanel.vue:526](../../lcnc-webui/src/ToolTablePanel.vue#L526), [SettingsPanel.vue:49](../../lcnc-webui/src/SettingsPanel.vue#L49), [useMacros.ts:65](../../lcnc-webui/src/useMacros.ts#L65), [HelpIcon.vue:91](../../lcnc-webui/src/HelpIcon.vue#L91).

**Vorschlag für einen gemeinsamen Vertrag:**

- **Eingabehilfe:** Die gemeinsame Besitzer-/Fokusregel beibehalten. Verlassen verbirgt die Hilfe, ohne anzuwenden; Wechsel und Rückkehr behandeln Entwürfe gleich.
- **Information:** Hintergrundklick darf schließen. Passende Fokusführung für den gewählten modalen oder nichtmodalen Charakter definieren; Fokusverlust allein muss nicht schließen.
- **Formular/Assistent:** Alle Schließwege durch dieselbe Änderungsprüfung führen — einschließlich X, Cancel, Header-Navigation und Schließen des Elternteils. Entwurf erhalten oder bei Verlust ausdrücklich „Weiter bearbeiten / Verwerfen“ anbieten. Automatisch gespeicherte Settings und lokale Makroentwürfe dabei unterscheiden.
- **Bestätigungsfrage:** Hintergrundklick kann konsistent der sicheren Abwahl entsprechen, solange noch kein Auftrag läuft. Anstehender manueller Werkzeugwechsel bleibt ein gesonderter Maschinenablauf mit Confirm/Abort. Keine Aktion durch bloßen Fokuswechsel auslösen.
- **Laufender Auftrag:** Entweder Schließen bis zur Rückmeldung schützen oder einen ausdrücklich benannten Weg „Im Hintergrund weiter“ mit dauerhaft erreichbarem Fortschritt/Ergebnis anbieten. „Cancel“ darf keinen Abbruch vortäuschen. Schließen, Verwerfen und Maschinen-Abort bleiben unterschiedliche Aktionen.

Diese Regeln gehören in den vorgeschlagenen gemeinsamen `DialogFrame`, zusammen mit Öffnungsfokus und bewachter Fokusrückgabe. **Escape bleibt gemäß Operator-Entscheidung globaler E-Stop** und wird nicht zu einer generischen Dialog-Schließtaste umgebaut.

**Abnahme:** Für jeden Dialogtyp Tab/Shift+Tab, Hintergrund, Header-Navigation, X/Cancel sowie verschachtelten Elternabschluss prüfen; jeweils leerer/geänderter Entwurf und ausstehende/fehlgeschlagene Antwort. Makroentwürfe dürfen beim Schließen der Settings nicht still verloren gehen. Laufende Importvorgänge müssen nach Verbergen sichtbar nachverfolgbar sein oder das Verbergen ablehnen. Fokus muss erkennbar innerhalb der ausdrücklich erlaubten Bedienbereiche bleiben; die vorhandenen Sicherheits- und Shortcut-Sperren bleiben wirksam.

### UI-K17 — Tabs sehen wie Aktionen aus; dieselbe Darstellung wird auch für Optionen verwendet

**Operator-Nachtrag, 22. September 2026:** Program, MDI, Offsets usw. und die Untertabs sollen als Registerkarten erkennbar sein. Aktionsbuttons unmittelbar darunter gehören bereits zum gewählten Inhalt und dürfen nicht wie weitere gleichrangige Tabs wirken.

**Ursache im Produkt:** [TabPanel.vue:19](../../lcnc-webui/src/TabPanel.vue#L19) verwendet `MachineBtn type="tab"` in einer frei umbrechenden Buttonreihe. Der [Katalogeintrag](../../lcnc-webui/src/machineControls.ts#L142) bedeutet lediglich normaler kleiner, abgeschwächter Button; [Btn.vue:38](../../lcnc-webui/src/Btn.vue#L38) liefert dieselbe geschlossene Rundung und Kontur wie für Aktionen. `.selected` ändert Füllung, Kontur und Schriftgewicht, schafft aber keine sichtbare Verbindung zum zugehörigen Inhalt.

Die acht Probing-Unteransichten in [ProbePanel.vue:683](../../lcnc-webui/src/ProbePanel.vue#L683) verwenden dieselben Buttons separat. Die acht Settings-Tabs verwenden erneut TabPanel. Gleichzeitig verwendet [GcodePanel.vue:1051](../../lcnc-webui/src/GcodePanel.vue#L1051) `type="tab"` für **Off / FWD / REV**, obwohl dies eine Spindel-Voreinstellung und keine Tab-Navigation ist. Eine globale Umgestaltung dieses Katalogeintrags allein würde deshalb unterschiedliche Interaktionen weiter vermischen. Die HAL-Auswahl Pins/Signals/Params ist umgekehrt derzeit als `inline`-Buttonreihe gebaut und muss nach ihrer tatsächlichen Rolle eingeordnet werden.

**Verbindliche visuelle Unterscheidung als Vorschlag:**

| Rolle | Form und Platzierung | Auswahl / Wirkung |
| --- | --- | --- |
| Hauptnavigation: Program, MDI, Probing, Offsets, Tools | Gemeinsame Registerleiste am oberen Rand der Inhaltsfläche; Tab nur oben gerundet, aktive Fläche optisch mit dem Inhalt verbunden | Aktiver Reiter mit Kontur, stärkerer Schrift und zusätzlichem Akzent. Wechsel zeigt einen Arbeitsbereich. |
| Untertabs: Probing-Verfahren, Settings-Bereiche | Innerhalb der zugehörigen Fläche eine ruhigere durchgehende Leiste; keine einzelnen geschlossenen Buttonrahmen | Aktiver Eintrag mit deutlich sichtbarer Unterstreichung und stärkerer Schrift. Wechsel zeigt eine Unteransicht; Haupttab bleibt ausgewählt. |
| Aktionen: Edit, Reload, Add, Measure, Send, Abort | Eigene Aktionsgruppe **unterhalb** der Navigation, innerhalb der Inhaltsfläche; nach Raumprüfung **6–8 px** Abstände/Innenränder als Ausgangspunkt | Normale umrandete Buttons; Hervorhebung richtet sich nach Aktionsbedeutung. Gruppenüberschrift nur, wenn sie zusätzlichen Kontext liefert. |
| Optionen: Off/FWD/REV, Modus, Filter | Beschriftete Auswahlgruppe, Radio- oder Select-Muster passend zur Aufgabe | Ausgewählter Wert statt aktivem Tab. Keine Tab-Rolle allein wegen ähnlicher Optik. |

**Frühere Scrollvariante, durch die Empfehlung unten ersetzt:** Jede Navigationsebene blieb eine Zeile mit horizontalem Scrollen und Richtungstasten bei Überlauf. Diese Variante ist im Entwurf nur noch zum Vergleich vorhanden. Weiter gültig: keine umspringenden mehrzeiligen Reiter, kein Schrumpfen der Touch-Ziele und kein Vermischen von Tab-Leiste und Aktionsgruppe. Das Gesamtbudget einschließlich Zoom bleibt eine eigenständige Anforderung.

**Frühere Präzisierung nach Raumprüfung:** Der kompakte Scrollentwurf verwendete unter 320 px Panelbreite zwei Auswahllisten. Die aktuelle Empfehlung verwendet die Verfahrensauswahl bereits bei normaler Panelbreite und schaltet die Hauptnavigation im Prototyp unter vorläufig 400 px um. Das genaue Limit und die Fokusübernahme beim Umschalten sind im Produkt abzusichern. Bei 120 px ist auch diese Variante keine brauchbare Freigabe: Dafür muss die übergeordnete Spaltenaufteilung reagieren.

**Zugänglichkeit und Verhalten:** Pro Leiste ein benanntes `tablist`, verknüpfte `tab`-/`tabpanel`-Elemente, `aria-selected` und genau ein regulärer Tab-Stopp. Vorschlag für diese Maschinenoberfläche: Links/Rechts sowie Home/End bewegen zunächst den Fokus; Enter/Leertaste wählen bewusst aus. Tab führt anschließend in den Inhalt. Damit beendet bloßes Navigieren mit Pfeiltasten keinen Eingabekontext. Auswahl und Fokus bekommen getrennte sichtbare Markierungen; Auswahl nicht nur durch Farbe anzeigen. Keine globale Tastenumbelegung, keine Maschinenaktion durch Tabwechsel; die vorhandenen Keyup-/Jog-Stop- und E-Stop-Regeln erhalten. Manuelle Tab-Aktivierung ist ein vorgesehenes [W3C-Muster](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

**Gemeinsamer Baustein:** Tab-Navigation mit zwei Darstellungen „Hauptnavigation / Unteransicht“ und gemeinsamem Fokus-/Auswahlvertrag. TabPanel und Probing migrieren auf dieselbe Umsetzung; Spindel-Voreinstellungen bekommen passende Optionssemantik. Die bestehenden fachlichen Maschinen-Gates/Hold-Verträge bleiben bei den Aktionskomponenten. Dafür braucht es keine zusätzliche Buttonvariante für jeden Tab oder eine neue Token-Skala.

**Anschaulicher Entwurf, verdichtet am 23. September:** [Interaktive Haupt- und Untertabs](ui-optimierungen.design-proposal.html#navigation), [Hell](ui-optimierungen.consistency-tabs-light.png), [Dunkel](ui-optimierungen.consistency-tabs-dark.png), [schmale Touch-Ansicht](ui-optimierungen.consistency-tabs-touch-450.png). Program/MDI/Probing/Offsets/Tools und die acht Probing-Untertabs sind anwählbar; Aktionsbuttons haben keine Maschinenverbindung. Der Entwurf zeigt das Muster, nicht alle echten Formulare. Die bisherigen Layoutbeispiele wurden auf dieselbe Registerdarstellung umgestellt. Die Breitenwahl und der Schalter „Kompakte Fassung“ erlauben jetzt den direkten Raumvergleich; die verlinkten Tab-Aufnahmen zeigen die kompakte Fassung.

**Prüfung des Entwurfs:** [Probe](ui-optimierungen.tabs-proposal.probe.mjs), [Ergebnis](ui-optimierungen.tabs-proposal.evidence.json). Chromium: unabhängige Auswahl von Haupt-/Untertabs und separatem Layoutbeispiel, manuelle Aktivierung, Tab in den Inhalt, Auswahl bleibt beim Zurückwechseln erhalten. Hell/Dunkel bei 1400 px, Touch bei 600/450 px; keine überlaufende Gesamtseite, erreichbare letzte Untertabs, Tab-Höhen bei Touch mindestens 44 px. Vorhandene breite Farbvergleichstabelle hat nun einen eigenen Scrollbereich. Auswahlkontur im simulierten Forced-Colors-Modus geprüft. Dies ist eine Entwurfsprüfung, keine Produkt-, Touchhardware- oder Screenreader-Abnahme.

**Produkt-Abnahme:** Tab und Aktion müssen ohne Hover und auch in Graustufen unterscheidbar sein. Beide Navigationsebenen behalten Form, Platz und Hierarchie über alle Bereiche. Ausgewähltes Panel und Untertab bleiben korrekt verknüpft; unsichtbare Panels sind nicht fokussierbar. Tastaturwechsel darf keine Maschinen-Shortcuts auslösen, keine laufenden Bewegungen hängen lassen und keinen Entwurf still verwerfen. Referenzaufnahmen an echten Program-, Probing-, Offsets-, Tools- und Settings-Inhalten bei Desktop/Touch sowie 100/150/200 %.

#### Raumprüfung des Seitenpanels · 23. September 2026

**Korrektur des ersten Entwurfs:** Die große Darstellung nutzte rund 1.130 px Breite. Auch eine Probe bei 450 px **Fensterbreite** war kein Beleg für das Platzbudget des realen Seitenpanels. Im Produkt setzt [App.vue:2398](../../lcnc-webui/src/App.vue#L2398) im Querformat eine feste Breite von **540 CSS-px**; nach Rahmen und Padding bleiben bei 100 % **522 px** für TabPanel/Inhalt. Im Hochformat hängt das Panel an der verbleibenden Spalte neben dem 280-px-Bedienbereich.

| Geprüfter Zustand | Panel außen | Innen nutzbar | Panelhöhe außen |
| --- | ---: | ---: | ---: |
| 1600 × 1000 Desktop, 100 % | 540 px | 522 px | 587 px |
| 1280 × 800 Touch quer, 100 % | 540 px | 522 px | 385 px |
| 900 × 1200 Touch hoch, 100 % | 588 px | 570 px | 524 px |
| 900 × 1200 Touch hoch, 150 % CSS-Zoom | 288 px | ca. 271 px | ca. 322 px |
| 900 × 1200 Touch hoch, 200 % CSS-Zoom | 138 px | 120 px | ca. 188 px |

Maße sind in logischen CSS-px angegeben; sie wurden aus dem tatsächlich gerenderten Panel gelesen. Die Höhe gilt für den geprüften Mockzustand und ist keine feste Zusage für andere Meldungen, Strip-Zustände oder geladene Programme. CSS-Zoom ist eine Layoutprobe und kein nativer Firefox/macOS-Zoomtest. Im Querformat liegt das Panel in der 1280er-Probe ab 150 % zudem teilweise außerhalb des Viewports; das ist ein bereits vorhandenes Problem der Gesamtaufteilung.

**Verdichtung des Vorschlags:** Haupt-/Untertabs 32 px am Desktop, 44 px bei Touch. Innenpadding 8 statt 16 px, Aktionsgruppen 6 px; keine zusätzliche Zeile „Probing · Outside“ und kein zweites „Aktionen · Outside“, wenn die Tab-Auswahl den Kontext bereits zeigt. Fachlich notwendige Angaben wie Programmdatei oder aktives Bezugssystem bleiben erhalten. Die fünf Probe-/Abort-Buttons passen bei 522 px dadurch in eine statt zwei Reihen. Alle Aktionsbuttons behalten 32/44 px Höhe.

| Gleiches schematisches Probing-Beispiel | Großzügige Fassung | Kompakte Fassung | Ersparnis |
| --- | ---: | ---: | ---: |
| 522 px breit, Desktop | 381 px hoch | 210 px hoch | 171 px |
| 522 px breit, Touch | 426 px hoch | 258 px hoch | 168 px, ca. 39 % |
| 271 px breit, Touch | 566 px hoch | 372 px hoch | 194 px, ca. 34 % |

**Bewertung:** Bei 522 px ist das Navigationsmuster mit kompakter Zusammensetzung plausibel; die großzügige Fassung war dafür nicht geeignet. Bei 271 px verlangt sogar das kurze Beispiel noch vertikales Scrollen: 372 px Inhalt passen nicht vollständig in die ca. 304 px innere Panelhöhe. Das vollständige Probing-Formular bleibt daher ein eigener scrollbarer Inhalt unter kompakter Navigation; keine Zusage, alle Aktionen/Parameter gleichzeitig zu zeigen. Bei 120 px muss das Gesamtfenster seine Anordnung ändern, z. B. vorhandene Spalten bei zu kleiner Restbreite anders anordnen. Ein weiterer kleinerer Button- oder Schrifttoken löst das nicht. Die konkrete Umordnung muss zusammen mit dauerhaft erreichbarer Safety-Bedienung und Viewer geprüft werden.

**Nachweis:** [Mess-/Vergleichsprobe](ui-optimierungen.panel-density.probe.mjs), [18 Produktmessungen und 12 Entwurfsvergleiche](ui-optimierungen.panel-density.evidence.json), [522 px Touch vorher](ui-optimierungen.panel-density-522-touch-spacious.png), [522 px Touch kompakt](ui-optimierungen.panel-density-522-touch-compact.png), [271 px Touch kompakt](ui-optimierungen.panel-density-271-touch-compact.png). Isolierter Mock und lokaler HTML-Entwurf, keine Produktänderung. Wechsel zwischen Dropdown und Tabs erhält Haupt-/Unterauswahl; die vorhandene Tastatur-/Theme-Probe wurde nach der Änderung erneut erfolgreich ausgeführt. Die Abnahme im echten Gesamtfenster mit vollständigen Formularen bleibt offen.

#### Alternativen zur horizontalen Scrollnavigation · 23. September 2026

**Operator-Einwand:** Die Scrollleiste ist für die Navigation ungünstig; welche anderen Muster bieten moderne UIs? Der Einwand ändert den vorgeschlagenen Umgang mit Überlauf. Horizontales Scrollen bleibt in manchen aktuellen Designsystemen vorgesehen, etwa [Carbon Tabs](https://carbondesignsystem.com/components/tabs/usage/). Es ist aber kein verpflichtendes Merkmal einer modernen Oberfläche. [Adobe Spectrum](https://spectrum.adobe.com/page/tabs/) nennt einen Picker als Alternative zu horizontalem Scrollen bei zu vielen Tabs. Für die Maschinenoberfläche ist die folgende Auswahl eine projektspezifische Empfehlung, keine pauschale Designsystem-Vorschrift.

| Variante | Vorteil | Preis / Eignung in diesem Panel |
| --- | --- | --- |
| **Feste sichtbare Tabs** | Alle Ziele direkt sichtbar und mit einer Auswahl erreichbar; stabile Positionen | Die fünf Hauptbereiche passen bei 522 px. Für acht lange Verfahrensnamen reicht eine Zeile nicht. |
| **Beschriftete Auswahlliste / Picker** | Eine feste Zeile, aktuelles Verfahren vollständig benannt; alle Alternativen über die Auswahl erreichbar | Öffnen und Auswählen statt unmittelbarem Tab-Tipp. Gute Ausgangsvariante für acht Verfahren; bei sehr häufigem Wechsel gegen direkte Auswahl vergleichen. |
| **Festes Auswahlraster oder aufklappbare Auswahlübersicht** | Alle Verfahren mit Text und Auswahlmarkierung sichtbar; direkt anwählbar oder erst nach Öffnen | Ein dauerhaftes 4×2-Raster braucht bei 44-px-Touch-Zielen mindestens 88 px plus Abstände. Eine aufklappbare Übersicht braucht weniger dauerhaften Platz, aber zusätzliche Öffnung/Fokus-/Schließlogik. Nicht als zufälliger Tab-Umbruch gestalten. |
| **Vertikale Navigation / Seitenliste** | Gut lesbare Namen und klare Hierarchie; geeignet für viele Settings-Kategorien | Verbraucht zusätzliche Breite. Im 522-px-Panel bleibt weniger Formularfläche; bei 271 px besonders ungünstig. Eher im breiteren Settings-Dialog oder als bewusst neu entworfene globale Navigation. |
| **Sichtbare Ziele plus „Weitere“** | Wichtige Ziele bleiben direkt erreichbar; Rest in einem Menü | Verbirgt einen Teil der Navigation. Erfordert begründete Prioritäten; ausgewähltes verstecktes Ziel muss sichtbar benannt bleiben. Keine automatisch wechselnde Reihenfolge. |

Accordions eignen sich für ein-/ausblendbare Parameterabschnitte; sie sind keine pauschale Ersatznavigation für Program/MDI/Probing. Eine reine Icon-Leiste spart Breite, braucht aber erlernte Bedeutungen und löst den Wunsch nach verständlicher Benennung nicht automatisch.

**Aktuelle Empfehlung für die weitere Diskussion:**

1. **Program / MDI / Probing / Offsets / Tools** bleiben im normalen Panel fünf feste Registerkarten ohne horizontales Scrollen.
2. **Probing-Verfahren** stehen in einer gleichbleibenden Zeile **„Verfahren: Outside ▾“**. Die Auswahl enthält alle acht Namen in stabiler Reihenfolge. Verfahren wechseln zeigt nur die entsprechende Ansicht; es startet keine Messung. Das gleiche Prinzip gilt für andere Unteransichten, wenn Anzahl und verfügbare Breite keine vollständige Leiste erlauben.
3. **Aktionsbuttons** bleiben darunter in ihrem eigenen Bereich. Unter vorläufig 400 px Panelbreite wird auch der Hauptbereich als beschriftete Auswahl angeboten. Die konkrete Schwelle muss tatsächliche Beschriftungen, Schriftvergrößerung und Lokalisierung berücksichtigen.
4. Falls der Operator sehr häufig zwischen Probing-Verfahren wechselt, ist das **feste Auswahlraster** die sinnvolle Gegenvariante für einen Bedienvergleich. Dafür wird bewusst mehr Höhe reserviert. Keine Behauptung, dass ein Picker bei jeder Arbeitsweise schneller sei.

**Entwurf umgesetzt:** [Aktuelle Variante ohne Scrollnavigation](ui-optimierungen.design-proposal.html#navigation), [522 px Touch](ui-optimierungen.navigation-picker-522-touch-light.png), [Dunkel](ui-optimierungen.navigation-picker-522-touch-dark.png), [271 px Touch](ui-optimierungen.navigation-picker-271-touch-light.png). Die Navigationseinstellung erlaubt weiterhin „Frühere Scrolltabs · Vergleich“. Die native Auswahlliste dient als funktionale Vorschau; eine individuell gestaltete Auswahlübersicht ist nicht implementiert.

**Prüfung:** [Probe](ui-optimierungen.navigation-picker.probe.mjs), [Ergebnis](ui-optimierungen.navigation-picker.evidence.json). Alle acht Verfahren auswählbar; Auswahl bleibt bei Hauptbereichs- und Breitenwechsel erhalten. Bei 522 px fünf sichtbare Haupttabs, keine horizontalen Scrollpfeile und kein horizontaler Überlauf. Das Touch-Beispiel misst **248 px Höhe**, gegenüber 258 px beim verdichteten Scrollentwurf; die Eingabe-/Aktionsziele bleiben 44 px hoch. Bei 271 px zwei beschriftete Auswahllisten, weiterhin 372 px Beispielhöhe und damit derselbe vertikale Scrollbedarf wie zuvor. Das ist keine Zusage einer insgesamt scrollbarfreien Anwendung. Keine Produktänderung; native Popupdarstellung, Screenreader, Escape/E-Stop, Fokusübernahme beim responsiven Wechsel und reale Maschinen-Gates bleiben im Produkt zu prüfen.

## Empfohlener Umsetzungsumfang für die UI-Welle

1. **Verträge festhalten:** Feldgrößen/Dichten, Schließanker und Schließverhalten einschließlich Entwurfsschutz, Formularraster, Tab-Hierarchie und Aktionsgruppen, Farbrollen und die Modalitätsentscheidung. Den Entwurf als Richtung verwenden; echte Keyboard-/Strip-Geometrie gesondert nachweisen.
2. **Gemeinsame Bausteine und zwei Referenzbereiche:** Tools samt Editor und MDI als Referenz; Program an dasselbe Aktionsgruppenmuster anschließen. Danach Probing, Offsets und Settings nachziehen. Keine weiteren neuen Einzelformulare während dieser Migration.
3. **Erkennbarkeit und Zugänglichkeit gemeinsam fertigstellen:** Viewer- und Syntaxpalette pro Theme, Formlabels, Tabsemantik, Fokusindikatoren, Dialogfokus, geprüfte Touch-Ziele. Größe/Farbe und Beschriftung nicht als voneinander unabhängige Nacharbeiten behandeln.

**Vor visueller Freigabe besonders wichtig:** UI-K01, K03–K05, K08–K12. **UI-K15** ist zusätzlich ein reproduzierter Funktions-/Bedienfehler im Programmbrowser; **UI-K16** enthält reproduzierten Entwurfsverlust und widersprüchliches Schließen während laufender Aufträge. K02 und K06/K07 verbessern Wiedererkennung und Platznutzung; K13 braucht teils eine eigene sichere Interaktionsentscheidung. Die Tokenbereinigung ist Begleitarbeit, kein Selbstzweck.

**Abnahme statt bloß neuer Screenshots:** Vergleich der tatsächlichen Kontrollmaße; feste Close-Positionen; Toolbar-Reihenfolge; Formspalten und dauerhaft sichtbare Einheiten. Light/Dark/HC-Light/HC-Dark bei Desktop und Touch, 100/150/200 % mit erreichbaren Aktionen; Tabellen/3D dürfen notwendige eigene Scroll-/Navigationsflächen haben, Textformulare müssen nutzbar bleiben. Gezielte AX-/Tastaturprüfungen plus manuelle Screenreader-Abnahme. Viewer mit dünnen und dichten Pfaden, Linien vor heller/dunkler Geometrie und aktiver Auswahl prüfen. Bestehende Shortcut-, Hold-, Fokusreturn-, Draft-, Sicherheits- und Kollisionssemantik darf dabei nicht verändert oder durch neue Testreferenzen verdeckt werden.

Die bisherigen FA-01–FA-04 bleiben wie vereinbart Folgearbeit zur Fehlerbehandlung. **Kontrast und verständliche Viewer-Darstellung gehören dagegen zu diesem UI-Auftrag**, auch wenn die Anpassung technisch in Viewer-Dateien erfolgt. Die unabhängige Nachprüfung von `691e642` bleibt ein eigener ausstehender Review-Schritt; dieser Gestaltungsreview behauptet dafür kein Agreement.

---

<a id="stellungnahme-claude--23-september-2026"></a>

## Stellungnahme Claude · 23. September 2026

**Operator-Entscheidung (23.09.):** die reproduzierten Funktionsfehler jetzt auf `feat/ui-review-wave`, die Gestaltungsverträge als **eigene Design-Welle nach dem Merge** mit eigenem Plan ([Plan Fassung 5](ui-optimierungen.plan.md#fassung-5), Folge-Liste). Die Befunde sind gegen den Code plausibel bzw. bestätigt; die Messwerte werden in der Design-Welle übernommen, nicht neu verhandelt.

| ID | Stand | Einordnung |
|---|---|---|
| UI-K15 | **umgesetzt** `358d6dc` | `list_files` wendet die Öffnungsregel (`validate_path_within`) auf jedes Kind an — externe Ordner- und Dateilinks werden nicht mehr gelistet, interne Links und echte Unterordner öffnen; `HttpError` mit Status, `browseFailure.ts`: 400 ohne Retry, 403/404/5xx/Netz mit. Tests: `test_program_files.py` (echter Ordner, interner Link, externer Ordner-/Dateilink, `..`, absoluter Pfad), Vitest der Fehlerzuordnung. Systembeispiele als eigene Lesewurzel = Design-/Konfigurationsentscheidung, nicht Teil dieses Fixes |
| UI-K16 (1) Makro-Entwurf / Assistent | **umgesetzt** `c7a32ba` | Eine Schließwache für Settings: X, Hintergrund und jeder Header-Wechsel fragen `SettingsPanel.unsavedDraft()` (geänderter Makro-Entwurf gegen den Öffnungs-Snapshot, laufender Gamepad-Assistent) → „Discard changes?“ (Keep editing / Discard, registrierter Modal); Discard führt die auslösende Navigation aus. e2e über alle drei Wege; der Assistentenfall ist mangels Gamepad nur im Code verdrahtet |
| UI-K16 (2) laufender Import | **umgesetzt** `c7a32ba` | `cancelImport` kehrt bei `importBusy` zurück; X und Cancel gesperrt mit Titel „Import in progress“, Hintergrund wirkungslos. e2e mit zurückgehaltener Antwort |
| UI-K16 (3) Fokus hinter dem Dialog | Design-Welle | gehört zum gemeinsamen `DialogFrame` (UI-K11) mit ausdrücklicher Modalitätsentscheidung; Safety-Bereich und Eingabehilfen bleiben erreichbar |
| UI-K01, K02 | Design-Welle | Eingabehilfen-Hülle mit festem Schließanker; räumliche Tastengruppen — beides gegen das 264-px-Strip-Budget zu messen |
| UI-K03, K04, K05 | Design-Welle | Kontrollhöhen je Dichte, ein Formularraster, gemeinsames Bereichsmuster (Tools + MDI als Referenz) |
| UI-K06, K07 | Design-Welle | Header-Gewichtung, Werkzeugtabelle (Beschreibung vor technischen Spalten, getrennte Leerzustände, `aria-sort`) |
| UI-K08, K09 | Design-Welle | Viewer- und Syntaxpaletten je Theme, Textrollen statt Opazität, Fokusfarbe getrennt von Info-Blau — Kontrastziele wie vorgeschlagen |
| UI-K10, K11, K12 | Design-Welle | FormField mit Label-Verknüpfung außerhalb der Single-Root-Controls, Dialog-Fokusführung (Escape bleibt E-Stop), Tabs mit `tablist`-Semantik |
| UI-K13 | Design-Welle | Touch-Ziele 44/36 px, abgesicherter Tastaturweg für Hold-Aktionen (eigene Sicherheitsentscheidung), `prefers-reduced-motion`/`forced-colors` |
| UI-K14 | Design-Welle | Inventar: Maschinenrollen behalten, visuelle Achsen straffen, Bausteine Control/FormField/ActionGroup/DialogFrame/InputHelperFrame |
| UI-K17 | Design-Welle | Fünf feste Haupttabs + beschriftete Verfahrensauswahl als Ausgangspunkt; Off/FWD/REV als Optionsgruppe; die Schwelle für die Auswahl-Navigation und die Gesamtaufteilung bei starkem Zoom im Produkt messen |



## Codex-Nachprüfung · Runde 8 · 23. September 2026

**UI-K15 sowie UI-K16 (1)/(2) sind unabhängig nachgeprüft und akzeptiert.** Der Ordnerfilter
schließt die fünf externen Links des installierten `nc_files` aus; interne Gegenbeispiele bleiben
öffnbar. Im Browser behält eine dauerhafte Ablehnung die alte Liste ohne Retry, ein vorübergehender
Fehler lässt sich erfolgreich wiederholen. Makroentwürfe bleiben auch nach Wechsel des
Settings-Untertabs geschützt. Der Gamepad-Assistent ist jetzt zusätzlich mit simulierter Geräte-API
geprüft: Keep editing erhält den Schritt, Discard führt die auslösende Header-Navigation aus.
Der reguläre Importfall mit zurückgehaltener Antwort besteht im vollständigen Offline-Lauf.

[Messungen, Gate und Nachweisgrenzen](ui-optimierungen.implementation-review.md#codex-implementierung-runde-8).
**UI-K16 (3) / Fokusführung, UI-K01–K14/K17 bleiben Design-Welle** entsprechend der dokumentierten
Entscheidung. Die geschlossenen Funktionsfehler bedeuten keine Abnahme dieser Gestaltungspunkte.
