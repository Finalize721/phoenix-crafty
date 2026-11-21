import { describe, expect, it } from "vitest";
import {
  type BatteryCurveSample,
  predictChargingCurve,
  splitChargingRuns,
} from "./chargingCurveModel";

const minute = (value: number) => value * 60_000;
const point = (
  level: number,
  at: number,
  sessionId: string,
  flags: Partial<
    Pick<
      BatteryCurveSample,
      "breakBefore" | "continuousSincePrevious" | "origin" | "heaterActive"
    >
  > = {}
): BatteryCurveSample => ({
  level,
  time: minute(at),
  sessionId,
  origin: "notification",
  continuousSincePrevious: true,
  heaterActive: false,
  ...flags,
});

const completed99 = [
  point(60, 0, "old"),
  point(70, 10, "old"),
  point(80, 20, "old"),
  point(90, 32, "old"),
  point(95, 40, "old"),
  point(99, 48, "old"),
];

describe("Crafty+ historical ETA to 99%", () => {
  it("uses the historical curve on the first fresh reading after reconnect", () => {
    expect(
      predictChargingCurve(
        [...completed99, point(80, 100, "new")],
        80,
        "new",
        minute(100)
      )
    ).toMatchObject({
      source: "history",
      targetLevel: 99,
      historicalRunCount: 1,
      chargingObserved: false,
      provisional: true,
      remainingMinutes: 28,
    });
  });

  it("estimates remaining time when history ends at 99%", () => {
    expect(
      predictChargingCurve(
        [...completed99, point(85, 100, "new")],
        85,
        "new",
        minute(100)
      )?.remainingMinutes
    ).toBe(22);
  });

  it("interpolates between observed battery levels", () => {
    expect(
      predictChargingCurve(
        [...completed99, point(87, 100, "new")],
        87,
        "new",
        minute(100)
      )?.remainingMinutes
    ).toBe(20);
  });

  it("treats 99% as complete without predicting 100%", () => {
    expect(
      predictChargingCurve(
        [...completed99, point(99, 100, "new")],
        99,
        "new",
        minute(100)
      )
    ).toBeUndefined();
    expect(
      predictChargingCurve(
        [...completed99, point(100, 100, "new")],
        100,
        "new",
        minute(100)
      )
    ).toBeUndefined();
  });

  it("uses history after live progress and marks charging observed", () => {
    expect(
      predictChargingCurve(
        [
          ...completed99,
          point(80, 100, "new", { origin: "snapshot" }),
          point(81, 103, "new"),
          point(82, 106, "new"),
        ],
        82,
        "new",
        minute(106)
      )
    ).toMatchObject({
      source: "history",
      chargingObserved: true,
      targetLevel: 99,
    });
  });

  it("does not learn a target arrival after an interruption", () => {
    const interrupted = [
      point(95, 0, "old"),
      point(98, 4, "old"),
      point(99, 5, "old", { breakBefore: true }),
    ];
    expect(
      predictChargingCurve(
        [...interrupted, point(97, 100, "new")],
        97,
        "new",
        minute(100)
      )
    ).toBeUndefined();
  });

  it("rejects a target reading after a long unobserved gap", () => {
    const interrupted = [
      point(60, 0, "old"),
      point(80, 10, "old"),
      point(99, 100, "old", { continuousSincePrevious: false }),
    ];
    expect(
      predictChargingCurve(
        [...interrupted, point(81, 110, "new")],
        81,
        "new",
        minute(110)
      )
    ).toBeUndefined();
  });

  it("uses near-complete fragments provisionally without inventing target time", () => {
    const partial = [
      point(75, 0, "old"),
      point(85, 10, "old"),
      point(90, 16, "old"),
      point(95, 24, "old"),
      point(98, 30, "old"),
    ];
    expect(
      predictChargingCurve(
        [...partial, point(80, 100, "new")],
        80,
        "new",
        minute(100)
      )
    ).toMatchObject({ source: "history", provisional: true });
  });

  it("does not use a near-full fragment separated by an interruption", () => {
    const partial = [
      point(60, 0, "old"),
      point(70, 10, "old"),
      point(80, 20, "old"),
      point(95, 100, "old", { breakBefore: true }),
      point(99, 105, "old"),
    ];
    expect(
      predictChargingCurve(
        [...partial, point(75, 200, "new")],
        75,
        "new",
        minute(200)
      )
    ).toBeUndefined();
  });

  it("does not extrapolate early-only history to 99%", () => {
    const partial = [
      point(20, 0, "old"),
      point(30, 10, "old"),
      point(40, 20, "old"),
      point(50, 30, "old"),
    ];
    expect(
      predictChargingCurve(
        [...partial, point(30, 100, "new")],
        30,
        "new",
        minute(100)
      )
    ).toBeUndefined();
  });

  it("does not use a one-step live rise as a charging rate", () => {
    expect(
      predictChargingCurve(
        [point(80, 100, "new"), point(81, 103, "new")],
        81,
        "new",
        minute(103)
      )
    ).toBeUndefined();
  });

  it("rejects a one-minute jump as insufficient live evidence", () => {
    expect(
      predictChargingCurve(
        [point(80, 100, "new"), point(81, 101, "new")],
        81,
        "new",
        minute(101)
      )
    ).toBeUndefined();
  });

  it("does not advertise a stale current measurement", () => {
    expect(
      predictChargingCurve(
        [...completed99, point(80, 100, "new")],
        80,
        "new",
        minute(131)
      )
    ).toBeUndefined();
  });

  it("splits samples at explicit interruption boundaries", () => {
    expect(
      splitChargingRuns([
        point(90, 0, "old"),
        point(98, 4, "old"),
        point(99, 5, "old", { breakBefore: true }),
      ])
    ).toHaveLength(2);
  });

  it("uses legacy 100% runs as a curve only through 99%", () => {
    const old100 = [
      point(60, 0, "legacy", { origin: "legacy" }),
      point(70, 10, "legacy", { origin: "legacy" }),
      point(80, 20, "legacy", { origin: "legacy" }),
      point(90, 30, "legacy", { origin: "legacy" }),
      point(95, 36, "legacy", { origin: "legacy" }),
      point(100, 45, "legacy", { origin: "legacy" }),
    ];
    expect(
      predictChargingCurve(
        [...old100, point(80, 100, "new")],
        80,
        "new",
        minute(100)
      )
    ).toMatchObject({ targetLevel: 99, remainingMinutes: 24 });
  });

  it("uses a single current snapshot to show an immediate historical ETA", () => {
    expect(
      predictChargingCurve(
        [...completed99, point(80, 100, "new", { origin: "snapshot" })],
        80,
        "new",
        minute(100)
      )
    ).toMatchObject({
      source: "history",
      remainingMinutes: 28,
      chargingObserved: false,
      provisional: true,
    });
  });

  it("does not use a historical snapshot as an exact starting crossing", () => {
    const history = [
      point(80, 0, "old", { origin: "snapshot" }),
      point(81, 3, "old"),
      point(82, 5, "old"),
      point(90, 15, "old"),
      point(95, 23, "old"),
      point(99, 31, "old"),
    ];
    const prediction = predictChargingCurve(
      [...history, point(80, 100, "new", { origin: "snapshot" })],
      80,
      "new",
      minute(100)
    );
    expect(prediction).toMatchObject({
      source: "history",
      provisional: true,
    });
    expect(prediction?.remainingMinutes).toBeGreaterThan(0);
  });

  it("keeps older provenance-tagged history usable only provisionally", () => {
    const olderHistory = completed99.map(
      // Older saved samples did not record heater state.
      ({ heaterActive: _heaterActive, ...sample }) => sample
    );
    expect(
      predictChargingCurve(
        [...olderHistory, point(80, 100, "new", { origin: "snapshot" })],
        80,
        "new",
        minute(100)
      )
    ).toMatchObject({
      source: "history",
      remainingMinutes: 28,
      chargingObserved: false,
      provisional: true,
    });
  });

  it("does not train from snapshot-to-notification intervals", () => {
    const history = [
      point(80, 0, "old", { origin: "snapshot" }),
      point(81, 10, "old"),
      point(82, 12, "old"),
    ];
    expect(
      predictChargingCurve(
        [...history, point(81, 100, "new", { origin: "snapshot" })],
        81,
        "new",
        minute(100)
      )
    ).toBeUndefined();
  });
});
