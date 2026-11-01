# R245 · FH-05-Nachprüfung

Stand `1cd1591e`, Diff `99260c56..1cd1591e`, Produktzweig `feat/snap-highlight`. Eigene Archivkopie: `/tmp/codex-r245-ukvcssko/repo`. Keine Produktänderung, keine Maschinenbefehle und kein Zugriff auf die LAN-Sim. Der eigene Mock auf `127.0.0.1:4188` ist beendet.

## Ergebnisse

- Build grün; `codeGlide` und `propShadow`: 6/6 Unit-Tests.
- Neun ursprüngliche R244-Proben grün, ausschließlich der Ausgabepfad geändert. Darunter alle acht Neustarts, erstes Folgen, Wegscrollen im Codefenster, kleine/große Dateien vorwärts/rückwärts, Unterprogramm und Sim-Ende/Filter/Resize/Tab.
- Gezielte Repository-Browserprüfung: 9/10 grün. Der neue Sim-Wegscroll-Wächter meldete einmal einen nicht sichtbaren neuen Eintrag; isoliert wiederholt 3/3 grün. Dieser einzelne Ausfall ist vollständig im Protokoll enthalten, keine nachträgliche Umwertung des ersten Laufs.
- Neue Gegenprobe zum wartenden Sim-Schritt: 5/5 Versuche mit einem oder zwei unsichtbaren Band-Bildern, obwohl das neue Ziel schon im DOM steht und sein erster Folge-Frame möglich war.
- Gleichartiger Kontrollfall nach Ende der Wartezeit: 5/5 ohne unsichtbares Band.
- Alle 410 Dateien unter `lcnc-webui/src` bytegleich zum geprüften Commit.

## Ablauf der Gegenprobe

Die echte Scrub-Bar-Eingabe des Mock-Programms wird von 0,60 auf 0,62, nach 24–28 ms auf 0,64 gesetzt. Nach weiteren 60 ms ist der erste Schritt beendet und das Band wird für den wartenden nächsten Schritt gehalten. Die Liste wird per `scrollTop` so weit hochgescrollt, dass dieses Band eine Zeilenhöhe unter der Ansicht steht. Dann folgt ein neues Scrub-Ziel 0,66 (`L43@43`, vorher `L42@42`).

Der Recorder wird erst durch einen MutationObserver auf die **neue DOM-Markierung** gestartet. Sein rAF wird damit nach der Gelegenheit des Post-Flush-Watchers eingereiht, das Folgen zu planen. Das vermeidet die Verwechslung einer bereits aktualisierten Zeile mit einer Messung vor deren erstem möglichen Folge-Frame. Gemessen wird anschließend mit rAF plus Timeout, wie auch beim neuen Repository-Sim-Wächter. Die Frames vor der neuen Markierung und das absichtliche Wegscrollen selbst sind kein Befund.

Der Kontrollfall unterscheidet sich nur durch 250 statt 60 ms zwischen zweiter Zieländerung und Wegscrollen: Dann ist die Wartezeit vorbei und kein Band mehr gehalten. Das neue Ziel rastet korrekt ein.

## Reproduktion

Eigene Archivkopie von `1cd1591e`, passende Abhängigkeiten und `npm run build`. Danach die drei `*.spec.ts`-Belege nach `lcnc-webui/e2e/` kopieren, die Konfiguration als `playwright.r245.config.ts` ablegen. `OUT` in den Sonden auf ein vorhandenes Ausgabeverzeichnis setzen. In den Testkopien `localhost:4174` durch `127.0.0.1:4188` ersetzen, einschließlich des WS-Kontrollkanals in `ctl.ts`.

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
```

Mit einem Worker seriell ausführen; die Tests teilen den Mock-Zustand:

```sh
npx vitest run src/codeGlide.test.ts src/propShadow.test.ts
npx playwright test --config playwright.r245.config.ts e2e/fixed-highlight.r245.codex-probe.spec.ts --grep 'R244 first|restarting without|status after scrolling|independent'
npx playwright test --config playwright.r245.config.ts e2e/fixed-highlight.r245.codex-pending.spec.ts e2e/fixed-highlight.r245.codex-pending-control.spec.ts
npx playwright test --config playwright.r245.config.ts e2e/layout.spec.ts e2e/sim-panel.viewer.spec.ts --grep 'a follow with no highlight|the list scrolled away|the code rests on a line|the highlight stands still while|playback at ×(50|100)|a moved window|a new result keeps'
npx playwright test --config playwright.r245.config.ts e2e/sim-panel.viewer.spec.ts --grep 'the list scrolled away' --repeat-each=3
```

Die Kopien im tatsächlichen Lauf hießen `r245.codex.spec.ts`, `r245.pending.spec.ts` und `r245.pending-control.spec.ts`. Die vollständigen Logs und Rohdaten stehen in `fixed-highlight.r245.codex-validation.txt` und `fixed-highlight.r245.codex-frames.json`. Maßgeblich für den neuen Rest sind dort `sim-pending` und `sim-pending-control` (je fünf Versuche).

Chromium/Mock-Prüfung; kein vollständiger Gate-Lauf wiederholt. Der Fehler erfordert keine Maschinenaktivität und ist über die öffentliche Scrub-/Listenoberfläche nachweisbar. Der Beleg beschreibt einen sichtbaren Anzeigenrest, keine Überschreitung der vereinbarten 160-ms-Planzeit.
