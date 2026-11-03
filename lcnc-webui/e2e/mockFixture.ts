// The per-worker mock's lifecycle (Codex R261/R262 PM261-03): each worker
// starts ITS mock on its slot's port, ready only when that child confirms
// the bind (`MOCK-BOUND <port> <instance>`), registered as this run's owner
// of the slot, stopped by closing its stdin (it also leaves when the worker
// dies). A replacement worker waits — bounded — only for its own run's
// predecessor on the slot; a port held by anything else is a failure, and a
// foreign process is never used or stopped.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { portOf } from "./mockSlot.mjs";

export const HANDOFF_MS = 5_000;
const BIND_MS = 20_000;
const STOP_MS = 5_000;
const MOCK_SCRIPT = fileURLToPath(new URL("./mock-gateway.mjs", import.meta.url));
const REGISTRY = join(tmpdir(), "lcnc-e2e-mock");

/** This run: set by the config in the runner, inherited by every worker. */
export const RUN = process.env.LCNC_E2E_RUN ?? `unset-${process.ppid}`;
const EVENTS = process.env.LCNC_E2E_EVENTS;

export interface MockEvent { event: string; [k: string]: unknown }

/** One line per event, appended at once (the harness watches it live). */
export function logEvent(e: MockEvent): void {
  if (!EVENTS) return;
  appendFileSync(EVENTS, JSON.stringify({ t: Date.now(), run: RUN, pid: process.pid, ...e }) + "\n");
}

export interface MockHandle {
  slot: number; port: number; instance: string; workerIndex: number;
  child: ChildProcess;
  /** Why the child ended while it was in use, or null. */
  died(): string | null;
}

interface Owner { run: string; slot: number; port: number; instance: string; pid: number; workerIndex: number }

const registryPath = (slot: number) => join(REGISTRY, `${RUN}-${slot}.json`);

function readOwner(slot: number): Owner | null {
  try {
    return JSON.parse(readFileSync(registryPath(slot), "utf8")) as Owner;
  } catch {
    return null;
  }
}

function writeOwner(o: Owner): void {
  mkdirSync(REGISTRY, { recursive: true });
  const tmp = `${registryPath(o.slot)}.${o.instance}.tmp`;
  writeFileSync(tmp, JSON.stringify(o));
  renameSync(tmp, registryPath(o.slot));          // atomic: never half an entry
}

function dropOwner(slot: number, instance: string): void {
  if (readOwner(slot)?.instance === instance) unlinkSync(registryPath(slot));   // only its own entry
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Does anything accept a connection on the port (IPv4 or IPv6 loopback)? */
export function portBusy(port: number): Promise<boolean> {
  const one = (host: string) => new Promise<boolean>(resolve => {
    const s = createConnection({ host, port });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
  return Promise.all([one("127.0.0.1"), one("::1")]).then(r => r.some(Boolean));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startMock(slot: number, workerIndex: number): Promise<MockHandle> {
  const port = portOf(slot);
  if (await portBusy(port)) {
    const prev = readOwner(slot);
    if (!prev || prev.run !== RUN || !alive(prev.pid)) {
      throw new Error(`port ${port} (slot ${slot}) is held by a process this run did not start — `
        + "a foreign server is never used or stopped");
    }
    // This run's predecessor on the slot: it leaves on its stdin's EOF.
    logEvent({ event: "handoff-wait", slot, port, workerIndex, predecessor: prev.instance, limitMs: HANDOFF_MS });
    const t0 = Date.now();
    while (await portBusy(port)) {
      if (Date.now() - t0 > HANDOFF_MS) {
        logEvent({ event: "handoff-timeout", slot, port, workerIndex, predecessor: prev.instance });
        throw new Error(`handoff timed out: the predecessor ${prev.instance} still holds port ${port} after ${HANDOFF_MS} ms`);
      }
      await sleep(50);
    }
  }
  const instance = randomUUID();
  const child = spawn(process.execPath, [MOCK_SCRIPT], {
    env: { ...process.env, MOCK_PORT: String(port), MOCK_INSTANCE: instance, MOCK_EXIT_ON_STDIN_EOF: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let died: string | null = null, stderr = "";
  child.stderr!.on("data", d => { stderr = (stderr + d).slice(-2000); });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`mock on port ${port} confirmed no bind in ${BIND_MS} ms: ${stderr}`)), BIND_MS);
    child.stdout!.on("data", d => {
      out += d;
      if (out.includes(`MOCK-BOUND ${port} ${instance}`)) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`mock on port ${port} ended before its bind (exit ${code}): ${stderr}`)); });
  });
  child.once("exit", (code, signal) => { died = `exit ${code ?? signal}: ${stderr.slice(-300)}`; });
  child.stdout!.resume();
  writeOwner({ run: RUN, slot, port, instance, pid: child.pid!, workerIndex });
  logEvent({ event: "bound", slot, port, workerIndex, instance, endpoint: `http://localhost:${port}/` });
  return { slot, port, instance, workerIndex, child, died: () => died };
}

export async function stopMock(h: MockHandle): Promise<void> {
  const ended = new Promise<void>(r => (h.child.exitCode !== null || h.child.signalCode !== null) ? r() : h.child.once("exit", () => r()));
  const within = (ms: number) => Promise.race([ended.then(() => true), sleep(ms).then(() => false)]);
  h.child.stdin!.end();
  if (!await within(STOP_MS)) {
    h.child.kill("SIGTERM");
    if (!await within(2_000)) {
      h.child.kill("SIGKILL");
      await ended;
    }
  }
  dropOwner(h.slot, h.instance);
  logEvent({ event: "stopped", slot: h.slot, workerIndex: h.workerIndex, instance: h.instance });
}
