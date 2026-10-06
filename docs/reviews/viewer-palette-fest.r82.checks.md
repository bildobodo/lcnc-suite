# R82 · Prüfprotokoll · 2026-10-06

Prüfstand `880492457c634d4334f2ec7d9c58b37656041b4c`, Basis
`6cb25e7c823afc01638b94a6f686b0573e678504`.
Archiv unter `/tmp/codex-r82-dau10sks/archive`.

Live-Checkout nur gelesen; abschließend Review angehängt, neue R82-Belege
abgelegt und Handshake abgeschlossen. Keine Zugriffe auf :5173/:8000.
Mock ausschließlich `127.0.0.1:4188`; Browser seriell, ein Worker, nice 19.

## Isolation

- `git archive 88049245` für WebUI, Test-Fixtures und XYZAC-Maschinenmodell.
- Einzelne Abhängigkeiten aus dem vorhandenen `node_modules` verlinkt;
  Cache-/Buildinfo-Verzeichnisse liegen in der Archivkopie.
- `ctl.ts`: HTTP und WebSocket von localhost:4174 auf 127.0.0.1:4188.
- Drei tsconfig-Buildinfo-Pfade und Vite-Cachepfad umgelegt.
- Quellvergleich mit Git-Blobs: 411 Dateien identisch, genau die fünf
  Isolationsdateien geändert; keine Änderung unter `src/`.
- Diff der Isolation: `viewer-palette-fest.r82.isolation.patch`.
- Gebaut vor dem Hinzufügen der externen Browser-Sonden. Der Build prüft
  den angefragten Stand samt seinen Tests; die zusätzlichen Sonden laufen
  anschließend durch Playwright.

## Ausführung

Im archivierten `lcnc-webui`, jeweils mit `nice -n 19`:

```sh
npm run build
node node_modules/vitest/vitest.mjs run --config r82.vitest.config.ts
node node_modules/@playwright/test/cli.js test --config r82.chromium.config.ts sim-panel.viewer.spec.ts r82.follow.spec.ts
R81_BROWSER=firefox node node_modules/@playwright/test/cli.js test --config r82.firefox.config.ts sim-panel.viewer.spec.ts r82.follow.spec.ts
node node_modules/@playwright/test/cli.js test --config r82.chromium.config.ts r82.summary.spec.ts
R82_BROWSER=firefox node node_modules/@playwright/test/cli.js test --config r82.firefox.config.ts r82.summary.spec.ts
```

Die Konfigurationen und Sonden sind als R82-Belege beigefügt; zum Wiederholen
die Konfigurationen in `lcnc-webui` und die Sonden in `e2e` mit obigen Namen
ablegen. Die neue Summary-Sonde übernimmt den bestehenden Sim-Aufbau und
prüft darüber hinaus:

- Eine synthetische gekappte Übermittlung: 200636 gemeldete Befunde,
  200 übermittelte Zeile/Achse-Datensätze, 100 Programmzeilen.
- Vier Themes × vier Kombinationen aus Fenstergröße und CSS-Zoom.
- `hasTouch: true`, ein echter Playwright-Tap auf die Zahl, anschließend
  Fokus + Enter auf der bestehenden Timeline-Hilfe. ARIA-Namen, sichtbare
  Texte, Maße und Hilfetext werden getrennt gespeichert.
- Eine dokumentierte Worker-Testeingabe: `truncated.covered = .99` mit
  Zertifizierungsvorbehalt, dann 30 Kontakte über die bestehende Diagnose-
  Schnittstelle. Keine Produktquellen geändert.

Die R81-Sonde ist bytegleich zum alten Review-Beleg. Sie schreibt intern
weiter `.r81.*`; diese neu erzeugten Ausgaben wurden beim Übertragen in die
neuen `.r82.*`-Belege umbenannt. Alte Belege bleiben unverändert.

## Ergebnis

- Build PASS, Unit 111/111 (sieben Dateien, einschließlich codeGlide).
- Chromium 15/15, Firefox 15/15 (zwölf Sim-Tests plus drei R81-Sonden).
- Zusätzliche Summary-Sonde: je Browser zwei PASS, ein FAIL. Der einzige
  rote Erwartungswert ist der fehlende sichtbare Kappungshinweis in der
  bestehenden Hilfe (VP-I42); kein Test-Infrastrukturfehler.
- R81 ×100: Chromium 25 verschiedene Markierungen, Firefox 23;
  jeder Messpunkt mit Markierung vollständig sichtbar.

Die roten Sonden verlangen den empfohlenen Hilfeweg. Eine andere vollständig
per Touch und Tastatur zugängliche Umsetzung darf den Wächter entsprechend
anpassen. Es wird kein bestimmtes zusätzliches Bedienelement gefordert.

Keine Gesamt-Gate-Wiederholung, keine reale Maschine, keine echte
Screenreader-Abnahme. CSS-Zoom ist die Layout-Testkonvention des Projekts.
