# R246 · FH-05 abgeschlossen

Geprüft: `1cd1591e..5f9fd3b9`, Produktzweig `feat/snap-highlight`, eigene Archivkopie `/tmp/codex-r246-6qxa2x4w/repo`. Keine Änderungen am Produktcode, keine Tests/Builds im Live-Baum oder Claudes Worktree und keine Zugriffe auf die LAN-Sim. Der eigene Mock auf `127.0.0.1:4188` wurde beendet.

## Ergebnisse

- Produktions-Build bestanden; `codeGlide` und `propShadow`: 6/6 Unit-Tests.
- Drei eigene Browserproben bestanden: die unveränderte R245-Timer-Gegenprobe (fünf Versuche), der unveränderte Kontrollfall (fünf Versuche) und die bestehende Sim-Ende-/Filter-/Resize-/Tab-Probe.
- Beide Sim-Wegscroll-Wächter je dreimal seriell: 6/6 bestanden.
- Fünf weitere Repository-Wächter bestanden: Codefenster nach Stopp/Wegscrollen, verschobenes Sim-Fenster, neues Ergebnis nach manuellem Scrollen, Wiedergabe ×50 und ×100.
- Gesamt: 14/14 gezielte Browserprüfungen. Kein vollständiger Gate-Lauf wiederholt.
- Alle 410 Quelldateien unter `lcnc-webui/src` bytegleich zum geprüften Commit.

Die R245-Sonden wurden nur im Ausgabepfad angepasst; dieser Vergleich wurde zusätzlich maschinell geprüft. Im früher roten Timer-Fall stand in allen fünf Versuchen vor dem Eingriff tatsächlich ein gehaltenes Band. Nach dem Wegscrollen und neuen Ziel gab es in keinem Versuch ein unsichtbares Band-Bild. Der Recorder beginnt weiterhin erst nach der beobachteten neuen DOM-Markierung und der Gelegenheit, deren Folgen im nächsten Frame auszuführen.

## Reproduktion

Eigene Archivkopie von `5f9fd3b9` erstellen, passende Abhängigkeiten bereitstellen und `npm run build` ausführen. Die drei `*.spec.ts`-Belege nach `lcnc-webui/e2e/`, die Konfiguration als `playwright.r246.config.ts` kopieren. `OUT` in den Sonden auf ein vorhandenes Ausgabeverzeichnis setzen. In den Testkopien `localhost:4174` durch `127.0.0.1:4188` ersetzen, einschließlich `ws://` in `ctl.ts`.

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
```

Seriell gegen den gemeinsamen Mock ausführen:

```sh
npx vitest run src/codeGlide.test.ts src/propShadow.test.ts
npx playwright test --config playwright.r246.config.ts e2e/fixed-highlight.r246.codex-pending.spec.ts e2e/fixed-highlight.r246.codex-pending-control.spec.ts e2e/fixed-highlight.r246.codex-probe.spec.ts --grep 'pending Sim|control after|independent Sim ends'
npx playwright test --config playwright.r246.config.ts e2e/sim-panel.viewer.spec.ts --grep 'the list scrolled away:' --repeat-each=3
npx playwright test --config playwright.r246.config.ts e2e/layout.spec.ts e2e/sim-panel.viewer.spec.ts --grep 'a follow with no highlight|playback at ×(50|100)|a moved window|a new result keeps'
```

Im protokollierten Lauf hießen die Sondenkopien `r246.pending.spec.ts`, `r246.pending-control.spec.ts` und `r246.codex.spec.ts`. Aus der letztgenannten Datei wurde nur die genannte Sim-Übergangsprobe ausgeführt; die übrigen enthaltenen Fälle waren bereits in R245 geprüft.

Rohdaten: `fixed-highlight.r246.codex-frames.json` (`sim-pending`, `sim-pending-control`, `sim-transitions`). Laufprotokolle: `fixed-highlight.r246.codex-validation.txt`. Herkunft und Quellenvergleich: `fixed-highlight.r246.codex-metadata.json`.
