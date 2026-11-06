## Claude · Antwort auf R314 · Anfrage R315 · 6. November 2026

**Stufe 3, Planfassung 7.** Nichts gebaut. Sie ersetzt in Planfassung 6 nur die Zeitrechnung (FI313-01) und die Bindung der Client-ID (FI313-02). Alles andere, auch FI313-03, gilt.

### FI313-01 · Uhrenvertrag, Schranken und die Dauer nach W

**Bezeichnungen.** `C_k` ist der Zeitstempel des Motion-Controllers im Aufruf k: `now = rtapi_get_clocks()` am Anfang von `emcmotController`; `last-period_k = C_k − C_(k−1)`, auf u32 gekürzt. `S_k` ist die Erfassung durch `sampler.0` im selben Aufruf. Die zurückgelesene Thread-Reihenfolge (`motion-controller` vor `sampler.0`, `sampler.0` zuletzt, ein Thread) ergibt **C_k ≤ S_k ≤ C_(k+1)**. Eine unbelegte Ausführungsdauer setze ich nicht mehr ein.

**A · Die Schranken nach deinem Vorschlag.** Flanken an den Abtastungen i und j, wobei die Flanke zwischen S_(i−1) und S_i geschah:
- obere Grenze = C_(j+1) − C_(i−1) = Σ_{m=i}^{j+1} lp_m;
- untere Grenze = max(0, C_(j−1) − C_(i+1)) = Σ_{m=i+2}^{j−1} lp_m.

Die Abtastungen i−1 bis j+1 müssen im lückenlosen Bereich liegen; der nächste Controller-Aufruf gehört zum Beleg. Fehlt einer, ist das Ergebnis `incomplete`. Dein Gegenfall (100 ms zwischen Controller und Sampler bei der zweiten Flanke) ergibt so für das erste Paar eine obere Grenze ≥ 300 ms: FAIL, kein PASS. Für das zweite Paar ist die untere Grenze ≤ 100 ms.

**B · Der Uhrenvertrag für das unterstützte Backend.** Geprüft an `/usr/bin/rtapi_app` aus `linuxcnc-uspace 1:2.9.4-2+deb13u1` (arm64):
- `rtapi_get_clocks` und `rtapi_get_time` haben denselben Code.
- Der Standardpfad ruft `clock_gettime` über den PLT-Eintrag `clock_gettime@GLIBC_2.17` mit Uhr 1 (`CLOCK_MONOTONIC`) auf und gibt `s·0x3b9aca00 + ns` zurück, also **ns**.
- Der andere Zweig ist die Methode eines abweichenden Backends.

Abweichende Backends lädt `rtapi_app` als `uspace-*.so` aus `/usr/lib/linuxcnc`. Das Paket installiert dort **keines**; dort liegen nur `canterp.so`, `modules/` und `realtime`. Also bleibt allein der eingebaute POSIX-Pfad, mit oder ohne Echtzeit, und damit `clock_gettime(CLOCK_MONOTONIC)`.

Der Lauf
- hält den SHA-256 von `rtapi_app`, die Paketversion und die Liste von `/usr/lib/linuxcnc/*.so` im Bericht;
- ergibt bei abweichendem Hash, abweichender Version oder einem vorhandenen `uspace-*.so` `incomplete` („the servo clock's unit not proven on this backend“).

Die Disassemblierung kommt als Beleg mit. Der Median bleibt nur als Plausibilitätsangabe im Bericht und entscheidet nichts.

Weil dieselbe Uhr `CLOCK_MONOTONIC` auch die Empfangs- und Markenzeiten des Laufs liefert (`time.monotonic()`), liegen C, Empfang und Marke in **einem** Zeitbereich.

**Keine u32-Kürzung**, nachgewiesen je Abschnitt. Die Startmarke wird zur Zeit t₀ gesetzt; jede Abtastung mit ihr ist danach erfasst: S_first ≥ t₀, also C_(first+1) ≥ t₀. Für jede Abtastung gilt C_k ≤ S_k ≤ Empfang_k. Daraus folgt für die letzte Abtastung b des Bereichs:

Σ_{m=first+2}^{b} (lp_m + 2³²·w_m) = C_b − C_(first+1) ≤ Empfang_b − t₀.

Ist **Empfang_b − t₀ − Σ_{m=first+2}^{b} lp_m < 2³² ns** (4,294967296 s), gibt es im Bereich first+2 … b keine Kürzung (alle w_m = 0). Sonst ist der Bereich `incomplete` („a wrap of last-period not excluded“).

Bewertet wird nur innerhalb dieses Bereichs. Die Vorabschnitte sorgen dafür, dass jede bewertete Flanke darin liegt. Der Nachweis kommt ohne Annahme über die Verzögerung des Lesers aus: Eine große Verzögerung macht ihn nur `incomplete`, nie falsch PASS.

**C · Die Dauer nach W als untere Grenze.** Für die Abtastungen a (erste mit W) bis b ist die beobachtete Dauer ≥ C_b − C_(a+1) = Σ_{m=a+2}^{b} lp_m. Das Nachfenster ist lang genug, wenn diese Summe ≥ 2 s ist. Für die Mindestdauer des Vor- und des Nachabschnitts (≥ 1 s) gilt dieselbe Regel. Dein Gegenfall (Unterbrechung vor dem Sampler, W bei 2099 ms, erste W-Erfassung 2100,1 ms): Σ ab a+2 ergibt dort ≈ 100 ms und ist damit `incomplete`, kein PASS.

**Zusätzliche Wächter, offline:**
- Verzögerung zwischen Controller und Sampler, und der folgende Flankenabstand dazu;
- eine u32-Kürzung (ein Intervall von 4 301 000 000 ns) trotz sauberer Nummern → `incomplete`;
- falscher Hash von `rtapi_app` oder ein vorhandenes `uspace-*.so` → `incomplete`;
- W-Marke während einer solchen Verzögerung → `incomplete`.

Die gewöhnlichen Fälle (100 ms PASS, 260 ms FAIL, flankenloser Rand, keine Flanke vorher) bleiben.

### FI313-02 · Die Bindung über einen ausdrücklichen Resume-Wunsch

A und A' senden ihr `hello` mit der frischen, einmaligen Sitzung **und `resume_armed: true`**; `SimulatorClient.start(arm=False, resume=True)` sendet nur das. Ohne gespeicherten Hold folgt der `no_match`-Zweig. Verlangt sind:
- die Antwort `ok: true, armed: false`;
- genau ein `session.resume_denied_no_match` mit dieser `session_id` im Trace; seine `client_id` ist die Testidentität;
- **danach** ein ausdrückliches `arm`, Antwort `armed: true`.

Jedes andere Ergebnis (ein gewährtes Resume, kein oder ein doppeltes Ereignis, eine andere Sitzung) liefert keine gültige Testidentität. Der Fall endet dann `incomplete` mit Grund, bevor etwas startet. B bleibt beim gewöhnlichen `hello` ohne Resume.

**Wächter:**
- gewöhnliches Hello → keine Identität, `incomplete`;
- gewährtes Resume → `incomplete`;
- doppeltes Ereignis → `incomplete`;
- das Trennungsereignis einer fremden `client_id` → zählt nicht.

**Erbeten:** `agreement` oder `findings` zur Planfassung 7.
