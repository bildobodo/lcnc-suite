# R368 · Codex · Prüfnachweis

Produkt `47fd2c5b..d1e2c2e9`, Anfrage `870017c1`. Frische Archivkopie `/tmp/codex-r368`. Kein Produktcode geändert; die vier relevanten Implementierungsdateien sind bytegleich mit dem Integrationskopf ([Hashes und Testzähler](vor-maschine.p3a.r368.codex-checks.json)). Im Live-Baum nur Review-Anhang und neue Belege. Kein Zugriff auf Live-Sim, NML oder Live-Ports.

## Prüfungen

- **929/929 Backend-Tests bestanden.** Im Archiv unter `lcnc-gateway`, Venv `/home/cnc/lcnc-suite-link/lcnc-gateway/.venv`, `LCNC_LOG_DIR=/tmp/codex-r368-logs`:

  ```text
  python3 -m pytest -q test_r366_codex.py test_r367_codex.py test_payload_contract.py test_payload_scan.py test_command_policy.py test_command_dispatch.py test_g30.py test_toolsetter_rules.py test_feature_switches.py --junitxml=/tmp/r368-backend.xml
  ```

  Die R366- und R367-Sonden wurden unverändert in die Archivkopie übernommen. [Ausgabe](vor-maschine.p3a.r368.codex-backend.txt), [JUnit](vor-maschine.p3a.r368.codex-backend.xml), [R367-Dispatchfälle am neuen Kopf](vor-maschine.p3a.r368.codex-r367-wire.json). Die R366-Sonde enthält weiterhin ihr ausdrücklich korrigiertes 255-Byte-Modell; ihre Fälle liegen nicht auf der Kante. Die 254/255-Grenzwächter des Repositorys und die R367-Touch-off-Kante laufen mit. Fake-LinuxCNC und Unterbindung der Host-Sim-Erkennung bleiben aktiv; nur die für asyncio nötigen lokalen Sockets wurden freigegeben.

- **5/5 neue Offline-Wächter des Live-Treibers bestanden.** `python3 -m pytest -q scripts/test_native_stage.py -k 'home_group_fixture or gateway_on_the_port or home_step_driver'`. [Ausgabe](vor-maschine.p3a.r368.codex-target-tests.txt). Die zwei reinen Zielhelfer sowie die Eintrittspfade wurden gelesen. Kein vollständiger nativer Testlauf.

- **Die beiden R367-Eintrittsgegenfälle sind geschlossen.** Unveränderte [R367-Sonde](vor-maschine.p3a.r367.codex-live-target.py) mit Argument `/tmp/codex-r368`: [Ausgabe](vor-maschine.p3a.r368.codex-r367-target-rerun.txt). Die als `FAIL target` beschrifteten Zeilen sind hier die erwarteten Ablehnungen; beide `refused_before_writes` sind `true`, kein Connect/Arm/Reset. LinuxCNC und Transport sind vollständig ersetzt.

- **Neue Listener-Gegenprobe: 1 rot, 2 grün.** [Quelle](vor-maschine.p3a.r368.codex-listeners.py), [Ausgabe](vor-maschine.p3a.r368.codex-listeners.txt), [Eingaben und Ergebnisse](vor-maschine.p3a.r368.codex-listeners.json). Als `scripts/test_r368_target_codex.py` im Archiv, Aufruf `python3 -m pytest -q scripts/test_r368_target_codex.py`. Echte `listening_pids`- und `gateway_target_problems`-Funktionen, ausschließlich injizierte `ss`-/`/proc`-Daten: kein `ss`-Prozess, kein Socket, kein NML. Ein unbekannter Listener allein wird verweigert; ein bewiesenes Gateway allein wird angenommen. Die Kombination lässt den unbekannten Listener verschwinden und wird ebenfalls angenommen.

Die neue Sonde weist den Verlust einer Listener-Zeile im Parser und damit eine unbelegte Zulassung nach. Sie behauptet weder eine tatsächlich vorhandene fremde Maschine auf diesem Host noch einen ausgeführten Maschinenbefehl. Der Treiber ruft genau diese beiden Helfer auf und behandelt die leere Problemliste als Freigabe.

## Grenzen

Kein Browser, kein vollständiges Gate, keine eigene Live-Abnahme. Claudes Gate-/Live-/CI-Angaben sind fremde Nachweise; CI nicht unabhängig abgefragt. Der gemeldete fehlgeschlagene Standby-Lauf und sein Wiederholungslauf bleiben im Review ausdrücklich getrennt. Die Oberfläche war in dieser Korrektur unverändert; VM-I12 bleibt nach R367 geschlossen.
