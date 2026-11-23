## Claude · Härtung `jog-lease.spec.ts:61` v2 · nach R439 · 23. November 2026

### Anlass

Im ersten Merge-Gate-Lauf von P2a (f52930df) ist der Test „a held jog button names its lease, the page renews it, its release ends exactly that lease“ einmal gescheitert: Erneuerungslücken von **443**, 53, 104 und 88 ms gegen die Grenze < 400; alle anderen Tests waren grün (1022/1023). Im zweiten Lauf bestand er. In den Merge-Gates von P1b, P3 und P4 kam der Fehler nicht vor.

Gemessen wird die **Ankunft am Mock**. Die Strecke dorthin führt über den Hauptthread der Seite, `postMessage` an den WS-Worker, den Socket und die Event-Loop des Mocks; drei Worker-Paare teilen sich dabei die CPU.

### Was der Test beweisen soll

1. Die Seite erneuert jede laufende Lease von ihrem Hauptthread aus, **eine Erneuerung je 100 ms**, und jede nennt die Kennung der Lease.
2. Das Loslassen beendet genau diese Lease.
3. Eine beendete Lease wird danach nicht mehr erneuert.

Dass die Erneuerung vom Hauptthread und nicht vom Worker kommt, beweist bereits der Nachbartest in Echtzeit, unverändert: Hauptthread 2,2 s blockiert → keine Erneuerung im Block, der Worker-Heartbeat läuft, danach geht die Erneuerung weiter. Die native Sonde (`scripts/test_support/lease_page_probe.mjs`) prüft die Frist gegen das echte Gateway, ebenfalls unverändert.

### Vertrag: der Takt auf der Uhr der Seite, die Uhr steht schon vor der Geste

**MT439-03 · ein eigener 100-ms-Takt:**
- Der Test legt den vereinbarten Takt **selbst** fest (`const AGREED_RENEW_MS = 100`) und importiert **nicht** `RENEW_MS` aus dem Produkt.
- Die Kopplung des Produktwerts an die Erwartung des Gateways prüft weiterhin der Unit-Test (`jogLease.test.ts:66`, `RENEW_MS === 100`, gegen `JOG_RENEW_EXPECTED_S` des Gateways). Der Browserwächter wird zusätzlich selbst rot, wenn der Produkttakt abweicht.

**MT439-04 · Reihenfolge ohne Echtzeit als Beleg:**
1. `installHoldClock(page)` vor dem Laden (`e2e/holdClock.ts:13`).
2. **Die Uhr anhalten, bevor die Geste beginnt:** `pauseAt(Date.now() + 1000)`. Vor der Geste gibt es keine Lease; ohne laufende Lease erzeugt die vorgerückte Sekunde keine Erneuerung.
3. Druck auf X+ **unter stehender Uhr**. Der Start `jog_cont` geht ereignisgetrieben hinaus. Bestätigt wird der **Empfang** am Mock (`lastCmds` enthält `jog_cont` mit Lease L). Der Mock hat zu diesem Zeitpunkt **0 Erneuerungen** (`clearRenewals` vor der Geste). Ohne Vorrücken der Seitenuhr erzeugt das Produkt keine Erneuerung: Der erste `renewTick` liegt eine Periode nach `beginLease`.
4. **Nachweis, dass Echtzeit verging und der Auslöser einer Worker- bzw. Echtzeit-Mutante empfangen wurde:** Der Test wartet ereignisgetrieben, bis der Mock **zwei Heartbeats des Workers** mit Zeitstempel nach dem Empfang des Starts gezählt hat (`beats`, `mock-gateway.mjs:410`). Danach muss die Zahl der Erneuerungen noch **0** sein. Eine Erneuerung aus dem Worker oder an dessen Heartbeat gekoppelt käme spätestens mit diesen Heartbeats über denselben Socket an. Eine bloße Verzögerung kann deshalb kein Grün liefern.
5. **Exakte Schritte, Erzeugung und Empfang je Schritt geordnet:** Für k = 1…5 läuft `page.clock.runFor(AGREED_RENEW_MS)`; das erzeugt genau einen Tick. Danach wartet `expect.poll` auf **Empfang** am Mock: Zahl = k, und die Erneuerung nennt L. Da nur `runFor` Erneuerungen erzeugt, ist nach dem Empfang der k-ten nichts mehr unterwegs.
6. **Genau 5, nicht mehr:** Nach Schritt 5 wartet der Test auf einen weiteren empfangenen Heartbeat, ereignisgetrieben. Danach ist die Zahl genau 5.
7. **Loslassen:** `mouse.up` → Empfang von `jog_lease_end` L. Dann `runFor(4 × AGREED_RENEW_MS)`.
8. **Nachweis, dass die Strecke geleert ist**, durch eine geordnete Markierung statt Echtzeit:
   - Ein neuer kurzer Druck auf X− erzeugt `jog_cont` mit Lease L2.
   - Sein Empfang am Mock beweist, dass alles früher Erzeugte angekommen ist. Hauptthread → Worker (ein MessagePort) und Worker → Socket sind jeweils FIFO.
   - Erst dann wird geprüft: **keine Erneuerung, die L nennt**, nach `jog_lease_end` L.
   - Danach L2 loslassen und dessen Ende empfangen.

**Änderung (`lcnc-webui/e2e/jog-lease.spec.ts`, Test ab Zeile 61; Skizze, Bau nach Freigabe):**

```ts
import { installHoldClock } from "./holdClock";
const AGREED_RENEW_MS = 100;   // the agreed cadence, fixed HERE (not the product's RENEW_MS — Codex R439 MT439-03)

test("a held jog button names its lease, the page renews it, its release ends exactly that lease", async ({ page }) => {
  await installHoldClock(page);
  await open(page);                                    // clears commands and renewals
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);               // the clock stands BEFORE the gesture (MT439-04)
  try {
    await hold(page, "X+");
    const start = await startOf();                     // the start's RECEIPT at the mock
    expect(start).toMatchObject({ cmd: "jog_cont", axis: 0, lease: expect.any(Number) });
    const L = start.lease!;
    const t0 = (await timeline()).now;
    expect((await timeline()).renewals.length, "no renewal before the page's clock moves").toBe(0);
    // real time passed for the worker: two of its heartbeats RECEIVED after the start
    await expect.poll(async () => (await timeline()).beats.filter((b) => b > t0).length).toBeGreaterThanOrEqual(2);
    expect((await timeline()).renewals.length, "no renewal while the page's clock stands").toBe(0);
    for (let k = 1; k <= 5; k++) {
      await page.clock.runFor(AGREED_RENEW_MS);
      await expect.poll(async () => (await timeline()).renewals.length, `renewal ${k} received`).toBe(k);
      expect((await timeline()).renewals[k - 1]!.ids, `renewal ${k} names the lease`).toContain(L);
    }
    const t5 = (await timeline()).now;
    await expect.poll(async () => (await timeline()).beats.filter((b) => b > t5).length).toBeGreaterThanOrEqual(1);
    expect((await timeline()).renewals.length, "exactly one renewal per 100 ms of page time").toBe(5);
    await page.mouse.up();
    await expect.poll(async () => (await sent()).map((c) => [c.cmd, c.axis ?? c.lease]))
      .toEqual([["jog_cont", 0], ["jog_lease_end", L]]);
    await page.clock.runFor(4 * AGREED_RENEW_MS);
    // the ordered marker: a new start through the same main-thread → worker → socket path
    await hold(page, "X-");
    await expect.poll(async () => (await sent()).filter((c) => c.cmd === "jog_cont").length).toBe(2);
    const endIdx = (await sent()).findIndex((c) => c.cmd === "jog_lease_end" && c.lease === L);
    expect(endIdx).toBeGreaterThan(0);
    expect((await timeline()).renewals.filter((r) => r.ids.includes(L)).length,
      "no renewal of L after its end (the marker's receipt drained the path)").toBe(5);
    await page.mouse.up();
  } finally {
    await page.clock.resume();
  }
});
```

Hinweise zur Skizze:
- **Beim Bau zu prüfen:** ob der Startweg des Jogs selbst auf einen Timer der Seite wartet. Heute geht er ereignisgetrieben über `pointerdown`, und `fire()` begrenzt die Sendehäufigkeit über Zeitstempel. Wartet er doch auf einen Timer, braucht es einen benannten `runFor(0)` bzw. den kleinsten nötigen Schritt, und der Test nennt ihn; er wird nicht durch Echtzeit ersetzt.
- „keine Erneuerung von L nach dessen Ende“ ist als Gesamtzahl der L-Erneuerungen = 5 formuliert. Die Erneuerungen 1–5 sind vor dem Loslassen empfangen und bestätigt.
- Die Mock-Zeiten (`timeline().now`, `beats`) stammen aus derselben Uhr des Mocks; daher ist `beats > t0` ein Ereignisvergleich, keine Wartezeit.
- Der Mock lässt keine Lease von selbst ablaufen, nur auf `leaseExpired` (`mock-gateway.mjs:629`).
- `REPLY_MS` (3 s) wird nicht erreicht: Die Seitenzeit läuft 1 s (`pauseAt`) plus 900 ms.

### Wächter und Rot-Nachweise

**Mutationen.** Jede muss den Browserwächter rot machen, sofern sie nicht als äquivalent benannt ist:
1. **`RENEW_MS = 200` in `jogLease.ts`** → Schritt 1 empfängt keine Erneuerung (Zählung `[0,1,1,2,2]`): rot. Das war in v1 grün, weil der Test den Produktwert importierte.
2. **Erneuerung ohne Kennung** (`ids: []`) → „renewal k names the lease“.
3. **Kein `jog_lease_end` beim Loslassen** → die Befehlsfolge stimmt nicht.
4. **Eine beendete Lease wird weiter erneuert** (MT439-03): `endLease` sendet `jog_lease_end`, löscht die Lease aber nicht aus `live` (`jogLease.ts:89–95`, ohne `live.delete(id)`) → `renewTick` nennt L weiter → nach der Markierung mehr als 5 Erneuerungen von L: rot.
   - **Äquivalent, nicht rot verlangt:** Nur `clearInterval` zu entfernen (`idleCheck`, `:156–158`) sendet ohne lebende Lease nichts. Das hat Codex' Sonde gezeigt: 0 weitere Erneuerungen. Die Timer-Freigabe prüft, falls gewünscht, der Unit-Test (`jogLease.test.ts`) gesondert.
5. **Takt aus Echtzeit bzw. aus dem Worker:** Die Mutation erneuert zusätzlich bei jedem Heartbeat des Workers (`wsWorker.ts:108`, im Heartbeat-Timer ein `jog_renew` für die zuletzt gemeldeten Leases). Rot wird sie bei „no renewal while the page's clock stands“. Bewiesen ist das an den **zwei empfangenen Heartbeats** als auslösenden Ereignissen, nicht an einer Wartezeit.

**Stabilität:** 30 Läufe (`--repeat-each=30`) unter drei parallelen Workern und gleichzeitiger CPU-Last auf der VM. Die Last erzeugen zwei Node-Busy-Loops; es wird nichts installiert.
- Es werden **alle 30 Ergebnisse** berichtet, ohne Retry und ohne Auswahl.
- Zum Vergleich der alte Test unter derselben Last, ebenfalls alle 30. **0/30 Fehler wäre dort ein ehrlicher Ausgang**; es wird nicht so lange gelaufen, bis ein Rot erscheint.

**Erbeten:** `agreement` oder `findings`.
