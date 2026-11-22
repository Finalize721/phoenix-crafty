import { describe, expect, it, vi } from "vitest";
import {
  type CurvePredictionDiagnostics,
  predictChargingCurve,
} from "./chargingCurveModel";
import {
  appendChargingEtaTrace,
  classifyObserved99Arrival,
  createChargingDebugExport,
} from "./chargingDiagnostics";
import type { BatterySample } from "./chargingEta";

const minute = (value: number) => value * 60_000;

const sample = (
  level: number,
  at: number,
  sessionId: string,
  origin: BatterySample["origin"] = "notification"
): BatterySample => ({
  level,
  time: minute(at),
  sessionId,
  origin,
  continuousSincePrevious: true,
  heaterActive: false,
});

describe("Crafty charging diagnostics", () => {
  it("exports the exact saved observation JSON without modifying storage", () => {
    const raw = '[{"level":42,"time":123,"sessionId":"a","custom":"kept"}]';
    const storage = new Map<string, string>([
      ["craftyChargingHistory:crafty", raw],
    ]);
    const setItem = vi.fn((key: string, value: string) =>
      storage.set(key, value)
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem,
    });

    try {
      const exported = createChargingDebugExport(
        "crafty",
        { version: "1.0.4", gitCommit: "abc123" },
        minute(200)
      );
      expect(exported.rawBatteryHistory.rawStorageValue).toBe(raw);
      expect(exported.rawBatteryHistory.observations).toEqual(JSON.parse(raw));
      expect(storage.get("craftyChargingHistory:crafty")).toBe(raw);
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("combines measured per-percent coverage across charging sessions", () => {
    const history = [
      sample(0, 0, "session-a"),
      sample(10, 10, "session-a"),
      sample(20, 20, "session-a"),
      sample(10, 30, "session-b"),
      sample(20, 40, "session-b"),
      sample(30, 50, "session-b"),
      sample(25, 55, "current", "snapshot"),
    ];
    const storage = new Map<string, string>([
      ["craftyChargingHistory:crafty", JSON.stringify(history)],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
    });

    try {
      const exported = createChargingDebugExport(
        "crafty",
        { version: "1.0.4", gitCommit: "abc123" },
        minute(55)
      );
      const rows = exported.coverage.intervals;
      expect(exported.coverage.totalHistorical).toMatchObject({
        coveredPercentPoints: 30,
        possiblePercentPoints: 99,
      });
      expect(rows[0]).toMatchObject({
        acceptedObservationCount: 1,
        coverage: "measured",
      });
      expect(rows[10]).toMatchObject({
        acceptedObservationCount: 2,
        coverage: "measured",
      });
      expect(rows[20]).toMatchObject({
        acceptedObservationCount: 1,
        coverage: "measured",
      });
      expect(rows[30].coverage).toBe("missing");
      expect(exported.coverage.remainingRange).toMatchObject({
        coveredPercentPoints: 5,
        possiblePercentPoints: 74,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not interpret a 99% snapshot after interruption as an exact arrival", () => {
    expect(
      classifyObserved99Arrival(
        {
          ...sample(99, 10, "new", "snapshot"),
          breakBefore: true,
          continuousSincePrevious: false,
        },
        sample(98, 9, "old")
      )
    ).toMatchObject({
      kind: "snapshot_after_interruption",
      exactArrivalTime: false,
    });
  });

  it("records exact 99% arrivals only from verified change notifications", () => {
    expect(
      classifyObserved99Arrival(
        sample(99, 10, "session"),
        sample(98, 9, "session")
      )
    ).toMatchObject({
      kind: "verified_change_notification",
      exactArrivalTime: true,
    });
    expect(
      classifyObserved99Arrival(
        sample(99, 10, "session", "snapshot"),
        sample(98, 9, "session")
      )?.exactArrivalTime
    ).toBe(false);
  });

  it("persists recalculation traces independently from battery history", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const entry = {
        kind: "eta_recalculation" as const,
        recordedAt: minute(12),
        input: {
          deviceId: "crafty",
          currentLevel: 80,
          sessionId: "session",
          calculationTime: minute(12),
          historySampleCount: 1,
          historyFingerprint: "fnv1a-test",
        },
        previousEta: null,
        updatedEta: null,
        calculation: {
          input: {
            currentLevel: 80,
            currentSessionId: "session",
            calculationTime: minute(12),
            historySampleCount: 1,
            activeSessionSampleCount: 1,
          },
          fallbackReason: "no_history",
          baseline: undefined,
          liveAdjustment: { factor: 1, applied: false },
          selectedIntervals: [],
          coverageCandidates: {},
        },
      };
      appendChargingEtaTrace("crafty", entry);
      expect(
        JSON.parse(storage.get("craftyChargingDebugTrace:crafty") || "[]")
      ).toEqual([entry]);
      expect(storage.has("craftyChargingHistory:crafty")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps estimator results identical when diagnostics are enabled", () => {
    const history = [
      sample(70, 0, "history"),
      sample(80, 10, "history"),
      sample(90, 20, "history"),
      sample(95, 28, "history"),
      sample(99, 36, "history"),
      sample(80, 100, "current", "snapshot"),
    ];
    const input = {
      currentLevel: 80,
      currentSessionId: "current",
      calculationTime: minute(100),
      historySampleCount: history.length,
      activeSessionSampleCount: 0,
    };
    const diagnostics: CurvePredictionDiagnostics = {
      input,
      fallbackReason: null,
      baseline: undefined,
      liveAdjustment: { factor: 1, applied: false },
      selectedIntervals: [],
      coverageCandidates: {},
    };

    expect(
      predictChargingCurve(history, 80, "current", minute(100), diagnostics)
    ).toEqual(predictChargingCurve(history, 80, "current", minute(100)));
    expect(diagnostics.selectedIntervals).toHaveLength(1);
  });
});
