# Codex R165: Reproduktion

Prüfstand `8b2044b7`, `git archive` nach `/tmp/codex-r165-l2uqdqzs/repo`. Eigene Kopie vorhandener node_modules aus R164. Vor dem Einfügen der Sonden: `nice -n 15 npm run build` — PASS. Alle 380 verfolgten Quelldateien unter `lcnc-webui/src` stimmen mit den Git-Blobs überein. Keine Produktänderung.

## Gezielte Unit-Prüfung

Beiliegende `vitest.config.ts` als `vitest.codex-r165.config.ts` in `lcnc-webui` ablegen:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r165.config.ts src/viewer/simListRange.test.ts src/viewer/simWindow.test.ts src/viewer/simRows.test.ts src/simPanelStore.test.ts src/viewer/contactPublisher.test.ts
```

62/62 PASS in fünf Dateien. Ein vorangegangener Lauf hatte den Store irrtümlich unter `src/viewer` angegeben (61 PASS in vier Dateien); die beigefügte Ausgabe `targeted.txt` ist der korrigierte vollständige Lauf. Keine unveränderten großen Geometriesuiten erneut ausgeführt.

## Browser vorbereiten

Beiliegende `playwright.config.ts` als `playwright.codex-r165.config.ts`. Die drei Spezifikationen `focus.viewer.spec.ts`, `longtask.viewer.spec.ts`, `roundoff.viewer.spec.ts` als `e2e/codex-r165-{focus,longtask,roundoff}.viewer.spec.ts`. Nur in der Archivkopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen. Ausgabeordner vorher anlegen; die Leistungsdateien dürfen vor dem Lauf noch nicht existieren, die Spezifikationen hängen an.

Ein Chromium-Worker, Trace aus, niedrige Priorität, kein paralleler CPU-Lauf. Eigener Mock ausschließlich auf `127.0.0.1:4188`; Ausführung außerhalb der Sandbox wegen des Bindeverbots freigegeben. Sämtliche Status-/Befehlssimulationen gehen nur an diesen Mock.

### Vorhandene Wächter

```sh
nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r165.config.ts e2e/sim-panel.viewer.spec.ts --grep "a long list|spacers|between the portions|a moved window|rows' keys|result change under the focus|list follows the position|playback at"
```

9/9 PASS, 28,4 s: neue Portionen-/Spalten-/Spacer-Prüfungen, verborgener Tab, Home/End, Filter-/Programmwechsel während des Füllens, Fenster-/Fokuswechsel und Mitlaufen.

### Eigene Gegenproben

```sh
R165_OUT=/tmp/r165-out nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r165.config.ts e2e/codex-r165-focus.viewer.spec.ts
```

Erwartung am Prüfstand: **Exit 1, zwei grün und vier rot** (17,9 s). Drei rote Fälle belegen VP-I121: Fokus und Tab-Stopp getrennt im Desktop/Hochformat sowie echte Tab-Tasten während des Füllens. Ein weiterer roter Fall misst die benannte Cache-Grenze beim Wechsel der CSS-Zoom-Emulation nach der ersten Zeilenabstandsmessung; das ist kein Nachweis nativen Browserzooms. Die zwei grünen Geometrieproben setzen 150 % **vor** der ersten Messung.

Die Ausgabe `probe-summary.json` fasst die Rohdaten zusammen. Die Fokusproben beobachten per MutationObserver die erste neue Portion und anschließend jeden Frame; kein künstliches Anhalten der Renderframes. Der Tab-Fall fokussiert beim ersten neuen DOM die Listenhilfe, sendet dann echte Playwright-Tab-Tasten und vergleicht den Einstieg nach vollständigem Füllen. Die Hilfsfunktionen stammen aus `sim-panel.viewer.spec.ts`; die Gegenproben wurden ergänzt. Ein erster Entwurf des Tab-Falls verwendete einen falschen `button`-Selektor für das `span` der Hilfe und lieferte keinen Befund. Der beigefügte Endlauf verwendet `.helpIcon` und scheitert an der eigentlichen Assertion. Frühere Arbeitsläufe lieferten dieselbe fehlende Tab-Zeile und dieselbe Cache-Abweichung; keine zusätzliche Abnahme daraus gezählt.

### Leistung bis zum Ende des DOM-Aufbaus

```sh
LT_OUT=/tmp/r165-out/browser-keys.json LT_KEYS=1 nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r165.config.ts e2e/codex-r165-longtask.viewer.spec.ts e2e/codex-r165-roundoff.viewer.spec.ts
LT_OUT=/tmp/r165-out/browser-pointer.json LT_KINDS=wideDecimal nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r165.config.ts e2e/codex-r165-roundoff.viewer.spec.ts
python3 ../docs/reviews/viewer-palette-fest.r164.codex-acceptance.py /tmp/r165-out/browser-keys.json /tmp/r165-out/acceptance.json
```

4/4 mit Tasten und 1/1 ohne Tasten PASS. Die Spezifikationen stammen aus R159 (`longtask`) und R163 (`roundoff`); einzige Ablaufanpassung: die Schleife jedes Kontaktschritts endet zusätzlich erst bei `data-list-complete="1"` (oder wenn nach Abbruch keine Tabelle mehr da ist). Die vier Datenformen und Budgets sind unverändert. Das R164-Auswertungsskript ist unverändert und jetzt grün.

`LT_KEYS=1` sendet wiederholt `page.keyboard.press("Shift")`, jeweils Keydown und Keyup. Die Verzögerung ist `event.timeStamp` bis zum Capture-Handler. Kein realer Maschinenbefehl, keine Aussage über dessen End-to-End-Latenz. Keine gemeldete lange Aufgabe bedeutet nicht 0 ms Arbeit; der Long-Task-Observer meldet erst Überschreitungen seiner Schwelle. Die separat gemessenen langen Aufgaben beim Programmwechsel bleiben außerhalb der Leistungsabnahme von Form 1.

Claudes vollständiges Gate und Mutationsberichte gelesen, nicht vollständig wiederholt. Im Live-Baum nur Review-Anhang, neue `r165.codex-*`-Belege und abschließend Handshake. Keine Live-Ports, Builds dort oder realen Maschinenbefehle.
