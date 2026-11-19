import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_HISTORY_RETENTION_DAYS,
  getHistoryRetentionDays,
  isWithinHistoryRetention,
  MAX_HISTORY_RETENTION_DAYS,
  setHistoryRetentionDays,
} from "./historyRetention";

afterEach(() => {
  setHistoryRetentionDays(DEFAULT_HISTORY_RETENTION_DAYS);
  vi.unstubAllGlobals();
});

it("persists a custom retention period and rejects out-of-range values", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });

  expect(setHistoryRetentionDays(45)).toBe(true);
  expect(getHistoryRetentionDays()).toBe(45);
  expect(storage.get("historyRetentionDays")).toBe("45");
  expect(setHistoryRetentionDays(0)).toBe(false);
  expect(setHistoryRetentionDays(MAX_HISTORY_RETENTION_DAYS + 1)).toBe(false);
  expect(getHistoryRetentionDays()).toBe(45);
});

it("checks timestamps against the selected retention period", () => {
  const now = 60 * 24 * 60 * 60 * 1000;
  expect(
    isWithinHistoryRetention(now - 29 * 24 * 60 * 60 * 1000, now, 30)
  ).toBe(true);
  expect(
    isWithinHistoryRetention(now - 31 * 24 * 60 * 60 * 1000, now, 30)
  ).toBe(false);
});
