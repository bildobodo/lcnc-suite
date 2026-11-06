## Claude · Bau Stufe 3 · Anfrage R317 · 6. November 2026

**Stufe 3 der nativen Stufe ist gebaut**, nach Planfassung 8 (R316). Zweig `feat/native-step3` von `integ/p2-native` `6f90c072`, Stand **`33630f93`**. Erbeten: `agreement` oder `findings`.

### Block 1 · Die Zeit des Servo-Stroms (`57ab67e2`)

**`servo.py`:**
- Vier Kanäle **hinter** der Marke: `oneshot.0.out`, `webui-hb-latch.fault-out`, `oneshot.0.in` und `motion.servo.last-period` (u32); `cfg` ist `ffffffsbsbbbu`. Jede 2c-Spalte behält ihre Stelle.
- Die Verdrahtung wird zurückgelesen. `motion-controller` muss vor `sampler.0` im Servo-Thread stehen.
- Der Leser hält jeden Empfang in ganzzahligen ns (`monotonic_ns`).
- `begin()` hält t₀ (`monotonic_ns`) vor dem Setzen der Startmarke fest.
- `phase()` setzt eigene, negative Marken innerhalb des offenen Abschnitts. `section()` nimmt sie in den Körper und gibt `phase_first` zurück.

**`servo_time.py`** (rein):
- **Uhrenvertrag:** SHA-256 von `rtapi_app` und Paketversion.
- **Überlaufnachweis:** `0 ≤ recv_b − t₀ − Σ lp_2..b < 2³²`.
- **Flankenschranken:** oben Σ lp_i..j+1, unten Σ lp_i+2..j−1, nur im bewiesenen Bereich.
- **Untere Dauer:** Σ lp_a+2..b.
- **Urteil:** dreistufig.

**Wächter:**
- 100 ms ergibt PASS, 260 ms FAIL.
- Der R314-Fall ist `incomplete`, auch als 200/200.
- Ebenfalls abgefangen: der gekürzte 4,301-s-Wert, ein negativer Rest, ein Rest von genau 2³², Perioden außerhalb des Bereichs.
- Die untere Dauer nach einer Marke in einer Pause.
- Die Uhr gilt nur am geprüften Binary.

### Block 2 · Der Latch (`3652208d`, `c83bcf4a`)

**`servo_cases`:**
- `falling_edge` bestimmt die zugeordnete fallende Flanke: das erste FALSE nach einem TRUE.
- `eval_latch_same_cycle`: Die verzögerte Variante gibt PASS nur bei genau einem Takt Verzug.
- `eval_latch_sticky`: Wiederanlauf; `fault-out` bleibt bis zum Ende; der Reset vor dem Quittieren ist abgelehnt; die Frames nach dem Wiederanlauf zeigen den wartenden Trip.
- `eval_latch_recovered`: im eigenen Abschnitt.

**`trip.py`:**
- `stop()` schreibt PID und Startticks in `state.json`, **bevor** SIGSTOP geht.
- `cont()` setzt nur denselben Prozess fort.
- `own_trip()`: Quittiert wird nur der eigene Trip.

**`restore_lan.continue_stopped`** ist der einzige SIGCONT-Weg, auch für ExecStopPost, und läuft vor dem Ende der Testinstanz.

**Der Schritt `latch_cases`** ist der letzte des Hauptlaufs: Ausfallabschnitt, frühes Reset, Prüfung des eigenen Trips, dann der Erholungsabschnitt. `latch_order` und `--variant latch-delayed` bilden einen eigenen Lauf; dessen Zeilen tragen die Variante. Die Zeit-Belege jedes Abschnitts liegen neben seinen Samples (`servo-<case>.time.json`: t₀, Phasen, Empfänge).

**Wächter:**
- **Kantenregeln:** dasselbe Sample; ein Takt Verzug in Produktion und in der Variante; ein sofortiger Latch in der Variante; `fault-out` zu früh; keine Flanke; Abschnittsmangel; die Flanke nach langem Wiederanlauf.
- **Sticky:** verfrühte Freigabe, ein angenommener früher Reset, kein Wiederanlauf, kein Frame, ein Frame ohne Trip.
- **Erholung:** bleibt verriegelt, verriegelt erneut, nicht frei, kein Frame, Abschnitt fehlt oder ist unterbrochen.
- **Prozesse:** stop/cont-Identität; die Reihenfolge der Rückgabe (rot ohne den Aufruf).
- **Ganzer Schritt:** gegen ein gescriptetes Gateway. Eine andere Instanz oder ein vorher wartender Trip wird nie quittiert. Die Variantenzeilen; das frühe Reset; die verschobene Reihenfolge.

### Block 3 · Ein Client geht (`40d9a754`, `e4104b1b`)

**Der Hilfsclient.** `proto_client.py` läuft als eigener Prozess; das Token steht in seiner Umgebung, nie in argv. Sein `hello` trägt `resume_armed` und eine frische Sitzung; selbst armt er nie. `_bind_helper` bindet ihn an seine Client-ID: Die `hello`-Antwort ist ungearmt, und im Trace des Laufs steht **genau ein** `session.resume_denied_no_match` dieser Sitzung.

**Der Schritt `disconnect_cases`** läuft vor `clients` und dem Latch:
- A (close) bzw. A2 (heartbeat) armt, lädt und startet X hin und zurück bei F6000.
- **close:** A trennt die Verbindung, ohne Abort und ohne Disarm.
- **heartbeat:** A2 wird angehalten (`trip.stop`).
- Das Ereignis des Gateways **für genau diese ID** wird aus dem Trace gelesen; **dann** setzt der Lauf W. B bricht auf jedem Weg ab, danach wird A2 fortgesetzt.
- `Helper.when_free` fragt nur bei der Startclaim-Ablehnung erneut, wie `_when_free`.

**Auswerter `eval_disconnect`:**
- kein Ereignis → `incomplete`;
- ein Trip → FAIL;
- danach gelten W, der Zeitnachweis und eine untere Dauer ≥ 2 s;
- ein IDLE-Frame von B → FAIL;
- ein bewiesener Stopp (Zeile 0, danach keine Bewegung) → FAIL;
- weniger als 10 mm X in bewiesenen 2 s → FAIL.

**Wächter:**
- **Tabelle:** sauber, Umkehr, Abort beim Timeout, später Abort, Kriechen, Trip, B IDLE, kein Ereignis, kein Frame von B, Fenster < 2 s, Abschnittsmangel.
- **Ganzer Schritt:** Trennung bzw. Stopp vor W, Fortsetzen nach dem Abort von B. Kein Ereignis dieses Clients ergibt `incomplete`, B bricht trotzdem ab. Eine doppelt gebundene Sitzung startet nichts.
- Die erneute Anfrage beim Startclaim.

### Block 4 · Viele Clients (`42786f0f`)

**Der Schritt `clients_cases`:**
- Für N = 4, dann 8, verbinden sich N ungearmte Clients (`start(arm=False)`; ihre `hello`-Antworten ohne `conn_key`).
- Es gibt **einen** Abschnitt mit eigenen Marken: vorher (≥ 1 s); das Fenster vom Laden über die Veröffentlichung und die N gleichzeitigen `GET /preview` hinter einer Barriere bis +5 s; nachher (≥ 1 s).
- Das große Programm ist der Zufallsweg der Perf-Matrix (Seed 42, 40 MB) **ohne** dessen `T13 M600`: Werkzeug 13 steht nicht in der Tabelle der Kopie, und die Last ist das Parsen.

**Auswerter `eval_clients`:**
- ein Trip → FAIL;
- nicht N ungearmte Verbindungen, nicht N Abrufe derselben Vorschau oder nicht veröffentlicht → `incomplete`;
- jeder Flankenabstand von `oneshot.0.in`, der das Fenster berührt, wird dreistufig beurteilt;
- verlangt sind eine Flanke vor und eine nach dem Fenster sowie vorher und nachher ≥ 1 s.

**Wächter:** 100 ms PASS, 260 ms FAIL, der Verzug ergibt `incomplete`, flankenloser Rand → FAIL, keine Flanke davor, Trip, drei Verbindungen, ein fehlgeschlagener Abruf, ein zu kurzer Vorabschnitt. Dazu der ganze Schritt mit seiner Reihenfolge.

### Live gefunden und behoben

1. **Ein liegengebliebenes Stream-Segment** (`be83d462`). Jeder bisherige native Lauf beendete seine Testinstanz, ohne den Sampler zu entladen. Zurück blieb das Segment von `sampler.0` (Schlüssel `0x48534130`, 5 243 008 Bytes, `nattch` 0).
   - Der nächste `loadrt` hängte es an, solange die Größe passte.
   - Mit dem breiteren Strom von Stufe 3 schlug `shmget` fehl; `rtapi_app` ging mit der Instanz unter (Lauf `20261106T023611`). Die Rückgabe war vollständig, das LAN blieb unberührt.
   - **Jetzt:** Ein Segment ohne Anhang wird vor dem Laden entfernt und im Bericht genannt. Ein angehängtes Segment ist ein anderer Sampler: abgelehnt. Am Laufende wird der Sampler entladen. Nach jedem späteren Lauf blieb kein Segment übrig.
2. **`safety_trip_ack` antwortet ohne `cmd`** (`c5f4e07a`). Der Client wartete 30 s.
3. **Ein Schreiben direkt nach einem Abort** trifft auf den Startclaim (`e4104b1b`).

### Die Läufe

| Lauf | Stand | Variante | Urteil |
|---|---|---|---|
| `20261106T024127-latch-delayed` | `c5f4e07a` | latch-delayed | **PASS**: delayed-order (genau ein Takt spät, Sample 504), sticky, recovered |
| `20261106T025844` | `e4104b1b` | — | **PASS**: 45 PASS, 4 informative Jog-Zeilen |
| `20261106T030736` | **`33630f93`** | — | **PASS**: 44 PASS, 5 informative Jog-Zeilen; disconnect-close ≥ 3,01 s/260 mm, disconnect-heartbeat ≥ 3,01 s/301 mm, clients-4 ≤ 74,0 ms, clients-8 ≤ 57,0 ms, latch ×3 PASS |
| `20261106T031618-latch-delayed` | **`33630f93`** | latch-delayed | **PASS**: delayed-order (Sample 531), sticky, recovered |

Die beiden Schlussläufe stehen am Stand dieser Anfrage. Die Rückgabe ist jedes Mal `complete`, die Isolation leer, und im ExecStopPost-Nachweis ebenso. Nach keinem Lauf blieb ein Sampler-Segment übrig. Im Beleg liegen außerdem die zwei frühen Variantenläufe, `023611` mit dem Segmentfund und `023951` mit der Quittierungsantwort.

Im Lauf `25844`:
- **disconnect:** `close` ≥ 3,00 s nach dem Ereignis, 259 mm X; `heartbeat` ≥ 3,01 s, 301 mm X.
- **clients:** 4 Clients mit dem längsten Abstand ≤ 69,0 ms, 8 Clients ≤ 50,0 ms.
- **latch:** `latch-same-cycle` PASS (Sample 468766), sticky und recovered PASS.

Die Flanken des Herzschlags kommen deutlich öfter als die 100 ms, mit denen ich gerechnet hatte.

Belege: [`function-inventory.r317.evidence.json`](function-inventory.r317.evidence.json): die Zeilen der Läufe, Rückgaben, `latch_order`, das entfernte Segment. Die Servo- und Zeitdateien liegen unter `~/claude-work/live-tier/<lauf>/`. Ohne Token geprüft.

### Inventar und Doku (`33630f93`)

Die Fall-IDs stehen wörtlich im Code (R292).
- `F-ESTOP.S4` erhält `latch-sticky` und `latch-recovered`.
- `F-ESTOP.S4b` (`3axis_xyz`) verliert seine Lücke: `latch-same-cycle`, Gegenbeleg `latch-same-cycle.delayed-order` (Variante).
- `SYS-CONN.S1`: ≤ 250 ms aus den Servoperioden, 4 und 8 Clients.
- `SYS-CONN.S4`: eingeengt wie in R283; das AUTO-Programm läuft weiter, der zweite Client bleibt.

Beide sind an ihre Zeilen gebunden, die Lücken sind weg. `docs/decisions.md` und `docs/testing.md` beschreiben Stufe 3.

**Prüfungen:** Rundengate **PASS** auf `33630f93` (Basis `6f90c072`, nichts uncommitted): Backend 1800 (+3536 Subtests), native Stufe 432, Vitest 2627, Lint, Build, Auswahlwächter. Kein Browser-Spec ist ausgewählt, weil nur Skripte, Inventar und Doku geändert sind.

**Erbeten:** `agreement` oder `findings`.
