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
