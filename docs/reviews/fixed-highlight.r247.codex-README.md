# R247 · Positionsfarbe und Werkzeugmarken

Geprüft: `5f9fd3b9..cc5a463d`, Produktzweig `feat/snap-highlight`. Eigene Archivkopie `/tmp/codex-r247-2_4n60rz/repo`; keine Änderungen am Produktcode und keine Zugriffe auf die LAN-Sim. Der eigene Mock auf `127.0.0.1:4188` wurde beendet.

## Ergebnisse

- Produktions-Build bestanden.
- 57/57 Unit-Tests: `themeTokens`, `toolChangeScan`, `propShadow`.
- Neue Repository-Browserwächter: 6/6 bestanden (Positionsfüllung/Lesetext in fünf Themes und die kombinierte Markenspalte).
- Eigene positive Browserprobe bestanden: M600/M601 aus dem Text, M6 mit vom Gateway bestätigtem Werkzeug, unverfälschte Kommentarzeile, Programmwechsel, Entladen und erneutes Laden ohne alte Marken.
- Eigene Gegenprobe rot: `#<m600_count>`, `#<m6>` und `#<m601_done>` werden als Werkzeugwechsel markiert, obwohl `tool_change_lines` leer ist und das Programm keine entsprechenden Befehle enthält. Drei falsche Marken im Code sowie drei entsprechende Einträge in der Sim-Liste.
- Alle 411 Dateien unter `lcnc-webui/src` bytegleich zum geprüften Commit. `viewer/toolChangeScan.ts` ist gegenüber dem Basiscommit ebenfalls unverändert: Der neue Codeverbraucher übernimmt einen bereits vorhandenen Fehler der gemeinsamen Quelle.

Die Initialfassung der positiven Probe hatte zusätzlich verlangt, dass die Scrub-Komponente beim Entladen aus dem DOM verschwindet. Das ist kein Produktvertrag; die Komponente bleibt gemountet. Diese Harness-Annahme wurde entfernt. Die protokollierte Schlussfassung prüft die geleerten Codezeilen und ausbleibende alte Marken beim nächsten Programm.

## Reproduktion

Eigene Archivkopie von `cc5a463d`, passende Abhängigkeiten und `npm run build`. Danach `fixed-highlight.r247.codex-probe.spec.ts` nach `lcnc-webui/e2e/` und die Konfiguration als `playwright.r247.config.ts` kopieren. `OUT` auf ein vorhandenes Ausgabeverzeichnis setzen. In den Testkopien `localhost:4174` durch `127.0.0.1:4188` ersetzen, einschließlich des WS-Kontrollkanals in `ctl.ts`.

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
```

Die Tests teilen den Mock-Zustand; seriell ausführen:

```sh
npx vitest run src/themeTokens.test.ts src/viewer/toolChangeScan.test.ts src/propShadow.test.ts
npx playwright test --config playwright.r247.config.ts e2e/contrast.spec.ts e2e/layout.spec.ts --grep 'the Sim tab marks the position|a code line names its findings'
npx playwright test --config playwright.r247.config.ts e2e/fixed-highlight.r247.codex-probe.spec.ts
```

Im tatsächlichen Lauf hieß die Sondenkopie `r247.codex.spec.ts`. Der rote Fall verwendet das beigefügte `fixed-highlight.r247.codex-names.ngc` als Text und eine Vorschau mit drei Punkten auf L1/L7/L8, aufsteigender Sequenz, ohne Grenzbefunde und mit `tool_change_lines: []`. Er liest die gerenderten Codemarken und die Werkzeugwechsel-Zeilen der Sim-Liste über die öffentliche Oberfläche, ohne Vue-Zustandsinjektion oder Produktmutation.

Belege: `fixed-highlight.r247.codex-results.json`, `fixed-highlight.r247.codex-names.png`, `fixed-highlight.r247.codex-validation.txt` und `fixed-highlight.r247.codex-metadata.json`.

## Abgrenzung

Chromium/Mock-Prüfung; kein vollständiger Gate-Lauf und keine native Maschinenprüfung. Die Kontrastwächter behalten die bereits vereinbarte Ausnahme für die festen Identifikationsfarben `--mark-*` bei, auch für so eingefärbte Zeilennummern. Die grünen Kontrasttests sind daher keine Aussage, dass diese Farben auf jedem Hintergrund 4,5 : 1 erreichen. Die neue Positionsfüllung und ihr gewöhnlicher Lesetext bestehen die fünf Theme-Prüfungen.
