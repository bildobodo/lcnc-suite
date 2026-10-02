# R68 · Reproduktion und Grenzen · Codex · 2. Oktober 2026

Prüfstand: `git archive 10bbabc`, Diff `a8138fc..10bbabc`, Paket 4 auf
`feat/viewer-marks`. Archiv: `/tmp/codex-r68-hm0wav28`. Der Live-Checkout
auf `feat/keypad-keys` wurde nur gelesen; geschrieben werden dort
Review-Anhang, neue R68-Belege und das angeforderte Handshake-`done`.
Keine Builds/Tests/Checkouts im Live-Baum, keine Zugriffe auf :5173/:8000,
keine Maschinenbefehle, keine Produktkorrektur und kein Commit.

## Isolierter Aufbau

- Archiv unter `/tmp` entpacken, `evidence/` daneben anlegen.
- Installierte `lcnc-webui/node_modules` verlinken; nur im Archiv die
  TypeScript-Cachepfade in `tsconfig*.json` von `./node_modules/.tmp/`
  nach `../r68-ts-cache/` verlegen.
- Nur im Archiv `e2e/ctl.ts`: `localhost:4174` durch `127.0.0.1:4188`
  ersetzen. Der Mock lädt das dort gebaute Frontend.
- Beigefügte Configs in `lcnc-webui/` als `r68.vitest.config.ts`,
  `r68.playwright.config.ts` und `r68.probe.playwright.config.ts` ablegen.
  Sämtliche Läufe `nice -n 19`, Browser seriell mit einem Worker,
  eigenem Mock auf `127.0.0.1:4188`, automatisches Beenden nach jedem Lauf.

## Produktstand ohne Instrumentierung

Aus `lcnc-webui/`:

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r68.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test --config r68.playwright.config.ts
```

Der Browserlauf umfasst die beiden vorhandenen Specs `scenes.viewer.spec.ts`
und `toolsetter.viewer.spec.ts`: Boxkanten bei fünf Kombinationen von
Viewportbreite/DPR und zwei Themes, Animationsgrößen, Zwei-Stück-Kette,
Near-Clipping, Phasenverankerung, Endmarken/Labels, Palette und zehn
Nadelprüfungen. Kein vollständiges Offline-Gate, kein erneuter Backend-Test.

## Unveränderte R67-Gegenprobe

Die R67-Sonde und ihr passiver Beobachter wurden bytegleich kopiert:

- `viewer-palette-fest.r68.tween.spec.ts` als `e2e/r67.spec.ts` installieren.
  SHA-256: `8e997bf21090dc68bad2fba7dfa374db23fb465f98624b0c9a14e8369377f846`.
- `viewer-palette-fest.r68.observe.py` als
  `evidence/viewer-palette-fest.r67.observe.py` installieren.
  SHA-256: `1d8c63e76718615582dfef09589803dd6cb1f1542fc56451843d64ec980ccb6d`.

```sh
python3 ../evidence/viewer-palette-fest.r67.observe.py
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
nice -n 19 node node_modules/@playwright/test/cli.js test --config r68.probe.playwright.config.ts r67.spec.ts
```

Der Beobachter wird ausschließlich in die Archivkopie eingesetzt; der
resultierende Diff liegt als `viewer-palette-fest.r68.observer.patch` bei.
Er liest die bereits gerenderten Endmarken hinter `renderer.render`, ohne
Kamera oder Marken neu zu positionieren. Die neue Produkt-Bildsonde wird
von diesem unabhängigen Probeaufruf nicht verwendet.

Startkamera `(600,0,0)`, Ziel `(0,0,0)`, Perspektive; echte Ansichtswechsel
`front → back → top → iso`. Nur vollständig sichtbare Balken zählen,
Längen zwischen den Geometrie-Endpunkten ohne Rundkappen. Die identischen
Assertions fordern 10 ± 0,05 CSS-px. Zusätzliche Label-Faktoren in den
JSON-Daten sind ungefilterte Diagnosewerte; der vorhandene neue
Produktwächter prüft zusätzlich Nadeln und Labels.

Die Sonde schreibt intern weiterhin `viewer-palette-fest.r67.tween.json`.
Dieses neue Ergebnis wurde unter `viewer-palette-fest.r68.tween.json`
abgelegt. Frühere R67-Belege wurden nicht überschrieben. Es wurde keine
Gegenkorrektur mehr eingesetzt: Die Kameramatrix-Korrektur stammt vollständig
aus dem geprüften Commit `10bbabc`.
