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

---

## R40 · Codex · Implementierungsreview · 29.09.2026

**Stand:** `fd36324..306226a`, geprüft aus einem Archiv von `306226a`.
**Urteil: findings.** Die Zahlenfeld-Korrektur `ee493e4` ist abgenommen.
Beim Vorschau-Parse `dec119d` bleiben MR-I01 bis MR-I03 offen. Dafür ist keine
Operator-Entscheidung nötig; es sind reproduzierbare Implementierungslücken.

### MR-I01 · P1 · Der Werkzeug-Startwert erreicht die Interpreter-Spindeltasche nicht

`gcode_parse_worker.py:212` baut `PreviewCanon(s, random_tc)` weiterhin aus dem
aktuellen STAT. `StatMixin` übernimmt dabei `s.tool_table` einschließlich Tasche 0.
`seed_tool` wird erst nach dem gesamten Parse bei `seeded_tool_meta()` gelesen
(`gcode_parse_worker.py:1140`): Es verändert die gemeldeten Metadaten, nicht diesen
Eingang des Interpreters. Die in der Anfrage offen benannte Grenze ist deshalb
**nicht abnahmefähig**, solange der Parse als Vorschau vom eingefrorenen Start
veröffentlicht wird.

Reproduktion mit dem echten Worker und nativen Offline-Interpreter, ausschließlich
künstlichem STAT: Start T1/Z10; Programm beginnt mit `G43` ohne H, danach
`G0 X0 Y0 Z0` und `G1 X10 Z1 F100`. Während des Programms wird später T2 verwendet;
beim erneuten Parse steht deshalb T2/Z80 in der Live-Spindeltasche. Identischer
`seed_tool={loaded_tool:1, applied_tlo:[0,0,10]}`, identische T1-/T2-Tabellenwerte:

| Ergebnis | Spindeltasche T1 | Spindeltasche T2 |
| --- | ---: | ---: |
| berechnetes erstes TLO-Ereignis, Z | 10 | **80** |
| Z-max-Befunde bei Z-Limit 50 | 0 | **2**, an Zeilen 3 und 4 |
| gemeldeter Start in `__TLO__` | T1/Z10 | **weiter T1/Z10** |

Damit kann die Messung eines späteren Werkzeugs bereits abgearbeitete Abschnitte
mit einer anderen Werkzeuglänge berechnen und falsche Limitbefunde erzeugen.
Das ist mehr als eine Abweichung der Beschriftung.

**Korrektur:** Den Start-Werkzeugzustand dort anwenden, wo der Interpreter ihn
liest, einschließlich Spindeltasche/Toolchanger-Zuordnung. Die Tabellenzeile des
festgehaltenen Startwerkzeugs darf dabei die neue Tabellenlänge liefern; die
Werkzeugidentität darf nicht vom späteren Live-Spindelinhalt übernommen werden.
Ein durchgängiger Worker-Test mit Werkzeugwechsel und `G43` ohne H muss Bahn-/TLO-
und Limitdaten prüfen, nicht nur den an den Worker gesendeten Kontext oder
`__TLO__`. Falls ein Fall nicht sicher abbildbar ist, für diesen Fall ausdrücklich
bei der alten, als veraltet markierten Vorschau bleiben.

Beleg: [Worker-Probe](midrun-tool-reparse.r40.worker-probe.py),
[Ergebnis mit Kontext und sieben Parses](midrun-tool-reparse.r40.worker-probe.json).

### MR-I02 · P1 · Die Parameterdatei wird trotz eingefrorenem Kontext erneut live eingelesen

`gcode_parse_worker.py:219–224` kopiert bei jedem Parse die **aktuelle**
Parameterdatei. `var_patches` konserviert die Fixture-Zeilen, aber weder G92
(`#5210` ff.) noch G28/G30 oder sonstige nicht darin enthaltene Parameter.
Auch `__WCSOFF__` verwendet weiterhin `s.g92_offset` (`:1179`). Der veröffentlichte
`published_ctx` ist deshalb kein vollständiger Snapshot der ursprünglichen
Parse-Eingaben. Ein zwischenzeitliches Persistieren/Synch kann einen Zustand des
laufenden Programms zu dessen neuem Anfang machen.

Die native Probe hält alle 90 Fixture-Patches und den gesamten Kontext konstant
und verändert die Parameterdatei in getrennten Fällen:

- Nur G92 X 0→100: Die gelieferte Startbasis `wcs_basis.g92[0]` wechselt auf **100**.
- Nur G30 X / `#5181` 10→30: Derselbe Programmtext `G1 X#5181 Z1 F100` endet nach
  dem erneuten Parse bei **X30 statt X10**.

Das zweite Beispiel zeigt eine tatsächlich andere Bahn, obwohl nur die neue
Werkzeugtabelle übernommen werden sollte. Die reine Kontext-Gleichheitsprüfung
in `TestPinnedReparse` kann diese Änderung nicht sehen.

**Korrektur:** Die vom veröffentlichten Parse tatsächlich verwendete
Parameterbasis einschließlich G92 und der übrigen Parameter erhalten und für
seine Folge-Parses wiederverwenden. Die Herkunfts-/Drift-Metadaten müssen dieselbe
Basis abbilden. Ein Worker-Test muss nach dem ersten Parse die Parameterdatei
ändern und beweisen, dass ein eingefrorener Folge-Parse die alte Basis und die
neue Werkzeugtabelle verwendet. Ein normaler Idle-Parse soll anschließend wieder
den neuen Startzustand übernehmen.

Beleg: dieselbe [native Worker-Probe](midrun-tool-reparse.r40.worker-probe.json),
Fälle „only G92“ und „only G30 X“.

### MR-I03 · P2 · Ein während des Laufs verworfener Kollisionscheck startet bei IDLE nicht wieder

Der neue Midrun-Publish aktiviert einen bisher im normalen Ablauf vermiedenen
Client-Pfad: `ThreeViewer.vue:2911` löscht bei `viewerGcode` die bisherigen
Kollisionsresultate und ruft `_colScheduleAuto()` auf. Dessen einmaliger Timer
kehrt während AUTO nach 400 ms zurück (`:2884–2892`). Es gibt keinen erneuten
Anstoß beim Übergang nach IDLE. `_colOnInputChange()` hilft dann ebenfalls nicht:
Ohne Ergebnis oder laufenden Check kehrt es sofort zurück.

Eigene Browserprobe auf dem echten XYZAC-Modell mit kleinem synthetischem Preview:

1. Veröffentlichung im Leerlauf: **zwei Kollisionen** sichtbar.
2. Derselbe Payload als neue Revision während RUNNING: Befunde werden entfernt.
3. RUNNING→IDLE ohne weiteren Publish: Nach 2,5 s **weiter kein Kollisionsresultat**.
4. Positivkontrolle, derselbe Payload jetzt im Leerlauf neu veröffentlicht:
   **beide Kollisionen wieder da**.

Ein weiterer Idle-Parse ist nicht garantiert: Ein Programm kann mit demselben
Werkzeug, angewandten Offset, Fixture und Rotary-Zustand enden, mit dem es
begonnen hat; die Tabelle wurde bereits durch den Midrun-Parse übernommen.
Die automatische Kollisionsprüfung muss deshalb unabhängig von einer weiteren
Parse-Revision wieder anlaufen.

**Korrektur:** Einen während des Laufs aufgeschobenen Check merken und beim
nächsten zulässigen Leerlauf für den noch aktuellen Track starten. Den Fall
„Midrun-Publish, dann IDLE ohne weitere Eingangsänderung“ als Browser-Wächter
aufnehmen. Alte Befunde zu löschen ist richtig; der Wiederanlauf fehlt.

Belege: [Browser-Sonde](midrun-tool-reparse.r40.browser-probe.ts),
[rote Schlussassertion](midrun-tool-reparse.r40.browser-probe.txt),
[Vorher/Lauf/IDLE/Positivkontrolle](midrun-tool-reparse.r40.midrun-client.json),
[Bild nach IDLE](midrun-tool-reparse.r40.after-idle.png).

### Antworten auf die sechs Fragen

**Zahlenfelder 1 — benötigter Mausfokus:** Kein weiterer Befund. Der Opener wird
explizit aus `e.currentTarget` gespeichert; er hängt nicht vom vorherigen
`activeElement` ab. Entwurfswechsel, wiederholter Klick/Doppelklick/Ziehen,
physische Eingabe sowie Fokusrückgabe nach OK/Discard/Schließen bestehen in den
gezielten Browserprüfungen. Tab bleibt möglich; Enter/Space öffnen bzw.
refokussieren die bestehende Sitzung. `refocusKeypad` setzt den Ausdruck nicht
zurück. Auch die geprüften Dialog-/Tab-Wechsel bleiben funktionsfähig.

**Zahlenfelder 2 — Touch:** Zustimmung zum Ansatz. Bei Pointer Events verhindert
`preventDefault(pointerdown)` nicht das spätere `click`; Panning wird über
`touch-action` geregelt. Das ist der
[W3C-Vertrag für Pointer Events](https://www.w3.org/TR/pointerevents3/#compatibility-mapping-with-mouse-events)
und [direkte Manipulation](https://www.w3.org/TR/pointerevents3/#the-touch-action-css-property).
Die geprüften Chromium-Touch-Taps öffnen die Zahlenfelder weiterhin. Daraus folgt
keine getestete Freigabe sämtlicher iOS-/Safari-Geräte; einen konkreten Fehler
habe ich hier nicht gefunden.

**Parse 1 — weitere Live-Eingänge:** MR-I01/MR-I02 müssen geschlossen werden.
Zusätzlich liest `StatMixin.get_block_delete()` den aktuellen Schalter; die Sonde
zeigt bei identischem Kontext die Aufnahme bzw. Entfernung einer `/G1 X123`-Zeile.
Diese gewollt bedienbare Laufoption braucht eine ausdrückliche Beschreibung im
Vertrag; „nur die Tabelle wird live gelesen“ stimmt auch deshalb nicht. Weitere
Live-Lesezugriffe betreffen STAT-Achsmaske/-Einheiten und Joint-Limits sowie INI,
Programm- und Subdateien. Aktuelle Limits als Validierungsgrundlage sind sinnvoll;
sie sind von einer eingefrorenen Interpreter-Startbasis zu unterscheiden.

**Parse 2 — nice 19:** Die Entscheidung trage ich mit. Die absolute Begründung
„SCHED_IDLE würde unbegrenzt aushungern“ und „nimmt nie CPU von LinuxCNC“ sollte
abgeschwächt werden: Die [Kernel-Dokumentation](https://www.kernel.org/doc/html/latest/scheduler/sched-design-CFS.html#scheduling-policies)
beschreibt SCHED_IDLE als schwächer als nice 19, ausdrücklich aber nicht als
reinen Idle-Timer-Scheduler. nice 19 ist eine nachvollziehbare Priorisierung,
keine Garantie für Echtzeit- oder Speicher-/I/O-Latenzen. Timeout-Verlängerung und
der Ausschluss aus der normalen Parse-Zeithistorie sind schlüssig. Keine zusätzliche
Lastprüfung auf der Live-Sim vorgenommen.

**Parse 3 — Client-Verträge:** MR-I03 ist offen. Die eigene Probe bestätigt
ansonsten: Die Zeitleiste hängt sich nach dem neuen Payload beim nächsten Status
wieder an die Position, zeigt **L6 / Position 110 / ungefähr 14 %**, und das
GcodePanel markiert L6. Kein Sim-Eintritt, keine gesendeten Befehle. Die vorhandene
Bindung von Holds an die Revision bleibt konservativ: Eine laufende Bestätigung
wird bei neuer Revision abgebrochen. Identischer erneut geladener Text löscht die
Zeilenauswahl nicht; während des Text-Fetchs bleiben textabhängige Startaktionen
wie bisher gesperrt. Im Code kein weiterer Vertragsbruch gefunden.

**Parse 4 — zweite Messung:** Kein zwingender Abbruch/Neustart allein wegen einer
zweiten Messung. Single-flight plus erneuter Vergleich mit der **tatsächlich
geparsten** Tabelle ist vertretbar und verhindert bei mehreren Messungen ein
ständiges Verwerfen fast fertiger Parses. Die zweite Änderung darf dabei nicht
als bereits abgearbeitet gelten. Einen Wächter für „Tabelle ändert sich während
eines eingefrorenen Parses → anschließend genau ein Folge-Parse mit derselben
Startbasis und letzter Tabelle → danach Ruhe“ ergänzen. Für die Abnahme zuerst
die belegten Startbasis- und Wiederanlaufprobleme schließen.

### Prüfung und Belege

- Archiv-Build (`vue-tsc -b`, Vite): **PASS**.
- Backend `test_bulk_pipeline`, `test_gateway_util`: **408 PASS**.
- Vitest `useNumberKeypad`, `statusStore`: **35 PASS**.
- Gezielt ausgewählte `input-session`-Browserprüfungen: **11 PASS**,
  einschließlich Touch und Portrait bei 100/150 %.
- Eigene native Worker-Probe: sieben fehlerfreie Parses; vier verletzte
  Gleichheitsbedingungen belegen MR-I01/MR-I02.
- Eigene Midrun-Browserprobe: Zeitleistenprüfung und Positivkontrolle erfolgreich,
  Schlussassertion zum Wiederanlauf **ROT** (MR-I03).

[Reproduktion, Laufbefehle und Grenzen](midrun-tool-reparse.r40.reproduce.md).
Alle Prüfungen im Archiv, niedrig priorisiert und mit eigenem Mock auf
`127.0.0.1:4188`; Browser und Mock beendet. Produktcode und bestehende Belege
unverändert. Claudes Live-Messung wurde gelesen, aber nicht an der laufenden
Operator-Sim wiederholt.
