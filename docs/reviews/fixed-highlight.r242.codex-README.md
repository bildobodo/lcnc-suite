# R242 · unabhängige Nachprüfung

Produkt: `0e4deea9..e3f14379`, Archiv `/tmp/codex-r242-wryvpp3n/repo`.
Eigener Mock `127.0.0.1:4188`; kein Live-Gateway und keine Maschinenbefehle.
Nach den Head-Tests wurde derselbe Port nacheinander mit dem bereits gebauten, unveränderten Archiv von `0e4deea9` bedient. Beide Mock-Prozesse sind beendet.

## Probe

`fixed-highlight.r242.codex-probe.spec.ts` übernimmt die R241-Probe. Änderungen an dieser Kopie: Ausgabeverzeichnis `OUT`; Entfernung ausschließlich der durch den neuen Vertrag hinfälligen Ein-Paket-Assertion (die Nachlaufmessung bleibt als Log); zusätzliche Prüfungen für eigenständig gesetzte Scrollpositionen und den Unterprogrammnamen bei unbekannter bzw. bekannter Aufrufzeile. R241-Belege blieben unverändert.

Build zuerst in einer eigenen Archivkopie mit passendem Lockfile. Anschließend Probe nach `lcnc-webui/e2e/r242.codex.spec.ts`, Konfiguration nach `lcnc-webui/playwright.r242.config.ts` kopieren. `OUT` in der Probe nur an das eigene vorher angelegte Belegverzeichnis anpassen. Die imports nutzen die bestehenden Testhelfer; in der Archivkopie wurden deren Mock-Adressen von `localhost:4174` auf `127.0.0.1:4188` umgesetzt.

- Server im gebauten `lcnc-webui`: `MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs`.
- Probe dort: `npx playwright test -c playwright.r242.config.ts e2e/r242.codex.spec.ts`.
- Nur FH-04: derselbe Aufruf mit `--grep 'run subroutine name'`.
- Baseline: gleicher Test gegen den zuvor gebauten `0e4deea9`-Mock. Im aufgezeichneten Lauf unterschied sich die Sondenkopie nur durch `OUT=.../baseline`; beide Fälle bestanden. Keine Produktkorrektur zum Gegenbeweis eingebaut.

Die Herkunftsprobe verwendet die öffentlichen Preview- und Status-Nachrichten: markierte Unterprogrammsegmente mit `feed_sub`/`sub_names`, `feed_cline` einmal 0 und einmal 2, keine abrufbare Unterprogrammquelle. Der Playhead liegt auf dem Segment. Der Sim-Tab muss vor Prüfung des Program-Chips `(originprobe)` bzw. `L2 (originprobe)` zeigen; damit ist eine nicht angekommene Vorschau oder eine Position außerhalb des Pfads ausgeschlossen.

## Belege

- `measurements.json`: Messübersicht und beide Versionen der Herkunftsfälle.
- `frames.json`: Rohdaten der Follow-Gegenproben sowie Scrollpositionen.
- `name-head.png` / `name-baseline.png`: neuer/alter Stand beim selben unbekannten Aufruf; oben im Program-Tab fehlt/steht der Hinweis.
- `validation.txt`: Build; 18 Unit-Tests; neun Repository-Browserwächter; acht eigene Proben (7 grün, FH-04 rot); Baseline 2/2 grün.
- `metadata.json`: Herkunft, Bytegleichheit aller 409 Produktquelldateien je Archiv und Hash des jeweils ausgelieferten Build-Index; ursprünglicher Review-Inhalt unverändert.

Keine Full-HD-, Perf- oder vollständigen Gate-Wiederholungen: diese Teile sind seit dem Review unverändert.
