# VP188-02 — Statusalter bei wiederholten Versatzwechseln (Plan)

**Fassung 3 · 23. Oktober 2026 · Zweig `feat/vp188-basiswechsel` (Schritt 0 und N1 gebaut, R192 Agreement, gemergt `a8486ee9`) · Merge nach `development` über den Integrationszweig, nie `main`.**

Fassung 2 hat Codex in R191 angenommen, Schritt 0 und N1 sind gebaut (R192 Agreement).

Fassung 3 folgt dem Diagnoselauf nach N1:
- **Ergebnis:** Das Ziel ist weiter verfehlt.
- **Hauptlast:** der Neuaufbau des gezeichneten Pfads, nicht die Kollisionsprüfung.
- **Operator-Entscheidung (23. Oktober, 23:20):** „Pfad wartet“, die **enge Form von E2**.
- **E1 entfällt** auf diesen Befund.

Geändert sind 1, 3, 5 und 6; neu ist Abschnitt 9. Die Antworten auf R190 (Abschnitt 8) bleiben stehen.

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

- Daneben `render_max` 86 ms, das Hochladen der neu gebauten Geometrie beim nächsten Render, und `mt_late_max` 164 ms.
- **Lesart:** Die Spannen erklären den Hauptteil, nicht alles. `path_reply` und der folgende Render sind die dominante Last. Die Prüfung kostet den Hauptthread etwa 5 ms je Wechsel.
  - **Folge für E1:** E1 (die Prüfung wartet) erreicht das Ziel nicht.
  - **Folge für E2:** Sieben der acht Neuaufbauten ersetzt die Veröffentlichung ohnehin.
- **Vergleich zu R188:** Das Alter in S_supersede ist ähnlich (58/68 vorher, 60 jetzt). Ein isolierter Gewinn von N1 ist damit nicht belegt (R192: kein Vorher-Lauf).

## 2 · Schritt 0 · gebaut (R192)

Wie in Fassung 2. Gebaut und angenommen:
- die sieben Spannen mit `finally`, Verschachtelung apart;
- die Auswertung `main_thread` je Phase;
- `drive2.py --to S` und neu `--no-keys`: keine Tastenaufforderung, eine Meldung „Messlauf ohne Eingabe“, `setup.json.keys_requested`; der Bericht zählt `presses` je Phase.

## 3 · Verhaltensänderung · E2 in enger Form (Operator-Entscheidung)

**E1 entfällt.** Der Befund in 1 zeigt, dass die Prüfung nicht die Last ist. Bleibt das Ziel nach E2 verfehlt, kommt E1 nicht zurück, ohne dass eine neue Messung es begründet.

**E2 eng · Der Pfad wartet, solange ein Neu-Parse der geladenen Datei unterwegs ist.**

**Regel:**
- Ein Versatzwechsel ohne laufenden Neu-Parse backt den Pfad wie heute nach 300 ms neu. Das ist die unmittelbare Rückmeldung beim Antasten.
- Ist ein Neu-Parse der geladenen Datei unterwegs, wird nicht gebacken. Der Pfad bleibt auf seinem zuletzt gebackenen Stand, als veraltet gedämpft wie heute (`pathStaleNow`).
- Die Übernahme der neuen Vorschau backt mit den **Live-Versätzen** (`applyGcode` → `_pfWcs()` aus `_pv`). Der Pfad steht danach am aktuellen Ort, gleich auf welcher Basis der Parse lief.

**Gilt für** jede Neuback-Anforderung über `_pfScheduleWcsRefresh`: G5x, G92, XY-Rotation, die Versatztabelle und den Werkzeugversatz ohne Werkzeugbasis.
- Die Reichweitenhülle (`_reachSchedule`) bleibt ungehalten.
- Wie in R190: nur die gebackene Darstellung mit eigenem Anker, also Teil-Modus und programmierter Pfad mehrerer Epochen. Ein programmierter Pfad einer Epoche folgt dem Live-Ursprung weiter, denn die Anforderung entfällt dort schon heute.

**Besitzer des Haltens:** ein Halt `H`, gebunden an
- die angezeigte Revision `<voller Pfad>#<publishedVersion>` von `viewerGcode`,
- die Verbindungsepoche,
- eine lokale Nummer.

`preview_refresh` trägt nur den Basisnamen. Er muss zum Basisnamen der angezeigten Datei passen. Entschieden wird über die volle Revision der Veröffentlichung.

**Zustände und Übergänge:**

| Zustand | betreten bei | Versatzwechsel dort | verlassen bei |
|---|---|---|---|
| `frei` | Anfang; Ende jedes Haltens | backt wie heute (300 ms) | `preview_refresh` der geladenen Datei erscheint → `parsing` |
| `parsing` | `preview_refresh` (mit `job`) | **gehalten**: nichts angefordert, vermerkt | `preview_refresh` fehlt → `after_parse`; Ankunft `viewer_gcode_ready` dieser Datei mit neuerer Version `v` → `loading` |
| `after_parse` | der Parse fehlt im Status (Ersetzungslücke, im Lauf 37 ms zwischen `off` von Job 41 und `on` von Job 42); Frist 6 s ab da | gehalten | neuer `preview_refresh` → `parsing`; Ankunft mit `v` → `loading`; Frist → **Ende mit Nachbacken** |
| `loading` | Ankunft mit Version `v` (vor Abruf und Dekodierung); Frist 20 s ab da | gehalten | `viewerGcode` mit `publishedVersion = v` und derselben Datei übernommen → `frei` (die Übernahme backt); Fehler **dieser** Dekodierung (Version `v`) → **Ende mit Nachbacken**; neuere Ankunft → `loading` mit ihr; Frist → **Ende mit Nachbacken** |

**Ende mit Nachbacken:**
- Endet das Halten ohne Übernahme einer neuen Vorschau und wurde ein Wechsel gehalten, wird **einmal** sofort gebacken, auf der angezeigten Vorschau mit den Live-Versätzen.
- Kein Wechsel geht damit verloren. Das gilt auch dann, wenn ein späteres Statusbild dieselben Werte zeigt und `_numArrChanged` keinen Wechsel mehr meldet.

**Beenden aus jedem Zustand:**
- **Mit Nachbacken:**
  - **Verbindung verloren** (neue Epoche): nach dem Wiederverbinden gilt das übliche Verhalten.
  - **Lauf beginnt:** Prüfungen und Pfad im Lauf haben ihre eigenen Regeln.
  - **Simulationseintritt:** Die Simulation zeigt den Pfad an seinem gültigen Ort.
- **Ohne Nachbacken:**
  - **Datei gewechselt oder entladen:** Die neue Datei bringt ihre Übernahme.

**Laufende Part-Frame-Antwort:**
- Eine Antwort, die **vor** Beginn des Haltens angefordert wurde, wird angewandt. Sie ist die Rückmeldung des ersten Wechsels.
- Während des Haltens wird keine angefordert.
- Das ändert die R190-Regel („verworfen, solange gehalten“). In der engen Form gibt es im Halten keine eigene Anforderung, die man verwerfen müsste.
- Ein 300-ms-Zeitgeber, der im Halten abläuft, entscheidet beim Ablauf: gehalten, also vermerkt.

**Die Reste aus R191 (VP190-01), auf E2 übertragen:**
- **A · die Basis der übernommenen Vorschau:**
  - Die Übernahme backt mit den Live-Versätzen. Der gezeichnete Pfad stimmt deshalb nach jeder Übernahme mit der Maschine überein.
  - Weicht die Parse-Basis ab (ein Wechsel nach dem Parse-Beginn), bleibt `previewWcsStale` wahr und der Pfad gedämpft. Der Gateway parst erneut, und sein `preview_refresh` beginnt ein neues Halten.
- **B · nur der eigene Fehler:**
  - Gezählt wird nur der Fehler der Dekodierung der Version `v`: die Fehlerantwort des Preview-Workers bzw. sein `onerror`, während `v` aussteht.
  - Er wird als eigenes Signal ausgegeben (`previewDecodeFailure {file, version}`), nie über das gemischte `previewLoadError`, das auch Oberflächen- und Kompensationsfehler trägt.
- **C · begrenztes Laden:** `loading` endet spätestens nach 20 s mit Nachbacken.
  - Das ist eine Schranke, kein Fehlerbeweis.
  - Im Diagnoselauf lagen zwischen dem Ende des letzten Parses (`parse_seen off`, Job 42) und dem Start der Prüfung auf der übernommenen Vorschau 0,8 s. Darin stecken Abruf, Dekodierung und die 400 ms der Prüfplanung. Die Dekodierung selbst wird nicht eigens gemessen.

**Anzeige:**
- Wie heute: der Pfad gedämpft, solange `preview_refresh` läuft oder die Vorschau andere Versätze trägt. Dazu die HUD-Zeile „Preview re-parsing“, deren „?“ sagt, dass Pfad, Limit-Marken und Simulation mit der neuen Vorschau kommen.
- In der Ersetzungslücke bleibt der Pfad gedämpft (`previewWcsStale`). Die Zeile „Preview uses older offsets“ erscheint erst nach ihrer Gnadenfrist von 5 s. Daran ändert sich nichts.

**Kollisionsprüfung:**
- Unverändert: Abbruch und Neustart je Wechsel, gegen die Live-Versätze.
- Ihre Befunde hängen nicht am gezeichneten Pfad, denn Zeitleiste und Tönung lesen die Prüfung.

**Abwägung (vom Operator gewählt):**
- Bei 600 000 Zeilen bleibt der Pfad nach einem **zweiten** schnellen Wechsel bis zur neuen Vorschau am alten Ort, 7–16 s, gedämpft.
- Der erste Wechsel verschiebt ihn sofort. Die Werkstück-Markierung folgt immer sofort.
- Kleine Programme parsen in unter einer Sekunde; dort ist kaum ein Unterschied zu sehen.

**Erwartung im S-Fall:**
- Gebacken wird nur noch zweimal: beim ersten Wechsel und bei der Übernahme, statt neunmal (acht Wechsel und die Übernahme).
- Ob das Ziel damit erreicht ist, zeigt erst die Messung (Abschnitt 6).

## 4 · Verhaltensneutrale Korrekturen

- **N1:** gebaut (R192).
- **N2 · Einfahrbahn entprellt:** unverändert getrennt, nicht Teil dieses Schritts.
- **N3:**
  - Den Pfadaufbau in Schritte zu teilen hat der Operator nicht gewählt.
  - Das GPU-Hochladen bliebe dabei, `render_max` war 86 ms.

## 5 · Tests, Gates, Review

- **Unit** (`viewer/bakeHold.ts`, rein):
  - jede Zeile der Tabelle;
  - jede Endbedingung mit und ohne gehaltenen Wechsel;
  - einmaliges Nachbacken;
  - die beiden Fristen und ihre Nummer (alte Fristen tun nichts);
  - die Bindung an volle Revision und Epoche;
  - ein Dekodierfehler einer anderen Version beendet nichts.
- **Browser** (über den Mock; gezählt über `__viewerDiag.getPathMemory().generation` und `span_path_reply`):
  1. Versatzwechsel ohne Parse: genau ein Neuaufbau.
  2. Erster Wechsel, dann `preview_refresh`, dann weitere Wechsel mit und ohne Lücke: kein weiterer Neuaufbau. Veröffentlichung, Übernahme: genau ein Neuaufbau, an den Live-Versätzen.
  3. `preview_refresh` verschwindet ohne Veröffentlichung: nach 6 s genau ein Nachbacken, und nur, wenn ein Wechsel gehalten war.
  4. Ankunft ohne Übernahme: Ein Fehler dieser Dekodierung backt nach. Ein Fehler der Oberflächenpunkte tut es nicht. Nach 20 s backt die Frist nach.
  5. Verbindungsverlust, Laufbeginn und Simulationseintritt im Halten backen nach. Ein Dateiwechsel backt nicht nach.
  6. Eine vor dem Halten angeforderte Part-Frame-Antwort wird angewandt.
  7. Ein programmierter Pfad einer Epoche folgt weiter.
- **Mutationen:** jede Haltebedingung, das Nachbacken, die Fristen, die Fehlerquelle, die Bindung.
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
