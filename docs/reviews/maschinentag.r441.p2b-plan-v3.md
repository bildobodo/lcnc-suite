## Claude · P2b-Detailplan v3: Lebensdauer einer Berechnung (Parse und Kollisionsprüfung) · nach R440 · 23. November 2026

Grundlage:
- der vereinbarte P2-Umfang (R418/R419, Punkt 3 „Lebensdauer einer Berechnung“, MT418-03);
- die in P2a benannte Grenze (der Halt deckt nur die Toolsetter-Kante ab);
- Codex R439/R440. In R440 sind angenommen: der Beginn-Haken, die Veröffentlichungsordnung, P2b-1 und P2b-2 (MT439-02 geschlossen). v3 beantwortet die beiden Reste von MT439-01: **A**, das tatsächliche Aktionsende, und **B**, die Klassifikation nach Wirkung.

Codestellen an development `594e333c`. **Planfreigabe erbeten, noch kein Code.**

### Was die Maschine am 22.11. zeigt (Arbeitshypothese, keine bewiesene Einsparung)

Offline aus der lokalen Trace-Kopie (ad16dff3, 74 min Fräsen mit kleinen Programmen, Simulation am Panel an), ausgewertet mit `~/claude-work/p2b/analyze_builds.py`; Rohdaten bleiben lokal.

| Messgröße | Wert |
|---|---|
| Parses | 20, je 0,6–1,9 s |
| Kollisionsprüfungen | 27 Starts, 19 fertig, 8 abgebrochen; die gemeldete Sweep-Zeit (`sweep_ms`) zusammen 2,4 s, höchstens 257 ms |
| Prüfungen, die alle Maschinenkörper senden (`bodies: 4`) | 9. Die nächste Fertigmeldung danach nennt jeweils ein neues `bvh_ms` von 62–94 s, zusammen etwa 711 s **verstrichene Zeit** (keine gemessene Kernzeit). Einer davon ist der erste der Seite; 8 folgen auf eine Änderung der Werkzeugmaße (`tool_loaded`, `tool_offset`, M600). |
| Abbrüche | alle 8 mit `progress: 0` |
| Hauptthread-Verspätung > 150 ms (`mt_late_max_ms`, 3-s-Fenster der sichtbaren Seite) | 25 der 38 Fenster **überlappen** zeitlich die 8 Bauphasen |

**Grenzen dieser Auswertung (MT439, P2b-1):**
- Der Bau ist dem nächsten geänderten `bvh_ms` zugeordnet, nicht über eine gebundene Identität aus Seite, Worker und Anfrage.
- `bvh_ms` ist verstrichene Zeit.
- Die Überlappung der 25 Fenster ist eine **Korrelation**.
- „8 vermeidbare Neubauten“ ist die **Arbeitshypothese**. Über CPU- und Lag-Ersparnis entscheidet der Vorher/Nachher-Lauf mit gebundenem Join (unten).

### P2b-1 · Das Kollisionsmodell überlebt einen Werkzeugwechsel (Browser) — angenommen, mit Erhaltungsregeln

**Heute:**
- `_colModelKey` (`ThreeViewer.vue:3966–3971`) enthält `_toolVisual(...)`. Jede Änderung der Werkzeugmaße ändert damit den Schlüssel, `sendBodies` (`:4035`) schickt alle Maschinen-STLs, und der Worker baut das ganze `CollisionModel` neu (`collisionWorker.ts:292–312`, `collision.ts:765ff`): Baum, DOFs, Paarzuordnung, BVHs und Werkzeugkörper.
- Die Basis des Werkzeugkörpers ist `model.baseTool` (`collision.ts:675–686`). Varianten je Programmwerkzeug entstehen je Sweep (`:1141–1160`).

**Vertrag:**
- **Schlüssel bzw. Invalidierung über alle modellbildenden Eingänge**, ohne die Werkzeugmaße:
  - der Maschinenbaum und die Gruppen samt Kinematik-/DOF-Deklaration (`_pfMachine(init)`, vollständig, nicht nur die Teilefelder);
  - je Teil: Id, Datei, Proxy, Gruppe, Lage, Stock- und Kollisionskennung;
  - die **tatsächlich geladene Mesh- bzw. Proxy-Version** (Geometrie-Cache-Kennung bzw. `?v=`-Stempel);
  - `unitScale`;
  - ob ein Werkzeugkörper existiert (Strukturbit, siehe unten).
  Ändert sich einer davon, wird ehrlich neu gebaut.
- **Basisvariante je Lauf, unveränderlich:**
  - Die Anfrage nennt ihr Live-Werkzeug (`tool`). Daraus entsteht **bei der Initialisierung des Laufs** eine Variante, die am Lauf hängt (`run.baseVariant`) und für dessen Initialisierung, Vorprüfung und jede Geometrieabfrage gilt.
  - **Kein** gemeinsames veränderliches `model.baseTool` mehr als Quelle: Das Modell kennt nur noch seinen Werkzeugkörper-Platz.
  - Vor **jeder** Geometrieabfrage eines Laufs nach einem Wechsel zwischen Haupt- und Seitenlauf, also nach jedem Yield, trägt der Körper die Variante dieses Laufs. Dafür gibt es ein Install-on-resume je Lauf, so wie heute die Programmwerkzeug-Varianten installiert werden; Prüfung über Geometrie-Identität (TWP-07).
  - Abschluss, Stop, Cancel und frühe Rückgabe eines Laufs stellen **nichts für einen fremden Lauf** ein und geben **keine Geometrie frei, die ein anderer lebender Lauf noch referenziert**.
- **Variantencache:**
  - begrenzt (8 Einträge je Worker-Instanz, LRU);
  - jeder Eintrag zählt seine lebenden Läufe; freigegeben wird er nur ohne Referenz.
- **Werkzeug vorhanden → keines → wieder vorhanden:**
  - Heute sendet die Seite immer `tool` (Ersatzmaße 6/60 mm, `ThreeViewer.vue:3030`).
  - Eine Anfrage ohne `tool` hat ein anderes Strukturbit und damit einen ehrlichen Neubau. Das kostet einmal, nicht bei jedem Wechsel, und ist benannt.
- **Pool-Fallback:**
  - Fällt ein Shard aus (`poolFailed`), läuft die Anfrage samt ihrer Werkzeugangabe auf dem Kern weiter. Der Kern baut, falls nötig, sein eigenes Modell; das ist eine erlaubte Instanz.
  - Die Basisvariante kommt aus der Anfrage, nicht aus einem Shard-Zustand.
- **Zusage:** **ein Bau je unveränderter Modellgeneration und benötigter Worker-Instanz**. Mehrere Shards bauen je eines; ein Worker-Neustart und eine ehrliche Geometrieänderung bleiben erlaubte Neubauten.
- **Telemetrie für den Join** (Seite, Worker-Instanz, Anfrage):
  - `sweep_start` nennt `page`, `id`, `model_gen` und `shards`;
  - jede Worker-Instanz meldet `model_built {instance, model_gen, ms}` bzw. `model_reused`;
  - `sweep_done` nennt `tool_variant_ms`.

**Wächter:**
- **Unit:**
  - Der Schlüssel ist invariant gegen Werkzeugmaße.
  - Er ändert sich mit jedem modellbildenden Eingang: Kinematik bzw. DOF bei gleichen Teilefeldern, eine neue Mesh- bzw. Proxy-Version, das Strukturbit.
- **Worker:**
  1. **Überlappung an Initialisierungs-Yields:** Ein Hauptlauf mit Werkzeug A pausiert in seiner Initialisierung; ein Seitenlauf mit Werkzeug B initialisiert und fragt Geometrie ab. Danach setzt der Hauptlauf fort, jeweils mit der eigenen Variante. Das Ganze in **beiden Größenreihenfolgen** (A < B und A > B), verglichen mit frisch gebauten Einzelmodellen.
  2. Ein Lauf endet bzw. wird abgebrochen, während ein anderer noch dieselbe Variante nutzt: Der andere läuft unverändert weiter, die Geometrie bleibt lebendig.
  3. Werkzeug vorhanden → keines → wieder vorhanden: Die Bauzahl folgt dem Strukturbit, die Kontakte stimmen.
  4. Pool-Fallback mitten im Lauf: Die Variante aus der Anfrage gilt.
  5. Der Cache bleibt bei 8, und es gibt keine Freigabe mit lebender Referenz.
  6. Orakel: ein längeres Werkzeug berührt einen Maschinenkörper, das kürzere nicht. Die Ergebnisse gleichen denen frisch gebauter Modelle.
- **Browser:** Werkzeugwechsel auf der Mock-Maschine: zweite Prüfung mit `model_reused` auf jeder Instanz, die schon gebaut hatte.
- **Vorher/Nachher-Lauf (Abnahme), Lastfolge wie am 22.11. auf der VM-Sim:** Laden → Lauf mit M600 → Werkzeugwechsel → Laden.
  - Gezählt werden Bauten je Instanz und Modellgeneration und Fenster > 150 ms Hauptthread-Verspätung, gebunden über Seite, Instanz und Anfrage.
  - Die Messung auf der Maschine folgt beim nächsten Besuch.

**Offen für P2e (nicht hier):** den kalten ersten Bau einmal je Gerät. Das ist eine Speicherfrage (die localStorage-Regel).

### P2b-2 · Eine Prüfung im Leerlauf wartet auf die Driftentscheidung und auf einen benannten Parse — Variante 1 gewählt (MT439-02)

**Heute:** Die Seite startet 400 ms nach dem Anlass (`_colScheduleAuto`, `ThreeViewer.vue:4240–4262`). Die Drift-Kanten entscheiden mit 2 s Entprellung im Leerlauf (`gateway.py:2178`, `gateway_util.py:1630`). Am 22.11. wurden 5 Prüfungen 1,4–5 s nach dem Start von der folgenden Drift-Veröffentlichung abgebrochen.

**Gewählt:** Variante 1 aus R439, zwei getrennte Wartephasen. Der 3-s-Ausweg gilt **nur** für die erste Phase, einmalig und benannt. Es gibt **keine** absolute Zusage „nie vor der Veröffentlichung“ und keine pauschale „kein Abbruch in 5 s“.

1. **Warten auf die erste Driftentscheidung:**
   - Das Gateway meldet je (Programmgeneration, Eingangsgeneration aus P2b-3) `drift_decision`: `pending` | `none` | `parse {job}`.
   - Gesetzt wird `pending` beim Leerlauf-Übergang und beim Ende einer Eingangsaktion (P2b-3). Beendet wird es durch die nächste vollständige Auswertung der Drift-Kanten (`none`) oder durch die Planung eines Parse (`parse {job}`).
   - Die Seite wartet höchstens 3 s auf eine Entscheidung. Danach startet sie einmalig und benannt (`collision.check_fallback {waited_ms}`).
2. **Warten auf einen benannten Parse und dessen Übernahme:**
   - Bei `parse {job}` wartet die Prüfung auf die Veröffentlichung **dieses** Jobs **und** deren Übernahme durch die Seite: dekodiert und adoptiert, unter Beachtung der vorhandenen Halte (`previewBasisPending`, `_holdApply`, Decode). Eine Status-Veröffentlichung allein ist noch keine Übernahme.
   - Der Parse hat seine eigene Grenze, das Zeitbudget des Gateways (`timeout_s`).
   - Endet der Job ohne Veröffentlichung (Fehler, Timeout, Cancel, Supersede), endet dieses Warten. Es folgt die neue Entscheidung bzw. die Prüfung auf der vorhandenen Vorschau, benannt.
- **Besitz des Wartens:** (Programmgeneration, Eingangsgeneration, Verbindung). Entladen, A→B→A, eine neue Schreibaktion, ein Fehler und ein Verbindungswechsel schließen es. Ein später Status mit älterer Generation schließt es nicht und öffnet kein neues.
- **Unverändert:** Eine Prüfung **im Lauf** ist an den Laufbeginn gebunden.
- **Der 30-s-Halt für alle Leerlauf-Kanten** (Antwort auf Frage 3, Bedingungen aus R439):
  - Er gehört **einer** offenen Bestätigung, dem Read-back-Versuch (Revision, Programm). Ihr Anker ist die Buchung, die die Basis angenommen ließ.
  - Andere Kanten beginnen die Frist **nie** neu.
  - Nach Ablauf parst die Kante mit der Basis, benannt „angenommen bzw. unbekannt“.

**Wächter (Gegenfälle aus R439):**
1. Laufende → Drift-Parse von 5 s → die Prüfung startet erst nach Veröffentlichung **und** Übernahme dieses Jobs; kein 3-s-Fallback, weil die Entscheidung `parse` früh kam.
2. Keine Entscheidung binnen 3 s → einmaliger, benannter Fallback.
3. Verspätete Übernahme (Decode-Halt) → die Prüfung wartet weiter auf die Übernahme.
4. Gescheiterter Parse → das Warten endet benannt.
5. Entladen bzw. erneutes Laden während des Wartens → alter Besitz geschlossen, kein Start auf der alten Vorschau.
6. Später Status einer alten Generation → kein Effekt.
7. 30-s-Halt: Eine andere Kante feuert mehrfach, der Anker bleibt.

**Abnahme:** Auf derselben Lastfolge kein Abbruch einer Prüfung durch einen Drift-Parse, der bei ihrem Start schon entschieden war. Abbrüche durch spätere echte Eingangsänderungen sind erlaubt und werden gezählt.

### P2b-3 · Generation einer Berechnung im Gateway: Entwertung vor der Wirkung (MT418-03, MT439-01)

**Heute:**
- **Abbruch und Veröffentlichung:** Ein Parse wird nur über `cancel_inflight` verworfen (`bulk_pipeline.py:649`, Prüfung `:878`). Die Veröffentlichung (`:1085–1130`) prüft keine Generation.
- **Entladen** (`gateway.py:2295–2300`) bricht einen laufenden Parse nicht ab. Dessen spätes Ende veröffentlicht die alte Datei kurz wieder.
- **Schreibungen** von Parse-Eingängen werden erst von der entprellten Drift-Auswertung gesehen.
- **Der `written`-Haken** von `_cmd_blocking` (`gateway.py:4027ff`, Aufruf nach dem Schreibaufruf `:4148`) läuft **nach** der Schreibung und bucht u. a. gesendete Jogs. Er ist **nicht** der Ort der Entwertung und behält seinen Auftrag.
- **Vorbild für den Ort:** Die Toolsetter-Buchung `_ts_mark_assumed` (`:4100`) steht schon **vor** dem Schreibweg.

**Vertrag:**
- **Zwei getrennte Zustände je Eingangsaktion:**
  1. **Queue-Besitz:** Ein zugelassener, wartender Auftrag einer Eingangsaktion (in der Warteschlange eines Clients oder in Bearbeitung) **hält** einen neuen Leerlauf-Parse auf, ohne zu entwerten. Eine Ablehnung vor der ersten Schreibung beendet nur diesen Besitz; die Vorschau bleibt gültig.
  2. **Schreibbeginn:** Der tatsächliche Beginn der **ersten möglichen Wirkung** entwertet die Generation, nach der letzten Zulassung und Link-Prüfung, unmittelbar vor der Wirkung.
- **Neuer Beginn-Haken:** `began=` an `_cmd_blocking` wird im Schreibthread aufgerufen, nach `admit` und der zweiten Link-Prüfung, **unmittelbar vor** `getattr(conn.cmd, …)(*args)`. Für Datei-Schreiber gibt es einen gleichwertigen Aufruf im Schreibthread unmittelbar vor dem Ersetzen der Datei.
- **Ordnung gegenüber der Veröffentlichung:**
  - Die Generation lebt in einem `threading.Lock`-geschützten Zähler.
  - Der Beginn-Haken erhöht ihn unter dem Lock.
  - Die Veröffentlichung prüft die Generation und legt die veröffentlichten Felder **unter demselben Lock in einem Schritt** fest, ohne `await` und ohne I/O im Abschnitt; `preview_version` wird zuletzt gesetzt.
  - Daraus folgt: Entweder liegt die Veröffentlichung vollständig vor dem Schreibbeginn (sie gilt dann für die Eingänge vor der Schreibung; deren Wirkung löst danach die Drift aus), oder sie wird verworfen. Ein später im Event-Loop ausgeführter `cancel_inflight` ist nur noch das Beenden des Prozesses, kein Veröffentlichungsverbot.
- **Aktionsbesitz bis zum tatsächlichen Ende (R440 Rest A):** Der Handler-Rücklauf ist **kein** Aktionsende. `_feature_job` schreibt den CALL mit `wait=None` und antwortet sofort `ok` (`gateway.py:6516–6522`); ebenso `run_macro` (`:6854`) und der allgemeine MDI-Weg. Deshalb:
  - **Laufgebundener Beobachter:** Der Beginn-Haken jeder Wirkungsschreibung legt einen Beobachter an, **noch vor** der Schreibung, gebunden an (Link, Kommando-Serial, Schreibzeit). Kommt der Schreibaufruf nicht zustande, wird der Beobachter mit `refused_before_write` verworfen, ohne Entwertung.
  - **Übergabe statt Ende:** Am Handler-Rücklauf geht der Aktionsbesitz an diesen Beobachter über; er endet nicht. Wirft der Handler **nach** einer erfolgten Schreibung, bleibt der Beobachter bestehen und die Wirkung gebucht.
  - **Startnachweis:** ein Poll **desselben Links**, der nach der Schreibung begann, mit `echo_serial_number ≥ Serial` (das Muster aus P4-1, `_poll_record`, `gateway.py:10581ff`). Er wird um RCS-`state`, `interp_state` und `task_mode` erweitert.
  - **Ende:** ein solcher Poll mit `echo_serial_number == Serial` und RCS-`state` ∈ {`RCS_DONE`, `RCS_ERROR`} **und** `interp_state == INTERP_IDLE`; oder ein Echo **über** Serial hinaus, denn dann hat der Controller einen späteren Befehl angenommen und dieser ist beendet. Dazu eine Fehlerkanal-Beobachtung nach dem Ende (`_status_cycles`), Ausgang `done` bzw. `error`.
  - **Unbekannter Ausgang:** Linkwechsel → `link_lost`; Abort bzw. E-Stop → `aborted`; kein Startnachweis binnen 1 s nach der Schreibung (die Echo-Frist aus P4-1) → `unknown`. Für `unknown` und `link_lost` liest der folgende Neustart die Basis neu bzw. nennt sie unbekannt.
  - **Was kein Ende ist:** „Leerlauf + Stillstand + 2 s“ vor einem belegten Start ist kein Ende; auch ein älterer Leerlauf-Status gilt nicht. Ein einzelnes `wait_complete` oder eine kurze Leerlaufbeobachtung zwischen zwei Schreibungen einer Aktion (Chunks → Moduswechsel → CALL) beendet sie ebenfalls nicht: Die Aktion endet erst, wenn **ihr letzter** Beobachter endet.
  - **Kein globaler Lock:** Der Beobachter hält **keinen** Befehls-Lock über die Antastbewegung; Stopps, `abort` und `estop` gehen durch wie heute. Er sperrt nur den Neustart des Leerlauf-Parse.
  - **Ohne Wirkung:** Ein nachweislich nie gesendeter Auftrag gibt den Queue-Besitz frei und entwertet nichts.
- **Neustart erst nach dem Ende aller Eingangsaktionen** (alle Clients): kein Queue-Besitz und kein lebender Beobachter. Danach gelten Leerlauf und Stillstand und 2 s Ruhe seit dem **beobachteten** Ende (die bestehende Entprellung, jetzt daran gebunden), und kein Halt ist aktiv (P2b-2). Danach entscheidet die Drift wie heute.
- **Entladen:**
  - erhöht die Programmgeneration;
  - `cancel_inflight("unload")`;
  - `reparse_pending` aus;
  - keine Veröffentlichung danach. Das gilt auch für A→B→A und das Laden desselben Pfads: jedes Laden ist eine neue Programmgeneration.
- **Benannte Ausgänge:** `gcode.parse_discarded {why, gen_at_spawn, gen_now}`. Die Aktion endet mit einem der Ausgänge `refused_before_write`, `done`, `partial`, `aborted`, `link_lost`, `unknown`. Ein Neustart nach `partial`, `aborted`, `link_lost` oder `unknown` liest die Basis neu bzw. nennt sie unbekannt.
- **Ausnahme:** Schreibungen des **laufenden AUTO-Programms** (G10, M600 in `G10 L1`) erhöhen die Generation nicht. Sie folgen dem bestehenden Vertrag des gepinnten Parse; ein gepinnter Parse wird nie umgebunden. Fremde GUIs am Gateway vorbei sieht das Gateway erst an der Datei- bzw. Drift-Kante.

**Karte je Eintrittsweg** (Beginn = Entwertung vor der ersten möglichen Wirkung, Ende = Ende des Aktionsbesitzes):

| Eintrittsweg | Erste mögliche Wirkung (Beginn-Haken) | Ende |
|---|---|---|
| WS `mdi`, `touchoff`, `clear_wcs`, `set_wcs`, `go_to_zero`, `set_kins_mode`, `twp_capture`, `tool_change` (über `_cmd_blocking`, Handler `_cmds_mdi_and_frames`, `_cmds_work_offsets`, `_cmds_machine_state`) | erster Schreibaufruf des Handlers. Ein vorangehender **Moduswechsel nach MDI/AUTO** zählt bereits (siehe Zeile `set_mode`) | Ende des **letzten Beobachters** (Rest A), nicht der Handler-Rücklauf |
| WS `probe_run`, `tool_measure`, `tool_unload_measure`, `surface_scan_run`, `run_macro` (`_feature_job` `:6450ff`, Parameter über `_apply_probe_vars_detail` `:6256ff`) | Moduswechsel bzw. erster Parameter-Chunk, je nachdem, was zuerst schreibt | Ende des Beobachters **des CALL** (`wait=None`, `:6516–6522`; `run_macro` `:6856`), also der tatsächliche Routineabschluss oder ihr benannter unbekannter Ausgang; Abbruch nach Chunk 1 → `partial` |
| WS `set_params` (`_apply_probe_vars_detail`: MDI-Chunks, danach die Datei nur mit den übernommenen Schlüsseln, `:6351`) | erster Chunk bzw. Moduswechsel | nach der Dateischreibung bzw. ihrem Fehler (Ausgang „übernommen, Persistenz nicht bestätigt“) |
| WS `set_g30`, `read_g30`, `capture_g30` (`_g30_command` `:11980`, Synch `_synch_interp_params` `:11847`) | `task_plan_synch` (schreibt die Parameterdatei), bei `set_g30` die MDI | nach der zweiten bestätigten Lesung bzw. dem benannten Ausgang |
| WS `save_tool`, `add_tool`, `delete_tool`, `renumber_tool` (`_persist_tool_edit` → `_write_tool_table_admitted` `:5139–5174` → `_reload_tool_table_and_bump` `:3306`) | **das Ersetzen der Datei** im Schreibthread, also vor dem NML-Reload | nach Reload und Metadaten |
| HTTP Werkzeugbibliothek: `/import-tool-library/apply`, `/refresh` (`_persist_imported_tools` `:3368`) | Ersetzen der Tabellendatei | nach Reload und Metadaten |
| HTTP `/upload` (mit `overwrite`), `/save` am **geladenen** Programm | `os.link`-Veröffentlichung bzw. Ersetzen der Datei | nach der Veröffentlichung |
| HTTP `/macro`, `/macro-upload`, `DELETE /macro` | Schreiben bzw. Löschen der Makrodatei (Unterprogrammpfad: ein Eingang, wenn das Programm sie ruft; vereinfachend immer) | danach |
| HTTP `/settings/{section}` | **keine** Parse-Eingabe. Die Toolsetter-Werte erreichen die Maschine nur über den Start-Sync (unten) bzw. `set_params` | — |
| Intern `_ts_read_back` (`:6037ff`, Synch) | `task_plan_synch` | nach der Buchung bzw. dem Ausgang |
| Intern `_toolsetter_sync` (`:6412`) beim Programmstart, `_start_guard` (`:5474`, #3116) | erste Parameterschreibung des Starts | Start geschrieben → ab da AUTO-Ausnahme; abgelehnt → `refused_before_write` bzw. `partial` |
| Intern `_rfl_sequence` / `_rfl_mdi_step` (`:5670`, `:5831`) | erster MDI-Schritt | AUTO-Start (Ausnahme) bzw. Ausgang |
| Intern `_reserved_fixture_heal` (`:8637`), `_stamp_wcs_rows` (`:8917`), `_ensure_prov_var_rows` (Datei, `:8996`) | jeweils die erste Schreibung bzw. das Dateiersetzen | Rücklauf |
| WS `set_mode` als eigener Auftrag (`_cmds_machine_state` → `set_mode` → `_cmd_blocking(op(command.mode, …))`, `:4192–4244`) und **jeder** andere Weg zu `set_mode` (Vorbereitung in `_feature_job`, `_apply_probe_vars_detail`, `_manual_command`, RFL, …) | **nach Wirkung, nicht nach Eintrittsweg (R440 Rest B):** Ein Wechsel **nach MDI oder AUTO** ist eine Eingangsschreibung, weil task dabei synch't und die Parameterdatei schreibt (emctask `emcTaskSetMode`, in CLAUDE.md belegt: „task synchs on every switch to MDI/AUTO“, live geprüft am 28.09.). Beginn-Haken vor `command.mode`, Beobachter bis `echo ≥ Serial` und `task_mode == Ziel`, sonst `unknown`. Ein Wechsel nach **MANUAL** synch't nicht und ist keine Eingangsschreibung (begründete Ausnahme). Ein Wechsel, den das frische Lesen als unnötig erkennt (`task_mode == mode`, `:4230`), schreibt nichts und entwertet nichts | Ende des Beobachters |
| Jogs, `home`/`unhome`, Spindel, Kühlmittel, Overrides, Pause/Resume, E-Stop/Abort | **keine** Eingangsschreibung; Rotary-Pose und Kinematik behandeln die bestehenden Doom-/Settle-/Drift-Kanten. Löst einer dieser Wege selbst einen Moduswechsel nach MDI/AUTO aus, gilt die Zeile `set_mode` | — |
| AUTO `auto_run`, `auto_step`, `cycle_start` | Ausnahme: gepinnter Parse | — |

**Vollständige Klassifikation:** Alle **68 Befehle** in `COMMAND_GATES` (nicht nur die 40 in `COMMAND_SCHEMA`) erhalten in `command_policy` eine Klasse: `input_action` (Eintrittsweg nach obiger Karte), `drift_only` oder `none`. Ein Wächter verlangt für jeden Befehl eine Klasse. Ein zweiter verlangt für jede Funktion, die `_cmd_blocking` mit `mdi`, **`mode`**, `task_plan_synch` oder `load_tool_table` ruft, sowie für jeden Aufrufer von `write_tool_table`, `_write_var_file_updates` und der HTTP-Veröffentlichung einen Beginn-Haken oder eine **begründete** Ausnahme. Ein `mode`-Aufruf ist ausgenommen nur mit dem Nachweis, dass sein Ziel nie MDI/AUTO ist. Eine Ausnahme allein wegen des äußeren Befehlsnamens zählt nicht. Der Scan arbeitet statisch, wie `controlInventory`.

**Wächter (Gegenfälle aus R439 MT439-01):**
1. Veröffentlichung **zwischen** Zulassung und Rücklauf einer blockierten Schreibung: Der Worker endet nach `began`, aber vor dem Rücklauf der Schreibung → verworfen.
2. Werkzeugdatei bereits ersetzt, NML-Reload noch nicht begonnen: ein Parse endet in diesem Spalt → verworfen.
3. Cancel nach dem ersten Parameter-Chunk → Generation erhöht, Ausgang `partial`, Neustart nach Aktionsende mit neu gelesener bzw. unbekannter Basis.
4. Ein weiterer Client mit Eingangsaktion steht schon in der Queue → kein Parse zwischen den Aktionen.
5. Linkwechsel bzw. Entladen während des Abschlusses → kein altes Publish, kein Parse mitten in der Aktion.
6. Ablehnung vor der ersten Schreibung → Generation unverändert, die Vorschau bleibt, nur der Queue-Besitz endet.
7. Drei Antastvorgänge in Folge → kein Parse zwischen ihnen, solange der nächste in der Queue steht.
8. `tool_measure` → genau ein Parse nach dem Read-back, mit bestätigter Toolsetter-Basis.
9. A→B→A mit spätem A₁-Ende → verworfen; Entladen während eines Parse → keine Veröffentlichung, kein Neustart.
10. **(R440 Rest A)** CALL geschrieben, Handler zurück (`ok`), Start- bzw. Echo-Beobachtung noch ausstehend, ein alter Leerlauf-Status steht länger als 2 s → **kein** neuer Parse; der Beobachter besitzt die Aktion.
11. **(Rest A)** Ergebnis und Abschluss kommen später → genau dann endet der Besitz, und der Neustart folgt nach 2 s Ruhe.
12. **(Rest A)** Abort bzw. Linkverlust nach dem Handler-Rücklauf → `aborted` bzw. `link_lost`, Neustart mit neu gelesener bzw. unbekannter Basis.
13. **(Rest A)** Weitere Eingangsaktion bereits eingereiht, während der erste Beobachter lebt → kein Parse dazwischen.
14. **(Rest A)** Handler wirft nach erfolgter Schreibung → Beobachter und Buchung bleiben; ein nie gesendeter Auftrag gibt nur den Queue-Besitz frei.
15. **(Rest A)** Während eines lebenden Beobachters gehen `abort`, `estop` und `jog_stop` sofort durch; kein Befehls-Lock wird gehalten.
16. **(Rest B)** Dieselbe Synch einmal als Vorbereitung einer Eingangsaktion und einmal über den eigenständigen Modusknopf (MANUAL → MDI) → in beiden Fällen dasselbe Veröffentlichungsverbot für einen in diesem Spalt endenden Parse.
17. **(Rest B)** Modusknopf in den Modus, in dem task schon ist → keine Schreibung, keine Entwertung. Wechsel nach MANUAL → keine Entwertung.

Dazu je Regel eine Mutation. **Nativ:** die erweiterte `parse-basis`-Variante mit `tool_measure` und Entladen während eines Parse an einem großen Programm.

### Reihenfolge und Abgrenzung

- **Reihenfolge:**
  1. P2b-1, klein und sofort wirksam auf die Lastfenster;
  2. P2b-3;
  3. P2b-2, das `drift_decision` und die Generationen aus P2b-3 nutzt.
- **Nicht in P2b:** P2c (zweistufiger Parse), P2d (Verlagerung), P2e (kalter Bau einmal je Gerät) und die Messung auf der Maschine.

**Erbeten:** `agreement` zum Plan v2 oder `findings`.
