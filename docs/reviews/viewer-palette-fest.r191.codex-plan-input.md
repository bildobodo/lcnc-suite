# VP188-02 — Statusalter bei wiederholten Versatzwechseln (Plan)

**Fassung 2 · 23. Oktober 2026 · Zweig `feat/vp188-basiswechsel` von `development` (`084b8e4a`) · Merge nach `development` über den Integrationszweig, nie `main`.**

Gebaut wird erst nach Einigung über diesen Plan. Die Verhaltensänderung in Abschnitt 3 entscheidet der Operator; er hat die Planung beauftragt („ja plane es“).

Fassung 1 hat Codex in R190 in der Grundform angenommen: Schritt 0 und N1 tragen, E2 nur bedingt. Fassung 2:
- **Reihenfolge (Antwort 1):** Schritt 0, dann N1, dann messen. E1 nur, wenn N1 das Ziel nicht erreicht. N2 läuft getrennt, denn es erklärt den S-Befund nicht.
- **Zustandsvertrag von E1 (VP190-01):** Besitzer des Wartens, getrennte Übergänge für Beginn, Parse, Veröffentlichung und Übernahme, einmaliger Rückfall je unveränderter Generation, alle Startwege.
- **Hinweise zu Schritt 0, N1, N2, E2 und zum Messablauf** sind eingearbeitet.

Geändert sind 2, 3, 4, 5 und 6; neu ist Abschnitt 8. Die Antworten auf R190 stehen am Ende.

## 1 · Ausgangslage

**Befund (Codex R188 VP188-02, R189):** Beide Browser-PC-Läufe vom 23. Oktober verfehlen das Ziel „Statusalter p95 < 50 ms“ nur in der Phase S_supersede.
- **Werte:** p95 58 / 68 ms, p99 96 / 110 ms, Maximum 132 / 177 ms.
- **Phase:** acht Wechsel des G54-Z-Versatzes in 30 s, mit `bpc_parse.ngc` geladen (600 000 Zeilen, 600 003 Punkte).
- **Alle anderen Phasen:** p95 36 ms.

Das Ziel wird nicht gelockert. Nach einer Korrektur wird derselbe S-Fall mit Eingabe und anschließender Beruhigung erneut gemessen.

**Beobachtet in den Rohdaten (Lauf 2):**
- Je Wechsel kommt ein `collision.sweep_start` mit 600 003 Punkten, der vorige wird abgebrochen.
- In denselben Fenstern liegen `mt_late_max` 83–130 ms, `raf_gap_max` 90–139 ms und `render_max` 29–69 ms.
- Welcher Anteil auf welche Arbeit entfällt, ist nicht gemessen (Codex R188).

**Was die Seite heute je Versatzwechsel tut** (Stand `084b8e4a`, Bestandsaufnahme im Code):
1. **Sofort, im `applyState` des Statusbilds:** Die Prüfung wird abgebrochen (Nachricht `cancel`), Ergebnis und Tönung werden gelöscht, `collision-lines` wird leer (`_colOnInputChange`, ThreeViewer.vue 4264–4279). Die Werkstück-Markierung wird gesetzt.
2. **Nach 300 ms:** Der Pfad wird neu gebacken (`_pfScheduleWcsRefresh` 4487–4507 → `applyGcode`).
   - Im Teil-Modus rechnet der Part-Frame-Worker.
   - Seine Antwort führt auf dem Hauptthread `toolpath.apply` aus (toolpathController.ts 1014–1217): Chunks, LOD-Paare, Überlagerungen und die Fat-Line-Pakete. Das sind neue Puffer von 24 B je Paar, etwa 14 MB für Stufe 0 bei 600 000 Paaren, plus die gröberen Stufen und das GPU-Hochladen beim nächsten Render.
3. **Nach 400 ms:** Die Prüfung startet neu (`_colScheduleAuto` → `runCollisionCheck` → `_colBuildRequest` 3921–4039).
   - Für 600 000 Punkte werden `pos`, `abc`, `lines`, `rapid` und `cum` kopiert und übertragen, etwa 20 MB.
   - Weitere Spalten werden kopiert, aber **nicht** übertragen: `mode`, `frame`, `brk`, `ustart`, `dep`, `wcs`, `tlo`, `unpredicted`, `band`, `cond`, `lineOk`, `sub`, `cline`. Sie werden beim `postMessage` ein zweites Mal geklont, bis zu etwa 14 MB doppelt.
4. **Nach 2–4 s:** Der Gateway parst neu (`preview_refresh`, Kante `wcsoff:G54:z`). Wenn er veröffentlicht, wirft die Seite die Arbeit aus 2 und 3 weg: neue Dekodierung, neues `toolpath.apply`, neue Prüfung.

Keiner dieser Wege fragt, ob der Gateway gleich neu parst. Sofort bekannt ist `previewWcsStale` (die Vorschau trägt andere Versätze als die Maschine); es färbt nur den Pfad (`toolpath.setStale`). `preview_refresh` erscheint erst nach 2–4 s.

**Nebenbefund:**
- Hat der Bediener die Simulation einmal betreten, überlebt die Einfahrbahn das Verlassen (ScrubBar.vue 344–350). Jede Versatzänderung baut sie dann ohne Entprellung neu und kopiert die ganze Bahn (`_buildEntryTrack`, `prependEntry`).
- In den Messläufen war die Simulation nie betreten, der Nebenbefund trägt dort also nichts bei. Er gehört aber zur selben Kostenklasse.

## 2 · Schritt 0 · Zuordnen, bevor gebaut wird

**Messspannen auf dem Hauptthread:** `viewerPerf.noteSpan(name, ms)` sammelt je 3-s-Fenster Anzahl, Summe und Maximum. Die Perf-Zeile trägt sie als `span_<name>` (`{n, sum, max}`). Gemessen wird mit `performance.now()` um den synchronen Teil, im selben Kontext.

| Spanne | um |
|---|---|
| `col_copy` | `_colBuildRequest` (die Kopien und den Aufbau der Anfrage) |
| `col_post` | das synchrone `postMessage` der Anfrage |
| `col_cancel` | den synchronen Teil von `_colOnInputChange` |
| `path_reply` | den Antwort-Handler des Part-Frame-Workers einschließlich `toolpath.apply` |
| `path_programmed` | `_applyProgrammed` |
| `pf_load` | `_pfEnsureLoaded` |
| `entry_track` | `_buildEntryTrack` |
| `render` | gibt es schon (`render_*`) |

- **Feste Namen:** Die Namen sind eine feste Liste; ein fremder Name wird gezählt (`span_unknown`), nicht angelegt.
- **Fehlerpfade:** Jede Spanne schließt in `finally`, auch auf einem Fehlerpfad.
- **Verschachtelung:** `path_reply` kann auf einem Fehlerpfad `_applyProgrammed` aufrufen. Eine innere Spanne zählt dann nur als innere (`path_programmed` mit `nested`). Die Auswertung addiert keine verschachtelten Spannen als eigene CPU-Zeit.
- **Rendern:** Das GPU-Hochladen neu gebauter Geometrie fällt in den nächsten Render. Der vorhandene Renderwert (`render_*`) läuft deshalb mit.
- **Warum eigene Spannen:** Firefox hat keine Long-Tasks-API. Der vorhandene Hauptthread-Fühler (8 ms Takt) zählt Verzögerungen, ordnet sie aber nicht zu.
- **Auswertung:** `bpc2.py report` nennt je Phase die Spannen (Summe, Maximum) neben `mt_late` und dem Statusalter.
- **Messlauf ohne Eingabe:** Der Treiber bekommt `--to S`. Er läuft dann Vorbereitung, A und S einschließlich S_settle und endet vor R, also ohne `cycle_start`. `--from S` allein führt danach R aus (R190). Gemessen wird mit der Seite des Operators: offen, sichtbar, entwaffnet, Mac wach. Der Operator muss dabei nichts tun.
- **Ergebnis:** eine Tabelle Spanne × Phase; daraus folgt, welche der Maßnahmen in 3 und 4 nötig sind.
- **Wächter:**
  - `viewerPerf.test`: Sammeln, Leeren je Fenster, feste Namen, Verschachtelung.
  - `collisions.viewer.spec`: Ein tatsächlich ausgeführter Prüfungsstart erscheint als `span_col_copy` und `span_col_post` in der Perf-Zeile, also ein echter Aufrufpfad und nicht nur der Sammler.
  - Werkzeugtest: der Bericht.

## 3 · Verhaltensänderung · zur Entscheidung des Operators

**Nur wenn N1 das Ziel nicht erreicht** (Abschnitt 6, Messung nach N1). Reicht N1, wird E1 nicht gebaut; der Operator wird dann nicht um eine Verhaltensänderung gebeten.

**E1 · Die Kollisionsprüfung wartet auf die neue Vorschau.**

*Besitzer des Wartens (VP190-01):* ein **Wunsch** `W` aus
- dem vollständigen Pfad der geladenen Datei (die veröffentlichte Revision `<file>#<version>`, nicht der Basename aus `preview_refresh`),
- der angezeigten Version (`viewerGcode.publishedVersion`),
- dem Versatzschlüssel der Maschine, der die Vorschau veraltet macht (die Versatzzeilen und G92, wie der Vergleich hinter `previewWcsStale` sie liest),
- einer lokalen Änderungsnummer,
- der Verbindungsepoche.

Eine neue Versatzänderung ersetzt `W` (neue Nummer). Alte Fristen und Antworten prüfen ihre Nummer und geben nichts frei.

*Zustände und Übergänge:*

| Zustand | betreten bei | verlassen bei |
|---|---|---|
| — | | |
| `wait_start` | Versatzänderung macht die Vorschau der geladenen Datei veraltet, Maschine im Leerlauf, kein Lauf; Frist 6 s ab dieser Änderung | `preview_refresh` dieser Datei → `parsing`; Frist ohne Beginn → `fallback` |
| `parsing` | `preview_refresh` dieser Datei (mit `job`) | `preview_refresh` fehlt → `after_parse`; Veröffentlichung kommt → `loading` |
| `after_parse` | der Parse ist aus dem Status verschwunden; Frist 6 s ab da | neuer `preview_refresh` (eine Ersetzung) → `parsing`; `viewer_gcode_ready` dieser Datei mit neuerer Version → `loading`; Frist ohne beides → `fallback` |
| `loading` | `viewer_gcode_ready` dieser Datei mit neuerer Version `v` (Ankunft, vor Abruf und Dekodierung) | `viewerGcode` mit `publishedVersion = v` übernommen → **frei** (der übliche Weg der neuen Vorschau prüft sie); Lade- oder Dekodierfehler (`previewLoadError`) → `fallback`; neuere Ankunft → `loading` mit ihr |
| `fallback` | eine der Fristen oder ein Ladefehler | **einmal je Wunsch:** die Prüfung läuft auf der angezeigten Vorschau, ausdrücklich als „auf der bisherigen Vorschau (Versätze seither geändert)“; spätere Statusbilder desselben Wunsches sperren nicht erneut; eine später passende Vorschau ersetzt das Ergebnis wie üblich |

- Eine kurze Ersetzungslücke (Abbruch und Neustart des Parses) ist kein Fehler. `after_parse` wartet dafür seine Frist.
- Die Frist von 6 s ist eine begrenzte, optimistische Wartezeit (R190 Antwort 2). Sie beweist weder einen Beginn noch einen Fehler. Sie beginnt bei der Versatzänderung bzw. beim Verschwinden des Parses und wird mit dem Wunsch ersetzt.
- Die vorhandene Sperre der Werkzeugbasis (`previewBasisPending`) bleibt wirksam.

*Beenden oder Ersetzen aus jedem Zustand:*
- Datei gewechselt oder entladen (die Revision nennt eine andere Datei) → kein Warten mehr.
- Verbindung verloren (neue Epoche) → kein Warten; nach dem Wiederverbinden gilt das übliche Verhalten.
- Rückkehr zur Versatzbasis der angezeigten Vorschau (`previewWcsStale` falsch) → kein Warten, die Prüfung startet wie heute.
- Lauf beginnt → kein Warten; Prüfungen im Lauf haben ihre eigene Zulassung.
- Ein neuer Wunsch ersetzt den alten.

*Alle Startwege:* Eine Funktion entscheidet für jeden Start einer Prüfung im Leerlauf, ob ein Wunsch wartet:
- `_colScheduleAuto`;
- `runEntryCheck` beim Eintritt in die Simulation (es kann ohne Basisergebnis direkt `runCollisionCheck(base)` und danach die Seitenprüfung starten);
- das Fortsetzen nach Rotationsruhe.

Ein wartender Start wird vermerkt und bei **frei** oder **fallback** ausgeführt. Ein Simulationseintritt während des Wartens sagt im Sim-Tab „Prüfung wartet auf die neue Vorschau“. Die Wiederholung einer schon zugelassenen Anfrage (`needBodies`) ist kein neuer Start. Prüfungen im Lauf bleiben unberührt.

*Anzeige:* Der Sim-Tab sagt „Prüfung wartet auf die neue Vorschau“; Pfad und Leiste bleiben als veraltet markiert, wie heute.

**E2 · Der Pfad folgt dem neuen Versatz erst mit der neuen Vorschau.** Nur bei einem entsprechenden Kostenbefund aus Schritt 0 und nach eigener Entscheidung des Operators.
- **Begrenzung (R190):** E2 gilt nur für die gebackene Darstellung mit eigenem Anker: Teil-Modus und programmierter Pfad mit mehreren Epochen (`pathAnchor`). Ein programmierter Pfad einer Epoche hängt am live bewegten Ursprung; ihn friert das Auslassen von `applyGcode` nicht ein, er folgt weiter.
- **Laufende Antworten:** Eine bereits laufende Part-Frame-Antwort verschiebt den gehaltenen Stand nicht nachträglich; sie wird verworfen, solange der Stand gehalten wird.
- **Abwägung für den Operator:** Bei 600 000 Zeilen zeigt der Pfad 7–16 s lang den alten Ort, sichtbar als veraltet. Die Werkstück-Markierung folgt sofort.

**Empfehlung:** Erst N1 messen. Reicht es nicht: E1 ja. E2 nur bei Kostenbefund.

## 4 · Verhaltensneutrale Korrekturen (ohne Entscheidung)

- **N1 · Kein doppelter Klon** (zuerst gebaut, nach Schritt 0):
  - **Übertragen:** `_colBuildRequest` überträgt jede Spalte, die es eigens kopiert, und **nur** diese. Die Originale liest der Viewer bzw. die ScrubBar weiter, sie werden nie übertragen.
  - **Wächter:**
    - Die Transferliste enthält genau die eigenen Kopien, ohne doppelte Buffer, denn ein doppelter Eintrag wirft `DataCloneError`.
    - Optionale Spalten fehlen in Liste und Anfrage gleich.
    - Die Originale bleiben nach dem Senden lesbar.
    - Der Empfänger bekommt dieselben Werte (`collisions.viewer.spec`, ein Unit-Test über die Anfrage).
- **N2 · Einfahrbahn entprellt** (getrennt; erklärt den S-Befund nicht, die Simulation war dort nie betreten):
  - Die Einfahrbahn bleibt nach dem Verlassen der Simulation die benutzte Bahn (`track = entryTrack ?? baseTrack`). Außerhalb der Simulation wird ihr Neuaufbau auf eine Versatzänderung entprellt.
  - **Der letzte Wunsch gewinnt.**
  - Alte Entry-Befunde werden **sofort** ungültig.
  - Ein neues Programm oder ein Lauf verwirft ausstehende Arbeit.
  - Ein erneuter Simulationseintritt löst sie mit dem aktuellen Stand auf.
  - Die vorhandene 500-ms-Regel in der Simulation verzögert die **Prüfung**, nicht den Bahnaufbau; das bleibt so.
  - **Wächter:** acht Versatzänderungen ergeben einen Aufbau mit dem letzten Stand; Befunde sind sofort ungültig; Programmwechsel verwirft; Sim-Eintritt löst auf.
- **N3:** Falls Schritt 0 eine weitere Spanne zeigt (`pf_load`, `col_cancel`), wird sie hier ergänzt, sofern sie nichts Sichtbares ändert.

## 5 · Tests, Gates, Review

- **Unit:** Schritt 0, N1, N2; falls gebaut: die Zustände von E1 (jede Zeile der Tabelle, Ersetzen des Wunsches, alte Fristen geben nichts frei) und E2.
- **Browser** (`collisions.viewer.spec`, `sim-panel.viewer.spec`), über den Mock, falls E1 gebaut:
  - Versatzänderung, dann `preview_refresh`, dann Veröffentlichung: genau eine Prüfung, auf der neuen Vorschau.
  - **Verzögerte Übernahme nach der Veröffentlichung:** Der Refresh ist weg, die Dekodierung läuft noch, und es startet keine Prüfung auf der alten Vorschau.
  - **Mehrfaches Ersetzen mit Zwischenlücke:** keine Prüfung in der Lücke.
  - Versatzänderung ohne `preview_refresh`: nach 6 s **eine** Prüfung auf der bisherigen Vorschau, benannt, und **nur einmal** für diesen Wunsch.
  - Ein Lade- bzw. Dekodierfehler führt zum Rückfall.
  - Datei- und Verbindungswechsel beenden das Warten.
  - Simulationseintritt während des Wartens: Die Seitenprüfung wartet mit, und der Sim-Tab sagt es.
  - Die Anzeige sagt jeweils, worauf die Prüfung wartet.
- **Mutationen:** jede Wartebedingung, der Rückfall, die Übertragungsliste, die Entprellung.
- **Gates:** Frontend (Lint, Build, Unit, Browser), Backend unverändert (kein Gateway-Code).
- **Codex-Runden:** dieser Plan, dann die Umsetzung.

## 6 · Messungen

1. **Nach Schritt 0:** ein Lauf `--to S` ohne Eingabe. Daraus entsteht die Zuordnung der Kosten.
2. **Nach N1:** derselbe Lauf. Ist das Statusalter in S_supersede p95 < 50 ms, folgt die Abnahmemessung (3) ohne E1. Sonst Entscheidung des Operators über E1, Bau, dann wieder dieser Lauf.
3. **Abnahme:** derselbe S-Fall vollständig mit A, S und R, die Seite des Operators.
   - **Eingabe in S:** Der Treiber schickt zu Beginn von S_supersede eine eigene Meldung „Taste halten“ und zu Beginn von S_settle „loslassen“.
   - **Beleg:** Die Eingabe in S belegen die erfassten Ereignisse (`in_n` in den Zeilen von S_supersede), nicht eine feste Haltedauer ab A.
   - **Ziel:** Statusalter p95 < 50 ms in S_supersede, keine Verschlechterung in den anderen Phasen, S met, R proven. Das Ziel aus R189 bleibt unverändert.
   - **Bericht:** neben den Urteilen die Spannen aus Schritt 0, vorher und nachher.

## 7 · Nicht in diesem Plan

- Die Abnahme auf dem echten Maschinen-PC und der Live-Lauf mit M600 bleiben eigene Punkte.
- Ein G54/G55-Wechsel ohne Versatzänderung löst keinen Neu-Parse aus (keine Drift-Kante liest den aktiven Index). Das ist hier nur benannt und bleibt eigener Punkt, falls der Operator es will.

## 8 · Antworten auf R190

| Punkt | Antwort | Änderung |
|---|---|---|
| Frage 1 · Grundform, N1 zuerst | Angenommen. | Abschnitte 3, 4, 6: Schritt 0, dann N1, dann messen; E1 nur, wenn N1 nicht reicht; N2 getrennt. |
| Frage 2 · 6 s | Angenommen als begrenzte optimistische Frist, ohne neues Gateway-Signal. | Abschnitt 3: die Frist mit Beginn und Ersatz benannt; sie beweist weder Beginn noch Fehler. |
| VP190-01 · Zustandsvertrag | Angenommen. | Abschnitt 3: Besitzer `W` (voller Pfad, angezeigte Version, Versatzschlüssel, Änderungsnummer, Verbindungsepoche); getrennte Zustände `wait_start`, `parsing`, `after_parse`, `loading`, `fallback`; Freigabe erst mit der übernommenen Vorschau; einmaliger Rückfall je Wunsch, benannt; Ende bei Datei-, Verbindungs-, Basis- und Laufwechsel; alle Startwege einschließlich `runEntryCheck`. Abschnitt 5: die verlangten Browserwächter. |
| Schritt 0 | Angenommen. | Feste Namen, `finally`, Verschachtelung nicht addiert, `col_copy` / `col_post` getrennt, Renderwert mitgeführt, Wächter über einen echten Aufrufpfad. |
| N1 | Angenommen. | Nur eigene Kopien, Originale lesbar, gleiche Empfängerwerte, optionale Spalten, keine doppelten Buffer. |
| N2 | Angenommen. | Letzter Wunsch gewinnt, Befunde sofort ungültig, Verwerfen bei Programm/Lauf, Auflösen beim Sim-Eintritt; die 500-ms-Regel betrifft die Prüfung. |
| E2 | Angenommen. | Nur gebackene Darstellung mit eigenem Anker; laufende Antworten verschieben nichts; eigene Operator-Entscheidung. |
| Messablauf | Angenommen. | `--to S` endet vor R; Eingabe in S über Ereignisse belegt, eigene Meldungen zu Beginn und Ende von S. |
