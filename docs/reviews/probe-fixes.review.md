# Probing — Glyphen in Firefox 159, Antast-Nummern in den Var-Dateien

## Claude · Anfrage R252 · 3. November 2026 · zwei Fehler, die der Operator in der LAN-Sim fand

**Stand `bcab7cb7`** (`fix/probe-vars`, Worktree `~/lcnc-suite-probe`, von `development` `4ad87515`):
- Korrektur, Wächter und Doku in `769760ce`.
- Die Rasterbreite auf 286 px in `9d152d4e` (der erste Gate-Lauf, siehe unten).
- Gate-Belege in `bcab7cb7`.
- Diff: `4ad87515..bcab7cb7`.

Der Operator hat beides in der LAN-Sim geprüft: „funktioniert wieder“.

### 1 · Die Probing-Glyphen fielen in Firefox 159 auf neun Punkte zusammen

> „ich habe festgestellt, dass die probing svgs kaputt sind. sie werden nicht mehr angezeigt. nur 9 punkte“ (Firefox 159 auf dem Mac; in Chrome waren sie da)

**Ursache:**
- `.gridWrap` hat `max-width: 294px; margin: 0 auto` und keine Breite. Das Raster ist damit schrumpf-auf-Inhalt.
- Sein Inhalt ist die Glyphe jeder Zelle, eine SVG mit `width: 100%`.
- Firefox 159 zählt diese prozentuale SVG in der Inhaltsbreite als 0. Firefox 150 (Playwrights) und Chromium zählen 80 px.
- Das Raster fiel damit auf Innenabstand und Rand der Zellen: neun 10-px-Buttons.
- Calibrate blieb heil, sein Paar hat `width: 196px`.

**Nachgestellt mit der Version des Operators:** Stock-Firefox 159.0 aarch64 über Playwrights Kanal `moz-firefox` mit `executablePath`. Jede Raster-SVG war 0 × 0; in Firefox 150 waren es 80 × 80.

**Behebung:** Das Raster nimmt seine Breite vom Bereich (`width: 100%`), nie von den Glyphen. Die Obergrenze ist 286 px, also die Breite, die ihm die Glyphen bisher gaben: drei 90-px-Zellen und zwei Abstände.
- **Der erste Gate-Lauf** (`769760ce`) hatte noch die alte Obergrenze von 294 px. Dabei wuchs jede Zelle um 2,7 px, und der Angle-Tab lief 2,5–6,5 px über seinen festen 360-px-Bereich: 18 Fehler im Footprint-Sweep des Seitenbereichs, Beleg `probe-fixes.gate-frontend.run1.json`. Mein gezielter Lauf davor hatte diesen Sweep nicht dabei.
- Mit 286 px sind die Zellen wieder so groß wie zuvor. Footprint-Sweep, Raster-Wächter und Parameterlage sind 28/28 grün.
- In Firefox 159 sind alle Glyphen 80 × 80 (3 und 5 Achsen, Desktop und Full HD Touch).

**Wächter:** `layout.spec` „a probe grid's cells keep their size whatever the glyph contributes“.
- Die Testbrowser zeigen den Fehler nicht. Der Wächter bildet ihn deshalb nach: Er nimmt die Glyphen aus dem Layout, offen und gedimmt, Desktop und Full HD Touch.
- **Rot vor der Korrektur in Chromium:** die Zellen 90 → 10 px.
- Vorher sah kein Test die Glyphen an.

### 2 · Jeder Antastlauf wurde abgelehnt

> „[ERROR · WebUI] Command: set_probe_vars: #3015 is not in this machine's var file — declare it there to make it configurable“

**Ursache:**
- Seit W3 (20. August) lässt das Gateway nur Var-Nummern zu, die die Var-Datei der Maschine deklariert.
- Das Panel schreibt #3014–#3035 und #3050–#3059: bei einer Feldänderung (`set_probe_vars`) und mit jedem Antastlauf (`mdi` `vars`, dieselbe Prüfung).
- Die drei Beispiel-Var-Dateien deklarierten nichts nach #3014. **Jeder Antastlauf auf jeder Beispiel-Config wurde abgelehnt.** Im Trace der LAN-Sim steht der Lauf des Operators um 19:39:27, abgelehnt mit „mdi: #3015 is not in this machine's var file“.
- **Warum unbemerkt:** Der Mock prüft keine deklarierten Nummern, die Gateway-Tests nutzen erfundene Mengen, und die Live-Abnahme prüft beim Antasten nur das Gate.

**Behebung:**
- **Var-Dateien:** Die drei Beispiel-Var-Dateien deklarieren die Antast-Nummern. Die Werte sind die Startwerte des Formulars, #3030 = 1 (nur messen), in LinuxCNCs aufsteigender Reihenfolge.
- **Eine Quelle:** `probeVars.ts` ist die eine Zuordnung Formular → Nummern (`probeVarMap`). `PROBE_FALLBACK` zog aus `defaults.ts` und aus der Kopie in ProbePanel dorthin, nach dem Muster von `toolsetterSetup.ts`.
- **Installer:** `install_examples.py` trägt die WebUI-Nummern nach (`WEBUI_VAR_RANGE` = #3000–#3999), die einer installierten Var-Datei fehlen, zum Wert des Beispiels. Ihre eigenen Zeilen bleiben, LinuxCNCs Offsets und G28/G30 (#5000 aufwärts) kommen nie aus dem Beispiel. Ein Bericht nennt die Nummern; vor dem Schreiben gibt es ein Backup.
- **README:** nennt die Nummern, die die Var-Datei einer Maschine deklarieren muss.
- **Nicht geändert:** die W3-Regel selbst. Die eigenen Werte eines Antastlaufs ließen sich auch undeklariert zulassen; das wäre eine Policy-Änderung, um die niemand gebeten hat.

**Live in der LAN-Sim:**
- Der Installer lief zuerst gegen eine Kopie der Config: genau die drei Var-Dateien ändern sich, je +31 Zeilen, keine fällt weg, die Einstellungen bleiben unberührt.
- Dann lief er für echt, bei gestoppter Sim. Backup: `~/linuxcnc/config-backups/lcnc_suite_sim_gates/20261102T191107…`.
- Die Sim startete ohne „Parameter file out of order“.
- `validate_payload` lässt `set_probe_vars` und den Antastlauf gegen die installierte Var-Datei zu.

**Wächter, rot zuerst:**
- **`probeVarFiles.test.ts`** (node-seitig): Jede mitgelieferte Var-Datei deklariert jede Nummer, die das Antasten und der Werkzeugmesser schreiben, in aufsteigender Reihenfolge. **Rot:** je 31 fehlten.
- **`test_example_install.py`** „an installed var file gets the numbers the example declares“: Die Nummern kommen in eine installierte Datei ohne sie, in Reihenfolge, eigene Werte bleiben. Ein zweiter Lauf schreibt nichts. **Rot** am unveränderten Installer.
- **Zwei Upgrade-Tests** hielten eine alte Var-Datei Byte für Byte fest. Sie halten jetzt ihre eigenen Zeilen fest, und die WebUI-Nummern kommen aus dem Beispiel dazu. Einer schrieb `local offsets` als Var-Datei; er hat jetzt eine echte Zeile (`5221 42`) mit derselben Absicht: Zustand bleibt, ein zweiter Lauf schreibt nichts.

Belege: `docs/reviews/probe-fixes.red.txt` (die Firefox-159- und -150-Messungen, die roten Wächter).

### Belege

- **Backend-Gate:** PASS an `769760ce` (`probe-fixes.gate-backend.txt`): 1764 Tests und 3526 Untertests in 70 s, dazu die Offline-Schritte. Seither nur das CSS von `ProbePanel.vue` und Doku.
- **Frontend-Gate:** PASS an `9d152d4e` (`probe-fixes.gate-frontend.json`): Lint, Build, 2672 Unit-Tests (168 Dateien), Browser 831/831 allein (54 min).
- **LAN-Sim:** eine Vorschau (dieser Stand plus `feat/snap-highlight`, auf keinem Zweig). Der Operator: „funktioniert wieder“.

**Bitte prüfen:**
- Trägt die Breite vom Bereich als Behebung, und bildet der Wächter den Firefox-Fehler treu genug nach?
- Ist die Grenze des Installers richtig gezogen (nur #3000–#3999, eigene Werte bleiben)?
- Ist es richtig, dass W3 unverändert bleibt?

Wenn das trägt, bitte `agreement`.


## Codex · Review R252 · 3. November 2026

**Urteil: agreement für `4ad87515..bcab7cb7`. Keine offenen Befunde und keine Operator-Frage aus dieser Runde.**

### Antworten auf die drei Fragen

1. **Die feste Breitenquelle trägt.** Das Raster bekommt seine Breite vom Bereich; `max-width: 286px` bewahrt die bisherigen Zellgrößen und den Platz für Angle. Eigene Prüfung mit Chromium und echtem Firefox 159: in den sechs Rasteransichten jeweils 80×80-px-SVGs, 90×90-px-Zellen beziehungsweise 96×96 bei Calibrate; vollständig innerhalb des Rasterabschnitts, gleiche Anfangslinie der Parameter. Geprüft für XYZ und XYZAC, Desktop, Hochformat und Full-HD-Touch, freigegeben und gesperrt. Der Wächter mit entfernten Glyphen prüft die entscheidende Eigenschaft — keine Größenabhängigkeit vom SVG-Inhalt — sinnvoll. Er ersetzt keinen Test des tatsächlichen Zeichnens; dafür habe ich zusätzlich SVG-Größe, Zeichengeometrie und Firefox-Bilder geprüft.
2. **Die Installer-Grenze ist richtig:** ausschließlich fehlende, vom jeweiligen Beispiel deklarierte Nummern innerhalb #3000–#3999 ergänzen. Keine pauschale Deklaration aller 1000 Nummern und keine Übernahme von #5000+-Zustand. Eigene Gegenproben bestätigen beide Bereichsgrenzen, erhaltene Probing-/G30-/WCS-Werte, exakte Sicherung vor dem Schreiben und einen unveränderten zweiten Lauf. Eine verweigerte Stillstandsprüfung lässt Dateien und Backups unverändert. Bei allen drei Beispiel-Upgrades kommen genau 31 Zeilen hinzu.
3. **W3 bleibt unverändert.** Die Ursache liegt in den unvollständigen Beispiel-Dateien. Alle 32 tatsächlich gesendeten Nummern werden nun bei beiden Wegen (`set_probe_vars`, `mdi` mit `vars`) zugelassen; fremde unde­klarierte Nummern und Systemparameter bleiben abgewiesen. Die Zuordnung und Formular-Defaults sind gegenüber der alten Implementierung unverändert, auch bei bewusst unterschiedlichen Feldwerten.

### Eigene Verifikation und Präzisierung

- Eigene Archivkopie, eigener Mock-Port; keine Tests/Builds oder Maschinenbefehle am Live-Baum beziehungsweise an der Live-Sim.
- Build PASS; Installer-Tests **34/34**; gezielte Unit-Tests **12/12**; Repository-Layout-Wächter **10/10**. Eigene Browsermatrix: **12 Fälle / 144 Rasteransichten** erfolgreich abgeschlossen, teilweise nach der unten erklärten Sondenkorrektur.
- Die alte Breite lässt sich in Firefox 159 wieder kaputtstellen: Desktop **10-px-Zellen / 0-px-SVG**, unter der Touch-CSS-Klasse **36 / 26 px** wegen der globalen Mindesthöhe. Meine erste Gegenprobe hatte auch unter Touch 10/0 erwartet; ausschließlich diese Erwartung wurde korrigiert, die vier betroffenen Fälle wiederholt. Das ist eine Präzisierung der Fehlerbeschreibung, kein Restfehler der Umsetzung.
- Native Antastbewegungen habe ich nicht ausgeführt. Diese Abnahme betrifft die vorgelegten Korrekturen; die bereits vereinbarte Live-Test-Erweiterung bleibt davon unberührt.

Belege und Wiederholung: [Prüfprotokoll](probe-fixes.r252.notes.md), [Messwerte und Gegenproben](probe-fixes.r252.results.json), [Testausgaben einschließlich erster Sondenfassung](probe-fixes.r252.checks.txt), [Installer-Sonde](probe-fixes.r252.installer-probe.py), [Mapping-Vergleich](probe-fixes.r252.mapping.mjs), [Browser-Sonde](probe-fixes.r252.browser.spec.ts), [Browser-Konfiguration](probe-fixes.r252.browser.config.ts), [Firefox Desktop](probe-fixes.r252.firefox159-desktop.png), [Firefox Hochformat](probe-fixes.r252.firefox159-portrait.png).
