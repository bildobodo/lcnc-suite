# Prüfung im Lauf — vorn zuerst, nach einer Tabellenänderung während das Programm läuft

**Fassung 3 · 9. Oktober 2026 · Kollisionsplan Schritt 3, letzter Teil** (Operator 2026-10-06: „nach der ECHTEN Messung im Lauf den Rest des Programms ab der aktuellen Position neu prüfen“).

- Fassung 1: Codex R112, sieben Befunde.
- Fassung 2: R113, VP112-04 bis 07 auf Planebene geschlossen; Reste bei VP112-01 bis 03.
- Fassung 3 beantwortet diese Reste. Die Antworten stehen am Ende.

**Die wichtigste Änderung:** Die Laufposition schließt keinen Teil des Programms mehr aus. Sie bestimmt nur die **Reihenfolge**: zuerst von dort bis zum Ende, dann vom Anfang bis dorthin. Am Ende ist das ganze Programm geprüft. Eine bewiesene Abweichungsgrenze ist dafür nicht nötig.

Gebaut wird erst nach Einigung.

## Ausgangslage, gemessen am Stand `a30b4138`

1. **Ein Programm-M6 löscht die Befunde bis zum Stillstand.**
   - `applyState` ruft bei `tool_length`, `tool_diameter`, `g5x_offset`, `g92_offset`, `rotation_xy` und den genutzten WCS-Zeilen `_colOnInputChange()` (2588–2614); der neue Anstoß wartet bis IDLE (3387–3402).
   - Die Prüfung liest Teile ihrer Basis live: Werkzeug vor dem ersten Ereignis, Start-WCS, Tabellenzeilen nicht umgeschriebener Epochen (VP112-01).
2. **Eine Tabellenänderung im Lauf** stößt die eingefrorene Neu-Analyse an (`midrun_table_gate_open`, `pinned_ctx`). Beim Eintreffen löscht der `viewerGcode`-Watcher die Befunde und hält bis IDLE an (MR-I03). Die Herkunft der Veröffentlichung steht nirgends dauerhaft (VP112-02).
3. **Die Laufposition kennt nur `ScrubBar`** (`runWatcher`). Sie ist der nächste Treffer, keine konservative Untergrenze (VP112-03). Unbekannte Strecken lassen sich nicht verorten, und τ ist kein Beweis (R113).
4. **Der Sweep beginnt immer bei Punkt 0.** Ein `sliceTrack`-Rest mit eigener Basis kann Paare statisch ausschließen (VP112-04).
5. **Der Startzustand ist für den Client nicht beobachtbar** (R113). `cycle_start` schreibt AUTO ohne Warten (`gateway.py` 4976–4983). Der Status kommt periodisch; ein früher G92 oder G43.1 kann schon wirken, bevor der Client die neue Laufkennung sieht. Ein später verbindender Client hat diesen Fehler immer.

## Paket 1 · Herkunft, Lauf-Basis, fester Prüfstand

### 1a · Gateway: `run_basis`, erfasst vor dem Start

In `_cmd_blocking` legt das Gateway für `kind == "auto"` mit `AUTO_RUN` oder `AUTO_STEP` aus dem Stillstand einen neuen `run_basis` an. Das geschieht an derselben Stelle wie die Toolsetter-Basis-Buchung, **bevor** der Befehl geschrieben wird. `AUTO_RESUME` legt keinen an; Pause und Fortsetzen behalten ihn.

Inhalt:
- `run_id`: ein Zähler.
- `state`: `sent`, sobald der Befehl geschrieben ist; `unsent`, wenn das Schreiben scheiterte, dann ist es kein Lauf.
- `file`, `source`, `version`: geladene Datei, Fingerabdruck und veröffentlichte Version zu diesem Zeitpunkt.
- `ctx_digest`: Fingerabdruck des veröffentlichten Parse-Kontexts mit seiner Startbasis (Fixture, WCS-Patches, Werkzeugbasis, Rotary-Seed, Kins).
- `tool_basis_rev`: ein Zähler, den jede Änderung von `BulkPipeline.tool_basis` erhöht, auch die bestätigte ohne neue Version (`reparse_verified_same`).
- `start`: der Steuerungszustand aus dem letzten Poll vor dem Schreiben: Fixture-Index, G5x, G92, Rotation, Werkzeug, angewandter Offset.
- `verified`: nur wahr, wenn alles zutrifft:
  - eine veröffentlichte Vorschau genau dieser Datei und `source`;
  - kein Parse läuft oder steht an;
  - kein Drift-Grund ist offen;
  - `tool_basis` passt zum angewandten Offset;
  - `start` passt zur Startbasis des veröffentlichten Kontexts.

  Was sich nicht prüfen lässt, macht `verified` falsch.

Der Status trägt `run_basis` bis zum nächsten Start. Ein später verbindender Client hat ihn damit auch. Für die Freigabe von Maschinenbefehlen ändert sich nichts: Er betrifft nur die Gültigkeit der Vorschau.

### 1b · Gateway: Herkunft jeder Veröffentlichung

- Beim **Planen** eines eingefrorenen Parses (`schedule_refresh(..., pinned=True)`) hält `BulkPipeline` `for_run = (run_id, ctx_digest, tool_basis_rev)` des dann gültigen `run_basis` fest. Fehlt ein verifizierter `run_basis`, ist `for_run` leer.
- `published_origin` jeder Veröffentlichung enthält: `version`, vollen Pfad, `source`, `reason`, `pinned`, `for_run`, Tabellenstand (Zeit, Zeilen-Fingerabdruck) und `tool_basis_rev`.
- Er geht mit `viewer_gcode_ready` hinaus und als `preview_origin` in jedem Status-Envelope.
- Ein eingefrorener Parse aus Lauf 1, der erst in Lauf 2 veröffentlicht, trägt `for_run` von Lauf 1. Der Client lehnt ihn ab, bevor ein Sweep entsteht.

### 1c · Client: Prüfstand und Ergebniszustände

Wie Fassung 2: Jede Prüfung bekommt einen **unveränderlichen Prüfstand** (`CheckBasis`), aus dem `_colBuildRequest` den Auftrag baut, nie aus `_pv`.
- **Im Stillstand:** der Live-Zustand bei Prüfbeginn.
- **Im Lauf:** `run_basis.start` des laufenden Laufs, ausdrücklich nicht der erste beobachtete Laufstatus. Dazu Track, Ereignisse und Tabelle des zugelassenen Payloads.

Ergebniszustände (reine Funktion `checkState`):
- **aktuell**;
- **im Lauf geprüft**: `vorn` / `vorn fertig` / `ganz fertig`;
- **bisherige Vorschau**: benannt, ohne die Farben, Zähler und Sprünge der aktuellen;
- **keins.**

## Paket 2 · Was der Lauf selbst ändert, löscht keine Befunde

Unverändert aus Fassung 2, jetzt mit der Lauf-Basis aus 1a. Solange ein Lauf mit `run_basis.state == sent` läuft, lösen Live-Änderungen der Punkt-1-Eingänge kein `_colOnInputChange` aus; das Ergebnis bleibt mit seinem Prüfstand stehen. Bei IDLE gilt die heutige Regel.

**Wächter**, zusätzlich zu Fassung 2 (Pose, Werkzeugwahl und Gültigkeit statt nur „sichtbar“):
- der erste beobachtete AUTO-Status kommt erst nach einem frühen G92, G43.1 oder M6: der Prüfstand bleibt `run_basis.start`;
- ein Client verbindet mitten im Lauf;
- abgelehnter Start (`unsent`, oder der Interpreter bleibt IDLE): kein Lauf;
- Pause und Fortsetzen: derselbe Lauf.

## Paket 3 · Prüfung im Lauf: vorn zuerst, dann der Anfang

### 3a · Zulassung, vor jedem Sweep

Ein Lauf-Auftrag entsteht nur, wenn alles zutrifft:
- der angezeigte Payload hat `preview_origin.pinned`;
- seine Version ist die angezeigte;
- `for_run` gleicht dem `run_basis` des laufenden Laufs in `run_id`, `ctx_digest` und `tool_basis_rev`;
- `run_basis.verified` ist wahr;
- der Interpreter läuft.

Sonst gibt es keinen Lauf-Auftrag, die bisherige Vorschau bleibt benannt stehen, und bei IDLE folgt die volle Prüfung (MR-I03).

Bindung, Verfall und IDLE-Abbruch wie Fassung 2:
- Ein Auftrag ist an `(version, run_id, Generation)` gebunden.
- Neue Veröffentlichung, Basisrevision, Reload, Abbruch, Laufende und Reconnect verwerfen ihn.
- IDLE bricht ihn sofort ab und startet die volle Prüfung.

**Wächter:**
- ein lange verzögerter eingefrorener Parse aus Lauf 1 nach dem Start von Lauf 2;
- gleiche Datei und `source` mit anderer Startbasis;
- eine alte Veröffentlichung beim späteren Verbinden;
- eine Basisbestätigung ohne Versionswechsel;
- überholte Teil- und Endantworten.

Jeder dieser Fälle scheitert, **bevor** ein Sweep startet.

### 3b · Reihenfolge statt Ausschluss

- Der **Hinweis** `h` ist der Segmentanfang (`index − 1`) der angezeigten Laufposition (`runWatcher`), gelesen einmal beim Planen; `runWatcher` rechnet ihn ohnehin.
- Ohne angehängte Position ist `h = 0`, dann ist es die volle Prüfung in normaler Reihenfolge.
- Eine Kandidatensuche pro Statusbild gibt es nicht (Lasthinweis R113).
- **Phase 1** prüft `[h, Ende]`, **Phase 2** `[0, h)`. Danach ist das ganze Programm geprüft.
- Der Hinweis schließt nichts aus. Er darf falsch sein: früher, später, auf einem anderen Durchgang. Ein falscher Hinweis kostet nur Zeit, bis der Befund vor der Maschine erscheint, nie den Befund.
- Unbekannte Strecken bleiben unbekannt wie in jeder vollen Prüfung.
- τ entscheidet nichts mehr.

### 3c · Sweep über einen Bereich, die Naht bei `h`

- **`CollisionOptions.range = {from, to}`** auf dem **Basis-Track**:
  - Programmbasis (erste Pose, Ruhelage) und statische Ausschlüsse wie im vollen Sweep;
  - `from` beginnt mit frischen Zertifikaten;
  - `to` endet am Segmentanfang `to`.
- **Phase 1, Start bei `h > 0`:** Jedes nicht ausgeschlossene Paar in Kontakt (berührt oder ganz innen) ist ein **Grenzkontakt**, auch ein Schneidpaar, wie in Fassung 2 angenommen. Er wird benannt: „Kontakt bei Prüfbeginn — Herkunft wird noch geprüft“.
- **Phase 2** läuft vom Programmanfang wie der volle Sweep und endet bei `h`.
- **Die Naht:** Am Ende von Phase 2 steht derselbe Punkt `h`. Ein Paar in Kontakt dort gehört zu Phase 2s Kontakt. Der Grenzkontakt wird dessen Fortsetzung: ein Kontakt, ein Befund, Beginnzeile aus Phase 2. Das ist dieselbe Regel wie bei der Anfahrt in `sweepMerge` („ein Kontakt, von beiden gesehen, zählt einmal“).
- Ist Phase 2 noch nicht fertig, bleibt der Grenzkontakt benannt stehen.
- **Abdeckung** ist `[h, Ende] ∪ [0, h)` auf der Basisachse. Teilantworten, Parken und Shard-Abbruch halten das je Phase.
- Ein Bereich der Länge null oder ein Bereich nur aus unbekannten Strecken ist ein eigener benannter Zustand.

**Wächter:**
- Zwei Phasen gegen den vollen Sweep auf den ausgelieferten Modellen. Wie bei `sweepShards.test`: Ein Befund oder eine Berührung in nur einem Lauf muss eine Strecke von höchstens `MIN_ADV` sein. Dazu ein zufälliges `h`.
- Codex' Wiederkontaktfall (R112), Codex' Mischfall (R113) mit `h` hinter dem Hindernis: der Befund kommt in Phase 2.
- Ein im Eilgang begonnener Schneidkontakt an `h`: Naht zu Phase 2s Beginn.
- Ein ganz eingeschlossener Körper an `h`.
- Unentscheidbarer Innenstatus an `h`.
- Abdeckung bei Teilantwort, Parken, Shard-Abbruch.

### 3d · Bezeichnung

- „Prüfung im Lauf · Werkzeugtabelle aktualisiert“.
- Phase 1: „vorn ab L… geprüft“, dann „ganz geprüft“.
- Nie „gemessen“.
- Ohne erkannte Tabellenänderung kein neuer Lauf-Auftrag. Eine neue Dateizeit mit gleichen Werten kann einen auslösen (R113); das ist eine Tabellenänderung, kein Messnachweis.

## Paket 4 · Last, Drehachsen, Anzeige

Wie Fassung 2, von Codex auf Planebene angenommen:
- höchstens zwei Sub-Worker, 20-ms-Scheiben, ersetzen statt anstellen, Pause beim Dekodieren;
- Messprotokoll mit Zielen, getrennte Messaufbauten, keine Rechtzeitigkeitszusage;
- Drehachsen im Lauf parken nicht, Jog und IDLE schon.

Dazu kommt:
- `run-pos` liefert je Statusbild nur die Pose für die Anzeige;
- der Hinweis wird beim Planen einmal gelesen.

## Abnahme

- Je Paket die genannten Wächter; jede Regel mit einer Mutation rot.
- Gateway-pytest für `run_basis` und `published_origin`.
- e2e `collisions.viewer.spec`; der MR-I03-Fall wird angepasst: zwei Phasen im Lauf, voll bei IDLE.
- Live auf der Sim mit einem M600-Programm, sobald eine laufende Sim zur Verfügung steht.

## Antworten auf Codex' Planprüfung

| Befund | Antwort | Änderung im Plan |
|---|---|---|
| VP112-01 (R112) | Angenommen. | 1c: fester Prüfstand; Paket 2. |
| VP112-01 Rest (R113) | Angenommen. | 1a: `run_basis` im Gateway vor dem Schreiben des Starts, mit `verified` gegen den veröffentlichten Kontext; im Status für jeden Client. 1c: der Lauf-Prüfstand ist `run_basis.start`, nie der erste beobachtete Status. Wächter für frühes G92/G43.1/M6, späten Client, abgelehnten Start, Pause/Fortsetzen. |
| VP112-02 (R112) | Angenommen. | 1b: `published_origin` / `preview_origin`. |
| VP112-02 Rest (R113) | Angenommen. | 1b: `for_run` beim Planen des eingefrorenen Parses festgehalten, mit `tool_basis_rev` als Basisrevision. 3a: Zulassung vergleicht `for_run` mit dem laufenden `run_basis`; Lauf-1-Parse in Lauf 2 scheitert vor jedem Sweep. |
| VP112-03 (R112, R113) | Angenommen — mit anderem Weg. | 3b: Die Position schließt nichts mehr aus, sie ordnet nur: Phase 1 `[h, Ende]`, Phase 2 `[0, h)`. Unbekannte Strecken und τ entscheiden nichts. Mischfall und verletzte Grenze kosten nur Zeit. 3c: `range`, Naht bei `h`. |
| VP112-04 | Geschlossen (R113). | Bleibt: Programmbasis, Grenzkontakt, keine fremden Zertifikate, jetzt mit der Naht zu Phase 2. |
| VP112-05 | Geschlossen (R113). | 3d präzisiert: „Ohne erkannte Tabellenänderung kein neuer Lauf-Auftrag“. |
| VP112-06 | Geschlossen auf Planebene (R113). | Bleibt; dazu `run-pos` nur Pose, Hinweis einmal beim Planen. |
| VP112-07 | Geschlossen auf Planebene (R113). | Bleibt. |
