import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOW_BATTERY_SETTINGS,
  getLowBatterySettings,
  isValidLowBatteryThreshold,
  setLowBatteryShutdownEnabled,
  setLowBatteryThreshold,
  setLowBatteryWarningEnabled,
} from "./lowBatterySettings";

const storageMock = (storage: Map<string, string>) => ({
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});

afterEach(() => {
  setLowBatteryThreshold(DEFAULT_LOW_BATTERY_SETTINGS.threshold);
  setLowBatteryWarningEnabled(false);
  setLowBatteryShutdownEnabled(false);
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("low-battery settings", () => {
  it("accepts only integer thresholds from 1 to 99", () => {
    expect(isValidLowBatteryThreshold(1)).toBe(true);
    expect(isValidLowBatteryThreshold(99)).toBe(true);
    expect(isValidLowBatteryThreshold(0)).toBe(false);
    expect(isValidLowBatteryThreshold(100)).toBe(false);
    expect(isValidLowBatteryThreshold(15.5)).toBe(false);
    expect(isValidLowBatteryThreshold("15")).toBe(false);
  });

  it("persists validated settings in localStorage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", storageMock(storage));

    expect(setLowBatteryThreshold(20)).toBe(true);
    expect(setLowBatteryWarningEnabled(true)).toBeUndefined();
    expect(setLowBatteryShutdownEnabled(true)).toBeUndefined();

    expect(getLowBatterySettings()).toEqual({
      threshold: 20,
      warningEnabled: true,
      shutdownEnabled: true,
    });
    expect(JSON.parse(storage.get("craftyLowBatteryProtection") ?? "")).toEqual(
      {
        threshold: 20,
        warningEnabled: true,
        shutdownEnabled: true,
      }
    );
  });

  it("rejects invalid threshold updates", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", storageMock(storage));

    expect(setLowBatteryThreshold(15)).toBe(true);
    expect(setLowBatteryThreshold(0)).toBe(false);
    expect(setLowBatteryThreshold(100)).toBe(false);
    expect(setLowBatteryThreshold(12.5)).toBe(false);
    expect(getLowBatterySettings().threshold).toBe(15);
  });

  it("reads persisted valid settings on startup", async () => {
    vi.resetModules();
    const storage = new Map([
      [
        "craftyLowBatteryProtection",
        JSON.stringify({
          threshold: 25,
          warningEnabled: true,
          shutdownEnabled: true,
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", storageMock(storage));

    const module = await import("./lowBatterySettings");

    expect(module.getLowBatterySettings()).toEqual({
      threshold: 25,
      warningEnabled: true,
      shutdownEnabled: true,
    });
  });

  it("falls back to defaults for invalid stored values", async () => {
    vi.resetModules();
    const storage = new Map([
      [
        "craftyLowBatteryProtection",
        JSON.stringify({
          threshold: 100,
          warningEnabled: "yes",
          shutdownEnabled: true,
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", storageMock(storage));

    const module = await import("./lowBatterySettings");

    expect(module.getLowBatterySettings()).toEqual({
      threshold: DEFAULT_LOW_BATTERY_SETTINGS.threshold,
      warningEnabled: false,
      shutdownEnabled: true,
    });
  });
});
