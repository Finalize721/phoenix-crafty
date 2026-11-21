import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HISTORY_RETENTION_DAYS,
  setHistoryRetentionDays,
} from "../../utils/historyRetention";
import {
  type BatterySample,
  estimateChargingEta,
  readChargingHistory,
  readUserChargingHintAt,
  recordBatterySample,
  saveUserChargingHintAt,
} from "./chargingEta";

const minute = (value: number) => value * 60_000;

const completed99 = (): BatterySample[] => [
  { level: 60, time: minute(0), sessionId: "old" },
  { level: 70, time: minute(10), sessionId: "old" },
  { level: 80, time: minute(20), sessionId: "old" },
  { level: 90, time: minute(32), sessionId: "old" },
  { level: 95, time: minute(40), sessionId: "old" },
  { level: 99, time: minute(48), sessionId: "old" },
];

describe("Crafty charging ETA integration", () => {
  it("uses saved history immediately from the first fresh reading", () => {
    const history = completed99();
    const samples = recordBatterySample(
      "crafty",
      80,
      minute(100),
      "new",
      history,
      { origin: "snapshot" }
    );

    expect(estimateChargingEta(samples, 80, "new", minute(100))).toMatchObject({
      source: "history",
      targetLevel: 99,
      remainingMinutes: 28,
      provisional: true,
      chargingObserved: false,
      expiresAt: minute(130),
    });
  });

  it("keeps falling observations and persists heater state", () => {
    const first = recordBatterySample(
      "crafty",
      82,
      minute(100),
      "session",
      [],
      { origin: "snapshot", heaterActive: false }
    );
    const decreased = recordBatterySample(
      "crafty",
      80,
      minute(102),
      "session",
      first,
      {
        origin: "notification",
        continuousSincePrevious: true,
        heaterActive: true,
      }
    );
    expect(decreased).toHaveLength(2);
    expect(decreased[0].heaterActive).toBe(false);
    expect(decreased[1]).toMatchObject({ level: 80, heaterActive: true });
  });

  it("stores manual display requests only for a short per-device window", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    try {
      saveUserChargingHintAt("crafty", minute(100));
      expect(readUserChargingHintAt("crafty", minute(102))).toBe(minute(100));
      expect(readUserChargingHintAt("crafty", minute(104))).toBeUndefined();
      expect(storage.has("craftyChargingHint:crafty")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves the existing per-device storage key and legacy sample format", () => {
    const storage = new Map<string, string>([
      ["craftyChargingHistory:crafty", JSON.stringify(completed99())],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const history = readChargingHistory("crafty", minute(100));
      expect(history).toHaveLength(6);
      expect(history[0]).not.toHaveProperty("breakBefore");
      const samples = recordBatterySample(
        "crafty",
        80,
        minute(100),
        "new",
        history
      );
      expect(
        estimateChargingEta(samples, 80, "new", minute(100))
      ).toMatchObject({
        targetLevel: 99,
        source: "history",
        chargingObserved: false,
      });
      expect(storage.has("craftyChargingHistory:crafty")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("appends a same-level reading after an interruption boundary", () => {
    const first = recordBatterySample("crafty", 80, minute(100), "session", []);
    const resumed = recordBatterySample(
      "crafty",
      80,
      minute(110),
      "session",
      first,
      { breakBefore: true }
    );

    expect(resumed).toHaveLength(2);
    expect(resumed[1]).toMatchObject({
      level: 80,
      breakBefore: true,
    });
  });

  it("persists observation provenance without changing the storage key", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    try {
      const stored = recordBatterySample(
        "crafty",
        80,
        minute(100),
        "session",
        [],
        { origin: "snapshot" }
      );
      expect(stored[0].origin).toBe("snapshot");
      expect(storage.has("craftyChargingHistory:crafty")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats 99% as complete and never predicts a 100% ETA", () => {
    expect(
      estimateChargingEta(
        [...completed99(), { level: 99, time: minute(100), sessionId: "new" }],
        99,
        "new",
        minute(100)
      )
    ).toBeUndefined();
    expect(
      estimateChargingEta(
        [...completed99(), { level: 100, time: minute(100), sessionId: "new" }],
        100,
        "new",
        minute(100)
      )
    ).toBeUndefined();
  });

  it("marks the live fallback as provisional and charging-observed", () => {
    const samples = [
      {
        level: 80,
        time: minute(100),
        sessionId: "new",
        origin: "notification" as const,
        heaterActive: false,
      },
      {
        level: 81,
        time: minute(102),
        sessionId: "new",
        origin: "notification" as const,
        continuousSincePrevious: true,
        heaterActive: false,
      },
      {
        level: 82,
        time: minute(104),
        sessionId: "new",
        origin: "notification" as const,
        continuousSincePrevious: true,
        heaterActive: false,
      },
    ];
    expect(estimateChargingEta(samples, 82, "new", minute(104))).toMatchObject({
      source: "live",
      targetLevel: 99,
      provisional: true,
      chargingObserved: true,
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
