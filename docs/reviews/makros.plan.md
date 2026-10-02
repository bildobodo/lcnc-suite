# Makros als Dateien, eigener Tab, Makroleiste im Hochformat

**Fassung 3 · 2. Oktober 2026 · Paket 5 der Operator-Liste.** Fassung 1 (1. Oktober) legte zwei
Entscheidungen vor. Der Operator hat am 2. Oktober beide nach der Empfehlung entschieden und eine
dritte Vorgabe ergänzt. Fassung 2 arbeitete den Plan aus (Codex R69: VP69-01 bis VP69-05).
Fassung 3 beantwortet R69; die Antworten stehen am Ende. Gebaut wird
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
- **Suchreihenfolge des Interpreters:** siehe Stufe B, „Welche Datei ruft `o<name> call`
  wirklich?“. Kurz: Arbeitsverzeichnis von milltask, `PROGRAM_PREFIX`, `SUBROUTINE_PATH`,
  `WIZARD_ROOT`; der erste Treffer gilt. Ein gleichnamiges Programm verdeckt also ein Makro. Namen
  schreibt der Interpreter immer klein (siehe „Dateinamen“).
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
- **Buttons schrumpfen nie** (`flex: none`): Die Zeile scrollt, ein Button behält seinen ganzen
  Namen. Der neue Wächter fand das in der Umsetzung: Neun Makros in der 600-px-Spalte schnitten
  jeden Namen ab („cro numb“). Mit vielen Makros galt das vorher auch im Querformat.
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
- **Er darf `PROGRAM_PREFIX` weder enthalten noch darin liegen.** Sonst erreichten `/save` und
  `/upload` dieselben Dateien an der Makrozulassung vorbei. Das Gateway lehnt eine solche
  Konfiguration ab (Banner, keine Makrodateien).
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
  - Relativ heißt für den Interpreter: zum Arbeitsverzeichnis von milltask. Das Startskript
    wechselt vor dem Start in den INI-Ordner (`/usr/bin/linuxcnc:777`, `cd "$INI_DIR"`); am
    laufenden Sim gemessen: `/proc/<milltask>/cwd` = Konfigurationsordner.
  - Das Gateway nimmt das nicht an, es PRÜFT es: Beim Binden an die LinuxCNC-Instanz liest es
    `/proc/<pid>/cwd` des milltask dieser Instanz. Weicht es vom INI-Ordner ab oder ist es nicht
    lesbar, sind relative Einträge nicht auflösbar: Banner, keine Makrodatei ausführbar.
  - `config_sync_check.py` (und der Installer) lehnen laut ab:
    - jede INI-Zeile über 255 BYTES, gezählt an den gelesenen Bytes, nicht an Unicode-Zeichen
      (gemessen mit `linuxcnc.ini`: 255 Bytes werden ganz gelesen, 256 auf 255 gekürzt);
    - mehr als 10 `SUBROUTINE_PATH`-Einträge;
    - einen Eintrag, der nicht existiert.
  - Wächter: Test mit der heutigen TWP-INI, zuerst rot.
  - Die installierten INIs ändert erst ein neuer Abgleich durch den Operator. Ich schreibe sie
    nicht selbst um.
- **Die Beispiel-Konfigurationen:**
  - Sie setzen `WEBUI_MACRO_DIR = ~/linuxcnc/macros` und nehmen den Ordner als LETZTEN Eintrag in
    `SUBROUTINE_PATH` auf.
  - Umsetzung, gegen Fassung 3 geändert: Als ERSTER Eintrag könnte ein Makro namens `m600` oder
    `go_to_g30` die Routinen der Suite verdecken, etwa die Werkzeugwechsel-Remap. Als letzter wird
    umgekehrt das Makro verdeckt („Shadowed by …“), und die Suite bleibt unberührt.
  - Die Beispielmakros kopiert der Installer nur beim ERSTEN Anlegen des Ordners. Ein gelöschtes
    Beispiel bleibt gelöscht.
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
(UNITS mm)
(PARAM 1 width "Width" length 50 min=1 max=500)
(PARAM 2 length "Length" length 80 min=1)
(PARAM 3 depth "Depth" length 0.5 min=0 max=5)
(PARAM 4 feed "Feed" feed 600 min=1)
(Faces the stock top in parallel passes; the description is free text.)
o<face_top> sub
  M73
  G21 G90 G94
  …
o<face_top> endsub
```

- **`MACRO`:** der Titel auf dem Button; höchstens einmal. Ohne ihn gilt der Dateiname.
- **`FRAME machine`:** Das Makro braucht Identitätskinematik, etwa weil es `G53` fährt.
  - Gate dann `probe` UND `machineFrame`, im Gateway und im Client gleich.
  - Grund am Button: „Machine frame only“.
  - Ohne die Zeile gilt `probe` allein. Die Zeile ist ein Vertrag des Autors, auch für indirekte
    `G53`-Helfer wie `o<go_to_g30>`.
  - Eine Textsuche nach `G53` im Rumpf ohne `FRAME machine` gibt eine WARNUNG im Tab (nicht
    ausführbar wird das Makro dadurch nicht). Sie ersetzt weder die Zeile noch das Gate, weil
    gerufene Unterprogramme unsichtbar bleiben.
  - Die Beispielmakros tragen die Zeile, wo sie `G53` fahren oder einen `G53`-Helfer rufen; ein
    Test hält das fest.
- **`UNITS mm` / `UNITS inch`:** die Einheit, in der das Makro seine Längen und Vorschübe
  ERWARTET. Pflicht, sobald ein Parameter `length` oder `feed` ist (VP69-04). Der Dialog zeigt
  diese Einheit, nicht die der Maschine.
- **`PARAM <n> <key> "<Label>" <unit> <default> [min=…] [max=…] [integer]`:**
  - `n` ist die Position (`#1` … `#30`, lückenlos ab 1, keine doppelt), `key` ein Bezeichner,
    nicht leer, keiner doppelt.
  - Das Label steht in Anführungszeichen, höchstens 40 Zeichen.
  - `unit` ist eine Art, kein Literal:
    - `length` in der `UNITS`-Einheit;
    - `feed` in `UNITS`-Einheit/min (G94);
    - `angle` (°), `rpm` (G97), `time` (s), `count`, `none`.
  - `default` ist eine endliche Zahl im Bereich, ganzzahlig bei `integer`; `min` ≤ `max`.
- **Der Einstieg** (VP69-04, Pflicht ab dem ersten `length`-, `feed`- oder `rpm`-Parameter):
  - Die erste ausführbare Zeile des Rumpfs ist `M73`. Sie sichert die modalen Zustände und stellt
    sie bei `endsub`/`return` wieder her (LinuxCNC M70/M73).
  - Getrennte Zeilen machen die Reihenfolge unabhängig von der Ausführungsreihenfolge innerhalb
    einer Zeile: Gesichert wird sicher VOR dem Umstellen.
  - Die zweite setzt, wovon die Parameter abhängen:
    - `G21` bzw. `G20` passend zu `UNITS`;
    - `G94`, wenn ein `feed`-Parameter da ist;
    - `G97`, wenn ein `rpm`-Parameter da ist.
  - Damit gilt ein Wert des Dialogs in der Einheit, die er zeigt, gleich welcher Modus vorher aktiv
    war (G20 auf einer mm-Maschine, G95, G96).
  - Das Gateway prüft den Einstieg als Text. Fehlt er, ist das ein Kopffehler.
- **Was M73 nicht leistet**, benannt in Doku und Hilfe:
  - Bei Abort stellt M73 nichts wieder her.
  - Der Bewegungsmodus (G0/G1) gehört nicht zu den gesicherten Zuständen.
  - Nach Abort wird nichts automatisch fortgesetzt, weder Spindel noch Bewegung.
- **Fehler** nennen Zeile und Grund. Ein Makro mit Kopffehler wird gelistet, ist aber nicht
  ausführbar.
- **Kopfzeilen und Beschreibung:**
  - Eine Kopfzeile beginnt mit einem Wort aus Großbuchstaben, gefolgt von Leerzeichen oder
    Klammer.
  - `MACRO`, `UNITS`, `FRAME` und `PARAM` sind bekannt. Jedes andere solche Wort ist ein Fehler
    (`PARM 1 …` wird nicht still übergangen).
  - Jeder andere Kommentar vor `sub` ist Beschreibung, frei, und wird nicht ausgewertet. Er darf
    also nicht mit einem Wort ganz in Großbuchstaben beginnen; die Hilfe nennt das.
  - `(MSG, …)` und `(DEBUG, …)` sind am Komma erkennbar Beschreibung.
- **Prüfungen am Rumpf** (Textprüfung ohne Kommentare, keine Ausführung):
  - genau ein `o<name> sub` mit dem Dateinamen und ein `o<name> endsub`;
  - kein `M2`/`M30` zwischen `sub` und `endsub`. Im MDI setzt es das Programmende zurück und meldet
    einen Fehler (`interp_convert.cc` `convert_stop`, `emctaskmain.cc:2280-2285`).
  - kein `%` vor `endsub`. Startet das geladene Programm mit `%`, liest der Interpreter `%` als
    Dateiende (`interp_read.cc:3159-3162`).
  - Was nach `endsub` steht, liest der Interpreter bei einem Aufruf nie; es ist erlaubt.
  - Benannte Grenze: Die Prüfung ist eine Textprüfung, keine Semantik. Sie sieht kein `M2` in
    einem weiter gerufenen Unterprogramm und keine berechneten oder indirekten Befehle.
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
- **`POST /macro-upload[?replace=<revision>]`:** Import (VP69-03).
  - Ohne `replace` legt er nur neu an: atomares Nicht-Ersetzen (`os.link`), 409 mit der aktuellen
    Revision, wenn der Name existiert.
  - Mit `replace` ersetzt er genau die bestätigte Revision. Das wird unter der Schreibzulassung
    beim Veröffentlichen geprüft; ist die Datei inzwischen eine andere, kommt 409 mit dem
    aktuellen Stand.
  - Der Client wiederholt nie selbst mit neuer Basis; die Entscheidung trifft der Operator neu.
- **`DELETE /macro?name=&base=`:** löschen, mit Konfliktschutz.
- **Export** = der Download von `GET /macro` als Datei. Der Browser speichert ihn.
- **Zulassung:** siehe den nächsten Abschnitt. Benannte Grenze: Ein Editor außerhalb der Suite
  kann sie nicht beachten.

**Gemeinsame Zulassung von Schreiben und Start** (VP69-02)

Ein Zustand im Gateway, `_source_claim`, und eine Sperre, `_source_lock`. Beide gehören dem
Gateway, keinem Client. Der Anspruch zählt die offenen Starts; ein neuer Start erhöht ihn, auch wenn
schon einer offen ist (konkurrierende MDI- und AUTO-Starts).

- **Starts:**
  - Jeder Start, der den Interpreter Dateien lesen lässt, läuft durch EINE Funktion: `CMD.mdi`,
    `CMD.auto` (run, step, resume).
  - Diese Funktion setzt unter `_source_lock` den Anspruch `_source_claim` mit der
    Seriennummer des Befehls und sendet dann.
  - Ein Quelltest (wie `TestCoverage`) verbietet `CMD.mdi`/`CMD.auto` an jeder anderen Stelle.
- **Dauer des Anspruchs:**
  - Ein MDI-Start (Makro, MDI-Zeile) hält ihn bis zum Ende dieses Befehls.
  - Ein AUTO-Start hält ihn für den GANZEN Lauf: Der Interpreter liest gerufene Dateien während
    des Laufs, IDLE kommt erst am Programmende.
  - Solange sind Makro-Schreiber und gleichnamige Programm-Uploads abgelehnt. Programm-Uploads
    mit anderen Namen bleiben frei.
- **Freigabe des Anspruchs:**
  - NUR der Statuslauf gibt ihn frei, wenn der Controller nachweislich fertig ist:
    `echo_serial_number` ≥ Seriennummer, Befehlsstatus nicht `RCS_EXEC`, Interpreter `IDLE`, in
    einem frischen Poll.
  - Ein Handler, der abbricht, ein Disconnect oder eine Cancellation geben ihn nie frei. Ein
    `finally` im Handler berührt ihn nicht.
  - Abort und E-Stop bleiben jederzeit erreichbar; der Anspruch hält keine Befehlssperre. Nach
    einem Abort gibt ihn derselbe Nachweis frei.
  - Ein Anspruch, den kein Nachweis mehr freigeben kann, verfällt nur mit einem neuen Binden an
    eine LinuxCNC-Instanz oder einem Gateway-Neustart. Er wird mit dem Grund getraced
    (`macro.claim_dropped`) und im Tab als Grund der Ablehnung genannt. Er läuft nie auf einer
    Zeituhr ab.
- **Makro-Schreiber** (PUT, Import, DELETE, „Convert to file“):
  - Der langsame Teil (Empfangen, temporäre Datei) läuft außerhalb der Sperre.
  - Unmittelbar vor dem atomaren Veröffentlichen prüft der Schreiber unter `_source_lock`
    erneut:
    - kein Anspruch offen;
    - Interpreter IDLE in einem frischen Poll;
    - die Basisrevision gilt noch.
  - Erst dann wird veröffentlicht, noch unter der Sperre. Sonst 409/423 mit Grund, die temporäre
    Datei wird verworfen.
- **Programm-Schreiber** (`/upload`, `/save`):
  - Sie bleiben, wie sie sind, auch während eines Laufs. Ein Programm hochzuladen, während ein
    anderes läuft, geht weiter.
  - Neu ist allein die Namensprüfung unten. Sie läuft unter `_source_lock` unmittelbar vor dem
    Veröffentlichen.
- **Vorrangige Namen:**
  - `/upload` und `/save` lehnen einen Dateinamen ab, der genau `<makro>.ngc` eines vorhandenen
    Makros ist („Name taken by a macro“). Genau diesen Namen öffnet der Interpreter: Er schreibt
    den o-Wort-Namen klein und hängt `.ngc` an. `Park.ngc` oder `park.NGC` verdecken `park.ngc`
    auf einem Dateisystem mit Groß-/Kleinschreibung nicht (benannte Annahme: Linux ext4/xfs).
  - Umgekehrt lehnen die Makrorouten einen Namen ab, den es in `PROGRAM_PREFIX` gibt. Beides
    unter `_source_lock`.
  - Damit kann kein Suite-Schreiber ein Makro verdecken, auch nicht zwischen Prüfung und Lesen.
  - Das Arbeitsverzeichnis, frühere `SUBROUTINE_PATH`-Ordner und `WIZARD_ROOT` beschreibt die
    Suite nicht; dort bleibt ein Vorrang von außen die benannte Grenze (sichtbar als „Shadowed by
    …“).
- **Sperrreihenfolge:**
  - `_cmd_lock` vor `_source_lock`, nie umgekehrt.
  - Schreiber nehmen `_cmd_lock` nie.
  - `_var_file_lock` bleibt unter `_cmd_lock`, wie heute.
- **Abnahmefälle** (Gateway-Tests mit der Fake-Bindung):
  - ein verzögerter Upload gegen einen Start;
  - ein schon gesendeter Start, während der Status noch IDLE meldet;
  - Schreiben über `/save` und `/upload` mit einem Makronamen;
  - ein gleichnamiger Upload in `PROGRAM_PREFIX`;
  - Abbruch und Disconnect des anfragenden Clients;
  - konkurrierende MDI- und AUTO-Starts.

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
  - Danach `_start_guard`, dann der **Cache-Reset vor dem Einstieg** (VP69-01), dann der Start
    über die eine Startfunktion.
- **Cache-Reset vor dem Einstieg** (VP69-01):
  - `run_macro` sendet IMMER `SET_MODE(MDI)`, auch wenn die Maschine schon in MDI ist. Das heutige
    `set_mode` kehrt dann früh zurück (`gateway.py:3018`); `run_macro` übergeht diese Abkürzung.
  - Was LinuxCNC dabei tut (v2.9.4): `EMC_TASK_SET_MODE` ruft `emcTaskSetMode(MDI)` ohne Vergleich
    mit dem aktuellen Modus (`emctaskmain.cc:2125-2170`). Das ruft `emcTaskAbort()`
    (`emctask.cc:264-300`), und das ruft `emcTaskPlanReset()` → `Interp::reset()` →
    `unwind_call()` → `offset_map.clear()` (`emctask.cc:225-262`, `rs274ngc_pre.cc:1765-1785`,
    `:1724`).
  - Das ist derselbe Weg, den jeder Wechsel MANUAL → MDI nimmt, also jedes MDI aus dem Handbetrieb.
    Er ist kein zusätzlicher Abort. Bei ruhendem Interpreter wirkt er so:
    - `emcMotionAbort()` bricht Jogs und die Bahn ab (`taskintf.cc:1798-1815`); einen
      Spindel- oder Kühlmittelbefehl enthält es nicht. Dass eine laufende Spindel weiterläuft,
      prüft der Abnahmefall am Sim (M3 vor dem Aufruf, Drehzahl danach unverändert).
    - `Interp::reset()` ändert keinen modalen Zustand; es setzt `#1…#30` zurück und leert den
      Cache;
    - danach `emcTaskPlanSynch()`.
    - `ON_ABORT_COMMAND` läuft dabei nicht; es hängt an `emcAbortCleanup` (`emctask.cc:745`),
      nicht an `emcTaskAbort`.
  - **Wann LinuxCNC den Wechsel ignoriert:**
    - `emcTaskSetMode` kehrt ohne Reset zurück, solange `jogging_is_active()` gilt
      (`emctask.cc:268-271`, Meldung „Ignoring task mode change while jogging“). Die Antwort ist
      trotzdem 0.
    - Ein MDI→MDI-Wechsel zeigt danach denselben Modus wie vorher; die heutige Prüfung von
      `set_mode` (Modus vorher/nachher) kann „Reset geschehen“ und „ignoriert“ also nicht
      unterscheiden.
  - **Die Bedingung wird deshalb selbst geprüft, an ihrer Quelle:**
    - `jogging_is_active()` liest `emcStatus->motion.jogging_active` (`emctaskmain.cc:155-157`).
      Das ist der HAL-Pin `motion.jog-is-active` (`control.c:2063`, `:2149`): jeder aktive Jog,
      auch einer über halui oder ein Handrad, den das Gateway nicht kennt.
    - Das Gateway liest den Pin über den HAL-Leser mit (`set_extra_pins`, wie `kins_type`).
    - `run_macro` läuft nur, wenn ein FRISCHER Schnappschuss (jünger als 100 ms) ihn FALSE zeigt.
      Fehlt er oder ist er alt: Ablehnung „Jog state unknown — wait“; aktiv: „A jog is
      active — release it“.
    - Zusätzlich liegt eine Stolperleine auf dem Fehlerkanal: Kommt nach dem Wechsel die Meldung
      „Ignoring task mode change while jogging“ (unübersetzt in der Quelle), wird abgelehnt und
      getraced, auch wenn der Pin FALSE zeigte.
    - Aus MANUAL heraus prüft die heutige Modusprüfung den Wechsel zusätzlich.
  - Erst danach geht der Aufruf hinaus.
  - Zwischen Reset und Aufruf kann nichts den Cache füllen: Beide laufen unter `_cmd_lock` und dem
    Startanspruch; ein anderer Start wartet.
  - **Abnahmefall** (ein eigenes Sim, kopierte Konfiguration ohne Anzeige wie beim
    Golden-Rezept, nie die Live-Suite). Die Byte-Rechnung macht den Rot-Fall herstellbar:
    - **Datei vorher:** 300 Bytes Beschreibungskommentar, dann `o<probe_helper> sub`. Im Rumpf
      folgen 20 Zeilen `(DEBUG, step NN)` zu je 20 Bytes, dann `endsub`.
    - **Der Cache-Eintrag:** Eine Test-Remap `M499` ruft per MDI `o<probe_helper> call`. Ihr Ende
      leert den Cache nicht (`rs274ngc_pre.cc:455-486`); der Offset 300 bleibt stehen.
    - **Datei danach:** Der Beschreibungskommentar wird gestrichen; der Kopf steht jetzt bei
      Byte 0. Byte 300 liegt damit rund 280 Bytes tief im Rumpf, in Zeile 14 oder 15.
    - **Ohne Reset:** Der Interpreter beginnt dort. Die Meldungen `step 01` … `step 13` fehlen,
      oder ein Zeilenbruchstück gibt einen Lesefehler. Beides ist rot.
    - **Mit Reset:** alle 20 Meldungen in Reihenfolge, kein Fehler.
    - Die Meldungen sind Kommentar-Befehle, die beim AUSFÜHREN ihrer Zeile ausgegeben werden. Das
      Gateway reicht sie als Maschinenmeldungen weiter.
- **Gate:** `probe` im Gateway (`COMMAND_GATES`), gleich dem Client und dem Katalogtyp `macro`.
  Heute prüft das Gateway für Makros nur `ready`; das ist eine Verschärfung. Mit `FRAME machine`
  zusätzlich `machineFrame`, in beiden.
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
  - Jedes Beispiel folgt dem Einstieg (`M73`, dann Einheit und Modi), auch ohne Parameter, als
    Vorlage. M73 stellt die gesicherten Zustände beim `endsub` wieder her, nicht bei Abort.
  - Tests am Gateway-Parser: jede Beispieldatei gültig, mit Einstieg.
  - Abnahme am Sim mit metrischer Konfiguration (XYZAC) in G20 und G95 vor dem Aufruf: Face top
    mit 10 mm fährt 10 mm. Danach sind G20 und G95 wieder aktiv.
  - Eine imperiale Konfiguration gibt es im Beispielsatz nicht. Ein Parser- und Aufruftest mit
    `UNITS inch` deckt die Gegenrichtung ab; am Sim ist sie nicht geprüft (benannt).
- **Abnahme am Sim:**
  - Park und Go to G30 unter TCP abgelehnt („Machine frame only“), am Button gedimmt mit Grund.
  - jedes Beispiel einmal am XYZAC-Sim mit Ergebnis;
  - Park und Go to G30 aus beiden Z-Lagen, die Z-Prüfung wie in `twp_buttons_check.py`.
  - **Umsetzung:** `scripts/macro_live_check.py` an einer frischen Installation der Beispiele
    (Scratch-Ordner, XYZAC headless), Ergebnis `docs/reviews/makros.live-r1.txt`: 12 PASS, 1 SKIP
    (über Maschinen-Z0 ist auf dieser Konfiguration unerreichbar). Der Rot-Fall des Caches ist
    belegt („Unknown word starting with e“, kein Schritt), ohne den erzwungenen Wechsel wird auch
    `run_macro` rot. Die Z-Prüfung tastet den Weg ab: vor dem X/Y-Ziel liegt jeder Punkt auf der
    senkrechten Rückzugslinie oder auf Z0, innerhalb des `G64 P` aus dem Startcode (der Planer
    schleift die Ecke: X/Y beginnt 0,02 mm unter Z0). Ein diagonales Park ist rot (10,39 mm).
    Gefunden: Die TCP-Ablehnung sagte „Machine frame only — Machine frame only“; jetzt der Grund
    der Rechte-Tabelle wörtlich.

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
- Die Schwelle kommt aus der MESSUNG, nicht aus der Schätzung 422.
- `layout.spec` prüft weiter `inner < Schwelle === schmal` und keine angeschnittenen Namen, jetzt
  mit sechs. Geprüft wird bei 100 % und 150 % und unmittelbar unter, an und über der Schwelle, mit
  Touch-Maßen und je mit aktivem sechstem Reiter.
- Wechselt die Breite über die Schwelle, während ein Reiter den Fokus hat, landet der Fokus auf der
  Auswahl (`tabSelect`) und nicht auf `body`. Das wird ebenfalls geprüft.
- `tabs.spec` kennt sechs Namen; Pfeile, Home und End sind entsprechend nachgeführt.
- **Umsetzung:** gemessen 431 px, Schwelle 432 px (`sidePaneNarrow.ts`).
  - Die Schätzung aus der Textbreite sagte 428 px. Der Wächter fand 1 px Anschnitt je Spalte, eine
    Breitensuche an der echten Reiterliste dann 431 px.
  - Der Fokus geht beim Umschalten auf das Select über.
  - Eine abgelehnte Auswahl im Select wird zurückgesetzt; das Select zeigte sonst den abgelehnten
    Bereich.

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

- **Umsetzung, Liste:** drei Spalten: Schalter „On bar“, das Makro mit Datei, Wertezahl und
  Zustand darunter, die Pfeile der Leistenreihenfolge.
  - Mitglieder der Leiste stehen zuerst, in Leistenreihenfolge.
  - Nur der Kopf steht fest; darunter scrollt alles. So passt es auch bei 150 % (272 px).
- **Umsetzung, Editor:** Das Auswählen eines Makros öffnet den Editor ohne Bildschirmtastatur
  (`autoOpen` aus); ein Tipp in den Text öffnet sie. Beim Programm bleibt „Edit“ die bewusste
  Handlung.

**Run und Editorentwurf: eine gemeinsame Basis** (VP69-05, nach dem Programmeditor,
`GcodePanel.vue:937-942`)

- Run für DIESELBE Makrodatei ist gesperrt, mit Grund am Button, in drei Fällen:
  - sie hat einen ungespeicherten Entwurf („Unsaved edit — Save or Discard“);
  - ihr Text lädt noch („Loading macro — wait“);
  - ein Versionskonflikt ist ungelöst („Changed on disk — Reload or Keep editing“).
- Das gilt für den Run im Tab UND den Button auf der Leiste, aus EINER Ableitung (`macroRunState`,
  rein, getestet). Andere, unveränderte Makros bleiben frei.
- Erst Save oder Discard/Reload stellt die Basis wieder her. Es gibt kein stilles Autosave.
- Die Liste übernimmt eine neue Revision, während der Editor noch die alte zeigt:
  - mit Entwurf ist das der Konfliktfall;
  - ohne Entwurf lädt der Editor den neuen Text nach, und bis er da ist, gilt „lädt noch“.
  - Eine späte Leseantwort für ein anderes, inzwischen gewähltes Makro wird verworfen
    (Sitzungsnummer).
- Import und Delete derselben Datei bei offenem Entwurf fragen zuerst „Discard changes?“. Erst
  danach gehen sie zum Gateway, das die Basisrevision ohnehin prüft.
- Ein offener Parameterdialog und ein laufender Hold folgen derselben Ableitung:
  - wird der Button gesperrt, bricht der Hold ab;
  - der Dialog zeigt den Grund, und Execute ist gesperrt.
- **Abnahmefälle:**
  - Änderung des Rumpfs bei gleichem Kopf;
  - Änderung des Kopfs;
  - neue Revision von einem anderen Client;
  - späte Leseantwort nach einem Auswahlwechsel;
  - offener Parameterdialog;
  - laufender Hold.
  - Geprüft wird, dass sichtbarer Text, Parameterdefinition, Hold-Key und Startrevision
    zusammenpassen.

**Die Settings-Makros**

- **Umsetzung, Operator-Entscheidung 2. Oktober abends (Live-Blick):** Die Settings-Makros
  entfallen ganz („ich würde die alten makros fallen lassen“). Die Leiste trägt nur noch Dateien,
  „Earlier macros“ und „Convert to file“ entfallen. Ein gespeicherter `macros`-Eintrag bleibt in den
  Settings genau so, wie er ist: nie benutzt, nie umgeschrieben. Die Konsole sagt einmal, dass er da
  ist. Der Operator hatte keinen. Die Absätze unten beschreiben den Stand vor dieser Entscheidung.
- Sie bleiben, laufen weiter und stehen weiter auf der Leiste, vor den Dateimakros.
- Ihr Editor zieht aus Settings in den Tab als Gruppe „Earlier macros“. Settings › Macros entfällt;
  der Unterreiter nennt keinen Ersatz mehr, weil es nur EINEN Ort gibt.
- **Dialoginventar (Anhang B der Design-Welle), nachgeführt:**
  - **Fall 3** (Settings „Discard changes?“) verliert nur den Makro-Anteil. Die Wache für den
    Gamepad-Assistenten bleibt.
  - **Fall 20** (Makro löschen) bleibt eine Löschbestätigung:
    - Initialfokus Cancel;
    - nach dem Löschen geht der Fokus auf die nächste Zeile, sonst auf die vorige, sonst auf den
      Tab-Kopf.
  - **Fall 6** (Parameterdialog) bleibt ein Formular ohne Schließen per Hintergrund.
  - **Neu ist die Discard-Rückfrage im Macros-Tab**, mit Keep editing / Discard. Der Hintergrund
    heißt „Keep editing“. Escape bleibt E-Stop und schließt nie einen Dialog.
  - Der Dialog-Scan (`dialogs.spec`) bekommt die neuen und geänderten Fälle.
- **„Convert to file“** je Eintrag, nur auf Wunsch:
  - schreibt `name.ngc` mit `o<name> sub`, dem Einstieg, der MDI-Zeile und den Parametern als
    `PARAM` (`{x}` wird zu `#n`);
  - die Einstellung bleibt, bis der Operator sie löscht.
  - Ein Name, der schon existiert, wird nicht überschrieben (`base=new`).
  - Heutige Parameter haben freie Texte als Vorgabe und keine Einheit:
    - Eine Vorgabe, die keine endliche Zahl ist (ein Ausdruck, leer, ein Platzhalter), wird nicht
      still umgewandelt.
    - Die Umwandlung nennt jeden solchen Parameter und fragt nach einer Zahl und einer Art. Ohne
      Antwort entsteht keine Datei; die alte Definition bleibt.
  - Migrationstest: ein Makro mit einem Ausdruck als Vorgabe.
- Die gespeicherten Makros des Operators fasst die Umstellung nicht an. Die Migration ändert die
  Sektion nicht, sie liest sie nur.

**Wächter (Stufe C)**

- `dialogs.spec`: Neu-Dialog, Löschbestätigung, Discard-Rückfrage im Tab.
- `keyboard-guards`: Makroentwurf beim Tabwechsel, statt bisher im Settings-Dialog.
- `run-hold.spec`: Hold an Leiste und Tab mit Revision; eine neue Revision während des Holds bricht
  ab, der nächste volle Hold sendet genau `run_macro` mit der neuen Revision. Dazu die Fälle von
  „Run und Editorentwurf“.
- Fokus beim Wechsel der Ausrichtung (R69, Frage 5):
  - Ein fokussierter Makro-Button behält seinen Fokus über das neue Element, zugeordnet über den
    Makronamen, nicht über den Index.
  - Ein offener Parameterdialog, dessen Auslöser neu gemountet wurde, kehrt zum neuen Button
    zurück, sonst zum Ersatzpunkt des Dialogstapels.
  - Seitliches Scrollen der Zeile löst keinen Hold aus; jeder Button ist per Touch und Tastatur
    ganz erreichbar.
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

**Folgerungen für den Plan** (korrigiert nach R69, VP69-01):
- Das Leeren am ENDE eines MDI-o-Calls heißt nicht, dass der nächste Aufruf leer BEGINNT.
  - Eine MDI-Remap, die das Makro als Helfer ruft, hinterlässt es im Cache.
  - Bleibt die Maschine in MDI, kehrt das heutige `set_mode` früh zurück, und der Aufruf nimmt den
    alten Offset.
  - Deshalb setzt `run_macro` vor jedem Einstieg den Cache zurück (Stufe B, „Cache-Reset vor dem
    Einstieg“).
- Ein laufendes PROGRAMM, das das Makro per `o<…> call` ruft, hält den Cache für den ganzen Lauf,
  und der Interpreter liest der Bewegung voraus. Dagegen hilft die gemeinsame Zulassung: kein
  Suite-Schreiber veröffentlicht, solange ein Start offen ist.
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

## Antworten auf Codex' Planrunde R69

| Punkt | Antwort | Planänderung / Abnahme |
|---|---|---|
| VP69-01 (P1) | Angenommen. Leeren am Ende ≠ leerer Beginn; der MDI-Remap-Fall trifft den Vertrag. | Stufe B „Cache-Reset vor dem Einstieg“: `run_macro` sendet immer `SET_MODE(MDI)`, ohne die frühe Rückkehr. Das ist der Reset-Pfad jedes MANUAL→MDI-Wechsels (`emcTaskSetMode` → `emcTaskAbort` → `Interp::reset` → `offset_map.clear()`), mit Quellstellen und Wirkung im Ruhezustand. Die einzige Bedingung, unter der LinuxCNC den Wechsel ignoriert (`jogging_is_active()`), prüft das Gateway an ihrer Quelle, dem HAL-Pin `motion.jog-is-active`, frisch und FALSE; dazu die Stolperleine auf dem Fehlerkanal. Abnahme an einem eigenen Sim mit Byte-Rechnung: Remap `M499` → Helfer, Kopf um 300 Bytes gekürzt, `run_macro` ohne Moduswechsel; rot ohne Reset (Meldungen 1–13 fehlen oder Lesefehler). Folgerung im Interpreter-Abschnitt korrigiert. |
| VP69-02 (P1) | Angenommen. | Neuer Abschnitt „Gemeinsame Zulassung von Schreiben und Start“: Startanspruch über EINE Startfunktion; freigegeben nur vom Statuslauf mit Nachweis (Seriennummer, Status, IDLE); Schreiber prüfen unmittelbar vor dem atomaren Veröffentlichen unter `_source_lock`. `/upload` und `/save` sind Schreiber, mit gegenseitigem Namensausschluss zu den Makros. Makroordner und `PROGRAM_PREFIX` überlappen nie. Sperrreihenfolge benannt, das milltask-Arbeitsverzeichnis wird über `/proc` geprüft. Abnahmefälle wie gefordert. |
| VP69-03 (P2) | Angenommen. | `POST /macro-upload?replace=<revision>`, unter der Schreibzulassung geprüft; 409 mit dem aktuellen Stand, keine automatische Wiederholung. Zwei-Client-Test: r2 bleibt, wenn As Bestätigung r1 betrifft. |
| VP69-04 (P2) | Angenommen. | Kopfzeile `UNITS mm|inch` (Pflicht bei `length`/`feed`). Einstieg als Autorenregel, vom Gateway als Text geprüft: erst `M73`, dann `G21`/`G20`, `G94`, `G97` nach Bedarf. Was M73 nicht leistet (Abort, G0/G1), steht in Doku und Hilfe. Abnahme am metrischen Sim in G20 + G95. `UNITS inch` ist im Test abgedeckt, am Sim nicht (benannt). |
| VP69-05 (P2) | Angenommen, nach dem Programmeditor. | Abschnitt „Run und Editorentwurf“: Run derselben Datei gesperrt bei Entwurf, Laden oder Konflikt, im Tab und an der Leiste aus einer Ableitung. Import und Delete fragen zuerst. Abnahmefälle wie gefordert. |
| Frage 2, Kopf | Angenommen. | Doppelte Positionen und Keys, leere Keys, `min` > `max` und nicht ganzzahlige Vorgaben bei `integer` werden abgelehnt. Kopfwörter in Großbuchstaben sind reserviert, Beschreibungen frei. Die Textprüfung nennt berechnete und indirekte Befehle als Grenze. |
| Frage 3, FRAME | Angenommen. | Autorenvertrag inklusive indirekter Helfer. Eine `G53`-Suche gibt nur eine Warnung. |
| Frage 4, Schwelle | Angenommen. | Die gemessene Schwelle; Prüfung unter, an und über der Schwelle, mit Touch-Maßen, aktivem Reiter und Fokus beim Wechsel zur Auswahl. |
| Frage 5, Hochformat | Angenommen. | Fokus über den Makronamen, Rückkehrpunkt des Dialogs, Scrollen ohne Hold, jeder Button erreichbar. |
| Frage 6, Settings | Angenommen. | Dialoginventar nachgeführt (Fälle 3, 6 und 20, neue Discard-Rückfrage im Tab); Escape bleibt E-Stop. |
| Hinweise | Angenommen. | „Convert to file“ wandelt nicht still um und hat einen Migrationstest mit Ausdruck. Die Suchreihenfolge steht nur noch an einer Stelle. Die INI-Länge wird in Bytes geprüft. |

## Ablauf

1. Codex-Planrunde zu dieser Fassung.
2. Stufe A, Gate, Renderings für den Operator.
3. Stufe B, Gate, Live-Probe am XYZAC-Sim (jedes Beispiel).
4. Stufe C, Gate.
5. Codex-Umsetzungsrunde(n).
6. Live-Blick des Operators, dann Merge nach `development`.
