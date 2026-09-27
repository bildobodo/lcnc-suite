# XYZAC-Sim: Z-Nullpunkt oben, M600/M601 — Implementierungsprüfung

Branch `fix/xyzac-z0-m600` aus `development` (`3e501ed`), Worktree `~/lcnc-suite-xyzac`. In
`feat/viewer-contrast` (Live-Checkout `~/lcnc-suite`) mehrfach hineingemergt, zuletzt `be421f4`.
Merge nur nach `development`.

## Anfrage Claude · Runde 15 · 27. September 2026

**Anlass:** Der Operator lud auf der 5-Achs-Sim (XYZAC) ein Programm mit M600 und erhielt „M-code
greater than 199: M600“. Die Konfiguration hatte weder Remaps noch Unterprogrammpfad, und ihr
Maschinen-Z0 lag unter dem Verfahrweg (Z 100..500). Die gebündelten Routinen setzen aber
LinuxCNCs Konvention voraus: Z0 ist die Oberkante (`G53 G1 Z0` als Rückzug, `ABS(#3102)`).
Operator-Entscheidung: den Z-Nullpunkt verschieben.

### Commits

| Commit | Inhalt |
|---|---|
| `9952357` | Z-Datum: Gruppe `frame` −500, `c_work`, `z-rot-point −500` (gegen den kompilierten Kins-Orakel geprüft), Z −400..0, HOME 0; `test_5axis_xyzac.py` 4/4 |
| `09bf368` | M600/M601 als kinematikbewusste Wrapper in `remap_subs` (Messen in Identität, TCP zurück; auf XYZAC ist M429 Identität, M428 TCP), RS274NGC-Block, `#<_webui_kinstype>`-Spiegel in 428/429, Toolsetter G53 X150 Y0 Z−300 |
| `46f538f` | `install_examples.py`: einmalige Migration einer Installation von vor dem Umzug (INI-Datumsschlüssel, G5x/G28/G30-Z, Position) und fehlende Suite-Remaps/RS274NGC-Schlüssel für jedes Profil |
| `073048e` | Migration: die Fallback-Nullen der WebUI (#3100–#3102 = 0/0/0) werden wie die alte Vorlage ersetzt, nicht verschoben (verschoben lag die Platte bei Z −500, unter dem ganzen Fenster) |
| `cb48316` | `tool_touch_off.ngc`: `#<_ini[DISPLAY]DEBUG>` hinter `EXISTS` (ohne den Schlüssel brach jedes M600 ab) |
| `f3dba26` | Gateway `set_probe_vars`: `mdi_set` über `_cmd_rc_failed` (RCS_DONE = 1 galt als Fehler) |
| `472d454` | XYZAC-Vorlage: „Return to start position“ (#3106) aus; README |
| `4c67822` | `docs/decisions.md`: Live-Prüfung |

### Nachweise

- **Offline:** `test_example_install.py` 15/15 (5 neue, rot vorher), `test_command_dispatch.py` mit
  neuem Test (rot vorher: Spion liefert jetzt die 1 des Bindings), `test_5axis_xyzac.py` 4/4
  (8000 Vergleiche, max. 2,27e-13).
- **Live** am migrierten Sim des Operators, über den WS-Pfad der WebUI (Skripte im Scratchpad):
  - Migration: Backup `~/linuxcnc/config-backups/lcnc_suite_sim/20260927T132644.739785Z/`,
    G54 Z 280 → −220, G30 Z 473,725 → −26,275, G55–G59.3 Z 0 → −500, Toolsetter 0/0/0 →
    150/0/−300.
  - M600 in Identität und unter TCP (TCP danach wiederhergestellt), aus der Oberkante mit längerem
    Werkzeug (42 → 62 mm).
  - → G30, → Home, → Zero jeweils aus Z −200; → Zero an der Oberkante senkt nicht.
  - Nach Neustart: `mdi_set: True`.
- `twp_buttons_check.py` ist TWP-spezifisch (M428 = Machine dort, B-Achse, Capture) und lief auf
  XYZAC nicht.

### Bitte prüfen

1. Die Migrationsregeln (`install_examples.py`): Erkennung (`xyzac_before_datum_move`), welche
   Parameter verschoben werden (G92 bewusst nicht), die Toolsetter-Regel als explizite Menge
   statt „innerhalb des alten Fensters“ (die Platte liegt, wo die SPITZE berührt; ein langes
   Werkzeug erreicht eine Platte unter dem Nasenfenster), Einmaligkeit.
2. Die M600/M601-Wrapper: Quelle der Kinematik in Task (`#<_hal[motion.switchkins-type]>`) und
   Vorschau (`#<_webui_kinstype>`), Verhalten bei Fehler oder Abbruch unter TCP (bleibt in
   Identität — README und decisions benennen es).
3. Die Einordnung von #3106 = 0 als Vorlagenwert statt einer Änderung an der Routine.

### Zwei Befunde, zu denen ich vor der Korrektur deine Regel möchte

**B1 — Die WebUI schreibt Fallback-Nullen in die Maschine.**
- XYZAC hatte keinen gespeicherten `toolsetter`-Abschnitt. `buildToolsetterVarMap()` liefert dann
  `TOOLSETTER_FALLBACK` (alles 0).
- Das Formular (`saveTsParams`), Measure Current und Unload (`measureAuto`/`unloadTool`,
  App.vue) schicken diese Werte per `set_probe_vars` an die Maschine.
- **Beleg:** Die installierte Var-Datei im Backup hat 3004–3007, 3009, 3010, 3100, 3102–3104 und 3106
  = 0, wo die Vorlage Werte hatte.
- Für den Operator ist das behoben: Der Abschnitt ist über den Speicherpfad des Gateways gesetzt.
  Offen ist das Produktverhalten. Zwei Kandidaten:
  - **(a)** Measure Current und Unload (m600) sind gesperrt, solange der Abschnitt nie gespeichert
    wurde. Der Grund steht am Control, zum Beispiel „Toolsetter not set up — Probing tab“.
  - **(b)** Das Formular wird aus der Maschine gefüllt (`get_probe_vars` existiert, hat aber
    keinen Aufrufer im Frontend).
- Meine Empfehlung: (a) jetzt, (b) als Folge.

**B2 — Der Resolver übernimmt ein Unterprogramm als geladenes Programm.**
- `resolve_loaded_file` übernimmt `STAT.file` bei jedem Leerlauf.
- Ohne geladenes Programm endet ein MDI-Aufruf, der in einem Unterprogramm mit **Fehler**
  abbricht, mit `STAT.file` = Unterprogramm. Der Resolver übernimmt dann
  `remap_subs/m600.ngc` als Programm, samt Vorschau.
- Reproduziert: Vorschub 0 → „Cannot probe with zero feed rate“ → `active_file` =
  `…/remap_subs/m600.ngc`, `gcode.refresh_scheduled reason=file`.
- Nicht betroffen: vollständige oder abgebrochene Aufrufe, und jeder Fehler bei geladenem
  Programm.
- Der Docstring verspricht das Gegenteil („an MDI o-word probe with no program loaded must not
  adopt the probe sub“).
- **Vorgeschlagene Regel:** Eine Datei unter einem Verzeichnis aus `[RS274NGC] SUBROUTINE_PATH`
  ist nie ein geladenes Programm. `PROGRAM_PREFIX` wird ausgenommen, weil der Interpreter auch
  dort Unterprogramme sucht. Der Fall wird wie jede ignorierte Umschaltung getraced.

---
