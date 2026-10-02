# R67 · Reproduktion und Grenzen · Codex · 2. Oktober 2026

Prüfstand: `git archive a8138fc`, Diff `9001850..a8138fc`, Paket 4 auf
`feat/viewer-marks`. Die in der Anfrage genannte Branchbezeichnung des
Live-Checkouts (`feat/keypad-keys`) wurde nicht als Produktstand verwendet.
Archiv: `/tmp/codex-r67-33ut4bjx`. Gegenvergleich des Boxkanten-Tests:
vorhandene R66-Archivkopie `/tmp/codex-r66-zbzn8dd_`, Produktstand `9001850`.

Live-Checkout nur für Lesen, Review-Anhang, neue R67-Belege und das
angeforderte Handshake-`done`. Kein Zugriff auf :5173/:8000, keine
Maschinenbefehle, kein Checkout/Build/Test im Live-Baum, kein Commit.
Alle Browserläufe seriell, `nice -n 19`, eigener Mock auf `127.0.0.1:4188`;
Playwright beendet ihn nach jedem Lauf.

## Aufbau

1. `git archive a8138fc` in ein neues Verzeichnis unter `/tmp` entpacken;
   daneben `evidence/` anlegen.
2. `lcnc-webui/node_modules` auf die bereits installierten Abhängigkeiten
   verlinken. Nur in der Archivkopie in `tsconfig*.json` den Cachepfad
   `./node_modules/.tmp/` nach `../r67-ts-cache/` verlegen.
3. In der Archivkopie `e2e/ctl.ts` von `localhost:4174` auf
   `127.0.0.1:4188` umstellen. Der Mock lädt das dort gebaute `dist`.
4. Die beigefügten Configs nach `lcnc-webui/r67.*.config.ts` kopieren.
   Die R66-Sonde liegt im Archiv unter
   `evidence/viewer-palette-fest.r66.probe.test.ts`: Die als
   `viewer-palette-fest.r67.probe.test.ts` beigefügte Kopie ist **bytegleich**
   mit dem R66-Original (SHA-256
   `5d9383a104b9d513ff8f23bdc33397447a7eb1444f4bf328e165860c0f0bb91a`).
   Die Testnamen und internen R66-Ausgabepfade wurden absichtlich nicht
   angepasst; die neuen Ergebnis-JSONs sind unter dem R67-Präfix abgelegt.

## Unveränderter Produktstand

Aus `lcnc-webui/`:

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r67.vitest.config.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r67.probe.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test --config r67.playwright.config.ts
```

- Build/Typecheck PASS; die bestehende Vite-Warnung zu großen Chunks bleibt.
- 172/172 vorhandene Unit-Tests, sechs Dateien, PASS.
- Die beiden unveränderten R66-Gegenproben: 2/2 PASS.
- Browser: 17/18 PASS; `the box edge alone` scheitert an der Einteilung der
  entlang der Linie gemessenen Pixel in zwei Töne. Alle zehn Nadeltests,
  Endmarken/Labels, Phasenverankerung, Near-Clipping und die neue Kette
  bestehen.
- Gezielte Wiederholung am unveränderten Stand: Boxkante wieder rot,
  neue Kette wieder grün (`browser-rerun.txt`). Mit dem beiliegenden
  `r67.reporter.ts` wurden die Screenshot-Anhänge gesichert.
- Zum Eingrenzen: derselbe Boxkanten-Test im vorhandenen R66-Archiv einmal
  grün (`base-box.txt`). Die neue Boxkante zeigt auf dem Screenshot beide
  Töne. Das allein belegt noch keinen zweiten Produktfehler; die
  Pixelklassifikation und die Wahl der Messkante müssen eingegrenzt werden.

Das vollständige Offline-Gate und Backend wurden nicht wiederholt.

## Beobachtung der Ansichtsanimation

Der neue Helper liest `camera.matrixWorld`, aktualisiert sie aber nicht.
Die echte `_tweenStep` schreibt Position und Quaternion. `animate` berechnet
Marker und Boxen vor `updateCulling`/`renderer.render`, die die Kameramatrix
aktualisieren. Eine reine Prüfung einer bereits aktualisierten Kamera
verdeckt diese Reihenfolge.

`viewer-palette-fest.r67.observe.py` wird **nur in der Archivkopie** aus
`lcnc-webui/` ausgeführt. Es fügt hinter dem eigentlichen Renderaufruf einen
passiven Beobachter ein; der genaue Diff liegt als `observer.patch` bei.
Er liest die bereits gerenderten Endmarken über `toolpath.boxTicks()`
(kein erneutes `pose`) und projiziert sie mit der Matrix des gerade
gezeichneten Bilds. Er aktualisiert weder Kamera noch Markengröße.
Nur Balken, deren beide Endpunkte vollständig im Viewport und im
Clipvolumen liegen, zählen. Gemessen werden Geometrie-Endpunkte ohne
Rundkappen. Zusätzliche Labelwerte sind Diagnosewerte; sie werden ohne
Frustumfilter nicht als eigenständiger Nachweis gewertet.

Die Sonde wird als `e2e/r67.spec.ts` installiert. Kamera fest bei
`(600,0,0)`, Ziel `(0,0,0)`, Perspektive; danach über die echte Viewer-API
`front → back → top → iso`. Keine Verlangsamung oder künstliche Zeitstörung.
59 gerenderte Bilder im Ausgangslauf, 60 im Gegenexperiment über die drei
Übergänge, nominell 300 ms pro Übergang.

```sh
python3 ../evidence/viewer-palette-fest.r67.observe.py
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
nice -n 19 node node_modules/@playwright/test/cli.js test --config r67.observer.playwright.config.ts r67.spec.ts
```

`tween.txt` ist rot; `tween.json` enthält die gerenderten Maße. Die
zugehörige `tween.spec.ts` prüft 10 px mit 0,05 px Toleranz. Sie ruft während
der Messung ausdrücklich nicht `__viewerDiag.getBoxTicks()` auf: Dieser
bestehende Diagnoseaufruf würde die Marken neu setzen und den Fehler nach
dem Rendern verdecken.

## Gegenexperiment, keine übernommene Produktkorrektur

Nur in der Wegwerfkopie: `counterfactual.patch` fügt nach
`_orthoEyeOutsideScene()` und vor der Marker-/Boxberechnung
`camera?.updateMatrixWorld()` ein. Sonst unveränderte Größenberechnung.
Der passive Beobachter bleibt installiert. `tween-counterfactual.spec.ts`
ist dieselbe Sonde mit anderem JSON-Ziel, identischen Kamerapositionen
und identischen Assertions. Nach erneutem Build:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r67.counterfactual.playwright.config.ts r67.spec.ts
```

`counterfactual.txt` und `tween-counterfactual.json` dokumentieren den
Gegenlauf. Das ist eine Ursachenprüfung, keine Abnahme einer von Claude
noch nicht implementierten Korrektur. Der Live-Produktcode blieb unverändert.
Frühere Review-Belege blieben unverändert.
