# Button-Gates: welches Bedienelement in welchem Zustand freigegeben ist

**Fassung 1 · 25. Oktober 2026 · Review durch Codex, Verhandlung mit Claude · kein Code ·
Stand `b2ded6d1` (`development` = `feat/backlog-integration`).** Anfrage R202.

## Anlass

Der Operator, 25. Oktober:

> Ich brauch bei der lcnc suite ein Review mit den Buttons-Gates: welche Buttons wann aktiviert
> werden dürfen. […] Derzeit ist es so, dass ARM/DISARM zum Teil auch eine Navigation durch das UI
> verhindert. Das soll geprüft werden. Dann gibt es Fälle wie: Ich kann kein Programm laden, wenn
> die Maschine nicht referenziert ist. Die Buttons erlauben es aber tatsächlich, diese Aktion
> auszuführen. Oder gewisse Aktionen, die nicht durchgeführt werden können, wenn die Maschine aus
> ist. Zum Beispiel: Ist es normal, dass der Mode nicht gewechselt werden kann, wenn die Maschine
> aus ist? Oder die Jog-Increments? Welche Aktionen brauchen Homing, welche nicht? Kann man die
> Offsets nicht editieren, wenn die Maschine nicht gehomed ist? Usw.

Er will, dass du das Review machst und wir beide verhandeln, bis wir ein gemeinsames Agreement
über den besten Weg haben.

## Auftrag

**Du reviewst, ich verhandle und setze danach um.** Prüfe nicht nur meine Ausgangsbefunde unten.
Bring eigene Befunde und Gegenvorschläge, auch zu Dingen, die ich nicht sehe.

**Die Invariante, gegen die geprüft wird:** Ein Bedienelement ist genau dann freigegeben, wenn
der Befehl, den es sendet, in diesem Zustand angenommen würde **und** in diesem Zustand sinnvoll
und gefahrlos ist. Daraus folgen zwei Fehlerklassen:

- **Zu großzügig:** freigegeben, aber das Gateway oder LinuxCNC lehnt ab (oder ignoriert still).
- **Zu streng:** gesperrt, obwohl die Aktion in diesem Zustand gefahrlos und sinnvoll ist,
  typisch eine Aktion ohne Bewegung hinter einem Bewegungs-Gate oder eine reine Ansicht hinter
  `armed`.

Dazu die dritte Art: Frontend und Backend sind uneins (Katalog-Gate ≠ `COMMAND_GATES`, eine
Gate-Verschachtelung oder ein `:disabled` macht etwas anderes als der Katalog), oder die
Erklärung einer gedimmten Kontrolle (`permission_reasons` / `gateExplain`) nennt einen anderen
Grund als den, der wirklich sperrt.

### Die Fragen des Operators

- **G1 · Arm/Disarm und Navigation.** Was darf ein nicht gearmter Client? Tabs, Viewer, Lesen
  (Programmtext, Werkzeugtabelle, Offsets, Meldungen), Hilfe, Download, lokale Einstellungen.
- **G2 · Programm laden ohne Referenzierung.** Freigegeben, scheitert (Befund 2).
- **G3 · Maschine aus.** Was ist bei Maschine aus (E-Stop zurückgesetzt, nicht eingeschaltet)
  sinnvoll und von LinuxCNC erlaubt, z. B. der Moduswechsel?
- **G4 · Jog-Schrittweite und Jog-Geschwindigkeit.** Lokale Vorwahlen hinter dem `jog`-Gate.
- **G5 · Homing.** Welche Aktionen brauchen eine Referenzierung, welche nicht? Insbesondere
  Jog vor dem Referenzieren (Achsen freifahren, vorpositionieren).
- **G6 · Offsets unreferenziert.** WCS-Werte editieren, WCS wählen, löschen.
- **G7 · „usw.“** Die vollständige Durchsicht aller übrigen Kontrollen.

### Zustände

- getrennt;
- verbunden, nicht gearmt (Beobachter, auch nach dem Idle-Auto-Disarm);
- gearmt + E-Stop;
- unquittierter Safety-Trip;
- E-Stop zurückgesetzt, Maschine aus;
- Maschine an, nicht referenziert;
- teilweise referenziert;
- referenziert, idle (MANUAL / MDI / AUTO);
- MDI läuft;
- Programm läuft;
- pausiert (auch an M6);
- Simulationsmodus;
- `eoffset` aktiv;
- Reader veraltet.

Kinematikmodi (Identität / TCP / Plane) nur, wo ein Gate davon abhängt.

## Wo die Gates leben

- **Die Politik ist im Backend:**
  - `lcnc-gateway/command_policy.py` — `GATE_REQUIREMENTS` (:498), `COMMAND_GATES` (:600),
    `permission_reasons`; ein Tisch entscheidet und erklärt.
  - Dazu die Prüfungen in den Handlern von `gateway.py`: `require_armed`,
    `reject_if_auto_running`, `set_mode` (meldet einen ignorierten Wechsel),
    `_rfl_busy`, `require_tool_change_pending` u. a.
- **Das Frontend:**
  - `permissions.ts` legt nur `armed`, `busy` und `sim` darüber;
  - `machineControls.ts` ist der Katalog (`BUTTON_TYPES`, `INPUT_DEFS`);
  - `Gate.vue` ist das Fieldset; die Verschachtelung steht in `App.vue`, den Strips und Panels;
  - dazu einzelne `:disabled`, `gateExplain.ts`, `simMode.ts`;
  - `useKeyboardShortcuts.ts` und `useGamepad.ts` senden ebenfalls Befehle.
- **Doku:** CLAUDE.md „Permission System“, `docs/architecture/safety-and-permissions.md`.

## Ausgangsbefunde (von mir am Code geprüft — bitte bestätigen oder widerlegen)

1. **Disarm sperrt die Navigation.**
   - Die äußere `<Gate gate="armed">` umschließt den Inhalt (`App.vue:1992`) und den Strip
     (`App.vue:2460`).
   - Im Katalog sind `tabMain`, `tabSub`, `nav` und `tabSelect` `always`
     (`machineControls.ts:175`, `:176`, `:195`, `:318`). Das Fieldset sperrt sie trotzdem.
   - Der Overlay in `permissions.ts` UND-verknüpft `armed` ohnehin in jedes Gate außer `always`.
     Das Fieldset ist also die grobe zweite Schicht, die auch reine Ansichten trifft.
   - Häufig wird der Fall durch den Idle-Auto-Disarm (`App.vue:1284`, Settings → Machine).
2. **Programm laden ist freigegeben, scheitert aber unreferenziert.**
   - `fileOp` und `load_file` / `unload_file` = `setup` (armed + kein E-Stop + idle;
     `command_policy.py:681`, `machineControls.ts:94`). Weder Maschine an noch referenziert ist
     verlangt.
   - Der Handler schaltet zuerst nach AUTO (`gateway.py:5282–5312`, `set_mode(MODE_AUTO)`).
   - Trace vom 25.10., 19:11–19:14 ([Beleg](button-gates.r202.trace-mode-switch.txt)): vier
     `task.mode_switch_ignored`, gewünscht AUTO, geblieben MANUAL, `homed: false`. Drei davon mit
     Maschine an, eine mit Maschine aus.
   - Welcher Befehl sie auslöste (Laden oder die Modus-Wahl „Auto“), zeigt der Trace nicht.
     Sehr wahrscheinlich die Ladeversuche des Operators.
   - **Offen und entscheidend:** Lehnt LinuxCNC AUTO unreferenziert selbst ab (Quelltext)? Braucht
     `program_open` überhaupt AUTO? Wie öffnen AXIS, gmoccapy und QtDragon eine Datei
     unreferenziert oder im E-Stop? Davon hängt ab, ob das Gate strenger wird oder das Laden ohne
     Referenzierung funktionieren soll.
3. **Moduswahl.** `modeSelect` und `set_mode` = `idle` (Maschine an, idle;
   `machineControls.ts:287`). „Auto“ ist unreferenziert wählbar und wird dann ignoriert, wie in
   Befund 2.
4. **Jog-Schrittweite und Jog-Geschwindigkeit.**
   - `jogIncrement` und `jogSpeed` = `jog` (Maschine an + referenziert;
     `machineControls.ts:269`, `:270`).
   - Beide sind lokale Vorwahlen: `JogStrip.vue` emittiert `update:jogIncrement` bzw.
     `update:jogVel`. Ein Maschinenbefehl geht davon nicht aus, erst der Jog selbst nimmt die
     Werte mit. Die Schieber tragen dazu `:disabled="isDisabled"` (`jogWheel`-Gate oder
     `jogDisabled`, `JogStrip.vue:119`).
5. **Jog vor dem Referenzieren.**
   - `jog` = Basis + idle + referenziert.
   - Aus Erinnerung, nicht am Quelltext geprüft: LinuxCNC erlaubt den Gelenk-Jog im freien Modus
     unreferenziert, erst der Welt-Jog (teleop) braucht die Referenzierung.
   - Trifft das zu, lässt sich bei uns eine unreferenzierte Maschine nicht von einem Endschalter
     freifahren und nicht vorpositionieren. Bitte am Quelltext und an den Referenz-Oberflächen
     prüfen.
6. **Offsets.**
   - `offsetCell`, `wcs`, `wcsSelect`, `set_wcs` und `clear_wcs` = `probe` (referenziert + kein
     `eoffset`; `machineControls.ts:108`, `:203`, `:279`).
   - Geschrieben wird per MDI `G10`. Aus Erinnerung, nicht geprüft: LinuxCNC lehnt MDI
     unreferenziert ab, außer mit `NO_FORCE_HOMING`. Bitte am Quelltext klären.
   - Eine Alternative ohne MDI (Var-Datei, das Gateway hat Schreiber unter `_var_file_lock`)
     hätte Folgen für den Interpreter-Sync (siehe den G30-Abschnitt in CLAUDE.md). Bitte abwägen
     statt annehmen.

## Referenzen, die du heranziehst

- **LinuxCNC selbst**, Quelltext der installierten Version (`dpkg -s linuxcnc-uspace`, der
  passende Git-Tag), gelesen, nicht erinnert:
  - `emctaskmain.cc`: die Vorbedingungen je Befehl, die „not homed“-Ablehnungen;
  - `emctask.cc`: `emcTaskSetMode`;
  - `NO_FORCE_HOMING`;
  - Gelenk- gegenüber Welt-Jog;
  - was Task in ESTOP, OFF und unreferenziert annimmt.
- **Verbreitete Oberflächen:** AXIS, gmoccapy, QtDragon / QtVCP, probe_basic. Welche Widgets
  geben sie in welchem Zustand frei (Programm öffnen, Modus, Jog, Schrittweite, Offsets,
  Werkzeugtabelle, MDI)?
- **Industriesteuerungen**, wo belegbar (Sinumerik, Heidenhain, FANUC): Programmanwahl ohne
  Referenzpunkt, JOG vor dem Referenzieren, Nullpunkttabelle.
- **Normen** nur, wo sie etwas aussagen (IEC 60204-1 Steuerfunktionen, ISA-101 HMI).
- Primärquellen mit Links, wie in den früheren Recherchen.

## Grenzen — nicht neu verhandeln, außer ein Befund zwingt dazu

- Die Kinematik-Regeln aus den TWP-Wellen: `machineFrame`, `touchoff*`, `twpCapture`, `goZero`,
  `planeFrame`, `g30Capture`.
- `armed` ist die Berechtigung für **neue** Maschinenbefehle, kein Totmann. Stopps sind immer
  erlaubt, Abort bleibt konstant, Escape ist E-Stop.
- Die `eoffset`-Regel (`_R_NO_EOFFSET`).
- Der Simulationsmodus schließt die Maschinen-Gates.
- Die Politik bleibt im Backend: ein Tisch entscheidet und erklärt. Das Frontend legt nur
  client-lokale Terme darüber.

## Was am Ende stehen soll

1. **Prinzipien** in wenigen Sätzen, aus denen sich jede Kontrolle einsortieren lässt, auch
   künftige.
2. **Soll-Matrix:** Kontrollgruppe × Zustand, Ist → Soll, mit Gate-Namen. Sie wird die neue
   Tabelle in CLAUDE.md und `docs/architecture/safety-and-permissions.md`.
3. **Befunde `BG-01` …**, jeweils mit:
   - Priorität:
     - P0 Sicherheit;
     - P1 Funktion falsch (freigegeben, scheitert; gesperrt, obwohl sinnvoll);
     - P2 Bedienbarkeit oder Erklärung.
   - Beleg: Code-Stelle, Live-Messung oder Quelle.
   - Vorschlag.
4. **Fragen an den Operator**, getrennt aufgeführt.
5. **Wächter:** Jede vereinbarte Änderung kommt mit einem vorher roten Test. Mögliche Kandidaten:
   - eine Konsistenzprüfung: Gate der Kontrolle = Gate des Befehls, den sie sendet. Die gibt es
     noch nicht:
     - `commandPath.test.ts` prüft nur die Aufrufstellen (jeder Befehl geht über `fire()` oder
       ist eingeordnet);
     - `test_command_policy.py` prüft nur, dass jeder Befehl in `COMMAND_GATES` steht;
     - einen Vergleich zwischen Katalog und Backend habe ich nicht gefunden;
   - die Abdeckung in `test_command_policy`;
   - ein Zustands-Sweep im Browser (`layout.spec`);
   - `scripts/twp_buttons_check.py` für alles, was einen Bewegungsbutton berührt.

   Die Abnahme prüft, was der Operator sieht.

## Arbeitsweise und Regeln

- **Nur Review, kein Produktcode.** Belege als `docs/reviews/button-gates.r<N>.*`. In diese Datei
  nur anhängen (Abschnitt „Codex · Runde n · R<N>“).
- **Der Live-Baum `~/lcnc-suite` wird ausgeliefert.** Vite lädt Quellen sofort neu, und die
  XYZAC-Sim läuft auf :8000.
  - Dort keine Builds, Tests oder Checkouts.
  - Tests in einer eigenen Kopie (Worktree oder Archiv von `b2ded6d1`).
- **Live-Messungen an der Sim sind erlaubt**, nur an der Sim, nie an echter Hardware. Erlaubt sind
  Zustandswechsel wie E-Stop, Maschine an/aus, Home/Unhome, Modus und Laden/Entladen, über einen
  eigenen WS-Client (Token in der INI; mehrere Clients dürfen gearmt sein) oder über
  `linuxcnc`-Python für LinuxCNCs eigenes Verhalten. Dabei:
  - den vorgefundenen Zustand notieren und wiederherstellen: geladenes Programm, Offsets,
    Werkzeug, Referenzierung, Modus;
  - immer mindestens einen WS-Client verbunden lassen, sonst löst der HAL-Watchdog aus;
  - nur Programme laufen lassen, die du vorher gelesen hast (`5axis_demo.ngc` schreibt G54 und
    G92);
  - jede Messung mit Uhrzeit im Beleg.
- **Protokoll:** Steht dein Review in der Datei, meldest du zurück:

  `python3 scripts/review_handshake.py done R202 --verdict findings|agreement|question --note "<ein Satz>"`

  - `question` heißt: Eine Operator-Entscheidung ist nötig.
  - Ich antworte in dieser Datei und melde die nächste Runde mit `review_handshake.py request`.
    Die Nachricht kommt automatisch in deinen Thread.
  - Runden bis zum Agreement über Prinzipien, Matrix und Befundliste.
  - Danach setze ich um, auf einem eigenen Branch, jeder Wächter vorher rot. Dann folgen
    Implementierungsrunden auf demselben Weg.
  - Merge nur nach `development`.

---
