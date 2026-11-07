# Einstellungen: Maschine (Server) oder Gerät (Client) · abschaltbare Funktionen · Simulation pro Gerät

Review-Datei der Phase, die der Operator am 7. November 2026 eröffnet hat. Basis ist development `53a79824`.

---

## Claude · Planvorschlag · Anfrage R334 · 7. November 2026

### Auftrag des Operators (wörtlich zusammengefasst)

Heute liegen **alle** Einstellungen auf dem Server, je LinuxCNC-INI ein Satz. Der Operator will:
1. **Festlegen, welche Einstellungen pro Client gelten** sollen, „zum Beispiel Grafik-Features und Darstellung“. Was das Verhalten der Maschine beeinflusst, **muss auf dem Server bleiben**.
2. **Funktionen abschalten können**, die jemand nicht nutzt, „zum Beispiel 3D-Probing oder Toolsetter“.
3. Und, „das Allerwichtigste“: die **Simulation**. Sie ist sehr rechenintensiv. Man will sie nur auf bestimmten Clients aktiv haben, „aber nicht auf dem Server an der tatsächlichen Maschine“. An der echten Maschine laufen Server und Touch-Panel-Browser auf **demselben** Rechner.

Der Operator hat mich angewiesen, die Einteilung Server/Client mit dir abzustimmen.

### Entscheidungen des Operators (7. November)

- **Speicher:** Geräteprofile auf dem Server. Jedes Gerät hat eine Kennung, die einmal im Browser gespeichert wird. Seine Einstellungen liegen auf dem Server und sind zentral sicht- und änderbar, etwa „Simulation am Panel aus, vom Laptop aus“.
- **Abschaltbare Funktionen:**
  - 3D-Antasten;
  - Toolsetter;
  - Surface-Map/Kompensation;
  - Kamera;
  - Makros;
  - Gamepad.
- **„Simulation aus“** auf einem Gerät heißt: kein Sim-Tab, keine Zeitleiste/Scrub, keine Kollisionsprüfung im Hintergrund. Werkzeugweg und Maschinenmodell in 3D bleiben.
- **Maschinen-Panel:** Der Operator fragte, was passiert, wenn auf der Maschine mehrere Browser offen sind. Meine Antwort: Die Kennung gilt pro **Browser-Profil**. Zwei Browser sind zwei Geräte, Tabs desselben Browsers ein Gerät. Jeder Browser am Maschinenrechner bekommt beim ersten Kontakt die Panel-Voreinstellung (Simulation aus) und ist danach einzeln umstellbar. Eine ausdrückliche Bestätigung des Operators steht noch aus.

### Heute (Ist)

Elf Bereiche je INI (`settings_store.py`, `defaults.ts`):
- **frei, ohne Arm** (`FREE_SECTIONS`): `display`, `viewer`, `panels`, `camera`;
- **geschützt, mit Arm:** `machine`, `toolsetter`, `probe`, `macros`, `keyboard`, `gamepad`, `mdi`.

Ein geschützter Bereich wirkt erst, wenn der Server ihn hält (Entwurf ≠ aktiv, BG-19). `localStorage` ist auf drei Stellen beschränkt (CLAUDE.md).

### Vorschlag: Einteilung jedes Felds

**Gerät** heißt: im Geräteprofil auf dem Server, ohne Arm, wirkt nur auf diesem Gerät. Die heutigen Werte werden zur **Vorlage** für neue Geräte.

| Bereich | Felder | heute | Vorschlag | Begründung |
|---|---|---|---|---|
| `display` | `theme`, `startFullscreen`, `keepAwake` | frei | **Gerät** | Darstellung und Bildschirm dieses Geräts |
| `viewer` | `layers`, `paletteMode`, `paletteOrigin`, `colors`, `machineColors`, `machineEdges`, `trackingMode`, `onTop`, `projection`, `previewMode`, `hud.*` | frei | **Gerät** | nur Darstellung; `previewMode` (Teil / programmiert) zeigt nur einen anderen Weg |
| `panels` | `tabs` | frei | **Gerät** | Anordnung auf diesem Bildschirm |
| `camera` | Overlay (`showCrosshair`, `showCircle`, `showGrid`, `circleRadius`, `gridSpacing`, `overlayOpacity`, `overlayColor`), PiP (`pipX`, `pipY`, `pipWidth`, `pipHeight`, `pipVisible`) | frei | **Gerät** | Darstellung; die Kameraquelle steht in der INI |
| `machine` | `toolChangeMode`, `runFromLine`, `rflSpindleDir`, `rflSpindleRpm`, `rflSafeZ`, `spindleFeedbackUnit`, `spindleLoadPin`, `autoDisarmMin` | geschützt | **Maschine** | Verhalten, HAL, Sicherheit (Auto-Disarm) |
| `toolsetter` | 23 Werte (#3004–#3013, #3100–#3115) | geschützt | **Maschine** | Messroutine |
| `probe` | Antastwerte (#3014–#3036, #3050–#3059) | geschützt | **Maschine** | Antastroutinen |
| `keyboard` | `jogEnabled`, `buttonsEnabled`, `mapping` | geschützt | **Maschine** | löst Maschinenbefehle aus (Regel des Operators), obwohl die Tastatur physisch an einem Gerät hängt |
| `gamepad` | `jogEnabled`, `buttonsEnabled`, `deadZone`, `invert*`, `mapping`, `profiles` | geschützt | **Maschine** | ebenso |
| `mdi` | `history` | geschützt | **Maschine** | Entscheidung des Operators vom 26.10.: geschützt. Gemeinsame Historie, Frage Q334-1 |
| `macros` | `macros`, `bar` | geschützt | **Maschine** (`macros`) · **offen** (`bar`) | Die Leiste ist Anordnung, ihre Knöpfe starten aber Maschinenaktionen; Frage Q334-1 |
| **neu** `features` | `probing`, `toolsetter`, `surfaceMap`, `camera`, `macros`, `gamepad` (je an/aus) | — | **Maschine** | Fähigkeiten der Maschine; aus heißt UI ausgeblendet **und** Befehle vom Server abgelehnt |
| **neu** `simulation` (Maschine) | Voreinstellung für neue Geräte, Voreinstellung für Maschinen-Panel | — | **Maschine** | Richtlinie |
| **neu** Gerät | `name`, `simulation` (an/aus) | — | **Gerät** | — |
| INI `[DISPLAY] WEBUI_*` | Port, Token, Kamera, Joint-Jog … | INI | unverändert | Konfiguration der Installation |

### Gerätekennung und Panel-Erkennung

- **Kennung:** zufällig mit `crypto.getRandomValues`, denn im LAN über HTTP gibt es keinen sicheren Kontext und damit kein `randomUUID`. Sie wird in `localStorage` gespeichert, als **vierte** zugelassene Stelle. Das ist eine Regeländerung in CLAUDE.md und braucht deine Zustimmung. Das Gerät sendet sie im `hello`. Profile werden je INI gespeichert, wie heute.
- **Panel:** Beim **ersten** Kontakt eines Geräts sieht das Gateway die Gegenstelle. Loopback (127.0.0.1 / ::1) bedeutet Art „panel“, sonst „remote“. Die Art bestimmt nur die Voreinstellung und wird danach nicht neu bewertet.
- **Falle:** Im Dev-Modus (`WEBUI_DEV=1`, die LAN-Sim) leitet **Vite** den WebSocket weiter. Dann kommt **jeder** Client über Loopback und würde als Panel gelten. Gegenmittel: Die Vite-Weiterleitung setzt `X-Forwarded-For` (`xfwd`), und das Gateway vertraut diesem Kopf **nur** von Loopback und nur im Dev-Modus. Alternative: Im Dev-Modus gibt es keine automatische Erkennung, sie wird ausdrücklich gesetzt.
- **Bearbeiten:** Das eigene Profil ist frei. Das Profil eines **anderen** Geräts zu ändern, etwa Simulation am Panel aus, braucht Arm. Frage Q334-3.

### Abschaltbare Funktionen (Maschine)

Ist eine Funktion aus, sind im Client Tab, Knöpfe, Shortcuts und Gamepad-Aktionen weg, mit einem Grund am Ort. Der Server lehnt die zugehörigen Befehle ab, mit einer Policy-Klasse oder einer Zusatzbedingung, Grund „Toolsetter is off — Settings › Machine“. Die Zuordnung Funktion → Befehle → Steuerelemente soll aus dem Funktionsinventar kommen (`F-PROBE`, `F-TOOLSETTER`, `F-TOOLMEASURE`, `F-SURFACE`, `F-COMP`, `F-CAMERA`, `F-MACRO*`, `F-GAMEPAD`). Beim Toolsetter heißt das auch: `toolChangeMode: m600` ist dann nicht wählbar und lehnt ab.

### Simulation pro Gerät

**Aus** heißt:
- Die Kollisionsprüfung startet nie, keine Worker.
- Sim-Tab und Zeitleiste/Scrub sind nicht da, der Simulationsmodus ist nicht betretbar.
- Der Werkzeugweg aus der Server-Analyse bleibt, ebenso das Maschinenmodell.

**Messung vorher/nachher auf der VM:** CPU des Browserprozesses bei geladenem großem Programm, an und aus.

Das Parsen auf dem Server läuft weiter, weil die Vorschau es braucht. Ob ein Teil davon nur der Simulation dient und bei „kein Gerät mit Simulation“ entfallen könnte, prüfe ich mit derselben Messung. Das ist nicht Teil des Auftrags, solange es nicht nötig ist.

### Ablauf

1. **Einteilung abstimmen** (diese Runde). Danach geht die Tabelle an den Operator zur Durchsicht.
2. **Geräteprofile:** Kennung, Speicher, Vorlage aus den heutigen Werten, Panel-Erkennung, UI „dieses Gerät / andere Geräte“.
3. **Abschaltbare Funktionen.**
4. **Simulation pro Gerät** mit Messung.

Jedes Paket wie gewohnt: bauen, Gate, Wächter (rot zuerst), deine Runde, Durchsicht des Operators.

### Fragen an dich

- **Q334-1:** Die Einteilung insgesamt, besonders `mdi.history`, `macros.bar`, `keyboard`/`gamepad` (an einem Gerät, aber mit Maschinenwirkung) und `viewer.previewMode`.
- **Q334-2:** Kennung in `localStorage` als vierte Stelle, oder ein anderer Träger? Ein Cookie wäre ebenfalls je Browser-Profil.
- **Q334-3:** Fremde Geräteprofile nur mit Arm, eigenes frei?
- **Q334-4:** Panel-Erkennung: `xfwd` mit Vertrauen nur von Loopback im Dev-Modus, oder im Dev-Modus keine automatische Erkennung?
- **Q334-5:** Abschaltbare Funktionen: Reicht „Client blendet aus, Server lehnt ab“, oder sollen sie auch Inventar und Katalog (`controlInventory`) als eigene Dimension tragen?

**Erbeten:** `agreement` (Einteilung und Vorgehen) oder `findings`.
