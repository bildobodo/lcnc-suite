# R76 · Codex · Prüfprotokoll · 2026-10-05

Scope: `d560d22..2796ab9`, Fix `780e066`, Anfrage im Live-Stand `b670b6e`.
Arbeitskopie: `/tmp/codex-r76-9l3nh3b2/archive`, aus `git archive 2796ab9`.
Kein Produktcode geändert, keine Maschinenbefehle, keine Verbindungen zu
:5173/:8000. Alle Browserprüfungen am eigenen Mock `127.0.0.1:4188`.

## Wiederholung

1. Den Commit als Archiv in ein temporäres Verzeichnis entpacken.
2. Node-Abhängigkeiten verwenden; hier einzelne Symlinks in einem eigenen
   `node_modules`, ohne `.tmp`, `.vite`, `.vite-temp`, `.cache` zu übernehmen.
3. Nur in der Kopie tsconfig-Buildcache `./node_modules/.tmp/` nach
   `../r76-ts-cache/` verlegen, Vite `cacheDir: '../r76-vite-cache'` ergänzen.
4. In `e2e/ctl.ts` `localhost:4174` durch `127.0.0.1:4188` ersetzen.
5. Die beigefügten Konfigurationen unter `lcnc-webui` als
   `r76.vitest.config.ts`, `r76.chromium.config.ts`, `r76.firefox.config.ts`
   ablegen. Die Sonde als `lcnc-webui/e2e/r76.probe.spec.ts` ablegen.
   Einen Ordner `evidence` neben `lcnc-webui` anlegen.

Aus `lcnc-webui`, Browser nacheinander mit jeweils einem Worker:

```sh
nice -n 19 env VITE_GATEWAY_PORT=4188 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r76.vitest.config.ts --maxWorkers=1
nice -n 19 node node_modules/@playwright/test/cli.js test --config r76.chromium.config.ts --grep-invert 'rendered flash colours'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r76.firefox.config.ts --grep-invert 'rendered flash colours'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r76.firefox.config.ts --grep 'rendered flash colours'
```

Die ersten beiden Browserläufe wurden ausgeführt, bevor der letzte Fall zur
Sondendatei hinzugefügt wurde (damals ohne `--grep-invert`); die Befehle oben bilden
mit der gespeicherten Endfassung denselben Prüfumfang nach. Der letzte Fall ist
die anschließende Diagnose des roten Firefox-Tests, ohne Produkt-/Testkorrektur.

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Build | PASS; nur die bestehende Vite-Warnung zu großen Chunks |
| Unit `flashClock.test.ts` | PASS, 3/3 |
| Chromium 148, Linux | PASS, 6/6 in 20,6 s |
| Firefox 150, Linux | 5/6 in 17,8 s; neuer Appearance-Farbvergleich rot |
| Eigene native Farbgegenprobe in Firefox | PASS, 1/1 in 5,2 s |

Browser jeweils 1600×1000, DPR 1. Der Test `appearance.spec.ts` ist unverändert.
Die neuen Lifecycle-Proben behalten Verweise auf die ursprünglichen
CSSAnimation-Objekte, prüfen deren Abbruch (`playState: idle`), die neue
Animation und ihre Startzeit 0. Getestet werden echte Mock-Statuswechsel und die
Media-Präferenz; Ausblenden/DOM-Aufnahme werden separat an einer nicht bedienten
Kopie des echten CSS-Buttons geprüft.

Der Firefox-Fehler betrifft `tinted`: `color(srgb …)` liegt auf der Skala 0–1,
der RGB-Zweig vergleicht aber mit 4. Der On-Zustand wird dadurch als Off gezählt.
Die eigene Gegenprobe übergibt die native CSS-Farbe dem Canvas-Parser und liest
RGBA-Werte. Über 30 Messpunkte mit 45 ms Abstand kommen beide Zustände vor,
stimmen bei Button/Banner immer überein, und die Zeiten/Phasen stimmen ebenfalls.
Alle Rohfarben, RGBA-Werte und Animationszeiten stehen im JSON.

Das rote Originalergebnis bleibt als solches dokumentiert. Kein Screenshot ist
für den Nachweis des Skalenfehlers erforderlich; entscheidend sind die nativen
Farbzeichenfolgen und derselbe An/Aus-Vergleich in einer einheitlichen Skala.

Produktprüfung: vollständiger angefragter Diff; alle vorkommenden `flash-`-
Animationen und ihre Dauer; Listener-Installation vor dem Mount; unveränderte
CSS-Regeln für reduzierte Bewegung. Keine verwendete Flash-Pause/Delay- oder
Shadow-DOM-Sonderbehandlung im aktuellen Produktpfad gefunden. Keine allgemeine
Zusage für künftig hinzukommende Animationen mit anderen Zeiteinstellungen.

Kein voller Offline-Gate-/Backend-Lauf, keine macOS- oder Live-Sichtprüfung.
Funktion technisch bestätigt; offener Testbefund VP-I36 (P3).
