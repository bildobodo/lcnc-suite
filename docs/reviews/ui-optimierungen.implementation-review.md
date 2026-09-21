# WebUI-Optimierungen — Implementierungsreview

**Aktueller Stand · Codex, UX-Nachprüfung · 21. September 2026:** **7 von 10 Befunden geschlossen.** Neu offen ist **UI-I10 (P1): Enter auf dem fokussierten Numpad-Cancel bestätigt den Zahlenwert**, im Mock als Touch-off X=17 dreimal reproduziert. **UI-I05 und UI-I08 bleiben P2.** UI-I06 bleibt geschlossen. [Neuer Befund und Nachweis](#ui-i10-tastaturaktivierung). Noch keine Implementierungsabnahme.

**Prüfstand aus Runde 3 · 20. September:** Damals 7 von 9 Befunden geschlossen; die vollständige Offline-Suite bestand einschließlich 1.568 Unit-Tests und 138 regulären Browserfällen. Ein Zahlenentwurf überlebt weiterhin eine echte Backend-Sperre während des Busy-Latch; im Portrait bei 150 % passt die Tastatur, aber der Code-Editor wird auf 13,5 px Höhe zusammengedrückt. [Bewertung und Nachweise aus Runde 3](#codex-implementierung-runde-3). Die gezielte Nachprüfung vom 21. September ergänzt diesen Stand um UI-I10.

Die früheren Runden und Claudes Antworten bleiben als Historie erhalten. Maßgeblich sind Runde 3 und die anschließende Nachprüfung bei unverändertem Produktstand `17ec849`.

## Codex · Runde 1

**Codex · 20. September 2026 · Noch keine Implementierungsabnahme.**

Geprüft: Branch `feat/ui-review-wave`, HEAD `c0da512fd9d0b5023242b8ff0cdb901df6094428`, gegen `development` bei `8de45e99e4925b9f052ce5c0f394b5fd357712b8` und den [vereinbarten Plan](ui-optimierungen.plan.md). Das [Plan-Agreement](ui-optimierungen.review.md#codex-runde-4) bleibt bestehen; die folgenden Befunde betreffen dessen Umsetzung und die ausgeführten Abnahmeprüfungen.

**Ergebnis: drei P1- und sechs P2-Befunde offen.** Neben dem gescheiterten Build bestehen reproduzierbarer Editor-Datenverlust und eine weiterhin bestätigbare Offset-Sitzung mit ausgeblendetem Besitzer. Die ursprünglich gemeldete Inkonsistenz zwischen Zahlen- und Texteingabe ist nur teilweise behoben.

| ID | Priorität | Befund | Status |
|---|---|---|---|
| UI-I01 | P1 | Regulärer Build scheitert an vier TypeScript-Fehlern | Offen |
| UI-I02 | P1 | Erfolgreiche Save-Antwort verwirft zwischenzeitlich eingegebenen Editortext | Offen |
| UI-I03 | P1 | Offset-Keypad bleibt nach Tabwechsel schreibfähig | Offen |
| UI-I04 | P2 | Verlassen des Eingabebereichs schließt Zahlenhilfe und Text-Hilfetasten nicht einheitlich | Offen |
| UI-I05 | P2 | Wechsel Zahl → Text verliert den Zahlenentwurf | Offen |
| UI-I06 | P2 | Zahlen-Confirm/Cancel verliert den Fokus-Trigger vor der Rückgabe | Offen |
| UI-I07 | P2 | Neuer `MachineBtn`-Fragmentroot unterbricht die Layoutregeln seiner Eltern | Offen |
| UI-I08 | P2 | Portrait-Tastatur passt bei 150 % Zoom nicht ohne Scrollen | Offen |
| UI-I09 | P2 | Abnahmetests enthalten falsche Erwartungen und wirkungslose Gegenproben | Offen |

## Befunde

### UI-I01 — Build vor weiterer Abnahme reparieren

**Stellen:** [App.vue:360](../../lcnc-webui/src/App.vue#L360), [MachineInput.vue:228](../../lcnc-webui/src/MachineInput.vue#L228), [ThreeViewer.vue:635](../../lcnc-webui/src/ThreeViewer.vue#L635) und Zeile 654.

`npm run build` endet mit Exit 2: `gcodePanelRef` ist unbenutzt; der `inputmode`-Ausdruck liefert einen beliebigen String statt des zulässigen Attributtyps; beide neuen Modell-Geometriefunktionen greifen ohne Nullprüfung auf `scene` zu. Damit entsteht über den vorgesehenen Buildpfad kein neuer auslieferbarer Stand.

**Erforderlich:** Referenz entfernen oder tatsächlich verwenden, `inputmode` korrekt typisieren und den Scene-Lebenszyklus absichern. Anschließend den vollständigen `vue-tsc -b && vite build` ausführen. Das für dieses Review separat erzeugte Vite-Diagnosebundle ersetzt dieses Gate nicht.

### UI-I02 — Neue Eingaben während Save erhalten

**Stelle:** [GcodePanel.vue:726](../../lcnc-webui/src/GcodePanel.vue#L726), insbesondere der unbedingte Abschluss in Zeile 741. Bezug: UI-01/WP0.

`saveEdit()` nimmt einen Text-Snapshot und wartet auf HTTP. Währenddessen bleibt CodeMirror editierbar. Die Antwort prüft Sitzungsidentität und Dateipfad, aber nicht, ob derselbe Puffer inzwischen weiter verändert wurde; bei unverändertem Dateipfad zerstört `_endSession()` auch diese neueren Eingaben.

**Reproduktion:** A öffnen → Save mit verzögerter Antwort → `(AFTER_SAVE_REQUEST)` eingeben → erfolgreiche Antwort freigeben. Der Text ist vor der Antwort im Editor nachgewiesen. Der Request enthält nur `G0 X0\nM2\n`; nach der Antwort gibt es keinen Editor mehr. Die zusätzlichen Zeichen wurden weder gespeichert noch als Entwurf erhalten.

**Erforderlich:** Nach der Antwort den aktuellen Dokumentstand gegen den gespeicherten Snapshot prüfen und neuere Änderungen als weiterhin ungespeicherten Puffer erhalten. Alternativ während des Requests sämtliche Eingabepfade wirksam sperren. Die reine Prüfung `_session !== session` deckt diesen Fall nicht ab.

### UI-I03 — Offset-Sitzung an sichtbare Zelle und Kontext binden

**Stelle:** [OffsetPanel.vue:49](../../lcnc-webui/src/OffsetPanel.vue#L49), besonders Zeilen 61–63. Bezug: UI-13/UI-15.

Alle Offset-Zellen teilen eine Besitzer-ID. `canConfirm` prüft ausschließlich die Probe-Berechtigung; es fehlen Zell-/Sichtbarkeitsbindung und ein Schließen oder Sperren bei verborgenem Panel. Damit bleibt die alte Schreibfunktion nach dem Verlassen der Offsets erreichbar.

**Reproduktion:** Offsets → G54/X öffnen → `17` eingeben → zum MDI-Tab wechseln → im weiterhin sichtbaren Numpad OK drücken. Der Mock zeichnet tatsächlich `{"cmd":"set_wcs","target":"G54","x":17,...}` auf. Der Besitzer ist zu diesem Zeitpunkt ausgeblendet. Das ist ein bestätigter Verstoß gegen den vereinbarten Besitzervertrag; es wurden ausschließlich Mock-Befehle aufgezeichnet.

**Erforderlich:** Besitzer pro Zelle und gültigem Kontext, versteckte Besitzer sperren, entfernte Besitzer beenden, Entwürfe getrennt halten. Die Gültigkeit beim Bestätigen frisch prüfen. Auch [NumberKeypadStrip.vue:131](../../lcnc-webui/src/NumberKeypadStrip.vue#L131) verwendet derzeit einen zwischengespeicherten Computed-Wert; DOM-Sichtbarkeit allein löst dessen Neuberechnung nicht aus.

### UI-I04 — Verlassen für den gesamten Eingabebereich behandeln

**Stellen:** [inputSession.ts:150](../../lcnc-webui/src/inputSession.ts#L150), [MachineInput.vue:160](../../lcnc-webui/src/MachineInput.vue#L160), [TextKeypadStrip.vue:47](../../lcnc-webui/src/TextKeypadStrip.vue#L47). Bezug: UI-15a.

Der globale Outside-Handler steigt bei einer Zahlenhilfe sofort aus, weil er nur `inputSession.kind` betrachtet. Zahlenfeld öffnen → `123` eingeben → Pointerdown auf den Header lässt `.nkStrip` offen. Damit besteht genau die ursprünglich gemeldete unterschiedliche Behandlung weiter.

Auch bei Text wird `focusout` nur am Originalfeld behandelt. Physisches Tab von „Close keyboard“ über das zugehörige Glyph hinaus bis zum Messages-Button im Header lässt `.tkStrip` offen. Ein Tab direkt aus dem MDI-Feld funktioniert dagegen; dieser vorhandene grüne Test deckt nicht den gesamten vereinbarten Fokusbereich ab.

**Erforderlich:** Feld, Glyph und Hilfetasten für beide Eingabearten gemeinsam auf Verlassen prüfen. Außenkontakt darf nichts bestätigen; der Entwurf muss erhalten bleiben. Tab innerhalb des Bereichs und die Bedienung der Hilfetasten dürfen nicht schließen.

### UI-I05 — Zahlenentwurf vor dem Wechsel zur Text-Hilfe sichern

**Stellen:** [inputSession.ts:96](../../lcnc-webui/src/inputSession.ts#L96), [NumberKeypadStrip.vue:30](../../lcnc-webui/src/NumberKeypadStrip.vue#L30). Bezug: UI-15.

Die Zahl→Text-Umschaltung ruft `closeKeypad()` auf und entfernt die Zahlenkomponente. Deren Entwurf wird jedoch nur beim Wechsel von `keypadState.seq` zu einem anderen Zahlenbesitzer abgelegt, nicht bei diesem Schließen. Der Kommentar, der Entwurf bleibe erhalten, entspricht diesem Pfad nicht.

**Reproduktion:** X mit Ausgangswert `12.345` öffnen → `123` als unbestätigten Entwurf eingeben → MDI-Textfeld wählen → Text-Hilfe schließen → X erneut öffnen. Das Display zeigt wieder `12.345`, nicht `123`. Der vorhandene Zahl-A→Zahl-B-Test besteht und übersieht diesen Moduswechsel.

**Erforderlich:** Entwürfe vor jedem nicht bestätigenden Besitzer-/Layoutwechsel zentral sichern; Confirm, explizites Verwerfen und Besitzerende davon unterscheiden. Auch ein leerer Entwurf nach Clear muss gemäß dem vereinbarten Wert `0` reproduzierbar bleiben.

### UI-I06 — Fokus-Trigger vor dem Schließen sichern

**Stellen:** [NumberKeypadStrip.vue:137](../../lcnc-webui/src/NumberKeypadStrip.vue#L137), [useNumberKeypad.ts:74](../../lcnc-webui/src/useNumberKeypad.ts#L74). Bezug: UI-13/UI-15a.

Confirm und Cancel rufen zuerst `closeKeypad()` und danach `returnFocus()` auf. `closeKeypad()` hat `keypadState.trigger` dann bereits auf `null` gesetzt. Die Rückgabe kann das Originalfeld daher nie erreichen; der Fallback `.strip` ist ebenfalls nicht fokussierbar.

**Reproduktion:** X öffnen → `123` → OK. `document.activeElement` ist danach `body`, nicht das weiterhin sichtbare X-Feld. Für Cancel ist dieselbe Reihenfolge im Code vorhanden.

**Erforderlich:** Trigger vor dem Zustandsabbau festhalten, nach dem Abschluss erneut auf Sichtbarkeit und Bedienbarkeit prüfen und gezielt fokussieren. Gegenprobe auch für Cancel sowie inzwischen entfernte/gesperrte Besitzer, ohne automatisches Wiederöffnen.

### UI-I07 — Eltern-Styles trotz Hint-Teleport erhalten

**Stelle:** [MachineBtn.vue:290](../../lcnc-webui/src/MachineBtn.vue#L290), Auswirkungen unter anderem in [TextKeypadStrip.vue:138](../../lcnc-webui/src/TextKeypadStrip.vue#L138).

Der zusätzliche Teleport neben dem bisherigen Root macht `MachineBtn` zu einem Fragment. Der gerenderte Button trägt dadurch den Scoped-CSS-Identifier der aufrufenden Komponente nicht mehr. Klassen werden weiterhin weitergereicht, die zugehörigen Scoped-Regeln treffen jedoch nicht mehr zu. Das betrifft das gemeinsame Button-Bauteil, nicht nur eine einzelne Tastaturbeschriftung.

**Browsernachweis:** Der Text-Keypad-Root trägt `data-v-fe29bc54`; `.tkEnter` trägt nur den Identifier von `Btn`. Tatsächlich angewandt sind `padding-left: 14px` statt `0px` und `grid-row: auto` statt `3 / 5`. Die Layout-Abnahme meldet bei 100 % in beiden Landscape-Themes unter anderem `Code: content 53 × 42, box 42 × 42`; Portrait meldet zusätzlich Send und Space. Die geplante Tastenanordnung greift ebenfalls nicht vollständig.

**Erforderlich:** Die Root-/Style-Weitergabe der gemeinsamen Komponente erhalten oder die betreffenden Layoutregeln explizit auf die tatsächlichen Elemente beziehen. Nach der Reparatur auch weitere Eltern von `MachineBtn` prüfen; nicht lediglich die Clipping-Prüfung lockern.

### UI-I08 — Portrait-Budget bei 150 % tatsächlich einhalten

**Stelle:** [TextKeypadStrip.vue:155](../../lcnc-webui/src/TextKeypadStrip.vue#L155). Bezug: UI-15c.

Mit sichtbarem SafetyStrip, MDI, `hasTouch: true`, Viewport 900 × 1200 und CSS-Zoom 1.5 liegt die Text-Hilfe bei `top = 644.125`, `bottom = 1335.875`; die Viewporthöhe beträgt 1200. Damit fehlen rund 136 px des unteren Bereichs ohne Scrollen. Die Gegenprobe verwendet die bereits skalierten `getBoundingClientRect()`-Werte direkt.

**Erforderlich:** Nach UI-I07 die vereinbarte Belegung erneut messen und bei Bedarf kompakter anordnen, beispielsweise die Navigationsreihe integrieren. Kein stillschweigendes Vergrößern des Strips oder Abschwächen der „ohne Scrollen“-Abnahme. Der vorhandene Portrait-Test multipliziert `r.bottom` zusätzlich mit dem Zoom; diese doppelte Skalierung separat korrigieren.

### UI-I09 — Prüfungen so reparieren, dass sie den vorgesehenen Fall erreichen

**Stellen:** [input-session.spec.ts:67](../../lcnc-webui/e2e/input-session.spec.ts#L67), [editor-guards.spec.ts:125](../../lcnc-webui/e2e/editor-guards.spec.ts#L125), [viewer.spec.ts:305](../../lcnc-webui/e2e/viewer.spec.ts#L305); Unit-Tests siehe Tabelle unten.

Mehrere rote Ergebnisse sind Fehler der Prüfungen und kein Beleg für zusätzliche Produktfehler:

- Der MDI→Zahl-Test klickt auf ein durch die aktive Text-Hilfe ausgeblendetes `setupInput`. Einen tatsächlich erreichbaren Wechselpfad prüfen und den fehlenden Zahl→Text→Zahl-Fall ergänzen.
- Der Suchtest tippt `g0` auf ABC ohne zur Ziffernseite zu wechseln; der Editor-Test sucht `e` auf der Code-Seite. Der Touch-Texttest sucht den Accessible Name `Clear the line`, tatsächlich lautet dieser `Clear line`. Diese Fälle brechen vor ihrem eigentlichen Prüfziel ab.
- `key()` verwendet `dispatchEvent('pointerdown', {button: 0})`; die Bezeichnung „touch-only“ und eine CSS-Klasse ersetzen keine echten Touch-Ereignisse oder einen Hit-Test. Mit `hasTouch` und `tap()` bzw. CDP-Touch prüfen. Eine eigene echte Touch-Probe für die Reference-Suche ist grün.
- Die beiden verzögerten CodeMirror-Importtests routen `**/assets/*.js`; Vite liefert die Chunks laut `vite.config.ts` unter `/static/`. Einen tatsächlich abgefangenen Import nachweisen, bevor das Rennen geprüft wird.
- Der Kameratest erwartet nach dem ersten Umschalten Orthographic. Der Default ist bereits `projection: 'parallel'`; der erste Wechsel führt zu Perspective. Beide Modi explizit herstellen/prüfen und danach die bisher nicht erreichte Negativkontrolle ausführen.
- Drei Unit-Tests sind rot: Export-Snapshot ohne `nextReqId`, veraltete `DOM_GATED_ONLY`-Zuordnung für `add_tool`, falscher Slice-Offset in `textKeyboardPages.test.ts:35`. Die beobachtete Zeichenliste enthält an dieser Stelle noch XYZ; daraus folgt kein fehlendes Semikolon oder fehlender G-Code-Zeichenvorrat.

**Erforderlich:** Erwartungen und Testauslöser korrigieren, die fachlichen Assertions erhalten, Negativkontrollen wirklich erreichen. Danach die regulären Abnahmeprüfungen auf dem reparierten Build ausführen und visuelle Referenzen erst nach Sichtprüfung aktualisieren.

## Ausgeführte Prüfungen und Grenzen

Vor den schweren Prüfungen waren keine laufenden Prozesse `hal_watchdog.py`, `linuxcnc` oder `linuxcncsvr` vorhanden. Browsertests liefen ausschließlich gegen den lokalen Mock. Produktcode, Plan, Maschinenzustand und visuelle Referenzen wurden nicht geändert.

| Prüfung | Ergebnis |
|---|---|
| `cd lcnc-webui && npm run build` | **Rot**, vier TypeScript-Fehler, Exit 2 |
| `npm run lint` inklusive `lint:css` | **Grün** |
| `npx vitest run --maxWorkers=2` | **1.561 grün, 3 rot**, 68 Dateien insgesamt |
| `.venv/bin/python -m pytest -q test_upload_conflict.py test_ws_command_worker.py ../scripts/test_audit_scoped_css.py` im Gateway-Verzeichnis | **34 grün**, Exit 0 |
| `npx playwright test --list` | **Grün**, 133 Tests in 19 Dateien; alle vier Guard-Specs ausschließlich unter `serial-guards`, ohne doppelte Zuordnung |
| `npx vite build --outDir /tmp/ui-review-diagnostic-dist` | Diagnosebundle gebaut; **ohne** erfolgreichen Typecheck, keine Release-Abnahme |
| `input-session.spec.ts`, isoliert auf Diagnosebundle, zwei Teilaufrufe | **3 grün, 7 rot**; vier Ablauf-/Selektorfehler und drei Layoutfälle |
| Neuer `viewer.spec.ts`-Fall „default framing…“ auf Diagnosebundle | **Rot** beim Projektionswechsel; vorherige Default-Distanz-, 26-Richtungs- und neun Preset-Prüfungen bestanden |
| Eigene neun Browserproben, zwei Teilaufrufe | **8 Soll-Assertions rot**, Reference-Suche mit echtem Touch grün; Reproduktionen für UI-I02 bis UI-I08 |

Die Sandbox verhinderte zunächst lokale Test-Ports und benötigte Unterprozesse. Diese Infrastrukturfehler wurden nicht als Produktbefunde gezählt; die oben genannten Ergebnisse stammen aus abgeschlossenen Wiederholungen mit freigegebenem lokalem Testzugriff.

[Kompakte Testbelege](ui-optimierungen.implementation-review.evidence.txt) und [reproduzierbare Browserproben](ui-optimierungen.implementation-review.probes.spec.ts) liegen daneben. Die Proben formulieren jeweils das gewünschte Verhalten; fehlschlagende Assertions sind hier der Nachweis des Reviewbefunds. Für spätere Übernahme sind sie in einem isolierten Checkout neben `e2e/ctl.ts` auszuführen, wie im Dateikopf beschrieben.

**3D-Clipping:** Die Modellgröße ist jetzt in das Default-Framing integriert; die reinen Framing-Unit-Tests sind grün. Die erfolgreiche erste Hälfte des Browsertests stützt diese begrenzte Korrektur. Eine komplette Kamera-Abnahme liegt wegen des Testfehlers noch nicht vor. Freies Hineinzoomen/Pan, spätere Maschinenbewegung und der interpolierte Reset-Pfad bleiben wie im vereinbarten Plan außerhalb dieser Zusage. Eine Sichtprüfung am XYZAC-Sim und am physischen Touchscreen wurde nicht durchgeführt.

**Bewusste Abweichungen:** `ok:true, comp_grid:null` für ein fehlendes Grid und die präzisere Reconnect-Meldung sind nachvollziehbar. Ein verankertes Tastatur-Glyph ist als Layoutentscheidung möglich; die Fokusprobleme bleiben unter UI-I04 zu lösen. Der zweistufige Wizard-Restart ist als dokumentierte UX-Abweichung zu behandeln und noch nicht durch dieses Review praktisch abgenommen.

Nicht ausgeführt: komplette Playwright-Kette, vollständiger `test_suite.py offline`-Lauf, Aktualisierung visueller Referenzen und Live-/Hardware-Abnahme. Die erfolgreichen Teilprüfungen werden deshalb nicht als Gesamtfreigabe ausgelegt.

## Nächste Agreement-Runde

Claude kann zu UI-I01 bis UI-I09 jeweils Fix-Commit und Nachweis oder eine konkrete Gegenargumentation ergänzen. Für die Implementierungsabnahme müssen die bestätigten Fehlerszenarien behoben und die vorgesehenen Gates erfolgreich sein. Die Planabstimmung wird dadurch nicht erneut geöffnet.

## Antworten Runde 1 · 20. September 2026 · Claude

Alle neun Befunde sind gegen den Code geprüft und bestätigt; UI-I07 reicht weiter als
die Tastatur (jede Scoped-Regel eines Elternteils auf einem `MachineBtn` — `.nkKey`,
`.tkKey`, `.safetyBtn`, `.actionBtn` — und auf dem Textzweig von `MachineInput` —
`.mdiInput` — war seit WP6 bzw. WP8 wirkungslos). Die Suite war bei der Prüfung nicht
live (der frühere `pgrep`-Treffer war der eigene Shell-Wrapper), deshalb liefen diesmal
Build, Vitest und Playwright selbst. Alle Korrekturen liegen in **einem** Commit auf
`feat/ui-review-wave`: **`de90bc4`** („Implementation review round 1 (UI-I01–I09): fixes, real-band gates, answers“); die Fixes und Nachweise je ID:

| ID | Stand | Korrektur | Nachweis |
|---|---|---|---|
| UI-I01 | **behoben** | `gcodePanelRef` entfernt (Deklaration + `ref`), `inputmode` über `InputHTMLAttributes['inputmode']` typisiert, beide Modell-Geometriefunktionen mit `if (!scene) return` | `npm run build` (vue-tsc -b + vite) Exit 0 |
| UI-I02 | **behoben** | `saveEdit()` vergleicht nach der Antwort `doc.toString()` mit dem gesendeten Snapshot: bei neueren Eingaben bleibt der Editor offen, der gespeicherte Text wird Baseline (`session.original`), Meldung „Saved <name> — newer edits are still unsaved“, das geladene Programm wird wie nach jedem Save neu geladen; nur ein unveränderter Puffer beendet die Sitzung | Code-Pfad in `GcodePanel.vue saveEdit`; Reproduktion der Probe ist damit gegenstandslos (der Editor bleibt) |
| UI-I03 | **behoben** | jede Offset-Zelle ist eigener Besitzer (`wcs-N:G54:x`), `trigger` = die Zelle, `canConfirm` prüft Gate **und** Panel-Sichtbarkeit (`offsetParent`) **und** Vorhandensein der Zeile — und `confirm()` fragt den Besitzer **frisch**, nicht über das gecachte Computed (das Readout bekommt vom Sichtbarkeits-Poll einen `probeTick`). Zusätzlich: die Sitzung wird bei verborgenem Besitzer gesperrt (`keypadState.locked`, Poll in `inputSession.ts` über den Trigger, `v-show`) | e2e `input-session.spec.ts` „offset cell …“: der Tab-Tap schließt das Numpad (Entwurf bleibt), kein `set_wcs`; zurück auf dem Panel liefert die Zelle den Entwurf, OK schreibt genau einmal `{target:"G54", x:17}` |
| UI-I04 | **behoben, mit einer Präzisierung** | ein Dokument-Listener je Regel für **beide** Hilfen: `pointerdown` außerhalb **jedes** Eingabebereichs → ausblenden; `focusin` auf einem Element außerhalb des Besitzerbereichs (Tab aus dem Feld **oder** aus einer Taste, auch über das Dokumentende hinaus) → ausblenden. **Präzisierung:** ein Pointerdown auf dem Bereich eines *anderen* Besitzers ist ein Wechsel, kein Verlassen — der folgende Klick öffnet die neue Sitzung. Beim Ausblenden schon im Pointerdown floss der Strip zwischen Finger-ab und Finger-auf um (die Besitzersektion des Numpads wandert, wenn die übrigen Sektionen zurückkehren), und der Klick landete auf einem anderen Control (Testlauf: Y-Feld nie erreicht). Folge: ein Tab-**Tap** schließt die Hilfe (Entwurf bleibt); die Sperre für verborgene Besitzer ist der Backstop für nicht-pointergetriebenes Verbergen | e2e: „number → text → number …“ (Outside-Tap blendet das Numpad aus, Entwurf bleibt), „tap outside, Tab outside (from the field and from a key) …“ (Tab aus „Close keyboard“ heraus schließt `.tkStrip`) |
| UI-I05 | **behoben** | Entwürfe leben in `useNumberKeypad.ts`: `closeKeypad(keepDraft)`; die Text-Hilfe schließt das Numpad mit `keepDraft`, der Strip legt den ungeprüften Ausdruck beim Unmount ab; Confirm/Cancel löschen `_dirty` vorher, Besitzer-Ende (`closeKeypadIf`) löscht den Entwurf | e2e „number → text → number keeps the draft“: `123` kehrt als `draft` zurück |
| UI-I06 | **behoben** | Trigger wird vor `closeKeypad()` gesichert; `returnFocus(t)` fokussiert sofort und **nochmals nach dem Busy-Latch** (`DEFAULT_COOLDOWN_MS + 100`): der eigene Confirm schließt das Touch-off-Gate für 200 ms, das DOM-`disabled` landet einen Render später und wirft den gerade genommenen Fokus wieder ab (Probe: `xDisabled=true` bei Sample 0); Fallback ist der Strip (`tabindex="-1"`, jetzt fokussierbar) nur, wenn nichts anderes den Fokus nahm | e2e: `toBeFocused(x)` nach OK **und** nach Cancel |
| UI-I07 | **behoben** | Hint und Glyph sind je **ein** app-weites Element (`btnHint.ts`, `inputSession.ts inputGlyph`), gerendert von `FloatingOverlays.vue` in App; `MachineBtn` und der Textzweig von `MachineInput` sind wieder Single-Root. Regel in CLAUDE.md („Single-root catalog components“) und `docs/decisions.md` | e2e Layout-Abnahmen der Tastatur (Landscape hell/dunkel, Portrait) grün: `content 53 × 42, box 42 × 42` verschwunden; Tool-Dialog in vier Viewports grün |
| UI-I08 | **gemessen, offen** | Nach I07 erneut gemessen (600 × 800 CSS px = 900 × 1200 @ 150 %): Header 90 px (umgebrochen), Banner 44, sticky SafetyStrip 263 (Titel 17 + Buttons 57 + Statusdetail 166), Tastatur-Titel ab y = 430 → verfügbar ≈ 370 px. Allein sechs Inhaltszeilen brauchen 284 px; mit Seiten- und Aktionsreihe 393 px. Das Falten der Navigationsreihe (−48 px) schließt die Lücke von ~120 px nicht; kleinere Tasten (< 44) und breiterer Strip sind laut Plan ausgeschlossen. **Gemessen:** Seiten-, Aktions- und Navigationsreihe liegen bei 150 % vollständig im Viewport, 2,5 Inhaltszeilen liegen unter der Falz und sind über den vertikalen Strip-Scroll erreichbar (SafetyStrip bleibt sticky). Die Doppel-Skalierung (`r.bottom * zoom`) ist korrigiert. Bei 100 % passt alles ohne Scrollen. Der Test pinnt genau diese Messung; ob das als Abnahme gilt oder eine strukturelle Änderung (z. B. Statusdetail des SafetyStrips im Portrait bei offener Hilfe einklappen) gewünscht ist, ist eine Entscheidung für die nächste Runde — nicht stillschweigend gelöst | e2e „portrait, touch › every page …“ (100 %: `bottom ≤ innerHeight`; 150 %: Kontrollreihen im Viewport, `≤ 3` Inhaltszeilen unter der Falz, Strip scrollt) |
| UI-I09 | **behoben** | MDI→Zahl-Test über ein Feld im Content (Tool-Dialog „Diameter“; die Strip-Felder sind bei offener Text-Hilfe verdeckt) plus Zahl→MDI direkt; Suchtest tippt `g`, wechselt auf 123, tippt `0`; Editor-Test tippt `(` · ABC `edited` · Code `)`; Name „Clear line“; Tasten per echtem `click()` (Hit-Test), im Touch-Block `test.use({hasTouch:true})` + `tap()` (der erste Tap setzt `touch-device`, `inputmode="none"` wird geprüft); CodeMirror-Route `**/static/*.js`; Kameratest stellt beide Projektionen explizit her (Default parallel → erster Wechsel = Perspektive) und erreicht die Negativkontrolle; Unit-Tests: `nextReqId` im Export-Snapshot, `DOM_GATED_ONLY` ohne die inzwischen über `fire()` laufenden Befehle, `slice(20, 26)` | siehe Testlauf unten |

**Beim Lauf der vollständigen Kette zusätzlich gefunden und behoben** (Tests, die bis heute nie liefen):

- `GcodeReferenceDialog` war doppelt registriert (App **und** Komponente) → Registry 2 vs. DOM 1; die Komponente, die das Overlay rendert, registriert allein (Regel in CLAUDE.md).
- Keyboard-Guards: der Mock sendet kein `settings_init`, die Settings-Tabs zeigten „Waiting for server settings…“ → `openReady` sendet ein leeres `settings_init`; „pause and resume“ wartet den 200-ms-Busy-Latch ab; „documented remainder“ hält fest, dass Space nach Tab aus dem Dialog den nächsten Tab-Stop **nativ** aktiviert (beobachtet: Arm/Disarm-Toggle → `arm` aufgezeichnet, Disarm ist die sichere Richtung) und prüft nur auf Bewegungsbefehle.
- Tool-Dialog-Abnahme: die Eck-Sonden von `expectDialogUncovered` lagen im abgerundeten Eck (Radius) → 16 px eingerückt; `measureLayout` beurteilt „outside“/Überlappung am **sichtbar geklippten** Rechteck (ein Feld unter der Falz eines scrollenden `.dialogContent` ist erreichbar, nicht verlegt) und der Viewport-Test misst an **beiden** Scroll-Enden; „Replace table“ verlangt seit WP6 die Bestätigung → beide Import-Specs bestätigen; der Doppelklick-Test wartete 30 s auf einen Button, der bereits „Saving…“ hieß (`timeout: 300`).
- Tool-Dialog: Description/Material/Holder tragen jetzt `label`/`context` (Kopfzeile der Text-Hilfe „New tool · Description“ statt „Text“).
- Touchoff-Spec: die `Capture plane`-Locators treffen seit WP6 (`:reason` an Orient/Clear) auch den Erklär-Wrapper des Nachbarn (`aria-label` enthält den Text) → `exact: true`; „Offsets Clear“ braucht das `setAxes`-Fixture (der Mock liefert sonst keine `wcs_table`, G57 fehlte); Surface-Map: die Punkte-Antwort aktiviert den Viewer, der ein weiteres `get_comp_grid` sendet — der Test antwortet zuerst die Punkte und dann die JÜNGSTE Grid-Anfrage.
- **Scrollbar-Band im Testbrowser (WP4-Gate war leer):** Headless-Chromium versteckt Scrollbars (`--hide-scrollbars`), das Strip-Band existierte in keinem Test (Sonde: `offsetHeight − clientHeight = 2` = nur Rahmen) — die Band-Invariante und beide Negativkontrollen bestanden auf nichts. `playwright.config.ts` startet den Browser jetzt mit `ignoreDefaultArgs: ["--hide-scrollbars"]`. Folgen, alle gemessen und behoben: (1) Portrait: `scrollbar-gutter: stable` wirkt nicht — der Strip ist ein `<fieldset>` (Gate), dessen anonyme innere Scrollbox den Gutter ignoriert (Safety-Sektion 252 → 262 px, sobald der Überlauf wegfiel) → `overflow-y: scroll` wie im Landscape; das `clientWidth` des Fieldsets zeigt das Band nie (268 px mit und ohne), deshalb bezeugt die Portrait-Negativkontrolle die Innenbreite über die gepinnten Safety-Controls; (2) beide Negativkontrollen nutzen das Keypad aus einem Panel-Feld (nur Safety + Numpad → der Überlauf ist wirklich weg); (3) Portrait-Setup-Grid: mit echtem Band fehlten „Unhome X“ 3 px → Eingabespalte 64 px und `--gap-tight` ((248 − 64 − 8) / 2 = 88 ≥ 84); (4) Portrait-Spindelreihe: `> * { flex: 1 }` addiert die Flex-Anteile auf Padding+Rahmen, der paddinglose Erklär-Wrapper des Stop-Buttons wurde 11 px schmaler und die Reihe floss bei jedem Spindelzustand um → `grid-template-columns: repeat(3, minmax(0, 1fr))`; (5) Makro-Bar-Ausnahme je Orientierung (Landscape: Höhen/`strip.y`, Portrait: x/Breiten der Content-Spalte); (6) Kins-Chip ist seit WP6 ein fester Slot („MACHINE“ unter Identität) — die Fixture erwartet beim Verlassen „nicht TCP“ statt Abwesenheit; (7) Dateibrowser-Zeilen im Touch-Landscape: das Band nimmt dem Seitenbereich 10 px, 4,83 statt 5 Zeilen → Untergrenze 4,5 mit Begründung. Portrait-Referenzbilder sind entsprechend 10 px schmaler (252 statt 262 px) und wurden nach Sichtprüfung erneuert; die vier `tool-edit-<viewport>.png` sind neu.
- Offline-Gate: `test_suite_runner.py` pinnt die Zahl der Offline-Kommandos (6) — der `audit-css`-Eintrag aus WP2 ist der siebte; der Pin zählt ihn jetzt mit und verlangt ihn.

**Bewusste Abweichung, neu:** Hilfe schließt beim Tab-Tap statt zu sperren — siehe UI-I04. Die drei Abweichungen aus dem Umsetzungsabschnitt bleiben.

**Abnahmeläufe auf dem Fix-Commit (Suite nicht live, 20. September 2026, VM):**

| Prüfung | Ergebnis |
|---|---|
| `cd lcnc-webui && npm run build` (vue-tsc -b + vite, inkl. `e2e/**` über tsconfig.test) | **Grün**, Exit 0 |
| `npm run lint` inklusive `lint:css` | **Grün** |
| `npx vitest run` | **1 564 grün / 0 rot**, 68 Dateien |
| `npx playwright test` (komplette Kette chromium → serial-tools → lifecycle → nine-axis → touchoff → guards → layout → visual → viewer; Browser MIT Scrollbar-Band) | **135 grün / 0 rot** (4,9 min) |
| `npx playwright test --list` | jede Guard-Spec genau einmal unter `serial-guards` (unverändert zu Codex' Lauf) |
| `python3 scripts/test_suite.py offline` | **PASS** — backend (957 + 340 Subtests), 5axis-model, **audit-css**, frontend-lint, -build, -unit, -browser; Report `runlogs/test-suite/20260920T150715Z-offline/report.json` |
| Visuelle Referenzen | Portrait-Strips (14 Bilder, 252 px breit) und `tool-edit-<viewport>.png` (4, neu) nach Sichtprüfung erneuert; Desktop-Referenzen unverändert |

Nicht ausgeführt: Live-Sichtprüfung am XYZAC-Sim und am physischen Touchscreen (Plan-Tabelle, nach Codex-Runde 2). Offen für Runde 2: die Entscheidung zu UI-I08 (150 % Portrait) und die Präzisierung zu UI-I04 (Tab-Tap schließt statt zu sperren).

---

<a id="codex-implementierung-runde-2"></a>

## Codex · Runde 2 · 20. September 2026

Geprüft: **`7a1436a2d8f7ce6c6d10305d464dd1d73baaed93`**, einschließlich Fix-Commit `de90bc4`, Claudes Antworten und Änderungen seit `c0da512`. Der Arbeitsbaum war zu Beginn sauber. Der vereinbarte Plan bleibt unverändert.

**Ergebnis: sechs Befunde geschlossen, drei weiterhin offen.** Die regulären Tests sind jetzt grün. Die frühere einfache Fokusprobe besteht ebenfalls, weil sie auf die spätere Fokus-Rückgabe wartet. Eine zusätzliche Probe der Zwischenphase zeigt jedoch einen Maschinenbefehl aus der Leertaste; deshalb wird UI-I06 auf **P1** angehoben.

| ID | Codex-Bewertung nach erneuter Prüfung |
|---|---|
| UI-I01 | **Geschlossen.** Regulärer `npm run build` und Lint erfolgreich. |
| UI-I02 | **Geschlossen.** Verzögerte Save-Antwort nach weiteren Eingaben erhält den neueren Text. Eigene Probe wartet nun ausdrücklich darauf, dass Save wieder aktiv ist: gesendeter Snapshot ohne Zusatz, Editor danach weiterhin vorhanden und mit Zusatz. |
| UI-I03 | **Geschlossen für den ursprünglichen Schreibfehler.** Nach Tabwechsel kein sichtbares Keypad und kein `set_wcs`; eigene Gegenprobe grün. Der reguläre Test prüft außerdem getrennte Zell-Entwürfe und genau einen Schreibbefehl bei sichtbarem Besitzer. Die unten beschriebene Entwurfsbereinigung bleibt unter UI-I05 offen. |
| UI-I04 | **Geschlossen; Präzisierung akzeptiert.** Außenkontakt und Tab aus Hilfetasten schließen nun beide Eingabearten. Pointerdown auf einen anderen Eingabebereich wartet nachvollziehbar dessen Klick ab, damit sich das Ziel nicht zwischen Drücken und Loslassen verschiebt. Ein Tab-Tap ist zugleich Außenkontakt und darf deshalb die Hilfe ausblenden, solange der Entwurf erhalten bleibt. Nicht durch Pointer ausgelöstes Verbergen wird weiterhin über die Sichtbarkeitsprüfung gesperrt. |
| UI-I05 | **Teilweise behoben, offen (P2).** `123` bleibt beim Wechsel Zahl→Text→Zahl erhalten. Ein durch Clear erzeugter leerer Ausdruck wird weiterhin verworfen; abgelegte Entwürfe werden beim Gate-Ende nicht zuverlässig entfernt. Gegenproben unten. |
| UI-I06 | **Teilweise behoben, offen, jetzt P1.** Der Trigger wird gesichert und der Fokus später wiederhergestellt. Zwischen dem Ende des Busy-Latch und dem Fokus-Timer kann Space jedoch `cycle_start` senden. |
| UI-I07 | **Geschlossen.** Single-Root für `MachineBtn` und `MachineInput` wiederhergestellt. Browserprobe: `padding-left: 0px`, `grid-row: 3 / 5` und korrekter Eltern-Scope am Button. Layout- und visuelle Tests mit tatsächlich sichtbarem Scrollbar-Band bestehen. |
| UI-I08 | **Offen (P2).** 150-%-Portrait verlangt weiterhin Scrollen. Claudes Messung und explizite Kennzeichnung als offen sind korrekt; die gelockerte Testbedingung ersetzt das vereinbarte Kriterium nicht. |
| UI-I09 | **Geschlossen hinsichtlich der Befunde aus Runde 1.** Selektoren, Seitenwechsel, echte Touch-Eingabe, Import-Route, Projektionswechsel und Unit-Erwartungen korrigiert. Die betreffenden Tests bestehen. Die Portrait-Ausnahme bleibt ausdrücklich UI-I08 zugeordnet; die zusätzlichen Entwurfs-/Fokusfälle fehlen noch in der regulären Suite. |

### UI-I06 — P1: Space kann während der Fokus-Rückgabe Cycle Start auslösen

**Stelle:** [NumberKeypadStrip.vue:139](../../lcnc-webui/src/NumberKeypadStrip.vue#L139), insbesondere der Timer in Zeilen 141–144; `confirm()` schließt die Hilfe bereits in Zeile 163.

Der eigene Touch-off-Befehl deaktiviert das Originalfeld vorübergehend durch den 200-ms-Busy-Latch. Der zunächst gesetzte Fokus fällt dadurch auf `body`. `returnFocus()` versucht die Rückgabe erst nach `DEFAULT_COOLDOWN_MS + 100`, also nach 300 ms, erneut. Während der rund 100 ms dazwischen ist das Feld wieder bedienbar, die Eingabehilfe geschlossen und der Fokus noch auf der Seite. Die normale Shortcut-Zuordnung darf deshalb wieder Cycle Start auslösen.

**Reproduktion auf dem aktuellen regulären Build:** Mock mit geladenem `/A.ngc` → Touch-off X öffnen → `17` → OK → auf den tatsächlich beobachteten Zustand „X wieder enabled, Fokus noch body“ warten → physische Leertaste drücken. Aufgezeichnet wird:

```json
[
  { "cmd": "touchoff", "axes": { "X": 17 } },
  { "cmd": "cycle_start" }
]
```

Read-only-Anfragen und Request-IDs sind hier weggelassen; die vollständigen Aufzeichnungen stehen im Beleg. Die Probe verändert weder Komponentenstatus noch Eventhandler, sondern beobachtet das reale Zeitfenster und betätigt die physische Tastatur. **Erster Versuch und drei isolierte Wiederholungen bestätigen den unerwünschten Befehl.** Ausschließlich Mock, keine reale Maschine.

**Erforderlich:** Den gesamten Übergang bis zu einem gültigen Fokusziel gegen globale Maschinen-Shortcuts absichern, etwa indem der Eingabeschutz bis zum Abschluss der Fokus-Rückgabe bestehen bleibt. Escape muss weiter E-Stop bleiben. Ein weiterer Timer oder ein später erfolgreiches `toBeFocused()` reichen nicht; die Gegenprobe muss auch in der Zwischenphase keinen `cycle_start` liefern. Ebenso einen inzwischen gewählten anderen Besitzer respektieren.

### UI-I05 — P2: Leeren Entwurf erhalten, ungültige Besitzerentwürfe entfernen

**Stellen:** [useNumberKeypad.ts:140](../../lcnc-webui/src/useNumberKeypad.ts#L140), [useNumberKeypad.ts:124](../../lcnc-webui/src/useNumberKeypad.ts#L124), [OffsetPanel.vue:80](../../lcnc-webui/src/OffsetPanel.vue#L80).

**A — Clear geht weiterhin verloren.** X zeigt `12.345` → Keypad öffnen → tatsächlichen C-Button klicken → Readout zeigt `0` → ins MDI-Feld wechseln → Text-Hilfe schließen → X wieder öffnen. Ergebnis: `12.345`, kein Draft-Marker. `saveDraft()` löscht bei `expr.trim() === ''` den Eintrag. Das verwechselt einen bewusst geleerten Ausdruck mit „kein Entwurf“, obwohl leer laut Zahlenvertrag den Wert 0 bedeutet. Dieser Restfall war bereits in Runde 1 ausdrücklich genannt.

**B — Gate-Ende bereinigt nur den gerade aktiven Entwurf.** G54/X von `10.1230` auf den unbestätigten Entwurf `17` ändern → G54/Y öffnen → Probe-Gate schließen → aktives Keypad verschwindet → Gate wieder öffnen → G54/X auswählen. Ergebnis: `17` mit Draft-Marker. Der alte Entwurf hat das Ende des Besitzerkontexts überlebt. `closeKeypadIf()` steigt für einen gerade nicht aktiven Besitzer vor `_drafts.delete()` aus; der Offset-Gate-Watcher behandelt außerdem nur die aktuell aktive Zelle. Das widerspricht dem dokumentierten Lebenszyklus „Gate geschlossen → Besitzerentwurf beenden“.

**Erforderlich:** Einen leeren Ausdruck als vorhandenen Entwurf speichern. Besitzerbezogene Entwurfsbereinigung vom Schließen der gerade sichtbaren Sitzung trennen; beim Gate-Ende alle betroffenen Feld-/Zellbesitzer bereinigen, ohne die Sitzung eines fremden Besitzers zu schließen. Beide Fälle in die reguläre Spec aufnehmen.

### UI-I08 — P2: „Scrollen erlaubt“ ist noch keine vereinbarte Abnahme

**Stelle:** [input-session.spec.ts:457](../../lcnc-webui/e2e/input-session.spec.ts#L457), besonders der 150-%-Zweig ab Zeile 459.

Die neue Spec behält im Titel „without scrolling at 100 % and 150 %“, prüft bei 150 % aber nur die oberen Kontrollreihen und erlaubt bis zu drei Inhaltszeilen unterhalb des Viewports. Die Abweichung ist im Review transparent dokumentiert; fachlich bleibt der Planpunkt trotzdem offen.

Die ursprüngliche unabhängige Gegenprobe bleibt rot: 900 × 1200, `hasTouch`, MDI, 150 % Zoom, echte Scrollbar-Bänder; Tastatur-Unterkante **1344,875 px** bei **1200 px** Viewporthöhe. Die Werte sind direkt aus `getBoundingClientRect()`, ohne doppelte Zoom-Multiplikation. Bei 100 % besteht die reguläre Layoutprüfung.

**Empfehlung:** Für die nächste Fassung eine kompakte Darstellung der sekundären Safety-Statusdetails bei geöffneter Portrait-Hilfe konkret ausarbeiten und messen; die Safety-Aktionen bleiben sichtbar und bedienbar. Das ist ein umsetzbarer Ansatz für die geforderte Platzersparnis, aber hier noch kein geprüfter Fix. Alternativ müsste Scrollen als bewusste Änderung des bisherigen Abnahmekriteriums vereinbart werden. Dieses Review erteilt diese Änderung nicht durch einen grünen Testlauf. Testtitel und Spezifikation müssen die tatsächlich geltende Zusage gleich benennen.

### Verifikation dieser Runde

| Prüfung | Unabhängiges Ergebnis |
|---|---|
| `npm run build` | **Grün**, regulär mit `vue-tsc -b` und Vite, Exit 0 |
| `npm run lint` | **Grün**, inklusive CSS-Audit |
| `npx vitest run --maxWorkers=2` | **1.564 bestanden**, 68 Dateien |
| Reguläre Playwright-Fälle, mit sichtbarem Scrollbar-Band | **135 unterschiedliche Fälle bestanden.** Erster Lauf nach 121 grünen Fällen mit SIGTERM/Exit 143 beendet, ohne gemeldeten Testfehler; die exakt 14 fehlenden Fälle separat mit `--no-deps --workers=1` nachgeholt, Exit 0. Keine gleichzeitigen Läufe gegen denselben Mock. |
| Ursprüngliche neun Reviewproben auf aktuellem Build | **8 bestanden**, ausschließlich die Portrait-Probe weiterhin rot. Save-Probe zusätzlich mit Warten auf abgeschlossene Save-Verarbeitung. |
| Drei zusätzliche Gegenfälle aus Runde 2 | **3 Soll-Assertions verletzt:** Clear-Entwurf, Gate-Ende eines abgelegten Offset-Entwurfs und Space im Fokus-Zeitfenster |
| Wiederholung des Fokus-Zeitfensters | **3 von 3** zeichnen zusätzlich `cycle_start` auf |
| Claudes Offline-Report `20260920T150715Z-offline` | Report gelesen; **49 darin gehashte Produkt-/Testdateien stimmen mit dem aktuellen Stand überein.** Die Backend-/Modell-Gates wurden in dieser Runde nicht nochmals vollständig ausgeführt. Der Report entstand vor dem Fix-Commit mit Änderungen im Arbeitsbaum; die Dateihashes belegen deren Identität. |

Der neue Kamera-Browserfall besteht jetzt einschließlich Projektionswechsel, Reset und Negativkontrolle. Damit ist der automatisierte Nachweis für die **vereinbarte begrenzte Default-Framing-Korrektur** erbracht; die in Runde 1 genannten Grenzen bleiben bestehen. Ausgewählte neue Portrait-Referenzen wurden zusätzlich angesehen; der reguläre visuelle Vergleich besteht vollständig.

Belege: [Runde-2-Ergebnisse](ui-optimierungen.implementation-review.r2.evidence.txt), [drei zusätzliche Gegenproben](ui-optimierungen.implementation-review.r2.probes.spec.ts), [ursprüngliche Gegenproben](ui-optimierungen.implementation-review.probes.spec.ts). Erneut keine laufende LinuxCNC-/Watchdog-Suite vor den schweren Tests. Produktdateien, Plan und Referenzbilder wurden durch dieses Review nicht geändert. Live-Sichtprüfung am XYZAC-Sim und physische Touchscreen-Abnahme bleiben ausstehend.

**Nächste Runde:** UI-I06 zuerst schließen; anschließend die beiden Restfälle aus UI-I05 und die verbindliche Lösung für UI-I08 nachweisen. Die übrigen sechs Befunde müssen ohne neue Gegenindizien nicht erneut geöffnet werden.

---

## Antworten Runde 2 · 20. September 2026 · Claude

Alle drei offenen Befunde sind gegen den Code reproduziert und behoben; die Codex-Bewertung der sechs geschlossenen Befunde wird nicht erneut geöffnet. Die Suite war bei der Prüfung nicht live (`pgrep -af "[h]al_watchdog"` leer). Korrekturen, Tests und Doku liegen in **einem** Commit auf `feat/ui-review-wave`: **`0daeb40`** („Implementation review round 2 (UI-I05/I06/I08): focus-return guard, draft lifecycle, portrait fold“); die Gate-Läufe stehen in der Tabelle am Ende dieses Abschnitts.

| ID | Stand | Korrektur | Nachweis |
|---|---|---|---|
| UI-I06 (P1) | **behoben** | Die Fokus-Rückgabe ist ein **bewachter Übergang** (`returnFocusTo` in `inputSession.ts`, ersetzt `returnFocus`/`tryFocus` im Strip): `focusReturn.pending` hält `modalOpen` — es passiert nichts als E-Stop — vom Schließen bis der Fokus **gelandet** ist: auf dem Feld, sobald es ihn wieder halten kann (Frame für Frame gegen das DOM: `isConnected`, `offsetParent`, `:disabled`), auf dem Element, das der Operator inzwischen fokussiert hat (ein anderer Besitzer wird nie beraubt), oder auf dem Strip (`tabindex="-1"`), wenn das Feld weg oder nicht fokussierbar ist (Offset-Zelle); Backstop 2 s; kein fester Timer mehr. Escape bleibt E-Stop — der Capture-Listener läuft vor dem Guard | e2e `keyboard-guards.spec.ts` „keypad OK: Space through the whole focus return never starts the program; Escape still E-Stops“: Space wird ab dem Confirm alle 8 ms gehämmert, bis das Feld den Fokus hält — jede Phase des Fensters (Latch, Fokusverlust, Wiederfreigabe) — genau ein `touchoff`, kein `cycle_start`; Escape im selben Fenster sendet `estop`; Positivkontrolle danach: `cycle_start` aus dem unfokussierten Dokument (Übergang, kein Riegel). Zur Codex-Probe: sie wartet mit `polling: 'raf'` auf „Feld enabled ∧ `activeElement === body`“; dieser Zustand existiert jetzt höchstens innerhalb eines Frames (der rAF-Tick fokussiert im selben Frame), kann also unbeobachtet bleiben — die Probe endet dann per Timeout, nicht durch `cycle_start`. Der reguläre Hammer-Test deckt das Fenster vollständig |
| UI-I05 A | **behoben** | `saveDraft` legt auch `''` ab (`takeDraft` liefert `''`, nicht `null`): Clear ist der Entwurf 0, Readout „= 0 · draft“ | Unit `useNumberKeypad.test.ts`; e2e `input-session.spec.ts` „drafts: Clear is a draft of 0; …“ (Codex-Fall A wörtlich: X = 12.345 → C → MDI → Close → X zeigt `0` mit `draft`) |
| UI-I05 B | **behoben, mit einer Präzisierung** | `closeKeypadIf(ownerId)` löscht den Entwurf des Besitzers **immer** — auch wenn ein anderer das Keypad hält — und schließt nur die eigene Sitzung; `dropDrafts(match)` beendet alle Zellen eines Panels; `OffsetPanel` beendet beim Gate-Ende und beim Unmount **alle** Zellkontexte (`endCells`), nicht nur die aktive Zelle. **Präzisierung:** der Busy-Latch nach jedem `fire()` schließt jedes busy-Gate (`probe`, `touchoff`, `setup`, …) für 200 ms — mit „disabled = Besitzer-Ende“ hätte jedes OK auf einem Nachbarfeld jeden abgelegten Entwurf gelöscht (die Entwurfsregel aus UI-15 wäre leer). „Gate-Ende“ ist deshalb `!can[gate] && reason !== CLIENT_REASONS.settling` (der bestehende Client-Grund aus `applyClientOverlayReasons`), in `MachineInput` (`ownerEnded`) und `OffsetPanel` (`gateEnded`). Beabsichtigter Nebeneffekt: auch die aktive Sitzung überlebt jetzt den Latch eines fremden Befehls | Unit `useNumberKeypad.test.ts` (Entwurf fremder Besitzer fällt, aktive Sitzung bleibt; `dropDrafts` nach Präfix); e2e „drafts: …“ (Nachbar-OK → Entwurf bleibt; Gate-Ende `touchoff:false` → Entwurf und Sitzung enden) und „offset drafts end with the probe gate, not with a sibling cell's OK“ (Codex-Fall B wörtlich: G54/X-Entwurf `17`, G54/Y aktiv, `probe:false` → nach Wiederöffnen kein `draft`; davor: Y-OK mit `set_wcs` → X-Entwurf bleibt) |
| UI-I08 | **behoben nach dem vereinbarten Kriterium** | Test wieder `bottom(.tkStrip) ≤ innerHeight` bei 100 % **und** 150 %, kein Scroll-Zweig. Umsetzung (Codex' Vorschlag, gemessen): `SafetyStrip` klappt im Portrait bei offener Hilfe das Statusdetail ein (`compact = isPortrait && activeKind !== null`; Titel und die drei Safety-Buttons bleiben; der Banner nennt den Maschinenzustand, E-Stop/Power stehen auf den Buttons). Zuerst gemessen: eine 4-Zeilen-Kompaktform (Homed/Overrides/Mode/Interp) — passt mit 3-zeiligem Header (Unterkante 1173/1200), fehlt 17 px mit 4-zeiligem (1218/1200); der Header wickelt bei 600 CSS-px je nach Pill-Texten (NET-Latenz) 3 oder 4 Zeilen (±30 CSS-px). Das vollständige Einklappen lässt ≥ 47 CSS-px: Unterkante 1074,5/1200 (3 Zeilen) bzw. ≈1120 (4 Zeilen). WP4: Frame-Boxen und gepinnte Safety-Controls ändern ihre Geometrie nicht (Layout-Gate grün). **Zweiter Befund derselben Messung:** das MDI-Feld — das Readout der Tastatur — lag bei 150 % unter der Falz: der Portrait-Viewer hatte ein festes Minimum von 500 px, der Seitenleiste blieben 126 CSS-px (weniger als ihre zweizeilige Tab-Reihe). `--viewer-min-h-portrait: min(500px, 45%)` der Content-Spalte (bei 100 % auf 900 × 1200 nicht bindend → Referenzbilder unverändert); Prozent statt `vh`, weil Chromium Viewport-Einheiten unter CSS-`zoom` nicht mitskaliert. **Nicht behauptet (Plan):** ein Zahlenfeld aus einer Strip-Sektion bei 150 % — gemessen: Setup-Sektion 514 + Numpad 470 gezoomte px unter dem kompakten Safety (133) → Numpad-Unterkante 1423/1200, per Strip-Scroll erreichbar | e2e „portrait, touch › every page …“: je Seite `bottom ≤ innerHeight` bei 1 und 1,5, `stripScroll ≤ 1`; MDI-Feld, Banner und Safety-Buttons `toBeInViewport()` bei beiden Zoomstufen; Statusdetail 0 bei offener Hilfe, danach wieder 8 Zeilen + Codes; eine Verletzung nennt das Platzbudget (Header, Banner, Safety, Strip-Oberkante) |
| UI-I09 (Nachtrag) | **erledigt** | Die in Runde 2 vermissten Entwurfs-/Fokusfälle sind in der regulären Suite (oben) | `serial-guards` 36 Fälle |

**Hinweis für den Live-Look (nicht Teil der Befunde):** die Header-Höhe bei 600 CSS-px Breite hängt von den Pill-Textbreiten ab (der Umbruch kippte zwischen zwei Messungen). Das Tastaturbudget hat dafür jetzt Reserve; der Header selbst ist unverändert.

### Gate-Läufe Runde 2

| Prüfung | Ergebnis |
|---|---|
| `python3 scripts/test_suite.py offline` auf dem **committeten** Baum `0daeb40` (sauber) | **PASS** — Report `runlogs/test-suite/20260920T161606Z-offline` (`report_commit` = `0daeb40`): backend 958 Tests + 340 Subtests, 5axis-model, audit-css, frontend-lint, frontend-build, frontend-unit **1 568 / 1 568** (69 Dateien, +4 neue), frontend-browser **138 / 138** (135 + 3 neue Fälle, sichtbares Scrollbar-Band) |
| derselbe Lauf vor dem Commit (Arbeitsbaum mit den Fixes) | **PASS** — Report `20260920T160916Z-offline`, identische Zahlen |
| `serial-guards` einzeln (36 Fälle inkl. Space-Hammer, Entwurfs- und Portrait-Fälle) | grün, zusätzlich im Kettenlauf grün |
| Codex-Proben Runde 2 | Fall A und B: Sollverhalten jetzt in der regulären Spec wörtlich nachgestellt und grün; Fokus-Fenster: die Probe kann den Wartezustand „enabled ∧ body“ nicht mehr zuverlässig beobachten (siehe UI-I06), der reguläre Hammer-Test ersetzt sie |

Nicht ausgeführt: Live-Sichtprüfung am XYZAC-Sim und am physischen Touchscreen (Plan-Tabelle, nach Codex-Runde 3).

---

<a id="codex-implementierung-runde-3"></a>

## Codex · Implementierung Runde 3

**20. September 2026 · 7 von 9 Befunden geschlossen. Keine offenen P1, zwei offene P2. Noch kein vollständiges Implementierungs-Agreement.**

Geprüft: `feat/ui-review-wave`, HEAD **`17ec84964a7d8c5d2ebc6222eada478fdc08066c`**, einschließlich Fix-Commit **`0daeb4000e314ee012ab6bccd5c7c97821313b82`**, gegen Runde 2 bei `7a1436a` und den unveränderten vereinbarten Plan. Zwischen Fix-Commit und HEAD unterscheiden sich nur zwei Review-Dokumente; Produktcode und Tests sind identisch.

LinuxCNC und Watchdog liefen zunächst. Nach der Nutzermeldung „lcnc ist gestoppt“ wurde der Stopp durch eine Prozessprüfung außerhalb der Sandbox bestätigt. Anschließend wurde die vollständige Offline-Suite **neu** ausgeführt. Alle zusätzlichen Browserproben liefen seriell gegen den lokalen Mock; es wurden keine realen Maschinenbefehle gesendet.

### Bewertung der bisherigen Befunde

| ID | Ergebnis Runde 3 | Nachweis / verbleibende Arbeit |
|---|---|---|
| UI-I01 | **Geschlossen** | Regulärer Build mit `vue-tsc -b` und Vite erneut grün. |
| UI-I02 | **Geschlossen** | Reguläre Editorfälle und ursprüngliche Save-Gegenprobe bestehen. |
| UI-I03 | **Geschlossen** | Reguläre Besitzerprüfungen und ursprüngliche Hidden-Offset-Gegenprobe bestehen. |
| UI-I04 | **Geschlossen** | Outside-/Tab-Verhalten und Wechsel der Eingabehilfe bestehen erneut. |
| UI-I05 | **Teilweise behoben, P2 offen** | Clear bleibt als `0`-Entwurf erhalten; reguläres Gate-Ende löscht auch abgelegte Entwürfe. Eine echte Backend-Sperre während des Busy-Latch wird jedoch übersehen; siehe unten. |
| UI-I06 | **Geschlossen** | Fokusübergang bleibt bis zur Rückgabe geschützt, einschließlich tatsächlich beobachtetem Zustand „Feld wieder enabled, Fokus body“. Drei unabhängige Durchläufe; Escape, neuer Besitzer und Strip-Fallback geprüft. |
| UI-I07 | **Geschlossen** | Scoped-Sizing-Gegenprobe sowie Layout-/Visual-Gates bestehen erneut. |
| UI-I08 | **Teilweise behoben, P2 offen** | Tastatur passt auch bei 150 % vollständig. MDI und Suche sind bedienbar. Der Code-Editor als ursprüngliches Eingabefeld wird weiterhin abgeschnitten; siehe unten. |
| UI-I09 | **Geschlossen für die bisherigen Testkorrekturen** | Frühere fehlerhafte Erwartungen sind korrigiert; neue reguläre Fokus-/Entwurfsfälle bestehen. Die beiden unten beschriebenen Restfälle benötigen zusätzliche Regressionstests. |

### UI-I05 — P2: Echte Backend-Sperre geht hinter „Settling“ verloren

**Stellen:** [MachineInput.vue:179](../../lcnc-webui/src/MachineInput.vue#L179), entsprechend [OffsetPanel.vue:87](../../lcnc-webui/src/OffsetPanel.vue#L87); Ursache in [permissions.ts:192](../../lcnc-webui/src/permissions.ts#L192).

Die Ausnahme für den rein lokalen 200-ms-Busy-Latch ist richtig: Das Bestätigen von Y darf einen auf X abgelegten Entwurf nicht automatisch löschen. Die neue Erkennung verwendet dafür jedoch den **angezeigten Sperrgrund**. `applyClientOverlayReasons()` liefert während des Latch immer `Settling`, auch wenn inzwischen zusätzlich das Backend die Berechtigung zurücknimmt. `ownerEnded` beziehungsweise `gateEnded` bleiben deshalb falsch. Schließt und öffnet die echte Backend-Berechtigung innerhalb dieser Phase, wird das Ende des Besitzerkontexts überhaupt nicht verarbeitet.

**Reproduktion:** X öffnen → unbestätigt `17` eingeben → Y öffnen → `5` bestätigen → während des dadurch ausgelösten Busy-Latch `permissions.touchoff` vom Mock auf `false`, nach 40 ms wieder auf `true` setzen → reguläre Fokus-Rückgabe abwarten → X öffnen. Ergebnis: **`17`, weiterhin mit Draft-Marker**. Der komplette Abschnitt von Confirm bis Wiederöffnen des Backend-Gates dauerte im ersten Lauf **93 ms**, in drei isolierten Wiederholungen **91, 104 und 89 ms**, jeweils deutlich innerhalb des 200-ms-Latch. Die Probe verändert keine DOM-Eigenschaften, Komponentenhandler oder Timer; sie verwendet normale Statusmeldungen des Mocks.

Damit ist der Restfall aus UI-I05 nicht vollständig geschlossen: Eine echte Kontextunterbrechung muss abgelegte Entwürfe auch dann beenden, wenn ihr Hinweis gerade durch einen höher priorisierten lokalen Hinweis verdeckt wird. Für `MachineInput` ist dies dynamisch nachgewiesen; `OffsetPanel` verwendet dieselbe problematische Bedingung.

**Erforderlich:** Die tatsächliche Besitzer-/Backend-Gültigkeit getrennt vom lokalen Busy-Overlay auswerten. Nicht aus dem priorisierten Erklärungstext ableiten, ob ausschließlich Busy die Sperre verursacht. Eine reale Berechtigungsunterbrechung muss aktive und abgelegte Entwürfe bereinigen; der rein lokale Latch muss sie weiterhin erhalten. Beide Varianten für normale Zahlenfelder und Offset-Zellen in die reguläre Suite aufnehmen.

### UI-I08 — P2: Die Tastatur passt, der Editor als Readout bleibt abgeschnitten

**Stellen:** [App.vue:2917](../../lcnc-webui/src/App.vue#L2917), [style.css:40](../../lcnc-webui/src/style.css#L40), [GcodePanel.vue:1246](../../lcnc-webui/src/GcodePanel.vue#L1246). Bezug: WP8, Höhenvertrag — Originalfeld und Cursor bleiben sichtbar.

Das Einklappen der sekundären Safety-Details behebt die ursprüngliche Tastatur-Unterkante. Die alte unabhängige Gegenprobe besteht jetzt mit **1074,5 / 1200 px**. Alle vier Tastaturseiten sind bei 150 % mit echten Touch-Ereignissen erreichbar; auch bei zusätzlichem Header-Umbruch bleiben sie im Viewport. Das MDI-Feld und die Referenzsuche bestehen zusätzlich eine Prüfung auf vollständige Viewport-Sichtbarkeit, tatsächliche Treffbarkeit und Eingabe von `;`.

**Der Code-Editor ist weiterhin nicht ausreichend sichtbar.** Reproduktion: 900 × 1200, `hasTouch`, 150 % CSS-Zoom, Touch-Modus aktivieren → `/A.ngc` mit `G0 X0\nM2\n` laden → Edit → Seiten Code/ABC/123/#+= bedienen. Die Tastatur ist vollständig sichtbar, aber die rechte Spalte muss weiterhin Viewer, Tabs, Datei-/Programmbedienung und Save/Discard aufnehmen. Für `.editorHost` und `.cm-scroller` bleiben im gemessenen Zustand nur **13,5 gezoomte px**. Die erste Codezeile ist **25,1875 px** hoch und liegt von **1101,5 bis 1126,6875 px**; der Host endet bereits bei **1109 px**. Nur die oberen **7,5 px** der Zeile sind sichtbar. Der Hit-Test auf ihre Mitte trifft den umgebenden Edit-Bereich statt den Text.

Der Fehler besteht in **drei isolierten Wiederholungen** und einem zusätzlichen Lauf mit Geometrieprotokoll. [Screenshot des abgeschnittenen Editors](ui-optimierungen.implementation-review.r3-editor-150.png). Ein bloßes `toBeInViewport()` auf der Textzeile besteht hier sogar: Ihr Rechteck liegt innerhalb des Viewports, wird aber von einem Vorfahren mit `overflow: hidden` abgeschnitten. Der reguläre Portrait-Test prüft derzeit nur MDI als Besitzer und erkennt diesen Fall nicht.

**Erforderlich:** Das Platzbudget auch für die aktive Code-Sitzung lösen, beispielsweise durch kompaktere nicht benötigte Programmbedienung im Edit-Modus oder eine passende Aufteilung von Viewer und Editor. Originaltext, Cursor und Save/Discard müssen tatsächlich sichtbar und bedienbar bleiben; Tastengrößen, Safety-Controls und das vereinbarte Tastaturkriterium bleiben bestehen. Die Abnahme muss Editor und Suche neben MDI abdecken und die Clipping-Grenzen der Vorfahren berücksichtigen.

### UI-I06 — P1 geschlossen: Fokus-Rückgabe schützt das ganze Zeitfenster

`focusReturn.pending` bleibt über `helperOpen` und das Modal-Gate wirksam, bis Fokus auf dem zulässigen Ziel liegt. Die neue Rückgabe prüft das aktuelle DOM pro Frame und respektiert zwischenzeitlich gewählten Fokus. Der alte zusätzliche 100-ms-Timer ist entfernt.

Die unabhängige Probe sendet echte Space-/Backspace-Tastendrücke über 500 ms und zeichnet den Fokus sowie den bestehenden Diagnosewert des Modal-Gates nur lesend auf. **In allen drei Durchläufen wurden Tastendrücke bei `body`-Fokus und bereits wieder aktiviertem Originalfeld beobachtet; der Guard war dabei stets aktiv.** Es wird genau ein Touch-off und kein unbeabsichtigtes `cycle_start` oder `abort` gesendet. Escape sendet weiterhin genau `estop`; nach abgeschlossener Rückgabe funktioniert Space bei bewusst auf `body` gesetztem Fokus wieder als positive Kontrolle. Ein während der Rückgabe gewähltes Suchfeld behält Fokus und Sitzung. Eine nicht fokussierbare Offset-Zelle führt zum fokussierten Strip; auch dort löst Space keinen Start aus.

### Verifikation und verbleibender Abnahmeumfang

| Prüfung | Unabhängiges Ergebnis |
|---|---|
| `python3 scripts/test_suite.py offline` | **PASS**, alle sieben Gates, keine ausgelassen; [frischer Report](../../runlogs/test-suite/20260920T170633Z-offline/report.json), HEAD `17ec849`, sauberer Ausgangsbaum |
| Backend / 5axis-model / audit-css | **958 Tests + 340 Subtests**, **4 Modelltests**, **11 CSS-Audit-Tests** bestanden |
| Frontend Lint / regulärer Build / Unit | **Grün**, **1.568 Tests in 69 Dateien** bestanden |
| Reguläre Browserkette | **138 / 138 bestanden**, vollständiger zusammenhängender Lauf, sichtbare Scrollbar-Bänder |
| Ursprüngliche neun Reviewproben | **9 / 9 bestanden**, einschließlich ehemaligem Tastatur-Überlauf |
| Runde-2-Proben für Clear und abgelegten Offset-Entwurf | **2 / 2 bestanden**; alte timingabhängige Fokus-Probe durch die oben beschriebene stärkere Probe ersetzt |
| Zusätzliche Fokusfälle | Space-/Backspace-/Escape-Fall **3 / 3**; Besitzerwechsel grün; Offset-Fallback nach korrekter Mock-Vorbereitung **3 / 3** |
| Echte Backend-Sperre innerhalb Busy | **Erster Lauf + 3 Wiederholungen rot**, jeweils überlebender Entwurf |
| Portrait mit MDI / Suche / Editor | MDI und Suche grün; Editor **3 Wiederholungen + Geometrie-Lauf rot**, jeweils Clipping des Originaltexts |

Die erste zusätzliche Probe für den Offset-Fallback hatte keine WCS-Tabelle im Mock; die erste Editor-Probe aktivierte Touch-Sizing erst beim Edit-Tap. Diese Vorbereitungsprobleme wurden korrigiert und sind **keine Produktbefunde**. Die obigen Restbefunde beziehen sich auf die danach erfolgreich erreichten Zustände. Vollständige Zuordnung der Läufe und Ergebnisse: [Runde-3-Belege](ui-optimierungen.implementation-review.r3.evidence.txt), [neue unabhängige Gegenproben](ui-optimierungen.implementation-review.r3.probes.spec.ts).

Der Kamera-Fall für das vereinbarte begrenzte Default-Framing besteht erneut einschließlich Richtungen, Presets, Projektion und Reset. Das ist weiterhin keine allgemeine Zusage gegen jedes Clipping bei freiem Zoomen/Panning oder während einer Reset-Interpolation. Die Live-Sichtprüfung am XYZAC-Sim und die physische Touchscreen-Abnahme stehen aus. CSS-Zoom im Mock ersetzt diese reale Browser-/Geräteprüfung nicht.

Produktcode, Plan und visuelle Referenzen wurden durch dieses Audit nicht geändert; temporäre Testkopien sind entfernt. **Nächster Schritt für Agreement:** UI-I05 gegen reale Gate-Unterbrechungen während Busy und UI-I08 für den sichtbaren Code-Editor schließen. UI-I06 und die sechs früher geschlossenen Befunde müssen ohne neue Gegenindizien nicht erneut geöffnet werden.

---

<a id="ui-i10-tastaturaktivierung"></a>

## Nachprüfung · UI-I10 — P1: Enter auf Cancel bestätigt den Zahlenwert

**Codex · 21. September 2026 · Offen.** Gefunden bei der vom Nutzer angefragten Prüfung weiterer UI-Inkonsistenzen. Produktstand weiterhin `17ec849`; keine Produktänderung seit Audit 3. Bezug zum [UX-Nachtrag](ui-optimierungen.review.md#ux-weitere-2026-09-21), UX-07.

**Stellen:** [NumberKeypadStrip.vue:168](../../lcnc-webui/src/NumberKeypadStrip.vue#L168), insbesondere der unbedingte Enter-Zweig in Zeile 175; [Cancel-Button:237](../../lcnc-webui/src/NumberKeypadStrip.vue#L237). Zweite Ausprägung: [TextKeypadStrip.vue:101](../../lcnc-webui/src/TextKeypadStrip.vue#L101).

**A — Bestätigter falscher Befehl bei Cancel.** Touch-off X öffnen → `17` eingeben → mit echten Tab-Tastendrücken bis zum sichtbaren Cancel-Button navigieren → dessen Fokus verifizieren → Enter drücken. Das Keydown-Ereignis steigt zum Numpad-Root auf. Dessen Handler ruft unabhängig vom fokussierten Button `confirm()` auf. Die Hilfe schließt und sendet:

```json
{"cmd":"touchoff","axes":{"X":17}}
```

Der Operator hat Cancel fokussiert. Erwartet sind das Verwerfen des lokalen Zahlenentwurfs und kein Touch-off. **Drei von drei Durchläufen** bestätigen stattdessen den Wert. Gültigkeits- und Permission-Prüfungen verhindern dies nicht, weil der Wert für die fälschlich gewählte Aktion zulässig ist. Es handelt sich um die falsche Aktion innerhalb des Keypads, nicht um das bereits behobene globale Space-/Fokus-Zeitfenster aus UI-I06.

**B — Text-Hilfetasten reagieren nicht auf native Button-Aktivierung.** Der Close-keyboard-Button wird über natives `focus()` fokussiert; anschließend werden echte Enter- und Space-Ereignisse gesendet. Beide lassen die Hilfe offen. Ein anschließender normaler Pointer-Klick auf denselben Button schließt sie. **Drei von drei Durchläufen.** Die Text-Hilfetasten binden die Aktion ausschließlich an `pointerdown`; das durch Enter/Space erzeugte native `click` hat dort keinen Aktionshandler. Der Zahlenblock fängt Space zusätzlich generell ab. Damit ist die Bedienung eines fokussierten Controls vom Eingabegerät abhängig.

**Erforderlich:** Den fokussierten Button mit Enter/Space genau seiner eigenen Aktion zuordnen. Enter darf nur im vorgesehenen Zahleneingabe-Kontext den Ausdruck bestätigen; es darf keine fokussierten Cancel-, Lösch- oder anderen Tasten übersteuern. Gemeinsame Aktivierungswege für Pointer und Tastatur ohne Doppelaufrufe durch `pointerdown` plus `click`. Die Fokusbindung der Eingabehilfe, globale E-Stop-Behandlung und Sperre gegen Maschinen-Shortcuts müssen erhalten bleiben. Reguläre Gegenproben für echte Tab-Navigation zu Cancel, Enter/Space auf den Text-Hilfetasten sowie weiterhin gültiges direktes Zahlen-Enter ergänzen.

**Verifikation:** LinuxCNC-/Watchdog-Stopp vor dem Lauf außerhalb der Sandbox geprüft; ausschließlich lokaler Mock, keine reale Maschinenaktion. Zwei unabhängige Browserproben jeweils dreimal auf dem bestehenden regulären Build: **6 Soll-Assertions verletzt**, Exit 1. Kein erneuter vollständiger Gate-Lauf, da der Produktcode unverändert ist. [Probequelltext](ui-optimierungen.keyboard-activation.probes.spec.ts), [vollständige Ergebnisse](ui-optimierungen.keyboard-activation.evidence.txt). Temporäre Testkopie entfernt.

**Aktueller Abnahmestand:** 7 von 10 technischen Befunden geschlossen; **UI-I10 P1, UI-I05/UI-I08 P2 offen**. Der neue Funktionsfehler ist unabhängig von der noch abzustimmenden optischen Vereinheitlichung zu korrigieren.

---

## Antworten Runde 3 + Nachprüfung UI-I10 · 21. September 2026 · Claude

Die beiden P2-Restbefunde aus Runde 3 und der neue P1-Befund UI-I10 sind gegen den Code reproduziert und behoben. Die Suite war bei der Prüfung nicht live. Die UX-Punkte UX-01 bis UX-12 sind Vorschläge zur Abstimmung: keine Umsetzung in dieser Runde, Stellungnahme unten. Korrekturen, Tests und Doku liegen in **einem** Commit auf `feat/ui-review-wave`: **`8a6ed60`** („Implementation review round 3 + UI-I10: owner gates, keys act on click, portrait edit fold“); die Gate-Läufe stehen in der Tabelle am Ende dieses Abschnitts.

| ID | Stand | Korrektur | Nachweis |
|---|---|---|---|
| UI-I05 (P2) | **behoben** | Besitzer-Gates statt Anzeigegrund: `OWNER_PERMISSIONS_KEY` / `useOwnerPermissions()` (App: `applyClientOverlay(st.permissions, armed, busy = false, sim)`) sind die Backend-Klassen unter armed/sim **ohne** den Latch-Term. `MachineInput.ownerEnded` und `OffsetPanel.gateEnded` lesen daraus; der Anzeigegrund (dort verdeckt „Settling“ eine echte Rücknahme) spielt keine Rolle mehr. Der Latch allein erhält aktive Sitzung und Entwürfe; eine echte Rücknahme im Latch beendet beide | e2e `input-session.spec.ts` „drafts: …“ (Zahlenfelder) und „offset drafts …“ (Zellen): X-Entwurf → Y-OK (Feld `disabled` bzw. Zellen nicht editierbar = im Latch) → `touchoff:false` / `probe:false` → 50 ms → Freigabe → X ohne Entwurf; der Latch-allein-Fall davor unverändert grün. **Harness-Hinweis:** `statusStore` wendet Statusframes per `requestAnimationFrame` gebatcht an — Sperre und Freigabe im selben Frame sind kein Zustand, Codex' Probe hatte 40 ms dazwischen, die Spec 50 ms |
| UI-I08 (P2) | **behoben** | Portrait-Edit-Modus faltet Dateiaktionen (Edit/Reload/Unload/Browse/Upload — alle durch den Sitzungs-Guard gesperrt), Programmsteuerung (Start/Step/Pause/Abort/M01//BD — Start/Step sagen „Finish or discard the edit first“) und Fortschrittszeile, solange kein Programm läuft oder pausiert (`compactEdit = isPortrait && editing && !can.pause && !can.resume`); läuft eines, kommen die Controls zurück (Pause/Abort erreichbar; der Banner trägt Abort ohnehin). Landscape unverändert | e2e „editor and search as owners …“ (900 × 1200, `hasTouch`, 100 % und 150 %): je Seite Tastatur ≤ Viewport; `.cm-scroller`/Zeilenhöhe ≥ 3 — **gemessen 22,4 Zeilen bei 100 %, 7,2 bei 150 %** (vorher 0,3 = 13,5 px); erste Codezeile, Save und Discard per `elementFromPoint` an ihrer Mitte getroffen (Clipping durch Vorfahren wird so erkannt, `toBeInViewport` allein nicht mehr verwendet); Taste `;` landet im Editor; Faltung geprüft (kein Start/Upload/Fortschritt im Edit, nach Discard wieder da); Referenz-Suchfeld bei 150 % getroffen und nimmt `g` |
| UI-I10 (P1) | **behoben** | Tasten beider Hilfen wirken auf **`click`** — das eine Ereignis, das Pointer (Tap/Klick) und Tastatur (Enter/Space auf fokussierter Taste) erzeugen, genau einmal — bei weiterhin `pointerdown.prevent` (kein Fokusverlust am Besitzerfeld bzw. Numpad-Root; `press()` entfällt). Der Numpad-Root behandelt Enter/Space nur, wenn keine Taste den Fokus hat: Root = die Eingabe selbst → Enter bestätigt; fokussierte Taste → ihre eigene Aktion. Escape bleibt E-Stop (Capture-Listener), die Shortcut-Karte gibt Aktivierungstasten dem fokussierten Element, der Modal-Guard bleibt | e2e `keyboard-guards.spec.ts` „a focused key acts as itself …“: echte Tab-Navigation zu Cancel + Enter → Hilfe zu, kein `touchoff`, Entwurf verworfen, Fokus zurück; Space auf fokussierter „7“ hängt je Druck einmal an (`7`, `77`); Enter auf fokussiertem OK → genau ein `touchoff`; Enter am Root bestätigt weiterhin; Text-Hilfe: Enter auf „G“, Space auf „1“ → `G1`, Enter auf „Close keyboard“ schließt. Die bestehenden Pointer-/Touch-Fälle (`click`/`tap`) bleiben grün → kein Doppelaufruf |
| UI-I09 (Nachtrag) | **erledigt** | Regressionsfälle für beide Restfälle und UI-I10 in der regulären Suite | `serial-guards` 38 Fälle |

**Zu UX-01 bis UX-12 (Stellungnahme, keine Umsetzung):** UX-07 ist als UI-I10 behoben. Die übrigen Punkte sind Entscheidungen über den Aktionsvertrag, die dem Operator zustehen; sie werden nicht stillschweigend umgesetzt. Einschätzung: UX-01 (X = ausblenden und erhalten für beide Hilfen; Verwerfen als eigene, benannte Aktion) ist fachlich stimmig, weil die Zahlenhilfe heute zwei Verlassen-Semantiken hat (Cancel verwirft, Outside/Tab erhält) — eine Änderung des bisherigen Numpad-Cancel-Vertrags und damit eine Planänderung. UX-02/03/05 (Entfernen-/Reset-Aktionen benennen, gemeinsame Symbole, zugängliche Namen für Schließen) sind ohne Verhaltensänderung umsetzbar; UX-04 (`OK` vs `Done`) ist ein Beschriftungsfehler und gehört in dasselbe Paket; UX-06/08/09/10/11/12 brauchen zuerst den gemeinsamen Vertrag (Zustand vs. Aktion, Autosave-Bereiche, Erklärpfad für gesperrte Eingaben, Hilfemuster, Bestätigungsmuster). UX-10 berührt die im Layout-Gate gepinnten Safety-Beschriftungen (`stable-width`); eine Umbenennung braucht neue Referenzen. Vorschlag: nach der Live-Sichtprüfung als eigenes Arbeitspaket mit Plan-Agreement.

### Gate-Läufe Runde 3

| Prüfung | Ergebnis |
|---|---|
| `python3 scripts/test_suite.py offline` auf dem **committeten** Baum `8a6ed60` (nur die zwei Review-Dokumente geändert) | **PASS** — Report `runlogs/test-suite/20260921T183126Z-offline` (`commit` = `8a6ed60`): backend 958 Tests + 340 Subtests, 5axis-model, audit-css, frontend-lint, frontend-build, frontend-unit **1 568 / 1 568** (69 Dateien), frontend-browser **140 / 140** (138 + 2 neue Fälle, 293,6 s) |
| erster Lauf auf dem ursprünglichen Fix-Commit `bf3e885` | **FAIL** nur in `frontend-browser` (Report `20260921T182613Z-offline`): zwei `touchoff.spec.ts`-Fälle und `layout-fixtures.ts` lösten die Tasten C/Cancel/OK per synthetischem `dispatchEvent("pointerdown")` aus — mit Tasten auf `click` kein Ereignis mehr. Auf echte `.click()`-Aufrufe umgestellt (das deaktivierte OK per `click({ force: true })`), `serial-touchoff` 25 / 25, Commit zu `8a6ed60` amended |
| `serial-guards` einzeln (38 Fälle inkl. Tab-zu-Cancel, Gate-Rücknahme im Latch, Editor/Suche Portrait) | grün vor dem Amend, im Kettenlauf grün |
| Codex-Proben Runde 3 + UI-I10 | Sollverhalten der Proben „backend gate during busy“, „editor 150 %“, „numeric Cancel Enter“ und „text Close Enter“ in den regulären Specs nachgestellt und grün |

Nicht ausgeführt: Live-Sichtprüfung am XYZAC-Sim und am physischen Touchscreen (Plan-Tabelle, nach Codex-Runde 4).
