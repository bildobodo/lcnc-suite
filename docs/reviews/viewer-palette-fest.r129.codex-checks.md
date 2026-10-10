# R129 · Codex · Prüfprotokoll

Geprüfter Stand: `4db1f22d9a0a3dd23de35aa966e4edbbb7b74fde`, Diff ab
`023cf54c`. Der Diff enthält ausschließlich die beiden Plan-/Review-Dateien.
E4a ist noch nicht umgesetzt. Diese Prüfung bescheinigt daher keinen
Produktfehler oder roten Produkttest in einer fertigen E4a-Implementierung,
sondern zwei Lücken in ihrem vorgeschlagenen Vertrag.

## Reproduktion

Das beigefügte `viewer-palette-fest.r129.codex-audit.py` arbeitet mit einer
Archivkopie des genannten Commits. Es benötigt nur Python-Standardbibliothek:

```sh
mkdir /tmp/r129-source
git archive 4db1f22d | tar -x -C /tmp/r129-source
nice -n 19 python3 docs/reviews/viewer-palette-fest.r129.codex-audit.py /tmp/r129-source
```

Codex benutzte `/tmp/codex-r129-uqp11c3o/src`, beschränkt auf die für das
Review nötigen Verzeichnisse. Der Kontextbeleg hält Quellhashes und den
unveränderten Review-Präfix fest.

## Ergebnisse und Aussagegrenzen

Alle Assertions des Audits bestanden. Vollständige Werte stehen in
`viewer-palette-fest.r129.codex-audit.json`.

1. **Lesungen über Helfer:** Der AST-Aufrufgraph der ausgelieferten
   `remap.py` erreicht aus `g683` und `g53x_core` die Leser von A/B/C. Aus
   `twp_touchoff` erreicht er X/Y/Z und A; eine konservative, nicht
   argumentabhängige Aufrufgraph-Vereinigung schließt auch B/C ein. Das ist
   eine Obermenge, keine Behauptung, dass jeder Zweig alle Achsen liest.
   `twp_touchoff` ruft `get_machine_a(self)` ausdrücklich auf Zeile 1568
   auf. `g682`, `g684` und `g69_core` erreichen in diesem einfachen Graphen
   keine direkten Positionsattribute. Parameter-/HAL-Zugriffe werden damit
   nicht vollständig analysiert.
2. **Rotary-Abhängigkeit:** Der tatsächliche Funktionskörper von
   `get_current_rotary_positions` wurde aus dem AST isoliert ausgeführt,
   mit festen Nullversätzen und PRIMARY=C/SECONDARY=B. B/C=0/0 ergibt 0/0,
   B/C=20/−15 ergibt −15/20 Grad. Kein HAL und kein Interpreterlauf.
   Die Verwendung dieser Werte für die G68.3-Ebene ist im Quelltext
   `remap.py:1683–1694,1721` direkt sichtbar. Der Plan darf diese Lesung
   bei `stale` deshalb nicht als „keine Positionslesung“ behandeln.
3. **TOPLEVEL-Gegenprobe:** Unveränderte archivierte `toplevel.py` mit
   `runpy.run_path` ausgeführt, während ein temporäres fremdes `remap.py`
   vor dem Suite-Verzeichnis im Python-Suchpfad liegt. TOPLEVEL liegt
   weiterhin im richtigen Verzeichnis, `g682` heißt weiterhin `g682`,
   stammt aber aus der fremden Datei und liest X=123. Das ist eine reale
   Python-Importprobe; kein nativer LinuxCNC-/PATH_PREPEND-Integrationstest.
   Sie widerlegt die behauptete Herkunftsbindung allein durch TOPLEVEL.
4. **Zusätzliche Remap-Hooks:** Die echte Funktion `foreign_m600_codes`
   klassifiziert die gebündelten M600/M601 auch mit `prolog=reads_x` oder
   `epilog=reads_x` nicht als fremd. Die echte `RemapEnv.effect` liefert für
   diese vier Fälle dagegen korrekt `(None, None)`. Der Name `reads_x` ist
   synthetisch; ausgeführt wird er nicht. Der Test zeigt den unterschiedlichen
   Erkennungsumfang der beiden vorhandenen Helfer. Eine neue globale
   Lese-Ausnahme darf den strengeren Vertrag nicht durch den schwächeren
   ersetzen.
5. **Korpus:** `position_write_lines` klassifiziert fünf Programme als
   `foreign` und `parity_linear.ngc` als `ordered`. Vier benutzen G68.2,
   eines G68.3; `parity_linear` keines von beiden. Fünf rufen `square`.
   Die Formulierung „alle sechs“ im Plan ist ungenau; der Bedarf an einer
   engeren Lese-Klassifikation bleibt bestehen.

Keine breite Testsuite nötig für diesen Plan-Diff. Keine Aussage über den
parallel bearbeiteten Branch `fix/start-dep`, keinen Live-Parity-Lauf oder
eine abgeschlossene Implementierung abgeleitet. Keine Live-Ports, native
Controller-Bindings, HAL-Abfragen oder Maschinenbefehle benutzt. Im
Live-Arbeitsbaum nur der Review-Anhang und neue `r129.codex-*`-Belege.
