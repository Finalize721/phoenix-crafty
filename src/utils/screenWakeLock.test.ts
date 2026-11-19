import { afterEach, expect, it, vi } from "vitest";
import {
  getScreenAwakePreference,
  setScreenAwakePreference,
} from "./screenWakeLock";

afterEach(() => {
  setScreenAwakePreference(false);
  vi.unstubAllGlobals();
});

it("persists the screen-awake preference locally", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });

  setScreenAwakePreference(true);
  expect(getScreenAwakePreference()).toBe(true);
  expect(storage.get("keepScreenAwake")).toBe("true");

  setScreenAwakePreference(false);
  expect(getScreenAwakePreference()).toBe(false);
  expect(storage.get("keepScreenAwake")).toBe("false");
});
