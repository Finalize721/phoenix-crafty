import { describe, expect, it, vi } from "vitest";
import {
  type CurvePredictionDiagnostics,
  predictChargingCurve,
} from "./chargingCurveModel";
import {
  appendChargingEtaTrace,
  classifyObserved99Arrival,
  createChargingDebugExport,
  type EtaTraceSnapshot,
  fingerprintBatterySamples,
} from "./chargingDiagnostics";
import { type BatterySample, diagnoseChargingEta } from "./chargingEta";

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
      expect(exported.observations.classificationCounts.interpolated).toBe(36);
      expect(
        exported.observations.interpolatedObservations
          .verifiedIntervalArrivals[0].classificationReasons
      ).toContain(
        "interior_percentage_arrivals_interpolated_between_verified_notification_observations"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exports observation classification counts and reasons", () => {
    const storage = new Map<string, string>([
      [
        "craftyChargingHistory:crafty",
        JSON.stringify([
          sample(80, 0, "isolated", "snapshot"),
          sample(81, 10, "rejected-a", "snapshot"),
          sample(82, 11, "rejected-b", "snapshot"),
        ]),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
    });

    try {
      const exported = createChargingDebugExport(
        "crafty",
        { version: "1.0.4", gitCommit: "abc123" },
        minute(100)
      );
      expect(
        exported.observations.derivedClassifications.map(
          (item) => item.classification
        )
      ).toContain("isolated_snapshot");
      expect(exported.observations.classificationCounts).toMatchObject({
        isolated: 3,
        accepted: 0,
        rejected: 3,
        interpolated: 0,
      });
      expect(
        exported.observations.derivedClassifications[0].classificationReasons
      ).toContain("snapshot_is_not_an_exact_percentage_transition");
      expect(exported.ruleAudit).toMatchObject({
        explicitSnapshotsInProvisionalRateSegments: 0,
        crossSessionSnapshotTransitionsRejected: 2,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports legacy observations selected by the provisional curve as unverified", () => {
    const history: BatterySample[] = [
      { level: 60, time: minute(0), sessionId: "legacy", origin: "legacy" },
      { level: 70, time: minute(10), sessionId: "legacy", origin: "legacy" },
      { level: 80, time: minute(20), sessionId: "legacy", origin: "legacy" },
      { level: 90, time: minute(30), sessionId: "legacy", origin: "legacy" },
      { level: 95, time: minute(36), sessionId: "legacy", origin: "legacy" },
      { level: 99, time: minute(45), sessionId: "legacy", origin: "legacy" },
      sample(80, 100, "current", "snapshot"),
    ];
    const { estimate, diagnostics } = diagnoseChargingEta(
      history,
      80,
      "current",
      minute(100)
    );
    expect(estimate).toMatchObject({
      source: "history",
      provisional: true,
    });

    const storage = new Map<string, string>([
      ["craftyChargingHistory:crafty", JSON.stringify(history)],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const current = history[history.length - 1];
      const updatedEta: EtaTraceSnapshot = {
        remainingMinutes: estimate?.remainingMinutes ?? 0,
        source: estimate?.source ?? "history",
        targetLevel: 99,
        historicalRunCount: estimate?.historicalRunCount ?? 0,
        adaptedToLive: estimate?.adaptedToLive ?? false,
        provisional: estimate?.provisional ?? true,
        chargingObserved: estimate?.chargingObserved ?? false,
        predictedCompletionAt:
          current.time + (estimate?.remainingMinutes ?? 0) * 60_000,
      };
      appendChargingEtaTrace("crafty", {
        kind: "eta_recalculation",
        recordedAt: minute(100),
        input: {
          deviceId: "crafty",
          currentLevel: 80,
          sessionId: "current",
          calculationTime: minute(100),
          historySampleCount: history.length,
          historyFingerprint: fingerprintBatterySamples(history),
          latestSample: current,
        },
        previousEta: null,
        updatedEta,
        calculation: diagnostics,
      });

      const exported = createChargingDebugExport(
        "crafty",
        { version: "1.0.4", gitCommit: "abc123" },
        minute(100)
      );
      expect(
        exported.ruleAudit.unverifiedProvisionalRateCandidates
      ).toBeGreaterThan(0);
      expect(
        exported.ruleAudit.selectedUnverifiedProvisionalRateIntervals
      ).toBeGreaterThan(0);
      expect(
        exported.observations.provisionalRateCandidates.intervals.some(
          (interval) =>
            interval.selectedByLatestPrediction &&
            interval.unverifiedReasons.includes(
              "previous_observation_not_verified_change_notification"
            )
        )
      ).toBe(true);
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
