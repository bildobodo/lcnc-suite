# Review: Zahlenfelder ohne Fokus-Diebstahl · Vorschau-Parse mitten im Lauf

## Anfrage R40 · Claude · Implementierungsprüfung · 29. September 2026

**Umfang:** `fd36324..dec119d` — zwei Commits, beide aus Operator-Beobachtungen
des Abends, beide im Live-Stand der Sim (`feat/viewer-palette` per Fast-Forward):

- `ee493e4` Number fields: a press takes no focus and selects nothing
- `dec119d` Preview: re-parse during a run when the program measured a tool

**Arbeitsort:** wie gehabt. In `~/lcnc-suite` nur an diese Datei anhängen und
`midrun-tool-reparse.r40.*`-Belege ablegen; keine Builds, Tests, Checkouts
oder Maschinenbefehle dort, kein `:5173`/`:8000`. Bitte eine Archivkopie von
`dec119d` nutzen. Die Sim läuft (XYZAC, `heavy_test.ngc` geladen).

### 1. Zahlenfelder (`ee493e4`)

**Beobachtung:** Wer mit der Maus über ein Zahlenfeld zieht, um den Wert zu
markieren, hat danach ein „totes“ Keypad.

**Ursache (reproduziert in Chromium und Firefox):** Jeder Mausdruck auf das
schreibgeschützte Zahlenfeld (zweiter Klick, Doppelklick, Ziehen) holte den
Fokus ins Feld. Das Keypad nimmt die physische Tastatur aber nur an seinem
eigenen Wurzelelement an (`NumberKeypadStrip` `@keydown`). Danach kam keine
getippte Ziffer mehr an; die Bildschirmtasten gingen weiter. Die Markierung
war nur das sichtbare Symptom.

**Änderung:**
- `MachineInput`: `pointerdown` mit Primärtaste auf einem Zahlenfeld wird
  default-prevented — kein Fokus, keine Markierung. Der Klick öffnet weiter
  das Keypad; Tab erreicht das Feld weiter, Enter/Leertaste öffnen.
- Ein Druck auf das Feld, dessen Sitzung schon offen ist (Label-Tipp, Enter
  nach Tab zurück), gibt den Fokus ans Keypad zurück: `refocusKeypad()` →
  `keypadState.focusTick` → der Strip fokussiert seine Wurzel.

**Wächter:** `e2e/input-session.spec.ts` (serial-guards): zweiter Klick,
Doppelklick, Ziehen über das Feld und Ziehen aus dem Feld heraus markieren
nichts, der Fokus bleibt außerhalb des Felds, Tippen läuft weiter ins Keypad;
Enter auf einem anders fokussierten Feld gibt ihn zurück. Rot bewiesen:
ohne die pointerdown-Sperre markiert der Doppelklick, ohne das Zurückholen
verschluckt der Enter-Pfad die Ziffer. serial-guards 178/178.

**Fragen:**
1. Siehst du einen Pfad, auf dem ein Zahlenfeld den Fokus braucht, den ein
   Mausdruck ihm früher gab (Fokusrückgabe nach OK/Cancel, Draft-Wiederaufnahme,
   Dialog-Initialfokus, `takeOpener()` — macOS Safari/Firefox fokussieren
   geklickte Buttons ohnehin nicht)?
2. Touch: `pointerdown.preventDefault` verhindert in Chromium/Firefox weder
   den Klick noch das Scrollen. Trägst du das mit, oder siehst du ein
   Touch-Gerät, auf dem der Tipp dann nichts mehr öffnet?

### 2. Vorschau-Parse mitten im Lauf (`dec119d`)

**Beobachtung:** Nach der programmeigenen Werkzeugmessung (`heavy_test.ngc`:
`T13 M600` → G10 L1) blieb die Vorschau für den ganzen Lauf ausgegraut, mit
den Limit-Flags der alten Länge.

**Ursache:** Alle Drift-Kanten sind idle-gegated (`drift_gate_open`), weil
der Worker seinen Startzustand live von der Maschine nimmt (Fixture,
WCS-Patches, Kinematik, Drehachsen, angewandter Offset, geladenes Werkzeug).
Mitten im Lauf ist das der Zustand des laufenden Programms. Das Programm
fräst direkt nach der Messung weiter; der Interpreter wird vor M2 nicht idle.

**Änderung — eine Kante, die während des Laufs parst, nur für die Tabelle,
mit eingefrorenem Startzustand:**
- `gateway_util.midrun_table_gate_open`: AUTO, Interpreter nicht idle, ein
  veröffentlichter ctx für die geladene Datei, 2 s Debounce. MDI (Measure
  Current) bewusst nicht: dort parst die Idle-Kante Sekunden später live.
- `evaluate_tlo_drift(table_only=True)`: nur `table_mtime` / `table_row`;
  G43 und M6 des Laufs sind keine Drift.
- `BulkPipeline.published_ctx` + `pinned_ctx()`: der ctx des veröffentlichten
  Parse unverändert (g5x_index, var_patches, kins_type/frame) + dessen
  Drehachsen-Startwert (`rotary_pose`, der vorhandene Golden-Hook) + dessen
  Werkzeug-Startwert (`seed_tool`) + `nice` 19. Live gelesen wird nur die
  Werkzeugtabelle (im Worker, über STAT).
- Timeout ×3; die Dauer eines eingefrorenen Parse geht nicht in
  `parse_ms_by_file` ein; `inflight["pinned"]` → `inflight_doomed_reason`
  verdammt ihn nicht wegen der Drehbewegung des Programms.
- Worker: `apply_nice` als erste Handlung (`__NICE__`); der Tabellen-Zeitstempel
  wird jetzt VOR dem STAT-Lesen gelesen (vorher danach: alte Zeilen + neue
  Zeit hätten die Kante auf veralteten Zeilen beruhigt; `table_row` feuert
  nach, bis sie übereinstimmen); `seeded_tool_meta` meldet im `__TLO__` den
  Startwert, nicht G43/M6 des Laufs — sonst verschwände der Idle-Parse nach
  dem Lauf.
- Client: Banner-Labels für die TLO-Gründe (sie kamen roh an: „table_mtime“)
  und „tool measured (program running)“; der Hinweis im Viewer sagt nicht
  mehr „re-parses when idle“.

**Was „die Vorschau“ damit im Lauf bedeutet:** das Programm, wie die Maschine
es ausführt — vom selben Start aus, mit der Tabelle, die sie jetzt hält. Das
ist der Grund, warum der eingefrorene Startwert der richtige ist und keine
Umgehung.

**Restlücke (dokumentiert):** Die Spindeltasche des Interpreters
(`StatMixin.tools[0]`) ist die live gesteckte. Ein `G43` ohne H vor dem
programmeigenen Werkzeugwechsel nähme im eingefrorenen Parse das Werkzeug,
das der Lauf geladen hat.

**Wächter (Unit):** Gate-Matrix; `table_only`; Doom-Ausnahme; `seeded_tool_meta`
inklusive der einen Idle-Drift nach dem Lauf; Pipeline: veröffentlichter ctx
= was der Worker bekam, eingefrorener Parse sendet den veröffentlichten
Startzustand statt Fixture/Patches/Kinematik/Pose des Laufs, aufeinander
folgende eingefrorene Parses behalten ihn, Timeout ×3, keine Historie,
eingefrorener In-flight-Snapshot, lauter Skip ohne veröffentlichten ctx,
Entladen vergisst ihn. Fünf Mutationen rot bewiesen. Gateway-Suite,
Frontend-Unit-Tests und Build grün.

**Live (Sim neu gestartet mit `dec119d`, `heavy_test.ngc`, Trip automatisch
per Helfer, der während einer Tastfahrt `probe-in` pulst):**

| Zeit | Ereignis |
|---|---|
| 23:06:34 | `tool_touch_off.ngc` startet (M600 im Programm) |
| 23:06:45 | Tabelle geschrieben → `gcode.reparse_table_midrun` table_mtime, `spawn_start pinned timeout_s 180` |
| 23:06:52 | Worker `__NICE__ 19`, parse 6,5 s |
| 23:06:53 | `gcode.publish pinned` (7,1 s nach der Messung, Programm fräst) |
| — | kein weiterer Parse während des Laufs |
| 23:11:35 | nach dem Lauf: ein Idle-Parse `tool_offset` (G43 H13 aktiv ≠ Startwert), veröffentlicht 23:11:42, danach Ruhe |

**Browser (Operator-Mac, Firefox, Beobachtungslauf, `browser.viewer.perf`):**

| Zeit | `path_stale` | Befund |
|---|---|---|
| 23:18:09 | true | Messung; Parse läuft (Banner) |
| 23:18:16 | true | `gcode.publish pinned` |
| 23:18:22 | false | Pfad wieder normal, 13 s nach der Messung (vorher: bis M2) |

Beim Eintreffen der neuen Vorschau ein Main-Thread-Block von 51 ms (`mt_late_max`,
`raf_gap_max` 51 ms), sonst durchgehend `raf_gap_p95` 18 ms. Zum Vergleich:
107 ms nach der Idle-Veröffentlichung im Lauf des Operators um 21:45.

**Fragen:**
1. Ist der eingefrorene Startwert vollständig? Gibt es einen weiteren Eingang,
   den der Worker live liest und der mitten im Lauf der Zustand des Programms
   ist (außer der dokumentierten Spindeltasche)?
2. `nice 19` statt SCHED_IDLE — trägst du die Begründung mit (ein
   Maschinen-PC, der seinen eigenen HMI-Browser rendert, würde einen
   Idle-Klassen-Parse unbegrenzt aushungern)?
3. Mitten im Lauf kommt eine neue Programm-Revision: Siehst du auf der
   Client-Seite einen Vertrag, den das bricht (Holds an der Revision,
   Run-Playhead, Kollisionsprüfung, GcodePanel)?
4. Zwei Messungen in einem Lauf: Die Kante feuert erneut (neue Tabellenzeit),
   der Startwert bleibt. Reicht das, oder muss eine laufende eingefrorene
   Parse bei einer zweiten Messung abgebrochen und neu gestartet werden
   (heute wartet die zweite, bis die erste veröffentlicht hat)?
