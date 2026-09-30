# R50 · Codex · isolierte Nachprüfung · 30. September 2026

Archiv von `a519a8163c67fc02967d547c858450586e9941f5`, Bereich
`96cc36d..a519a81`, Arbeitskopie `/tmp/codex-r50-akch8lyj`.
Live nur Review-Anhang und neue R50-Belege; keine Produktänderungen,
Builds, Tests, Checkouts, Zugriffe auf :5173/:8000, LinuxCNC-/HAL-Verbindung,
Maschinenbefehle oder Quittierung.

## Vorbereitung und bestehende Tests

Archiv mit `git archive a519a81` erstellen, installierte
`lcnc-webui/node_modules` verknüpfen. Vite/Vitest `cacheDir` auf
`./.review-cache`, tsconfig-Buildinfo auf `./.review-tsbuildinfo/` umleiten.
In `e2e/ctl.ts` `localhost:4174` durch `127.0.0.1:4188` ersetzen.
Ohne Git-Metadaten meldet der Build `unknown`; der geprüfte Commit steht
oben und wird nicht im Mock erfunden.

Vor Einfügen der Review-Sonden im WebUI-Verzeichnis:

```sh
nice -n19 node node_modules/vue-tsc/bin/vue-tsc.js -b
nice -n19 node node_modules/vite/bin/vite.js build --configLoader runner
nice -n19 node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers 1 src/viewer/fatPaths.test.ts src/viewer/toolpathController.test.ts src/viewer/toolsetterMarker.test.ts src/viewerSection.test.ts
```

Im Gateway-Verzeichnis:

```sh
nice -n19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B -m pytest -q -p no:cacheprovider test_sim_toolsetter.py
```

**Typecheck/Build PASS, 102/102 Unit-Tests, 17/17 Backend-Tests.**
Die neuen GC-Wächter laufen mit dem eingecheckten `--expose-gc`.

## Speicherbilanz

Belege unter `evidence/` ablegen. Den aktuellen
`src/viewer/toolpathController.ts` nach
`src/viewer/r50.instrumented-controller.ts` kopieren und die beiden
Beobachtungsstellen aus `viewer-palette-fest.r50.ledger-observation.patch`
übernehmen. Sie geben nur Set- und gezählte Buffer-Referenzen heraus;
Berechnung, Allokation und Freigabe bleiben unverändert.

`viewer-palette-fest.r50.ledger-probe.ts` als
`src/viewer/r50.ledger-probe.test.ts` mit demselben Vitest-Aufruf ausführen:
**1/1 PASS**. Gegenüber R49 nur Namen/Import und die Erwartungen geändert:
kein gehaltener Vorbereitungsbuffer ungezählt, `ovIdx` verbraucht.
Der genaue Unterschied steht in `r50.probe-adaptations.patch`.
Die Sonde ergänzt die sechs unabhängigen GC-Wächter im Originaltest.

## Browser

`viewer-palette-fest.r50.browser-probe.ts` als `e2e/r50.viewer.spec.ts`,
`viewer-palette-fest.r50.playwright.config.ts` als
`playwright.r50.config.ts` ablegen. Aus der Archivwurzel:

```sh
python3 evidence/viewer-palette-fest.r50.browser-run.py
```

Eigener Mock `127.0.0.1:4188`, Chromium, ein Worker, `nice -n19`.
Der Runner beendet seinen Server in `finally`. **8/8 PASS** bedeutet sechs
grüne Produktwächter und zwei Fehlernachweise. Die Gegenproben verlangen
ausdrücklich die beobachtete Fehlreaktion:

1. **Save ohne Busy-Paket:** Mit G30 X100 starten, im echten Feld X110
   eingeben und Save G30 betätigen. Mock bestätigt Schreiben/Rücklesen mit
   X110; auch die HTTP-Daten enthalten X110. Nach 900 ms zeigt die Form
   bestätigt X110, der Pin weiterhin X100, Zahl der HTTP-Lesungen weiterhin
   2. Eine explizite Busy→Idle-Flanke führt zur dritten Lesung und X110.
2. **Vertauschte Antworten:** Zwei getrennte Busy→Idle-Flanken starten
   Reads mit X110 und X120. Die zweite Antwort kommt zuerst: Pin X120.
   Danach die ältere: Pin springt auf X110 zurück. Beide Antworten sind
   erfolgreich, vollständig, in mm; auch ihre Zeitstempel sind geordnet.

Es werden ausschließlich Mock-Kommandos bestätigt. Die Gegenproben bilden
zulässige Antwort-/Statusreihenfolgen ab, nicht eine Messfahrt am Controller.
Der Poller liefert periodische Zustände, keine garantierte Folge aller
Interpreterflanken (`gateway.py`, 30 Hz bzw. im adaptiven Leerlauf 5 Hz).
JSON enthält Zustände und positive Kontrolle; `g30-save-stale.png` zeigt
die bestätigte Form neben dem alten Pin. Die beiden `pin-*.png` sind
unveränderte Attachments des Original-Pixeltests auf dem XYZAC-Modell.

## Rückzug und Grenzen

`r50.retract.json` enthält die aus allen drei INIs und `sim.var` gelesenen
Werte und die Rechnung. Alle Profile sind mm, haben F2000/F200/3 mm und
rechnerisch mehr als 0,5 mm Rest über dem angesetzten G64-Überlauf.

Quellenkontrolle im lokal vorhandenen Upstream-Archiv LinuxCNC 2.9.4:
`tcGetOverallMaxAccel()` halbiert den Faktor bei parabolischer Endbedingung
bzw. `blend_prev`
([Quellstelle](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/tp/tc.c#L55)).
Das passt zur verwendeten Rechnung für diesen Fall. Die Dokumentation
beschreibt das Abbremsen der Tastbewegung innerhalb der Maschinen-
Beschleunigungsgrenzen
([G38-Dokumentation](https://linuxcnc.org/docs/2.9/html/gcode/g-code.html#gcode:g38)).
Kein erneutes vollständiges Offline-Gate, keine Mac-Messung und keine
eigene Live-Tastfahrt. Claudes gemeldete Live-Messung wurde nicht wiederholt.
