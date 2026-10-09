# Prüfung im Lauf — erst vorläufig ab der Maschine, dann vollständig, nach einer Tabellenänderung

**Fassung 4 (angenommen, Codex R115) · 9. Oktober 2026 · Kollisionsplan Schritt 3, letzter Teil** (Operator 2026-10-06: „nach der ECHTEN Messung im Lauf den Rest des Programms ab der aktuellen Position neu prüfen“).

- Fassung 1: Codex R112, sieben Befunde.
- Fassung 2: R113, VP112-04 bis 07 auf Planebene geschlossen.
- Fassung 3: R114, VP112-01 und 03 geschlossen; offen der Rest von VP112-02 und VP114-01.
- Fassung 4 beantwortet diese beiden. Die Antworten stehen am Ende.

**Die wichtigste Änderung** (seit Fassung 3, in Fassung 4 vereinfacht): Die Laufposition schließt keinen Teil des Programms aus. Sie bestimmt nur, was **zuerst** sichtbar wird:
1. eine **vorläufige** Prüfung ab ihr bis zum Ende;
2. danach eine **vollständige** Prüfung wie im Stillstand, die die vorläufige ersetzt.

Eine Naht zwischen zwei Teilen gibt es nicht. Eine bewiesene Abweichungsgrenze ist nicht nötig.

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

- **Der Laufkontext.** Beim Anlegen eines verifizierten `run_basis` (1a) hält das Gateway auch den **vollständigen Startkontext** fest, den `pinned_ctx()` in diesem Moment bauen würde: `published_ctx`, `published_params`, Rotary-Seed, TLO-Basis und `tool_basis`. Er liegt unveränderlich als `run_basis.ctx`; `ctx_digest` ist sein Fingerabdruck.
- **Ein eingefrorener Parse im Lauf** wird **aus `run_basis.ctx`** gebaut, nicht aus der jüngsten Veröffentlichung (R114: Eine gewöhnliche Veröffentlichung B mitten im Lauf hätte sonst das Etikett von A getragen). Der einzige neue Eingang ist die Werkzeugtabelle, eigens gebunden über Tabellenzeit und Zeilen-Fingerabdruck in der Herkunft.
- **Prüfung des gebauten Kontexts.** Vor dem Dispatch prüft das Gateway den Fingerabdruck des tatsächlich gebauten Kontexts (ohne Tabelle) gegen `run_basis.ctx_digest`; beim Veröffentlichen prüft es, dass `for_run` noch derselbe ist. Bei einer Abweichung oder ohne verifizierten `run_basis` bekommt der Parse kein `for_run`. Er bleibt eine Vorschau ohne Laufherkunft.
- Beim **Planen** hält `BulkPipeline` `for_run = (run_id, ctx_digest, tool_basis_rev)` dieses `run_basis` fest.
- `published_origin` jeder Veröffentlichung enthält: `version`, vollen Pfad, `source`, `reason`, `pinned`, `for_run`, Tabellenstand (Zeit, Zeilen-Fingerabdruck) und `tool_basis_rev`.
- Er geht mit `viewer_gcode_ready` hinaus und als `preview_origin` in jedem Status-Envelope.
- Ein eingefrorener Parse aus Lauf 1, der erst in Lauf 2 veröffentlicht, trägt `for_run` von Lauf 1. Der Client lehnt ihn ab, bevor ein Sweep entsteht.

### 1c · Client: Prüfstand und Ergebniszustände

Wie Fassung 2: Jede Prüfung bekommt einen **unveränderlichen Prüfstand** (`CheckBasis`), aus dem `_colBuildRequest` den Auftrag baut, nie aus `_pv`.
- **Im Stillstand:** der Live-Zustand bei Prüfbeginn.
- **Im Lauf:** `run_basis.start` des laufenden Laufs, ausdrücklich nicht der erste beobachtete Laufstatus. Dazu Track, Ereignisse und Tabelle des zugelassenen Payloads.

Ergebniszustände (reine Funktion `checkState`):
- **aktuell**;
- **im Lauf geprüft**: `vorläufig ab L…` (die vorläufige Prüfung, 3b) und danach der vollständige Stand, wenn die vollständige Prüfung fertig ist (3c/3d);
- **bisherige Vorschau**: benannt, ohne die Farben, Zähler und Sprünge der aktuellen;
- **keins.**

## Paket 2 · Was der Lauf selbst ändert, löscht keine Befunde

Unverändert aus Fassung 2, jetzt mit der Lauf-Basis aus 1a. Solange ein Lauf mit `run_basis.state == sent` läuft, lösen Live-Änderungen der Punkt-1-Eingänge kein `_colOnInputChange` aus; das Ergebnis bleibt mit seinem Prüfstand stehen. Bei IDLE gilt die heutige Regel.

**Wächter**, zusätzlich zu Fassung 2 (Pose, Werkzeugwahl und Gültigkeit statt nur „sichtbar“):
- der erste beobachtete AUTO-Status kommt erst nach einem frühen G92, G43.1 oder M6: der Prüfstand bleibt `run_basis.start`;
- ein Client verbindet mitten im Lauf;
- abgelehnter Start (`unsent`, oder der Interpreter bleibt IDLE): kein Lauf;
- Pause und Fortsetzen: derselbe Lauf.

## Paket 3 · Prüfung im Lauf: erst vorläufig ab dem Hinweis, dann vollständig

### 3a · Zulassung, vor jedem Sweep

Ein Lauf-Auftrag entsteht nur, wenn alles zutrifft:
- der angezeigte Payload hat `preview_origin.pinned`;
- seine Version ist die angezeigte;
- Datei (voller Pfad) und `source` sind die der geladenen Datei (aus Fassung 2, ausdrücklich beibehalten);
- `for_run` gleicht dem `run_basis` des laufenden Laufs in `run_id`, `ctx_digest` und `tool_basis_rev`;
- `run_basis.verified` ist wahr;
- der Interpreter läuft.

Sonst gibt es keinen Lauf-Auftrag, die bisherige Vorschau bleibt benannt stehen, und bei IDLE folgt die volle Prüfung (MR-I03).

Bindung, Verfall und IDLE-Abbruch wie Fassung 2:
- Ein Auftrag ist an `(version, run_id, Generation)` gebunden.
- Neue Veröffentlichung, Basisrevision, Reload, Abbruch, Laufende und Reconnect verwerfen ihn.
- IDLE bricht ihn sofort ab und startet die volle Prüfung.

**Wächter:**
- ein lange verzögerter eingefrorener Parse aus Lauf 1 nach dem Start von Lauf 2 (grüne Kontrolle aus R113);
- R114: verifizierter Lauf A → gewöhnliche Veröffentlichung B derselben `source` → eingefrorener Tabellen-Parse: sein tatsächlicher Kontext ist A, sonst scheitert die Zulassung;
- eine Änderung zwischen Planen und Kontextbau;
- geänderte `source` bei gleicher Datei;
- gleiche Datei und `source` mit anderer Startbasis;
- eine alte Veröffentlichung beim späteren Verbinden;
- eine Basisbestätigung ohne Versionswechsel;
- überholte Teil- und Endantworten.

Jede **ungültige** Variante scheitert, **bevor** ein Sweep startet. Der korrigierte Fall A → B → Parse aus A wird zugelassen; ein Parse mit B-Kontext unter A-Etikett scheitert.

### 3b · Erst vorläufig ab dem Hinweis, dann vollständig

- Der **Hinweis** `h` ist der Segmentanfang (`index − 1`) der angezeigten Laufposition (`runWatcher`), gelesen einmal beim Planen. Ohne angehängte Position entfällt die vorläufige Prüfung, es folgt gleich die vollständige.
- **Vorläufig:** ein Sweep über `[h, Ende]` (`CollisionOptions.range = {from: h}` auf dem Basis-Track; Programmbasis und statische Ausschlüsse wie im vollen Sweep, frische Zertifikate ab `h`).
  - Jedes nicht ausgeschlossene Paar in Kontakt an `h` ist ein **Grenzkontakt**, auch ein Schneidpaar. Er heißt „Kontakt bei Prüfbeginn — Art erst mit der vollständigen Prüfung geklärt“.
  - Er wird nicht als Kollision gezählt und nicht mit anderen Befunden zusammengelegt.
  - Folgezeilen eines Kontakts, der vor `h` begann, kann die vorläufige Prüfung nicht richtig einordnen. Sie stehen dort mit der Bezeichnung „vorläufig“ (R114: ein Eilgang-Kontakt vor `h` bestimmt Zeilen nach `h`).
- **Vollständig:** Danach läuft der normale Sweep von Punkt 0, mit demselben Prüfstand. Er **ersetzt** die vorläufige Prüfung ganz, wenn er fertig ist. Bis dahin bleibt die vorläufige stehen; der Fortschritt der vollständigen wird getrennt gezeigt. Erst sein Ergebnis ist „im Lauf ganz geprüft“.
- Eine Naht gibt es nicht: Kein Ergebnis wird aus zwei Teilen zusammengesetzt. Der Preis ist, dass `[h, Ende]` doppelt gerechnet wird (Codex' einfachere Alternative aus R114).
- Der Hinweis schließt nichts aus. Ein falscher Hinweis verzögert höchstens die vorläufige Anzeige eines Befunds vor der Maschine; die vollständige Prüfung findet ihn.
- Unbekannte Strecken bleiben unbekannt wie in jeder vollen Prüfung; τ entscheidet nichts.

### 3c · Abdeckung und Zustände

- **Abdeckung:** Die vorläufige deckt `[h, Ende]` ab, ihr Band beginnt bei `h`. Die vollständige deckt `[0, Ende]` ab, wie heute.
- Ein Abbruch, die Sample-Grenze oder unbekannte Strecken werden durch das Ende einer Phase nicht zu „alles geprüft“.
- Teilantworten, Parken und Shard-Abbruch behalten das je Sweep (`mergeShardResults` unverändert).
- Ein Bereich der Länge null oder einer nur aus unbekannten Strecken ist ein eigener benannter Zustand.
- `checkState`: `vorläufig ab L…` → `vorläufig fertig` → `ganz geprüft`. IDLE bricht beide ab und startet die volle Prüfung wie heute.

**Wächter:**
- Die vollständige Prüfung im Lauf gleicht der im Stillstand (gleicher Track und Prüfstand: gleiche Befunde).
- Codex' Schneidfälle aus R114:
  - **Feed hinein, Schnitt, Rapid heraus:** vorläufig ein benannter Grenzkontakt, vollständig kein Befund.
  - **Rapid hinein, Feed, Rapid ohne Trennung:** vorläufig unvollständig und so benannt, vollständig alle Folgezeilen wie im Vollsweep.
- Codex' Wiederkontaktfall (R112) und Mischfall (R113): die vollständige findet beide.
- Grenzkontakt eines ganz eingeschlossenen Körpers; unentscheidbarer Innenstatus an `h`.
- Abdeckung bei Teilantwort, Parken, Shard-Abbruch; die vorläufige färbt `[0, h)` nie.

### 3d · Bezeichnung

- „Prüfung im Lauf · Werkzeugtabelle aktualisiert“.
- Vorläufig: „ab L… geprüft (vorläufig)“, mit dem Hinweis im „?“, dass der Start die vermutete Position der Maschine ist und der Anfang noch folgt. Nie „vorn“ im Sinne von „das Ungeprüfte liegt sicher hinter der Maschine“.
- Danach „ganz geprüft“.
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
- e2e `collisions.viewer.spec`; der MR-I03-Fall wird angepasst: vorläufig und vollständig im Lauf, voll bei IDLE.
- Live auf der Sim mit einem M600-Programm, sobald eine laufende Sim zur Verfügung steht.

## Antworten auf Codex' Planprüfung

| Befund | Antwort | Änderung im Plan |
|---|---|---|
| VP112-01 (R112) | Angenommen. | 1c: fester Prüfstand; Paket 2. |
| VP112-01 Rest (R113) | Angenommen. | 1a: `run_basis` im Gateway vor dem Schreiben des Starts, mit `verified` gegen den veröffentlichten Kontext; im Status für jeden Client. 1c: der Lauf-Prüfstand ist `run_basis.start`, nie der erste beobachtete Status. Wächter für frühes G92/G43.1/M6, späten Client, abgelehnten Start, Pause/Fortsetzen. |
| VP112-02 (R112) | Angenommen. | 1b: `published_origin` / `preview_origin`. |
| VP112-02 Rest (R113) | Angenommen. | 1b: `for_run` beim Planen des eingefrorenen Parses festgehalten, mit `tool_basis_rev` als Basisrevision. 3a: Zulassung vergleicht `for_run` mit dem laufenden `run_basis`; Lauf-1-Parse in Lauf 2 scheitert vor jedem Sweep. |
| VP112-02 Rest (R114) | Angenommen. | 1b: `run_basis.ctx` beim Laufstart festgehalten; der eingefrorene Parse im Lauf wird daraus gebaut, nur die Tabelle ist neu und eigens gebunden; der gebaute Kontext wird vor dem Dispatch gegen `ctx_digest` geprüft, `for_run` beim Veröffentlichen erneut. 3a: Datei und `source` ausdrücklich in der Zulassung. Wächter A → B → eingefrorener Parse, Änderung zwischen Planen und Bau, geänderte `source`. |
| VP112-03 (R112, R113) | Geschlossen (R114). | Die Position ordnet nur, sie schließt nichts aus. |
| VP114-01 | Angenommen — mit Codex' einfacherer Alternative. | 3b: keine Naht; die vorläufige Prüfung `[h, Ende]` steht benannt, bis die vollständige Prüfung von Punkt 0 sie ersetzt. Grenzkontakte und von einem Beginn vor `h` abhängige Folgezeilen heißen „vorläufig“ und werden nie zusammengelegt. 3c: Wächter mit Codex' Schneidfällen gegen den Vollsweep. Preis: `[h, Ende]` wird doppelt gerechnet. |
| VP112-04 | Geschlossen (R113). | Bleibt: Programmbasis, Grenzkontakt, keine fremden Zertifikate; der Grenzkontakt gehört jetzt nur zur vorläufigen Prüfung. |
| VP112-05 | Geschlossen (R113). | 3d präzisiert: „Ohne erkannte Tabellenänderung kein neuer Lauf-Auftrag“. |
| VP112-06 | Geschlossen auf Planebene (R113). | Bleibt; dazu `run-pos` nur Pose, Hinweis einmal beim Planen. |
| VP112-07 | Geschlossen auf Planebene (R113). | Bleibt. |
