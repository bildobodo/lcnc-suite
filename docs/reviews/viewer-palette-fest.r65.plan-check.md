# R65 – Nachprüfung Planfassung 3.1 (Codex, 2026-10-02)

Geprüfter Bereich: `3e5eae9..fd6f935` auf `wip/part-b`.
Vollständiger Prüfstand: `fd6f935421b339b1145c1003ddf15fa7e8f0a00a`.
Live-Checkout beim Lesen: `a85bf5d` auf `feat/keypad-keys`.

Der Diff ändert ausschließlich `viewer-marks.plan.md` und die Review-Anfrage.
Beide gelesenen Dokumente im Live-Checkout waren vor meinem Anhang bytegleich
mit dem angefragten Prüfstand. SHA-256:

- Plan: `302159ee28987e635319cc64b23a313d7a1f97c3f1d6b3db7e95734f763d5db6`
- Review vor R65-Anhang: `433c360b99963ba71f23cc7a301572e8d83868e50ee82720e0a032c64b1f1504`
- Unveränderter R64-Rechenbeleg (`viewer-palette-fest.r64.plan-probe.json`):
  `a464d21813f51621d8ec4e324f34eec9d6480a3e36747a18d4f5deee32d292f4`

## Prüfung des letzten Rests VP62-01

Sei `m = L_sichtbar / (N · Δt)`. Für ein sichtbares, nicht degeneriertes
Intervall gilt unter der vereinbarten oberen Mittelwertgrenze `m ≤ 15`
und bei `L_sichtbar > 15`:

`N · Δt = L_sichtbar / m ≥ L_sichtbar / 15 > 1`.

Damit ist das Intervall länger als eine Zelle und enthält mindestens eine
Zellgrenze strikt im Inneren. Auf beiden Seiten liegen alternierende Töne
mit positiver Parameterlänge. Daraus folgt keine Mindestbreite im Raster.
Die Aussage wird im Plan ausdrücklich ohne Stufenkappung gemacht.

Die unveränderten R64-Gegenbelege stimmen mit dem neuen Vertrag überein:

| Fall | Nachweis aus R64 | Vertrag in 3.1 |
|---|---|---|
| Genau 15 px, `N=8`, `[7/8,1]` | Nur Zelle 7 hat positive Länge | Aus der Zusage ausgeschlossen und als Grenzfall benannt |
| Perspektivische 100-px-Kante, `N=16` | Helle Anteile zusammen 0,105870934 px | Keine allgemeine Pixel-/Lesbarkeitsgarantie |
| R63-Near-Clipping, 100 px, `Δt=1/51` | `N=512`, nominal 9,9609375 px; beide Töne geometrisch vorhanden | Bleibt konkreter Fall für die spätere gerenderte Abnahme |

Auch die Überverfeinerung anderer Reach-Stücke wird als Auflösungsgrenze
benannt. Die geplanten Bildprüfungen beziehen sich jetzt auf bestimmte
Geometrien, während die beiden Grenzfälle die geometrische Aussage prüfen.
Das setzt die drei Korrekturvorschläge aus R64 um. VP62-01 ist auf Planebene
geschlossen; keine neuen Befunde in diesem Dokumentationsdiff.

## Grenzen

Manuelle Prüfung des Diffs, der mathematischen Folgerung und der bestehenden
Rechenbelege. Keine neue Sonde, kein erneuter Testlauf, kein Build und keine
Browser-/Live-Prüfung für diese reine Textänderung. Die Testpflege und
Endmarken wurden bereits in R64 angenommen; diese Ergebnisse gelten weiter.

Agreement für den fortgeschriebenen Plan bis einschließlich Fassung 3.1,
nicht für eine noch ausstehende Implementierung. Rendernachweise und
Operator-Auswahl der Label-Variante bleiben die vereinbarten nächsten
Abnahmeschritte. Keine Produktänderung, keine Maschinenbefehle, keine
Live-Port-Zugriffe, kein Commit; frühere Texte und Belege bleiben unverändert.
