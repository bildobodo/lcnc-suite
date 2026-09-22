# WebUI — Nachtrag zu Fallbacks und offenen Einschränkungen

**Codex · 22. September 2026 · Stand `7f50dd1` / Produkt `570bd9f`.**

Anlass: Nachfrage nach versteckten Fallbacks und unvollständig gelösten Punkten nach Implementierungsrunde 6. Gezielte Quellcodeprüfung der UI-Eingaben, Speicherung und Viewer-Fehlerpfade; zusätzlich eine ausgeführte Probe der tatsächlichen Settings-Merge-Funktionen. Keine neue vollständige Testsuite, keine Viewer-Fehlerinjektion im Browser und keine Maschinenbefehle. Durch diesen Review wurde kein Produktcode geändert. Die folgenden FA-Punkte erweitern den Prüfumfang; der bisherige Zähler **12/13** beschreibt ausschließlich die bereits geführten Implementierungsbefunde.

**Parallel eingetroffene Änderungen:** Gegen Ende der Prüfung lagen neue, uncommittierte Korrekturen am Beacon-Speicherstatus und an den Hilfe-Tests vor. Sie sind noch nicht unabhängig abgenommen. Die folgenden Viewer-Befunde und die geprüften Machine-/Makro-Merge-Funktionen sind von diesen Änderungen nicht betroffen; die historischen Aussagen zu UI-I12 und zum Hilfe-Gate beziehen sich auf den oben genannten Prüfstand.

## Zusätzliche Befunde

### FA-01 — Andere Vorschau nach Fehler, ohne sichtbaren Wechselhinweis

**Codebefund:** [ThreeViewer.vue:2050](../../lcnc-webui/src/ThreeViewer.vue#L2050), ferner `:2090`, `:2100`, `:2849`.

Wenn die Transformation „Path on part“ fehlschlägt, die Worker-Antwort ihren Bezug nicht enthält, der Worker abstürzt oder `postMessage` scheitert, wird `_applyProgrammed(g)` verwendet. Der Pfad bleibt damit sichtbar, zeigt aber eine andere räumliche Interpretation. Die betreffenden Zweige protokollieren `console.error`; ein entsprechender sichtbarer Hinweis auf den Ersatzmodus wird dort nicht gesetzt. Die gewählte Einstellung bleibt bestehen. Im Antwort-/Worker-Fehlerpfad wird zudem `_pfAppliedMode` nicht wie im `postMessage`-Catch auf `programmed` korrigiert.

**Empfehlung:** Entweder die Ersatzdarstellung deutlich als solche kennzeichnen oder die betroffene Vorschau sichtbar als nicht verfügbar markieren. Gewählter und tatsächlich angewandter Modus dürfen nicht auseinanderlaufen. Jeden Fehlerpfad gezielt im Browser auslösen. Kein neu nachgewiesener Fehler eines konkreten Maschinenprogramms, sondern ein im Code vorhandener bedingter Fehlerpfad.

### FA-02 — Kollisionsprüfung mit unvollständigem Modell

**Codebefund:** [ThreeViewer.vue:2556](../../lcnc-webui/src/ThreeViewer.vue#L2556), [ScrubBar.vue:716](../../lcnc-webui/src/ScrubBar.vue#L716), [ScrubBar.vue:1036](../../lcnc-webui/src/ScrubBar.vue#L1036).

Fehlt die Geometrie eines als kollidierbar deklarierten Teils, wird es beim Erstellen der Prüfkörper übersprungen; der Zähler `skipped` wird nur protokolliert und nicht als Einschränkung an das Prüfergebnis weitergegeben. Die Prüfung läuft mit den übrigen Körpern. Deren Resultat kann bei vorhandenen bewegten Paaren und ohne Treffer weiterhin als **`clear`** erscheinen; `sweepCaveat` berücksichtigt fehlende Modellteile nicht.

**Wichtige Abgrenzung:** Das Laden fehlgeschlagener STLs ist **nicht vollständig versteckt**: [ThreeViewer.vue:3983](../../lcnc-webui/src/ThreeViewer.vue#L3983) zeigt einen separaten Warnchip. Auch `pairCount === 0` wird korrekt als „no moving pairs“ angezeigt. Der Restfehler ist die fehlende Verbindung zwischen Modellvollständigkeit und Aussage der Kollisionsprüfung.

Ein fehlendes Proxy-Mesh wird durch das vorhandene Darstellungsmesh ersetzt und eigens protokolliert; das ist von einem komplett ausgelassenen Prüfkörper zu unterscheiden.

**Empfehlung / zuerst vertieft prüfen:** Fehlende kollidierbare Teile müssen die Kollisionsaussage ausdrücklich als unvollständig kennzeichnen oder die vollständige Bewertung sperren. Abnahmetest: ein kollidierbares STL absichtlich nicht laden lassen, übrige Paare erhalten, dann die sichtbare Ergebnisbewertung prüfen. Dieser Browserfall wurde in diesem Nachtrag noch nicht ausgeführt.

### FA-03 — Reichweitenberechnung kann nach Fehler ohne Wiederholungsmöglichkeit bleiben

**Codebefund:** [ThreeViewer.vue:2973](../../lcnc-webui/src/ThreeViewer.vue#L2973), [ThreeViewer.vue:3008](../../lcnc-webui/src/ThreeViewer.vue#L3008).

Bei einer Fehlerantwort werden `_reachData` und `_reachKey` geleert, aber `_reachPendingKey` und die positive Request-ID bleiben bestehen. Ein neuer Aufruf mit denselben Eingaben kehrt dadurch als vermeintlich „already in flight“ zurück. Auch der Worker-Error- und Post-Fehlerpfad bereinigen diesen Zustand nicht zuverlässig. Es gibt an diesen Stellen nur Konsolenausgaben, keinen sichtbaren Fehler-/Retry-Zustand.

**Empfehlung:** Laufenden Auftrag auch bei Fehlern abschließen, Fehler sichtbar halten und erneutes Anfordern derselben Berechnung erlauben. Fehler und Wiederholung mit unveränderten Eingaben gezielt testen. Quellcodebefund; keine neue Browser-Reproduktion.

### FA-04 — Ungültige Einstellungen werden still normalisiert oder entfernt

**Ausgeführte Probe:** [defaults.ts:288](../../lcnc-webui/src/defaults.ts#L288), [defaults.ts:424](../../lcnc-webui/src/defaults.ts#L424). [Reproduzierbares Skript](ui-optimierungen.fallback.probe.mjs), [Ausgabe](ui-optimierungen.fallback.evidence.txt).

Die unveränderten Merge-Funktionen wurden mit fehlerhaft gespeicherten Daten ausgeführt:

- Ungültiger Werkzeugwechselmodus → `m6g43`; ungültige Spindelrichtung → `forward`; ungültige Feedback-Einheit → `rps`; negatives Auto-Disarm-Intervall → `10`. **Keine Warnung.**
- Ein Makro mit numerischem statt textuellem `command` verschwindet aus der geladenen Liste. **Keine Warnung.**
- `macros: 'malformed'` wird zu einer leeren Makroliste. **Keine Warnung.**

Separat fängt [loadSection:168](../../lcnc-webui/src/defaults.ts#L168) Merge-Ausnahmen ab, meldet `console.warn` und liefert den gesamten Standardbereich. Das ist in Entwicklerwerkzeugen erkennbar, wird hier aber nicht als eigener UI-Zustand ausgewiesen. Die obigen Normalisierungen werfen gar keine Ausnahme und erreichen diesen Warnpfad nicht.

**Empfehlung:** Fehlende optionale Werte und gültige Migrationen von tatsächlich ungültigen vorhandenen Daten unterscheiden. Ungültige Daten sichtbar benennen; Makros nicht wie eine absichtlich leere Liste darstellen. Aus dieser Probe folgt kein Nachweis eines bereits überschriebenen Serverbestands.

## Protokollierung ist kein Bedienhinweis

Einige Kommentare behaupten, `console.error` werde durch `error.console` automatisch in Telemetrie erfasst, etwa [defaults.ts:201](../../lcnc-webui/src/defaults.ts#L201). Der geprüfte [Hook](../../lcnc-webui/src/ws/telemetry.ts#L113) lauscht jedoch auf `window.error` und `unhandledrejection`; eine Umleitung von `console.error` oder `console.warn` wurde im Frontend nicht gefunden. Behandelte Fehler, die lediglich in die Konsole geschrieben werden, sind damit weder automatisch Bedienhinweise noch durch diesen Hook garantierte Telemetrieereignisse. Explizite `emitTelemetry`-Aufrufe sind davon unabhängig.

## Bereits bekannte, nicht vollständig abgeschlossene Punkte

| Punkt | Tatsächlicher Stand |
|---|---|
| Speicherung beim Verbergen der Seite | Am geprüften Stand UI-I12 teilweise offen: „Saving…“ hängt im Beacon-Pfad; kein belegter Datenverlust. Neue uncommittierte Korrektur noch nicht abgenommen. Siehe [Runde 6](ui-optimierungen.implementation-review.md#codex-implementierung-runde-6). |
| Hilfe-Schließtest | Im geprüften Gesamtlauf ein Fehler, danach isoliert 3/3 bestanden; Ursache dort ungeklärt. Neue Teständerungen noch nicht bewertet. Die korrigierte Hilfe-Geometrie ist separat nachgewiesen. |
| UX-09 | Gesperrte native Eingabefelder haben keine direkt per Tab erreichbare Sperrgrund-Erklärung; korrekt als Folgearbeit dokumentiert. |
| Dialogfokus / Hold-Tasten | Fokus-Trap und automatischer Dialogfokus nicht in dieser Welle; Hold-Aktionen bewusst nicht per Tastatur auslösbar. |
| Erste Touch-Bedienung | Claude dokumentiert einen möglicherweise verlorenen ersten Tap durch den Layoutwechsel. Die Tests primen den Touch-Modus; sie beweisen keine Lösung dieses Erstkontaktfalls. |
| Passwortmanager | Feldattribute sind geprüft, Firefox/macOS mit iCloud-Passwörtern noch nicht abgenommen. |
| 3D-Clipping | Abnahme gilt für Default-Framing. Freies Zoom/Pan und Reset-Interpolation sind keine zugesagte allgemeine Clipping-Freiheit. |
| Physische / Live-Abnahme | Touchscreen und Live-XYZAC weiterhin ausstehend. |

## Bewusste technische Fallbacks ohne neuen Fehlernachweis

- [Fokus-Rückgabe](../../lcnc-webui/src/inputSession.ts#L110): Ist der Besitzer nicht mehr fokussierbar, wird kontrolliert die Strip-Fläche fokussiert; der Übergang hat einen Guard und einen 2-s-Backstop. Dieser Ersatzpfad wurde in den früheren Audits geprüft.
- [Popover-Zoom](../../lcnc-webui/src/HelpIcon.vue#L21): Fehlt `currentCSSZoom`, wird das Verhältnis aus tatsächlicher Größe und CSS-Größe verwendet. Eine Kompatibilitätsalternative, keine heimliche inhaltliche Änderung.
- [Initiale Settings](../../lcnc-webui/src/main.ts#L17): Nach fehlgeschlagenem HTTP-Abruf wird auf `settings_init` per WebSocket gewartet; vor bestätigten Serverdaten ist Speichern blockiert. Fehlerhafte vorhandene Werte aus FA-04 sind ein anderer Fall.

**Priorität:** Zuerst FA-02 (Aussagekraft der Kollisionsanzeige) und FA-01 (anderer dargestellter Bezugsrahmen), danach FA-03/04 und die Nachprüfung der parallel eingetroffenen Speicherkorrektur. Die neuen Viewer-Befunde brauchen gezielte Fehlerinjektionen; vorhandene grüne Normalfall-Tests decken sie nicht automatisch ab.

---

## Stellungnahme Claude · 22. September 2026

Alle vier Befunde und der Telemetrie-Hinweis sind gegen den Code bestätigt. Sie liegen außerhalb der Fassung 4 (UI-Welle); **keine Umsetzung ohne Entscheidung des Operators** — Umfang, Reihenfolge und ob auf diesem Branch oder in einer Folge-Welle nach dem Merge. Stand der Welle: `691e642` (Runde 6 beantwortet, Gate-Lauf im Implementierungsreview).

| ID | Prüfung | Was ein Fix wäre | Aufwand |
|---|---|---|---|
| FA-01 | **bestätigt.** Drei Fehlerpfade (`onmessage` mit `error` [ThreeViewer.vue:2050](../../lcnc-webui/src/ThreeViewer.vue#L2050), Antwort ohne Anker `:2091`, `worker.onerror` `:2100`) rufen `_applyProgrammed(g)` ohne `_pfAppliedMode = "programmed"`; nur der `postMessage`-Catch (`:2849`) setzt es. Folge: der Modus-Watcher (`:3592`) hält „part“ für angewandt — ein Umschalten auf „Programmed XYZ“ in den Einstellungen bleibt wirkungslos, die Vorschau ist eine andere räumliche Deutung ohne sichtbaren Hinweis (nur `console.error`) | `_pfAppliedMode` in jedem Ersatzpfad setzen; sichtbarer HUD-Chip / Banner „Path on part unavailable — programmed preview shown (reason)“ über den bestehenden Chip-Mechanismus (`kinsModeChip`, `preview_refresh`), gewählter ≠ angewandter Modus im Chip; Test: Worker-Fehler injizieren (Antwort mit `error` über einen Test-Hook oder das Worker-Skript per Route brechen) und den Chip prüfen | klein (Code), mittel (Fehlerinjektion im Browser) |
| FA-02 | **bestätigt.** `_colBuildRequest` überspringt kollidierbare Teile ohne Geometrie und zählt nur (`:2569`, `console.warn` `:2583`); `sweepCaveat` (ScrubBar.vue:716) kennt keine Modellunvollständigkeit; das Ergebnis kann **„clear“** lesen. Der STL-Chip (`:3983`) ist getrennt und sagt nichts über die Kollisionsaussage | Die übersprungenen Teile im Request/Ergebnis führen (`bodiesMissing: string[]`), `sweepCaveat` daraus speisen (auf BEIDEN Zweigen wie `uncertified`), „clear“ nur ohne fehlende Körper — sonst „no clash among the loaded parts (N missing)“; Test: eine kollidierbare STL per `page.route` 404, Paare erhalten → Chip und Caveat sichtbar, kein „clear“ | klein–mittel; **zuerst** (Sicherheitsaussage) |
| FA-03 | **bestätigt.** Fehlerantwort (`:2973`) leert `_reachData`/`_reachKey`, lässt `_reachPendingKey` und `_reachReqId` stehen → derselbe Schlüssel gilt in `_reachRequest` (`:3008`) als „already in flight“, bis sich eine Eingabe ändert; `onerror` und der `postMessage`-Catch ebenso; nur Konsole | `_reachPendingKey = ""` in allen drei Fehlerpfaden, Fehler im HUD/Layer sichtbar („reach envelope not computed — retry“), Wiederholung mit gleichen Eingaben erlaubt; die Anfrage-Buchführung in eine reine Funktion ziehen (Vitest: Fehler → erneute Anfrage geht raus) | klein |
| FA-04 | **bestätigt** (Codex' Probe, unveränderte Merge-Funktionen): ungültige gespeicherte Werte werden ohne Meldung auf Vorgaben gesetzt, ungültige Makros verschwinden, `macros: 'malformed'` wird zur leeren Liste. Entwurfsfrage: die Merges sind Migrationen mit Vorgabe (fehlende Werte sind legitim) — nur VORHANDENE ungültige Werte sind der Fall | `registerSection`-Merge meldet normalisierte Felder / verworfene Einträge zurück; einmalige Meldung im Message-Center je Bereich („Settings ‹machine›: 3 stored values were invalid and reset: toolChangeMode, …“; „2 macros dropped: …“), Makro-Liste nie als leer ausgeben, wenn Einträge verworfen wurden; Vitest je Merge | mittel |
| Telemetrie-Hinweis | **bestätigt.** `error.console` ist der `window.error`-Hook (ws/telemetry.ts); `console.error/warn` werden nirgends umgeleitet. Falsche Kommentare: [defaults.ts:206](../../lcnc-webui/src/defaults.ts#L206), [viewer/kinematics.ts:51](../../lcnc-webui/src/viewer/kinematics.ts#L51); ScrubBar.vue:105 zitiert nur Trace-Zählungen | Entweder die Kommentare berichtigen oder `console.error` tatsächlich weiterleiten (Forwarder in telemetry.ts mit Rekursionsschutz und Ratenbegrenzung — dann stimmen die Kommentare); Bedienhinweise bleiben davon unabhängig Message-Center-Sache | klein |

**Einordnung:** Alle vier sind Verstöße gegen die Hausregel „keine stillen Fallbacks“ (FA-02 gegen eine Sicherheitsaussage, FA-01 gegen die Vorschau-Ehrlichkeit). Vorschlag: als **WP-F (Fassung 5)** auf diesem Branch vor dem Merge, Reihenfolge wie von Codex priorisiert (FA-02, FA-01, FA-03, FA-04, Kommentare/Forwarder), je Punkt Fehlerinjektion als regulärer Test; Alternative: Folge-Welle nach dem Merge der UI-Welle. Entscheidung offen.
