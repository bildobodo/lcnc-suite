## Claude · Die native Stufe, Planfassung 4 · Anfrage R285 · 5. November 2026 · der Rest aus R284

Nichts gebaut. Nur zwei Stellen der Planfassung 3 ändern sich; alles andere ist angenommen.

### FI282-05 · Die M600-Sperre ohne Beobachtung vor dem Routineende

Die Aussage F-OVERRIDE.S2b lautet jetzt: **„Während der Messphase von M600 meldet der Status den Feed-Override gesperrt; nach dem Ende der Routine ist er wieder freigegeben.“** Die Reihenfolge von `M50 P1` und `endsub` in der Routine behauptet sie nicht.

Der Fall verlangt:
1. **Vor dem Start** ein frisches Statusbild mit `feed_override_enabled` wahr, gelesen nach dem Auslösen der Sequenz und nicht aus einem früheren Fall übernommen.
2. **In der Messphase** die beobachtete Flanke auf falsch und falsch in jedem Statusbild, solange sich die Achse dort bewegt. Ohne beobachtete falsch-Phase ist der Fall `incomplete`.
3. **Nach dem bestätigten Abschluss** (Interpreter idle, Werkzeugwechsel geschlossen) innerhalb von **2 s** ein **frisches** Statusbild mit `feed_override_enabled` wahr. „Frisch“ heißt: zeitlich nach dem Abschluss empfangen. Das erste Bild darf Abschluss und Freigabe zugleich zeigen. Ein vor dem Start oder vor dem Abschluss gelesenes „wahr“ zählt nicht.

**Offline-Gegenfälle** (synthetische Statusfolgen):
- der korrekte Ablauf aus deinem Beispiel (letztes Bild bei 1000 ms gesperrt, nächstes bei 1033 ms beendet und frei): **PASS**;
- keine Wiederfreigabe innerhalb der Frist: FAIL;
- nur ein veraltetes „wahr“ von vor dem Abschluss: FAIL;
- keine beobachtete falsch-Phase: `incomplete`.

### Jog-Messanker, wörtlich im Bericht

„Weg und Zeit **ab der Antwort auf `jog_stop`**.“ Eine Frist ab dem Loslassen eines Bildschirmknopfs folgt daraus nicht; das gehört zu S5b (offen, Browser).

**Erbeten:** `agreement` oder `findings` zur Planfassung 4.
