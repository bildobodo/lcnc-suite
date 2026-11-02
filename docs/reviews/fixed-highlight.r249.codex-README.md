# R249 · FH-06 und durchgehende Positionsfüllung

Geprüft: `cc5a463d..a93401fc`, eigene Archivkopie `/tmp/codex-r249-rq1yv81l/repo`. Produktquellen nicht verändert. Keine Zugriffe auf die LAN-Sim.

## Ergebnisse

- Build PASS.
- Unit: `themeTokens`, `toolChangeScan`, `propShadow`, 60/60.
- Repository-Browserwächter: fünf Themes der Sim-Positionsfüllung und die kombinierte Codemarkenspalte, 6/6.
- R247-Gegenproben mit lediglich geändertem Ausgabeverzeichnis/Rundennamen: positiver Lebenszyklus und negative Parameternamenprobe, 2/2 PASS.
- Neue Browser-Gegenprobe: FAIL, weil T+#<next>, T+7 und TABS[-7] nach T5 jeweils „Tool change → T5“ anzeigen. `#<next>` ist 7, der Draht enthält keine Werkzeugwechselbestätigung. Ergebnisse protokollieren Code und Sim-Liste.
- Isolierte Scannerprobe: acht Formen; zwei der neuen Unbekannt-Regeln greifen, fünf weitere Formen behalten T5, die intern gespreizte Zahl T1 3 ergibt T1.
- 411 Quelldateien unter `lcnc-webui/src` bytegleich zu `a93401fc`.

## Reproduktion

Archivkopie von `a93401fc`, passende Abhängigkeiten und `npm run build`. Danach die Review-Browserprobe nach `lcnc-webui/e2e/`, die Konfiguration nach `lcnc-webui/playwright.r249.config.ts` und die Scannerprobe nach `lcnc-webui/scanner-probe.mjs` kopieren. Die absoluten Ausgabepfade in beiden Proben auf ein eigenes vorhandenes Verzeichnis setzen. In den E2E-Testkopien einschließlich `ctl.ts` `localhost:4174` durch `127.0.0.1:4188` ersetzen, auch im WS-Kontrollkanal.

Eigener Mock, keine Operatorsim:

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
```

Seriell im eigenen Frontend-Verzeichnis:

```sh
npx vitest run src/themeTokens.test.ts src/viewer/toolChangeScan.test.ts src/propShadow.test.ts
npx playwright test --config playwright.r249.config.ts e2e/contrast.spec.ts e2e/layout.spec.ts --grep 'the Sim tab marks the position|a code line names its findings'
npx playwright test --config playwright.r249.config.ts e2e/r249.codex.spec.ts
node scanner-probe.mjs
```

Die Scannerprobe übersetzt ausschließlich die unveränderte TS-Datei mit der vorhandenen TypeScript-Abhängigkeit und ruft ihre exportierte Funktion auf. Sie schreibt Beobachtungen, kein künstliches PASS für die fehlerhaften Werte. Kein LinuxCNC-/Gateway-Import oder Maschinenzugriff. Die Browserprobe prüft die neue Grenze ausdrücklich mit einer fehlschlagenden Assertion. Der Mock wurde nach den Prüfungen beendet.

## Abgrenzung

Kein vollständiger Gate-Lauf, keine native Ausführung der Programme und kein separater HMR-Test. Der Benutzerwunsch zum gemeinsamen Aussehen der nächsten/gezeigten Zeile wurde als geänderter Vertrag geprüft. Die vorbestehende Ausnahme für `--mark-*`-Identifikationsfarben blieb in den Kontrastwächtern bestehen. FH-07 ist ein Rest der zusätzlich angebotenen T-Wort-Korrektur, keine durch den neuen Highlight-Stil ausgelöste Regression.
