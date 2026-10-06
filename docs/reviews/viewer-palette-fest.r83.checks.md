# R83 · Prüfprotokoll · 2026-10-06

Prüfstand `207691712ed1f393705afa896d6aab5a519e2262`, Basis
`d7602eb7b36efb3dab34ab58715203b9bbcf2a4f`.
Archiv: `/tmp/codex-r83-tbcw1bd4/archive`.

## Isolation

Archiviert wurden `lcnc-webui`, `test-fixtures`, `scripts/test_fixtures`
und das XYZAC-Modell. Abhängigkeiten einzeln aus dem vorhandenen
`node_modules` verlinkt, Caches/Buildinfo im Archiv. Genau fünf Anpassungen
zur Isolation: ctl HTTP/WS auf 127.0.0.1:4188, drei tsconfig-Buildinfo-Pfade,
Vite-Cachepfad. 411 andere getrackte Dateien stimmen mit ihren Git-Blobs
überein, alle Produktdateien unter `src/` unverändert.

Der Live-Baum wurde nur gelesen und abschließend um Review-Anhang und neue
R83-Belege ergänzt. Kein Zugriff auf :5173/:8000. Alte Belege unverändert.
Browser und Mock seriell, ein Worker, nice 19.

## Ausführung

Im archivierten `lcnc-webui`, jeweils mit nice 19:

```sh
npm run build
node node_modules/@playwright/test/cli.js test --config r83.chromium.config.ts
R83_BROWSER=firefox node node_modules/@playwright/test/cli.js test --config r83.firefox.config.ts
node node_modules/@playwright/test/cli.js test --config r83.chromium.config.ts r83.summary.spec.ts -g 'long partial'
```

Der Build lief vor dem Hinzufügen der Review-Sonde. Zum Wiederholen die
beigefügten Konfigurationen in `lcnc-webui` und die Sonde in `e2e` unter den
obigen Namen ablegen. Die Sonde ist aus R82 abgeleitet; der beigefügte Diff
zeigt sämtliche Anpassungen. Sie verwendet dieselbe gekappte Vorschau und
denselben lang formatierten Teilprüfungsfall. Hinzu kommen:

- Bedienung der neuen Summary-Hilfe über Tab, Enter, Space und echte
  Playwright-Touchscreen-Ereignisse (`hasTouch: true`).
- Getrennte Prüfung von Text, Anzeigegröße, Zoom, ARIA-Namen, tatsächlichem
  Theme und Trefferpunkten einschließlich des vergrößerten Außenbereichs.
- Zustand komplett / null Befunde / ungeprüft nach neuer Vorschau.
- Nach dem ersten Chromium-Lauf wurde der rote äußere Trefferpunkt um
  echte Taps und eine positive Kontrolle erweitert. Firefox lief mit dieser
  erweiterten Fassung vollständig; Chromium wiederholte gezielt den Randfall.
- Die positive Kontrolle setzt im Browser-Dokument vorübergehend 4 px
  padding-right an `.simSummaryRow`, misst und tippt erneut und nimmt den
  Eingriff zurück. Keine Produktdatei und kein Bundle wurde geändert.

## Ergebnisse

- Build PASS. Unit-/Backend-Suiten nicht erneut ausgeführt.
- Chromium und Firefox: je zwölf bestehende Sim-Tests und drei eigene
  Prüfungen PASS; nur der äußere rechte Trefferpunkt FAIL (15/16).
- VP-I42: sichtbarer Kappungstext durch Touch und Tastatur in beiden Browsern
  bestätigt, keine alten Zahlen nach Wechsel zu kompletter oder ungeprüfter
  Vorschau.
- VP-I43: Randtap öffnet nicht, Mitte öffnet, mit 4 px reserviertem Platz
  öffnet der relative Randtap ebenfalls; beide Browser.
- Die Reihenhöhe bleibt 18 Layout-px. Alle 16 Theme-/Größenkombinationen
  bestehen; der lange Text hat nur den beschriebenen Trefferflächenbefund.

Kein vollständiges Gate, keine LinuxCNC-Befehle, keine Geräte- oder
Screenreader-Abnahme. Die Worker-Antwort ist eine Testeingabe, kein realer
Kollisionsnachweis. CSS-Zoom folgt der Layout-Testkonvention des Projekts.
