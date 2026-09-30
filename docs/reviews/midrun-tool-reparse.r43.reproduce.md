# R43 · Nachprüfung MR-I04-Rest · 2026-09-30

Geprüfter Commit: `0d07dae`, Bereich `b3f6b20..0d07dae`.
Archiv: `/tmp/codex-r43-14pqhmeo`. Der spätere Commit `7aad422`
ist nicht im geprüften Build enthalten.

## Ausführung

- `git archive 0d07dae` in ein neues Verzeichnis unter `/tmp` entpacken.
  Vorhandene `lcnc-webui/node_modules` nur als Abhängigkeiten verlinken.
  In den Archiv-`tsconfig*.json` die Buildinformationen von
  `./node_modules/.tmp/` nach `./.review-tsbuildinfo/` umleiten;
  Vite/Vitest erhalten `cacheDir: "./.review-cache"`.
- Unter `lcnc-webui` nacheinander ausführen:
  `nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b` und
  `nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner`.
  Ergebnis: **PASS**, übliche Chunkgrößenwarnung.
- `evidence/` im Archiv anlegen. `midrun-tool-reparse.r43.input-envelopes.json`
  dorthin kopieren: Dies sind die unveränderten Ergebnisse der R42-Pipeline-Sonde
  (`midrun-tool-reparse.r42.pipeline-probe.json`), kein neuer Backend-Lauf.
  Ihre interne Commitangabe `b6fd7c5` bezeichnet diese Herkunft.
- Die beiliegende Browser-Sonde nach `lcnc-webui/e2e/r43.spec.ts` kopieren,
  die Konfiguration nach `lcnc-webui/playwright.r43.config.ts`.
  In `e2e/ctl.ts` nur die Mock-Adresse auf `127.0.0.1:4188` umstellen.
- Eigener Mock: `env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs`.
- Browser: `nice -n 19 node node_modules/@playwright/test/cli.js test --config playwright.r43.config.ts --grep 'R43:|on a machine with no other viewer note'`.
  Ergebnis: **2/2 PASS**, ein Worker, Chromium, Light-Theme, 1600 × 1000.
  Der erste Test ist Claudes neuer XYZ-Wächter; der zweite ist die R42-Sonde
  mit unveränderten Abläufen und Assertions. Nur Rundenkennung, Eingabedateiname
  und Commitangabe wurden angepasst.

## Beobachtungen und Grenzen

Die Karte erscheint für `unsupported` und `no-basis` jeweils als einziger
Hinweis; die passende Hilfe ist enthalten. Die Pfade bleiben gedämpft.
Der Status eines fehlgeschlagenen Idle-Parses behält die Erklärung;
nach Status ohne Markierung verschwinden Erklärung und Dämpfung.
Kontrollen mit Rotation verhalten sich weiterhin gleich.
`client.json` protokolliert jede Phase, die Bilder zeigen die Anzeige.

Keine Produktänderung, keine Änderungen an früheren Belegen. Keine
Backend-Wiederholung: in diesem Commitbereich nur Viewer-Bedingung,
Browserwächter und Dokumentation geändert. Kein vollständiges Offline-Gate,
keine erneute Prüfung des Boxkanten-Pixeltests und keine Live-Sichtprüfung.
Keine Zugriffe auf `:5173`/`:8000`, keine Maschinenbefehle. Mock und Browser
wurden nach der Prüfung beendet.
