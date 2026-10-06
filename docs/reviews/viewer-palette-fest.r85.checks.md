# R85 · Prüfaufbau und Grenzen

Stand: `cf4a9142..8880a17d`, Anfrage `9d5c6c37`, 6. Oktober 2026.
`8880a17d..9d5c6c37` verändert ausschließlich die Review-Anfrage.

## Isolation

Archivkopie unter `/tmp/codex-r85-t57utcjg/archive` aus `git archive
8880a17d lcnc-webui test-fixtures examples scripts`. Abhängigkeiten einzeln
verlinkt; Cache-Verzeichnisse nicht verlinkt. Änderungen für die Isolation
stehen in `viewer-palette-fest.r85.isolation.patch`: eigener Cache für Vite
und TypeScript, Mock-Adressen in `e2e/ctl.ts` nach `127.0.0.1:4188`.
413 archivierte Frontend-Dateien stimmen mit ihren Git-Blobs überein, fünf
haben ausschließlich diese dokumentierten Isolationsänderungen.

Kein Zugriff auf `:5173` oder `:8000`, kein LinuxCNC-/HAL-Befehl, keine
Verwendung der privaten R84-Eingaben. Der Live-Arbeitsbaum dient nur dem
Review-Anhang, neuen R85-Belegen und dem Handshake. Die R84-Belege wurden
gegen ihr bestehendes Hashmanifest verifiziert.

## Aufrufe

Alle Befehle im archivierten `lcnc-webui`, ein Worker, `nice -n 19`:

```sh
npm run build
node node_modules/vitest/vitest.mjs run --config r85.vitest.config.ts
R85_BROWSER=chromium node node_modules/@playwright/test/cli.js test --config r85.chromium.config.ts
R85_BROWSER=firefox node node_modules/@playwright/test/cli.js test --config r85.firefox.config.ts
R85_BROWSER=firefox node node_modules/@playwright/test/cli.js test --config r85.edge.config.ts
node node_modules/@playwright/test/cli.js test --config r85.contrast.config.ts --grep 'every readable text'
```

Die Playwright-Konfiguration startet ihren Mock selbst und übernimmt keinen
vorhandenen Server. Das lokale Binding war in der Sandbox gesperrt; die
Browserläufe erfolgten nach Freigabe außerhalb dieser Beschränkung, mit
derselben isolierten Konfiguration.

Zum Wiederholen die beigefügten `*.config.ts` als `r85.<name>.config.ts`
unter `lcnc-webui` ablegen. `summary.spec.ts`, `marks.spec.ts`, `edge.spec.ts`
und `scan.ts` gehören unter `e2e/r85.<name>`, `tint.test.ts` unter
`src/viewer/r85.tint.test.ts`. Neben `lcnc-webui` einen Ordner `evidence`
anlegen; dort schreiben die Sonden ihre Messwerte.

## Ergebnisse und Einordnung

- Build einschließlich TypeScript erfolgreich, vor dem Anlegen der eigenen
  Browser-/Unit-Sonden. Übliche Bundle-Größenwarnung, kein Buildfehler.
- 71 Unit-Tests in vier Dateien bestanden: `clashTint`, `sweepMerge`,
  `themeTokens` sowie eigene gemeinsame-Körper-/Lücken-/Satzreihenfolge-Probe.
- Je Browser 13 Repository-Tests der Sim-Ansicht und sechs eigene Prüfungen.
  Chromium meldet 19 bestanden; die ausführende Session endete nach der
  Abschlussmeldung mit 143 beim Aufräumen. Firefox meldet 18 bestanden und
  einen Fehler: die neu hinzugefügte Vorlage kürzt den Limit-Text nicht.
- Die vier übernommenen R83-Proben wurden ausschließlich für R85-Dateinamen
  umbenannt. Alle vier bestehen in beiden Browsern. Die alte bedingte
  Layoutkorrektur wird nicht ausgeführt (`taps: null` in den Partial-Daten).
- Palette: sechs Modi, darunter Auto hell/dunkel; gemessene Sim-Glyphen und
  Zähltexte, Listenzeichen, Scrub-Striche und HUD-Limittext. Code-/Settings-
  Zuordnungen zusätzlich am Quelltext geprüft. Keine erneute WebGL-Bildserie.
- Kontrast-Ausnahme: unverändert extrahierte `scan`-Funktion des geprüften
  `contrast.spec.ts`, echte Browser-Canvas-Farbnormalisierung. Drei exakte
  Kennfarben ausgenommen; ein um zwei Kanalstufen abweichendes Rot, schwacher
  normaler Text und anders gefärbter Kindtext werden weiterhin gemeldet.
- Fünf bestehende Textkontrast-Prüfungen: 5/5 bestanden.

## VP-I44 und die rote Kontrolle

Die Repository-Vorlage `1234567890` belegt in Firefox nur 283 px; 283 px sind
verfügbar. Der Vorbedingungsfehler entsteht vor dem Klick. Mit derselben
Vorlage bleibt der Klick auch beim Entfernen des Polsters erfolgreich.
Ein bloßes Löschen der Vorbedingung würde einen nicht empfindlichen Test
ergeben.

Die endgültige Gegenprobe verwendet für die zweite Hälfte den synthetischen
Gesamtwert `Number.MAX_SAFE_INTEGER`, ansonsten dieselbe Vorschau. 324 px
Text müssen jetzt auf 283 px gekürzt werden. Der äußere Klick öffnet genau
die Summary-Hilfe. Ohne Polster liegt er rechts vom Tab und öffnet sie nicht.
Popover-Bereinigung und CSS-Kontrolle erfolgen nur im Browserdokument der
Sonde; Produktquellen und Bundle sind unverändert.

Bei der Entwicklung dieser Sonde wurden zunächst Popover-Bereinigung und
ein emulierter erster Touch mit einem Desktop-Layout vermischt. Der erste
Touch schaltet die Bedienart um und verändert die Zeilenlage; das ist keine
Kontrolle bei gleicher Geometrie. Die endgültige Sonde verwendet deshalb
wie der Repository-Test die Maus. Außerdem behält das Seitenpanel beim
Verkleinern des Desktopfensters seine Breite: erst der längere Testinhalt
erzwingt die benötigte Kürzung. Diese Vorversuche zählen nicht als
Produktbefunde oder als bestandene Abnahmetests.

Keine Aussage über das volle Offline-Gate, die reale haus.ngc-Laufzeit oder
die zukünftige Umsetzung von VP84-01 bis VP84-03.
