# R244 · unabhängige Prüfung

Geprüft: `4ad87515..99260c56`, Produkt in `feat/snap-highlight`. Eigene Archivkopie: `/tmp/codex-r244-4ynyl998/repo`. Keine Produktänderungen; kein Zugriff auf die LAN-Sim oder Maschinenbefehle. Nur diese Belege und der Review-Anhang wurden im Live-Baum geschrieben. Der eigene Mock `127.0.0.1:4188` ist beendet.

## Ergebnis

- Build bestanden; `codeGlide` und `propShadow`: 6/6 Unit-Tests.
- 15 Repository-Browserwächter bestanden: zehn für Schrittverhalten, Altersgrenze, feste Markierung, Unterprogramm, Touch-Zeilenhöhe und Sim ×50/×100; zwei für Fenster-/Ergebniswechsel der Sim-Liste; drei für echtes erstes Touch (Home-Halten, MDI und Werkzeug-Suche).
- Sechs eigene unveränderte Übergangsproben aus R243 bestanden: Dateien mit 1.200/600.000/2.000.000 Zeilen vorwärts/rückwärts und an beiden Enden, Sim-Ende/Filter/Resize/Tab, Unterprogramm sowie manuelles Scroll-Mapping großer Dateien. Nur Ausgabepfad und erläuternder Kommentar angepasst.
- Neue Gegenprobe: Nach einem Stopp fehlt bei der ersten Folgebewegung die sichtbare Markierung. Am R244-Build 8/8 Versuche mit jeweils einem außerhalb liegenden Highlight-Frame; am R243-Build dieselbe Probe 8/8 ohne solchen Frame.
- Ergänzende Gegenprobe: Nach manuellem Wegscrollen beginnt auch ein gehaltenes Band außerhalb des Bildes (zwei Frames). Das absichtliche Wegscrollen selbst wird nicht beanstandet, erst das automatische Folgen des neuen Status.
- Die zwei ersten explorativen Startfälle stehen ebenfalls im Protokoll: einmal grün, einmal rot. Der wiederholte Neustartfall ist der tragende Nachweis.

## Reproduktion

Eine eigene Archivkopie von `99260c56` erstellen, passende Abhängigkeiten bereitstellen und `npm run build` ausführen. Dann die Sonde nach `lcnc-webui/e2e/r244.codex.spec.ts` und die Konfiguration nach `lcnc-webui/playwright.r244.config.ts` kopieren. `OUT` in der Sonde auf ein vorhandenes Ausgabeverzeichnis setzen. In den **Testkopien** `localhost:4174` durch `127.0.0.1:4188` ersetzen (auch `ws://` in `ctl.ts`). Mock:

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
```

Die Tests müssen wegen des gemeinsamen Mock-Zustands seriell laufen:

```sh
npx vitest run src/codeGlide.test.ts src/propShadow.test.ts
npx playwright test --config playwright.r244.config.ts e2e/r244.codex.spec.ts --grep 'restarting without|status after scrolling'
npx playwright test --config playwright.r244.config.ts e2e/r244.codex.spec.ts --grep 'independent|manual scroll'
npx playwright test --config playwright.r244.config.ts e2e/layout.spec.ts e2e/sim-panel.viewer.spec.ts --grep 'the running line steps|the highlight stands still while|the code rests on a line|expanded subroutine|lays its rows|playback at ×(50|100)'
npx playwright test --config playwright.r244.config.ts e2e/sim-panel.viewer.spec.ts --grep 'a moved window|a new result keeps'
npx playwright test --config playwright.r244.config.ts e2e/safety-during-edit.spec.ts --grep 'first touch'
```

Der Neustartfall folgt erst L1, beendet den Lauf (`interp_state:1, motion_line:0`), scrollt zum Anfang und beginnt danach bei L43 (`interp_state:2, task_mode:2`). Die Zielzeile wird aus der tatsächlichen Viewporthöhe berechnet; der Weg liegt unter der Zwei-Ansichten-Sprunggrenze. rAF erfasst die tatsächlich gerenderten Positionen. Die Assertions zählen nur Frames mit der neuen aktiven Zeile bzw. dem neuen Band. Nach einem manuellen Scroll sind die Frames vor dem neuen Follow ausgenommen.

Für den Gegenvergleich wurde ausschließlich `dist` der **eigenen Kopie** durch den bereits gebauten R243-Stand `4ad87515` ersetzt. Derselbe Neustart-Test blieb unverändert; anschließend wurde R244-dist wiederhergestellt. Keine Mutationen am Produktcode.

## Belege und Grenzen

- `fixed-highlight.r244.codex-probe.spec.ts`: öffentliche Mock-/Preview-/DOM-Wege, keine Vue-Zustandsinjektion.
- `fixed-highlight.r244.codex-frames.json`: Rohbilder als Geometrie-/Zeitmesswerte; Schlüssel `restarts-head`, `restarts-r243`, `scroll-away` sowie die sechs Regressionen.
- `fixed-highlight.r244.codex-validation.txt`: Build, Unit-Tests und alle genannten Browserläufe, einschließlich roter Gegenproben.
- `fixed-highlight.r244.codex-metadata.json`: Ursprung, Ergebnisse und bytegleicher Vergleich aller 410 Quelldateien unter `lcnc-webui/src`.

Chromium im isolierten Mock; kein vollständiger Gate-Lauf wiederholt. Kein Nachweis einer harten Echtzeitgrenze bei blockiertem Eventloop oder eines Alters gegenüber der tatsächlichen Maschine. Die Altersprüfung der neuen Repository-Wächter gilt dem lokalen Folgen bei regelmäßigen Paketen. Die endgültige Sichtpräferenz des Operators wurde hier nicht ersetzt.
