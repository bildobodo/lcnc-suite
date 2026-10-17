# R167: Planreview und Gegenprobe

Geprüfter Quellstand: `a53db42e22451e214194f3ed2cab405cf2effe67`.
Plan und Anfrage wurden aus dem Live-Baum gelesen; ihre Eingangshashes stehen im Manifest. Keine Produktänderung vorgeschlagen oder eingebaut.

Die Probe ergänzt den vorhandenen Fall „at rest is never a static exclusion“ aus `lcnc-webui/src/viewer/collisionInside.test.ts` um die Kontakt-Senke und prüft, dass trotz null Lücken eine Unentscheidbar-Notiz besteht. Nur die Antwort des Innenprüfers ist per Vitest-Mock kontrolliert, entsprechend dem vorhandenen Wächter; Sweep und Tabellen sind die unveränderte Implementierung. Eine grüne Assertion bestätigt hier den Gegenfall zur geplanten ausschließlichen Ableitung aus Tabellenlücken.

Reproduktion in einer Archivkopie des genannten Commits mit vorhandenen npm-Abhängigkeiten:

1. `viewer-palette-fest.r167.codex-notes.test.ts` als `lcnc-webui/src/viewer/r167.codex-notes.test.ts` ablegen.
2. `/tmp/codex-r167-j22yr_df` anlegen; dorthin schreibt die Sonde ihre JSON-Ausgabe.
3. Im Verzeichnis `lcnc-webui` ausführen:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run src/viewer/r167.codex-notes.test.ts --maxWorkers=1
```

Ergebnis: 1/1 grün, 1 Episode, 1 Intervall, 0 Lücken, 1 Notiz; `uncertified` entspricht der Notiz. Die Ausführung braucht keinen Browser, Server oder Maschinenzugriff.

Quellstellen am geprüften Commit:

- `collision.ts:1859–1868`: unentscheidbare Ruhepose wird über `markInside` benannt.
- `collision.ts:2078–2189`: Kontakt-Senke; Lücken bei Bisektionen und Spurproben.
- `collision.ts:2572–2591`: Notizen aus `undecSpans` und `refineUndec`.
- `collisionInside.test.ts:160–170`: bestehender Wächter zur Ruhepose.
- `ThreeViewer.vue:3318–3369`: aktuelle Bindung der Live-/Seitenansicht an Teilstände.
- `ScrubBar.vue:1246–1265`: Grenzkontakt-Hilfe.
- `scrubTrack.ts:615–629`: Vertrauen, Aufrufzeile und Unterprogrammname.

Die Sonde ist neue Evidenz, kein Repository-Produktfix. Keine Browser- oder Leistungsabnahme in dieser Planrunde.
