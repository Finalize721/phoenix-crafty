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

  it("uses the measured live slope when no completed curve exists", () => {
    const samples: BatterySample[] = [
      { level: 20, time: 0, sessionId: "session" },
      { level: 30, time: 10 * 60_000, sessionId: "session" },
      { level: 40, time: 20 * 60_000, sessionId: "session" },
    ];

    expect(
      estimateChargingEta(samples, 40, "session", 20 * 60_000)
    ).toMatchObject({
      expiresAt: 50 * 60_000,
      remainingMinutes: 60,
      source: "live",
    });
  });

  it("estimates charge speed across frequent battery updates", () => {
    const samples: BatterySample[] = Array.from({ length: 21 }, (_, level) => ({
      level,
      time: level * 30_000,
      sessionId: "session",
    }));
    const now = 20 * 30_000;

    expect(estimateChargingEta(samples, 20, "session", now)).toMatchObject({
      expiresAt: now + 30 * 60_000,
      remainingMinutes: 40,
      source: "live",
    });
  });

  it("uses measured high-battery rates when charging slows near full", () => {
    const samples: BatterySample[] = [
      { level: 50, time: 0, sessionId: "session" },
      { level: 60, time: 10 * 60_000, sessionId: "session" },
      { level: 70, time: 20 * 60_000, sessionId: "session" },
      { level: 90, time: 40 * 60_000, sessionId: "session" },
      {
        level: 95,
        time: 55 * 60_000,
        sessionId: "session",
        continuousSincePrevious: true,
      },
      {
        level: 96,
        time: 58 * 60_000,
        sessionId: "session",
        continuousSincePrevious: true,
      },
    ];

    expect(
      estimateChargingEta(samples, 96, "session", 58 * 60_000)
    ).toMatchObject({
      expiresAt: 88 * 60_000,
      remainingMinutes: 12,
      source: "live",
    });
  });

  it("does not mistake an incomplete historical session for a full curve", () => {
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
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses a completed locally saved curve after a current-session rise", () => {
    const samples: BatterySample[] = [
      { level: 50, time: 0, sessionId: "old" },
      { level: 60, time: 10 * 60_000, sessionId: "old" },
      { level: 70, time: 20 * 60_000, sessionId: "old" },
      { level: 80, time: 30 * 60_000, sessionId: "old" },
      { level: 90, time: 40 * 60_000, sessionId: "old" },
      { level: 95, time: 50 * 60_000, sessionId: "old" },
      { level: 100, time: 60 * 60_000, sessionId: "old" },
      { level: 80, time: 2 * 60 * 60_000, sessionId: "new" },
      { level: 85, time: 2 * 60 * 60_000 + 5 * 60_000, sessionId: "new" },
      { level: 90, time: 2 * 60 * 60_000 + 10 * 60_000, sessionId: "new" },
    ];

    expect(
      estimateChargingEta(samples, 90, "new", 2 * 60 * 60_000 + 10 * 60_000)
    ).toMatchObject({
      remainingMinutes: 20,
      source: "history",
    });
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
