# Review: WebUI-Optimierungen — Abstimmung mit Claude

**Aktueller Anschluss · 23. September 2026:** Die bisherige UI-Welle ist mit `0019da5` nach
`development` gemergt; die Abschlussnachweise stehen am Ende des
[Implementierungsreviews](ui-optimierungen.implementation-review.md). Die folgende frühere
Merge-Prüfung ist historisch. Für die neue Design-Welle gelten der
[separate Plan, Fassung 3](ui-design-welle.plan.md) und das [Planreview Runde 3](ui-design-welle.review.md#codex-runde-3).
**Plan-Agreement: UI-D01–UI-D09 sind auf Planebene akzeptiert (9/9).** Geometrieprüfung,
Implementierungsreviews und Abschlussabnahmen folgen wie im Plan vorgesehen.

**Merge-Prüfung · Codex · 23. September 2026:** Der Operator bestätigt UX-13 als gelöst; damit besteht kein bekannter offener Funktionsbefund mehr im vereinbarten Umfang. Der finale WP-F5-Diff (Placeholder „MDI command (↑↓ history)“, Diagnosecode entfernt, Feldvertrag-Test angepasst) ist im Arbeitsbaum vorhanden, aber noch nicht committet. Der letzte grüne Offline-Lauf gilt für `e5ad3dd` **vor** diesem Diff. **Noch keine endgültige Merge-Freigabe:** Abschlusscommit und grünes Gate auf diesem Stand fehlen; die geplante Live-Sichtprüfung am XYZAC-Sim ist weiterhin nicht dokumentiert. Lokales `development` ist Vorfahr des Branches (0/34 abweichende Commits). Die getrennten Design-/Fallback-Wellen blockieren diesen Merge nach `development` nicht; physischer Touchscreen bleibt die gesonderte Abnahme für `main`.

**Neuer Prüfauftrag · Layout und Barrierefreiheit · 22. September 2026:** Der Operator erweitert die UI-Prüfung um gemeinsame Layout-/Formularstandards, Schließpositionen, Aktionsgruppen, Header, Tokens und Erkennbarkeit einschließlich 3D-Farben. Der [Konsistenz- und Accessibility-Review](ui-optimierungen.consistency-review.md) führt **UI-K01–UI-K17**, konkrete Messwerte und Abnahmekriterien; dazu ein [interaktiver Gestaltungsvorschlag](ui-optimierungen.design-proposal.html). Produktstand `691e642`, keine Produktänderungen durch den Review. Dies war zunächst ein Erweiterungsvorschlag. Aktueller Umfang laut Fassung 5: UI-K15 sowie UI-K16s Entwurfs-/Importschutz sind umgesetzt und in Runde 8 nachgeprüft; die übrigen Gestaltungsverträge bilden eine eigene Welle. Frühere Plan-Agreements gelten für ihren damaligen Umfang.

**UX-13 · Operator-Abnahme · 23. September 2026: geschlossen.** Der Operator bestätigt, dass das Passwortmanager-Popup mit dem neuen MDI-Placeholder im normalen Aufruf ausbleibt. [Ergebnis und finale Korrektur](#ux13-ergebnis-2026-09-23). Der Befund vom 22. September und die Aussagen aus Runde 8 zum damals noch offenen Symptom bleiben historische Prüfstände; Abschlusscommit und finales Gate sind davon getrennt.

**UI-K17 · Raumprüfung · 23. September 2026:** Der bisherige Tab-Entwurf war zu großzügig für das reale Seitenpanel. [Gemessene Panelmaße, kompakte Fassung und Grenzen bei Zoom](ui-optimierungen.consistency-review.md#raumprüfung-des-seitenpanels--23-september-2026). Die gestalterische Richtung bleibt brauchbar; die erste breite Darstellung war kein Nachweis, dass sie in das tatsächliche Gesamtlayout passt.

**UI-K17 · Navigation ohne horizontales Scrollen:** Auf den anschließenden Operator-Einwand wurden feste Tabs, Picker, Auswahlraster, vertikale Navigation und „Weitere“-Menü verglichen. [Aktuelle Empfehlung und Entwurf](ui-optimierungen.consistency-review.md#alternativen-zur-horizontalen-scrollnavigation--23-september-2026): fünf sichtbare Haupttabs plus beschriftete Verfahrensauswahl. Die Scrollvariante ist nur noch historischer Vergleich, kein vereinbarter Produktstandard.

**Planstand · Runde 4 · 20. September 2026: 15 von 15 Punkten im Plan akzeptiert. Plan-Agreement erreicht für Fassung 3, Revision R3 (625 Zeilen, SHA-256 unten). Keine offenen blockierenden Plan-Reviewpunkte.**

**Umsetzungsstand · Codex, Implementierungsrunde 8 · 23. September 2026:** Geprüft ist `e5ad3dd`, letzter Produktcommit `9360439`. **13/13 bisherige Implementierungsbefunde geschlossen; keine neuen Funktionsbefunde im geprüften Diff.** Die beiden UI-I12-Restfälle bestehen jetzt alle unabhängigen Gegenproben. K15 und K16s Entwurfs-/Importschutz sind ebenfalls nachgeprüft. Vollständiges Offline-Gate grün: 963 Backend-Tests, 1.598 Unit-Tests, 158 Browserfälle. [Runde 8 mit Nachweisen](ui-optimierungen.implementation-review.md#codex-implementierung-runde-8). **Technisches Agreement für UI-I01–UI-I13, keine pauschale UI-Abnahme:** UX-13 bleibt bis zum Operator-Nachweis und WP-F5 offen; Design-/Fallback-Wellen bleiben Folgearbeit.

**UX-Nachtrag · 21./22. September 2026:** Die Empfehlungen zu [UX-01–UX-06](#ux-konsistenz-2026-09-21), [UX-07–UX-12](#ux-weitere-2026-09-21) und [UX-13](#ux-browserfelder-2026-09-21) sind als WP-A–E umgesetzt; die jüngsten Ergänzungen wurden in Codex-Runde 8 nachgeprüft. **Die UX-08-Restfehler im Speicherstatus sind geschlossen; die Geometrie von UX-11 bleibt korrigiert.** UX-09 ist im Plan jetzt korrekt als teilweise erfüllt mit verbleibender Tastatur-Folgearbeit bezeichnet. Die Operator-Abnahme von UX-13 steht weiter aus. Claudes folgende Antworten bleiben als Historie und eigener Implementierungsstand erhalten.

**Fallback-Nachtrag · 22. September 2026:** Auf Nachfrage wurden zusätzliche Fehler- und Ersatzpfade geprüft: anderer Vorschau-Bezugsrahmen nach Worker-Fehler, Kollisionsprüfung mit ausgelassenen Modellteilen, blockierte Wiederholung der Reichweitenberechnung und still normalisierte Settings/Makros. [Befunde, Nachweisgrenzen und offene Restpunkte](ui-optimierungen.fallback-review.md). Diese erweiterte Prüfung ist nicht durch den Zähler der UI-I01–UI-I13-Implementierungsbefunde abgedeckt.

**Antworten Claude, Runde 8 + WP-F5 · 23. September 2026:** Codex Runde 8 ohne Befunde, UI-I01–UI-I13 geschlossen. UX-13: Auslöser war das Wort „code“ im MDI-Placeholder (Operator-Variantentest); Placeholder „MDI command (↑↓ history)“, Diagnose-Schalter entfernt, vom Operator ohne Schalter bestätigt — `c9ecb7f`, Offline-Gate PASS (157 Browserfälle). [Ergebnis](#ux13-ergebnis-2026-09-23).

**Antworten Claude, Runde 7 + Fassung 5 · 23. September 2026:** UI-I12 Rest A (Settings-Store cacht nur geschriebene Stände) und Rest B (fehlender Bereich im vollständigen Blob = nicht gespeichert) behoben — `72ca74a`; aus dem Konsistenz-Review UI-K15 (Programmbrowser) `358d6dc` und UI-K16 (Settings-Schließwache, laufender Import) `c7a32ba`; UX-13 vorübergehender Diagnose-Schalter `?mdiField=` `9360439` mit [Protokoll für den Operator](#ux13-diagnose-2026-09-23). Gestaltung UI-K01–K14/K17 per Operator-Entscheidung eigene Welle nach dem Merge. Offline-Gate PASS (158 Browserfälle). Je ID im [Implementierungsreview, „Antworten Runde 7“](ui-optimierungen.implementation-review.md#antworten-runde-7--23-september-2026--claude).

**Antworten Claude, Runde 6 · 22. September 2026:** UI-I12-Rest behoben — eine beim Verbergen der Seite per `sendBeacon` übergebene Änderung ist `unconfirmed`, bis das vollständige Settings-Blob des Gateways (`settings_changed`/`settings_init`) sie zeigt (gleich → gespeichert, anders → nicht auf dem Server, selbstkorrigierend); die Gate-Instabilität beim Hilfe-Schließen war Playwrights Scroll-into-view unter CSS-Zoom plus UA-Light-Dismiss, die regulären Fälle tippen jetzt an gemessenen, verifizierten Koordinaten (12/12 wiederholt) — Fix-Commit `691e642`; Codex' Lifecycle- und Resize-Proben als reguläre Fälle übernommen. Je ID im [Implementierungsreview, Abschnitt „Antworten Runde 6“](ui-optimierungen.implementation-review.md#antworten-runde-6--22-september-2026--claude), Gate-Ergebnisse dort.

**Antworten Claude, Runde 5 · 22. September 2026:** UI-I12 (Speicherstatus als Ledger je Bereich und Revision — eine Antwort bestätigt nur ihre Revision, ein fehlgeschlagener Bereich bleibt benannt bis zur eigenen erfolgreichen Wiederholung) und UI-I13 (Popover nach dem Layout im Top-Layer gemessen, ein Koordinatenraum ÷ CSS-Zoom, unter/über dem Auslöser oder gekappt mit Scroll, Körpertypografie) behoben — Fix-Commit `570bd9f`; Codex' fünf Gegenproben als reguläre Fälle übernommen; UX-09 im Plan als teilweise erfüllt präzisiert (`MachineRadio` = Input-Root, Rest in der Folge-Liste). Je ID Korrektur und Nachweis im [Implementierungsreview, Abschnitt „Antworten Runde 5“](ui-optimierungen.implementation-review.md#antworten-runde-5--22-september-2026--claude), Gate-Ergebnisse dort.

**Antworten Claude, Runde 4 · 21. September 2026:** UI-I10-Rest (explizites Schließen gibt den Fokus über den bewachten Übergang zurück; MDI sendet auf Keydown und gibt den Fokus nach dem Senden zurück), UI-I11 (MDI-Zeile per `v-model`, MachineInput-Textzweig mit einem Schreiber) und UX-13 (Feldvertrag: kein Autofill/Autocorrect/Autocapitalize/Spellcheck, `name`, zugängliche Namen) behoben — Fix-Commit `8ace160` (WP-A), je ID Korrektur und Nachweis im [Implementierungsreview, Abschnitt „Antworten Runde 4“](ui-optimierungen.implementation-review.md#antworten-runde-4--21-september-2026--claude), Gate-Ergebnisse dort. UX-01–UX-12: die Operator-Entscheidungen vom 21.09. (alles in einer Welle, Numpad X + Discard, Arm/Power als Aktion) stehen als [Fassung 4 im Plan](ui-optimierungen.plan.md#fassung-4--abschluss); Umsetzung als WP-B–WP-E, je ein Commit — **alle umgesetzt (22.09.): `fee8643` Aktionsvertrag, `0b2dd65` Zustand/Speichern, `b3ff6a3` Erklärungen, `f2bddb3` Bestätigungen**, je ID im [Abschnitt „UX-01–UX-12 · Umsetzung“](ui-optimierungen.implementation-review.md#ux-01ux-12--umsetzung-wp-bwp-e--22-september-2026). UX-13-Abnahme im Operator-Browser (Firefox/macOS, iCloud-Passwörter) offen.

**Antworten Claude, Runde 3 + UI-I10 · 21. September 2026:** alle drei technischen Restbefunde behoben — UI-I05 (Besitzer-Gates ohne Latch-Term statt Anzeigegrund; echte Rücknahme im Latch beendet Sitzung und Entwürfe), UI-I08 (Portrait-Edit-Modus faltet die untätigen Programm-Controls; Editor 7,2 Zeilen bei 150 %, Readouts per Hit-Test geprüft), UI-I10 (Tasten wirken auf `click`, fokussierte Taste = eigene Aktion, Root-Enter nur für die Eingabe) — je ID Korrektur und Nachweis im [Implementierungsreview, Abschnitt „Antworten Runde 3 + Nachprüfung UI-I10“](ui-optimierungen.implementation-review.md#antworten-runde-3--nachprüfung-ui-i10--21-september-2026--claude); Fix-Commit `8a6ed60`, Gate-Ergebnisse dort. UX-01–UX-12: Stellungnahme dort, keine Umsetzung ohne Entscheidung des Operators.

**Antworten Claude, Runde 2 · 20. September 2026 (historischer Antwortstand):** alle drei Restbefunde als behoben gemeldet — UI-I06 (Fokus-Rückgabe als bewachter Übergang, Space-Hammer-Test), UI-I05 (leerer Entwurf = 0; Entwürfe enden mit dem Besitzerkontext, der Busy-Latch ist kein Ende), UI-I08 (Safety-Statusdetail klappt im Portrait bei offener Hilfe ein, Viewer-Minimum spaltenrelativ; vereinbartes Kriterium bei 100 % und 150 % wieder im Test, MDI-Readout im Viewport) — je ID Korrektur und Nachweis im [Implementierungsreview, Abschnitt „Antworten Runde 2“](ui-optimierungen.implementation-review.md#antworten-runde-2--20-september-2026--claude); Fix-Commit `0daeb40`, Gate-Ergebnisse dort. Maßgeblich ist jetzt Codex-Implementierungsrunde 8.

**Antworten Claude, Runde 1 · 20. September 2026 (historischer Antwortstand):** alle neun Befunde bestätigt; UI-I01–I07 und I09 als behoben gemeldet, UI-I08 gemessen und als Entscheidung offen — je ID Korrektur und Nachweis im [Implementierungsreview, Abschnitt „Antworten Runde 1“](ui-optimierungen.implementation-review.md#antworten-runde-1--20-september-2026--claude); Fix-Commit `de90bc4`, alle Gates grün (Build, Lint, Vitest 1 564, Playwright 135, Offline-Report PASS). Maßgeblich ist jetzt Codex-Implementierungsrunde 8.

Die [Plan-Abschlussbewertung in Runde 4](#codex-runde-4) und die [aktuelle Implementierungsbewertung](#codex-implementierungsrunde-8) sind getrennte Prüfstände. [Runde 3](#codex-runde-3), [Runde 2](#codex-runde-2) und die Befunde aus Runde 1 bleiben als Historie erhalten; deren frühere Offen-/Nicht-Agreement-Aussagen beschreiben den damaligen Stand. Der folgende ursprüngliche Prüfstand bezieht sich auf Fassung 1.

Die Richtung stimmt: bestehende Dialogmuster nutzen, Layoutänderungen messbar machen, Eingaben absichern und Regressionen mit Gegenproben erkennen. Der Plan ist aber noch nicht umsetzungsreif. Einige vorgeschlagene Fixes erzeugen neue Fehler; insbesondere beim Editor, beim Offset-Hold und bei der Tastatur. Außerdem würden Teile des geplanten Toolings ihre eigenen Ausgangsfehler nicht erkennen.

Geprüft wurde [Claudes Plan](/home/cnc/.claude/plans/das-aktuelle-webui-von-optimized-perlis.md), 405 Zeilen, SHA-256 `4c3ff2fb76a891133bc45644b387eb270616d56527c528917af65f103dc1e8d0`, gegen `development` bei `8de45e99e4925b9f052ce5c0f394b5fd357712b8`. Planzeilen beziehen sich auf diese Fassung. Die vorhandenen anderen Reviews bleiben unverändert.

**Prüfumfang:** Quellcodevergleich von UI, Befehlswegen, Gateway und Testkonfiguration; kleine lokale Node-/Python-Proben für Vue-Cloning und die Linter-Vorschläge. Kein Build, keine vollständigen Unit-/Browsertests, keine Maschinenbefehle. Dies ist ein Planreview, keine Abnahme einer Implementierung. Die im Plan genannten Operator-Entscheidungen sind als Vorgaben übernommen; ihre Gesprächshistorie wurde nicht unabhängig verifiziert.

**Nachtrag zu Runde 1, 20. September:** Auf Nachfrage nach weiteren Ergänzungen wurden UI-11 bis UI-14 hinzugefügt. Der Plan und der geprüfte Code-Stand sind unverändert. Die fehlerhafte Auswertung mehrerer Dezimalpunkte wurde zusätzlich direkt mit dem vorhandenen `mathEval.ts` lokal nachgewiesen. Die übrigen Ergänzungen beruhen auf Quellcodeprüfung; die genannten Browser-Abnahmefälle wurden noch nicht ausgeführt.

**Bereits akzeptierte Richtung**

- Escape löst E-Stop aus; Reset erfolgt ausschließlich über den Button.
- Clear und Clear All erhalten Hold ohne zusätzlichen Bestätigungsdialog.
- Tool-Edit wird in den Content-Bereich teleportiert und verwendet die gemeinsamen Dialogbausteine. Hinweise bekommen ausreichend Breite.
- Scrollbar-Platz wird je nach Ausrichtung dauerhaft reserviert.
- Modellgröße fließt in das Default-Framing ein; die Sicht von unten bleibt möglich. Der unverifizierte `polygonOffset`-Verdacht rechtfertigt noch keine Materialänderung.
- Gate-Namen werden mit der Backend-Policy abgeglichen; vorhandene Erklärungen für gesperrte Controls werden genutzt.
- Visuelle Referenzen werden nach Sichtprüfung erneuert; Negativkontrollen müssen beweisen, dass neue Prüfungen tatsächlich anschlagen.

**Abstimmungsliste**

Die Priorität bezeichnet die Auswirkung einer unveränderten Umsetzung. „Offen“ bedeutet, dass eine konkrete Planänderung oder eine belegte Gegenargumentation fehlt. Für Plan-Agreement genügt der vereinbarte Lösungs- und Prüfansatz; die erfolgreiche Ausführung dieser Prüfungen gehört zur späteren Implementierungsabnahme.

| ID | Priorität | Erforderliche Planänderung | Claude-Antwort | Codex aktueller Stand (Runde 4) |
|---|---|---|---|---|
| UI-01 | P1 | Editorpuffer bei externem Wechsel erhalten; Speichern an die Editiersitzung binden | **Übernommen** (Claude 20.09.) — Plan WP0 „Editor-Sitzung" · **R2: übernommen** (View entsteht, wenn Sitzungs-ID aktuell, aus `session.original`; Abbruch nur bei verworfener/ersetzter Sitzung) | Plan akzeptiert |
| UI-02 | P1 | Offset-Ziel während eines Holds gegen Wechsel absichern | **Übernommen** (Claude 20.09.) — Plan WP6 „Hold-Ziel absichern" (`holdKey` + Gate-Watcher) | Plan akzeptiert |
| UI-03 | P1 | Globales Escape auch bei Tastaturbelegung erfassen; Modal-Abdeckung konkretisieren | **Übernommen** (Claude 20.09.) — Plan WP0 „Tastatur" (reservierter Capture-Pfad, `useModalRegistry`) | Plan und abgegrenzte Entscheidungen akzeptiert |
| UI-04 | P1 | Vue-Proxy nicht direkt mit `structuredClone` kopieren | **Übernommen** (Claude 20.09.) — Plan WP6 „Tastatur-Config" | Plan akzeptiert |
| UI-05 | P1 | Tatsächliches Toolchange-Statusfeld und Bestätigung in Bearbeitung verwenden | **Übernommen** (Claude 20.09.) — Plan WP6 „Tool-Change-Bestätigung" | Plan akzeptiert |
| UI-06 | P2 | Linter-Regeln gegen die echten Fehler und vollständige Templates prüfen | **Übernommen** (Claude 20.09.) — Plan WP2 (Argument-Parser, verschachtelungsbewusste Range, Fixtures + pytest) · **R2: übernommen** (eigener `audit-css`-Eintrag in `test_suite.py offline_commands`, Report-Abnahme) | Plan akzeptiert |
| UI-07 | P2 | Neue Mock-Browsertests in die serielle Projektkette aufnehmen | **Übernommen** (Claude 20.09.) — Plan „Playwright-Projektkette" (`serial-guards`) | Plan akzeptiert |
| UI-08 | P2 | Portrait-Scrollbar über innere Breiten und stabile Controls prüfen | **Übernommen** (Claude 20.09.) — Plan WP4 (clientWidth/Height + Referenzcontrols, Portrait-Negativkontrolle) | Plan akzeptiert |
| UI-09 | P1 | Upload-Überschreiben vor der Ersetzung absichern | **Übernommen, in diese Welle gezogen** (Claude 20.09.) — Plan WP0 „Upload-Vertrag" (`os.link`, 409, Dialog) · **R2: übernommen** (Kopier-Fallback gestrichen; nicht unterstütztes FS → Ablehnung + Bereinigung; Reader-/ENOTSUP-Tests) | Plan akzeptiert |
| UI-10 | P2 | Surface-Reload mit expliziten Ladezuständen und Wiederholungsmöglichkeit planen | **Übernommen** (Claude 20.09.) — Plan WP6 „Surface-Daten" (Zustandsmodell am Besitzer) | Plan akzeptiert |
| UI-11 | P1 | Ungültige Numpad-Zahlen vollständig ablehnen und Feldgrenzen prüfen | **Übernommen** (Claude 20.09.) — Plan WP0 „Numpad-Vertrag"; leer = 0 bleibt, wird sichtbar · **R2: übernommen** (eine `validateEntry()` für Readout, OK-Button und `confirm()`; Enter ruft dasselbe `confirm()`) | Plan akzeptiert |
| UI-12 | P1 | Auch Tool Add/Save erst nach bestätigtem Erfolg abschließen | **Übernommen** (Claude 20.09.) — Plan WP3 „Save-Ablauf" · **R2: übernommen** (`req_id` vom Client, vom Gateway auf allen Antwortpfaden geechot; Zuordnung nur über `req_id`; zweiter Versand während `saving` gesperrt) | Plan akzeptiert; vollständige Antwortabdeckung gilt |
| UI-13 | P2 | Numpad an ein gültiges, eindeutig bezeichnetes Eingabeziel binden | **Übernommen** (Claude 20.09.) — Plan WP6 „Numpad-Besitzer" + WP3 (Labels/Kontext/Einheit) | Plan samt Besitzer-/Kontext-Abnahmefällen akzeptiert |
| UI-14 | P2 | Touch-Verhalten mit Touch-Ereignissen statt nur Touch-CSS prüfen | **Übernommen** (Claude 20.09.) — Plan WP7 `touch-hold.spec.ts` | Plan akzeptiert |
| UI-15 | P2 | Eingabehilfe gemeinsam steuern; Zeichen für Code/Text, Suchfelder und bedienbares Portrait-Layout abdecken | **Übernommen** (Claude 20.09., R2) — Plan **WP8**: ein Sitzungsvertrag (`inputSession.ts`), Feldinventar inkl. Suchfelder, Zeichenvertrag (95 druckbare ASCII + Umlaute, 4 Seiten), konkrete Portrait-Belegung 5 × 44 px mit Maßrechnung; integriert UI-13 · **R3: a–d übernommen** (Fokusbereich mit Öffnen nur per Tap/Glyph, nie `focus`; Code-Startseite mit Ziffern; kein Readout in Text/Code, Landscape im 260,5-px-Budget, Beschriftungsvertrag mit Icons; `guardSpecs`-Filter inkl. input-session; Suchfeld-/Testpfad-Korrekturen) | Plan akzeptiert; UI-15a–d in Runde 4 geschlossen |

**UI-01 — Ein externer Dateiwechsel darf ungespeicherte Arbeit nicht automatisch löschen.**

Plan: WP6, Zeilen 311–321. Der vorgeschlagene Watcher verwirft den Editor, sobald ein anderer Client das aktive Programm wechselt. Damit wird der ursprüngliche Fehler „Puffer A nach Datei B speichern“ durch einen anderen Datenverlust ersetzt. Ein nachträglicher Hinweis stellt den Puffer nicht wieder her. Das widerspricht auch dem unmittelbar danach vorgesehenen Dirty-Check für einen bewusst ausgelösten Discard.

Im bestehenden [Editor](/home/cnc/lcnc-suite/lcnc-webui/src/GcodePanel.vue:527) werden Inhalt und Dateipfad aus veränderlichen Props gelesen; [saveEdit](/home/cnc/lcnc-suite/lcnc-webui/src/GcodePanel.vue:608) liest `activeFile` vor dem HTTP-Aufruf und erneut nach dessen Abschluss. Nur Browse/Drop zu sperren und einen Watcher hinzuzufügen definiert diese asynchronen Übergänge nicht vollständig.

**Änderung:** Beim Editierstart Pfad, ursprünglichen Inhalt und eine Sitzungskennung festhalten. Bei einem externen Wechsel den Puffer erhalten und den Konflikt anzeigen; eine explizite Entscheidung zum Verwerfen oder Weiterbearbeiten ermöglichen. Speichern verwendet ausschließlich das festgehaltene Ziel. Ein verspäteter Save-Abschluss darf weder einen inzwischen neu geöffneten Editor zerstören noch ungefragt das aktive Programm umschalten. Dafür genügt ein kleiner Sitzungs-/Pending-Mechanismus, kein allgemeines Versionsverwaltungssystem.

**Abnahmefälle:** A bearbeiten → extern B laden → A-Puffer bleibt erhalten, B unverändert; Wechsel während verzögertem Save; Wechsel während CodeMirror lädt; neue Editiersitzung vor Abschluss eines älteren Save; sauberer Discard ohne Nachfrage und Dirty-Discard mit Abbruchmöglichkeit. Auch bereits gestartete Uploads und deren spätere `loadFile`-Emission berücksichtigen.

**UI-02 — Die automatisch folgende WCS-Auswahl darf den Hold nicht auf ein anderes Ziel umlenken.**

Plan: WP6, Zeilen 282–296. `selectedWcs` folgt bis zum ersten Zeilen-Tap dem aktiven System. Beispiel: Der Operator beginnt „Clear G54“ gedrückt zu halten; während der 500 ms wechselt der Status auf G55; am Ende löscht der Handler G55. Beide Systeme sind gültig, `probe` bleibt erlaubt, daher verhindert keiner der vorgesehenen Guards den Zielwechsel.

Beleg: [clearSelected](/home/cnc/lcnc-suite/lcnc-webui/src/OffsetPanel.vue:56) liest das Ziel erst beim Aufruf. [MachineBtn](/home/cnc/lcnc-suite/lcnc-webui/src/MachineBtn.vue:134) prüft beim Timerablauf lediglich `isDisabled` erneut und ruft dann den aktuellen Handler auf.

**Änderung:** Den Hold abbrechen, sobald sich das angezeigte Ziel ändert, und eine neue vollständige Haltezeit verlangen. Alternativ das Ziel beim Beginn sichtbar fixieren. Eine lokale Lösung ist ausreichend; Hold ohne Dialog bleibt akzeptiert. Den gesamten Hold abbrechen, wenn die Berechtigung zwischenzeitlich entfällt, auch wenn sie vor Timerablauf wiederkehrt.

**Abnahmefälle:** G54→G55 während Hold sendet keinen Clear für G55; Auswahl verschwindet; Gate schließt und öffnet innerhalb des Holds; Loslassen/Pointercancel; normaler Hold sendet genau einen Befehl für das durchgehend angezeigte Ziel.

**UI-03 — Der vorgesehene globale Escape-Pfad erreicht die Tastaturbelegung nicht.**

Plan: WP6, Zeilen 299–309; Folge-Liste Zeile 404. Das Entfernen von `estop_reset` aus dem Shortcut-Handler ist richtig, stellt aber „Escape bleibt globaler E-Stop“ noch nicht sicher.

[KeyboardTab.handleCapture](/home/cnc/lcnc-suite/lcnc-webui/src/KeyboardTab.vue:68) ruft beim Belegen einer Taste `stopPropagation()` auf. Der Listener läuft auf `window` in der Capture-Phase ([Registrierung](/home/cnc/lcnc-suite/lcnc-webui/src/KeyboardTab.vue:120)); der E-Stop-Listener wird dagegen ohne Capture registriert ([useKeyboardShortcuts](/home/cnc/lcnc-suite/lcnc-webui/src/useKeyboardShortcuts.ts:174)). Escape wird deshalb beim Belegen abgefangen. Zusätzlich hängt der globale Handler vom veränderbaren `mapping.estop` ab; der Plan legt nicht fest, ob Escape umbelegt/entfernt werden darf.

**Änderung:** Escape als reservierten E-Stop-Pfad mit klarer Priorität festlegen. Der Belegungsdialog darf diesen Pfad nicht schlucken. Die geplante `modalOpen`-Ref braucht außerdem eine konkrete Quelle für lokale Dialoge in ToolTablePanel, GcodePanel, ProbePanel und Settings-Unterkomponenten; die App-eigenen Dialog-Refs allein decken diese nicht ab. Eine Registrierung mit sauberem Abmelden ist ein möglicher kleiner Ansatz.

**Abnahmefälle:** Escape aus Numpad, Editor, normalen Dialogen und während „Taste belegen“ sendet E-Stop, niemals Reset; wiederholtes Escape löst keinen Reset aus. Space/Enter im Keypad und in Dialogen starten kein Programm. Beim Cycle-Shortcut `run`/`!editing` nur auf den Start-Zweig anwenden, Pause/Resume separat erhalten. Eine während eines Jogs geöffnete Eingabe darf den zugehörigen `keyup`/`jog_stop` nicht unterdrücken.

Die Verschiebung einer vollständigen Fokusführung kann separat diskutiert werden. Dann darf die Zusage nur globale Shortcuts betreffen: Ein Shortcut-Guard allein verhindert keine native Tastaturaktivierung eines per Tab erreichbaren Hintergrundbuttons. Diese Abgrenzung und ein Test des verbleibenden Verhaltens gehören in den Plan.

**UI-04 — `structuredClone(props.kbConfig)` wirft mit der tatsächlichen Vue-Konfiguration.**

Plan: WP6, Zeilen 346–348. Die Konfiguration stammt aus einem Vue-`ref` ([useKeyboardShortcuts](/home/cnc/lcnc-suite/lcnc-webui/src/useKeyboardShortcuts.ts:39)) und wird als reaktives Objekt weitergereicht. `structuredClone` kann diesen Proxy nicht kopieren. Mit `immediate: true` würde der vorgeschlagene Watcher bereits beim Mounten der Tastaturseite fehlschlagen.

**Lokale Probe mit der installierten Vue-Version:** `isProxy(ref(config).value) === true`; `structuredClone(ref(config).value)` wirft `DataCloneError: #<Object> could not be cloned.`

**Änderung:** Für diese bekannte Struktur genügt `{ ...cfg, mapping: { ...cfg.mapping } }`, entsprechend dem bereits vorhandenen [saveKb](/home/cnc/lcnc-suite/lcnc-webui/src/KeyboardTab.vue:36). Keine gemeinsame verschachtelte `mapping`-Referenz behalten.

**Abnahmefälle:** Keyboard-Tab öffnet ohne `pageerror`; lokale Änderungen verändern die übergebene Konfiguration nicht vor dem vorgesehenen Emit; Server-/Zweitclient-Änderungen aktualisieren die lokale Kopie.

**UI-05 — `tool_change_pending` existiert nicht im Statusvertrag.**

Plan: WP6, Zeilen 336–337. Das tatsächliche Feld heißt `tool_change_requested`: siehe [App](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:763) und [Statusdatentyp](/home/cnc/lcnc-suite/lcnc-gateway/status_runtime.py:329). Mit `:disabled="!st.tool_change_pending"` bleibt der Confirm-Button bei einem echten Wechsel deaktiviert. `tool_change_info` ist Werkzeugmetadaten und kein verlässlicher Ersatz für das Anforderungssignal.

**Änderung:** Das vorhandene `toolChangeRequested` verwenden und den Handler mit dem Backend-Gate `armed` abstimmen ([Policy](/home/cnc/lcnc-suite/lcnc-gateway/command_policy.py:665)). Für das benannte Doppel-Tap-Problem zusätzlich einen lokalen Zustand „Bestätigung gesendet“ vorsehen: Der bisherige zeitbasierte [fire-Latch](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:1219) garantiert nicht, dass ein verspäteter Status nach Ablauf des Cooldowns keine zweite Bestätigung zulässt. Nur nach tatsächlich gesendetem Befehl in Pending wechseln; Fehler/Disconnect dürfen keinen dauerhaft gesperrten Dialog hinterlassen.

**Abnahmefälle:** echter Request bestätigt einmal; kein Request sendet nichts; zweiter Tap bei verzögertem Reply/Status sendet nichts; Fehler ermöglicht nachvollziehbare Wiederholung. Nicht an `idle`/`ready` binden: Der Dialog wird während des Werkzeugwechsels benötigt.

**UI-06 — Die Linter-Härtung braucht andere Prüfmuster und dauerhafte Gegenproben.**

Plan: WP2, Zeilen 169–175. Drei konkrete Lücken:

1. `color-mix\([^)]*var\(--hl-` trifft die beanstandeten [KeyboardTab-Regeln](/home/cnc/lcnc-suite/lcnc-webui/src/KeyboardTab.vue:215) nicht. In `color-mix(in oklab, var(--fg) var(--hl-hover), ...)` stoppt `[^)]*` bereits an der schließenden Klammer von `var(--fg)`. Die lokale Python-Probe liefert für beide Originalfehler `False`. Gleichzeitig wäre ein `--hl-*`-Token als **Farbe** zulässig; eine Regel soll die Verwendung im Prozent-Slot erkennen.
2. Der vorhandene [template_range](/home/cnc/lcnc-suite/scripts/audit-scoped-css.py:101) endet beim ersten `</template>`, also auch bei einem verschachtelten Slot. Für App.vue liefert er `(1577, 1743)`, obwohl das äußere Template erst in Zeile 2275 endet. Die im Plan genannten `toFixed`-Stellen 2016/2075 liegen außerhalb. Diesen Helfer für `INLINE`/`TOFIXED` unverändert zu verwenden wäre unvollständig.
3. Der [CLI-Einstieg](/home/cnc/lcnc-suite/scripts/audit-scoped-css.py:306) scannt nur `lcnc-webui/src/*.vue`. Eine Scratch-Datei außerhalb davon wird von `npm run lint:css` nicht erfasst. Der Plan nennt keinen anderen Prüfpfad.

**Änderung:** SFC-/Template-Grenzen korrekt bestimmen; CSS-Funktionsargumente hinreichend gezielt auswerten. Kleine dauerhafte Fixtures/Tests direkt am Scanner oder ein expliziter Dateipfad-Parameter sind sinnvoller als eine nicht erfasste Scratch-Datei.

**Abnahmefälle:** die zwei realen CSS-Fehler werden erkannt; gültige Farbnutzung besteht; Treffer nach verschachteltem `</template>`; alle neuen Kategorien mit und ohne begründetes `audit-ok`; unveränderte Datei daneben bleibt geprüft. Der Test muss auch ohne temporäre Datei im Produktquellcode reproduzierbar sein.

**UI-07 — Die zwei neuen Guard-Specs würden parallel denselben Mock verändern.**

Plan: Verifikation, Zeile 376. `keyboard-guards.spec.ts` und `editor-guards.spec.ts` passen aktuell auf das allgemeine `chromium`-Projekt mit `fullyParallel: true`; sie sind in dessen `testIgnore` nicht enthalten. Die Konfiguration dokumentiert ausdrücklich, dass Status-/Reset-Broadcasts des gemeinsamen Mocks zwischen Tests durchschlagen ([playwright.config.ts](/home/cnc/lcnc-suite/lcnc-webui/playwright.config.ts:33)).

**Änderung:** Beide Dateien in eine passende serielle Projektstufe aufnehmen, im allgemeinen Projekt ausschließen und bei mehreren Dateien `workers: 1` festlegen; alternativ nachweislich getrennte Mock-Instanzen verwenden. Vorbedingungen jedes Falls explizit setzen.

**Abnahme:** Die Projektzuordnung ist Bestandteil des Plans. Später müssen die neuen Specs sowohl einzeln als auch im normalen vollständigen E2E-Aufruf zuverlässig bestehen; ein grüner Einzellauf belegt keine Isolation.

**UI-08 — `measureFrame` sieht die ursprüngliche Portrait-Regressionsart nicht.**

Plan: WP4, Zeilen 232–247. Im Portrait ist die äußere [Strip-Breite fest 280 px](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:2725). Wenn innen die vertikale Scrollbar verschwindet, ändern sich `clientWidth` und Control-/Sektionsbreiten. Die Bounding-Boxen von Strip, Viewer und Content können dabei unverändert bleiben. Der geplante Root-Box-Vergleich wäre dann grün, obwohl Controls weiterhin unter dem Finger wandern. `layoutChanges` wird für Keypad-Zustände nicht zusätzlich verlangt.

**Änderung:** Je Ausrichtung die innere nutzbare Strip-Breite/-Höhe und dauerhaft sichtbare Referenzcontrols messen. Bei bewusst ausgeblendeten Sektionen nur gemeinsame, stabil identifizierte Controls vergleichen. Für Portrait eine eigene Negativkontrolle vorsehen, die `scrollbar-gutter` entfernt und tatsächlich einen Überlaufwechsel erzeugt. Die Landscape-Injektion `overflow-x:auto` prüft das nicht.

**Abnahmefälle:** Keypad auf/zu in Landscape hält Strip-/Viewer-Höhe konstant; in Portrait bleiben nutzbare Breite und relevante Control-Positionen konstant. Beide passenden Negativkontrollen schlagen an. Makro-Bar-Ausnahmen nur für die ausdrücklich erlaubte Dimension anwenden.

**UI-09 — Eine Meldung nach dem Upload verhindert das Überschreiben nicht.**

Plan: Kontext Zeile 15 versus WP6 Zeilen 319–321 und Folge-Liste Zeile 402. Oben ist „alles (P0–P3 + Tooling)“ als Umfang festgehalten; der im P0-Abschnitt genannte Upload-Datenverlust wird später ohne Schutz vor dem Ersetzen verschoben. `replaced: true` meldet den Verlust erst, nachdem die alte Datei weg ist. Die bestehende [Schreibroutine](/home/cnc/lcnc-suite/lcnc-gateway/gateway.py:6116) veröffentlicht mit `os.replace`.

**Änderung:** Den Upload standardmäßig ohne Ersetzen durchführen. Bei Namenskonflikt vor Veröffentlichung eine Entscheidung ermöglichen: Abbrechen, anderer Name oder ausdrücklich Ersetzen. Ein eigener Exists-Roundtrip ist keine zwingende Voraussetzung: Der Upload-Endpunkt kann selbst einen Konflikt melden. Ein bloßer Exists-Check vor unverändertem `os.replace` reicht bei konkurrierenden Uploads ebenfalls nicht; der Server muss den Nicht-Ersetzen-Vertrag bei der Veröffentlichung einhalten.

**Abnahmefälle:** gleicher Name ohne Ersetzungsfreigabe lässt Original unverändert; Abbrechen erhält Original; ausdrücklich bestätigte Ersetzung funktioniert; konkurrierende gleichnamige Uploads werden sauber behandelt. Passende Backend-Tests gehören dann neben die Frontend-Prüfungen. Ein späteres Verschieben wäre eine offene Umfangsentscheidung, keine Erledigung dieses Befunds.

**UI-10 — „Kein Grid“ und „Reload deaktivieren“ sind noch kein vollständiger Ladeablauf.**

Plan: WP6, Zeilen 333–335. `Reload Data` lädt derzeit sowohl Probe-Punkte als auch das berechnete Grid ([refreshSurface](/home/cnc/lcnc-suite/lcnc-webui/src/ProbePanel.vue:315)). Ein Grid muss dafür nicht bereits vorhanden sein. Der vorgeschlagene aus dem letzten Reply abgeleitete `hasGrid`-Wert ist nur Wissen über die letzte Anfrage. Nach einer fehlenden Datei kann eine spätere Datei oder eine behobene Störung eine erneute Anfrage nötig machen.

Es existieren bereits automatische Anfragen beim Aktivieren der Surface-Ansicht und bei `compGridVersion`-Änderungen ([Watcher](/home/cnc/lcnc-suite/lcnc-webui/src/ProbePanel.vue:626)); die müssen ausdrücklich in den neuen Ablauf einbezogen werden. Außerdem besitzt die App die Antworten und reicht aktuell nur Daten weiter ([App](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:1547)). „Panel hält hasGrid“ legt den Fehler-/Leerzustand zwischen diesen Komponenten noch nicht fest.

**Änderung:** `unknown/loading/empty/ready/error` oder einen vergleichbar eindeutigen Zustand am Besitzer der Daten führen und weiterreichen. Erwartetes „noch kein Grid“ als Leerzustand behandeln; beschädigte Datei und Transportfehler sichtbar lassen. Eine Wiederholungsmöglichkeit erhalten und neue Punkte/Grid-Versionen, Reconnect sowie den Übergang vom ersten Scan zu vorhandenen Daten berücksichtigen.

**Abnahmefälle:** erster Besuch ohne Daten zeigt einen verständlichen Leerzustand; erster Scan macht die Daten erreichbar; Grid fehlt zunächst und wird später verfügbar; beschädigte Datei bleibt als Fehler erkennbar; erneutes Laden nach Fehler funktioniert. Aus fehlendem Grid allein darf nicht folgen, dass auch neue Probe-Punkte nicht mehr nachgeladen werden können.

**UI-11 — Das Numpad darf einen ungültigen Ausdruck nicht als andere Zahl bestätigen.**

Ergänzung zu WP4/WP6: Der Plan prüft Numpad-Layout und Shortcuts, aber nicht die Bedeutung der bestätigten Eingabe. [tokenize](/home/cnc/lcnc-suite/lcnc-webui/src/mathEval.ts:13) sammelt beliebig viele Punkte in einem Zahlentoken und verwendet anschließend `parseFloat`, das einen gültigen Präfix akzeptiert. Die direkte Probe gegen die vorhandene Funktion ergibt `evaluate('1.2.3') === 1.2`, `evaluate('1..2+5') === 6` und `evaluate('0..5') === 0`. [confirm](/home/cnc/lcnc-suite/lcnc-webui/src/NumberKeypadStrip.vue:85) reicht diese Ergebnisse an das Eingabeziel weiter. Das kann auch ein Offset-/Touch-off-Ziel sein.

Eine zweite Lücke im Eingabevertrag: [MachineInput](/home/cnc/lcnc-suite/lcnc-webui/src/MachineInput.vue:40) bestätigt ohne Feldprüfung und rendert Zahlenfelder tatsächlich als `type="text"`. Attribute wie `min="1"` am Tool-Nummernfeld oder `min/max` an der [Spindeldrehzahl](/home/cnc/lcnc-suite/lcnc-webui/src/SpindleStrip.vue:53) gewährleisten deshalb keine Numpad-Validierung. Backend-Prüfungen bleiben nötig; sie ersetzen die verständliche Korrekturmöglichkeit vor dem Absenden nicht.

**Änderung:** Zahlentoken vollständig validieren; Ausdrücke mit mehreren Dezimalpunkten dürfen keinen Zahlenwert liefern. Den Feldvertrag an die Eingabe weiterreichen: vorhandene Min-/Max-Grenzen und ausdrücklich verlangte Ganzzahligkeit prüfen, ohne Werte still zu kürzen oder zu begrenzen. Negative Werte dort weiterhin zulassen, wo sie fachlich korrekt sind, etwa beim Z-Offset. `step` nicht pauschal mit einer zulässigen Genauigkeit gleichsetzen.

**Abnahmefälle:** `1.2.3`, `0..5`, Division durch null und unvollständige Ausdrücke lassen sich nicht bestätigen; zulässige Rechnungen funktionieren; Tool-Nummer bleibt ganzzahlig und im zulässigen Bereich; ungültige Eingabe bleibt zur Korrektur erhalten und löst keinen Update-/Maschinenbefehl aus. Das bestehende Verhalten „leeres Feld bestätigen = 0“ ausdrücklich entscheiden und sichtbar machen, statt es versehentlich mit einem Parser-Fix zu verändern.

**UI-12 — Der Tool-Dialog muss auch beim normalen Add/Save auf Erfolg warten.**

Ergänzung zu WP3/WP6: Der Plan sichert Delete ab, lässt im umgebauten Edit-Dialog aber Save unverändert. [saveEdit](/home/cnc/lcnc-suite/lcnc-webui/src/ToolTablePanel.vue:241) wartet nur beim Umnummerieren auf eine Antwort. Für `add_tool` und `save_tool` sendet der Handler direkt, setzt sofort `editTool = null` und lädt nach 400 ms neu. Eine Ablehnung, ein Schreibfehler oder ein Verbindungsabbruch schließt damit die Bearbeitung, obwohl der Erfolg nicht feststeht; die Eingaben stehen nicht mehr im Dialog zur Korrektur bereit. Auch eine langsame erfolgreiche Antwort kann nach dem festen Refresh-Zeitpunkt eintreffen.

**Änderung:** Add, Save und Renumber erhalten denselben klaren Ablauf: gültige Eingabe → tatsächlich gesendet → in Bearbeitung → bestätigter Erfolg oder Fehler mit erhaltenem Entwurf. Erst nach Erfolg schließen und die Tabelle aktualisieren. Passendes `setup`-Gate am Befehlsweg erneut prüfen. Antworten einer älteren Bearbeitung dürfen eine neue Sitzung nicht schließen. Bei unklarem Ausgang nach Disconnect den Zustand abgleichen und keine Mutation blind erneut senden.

**Abnahmefälle:** `ok:false` erhält alle Felder und zeigt den Grund im Dialog; verzögerter Erfolg bleibt nachvollziehbar in Bearbeitung; zweiter Save sendet nicht doppelt; Fehler beim Senden erzeugt keinen dauerhaften Pending-Zustand; Disconnect und verspätete Antwort nach Schließen/Neuöffnen werden sauber behandelt. Die bestehenden Renumber-Tests bleiben erhalten und werden um gewöhnliches Add/Save ergänzt.

**UI-13 — Ein offenes Numpad braucht einen gültigen Besitzer und sichtbaren Feldkontext.**

Ergänzung zu WP3/WP6: [useNumberKeypad](/home/cnc/lcnc-suite/lcnc-webui/src/useNumberKeypad.ts:13) hält Trigger und Callback global. [MachineInput](/home/cnc/lcnc-suite/lcnc-webui/src/MachineInput.vue:40) prüft `isDisabled` nur beim Öffnen, nicht bei der späteren Bestätigung; es meldet seine Eingabe beim Unmount nicht ab. [cancelEditModal](/home/cnc/lcnc-suite/lcnc-webui/src/ToolTablePanel.vue:280) schließt lediglich den Tool-Dialog. Damit ist für „Tool-Dialog schließen, während dessen Numpad offen ist“ kein gemeinsamer Lebenszyklus definiert. Die bestehende automatische Schließung bei Disarm deckt weder jeden Gate-Wechsel noch das Verschwinden des Eingabeziels ab.

Viele Tool-Felder reichen außerdem kein `label` weiter ([Tool-Formular](/home/cnc/lcnc-suite/lcnc-webui/src/ToolTablePanel.vue:593)); das Numpad zeigt dann nur „Enter value“. Nach dem Teleport und beim Scrollen kann das zugehörige Feld außerhalb des sichtbaren Bereichs liegen. Die Längeneinheit ist im Panel bereits als `linearUnit` vorhanden, während mehrere Placeholder fest „mm“ sagen.

**Änderung:** Eine Numpad-Sitzung an den Besitzer bzw. dessen Kennung binden. Bei Schließen, Entfernen oder unzulässigem Kontextwechsel abbrechen; vor Confirm die Gültigkeit erneut prüfen. Beim Abmelden eines alten Besitzers ein inzwischen für ein anderes Feld geöffnetes Numpad erhalten. Den Kontext sichtbar benennen, etwa „T12 · Diameter · mm“ bzw. mit der tatsächlichen Längeneinheit. Nach Confirm/Cancel Fokus an ein noch vorhandenes, bedienbares Ziel zurückgeben.

**Abnahmefälle:** Dialog schließen bei offenem Numpad; Gate-Wechsel während der Eingabe; Wechsel zwischen zwei Feldern und zwei Dialogsitzungen; Tab-Wechsel mit verborgenem Eingabeziel; mm-/inch-Kontext; Confirm/Cancel ohne nachträgliche Änderung eines anderen oder nicht mehr vorhandenen Ziels. Reine DOM-Sichtbarkeit genügt nicht als Besitzerprüfung, weil verschiedene Aufrufer ohne `trigger` arbeiten.

**UI-14 — Ein „touch“-Viewport beweist noch keine Touch-Bedienbarkeit.**

Ergänzung zur Verifikation von WP3/WP4/WP6: [openLayout](/home/cnc/lcnc-suite/lcnc-webui/e2e/layout-fixtures.ts:85) ändert die Viewport-Größe und setzt für Touch die Klasse `touch-device`. Das prüft die Touch-Darstellung, erzeugt aber keine Touch-Ereignisse. Die geplante Hold-Prüfung mit `mouse.down/up` deckt entsprechend den Mauspfad ab. Gerade Scrollgesten, `pointercancel` und das Verlassen eines Hold-Buttons während einer Berührung sind eigenständige Fälle.

**Änderung:** Einen kleinen zusätzlichen Browser-Interaktionstest mit Touch-fähigem Kontext und tatsächlich ausgelösten Touch-Ereignissen vorsehen. Bestehende Maus-/Layouttests weiterverwenden; keine vollständige Verdopplung der Matrix. Die physische Touchscreen-Abnahme bleibt gesondert, da auch Browser-Emulation diese nicht ersetzt.

**Abnahmefälle:** kurzer Tap löst keinen Hold-Befehl aus; vollständiger Hold genau einen; Wegziehen/Scrollbeginn/Pointercancel bricht ab; erneuter Hold beginnt bei null. Im teleportierten Tool-Dialog lässt sich das Formular scrollen, ein Zahlenfeld öffnen und das Strip-Numpad bestätigen, während Save/Cancel erreichbar bleiben. Zusätzlich Fokus-/Sichtbarkeitsverlust während eines Holds prüfen, damit ein späterer Timer kein aufgegebenes Drücken nachholt.

**Weitere sinnvolle Qualitätschecks zum Nachtrag**

- **Hold verständlich machen:** Vor oder nach einem kurzen Tap einen sichtbaren Hinweis „Gedrückt halten“ anbieten; die vorhandene Füllanimation während des Holds beibehalten. Eine ausschließlich in der Browserkonsole protokollierte Ablehnung erklärt dem Operator nicht, warum der Button nichts getan hat. Dasselbe gilt für eine wegen des Busy-Latches nicht gesendete Aktion. Das kann als kleine gemeinsame Verbesserung am Button ergänzt werden.
- **Darstellung und Bedienfluss stichprobenartig prüfen:** Die neuen Dialoge/Numpad-Zustände einmal mit Dark-/High-Contrast-Darstellung, langen Werkzeugbeschreibungen und vergrößerter Schrift bzw. Browserzoom bedienen. Für Dialogöffnung, Scrollen und Kamera-Reset Vorher/Nachher unter derselben repräsentativen Last vergleichen. Dafür zunächst keine neuen unbelegten Millisekunden-Grenzen und keine vollständige Kreuzprodukt-Testmatrix einführen.

**Weitere Präzisierungen ohne zusätzliche Blocker-ID**

- **Reihenfolge:** Die beiden im Plan als P0 bezeichneten Eingabefehler zuerst zusammen mit ihren Regressionstests beheben. Sie benötigen weder eine globale z-index-Migration noch eine Formatiererbereinigung. Die Abhängigkeit „WP1→WP2“ ist für den Linter nachvollziehbar; sie sollte WP6-Korrekturen nicht nach hinten schieben.
- **Kamera:** Die Kugelregel ist für ein festes Ziel und die bei der Berechnung erfasste Modellpose schlüssig. Dolly, Pan, spätere Maschinenbewegung und Reset-Tween sind davon nicht automatisch abgedeckt. Der aktuelle [Reset-Tween](/home/cnc/lcnc-suite/lcnc-webui/src/ThreeViewer.vue:800) interpoliert die Position auf einer Geraden; sichere Endpunkte beweisen keinen sicheren Zwischenweg. Den zugesagten Umfang ausdrücklich auf Default-Framing begrenzen, beide Projektionen testen und beim interaktiven Check auch Reset sowie eine andere Maschinenpose beobachten. `matrixWorld` vor der Radiusberechnung aktualisieren. Keinen vollständigen Kamerakollisionsschutz behaupten.
- **Tool-Dialog:** Abstand zwischen `.editFields` und Vorschau allein beweist nicht, dass die Inputs innerhalb des Feldbereichs passen. Labels, Eingaben und Footer in den unterstützten Viewports auf Clipping/Erreichbarkeit prüfen; gestapelte Vorschau braucht ein vertikales statt horizontales Abstandskriterium. Die Teleport-/Keypad-Kombination tatsächlich bedienen, einschließlich Gate-Wechsel bei offenem Dialog.
- **`title`/`reason`:** Erklärungen für gesperrte Controls ergänzen, vorhandene Aktionshinweise für aktive Controls erhalten. Ein pauschales `:title`→`:reason` entfernt beispielsweise die Beschreibung der Orient-Bewegung im aktiven Zustand, weil `reason` dort nicht angezeigt wird.
- **`useDialogState`:** Den App-eigenen `fire`-Pfad als Callback weiterreichen. Das Composable läuft im App-Setup; ein direktes `useFire()` kann den von derselben App bereitgestellten Provider nicht wie eine Kindkomponente injizieren. Beim Delete-Dialog außerdem ein echtes zugeordnetes Reply abwarten; `fire()` liefert derzeit keine Befehlsbestätigung.
- **Prioritäten im Plan:** „Replace table ohne Bestätigung“ und „Leertaste startet unbeabsichtigt ein Maschinenprogramm“ haben unterschiedliche Auswirkungen. Nicht jeden fehlenden Bestätigungsdialog pauschal P0 nennen; die konkrete Folge und der betroffene Zustand bestimmen die Reihenfolge.

**Proben aus dieser Runde**

Die folgenden kurzen Prüfungen laufen ohne Gateway oder Browser und lassen sich aus dem Repository wiederholen.

```sh
cd lcnc-webui
node --input-type=module <<'JS'
import { ref, isProxy } from 'vue';
const cfg = ref({ jogEnabled: true, buttonsEnabled: true,
  mapping: { estop: 'Escape', cycle: ' ' } });
console.log('isProxy:', isProxy(cfg.value));
try { structuredClone(cfg.value); }
catch (e) { console.log(e.name + ': ' + e.message); }
JS
```

Ergebnis: `isProxy: true`, danach `DataCloneError`.

```sh
python3 - <<'PY'
from pathlib import Path
import re, importlib.util
for n, line in enumerate(Path('lcnc-webui/src/KeyboardTab.vue').read_text().splitlines(), 1):
    if 'background: color-mix' in line:
        print(n, bool(re.search(r'color-mix\([^)]*var\(--hl-', line)))
spec = importlib.util.spec_from_file_location('audit', 'scripts/audit-scoped-css.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
print(audit.template_range('lcnc-webui/src/App.vue'))
PY
```

Aus dem Repository-Root ausgeführt: `216 False`, `220 False`, `(1577, 1743)`.

**Zusätzliche Parser-Probe zum Nachtrag:** Aus `lcnc-webui` die vorhandene TypeScript-Datei isoliert transpiliert und ihre echte `evaluate`-Funktion aufgerufen; kein App-Build und keine Nachimplementierung des Parsers:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('src/mathEval.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { evaluate } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
for (const input of ['1.2.3', '1..2+5', '0..5', '1.2+3', '1/0']) {
  console.log(input, evaluate(input));
}
JS
```

Ergebnis: `1.2.3 → 1.2`, `1..2+5 → 6`, `0..5 → 0`; positive/negative Kontrollen `1.2+3 → 4.2`, `1/0 → null`.

**Ablauf bis zum Agreement**

Claude kann pro UI-ID direkt eine datierte Antwort ergänzen: **übernommen**, **abweichender Vorschlag** oder **widersprochen**, jeweils mit konkreter Planänderung bzw. Beleg. Die Originalbefunde bleiben zur Nachverfolgung stehen. Die nächste Codex-Runde prüft Antworten und aktualisierten Plan und ergänzt die Entscheidung in der Tabelle.

Plan-Agreement besteht, wenn die offenen IDs UI-01 bis UI-15 mit einer akzeptierten Lösung oder belegten Widerlegung geschlossen sind und Umfang, Reihenfolge sowie spätere Abnahmekriterien zusammenpassen. UI-15 stammt aus dem späteren Nutzer-Nachtrag und war nicht Teil von Claudes Antworten auf Runde 1. Die zusätzlichen Qualitätsvorschläge ohne ID werden ausdrücklich übernommen oder als spätere Verbesserung festgehalten. Eine bloße Zustimmung ohne Anpassung der widersprechenden Planstellen schließt einen Punkt nicht. Erfolgreiche Implementierung, Testläufe und Merge werden damit noch nicht behauptet.

---

## Runde 1 · Antworten Claude · 20. September 2026

Geprüfter Plan-Stand: Fassung 2 (`/home/cnc/.claude/plans/das-aktuelle-webui-von-optimized-perlis.md`,
Kopf „Fassung 2 · 20. September 2026"). Jede zitierte Code-Stelle des Reviews wurde vor der
Antwort gegengelesen (KeyboardTab-Capture-Listener, `tool_change_requested`, Add/Save-Ablauf,
Tokenizer, `os.replace` im Upload, Playwright-Kette, globaler Keypad-Zustand,
`template_range`). Kein Punkt wird widersprochen. Wo der Plan über die Review-Forderung
hinausgeht oder eine Entscheidung trifft, steht das hier ausdrücklich.

**UI-01 — übernommen.** Der Watcher-Verwurf aus Fassung 1 ist gestrichen. Neu: `enterEdit`
hält `{id, path, original}`; `saveEdit` speichert nur nach `session.path`; eine Reply, die zu
einer älteren Sitzung gehört oder deren Pfad nicht mehr aktiv ist, zerstört weder den Editor
noch emittiert sie `loadFile`. Externer Wechsel → Puffer bleibt, Konfliktbanner mit „Keep
editing"/„Discard" (Dirty → Rückfrage). Browse/Unload/Drop beim Editieren deaktiviert;
CodeMirror-Ladephase trägt die Sitzungs-ID; ein später eintreffendes Upload-`loadFile` läuft in
denselben Watcher. Alle genannten Abnahmefälle sind als `e2e/editor-guards.spec.ts` im Plan.

**UI-02 — übernommen.** `MachineBtn` erhält `holdKey`; Änderung während eines Holds →
`cancelHold("target changed")`, neuer vollständiger Hold nötig. Zusätzlich ein Watcher auf
`isDisabled` während des Holds: schließt das Gate zwischenzeitlich, wird sofort abgebrochen,
auch wenn es vor Ablauf wieder öffnet (heute nur Prüfung beim Timerablauf). OffsetPanel bindet
`:hold-key="selectedWcs"`. Hold ohne Dialog bleibt. Abnahmefälle wie gefordert in
`touchoff.spec.ts`.

**UI-03 — übernommen, mit Entscheidung.** Escape wird **reserviert**: `mapping.estop` ist
nicht umbelegbar (beim Laden auf `"Escape"` normalisiert, Keyboard-Tab zeigt es fest). Der
E-Stop-Pfad läuft als eigener Capture-Listener, der vor dem KeyboardTab-Listener registriert
wird; `handleCapture` lässt Escape durch und bricht das Belegen ab. `estop_reset` per Tastatur
entfällt. Modal-Quelle: `useModalRegistry()` mit `registerModal(isOpenRef)` in jeder Komponente
mit `.dialogOverlay` plus `keypadState.open`; ein Selbsttest vergleicht DOM-Scan und Registry-
Zählung. Solange ein Modal offen ist, passiert nur `estop` (auch Backspace/Abort nicht — Abort
bleibt per Button/Banner). Cycle-Shortcut: `run` + `!editing` nur im Start-Zweig; Pause/Resume
unverändert; `keyup → jog_stop` bleibt ungefiltert. Abgrenzung wie vom Review verlangt: Der
Guard betrifft globale Shortcuts; die native Aktivierung eines per Tab erreichbaren
Hintergrund-Buttons bleibt und wird von einem Test dokumentiert; Fokus-Trap steht auf der
Folge-Liste.

**UI-04 — übernommen.** `{ ...cfg, mapping: { ...cfg.mapping } }` im Watcher (immediate), kein
`structuredClone`. Abnahme: kein `pageerror` beim Öffnen; keine Prop-Mutation vor dem Emit;
Server-Änderung aktualisiert die Kopie.

**UI-05 — übernommen.** `toolChangeRequested` (Feld `tool_change_requested`), Backend-Gate
`armed`, nicht idle/ready. Lokaler Zustand `confirmSent` wird erst nach tatsächlichem Senden
gesetzt (`fire()` liefert dafür `true/false`) und zurückgesetzt bei `tool_change_requested →
false`, `ok:false` und Disconnect. Abnahmefälle wie gefordert.

**UI-06 — übernommen.** `template_range` wird verschachtelungsbewusst (App.vue → `(1577,
2275)`); `HLPCT` ist ein Argument-Parser für `color-mix()` (Split an Kommas auf Klammertiefe 1,
Treffer nur bei `var(--hl-…)` an der Prozent-Position; `--hl-*` als Farbe bleibt gültig).
Dauerhafte Gegenproben: `--paths`-Parameter, Fixtures unter `scripts/test_fixtures/audit_css/`
(die zwei realen KeyboardTab-Regeln, gültige Farbnutzung, Treffer nach verschachteltem
`</template>`, jede Kategorie mit/ohne `audit-ok`) und `scripts/test_audit_scoped_css.py`
(pytest im offline-Backend-Lauf). Keine Scratch-Datei.

**UI-07 — übernommen.** Neues Projekt `serial-guards` (keyboard-guards, editor-guards,
touch-hold; `workers: 1`, `fullyParallel: false`, nach `serial-touchoff`, vor `serial-layout`),
die Dateien ins `testIgnore` von `chromium`. Jeder Fall setzt Vorbedingungen explizit. Abnahme:
einzeln UND im vollständigen `npm run test:e2e`.

**UI-08 — übernommen.** `measureFrame` liefert zusätzlich `clientWidth`/`clientHeight` der
drei Container; je Keypad-Zustand zusätzlich `layoutChanges` auf dauerhaft sichtbaren
Referenzcontrols (`.safetyStrip` immer; Besitzer-Sektion bei `keypad-setup`). Eigene
Portrait-Negativkontrolle: `scrollbar-gutter: auto !important` + erzwungener Überlaufwechsel →
`clientWidth`-Änderung und Control-Verschiebung erwartet. Makro-Bar-Ausnahme nur für die
erlaubten Dimensionen.

**UI-09 — übernommen, in diese Welle gezogen.** Der Verschiebe-Eintrag ist gestrichen.
`POST /upload?overwrite=0|1`; ohne Freigabe publiziert der Server per `os.link(tmp, dest)`
(EEXIST → 409 `{"error":"exists"}`), atomar auch bei konkurrierenden Uploads; mit Freigabe
`os.replace`. Fallback `O_CREAT|O_EXCL` für Dateisysteme ohne Hardlinks, gleiche Semantik.
Client: 409 → Dialog Cancel / Rename / Replace. Backend-Tests neben den Frontend-Prüfungen.

**UI-10 — übernommen.** Zustandsmodell `unknown|loading|empty|ready|error` je Ressource
(Punkte, Grid) am Besitzer (App), durchgereicht an ProbePanel; `No grid file` = `empty`,
Transport-/Parsefehler = `error` mit Retry; „Reload Data" bleibt aktiv (lädt Punkte unabhängig
vom Grid) und zeigt `loading`; Auto-Fetch (View-Wechsel, `compGridVersion`, Reconnect) setzt
dieselben Zustände. Abnahmefälle wie gefordert.

**UI-11 — übernommen, mit Entscheidung.** Tokenizer akzeptiert nur `^(\d+\.?\d*|\.\d+)$`,
sonst `null`. Feldvertrag `constraints {min, max, integer}` reist mit `openKeypad`; `MachineInput`
liest `min`/`max` und ein explizites `integer`-Prop; `step` ist keine Genauigkeit; Verletzung
wird angezeigt, Confirm deaktiviert, nichts wird gekürzt; negative Werte bleiben erlaubt, wo
kein `min ≥ 0` gilt. **Entscheidung:** „leeres Feld = 0" bleibt (bewusstes Verhalten nach „C"),
wird aber sichtbar („= 0" im Readout) und unterliegt den Constraints (bei `min 1` nicht
bestätigbar).

**UI-12 — übernommen.** Add/Save/Renumber in einem Ablauf: validiert → per `fire()` gesendet →
`saving` (Felder bleiben) → korreliertes Reply der aktuellen Sitzung → `ok` schließt und lädt;
`ok:false` zeigt den Grund im Dialog; Replies älterer Sitzungen werden ignoriert; Disconnect →
`saving=false`, Hinweis, Tabelle neu laden, kein blinder Resend. Renumber-Tests bleiben, Add/Save
kommen dazu.

**UI-13 — übernommen.** `openKeypad({ ownerId, context, canConfirm })`; `MachineInput`
meldet sich in `onUnmounted` ab (nur das eigene Keypad wird geschlossen), `canConfirm` prüft
`isDisabled` vor `onConfirm`; Fokus zurück an den Trigger nur, wenn er noch verbunden und
bedienbar ist. Tool-Felder bekommen `label`; Kontext „T12 · Diameter · mm/in" aus `linearUnit`;
Placeholder folgen der Einheit. Besitzerprüfung über die ID, nicht über DOM-Sichtbarkeit.

**UI-14 — übernommen.** `e2e/touch-hold.spec.ts` in einem `hasTouch`-Kontext mit echten
Touch-Ereignissen (Tap, Hold, Wegziehen, Scrollbeginn, `pointercancel`, Fokus-/Sichtbarkeits-
verlust während des Holds, Tool-Dialog-Bedienung mit Strip-Numpad). Keine Verdopplung der
Layout-Matrix; physische Touchscreen-Abnahme bleibt gesondert.

**Qualitätschecks ohne ID — übernommen.** Hold-Hinweis nach kurzem Tap („Hold to activate",
~1,5 s über den `.btnTip`-Mechanismus) und derselbe transiente Hinweis bei Busy-Latch-Drop
(WP6). Stichproben Dark/High-Contrast, lange Beschreibungen, Browser-Zoom, Vorher/Nachher
unter gleicher Last sind in der Verifikation aufgeführt, ohne neue Millisekunden-Grenzen.

**Präzisierungen ohne ID — übernommen.** Reihenfolge: WP0 (P0-Eingabefehler + Tests) zuerst,
unabhängig von Tokens/Linter. Kamera: Zusage auf Default-Framing begrenzt, beide Projektionen im
Gate, `updateMatrixWorld` vor der Radiusberechnung, Reset-Tween und zweite Maschinenpose in der
manuellen Prüfung, kein Kollisionsschutz behauptet. Tool-Dialog: `measureLayout`/`assertLayout`
in allen vier Viewports, gestapelte Vorschau mit vertikalem Kriterium. `reason` ergänzen,
`title` behalten. `useDialogState` bekommt `fire` als Option; Delete wartet auf das korrelierte
Reply. „Replace table" ist P1; P0 sind nur Fälle mit unbeabsichtigter Maschinenaktion oder
stillem Datenverlust.

**Stand:** Aus Claudes Sicht sind UI-01 bis UI-14 mit akzeptierter Lösung und Prüfansatz
geschlossen. Offen für Runde 2: Bestätigung durch Codex, insbesondere der drei Entscheidungen
(Escape nicht umbelegbar; leer = 0 bleibt sichtbar; Modal-Guard blockiert auch Backspace/Abort).

---

<a id="codex-runde-2"></a>

**Runde 2 · Bewertung der Antworten und Fassung 2 · Codex · 20. September 2026**

**Ergebnis: 9 Punkte geschlossen auf Planebene; UI-01, UI-06, UI-09, UI-11 und UI-12 benötigen noch gezielte Änderungen.** Claude hat alle Befunde inhaltlich aufgegriffen und den Plan deutlich verbessert. Es gibt keine neuen Review-IDs und keine Erweiterung des vereinbarten Funktionsumfangs in dieser Runde. Die fünf offenen Punkte betreffen die vorgeschlagene Umsetzung oder die verlässliche Ausführung bereits zugesagter Tests.

Prüfstand: [Fassung 2 des Plans](/home/cnc/.claude/plans/das-aktuelle-webui-von-optimized-perlis.md), 404 Zeilen, SHA-256 `edb5eab67b5b6f329a7dfc6f7c459fcd968b7e691c9ea103c6c339d19d37c016`; Claudes Antworten oben; unveränderter Code bei `8de45e99e4925b9f052ce5c0f394b5fd357712b8`. Alle folgenden Planzeilen beziehen sich auf Fassung 2. Quellcodeprüfung plus eine kleine Dateisystemprobe unter `/tmp`; keine Maschinenbefehle, kein Build, keine vollständigen Tests.

**Akzeptierte Punkte und Entscheidungen**

- **UI-02/04/05:** `holdKey` plus Abbruch bei zwischenzeitlichem Gate-Verlust, explizite Kopie der Tastaturkonfiguration und `tool_change_requested` mit lokalem Bestätigungszustand sind passende Lösungen. Die Abnahmefälle im Plan sind ausreichend konkret.
- **UI-03:** Reserviertes Escape und Reset ausschließlich per Button sind akzeptiert. Ebenso akzeptiert ist, bei offenen Dialogen die **globalen** Cycle-/Jog-/Abort-Shortcuts zu unterdrücken, solange Escape und `keyup → jog_stop` erhalten bleiben und die genannten Abort-Buttons erreichbar sind. Das blockiert nicht das lokale Backspace zum Bearbeiten eines Eingabefelds. Registry und Dialog-Abdeckung sind jetzt konkret beschrieben.
- **UI-07/08:** Die serielle Projektkette, innere Strip-Maße, Referenzcontrols und getrennten Negativkontrollen schließen die bisherigen Lücken im Prüfkonzept.
- **UI-10/13/14:** Ressourcenweise Ladezustände, Numpad-Besitzer samt Kontext-/Tabwechsel-Abnahme und tatsächliche Touch-Ereignisse sind akzeptiert. Ein bereits gemountetes, nur verborgenes Eingabeziel bleibt ausdrücklich Teil von UI-13; `onUnmounted` allein wird diesen Test nicht erfüllen.
- **Leeres Feld = 0:** Als sichtbare, bewusst erhaltene Produktentscheidung akzeptiert. Die Feldgrenzen gelten dabei ebenfalls; die noch offene Enter-Prüfung ist unten separat beschrieben.
- **Ohne ID:** Reihenfolge, begrenzte Kamera-Zusage, Dialog-/Theme-/Zoom-Prüfungen, `reason` zusätzlich zu `title`, Übergabe von `fire` an `useDialogState` und sichtbare Hold-/Busy-Rückmeldung sind passend aufgenommen. Das Verschieben der vollständigen Fokusführung ist für diese Welle mit der dokumentierten Einschränkung akzeptiert: Ein offener Dialog sperrt dadurch nicht jede native Tastaturaktivierung im Hintergrund. Dies ist keine Behauptung vollständiger Modal-Isolation.

**UI-12 bleibt offen — Eine lokale Sitzungs-ID identifiziert die empfangene Antwort nicht.**

Planzeilen 238–244 nennen `saveSession = { id, cmd }` und als Korrelation `lastReply.cmd === session.cmd` plus „Sitzung noch aktuell“. Die Antwort enthält aber keine solche Sitzungs-ID: Der [Gateway-Antwortpfad](/home/cnc/lcnc-suite/lcnc-gateway/gateway.py:7009) sendet `type`, `cmd` und das Ergebnis; [lcncWs](/home/cnc/lcnc-suite/lcnc-webui/src/lcncWs.ts:281) übernimmt das unverändert in `lastReply`.

Gegenfall: Sitzung A sendet `save_tool`; der Dialog wird geschlossen. Sitzung B öffnet und sendet ebenfalls `save_tool`. Nun trifft A's verzögertes `ok` ein. `cmd` passt zu B, B ist aktuell — trotzdem ist dies kein Erfolg für B. Ein Vergleich nur mit dem aktuellen lokalen Zustand kann die Herkunft nicht rekonstruieren. Dasselbe betrifft Delete/Renumber bei wiederholtem gleichem Befehl.

**Kleine erforderliche Planänderung:** Die Zuordnung tatsächlich definieren: entweder eine eindeutige Request-ID, die der Server auf Erfolgs- und Fehlerpfaden zurücksendet, oder eine beim Versand festgehaltene Pending-Zuordnung, die auch nach dem Schließen bestehen bleibt und eine zweite gleichartige Anfrage bis zum Abschluss verhindert. Eine lokale `id` ohne Verbindung zur Antwort genügt nicht. Kein allgemeines Request-Framework ist vorgeschrieben.

**Gezielter Test:** Zwei Sitzungen mit demselben `cmd`; altes Erfolgsergebnis trifft ein, während die neuere Sitzung offen bzw. selbst in Bearbeitung ist. Es darf die neue Sitzung weder schließen noch deren Fehler-/Pending-Zustand als erledigt markieren. Bei einer Lösung mit gesperrter zweiter Anfrage stattdessen genau diese Sperre und ihre Freigabe prüfen.

**UI-09 bleibt offen — Der `O_EXCL`-Kopier-Fallback erhält die atomare Veröffentlichung nicht.**

Der Hauptweg aus Planzeilen 190–199 (`os.link` der fertig geschriebenen temporären Datei; Konflikt → 409) ist akzeptiert. Die Risikobehandlung in Zeilen 394–395 eröffnet dagegen zuerst den **endgültigen** Zielpfad mit `O_CREAT|O_EXCL` und kopiert danach hinein. Das verhindert Ersetzen, macht aber die noch unvollständige Datei sofort lesbar. Es ist deshalb nicht dieselbe Semantik wie die atomare Veröffentlichung des Hauptwegs.

Der bestehende [Upload-Vertrag](/home/cnc/lcnc-suite/lcnc-gateway/gateway.py:6075) verlangt ausdrücklich, dass LinuxCNC keine Teil-Datei sieht; die [Upload-Tests](/home/cnc/lcnc-suite/lcnc-gateway/test_command_dispatch.py:465) prüfen auch Fehler-/Abbruchpfade. Die kleine lokale Probe dieser Runde bestätigt: Ein Leser erhält nach dem ersten Kopierstück bereits `G0 X1\n` aus dem endgültigen Pfad, obwohl das vollständige Programm `G0 X1\nM2\n` lautet. Beim Link-Weg existiert der Zielpfad erst mit dem vollständigen Inhalt. Kein Controller war an dieser Probe beteiligt.

**Kleine erforderliche Planänderung:** Den Kopier-Fallback streichen. Falls die atomare Nicht-Ersetzen-Veröffentlichung auf dem Dateisystem nicht unterstützt wird, vor Veröffentlichung verständlich ablehnen und temporäre Dateien bereinigen. Alternativ eine ausdrücklich benannte, nachweislich atomare Nicht-Ersetzen-Operation für dieses Dateisystem wählen. Eine sichtbare leere Reservierungsdatei wäre ebenfalls kein gleichwertiger Ersatz.

**Gezielte Tests:** Concurrent Reader sieht vor Veröffentlichung kein Ziel und danach ausschließlich den vollständigen Inhalt; nicht unterstütztes Dateisystem sowie Fehler/Abbruch hinterlassen kein teilweise veröffentlichtes Ziel. Bestehende Upload-/Save-Regressionen bleiben erhalten.

**UI-11 bleibt offen — „Confirm deaktiviert“ muss auch den direkten Enter-Pfad abdecken.**

Tokenizer, Feldvertrag, explizite Ganzzahligkeit und die sichtbare Null sind akzeptiert. Planzeilen 180–188 beschreiben für Grenzverletzungen aber konkret nur die Anzeige und das Deaktivieren von Confirm. Der [physische Enter-Handler](/home/cnc/lcnc-suite/lcnc-webui/src/NumberKeypadStrip.vue:108) ruft `confirm()` direkt auf. Eine deaktivierte OK-Schaltfläche blockiert diesen Aufruf nicht; die [bestehende Funktion](/home/cnc/lcnc-suite/lcnc-webui/src/NumberKeypadStrip.vue:85) prüft nur, ob das Ergebnis ungleich `null` ist.

**Kleine erforderliche Planänderung:** Dieselbe zentrale Zulässigkeitsprüfung für Darstellung **und** `confirm()` festschreiben: gültiger Ausdruck, Min/Max/Ganzzahligkeit und gültiger Besitzer. Vor jedem Callback erneut prüfen. Bei einem ungültigen Wert Eingabe erhalten und weder Callback noch Schließen auslösen; Besitzerverlust darf wie vereinbart abbrechen.

**Gezielte Tests:** Feld `min=1`, Eingabe `0` bzw. leer → Enter sendet nichts und bestätigt nichts; ein Bruchteil im Integer-Feld ebenso. Die gleichen Fälle per Touch-OK prüfen; gültige Zahl funktioniert über beide Wege. Dies präzisiert den bereits geforderten Feldvertrag und führt keine neue Validierungsregel ein.

**UI-01 bleibt offen — Externes Programmwechseln und Ersetzen der Editiersitzung unterscheiden.**

Pfadbindung, Konfliktbanner und Schutz vor verspäteten Save-Abschlüssen sind akzeptiert. Planzeilen 167–168 sagen jedoch: „ein Wechsel während des Ladens bricht das Erstellen des Views ab, ohne `editing` zu ändern“. Wenn damit der externe Wechsel von A nach B gemeint ist, bleibt die Sitzung A ohne CodeMirror-View in `editing=true`; „Keep editing“ besitzt dann keinen beschriebenen Weg zu einem bedienbaren Editor. Die aktuelle [Initialisierung](/home/cnc/lcnc-suite/lcnc-webui/src/GcodePanel.vue:527) setzt `editing` vor dem asynchronen Import und liest den Text anschließend aus den Props.

**Kleine erforderliche Planänderung:** Den Abbruch nur auf eine **verworfene oder durch eine neue ID ersetzte Editiersitzung** beziehen. Wechselt lediglich das aktive Programm extern, bleibt Sitzung A gültig; der View wird aus deren festgehaltenem Originaltext erstellt und der Konflikt angezeigt. Alternativ einen konkreten Wiederaufnahmeweg nennen; ein dauerhaft leeres Editierfenster ist kein zulässiger Endzustand.

**Gezielter Test:** CodeMirror-Import verzögern, A→B extern wechseln, Import freigeben: Der Editor zeigt weiterhin den festgehaltenen Text von A und lässt sich bedienen. Bei wirklichem Discard/Neustart dagegen darf der alte Import keinen View mehr installieren.

**UI-06 bleibt offen — Der neue Linter-Test läuft nicht automatisch im genannten Offline-Gate.**

Scanner-Änderungen, echte Fehler-Fixtures und der Pfadparameter sind akzeptiert. Planzeilen 224–225 behaupten, `scripts/test_audit_scoped_css.py` laufe in `test_suite.py offline --component backend`. Der [Runner](/home/cnc/lcnc-suite/scripts/test_suite.py:104) startet pytest jedoch im Verzeichnis `lcnc-gateway`; dessen [pytest-Konfiguration](/home/cnc/lcnc-suite/lcnc-gateway/pyproject.toml:9) setzt `testpaths = ["."]`. Der Geschwisterpfad `scripts/test_audit_scoped_css.py` wird dadurch nicht entdeckt. Der separate Aufruf in Schritt 2 würde einmal prüfen, aber die angekündigte wiederkehrende Abdeckung des finalen Offline-Laufs fehlt.

**Kleine erforderliche Planänderung:** `scripts/test_suite.py` ausdrücklich um den Testaufruf ergänzen oder den Test in einen vom Gate erfassten Pfad legen. Befehle und Arbeitsverzeichnisse im Plan daran angleichen. Die Aufnahme in den Runner ist Teil von WP2, nicht nur eine Annahme über pytest-Discovery.

**Gezielte Abnahme:** Die Befehlsliste/der Report des gewöhnlichen Offline-Laufs enthält den Linter-Test. Eine absichtlich fehlerhafte Fixture-Erwartung macht diesen Lauf rot; nach Rücknahme besteht er. Dafür ist keine zusätzliche Vollsuite allein für dieses Planreview erforderlich.

**Nächste Abstimmungsrunde:** Nur diese fünf Punkte im Plan präzisieren und mit der jeweiligen UI-ID beantworten. Die neun akzeptierten Punkte werden nicht erneut aufgerollt, solange ihre Lösungen und Abnahmekriterien erhalten bleiben. Danach kann das vollständige Plan-Agreement festgestellt werden; Implementierung und ihre Tests bleiben eine spätere Abnahme.

---

<a id="eingabehilfe-nachtrag"></a>

**Nutzer-Nachtrag · 20. September 2026 — UI-15: Gemeinsame Eingabehilfe mit feldabhängigem Layout**

**Neue Beobachtung des Nutzers:** Die Texttastatur schließt beim Verlassen des Eingabefelds, das Numpad bleibt bis zum ausdrücklichen Cancel offen. Auch der Wechsel zwischen Text- und Zahlenfeldern verhält sich uneinheitlich. Der Nutzer stellt deshalb die Trennung von Keypad und Numpad infrage. Dieser Nachtrag erweitert den Abstimmungsumfang um einen konkreten Bedienfall; die neun bereits akzeptierten Planpunkte bleiben akzeptiert.

**Quellcodebefund:** Für das MDI-Feld setzt [App.vue](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:1777) `mdiKeypadActive` bei Fokus und löscht es bei Blur. Zusätzlich gibt es einen [Outside-Pointer-Handler](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:363). Der G-code-Editor hat einen dritten Ablauf: Sein [Tastaturmodus](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:328) hängt von `gcodeEditActive` und dem sichtbaren Tab ab. Das Numpad besitzt davon unabhängig den globalen [keypadState.open](/home/cnc/lcnc-suite/lcnc-webui/src/useNumberKeypad.ts:13). Im [Template](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:2201) verdrängt ein offenes Numpad die G-code-Tastatur auch dann, wenn inzwischen ein Textziel aktiv ist. Das Numpad wird bei Disarm automatisch abgebrochen; die Textfokus-Handler beenden seine Sitzung dagegen nicht. Die berichtete Inkonsistenz ist damit im Zustandsmodell nachvollziehbar. Ein neuer Browser-Reproduktionstest wurde in diesem Nachtrag noch nicht ausgeführt.

**Codex-Empfehlung zur Abstimmung:** Eine gemeinsame Eingabehilfe mit genau einer aktiven Eingabesitzung. Je nach Ziel verwendet sie das Zahlen-/Rechnerlayout oder das passende Text-/G-code-Layout. Die vorhandenen Layout-Komponenten können erhalten bleiben; Öffnen, Wechseln, Schließen, Besitzerprüfung und Layoutplatz werden gemeinsam gesteuert. Die folgenden Bedienregeln sind ein Vorschlag, noch keine bestätigte zusätzliche Operator-Entscheidung.

| Aktion | Vorgeschlagenes gemeinsames Verhalten |
|---|---|
| Eingabefeld auswählen | Passendes Layout mit sichtbarem Feldnamen und ggf. Einheit öffnen; genau dieses Feld ist der Besitzer. |
| Textfeld → Zahlenfeld oder umgekehrt | Besitzer und Layout direkt wechseln. Der bisherige Modus bleibt nicht im Hintergrund aktiv und erscheint später nicht ungefragt wieder. |
| Zahl A → Zahl B | A nicht automatisch übernehmen; B bekommt seine eigene Eingabe und seinen Feldvertrag. |
| Tastatur bedienen | Sitzung bleibt aktiv. Ein Fokuswechsel vom Feld zur Eingabehilfe ist kein Verlassen der Eingabe. |
| Eingabebereich verlassen oder „Schließen“ | Eingabehilfe ausblenden, ohne automatisch zu übernehmen, zu speichern oder einen MDI-Befehl zu senden. |
| Zum ursprünglichen Feld zurückkehren | Dessen noch gültigen Entwurf wieder aufnehmen. Unbestätigte Werte bleiben als Entwurf erkennbar. |
| Dialog/Besitzer entfernen, Gate oder Kontext ungültig | Sitzung gezielt beenden bzw. sperren; keine Wiederverwendung des alten Callbacks für ein neues Ziel. |

**Unterschiedliche Bestätigungsaktionen bleiben fachlich erforderlich:** Zahlen-/Offset-Eingaben ändern den Zielwert erst mit **Übernehmen** bzw. gültigem Enter. MDI wird nur mit **Senden** bzw. seinem ausdrücklich zugeordneten Enter ausgeführt. Im G-code-Editor fügt Enter weiterhin einen Zeilenumbruch ein; das Programm wird über **Speichern** gesichert. Ein gemeinsames Schließverhalten darf diese Bedeutungen nicht vereinheitlichen. Escape bleibt E-Stop und wird nicht zur Schließen-Taste.

**Entwürfe und Fokus:** Text-/Editorentwürfe liegen bereits im jeweiligen Zielmodell. Ein unbestätigter Zahlenentwurf bleibt bei einer Unterbrechung beim ursprünglichen Besitzer und darf weder automatisch angewendet noch in das nächste Feld übertragen werden. Dafür genügt ein kurzlebiger Entwurf pro betroffenem Besitzer; keine dauerhafte globale Entwurfshistorie. Vor Wiederaufnahme/Übernahme den ursprünglichen Feld-, Einheiten- und Berechtigungskontext gemäß UI-11/UI-13 prüfen. „Schließen“ bedeutet Ausblenden; ein explizites „Verwerfen“ kann den Entwurf löschen. Beim Wechsel zu einem anderen Feld darf eine nachlaufende Fokus-Rückgabe nicht wieder das alte Feld oder dessen Numpad aktivieren.

**Kleine technische Richtung:** Ein gemeinsamer Controller verwaltet `ownerId`, Eingabeart, Kontext und die zum Ziel gehörenden Editier-/Bestätigungsaktionen. Die Darstellungsentscheidung und `stripVis` werden daraus abgeleitet. `mdiKeypadActive`, editorbedingte Sichtbarkeit und `keypadState.open` dürfen nicht als konkurrierende Wahrheiten weiterlaufen. Feld und Eingabehilfe bilden einen logischen Eingabebereich; bloßes DOM-`blur` ist kein hinreichendes Schließkriterium. Beim Feldwechsel den neuen Besitzer übernehmen, ohne zwischenzeitlich den gesamten Strip ein-/auszublenden. Normale Textfelder müssen ein altes Numpad ebenfalls ablösen, auch wenn sie ihre native Bildschirmtastatur verwenden. Der ursprüngliche Nachtrag ließ deren eigenes Buchstabenlayout offen; die folgende Nutzerpräzisierung ergänzt jetzt Zeichenvorrat und Textfeld-Abdeckung.

**Abnahmefälle für den Plan:**

- MDI/Text → Zahl → MDI/Text: jeweils genau ein passendes Layout; niemals ein altes Numpad vor dem aktiven Textziel.
- Zahl A → Zahl B: unbestätigter A-Wert wird weder angewendet noch nach B übertragen; Rückkehr nach A erhält den gültigen Entwurf.
- Tap/Tab außerhalb sowie explizites Schließen verhalten sich für beide Layouts gleich; keine Maschinen-/Save-/MDI-Aktion durch das Verlassen.
- Eingabehilfe bedienen, inklusive Fokuswechsel innerhalb ihrer Tasten, schließt sie nicht versehentlich.
- Editor verlassen, Zahlenfeld bedienen, zum Editor zurückkehren: Editorpuffer bleibt, Tastatur folgt dem tatsächlich gewählten Eingabeziel statt allein dem offenen Editor.
- Schließen/Confirm beim gleichzeitigen Wechsel zu einem neuen Feld gibt den Fokus nicht an das alte Ziel zurück; entfernte Besitzer und ungültige Einheiten-/Gate-Kontexte bleiben gesperrt.
- Maus, physische Tastatur und tatsächliche Touch-Ereignisse prüfen; Strip-/Viewer-Geometrie bleibt bei den Übergängen gemäß WP4 stabil. Escape und Jog-Keyup behalten ihre vereinbarte Wirkung.

**Abstimmungsfolge:** Zusätzlich zu den fünf offenen Punkten aus Runde 2 muss UI-15 im Plan beantwortet werden. UI-13 wird dabei in die gemeinsame Besitzer-/Sitzungsverwaltung integriert; dessen bisher akzeptierte Schutz- und Kontextregeln bleiben erhalten.

<a id="eingabehilfe-zeichen-und-portrait"></a>

**Weitere Nutzerpräzisierung · 20. September 2026 — UI-15: Zeichenabdeckung, Suchfelder und Hochformat**

Der Nutzer fragt nach fehlenden Tasten für Codebearbeitung, insbesondere dem Semikolon für Kommentare, und berichtet von Suchfeldern ohne Tastaturaufruf. Gleichzeitig soll eine umfassendere Tastatur das vertikale Layout nicht unbedienbar machen. Dies konkretisiert UI-15; es ist kein zusätzlicher sechzehnter Reviewpunkt.

**Bestätigte Lücken im vorhandenen Code:**

- [GcodeKeypadStrip.vue](/home/cnc/lcnc-suite/lcnc-webui/src/GcodeKeypadStrip.vue:23) bietet nur `G M T F S`, konfigurierte Achsbuchstaben, `I J K P R Q`, Ziffern, Punkt, Minus, Space, Backspace und Enter/Send sowie Clear im MDI-Modus. Es fehlen unter anderem `;`, `(`, `)`, `#`, `[`, `]`, `<`, `>`, `_`, `=`, `+`, `*`, `/` und Buchstaben wie `H D L N O`. Beliebige Kommentartexte lassen sich damit ebenfalls nicht schreiben. Der [Editor-Tokenizer](/home/cnc/lcnc-suite/lcnc-webui/src/gcodeCmLanguage.ts:26) kennt sowohl Semikolon- als auch Klammerkommentare. Die Oberfläche kann also Inhalte anzeigen, deren Zeichen ihre eigene Tastatur nicht eingeben kann.
- Der Textzweig von [MachineInput.vue](/home/cnc/lcnc-suite/lcnc-webui/src/MachineInput.vue:79) enthält keinen allgemeinen Aufruf der eigenen Bildschirmtastatur. Betroffen sind beispielsweise die Suche in [Werkzeugtabelle](/home/cnc/lcnc-suite/lcnc-webui/src/ToolTablePanel.vue:528), [G-code-Referenz](/home/cnc/lcnc-suite/lcnc-webui/src/GcodeReferenceDialog.vue:55) und [Halshow](/home/cnc/lcnc-suite/lcnc-webui/src/HalshowTab.vue:134), außerdem Werkzeugbeschreibung, Material, Halter sowie Textfelder in den Einstellungen. Ob dort eine Betriebssystemtastatur erscheint, hängt von der Umgebung ab; deren Verfügbarkeit ist kein durch diese App erfüllter Eingabevertrag.
- [Makrovorlagen](/home/cnc/lcnc-suite/lcnc-webui/src/SettingsPanel.vue:785) benötigen zusätzlich geschweifte Klammern, etwa in `G0 Z{depth} F{feed}`. Technische Such-/Namensfelder brauchen auch Ziffern, Punkt, Bindestrich und Unterstrich. Ein reines Buchstabenlayout reicht daher selbst außerhalb des Editors nicht.
- Im Touchbetrieb unterdrücken [MDI](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:1783) und [CodeMirror](/home/cnc/lcnc-suite/lcnc-webui/src/GcodePanel.vue:565) die native Tastatur ausdrücklich. Dort ist die fehlende Zeichenabdeckung besonders relevant.

**Vorgeschlagener Umfang:** Alle bedienbaren Text-/Suchfelder an dieselbe Eingabehilfe anbinden; native Inputs, `MachineInput` und CodeMirror beim Feldinventar berücksichtigen. Touch-Eingabe muss ohne angeschlossene Hardwaretastatur möglich sein. Die automatische Anzeige für Touch und ein expliziter Tastaturaufruf bei fokussiertem Textziel sollen auch im Mischbetrieb aus Maus, Touch und Hardwaretastatur funktionieren. Keine zwei Bildschirmtastaturen gleichzeitig; native Eingabe nur dort unterdrücken, wo die eigene Hilfe tatsächlich verfügbar ist. Ein Suchfeld benötigt weiterhin nur seine bisherige Berechtigung, keine MDI-/Maschinenfreigabe.

| Ziel | Startansicht und erreichbare Eingaben |
|---|---|
| Zahlen-/Offsetfeld | Zahlen/Rechner mit bisherigem Feldvertrag; keine Buchstaben nötig. |
| MDI / G-code-Editor | Häufige Codezeichen direkt; Umschaltung zu vollständigen Buchstaben, Ziffern und Symbolen. Semikolon und Kommentar-Klammern leicht erreichbar. |
| Suche / Beschreibung / Namen | Buchstaben zuerst; Ziffern und Symbole über sichtbare Umschaltung. Groß-/Kleinschreibung sowie deutsche Textzeichen erreichbar. |
| Makrovorlage / technische Textfelder | Gleicher Text-/Symbolzugang, einschließlich `{}`; keine Beschränkung auf konfigurierte Achsbuchstaben. |

Als prüfbare Zeichenbasis für Code und technische Textfelder **alle druckbaren ASCII-Zeichen einschließlich Leerzeichen** vorsehen; Textfelder zusätzlich mindestens `ä ö ü Ä Ö Ü ß`. Dies ist ein vorgeschlagener Zeichenvertrag, keine Zusage beliebiger Unicode-Eingabe. Zeilenumbruch nur für mehrzeilige Ziele; Tab/Einrücken als Editoraktion. Backspace, gezieltes Positionieren des Cursors und Ersetzen einer Auswahl müssen per Touch nutzbar bleiben; für den Editor außerdem erreichbares Rückgängig/Wiederholen. Hierfür ist keine komplette PC-Tastatur mit Funktions- und Modifier-Reihen erforderlich. Enter bleibt feldabhängig; ein Suchfeld darf dadurch niemals MDI senden oder eine Maschinenaktion auslösen.

**Portrait-Vorschlag:** Zeichen vollständig zugänglich machen, aber auf austauschbaren Seiten anzeigen, etwa **Code / ABC / 123 / Symbole**, bei Bedarf mit sichtbar bezeichneten Unterseiten. Buchstaben-/Symbolseiten ersetzen die aktuelle Tastenfläche; sie werden nicht zusätzlich über dem vorhandenen Zahlenblock gestapelt. Seitenwechsel erhalten Besitzer, Entwurf, Cursor und Auswahl.

Die vorhandene [Portrait-Spalte](/home/cnc/lcnc-suite/lcnc-webui/src/App.vue:2708) ist außen 280 px breit; eine zehnspaltige Buchstabenreihe hätte schon ohne Abstände höchstens 28 px pro Taste. Deshalb keine geschrumpfte Desktop-Anordnung. Für diese Spalte eine kompakte Anordnung mit aus den vorhandenen Tastengrößen und der **inneren** Breite abgeleiteter Spaltenzahl vorsehen, bei Bedarf mehr Seiten. Tastenmaß, Aktionsbereich und Seitenumschalter bleiben stabil. Die unveränderte WP4-Zusage zu Viewer-/Content-Geometrie gilt auch für Seitenwechsel. Ein breites Tastatur-Dock wäre eine gesonderte Layoutänderung und darf nicht stillschweigend als Ausnahme eingeführt werden.

Die kompakte Anordnung ist zunächst ein zu prüfender Vorschlag: Vor der Implementierung muss der Plan eine konkrete Tastenbelegung samt Maßen für das kleinste unterstützte Portrait-Format zeigen. Falls ganze Wörter damit zu umständlich einzugeben sind oder wesentliche Aktionen nur durch ständiges Scrollen erreichbar wären, ist dieser Entwurf noch nicht akzeptiert. Insbesondere keine Behauptung „passt im Hochformat“ allein aufgrund von `flex-wrap` oder kleinerer Schrift. Safety-Controls sowie aktives Feld und Cursor müssen während der Eingabe erreichbar bzw. sichtbar bleiben; die Tastatur muss auch für Felder in Dialogen bedienbar sein, ohne deren Outside-Click-Schließen auszulösen.

**Ergänzende Abnahmefälle:**

- Kommentartexte mit `;` und `(...)`, Parameter-/Ausdruckszeichen wie in `#<tiefe> = [1 + 2]` sowie Makrotext `G0 Z{depth} F{feed}` ausschließlich über Touch eingeben und anschließend mitten im Text korrigieren. Dies sind Eingabeprüfungen, keine auszuführenden Maschinenprogramme.
- Die Zeichenbasis gegen die tatsächlich erreichbaren Tastaturseiten prüfen. Seitenwechsel während markierter Auswahl erhält diese; die nächste Zeicheneingabe ersetzt sie im richtigen Ziel.
- Werkzeug-, G-code-Referenz- und HAL-Suche öffnen die Textansicht; Wörter und technische Namen mit Zahlen/Symbolen lassen sich eingeben. Beschreibung mit Umlaut und Makrovorlage ebenfalls prüfen. Physische Tastatur bleibt parallel benutzbar.
- Suche → Zahl → Editor und zurück: jeweils genau ein Besitzer und passendes Layout, keine verlorenen Entwürfe oder ungewollten Bestätigungen. Suche im Dialog kann die gemeinsame Tastatur bedienen; andere Dialogziele erhalten keine Eingaben.
- Alle Seiten im kleinsten unterstützten Portrait-Viewport mit tatsächlichem Touch, beiden Themes und dem vereinbarten Zoom prüfen: ausreichende Tastenmaße, keine abgeschnittenen Zeichen/Aktionen, kein horizontaler Überlauf, bedienbarer Seitenwechsel; WP4 misst weiterhin innere Breiten und Referenzcontrols. Ein visueller Entwurf allein ersetzt diese Implementierungsabnahme nicht.

**Erwartete Claude-Antwort zu UI-15:** Gemeinsamen Sitzungsvertrag, Feldinventar, erreichbaren Zeichenvorrat und konkrete Portrait-Belegung zusammen in den Plan aufnehmen oder eine gleichwertige, begründete Alternative nennen. Die bisherige Empfehlung ist dadurch erweitert; weder ein vollständiges Plan-Agreement noch eine getestete Tastaturimplementierung wird behauptet.

---

## Runde 2 · Antworten Claude · 20. September 2026

Geprüfter Plan-Stand: **Fassung 3** (Kopf „Fassung 3 · 20. September 2026"). Die neun
akzeptierten Punkte sind unverändert; nur die fünf Nachschärfungen und UI-15 sind neu
eingearbeitet. Vor jeder Antwort wurde die zitierte Stelle gegengelesen: Antwortpfade des
Gateways (`gateway.py:7009`, `:7664`, `:7689`), `mkstemp(dir=dest_dir)` und `os.replace` im
Upload (`:6075-6116`), `offline_commands()` in `scripts/test_suite.py:104`, die CodeMirror-
Initialisierung (`GcodePanel.vue:527-560`), der Enter-Pfad des Numpads (`NumberKeypadStrip.vue:
85, :108`) sowie für UI-15 die drei Keypad-Wahrheiten (`App.vue:328-372, :1777, :2201`),
`GcodeKeypadStrip.vue`, `NumberKeypadStrip.vue`, der Textzweig von `MachineInput.vue:79` und
die Portrait-Spalte (`App.vue:2708`, Tokens `--key-size` 44 px, `--gap-tight` 4 px,
`--key-action-w` 70 px).

**UI-01 — übernommen.** Der Satz „ein Wechsel während des Ladens bricht das Erstellen des Views
ab" ist ersetzt. Neu: Der Import trägt die Sitzungs-ID; nach dem Import wird der View **genau
dann** erstellt, wenn `session.id` noch die aktuelle Sitzung ist — unabhängig von
`props.activeFile` — und der Doc-Inhalt ist `session.original`, nicht `props.gcodeContent`.
Ein externer Programmwechsel A→B während des Imports lässt Sitzung A gültig: View mit A's Text,
Konfliktbanner, „Keep editing" bedienbar. Nur eine verworfene oder durch eine neue ID ersetzte
Sitzung bricht ab; der alte Import installiert dann keinen View. Kein leeres Editierfenster als
Endzustand. Gezielter Test wie gefordert (Import verzögern, A→B, freigeben; nach Discard nichts).

**UI-06 — übernommen.** Bestätigt: pytest startet in `lcnc-gateway` mit `testpaths = ["."]`,
`scripts/` wird nicht entdeckt. `scripts/test_suite.py` `offline_commands()` bekommt im Backend-
Komponentenlauf den eigenen Eintrag `("audit-css", [python(), "-m", "pytest",
str(ROOT / "scripts/test_audit_scoped_css.py")], ROOT)` — Teil von WP2, keine Discovery-
Annahme. Abnahme: der Report des gewöhnlichen Offline-Laufs listet `audit-css`; eine absichtlich
falsche Fixture-Erwartung macht ihn rot, nach Rücknahme grün. `docs/testing.md` nennt den Eintrag.

**UI-09 — übernommen.** Der `O_CREAT|O_EXCL`-Kopier-Fallback ist gestrichen (die Probe des
Reviews ist richtig: der Zielpfad wäre vor Vollständigkeit lesbar). Hauptweg bleibt `os.link`
der fertig geschriebenen Temp-Datei (sie liegt per `mkstemp(dir=dest_dir)` bereits im
Zielverzeichnis). Unterstützt das Dateisystem `os.link` nicht (EPERM/ENOTSUP/EXDEV/EMLINK),
wird der Upload mit HTTP 500 und verständlicher Meldung abgelehnt, die Temp-Datei bereinigt und
ein Trace-Event geschrieben; der Zielpfad existiert nie teilweise. Tests: concurrent Reader
sieht vor Veröffentlichung kein Ziel und danach nur den vollständigen Inhalt; `os.link` auf
ENOTSUP gepatcht → 500, kein Ziel, kein `.part`-Rest; Abbruch mid-write → kein Ziel; bestehende
Upload-/Save-Regressionen bleiben. Keine sichtbare Reservierungsdatei.

**UI-11 — übernommen.** Eine zentrale `validateEntry(expr, constraints, owner)` liefert
`{ value | null, reason }` und speist Readout, OK-Button **und** `confirm()`. `confirm()`
prüft erneut und kehrt bei ungültigem Wert ohne Callback und ohne Schließen zurück (Eingabe
bleibt); der physische Enter-Handler ruft dasselbe `confirm()`, ein deaktivierter OK-Button ist
nie die einzige Sperre. Besitzerverlust → Cancel-Pfad. Tests: `min=1` mit `0` bzw. leer → Enter
und Touch-OK senden nichts; Bruchteil im Integer-Feld ebenso; gültige Zahl über beide Wege.

**UI-12 — übernommen.** Gegenfall anerkannt: `cmd` + lokale ID identifiziert die Antwort nicht.
Lösung: eine **Request-ID auf dem Draht**. Der Client sendet `req_id` (monoton pro Tab;
`send()`/`fire()` liefern es zurück), das Gateway echot es auf **jedem** Antwortpfad — Erfolg/
Fehler im Dispatcher (`gateway.py:7009`), „Superseded by abort", „Preempted by …" und Handler-
Exception (`:7664`, `:7689`, an den `_wcmd`-Stellen mit dem `req_id` des verdrängten Befehls);
`lcncWs` übernimmt es in `lastReply`. Zuordnung im Dialog ausschließlich `lastReply.req_id ===
saveSession.id`; fremde `req_id` werden ignoriert. Zusätzlich ist ein zweiter Versand gesperrt,
solange `saving` gesetzt ist. Backend-Test: Echo auf ok, ok:false, superseded, preempted;
Befehle ohne `req_id` antworten ohne. Gezielter Test wie gefordert (zwei Sitzungen, gleicher
`cmd`, altes `ok` trifft ein → B bleibt offen/pending; B's eigenes Reply schließt).

**UI-15 — übernommen, als WP8 mit Entscheidungen.** Gemeinsamer Sitzungsvertrag
(`src/inputSession.ts`, genau eine aktive Sitzung mit `ownerId`, `kind`, `context`,
`constraints`, `page`, `target`-Aktionen und kurzlebigen Zahlenentwürfen je Besitzer);
`stripVis` und die Darstellung werden nur daraus abgeleitet, `mdiKeypadActive`/
`gcodeEditActive`/`keypadState.open` entfallen als getrennte Wahrheiten. Alle sieben
Bedienregeln der Codex-Tabelle sind übernommen, ebenso: zielabhängige Bestätigungen (Übernehmen
/ Senden / Zeilenumbruch + Speichern; Suchfeld-Enter nie MDI), `blur` kein Schließkriterium,
verborgenes gemountetes Ziel sperrt statt beendet (UI-13-Nachtrag), Fokus-Rückgabe nie an ein
altes Ziel bei gewechseltem Besitzer. Feldinventar: MachineInput Zahl/Text, MDI, CodeMirror,
die drei nativen Suchfelder (werden `MachineInput type="text"`), Makrovorlage/Settings-Text.
Zeichenvertrag: alle 95 druckbaren ASCII-Zeichen inkl. Leerzeichen, Textfelder zusätzlich
`ä ö ü ß Ä Ö Ü`, verteilt auf vier Seiten **Code / ABC / 123 / Sym** (Belegung im Plan
aufgezählt; 123 + Sym decken zusammen alle 32 ASCII-Satzzeichen, Code dupliziert `; ( ) # =`),
feste Aktionsreihe `⇧ | Space | ⌫ | Enter/Send/OK`, Navigationsreihe `← → ↶ ↷ Tab/Clear` für
Code-/Text-Ziele, fester Seitenschalter. Portrait-Belegung mit Maßrechnung: innen ≈ 253 px
(280 − 16 Padding − ~11 Gutter) → **5 Spalten à 44 px** (6 passen nicht; 36-px-Kompaktmaß wird
für Wörter nicht gewählt); Inhaltsseiten immer auf 6 Zeilen aufgefüllt (ABC = 30 Zellen exakt),
Sektionshöhe ≈ 470 px, unter dem sticky SafetyStrip ohne Scrollen erreichbar, aktives Feld
rechts der Spalte sichtbar; explizites 5-Spalten-Grid, kein `flex-wrap`, keine kleinere Schrift.
Landscape: feste 5 Zeilen, spaltenweiser Fluss, Rails rechts; Breite ändert nur die Scrollweite.
**Entscheidungen zur Bestätigung:** (a) ohne Touch öffnet die Hilfe nur über ein explizites
Tastatur-Glyph am fokussierten Textfeld (neues globales Muster `.inputWithAction`), auf Touch
automatisch; (b) alphabetische Belegung der ABC-Seite (kein QWERTZ) — auf 5 Spalten ist die
alphabetische Ordnung vorhersagbar, QWERTZ wäre zerrissen; (c) die drei nativen Suchfelder
werden auf `MachineInput` umgestellt, damit ein Besitzervertrag gilt. Tests wie in der Codex-
Liste, ergänzt um einen Unit-Test des Zeichenvertrags über die Seitendefinitionen und
`measureLayout` auf der Tastatursektion bei jedem Seitenwechsel im kleinsten Portrait-Format
mit `hasTouch`. Reihenfolge: WP8 nach WP0 und WP6 (Feldvertrag und Besitzerregeln zuerst).

**Stand:** Aus Claudes Sicht sind UI-01 bis UI-15 mit akzeptierter Lösung und Prüfansatz
geschlossen. Offen für Runde 3: Bestätigung der fünf Nachschärfungen und der drei
UI-15-Entscheidungen (a)–(c).

---

<a id="codex-runde-3"></a>

**Codex · Runde 3 · 20. September 2026 — 14 von 15 Planpunkten akzeptiert; UI-15 gezielt nachschärfen**

Geprüft: [Plan, Fassung 3](/home/cnc/.claude/plans/das-aktuelle-webui-von-optimized-perlis.md), 562 Zeilen, SHA-256 `3ae6a1719b9fa34b9e02c7e57adb06b14cc5a6c1cdf5808a0e1ede9f662cee33`, sowie Claudes vorstehende Antworten. Der Code steht weiterhin bei `8de45e99e4925b9f052ce5c0f394b5fd357712b8`. Planzeilen in dieser Runde beziehen sich ausschließlich auf Fassung 3. Geprüft wurden Quellcode, Tastenseiten als Zeichenmengen, eine beispielhafte Eingabefolge und die Maßrechnung. Keine Builds, Browser-/Volltests oder Maschinenbefehle; insbesondere keine behauptete Umsetzung der neuen Tastatur.

**Die fünf Nachschärfungen aus Runde 2 sind akzeptiert.**

| ID | Warum der neue Plan den Einwand erfüllt |
|---|---|
| UI-01 | Zeilen 171–180: Import an die Editiersitzung gebunden; externer Programmwechsel verhindert den View aus `session.original` nicht mehr. Discard/ersetzte Sitzung bleibt separat abgefangen. |
| UI-06 | Zeilen 253–259: eigener `audit-css`-Eintrag im Offline-Runner mit explizitem Testpfad, Report-Abnahme und Gegenprobe. |
| UI-09 | Zeilen 212–226: Kopier-Fallback entfernt; nicht unterstützte atomare Veröffentlichung wird abgelehnt und bereinigt. Concurrent Reader und Fehlerpfade sind benannt. |
| UI-11 | Zeilen 191–201: dieselbe Zulässigkeitsprüfung in Anzeige, OK und `confirm()`; dadurch ist der direkte Enter-Pfad abgedeckt. |
| UI-12 | Zeilen 271–289: vom Gateway zurückgesendete `req_id` statt bloß lokaler Sitzungskennung; verspätete Antwort A kann Sitzung B nicht bestätigen. |

Für UI-12 gilt die Zusage **jedes befehlsbezogenen Antwortpfads** tatsächlich auch für die Queue-Ablehnung vor dem Worker ([gateway.py](/home/cnc/lcnc-suite/lcnc-gateway/gateway.py:7971)); bei der Umsetzung ist dafür ebenfalls ein Echo-/Fehlertest erforderlich. Die neue Request-ID-Regel gilt auch für Delete: Den veralteten alleinigen `lastReply.cmd`-Verweis in Planzeile 382 an WP3 angleichen. Das präzisiert die bereits zugesagte Abdeckung und eröffnet den gelösten Zuordnungsansatz nicht erneut. Ebenso die Rückgabetypen von `send`/`fire` konsistent machen: WP3 nennt eine Request-ID, WP6 noch `true/false`; ein verweigerter Versand darf keine gültige Request-ID bzw. kein Pending erzeugen.

Die neun zuvor akzeptierten Punkte bleiben akzeptiert. Die Kamera-Zusage bleibt ausdrücklich auf Default-Framing begrenzt; allgemeiner Kollisionsschutz beim Zoomen/Pan und der Reset-Zwischenweg sind weiterhin nicht enthalten.

**UI-15 — Was jetzt passt**

Ein Sitzungsvertrag, genau ein Besitzer, erhaltene Entwürfe, feldabhängiges Enter und die Anbindung der Text-/Suchfelder sind die richtige Richtung. Die Mengenprobe der geplanten Seiten ergibt: `123` hat 23 Zeichen, `Sym` 19; zusammen enthalten sie alle 32 ASCII-Satzzeichen. Mit Groß-/Kleinbuchstaben und Space fehlt keines der 95 druckbaren ASCII-Zeichen. Semikolon, beide Kommentar-Klammern, Parameter-/Ausdruckszeichen und Makroklammern sind also berücksichtigt.

Auch die Portrait-Breitenrechnung stimmt als Entwurfsbasis: fünf Tasten à 44 px plus vier Abstände à 4 px ergeben 236 px; sechs Spalten ergäben 284 px und passen nicht in die vorhandene Spalte. Die alphabetische ABC-Seite ist als kompakte Entwurfsentscheidung vertretbar; ihre praktische Schreibbarkeit bleibt Teil der vorgesehenen Abnahme. Automatische Touch-Anzeige plus expliziter Aufruf bei Mausbedienung ist ebenfalls akzeptiert, sobald der folgende Fokusablauf geklärt ist. Eine zusätzliche Operator-Freigabe wird hier nicht behauptet oder verlangt.

**UI-15a — Öffnen/Schließen braucht mehr als Fokus plus Outside-Pointer.**

Planzeilen 416–430 beschreiben Schließen durch Pointer außerhalb und die Fokus-Rückgabe nach Confirm/Cancel; Zeilen 437–440 öffnen auf Touch bei Fokus. Daraus ergeben sich noch drei unbehandelte Übergänge:

- **Tab nach außen:** Ein reiner Outside-`pointerdown` erfasst den physischen Tab-Wechsel nicht. Der Abnahmefall steht bereits im Plan, aber sein logischer Fokusbereich ist noch nicht vollständig beschrieben.
- **Schließen und erneut dasselbe Feld antippen:** Weil die Hilfetasten mit `pointerdown.prevent` den Fokus im Textfeld belassen, kann das geschlossene Ziel weiter fokussiert sein. Der nächste Tap erzeugt dann keinen neuen Fokuswechsel; ein ausschließlich an `focus` gebundener Aufruf öffnet die Hilfe nicht wieder.
- **Fokus-Rückgabe nach Abschluss:** Beim Numpad liegt der Fokus heute im Keypad-Root ([NumberKeypadStrip.vue](/home/cnc/lcnc-suite/lcnc-webui/src/NumberKeypadStrip.vue:27)). Wird nach Confirm/Cancel der Trigger fokussiert und öffnet Touch-Fokus automatisch, erscheint die gerade geschlossene Hilfe sofort erneut. Die Prüfung auf einen anderen Besitzer verhindert diesen Fall mit demselben Besitzer nicht.

**Erforderliche Ergänzung:** Feld, Aufruf-Button und Hilfe als gemeinsamen Fokusbereich behandeln; Fokuswechsel innerhalb erhalten die Sitzung, Fokus/Tab nach außen blendet sie ohne Bestätigung aus. Bewusster Tap bzw. expliziter Aufruf kann auch bei bereits fokussiertem Feld öffnen. Programmatische Fokus-Rückgabe nach Schließen/Confirm/Verwerfen öffnet nicht automatisch erneut. Alle drei Übergänge sowie Tab innerhalb der Hilfe ausdrücklich testen. Kein pauschales `blur → close` einführen.

**UI-15b — Die Code-Startseite braucht Ziffern direkt neben häufigen Codezeichen.**

Die Seite in Planzeilen 445–450 enthält viele Buchstaben, aber keine einzige Ziffer; diese liegen nur auf `123`. Für die einfache Eingabefolge `G1 X20 Y10 F1000` braucht man ab Code-Seite **sieben Seitenwechsel**. Die vorhandene [G-code-Tastatur](/home/cnc/lcnc-suite/lcnc-webui/src/GcodeKeypadStrip.vue:43) zeigt Buchstaben und Ziffern gleichzeitig. Der vollständige Zeichenvorrat allein würde deshalb einen häufigen Bedienweg verschlechtern.

**Erforderliche Ergänzung:** Eine gemeinsame Code-Startseite mit `0–9`, Punkt, Minus, `G M T F S` und den konfigurierten Achsbuchstaben; seltenere Buchstaben bleiben über ABC/weitere Seiten erreichbar. Diese Basis benötigt selbst bei neun Achsen nur 26 der 30 Zellen; die restlichen vier könnten `; ( ) #` aufnehmen. Bei weniger Achsen können freie Plätze weitere häufige Codebuchstaben enthalten. Das ist eine mögliche Belegung, keine Vorschrift zur exakten Reihenfolge. Abnahme: die genannte einfache Codezeile ohne Seitenwechsel eingeben; Kommentare und komplexere Ausdrücke weiterhin vollständig erreichbar.

**UI-15c — Die Maßskizze braucht einen vollständigen Höhen- und Beschriftungsvertrag.**

Die Portrait-Skizze enthält Titel und Readout zusätzlich zu neun Tastenzeilen. Landscape nennt dagegen fünf 44-px-Zeilen innerhalb von 264 px. Bereits die fünf Zeilen samt Abständen, heutigem Titel und einem Abschnittsabstand benötigen **260,5 px**, wie auch [style.css](/home/cnc/lcnc-suite/lcnc-webui/src/style.css:134) herleitet. Ein zusätzlicher Readout unter dem Titel passt dort nicht hinein. Die Zeichenseiten passen in die Breite; daraus folgt noch kein passender Landscape-Aufbau. Außerdem braucht „Schließen“ im 44-px-Seitenschalter eine konkrete passende Darstellung.

**Erforderliche Ergänzung:** Den Landscape-Kopf ausdrücklich ohne zusätzliche Readout-Zeile planen oder den Readout seitlich innerhalb des bestehenden Budgets anordnen; das aktive Originalfeld bleibt sichtbar. Für schmale Aktions-/Seitentasten passende Icons mit zugänglichem Namen bzw. nachgewiesen passende Beschriftungen festlegen. Seitenwechsel in beiden Ausrichtungen gegen das vollständige Budget prüfen; bei Portrait auch Safety-Bereich, eventuell sichtbare Besitzer-Sektion und den vereinbarten Zoom berücksichtigen. Die Aussage „ohne Scrollen erreichbar“ nur für den tatsächlich nachgewiesenen Zustand treffen. Keine größere Strip-Höhe als stillschweigende Ausnahme von WP4.

**UI-15d — Die neue Spec auch in den konkreten Projektfiltern ergänzen.**

Planzeile 533 sagt zwar, `serial-guards` umfasse zusätzlich `input-session.spec.ts`. Die tatsächliche Definition in Zeilen 511–513 enthält sie aber weder im `testMatch` noch im beschriebenen `chromium.testIgnore` und spricht weiter von drei Dateien. Nach dieser Definition würde die neue Datei im allgemeinen parallelen Projekt laufen; dort konkurrieren ihre `ctl reset`-/Statusänderungen mit anderen Tests des gemeinsamen Mocks. Die Gefahr ist im vorhandenen [Playwright-Aufbau](/home/cnc/lcnc-suite/lcnc-webui/playwright.config.ts:42) bereits dokumentiert.

**Erforderliche Ergänzung:** Einen gemeinsamen Filter für alle vier Guard-Specs einschließlich `input-session` für `serial-guards.testMatch` und `chromium.testIgnore` benennen; `workers: 1` und die Projektkette bleiben. Die spätere Test-Auflistung muss die Datei genau einmal und nur in `serial-guards` zeigen. Dies ergänzt UI-15 um seine neue Datei; die zuvor akzeptierte Isolation der ursprünglichen drei Specs wird nicht erneut infrage gestellt.

**Kleine sachliche Korrekturen beim Einarbeiten:** Die drei genannten Suchfelder sind bereits `MachineInput type="text"` ([Tools](/home/cnc/lcnc-suite/lcnc-webui/src/ToolTablePanel.vue:528), [Referenz](/home/cnc/lcnc-suite/lcnc-webui/src/GcodeReferenceDialog.vue:55), [Halshow](/home/cnc/lcnc-suite/lcnc-webui/src/HalshowTab.vue:134)). Sie brauchen die neue Besitzer-/Tastaturanbindung, keinen Wechsel von nativen Inputs zu `MachineInput`. In der Verifikationstabelle außerdem den Upload-Testpfad an den in WP0 festgelegten Ort `lcnc-gateway/test_upload_conflict.py` angleichen; dort steht derzeit zusätzlich ein nicht vorgesehener `tests/`-Unterordner.

**Nächste Abstimmung:** UI-15a–d und die genannten widersprüchlichen Restformulierungen in einer konsistenten Fassung beantworten. Die anderen 14 Planpunkte sind akzeptiert; ihre erfolgreiche Implementierung ist damit noch nicht geprüft. Ein vollständiges Plan-Agreement steht nur noch für diesen klar begrenzten Nachtrag aus.

---

## Runde 3 · Antworten Claude · 20. September 2026

Geprüfter Plan-Stand: **Fassung 3, Revision R3** (die Änderungen sind im Plan mit `[R3]`,
`[UI-15a]`–`[UI-15d]` markiert). Gegengelesen: der Queue-Voll-Antwortpfad
(`gateway.py:7971`, antwortet heute ohne `req_id`), die drei Suchfelder (bereits
`MachineInput type="text"` mit Gate `search`), die Landscape-Höhenherleitung (`style.css:134`:
16,5 + 8 + 5 × 44 + 4 × 4 = 260,5 px) und die Playwright-Filter (`playwright.config.ts:42`).

**UI-12-Präzisierungen — übernommen.** Der Queue-Ablehnungspfad („Command queue full",
`:7971`) echot `req_id` ebenfalls; der Backend-Test deckt ok, ok:false, superseded, preempted
und queue-full. Delete korreliert über `req_id` wie Save/Renumber (der Verweis auf
`lastReply.cmd` allein ist gestrichen). Rückgabetyp vereinheitlicht: `send()`/`fire()` liefern
`req_id | null`; `null` genau dann, wenn nichts gesendet wurde (Gate zu, Busy-Latch, verweigert)
und erzeugt nie ein Pending — gilt für WP3 und WP6 (`confirmSent`).

**UI-15a — übernommen.** Öffnen ist nie an `focus` gebunden: Auslöser sind `pointerup`/`click`
auf das Feld (Touch, auch wenn das Feld bereits fokussiert ist — der Tap nach dem Schließen
öffnet wieder), Enter/Space auf dem Zahlenfeld, oder das Tastatur-Glyph (ohne Touch). Feld +
Glyph + Hilfe-Sektion sind ein logischer Fokusbereich (`data-input-area`): Fokuswechsel und Tab
innerhalb erhalten die Sitzung; `focusout` mit `relatedTarget` außerhalb (physisches Tab nach
außen) oder `pointerdown` außerhalb blendet ohne Bestätigung aus; kein pauschales `blur → close`.
Programmatische Fokus-Rückgabe nach Confirm/Cancel/Schließen kann deshalb nicht erneut öffnen.
Alle drei Übergänge und Tab innerhalb der Hilfe sind als Tests im Plan.

**UI-15b — übernommen.** Die Code-Startseite enthält `0–9 . -`, `G M T F S`, die konfigurierten
Achsbuchstaben (≤ 9) und `; ( ) #` (≤ 30 Zellen); freie Zellen bei weniger Achsen füllen
`I J K P R Q H D L N O E`. Abnahmefall: `G1 X20 Y10 F1000` ohne Seitenwechsel; Kommentare und
Ausdrücke bleiben über 123/Sym/ABC vollständig erreichbar. Vorgabe ist die Zeichenmenge, nicht
die exakte Reihenfolge.

**UI-15c — übernommen.** Die Text-/Code-Hilfe hat keine Readout-Zeile — das sichtbare
Originalfeld ist das Readout; nur die Zahl-Hilfe behält ihr Display (passt heute). Landscape
bleibt im 260,5-px-Budget: fünf Zeilen, Inhalt spaltenweise, Aktions-, Navigations- und
Seitenrail als Spalten innerhalb dieser fünf Zeilen, kein zusätzlicher Kopf. Portrait-Reihenfolge:
Titel → Seitenschalter → Aktionsreihe → Navigationsreihe → 6 Inhaltszeilen (Bestätigen und
Seitenwechsel in den ersten drei Zeilen); Sektionshöhe 452,5 px (Text/Code) bzw. 408,5 px.
„Ohne Scrollen erreichbar" wird nicht behauptet, sondern im `hasTouch`-Test bei 900 × 1200 mit
sichtbarem SafetyStrip, ggf. Besitzer-Sektion und 150 % Zoom gemessen; schlägt das fehl, wird die
Belegung überarbeitet (Kandidat: Navigationsreihe in die Aktionsreihe falten), nie durch eine
größere Strip-Höhe/-Breite. Beschriftungsvertrag für 44-px-Zellen: Schließen = lucide `X`
(`aria-label="Close keyboard"`), Sym-Seite = `#+=`, ⇧ = `ArrowBigUp` mit `aria-pressed`,
⌫ = `Delete`, Enter zielabhängig (`CornerDownLeft` / `Send` / `OK`), Navigation als Icons,
`Tab`/`Clr` als Text; Text-Labels ≤ 4 Zeichen, längere nur in ≥ 2 Zellen oder im 70-px-Rail;
jede Taste mit `aria-label` + `title`. Seitenwechsel werden in beiden Ausrichtungen per
`measureLayout` gegen das volle Budget geprüft (keine `clipped-control`/`outside-panel`).

**UI-15d — übernommen.** Ein gemeinsamer Filter `guardSpecs =
/(keyboard-guards|editor-guards|touch-hold|input-session)\.spec\.ts/` steht in
`serial-guards.testMatch` und in `chromium.testIgnore`; `workers: 1` und die Kette bleiben.
Abnahme: `npx playwright test --list` zeigt jede der vier Dateien genau einmal, nur unter
`serial-guards`.

**Sachliche Korrekturen — übernommen.** Die drei Suchfelder sind bereits `MachineInput`; der
Plan spricht jetzt nur noch von der Besitzer-/Tastaturanbindung. Der Upload-Testpfad in der
Verifikationstabelle lautet `lcnc-gateway/test_upload_conflict.py` (kein `tests/`-Unterordner).

**Stand:** Aus Claudes Sicht sind alle 15 Punkte mit akzeptierter Lösung und Prüfansatz
geschlossen. Offen ist nur noch die Bestätigung von UI-15a–d durch Codex.

---

<a id="codex-runde-4"></a>

**Codex · Runde 4 · 20. September 2026 — Plan-Agreement erreicht, UI-01 bis UI-15 akzeptiert**

Geprüft: [Plan, Fassung 3 mit Revision R3](/home/cnc/.claude/plans/das-aktuelle-webui-von-optimized-perlis.md), 625 Zeilen, SHA-256 `72518910a229f55c187a20861bb10d06e86af5bd198b0ac626bbf3fe9c389e16`, und Claudes Antworten auf Runde 3. Der Dateikopf nennt weiterhin Fassung 3; Revision R3 wird deshalb zusätzlich durch Umfang und Hash identifiziert. Quellcode-Stand unverändert: `8de45e99e4925b9f052ce5c0f394b5fd357712b8`. Planzeilen unten gelten für diese Revision.

**UI-15a–d sind auf Planebene geschlossen.**

| Teilpunkt | Bewertung der neuen Fassung |
|---|---|
| UI-15a: Fokus und erneutes Öffnen | Zeilen 435–460, 468–474: bewusster Tap bzw. expliziter Aufruf öffnet; Fokus allein öffnet nicht. Feld, Aufruf-Button und Hilfe bilden einen gemeinsamen Eingabebereich. Tab nach außen blendet aus, interne Fokuswechsel erhalten die Sitzung. Erneutes Antippen desselben Felds und Fokus-Rückgabe ohne erneutes Öffnen sind ausdrücklich zu testen. Damit sind die drei Gegenfälle aus Runde 3 ausreichend behandelt. |
| UI-15b: Code und Ziffern | Zeilen 478–483: Ziffern, Punkt, Minus, häufige Codebuchstaben, konfigurierte Achsen und `; ( ) #` liegen gemeinsam auf der Startseite. Die lokale Mengenprobe für XYZ, XYZAC, XYZABC und neun Achsen ergibt jeweils höchstens 30 Zellen; `G1 X20 Y10 F1000` ist ohne Seitenwechsel erreichbar. Der vollständige ASCII-/Textzeichenvertrag bleibt erhalten. |
| UI-15c: Maße und Beschriftungen | Zeilen 491–533: Text/Code erhalten keinen zusätzlichen Readout; das Originalfeld bleibt sichtbar. Landscape bleibt mit 260,5 px innerhalb des 264-px-Budgets. Schmale Aktionen haben passende Icons bzw. kurze Labels. Portrait und 150 % Zoom müssen inklusive Safety-/Besitzerbereich gemessen werden; ein Fehlschlag verlangt eine überarbeitete Belegung und erlaubt keine stillschweigende WP4-Ausnahme. Dieser Lösungs- und Prüfansatz ist ausreichend konkret. |
| UI-15d: Testzuordnung | Zeilen 570–579: derselbe `guardSpecs`-Filter enthält alle vier Dateien und wird für `serial-guards.testMatch` sowie `chromium.testIgnore` verwendet. Ein Worker, Projektkette und Abnahme der Test-Auflistung sind festgelegt. Die lokale Regex-Probe erfasst alle vier Guard-Specs und schließt den Viewer-Spec aus. |

**Die ergänzenden Korrekturen sind ebenfalls aufgenommen:** Request-ID-Echo auch bei Queue-Ablehnung, einheitlicher Rückgabevertrag ohne Pending bei verweigertem Versand, Delete-Zuordnung über `req_id`, Anbindung der bereits vorhandenen `MachineInput`-Suchfelder und korrigierter Upload-Testpfad. Die zuvor akzeptierten 14 Punkte bleiben geschlossen.

**Redaktioneller Hinweis ohne Sperrwirkung:** In Planzeile 515 ergibt die optionale Variante ohne Navigationsreihe mit acht statt neun Zeilen nach derselben Formel **404,5 px**, nicht 408,5 px: `16,5 + 8 + 8 × 44 + 7 × 4`. Die Hauptvariante mit neun Zeilen und 452,5 px stimmt. Die Korrektur verkleinert den benötigten Platz und verändert weder Lösungsansatz noch Abnahmekriterien; dafür ist keine weitere Agreement-Runde nötig.

**Geltung des Agreements:** Die vereinbarten Lösungen, Reihenfolge und Prüfkriterien sind für die Umsetzung akzeptiert. Die alphabetische ABC-Seite und die übrige Tastaturbelegung sind damit ein akzeptierter Entwurf; ihre tatsächliche Bedienbarkeit, Dialoginteraktion, Touch-Ereignisse und Geometrie müssen die vorgesehenen Tests und Sichtprüfungen noch bestehen. Die begrenzte Kamera-Zusage (Default-Framing), die zurückgestellte vollständige Dialog-Fokusführung und die spätere physische Touchscreen-Abnahme bleiben wie dokumentiert.

Diese Runde umfasste Dokument-/Quellcodeabgleich und kleine lokale Proben zu Zeichenmengen, Seitenbelegung, Maßen und Testfilter. Es wurden keine Builds, Browser-/Volltests oder Maschinenbefehle ausgeführt und keine Produktdateien geändert. **Die Planabstimmung ist abgeschlossen; die Implementierungsabnahme folgt separat.**

## Umsetzung · 20. September 2026 · Claude

Branch `feat/ui-review-wave` (von `development` 8de45e9), ein Commit je Arbeitspaket
(WP0 9135eba, WP1 5016d13, WP2 18bb416, WP3 6fd2d6c, WP4 a8913b4, WP5 efa2e3c,
WP6 246ed60, WP7 41a3dbc, WP8 dcf9564 + fb48f32). Plan-Fassung 3/R3 liegt als
`docs/reviews/ui-optimierungen.plan.md` daneben (mit der 404,5-px-Korrektur aus Runde 4).

**Bewusste Abweichungen vom Plan (zur Prüfung im Implementierungs-Review):**

| Stelle | Plan | Umsetzung | Grund |
|---|---|---|---|
| UI-15a Tastatur-Glyph | globales Muster `.inputWithAction`: Wrapper um das `.inputField` mit nachgestelltem Icon-Button | globales Muster `.inputAction`: das Glyph wird von `MachineInput` per Body-Teleport am rechten Feldrand verankert (nur ohne Touch, nur bei Fokus, gehört zum Fokusbereich) | Ein Wrapper um jedes der ~20 Textfelder verändert deren Layout-Kontext (Grid-Zelle, Flex-Item mit `flex: 1`, `.w-full`) und damit die Layout-Gates; das verankerte Glyph lässt jede Feldgeometrie unverändert. Öffnen bleibt ausschließlich Tap/Klick oder Glyph, nie Fokus. |
| UI-10 „No grid file" | Client bildet `ok:false "No grid file"` auf `grid: 'empty'` ab | Gateway antwortet `ok: true, comp_grid: null, reason: "no grid file"`; Client bildet `null` auf `'empty'` ab; „Invalid grid file" bleibt `ok:false` → `'error'` | Jede `ok:false`-Antwort landet generisch im Message-Center (`lcncWs`); genau dieser Toast war der P1-Befund. Fehlen ist ein Zustand, kein Fehler. |
| Wizard „Restart" | Bestätigungsdialog | Restart ist immer gerendert (deaktiviert bei 0 Erfassungen) und braucht einen zweiten Druck innerhalb von 3 s („Press again to restart") | Ein verschachtelter Overlay-Dialog im Wizard-Dialog würde vom `.dialog` geclippt; feste Slots (P2) sind damit ebenfalls erfüllt. |
| WP3 Save-Fluss | Disconnect → „outcome unknown — table reloaded" | Meldung „outcome unknown, the table reloads on reconnect"; der Reload läuft über den bestehenden `connected`-Watcher | gleiche Semantik, kein zweiter Reload-Pfad |

**Noch offen (Suite lief während der gesamten Umsetzung live — keine Builds, Vitest, Playwright, vgl. Plan „Alle schweren Gates erst nach Suite-Stopp"):**

1. `cd lcnc-webui && npm run build && npm run lint && npx vitest run` — die TS-Prüfung ist bislang nur statisch (Diff-Durchsicht) erfolgt.
2. `npx playwright test --list` (Abnahme UI-15d: jede Guard-Spec genau einmal unter `serial-guards`), dann `npm run test:e2e`.
3. Visuelle Referenzen erneuern (Linux, nach Sichtprüfung): `npm run test:visual:update` — neu sind `tool-edit-<viewport>.png`, geändert die Portrait-Referenzen (WP4).
4. `python3 scripts/test_suite.py offline` — Report enthält `audit-css`.
5. Live-Sichtprüfung auf dem XYZAC-Sim gemäß Plan-Tabelle (Kamera von unten + Reset + zweite Pose; Numpad; Tool-Dialog mit FreeCAD-Tool inkl. Keypad; Offset-Clear per Hold mit WCS-Wechsel; Leertaste/Escape bei offenem Numpad; Text-Tastatur Landscape/Portrait, Dark/High-Contrast, Zoom 150 %).

Bereits grün (leichtgewichtig, während der Suite): `pytest test_upload_conflict.py` (8), `pytest test_ws_command_worker.py -k ReqIdEcho` (2), `pytest scripts/test_audit_scoped_css.py` (11), `npm run lint:css`.

---

<a id="ux-konsistenz-2026-09-21"></a>

## UX-Nachtrag · Einheitliche Aktionen und Symbole · 21. September 2026

**Anlass:** Der Nutzer nennt `Cancel` beim Numpad, X bei der Text-Tastatur und Quadrat bei `Abort` und fragt nach weiteren vergleichbaren Inkonsistenzen. Geprüft wurde der Quellcode bei `17ec849`. Dies ist eine Bestandsaufnahme mit Vorschlägen zur Abstimmung, kein neuer Browserlauf und noch keine angenommene Planänderung.

**Wichtigste Feststellung:** Beim Numpad unterscheiden sich auch die Wirkungen: `Cancel` löscht den Zahlenentwurf, während Verlassen per Outside/Tab ihn erhält. Das X der Text-Tastatur beendet nur die Hilfe; der eingegebene Text bleibt im Feld beziehungsweise Editor. Ein bloßer Austausch von `Cancel` gegen ein X würde diese Unterscheidung verdecken. Die Bedeutung der Aktion muss vor der Darstellung festgelegt werden.

| ID | Beobachtung im aktuellen Code | Vorschlag für die Abstimmung |
|---|---|---|
| UX-01 | **Eingabehilfe schließen / Eingabe verwerfen:** [NumberKeypadStrip.vue:150](../../lcnc-webui/src/NumberKeypadStrip.vue#L150) entfernt beim Cancel den Entwurf; [useNumberKeypad.ts:112](../../lcnc-webui/src/useNumberKeypad.ts#L112) erhält ihn beim Ausblenden. Das [Tastatur-X](../../lcnc-webui/src/TextKeypadStrip.vue#L101) schließt ausschließlich die Hilfe. Zudem liegt Cancel im Portrait unten im Zahlenblock, X oben bei den Text-Seiten. | Ein gemeinsamer, eindeutig benannter **X-Schließen-Pfad** für beide Hilfen: ausblenden, Eingabe erhalten, nichts bestätigen/senden/speichern. Bewusstes Verwerfen ausdrücklich als `Discard` behandeln. Gemeinsame Platzierungsregel pro Ausrichtung; die bestehenden Touch-/Portrait-Grenzen weiter einhalten. Das wäre eine bewusste Änderung des bisherigen Numpad-Cancel-Vertrags. |
| UX-02 | **X führt auch Änderungen aus:** In der [Keyboard-Konfiguration](../../lcnc-webui/src/KeyboardTab.vue#L169) entfernt × eine Belegung und speichert sie (`unbindKey`, Zeile 112). Bei den [Maschinenfarben](../../lcnc-webui/src/SettingsPanel.vue#L624) entfernt × die gespeicherte Sonderfarbe (`resetMachineColor`, Zeile 482). Im Tool-Editor ruft X denselben Verwerfpfad wie Cancel auf ([ToolTablePanel.vue:654](../../lcnc-webui/src/ToolTablePanel.vue#L654)). | Für das Entfernen einer Zuordnung `Remove binding`, für die Farbe `Reset color` mit passendem Symbol bzw. eindeutigem Tooltip/zugänglichem Namen. Für Formulare festlegen, was Schließen bei ungespeicherten Änderungen bedeutet; dieselbe Regel über Header-X und Footer-Aktion anwenden. |
| UX-03 | **Gleiche Aktion, unterschiedliche Zeichnung und Benennung:** Numpad-Backspace ist das Schriftzeichen `⌫` ohne erklärendes Label ([Zeile 215](../../lcnc-webui/src/NumberKeypadStrip.vue#L215)), die Text-Tastatur verwendet ein Lucide-SVG mit `Backspace`-Label ([Zeile 66](../../lcnc-webui/src/TextKeypadStrip.vue#L66)). Feldleeren heißt `C` und ist rot im Numpad, `Clr` und neutral in der Text-Hilfe. Dialog-X ist meist das Schriftzeichen `×`, Tastatur-X ein SVG. | Gemeinsame Symbole, Größen und zugängliche Aktionsnamen für Schließen, Backspace und Leeren. Bei Leeren den gleichen lokalen Eingriff gleich darstellen; eine abweichende Farbe braucht einen belegbaren Unterschied der Wirkung. Kürzel nur dort, wo das Platzbudget sie verlangt, mit eindeutiger Erklärung. |
| UX-04 | **Sichtbarer und zugänglicher Name widersprechen sich:** Bei normalen Textfeldern zeigt die [Enter-Taste](../../lcnc-webui/src/TextKeypadStrip.vue#L70) `OK`, während Tooltip und `aria-label` aus Zeile 23 `Done` liefern. Der [Handler](../../lcnc-webui/src/MachineInput.vue#L125) schließt lediglich die Hilfe; die Zeichen wurden bereits in das Feld geschrieben. | Sichtbar, Tooltip und zugänglicher Name müssen dieselbe Aktion ausdrücken. Vorschlag: `Done` für reine Texteingabe beenden, `OK`/`Apply` für Zahlenwert übernehmen, `Send` für MDI und Zeilenumbruch für den Editor. Die zielabhängigen Unterschiede bei Enter sind fachlich erforderlich. |
| UX-05 | **Symbolaktionen teilweise ohne eindeutigen Namen:** Die Text-Tastatur nennt `Close keyboard`; der [Referenzdialog](../../lcnc-webui/src/GcodeReferenceDialog.vue#L54), [Program Stats](../../lcnc-webui/src/App.vue#L1941) und mehrere andere Dialoge rendern nur `×`. `MachineBtn` ergänzt für `type="close"` keinen automatischen Aktionsnamen. | Schließen als gemeinsames Control mit einheitlichem SVG und verpflichtendem, kontextbezogenem Namen, z. B. `Close reference`. Für Touch darf eine wichtige Wirkungsunterscheidung nicht ausschließlich im Hover-Tooltip stehen. |
| UX-06 | **`Reset` und `Clear` benötigen je nach Ort sehr unterschiedliches Verständnis:** [Viewer](../../lcnc-webui/src/ThreeViewer.vue#L3946): Kamera zurücksetzen / Backplot leeren; [Overrides](../../lcnc-webui/src/OverridesStrip.vue#L42): auf 100 % setzen; [MDI](../../lcnc-webui/src/App.vue#L1869): Verlauf löschen; [Safety](../../lcnc-webui/src/SafetyStrip.vue#L115): E-Stop zurücksetzen; Einstellungen: Defaults wiederherstellen. Die Abschnittsüberschrift erklärt einiges, der Button allein häufig nicht. | Für diese Bestandsaufnahme kein pauschaler Funktionsfehler. Bei der Vereinheitlichung Ziel und Wirkung eindeutig benennen, z. B. `Reset view`, `Clear backplot`, `Clear history`, `100 %`, `Reset defaults`, `Reset E-Stop`. Sichtbarer Text kann kompakt bleiben, sofern der Kontext eindeutig und der zugängliche Name vollständig ist. |

### Stoppen und Abort: Unterschied der Wirkung erhalten

Die regulären Abort-Buttons sind bereits in [MachineBtn.vue:247](../../lcnc-webui/src/MachineBtn.vue#L247) als **Quadrat + `Abort`** zentral umgesetzt; die Aufrufer in Programm, MDI, Probing und Banner verwenden diesen Standard. [Spindel-Stop](../../lcnc-webui/src/SpindleStrip.vue#L43) und [Jog-Stop](../../lcnc-webui/src/JogStrip.vue#L168) verwenden ebenfalls ein Quadrat, benennen aber ihre jeweilige Stop-Funktion. Diese Familie gehört fachlich zu laufenden Abläufen. Fenster schließen, lokalen Entwurf verwerfen, Programm abbrechen, Spindel stoppen und E-Stop haben unterschiedliche Wirkungen und brauchen entsprechend eindeutige Namen. Die vereinbarte globale Escape-Belegung als E-Stop bleibt Teil dieses Vertrags.

### Vorgeschlagener gemeinsamer Aktionsvertrag

| Aktion | Erwartete Wirkung | Darstellung |
|---|---|---|
| Eingabehilfe schließen | Hilfe ausblenden, lokalen Stand erhalten; kein Übernehmen, Save oder Send | Einheitliches X, `Close keyboard` |
| Bearbeitung verwerfen | Ungespeicherten lokalen Stand ausdrücklich aufgeben | `Discard` mit benanntem Ziel |
| Dialogaktion abbrechen | Geplanten Vorgang nicht ausführen; Umgang mit Formularentwürfen explizit festlegen | `Cancel` |
| Laufenden Ablauf stoppen/abbrechen | Angegebenen laufenden Vorgang beenden | Quadrat + `Abort` / `Stop` mit eindeutigem Kontext |
| Datensatz/Zuordnung entfernen | Benannten Eintrag entfernen | Entfernen-/Papierkorb-Symbol und passender Name |
| Werte zurücksetzen | Benannte Werte auf definierten Ausgangsstand setzen | `Reset …` bzw. konkreter Zielwert |
| Übernehmen/speichern/senden | Genau die benannte Wirkung ausführen | Zielabhängig `OK`/`Apply`, `Save`, `Send`, `Add` |

**Vorgeschlagene Abnahme:** Zahl und Text mit Entwurf öffnen → X/Outside/Tab → wieder öffnen und Erhalt nachweisen; explizites Verwerfen getrennt prüfen. Kein Schließen löst einen Maschinen-/Save-/MDI-Befehl aus. Sichtbarer Name, Tooltip und zugänglicher Name passen zusammen. Gemeinsame Symbole und Platzierung werden in Landscape/Portrait einschließlich 150 % geprüft. Nach der Bestandsaufnahme bleibt eine vollständige visuelle Durchsicht aller betroffenen Dialoge und Zustände erforderlich.

**Abstimmungsstatus:** UX-01–UX-06 offen als Vorschläge. Zuerst den Schließen-/Verwerfen-Vertrag festlegen, dann Beschriftungen und Controls zentralisieren. Bestehende technische Auditbefunde und deren Nachweise bleiben unverändert.

<a id="ux-weitere-2026-09-21"></a>

## Weitere Bedienmuster · 21. September 2026

Auf die Nachfrage nach weiteren vergleichbaren Punkten wurden Speichern, Zustandsanzeigen, gesperrte Controls, Hilfen und Aktivierung untersucht. Die folgenden Stellen sind im Code bestätigt. Für UX-07 wurden zusätzlich zwei Browser-Gegenproben jeweils dreimal am lokalen Mock ausgeführt; die übrigen Punkte sind Vorschläge zur Abstimmung, keine pauschale Einstufung aller unterschiedlichen Bedienmuster als Defekt.

| ID | Konkretes Beispiel | Gewünschte Konsistenz |
|---|---|---|
| UX-07 | **Pointer und physische Tastatur lösen am selben Button unterschiedliche Aktionen aus.** Tab auf Numpad-Cancel + Enter sendet tatsächlich Touch-off X=17. Enter/Space auf dem fokussierten Text-Tastatur-X bewirken nichts; Pointer-Klick schließt. Beide Fälle 3/3 reproduziert. [UI-I10, P1](ui-optimierungen.implementation-review.md#ui-i10-tastaturaktivierung). | Jeder fokussierte Button führt per Enter/Space seine beschriftete Aktion genau einmal aus. Direkte Zahleneingabe und fokussierte Hilfetaste unterscheiden; Escape und globale Maschinen-Shortcut-Sperren erhalten. |
| UX-08 | **Automatisches Speichern wird allgemeiner versprochen, als es gilt.** Der [Settings-Kopf](../../lcnc-webui/src/SettingsPanel.vue#L492) sagt, Einstellungen würden automatisch gespeichert. Im selben Dialog benötigen [Makroänderungen](../../lcnc-webui/src/SettingsPanel.vue#L806) ausdrücklich Save; `saveMacro()` übernimmt den getrennten Entwurf. Viewer-/Kameraeinstellungen speichern dagegen bei Änderungen. | Pro Bereich klar anzeigen, ob Änderungen sofort gelten oder erst übernommen werden. Den globalen Autosave-Hinweis auf die tatsächlich automatisch gespeicherten Bereiche begrenzen; Entwürfe und Save-Ausnahmen sichtbar kennzeichnen. Beide Speichermodelle dürfen bestehen. |
| UX-09 | **Eine Sperre wird je nach Control erklärt oder bleibt stumm.** [MachineBtn](../../lcnc-webui/src/MachineBtn.vue#L71) bietet bei vorhandenem Grund und scharfgeschalteter UI eine per Tap und Tastatur erreichbare Erklärung. [MachineInput](../../lcnc-webui/src/MachineInput.vue#L202), [MachineSelect](../../lcnc-webui/src/MachineSelect.vue#L30), MachineRadio und MachineToggle setzen zentral nur `disabled`; ein vergleichbarer gemeinsamer Erklärungspfad fehlt. Einzelne Aufrufer ergänzen eigene Hinweise. | Derselbe Sperrgrund soll unabhängig vom Control-Typ erreichbar sein, mit gleichem Touch-/Tastaturmuster. Dafür bestehende Gate-Gründe nutzen und vorhandene bewusste Ausnahmen, etwa die insgesamt deaktivierte nicht scharfgeschaltete UI, berücksichtigen. |
| UX-10 | **Buttontext beschreibt teils Zustand, teils nächste Aktion.** [SafetyStrip](../../lcnc-webui/src/SafetyStrip.vue#L99) zeigt `Armed`, dessen Betätigung aber deaktiviert; der Tooltip sagt `Disarm`. [Machine Power](../../lcnc-webui/src/SafetyStrip.vue#L131) zeigt bei eingeschalteter Maschine `On`, obwohl der Klick ausschaltet. Bei Start/Save steht dagegen die auszuführende Aktion auf dem Button. | Ein gemeinsames Muster für Zustandsschalter festlegen: Zustand eindeutig erkennbar, nächste Aktion verständlich. Das kann ein klarer Schalter mit Zustandsanzeige oder eine Aktionsbeschriftung mit separatem Status sein; wesentliche Wirkung nicht nur im Hover-Tooltip erklären. |
| UX-11 | **Erklärungen sind teils antippbar, teils nur per Hover verfügbar.** [HelpIcon](../../lcnc-webui/src/HelpIcon.vue#L48) öffnet ein Popover per Button. Die ausführliche Erklärung zu [Kinematics frame / Machine / TCP](../../lcnc-webui/src/JogStrip.vue#L468) steckt dagegen in `title`-Attributen. MachineToggle dokumentiert ausdrücklich die Touch-Einschränkung von `title`. | Fachliche Erklärungen einheitlich über ein fokussierbares, antippbares Hilfemuster anbieten. Hover-Titel können ergänzen; Touch-Nutzer müssen dieselbe Information erreichen können. |
| UX-12 | **Bestätigungs- und Aktivierungsmuster wechseln.** Offset-Clear verlangt [500 ms Halten](../../lcnc-webui/src/machineControls.ts#L32), Werkzeuglöschen einen [Bestätigungsdialog](../../lcnc-webui/src/ToolTablePanel.vue#L630), Wizard-Restart einen [zweiten Druck innerhalb von 3 s](../../lcnc-webui/src/GamepadMapWizard.vue#L190). Bei Hold erscheint die Erklärung häufig erst nach einem zu kurzen Tap. | Die Zuordnung nach Wirkung festlegen und am Control vor der ersten Betätigung erkennbar machen. Die bestehenden Muster haben teilweise bereits vereinbarte Gründe, insbesondere die Vermeidung eines verschachtelten Wizard-Dialogs. Daraus folgt keine Forderung, alles auf denselben Mechanismus umzubauen; Stop-/Abort-Aktionen dürfen dadurch insbesondere keine zusätzliche Verzögerung bekommen. |

**Priorität:** UX-07/UI-I10 zuerst als Funktionsfehler beheben. Danach Speicherversprechen (UX-08) und die Erklärbarkeit gesperrter Controls (UX-09) klären. Für Zustandsanzeigen, Hilfen und Aktivierungsmuster einen gemeinsamen Vertrag festlegen und anschließend die betroffenen Komponenten systematisch prüfen. Neue Designentscheidungen sind noch nicht als Plan-Agreement angenommen.

---

<a id="codex-implementierungsrunde-4"></a>

## Codex · Implementierungsrunde 4 · 21. September 2026

**9 von 11 technischen Befunden geschlossen; noch kein Implementierungs-Agreement.** Geprüft ist `9b368f7` mit Produktfix `8a6ed60`. [Vollständiges Review](ui-optimierungen.implementation-review.md#codex-implementierung-runde-4), [Belege](ui-optimierungen.implementation-review.r4.evidence.txt).

| Punkt | Antwort auf Claudes Korrekturen |
|---|---|
| UI-I05 | **Geschlossen.** Die unabhängige Backend-Sperre innerhalb Busy verwirft den abgelegten Entwurf jetzt zuverlässig, auch in drei Wiederholungen. |
| UI-I08 | **Geschlossen.** Im Portrait bei 150 % bleiben 180,75 px bzw. 7,18 Editorzeilen; Originaltext, Save/Discard und alle Tastaturseiten sind treffbar. Externes Run/Pause bringt die Programmsteuerung zurück und erhält den Puffer. |
| UI-I10 / UX-07 | **Teilweise korrigiert, weiterhin P1.** Cancel bestätigt per Enter keinen Wert mehr und fokussierte Texttasten reagieren. Nach Aktivierung des X fehlt aber die Fokus-Rückgabe: `body` fokussiert, Modal-Guard aus, nächstes Space → `cycle_start`. Enter und Space jeweils 3/3 bestätigt. |
| UI-I11 | **Neu P2.** Echte physische Eingabe `G1 X7` ins MDI-Feld wird Zeichen für Zeichen gelöscht, bei offener und geschlossener Hilfe. 3/3 bestätigt, Referenzsuche funktioniert als Gegenkontrolle. Der betroffene Wertanschluss bestand schon vor dem aktuellen Fix. |

Die vollständige Offline-Suite besteht mit **1.568 Unit-Tests und 140 Browserfällen**, ebenso **22 historische Gegenproben**. Die neuen negativen Fälle sind damit zusätzliche Testlücken: Beim Text-Schließen muss der nächste Tastendruck geprüft werden, bei MDI die echte physische Eingabe neben den Bildschirmtasten. Die nötigen Korrekturen und Abnahmekriterien stehen im Implementierungsreview.

Claudes Trennung der technischen Korrekturen von den weiteren UX-Vorschlägen ist nachvollziehbar. **UX-07 ist jedoch noch nicht vollständig geschlossen; UX-01–UX-06 und UX-08–UX-12 bleiben offen als noch nicht umgesetzte Vorschläge.** Der gemeinsame Schließen-/Verwerfen-Vertrag und die daraus folgenden Namen, Symbole und Bedienmuster gehören in den ergänzten UX-Plan. Das bestehende Plan-Agreement für UI-01–UI-15 wird dadurch nicht geändert. Live-XYZAC- und Touchscreen-Abnahme stehen ebenfalls aus.

---

<a id="ux-browserfelder-2026-09-21"></a>

## UX-13 — Browser-/Autofill-Erkennung der Eingabefelder · 21. September 2026

<a id="ux13-diagnose-2026-09-23"></a>

### Diagnose-Schalter · 23. September 2026 · Claude

**Operator-Präzisierung:** In Firefox auf dem Mac poppt der **Apple-Passwortmanager** am MDI-Feld auf; andere Felder nicht. Chrome wurde nicht geprüft (die Seite war dort nicht erreichbar — auf macOS häufig die fehlende Berechtigung „Lokales Netzwerk“ für Chrome unter Systemeinstellungen → Datenschutz & Sicherheit). Für die Apple-Erweiterung ist kein dokumentiertes Ausschluss-Attribut bekannt, und sie läuft in dieser Umgebung nicht; deshalb entscheidet der Browser des Operators.

**Schalter (`9360439`, vorübergehend):** `?mdiField=<variante>[,<variante>…]` ändert am MDI-Feld je Variante genau ein Merkmal; das Message-Center nennt, was aktiv ist, das Feld trägt `data-mdi-variant`. Senden, Verlauf, Fokusrückgabe und Bildschirmtastatur bleiben unverändert (regulär geprüft für jede Variante).

| Variante | Unterschied zum ausgelieferten Feld |
|---|---|
| `base` | keiner (Kontrolle) |
| `noname` | kein `name` |
| `noplaceholder` | kein Placeholder |
| `nolabel` | kein `aria-label` |
| `withid` | `id="mdi-command"` |
| `search` | `type="search"` |
| `combobox` | `role="combobox"` + `aria-autocomplete="list"` |
| `acnope` | `autocomplete="nope"` (unbekanntes Token statt `off`) |

**Protokoll für den Operator:** Firefox/macOS mit aktiver iCloud-Passwörter-Erweiterung. Für jede Variante `http://<host>:8000/?mdiField=<variante>` neu laden (das Token liefert die Seite selbst mit, die URL braucht nur den Schalter), MDI-Tab öffnen, ins Feld tippen, notieren: Popup ja/nein. Zum Vergleich einmal die Werkzeugsuche. Bleibt eine Variante ruhig, bitte auch eine Kombination prüfen, falls zwei ruhig sind (`?mdiField=noname,noplaceholder`). **Danach WP-F5:** die ruhige Variante wird dauerhaft übernommen, der Schalter entfernt, der Feldvertrag-Test ergänzt. Kommt das Popup bei allen Varianten, wird das als Verhalten der Erweiterung dokumentiert und mit dem Operator entschieden.

<a id="ux13-ergebnis-2026-09-23"></a>

### Ergebnis · 23. September 2026 · Operator-Test und WP-F5

**Auslöser gefunden:** das Wort **„code“ im Placeholder** des MDI-Felds. Runde 1 (acht Varianten): nur `noplaceholder` ruhig. Runde 2 (Placeholder-Texte): „MDI command (↑↓ history)“ und „↑↓ history“ ruhig, „G-code (↑↓ history)“ löst aus. Die Erweiterung hält das Feld offenbar für ein Feld für Bestätigungscodes. Werkzeugsuche („Search tools…“) und Referenzsuche („Search codes, names, descriptions…“, Mehrzahl und Suchfeld) lösen nicht aus.

**Korrektur (WP-F5):** MDI-Placeholder „MDI command (↑↓ history)“ — genau der im Operator-Browser ruhige Text; Diagnose-Schalter entfernt; der Feldvertrag-Test lehnt das Wort „code“ in jedem geprüften Textfeld-Placeholder ab. Der allgemeine Feldvertrag bleibt. **Abnahme:** der ruhige Text ist im betroffenen Browser bereits geprüft (`phmdi`); **vom Operator am 23.09. ohne Schalter-Parameter bestätigt: kein Popup mehr — UX-13 abgenommen.**

<a id="ux13-nachpruefung-2026-09-22"></a>

### Nachprüfung · 22. September 2026 · Symptom weiterhin offen

**Neue Operator-Beobachtung:** MDI wird weiterhin als Passwortfeld erkannt; andere vergleichbare Eingaben zeigen das Problem nicht. Bisheriger dokumentierter Zielbrowser ist Firefox/macOS mit Apple-/iCloud-Passwörtern. Die genaue aktuelle Anzeige (Passwortvorschlag/Schlüsselsymbol oder maskierte Zeichen) und die konkrete Erweiterungsversion sind noch nicht bestätigt.

**Was der bisherige Fix tatsächlich leistet:** `MachineInput` setzt gemeinsame HTML-Hinweise: `autocomplete="off"`, deaktivierte Textkorrektur/Großschreibung/Rechtschreibprüfung, `name` und zugängliche Beschriftungen. Damit wurde der Feldvertrag verbessert. Die ursprüngliche Fehlklassifizierung im Operator-Browser wurde dadurch noch nicht nachweislich behoben. `autocomplete="off"` ist keine verlässliche Sperre gegen Passwortmanager, wenn diese ein Feld selbst als Login-Eingabe einstufen. [Mozilla-Dokumentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete).

**Aktuell im gerenderten lokalen Produktionsbuild geprüft:**

| Feld | Nativer Typ / Autocomplete | Fachlicher Name / Kennung | Beschriftung |
| --- | --- | --- | --- |
| MDI | `text` / `off` | `name="mdiText"`, keine `id` | `aria-label="MDI command"`, Placeholder „G-code command (↑↓ history)“ |
| Werkzeugsuche | `text` / `off` | `name="toolSearch"`, keine `id` | `aria-label="Search tools"` |
| Werkzeugbeschreibung | `text` / `off` | `name="toolEdit"`, `id="tool-description"` | Verknüpftes Label und `aria-label="Description"` |
| Makrobefehl | `text` / `off` | `name="macroEdit"`, `id="macro-edit-command"` | Verknüpftes Label „Command“ |

Alle vier besitzen dieselben Off-Vorgaben für Autocorrect/Autocapitalize und `spellcheck=false`. Keine dieser Eingaben liegt in einem `<form>`, keine hat CSS-Zeichenmaskierung. Das App-eigene Symbol „Open keyboard“ erscheint bei allen vier; es ist kein MDI-spezifisches Passwortsymbol. In Chromium ohne Erweiterung blieb die physisch eingegebene MDI-Zeile `G0 X10 ; review` vollständig lesbar erhalten; kein MDI-Befehl wurde gesendet.

**Warum andere Felder trotzdem anders reagieren können:** Die technischen Basiseinstellungen sind gleich, Name, Beschriftung, Placeholder und Umgebung unterscheiden sich. Autofill verwendet auch solche Kontextmerkmale ([HTML-Standard](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill)). Eine abweichende Klassifizierung von MDI ist deshalb plausibel. **Welches Merkmal die verwendete Erweiterung hier tatsächlich auslöst, ist nicht bewiesen.** Insbesondere sind „G-code im Placeholder“, fehlende `id`, Send-Button oder ein gespeicherter Seiteneintrag bisher nur mögliche Prüffaktoren, keine festgestellten Ursachen. Aus der gemeinsamen Basiskomponente folgt auch keine Fehlklassifizierung aller anderen Felder.

**Nachweisgrenze:** Produktstand `691e642`; lokaler Einstieg `/static/index-CVDIHYU1.js` enthält die Feldattribute. [Browserprobe](ui-optimierungen.mdi-autofill.probe.mjs), [DOM-Vergleich](ui-optimierungen.mdi-autofill.evidence.json). Isolierter Mock mit Linux-Chromium, ohne Passwortmanager. Die im Operator-Browser tatsächlich geladene Asset-Version ist hier nicht geprüft; Apple Passwörter/macOS steht in dieser Umgebung nicht zur Verfügung. Das ist kein erfolgreicher Firefox-/iCloud-Abnahmetest.

**Nächster belastbarer Schritt:** Im betroffenen Profil dieselbe MDI-Eingabe und einen unauffälligen Vergleich (Makrobefehl/Werkzeugsuche) mit Passwortmanager an/aus vergleichen und die tatsächlich geladenen Feldattribute prüfen. Danach jeweils nur einen Unterschied variieren, z. B. Name/Beschriftung/Umgebung. Einen dokumentierten produktspezifischen Ausschluss nur für den tatsächlich beteiligten Manager einsetzen und dort prüfen; ein 1Password-Attribut ist kein Apple-Fix. Allgemein sinnvolle Feldsemantik (eindeutige Kennungen, echte Suchfelder als `type="search"`) darf nicht als bereits bewiesene Lösung für MDI ausgegeben werden. MDI behält seine Befehlssemantik und seine geschützte Send-/Fokusführung.

**Abnahme korrigiert:** HTML-Vertrag umgesetzt; ursprüngliches UX-13-Symptom laut Operator weiterhin vorhanden. Erfolgreiche Prüfung im betroffenen Browser mit aktiver Erweiterung erforderlich. Die nachfolgende Bestandsaufnahme ist der historische Stand vor dem Feldvertrag-Fix.

### Ursprüngliche Bestandsaufnahme · 21. September 2026

**Operatorhinweis:** MDI wird als Passworteingabefeld wahrgenommen. **Status:** Beobachtung des Operators aufgenommen; konkreter Browser/Passwortmanager und Art der Anzeige noch nicht geklärt. Weitere Fehlklassifizierungen sind nicht reproduziert. Die folgende Bestandsaufnahme bestätigt gleiche Feldattribute, nicht dieselbe Reaktion jedes Browsers oder Passwortmanagers.

Auf Produktstand `9b368f7` ist [MDI](../../lcnc-webui/src/App.vue#L1864) ausdrücklich `type="text"`. Im WebUI-Quellcode gibt es kein `type="password"`, keine Passwort-Autocomplete-Tokens und keine CSS-Passwortmaskierung. [MachineInput](../../lcnc-webui/src/MachineInput.vue#L223) setzt jedoch keine gemeinsamen Vorgaben für `autocomplete`, `autocorrect`, `autocapitalize` oder `spellcheck`. Auch die Aufrufer der **14 Textfeld-Definitionen einschließlich MDI** setzen diese Attribute nicht; sie haben ebenfalls keine eigenen `id`-/`name`-Attribute. Eine Definition innerhalb von `v-for` kann mehrere sichtbare Felder erzeugen.

**Die 13 weiteren Stellen mit demselben Muster:**

| Bereich | Felder und Quellstellen |
|---|---|
| Suchen (3) | [G-Code-Referenz](../../lcnc-webui/src/GcodeReferenceDialog.vue#L57), [Werkzeugliste](../../lcnc-webui/src/ToolTablePanel.vue#L595), [HAL-Pins/Signale/Parameter](../../lcnc-webui/src/HalshowTab.vue#L134); alle derzeit `type="text"` |
| Makro-Editor (4) | [Name](../../lcnc-webui/src/SettingsPanel.vue#L786), [Befehl](../../lcnc-webui/src/SettingsPanel.vue#L790), [Parameterbeschriftung und Standardwert](../../lcnc-webui/src/SettingsPanel.vue#L800) |
| Makro-Ausführung (1) | [Parametereingabe](../../lcnc-webui/src/App.vue#L2128); kein expliziter `type`, daher normales Textfeld |
| Werkzeug-Editor (3) | [Beschreibung](../../lcnc-webui/src/ToolTablePanel.vue#L679), [Material](../../lcnc-webui/src/ToolTablePanel.vue#L691), [Haltername](../../lcnc-webui/src/ToolTablePanel.vue#L724) |
| Maschinen-Einstellung (1) | [Spindle Load HAL Pin](../../lcnc-webui/src/SettingsPanel.vue#L685) |
| Programm-Upload (1) | [Neuer Dateiname bei Namenskonflikt](../../lcnc-webui/src/GcodePanel.vue#L978) |

Auch die Zuordnung der Beschriftung ist teilweise unvollständig: `MachineInput.label` benennt den Eingabehelfer, erzeugt aber kein natives `aria-label`; beispielsweise stehen Werkzeug-Labels neben Feldern ohne `for`-/`id`-Verknüpfung. Der Upload-Dateiname hat dagegen bereits ein umschließendes natives `<label>`. Fehlende Semantik ist ein Ansatzpunkt für eine konsistente Lösung, aber kein Beweis für die Ursache der gemeldeten Passwort-Erkennung.

**Vorschlag für den ergänzten Plan:** Ein gemeinsamer Feldvertrag in `MachineInput` mit gezielten Unterschieden je Zweck: explizites Autofill-Verhalten für Maschinen-/Codefelder; passende Feldtypen für Suchen; stabile fachliche Kennungen und korrekt zugeordnete zugängliche Namen. Bei G-Code, HAL-Pfaden und Dateinamen automatische Textkorrektur und Großschreibung ausdrücklich ausschalten. Für natürliche Beschreibungen diese Entscheidung separat treffen. `autocomplete="off"` ist keine verlässliche Sperre gegen jeden Passwortmanager; Browser können es bei als Login erkannten Feldern ignorieren. [MDN zu Autocomplete](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete).

Falls ein konkreter Passwortmanager beteiligt ist, dessen dokumentierten Ausschluss für diese technischen Felder ergänzen und dort prüfen. Beispielsweise dokumentiert 1Password `data-1p-ignore` bzw. `data-op-ignore`; daraus folgt keine Zusage für andere Produkte. [1Password-Dokumentation](https://www.1password.dev/web/compatible-website-design#ignore-offers-to-save-or-fill-specific-fields).

**Abnahme:** MDI und die obigen Feldgruppen im betroffenen Browser mit dem tatsächlich verwendeten Passwortmanager sowie in einem frischen Profil vergleichen. Passwortvorschläge/-speicherangebote, Autofill, physisches Tippen und Bildschirmtasten prüfen; Auswahl oder Ausblenden eines Vorschlags darf keine Maschinenaktion auslösen. Das app-eigene [Tastatursymbol „Open keyboard“](../../lcnc-webui/src/FloatingOverlays.vue#L16) gehört zur Eingabehilfe und ist bei der Diagnose von Browser-/Erweiterungssymbolen zu unterscheiden.

**Abgrenzung zu UI-I11:** Der MDI-Zeichenverlust aus Runde 4 wurde bereits im isolierten Playwright-Chromium ohne Passwortmanager nachgewiesen. Die gemeldete Passwort-Erkennung ist daher keine ausreichende Erklärung dafür; UI-I11 bleibt eigenständig offen. In diesem Nachtrag wurden Quellstellen und offizielle Dokumentation geprüft, keine neue Browser-/Erweiterungsprüfung durchgeführt und kein Produktcode geändert. Der technische Abnahmestand bleibt **9 von 11 geschlossen**; UX-13 ist ein zusätzlicher Prüf-/Planpunkt.

---

<a id="ux-empfehlungen-2026-09-21"></a>

## Konkrete Codex-Empfehlungen für UX-01 bis UX-12 · 21. September 2026

Auf die Nachfrage nach einer konkreten Empfehlung werden die bisherigen Vorschläge hier präzisiert. **Empfehlungsstand, noch keine vom Operator angenommene Planänderung.** Die Eingabehilfe behält gemeinsame Sitzungsregeln und passende Zahlen-/Text-/Code-Layouts. Schließen, Verwerfen, Übernehmen und Stoppen bekommen jeweils eine feste Bedeutung.

| ID | Empfohlene Entscheidung |
|---|---|
| **UX-01 — Schließen und Verwerfen** | Beide Hilfen erhalten **X = ausblenden und Eingabe erhalten**, solange der Besitzerkontext gültig bleibt. X, Outside und Tab nach außen bestätigen nichts. Im Zahlenmodus steht **Discard** ausdrücklich für das Verwerfen des Zahlenentwurfs; Bearbeitungen im Editor werden weiterhin dort verworfen. Schließen bekommt pro Ausrichtung eine gemeinsame Position innerhalb des zulässigen Layoutbudgets. |
| **UX-02 — X nur zum Schließen** | Belegung entfernen heißt **Remove binding** mit Entfernen-Symbol; Sonderfarbe zurücksetzen **Reset color** mit Reset-Symbol. Header-X in einem unveränderten Formular schließt direkt. Bei ungespeicherten Änderungen: **Keep editing / Discard changes**. Header-X und eine abbrechende Footer-Aktion verwenden dieselbe Prüfung; kein stilles Speichern oder Verwerfen. |
| **UX-03 — Gleiche Symbole und Farben** | Für Schließen und Backspace dieselben Lucide-Symbole, Größen und Aktionsnamen verwenden. Lokales Leeren heißt auf beiden Hilfen **Clr**, mit vollständig erklärtem Ziel. Es bleibt neutral; das Numpad-C leert nur den unbestätigten Ausdruck und rechtfertigt deshalb keinen roten Maschinen-/Gefahrenstil. Mathematische Zeichen wie Multiplikation werden von dieser Symbolvereinheitlichung nicht erfasst. |
| **UX-04 — Bestätigen passend zur Wirkung** | **Apply** = Zahlenwert übernehmen; **Done** = reine Texteingabe beenden; **Send** = MDI senden; **↵ / New line** = Editor-Zeilenumbruch; **Save** bleibt das ausdrückliche Speichern einer Bearbeitung. Sichtbare Beschriftung, Tooltip und zugänglicher Name müssen dieselbe Aktion bezeichnen. |
| **UX-05 — Benannte Symbolbuttons** | Ein gemeinsames Schließen-Control mit SVG-X und verpflichtendem kontextbezogenem Namen, z. B. **Close reference** oder **Close keyboard**. Alle Symbolaktionen erhalten einen verständlichen zugänglichen Namen. Verwerfen, Löschen und Maschinenaktionen tragen sichtbaren Text, damit die Wirkung auf Touch ohne Hover verständlich ist. |
| **UX-06 — Ziel von Reset/Clear nennen** | **Reset view**, **Clear backplot**, **Clear history**, **Reset defaults**, **Reset E-Stop**. Override-Rückstellung zeigt den Zielwert **100 %**; der zugängliche Name nennt zusätzlich den betroffenen Override. Kurze Varianten nur bei eindeutig sichtbarem Kontext. |
| **UX-07 — Aktivierung und Fokus** | Jeder normale Button führt über Tap, Klick, Enter oder Space genau seine eigene Aktion einmal aus. Explizites Schließen gibt den Fokus geschützt an den gültigen Besitzer oder ein sicheres Ersatzziel zurück. Das auslösende Enter darf dort kein zusätzliches MDI-Senden erzeugen; das nächste Space darf keine Maschinenaktion auslösen. **Zuerst den offenen UI-I10-Restfehler beheben.** Bereits ausdrücklich abgesicherte Hold-/Bestätigungsaktionen behalten ihren dokumentierten Aktivierungsvertrag. |
| **UX-08 — Speichern pro Bereich erklären** | Anzeige-/Viewer-Einstellungen behalten automatische Speicherung. Makro-, Werkzeug- und Programmbearbeitungen behalten bewusstes **Save / Discard**. Den pauschalen Autosave-Hinweis durch zutreffende Hinweise je Bereich ersetzen. Ein **Saved**-Status darf nur einen tatsächlich bestätigten Speicherstand anzeigen; Fehler und noch nicht gespeicherte Änderungen müssen erkennbar bleiben. |
| **UX-09 — Sperrgründe erreichbar machen** | Den vorhandenen Erklärungspfad von MachineBtn auf Eingabefelder, Auswahlfelder und Schalter übertragen: gleicher Grund, gleiche per Touch und Tastatur erreichbare Erklärung. Dafür ein fokussierbares Info-/Sperr-Control am Feld bzw. Label verwenden, ohne das gesperrte Feld zu aktivieren. Für die insgesamt nicht scharfgeschaltete UI genügt der gemeinsame zentrale Hinweis. |
| **UX-10 — Zustand und nächste Aktion** | Bei **Arm** und **Machine Power** den tatsächlichen Zustand sichtbar halten und die Aktion als Handlung beschriften: Zustand **Armed**, Aktion **Disarm**; Zustand **Power on**, Aktion **Power off**. Beides muss auch bei kompakter Safety-Darstellung verständlich bleiben. Echte Optionsschalter wie **M01** behalten dagegen ein stabiles Label mit erkennbarem An/Aus-Zustand. Nur Farbe oder Hover erklärt die Wirkung nicht ausreichend. |
| **UX-11 — Eine zugängliche Hilfe** | Das vorhandene **HelpIcon mit antippbarem Popover** als gemeinsames Muster verwenden. Erklärungen zu Machine/TCP/Plane und vergleichbare Fachhinweise darüber zugänglich machen; Tastaturbedienung und Fokus-Rückgabe mitprüfen. Native Hover-Titel können ergänzen. |
| **UX-12 — Bestätigung nach Wirkung** | Lokales, unbestätigtes Feldleeren bleibt direkt. Werkzeug-/Datensatzlöschen nutzt einen Dialog mit konkret benanntem Ziel. Das vereinbarte **500-ms-Halten bei Offset-Clear** bleibt, erhält aber vorab sichtbaren Hinweis und Haltefortschritt. Wizard-Restart darf die vorhandene zweite Betätigung behalten, muss diesen Zustand und seine Restzeit deutlich anzeigen. **Abort/Stop/E-Stop bleiben unmittelbar auslösbar**, ohne zusätzlichen Hold oder Bestätigungsdialog. |

Die Empfehlungen zu nativer Button-Aktivierung, Fokus und zugänglichen Namen orientieren sich am [W3C-Button-Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/). Die Übereinstimmung sichtbarer und zugänglicher Beschriftung folgt dem [W3C-Kriterium Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html). Die fachliche Zuordnung von Maschinenaktionen und Bestätigungen ist eine projektspezifische Empfehlung; diese Quellen ersetzen keine Maschinenabnahme.

**Umsetzungsreihenfolge:** Zuerst UX-07/UI-I10 und den unabhängig offenen MDI-Eingabefehler UI-I11 abschließen. Danach den gemeinsamen Aktions-/Beschriftungsvertrag aus UX-01–UX-06, UX-08 und UX-10 umsetzen. Anschließend UX-09/UX-11 für Erklärungen und UX-12 für die vorhandenen Bestätigungsmuster vereinheitlichen. Die zugrunde liegenden Entscheidungen können bereits jetzt in den ergänzten Plan aufgenommen werden; eine Live-Sichtprüfung ist dafür keine technische Voraussetzung.

**Gemeinsame Abnahme:** Entwürfe und Besitzerkontext erhalten; keine zusätzliche Maschinenaktion beim Schließen, Fokuswechsel oder Bestätigen eines UI-Dialogs. Escape bleibt gemäß bestehender Vorgabe E-Stop. Touchziele, Portrait 900 × 1200 bei 100 % und 150 %, sichtbare Originaleingabe und erreichbare Safety-Controls bleiben verbindlich. Neue Symbole und längere Beschriftungen müssen diese Bedingungen erfüllen; visuelle Referenzen erst für die geprüfte Darstellung aktualisieren.


---

<a id="codex-implementierungsrunde-5"></a>

## Codex · Implementierungsrunde 5 — Prüfung WP-A–E · 22. September 2026

**Noch kein Implementierungs-Agreement. Elf alte Befunde geschlossen, zwei neue P2-Befunde offen.** Geprüft wurde der gemeinsame Endstand `ac0f918` auf `feat/ui-review-wave`, einschließlich Claudes Antworten und Fassung 4. Dies ist eine gemeinsame Runde über WP-A–E, keine Behauptung zweier unabhängig ausgeführter Runden 5 und 6.

| ID | Bewertung | Erforderliche Korrektur |
|---|---|---|
| UI-I01–UI-I09 | Weiterhin geschlossen; alle bisherigen unabhängigen Regressionen bestehen. | Keine neue Forderung. |
| UI-I10 / UX-07 | **Geschlossen.** Enter/Space auf dem Text-X gibt den Fokus zurück; nächstes Space ergänzt Text und sendet weder MDI noch Cycle Start. | Keine. |
| UI-I11 | **Geschlossen.** Physisches `G1 X7` bleibt mit offener und geschlossener Hilfe erhalten. | Keine. |
| UI-I12 / UX-08 | **Neu, P2:** Nach abgelehnter Keyboard-Speicherung überdeckt ein erfolgreiches Display-Save den Fehler mit `Saved`. Eine alte Antwort zeigt außerdem `Saved`, während eine neuere Änderung noch im Debounce wartet. | Speicherstände pro Bereich und Revision verfolgen; Pending und ungelöste Fehler beim Gesamtstatus berücksichtigen. Beide Antwortfolgen regulär testen. |
| UI-I13 / UX-11 | **Neu, P2:** Die neue „Go to positions“-Hilfe ist unten abgeschnitten, auch ohne Zoom. Im Portrait bei 150 % liegt ihre Unterkante bei 1916 px in einem 1200-px-Viewport. | Nach tatsächlichem Layout messen, Zoom-Koordinaten korrekt behandeln und vollständig im Viewport platzieren; Geometrie statt nur geöffneten Zustand prüfen. |

**UX-09 bleibt eingeschränkt:** Die Umsetzung bietet Touch-Erklärungen für native gesperrte Eingaben, aber keine per Tab erreichbare Erklärung direkt am Feld. Fassung 4 dokumentiert diese Grenze, erfüllt damit die ursprüngliche Empfehlung nur teilweise. `MachineRadio` ist zudem tatsächlich ein Input-Root, kein Label-Root wie in D1 beschrieben. Plan und Abschlusskennzeichnung entsprechend korrigieren; daraus keinen neuen Maschinenfehler ableiten.

**Frisch geprüft:** vollständiges Offline-Gate **PASS** auf `ac0f918` (958 Backend-Tests + 340 Subtests, 1.574 Unit-Tests, 148 Browserfälle, Modell, CSS, Lint und vollständiger Build); **27 / 27** bisherige unabhängige Gegenproben grün; **fünf neue Gegenproben jeweils 3 / 3 rot**. Die neuen Fälle sind zwei Speicherfolgen und drei Popover-Geometrien. Alle Browseraktionen ausschließlich gegen den lokalen Mock, LinuxCNC gestoppt. Nur Review-Dokumentation und Nachweise geändert.

Vollständige Ursachen, Sollverhalten, Messwerte, Proben und Screenshots stehen im [Implementierungsreview, Runde 5](ui-optimierungen.implementation-review.md#codex-implementierung-runde-5). Die technische Browser-Feldkonfiguration ist geprüft; Firefox/macOS mit iCloud-Passwörtern, physischer Touchscreen und Live-XYZAC bleiben gesonderte Operator-Abnahmen. Der bestehende Viewer-Nachweis betrifft weiterhin Default-Framing, nicht beliebiges Zoom/Pan.


---

<a id="codex-implementierungsrunde-6"></a>

## Codex · Implementierungsrunde 6 — Nachprüfung `570bd9f` · 22. September 2026

**12 von 13 technischen Befunden geschlossen; noch kein vollständiges Implementierungs-Agreement.** Geprüft: HEAD `7f50dd1`, Produktfix `570bd9f`, Claudes Antworten und die UX-09-Präzisierung.

| Bereich | Bewertung |
|---|---|
| UI-I12 / UX-08 | Die beiden alten WS-Folgen sind **behoben**, jeweils 3/3 unabhängig bestätigt. **Teilweise offen bleibt P2:** Der Hidden-Seitenpfad sendet per `sendBeacon`, löscht den Debounce-Timer und lässt die Revision trotzdem `pending`; auch der bestätigte Serverstand löst sie nicht auf. Dadurch dauerhaft „Saving…“ ohne laufenden Speicherauftrag. Lifecycle-Integrationsprobe 3/3 rot. |
| UI-I13 / UX-11 | **Geschlossen.** Alle drei Geometrien aus Runde 5 bestehen jeweils 3/3, einschließlich 150 %. Textdarstellung korrigiert; zusätzlich Größenwechsel und erneutes Öffnen dreifach geprüft. |
| UX-09 | Planpräzisierung akzeptiert: `MachineRadio` ist Input-Root, native gesperrte Felder bleiben ohne direkt per Tab erreichbare Erklärung. Diese Funktion steht korrekt als Folgearbeit im Plan. |

**Gate:** Backend, Modell, CSS, Lint, vollständiger Build und **1.583 Unit-Tests** bestehen. Der frische Offline-Lauf scheiterte in einem regulären Hilfe-Fall beim zweiten Tap (Schließen), nach erfolgreicher Geometrieprüfung: **109 Browserfälle bestanden, einer fehlgeschlagen, 42 übersprungen**. Der isolierte unveränderte Schließtest bestand danach 3/3; im ursprünglichen Trace wechselt das Trefferziel während der Aktion und Playwright wiederholt den Tap. Das bleibt eine ungeklärte Gate-Instabilität, kein sicher reproduzierter neuer Produktfehler. Die **42 nachgeholten Prüfungen bestehen vollständig** (29 Layout, 10 visuelle Vergleiche, 3 Viewer); alle Ausgaben stehen im [Implementierungsreview Runde 6](ui-optimierungen.implementation-review.md#codex-implementierung-runde-6).

Die Beacon-Probe simuliert ausdrücklich nur den Hidden/Visible-Lebenszyklus; Listener, Timer, Beacon und Serverstand-Verarbeitung laufen unverändert gegen lokale HTTP-/WS-Mocks. Kein echter manueller Browser-Tabwechsel und keine realen Maschinenbefehle. LinuxCNC blieb gestoppt. Firefox/macOS mit iCloud-Passwörtern, physischer Touchscreen und Live-XYZAC bleiben Operator-Abnahmen.

**Für den Abschluss:** Statusintegration des Visibility-/Beacon-Pfads vervollständigen, einschließlich bestätigtem Abschluss bzw. zutreffender Anzeige eines unbestätigten Ergebnisses. Die Ursache des instabilen Hilfe-Schließtests klären. Die beiden korrigierten WS-Fälle und die geschlossene Hilfe-Geometrie werden dabei nicht erneut infrage gestellt.


## Nachtrag — Versteckte Fallbacks und Restpunkte · 22. September 2026

Der [gesonderte Fallback-Review](ui-optimierungen.fallback-review.md) führt FA-01 bis FA-04 und die bekannten Abnahmegrenzen zusammen. Die Settings-Normalisierung ist mit den unveränderten Funktionen reproduziert; die zusätzlichen Viewer-Fehlerpfade sind im Code belegt, aber noch nicht per Browser-Fehlerinjektion nachgestellt. Fehlende STLs haben bereits einen Warnchip — die offene Frage betrifft die trotzdem nicht entsprechend eingeschränkte Kollisionsbewertung. Keine Produktänderung oder neue vollständige Suite.


---

<a id="codex-implementierungsrunde-7"></a>

## Codex · Implementierungsrunde 7 · 23. September 2026

Nachprüfung von Fables Produktfix **`691e642`** und den Dokumentationscommits bis **`f608f38`**. **12/13 technische Befunde geschlossen; kein vollständiges Implementierungs-Agreement.**

| Bereich | Bewertung |
|---|---|
| UI-I12 / UX-08 — erfolgreicher Beacon | **Korrigiert**, unabhängig 3/3 bestätigt; der Status bleibt nach erfolgreichem Abgleich nicht mehr bei Saving hängen. |
| UI-I12 — P2, Rest A | Bei vollem Datenträger oder beschädigter Settings-Datei verweigert der echte HTTP-Handler die Speicherung mit 409. Der vorher veränderte Server-Cache enthält trotzdem den neuen Wert; der neue Abgleich zeigt deshalb fälschlich **Saved**. Je 3/3 reproduziert. Der ältere Cache-Fehler wird durch den neuen Fix als Erfolgsnachweis verwendet. |
| UI-I12 — P2, Rest B | Ein vollständig leerer Serverstand nach nicht angekommenem ersten Beacon wird ignoriert. **Nicht bestätigt** bleibt dauerhaft stehen, obwohl der Bereich fehlt; 3/3 reproduziert. |
| UI-I13 / Hilfe-Tests | Weiterhin geschlossen. Der neue Tap-Helfer prüft stabile Position und tatsächliches Trefferziel; Geometrie, Schließen und Resize bestehen im frischen Gesamtlauf. |
| FA-01–FA-04 | Operator-Entscheidung zur getrennten Folgewelle bleibt bestehen. |
| Neue UI-Vorschläge / UX-13 | UI-K01–UI-K17 bleiben Vorschläge; das erneut gemeldete Passwortmanager-Symptom bleibt offen. Keine Produktimplementierung dieser zusätzlichen Punkte im geprüften Diff. |

**Frischer Offline-Lauf: PASS** — 958 Backend-Tests + 340 Subtests, Modell/CSS/Lint/Build, 1.589 Unit-Tests und 154/154 reguläre Browserfälle. Die unabhängigen zusätzlichen Fehlerproben bestehen ihre Abnahmekriterien nicht; sie erklären die trotz grünem Gate offenen Restbefunde.

Die vollständigen Ursachen, Abnahmekriterien, Testnachweise und Grenzen stehen im [Implementierungsreview Runde 7](ui-optimierungen.implementation-review.md#codex-implementierung-runde-7). Für UI-I12 muss der verglichene Serverbestand tatsächlich erfolgreich gespeicherte Daten repräsentieren; fehlende Bereiche eines vollständigen Bestands müssen als nicht gespeichert erkennbar werden. Keine Produktänderung durch diesen Review.


---

<a id="codex-implementierungsrunde-8"></a>

## Codex · Implementierungsrunde 8 · 23. September 2026

**Keine neuen Funktionsbefunde in den Änderungen bis `e5ad3dd`; 13/13 bisherige Implementierungsbefunde geschlossen.** UI-I12 ist nach der unabhängigen Wiederholung aller Runde-7-Gegenproben abgeschlossen: zwölf Browser-Abnahmekriterien erfüllt, einschließlich ENOSPC, beschädigter Datei und fehlendem Bereich. Für UI-I01–UI-I13 besteht damit technisches Agreement.

UI-K15s Ordnerfilter und Fehler-/Retry-Verhalten sowie UI-K16s Schutz für Makroentwürfe, Gamepad-Assistent und laufenden Import sind nachgeprüft. Auch der versteckte Makroentwurf und der Gamepad-Assistent bestehen unabhängige Zusatzproben. UI-K16s Dialog-Fokusproblem bleibt Teil der Design-Welle.

**Frischer vollständiger Offline-Lauf: PASS** — Backend 963 Tests + 343 Subtests, Modell/CSS/Lint/Build, 1.598 Unit-Tests und 158 Browserfälle. [Bewertung, Nachweise und Grenzen](ui-optimierungen.implementation-review.md#codex-implementierung-runde-8).

**UX-13 bleibt offen:** Der MDI-Schalter ist Diagnose, kein bereits bestätigter Fix für Apple-Passwörter. Die Varianten funktionieren technisch; der Bericht aus dem betroffenen Firefox/macOS-Browser und WP-F5 stehen aus. Die in Fassung 5 getrennten Design- und Fallback-Wellen sowie physische Touch-/Live-Abnahmen sind damit ebenfalls nicht erledigt. Keine Produktänderung und kein Merge durch diesen Review.
