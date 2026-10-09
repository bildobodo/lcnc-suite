# Restprüfung im Lauf — Kollisionen vor der Maschine, während das Programm läuft

**Fassung 1 · 9. Oktober 2026 · Kollisionsplan Schritt 3, letzter Teil** (Operator 2026-10-06: „nach der ECHTEN Messung im Lauf den Rest des Programms ab der aktuellen Position neu prüfen“). Zur Planprüfung an Codex (R112). Gebaut wird erst nach Einigung.

## Ausgangslage, gemessen am Stand `a30b4138`

1. **Ein Programm-M6 löscht die Befunde bis zum Stillstand.** `ThreeViewer.vue` `applyState` ruft bei jeder Änderung von `tool_length`, `tool_diameter`, `g5x_offset`, `g92_offset` und `rotation_xy` (bei `tool_offset` nur ohne `toolBasis`) `_colOnInputChange()` auf (2588–2602). Das bricht die Prüfung ab und löscht Ergebnis, Einfärbung und Codezeilen-Marken. Der neue Anstoß (`_colScheduleAuto`) wird verschoben, solange `interp_state` nicht IDLE ist (`_colHeldByRun`, 3387–3402). Im Lauf heißt das: Das erste Werkzeugwechsel-M6 oder ein G10 L2 des Programms selbst lässt alle Befunde verschwinden, bis das Programm zu Ende ist. Dabei bildet der Payload genau diese Änderungen pro Segment ab (`tlo_events`, `parse_tlos`, WCS-Epochen).
2. **Eine Messung im Lauf** (M600 → G10 L1) stößt die eingefrorene Neu-Analyse an (`midrun_table_gate_open`, `pinned_ctx`): Das ganze Programm wird vom eingefrorenen Start aus mit der neuen Tabelle neu geparst. Beim Eintreffen löscht der `viewerGcode`-Watcher die Befunde (3436–3444) und hält die Prüfung bis IDLE an (Codex R40 MR-I03: sie muss dort wieder anlaufen, das tut sie). Eine Neu-Analyse im Lauf trägt im Payload kein Kennzeichen. Erkennbar ist sie nur am letzten `preview_refresh.reason` = `midrun:<drift>` zusammen mit `interp_state`; dieser Grund ist beim Eintreffen des Payloads schon wieder weg (das Envelope mit dem Ready-Ping trägt kein `preview_refresh` mehr).
3. **Wo die Maschine auf dem Track steht**, weiß nur `ScrubBar.vue`. Dessen `runWatcher` projiziert die Gelenkposition auf den Track (Fenster vorwärts, Vollsuche bei Fehltreffer, OFF-PATH mit `cum: null`). ThreeViewer, das die Prüfung besitzt, erhält davon nichts (die Emits `pose` und `finding` laufen nur in der Simulation). Bei Schleifen und mehrfach gerufenen Subs landet die Vollsuche auf dem **frühesten** passenden Durchgang (`projectOntoTrack`, erster bester Treffer). Der `motion_line`-Hinweis ist für Schleifen grob (`lineRange` über alle Durchgänge).
4. **Der Sweep beginnt immer bei Punkt 0.** `CollisionOptions` kennt keinen Startindex. Ein Teilstück geht nur über `sliceTrack(t, a, b)`. Die Ereignistabellen (`tloEvents`, `wcsEvents`, Frames) bleiben dabei geteilt, die Indizes pro Segment gültig. Die Basis wandert dann auf den ersten Punkt des Teilstücks: Schneidpaare in Kontakt beginnen „eingerastet“, Werkzeugpaare in Kontakt werden als Beginn gemeldet, Maschinenpaare, die dort berühren und in Ruhe frei sind, ebenfalls; die auch in Ruhe berühren, werden statisch ausgeschlossen. Eine Zusammenführung gibt es nur für ein **vorangestelltes** Stück (`mergeEntryResult`, die Anfahrt), keine für einen Rest.

## Vorschlag

### A · Was der Lauf selbst ändert, ist kein neuer Eingang

Solange ein Programm läuft (AUTO, `interp_state` ≠ IDLE), lösen Änderungen von `tool_length`, `tool_diameter`, `tool_offset`, `g5x_offset`, `g92_offset`, `rotation_xy` und den genutzten WCS-Zeilen **kein** `_colOnInputChange` aus. Das Programm erzeugt sie selbst, und der geprüfte Payload bildet sie pro Segment ab. Was vor dem Lauf geprüft wurde, gilt weiter.

Der Prüfstand des Laufs bleibt der vor dem Start, also Werkzeug- und Offsetbasis zu Beginn. Ein Lauf ändert nichts davon, ohne dass ein neuer Payload kommt: Das Gateway parst im Lauf nur bei einer Tabellenänderung neu (Punkt B), und jede Änderung im Stillstand wird wie heute im Stillstand behandelt.

Wächter: e2e, Lauf mit Programm-M6 (andere `tool_length`, `tool_diameter`) und Programm-G10 L2 → die Befunde bleiben (rot mit dem heutigen Löschen); im Stillstand derselbe Wechsel → gelöscht und neu geprüft (Kontrolle).

### B · Nach einer Messung im Lauf: der Rest ab der aktuellen Position

1. **Erkennen:**
   - `previewRefresh.reason` mit dem Präfix `midrun:` setzt ein Merkzeichen für die Datei.
   - Ein `viewerGcode` derselben Datei, das bei laufendem Interpreter eintrifft, ist dann ein Payload aus einer Messung im Lauf.
   - Das Merkzeichen endet mit diesem Payload, bei IDLE oder bei einem Programmwechsel.
   - Ein Payload im Lauf ohne Merkzeichen (gibt es heute nicht) wird wie bisher bis IDLE zurückgehalten.
2. **Position:** `ScrubBar` gibt die Ausgabe von `runWatcher` an ThreeViewer weiter (neues Emit `run-pos {cum, index, phase}`, nur im Lauf). Der Startindex `k` ist der erste Punkt des Segments, auf das die Maschine projiziert. Ist die Position beim Eintreffen nicht angehängt (OFF-PATH oder noch keine Vollsuche), wartet die Restprüfung bis zu 3 s auf eine angehängte Position. Danach prüft sie den **ganzen** Track. Das ist langsamer, übersieht aber nichts.
3. **Prüfen:**
   - Ein **Haupt**-Sweep über `sliceTrack(base, k, base.count)`. Er läuft mit allem, was der Haupt-Sweep hat: Shards, Teilergebnisse, Pause bei Kamera und verborgenem Tab, Parken.
   - Er läuft nicht als Seiten-Sweep: Der ist einzeln, ohne Teilergebnis, ohne Pause.
   - Der volle Sweep wartet weiter bis IDLE (MR-I03) und ersetzt dann das Restergebnis.
4. **Anzeigen:**
   - Ein neues `mergeRestResult(rest, k, base)` verschiebt die Treffer-cums um `base.cum[k]`, ebenso Intervalle, Spannen-Enden und den erfassten Anteil (`covered` auf die Basisachse umgerechnet, ab `cum[k]`).
   - ScrubBar zeigt es auf dem Basis-Track. Der geprüfte Bereich ist das Band ab der Position, das Ungeprüfte davor bleibt ohne Band.
   - Die Zusammenfassung im Sim-Tab nennt den Umfang: „Rest ab L… geprüft (Werkzeug im Lauf gemessen)“. Das „?“ erklärt, dass davor nicht neu geprüft ist.
5. **Grenzen, offen benannt:**
   - **Die Basis am Startpunkt:** Was dort berührt, wird als Beginn auf der ersten Zeile des Rests gemeldet, nicht als Fortsetzung eines früheren Befunds. Im Schnitt eingerastete Schneidpaare bleiben wie beim Programmanfang still.
   - **Schleifen:** Die Position kann auf einem früheren Durchgang liegen, dann prüft der Rest mehr als nötig. Befunde hinter der Maschine sind dann sichtbar. Übersehen wird nichts vor der Maschine.
   - **Rechenlast:** Die Prüfung läuft im Browser, nicht auf der Steuerung. Die Steuerung ist davon nicht betroffen.

### C · Was unverändert bleibt

- Der Zeitstrahl startet keine Bewegung, eine Warnung hält nichts an. Anzeige wird vereinheitlicht, nicht Betätigung.
- Die Prüfung im Stillstand bleibt wie heute.
- Die Gateway-Seite bleibt unverändert.

## Abnahme

- **Unit:**
  - `mergeRestResult`: Verschiebung, Intervalle, `spanCumEnd`, Anteil, leeres Ergebnis.
  - Restplaner: Start `k`, Rückfall auf den ganzen Track ohne Position, Merkzeichen-Ende.
  - `runWatcher`-Weitergabe.
- **e2e `collisions.viewer.spec`:**
  - Programm-M6 und G10 L2 im Lauf behalten die Befunde (A).
  - Neu-Analyse im Lauf mit einem Hindernis **vor** der Position → Befund im Lauf sichtbar, an seiner Zeile. Rot mit der heutigen Zurückhaltung.
  - Ein Hindernis **hinter** der Position erscheint im Restergebnis nicht. Im Stillstand findet es der volle Sweep wieder (MR-I03-Fall, angepasst).
  - Keine Position → ganzer Track.
  - Verborgener Tab und Kamera pausieren die Restprüfung.
- **Mutationen:** jede Regel rot.
- **Live:** auf der Sim mit einem M600-Programm, wenn eine laufende Sim zur Verfügung steht.

## Fragen an Codex

1. Ist A tragfähig? Kann ein Lauf ohne neuen Payload einen Eingang ändern, den der Payload nicht abbildet? Also eine Programmänderung, die nicht pro Segment im Payload steht, die die Prüfung aber vom Live-Wert liest (Basiswerkzeug, `liveTool`, Start-WCS)?
2. Rest als Teilstück mit eigener Basis, oder ein voller Sweep mit Vorrang ab der Position? Letzteres bräuchte einen Startparameter im Iterator mit übernommenem Kontaktzustand.
3. Befunde hinter der Position: im Restergebnis gar nicht, oder ausgegraut?
4. Reicht der früheste Durchgang bei Schleifen als konservative Position, oder soll der `motion_line`-Hinweis den Start begrenzen?
