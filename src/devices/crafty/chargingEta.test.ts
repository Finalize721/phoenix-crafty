import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HISTORY_RETENTION_DAYS,
  setHistoryRetentionDays,
} from "../../utils/historyRetention";
import {
  type BatterySample,
  estimateChargingEta,
  readChargingHistory,
  recordBatterySample,
} from "./chargingEta";

describe("Crafty charging ETA", () => {
  it("waits for recent battery increases before showing charging", () => {
    const samples: BatterySample[] = [
      { level: 50, time: 0, sessionId: "session" },
      { level: 51, time: 5 * 60_000, sessionId: "session" },
    ];

    expect(estimateChargingEta(samples, 51, "session", 5 * 60_000)).toEqual({
      expiresAt: 35 * 60_000,
    });
    expect(
      estimateChargingEta(samples, 51, "session", 36 * 60_000)
    ).toBeUndefined();
  });

  it("uses the median of recent measured rates for a full-charge estimate", () => {
    const samples: BatterySample[] = [
      { level: 20, time: 0, sessionId: "session" },
      { level: 30, time: 10 * 60_000, sessionId: "session" },
      { level: 40, time: 30 * 60_000, sessionId: "session" },
    ];

    expect(estimateChargingEta(samples, 40, "session", 30 * 60_000)).toEqual({
      expiresAt: 60 * 60_000,
      remainingMinutes: 80,
    });
  });

  it("uses measured high-battery rates when charging slows near full", () => {
    const samples: BatterySample[] = [
      { level: 50, time: 0, sessionId: "session" },
      { level: 60, time: 10 * 60_000, sessionId: "session" },
      { level: 70, time: 20 * 60_000, sessionId: "session" },
      { level: 90, time: 40 * 60_000, sessionId: "session" },
      { level: 95, time: 55 * 60_000, sessionId: "session" },
      { level: 96, time: 58 * 60_000, sessionId: "session" },
    ];

    expect(estimateChargingEta(samples, 96, "session", 58 * 60_000)).toEqual({
      expiresAt: 88 * 60_000,
      remainingMinutes: 12,
    });
  });

  it("uses saved charge rates after a live rise in a new session", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      recordBatterySample("crafty", 50, 0, "old");
      recordBatterySample("crafty", 60, 10 * 60_000, "old");
      recordBatterySample("crafty", 70, 20 * 60_000, "old");
      const baseline = recordBatterySample("crafty", 80, 60 * 60_000, "new");
      expect(
        estimateChargingEta(baseline, 80, "new", 60 * 60_000)
      ).toBeUndefined();
      const samples = recordBatterySample("crafty", 81, 65 * 60_000, "new");

      expect(samples).toHaveLength(5);
      expect(estimateChargingEta(samples, 81, "new", 65 * 60_000)).toEqual({
        expiresAt: 95 * 60_000,
        remainingMinutes: 55,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the configured retention period for saved battery readings", () => {
    const storedSamples = [
      {
        level: 50,
        time: 40 * 24 * 60 * 60 * 1000 - 29 * 24 * 60 * 60 * 1000,
        sessionId: "recent",
      },
      {
        level: 40,
        time: 40 * 24 * 60 * 60 * 1000 - 31 * 24 * 60 * 60 * 1000,
        sessionId: "older",
      },
    ];
    const storage = new Map<string, string>([
      ["craftyChargingHistory:crafty", JSON.stringify(storedSamples)],
      ["craftyChargingHistory:other", JSON.stringify(storedSamples)],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

    try {
      const now = 40 * 24 * 60 * 60 * 1000;
      setHistoryRetentionDays(30);
      expect(readChargingHistory("crafty", now)).toHaveLength(1);
      setHistoryRetentionDays(45);
      expect(readChargingHistory("other", now)).toHaveLength(2);
    } finally {
      setHistoryRetentionDays(DEFAULT_HISTORY_RETENTION_DAYS);
      vi.unstubAllGlobals();
    }
  });
});
