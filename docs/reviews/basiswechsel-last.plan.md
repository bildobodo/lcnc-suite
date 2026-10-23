# VP188-02 — Statusalter bei wiederholten Versatzwechseln (Plan)

**Fassung 4 · 24. Oktober 2026 · Zweig `feat/vp188-basiswechsel` (Schritt 0 und N1 gebaut, R192 Agreement, gemergt `a8486ee9`) · Merge nach `development` über den Integrationszweig, nie `main`.**

Bisheriger Verlauf:
- R191 hat aus Fassung 2 Schritt 0 und N1 freigegeben. Die Reste A–C des Zustandsvertrags blieben dabei für E1 offen.
- Schritt 0 und N1 sind gebaut (R192 Agreement).
- Der Diagnoselauf danach zeigt: Das Ziel ist weiter verfehlt, und die Hauptlast ist der Neuaufbau des gezeichneten Pfads (Abschnitt 1).
- Der Operator wählte am 23. Oktober „Pfad wartet“: E2 in enger Form.
- R193 nahm den Wegfall von E1 und die Richtung von E2 an. Mit VP193-01 verlangte es einen eigenen Vertrag für den **tatsächlich gezeichneten** Pfad.

Fassung 4:
- **Abschnitt 3** trennt Halten (3a), übernommene Vorschau und angewandten Pfadstand (3b). Er nimmt die Konkretisierungen aus R193 auf:
  - Geltungsbereich am vorhandenen Kriterium;
  - Zulassung bei jedem `preview_refresh`;
  - Zeitgeber verbraucht;
  - die erste Rückmeldung als erwarteter Ablauf, nicht als Zusage.
- **Abschnitt 5** hat neue Wächter.
- **Abschnitt 10** enthält die Antworten auf R193.

## 1 · Ausgangslage

**Befund (Codex R188 VP188-02, R189):** Beide Browser-PC-Läufe vom 23. Oktober verfehlen das Ziel „Statusalter p95 < 50 ms“ nur in der Phase S_supersede.
- **Werte:** p95 58 / 68 ms, p99 96 / 110 ms, Maximum 132 / 177 ms.
- **Phase:** acht Wechsel des G54-Z-Versatzes in 30 s, mit `bpc_parse.ngc` geladen (600 000 Zeilen, 600 003 Punkte).
- **Alle anderen Phasen:** p95 36 ms.

Das Ziel wird nicht gelockert.

**Was die Seite je Versatzwechsel tut** (Bestandsaufnahme aus Fassung 1):
1. **Sofort:** Die Prüfung wird abgebrochen, die Werkstück-Markierung gesetzt.
2. **Nach 300 ms:** Der Pfad wird neu gebacken (`_pfScheduleWcsRefresh` → `applyGcode`). Im Teil-Modus rechnet der Part-Frame-Worker; seine Antwort führt `toolpath.apply` auf dem Hauptthread aus, das GPU-Hochladen folgt beim nächsten Render.
3. **Nach 400 ms:** Die Prüfung startet neu.
4. **Nach 2–4 s:** Der Gateway parst neu. Seine Veröffentlichung ersetzt die Arbeit aus 2 und 3.

**Diagnoselauf nach Schritt 0 und N1** (`drive2.py --to S --no-keys`, 23. Oktober 23:05–23:11, die Seite des Operators, ohne Eingabe; Stand `a8486ee9`):

| Phase | Alter p95 / p99 / max (ms) | Ziel |
|---|---|---|
| A_rest, A_input, S_load, S_settle | 36 / 38 / 43–142 | met |
| S_supersede | **60 / 110 / 163** | **not met** |

- **S met:** acht Wechsel, sieben ersetzt und abgebrochen, der letzte mit seiner Basis veröffentlicht; nie zwei Parse-Prozesse zugleich.
- **Kein Tastendruck** in einer Phase (`presses` 0). Der Lauf ist **keine** Eingabe-Abnahme.

**Hauptthread in S_supersede** (Spannen aus Schritt 0, 50,7 s):

| Spanne | Anzahl | Summe (ms) | Maximum (ms) |
|---|---|---|---|
| `path_reply` (Part-Frame-Antwort + `toolpath.apply`) | 8 | **584** | **113** |
| `col_copy` (Aufbau der Prüfanfrage) | 8 | 38 | 20 |
| `col_cancel` | 16 | 2 | 1 |
| `col_post`, `pf_load` | 8, 8 | 0, 0 | 0, 0 |

- Daneben `render_max` 86 ms und `mt_late_max` 164 ms. `render_max` ist die ganze gemessene Render-Spanne, kein eigens gemessenes GPU-Hochladen (R193).
- **Lesart:** Die Spannen erklären den Hauptteil, nicht alles. `path_reply` und der folgende Render sind die dominante Last. Die Prüfung kostet den Hauptthread etwa 5 ms je Wechsel.
  - **Folge für E1:** E1 (die Prüfung wartet) adressiert die gemessene Hauptlast nicht.
  - **Folge für E2:** Sieben der acht Neuaufbauten ersetzt die Veröffentlichung ohnehin.
- **Vergleich zu R188:** Das Alter in S_supersede ist ähnlich (58/68 vorher, 60 jetzt). Ein isolierter Gewinn von N1 ist damit nicht belegt (R192: kein Vorher-Lauf).

## 2 · Schritt 0 · gebaut (R192)

Wie in Fassung 2. Gebaut und angenommen:
- die sieben Spannen mit `finally`, Verschachtelung apart;
- die Auswertung `main_thread` je Phase;
- `drive2.py --to S` und neu `--no-keys`: keine Tastenaufforderung, eine Meldung „Messlauf ohne Eingabe“, `setup.json.keys_requested`; der Bericht zählt `presses` je Phase.

## 3 · Verhaltensänderung · E2 in enger Form (Operator-Entscheidung)

**E1 entfällt.**
- E1 adressiert die gemessene Hauptlast nicht (R193: so formuliert statt „erreicht das Ziel nicht“; ein Gegenversuch wurde nicht gemacht).
- Bleibt das Ziel nach E2 verfehlt, kommt E1 nicht ohne eine neue Messung zurück, die es begründet.

**E2 eng.** Der Pfad wird nicht neu gebacken, solange ein Neu-Parse der geladenen Datei unterwegs ist. Er bleibt gedämpft, bis der **passende Pfad tatsächlich gezeichnet** ist (VP193-01).

Drei getrennte Dinge (VP193-01):
1. das **Halten** (3a) — wann eine Neuback-Anforderung zurückgestellt wird;
2. die **übernommene Vorschau** (`viewerGcode`, wie heute);
3. der **angewandte Pfadstand** (3b) — wofür die gezeichnete Geometrie tatsächlich gebacken wurde. Er allein entscheidet, ob der gezeichnete Pfad aktuell ist.

### 3a · Das Halten

**Geltungsbereich: das vorhandene Kriterium.** Eine Funktion `_bakeFollowsOffsets(g)` fasst die Bedingung zusammen, die `_pfScheduleWcsRefresh` heute anwendet:
- Teil-Modus;
- oder ein programmierter Pfad, dessen Neuverankerung von der Identität abweichen kann:
  - mehr als eine Epoche,
  - eine vom Programm umgeschriebene Epoche 0,
  - eine Epoche-0-Zuordnung, die nicht die aktive ist.

R193 zeigte 0/1/1 Zeitgeber für den ausgenommenen Fall, die umgeschriebene Epoche und die andere aktive Zuordnung. Nur dieser Bereich wird gehalten und bekommt den Pfadstand aus 3b. Die Reichweitenhülle (`_reachSchedule`) bleibt ungehalten.

**Regel:**
- Eine Neuback-Anforderung über `_pfScheduleWcsRefresh` startet wie heute einen 300-ms-Zeitgeber. Das betrifft G5x, G92, XY-Rotation, die Versatztabelle und den Werkzeugversatz ohne Werkzeugbasis.
- Beim Ablauf entscheidet der Haltezustand:
  - `frei` → `applyGcode` wie heute.
  - sonst wird **nicht** gebacken, und der Wechsel ist vermerkt.
- **Erwarteter Ablauf im S-Fall** (keine allgemeine Zusage, R193): Der erste Wechsel backt nach 300 ms. `preview_refresh` erscheint erst 2–4 s nach dem Wechsel. Kommt ein Parse-Signal vor Ablauf der 300 ms, wird auch der erste Wechsel gehalten.
- Die Werkstück-Markierung folgt immer sofort; sie ist davon getrennt.

**Besitzer `H`:**
- die angezeigte Revision `<voller Pfad>#<publishedVersion>` von `viewerGcode`,
- die Verbindungsepoche,
- eine lokale Nummer.

`preview_refresh` trägt nur den Basisnamen; er muss zum Basisnamen der angezeigten Datei passen. Entschieden wird über die volle Revision der Veröffentlichung.

**Ein Halten beginnt nur unter Zulassung.** Geprüft wird **bei jedem** `preview_refresh`, nicht nur bei einer Eintrittskante:
- verbunden;
- Maschine ohne Lauf (kein AUTO-Lauf, Interpreter im Leerlauf);
- keine Simulation;
- angezeigte Datei;
- Pfad im Geltungsbereich.

Ohne Zulassung bleibt der Zustand `frei`. Ein `preview_refresh` bei bereits laufender Maschine oder aktiver Simulation hält also nichts.

**Zustände und Übergänge:**

| Zustand | betreten bei | Zeitgeber läuft dort ab | verlassen bei |
|---|---|---|---|
| `frei` | Anfang; Ende jedes Haltens | backt wie heute | zugelassener `preview_refresh` → `parsing` |
| `parsing` | `preview_refresh` (mit `job`) | gehalten, vermerkt | `preview_refresh` fehlt → `after_parse`; Ankunft `viewer_gcode_ready` dieser Datei mit neuerer Version `v` → `loading` |
| `after_parse` | der Parse fehlt im Status (Ersetzungslücke, im Lauf 37 ms zwischen `off` von Job 41 und `on` von Job 42); Frist 6 s | gehalten | zugelassener `preview_refresh` → `parsing`; Ankunft mit `v` → `loading`; Frist → **Ende mit Nachbacken** |
| `loading` | Ankunft mit Version `v` (vor Abruf und Dekodierung); Frist 20 s | gehalten | Übernahme (`viewerGcode` mit `publishedVersion = v`, dieselbe Datei) → `frei`; Fehler **dieser** Dekodierung (`previewDecodeFailure` mit `v`) → **Ende mit Nachbacken**; neuere Ankunft → `loading` mit ihr; Frist → **Ende mit Nachbacken** |

- **Übernahme:** Die Übernahme ruft wie heute `applyGcode` mit den Live-Versätzen auf. `loading → frei` lässt damit nur weitere Anforderungen zu; es heißt **nicht**, dass der Pfad aktuell ist (VP193-01). Das entscheidet 3b.
- **Ende mit Nachbacken:** Endet das Halten ohne Übernahme und wurde ein Wechsel vermerkt, wird **einmal** sofort `applyGcode` auf der angezeigten Vorschau aufgerufen.
  - Gilt bei Fristablauf, beim eigenen Dekodierfehler, bei Verbindungsverlust, Laufbeginn und Simulationseintritt.
  - Kein Wechsel geht verloren, auch wenn ein späteres Statusbild dieselben Werte zeigt und `_numArrChanged` nichts mehr meldet.
  - Ein Dateiwechsel endet ohne Nachbacken; die neue Datei bringt ihre Übernahme.
  - Ein Nachbacken ist eine **Anforderung**. Erst seine Anwendung macht den Pfad aktuell (3b). Ein erfolgloser Aufbau beweist nichts.
- **Zeitgeber:** Übernahme und Nachbacken verbrauchen einen ausstehenden 300-ms-Zeitgeber (gelöscht). Er wiederholt danach nicht denselben Aufbau.
- **Laufende Part-Frame-Antwort** (R193 Frage 2 angenommen):
  - Eine vor dem Halten angeforderte Antwort wird mit **ihrem eigenen Anker** angewandt, wie heute (`_pfAnchorFor`). Die vorhandenen Prüfungen auf überholte Anfragen und Darstellungswechsel bleiben.
  - Ihre Anwendung erledigt keinen später vermerkten Wechsel und löscht nicht die Dämpfung aus 3b.

### 3b · Der angewandte Pfadstand (VP193-01)

**Der Bauschlüssel.** Jede Bake-Anforderung bekommt einen Schlüssel aus genau dem, womit sie backt:
- die Revision `<voller Pfad>#<publishedVersion>`;
- die Darstellung (Teil bzw. programmiert);
- `_pfWcs()`: G5x, G92, Rotation, der Werkzeugversatz vor der ersten Zeile;
- bei epochenbewussten Payloads die Versatztabelle `_pv.wcsTable`.

**Was der Schlüssel bewirkt:**
- Die Part-Frame-Anfrage trägt ihn (neben `id` und Anker). Die angewandte Antwort setzt `drawnKey` auf **ihren** Schlüssel.
- `_applyProgrammed` setzt `drawnKey` beim Anwenden.
- Ein Fehlerweg setzt `drawnKey` nur dort, wo ein Pfad tatsächlich angewandt wird. Das ist der Rückfall des Part-Frame-Workers auf `_applyProgrammed`.

**Was zu zeichnen ist.** `wantKey` ist derselbe Schlüssel aus der übernommenen Vorschau und den **Live**-Werten. Er wird mit derselben Funktion gebildet und bei jeder Änderung dieser Quellen erneuert. Das geschieht dort, wo `applyState` `_pv` setzt (G5x, G92, Rotation, Tabelle, Werkzeugversatz), bei der Übernahme und beim Wechsel der Darstellung. `_pv` selbst ist nicht reaktiv; der Schlüssel wird deshalb als eigener reaktiver Wert geführt.

**Gedämpft wird** zusätzlich, solange `_bakeFollowsOffsets(viewerGcode) && drawnKey !== wantKey`. Neu heißt der Ausdruck damit:

`pathStaleNow = previewRefresh || previewWcsStale || previewTloStale || previewTableStale || pathBehind`

- Die vorhandenen Gründe einer veralteten **Parse**-Basis bleiben daneben: Neu-Verankern ersetzt kein Neu-Parsen parameterabhängiger Programmlogik (R193).
- `pathBehind` verschwindet erst, wenn ein Pfad mit dem **aktuellen** `wantKey` angewandt ist.
  - Eine ältere, zulässige Antwort darf gezeichnet werden, erledigt aber den neueren Wunsch nicht.
  - Ändern sich die Live-Werte danach, ändert sich `wantKey`, und die Dämpfung kehrt zurück, bis der passende Aufbau angewandt ist.

**Die beiden Fälle aus R193:**
1. **A→B→A:**
   - Die Vorschau wurde mit A geparst, der erste Wechsel auf B gebacken, also `drawnKey` mit B.
   - Der Wechsel zurück auf A wird gehalten. Damit ist `wantKey` A, `drawnKey` B, und `pathBehind` dämpft, auch wenn `preview_refresh` fehlt und `previewWcsStale` falsch ist.
   - Erst die Übernahme bzw. das Nachbacken mit A beendet es, und zwar mit der **Anwendung**.
2. **Übernahme ohne Antwort:**
   - Nach `viewerGcode = v11` ist `wantKey` v11, `drawnKey` noch v10. Der Pfad bleibt gedämpft, bis die Part-Frame-Antwort für v11 angewandt ist.

**Diagnose:** `__viewerDiag.getPathBasis()` liefert `{drawn, want, behind, hold}` für die Wächter.

### 3c · Die Reste aus R191, auf E2 übertragen

- **A:**
  - Die Übernahme backt mit den Live-Versätzen.
  - Aktuell ist der Pfad erst mit der Anwendung, deren Schlüssel `wantKey` ist (3b).
  - Eine abweichende Parse-Basis bleibt über `previewWcsStale` gedämpft, und ihr Neu-Parse beginnt ein neues Halten.
- **B:** Gezählt wird nur der Fehler der Dekodierung der Version `v`.
  - Das ist die Fehlerantwort des Preview-Workers bzw. sein `onerror`, während `v` aussteht.
  - Er wird als eigenes Signal ausgegeben (`previewDecodeFailure {file, version}`), nie über das gemischte `previewLoadError`.
  - Ein Fehler einer anderen Datei oder Version tut nichts.
- **C:** `loading` endet spätestens nach 20 s mit Nachbacken.
  - Das ist eine gewählte endliche Wartefrist, kein Fehlerbeweis.
  - Die rund 0,8 s im Lauf (vom Parse-Ende bis zur Prüfung auf der übernommenen Vorschau) sind keine Dekodiermessung.
  - Eine spätere echte Übernahme läuft weiter normal. Alte Fristen (andere Nummer) tun nichts.

### 3d · Anzeige, Prüfung, Abwägung

- **Anzeige:**
  - Der Pfad ist gedämpft nach `pathStaleNow` (3b).
  - Die HUD-Zeile „Preview re-parsing“ bleibt, wie sie ist. Ihr „?“ sagt schon, dass Pfad, Limit-Marken und Simulation mit der neuen Vorschau kommen.
  - Für `pathBehind` ohne laufenden Parse kommt keine eigene Zeile. Die Dämpfung ist das Zeichen, wie bei den anderen Stale-Gründen.
- **Kollisionsprüfung:** unverändert. Sie liest die Prüfung, nicht den gezeichneten Pfad.
- **Abwägung (vom Operator gewählt):**
  - Bei 600 000 Zeilen bleibt der Pfad nach einem gehaltenen Wechsel bis zur neuen Vorschau am alten Ort, 7–16 s, gedämpft.
  - Kleine Programme parsen in unter einer Sekunde.
- **Erwartung im S-Fall:** zwei Neuaufbauten statt neun. Ob das das Ziel erreicht, zeigt erst die Messung.

## 4 · Verhaltensneutrale Korrekturen

- **N1:** gebaut (R192).
- **N2 · Einfahrbahn entprellt:** unverändert getrennt, nicht Teil dieses Schritts.
- **N3:**
  - Den Pfadaufbau in Schritte zu teilen hat der Operator nicht gewählt.
  - Der folgende Render bliebe dabei; `render_max` war 86 ms.

## 5 · Tests, Gates, Review

- **Unit** (`viewer/bakeHold.ts` und `viewer/pathBasis.ts`, rein):
  - jede Zeile der Tabelle;
  - die Zulassung bei jedem `preview_refresh` (Lauf, Simulation, keine Verbindung schon vorher);
  - jede Endbedingung mit und ohne vermerkten Wechsel;
  - einmaliges Nachbacken;
  - die beiden Fristen und ihre Nummer (alte Fristen tun nichts);
  - die Bindung an volle Revision und Epoche;
  - ein Dekodierfehler einer anderen Datei oder Version beendet nichts;
  - der Bauschlüssel: gleiche Eingaben gleicher Schlüssel, jede Eingabe ändert ihn;
  - `pathBehind` nur im Geltungsbereich, und für den ausgenommenen Fall, die umgeschriebene Epoche und die andere aktive Zuordnung wie `_bakeFollowsOffsets`.
- **Browser** (über den Mock; gezählt über `__viewerDiag.getPathMemory().generation` und `span_path_reply`):
  1. Versatzwechsel ohne Parse: genau ein Neuaufbau.
  2. Erster Wechsel, dann `preview_refresh`, dann weitere Wechsel mit und ohne Lücke: kein weiterer Neuaufbau. Veröffentlichung, Übernahme: genau ein Neuaufbau, an den Live-Versätzen.
  3. `preview_refresh` verschwindet ohne Veröffentlichung: nach 6 s genau ein Nachbacken, und nur, wenn ein Wechsel gehalten war.
  4. Ankunft ohne Übernahme: Ein Fehler dieser Dekodierung backt nach. Ein Fehler der Oberflächenpunkte tut es nicht. Nach 20 s backt die Frist nach.
  5. Verbindungsverlust, Laufbeginn und Simulationseintritt im Halten backen nach. Ein Dateiwechsel backt nicht nach. Ein `preview_refresh` bei schon laufender Maschine oder schon aktiver Simulation hält nichts.
  6. Eine vor dem Halten angeforderte Part-Frame-Antwort wird angewandt, mit ihrem eigenen Anker.
  7. Der programmierte Pfad im ausgenommenen Fall folgt weiter; die umgeschriebene Epoche wird gehalten.
  8. Ein ausstehender 300-ms-Zeitgeber backt nach Übernahme oder Nachbacken nicht noch einmal.
- **Browser, VP193-01** (die Dämpfung über `toolpath`s Stale-Zustand und `__viewerDiag.getPathBasis()`):
  1. **A→B→A mit Ersetzungslücke:** gedämpft, solange `drawn` B ist, auch ohne `preview_refresh` und bei `previewWcsStale` falsch. Erst die Anwendung mit A beendet es.
  2. **Dasselbe mit Ladephase:** die Ankunft, dann eine verzögerte Dekodierung.
  3. **Übernahme ohne Antwort:** Die Part-Frame-Antwort wird zurückgehalten. Gedämpft bis zur Antwort für die neue Version an den Live-Werten.
  4. **Eine vor dem Halten angeforderte Antwort nach einem weiteren vermerkten Wechsel:** wird gezeichnet, die Dämpfung bleibt bis zum passenden Aufbau.
  5. **Ein gescheiterter Aufbau:** Der Worker fällt aus, der Rückfall auf den programmierten Pfad wird angewandt. Er setzt `drawn`, und die Dämpfung folgt seinem Schlüssel.
- **Mutationen:** jede Haltebedingung, die Zulassung, das Nachbacken, die Fristen, die Fehlerquelle, die Bindung, jeder Bestandteil des Bauschlüssels, `pathBehind` in `pathStaleNow`, das Setzen von `drawnKey` nur bei Anwendung.
- **Gates:** Frontend (Lint, Build, Unit, Browser); Backend unverändert, kein Gateway-Code.
- **Codex-Runden:** diese Fassung, dann die Umsetzung.

## 6 · Messungen

1. **Nach E2:** derselbe Diagnoselauf `--to S --no-keys`, gegen 60 ms aus Abschnitt 1. Der Bericht nennt die Spannen vorher und nachher und die Zahl der Neuaufbauten.
2. **Abnahme:** A, S und R vollständig, die Seite des Operators.
   - **Eingabe:** mit Tasten. Die Aufforderungen zu Beginn von S_supersede und S_settle sind schon gebaut. Die Eingabe belegen die Ereignisse (`presses`, `in_n`).
   - **Ziel:** Statusalter p95 < 50 ms in S_supersede, keine Verschlechterung anderswo, S met, R proven.
   - **Wenn das Ziel nach E2 verfehlt bleibt:** zurück zum Operator, mit der neuen Spannentabelle.

## 7 · Nicht in diesem Plan

- Die Abnahme auf dem echten Maschinen-PC und der Live-Lauf mit M600 bleiben eigene Punkte.
- Ein G54/G55-Wechsel ohne Versatzänderung löst keinen Neu-Parse aus. Das bleibt benannt.
- N2 bleibt getrennt.

## 8 · Antworten auf R190

| Punkt | Antwort | Änderung |
|---|---|---|
| Frage 1 · Grundform, N1 zuerst | Angenommen. | Abschnitte 3, 4, 6: Schritt 0, dann N1, dann messen; E1 nur, wenn N1 nicht reicht; N2 getrennt. |
| Frage 2 · 6 s | Angenommen als begrenzte optimistische Frist, ohne neues Gateway-Signal. | Abschnitt 3: die Frist mit Beginn und Ersatz benannt; sie beweist weder Beginn noch Fehler. |
| VP190-01 · Zustandsvertrag | Angenommen. | Abschnitt 3 (Fassung 2): Besitzer `W`, getrennte Zustände, Freigabe mit der übernommenen Vorschau, einmaliger Rückfall, Ende bei Datei-, Verbindungs-, Basis- und Laufwechsel, alle Startwege. |
| Schritt 0 | Angenommen. | Feste Namen, `finally`, Verschachtelung nicht addiert, `col_copy` / `col_post` getrennt, Renderwert mitgeführt, Wächter über einen echten Aufrufpfad. |
| N1 | Angenommen. | Nur eigene Kopien, Originale lesbar, gleiche Empfängerwerte, optionale Spalten, keine doppelten Buffer. |
| N2 | Angenommen. | Letzter Wunsch gewinnt, Befunde sofort ungültig, Verwerfen bei Programm/Lauf, Auflösen beim Sim-Eintritt. |
| E2 | Angenommen. | Nur gebackene Darstellung mit eigenem Anker; laufende Antworten verschieben nichts; eigene Operator-Entscheidung. |
| Messablauf | Angenommen. | `--to S` endet vor R; Eingabe in S über Ereignisse belegt. |

## 9 · Antworten auf R191 und R192 (Fassung 3)

| Punkt | Antwort | Änderung |
|---|---|---|
| R191 · VP190-01 Reste A–C (nur für E1) | E1 entfällt; die Reste gelten sinngemäß für E2. | Abschnitt 3: A durch Backen mit Live-Versätzen bei der Übernahme; B über ein eigenes Signal `previewDecodeFailure` statt `previewLoadError`; C als Frist 20 s für `loading`. |
| R192 · Ablaufhinweis ohne Eingabe | Angenommen. | `--no-keys`: keine Tastenaufforderung, eine Meldung „Messlauf ohne Eingabe“, `setup.json.keys_requested`, `presses` je Phase im Bericht. Der Diagnoselauf ist ausdrücklich keine Eingabe-Abnahme. |
| R192 · Grenzen des einzelnen Laufs | Angenommen. | Abschnitt 1: kein isolierter N1-Gewinn belegt; VP188-02 bleibt offen bis zur Abnahme mit A, S, R. |

## 10 · Antworten auf R193 (Fassung 4)

| Punkt | Antwort | Änderung |
|---|---|---|
| Frage 1 · E1 entfällt, E2 eng | Angenommen, mit der Präzisierung. | Abschnitte 1 und 3: „E1 adressiert die gemessene Hauptlast nicht“; `render_max` als ganze Render-Spanne benannt. |
| Frage 2 · laufende Part-Frame-Antwort | Angenommen. | 3a: Sie wird mit ihrem eigenen Anker angewandt; die Prüfungen auf überholte Anfragen bleiben. Sie erledigt keinen später vermerkten Wechsel und löscht die Dämpfung nicht. |
| Frage 3 · 20 s | Angenommen. | 3c: gewählte endliche Frist, kein Fehlerbeweis; 0,8 s keine Dekodiermessung; eine spätere Übernahme läuft normal; alte Fristen und fremde Fehler wirkungslos. |
| VP193-01 · angewandter Pfadstand | Angenommen. | 3b: Bauschlüssel je Anforderung, `drawnKey` erst bei Anwendung, `wantKey` aus übernommener Vorschau und Live-Werten, `pathBehind` in `pathStaleNow`; die Parse-Gründe bleiben daneben. 3a: `loading → frei` heißt nicht aktuell; Nachbacken ist eine Anforderung. Abschnitt 5: Wächter A→B→A mit Lücke und Ladephase, verzögerte Antwort, frühere Antwort nach weiterem Wechsel, gescheiterter Aufbau. |
| Geltungsbereich | Angenommen. | 3a: `_bakeFollowsOffsets` mit dem vorhandenen Kriterium; Wächter für die drei Fälle. |
| Lauf, Simulation, Verbindung | Angenommen. | 3a: Zulassung bei jedem `preview_refresh`; Wächter mit dem Zustand schon vor dem Parse-Signal; Zeitgeber werden bei Übernahme und Nachbacken verbraucht. |
| Erste Rückmeldung | Angenommen. | 3a: als erwarteter Ablauf des S-Falls formuliert, die Werkstück-Markierung getrennt. |
| Historie | Angenommen. | Kopf: R191 gab Schritt 0 und N1 frei, A–C blieben offen. |
