# Codex R166: Reproduktion

Prüfstand `a53db42e` aus `git archive` in `/tmp/codex-r166-red5e_ov/repo`, eigene Kopie vorhandener node_modules aus R165. `nice -n 15 npm run build` vor dem Einfügen der Sonden: PASS. Alle 380 verfolgten Dateien unter `lcnc-webui/src` stimmen mit den Git-Blobs überein. Kein Produktcode geändert.

## Unit-Prüfung

Beiliegende `vitest.config.ts` als `vitest.codex-r166.config.ts` in `lcnc-webui` ablegen:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run --config vitest.codex-r166.config.ts src/viewer/simListRange.test.ts src/viewer/simWindow.test.ts src/viewer/simRows.test.ts src/simPanelStore.test.ts src/viewer/contactPublisher.test.ts
```

63/63 PASS in fünf Dateien. Die geänderte Publisher-Testdatei ist eingeschlossen. Den neuen Beleg zu `p_view_dirties` gelesen, keine Mutation selbst erneut ausgeführt; `p_view_dirties` wird in seinem neuen Bericht durch die Assertion der begrenzten Scheibenzahl gefangen.

## Browser vorbereiten

Beiliegende `playwright.config.ts` als `playwright.codex-r166.config.ts`; die drei Spezifikationen als `e2e/codex-r166-{focus,longtask,roundoff}.viewer.spec.ts`. Nur in der Archivkopie `localhost:4174` in `e2e/ctl.ts` durch `127.0.0.1:4188` ersetzen. Ausgabeordner vorher anlegen; Leistungs-JSONs dürfen noch nicht existieren (die Spezifikationen hängen an).

Ein Chromium-Worker, Trace aus, niedrige Priorität, kein paralleler CPU-Lauf. Freigegebene Ausführung außerhalb der Sandbox wegen des Bindeverbots; eigener Mock ausschließlich auf `127.0.0.1:4188`, keine Live-Ports. Alle in Tests simulierten Status-/Befehlspakete bleiben dort.

### Vorhandene Wächter

```sh
nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r166.config.ts e2e/sim-panel.viewer.spec.ts --grep "a long list|spacers|between the portions|a moved window|rows' keys|result change under the focus|list follows the position|playback at|hidden tab and is shown|a size change|keeps ONE tab stop"
```

12/12 PASS. Der tatsächlich ausgeführte erste Befehl enthielt zusätzlich die eigene Fokus-Spezifikation und den Grep-Zweig `^R165`; wegen des Dateipräfixes im vollständigen Playwright-Testnamen erfasste er diese sechs Tests nicht. Sie wurden anschließend separat ausgeführt, nicht als bestanden angenommen.

### Gegenproben aus R165

```sh
R165_OUT=/tmp/r166-out nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r166.config.ts e2e/codex-r166-focus.viewer.spec.ts
```

6/6 PASS. Testnamen und die Ausgabevariable `R165_OUT` bleiben zur Herkunftskennzeichnung erhalten. Einzige Anpassung gegenüber der abgelegten R165-Sonde: `await settleLayout(page)` zwischen dem anfänglichen Setzen von 150 % CSS-Zoom und `simShow`. Sie wartet zwei Animationsframes auf die Umschaltung der schmalen Seitennavigation. Keine Assertion geändert; `probe-adaptation.diff` zeigt genau die eine hinzugefügte Zeile. Die als Race gemeldete Konstellation wurde nicht eigens ohne Wartepunkt wiederholt; der Helper wurde geprüft und die Anpassung übernommen.

Die erste neue Portion wird per MutationObserver, danach jeder Frame beobachtet. Der Tab-Fall sendet echte Playwright-Tab-Tasten; `tab.json` hält ausdrücklich fest, dass der erste Tastendruck noch bei `data-list-complete="0"` auf einer Zeile landet. Fokus, genau ein Tab-Stopp, Wechsel zurück zum regulären Stopp, Tabellenhöhe und Spalten sind in den Rohdaten und `probe-summary.json` enthalten. Die Zoomprüfung betrifft die CSS-Emulation, nicht nativen Browserzoom.

### Leistung

```sh
LT_OUT=/tmp/r166-out/browser-keys.json LT_KEYS=1 nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r166.config.ts e2e/codex-r166-longtask.viewer.spec.ts e2e/codex-r166-roundoff.viewer.spec.ts
LT_OUT=/tmp/r166-out/browser-pointer.json LT_KINDS=wideDecimal nice -n 15 node node_modules/@playwright/test/cli.js test --config playwright.codex-r166.config.ts e2e/codex-r166-roundoff.viewer.spec.ts
python3 ../docs/reviews/viewer-palette-fest.r164.codex-acceptance.py /tmp/r166-out/browser-keys.json /tmp/r166-out/acceptance.json
```

Die beiden Leistungsspezifikationen sind bytegleich zu R165: vier Formen am Budget, jeder Kontaktschritt wartet bis `data-list-complete="1"`, nach Abbruch darf die Tabelle fehlen. Auch das Abnahmeskript aus R164 ist unverändert. `LT_KEYS=1` bedeutet wiederholtes Drücken und Loslassen von Shift; gemessen wird `event.timeStamp` bis zum Capture-Handler. Kein realer Maschinenbefehl und keine End-to-End-Messung einer Maschine. Keine gemeldete lange Aufgabe bedeutet keine Überschreitung der Beobachterschwelle, nicht null Rechenzeit.

Claudes vollständiges Gate gelesen, nicht vollständig wiederholt. Im Live-Baum nur Review-Anhang, neue `r166.codex-*`-Belege und der abschließende Handshake; vorhandene Dateien außer dem Anhang unverändert.
