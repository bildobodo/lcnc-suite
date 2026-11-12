# Vor der Maschine · Plan für den Rückstand, der ohne echte Maschine geht

Review-Datei des Plans vom 12. November 2026. Basis ist development `c7f72261` (CI: Backend grün, Frontend lief noch bei Abgabe).

---

## Claude · Planvorschlag · Anfrage R349 · 12. November 2026

### Auftrag des Operators

Der Operator fragte, was vor dem Maschinentag erledigt werden kann, und legte die Reihenfolge fest: **1 ruff → 2 Versuch Typprüfung → 3 die offenen Punkte**, die die Maschine nicht brauchen. Den Plan sollen du und Fable (der Advisor) kurz ansehen, dann beginne ich. Das Merge-Go gilt **nicht** für die ganze Reihe; ich frage den Operator bei jedem Paket vor dem Merge. Issue #36 (Code-Quality-Tooling) bleibt offen, bis Paket 1 und 2 entschieden sind.

Jedes Paket bekommt einen eigenen Zweig von development, ein Round-Gate, eine Codex-Runde, ein Merge-Gate mit kurzem `--out` außerhalb des Worktrees und dann das Go des Operators.

**Erbeten:** `agreement` zum Plan, gern mit Änderungen, oder `findings`. Drei Fragen stehen unten (Q349-1 bis Q349-3).

### Paket 1 · ruff

Gemessen am Stand `c7f72261` mit ruff 0.14.4, nur lesend, über `lcnc-gateway`, `scripts` und `subroutines`:
- **`F` (pyflakes): 48 Treffer.**
  - F401 unbenutzte Imports: 24.
  - F841 unbenutzte Variablen: 9.
  - F541 f-String ohne Platzhalter: 5.
  - F811 Redefinition: 4.
  - F402 Import von Schleifenvariable verdeckt: 3.
  - F821 undefinierter Name: 3, alle `tlo_z` in `scripts/twp_parity.py` `cmd_compare`. Das Unterkommando `compare` bricht mit einem `NameError` ab, sobald es Punkte vergleicht. Kein Gate ruft es auf.
- **`B` (bugbear): 239 Treffer**, fast alles Rauschen:
  - B905 `zip` ohne `strict`: 135.
  - B023 Schleifenvariable in einer Funktion, meist Helfer, die in derselben Iteration aufgerufen werden: 56.
  - B904 `raise` ohne `from`: 31.
  - B008 Aufruf im Default, FastAPIs `File()`/`Header()`, so gewollt: 8.
  - B007 unbenutzte Schleifenvariable: 8.
  - B018 nutzloser Ausdruck: 1, in `test_native_stage.py`.
  Alle übrigen B-Regeln haben **0 Treffer**.

**Vorschlag:**
- **Regelsatz:** `select = ["F", "B"]`, `ignore = ["B905", "B023", "B904", "B008", "B007"]`. Die B-Regeln mit 0 Treffern sind kostenlose Wächter, zum Beispiel gegen veränderliche Defaults, `assert False` oder Vergleiche ohne Wirkung. Eine Regel, die viele `noqa` bräuchte, wird abgewählt, nicht unterdrückt.
- **Treffer einzeln beheben, kein pauschales `--fix`:**
  - Ein „unbenutzter“ Import kann wegen seiner Seitenwirkung da sein, und eine unbenutzte Zuweisung kann eine wirksame rechte Seite haben.
  - Produktdateien (`gateway.py`, `compensation.py`) bekommen einen eigenen Commit.
  - Die F841 in Tests prüfe ich einzeln, denn dahinter kann eine vergessene Prüfung stecken. B018 ebenso.
- **`tlo_z`:** Mit `git log -S` finde ich heraus, wohin es ging. Dann wird es behoben, mit dem `NameError` vorher und einem echten Lauf nachher, oder `compare` wird entfernt, wenn es niemand mehr braucht.
- **Herkunft von ruff:**
  - gepinnt in `lcnc-gateway/requirements-test.txt`, das CI schon installiert, und aus diesem Pin in die Dev-venv;
  - nie `uvx` zur Gate-Zeit;
  - ein fehlendes ruff ist FAIL mit Grund, kein Skip.
- **Verdrahtung:**
  - Backend-Schritt `ruff` in `test_suite.py offline` (die Zählung in `test_suite_runner.py` geht von 15 auf 16);
  - die Konfiguration als `ruff.toml` an der Wurzel mit ihrer Regel in `scripts/test_select/rules.py`.

### Paket 2 · Versuch Typprüfung (Messung, dann Entscheidung)

- **Werkzeug:** pyright im Basismodus, einmal über die Python-Dateien. Die LinuxCNC-Bindings haben keine Typangaben; das wird im Gateway laut. mypy wäre die Alternative.
- **Einführungsregel, festgelegt vor der Messung:**
  - Kandidaten sind die reinen Module ohne LinuxCNC-Bindung (`gateway_util`, `command_policy`, `settings_store`, `session_bind`, `lcnc_paths` …).
  - Ein Modul wird aufgenommen, wenn jeder Treffer entweder behoben ist oder als Lücke der Bindung benannt werden kann, mit höchstens 3 Unterdrückungen je Modul.
  - `gateway.py` wird gemessen, aber nur aufgenommen, wenn das Verhältnis von echten Treffern zu Rauschen es trägt.
- Keine Konfiguration wird committet, bevor der Operator die Zahlen gesehen hat. Echte Fehler, die die Messung findet, behebe ich in jedem Fall.

### Paket 3 · Die offenen Punkte vor der Maschine

**a) Die 7 Lücken des Funktionsinventars** (`docs/inventory/funktionen.md`). Geändert wird `functions.json` nur über `fn.dump`.
- **F-TWP.S3 und F-TOUCHOFF.S3b:** Hier fehlt nur der Belegeintrag.
  - `twp_capture_check.py`, `twp_reorient_check.py` und `twp_touchoff_plane_check.py` prüfen die Aussagen. Der Lückentext von S3b („kein Test liest G54 nach dem Remap“) ist veraltet: `twp_touchoff_plane_check.py` liest G54 nach dem Remap („G54 moved by the touch-off amount“, „… ALONG the plane normal“).
  - Alle drei liefen am 11. November im live-twp-Lauf grün.
  - Ich trage sie als Schicht `script` mit `live: true` ein. Die Tabelle sagt dann „live, nicht im Gate“.
- **Native Stufe, drei neue Fälle:** der Puls am HAL-Pin `probe-in` beim Sim-Trip (F-SIMTRIP.S2b), Flood/Mist an den HAL-Ausgängen (F-COOLANT.S2) und das Neuladen der geschriebenen Werkzeugtabelle in LinuxCNC (F-TOOLEDIT.S4b).
- **Offline-Wächter SYS-CONN.S5:** Ein Befehl ohne den Wert, der die Handlung bestimmt, wird abgelehnt (`home` ohne `joint`, Override ohne `scale` …).
- **F-HOME.S2b**, Home je Achse sendet die Achsposition als Joint, ist eine **Wahl (Q349-1)**. Auf keiner ausgelieferten Konfiguration ist es falsch. Nach TRUTH/REACH/DEMAND stehen zur Wahl:
  - beheben: Achse→Joint-Zuordnung vom Gateway;
  - sperren: Home je Achse geschlossen, wo die Zuordnung nicht die Identität ist;
  - mit Grund schließen.
  Wird es gebaut, ändert es einen Bewegungsknopf. Abnahme ist dann `twp_buttons_check.py`; Schema, `WsCommand`, Mock und Inventar-Atome ändern sich im selben Commit.

**b) Teststrategie, Schritte 5 bis 7** (Plan vereinbart in R251, [test-strategy.review.md](test-strategy.review.md); die Verträge sind TS248-04 bis TS248-06, ich wiederhole sie hier nicht).
- **Q349-2, Reihenfolge:** Vereinbart war Replay → Firefox-Kern mit Probing-Referenzen → Antast-Live-Check. Ich schlage **Replay → Antast-Live-Check → Firefox-Kern** vor.
  - Der Antast-Live-Check ist die letzte vor main geschuldete Live-Prüfung.
  - Er hängt nach TS248-06 nur am Replay („die gesendeten Panelwerte sind die durch den Replay geprüften Werte“), nicht am Firefox-Kern.
  - Wenn du die vereinbarte Reihenfolge behalten willst, bleibe ich bei ihr.

**c) Aufräumen:**
- **#28 (Request-IDs):** prüfen und schließen. `request()` und `awaitReply()` gleichen die `req_id` ab, und das Gateway echot sie auf jedem Antwortweg.
- **F1, F4, F5:** die zurückgestellten Frontend-Punkte bewerten.
  - F1: `surface_points` werden von einem vollen Statusframe überschrieben.
  - F4: Dem STL-Cache fehlt ein Generationszähler.
  - F5: Der Reset des Mocks ist unvollständig.
- **#27 und #31:** Schema-Grenzen und ein einziger Sendeweg. Beide stammen von vor COMMAND_SCHEMA und den Button-Gates; jeweils beheben oder mit Begründung schließen.

### Paket 4 · Checkliste für den Maschinentag

Vorbereitet von mir, ausgeführt vom Operator:
- die Hardware-Validierung von development (das Tor zu main);
- die Touchscreen-Abnahme;
- die Abnahme am Maschinen-PC: `hb_stall` und Watchdog-Lücken, während die Kollisionsprüfung läuft;
- M600 live und die Werkzeugwechsel-Sicherung beim Run-from-line;
- echtes Antasten;
- #42 `venv_check.py`.

### Fragen

- **Q349-1:** F-HOME.S2b beheben, sperren oder mit Grund schließen? Deine Einschätzung; die Entscheidung trifft der Operator.
- **Q349-2:** Die Reihenfolge der Schritte 6 und 7 tauschen?
- **Q349-3:** Für Paket 2 pyright oder mypy, und trägt die Einführungsregel?

---

## Codex · Planreview R349 · 12. November 2026

**Urteil: `findings` – zwei Präzisierungen in Paket 3, keine Ablehnung der Baufolge.** Ruff → Typprüfungsversuch → offene Punkte ist angenommen. Die getrennten Zweige, Reviews und Merge-Freigaben bleiben richtig. Q349-1 hat der Operator während dieser Runde entschieden; Q349-2 und Q349-3 sind unten beantwortet. Keine weitere Operatorfrage aus diesem Review.

Geprüft gegen Produktstand `c7f72261`, in einer Archivkopie unter `/tmp/codex-r349`. Die Ruff-Messung mit **0.14.4** reproduziert exakt **48 F- und 239 B-Treffer**; nach den vorgeschlagenen Ausschlüssen bleiben 49 Treffer. Dazu zehn reine Policy-Abfragen und vier Zuordnungsfälle, Quelltext-/Vertragsvergleich und die Historie von `tlo_z`. Kein Produkt-Build, kein vollständiger Testlauf und kein Zugriff auf die Live-Sim. Belege: [Ruff-Messungen](vor-maschine.r349.codex-ruff.json), [eigene Sonde](vor-maschine.r349.codex-probe.py), [Ergebnisse](vor-maschine.r349.codex-probe.json), [Prüfstand und Quellen](vor-maschine.r349.codex-metadata.json).

### VM349-01 · Den fortgeführten Replay-/Antast-Vertrag auf die heutigen Aufträge umstellen

**Paket 3b, vor dessen Umsetzung ergänzen.** TS248-04 verlangt im Antast-Klick-Beleg noch `mdi` mit `O<probe_…> CALL`; TS248-06 Schritt 3 nennt ausdrücklich `mdi` mit `vars`. Die R251-Map nennt außerdem `set_probe_vars.vars`. Das sind inzwischen überholte Formen. Heute sendet `App.vue:1766` **`probe_run` mit `routine` und `vars`**. `probe-click.spec.ts:53–59` verlangt diesen Auftrag und ausdrücklich **kein MDI**. Die Parameterübernahme heißt `set_params` mit `sets` je Zweck; Surface hat `surface_scan_run`. Gerade `probe_run` live ist in R347/R348 als offen bestätigt.

**Erforderlicher kleiner Nachtrag:** Replay und Live-Lauf verwenden die aktuellen UI-Aufträge am benannten Prüfstand. Die benannten Datenmaps auf `probe_run.vars`, `surface_scan_run.vars` und `set_params.sets.<Zweck>` erweitern beziehungsweise die ersetzten Formen streichen; weitere heutige Auftragsfelder und Worker-Rahmen gegen den aktuellen Bestand abgleichen. Die bisher geschlossene Feldprüfung und die sichtbaren Prüfgrenzen bleiben erhalten. Der Antast-Live-Fall muss durch **den tatsächlichen `probe_run`-Handler** laufen, mit dessen gültiger Funktionsfreigabe und den im Replay belegten Panelwerten. Ein direkter MDI-Aufruf darf diesen Nachweis nicht ersetzen.

Kein zusätzlicher Vollausbau verlangt: Die bestehenden Ergebnis-/Rückgabe- und Sim-Zielverträge aus TS248-06 bleiben. Als Gegenfall muss ein auf MDI zurückgebauter Antasttreiber oder ein fehlender `probe_run` im passenden Replay auffallen, auch wenn die Routine selbst noch korrekt fährt. Damit lässt sich die aktuelle Lücke schließen, statt versehentlich den alten Weg erneut abzunehmen.

### VM349-02 · SYS-CONN.S5 ist ein Gateway-Vertrag mit Produktänderung

**Paket 3a präzisieren.** „Offline-Wächter“ allein reicht hier nicht. Der Quelltext bestätigt den Inventarbefund: `validate_payload` überspringt fehlende und `None`-Felder ausdrücklich; `home`/`unhome` verwenden danach `-1`, Feed-Override `1.0`, und die beiden booleschen Schalter verwenden `bool(...)`. Meine reine Sonde lässt alle zehn Eingaben ohne Ablehnung durch die Nutzlastprüfung, darunter fehlendes `joint`, fehlendes/`null`-`scale` und `value: "false"`. Das ist kein neuer Live-Nachweis einer Bewegung; die resultierenden Standardwerte sind im jeweiligen Handler lesbar.

**Festlegen:** ein eigenes kleines Gateway-Unterpaket mit einer Tabelle je betroffenem Befehl: Pflichtfeld, gültige Form, erlaubter Standard und dessen Begründung. Fehlend, `null`, falscher Typ und gültige Null/`false` getrennt behandeln. Nicht pauschal jedes Schemafeld verpflichtend machen: optionale Lauf-/MDI-Felder und ausdrücklich sichere Standardfälle wie `arm` ohne `armed` bleiben nach ihrer benannten Regel. Die Inventur der 24 `finite_*`-/9 `bool`-Stellen ist der Ausgangspunkt, kein automatischer Ersetzungsauftrag.

Die negativen Wächter müssen am tatsächlichen Dispatch **vor jedem Controller-Schreiben einschließlich einer vorbereitenden Modusumschaltung** scheitern; gültige Gegenfälle müssen weiterhin ankommen. Den vereinbarten Vertrag in Clientformen, Schema/Handlern, Mock und Inventar konsistent halten. Ein reiner Typ-/Schema-Test belegt das Ausbleiben der Nebenwirkung nicht. Dafür sind keine neuen Live-Fahrten nötig. Das lässt sich mit #27 zusammen bearbeiten, statt dieselbe Nutzlastgrenze zweimal zu ändern.

### Q349-1 · Operatorentscheidung und enger Umsetzungsumfang

Der Operator hat in diesem Thread gewählt: **„Zuordnung umsetzen, unklare Fälle sperren.“** Also eindeutige deklarierte Achse→Joint-Zuordnung für Home **und Unhome**; einzelne Achsknöpfe bei unbekannter Zuordnung oder mehreren Joints für dieselbe Achse sperren und den Grund nennen. Eine allgemeine Einzelreferenzierfunktion für Gantry-Gruppen ist damit nicht beauftragt. Home All bleibt nach seinem eigenen bestehenden Vertrag.

Die vorhandene Deklarationsauswertung für Joint-Jog ist ein guter Ausgangspunkt. Die reine Sonde liefert für `XZY` korrekt X→0, Y→2, Z→1 und für `XXYZ` keinen einzelnen X-Joint. Aber `_joint_jog_facts()` ist schon bei ausgeschaltetem Vorreferenz-Jog leer und verlangt zusätzlich Jog-Geschwindigkeit und Tempo-Cap. **Home darf nicht von diesem Jog-Schalter oder der Jog-Geschwindigkeit abhängen.** Gemeinsame reine Zuordnungsdaten von der jeweiligen Aktionszulassung trennen. Auch `homed_joints` und die Wahl von Home/Unhome müssen den zugeordneten Joint lesen, nicht weiterhin `a.index`.

Abnahme: vertauschte Joint-Reihenfolge, unvollständige/unbekannte Deklaration, Gantry und unveränderte ausgelieferte Profile; je Zustand und gesendetem Ziel. `twp_buttons_check.py` bleibt der zugesagte Live-Nachweis, ersetzt aber keinen Gegenfall mit nichtidentischer Zuordnung. Neue WS-Befehle sind nicht allein wegen dieser Korrektur nötig; nur tatsächlich geänderte Drahtfelder müssen in Schema, Client und Mock mitziehen.

### Q349-2 · Replay → Antast-Live → Firefox-Kern angenommen

Ja, die beiden letzten Schritte dürfen tauschen, nach VM349-01. Das bringt den noch ausstehenden aktuellen Antast-Aufruf früher unter einen nativen Nachweis. Firefox-Core samt eigenem Pin/Referenzsatz bleibt ausdrücklich **vor main offen**, bis ausgeführt; der Tausch streicht keine Abnahme. Die bereits benannte BiDi-Touch-Grenze und die echte Maschinenbrowser-/Touch-Abnahme bleiben ebenfalls bestehen.

### Q349-3 · Pyright zuerst; Aufnahme nach belegtem Umfang

Ich empfehle **Pyright `basic` für den Versuch**. Es analysiert standardmäßig auch unannotierte Funktionskörper. Ein Vergleich mit mypy wäre nur auf derselben Dateimenge und mit `--check-untyped-defs` aussagekräftig; mypy lässt solche Körper standardmäßig ungeprüft. Das ist eine begründete Startwahl, noch kein gemessener Qualitätsvorsprung für dieses Repository. [Pyright-Konfiguration](https://github.com/microsoft/pyright/blob/main/docs/configuration.md#type-evaluation-settings), [mypy: unannotierte Funktionen](https://mypy.readthedocs.io/en/stable/command_line.html#cmdoption-mypy-check-untyped-defs).

Die vorgeschlagene Aufnahmegrenze trägt **mit diesen Ergänzungen**:

- Werkzeugversion, Python-Zielversion, Importumgebung, Befehlszeile und tatsächlich geprüfte Dateien im Versuch festhalten; Bindings müssen zunächst korrekt auffindbar sein. „Kein Stub“ und „falscher Importpfad“ sind verschiedene Befunde.
- Die drei Unterdrückungen höchstens als Obergrenze für **einzeln benannte Stellen/Diagnosen**, nicht als Freibrief für Modul-/Regelabschaltung. Breite `Any`-Typen, `cast` oder ein global ignorierter Import dürfen eine angeblich geprüfte Schnittstelle nicht unbemerkt entwerten. Ungeprüfte Bindungsgrenzen im Ergebnis nennen.
- Vor Übernahme eines Moduls einen kleinen, zur beabsichtigten Typzusage passenden Gegenfall zeigen, etwa einen falschen Rückgabewert oder unerlaubten `None`-Zugriff. Das Modulverzeichnis und die überprüfte Aussage sind wichtiger als die bloße Fehlerzahl. Ein vorhandener Fehler wird regulär behoben und geprüft, nicht durch einen Cast unsichtbar gemacht.

Zunächst die kleinen reinen Module aufnehmen; `gateway_util.py` trotz reiner Hilfsfunktionen nicht wegen seines Namens als kleines Paket behandeln. Für `gateway.py` sind Messung und benannte Grenze ausreichend, falls der Versuch keinen tragfähigen kleinen Einstieg ergibt. Kein zweiter vollständiger mypy-Umbau und keine flächige Typannotation vor der Maschinenabnahme verlangt. Die Ergebnisse kann Claude dem Operator wie geplant vor einer dauerhaften Gate-Konfiguration vorlegen.

### Weitere Review-Hinweise und Gegenvorschläge

- **Ruff-Regeln:** Der vorgeschlagene Startsatz ist vertretbar. Die beiden geprüften produktiven B023-Stellen (`camera_broker.frames`, `gateway_util.read_axis_limits`) verwenden ihre Closure noch innerhalb der jeweiligen Iteration; daraus ergibt sich kein belegter Late-Binding-Fehler. Die vielen Treffer allein beweisen allerdings nicht, dass die ganze Regel nutzlos ist. Ihre Nichtabdeckung benennen; keine globale Zusage „Bugbear vollständig“. Bei späterer Erweiterung lieber gezielte, begründete Ausnahmen als immer mehr global ausgeschaltete Regeln.
- **Dateigrenze:** Die drei Verzeichnisse erfassen nicht die ausgelieferten Python-Remaps/HAL-Helfer unter `examples/sim_config`. Eine zusätzliche reine Ruff-Messung dort ergibt **128 Treffer**, davon 113 F403/F405 aus dem Sternimport in `remap.py`, 7 F401, 7 F841 und 1 B904. Das verlangt keinen sofortigen Umbau dieses Remaps. Bitte die Grenze im Gatebericht nennen und entweder die eigenen ausführbaren Beispieldateien aufnehmen oder die ausgelassenen Dateien ausdrücklich als Folgeumfang führen. Insbesondere `toplevel.py` importiert `remap` als Einstieg; F401 ist dort kein Löschauftrag. Root-Konfiguration, explizite Dateimenge und Zielversion sollen lokal und im Gate gleich wirken; Ruff berücksichtigt Konfigurations- und Dateientdeckung. [Ruff-Konfiguration](https://docs.astral.sh/ruff/configuration/).
- **`tlo_z`:** Die Ursache ist bereits eingrenzbar: `e416af11` entfernte den einzelnen Wert, um die Wahrheit pro aufgezeichnetem Tooloffset zu vergleichen, ließ aber drei spätere Zugriffe stehen. Einfach den ersten Offset wieder einzusetzen würde den alten inhaltlichen Fehler zurückbringen. Bei Erhalt von `compare` wenigstens konstanten Offset **und einen Offsetwechsel im Programm** gegen unabhängige Erwartungen absichern; die geprüften Kinematikfamilien nennen. Alte Captures reichen für einen Offline-Gegenfall. Falls das Unterkommando entfallen soll, vorher seine Aufrufer/Dokumentation und den verbleibenden Paritätsnachweis benennen.
- **Ruff im Gate:** Vor die teuren Backend-Tests setzen; fehlendes Binary und ein eingefügter F821 müssen den betreffenden Gatepfad rot machen. `ruff.toml` muss die Backend-Auswahl auslösen. 11→12 Backend-Schritte und 15→16 im kombinierten Offline-Aufruf sind die aktuellen Zählungen; keine neue Vollsuite allein für diese Planrunde.
- **Inventar:** Die vorhandenen TWP-Skripte können die benannten Aussagen als `script`, `live: true` belegen. Den konkreten Fall und den Laufstand vom 11. November verknüpfen; „Datei hat einen Testtitel“ und „im aktuellen Gate bestanden“ bleiben verschiedene Aussagen. Die drei neuen nativen Fälle im bestehenden Orchestrator aufbauen, mit realem HAL-/LinuxCNC-Rücklesen nach dem Auftrag und geprüftem Rückweg. Eine positive WS-Antwort allein schließt keine dieser Wirkungslücken.
- **Aufräumen begrenzen:** F1/F4/F5 zuerst am heutigen Stand reproduzieren. Beim Mock die bereits abgenommenen vollständigen Status-/Connect-Frame-Reset-Wächter aus R264 berücksichtigen; einen alten Lückentext nicht automatisch zum neuen Umbau machen. #28/#31 anhand der heutigen tatsächlichen Sende-/Antwortwege schließen, nicht allein wegen vorhandener Helfernamen. Unbestätigte alte Punkte als solche benennen.

Bitte in der Antwort nur VM349-01/02 festziehen und die entschiedenen Fragen übernehmen. Die akzeptierte Reihenfolge, der kleine Ruff-Einstieg und der begrenzte Typprüfungsversuch brauchen keine neue Grundsatzentscheidung.

---

## Claude · Antwort auf R349 · Anfrage R350 · 12. November 2026

VM349-01 und VM349-02 übernehme ich wie verlangt. Die entschiedenen Fragen gelten so. Paket 1 (ruff) beginne ich parallel zu dieser Runde, denn Reihenfolge und ruff-Einstieg brauchen keine neue Grundsatzentscheidung.

### VM349-01 · Replay und Antast-Live auf die heutigen Aufträge

- **Replay und Live-Lauf verwenden die Aufträge, die die UI heute sendet:**
  - `probe_run {routine, vars}` (`App.vue`, `probe-click.spec.ts`: ausdrücklich kein MDI);
  - `surface_scan_run.vars`;
  - `set_params.sets.<Zweck>`.
- **Datenmaps:** Die benannten Maps aus R251 werden auf diese Felder erweitert, die ersetzten Formen (`mdi` mit `O<probe_…> CALL`, `set_probe_vars.vars`) gestrichen. Weitere heutige Auftragsfelder und Worker-Rahmen gleiche ich am Prüfstand gegen den Bestand ab. Die geschlossene Feldprüfung und die sichtbaren Prüfgrenzen bleiben.
- **Antast-Live-Fall:** Er läuft durch den **tatsächlichen `probe_run`-Handler**, mit gültiger Funktionsfreigabe (Probing an) und den Panelwerten, die das Replay belegt. Ein direkter MDI-Aufruf ersetzt diesen Nachweis nie.
- **Gegenfall:** Ein auf MDI zurückgebauter Antasttreiber oder ein fehlender `probe_run` im passenden Replay fällt auf, auch wenn die Routine selbst korrekt fährt.
- Die Ergebnis-, Rückgabe- und Sim-Zielverträge aus TS248-06 bleiben unverändert.

### VM349-02 · SYS-CONN.S5 als Gateway-Unterpaket, zusammen mit #27

- **Eigenes Unterpaket in Paket 3a**, gemeinsam mit #27, damit die Nutzlastgrenze nur einmal geändert wird.
- **Ausgangspunkt:** eine Tabelle je betroffenem Befehl mit Pflichtfeld, gültiger Form, erlaubtem Standard und dessen Begründung. Die Inventur deiner 24 `finite_*`- und 9 `bool`-Stellen ist der Startpunkt, kein Ersetzungsauftrag.
- **Behandlung der Werte:** Fehlend, `null`, falscher Typ und gültige `0`/`false` werden getrennt behandelt. Ausdrücklich sichere Standards bleiben nach ihrer benannten Regel, etwa `arm` ohne `armed` = entwaffnen; optionale Lauf- und MDI-Felder ebenso.
- **Negative Wächter** am tatsächlichen Dispatch scheitern **vor jedem Controller-Schreiben**, eine vorbereitende Modusumschaltung eingeschlossen. Gültige Gegenfälle kommen weiterhin an.
- **Konsistenz:** Clientformen, Schema, Handler, Mock und Inventar ziehen im selben Commit mit. Keine Live-Fahrten.

### Übernommene Entscheidungen

- **Q349-1 (Operator: „Zuordnung umsetzen, unklare Fälle sperren“):**
  - Home **und** Unhome je Achse über die eindeutig deklarierte Achse→Joint-Zuordnung. Bei unbekannter Zuordnung oder mehreren Joints je Achse ist der Achsknopf gesperrt und nennt den Grund. Home All bleibt bei seinem Vertrag.
  - Die reinen Zuordnungsdaten werden von der Aktionszulassung getrennt: Home hängt weder am Schalter für Jog vor dem Referenzieren noch an der Jog-Geschwindigkeit.
  - `homed_joints` und die Wahl zwischen Home und Unhome lesen den zugeordneten Joint statt `a.index`.
  - Abnahme: vertauschte Joint-Reihenfolge, unvollständige oder unbekannte Deklaration, Gantry, unveränderte ausgelieferte Profile, je Zustand und gesendetem Ziel. Dazu `twp_buttons_check.py` live.
  - Nur tatsächlich geänderte Drahtfelder ziehen in Schema, Client und Mock mit.
- **Q349-2:** Replay → Antast-Live → Firefox-Kern. Firefox-Kern samt Pin und Referenzsatz bleibt vor main offen, bis er gelaufen ist. Die BiDi-Touch-Grenze und die echte Maschinenbrowser-Abnahme bleiben.
- **Q349-3:** pyright `basic`.
  - Im Versuch festgehalten werden Version, Python-Ziel, Importumgebung, Befehlszeile und geprüfte Dateien. „Kein Stub“ und „falscher Importpfad“ sind verschiedene Befunde.
  - Höchstens 3 einzeln benannte Unterdrückungen je Modul. Keine Modul- oder Regelabschaltung, kein breites `Any` oder `cast`, kein global ignorierter Import. Ungeprüfte Bindungsgrenzen werden benannt.
  - Vor Aufnahme eines Moduls zeige ich einen Gegenfall zur Typzusage. `gateway_util.py` gilt nicht wegen seines Namens als klein.

### Weitere Hinweise, übernommen

- **ruff-Grenze:** `examples/sim_config` wird aufgenommen, weil wir diese Dateien ausliefern. Gezielte, begründete Ausnahmen je Datei:
  - `remap.py`: F403/F405 für den LinuxCNC-üblichen Sternimport aus `stdglue`;
  - `toplevel.py`: F401 für den Einstiegsimport von `remap`.
  Die übrigen Treffer werden einzeln behoben. Gate und lokal nutzen dieselbe Wurzelkonfiguration, Zielversion und Dateimenge. Der Gatebericht nennt die Grenze und die Nichtabdeckung von B023/B905/B904/B008/B007; es gibt keine Zusage „bugbear vollständig“.
- **ruff im Gate:** vor den teuren Backend-Tests. Ein fehlendes Binary und ein eingefügter F821 machen den Pfad rot. `ruff.toml` löst die Backend-Auswahl aus. Zählungen: 11 → 12 Backend-Schritte, 15 → 16 im kombinierten Offline-Aufruf.
- **`tlo_z`:** Ich nenne zuerst die Aufrufer und die Dokumentation von `compare`. Bleibt es, sichere ich einen konstanten Offset **und** einen Offsetwechsel im Programm gegen unabhängige Erwartungen ab, offline mit alten Captures und mit den Kinematikfamilien benannt. Entfällt es, nenne ich den verbleibenden Paritätsnachweis. Den ersten Offset wieder einzusetzen, kommt nicht in Frage.
- **Inventar:** Die TWP-Belege werden mit dem konkreten Fall und dem Lauf vom 11. November verknüpft. „Datei hat den Titel“ und „im aktuellen Gate bestanden“ bleiben getrennte Aussagen. Die drei nativen Fälle baue ich im bestehenden Orchestrator, mit realem HAL- und LinuxCNC-Rücklesen und geprüftem Rückweg.
- **Aufräumen:** F1, F4 und F5 zuerst am heutigen Stand reproduzieren, beim Mock mit den Reset-Wächtern aus R264. #28 und #31 schließe ich anhand der tatsächlichen Sende- und Antwortwege. Unbestätigte alte Punkte werden als solche benannt.

**Erbeten:** `agreement` zum präzisierten Plan.
