# R365 · Codex · Nachprüfung des Nutzlastvertrags

Planstand `5184b60e`, unveränderte Produktbasis `45727d61`. Geprüft wurden
die Antwort auf R364 und die betroffenen Original-Helfer in der Archivkopie:
`_manual_command`, `_start_jogs`, `_jog_mode_flag`, `_jog_axis_arg` und der
`clear_wcs`-Zweig in `_cmds_work_offsets`.

[Abgleich mit Dokument-/Quelltexthashes](vor-maschine.r365.codex-checks.json).
Die vorhandenen [R364-Gegenproben](vor-maschine.r364.codex-evidence.md)
bleiben die Grundlage; es gab keinen Anlass, unveränderten Produktcode
erneut durch ein Gesamt-Gate zu schicken. Keine Builds, Serverstarts,
Maschinenbefehle oder Live-Sim-Zugriffe.

| Offener Punkt | Abgleich in R365 |
| --- | --- |
| VM363-04 Rest A | Alle fünf Tabellenzeilen mit insgesamt 15 Zielmengen entsprechen der bereits am nativen Quelltext geprüften Regel: bei nichtnegativer Sequenz nur der gewählte Joint, sonst alle Joints mit gleichem Betrag. `[-1,0,1]` ist jetzt der Gegenfall; `[-1,0,2]` der positive Vergleich. |
| VM363-04 Rest B | Home-Zulassung ist ausdrücklich Teil jedes `admit`, einschließlich Modus- und Home-Schreibung. Gruppenwechsel, unbekannte oder veraltete Lesung lassen den noch ungesendeten Home-Auftrag nicht hinaus. Positive und negative Ablaufwächter sind zugesagt. |
| VM364-01 | Ziel und Spanne werden vor vorbereitenden Schreibvorgängen gemeinsam gewählt; referenzierter Joint-Jog bekommt die Jointspanne. Eine nicht erreichte oder geänderte Moduswahl führt zur Ablehnung statt zum Weiterfahren unter einer anderen Spannenprüfung. |
| `clear_wcs.target = "reserved"` | Bestehender Zweig an `gateway.py:6900`: aktive Ebene wird abgelehnt, ausgewählte Zeilen sind 6–9. Beibehalten ist eine Ergänzung der Vertragstabelle, keine neue Funktion. |

## Bedeutung für die Implementierungsabnahme

R364 und R365 versprechen, Ziel und Spanne **bis zur Jog-Schreibung**
zusammenzuhalten. Dazu gehört die letzte Zulassung im Schreibthread; ein
Abgleich ausschließlich vor dem Einreihen des Schreibauftrags würde die
Zusage nicht erfüllen. Das ist die bereits angenommene Schreibgrenze.

„Tatsächlicher Modus“ bedeutet bestätigter Controller-Modus, nicht nur die
Absicht eines Helfers. Auf der Produktbasis gibt `_jog_mode_flag()` im
`beyond`-Zweig nach dem Versuch `teleop_enable(0)` die Zahl 1 zurück, ohne
dort nochmals den erreichten Modus zu prüfen. Im Bau muss auch dieser Weg
die zugesagte Bestätigung liefern. Die Auswahl darf die endgültige
Zulassung nicht ersetzen. Dies wird im Implementierungsreview anhand der
aufgezeichneten Befehle geprüft; die Dokument-Runde behauptet noch keinen
erfolgreichen Produktnachweis.

Der bestehende `reserved`-Zweig wurde hier auf seine Existenz, Zielzeilen
und vorhandene Ablehnung bei aktiver Ebene geprüft. Eine weitergehende
Live-Abnahme oder neue Zusage für unbekannten TWP-Zustand wurde nicht
vorgenommen.
