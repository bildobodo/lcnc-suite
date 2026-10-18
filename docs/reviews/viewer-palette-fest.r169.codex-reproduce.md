# R169 · Codex · Reproduktion

Geprüfter Stand: `334122c7` (vollständiger Hash im Manifest). Eigene Archivkopie:
`/tmp/codex-r169-7fcxcy1g/repo`, aus `git archive 334122c7`; Abhängigkeiten über
`/tmp/codex-r168-pxyqpr1x/repo/lcnc-webui/node_modules` eingebunden.
Keine Tests im Live-Baum, keine Ports, keine Maschinenbefehle.

Die unveränderten R168-Sonden `viewer-palette-fest.r168.codex-rapid.test.ts` und
`viewer-palette-fest.r168.codex-sweep.test.ts` nach `lcnc-webui/src/viewer/` kopieren
(als `r169-codex-rapid.test.ts` und `r169-codex-sweep.test.ts`). Die neue Sonde
`viewer-palette-fest.r169.codex-index.test.ts` dort als `r169-codex-index.test.ts`
ablegen. Alle relativen Imports verweisen so auf den überprüften Produktstand.
Die Ausgabeordner der beiden Variablen müssen existieren.

Aus `lcnc-webui`:

```sh
R168_OUT=/tmp/codex-r169-7fcxcy1g nice -n 10 ./node_modules/.bin/vitest run   src/viewer/collision.test.ts src/viewer/contactViewUnion.test.ts   src/viewer/contactView.test.ts src/viewer/contactViewBudget.test.ts   src/viewer/contactViewIndexed.test.ts   src/viewer/r169-codex-rapid.test.ts src/viewer/r169-codex-sweep.test.ts   --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r169-7fcxcy1g/unit.json

R169_OUT=/tmp/codex-r169-7fcxcy1g nice -n 10 ./node_modules/.bin/vitest run   src/viewer/r169-codex-index.test.ts --maxWorkers=1 --reporter=json   --outputFile=/tmp/codex-r169-7fcxcy1g/own-index.json
```

217/217 in der ersten Gruppe, 2/2 in der zweiten. Die neue Probe prüft 195 getrennte
Ereignisse über Block- und Paargrenzen, jeweils mit Eilgang ausschließlich in der
alten bzw. neuen Generation. Die Kostenprobe verbindet je 1024 bzw. 8192 Intervalle
beider Generationen zu einem Stück; nur dessen letztes neues Intervall kann Eilgang
tragen. Die Tabellenlesungen werden über `ColumnTable.get` und die von `blocksOf`
gelieferten Spalten gezählt; Produktcode bleibt unverändert. Das ist eine
Komplexitätsprobe, keine Zeit- oder Browserlatenzmessung.

Die 380 verfolgten Quelldateien im Archiv wurden über Git-Blob-Hashes gegen den
Review-Commit geprüft. Die zusätzlichen Testdateien zählen nicht zu diesen 380.
Claudes vorhandene `r169.codex-probes.txt` bleibt unverändert; sämtliche hier neu
erzeugten Belege tragen andere Namen.
