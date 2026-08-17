// Export-surface snapshot for lcncWs.ts (frontend split program, A0.2).
//
// The A1 split turns lcncWs.ts into an orchestrator with barrel re-exports so
// its ~18 consumer files never change. This test pins the surface: the EXACT
// set of value-export names, which are refs vs functions, and (at compile
// time, via vue-tsc -b — tsconfig.app includes src tests) the 12 type
// exports. Any export that goes missing or appears unplanned during the
// split fails here, not in a consumer at runtime.
import "./testGlobals";
import { describe, it, expect } from "vitest";
import { isRef } from "vue";
import * as lcncWs from "./lcncWs";
import type {
  LcncMessage, WsStatus, TimingComponentStats, TimingStats,
  HalPin, HalSignalPin, HalSignal, HalParam,
  ViewerPart, KinematicsList, ViewerInit, ViewerGcode,
} from "./lcncWs";

// Compile-time guard for the 12 type exports — `npm run build` fails if any
// is renamed or dropped. Exported so noUnusedLocals doesn't flag it.
export type TypeExportSurface = {
  msg: LcncMessage; status: WsStatus;
  tcs: TimingComponentStats; ts: TimingStats;
  pin: HalPin; sigPin: HalSignalPin; sig: HalSignal; param: HalParam;
  part: ViewerPart; kin: KinematicsList; init: ViewerInit; gcode: ViewerGcode;
};

const REF_EXPORTS = [
  "armed", "configWarning", "connected", "gcodeContent",
  "halInitialized", "halParams", "halPins", "halSignals",
  "lastReply", "latency", "lcncError", "messages", "networkLatency",
  "previewLoadError", "previewParseError", "readerStale", "safetyChainIncomplete",
  "safetyTrip", "serverShuttingDown",
  "status", "timingStats", "toolTableVersion", "unreadCount",
  "viewerGcode", "viewerInit",
] as const;

const FN_EXPORTS = [
  "acknowledgeSafetyTrip", "clearAllMessages", "connectWs", "dismissMessage",
  "emitTelemetry", "getTimingCsv", "markMessagesRead", "pushMessage", "resetTimingStats",
  "saveSettings", "send",
] as const;

const VALUE_EXPORTS = [...REF_EXPORTS, ...FN_EXPORTS].sort();

describe("lcncWs export surface", () => {
  it("value-export name set matches the snapshot exactly", () => {
    expect(Object.keys(lcncWs).sort()).toEqual(VALUE_EXPORTS);
  });

  it("every ref export is a Vue ref/computed", () => {
    for (const name of REF_EXPORTS) {
      expect(isRef((lcncWs as Record<string, unknown>)[name]), name).toBe(true);
    }
  });

  it("every function export is a function", () => {
    for (const name of FN_EXPORTS) {
      expect(typeof (lcncWs as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});
