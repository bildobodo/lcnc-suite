# R385 · Codex · Prüfnotizen · 16. November 2026

Planstand `2684ca78`, Produktbasis `39a73679`. Reines Planreview: Quellen und Claudes Messzeilen gelesen, keine Tests, Builds oder Live-Befehle ausgeführt. Die gelesenen Dateien und ihre Prüfsummen stehen in [codex-audit.json](vor-maschine.ff.r385.codex-audit.json). Die Messwerte unten stammen aus [Claudes Versuch](vor-maschine.ff.trial-160.txt), nicht aus einer Wiederholung durch Codex.

## Abgleich mit dem bestehenden Vertrag

`test-strategy.review.md`, TS248-05, verlangt einen gepinnten Mozilla-Browser, getrennte Bilder, den nativen Rot-Nachweis des Rasterfehlers und eine Machbarkeitsprüfung vor der endgültigen Auswahl. Die fünf Minuten sind dort ausdrücklich ein Messziel. Der R385-Pflichtsatz und die Begrenzung auf Maus/Tastatur passen dazu. Der zusätzliche Test des synthetisch eingeschalteten Touch-Layouts sagt nichts über die Zustellung echter Touch-Ereignisse.

Die Messzeilen stützen die eingegrenzten Aussagen:

- Firefox: fünf Raster mit entferntem `width: 100%` bei 10 px statt 90 px. Calibrate bleibt bei 96 px; zwei weitere Prozeduren haben kein Raster.
- Beide Browser: Druck in den Rundungszwickeln erreicht den Hintergrund. Der Unterschied beim bisherigen Punkt (3,3) erklärt die unterschiedliche Testfolge; er macht den Produktfehler nicht Firefox-exklusiv.
- Der Versuch belegt noch keine erfolgreichen Bildvergleiche: fehlende Referenzen erzeugen Actual-Bilder. Ebenso fehlt nach dem gescheiterten Hintergrundklick der erfolgreiche Abschluss der Desktop-Dialogfälle. Beides muss die Umsetzung nachliefern.

## Eigene Quellprüfung

1. `DialogFrame.vue` teleportiert das Overlay direkt in `#content-dialog-area`. Dessen `.content`-Regel hat `overflow: hidden`, aber keine eigene Rundung. Der vorgeschlagene rechteckige Zeigerbereich wird daher nicht schon an dieser Stelle wieder rund beschnitten. `@click.self` und die Unterscheidung form/flow gegenüber info/confirm bleiben für den Eckenwächter relevant.
2. Die Rasterprüfung in `layout.spec.ts` hat **vier** Varianten: Desktop/Full HD jeweils homed/unhomed. `smoke.spec.ts` hat drei Fälle. Fünf Dialogzeilen in zwei Layouts ergeben zehn Dialogfälle. Zusammen mit einem neuen Fall je Prozedur ergibt das einen plausiblen Pflichtsatz von 25 Fällen; maßgeblich sind die vollständigen Identitäten und Varianten, nicht nur die Zahl.
3. `visual.spec.ts` enthält zwei verschiedene Regeln. Die Jog-/Setup-Bilder werden außerhalb linux/arm64 ausgelassen, ihre Geometrie läuft weiter. Die Werkzeugdialogbilder werden dagegen auf **jedem Linux** verglichen. F1(b) lässt sich deshalb nicht durch unveränderte Übernahme der ganzen Datei erreichen, falls sie später in den Firefox-Ausbau kommt.
4. `proof.check_executed` prüft Identität und Anzahl der Ergebnisse. Ein einzelnes Ergebnis mit Status `skipped` hat ebenfalls die Anzahl eins. Der bestehende Browser-Schritt verweigert es zusätzlich über `playwright_counts` und `judge`. Der neue Firefox-Schritt muss für seine zugesagte Null-Skip-Regel ebenfalls beide Aussagen prüfen. Die geplante Skip-Mutation hält das fest.
5. Die CI setzt `--timeout 5400` **je Schritt**. Die genannten 88 Minuten sind die Dauer des Frontend-Jobs, keine belegte Obergrenze des neuen Firefox-Schritts. Den Firefox-Kern getrennt zu messen und zu berichten ist daher sinnvoll; die Schätzung aus drei VM-Arbeitern ersetzt keinen CI-Messwert.
6. Ein Versions-/Arch-Name im Cache ist für sich noch kein Messwert des gestarteten Browsers. Als Umsetzungshinweis empfiehlt sich, angeforderten Pin und beobachtetes `browser.version()` getrennt zu erfassen und vor den Kernfällen abzugleichen. Das Archiv-SHA bleibt der Beschaffungsnachweis und darf nicht als Hash der ausführbaren Datei bezeichnet werden.

## Externe Primärquellen

- [CSS Backgrounds 3, Corner Clipping](https://www.w3.org/TR/css-backgrounds-3/#corner-clipping): Die Rundung begrenzt auch den Zeigerbereich. Das passt zu den Messzeilen beider Browser.
- [Playwright, Visual comparisons](https://playwright.dev/docs/test-snapshots): Referenzen sollen in derselben Renderumgebung entstehen wie ihre Vergleiche. Das stützt getrennte Referenzen; es verlangt keine ungesichteten x86_64-Bilder.
- [Playwright, browser.version](https://playwright.dev/docs/api/class-browser#browser-version): Liefert die Version des gestarteten Browsers und ist damit ein geeigneter zusätzlicher Abgleich zum Pin.

## Urteil

Agreement zum Plan. F1(b), der Pflichtsatz mit vorgeschlagener Ausbaureihenfolge und der Pflichtkern in CI sind angenommen. Kein neu offener Operatorentscheid; Q248-1 zum Maschinenbrowser bleibt unverändert offen. Dieses Urteil nimmt die Umsetzung, erfolgreiche Bildvergleiche, Firefox-Replay oder die Laufzeit noch nicht vorweg.
