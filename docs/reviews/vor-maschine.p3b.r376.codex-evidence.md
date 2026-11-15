# R376 · Codex · Nachprüfung des Messvertrags

Planstand: `1c6d05c1`, Abschnitt „Antwort auf R375, Plananfrage R376“. Produktstand unverändert `d7431f199a510c662e5363035ea8e15d3656d787`. Reine Planprüfung; kein Build, keine Produktänderung, kein Netzwerk-/HAL-Zugriff und kein Signal an Prozesse.

[Ausführbare Sonde](vor-maschine.p3b.r376.codex-probe.py), [Ergebnis](vor-maschine.p3b.r376.codex-probe.json):

```sh
python3 /path/to/vor-maschine.p3b.r376.codex-probe.py /tmp/r376-plan-probes.json
```

Alle Assertions bestanden. Die Sonde formalisiert die angegebenen Planregeln und liefert synthetische Zeugen; sie prüft keine noch nicht vorhandene Implementierung.

## Rest A · Grundlinienalter

Gültiger FALSE-Grundlinienframe vor dem Stopp:

| Wert | Sekunden |
|---|---:|
| `read0` | 9,00 |
| tatsächliche Ablesung im Gegenbeispiel | 9,01 |
| `read1` | 9,80 |
| `arrival` | 9,81 |
| `t_pub` | 9,90 |
| Empfang | 10,00 |

Alle Zeit-Ordnungsregeln des Plans sind erfüllt, `stale` ist falsch. Eine Verdrängung nach dem HAL-Lesen und vor seinem zweiten Zeitstempel erklärt die breite Klammer.

- R376 verwendet Empfang − `read1` = **0,20 s** und lässt die Grundlinie zu.
- Das tatsächliche Alter dieses Zeugen ist **0,99 s**.
- Das aus den Stempeln beweisbare Alter liegt in **[0,20; 1,00] s**. Eine Obergrenze von 0,5 s ist damit nicht belegt.
- Die Zulassung über Empfang − `read0` ≤ 0,5 s würde eine ausreichend junge Grundlinie beweisen. Eine nicht bewiesene Grundlinie ergibt `incomplete`, keinen behaupteten Produktfehler.

## Rest B · Gültigkeit des Latch-Wertes

Der zweite Zeuge erfüllt alle ausdrücklich aufgezählten Bedingungen in VM375-03 Schritt 1: richtige Epoche, endliche geordnete Zeiten, steigende Sequenz, ganzzahlige Generation, `stale: false`. Seine Ableseklammer liegt vollständig nach SIGCONT, die Fristobergrenze beträgt 0,14 s. `safety_trip` ist gesetzt, aber `latched` ist **null**.

Die Liste der Gültigkeitsbedingungen nimmt ihn derzeit an. Damit kann er die Rolle eines neuen Frames erfüllen, obwohl keine Latch-Eingabe belegt ist. Das ist durch eine ausdrückliche boolesche Pflichtform zu schließen: `true` oder `false`; fehlend/null/anderer Typ ist eine Messlücke. Die A2-Formulierung „ohne Snapshot oder Feld steht null“ muss hierzu eindeutig werden.

## Angenommene Fristregel mit `t_pub`

Vier Kontrollen bestätigen den konservativen Vertrag (jeweils gültige Zeitordnung und, wo nötig, keine vorherige Messlücke):

| Fall | Untergrenze | Obergrenze | Urteil |
|---|---:|---:|---|
| Rechtzeitige Veröffentlichung und Verarbeitung | 0,19 s | 0,30 s | PASS |
| Nachweislich verspätete Veröffentlichung | 1,19 s | 1,40 s | FAIL |
| Nur Empfangsverarbeitung spät | 0,19 s | 2,00 s | incomplete |
| Korrigiertes R376-Klammerbeispiel | 0,20 s | 1,20 s | incomplete |

Für die letzte Zeile sind SIGCONT [10,00; 10,40], Ablesung [10,41; 10,42], Ankunft 10,43, Veröffentlichung **10,60** und Empfang 11,20 s miteinander vereinbar. Das im Plan genannte `t_pub = 10,30` kann bei dieser Klammer keinen gültigen neuen Frame begleiten: Dafür müsste `read0 > 10,40` und zugleich `read1 ≤ t_pub` gelten.
