# R262 — Planabgleich

Geprüft: Abschnitt „Claude · Planfassung 2 · Anfrage R262“ im Review-Dokument, Produktbasis unverändert `012cf3d5`. SHA256 des Review-Dokuments vor dem Codex-Anhang: `9c695b1a323d97a06f6ac482b53ea56150c0dd098eaf710185228a1213fd90a6`.

Dies ist eine reine Planprüfung. Keine neuen Builds, Tests, Browser- oder Mock-Prozesse, kein Zugriff auf die Sim, keine Produktänderung. Die Quellbefunde und Reset-Probe aus R261 wurden nicht erneut ausgeführt.

| Vertrag | Festlegung in Fassung 2 | Beurteilung |
| --- | --- | --- |
| PM261-01 | Automatische Test-Fixture, bestätigter Reset, beforeAll-Inventur, Folgetest/-datei | Angenommen |
| PM261-02 | Ohne Slot ungebundene Adresse, Indexprüfung, Override entfernt, gemeinsame Endpoints, Smoke separat | Angenommen |
| PM261-03 | Eigene Bindebestätigung, Besitzregister, begrenzte Übergabe, Kind-Ende geprüft | Angenommen |
| PM261-04 | Explizite Identitätsmigration, Worker-Ereignisse, barrierenbasierter Sentinel, Auswahl- und Messläufe | Angenommen mit den zwei konkretisierten Harness-Abnahmekriterien im Review |

## Herleitung der beiden Präzisierungen

1. Fassung 2 Zeile 136 verlangt Slotgleichheit mit workerInfo.parallelIndex; Zeilen 147–153 verlangen den eigenen gebundenen Kindprozess. Werden bei zwei verschiedenen Worker-Indizes nur beide Slots auf 0 gesetzt (Zeile 169), kann die Gegenprobe bereits an diesen Schutzprüfungen scheitern. Ein solcher Fehler ist kein Beleg dafür, dass die Zustands-Assertions Kreuzkontamination erkennen. Der isolierte negative Harness muss daher tatsächlich beide Teilnehmer an denselben bereits laufenden Mock anbinden und die erwartete Zustands-Assertion als Fehlerursache belegen. Die normale Fixture behält ihre Schutzprüfungen.

2. Zeile 172 nennt 3 s beziehungsweise 8 s Verzögerung nach EOF; die Übergabegrenze aus Zeile 151 beginnt aber beim Ersatzworker. Einfacher analytischer Gegenfall (keine Messung): EOF bei t=0, alter Mock endet bei t=8, Ersatz beginnt sein Warten bei t=4. Dann wird der Port nach 4 s Warten frei und die 5-s-Grenze wird eingehalten. „8 s nach EOF“ allein erzwingt also keine Ablehnung. Der Harness muss Verzögerung und erwarteten Ausgang an den bestätigten Beginn des Übergabewartens binden.

Beides konkretisiert den bereits verlangten Nachweis, ohne die Architektur oder den Produktumfang zu erweitern. Die Umsetzung bleibt anschließend separat abzunehmen.
