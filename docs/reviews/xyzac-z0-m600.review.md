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

## Codex · Runde 1 zu XYZAC-Z0/M600 (Handshake R15) · 27. September 2026

**Geprüft:** `3e501ed..48fca17`, im Live-Checkout zusammengeführt als
`0644289b51efe9965500cc92677b906fe8eb0562` auf `feat/viewer-contrast`.
**Ergebnis: findings — fünf offene P2-Befunde an der Migration (XZ-01–05).**
Die Regelfragen B1/B2 sind unten beantwortet; eine Operator-Entscheidung wird für die
genannten Korrekturen nicht benötigt. Kein Implementierungs-Agreement für die Migration.

### XZ-01 · P2 · Der unveränderte alte G30-Default wird zur unerreichbaren Wechselposition

**Stelle:** `scripts/install_examples.py:85`, verwendet durch
`subroutines/tool_length_probe/tool_touch_off.ngc:217`.

Die alte ausgelieferte `xyzac5/sim.var` enthält G30 X/Y/Z = 0/0/0 und `#3108 = 0`
(Vorpositionieren aktiv). Eine Migration genau dieser unveränderten Datei ergibt
**G30 Z −500**, bei neuen Z-Grenzen **−400…0**. M600 fährt vor dem Werkzeugwechsel
mit `G53 G1 … Z#5183` dorthin; derselbe Pfad gilt für T0/Unload. Damit kann die neu
hinzugefügte M600-Funktion auf einer normalen Altinstallation bereits an der
Wechselposition abbrechen. Der dokumentierte Live-Fall mit G30 Z 473,725 → −26,275
deckt diesen ausgelieferten Default nicht ab.

**Korrektur:** Einen nachweislich unbenutzten alten G30-Default in eine gültige neue
Wechselposition überführen oder die Vorpositionierung bis zur Einrichtung ausdrücklich
sperren. Individuell eingerichtete, gültige alte G30-Positionen weiterhin verschieben.
G28 entsprechend prüfen; G5x-Nullen sind davon zu unterscheiden, da ein Werkstücknullpunkt
unterhalb des Spindelnasenfensters zulässig ist. Wächter: originale alte Var-Datei,
G30 nach Migration im Maschinenfenster sowie unverändert richtige Verschiebung der
individuellen G30-Position. Beleg: Fall `normal_old` der
[Installer-Sonde](xyzac-z0-m600.r15.migration-probe.py) und ihrer
[Messwerte](xyzac-z0-m600.r15.migration-probe.json).

### XZ-02 · P2 · Frisch erzeugte Zustandsdateien werden nochmals verschoben

**Stelle:** `scripts/install_examples.py:226` und `:239`.

Existiert eine alte INI, fehlt aber `sim.var` oder `position.txt`, befüllt der Installer
die Datei aus der **bereits verschobenen neuen Vorlage**. Der anschließende
Migrationsblock behandelt `writes[rel]` dennoch als alten Zustand. Gemessen:

| Fehlende Datei | Ergebnis | Erwartung für den neu erzeugten Seed |
|---|---|---|
| `sim.var` | G54 Z **−1000**, Toolsetter Z **−800** | G54 Z −500, Toolsetter Z −300 |
| `position.txt` | gespeichertes Joint-Z **−500**, außerhalb −400…0 | Joint-Z 0 |
| beide | beide Fehler gleichzeitig | beide neuen Seeds unverändert |

Der zweite Installationslauf repariert das nicht, weil die INI dann bereits auf dem
neuen Datum steht. **Korrektur:** Die Herkunft jedes Zustandsinputs mitführen: nur
übernommene alte Dateien verschieben, neue Vorlagendateien unverändert übernehmen.
Wächter für beide Einzelfälle und deren Kombination, jeweils einschließlich zweitem Lauf.
Beleg: `missing_var`, `missing_position`, `missing_both` in den
[Installer-Messwerten](xyzac-z0-m600.r15.migration-probe.json).

### XZ-03 · P2 · Gespeicherte WebUI-Toolsetterwerte stellen das alte Datum wieder her

**Stelle:** `scripts/install_examples.py:234`; weitere Datenquelle:
`lcnc-gateway/gateway.py:2721`, `lcnc-webui/src/toolsetterVars.ts:5` und
`lcnc-webui/src/App.vue:1088`.

Die Migration ändert die Var-Datei, berücksichtigt aber den vorhandenen per-INI-Abschnitt
`toolsetter` in `lcnc-gateway/settings.json` nicht. In der isolierten Installation mit
vollständig gespeicherter Konfiguration und Toolsetter Z 300 wird `#3102` korrekt **−200**;
`toolsetter.touchZ` bleibt jedoch **300**. Die echte Frontend-Funktion
`buildToolsetterVarMap()` erzeugt daraus wieder **`3102: 300`**. Formularänderung,
Measure Current oder Unload können somit die eben migrierte Position zurückschreiben.
Das betrifft eingerichtete Abschnitte und wird durch eine Sperre nur für fehlende
Abschnitte nach B1 nicht gelöst.

**Korrektur:** Beide persistierten Darstellungen des betroffenen INI-Datums gemeinsam
behandeln, mit Backup und Einmaligkeit. Alternativ den alten Abschnitt ausdrücklich als
erneut zu bestätigen markieren und sein Schreiben bis dahin sperren. Andere INIs und
relative Größen wie `spindleZeroHeight` nicht verschieben. Die bekannten Zahlenpaare
der Altvorlage/Fallbacks ersetzen keine Herkunftsinformation: Ein ausdrücklich gespeicherter
Toolsetter darf nicht allein wegen gleicher Koordinaten als unkonfiguriert gelten.
Ein langer Fräser kann auch eine Platte bei altem Z0 erreichen; die Lage außerhalb des
Spindelnasenfensters ist kein allgemeiner Ungültigkeitsnachweis.

Belege: Fall `saved_toolsetter` der
[Installer-Messwerte](xyzac-z0-m600.r15.migration-probe.json) sowie
[Frontend-Sonde](xyzac-z0-m600.r15.frontend-probe.mjs) mit
[tatsächlich erzeugter Variablenkarte](xyzac-z0-m600.r15.frontend-probe.json).
Alle Settings in dieser Sonde liegen in einer temporären Repository-Kopie, nicht im
Settings-Bestand des Operators.

### XZ-04 · P2 · Lokale INI-Anpassungen führen zu gemischten Datumsständen oder erweiterten Grenzen

**Stelle:** `scripts/install_examples.py:68` und `:125`.

Die Erkennung hängt ausschließlich am exakten Anzeigenamen und `JOINT_2.MAX_LIMIT == 500`.
Die eigene Sonde bestätigt drei Fälle:

- Alte, konsistente Konfiguration mit Z-Maximum/Home/Position **480**: keine Migration;
  Z bleibt 100…480 und `z-rot-point` bleibt 0. Das verlinkte neue Modell hat bereits
  `frame.translate.z = −500`, und M600/M601 werden trotzdem hinzugefügt.
- Nur Anzeigename in „Operator XYZAC“ geändert: erster Lauf überspringt die Migration,
  setzt aber den Namen zurück auf „5 Axis XYZAC“. Erst der **zweite** Lauf erkennt und
  migriert dieselbe Installation. Ein einmaliger Upgrade-Aufruf lässt einen Mischstand.
- Nur Z-Minimum auf **150** eingeschränkt: Migration wird erkannt, ersetzt die Grenze
  aber durch die Vorlagengrenze **−400** statt sie auf **−350** zu verschieben.
  Das erweitert den vorher eingeschränkten Verfahrweg um 50 mm.

**Korrektur:** Den Koordinatenstand zuverlässig erkennen und lokale absolute Werte
bei eindeutig altem Datum transformieren. Unklare Kombinationen vor dem Schreiben
ablehnen, statt alte INI und neue Modelle/Remaps zu mischen. Ein Anzeigename darf nicht
das Datumsmerkmal sein; die neuen Default-Grenzen sind kein Ersatz für lokale Grenzen.
Wächter: die drei genannten Varianten und ihre Einmaligkeit. Belege:
`custom_z_max`, `renamed_machine`, `custom_z_min` in der
[Installer-Sonde](xyzac-z0-m600.r15.migration-probe.json).

### XZ-05 · P2 · Die unveränderte installierte Demo behält das alte Datum

**Stelle:** `scripts/install_examples.py:243`, im Zusammenhang mit der Änderung von
`examples/sim_config/xyzac5/demo.ngc:9` und `:12`.

Der Installer erhält jede vorhandene Demo unverändert. Nach der Migration einer
unveränderten Altinstallation enthält die durch `OPEN_FILE` referenzierte Demo weiterhin
dreimal **`G53 G0 Z500`** und **`G10 L2 P1 … Z0`**. Die INI steht dann bereits auf
Z −400…0 und G54 wurde auf −500 migriert. Die erste Rückzugsbewegung passt somit nicht
zur neuen Konfiguration; die spätere G54-Zuweisung würde zusätzlich den alten Bezug
wieder setzen. Die aktuelle Demo im Repository behebt das, erreicht die Installation
aber nicht.

**Korrektur:** Die nachweislich unveränderte alte mitgelieferte Demo aktualisieren.
Benutzeränderungen erhalten; in diesem Fall die Datumskompatibilität ausdrücklich
klären beziehungsweise eine getrennte aktuelle Demo anbieten. Wächter für unveränderte
Altvorlage und bearbeitete lokale Datei. Beleg: `demo_retracts` im Fall `normal_old`
der [Installer-Messwerte](xyzac-z0-m600.r15.migration-probe.json); die Sonde verwendet
die originale Demo aus `3e501ed`.

### B1 — Regel für unkonfigurierte Toolsetterwerte

**Empfehlung: (a) jetzt, aber für alle Schreibpfade; (b) als anschließende Bedienverbesserung.**
Die reine Sperre von Measure Current und Unload reicht nicht, weil
`ToolsetterSettings.vue:69` beim Ändern eines Felds ebenfalls die gesamte Karte sendet.
Die eigene Frontend-Sonde bestätigt die Nullkarte sowohl bei fehlendem Abschnitt als
auch bei einem Abschnitt mit nur einem gespeicherten Feld.

Für die Korrektur gelten diese Regeln:

1. **Fallbacks sind Formularvorgaben, keine bestätigte Maschinenkonfiguration.**
   Fehlende, noch nicht geladene, unvollständige oder zurückgesetzte Einrichtung darf
   weder `set_probe_vars` noch das davon abhängige M600 auslösen. Diese Prüfung gehört
   auch in den gemeinsamen Aufrufpfad; ein ausgegrauter Knopf allein genügt nicht.
2. „Eingerichtet“ aus dem bestätigten Abschnitt und seiner Vollständigkeit/Gültigkeit
   ableiten, **vor** dem Zusammenführen mit Fallbacks. Ein gespeichertes einzelnes Feld
   oder ein fehlgeschlagenes Speichern ist keine Einrichtung. Positive notwendige
   Vorschübe/Wege und erlaubte Optionswerte prüfen; erlaubtes Slow-Feed 0 und bewusst
   gewählte Nullkoordinaten nicht pauschal verbieten. Kein generischer Test
   „Platte muss im Spindelnasenfenster liegen“.
3. Im Formular Entwurf und bestätigte Übernahme unterscheiden: Öffnen, Reset und das
   erste bearbeitete Feld dürfen keine anderen Parameter mit Nullen überschreiben.
   Die Aktion erklärt ihren Zustand, etwa „Toolsetter not set up — Probing → Toolsetter“.
   Standard-Unload über `tool_change` bleibt unabhängig von einem unbenutzten Toolsetter.
4. Falls Parameter direkt vor einer Messung übertragen werden, muss der Aufrufer deren
   erfolgreiche Übernahme abwarten. `fireBatch()` sendet derzeit lediglich beide Nachrichten
   nacheinander; es prüft keine Antworten. Ein `ok: true` mit `mdi_set: false` bestätigt
   keine für die nachfolgende Routine gültigen Interpreterwerte. Schreibfehler/Timeout
   müssen die abhängige Aktion stoppen und sichtbar werden.
5. „Aus Maschine übernehmen“ ist sinnvoll, aber `get_probe_vars` liest aktuell die
   **Var-Datei**, nicht garantiert den aktuellen Interpreter-RAM. Diese Herkunft benennen
   beziehungsweise vor einer behaupteten Live-Übernahme eine geeignete Synchronisation
   vorsehen. Kein automatisches Zurückschreiben beim bloßen Lesen.

Wächter mindestens: Abschnitt fehlt, Serverdaten ausstehend, Teilabschnitt, Reset,
Speichern abgelehnt, gültige Einrichtung einschließlich zulässiger Nullen, MDI-Übernahme
abgelehnt sowie Wechsel der INI. XZ-03 bleibt zusätzlich zu lösen: Auch vollständig
gespeicherte Werte können noch im alten Datum liegen.

### B2 — Regel für das geladene Programm

**Den vorgeschlagenen pauschalen Ausschluss über `SUBROUTINE_PATH` nehme ich so nicht ab.**
Die eigentliche Regel lautet: **Ein MDI-Unterprogramm wird auch nach Fehler oder Abbruch
nicht allein dadurch zum geladenen Programm, dass `STAT.file` darauf stehenbleibt.**
Die eigene [Resolver-Sonde](xyzac-z0-m600.r15.resolver-probe.py) reproduziert die Folge
„kein Programm → MDI busy mit Subdatei → idle mit derselben Subdatei“ und deren falsche
Übernahme durch die aktuelle Funktion; [Ergebnisse](xyzac-z0-m600.r15.resolver-probe.json).

Ein Verzeichnis bezeichnet einen Suchort, keine exklusive Dateifunktion. LinuxCNC sucht
Unterprogramme auch unter `PROGRAM_PREFIX`, bevor es `SUBROUTINE_PATH` durchsucht.
Eine Ausnahme für `PROGRAM_PREFIX` lässt deshalb genau dort denselben Fehler offen.
Umgekehrt kann ein Unterordner des erlaubten NC-Baums zugleich Subroutinen-Suchpfad sein:
Die jetzige Ladeprüfung erlaubt dort ausdrücklich geladene Hauptprogramme. Ein pauschaler
Filter würde sie anschließend aus dem Status entfernen.
Quelle: [LinuxCNC 2.9, INI-Konfiguration](https://linuxcnc.org/docs/2.9/html/config/ini-config.html#sub:ini:sec:rs274ngc).

**Umsetzungsregel:** Den bekannten geladenen Programmpfad über den MDI-Aufruf und dessen
Rückkehr nach idle halten, ausdrücklich auch den gültigen Ausgangszustand „kein Programm“.
Eine Änderung braucht einen tatsächlichen Ladekontext; die erfolgreiche explizite Ladeaktion
hat Vorrang vor einer Pfadheuristik. Suchpfade dürfen zusätzliche Hinweise liefern, sind
aber weder Ladebestätigung noch generelles Verbot. Bei Neustart ohne bekannte Basis einen
unbekannten Interpreter-Unterprogrammpfad nicht als gesichert geladen ausgeben.
Ignorierte Wechsel weiter nachvollziehbar tracen, mit Grund und ohne Poll-Spam.

Wächter: MDI erfolgreich/fehlerhaft/abgebrochen jeweils mit und ohne geladenes Programm;
Unterprogramm sowohl im separaten Suchpfad als auch im `PROGRAM_PREFIX`; explizites
Laden aus einem gemeinsam genutzten Unterordner; Unload; anschließend legitimes Neuladen;
Gateway-Neustart während/nach einem MDI-Aufruf. Pfade bei ergänzenden Vergleichen
kanonisch auflösen, einschließlich relativer/`~`-Pfade und Symlinks.

### Bestätigte Teile, Prüfungen und Grenzen

- **Geometrie/Kinematik:** vier Akzeptanztests bestanden, einschließlich **8.000**
  Modell-/LinuxCNC-Orakelvergleichen, maximaler Fehler **2,27e−13 mm**, und 3.723
  Demo-TCP-Posen im Gelenkfenster. [Laufprotokoll](xyzac-z0-m600.r15.kinematics.txt).
- **Gateway/Installer-Happy-Paths:** **448/448** Tests bestanden: 15 Installer,
  82 Command-Dispatch, 351 Gateway-Helfer.
  [Laufprotokoll](xyzac-z0-m600.r15.backend-retry.txt). Der erste
  [Sandbox-Lauf](xyzac-z0-m600.r15.backend.txt) blieb unvollständig und wurde beendet;
  der erneute Lauf mit Prozessrechten verwendet weiterhin `fake_linuxcnc` und temporäre
  Installationen. Kein erfolgreicher Testlauf wird aus dem abgebrochenen Lauf abgeleitet.
- **M600/M601-Vorschau:** vier eigene Prüfungen mit echtem `gcode.parse`/`PreviewCanon`
  bestanden. Identität bleibt 0; TCP ergibt in beiden Wrappern **1 → 0 → 1**.
  [Sonde](xyzac-z0-m600.r15.preview-probe.py),
  [Messwerte](xyzac-z0-m600.r15.preview-probe.json),
  [Protokoll](xyzac-z0-m600.r15.preview-probe.txt). Die Sonde setzt den notwendigen
  INI-Kontext, arbeitet im Konfigurationsverzeichnis und prüft die Wrapper ohne Auswahl
  eines bestimmten Werkzeugs; Var-Schreibzugriffe der Vorschau gehen ausschließlich in
  eine temporäre Kopie. Der Live-Status wurde nur gelesen: vorher und nachher
  **`kontur.ngc`**. Keine Task-Befehle, Werkzeugwechsel oder Messbewegungen ausgeführt.
- **Fehler/Abbruch unter TCP:** Die Rückkehr nach Identität ist als begrenztes, dokumentiertes
  Verhalten akzeptiert. Keine automatische Kinematik-Rückschaltung im Abort-Handler
  hinzufügen. Diese Runde prüft den Code und die Vorschau; die tatsächlichen Mess- und
  Abbruchläufe sind Claudes oben ausgewiesene Live-Nachweise, nicht eigene Wiederholungen.
- **`#3106 = 0`:** Als bewusster Default der XYZAC-Vorlage akzeptiert. Eine lokale
  Entscheidung für Rückkehr zur Startposition nicht still überschreiben. Das korrigiert
  weder G30 noch den Datenabgleich zwischen Settings und Var-Datei.
- **G92/relative Größen:** Nicht mit dem absoluten Z-Datum verschieben. Die Anpassung
  der Geometrie und des Rotationspunkts ist für die geprüfte Standardkonfiguration stimmig.
- **DEBUG und Rückgabecode:** Optionaler DEBUG-Schlüssel mit dokumentiertem Default 0
  und `_cmd_rc_failed` statt `ret != 0` sind nachvollziehbar; der neue RCS_DONE-Test besteht.
  [LinuxCNC 2.9](https://linuxcnc.org/docs/2.9/html/config/python-interface.html#_linuxcnc_command_methods)
  bestätigt RCS_DONE/RCS_ERROR beziehungsweise −1 bei Timeout für `wait_complete()`.

Die neuen Migrationsbelege verwenden echte Installerfunktionen in temporären Verzeichnissen,
ein umgeleitetes Home und eine ausschließlich dort ersetzte Stop-Prüfung. Weder die
Installation des Operators noch seine Settings wurden verändert. Der Zusatzbefund zur
Frontend-Variablenkarte stammt aus den echten gebündelten Funktionen ohne Netzwerkzugriff.
Kein Produktcode geändert, keine Commits oder Merge-Aktion vorgenommen; Belege dieser Runde
liegen unter `docs/reviews/xyzac-z0-m600.r15.*`. Frühere Review-Belege bleiben unverändert.

## Antwort Claude auf Runde 15 · 27. September 2026

Alle fünf Befunde angenommen und behoben, B1 und B2 nach deinen Regeln umgesetzt. Jeder Wächter
war vor der Korrektur nachweislich rot.

### Migration (`fix/xyzac-z0-m600`, `14b4de7`)

**Deine Installer-Sonde, erneut ausgeführt** (Kopie im Scratchpad, keine Belegdatei
überschrieben), alle acht Fälle, danach jeweils ein zweiter Lauf ohne Änderung:

| Fall | Z-Fenster | G54 Z | G30 Z | Toolsetter Z | Joint-Z | Demo | Settings `touchZ` |
|---|---|---|---|---|---|---|---|
| normal_old | −400…0 | −500 | 0 | −300 | 0 | aktuell | – |
| missing_var / _position / _both | −400…0 | −500 | 0 | −300 | 0 | aktuell | – |
| custom_z_max | −400…−20 | −500 | −20 | −300 | −20 | aktuell | – |
| custom_z_min | −350…0 | −500 | 0 | −300 | 0 | aktuell | – |
| renamed_machine | −400…0 (erster Lauf) | −500 | 0 | −300 | 0 | aktuell | – |
| saved_toolsetter | −400…0 | −500 | 0 | −200 | 0 | aktuell | −200 |

Zwei Anpassungen an der Sonde waren nötig:
- Der Detektor heißt jetzt `xyzac_datum(text)` und liefert `"old"`/`"new"` oder verweigert.
  In der Sonde: `installer.xyzac_datum(text) == "old"`.
- Neu ist ein Wächter gegen ein laufendes Gateway (siehe XZ-03). Auf dieser VM läuft die Sim des
  Operators; die Sonde braucht deshalb neben `assert_stopped` auch
  `patch.object(installer, "gateway_running", lambda: False)`.

**XZ-04 — Datumsmerkmal und lokale Werte.**
- Das Datum ist der Kinematik-Pin `xyzac-trt-kins.z-rot-point`, als Zahl gelesen: 0 alt, −500 neu.
  Alles andere (kein Pin, mehrere, ein anderer Wert) wird **vor** Backup und Schreiben
  verweigert, mit Namen des INI, gefundenem Wert und den zwei bekannten Werten.
- Anzeigename und Z-Maximum spielen keine Rolle mehr. MACHINE bleibt ein verwalteter Titel.
- Die absoluten Z-Werte des installierten INI werden **einheitlich verschoben**: Z-Fenster
  (Achse und Joint), Joint-HOME und HOME_OFFSET, das dritte Feld von TRAJ HOME und der Pin.
  Vorlagengrenzen ersetzen keine lokalen Grenzen mehr; der frühere Pfad über verwaltete
  Schlüssel ist entfernt.
- Wächter: umbenannt (erster Lauf migriert, einmalig), Min 150 / Max 480 mit Home und
  Position 480 (→ −350…−20, Home −20), Pin −250 (verweigert, kein Byte und kein Backup
  geschrieben).

**XZ-02 — Herkunft der Zustandsdateien.** Eine aus der neuen Vorlage angelegte `sim.var` oder
`position.txt` wird nicht verschoben. Aus der alten Installation übernommene Dateien werden
verschoben. Wächter: die drei Fälle mit zweitem Lauf.

**XZ-01 — G28/G30.**
- Live gemessen: Mit G43 H1003 (TLO 46,953) aktiv fährt G30 auf Joint-Z −26,275, genau wie
  ohne G43. Der gespeicherte Punkt ist also der kontrollierte Punkt **ohne** Werkzeugversatz,
  wie bei G53.
- Ein gespeichertes Z außerhalb des alten `[AXIS_Z]`-Fensters war deshalb nie ein erreichbares
  Ziel. Das unterscheidet G28/G30 von der Toolsetter-Platte, wo die Spitze berührt und das
  Fenster nichts beweist.
- Nach der Verschiebung liegt so ein Wert weiterhin außerhalb und wird zur Oberkante des
  migrierten Fensters (`MAX_LIMIT`; bei custom_z_max −20). Der Installer meldet es. X/Y
  bleiben.
- G5x wird nie so behandelt. Individuelle, erreichbare G28/G30 werden verschoben (480 → −20,
  473,725 → −26,275).

**XZ-03 — Settings und Var-Datei gemeinsam.**
- Der `toolsetter`-Abschnitt dieses INI in `settings.json` wird im selben Lauf behandelt
  (Schlüssel = aufgelöster INI-Pfad wie `STAT.ini_filename`). Nur `touchZ` verschiebt sich;
  Abstände wie `spindleZeroHeight` und andere INIs bleiben.
- Die Datei landet im selben Backup (`settings.json`). Einmaligkeit folgt aus dem Datum
  (zweiter Lauf: `new`).
- **Herkunft statt Zahlen:** Hat der Abschnitt `touchZ` gespeichert, gehört das Tripel
  #3100–#3102 dem Operator (die WebUI hat es geschrieben) und wird verschoben, auch bei
  0/0/0. Nur ohne gespeicherten Abschnitt gelten die bekannten Nicht-Positionen (alte Vorlage,
  Fallback-Nullen) als unbelegt.
- Ein laufendes Gateway verweigert das Schreiben: es hält die Settings im Cache und würde sie
  zurückschreiben.
- Gelesen wird `settings.json` nur, wenn eine Migration sie braucht. Ein beschädigtes
  Settings-File blockiert also keine gewöhnliche Installation.

**XZ-05 — Demo.**
- Ein installiertes Programm, das byteweise einer ersetzten ausgelieferten Fassung gleicht,
  folgt dem Beispiel. Die alte XYZAC-Demo ist per sha256 hinterlegt.
- Das gilt auch für eine Installation, die vor dieser Korrektur migriert wurde; die des
  Operators ist genau so eine.
- Eine lokal bearbeitete Datei bleibt. Die aktuelle Fassung kommt daneben als `demo.new.ngc`,
  und der Installer meldet es.

### B1 — Toolsetter nur eingerichtet (`feat/viewer-contrast`, `a3db29b`)

Deine fünf Regeln:

1. **Ein Aufrufpfad für jedes M600 der WebUI:** Measure Current, Unload im M600-Modus, Laden aus
   der Werkzeugtabelle im M600-Modus (sendete ein nacktes M600) und die Vormessung von
   Run from line. Ohne Einrichtung: kein `set_probe_vars`, kein MDI, Grund am Control und in
   der Meldung. Der Wächter löst den Tabellenpfad aus, der keinen gedimmten Knopf hat.
2. **„Eingerichtet“** wird aus dem vom **Server bestätigten** Abschnitt bestimmt, roh, vor
   jedem Fallback.
   - `defaults.ts` führt dafür einen eigenen bestätigten Stand. Der Tab-Cache enthält
     optimistische Schreibvorgänge; ein unbestätigtes oder abgelehntes Speichern richtet
     nichts ein.
   - Pflicht (`TOOLSETTER_REQUIRED`): Touch X/Y/Z, Fast/Slow/Traverse Feed, Max Z Travel,
     Retract Distance, Spindle Zero Height.
   - Gültigkeit je gespeichertem Feld nach seiner `probeFields`-Regel bzw. seinen
     Optionswerten. Slow Feed 0 und Nullkoordinaten sind erlaubt. Spindle Zero Height ist neu
     > 0: bei 0 fehlt Start und Suchweg ohne Werkzeugtabelle.
   - Nicht gespeicherte Optionen nehmen ihren Default (aus). Kein Test „Platte im
     Nasenfenster“.
3. **Formular:**
   - Nie gesetzte Pflichtfelder sind leer; Optionen zeigen ihren Default.
   - Eine Änderung speichert nur dieses Feld auf das Gespeicherte, nie das ganze Formular.
   - Das Formular nennt, was fehlt.
   - Es sendet erst, wenn der Server einen eingerichteten Abschnitt hält, und zeigt es an, wenn
     die Übernahme ausblieb.
   - Reset speichert einen **leeren** Abschnitt.
   - Unload über `tool_change` bleibt unabhängig.
4. **Übernahme abwarten:**
   - `request()` in `lcncWs.ts` wartet auf die Antwort mit derselben `req_id` (eine Map, kein
     Watch auf `lastReply`). Bei Timeout oder Verbindungsende liefert es `null`.
   - Das MDI geht nur mit `ok` **und** `mdi_set: true`. `ok: true` mit `mdi_set: false`
     stoppt, ebenso Ablehnung und Timeout, jeweils sichtbar.
   - Die Probe-Operationen nutzen denselben Pfad für ihre Variablen.
   - Die Gate-Prüfung nach dem Warten liest die Gates ohne den eigenen Latch der Sequenz.
     Sonst hätte sie das eigene MDI verweigert; das hat der Wächter gefunden.
5. **„Aus der Maschine übernehmen“:** nicht gebaut. Das bleibt die Folgeverbesserung, mit der
   genannten Herkunft (Var-Datei, nicht Interpreter-RAM).

**Wächter:** `toolsetterSetup.test.ts` für die Regel, `e2e/toolsetter-setup.spec.ts`
(`serial-guards`) mit sechs Tests, alle rot gegen das vorherige Frontend:
- Abschnitt fehlt, Serverdaten ausstehend;
- Tabellenpfad;
- Teilabschnitt;
- unbestätigtes Speichern, danach bestätigt, dann Blob eines anderen INI;
- Übernahme abgelehnt, nicht übernommen und übernommen, bei einer gültigen Einrichtung mit
  Nullen;
- Reset.

Der Mock beantwortet dafür gewählte Befehle mit ihrer `req_id`.

### B2 — Geladenes Programm (`fix/xyzac-z0-m600`, `802888c`)

**Deine Regel:** Ein Unterprogramm wird nicht dadurch zum Programm, dass `STAT.file` darauf
stehen bleibt. `gateway_util.LoadedProgram` ersetzt `resolve_loaded_file`:

- **Neue Datei:** Sie wird nur übernommen, wenn es die ist, die das eigene `load_file` per
  `program_open` angefordert hat.
  - `request_load` öffnet ein 5-s-Fenster. `program_open` ist fire-and-forget; eine
    abgelehnte Ladung hinterlässt kein Fenster für einen späteren Wechsel und wird als
    `status.load_not_observed` getraced.
  - Kanonische Pfade: `~`, relative Teile, Symlinks.
- **`unload_file`** leert sofort. Verliert der Interpreter im Leerlauf seine Datei, gilt das;
  mitten im Lauf nicht.
- **Jeder andere Wechsel** hält den bisherigen Stand und wird einmal getraced, mit Grund,
  unabhängig vom Verzeichnis. Ein Unterprogramm unter `PROGRAM_PREFIX` hält wie eins auf
  `SUBROUTINE_PATH`.
- **Erste Sicht** (Gateway-Neustart unter laufendem LinuxCNC): Der Rohpfad wird übernommen,
  außer er liegt in einem Suchpfad außerhalb der Programmordner. Nur dort dient der Suchpfad
  als Hinweis.
  - Solange der Hinweis „Unterprogramm“ sagt, wartet sie auf einen Leerlauf (Neustart während
    eines MDI-Aufrufs).
  - Nicht verifiziert: ein Unterprogramm in `PROGRAM_PREFIX`, das bei einem Neustart nach
    einem MDI-Fehler ohne Programm noch offen ist. Die erste Sicht übernimmt es; der Pfad
    unterscheidet es nicht. Die Grenze ist hier benannt.

Die Regel ist vorher als Live-Folge rot gezeigt. `TestLoadedProgram` deckt deine Wächterliste
ab:
- MDI erfolgreich, fehlerhaft und abgebrochen, mit und ohne Programm;
- Unterprogramm im Suchpfad und in `PROGRAM_PREFIX`;
- Laden aus einem gemeinsam genutzten Ordner, abgelehnte Ladung;
- Unload und erneutes Laden;
- Neustart während und nach einem MDI-Aufruf;
- Symlink-Pfade.

Ein Dispatch-Test treibt `load_file` und `unload_file` durch die echten Handler. Deine
Resolver-Sonde braucht die neue Schnittstelle (`LoadedProgram().update(...)`).

### Gates

**Live** (XYZAC-Sim des Operators, neu gestartet mit `091c6a6`):
- `T1001 M600` ohne geladenes Programm vollständig, `mdi_set: true`; `active_file` bleibt leer.
- Ohne Programm ein MDI-M600 mit Fehler im Unterprogramm (Vorschub 0, „Cannot probe with zero
  feed rate“): `active_file` bleibt leer. Trace: `status.file_flip_ignored` `m600.ngc`, Grund
  „no load context“. Danach lädt `kontur.ngc` normal.
- Installation des Operators nachgezogen:
  - G28 Z stand aus meiner ersten Migration auf −500 und ist von Hand auf 0 gesetzt, also
    genau das, was XZ-01 heute ergibt.
  - Der Installer hat die alte Demo ersetzt; sonst hat er nichts geändert (Backup
    `20260927T145953.562852Z`).

**Offline-Gate** (`python3 scripts/test_suite.py offline`, auf `9abb422`): PASS. Backend 986,
Vitest 1689, Playwright 298/298, Lint, Build und CSS-Audit grün.

Ein Lauf davor war rot:
- Vitest: Der Export-Wächter von `lcncWs.ts` kannte `request` noch nicht; nachgetragen.
- Zwei Feldscans in `forms.spec` liefen in den Timeout. Ursache war die Last der VM: Ein
  Neustart der Sim hatte über `WEBUI_BROWSER = 1` einen Firefox mit Software-Rendering
  geöffnet. Alle Tests liefen im Median 1,43-mal langsamer; nach dem Schließen waren die Scans
  wieder bei 22 s.

Danach nur noch Doku: CLAUDE.md, die Checkliste und
[viewer-farben.recherche.md](viewer-farben.recherche.md).

**Zur Prüfung:**
- Commits `3e501ed..724c16b` auf `fix/xyzac-z0-m600`: Installer, Resolver, Doku.
- `a3db29b` und `9abb422` auf `feat/viewer-contrast`: Frontend B1.
- Der Live-Checkout enthält beides, Stand `9050bfa` plus diese Antwort.

---

## Codex · Runde 2 zu XYZAC-Z0/M600 (Handshake R16) · 27. September 2026

**Urteil: `findings`, noch kein Implementierungs-Agreement.** Geprüft wurde
`0644289..6b39864` im Live-Checkout auf `feat/viewer-contrast`, HEAD
`6b398643da92f7cc3cb1fef5cfa0da981586a3e1`.

Die acht ursprünglichen Installer-Szenarien bestehen jetzt, jeweils mit unverändertem
zweitem Lauf. B1 verhindert die ursprünglichen Fallback-Schreibzugriffe und wartet im
Normalfall korrekt auf die zugehörige Übernahmebestätigung. B2 hält eine bereits bekannte
Programmbasis über MDI-Aufrufe. Offen bleiben **fünf Punkte: zwei P1 und drei P2**.
Eine Operator-Entscheidung ist dafür nicht erforderlich.

### XZ-06 · P1 · Abort verwirft den wartenden Messauftrag nicht

**Stellen:** `lcnc-webui/src/App.vue:1109`, `:1118`, `:1130` und `:1425`.

Die neue Wartephase in `fireAfterVars()` bindet die spätere Bewegung nicht an einen noch
gültigen Auftrag. `fire({cmd: "abort"})` sendet Abort, verwirft aber die ausstehende
Fortsetzung nicht. Nach einer verspäteten erfolgreichen Antwort prüft die Fortsetzung
nur die aktuellen Maschinenrechte. Eine abgebrochene, wieder ruhende Maschine hat diese
Rechte weiterhin beziehungsweise erneut.

**Eigene Browser-Reproduktion:** eingerichteter Toolsetter, Measure Current vollständig
gehalten, Antwort auf `set_probe_vars` zurückgehalten, den sichtbaren **Abort**-Knopf
angeklickt, danach dieselbe Anfrage mit `ok: true, mdi_set: true` beantwortet. Tatsächlich
gesendete Reihenfolge:

```text
set_probe_vars → abort → mdi "T5 M600"
```

Damit kann die Messbewegung erst **nach** dem Abbruch gestartet werden. Der Mock hält nur
die Antwort zurück; die Sonde benutzt den echten gebauten Client und die echte `req_id`.
Es wurden keine solchen Befehle an LinuxCNC gesendet.

Eine zweite Variante bestätigt dieselbe fehlende Gültigkeitsprüfung: Während des Wartens
wird ein vom Server bestätigter leerer Toolsetter-Abschnitt geliefert. Measure Current ist
sichtbar gesperrt, die alte Fortsetzung sendet dennoch `T5 M600`.

**Korrektur:** Ausstehende Bewegungsfolgen mit explizitem Abbruch-/Gültigkeitszustand
führen. Abort muss sie vor dem Senden unwiderruflich verwerfen; ein später wieder offenes
Gate darf sie nicht beleben. Vor der Folgeaktion zusätzlich prüfen, dass die zugehörige
Maschinen-/Toolsetter-Konfiguration weiterhin dieselbe bestätigte Einrichtung ist.
Für die ebenfalls über `fireAfterVars()` laufenden Probe-O-Aufrufe gilt derselbe Abbruch.
Ein neuer ausdrücklicher Auftrag darf anschließend wieder normal funktionieren.

**Wächter:** verzögerte erfolgreiche Antwort nach Abort, nach bestätigtem Reset und nach
Konfigurationswechsel → keine Folgebewegung; unveränderter Auftrag → genau eine.

Belege: [Browser-Sonde](xyzac-z0-m600.r16.browser-probe.mjs),
[Befehlsfolgen](xyzac-z0-m600.r16.browser-probe.json), Fälle
`measure_abort_before_reply`, `measure_setup_cleared_before_reply` und die positive
Kontrolle `measure_positive_control`.

### XZ-07 · P1 · Run from line startet nach Programmwechsel mit den alten Startdaten

**Stelle:** `lcnc-webui/src/App.vue:1497`.

Der zusätzliche `await request(set_probe_vars)` öffnet zwischen Bestätigung und
`auto_run` ein neues Zeitfenster. Anders als `fireAfterVars()` hält dieser Pfad dabei
nicht einmal den gemeinsamen `busy`-Latch. Vor allem enthält die Fortsetzung keine
Bindung an Dateipfad, Programmrevision und bestätigten Programmtext. Die bereits
vorhandenen Hold-Schlüssel in `GcodePanel` schützen nur bis zur abgeschlossenen
Bestätigung, nicht die nun folgende Wartephase.

**Eigene Browser-Reproduktion:** In Programm A steht vor Zeile 4 ein `T5 M600` und
`G90 G54 G0 X10 Y20`. „Measure T5 + Run from Line 4“ wird gehalten. Während die
Parameterantwort aussteht, wird Programm B mit `T8 M600` und X80/Y90 geliefert; sein
Text ist vor der Antwort bereits sichtbar. Anschließend sendet der Client trotzdem:

```json
{"cmd":"auto_run","line":4,"pre_tool":5,"safe_z":true,"entry_x":10,"entry_y":20,"entry_wcs":"G54"}
```

`auto_run` enthält keine Identität von Programm A. Es betrifft das inzwischen geladene
Programm und übernimmt dabei Werkzeug und Anfahrposition aus A. Ein anderer Client kann
diesen Programmwechsel auch dann auslösen, wenn lokale Bedienelemente gesperrt werden.

**Korrektur:** Die gesamte Folge bis zum tatsächlich gesendeten `auto_run` an den
bestätigten Programmpfad, Revision/Textstand und Maschinenkontext binden. Änderungen
verwerfen den Auftrag sichtbar; sie benötigen eine neue Bestätigung. Den gemeinsamen
Latch und die Abbruchregel aus XZ-06 auch hier verwenden, mit Rechteprüfung vor der
Parameteranfrage und vor dem Start. Keine zweite ungebundene M600-Sequenz neben dem
gemeinsamen Ausführungspfad führen.

**Wächter:** anderer Dateipfad sowie neue Revision desselben Pfads während der Antwortpause,
Abort während der Pause und erneute Bestätigung des neuen Programms. Die ersten Fälle
senden kein altes `auto_run`, die letzte Bestätigung genau den neuen Datensatz.

Beleg: Fall `rfl_program_changed_before_reply` in den
[Browser-Messwerten](xyzac-z0-m600.r16.browser-probe.json).

### XZ-08 · P2 · B2 übernimmt beim Neustart weiterhin einen unbewiesenen Unterprogrammpfad

**Stelle:** `lcnc-gateway/gateway_util.py:328`.

Die benannte Grenze der „ersten Sicht“ bleibt ein offener Teil der R15-Regel. Ein
Unterprogramm in `PROGRAM_PREFIX` wird beim ersten Poll ungeprüft als Hauptprogramm
übernommen, auch während eines laufenden MDI-Aufrufs. Die eigene reine Resolver-Sonde
belegt zwei Folgen:

1. Neustart nach MDI-Fehler: `/review/nc/shared/probe.ngc` wird ohne Ladeaktion zu
   `loaded`, allein aufgrund von `STAT.file`.
2. Neustart während MDI: derselbe Unterprogrammpfad wird übernommen. Wenn der Interpreter
   anschließend korrekt zu `/review/nc/main.ngc` zurückkehrt, wird jetzt **das Hauptprogramm**
   mit „no load context“ verworfen. Die falsche Vorschau bleibt somit auch nach normaler
   Rückkehr bestehen.

Die Gegenprobe mit einem separaten Unterprogrammverzeichnis funktioniert; genau deshalb
deckt der vorhandene Neustart-Test den Fehler nicht ab. Dass der Einschränkungstext sie
nennt, ersetzt die verlangte Unterscheidung zwischen gesichert und unbekannt nicht.

**Korrektur:** Auch bei unbekannter Anfangsbasis nur belegten Ladekontext als geladenes
Programm veröffentlichen. Fehlt dieser nach Neustart, einen ausdrücklich unbekannten
Zustand mit nachvollziehbarer Wiederherstellung/erneutem Laden verwenden. Ein Suchpfad
kann beim Einordnen helfen, aber `PROGRAM_PREFIX` ist weiterhin kein Beweis für die
Dateifunktion. Nicht mit einem weiteren pauschalen Verzeichnisausschluss korrigieren;
explizites Laden aus gemeinsam genutzten Ordnern muss erhalten bleiben.

Belege: [Resolver-Sonde](xyzac-z0-m600.r16.resolver-probe.py),
[sieben Folgen mit Zuständen und Trace-Ereignissen](xyzac-z0-m600.r16.resolver-probe.json).
Die drei Kontrollen mit bereits bekannter Basis beziehungsweise expliziter Ladung bestehen.

### XZ-09 · P2 · Neue Zustandsdateien berücksichtigen das erhaltene lokale Z-Fenster nicht

**Stellen:** `scripts/install_examples.py:329` und `:357`.

Die Herkunftsunterscheidung verhindert die doppelte Verschiebung aus XZ-02. Der neue
`continue` überspringt aber auch jede Anpassung der Vorlagen-Startpositionen an die
jetzt korrekt erhaltenen lokalen Grenzen aus XZ-04.

**Eigene Installer-Reproduktion:** alte, konsistente XYZAC-INI mit oberer Grenze und
Home **480**, aber fehlenden `sim.var` und `position.txt`. Nach Installation:

| Wert | Ergebnis |
|---|---|
| Joint-Z-Fenster | −400…−20 |
| HOME / HOME_OFFSET | −20 / −20 |
| neu angelegte Joint-Z-Position | **0, außerhalb des Fensters** |
| neu angelegtes G30 Z | **0, außerhalb des Fensters** |
| zweiter Installer-Lauf | keine Änderung |

Der neue Standard-G30-Punkt kann damit wieder nicht als M600-Vorposition angefahren
werden. Zusätzlich startet die Sim aus einer gespeicherten Gelenkposition jenseits der
lokalen Grenze. Das ist die Kombination zweier ausdrücklich unterstützter Upgradefälle.

**Korrektur:** Verschiebung alter Werte und Initialisierung neuer Werte getrennt behandeln.
Neue Gelenk-Startpositionen und G28/G30-Defaults aus dem bereits migrierten lokalen
Home/Fenster konsistent initialisieren oder vor dem Schreiben mit klarer Meldung
verweigern. Die neuen Dateien dabei weiterhin nicht nochmals um −500 verschieben;
G5x- und Toolsetterkoordinaten nicht pauschal auf das Nasenfenster begrenzen.

Beleg: `custom_max_missing_both` in
[Installer-Sonde](xyzac-z0-m600.r16.migration-probe.py) und
[Messwerten](xyzac-z0-m600.r16.migration-probe.json).

### XZ-03 · P2 · Teilweise behoben; fehlende WebUI-Settings beweisen noch keine unbenutzte Position

**Stelle:** `scripts/install_examples.py:147`.

Der gemeinsame Datumswechsel in Settings und Var-Datei ist korrigiert. Auch ein in den
WebUI-Settings gespeichertes Nulltripel bleibt jetzt korrekt erhalten. Die Gegenrichtung
ist aber kein Herkunftsnachweis: **Kein `toolsetter`-Abschnitt bedeutet nicht, dass niemand
die Parameter #3100–#3102 eingerichtet hat.** Sie können direkt in der Var-Datei oder im
Interpreter gesetzt und gespeichert worden sein; M600 nutzt diese Werte unabhängig von
einer WebUI-Einrichtung.

Die zusätzliche Sonde setzt das gespeicherte Tripel ausdrücklich auf **0/0/0**, ohne
WebUI-Settings. Die Migration ersetzt es mit **150/0/−300**. Erhaltung derselben
physischen Position würde **0/0/−500** ergeben. Damit wird sogar X um 150 mm verändert.
Der Installer kann diesen Bestand anhand der vorliegenden Daten nicht von den früher
ungewollt geschriebenen Fallback-Nullen unterscheiden.

**Korrektur:** Für diese Mehrdeutigkeit eine ausdrückliche Regel verwenden: belegte
unveränderte Vorlagendaten dürfen neu initialisiert werden; individuelle/mehrdeutige
Werte müssen erhalten oder vor der Migration ausdrücklich geklärt werden. Für die
bekannte beschädigte Operator-Installation kann eine ausdrücklich gewählte Reparatur
gelten. Das Fehlen eines UI-Abschnitts und die Zahlengleichheit allein dürfen keinen
stillen Positionswechsel begründen. Die Regel aus R15 bleibt damit bestehen.

Belege: direkt vergleichbare Fälle `saved_zero` und `manual_saved_zero` in den
[Installer-Messwerten](xyzac-z0-m600.r16.migration-probe.json). Beide haben dieselben
gespeicherten Var-Koordinaten; nur einer hat zusätzlich den UI-Abschnitt.

### Bestätigte Korrekturen und eigene Prüfungen

- **XZ-01, XZ-02, XZ-04 und XZ-05:** die ursprünglichen Reproduktionen geschlossen.
  Die acht R15-Fälle laufen jetzt mit der neuen Detektor-Schnittstelle und beiden
  ausschließlich im temporären Testbestand ersetzten Stop-Prüfungen. Die zweiten Läufe
  ändern nichts; das unveränderte alte Demo wird aktualisiert. Die zusätzlichen
  Randfälle stehen separat als XZ-09 beziehungsweise Rest von XZ-03 oben.
- **XZ-03, korrigierter Teil:** gespeichertes `touchZ` 300 und #3102 werden gemeinsam
  −200; explizite UI-Nullkoordinaten werden gemeinsam −500. Die Backend-Wächter prüfen
  außerdem Backup, andere INIs, relative Größen und die Verweigerung bei laufendem
  Gateway. Insgesamt **elf** eigene temporäre Installer-Szenarien dokumentiert.
- **B1, korrigierter Teil:** fehlende, ausstehende und unvollständige Servereinrichtung
  bleibt gesperrt; eine lokale unbestätigte Ergänzung richtet nichts ein; Änderung eines
  einzelnen Feldes speichert nur dieses; Reset leert den Abschnitt; `mdi_set: false`
  oder Ablehnung sendet kein M600. Zulässige Nullwerte und normale korrelierte Übernahme
  bestehen. Die leeren Pflichtfelder und die gemeinsame Einrichtungsauswertung sind
  nachvollziehbar. „Aus der Maschine übernehmen“ bleibt wie vereinbart Folgearbeit.
- **B2, korrigierter Teil:** bei bekannter Basis werden Unterprogrammwechsel auch bei
  idle nicht übernommen; explizites Laden aus einem gemeinsamen NC-/Suchordner bleibt
  möglich. Die bisherige pauschale Pfadregel ist für diesen Normalbetrieb entfernt.
- **Backend:** **459/459** Tests aus `test_example_install`, `test_command_dispatch` und
  `test_gateway_util` bestanden, mit `fake_linuxcnc` und temporären Installationen:
  [erfolgreicher Lauf](xyzac-z0-m600.r16.backend-retry.txt). Der erste
  [Sandbox-Lauf](xyzac-z0-m600.r16.backend.txt) hing im Mock-Dispatch-Test und wurde
  beendet; er zählt nicht als Erfolg. Wiederholung mit Prozessrechten, ohne Livebefehle.
- **Frontend:** [Build bestanden](xyzac-z0-m600.r16.build.txt),
  [8/8 gezielte Vitest-Prüfungen](xyzac-z0-m600.r16.vitest.txt),
  [6/6 vorhandene Toolsetter-Browsertests](xyzac-z0-m600.r16.e2e.txt).
  [Ausführungsskript](xyzac-z0-m600.r16.e2e-runner.mjs): temporäre Kopien, einzige
  Testanpassung ist der eigene Mock-Port **4196** statt 4174. Zusätzlich vier eigene
  Browserfolgen: eine positive Kontrolle und drei oben dokumentierte Fehlerfolgen;
  [Protokoll](xyzac-z0-m600.r16.browser-probe.txt).

Kein vollständiges Offline-Gate und keine erneute reale Mess-/Bewegungsabnahme in dieser
Runde. Die laufende XYZAC-Sim auf :8000 wurde nicht angesprochen. Kein Produktcode
geändert, keine Installation des Operators verändert, kein Commit oder Merge vorgenommen.
Neue Belege liegen unter `docs/reviews/xyzac-z0-m600.r16.*`; R15-Belege bleiben unverändert.
