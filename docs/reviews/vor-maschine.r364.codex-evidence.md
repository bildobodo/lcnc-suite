# R364 · Codex · Vertragsgegenfälle

Plan: `a699d525`, Produktbasis unverändert `45727d61`. Nur Review; keine
Produktänderung, kein Server, keine Live-Sim-Befehle und kein Gesamt-Gate.

[Sonde](vor-maschine.r364.codex-probe.py),
[Ergebnis](vor-maschine.r364.codex-probe.json).

```sh
python3 docs/reviews/vor-maschine.r364.codex-probe.py \
  /tmp/codex-r362 /tmp/r364-result.json
```

Die vorhandene Archivkopie `/tmp/codex-r362` entspricht der Produktbasis.
Die Sonde extrahiert `_jog_mode_flag`, `_jog_axis_arg` und `_manual_command`
unverändert per Python-AST. Ihre Abhängigkeiten sind reine In-Memory-Fakes;
sie importiert weder Gateway noch LinuxCNC und startet keinen Eventloop.
Exit 0; alle Gegenfälle und Vergleichsfälle durch Assertions bestätigt.
Der SHA256 von `gateway.py` im JSON ist mit `git show 45727d61:...` abgeglichen.

## Home-Gruppe

Die Gruppenrechnung setzt die aus [LinuxCNC 2.9.4 `do_home_one_joint`](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/motion/homing.c#L245)
gelesene Regel um: Der negative Zweig nimmt alle Joints mit gleichem
Sequenzbetrag; der nichtnegative Zweig nur den angeforderten Joint.
Dies ist eine Rechnung anhand des Quelltexts, kein nativer Homing-Lauf.

| Sequenz | Home Joint 0 | Home Joint 1 | Home Joint 2 |
| --- | --- | --- | --- |
| `[-1,-1,-1]` | 0,1,2 | 0,1,2 | 0,1,2 |
| `[1,-2,-2]` | 0 | 1,2 | 1,2 |
| `[-1,0,1]` | **0,2** | 1 | 2 |
| `[-1,0,2]` | 0 | 1 | 2 |

Der dritte Vektor ist im R364-Plan fälschlich „allein negativ, offen“.
Gerade er zeigt die Wirkung unterschiedlicher Vorzeichen bei gleichem
Betrag. Die vierte Zeile ist ein passender positiver Vergleich.

Die getrennte Unhome-Beurteilung wird dagegen durch
[`base_set_unhomed`](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/motion/homing.c#L534)
gestützt: Ein nichtnegativer Joint-Auftrag hat dort keine Sequenzausweitung.
Seine übrigen Zulassungsbedingungen bleiben bestehen.

## Home nach einer Wartephase

`gateway.py:8461` prüft in `_manual_command` zwar die bestehende Klasse
`zero` erneut vor jeder Schreibung; eine Home-Gruppenregel gibt es auf der
Produktbasis noch nicht. Die Planprobe stellt deshalb zwei zukünftige
Einbindungsvarianten gegenüber, ohne sie als Produktimplementierung auszugeben:

1. Frühe Gruppenprüfung bei `[1,2,3]`; während der Modusumschaltung neue
   Reader-Werte `[-1,-1,-1]`; bestehende Zulassung allein lässt danach den
   Home-Auftrag hinaus. Die Gruppenrechnung ergibt alle drei Joints.
2. Dieselbe Folge, aber die Gruppenregel ist Teil der erneut ausgeführten
   Zulassung: Antwort verweigert, kein Home-Auftrag aufgezeichnet.

Der Vertrag muss Variante 2 verlangen. Ein Wechsel nach bereits gesendeter
Modusumschaltung kann diese nicht zurücknehmen; er verhindert die noch
nicht gesendete Home-Schreibung. Kein Anspruch auf Atomizität zwischen
beliebigen externen HAL-Änderungen und der späteren Controller-Ausführung.

## Jog-Ziel trotz referenzierter Maschine

Originalcode: `_jog_mode_flag` ab `gateway.py:4226`, `_jog_axis_arg` ab 4253;
der Aufrufer `_start_jogs` nutzt das Ergebnis ab 4152.

| Status in der Sonde | Tatsächliche Auswahl des Original-Helfers |
| --- | --- |
| homed, Teleop, keine Überschreitung | `joint_flag = 0`, Achse |
| homed, Free, `joints_beyond_limit = [0]` | **`joint_flag = 1`, Joint** |
| homed, Free, Teleop angefordert, aber nicht erreicht | **`joint_flag = 1`, Joint** |

Mit unterschiedlichen, gültigen Fenstern (Achsspanne 1000, Jointspanne 100)
würde der Plan „referenziert → Achsspanne“ in den letzten beiden Fällen
einen Schritt von 200 annehmen, obwohl das wirkliche Jog-Ziel nur Spanne
100 hat. Dies ist eine Gegenrechnung zum neuen Größenvertrag, keine
Behauptung über die Endlage einer realen Fahrt. Die Quelle der Spanne muss
dem tatsächlichen `joint_flag` und Ziel entsprechen.
