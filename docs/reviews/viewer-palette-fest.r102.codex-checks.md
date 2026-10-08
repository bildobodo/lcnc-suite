# R102 · Codex · Prüfaufbau

Geprüft: Produkt und Plan `02a4c373..e4a9f075`, Anfrage `0643f2bd`. Archiv in `/tmp/codex-r102-r5odx6ao/archive`. Keine Produktänderungen, Maschinenbefehle, Live-Port-Zugriffe oder Browserprozesse.

## Ergebnisse

- 177 Repository-Tests: collision, collisionInside, insideCheck, sweepShards, sweepMerge, collisionWorker, collisionBounds, machineTrsrn, kinsBulge.
- 5 Repository-Orakeltests auf den mitgelieferten Modellen.
- 14 eigene Erwartungen grün, auch im gemeinsamen Wiederholungslauf.
- 4 native Beobachtungen mit synthetischem Status, eigener INI/Var-Datei/Werkzeugtabelle und verbotenem `linuxcnc.command()`; im Wiederholungswerkzeug explizite Werteprüfungen.
- `npm run build`: PASS (bestehender Hinweis zu großen Bundles).
- Rechen-/Quellenprobe für den M600-Plan: vollständige Toolsetter-Map gegen vorgeschlagene #3100–3115; normaler, zu kurzer, gekappter Tastweg, positive Referenz und Kantentaster.

Kein vollständiges Offline-Gate, erneuter Browserlauf, Deep-Hunt oder Live-Abnahme. Keine M600-Umsetzung gebaut. Die haus-Zeitmessung stammt von Claude und wurde nicht wiederholt.

## Isolation

Archiv von `e4a9f075` mit den Wurzeln `lcnc-gateway lcnc-webui examples test-fixtures scripts subroutines`; der reine Anfrage-Nachtrag ändert keine davon. 941 Dateien bytegleich gegen Git, 95 expandierte LFS-Dateien gegen Größe und SHA256 des Pointers geprüft. Vier ausschließlich lokale Cache-Umlenkungen siehe `isolation.patch`. Abhängigkeiten einzeln aus dem vorhandenen `node_modules` verlinkt, ohne `.tmp`, `.cache`, `.vite`, `.vite-temp`; keine Schreibvorgänge in den Live-Caches. Vitest-Cache in der Archivwurzel, `maxWorkers: 1`, `nice -n 19`. `r102.config.ts`:

```ts
import {defineConfig} from "vitest/config";
export default defineConfig({cacheDir:"../r102-vitest-cache",test:{environment:"node",maxWorkers:1,testTimeout:240000,include:["src/**/*.test.ts"]}});
```

Tests/Build ausschließlich aus `archive/lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r102.config.ts src/viewer/collision.test.ts src/viewer/collisionInside.test.ts src/viewer/insideCheck.test.ts src/viewer/sweepShards.test.ts src/viewer/sweepMerge.test.ts src/viewer/collisionWorker.test.ts src/viewer/collisionBounds.test.ts src/viewer/machineTrsrn.test.ts src/viewer/kinsBulge.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r102.config.ts src/viewer/collisionOracle.test.ts
nice -n 19 npm run build
```

Die eigenen Sonden und Modulkopien wurden vor dem Build entfernt. `collision.ts` und `kins.ts` blieben unverändert. Die zweite Kontrollkopie (`speedBound`) setzt heute dieselbe Formel wie die Produktfunktion ein: Sie ist kein unabhängiger Beweis dieser Formel. Dafür gelten die Ableitung über M/2, die familienweisen Prüfungen und die analytischen Kontaktintervalle.

## Sondenänderungen transparent

`probe-changes.patch` zeigt alle Änderungen an Kopien der R101-Sonden: Belegpräfix/Importnamen und **eine Erwartung**. Der damalige Kontrolllauf ohne Innenzertifikat hatte nur ein Intervall. Nach der reparierten gemeinsamen Schranke enthält derselbe Zeilenbefund auch den Rückkontakt. `cumEnd` benennt jetzt korrekt dessen Ende (22,5); das erste Austrittsende ist `intervals[0][1]` (3,680054). Die Erwartung auf den analytischen Austritt bleibt unverändert. Die manuell berechneten Felder `V` und `clearanceLeftClaimed` in `bulge.json` dokumentieren weiterhin die **alte** falsche Formel; sie sind nicht die V-Werte des R102-Produkts.

Die zusätzliche Retention-Sonde verglich zunächst sämtliche Intervallgrenzen bytegleich. Snapshot-Verfeinerung und einmaliger Ergebnisbau unterschieden sich um höchstens etwa 0,000002 mm. Für diese numerischen Intervallgrenzen verwendet sie nun die absolute Vitest-Toleranz `toBeCloseTo(..., 4)` (0,00005 mm); Befunde ohne diese Grenzwerte, Probenanzahl und Hinweise bleiben exakt verglichen. Ziel der Sonde ist die dauerhafte Warnung bei Snapshot/Memo/Weiterlauf sowie Shard- und Einfahrt-Merge. Das anfängliche Protokoll mit beiden zu strengen/überholten Erwartungen bleibt in `probes-initial.txt`; beide waren Sondenprobleme, keine offenen Produktbefunde. Der endgültige Lauf und die Wiederholung bestehen 14/14.

`noCert.patch` und `speedBound.patch` zeigen die Änderungen ausschließlich an separaten Kopien von `collision.ts`, niemals am geprüften Produktmodul.

## Wiederholen

In einer bereits isolierten Archivkopie mit den oben genannten Abhängigkeiten:

```sh
python3 /home/cnc/lcnc-suite/docs/reviews/viewer-palette-fest.r102.codex-reproduce.py /tmp/DEIN-ARCHIV
```

Das Werkzeug legt nur temporäre Sonden/Modulkopien im Archiv an, prüft das unveränderte Produktmodul und entfernt die Sonden wieder. Für die vier nativen Fälle verwendet es die vorhandene Python-Umgebung **als Abhängigkeit**, `native_start_probe.py` aus dem Archiv mit zusätzlichen CASES und synthetischem Status; kein echter Controller wird gelesen. `native.patch`, `native-cases.json`, `native.json` und `native-rerun.json` dokumentieren Eingaben und Ergebnisse. G38.2/G38.3 liefern den vollen Weg und #5070=0; die G54-Variante bestätigt #5063 im Arbeitskoordinatensystem. Ein bloßes G43 ohne jeden Tastvorgang liefert ebenfalls ein TLO-Ereignis.

Die reine Planrechnung liegt in `plan-checks.py`; sie erwartet die Archivwurzel oberhalb ihres Ordners. Sie ersetzt keine Prüfung einer künftigen M600-Umsetzung.

## Vorhandene Belege

R93–R101 gegen ihre Hashmanifeste geprüft und unverändert. Sämtliche neuen Dateien dieser Runde stehen im R102-Hashmanifest. Claudes R102-Gate-/Mutations-/haus-Belege wurden nicht überschrieben.
