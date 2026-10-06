# R77 · Codex · Prüfprotokoll · 2026-10-06

Scope: VP-I36, `c7b3a1a..e248a85`, Fix `4776924`.
Anfrage im Live-Stand `e32d7a2`.
Arbeitskopie: `/tmp/codex-r77-2k2btvhh/archive` aus
`git archive e248a85 lcnc-webui`.

## Wiederholung und Herkunft

Der Diff von `2796ab9` (R76-Buildquelle) bis `e248a85` enthält innerhalb
`lcnc-webui` ausschließlich `e2e/appearance.spec.ts`. Deshalb wird der eigene,
bereits geprüfte R76-Build unverändert wiederverwendet, ohne erneuten Build:
`lcnc-webui/dist` verweist auf
`/tmp/codex-r76-9l3nh3b2/archive/lcnc-webui/dist`.
Die SHA-256-Werte aller 26 Build-Dateien liegen separat bei.

Die aktuellen Tests kommen aus dem R77-Archiv. Abhängigkeiten sind durch einzelne
Symlinks in einem eigenen `node_modules` zugänglich; `.tmp`, `.vite`, `.vite-temp`
und `.cache` werden nicht übernommen. Nur in der Kopie ist `e2e/ctl.ts` von
`localhost:4174` auf `127.0.0.1:4188` umgestellt. Keine Zugriffe auf :5173/:8000,
keine Maschinenbefehle und keine Produktänderungen.

Die beigefügten Konfigurationen als `lcnc-webui/r77.firefox.config.ts` und
`r77.chromium.config.ts`, die bytegleiche R76-Sonde als
`lcnc-webui/e2e/r76.probe.spec.ts` ablegen; neben `lcnc-webui` einen Ordner
`evidence` anlegen. Falls der R76-Build nicht mehr verfügbar ist, lässt sich
derselbe Produktstand aus dem Archiv mit `VITE_GATEWAY_PORT=4188 npm run build`
erzeugen; dafür Build-Caches ausschließlich in der isolierten Kopie anlegen.

Aus `lcnc-webui`, Browser nacheinander mit jeweils einem Worker:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r77.firefox.config.ts --grep 'appearance.spec|rendered flash colours'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r77.chromium.config.ts --grep 'appearance.spec|rendered flash colours'
```

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Aktuelle `appearance.spec.ts`, Firefox 150 Linux | PASS, 4/4 |
| Bytegleiche unabhängige R76-Farbprobe, Firefox | PASS, 1/1 |
| Aktuelle `appearance.spec.ts`, Chromium 148 Linux | PASS, 4/4 |
| Bytegleiche unabhängige R76-Farbprobe, Chromium | PASS, 1/1 |

Viewport 1600×1000, DPR 1. Der aktuelle Blinkwächter ist unverändert ausgeführt
worden. Die unabhängige Sonde erzeugt weiterhin temporäre Dateinamen mit `r76`;
nur die Ergebnisdateien dieses neuen Laufs wurden zum Ablegen in `r77` umbenannt.
Sondeninhalt und alte Belege sind unverändert. Die beiden übrigen Lifecycle-Fälle
der R76-Sonde wurden nicht erneut ausgeführt; der Produktcode ist unverändert.

Die unabhängige Probe erfasst native CSS-Farben, normalisierte RGBA-Werte,
Start-/Laufzeiten und Phasen über 30 Messpunkte. Firefox liefert weiterhin
`color(srgb …)`, erkennt nach Normalisierung aber dieselben An-/Aus-Zustände.
Kanalspreizung in den Firefox-Daten: aus 0, an 71; der neue Testwert 16 liegt
dazwischen. Beide Zustände kommen vor, in jeder Probe gleichzeitig für beide
Elemente. Damit ist VP-I36 geschlossen.

Keine neue Build-/Unit-/Backend-/Offline-Gate-Prüfung und keine macOS-/Live-
Abnahme. Ergebnis: agreement, keine neuen Befunde im angefragten Umfang.
