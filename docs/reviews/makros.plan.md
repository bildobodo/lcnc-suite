# Makros als Dateien, eigener Tab, Makroleiste im Hochformat

**Fassung 2 · 2. Oktober 2026 · Paket 5 der Operator-Liste.** Fassung 1 (1. Oktober) legte zwei
Entscheidungen vor. Der Operator hat am 2. Oktober beide nach der Empfehlung entschieden und eine
dritte Vorgabe ergänzt. Diese Fassung arbeitet den Plan für die Codex-Planrunde aus. Gebaut wird
auf `feat/macros`, abgezweigt vom Integrationsstand `feat/backlog-integration` (Stapel + Pakete
2–4). Merge nur nach `development`, nie `main`.

## Anlass und Entscheidungen

Der Operator, 1. Oktober:

> Kannst du einige Beispielmakros erstellen, damit wir sehen, wie die Makrobar aussieht? Müssten wir
> die Makrofähigkeiten ausbauen? Inklusive Editor, Import, Export, File Browser usw.? Ähnlich wie
> wir das bereits beim Programm laden haben? Vielleicht müsste dann die ausgebaute Makrofunktion
> einen Tab im Sidepanel erhalten anstelle bei den Settings.

Der Operator, 2. Oktober, nach den Renderings:

> ich folge deinen empfehlungen grundsätzlich. bei portrait layout habe ich mir überlegt, ob wir
> die makros zwischen 3D viewer und dem unteren panel anbringen sollten. damit wäre ein
> horizontales scrollen möglich und es braucht nicht so viel platz.

Damit gilt:

1. **Ein Makro ist eine `.ngc`-Datei** (Entscheidung 1 = B): ein LinuxCNC-Unterprogramm in einem
   Makroordner, aufgerufen per `o<name> call`.
2. **Ein 6. Tab „Macros“** im Seitenpanel (Entscheidung 2 = ja).
3. **Hochformat:** Die Makroleiste ist eine waagrechte, seitlich scrollende Zeile zwischen
   3D-Viewer und Seitenpanel. Heute ist sie dort eine eigene senkrechte Spalte zwischen Leiste und
   Viewer, etwa 155 px breit.

## Heute (Stand `feat/backlog-integration`)

- **Speicher:** Settings-Sektion `macros` auf dem Server, JSON, höchstens 20 Einträge
  `{id, name, command, params[{name, label, default}]}` (`defaults.ts:447-493`). Das Gateway
  speichert sie ungeprüft (`settings_store.py`).
- **Ausführen** (`useMacros.ts`):
  - eine MDI-Zeile mit `{name}`-Platzhaltern, Gate `probe` im Client;
  - das Gateway prüft `mdi` nur mit `ready` und parst den MDI-Text nicht (`command_policy.py:629`,
    `:931`).
- **Halten:**
  - ohne Parameter hält man den Button (`holdKey` = id + Befehl + Parameter);
  - mit Parametern öffnet ein Tipp den Dialog (`kind="form"`), Execute wird gehalten;
  - Enter im Dialog springt weiter und führt nie aus.
- **Bearbeiten:** Settings › Macros mit Entwurfswache (`unsavedDraft`).
- **Gateway-Dateien:** Programme leben in `PROGRAM_PREFIX`. Dafür gibt es `/files`, `/upload`
  (ersetzt nur mit `overwrite=1`, sonst 409, `os.link`), `/save` (überschreibt nur Vorhandenes,
  **ohne** Konfliktschutz) und `/gcode`.
  - Den `SUBROUTINE_PATH` liest das Gateway nur: `/subfile` und die Probe-Liste.
  - Es gibt keine Route, die dort eine Datei anlegt oder speichert, und keinen Parser für
    Kommentarköpfe.
- **Suchreihenfolge des Interpreters:**
  - Er sucht `name.ngc` zuerst in `PROGRAM_PREFIX`, dann in den `SUBROUTINE_PATH`-Ordnern der Reihe
    nach; der erste Treffer gilt.
  - Ein gleichnamiges Programm verdeckt also ein Makro.
  - Alle drei Beispiel-INIs setzen `OWORD_NARGS = 1` und `NO_DOWNCASE_OWORD = 1`; Namen sind dort
    groß-/kleinschreibungsgenau.
- **Editor:** CodeMirror steckt inline in `GcodePanel.vue`, mit Sitzung, Konfliktbanner und
  „nach dem Speichern laden“ am geladenen Programm.

## Stufen

Drei Stufen auf einem Branch, je ein Commit mit Gate, Wächter jeweils zuerst rot. Stufe A
hängt nicht an B und C und kommt zuerst, weil sie mit den heutigen Makros funktioniert.

### Stufe A — Makroleiste im Hochformat zwischen Viewer und Seitenpanel

- **Ort:**
  - Im Hochformat liegt die Leiste in der rechten Spalte, zwischen `.viewerPane` und `.sidePane`.
  - Das Raster der `.wrap` verliert seine mittlere Spalte (`--strip-fixed-w 1fr`).
  - Im Querformat bleibt sie, wo sie ist: unter dem Inhalt, über den Leisten.
- **Umsetzung:**
  - EIN Element, kein zweites Exemplar: Die Leiste wird im DOM an ihren Platz im Hochformat
    gesetzt.
  - Das Querformat stellt sie über die Raster-/Flex-Reihenfolge wieder unter den Inhalt.
  - Ob das mit `order` in einer Flex-Spalte geht oder ob die Leiste per `isPortrait` zwischen zwei
    Plätzen wechselt (`v-if` an zwei Stellen, nie beide), entscheidet die Fokus- und Hold-Prüfung:
    - Ein Wechsel der Ausrichtung während eines Holds bricht den Hold ab, wie jede DOM-Änderung
      unter dem Finger.
    - Die Tab-Reihenfolge folgt der Darstellung (WCAG 2.4.3). Bei `order` folgt sie dem DOM, nicht
      der Anzeige; deshalb ist der Platzwechsel im DOM die Vorgabe. `order` kommt nur in Frage, wo
      DOM- und Anzeigereihenfolge übereinstimmen.
- **Gestalt:**
  - eine Zeile, Buttons in `--control-h-compact` (36 px Touch);
  - seitlich scrollend (`overflow-x: auto`, `.scroll-thin`, Ziehen per `dragScroll`);
  - die Kantenblenden waagrecht wie im Querformat;
  - die heutigen senkrechten Hochformat-Regeln (`.wrap > .macroBar`, App.vue:3078-3123) entfallen.
- **Höhe:** Die Zeile nimmt ihre Höhe dem **Viewer**, das Seitenpanel bleibt unverändert.
  - Heute sind Viewer und Seitenpanel beide `flex: 1 1 0` in der Spalte `.content`. Eine Zeile
    dazwischen würde beide um die Hälfte kürzen.
  - Deshalb bilden Viewer und Leiste im Hochformat EIN Flex-Element: eine Hülle `.viewerColumn`
    mit `flex: 1 1 0` und dem heutigen Viewer-Boden `--viewer-min-h-portrait`. Darin liegen
    `.viewerPane` (`flex: 1`) und die Leiste.
  - Das Seitenpanel sieht damit genau dieselbe Spalte wie ohne Makros.
  - Im Querformat ist die Hülle nur der Platz des Viewers. Die Leiste liegt dort weiter unter
    `.content`.
  - **Benannte Folge:** Der Viewer-Boden zählt im Hochformat die Leiste mit. Das 3D-Bild ist um die
    Höhe der Zeile (36 px + Abstand) kleiner als ohne Makros. Das ist der Platz, den der Operator
    sparen will: Heute kostet die Leiste eine 155 px breite Spalte.
- **Keine Makros:** keine Zeile, kein Abstand. Heute bleiben 16 px Lücke, weil die leere
  `auto`-Spalte zwei Rasterabstände trägt. Das entfällt mit der Spalte.
- **Wächter:**
  - `layout.spec`: Hochformat mit Makros (Zustand `macro-bar` der `layout-fixtures`) bei 100 % und
    150 %. Gemessen werden:
    - Leiste genau zwischen Viewer und Seitenpanel, volle Spaltenbreite;
    - eine Zeile, die waagrecht scrollt, wenn die Buttons nicht passen;
    - das Seitenpanel (`.sidePane`, direkt gemessen, nicht über die Rahmen-Ausnahme) mit Makros
      GLEICH dem ohne Makros, in Lage und Größe, bei 100 % und 150 %;
    - kein Button angeschnitten im Ruhezustand, sondern über das Scrollen erreichbar.
  - Die Rahmen-Ausnahme der `layout-fixtures` wechselt im Hochformat von `viewer.x/width` auf
    `viewer.height`.
  - Rot vorher: Am heutigen Stand liegt die Leiste links vom Viewer.
  - `run-hold.spec`: Hold und Dialog an der Leiste auch im Hochformat. Ein Wechsel der Ausrichtung
    während des Holds sendet nichts.
  - Die Kantenblenden (`attachScrollFades`) hängen sich heute nur bei einer neuen Makroanzahl neu
    an. Wechselt die Leiste mit der Ausrichtung ihren Platz im DOM, hängen sie sich auch bei
    `isPortrait` neu an. Geprüft wird, dass nach einem Wechsel die Blende am Ende erscheint, wenn
    die Zeile überläuft.

### Stufe B — Makrodateien im Gateway

**Der Makroordner**

- Er kommt aus der INI: `[DISPLAY] WEBUI_MACRO_DIR`, aufgelöst wie `PROGRAM_PREFIX`:
  - `~` wird erweitert, relativ heißt zum INI-Ordner, dann `realpath`;
  - der Ordner muss existieren.
- **Ohne Eintrag gibt es keine Makrodateien** (kein stiller Standardordner). Der Tab sagt das mit
  dem Namen des INI-Schlüssels. Die Settings-Makros laufen weiter.
- **Er muss im `SUBROUTINE_PATH` stehen**, sonst findet der Interpreter die Datei nicht.
  - Das Gateway prüft das gegen die aufgelösten Ordner.
  - Fehlt er dort, steht eine Konfigurationswarnung im Banner (Stufe warn), und kein Makro aus dem
    Ordner ist ausführbar.
- **Befund: Der `SUBROUTINE_PATH` der installierten TWP-Konfiguration ist heute abgeschnitten.**
  - LinuxCNCs INI-Leser liest eine Zeile nur bis 255 Zeichen. Gemessen mit `linuxcnc.ini`: Der
    Wert der installierten TWP-INI hat 246 Zeichen, gelesen werden 237.
  - Aus `…/subroutines/surfacemap` wird `…/subroutines/s`. Der Interpreter verwirft den Ordner beim
    `realpath` still (`rs274ngc_pre.cc:986-989`, nur `logDebug`). Die Surfacemap-Unterprogramme
    fehlen dort also.
  - Das Gateway liest mit demselben Leser und sieht denselben Rest, ebenfalls ohne Meldung.
  - Ein weiterer Eintrag für Makros passte in keine der installierten INIs ohne Kürzung.
  - Höchstens 10 Ordner (`MAX_SUB_DIRS`); weitere werden still verworfen.
- **Abhilfe in Stufe B:**
  - `install_examples.py` schreibt die Suite-Ordner nicht mehr absolut in den Checkout. Es legt
    einen Link `subroutines` im Konfigurationsordner an, wie heute schon `remap_subs` und `twp`,
    und schreibt die Einträge relativ (`subroutines/probe_basic`).
  - Relativ heißt für den Interpreter: zum Arbeitsverzeichnis von milltask. Am laufenden Sim
    gemessen ist das der Konfigurationsordner (`/proc/<milltask>/cwd`). Das Gateway löst ebenfalls
    zum INI-Ordner auf.
  - `config_sync_check.py` (und der Installer) lehnen laut ab:
    - jede INI-Zeile über 254 Zeichen;
    - mehr als 10 `SUBROUTINE_PATH`-Einträge;
    - einen Eintrag, der nicht existiert.
  - Wächter: Test mit der heutigen TWP-INI, zuerst rot.
  - Die installierten INIs ändert erst ein neuer Abgleich durch den Operator. Ich schreibe sie
    nicht selbst um.
- **Die Beispiel-Konfigurationen:**
  - Sie setzen `WEBUI_MACRO_DIR = ~/linuxcnc/macros` und nehmen den Ordner als ERSTEN Eintrag in
    `SUBROUTINE_PATH` auf.
  - `install_examples.py` legt den Ordner an und kopiert die Beispielmakros nur, wenn eine Datei
    fehlt, wie bei den Programmen. Nutzerdaten liegen damit nicht im Checkout.
  - `test_example_install.py` prüft beides.

**Welche Datei ruft `o<name> call` wirklich?**

- Das Gateway löst einen Namen genau wie der Interpreter auf (`find_ngc_file`,
  `rs274ngc_pre.cc:2660-2753`). Der erste Treffer gilt:
  1. das Arbeitsverzeichnis von milltask (der Konfigurationsordner);
  2. `PROGRAM_PREFIX`;
  3. die `SUBROUTINE_PATH`-Ordner in Reihenfolge;
  4. `WIZARD_ROOT`, rekursiv.
- Ein Makro ist nur dann ausführbar, wenn dieser erste Treffer seine Datei im Makroordner ist.
  Sonst heißt es „Shadowed by <Pfad>“, mit dem Grund am Button und im Tab.
- Eine reine Funktion in `gateway_util`, getestet mit verdeckenden Dateien in jedem Ordner.

**Dateinamen**

- `[a-z0-9_]+\.ngc`, klein geschrieben, höchstens 63 Zeichen ohne Endung.
  - Der Interpreter schreibt jeden o-Wort-Namen klein, auch mit `NO_DOWNCASE_OWORD`; dieser
    Schalter gilt nur für benannte Parameter in Kommentaren (`interp_internal.cc:70-107`,
    `interp_convert.cc:1397`).
  - Eine groß geschriebene Datei fände er nie. Die Doku (§11.7.9) erlaubt Kleinbuchstaben, Ziffern,
    Bindestrich und Unterstrich; der Bindestrich bleibt hier draußen, damit der Name auch ein
    Bezeichner ist.
- Die Datei definiert genau EIN Unterprogramm `o<name> sub … o<name> endsub` mit dem Dateinamen als
  Namen (Doku §11.7.9: eine Datei, eine Definition).

**Der Kommentarkopf**

Eine kleine Grammatik, nur im Gateway geparst. Der Client parst nichts. Ganze Kommentarzeilen VOR
`o<name> sub`:

```
(MACRO Face top)
(PARAM 1 width "Width" length 50 min=1 max=500)
(PARAM 2 length "Length" length 80 min=1)
(PARAM 3 depth "Depth" length 0.5 min=0 max=5)
(PARAM 4 feed "Feed" feed 600 min=1)
```

- **`MACRO`:** der Titel auf dem Button; höchstens einmal. Ohne ihn gilt der Dateiname.
- **`FRAME machine`:** Das Makro braucht Identitätskinematik, etwa weil es `G53` fährt.
  - Gate dann `probe` UND `machineFrame`, im Gateway und im Client gleich.
  - Grund am Button: „Machine frame only“.
  - Ohne die Zeile gilt `probe` allein. Die Pflicht liegt beim Autor der Datei; das Gateway
    erkennt `G53` nicht selbst. Die Beispielmakros mit `G53` tragen die Zeile, und ein Test hält
    das für jede Beispieldatei fest, die `G53` enthält.
- **`PARAM <n> <key> "<Label>" <unit> <default> [min=…] [max=…] [integer]`:**
  - `n` ist die Position (`#1` … `#30`, lückenlos ab 1), `key` ein Bezeichner.
  - Das Label steht in Anführungszeichen, höchstens 40 Zeichen.
  - `unit` ist eine Art, kein Literal, wie in `probeFields.unitText`: `length` (lineare
    Maschineneinheit), `feed` (Einheit/min), `angle` (°), `rpm`, `time` (s), `count`, `none`.
  - `default` ist eine endliche Zahl im Bereich.
- **Fehler** nennen Zeile und Grund. Ein Makro mit Kopffehler wird gelistet, ist aber nicht
  ausführbar.
- Unbekannte Kopfzeilen sind ein Fehler, keine stille Auslassung.
- **Prüfungen am Rumpf** (Textprüfung ohne Kommentare, keine Ausführung):
  - genau ein `o<name> sub` mit dem Dateinamen und ein `o<name> endsub`;
  - kein `M2`/`M30` zwischen `sub` und `endsub`. Im MDI setzt es das Programmende zurück und meldet
    einen Fehler (`interp_convert.cc` `convert_stop`, `emctaskmain.cc:2280-2285`).
  - kein `%` vor `endsub`. Startet das geladene Programm mit `%`, liest der Interpreter `%` als
    Dateiende (`interp_read.cc:3159-3162`).
  - Was nach `endsub` steht, liest der Interpreter bei einem Aufruf nie; es ist erlaubt.
  - Benannte Grenze: ein `M2` in einem weiter gerufenen Unterprogramm sieht die Prüfung nicht.
- Tests: Tabelle gültiger und ungültiger Köpfe, dazu jede Beispieldatei.

**Routen** (alle Schreib- und Leserouten mit Token, wie die Werkzeugbibliothek)

- **`GET /macros`:** die Liste. Je Datei:
  - `name`, `title`, `params`;
  - `revision` (sha256 der Bytes) und `mtime`;
  - `runnable` oder der Grund dagegen (Kopffehler, verdeckt, Ordner nicht im Pfad);
  - die Kopffehler.
  - Dazu der Ordner, ob er im Pfad liegt, und die Liste der Fehler.
- **`GET /macro?name=`:** der Text, mit `X-Macro-Revision`, aus einem einzigen `read()` wie
  `/gcode`.
- **`PUT /macro?name=&base=<revision>`:** Speichern MIT Konfliktschutz.
  - `base` muss die Revision der Datei auf der Platte sein, sonst 409 mit der aktuellen Revision.
  - `base=new` legt an und scheitert, wenn es den Namen gibt (`os.link`, wie `/upload`).
  - Atomar über `_atomic_stream_write`, unter einer Makrosperre.
- **`POST /macro-upload[?overwrite=1]`:** Import. Name und Kopf werden geprüft, wie `/upload`
  (409 ohne `overwrite`).
- **`DELETE /macro?name=&base=`:** löschen, mit Konfliktschutz.
- **Export** = der Download von `GET /macro` als Datei. Der Browser speichert ihn.
- **Sperren:**
  - Schreibrouten werden abgelehnt, solange der Interpreter nicht ruht („A macro or program
    runs — wait“).
  - Damit ändert die Oberfläche keine Datei, die gerade läuft.
  - Benannte Grenze: Ein Editor außerhalb der Suite kann das nicht verhindern.

**Ausführen: neues WS-Kommando `run_macro {name, args, revision}`**

- **Ablauf:**
  - Das Gateway baut den Aufruf selbst: `o<name> call [a1] [a2] …`, Zahlen formatiert wie
    `#N=`-Werte.
  - Vorher prüft es Folgendes, und zwar unter der Makrosperre:
    - Name gültig und ausführbar;
    - Anzahl und Bereich der Argumente laut Kopf (ganzzahlig, wo `integer`);
    - `revision` gleich der Datei auf der Platte. Sonst: „Macro changed — hold again“.
    - die gebaute Zeile höchstens 254 Zeichen (`LINELEN`, `interp_read.cc:3140`). Sonst wird
      abgelehnt, nie gekürzt.
  - Danach `_start_guard`, `set_mode(MDI)`, MDI.
- **Gate:** `probe` im Gateway (`COMMAND_GATES`), gleich dem Client und dem Katalogtyp `macro`.
  Heute prüft das Gateway für Makros nur `ready`; das ist eine Verschärfung.
- **Schema:**
  - `COMMAND_SCHEMA`: Name als Muster, Argumente als Liste von höchstens 30 endlichen Zahlen,
    Revision als 64 Hexzeichen.
  - `commandPath.test.ts` bekommt das Kommando.
- Das rohe `mdi` bleibt für den MDI-Tab und die Settings-Makros unverändert.

**Beispielmakros** (Dateien in `examples/sim_config/macros/`, installiert nach
`~/linuxcnc/macros`)

| Datei | Titel | Parameter |
|---|---|---|
| `spindle_warmup.ngc` | Spindle warm-up | max rpm, minutes |
| `park.ngc` | Park | – |
| `face_top.ngc` | Face top | width, length, depth, feed |
| `coolant_flush.ngc` | Coolant flush | seconds |
| `go_to_g30_macro.ngc` | Go to G30 | – (ruft `o<go_to_g30>`) |

- Probe Z entfällt als Beispiel: Die Antastroutinen haben in Probing ihren Platz, mit ihren Werten.
- **Regeln für die Beispiele:**
  - Jeder Rückzug hebt nur (`#<_abs_z>`-Schutz wie `go_to_zero.ngc`).
  - Wer `G53` fährt oder `o<go_to_g30>` ruft, trägt `(FRAME machine)`: Park und Go to G30.
  - Kein Makro hinterlässt einen anderen modalen Zustand als vorher (G90/G91, G20/G21, Vorschub),
    sichtbar am Ende der Datei.
- **Abnahme am Sim:**
  - Park und Go to G30 unter TCP abgelehnt („Machine frame only“), am Button gedimmt mit Grund.
  - jedes Beispiel einmal am XYZAC-Sim mit Ergebnis;
  - Park und Go to G30 aus beiden Z-Lagen, die Z-Prüfung wie in `twp_buttons_check.py`.

### Stufe C — der Tab „Macros“ und der Editor

**Reiter**

- `Program | MDI | Probing | Offsets | Tools | Macros`.
- Sechs Reiter brauchen etwa 422 px Innenbreite; die Umschaltung auf die Auswahlliste liegt heute
  bei 400 px.
  - Die Schwelle `NARROW_PANE_PX` steigt auf das GEMESSENE Maß für sechs Namen, gerundet nach
    oben.
  - Alle Schmal-Regeln hängen an derselben Schwelle; sie kippen damit zusammen, wie bisher.
  - Betroffen ist nur der Bereich zwischen 400 px und dem neuen Wert. Querformat (522 px) und
    Hochformat 100 % (570 px) bleiben breit.
- `layout.spec` prüft weiter `inner < Schwelle === schmal` und keine angeschnittenen Namen, jetzt
  mit sechs.
- `tabs.spec` kennt sechs Namen; Pfeile, Home und End sind entsprechend nachgeführt.

**Aufbau nach dem Tab-Muster (D5)**

- **Objektzeile:** das gewählte Makro (Titel · Datei) und sein Zustand (ausführbar / Grund).
- **Maschinenaktionen:**
  - Run: Hold, oder bei Parametern der Dialog wie an der Leiste, derselbe Pfad;
  - Abort ganz rechts.
- **Verwaltung:** New, Import, Export, Delete.
- **Inhalt:**
  - die Liste: Titel, Datei, Parameterzahl, Zustand, Schalter „On bar“;
  - darunter der Editor des gewählten Makros mit Save / Discard.
- **Leerzustände:**
  - kein Ordner konfiguriert;
  - Ordner nicht im `SUBROUTINE_PATH`;
  - Ordner leer.
- **Schmal:** Die Liste wird zur Auswahl über dem Editor. Verwaltung faltet hinter „More“, wenn die
  Objektzeile Platz hat.

**Die Makroleiste**

- Was auf die Leiste kommt und in welcher Reihenfolge, steht in der Settings-Sektion `macros`
  unter einem neuen Schlüssel `bar: string[]` (Dateinamen).
  - Sie wird vom Server synchronisiert; die alten Einträge `macros` bleiben daneben unverändert.
  - Das erste Speichern aus der neuen Oberfläche fügt den Schlüssel `bar` zur gespeicherten Sektion
    des Operators HINZU. Die vorhandenen Einträge bleiben Byte für Byte, wie sie sind; ein Test
    vergleicht das.
  - Die Reihenfolge ändert man in der Liste (auf/ab).
- Eine fehlende Datei erscheint nicht auf der Leiste. Der Tab nennt sie einmal mit „Remove from
  bar“; nichts verschwindet still aus der Einstellung.
- Ein Makro, das nicht ausführbar ist, steht gedimmt auf der Leiste, mit dem Grund am Button
  (`useGateExplain`).
- **Hold:**
  - ohne Parameter am Button, `holdKey` = Name + Revision;
  - mit Parametern ein Tipp zum Dialog, Execute gehalten, `holdKey` = Name + Revision + Werte.
  - Eine neue Revision, auch von einem anderen Client, bricht den Hold ab („Selection changed —
    hold again“).
  - Der Dialog liest sein Makro live; eine gelöschte Datei führt nichts aus. Das ist die Regel von
    heute (UI-DI08), jetzt an der Revision.
- Die Liste lädt nach: bei Tab-Öffnung, nach jedem eigenen Schreiben und wenn ein anderer Client
  schreibt.
  - Das Gateway sendet `macros_changed {revisionen}`, ausgelöst von den eigenen Schreibrouten und
    einer `mtime`-Prüfung im Statuslauf, im Ruhezustand höchstens 1 Hz.
  - So bemerkt die UI auch eine Datei, die von außen geändert wurde.

**Der Editor**

- CodeMirror wird aus `GcodePanel.vue` in eine Komponente `CodeEditor.vue` herausgelöst:
  - Sprache, Thema und Bildschirmtastatur (`editorTarget`);
  - Sitzungsnummer gegen späte Antworten;
  - eigener Eingabebesitzer je Verwendung.
- `GcodePanel` behält seine Programmsitzung, Verhalten unverändert; die vorhandenen Editor-Tests
  sind die Probe.
- **Makrositzung:** `{name, revision, original}`.
  - Save sendet `base = revision`. Ein 409 zeigt „Changed on disk“ mit „Reload“ und „Keep
    editing“, nie ein stilles Überschreiben.
  - Gespeichert wird nur die Sitzungsdatei; danach wird nichts als Programm geladen.
- Der Kopf wird beim Speichern vom Gateway geprüft. Ein Kopffehler speichert trotzdem (die Datei
  gehört dem Operator), das Makro ist dann aber nicht ausführbar und der Fehler steht beim Editor.
- **Entwurfswache:** Tabwechsel, Wahl eines anderen Makros und „Neu“ fragen „Discard changes?“
  (Keep editing / Discard), wie der Werkzeugeditor.
- Der Tab-Wächter von App (`activeTab`) sperrt die Editorsitzung beim Wechsel, wie beim G-Code.

**Die Settings-Makros**

- Sie bleiben, laufen weiter und stehen weiter auf der Leiste, vor den Dateimakros.
- Ihr Editor zieht aus Settings in den Tab als Gruppe „Earlier macros“. Settings › Macros entfällt;
  der Unterreiter nennt keinen Ersatz mehr, weil es nur EINEN Ort gibt.
- **„Convert to file“** je Eintrag, nur auf Wunsch:
  - schreibt `name.ngc` mit `o<name> sub`, der MDI-Zeile und den Parametern als `PARAM` (`{x}` wird
    zu `#n`);
  - die Einstellung bleibt, bis der Operator sie löscht.
  - Ein Name, der schon existiert, wird nicht überschrieben (`base=new`).
- Die gespeicherten Makros des Operators fasst die Umstellung nicht an. Die Migration ändert die
  Sektion nicht, sie liest sie nur.

**Wächter (Stufe C)**

- `dialogs.spec`: Neu-Dialog, Löschbestätigung, Discard-Rückfrage im Tab.
- `keyboard-guards`: Makroentwurf beim Tabwechsel, statt bisher im Settings-Dialog.
- `run-hold.spec`: Hold an Leiste und Tab mit Revision; eine neue Revision während des Holds bricht
  ab, der nächste volle Hold sendet genau `run_macro` mit der neuen Revision.
- `forms.spec`: Feldnamen im Tab und im Dialog.
- Unit: Sitzungs-/Konfliktlogik des Editors (pur), Leistenreihenfolge, fehlende Dateien.
- Gateway: Routen mit 401, Pfad-Einschluss, 409 bei falscher Basis, `base=new` gegen vorhandene
  Datei, Schreiben während eines Laufs, `run_macro` mit falscher Revision, Argumentzahl und
  -bereich, verdeckter Name, Ordner nicht im Pfad.

## Interpreter-Verhalten

Gelesen in den Quellen von LinuxCNC v2.9.4 (der Tag passt zu den installierten Headern,
`/usr/include/linuxcnc/interp_internal.hh`). Mögliche Debian-Patches sind nicht geprüft. Die
Zeilen beziehen sich auf `src/emc/rs274ngc/` bzw. `src/emc/task/`.

**Der einzige Cache.** `_setup.offset_map` merkt sich je Name Datei, Byte-Offset der
`o<name> sub`-Zeile und Zeilennummer (`interp_o_word.cc:93-124`). Inhalt wird nicht gehalten,
Datei-Identität und mtime nicht geprüft.

**Ein bekannter Name** wird nicht neu gesucht: Datei öffnen, `fseek` auf den alten Offset, weiter
(`interp_o_word.cc:549-586`). Wurde die Datei inzwischen geändert, läuft der Interpreter an der
alten Byte-Stelle in den neuen Text. Er kann Zeilen vor dem Kopf ausführen, Zeilen überspringen
oder ein Bruchstück wie `z-5` als Zeile nehmen.

**Wann der Cache leer ist:**
- Am Ende jedes MDI-`o<…> call` auf Ebene 0 (`rs274ngc_pre.cc:348-351`). **Jeder `run_macro`-Aufruf
  sucht und liest die Datei also neu**: Änderungen zwischen zwei Aufrufen greifen, auch von
  außen.
- Bei Fehler, Abort, M2/M30, Programm-Öffnen und jedem Moduswechsel nach MDI oder AUTO (über
  `unwind_call`/`reset`).
- NICHT bei `synch()`, Pause/Weiter, und nicht am Ende einer MDI-Remap-Ausführung
  (`rs274ngc_pre.cc:455-486`).

**Folgerungen für den Plan:**
- Im MDI ist der Cache kein Problem: Jeder Aufruf beginnt leer.
- Gefährlich ist eine Änderung, während ein PROGRAMM läuft, das das Makro per `o<…> call` aufruft.
  Der Cache hält dann für den ganzen Lauf, und der Interpreter liest der Bewegung voraus.
  - Darum lehnen die Schreibrouten ab, solange der Interpreter nicht ruht.
  - Ein Editor außerhalb der Suite bleibt die benannte Grenze.
- Höchstens 30 Argumente (`INTERP_SUB_PARAMS`). Nicht übergebene `#N+1…#30` sind im Unterprogramm
  0, anders als die Doku sagt (`interp_read.cc:1781-1785`). `run_macro` übergibt deshalb immer
  alle Parameter des Kopfs.
- Verschachtelung höchstens 9 Ebenen einschließlich Remaps (`interp_o_word.cc:666-670`). Ein
  Makro, das `o<go_to_g30>` ruft, braucht zwei.
- Ein Python-o-Wort gleichen Namens hat Vorrang vor der Datei (`is_pycallable`). Das Gateway sieht
  Python-o-Wörter nicht: benannte Grenze.

**Nebenbefund (außerhalb der Makros, nur benannt):** Eine MDI-Remap-Ausführung leert den Cache
nicht. Wird eine Remap-Datei (etwa `m600.ngc`) zwischen zwei MDI-Aufrufen geändert, ohne dass
dazwischen ein Moduswechsel, Abort oder MDI-o-Call liegt, läuft der zweite an der alten Stelle.
Das Gateway überspringt den Moduswechsel, wenn die Maschine schon im MDI ist
(`gateway.py:3018`).

## Benannte Grenzen

- Eine Datei, die außerhalb der Suite geändert wird, kann sich zwischen Prüfung und Lesen durch den
  Interpreter ändern. Die Suite schützt nur ihre eigenen Schreibwege.
- Ein Python-o-Wort gleichen Namens hat Vorrang vor der Makrodatei.
- Ein Makro läuft im MDI-Modus. Was es tut, prüft die Vorschau nicht (keine Kollisions- oder
  Grenzprüfung wie beim Programm). Das gilt schon heute für Settings-Makros und MDI.
- Ohne `WEBUI_MACRO_DIR` gibt es nur die Settings-Makros.

## Doku

- `CLAUDE.md`:
  - Makroordner, Kopfgrammatik, `run_macro`, Tab, Leiste im Hochformat;
  - die Zeilen zu „fünf Reitern“, Settings › Macros und dem Probe-Tier.
- `docs/decisions.md`: Eintrag mit den Entscheidungen.
- `examples/sim_config/README.md`: Makroordner.

## Ablauf

1. Codex-Planrunde zu dieser Fassung.
2. Stufe A, Gate, Renderings für den Operator.
3. Stufe B, Gate, Live-Probe am XYZAC-Sim (jedes Beispiel).
4. Stufe C, Gate.
5. Codex-Umsetzungsrunde(n).
6. Live-Blick des Operators, dann Merge nach `development`.
