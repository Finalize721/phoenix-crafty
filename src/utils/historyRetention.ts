import { createSignal } from "solid-js";

const STORAGE_KEY = "historyRetentionDays";
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_HISTORY_RETENTION_DAYS = 30;
export const MAX_HISTORY_RETENTION_DAYS = 3650;

const isValidDays = (days: number) =>
  Number.isInteger(days) && days >= 1 && days <= MAX_HISTORY_RETENTION_DAYS;

const readDays = () => {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return isValidDays(stored) ? stored : DEFAULT_HISTORY_RETENTION_DAYS;
  } catch {
    return DEFAULT_HISTORY_RETENTION_DAYS;
  }
};

const [historyRetentionDays, setValue] = createSignal(readDays());

export const getHistoryRetentionDays = historyRetentionDays;

export const setHistoryRetentionDays = (days: number) => {
  if (!isValidDays(days)) return false;
  try {
    localStorage.setItem(STORAGE_KEY, String(days));
  } catch {
    // Apply the preference for this session if storage is unavailable.
  }
  setValue(days);
  return true;
};

export const isWithinHistoryRetention = (
  timestamp: number,
  now = Date.now(),
  days = getHistoryRetentionDays()
) =>
  Number.isFinite(timestamp) &&
  timestamp <= now &&
  now - timestamp <= days * DAY_MS;
