# VP188-02 — Statusalter bei wiederholten Versatzwechseln (Plan)

**Fassung 1 · 23. Oktober 2026 · Zweig `feat/vp188-basiswechsel` von `development` (`084b8e4a`) · Merge nach `development` über den Integrationszweig, nie `main`.**

Gebaut wird erst nach Einigung über diesen Plan. Die Verhaltensänderung in Abschnitt 3 entscheidet der Operator; er hat die Planung beauftragt („ja plane es“).

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
| `col_build` | `_colBuildRequest` + `postMessage` in `runCollisionCheck` |
| `col_cancel` | den synchronen Teil von `_colOnInputChange` |
| `path_reply` | den Antwort-Handler des Part-Frame-Workers einschließlich `toolpath.apply` |
| `path_programmed` | `_applyProgrammed` |
| `pf_load` | `_pfEnsureLoaded` |
| `entry_track` | `_buildEntryTrack` |
| `render` | gibt es schon (`render_*`) |

- **Warum eigene Spannen:** Firefox hat keine Long-Tasks-API. Der vorhandene Hauptthread-Fühler (8 ms Takt) zählt Verzögerungen, ordnet sie aber nicht zu.
- **Auswertung:** `bpc2.py report` nennt je Phase die Spannen (Summe, Maximum) neben `mt_late` und dem Statusalter.
- **Messlauf ohne Eingabe:** Die Phase S läuft wie am 23. Oktober (`drive2.py`, ab A oder nur `--from S`), mit der Seite des Operators: offen, sichtbar, entwaffnet, Mac wach. Der Operator muss dabei nichts tun.
- **Ergebnis:** eine Tabelle Spanne × Phase; daraus folgt, welche der Maßnahmen in 3 und 4 nötig sind.
- **Wächter:** `viewerPerf.test` (Sammeln, Leeren je Fenster, Obergrenze der Namen), `frames.spec` (eine Spanne erscheint), Werkzeugtest (Bericht).

## 3 · Verhaltensänderung · zur Entscheidung des Operators

**E1 · Die Kollisionsprüfung wartet auf die neue Vorschau.**
- **Wann:** Die geladene Vorschau ist durch eine Versatzänderung veraltet (`previewWcsStale`), oder der Gateway parst die geladene Datei neu (`previewRefresh`), und die Maschine steht. Dann startet die Seite **keine** neue Prüfung auf der alten Vorschau.
- **Anzeige:** Die alten Befunde sind wie heute sofort weg. Der Sim-Tab sagt „Prüfung wartet auf die neue Vorschau“; Pfad und Leiste bleiben als veraltet markiert, wie heute.
- **Rückfall:** Kommt binnen `REPARSE_WAIT_MS` (6 s: Entprellung des Gateways 2 s, zwei gleiche Lesungen, Start des Prozesses; gemessen 2,8–3,5 s) kein `preview_refresh`, oder endet der Neu-Parse ohne Veröffentlichung (Fehler, Abbruch ohne Neustart, Zeitüberschreitung), prüft die Seite die vorhandene Vorschau wie heute. Ein Neu-Parse, der nie kommt, darf die Prüfung nicht für immer anhalten.
- **Ausgenommen:**
  - Während eines Laufs ändert sich nichts: Prüfungen im Lauf sind eigene Regeln.
  - Ein Versatzwechsel, auf den der Gateway nicht neu parst (er läuft, ist nicht im Leerlauf, keine Vorschau), startet die Prüfung wie heute.

**E2 · Der Pfad folgt dem neuen Versatz erst mit der neuen Vorschau** (nur nötig, wenn Schritt 0 `path_reply` als wesentlichen Anteil zeigt).
- **Heute:** Der Pfad springt nach 300 ms auf den neuen Versatz (neu gebacken aus der alten Vorschau). Mit der Veröffentlichung kommt er ein zweites Mal.
- **Mit E2:** Der Pfad bleibt an seinem Ort, gedämpft als veraltet (`setStale`, wie heute während eines Neu-Parses), bis die neue Vorschau da ist. Dazu gilt derselbe Rückfall wie bei E1.
- **Abwägung für den Operator:** Bei einem kleinen Programm kommt die neue Vorschau nach wenigen Sekunden, bei 600 000 Zeilen nach etwa 7–16 s. So lange zeigt der Pfad den alten Ort, sichtbar als veraltet. Die Werkstück-Markierung folgt sofort.

**Empfehlung:** E1 ja. Über E2 entscheidet die Messung aus Schritt 0; ist `path_reply` klein, bleibt der Pfad wie heute.

## 4 · Verhaltensneutrale Korrekturen (ohne Entscheidung)

- **N1 · Kein doppelter Klon:** `_colBuildRequest` überträgt jede Spalte, die es ohnehin kopiert. Heute klont `postMessage` die nicht übertragenen ein zweites Mal. Wächter: Die Anfrage enthält jede kopierte Spalte in `transfer` (`checkWiring.test` bzw. ein Unit-Test über die Anfrage), der Worker bekommt dieselben Werte (`collisions.viewer.spec` unverändert grün).
- **N2 · Einfahrbahn entprellt:** `_buildEntryTrack` außerhalb der Simulation erst nach Ruhe der Eingaben (wie die vorhandene 500-ms-Prüfung in der Simulation). In der Simulation bleibt sie sofort. Wächter: `scrub`/`sim-panel`-Specs unverändert; ein Unit-Test zählt Aufbauten bei acht Versatzänderungen.
- **N3:** Falls Schritt 0 eine weitere Spanne zeigt (`pf_load`, `col_cancel`), wird sie hier ergänzt und dem Operator nicht als Verhalten vorgelegt, sofern sie nichts Sichtbares ändert.

## 5 · Tests, Gates, Review

- **Unit:**
  - E1: warten, Rückfall nach 6 s, Rückfall bei einem Fehler des Neu-Parses, im Lauf unverändert, kein Warten ohne Neu-Parse;
  - E2 (falls gebaut);
  - N1, N2.
- **Browser** (`collisions.viewer.spec`, `sim-panel.viewer.spec`), über den Mock:
  - Versatzänderung, dann `preview_refresh`, dann Veröffentlichung: genau eine Prüfung, auf der neuen Vorschau.
  - Versatzänderung ohne `preview_refresh`: nach 6 s eine Prüfung auf der alten Vorschau.
  - Die Anzeige sagt jeweils, worauf die Prüfung wartet.
- **Mutationen:** jede Wartebedingung, der Rückfall, die Übertragungsliste, die Entprellung.
- **Gates:** Frontend (Lint, Build, Unit, Browser), Backend unverändert (kein Gateway-Code).
- **Codex-Runden:** dieser Plan, dann die Umsetzung.

## 6 · Nachmessung

- **Wiederholt wird derselbe S-Fall:** `drive2.py` mit A, S und R, die Seite des Operators, Eingabe in A_input und in S. Die Meldung „Taste loslassen“ bleibt kurz sichtbar, deshalb hält der Operator die Taste 2 Minuten, wie im zweiten Lauf.
- **Ziel:** Statusalter p95 < 50 ms in S_supersede, keine Verschlechterung in den anderen Phasen, S met, R proven.
- **Bericht:** neben den Urteilen die Spannen aus Schritt 0, vorher und nachher.

## 7 · Nicht in diesem Plan

- Die Abnahme auf dem echten Maschinen-PC und der Live-Lauf mit M600 bleiben eigene Punkte.
- Ein G54/G55-Wechsel ohne Versatzänderung löst keinen Neu-Parse aus (keine Drift-Kante liest den aktiven Index). Das ist hier nur benannt und bleibt eigener Punkt, falls der Operator es will.
