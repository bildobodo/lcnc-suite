// Dedicated Worker: owns the 1s heartbeat interval.
// Worker timers are not subject to the background-tab throttling rules that
// apply to setInterval on the main thread (Firefox/Chrome 2026), so the
// gateway's 3s heartbeat timeout stays semantically honest across long idle.

let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as { cmd: "start" | "stop" };
  if (msg.cmd === "start") {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      (self as unknown as Worker).postMessage({ tick: performance.now() });
    }, 1000);
  } else if (msg.cmd === "stop") {
    if (timer) { clearInterval(timer); timer = null; }
  }
};
