# R259 — eigene Nachprüfung

Stand `32e6ba68..0e5f30b1`, isolierte Git-Kopie `/tmp/codex-r259-bkksfkcj/repo`. Node-Abhängigkeiten aus der vorherigen Prüfkopie bei bytegleichem Lockfile kopiert. Produktbaum unverändert; alle temporären Quelländerungen zurückgenommen, Prüfkopie sauber.

- Auswahltests: 39 bestanden. Im ersten Lauf nur der eigene Socket-Test durch die Sandbox verweigert (38 bestanden); genehmigte Wiederholung vollständig grün.
- R257-Gegenfälle gleicher Zeile/Umbruch vor der Klammer und R258-Gegenfälle Namensraum-Leerraum/gemischter Import erkannt. Dynamischer IO-Import in scenes.viewer wird abgewiesen.
- Vier neue Formen: benannter Default-Import, benannter promises-Import, als Wert weitergereichtes fs.promises und Destrukturierung von fs.promises. Alle geben `calls: [], refused: []` zurück; auch `reads.problems` am tatsächlichen, vorübergehend ergänzten Spec bleibt leer. Der dort eingefügte Testaufruf konsumiert die Datei über `await r259Read()`.
- Node führt die vier Lesungen tatsächlich aus (je 1248 Zeichen). Beim benannten Default-Import bestehen alle 38 nicht socketbezogenen Auswahltests. Der für diesen Gegenfall irrelevante Porttest war ausgeschlossen.
- Eine reine Änderung an macro_refusals.json wählt freecad-import weiterhin nicht. Das belegt die Auswirkung einer unbemerkt hinzugefügten Abhängigkeit, keine neue Behauptung über eine im aktuellen unveränderten Produkt vorhandene Lesung.
- Die tatsächliche Auswahl für den R259-Diff ergibt nur scenes.viewer. Claudes vorhandene Round-4-Berichte unabhängig neu ausgewertet: vollständige gegen selektive Auflistung korrekt, 10 gelistet = 10 genau einmal ausgeführt, Reihenfolge korrekt; Unit 2573 gelistet = vorhanden, keine Retry-Fehlermeldungen. Hashes der Rohberichte stehen in results.json.
- Kein neuer vollständiger Gate-Lauf oder Produkt-Browserlauf; keine Builds/Tests im Live-Baum, keine Sim-Zugriffe oder Maschinenbefehle.

Reproduktion: isolierte Kopie von `0e5f30b1` mit passenden Node-Abhängigkeiten unter `TMP_WORK/repo`; `python3 test-strategy.r259.probes.py TMP_WORK`. Die Sonde schreibt nur in TMP_WORK; sie liest zusätzlich die benannten vorhandenen Round-4-Berichte.
