import { describe, expect, it } from "vitest";
import {
  type BatteryCurveSample,
  predictChargingCurve,
  splitChargingRuns,
} from "./chargingCurveModel";

const minute = (value: number) => value * 60_000;
const point = (
  level: number,
  minutes: number,
  sessionId: string,
  breakBefore = false
): BatteryCurveSample => ({
  level,
  time: minute(minutes),
  sessionId,
  ...(breakBefore ? { breakBefore: true } : {}),
});

const historical = [
  point(50, 0, "old"),
  point(60, 10, "old"),
  point(65, 15, "old"),
  point(75, 25, "old"),
  point(80, 30, "old"),
  point(85, 38, "old"),
  point(90, 45, "old"),
  point(93, 51, "old"),
  point(95, 55, "old"),
  point(97, 62, "old"),
  point(100, 70, "old"),
];

describe("empirical charging curve estimator", () => {
  it("uses historical time from the current level to observed full", () => {
    const current = [
      point(80, 100, "new"),
      point(85, 105, "new"),
      point(90, 115, "new"),
    ];
    const prediction = predictChargingCurve(
      [...historical, ...current],
      90,
      "new",
      minute(115)
    );
    expect(prediction).toMatchObject({
      source: "history",
      historicalRunCount: 1,
      remainingMinutes: 25,
    });
  });

  it("gives each completed run one vote when taking the median", () => {
    const fast = [
      point(80, 200, "fast"),
      point(85, 205, "fast"),
      point(90, 210, "fast"),
      point(95, 215, "fast"),
      point(100, 220, "fast"),
    ];
    const slow = [
      point(80, 300, "slow"),
      point(84, 309, "slow"),
      point(88, 318, "slow"),
      point(90, 325, "slow"),
      point(93, 337, "slow"),
      point(95, 343, "slow"),
      point(96, 349, "slow"),
      point(97, 353, "slow"),
      point(98, 357, "slow"),
      point(100, 365, "slow"),
    ];
    const current = [point(88, 400, "new"), point(90, 410, "new")];
    expect(
      predictChargingCurve(
        [...fast, ...slow, ...current],
        90,
        "new",
        minute(410)
      )
    ).toMatchObject({ historicalRunCount: 2, remainingMinutes: 25 });
  });

  it("does not infer completion across a disconnected gap", () => {
    const incomplete = [
      point(50, 0, "old"),
      point(70, 10, "old"),
      point(90, 20, "old"),
      point(100, 100, "old"),
    ];
    const current = [
      point(85, 200, "new"),
      point(87, 205, "new"),
      point(90, 210, "new"),
    ];
    expect(
      predictChargingCurve([...incomplete, ...current], 90, "new", minute(210))
        ?.source
    ).toBe("live");
  });

  it("splits at explicit visibility and reconnect boundaries", () => {
    const samples = [
      point(90, 0, "old"),
      point(94, 4, "old"),
      point(100, 8, "old", true),
    ];
    expect(splitChargingRuns(samples)).toHaveLength(2);
  });

  it("accepts a verified long plateau without requiring duplicate samples", () => {
    const completed = [
      point(80, 0, "old"),
      point(90, 8, "old"),
      point(95, 18, "old"),
      { ...point(100, 38, "old"), continuousSincePrevious: true },
    ];
    const current = [point(85, 100, "new"), point(90, 107, "new")];
    expect(
      predictChargingCurve([...completed, ...current], 90, "new", minute(107))
    ).toMatchObject({ source: "history", remainingMinutes: 30 });
  });

  it("does not treat an observed 99% as a confirmed 100%", () => {
    const partial = [
      point(60, 0, "old"),
      point(90, 30, "old"),
      point(99, 50, "old"),
    ];
    const current = [
      point(80, 100, "new"),
      point(85, 105, "new"),
      point(90, 110, "new"),
    ];
    expect(
      predictChargingCurve([...partial, ...current], 90, "new", minute(110))
        ?.source
    ).toBe("live");
  });

  it("adapts historical estimates conservatively to current speed", () => {
    const current = [
      point(80, 100, "new"),
      point(85, 107, "new"),
      point(88, 114, "new"),
      point(90, 120, "new"),
    ];
    expect(
      predictChargingCurve([...historical, ...current], 90, "new", minute(120))
    ).toMatchObject({ source: "history", adaptedToLive: true });
    expect(
      predictChargingCurve([...historical, ...current], 90, "new", minute(120))
        ?.remainingMinutes
    ).toBe(28);
  });

  it("requires a fresh rise and enough data for a live fallback", () => {
    expect(
      predictChargingCurve(
        [...historical, point(80, 100, "new")],
        80,
        "new",
        minute(100)
      )
    ).toBeUndefined();
    const short = [point(80, 100, "new"), point(82, 104, "new")];
    expect(predictChargingCurve(short, 82, "new", minute(104))).toBeUndefined();
  });

  it("drops stale readings", () => {
    const current = [point(80, 100, "new"), point(90, 110, "new")];
    expect(
      predictChargingCurve([...historical, ...current], 90, "new", minute(145))
    ).toBeUndefined();
  });

  it("does not predict levels below the available historical curve", () => {
    const current = [
      point(50, 100, "new"),
      point(55, 105, "new"),
      point(60, 110, "new"),
    ];
    expect(
      predictChargingCurve([...historical, ...current], 60, "new", minute(110))
        ?.source
    ).toBe("history");
    const lower = [
      point(10, 200, "other"),
      point(15, 205, "other"),
      point(20, 210, "other"),
    ];
    expect(
      predictChargingCurve([...historical, ...lower], 20, "other", minute(210))
        ?.source
    ).toBe("live");
  });
});
