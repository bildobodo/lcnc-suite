/**
 * The jog lease, the page's side (P1b, machine day 2026-11-21; plan agreed
 * with Codex R423–R426; the gateway's side is lcnc-gateway/jog_lease.py).
 *
 * A continuous jog used to end only by its stop, which the page's MAIN
 * thread sends at the release. A page that hangs (0.5–1.6 s measured on the
 * operator's panel) left the axis moving for as long as it hung; the
 * connection's heartbeat comes from the worker and kept beating through it.
 * Now every continuous jog the WebUI starts names the input GESTURE's lease:
 *
 * - a lease belongs to one gesture — a pointer on a jog button, a held key,
 *   a stick or a D-pad direction from leaving rest to returning — never to
 *   one command: speed changes and reversals inside it keep its id;
 * - this module renews every live lease from the main thread, one
 *   `jog_renew` every RENEW_MS (setInterval here — never the worker): a page
 *   that hangs stops renewing, the gateway stops the jog 500 ms after the
 *   last renewal it read;
 * - a lease ends three ways: its source ends the gesture (`jog_lease_end`:
 *   the release, the stick at rest, an explicit stop), it expires (the
 *   gateway says so — `jog_lease_expired` names the id), or the connection
 *   goes. A dead lease is never revived: its gesture is SPENT until its
 *   source's own end (pointerup / keyup / rest), and a new press begins a
 *   new lease with a new id;
 * - a start or change refused (`ok: false`) or not answered within
 *   REPLY_MS ends its gesture too (`jog_lease_end` — a stop, whatever the
 *   gate).
 *
 * The ids only grow in a page's life (the gateway treats an id at or below
 * the highest it saw on the connection as dead). Each source passes its own
 * sender for the end — the gamepad's marks itself `via: "gamepad"`.
 */
import { watch } from "vue";
import { awaitReply, connected, send, setJogLeaseFrameHandler } from "./lcncWs";
import { OPERATOR_ERROR } from "./lcnc";
import { pushMessage } from "./ws/statusStore";
import { emitTelemetry } from "./ws/telemetry";

/** The renewal period (jog_lease.py JOG_RENEW_EXPECTED_S — a test holds them
 *  together): five renewals fit the 500 ms validity. */
export const RENEW_MS = 100;
/** How long a start or change may go unanswered before its gesture ends
 *  (a command queued behind a slow one keeps its lease alive meanwhile). */
export const REPLY_MS = 3000;
/** One renewal names at most this many leases (jog_lease.py RENEW_IDS_MAX). */
export const RENEW_IDS_MAX = 16;

/** The operator's words for an ended gesture. */
export const LEASE_EXPIRED_TEXT = "Jog stopped — page delayed, press again";
export const LEASE_CONNECTION_TEXT = "Connection lost — press again";
export const LEASE_STOP_FAILED_TEXT = "Jog stop failed — press E-Stop if it still moves";

/** Why a lease ended without its source's own end. */
export type LeaseEnd = "expired" | "refused" | "stopped" | "connection";
export type LeaseEndCommand = { cmd: "jog_lease_end"; lease: number };
export type LeaseEndSender = (cmd: LeaseEndCommand) => void;
/** Told when the lease ends from outside its source (expired, refused, an
 *  explicit stop of every lease, the connection): the source marks its
 *  gesture spent until its own end. `text` says why, for the control. */
export type LeaseEndHandler = (why: LeaseEnd, text: string) => void;

interface LiveLease { id: number; sendEnd: LeaseEndSender; onEnd: LeaseEndHandler }

let lastId = 0;
const live = new Map<number, LiveLease>();
let timer: ReturnType<typeof setInterval> | null = null;

/** Begin a gesture's lease: its id for the jog commands. */
export function beginLease(sendEnd: LeaseEndSender, onEnd: LeaseEndHandler): number {
  const id = ++lastId;
  live.set(id, { id, sendEnd, onEnd });
  if (timer === null) timer = setInterval(renewTick, RENEW_MS);
  return id;
}

export function isLeaseLive(id: number): boolean {
  return live.has(id);
}

/** The leases alive now (tests, the debug view). */
export function liveLeaseIds(): number[] {
  return [...live.keys()];
}

/** The source ended its gesture (release, rest): stop renewing and tell the
 *  gateway — the axes the lease still owns stop. No callback: the source
 *  knows. A lease already ended is a no-op. */
export function endLease(id: number): void {
  const l = live.get(id);
  if (!l) return;
  live.delete(id);
  l.sendEnd({ cmd: "jog_lease_end", lease: id });
  idleCheck();
}

/** An explicit stop of every gesture (the pad's Stop, focus loss, a hidden
 *  tab, E-Stop): each lease ends — `wire` false when the gateway already
 *  ended them (its E-Stop / abort receipt) — and each source hears it, so a
 *  gesture still held is spent until its own end. */
export function endAllLeases(opts: { wire: boolean } = { wire: true }): void {
  for (const l of [...live.values()]) {
    live.delete(l.id);
    if (opts.wire) l.sendEnd({ cmd: "jog_lease_end", lease: l.id });
    l.onEnd("stopped", "");
  }
  idleCheck();
}

/** Watch a start's or change's reply: refused or unanswered within
 *  REPLY_MS, the gesture ends (with the reply's reason). `reqId` null =
 *  nothing went out: it ends at once; undefined = a sender that does not
 *  say (a test's): nothing to watch. */
export function watchLeaseReply(id: number, reqId: string | null | undefined | void): void {
  if (reqId === undefined) return;
  if (reqId === null) {
    endFromOutside(id, "refused", LEASE_CONNECTION_TEXT, true);
    return;
  }
  void awaitReply(reqId, REPLY_MS).then((reply: { ok?: boolean; error?: unknown; expired?: boolean;
    stop_failed?: unknown } | null) => {
    if (reply && reply.ok !== false) return;
    // a failed stop comes FIRST (Codex R428 MT-I11): the axis may still
    // move — said in the message center too, never as a page delay
    const stopFailed = !!reply && Array.isArray(reply.stop_failed) && reply.stop_failed.length > 0;
    if (stopFailed) {
      const said = typeof reply.error === "string" ? reply.error : LEASE_STOP_FAILED_TEXT;
      pushMessage(OPERATOR_ERROR, said);
      endFromOutside(id, "refused", said, true);
      return;
    }
    const text = reply === null ? "No answer — release and press again"
      : reply.expired ? LEASE_EXPIRED_TEXT
      : typeof reply.error === "string" ? reply.error : "Jog refused";
    endFromOutside(id, reply?.expired ? "expired" : "refused", text, true);
  });
}

function endFromOutside(id: number, why: LeaseEnd, text: string, wire: boolean): void {
  const l = live.get(id);
  if (!l) return;
  live.delete(id);
  if (wire) l.sendEnd({ cmd: "jog_lease_end", lease: id });
  emitTelemetry("jog.lease_ended", { why, lease: id });
  l.onEnd(why, text);
  idleCheck();
}

function renewTick(): void {
  if (live.size === 0) { idleCheck(); return; }
  if (!connected.value) { connectionGone(); return; }
  send({ cmd: "jog_renew", ids: [...live.keys()].slice(0, RENEW_IDS_MAX) });
}

function idleCheck(): void {
  if (live.size === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** The connection went: nothing can stop or renew through it — every
 *  gesture ends (the gateway ended the leases with the connection). */
function connectionGone(): void {
  for (const id of [...live.keys()]) endFromOutside(id, "connection", LEASE_CONNECTION_TEXT, false);
}

/** The gateway's `jog_lease_expired` (lcncWs routes it here). A failed stop
 *  is said whatever the gesture's state — the axis may still move. With a
 *  `reason` a STOP ended the lease (abort, E-Stop, a disarm): the gesture
 *  ends without the page-delay words — the operator or the safety path
 *  stopped it, the page did not hang. */
export function onLeaseExpiredFrame(msg: { id?: unknown; axes?: unknown; stop_failed?: unknown; error?: unknown;
  late_renewal?: unknown; reason?: unknown }): void {
  if (Array.isArray(msg.stop_failed) && msg.stop_failed.length > 0) {
    pushMessage(OPERATOR_ERROR, typeof msg.error === "string" ? msg.error : LEASE_STOP_FAILED_TEXT);
  }
  if (typeof msg.id !== "number") return;
  if (typeof msg.reason === "string") endFromOutside(msg.id, "stopped", "", false);
  else endFromOutside(msg.id, "expired", LEASE_EXPIRED_TEXT, false);
}

setJogLeaseFrameHandler(onLeaseExpiredFrame);
watch(connected, (on) => { if (!on) connectionGone(); });

/** Test seam: forget every lease and the timer (the ids keep growing). */
export function _resetJogLeasesForTest(): void {
  live.clear();
  if (timer !== null) clearInterval(timer);
  timer = null;
}
