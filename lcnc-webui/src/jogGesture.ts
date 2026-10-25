/**
 * A started jog and the stop it owns (button gates BG-06, Codex R202).
 *
 * A jog STARTS with a mode (continuous or one step) and a target (the axis or
 * axes it moves). Its END must stop exactly that — never what the step
 * selector, the key map or the pad's Z modifier say at the moment of release.
 * Every jog surface re-read those at the release: a continuous jog whose step
 * was changed mid-hold sent no jog_stop (keyboard, pointer, D-pad), and a
 * D-pad Z jog whose Z modifier was let go first stopped Y and left Z moving.
 * The release now reads the gesture recorded at the press.
 */
import type { WsCommand } from "./lcnc";

export interface JogGesture {
  /** The wire axis indices the gesture moves. */
  readonly axes: readonly number[];
  /** Continuous: its end must stop it. A step ends by itself. */
  readonly cont: boolean;
}

export type JogStopCommand = Extract<WsCommand, { cmd: "jog_stop" } | { cmd: "jog_stop_multi" }>;

/** The stop a gesture's end sends; null for a step (it stops by itself). */
export function stopFor(g: JogGesture): JogStopCommand | null {
  if (!g.cont || g.axes.length === 0) return null;
  if (g.axes.length === 1) return { cmd: "jog_stop", axis: g.axes[0]! };
  return { cmd: "jog_stop_multi", axes: [...g.axes] };
}

/**
 * The gestures in progress, keyed by what started them (a key action, a pad
 * button). `store` may be a reactive Map when a view reads `size`.
 */
export class JogGestures<K> {
  private readonly store: Map<K, JogGesture>;

  constructor(store: Map<K, JogGesture> = new Map()) {
    this.store = store;
  }

  start(key: K, g: JogGesture): void {
    this.store.set(key, g);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  get size(): number {
    return this.store.size;
  }

  /** End one gesture: the stop it owns, or null (a step, or none started). */
  end(key: K): JogStopCommand | null {
    const g = this.store.get(key);
    if (!g) return null;
    this.store.delete(key);
    return stopFor(g);
  }

  /** End every gesture: the stops they own. */
  endAll(): JogStopCommand[] {
    const out: JogStopCommand[] = [];
    for (const g of this.store.values()) {
      const c = stopFor(g);
      if (c) out.push(c);
    }
    this.store.clear();
    return out;
  }
}
