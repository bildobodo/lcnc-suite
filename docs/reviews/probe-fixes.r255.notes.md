# R255 · Codex · Prüfprotokoll

Prüfstand `a12c2443` gegen `b9e29335`, eigene Archivkopie `/tmp/codex-r255-taw1x_73/repo`. Live-HEAD zu Beginn `e860ffde`; keine Produktänderung, kein Build oder Test im Live-Baum, keine Verbindung zur LAN-Sim.

## Wiederholen

Archivkopie von `a12c2443` unter `/tmp` erstellen. Dann:

```sh
/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python docs/reviews/probe-fixes.r255.recheck.py /tmp/EIGENE_KOPIE /home/cnc/lcnc-suite /tmp/EIGENE_ERGEBNISSE
```

Der zweite Pfad wird nur für `git show/diff` und die unveränderte R254-Sonde gelesen. Die Kopie wird für Rückmutationen vorübergehend geändert und in `finally` wiederhergestellt. Die Sonde prüft den Zustand aller 1126 Dateien in `subroutines`, `lcnc-gateway`, `lcnc-webui`, `scripts`, `examples` vor/nachher auf Bytegleichheit (ohne Python-Caches).

## Ergebnis

- Genau 38 Ersetzungen `[3017]` → `[#3017]` in zehn NGC-Dateien, keine andere Änderung in diesen Dateien; Frontend unverändert.
- Unveränderte R254-Sonde: 112 Aufrufstellen, je Vorwahl 123/1000/1500, keine Abweichung; einschließlich Weitergabe vom vierten Argument an die G1-Verfahrbewegungen des Helfers. Statische Quelltextprüfung, keine Interpreterausführung.
- Repository `test_ngc_fixtures`: 7/7 grün. Der neue Wächter besucht 193 benannte O-call-Zeilen im Archiv.
- Jede der 38 korrigierten Stellen einzeln zurückgesetzt: 38/38 rot im echten Repository-Wächter, jeweils mit genau der betroffenen Datei/Zeile. Anschließend alle zehn Routinen auf den alten Stand gesetzt: genau 38 gemeldete Fehler. Nach Wiederherstellung grün.
- Dokumentationskorrektur zur W3-Grenze und Herkunftsvermerk geprüft. Claudes Backend-Gate an `d4898373` und Frontend-Gate an `b9e29335` gelesen; keine unabhängige Wiederholung dieser vollständigen Gates.

Grenze des Wächters: gezielter Repository-Lint gegen nackte 3xxx-Argumente in den verwendeten benannten Aufrufen, kein vollständiger G-Code-Parser oder allgemeiner Beweis über ausgewertete Ausdrücke. Insbesondere ist eine Zahl zwischen 3000 und 3999 sprachlich nicht grundsätzlich verboten; die Regel ist hier eine Konvention der mitgelieferten Aufrufe.

Kein nativer Antastlauf oder physischer Vorschubnachweis. Dafür gibt es in dieser Runde keinen neuen Bedarf: Die beanstandete konkrete Argumentweitergabe ist direkt geprüft. Die separat vereinbarte native Antast-Abnahme bleibt separat.
