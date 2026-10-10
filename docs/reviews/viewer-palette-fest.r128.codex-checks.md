# Codex R128 — F5-Nachweis / VP-I77

Geprüft: `ad7f195b..0d75dcf9`, 10.10.2026. Der Bereich enthält Dokumentation und Messskripte, keine Produktänderung. Commit-Dateien wurden in `/tmp/codex-r128-nyvew6of` unveränderlich abgelegt. Die Messskripte wurden von Codex **nicht** gestartet; kein Live-Port, HAL-Zugriff oder Maschinenbefehl.

## Unabhängig geprüfte Daten

Neben dem eingecheckten Bericht wurden die Originalausgaben im bereits vorhandenen Claude-Scratchpad gelesen:

- `f5_seq.txt` und `f5_seq.txt.samples.json`
- `f5_xyzac.logged.txt`, `f5_accel250.logged.txt`, `f5_norho.logged.txt`

Beide dortigen Messskripte stimmen bytegleich mit den in R128 eingecheckten Fassungen überein. Die vier Textausgaben sind unverändert als neue Belege kopiert. Die 3.222.163 Bytes Rohsamples sind verlustfrei als `viewer-palette-fest.r128.codex-samples.json.gz` gesichert (210.348 Bytes); der SHA256 der entpackten Originalbytes steht in Kontext und Audit-Ergebnis.

Der eigene Audit liest ausschließlich gespeicherte Dateien und prüft:

1. 32.971 STAT-Abfragen mit streng steigenden Zeitstempeln, 117 HAL-Samples, genau zwei Auslöseereignisse an der Platte mit T7.
2. Aus den Rohwerten bestimmte Auslösepositionen, untere Umkehrlagen, Rückzugsspitze und freier Eingang am Rückzugsmaximum sowie beim ersten beobachteten Abwärtsweg der langsamen Antastung.
3. Formel `h = 4*v*T + v²/a` mit INI-Grenzen und Reserve; beide beobachteten Überschwingstrecken darunter. Abstände 0,706111… und 0,002844… mm.
4. Rückzug exakt 3 mm, Werkzeugspitze danach 0,795 mm über der Platte. Die aus dem langsamen Auslösepunkt abgeleitete Tabellenlänge stimmt mit 65,9961 mm innerhalb der Berichts-Rundung überein.
5. HAL-Samples vor und nach beiden Auslöseereignissen: Freigabe TRUE, Werkzeuglänge 66. Alle 117 gespeicherten HAL-Samples: manueller Eingang FALSE, externer Versatz 0 und deaktiviert. Die Freigabe wird bereits rund 5,6 s vor dem ersten Auslöseereignis TRUE.
6. Alle drei neuen Einzelmessungslogs enthalten ihre INI-Basis, Plattenvergleich, Eingangskette und Zustandsmengen. Je 14 Messzeilen, insgesamt 42, sind wörtlich identisch zu den bereits geprüften R127-Zeilen des Vier-Takte-Modells. Formel und positive Abstände wurden erneut berechnet.

Ergebnis: **PASS**. Kein neuer Produkt-Testlauf für diese reine Nachweisrunde erforderlich; R127-Produktprüfungen bleiben maßgeblich.

## Wiederholung ohne Maschine

Aus einer Repository-Kopie mit den neuen Belegen:

```sh
python3 docs/reviews/viewer-palette-fest.r128.codex-audit.py docs/reviews docs/reviews/viewer-palette-fest.r127.f5.txt
```

Der Aufruf erzeugt `viewer-palette-fest.r128.codex-audit.json` im angegebenen Belegverzeichnis. Für unveränderte Belege vorher die Dateien in ein separates temporäres Verzeichnis kopieren und dieses übergeben. Keine LinuxCNC-Imports, Netzverbindungen oder Live-Aktionen im Audit.

## Grenzen / kleiner Lesehinweis

Die 32.971 STAT-Abfragen sind keine 32.971 unabhängigen Servoaufzeichnungen: viele Abfragen lesen denselben veröffentlichten Zustand. Der Audit benennt die unteren Lagen daher als beobachtete Minima. Die Messung und die HAL-Abtastung stützen F5 auf dieser Sim; sie zertifizieren keine beliebige reale Tasterkette.

Die R128-Erklärung „enable FALSE stammt aus der Zeit vor M61 T7“ ist für die **Einzelmessungen** zu bestimmt: deren Skript startet `HalSampler` erst nach dem M61-Erfolg. Die aggregierten Einzelmessungslogs enthalten keine Zeitzuordnung dieser FALSE-Werte. Daraus sollte keine exakte Zuordnung vor M61 behauptet werden. Für die **Routinefolge** ist die Zuordnung anhand der gesicherten zeitgestempelten Samples prüfbar: während beider Antastungen TRUE. Das ist eine kleine Textpräzisierung, kein neuer offener F5-/Produktbefund.

Für eine Wiederholung der ursprünglichen Messskripte müssen ihre Scratchpad-Namen berücksichtigt werden: `viewer-palette-fest.r128.f5-probe.py` importiert `f5_seq`; die zweite Datei war im Scratchpad entsprechend `f5_seq.py` benannt. Diese Live-Skripte wurden hier nur gelesen.
