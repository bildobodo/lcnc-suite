# R261 — Planprüfung und eigene Belege

Geprüft: Plan aus dem Live-Review-Dokument (vor dem Anhang unverändert gesichert), Quellstand `012cf3d5` auf feat/test-tiers. Isolierte Git-Kopie `/tmp/codex-r261-dq_g6o8l/repo`; Node-Abhängigkeiten bei bytegleichem Lockfile aus der vorherigen Prüfkopie übernommen. Produktquellen unverändert, Prüfkopie sauber.

## Protokollprobe

`node per-worker-mock.r261.reset-probe.mjs TMP_WORK`, mit dem Quellstand unter TMP_WORK/repo und installierten Frontend-Abhängigkeiten. Die Sonde startet ausschließlich den vorhandenen Mock aus der Kopie auf einem eigenen zufälligen IPv4-Loopback-Port. Sie verbindet nacheinander kurze WebSocket-Clients, keine Browser:

1. Neuer Client: armed=true, X=12.345.
2. Kontrollkanal verändert armed=false, X=99.125; alle bisherigen App-Clients geschlossen.
3. Nächster neuer Client: weiterhin armed=false, X=99.125.
4. Explizites reset; nächster Client: wieder armed=true, X=12.345.

Der Mock wurde im finally beendet und sein Exit abgewartet. Keine Sim-Ports verwendet, keine Maschinenbefehle, keine Builds/Tests im Live-Baum. Der erste Versuch scheiterte schon beim eigenen Socket an Sandbox-EPERM; genehmigte Wiederholung erfolgreich. Kein voller Browserlauf und keine Behauptung, den noch ungebauten Worker-Entwurf ausgeführt zu haben.

## Einordnung

Die Probe belegt den Zustandsübergang zwischen Clients des heutigen Mocks. Der ergänzende Quellbefund ist die fehlende Reset-Garantie in armed.spec und frames.spec. Sie beweist keine bereits gemessene neue Scheduler-Reihenfolge; diese ist gerade Teil des zu bauenden Entwurfs.

Portübergabe, Override-Regel und Identitätsmigration sind Vertragslücken des Plans, keine ausgeführten Fehler einer neuen Implementierung. Der Leck-Test prüft renderer.info des eigenen Renderers; seine Zeitbudgets müssen unter der künftigen Parallelbelastung gemessen werden.

Quellstellen/Hashes, installierte Playwright-Version und offizielle Referenzen stehen in inventory.json. Für die Browser-Semantik wurden die offiziellen Playwright-Seiten zu Parallelität, Fixtures und Worker-Neustarts gelesen und der installierte Worker-Einstieg geprüft.
