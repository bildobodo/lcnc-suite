# R53 · Nachprüfung, Reproduktion und Grenzen

Geprüft `36b35cb..79771e6`, vollständiger Stand
`79771e678526a15564b90aee25884e6d6e710fe4`.
Archiv `/tmp/codex-r53-aen7ujaj` via `git archive 79771e6`.
Live-Checkout nur Review-Anhang und neue R53-Belege; keine Zugriffe auf
:5173/:8000, keine Maschinenbefehle. Settings unverändert und nicht erneut
geprüft. Kein vollständiges Offline-Gate und keine eigene Live-Prüfung.

## VP-I21

Im Archiv node_modules als Symlink auf die vorhandene Installation,
Vite/Vitest-Cache `.review-cache`, tsconfig-Buildinformationen unter
`.review-tsbuildinfo/` statt in node_modules. Build und alle Tests mit
`nice -n 19`; Browser ein Worker. Vor dem Browserlauf waren Build und
native Sonden beendet.

- Typecheck: `node node_modules/vue-tsc/bin/vue-tsc.js -b`: PASS.
- Build: `node node_modules/vite/bin/vite.js build`: PASS.
- Units: `node node_modules/vitest/vitest.mjs run src/codeGlide.test.ts
  src/subRows.test.ts`: 12/12 in zwei Dateien. Kleine Fenster und skalierter
  Scrollraum hier per Unit-Test; kein zusätzlicher Browser-Megadateitest.
- Browser: ctl.ts nur im Archiv von localhost:4174 nach 127.0.0.1:4188
  geändert. `playwright.config.ts` aus den R53-Belegen nach
  `lcnc-webui/playwright.r53.config.ts`, `browser-probe.ts` nach
  `lcnc-webui/e2e/r53.spec.ts` kopieren.
  `python3 evidence/viewer-palette-fest.r53.browser-run.py`: 3/3.
  Ein Originaltest mit drei Zeilen sowie zwanzig Zeilen vorwärts/rückwärts;
  zwei eigene R52-Gegenproben (normale/reduzierte Bewegung).
- Änderungen der eigenen Gegenprobe: nur Namen/Pfade R52 → R53 und die
  Assertion „keine unsichtbaren Frames“ auch ohne Bewegungsreduktion.
  `probe-adaptations.patch` legt sie offen.
- Ergebnis: 0/97 unsichtbare Frames bei normaler Animation, 0/92 bei
  Bewegungsreduktion. Originalwächter: 60 fps, 98 % bewegte Frames,
  0 % ganze Paketschritte; große Schritte vorwärts/rückwärts 0/160
  unsichtbare Frames. Server durch finally-Zweig beendet.

## VP-I20-Planexperiment

Keine Produktimplementierung. `native-case.py` ist die eigene R52-Fixture
mit neuen Programmen und Beobachtung von `next_line`. Kopieren nach
`lcnc-gateway/r53_native_case.py`, dann
`python3 evidence/viewer-palette-fest.r53.native-run.py`.
Jeder Fall läuft als frischer Prozess im nativen Offline-Interpreter;
synthetischer STAT, temporäre INI/Var-Datei/Werkzeugtabelle,
`linuxcnc.command` wirft. Nur bei `unknown` wird die geplante Initzeile
weggelassen; das simuliert den Abschnitt A „kein Seed“, nicht einen schon
implementierten neuen Gateway-Fehlerpfad.

Die Sonde bildet Fassung 2 wörtlich ab: dep startet true und wird false,
sobald der Nachzustand 490 enthält; G53-Zuordnung aus dem Nachzustand.
Sie ändert keine Limitprüfungslogik, sondern vergleicht echte Worker-
Ergebnisse mit dieser geplanten Markierung. Vorheriger und nächster
Callback sowie Segmentsequenzen stehen vollständig im JSON.

Zwölf native Parses, alle ohne Parsefehler/Absturz:

- G49 zuerst und G49 plus Bewegung in einem Satz: positive Kontrollen.
- Ohne Seed, ohne Programm-G49: Standardzustand 490 führt nach Plan zu
  fälschlich aufgehobener Abhängigkeit, obwohl kein TLO-Event existiert.
- Relativer Zug nach G49: bei Start10 endet die Bewegung bei Z49,999 ohne
  Befund, bei Start10,005 bei Z50,004 mit Befund; Plan markiert sie dep=false.
- G53 vor G49 und relativem Zug: positive Kontrolle, Ziel nach G49 bleibt
  offsetunabhängig bei Z5; G53-Punkt selbst variiert korrekt mit dem Seed.
- M70/G49/M72: zusätzliche Kontrolle, im untersuchten nativen Fall stellt
  M72 den Tabellenoffset Z10 wieder her, bei beiden Startwerten gleich.
  Daraus wird **kein** weiterer Befund abgeleitet.

`plan-summary.json` verdichtet die beiden Gegenbeispiele. Seine Rechnung
zum ausgelassenen Reparse ist die deklarierte Regel aus Fassung 2, kein
Aufruf einer noch nicht vorhandenen Produktionsfunktion.

Die Plan-Sonde lief zunächst mit zehn Fällen; nach der Beobachtung der
Positionsabhängigkeit wurden zwei relative Fälle ergänzt. Der beigefügte
Runner reproduziert alle zwölf mit der finalen Sondenversion.

## Bewertung

Das gemeldete Live-Protokoll mit G43.1/G49/G43 wurde gelesen und seine
Z-Rechnung geprüft, nicht selbst an der Maschine wiederholt. Die bisherigen
R52-Befunde zu Parse-Basis und Trennung von Gültigkeit/Rechenhäufigkeit sind
auf Planebene adressiert. Noch offen ist die vollständige Abhängigkeits-
regel; allein aus einem ersten Zustand 490 folgt keine dauerhafte
Unabhängigkeit aller nachfolgenden Positionen.
