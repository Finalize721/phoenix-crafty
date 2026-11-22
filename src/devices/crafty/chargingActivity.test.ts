import { describe, expect, it } from "vitest";
import {
  assessChargingActivity,
  findChargingIntervals,
} from "./chargingActivity";

const minute = (value: number) => value * 60_000;
const point = (
  level: number,
  at: number,
  sessionId: string,
  origin: "snapshot" | "notification" | "legacy" = "notification",
  extra: Partial<{
    breakBefore: boolean;
    continuousSincePrevious: boolean;
    heaterActive: boolean;
  }> = {}
) => ({
  level,
  time: minute(at),
  sessionId,
  origin,
  heaterActive: false,
  ...extra,
});
const continuous = {
  continuousSincePrevious: true,
  heaterActive: false,
};
const charging = [
  point(80, 0, "old", "snapshot"),
  point(81, 3, "old", "notification", continuous),
  point(82, 6, "old", "notification", continuous),
];

describe("charging-vs-usage classification", () => {
  it("allows historical calculation from a snapshot without auto-showing it", () => {
    expect(
      assessChargingActivity([point(80, 100, "now", "snapshot")], "now", {
        now: minute(100),
      })
    ).toMatchObject({
      state: "unknown",
      showEta: false,
      canComputeHistoricalEta: true,
    });
  });

  it("does not treat increasing snapshots from separate app openings as charging", () => {
    const samples = [
      point(30, 0, "opening-a", "snapshot"),
      point(40, 10, "opening-b", "snapshot"),
    ];
    expect(
      assessChargingActivity(samples, "opening-b", { now: minute(10) })
    ).toMatchObject({
      state: "unknown",
      showEta: false,
      chargingIntervals: [],
    });
  });

  it("shows a recent manual request provisionally without training", () => {
    const evidence = assessChargingActivity(
      [point(80, 100, "now", "snapshot")],
      "now",
      { now: minute(100), userChargingHintAt: minute(99) }
    );
    expect(evidence).toMatchObject({ showEta: true, manualOnly: true });
    expect(evidence.chargingIntervals).toHaveLength(0);
  });

  it("expires old manual requests", () => {
    expect(
      assessChargingActivity([point(80, 100, "now", "snapshot")], "now", {
        now: minute(100),
        userChargingHintAt: minute(90),
      }).showEta
    ).toBe(false);
  });

  it("does not use a snapshot-to-notification interval as a charging rate", () => {
    const intervals = findChargingIntervals(charging);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ from: 81, to: 82 });
  });

  it("requires multiple rises for inferred charging", () => {
    expect(
      assessChargingActivity(charging, "old", { now: minute(6) })
    ).toMatchObject({ state: "charging-likely", showEta: true });
  });

  it("does not learn from a single 1% rebound", () => {
    const samples = [
      point(80, 0, "one", "snapshot"),
      point(81, 3, "one", "notification", continuous),
    ];
    expect(findChargingIntervals(samples)).toHaveLength(0);
    expect(
      assessChargingActivity(samples, "one", { now: minute(3) }).showEta
    ).toBe(false);
  });

  it("does not trust samples without a known inactive heater state", () => {
    const samples = [
      {
        level: 80,
        time: minute(0),
        sessionId: "unknown",
        origin: "snapshot" as const,
      },
      {
        level: 81,
        time: minute(3),
        sessionId: "unknown",
        origin: "notification" as const,
        continuousSincePrevious: true,
      },
      {
        level: 82,
        time: minute(6),
        sessionId: "unknown",
        origin: "notification" as const,
        continuousSincePrevious: true,
      },
    ];
    expect(findChargingIntervals(samples)).toHaveLength(0);
  });

  it("hides ETA after a confirmed drop", () => {
    const samples = [
      ...charging,
      point(81, 8, "old", "notification", continuous),
    ];
    expect(
      assessChargingActivity(samples, "old", { now: minute(8) })
    ).toMatchObject({ state: "discharging", showEta: false });
  });

  it("does not let a manual request override a falling battery", () => {
    const samples = [
      ...charging,
      point(81, 8, "old", "notification", continuous),
    ];
    expect(
      assessChargingActivity(samples, "old", {
        now: minute(8),
        userChargingHintAt: minute(8),
      })
    ).toMatchObject({
      state: "discharging",
      showEta: false,
      manualOnly: false,
    });
  });

  it("hides ETA and blocks learning while the heater is active", () => {
    const samples = [
      point(80, 0, "heated", "snapshot", { heaterActive: true }),
      point(81, 3, "heated", "notification", {
        ...continuous,
        heaterActive: true,
      }),
      point(82, 6, "heated", "notification", {
        ...continuous,
        heaterActive: true,
      }),
    ];
    expect(findChargingIntervals(samples)).toHaveLength(0);
    expect(
      assessChargingActivity(samples, "heated", {
        now: minute(6),
        userChargingHintAt: minute(6),
      })
    ).toMatchObject({ state: "using", showEta: false });
  });

  it("does not join a verified run across a reconnect snapshot", () => {
    const samples = [
      ...charging,
      point(83, 7, "old", "snapshot", { breakBefore: true }),
      point(84, 9, "old", "notification", continuous),
    ];
    expect(
      findChargingIntervals(samples).map((interval) => interval.to)
    ).toEqual([82]);
    expect(
      assessChargingActivity(samples, "old", { now: minute(9) })
    ).toMatchObject({ state: "unknown", showEta: false });
  });

  it("does not carry a previous connection's charging state into a new one", () => {
    const samples = [...charging, point(85, 100, "new", "snapshot")];
    expect(
      assessChargingActivity(samples, "new", { now: minute(100) }).showEta
    ).toBe(false);
  });

  it("treats 99% as full", () => {
    expect(
      assessChargingActivity([point(99, 100, "new", "snapshot")], "new", {
        now: minute(100),
      })
    ).toMatchObject({ state: "full", showEta: false });
  });

  it("does not infer active charging from stale samples", () => {
    expect(
      assessChargingActivity(charging, "old", { now: minute(80) }).showEta
    ).toBe(false);
  });

  it("only trains consecutive notification pairs after the trend qualifies", () => {
    const samples = [
      point(80, 0, "session", "snapshot"),
      point(83, 4, "session", "notification", continuous),
      point(85, 8, "session", "notification", continuous),
    ];
    expect(
      findChargingIntervals(samples).map(({ from, to }) => [from, to])
    ).toEqual([[83, 85]]);
  });

  it("keeps a falling snapshot as unknown rather than charge evidence", () => {
    const samples = [
      point(82, 0, "session", "notification"),
      point(78, 50, "session", "snapshot", { breakBefore: true }),
    ];
    expect(
      assessChargingActivity(samples, "session", { now: minute(50) })
    ).toMatchObject({ state: "unknown", showEta: false });
  });

  it("does not let a manual request override heater use", () => {
    expect(
      assessChargingActivity(
        [point(82, 100, "session", "snapshot", { heaterActive: true })],
        "session",
        { now: minute(100), userChargingHintAt: minute(100) }
      )
    ).toMatchObject({ state: "using", showEta: false });
  });

  it("needs a new qualifying streak after a break", () => {
    const samples = [
      ...charging,
      point(84, 10, "old", "snapshot", { breakBefore: true }),
      point(85, 13, "old", "notification", continuous),
    ];
    expect(
      assessChargingActivity(samples, "old", { now: minute(13) }).state
    ).toBe("unknown");
    samples.push(point(86, 16, "old", "notification", continuous));
    expect(
      assessChargingActivity(samples, "old", { now: minute(16) }).state
    ).toBe("charging-likely");
  });
});
