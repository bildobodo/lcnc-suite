# R60 — Nachprüfung auf b70b068

Archivkopie `/tmp/codex-r60-sw4f270a`, Commit
`b70b068b1087af925149a16184a62abc1a1ce4bd`. Live-Quellen und Live-Ports nicht
verwendet; eigener Mock `127.0.0.1:4188`, anschließend beendet. R59-Belege
unverändert. Nachfolgende Dateinamen tragen das Präfix `viewer-palette-fest.r60.`.

## Handler-Prüfung

`transitions.test.ts` und `vitest.config.ts` als `r60-transitions.test.ts`
bzw. `r60.vitest.config.ts` in das Archiv-Frontend kopieren; Ausgabeordner
`<Archiv>/evidence` anlegen. Die Sonde liegt bewusst außerhalb von `src`.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r60.vitest.config.ts
```

Echte Status-/Bulk-Handler, synthetischer Worker. R59-Folge nun mit
Erhalt von A als Sollwert: A angewandt → B ausstehend → A erneut gewünscht →
verspätetes B → unveränderter Status → B erneut gewünscht und angewandt.
Beide Varianten geprüft: A = Payload-Start 10 und A = zuvor bestätigte Basis
20. Der Rückwechsel erzeugt keinen zusätzlichen Decode; der spätere Wunsch
nach B erzeugt genau einen. Resultate: `transitions-10.json`,
`transitions-20.json`. Das sind jetzt Abnahme-Assertions, keine Diagnosen
des alten Fehlers.

## Browser und Anzeige

`browser.spec.ts` nach `<Archiv>/lcnc-webui/e2e/r60.spec.ts`,
`playwright.config.ts` als `r60.playwright.config.ts` ins Archiv-Frontend
kopieren. Nur im Archiv beide URLs in `e2e/ctl.ts` auf `127.0.0.1:4188`
setzen; `tsBuildInfoFile`-Pfade von `./node_modules/.tmp/` nach
`../r60-ts-cache/` umstellen, damit der Buildcache im Archiv bleibt.

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
MOCK_PORT=4188 MOCK_HOST=127.0.0.1 nice -n 19 node e2e/mock-gateway.mjs
```

In einem zweiten Terminal im selben Archiv-Frontend:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r60.playwright.config.ts --grep 'R60|a return to the basis|a changed tool offset|a mid-run re-parse'
```

Die eigene Browser-Sonde basiert auf R59. Änderungen: neues Dateipräfix,
Commit und erwartetes Ergebnis nach der verspäteten Antwort (−10 bleibt
stehen); zusätzliche Prüfung des reinen Zeilentextes und tatsächliches
Öffnen/Schließen der Hilfe. Sie verzögert weiterhin ausschließlich die
Zustellung einer echten Worker-Antwort. Die gemessenen R58-Zustände bleiben
abgedeckt. JSON-Warntexte enthalten auch den verborgenen Hilfeinhalt; der
sichtbare Text wird separat als `firstChild.textContent` geprüft.

Resultate `browser.json`, `return-browser.json`; Bilder
`pending-basis.png`, `ignored-reply.png`, `reason-help.png`.

## Ergebnis

- Build PASS (`build.txt`).
- Frontend 64/64 (`frontend-tests.txt`): vorhandene Bulk-/Status-/Export-
  Tests plus zwei eigene Handler-Prüfungen.
- Browser 5/5 (`browser.txt`): drei vorhandene gezielte Fälle und zwei
  eigene Nachprüfungen.
- Backend unverändert in diesem Bereich: keine Python-Tests wiederholt.
- Kein vollständiges Offline-Gate und keine Live-Abnahme wiederholt.
