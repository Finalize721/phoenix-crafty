import { describe, expect, it } from "vitest";
import {
  boundPercentArrival,
  extractObservationEvidence,
  isArrivalConsistentWithBounds,
  type QualitySample,
} from "./observationQuality";

const minute = (value: number) => value * 60_000;
const point = (
  level: number,
  at: number,
  origin: QualitySample["origin"],
  flags: Partial<
    Pick<QualitySample, "breakBefore" | "continuousSincePrevious" | "sessionId">
  > = {}
): QualitySample => ({
  level,
  time: minute(at),
  sessionId: "run",
  origin,
  ...flags,
});
const continuous = { continuousSincePrevious: true };

describe("battery observation quality", () => {
  it("does not treat a single opening snapshot as a crossing or duration", () => {
    const evidence = extractObservationEvidence([point(80, 0, "snapshot")]);
    expect(evidence.transitions).toEqual([]);
    expect(evidence.measuredSegments).toEqual([]);
  });

  it("uses a first notification as an arrival, not a measured duration", () => {
    const evidence = extractObservationEvidence([
      point(80, 0, "snapshot"),
      point(81, 3, "notification", continuous),
    ]);
    expect(evidence.transitions).toEqual([
      { level: 81, at: minute(3), quality: "observed" },
    ]);
    expect(evidence.measuredSegments).toEqual([]);
  });

  it("trains only from two consecutive notification events", () => {
    const evidence = extractObservationEvidence([
      point(80, 0, "snapshot"),
      point(81, 3, "notification", continuous),
      point(82, 5, "notification", continuous),
    ]);
    expect(evidence.measuredSegments).toHaveLength(1);
    expect(evidence.measuredSegments[0]).toMatchObject({
      fromLevel: 81,
      toLevel: 82,
      elapsedMs: minute(2),
    });
  });

  it("keeps missing interior percentages interpolated, not observed", () => {
    const evidence = extractObservationEvidence([
      point(80, 0, "notification"),
      point(85, 10, "notification", continuous),
    ]);
    expect(evidence.measuredSegments[0].arrivals).toEqual([
      { level: 81, at: minute(2), quality: "interpolated" },
      { level: 82, at: minute(4), quality: "interpolated" },
      { level: 83, at: minute(6), quality: "interpolated" },
      { level: 84, at: minute(8), quality: "interpolated" },
      { level: 85, at: minute(10), quality: "observed" },
    ]);
  });

  it("requires notification continuity for measured segments and 99% completion", () => {
    const noContinuity = extractObservationEvidence([
      point(98, 0, "notification"),
      point(99, 2, "notification"),
    ]);
    expect(noContinuity.measuredSegments).toEqual([]);
    expect(noContinuity.observed99ArrivalAt).toBeUndefined();
  });

  it("recognizes 99% only from a continuous notification arrival", () => {
    expect(
      extractObservationEvidence([
        point(98, 0, "notification"),
        point(99, 2, "notification", continuous),
      ]).observed99ArrivalAt
    ).toBe(minute(2));
    expect(
      extractObservationEvidence([
        point(98, 0, "notification"),
        point(99, 2, "snapshot", {
          breakBefore: true,
          continuousSincePrevious: true,
        }),
      ]).observed99ArrivalAt
    ).toBeUndefined();
  });

  it("never promotes legacy points to observed transitions", () => {
    const evidence = extractObservationEvidence([
      point(80, 0, "legacy"),
      point(81, 2, "legacy", continuous),
    ]);
    expect(evidence.transitions).toEqual([]);
    expect(evidence.measuredSegments).toEqual([]);
  });

  it("bounds snapshot arrivals without turning the bounds into a rate", () => {
    const snapshot = [point(82, 0, "snapshot")];
    expect(boundPercentArrival(snapshot, 82, "run")).toEqual({
      byInclusive: minute(0),
    });
    expect(boundPercentArrival(snapshot, 83, "run")).toEqual({
      afterExclusive: minute(0),
    });
    expect(extractObservationEvidence(snapshot).measuredSegments).toEqual([]);
  });

  it("constrains an arrival between snapshots to an interval", () => {
    const samples = [point(82, 0, "snapshot"), point(83, 4, "snapshot")];
    const bounds = boundPercentArrival(samples, 83, "run");
    expect(bounds).toEqual({
      afterExclusive: minute(0),
      byInclusive: minute(4),
    });
    expect(isArrivalConsistentWithBounds(minute(2), bounds)).toBe(true);
    expect(isArrivalConsistentWithBounds(minute(0), bounds)).toBe(false);
    expect(isArrivalConsistentWithBounds(minute(5), bounds)).toBe(false);
  });

  it("does not carry crossing bounds across a reconnect boundary", () => {
    expect(
      boundPercentArrival(
        [
          point(80, 0, "notification"),
          point(85, 15, "snapshot", { breakBefore: true }),
        ],
        84,
        "run"
      )
    ).toEqual({ byInclusive: minute(15) });
  });
});
