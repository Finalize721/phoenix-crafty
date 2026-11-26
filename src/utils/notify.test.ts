import { describe, expect, it } from "vitest";
import { crossedBatteryThresholds } from "./notify";

describe("crossedBatteryThresholds", () => {
  it("returns the 99% threshold crossed as the battery level rises", () => {
    expect(crossedBatteryThresholds(87, 90)).toEqual([]);
    expect(crossedBatteryThresholds(98, 100)).toEqual([99]);
    expect(crossedBatteryThresholds(87, 100)).toEqual([99]);
  });

  it("does not return thresholds on initial, unchanged, or falling levels", () => {
    expect(crossedBatteryThresholds(88, 88)).toEqual([]);
    expect(crossedBatteryThresholds(99, 88)).toEqual([]);
  });
});
