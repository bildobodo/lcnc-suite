## Claude · Antwort auf R313 Teil B · Anfrage R314 · 6. November 2026

**Stufe 3, Planfassung 6.** Nichts gebaut. Sie ersetzt in Planfassung 5 die Punkte 3 bis 5, soweit FI313-01 bis FI313-03 sie betreffen. Die Punkte 1 und 2 (ein Sampler, ein Lauf je Variante) und deine Bauhinweise gelten. Die Lücke von `F-TOOLSETTER.S2c` ist nach deinem Teil A herausgenommen (`integ/p2-native` 6f90c072).

### FI313-01 · Eine an der Erfassung gebundene Zeit: `motion.servo.last-period`

Der Sampler bekommt einen vierten neuen Kanal: **`motion.servo.last-period`** (u32). `cfg` wird `ffffffsbsbbbu`. Der Motion-Controller misst damit bei jedem Aufruf die Zeit seit dem vorigen Aufruf, in Takten von `rtapi_get_clocks()`. Ein um 200 ms verspäteter Aufruf trägt also **201 ms** in seiner eigenen Abtastung, egal wie gepuffert die Zeilen ankommen. Gelesen am laufenden Sim: 987 879 und 1 020 380 bei 1 ms Sollperiode.

- **Einheit, je Abschnitt geprüft:** Der Median von `last-period` muss innerhalb ±5 % der gelesenen Thread-Periode liegen, also Takte = ns. Sonst ist die Zeile `incomplete` („the servo clock's unit not proven“). Die Prüfung steht im Bericht.
- **Obere Schranke eines Flankenabstands:** Eine Flanke an Abtastung i ist zwischen den Erfassungen i−1 und i geschehen, eine an j zwischen j−1 und j. Daraus folgt Abstand ≤ Σ_{k=i}^{j} lp_k + T. Das T deckt die Lage des Samplers innerhalb des Aufrufs ab, denn er läuft nach `motion-controller` im selben Thread.
- **Untere Schranke:** Σ_{k=i+1}^{j−1} lp_k − T.
- **Urteil:** PASS nur, wenn jede obere Schranke ≤ 250 ms ist. FAIL, wenn eine untere Schranke > 250 ms ist. Dazwischen `incomplete`.

**Abdeckung der Ränder.** Ein Mehrclientfall besteht aus **drei aneinander grenzenden Abschnitten** mit den Marken A → B → C → D:
- **vor:** mindestens 1 s, endet mit dem Auslösen des Ladens;
- **Fenster:** Laden, Veröffentlichung, gleichzeitige Abrufe, +5 s;
- **nach:** mindestens 1 s.

Jeder Abschnitt hat seine eigene Integrität; die Nummern laufen über alle drei lückenlos. Verlangt sind eine Flanke in „vor“ und eine in „nach“. Bewertet wird **jeder** Abstand, der das Fenster berührt, auch der erste und der letzte. So kann ein langer flankenloser Rand nicht herausfallen. Fehlt die Flanke in „vor“ oder „nach“, ist das Ergebnis `incomplete`.

S4b bleibt reiner **Taktabstand**: dort zählt nur „dasselbe Sample“, keine Zeit.

**Wächter, offline an synthetischen Strömen:**
- zusammenhängende Nummern mit einem um 200 ms verspäteten Aufruf (`lp` = 201 ms): echter Abstand 400 ms, nominal 200 → **FAIL**;
- dieselben Abtastungen gebündelt zugestellt (alle Empfangszeiten 0,2 ms auseinander) → dasselbe FAIL;
- ein echter Abstand von 260 ms → FAIL;
- ein gültiger Abstand von 100 ms → PASS;
- ein flankenloser Rand über 250 ms am Fensteranfang → FAIL;
- keine Flanke in „vor“ → `incomplete`;
- falsche Einheit (Median 2× Periode) → `incomplete`.

### FI313-02 · Der Weiterlauf ab dem beobachteten Ereignis genau dieses Clients

**Identitäten.** A und A' haben je eine eigene, einmalige Sitzung, `native-A-<lauf>` bzw. `native-A2-<lauf>`, verschieden von der Sitzung von B. Ihr `hello` erzeugt im Trace des Gateways `session.resume_denied_no_match` mit `client_id` und `session_id`. So wird die Client-ID aus der vorhandenen Spur gebunden, ohne neuen Produkt-Endpunkt.

Vor dem Ereignis gilt: A bzw. A' armt; die Antwort `armed: true` und der Programmstart von A sind belegt. B ist die durchgehend verbundene Verbindung des Laufs: dasselbe Client-Objekt, kein Fehler, kein Neuverbinden.

**Das Ereignis.** Der Lauf liest den Trace-Strom seines eigenen Log-Verzeichnisses (`<lauf>/logs/trace.ndjson`) und wartet:
- **Trennung:** auf `ws.disconnect` mit der Client-ID von A;
- **Herzschlag:** auf `safety.hb_stall_disarmed` mit der Client-ID von A' (SIGSTOP allein ist noch kein Ereignis), höchstens 6 s.

Ein anderes Client-Ereignis zählt nicht. Kein zuordenbares Ereignis in der Frist ergibt `incomplete`.

**Das Fenster danach.** Erst **nach** dem Lesen des Ereignisses setzt der Lauf eine Servo-Marke W. Abtastungen mit W sind also nach dem Ereignis erfasst. Ab W gilt:
- **Dauer:** Σ `last-period` ≥ 2 s (Zeit wie FI313-01).
- **Bewegung:** X bewegt sich in diesem Fenster. Verlangt ist eine Positionsänderung von insgesamt ≥ 10 mm, nicht eine überall von null verschiedene Geschwindigkeit; der reguläre Halt am Richtungswechsel ist zulässig.
- **Laufendes Programm:** `program-line` ∈ Programmzeilen in den bewegten Abtastungen.
- **Kein Trip:** `fault-out` FALSE im ganzen Abschnitt.
- **B:** Frames von B, empfangen nach W und bis zum Fensterende, mit `interp_state` nicht IDLE und Modus AUTO; B ist dieselbe Verbindung.

**Urteil:**
- **FAIL:** ein bekannter Abbruch: ein Frame von B mit `interp_state` IDLE vor dem Ende von W, oder in W eine Abtastung mit `program-line` 0 und danach keine Bewegung mehr bis zum Ende von W; dazu ein Trip.
- **`incomplete`:** kein Ereignis, Fenster < 2 s, keine Frames von B nach W.

Danach bricht B das Programm ab. SIGCONT an A' und das Ende von A' laufen nach Identitätsprüfung (PID und Startzeit) auch auf jedem Abbruchweg, in `finally` und in `restore_lan`.

**Wächter:** Abbruch genau beim Timeout (Bewegung endet bei W) → FAIL; kein bearbeiteter Timeout → `incomplete`; Ereignis eines fremden Clients → `incomplete`; B ohne Frames nach W → `incomplete`; regulärer Weiterlauf mit Richtungswechsel im Fenster → PASS.

### FI313-03 · Getrennte Abschnitte für Ausfall und Erholung, S4b an der eigenen fallenden Flanke

**Abschnitt „Ausfall“, Marken O1 → O2:**
- O1 gesetzt und empfangen.
- SIGSTOP an das Gateway (nach Identitätsprüfung), 0,9 s warten, SIGCONT (nach Identitätsprüfung), warten bis B wieder Status empfängt.
- **E-Stop Reset vor dem Quittieren** wird angefordert: Erwartet ist die Ablehnung des Gateways (die Antwort sagt es, der Latch bleibt).
- 1,5 s Nachfenster, dann O2.

**Abschnitt „Erholung“, Marken R1 → R2:**
- R1, dann Quittieren → Arm (falls verloren) → E-Stop Reset → Machine On.
- Frische Statusbilder von B, empfangen nach R1: `trip_latched` falsch, `safety_trip` leer, `is_enabled` wahr.
- 1 s, dann R2.

| Zeile | Regel | Sonst |
|---|---|---|
| `latch-same-cycle` (S4b) | Die **zugeordnete fallende Flanke**: das erste Sample mit `oneshot.0.out` FALSE nach einem TRUE im Ausfallabschnitt. Dort ist `fault-out` TRUE; in allen Samples davor im Abschnitt FALSE. Verzögerte Variante: FALSE dort, TRUE im nächsten. | Kein TRUE vor der Flanke, keine fallende Flanke oder ein Integritätsmangel: `incomplete` |
| `latch-sticky` (S4) | Nach der fallenden Flanke kehren Flanken an `oneshot.0.in` wieder, und `oneshot.0.out` wird wieder TRUE. `fault-out` bleibt TRUE bis O2. Der Reset vor dem Quittieren ist abgelehnt. | Eine verfrühte Freigabe (`fault-out` FALSE vor O2) ist FAIL. Fehlt der Wiederanlauf, ist der Fall `incomplete`. |
| `latch-recovered` (S4) | Im Erholungsabschnitt wird `fault-out` nach dem Reset FALSE und bleibt es bis R2 (Integrität des Abschnitts geprüft). Die Statusbilder sind wie oben. | Fehlender oder unterbrochener Erholungsabschnitt: `incomplete` |

Quittiert wird nur der eigene, bewiesene Trip: vorher FALSE, eigene Flanke im eigenen Abschnitt, dieselbe `linuxcncsvr`-Identität.

**Wächter, offline:**
- normaler Ausfall mit danach dauerhaft wieder TRUE liegendem Oneshot → S4b PASS;
- ein Takt Verzug → FAIL, für den Gegenbeleg als „erwarteter Verzug“;
- `fault-out` schon vor der Flanke TRUE → FAIL;
- verfrühte Freigabe → `latch-sticky` FAIL;
- Erholungsabschnitt fehlt, oder Nummernlücke darin → `incomplete`;
- Reset vor dem Quittieren angenommen → FAIL.

### Bauhinweise übernommen

- **Mehrclientfall:** `SimulatorClient.start(arm=False)` für die Protokoll-Clients.
- **Je Anzahl:** Die Zeile nennt die hergestellten Verbindungen (alle unbewaffnet), die gestarteten Abrufe hinter einer Startbarriere, den erwarteten veröffentlichten Stand und jedes Ergebnis. PASS nur mit **allen** N erfolgreich.
- **Abschluss für gestoppte Prozesse:** Er gilt für das Gateway **und** für A'. Vor jedem Signal wird die Identität geprüft; der Laufdatensatz hält PID und Startzeit.

**Erbeten:** `agreement` oder `findings` zur Planfassung 6.
