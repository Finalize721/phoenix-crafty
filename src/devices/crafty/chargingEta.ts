import { isWithinHistoryRetention } from "../../utils/historyRetention";
import {
  type BatteryCurveSample,
  type CurvePrediction,
  predictChargingCurve,
} from "./chargingCurveModel";

export type BatterySample = BatteryCurveSample;

export interface ChargingEta extends CurvePrediction {
  expiresAt: number;
}

const STORAGE_KEY = "craftyChargingHistory";
const MAX_SAMPLES = 2_500;
const MAX_ESTIMATE_AGE_MS = 30 * 60_000;

const storageKey = (deviceId: string) =>
  `${STORAGE_KEY}:${encodeURIComponent(deviceId)}`;

const storeHistory = (deviceId: string, history: BatterySample[]): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(deviceId), JSON.stringify(history));
  } catch {
    // Storage may be restricted, but current-session estimation still works.
  }
};

const isBatterySample = (
  sample: unknown,
  now: number
): sample is BatterySample => {
  if (!sample || typeof sample !== "object") return false;
  const point = sample as Record<string, unknown>;
  return (
    typeof point.level === "number" &&
    Number.isFinite(point.level) &&
    point.level >= 0 &&
    point.level <= 100 &&
    typeof point.time === "number" &&
    Number.isFinite(point.time) &&
    isWithinHistoryRetention(point.time, now) &&
    typeof point.sessionId === "string" &&
    (point.breakBefore === undefined ||
      typeof point.breakBefore === "boolean") &&
    (point.continuousSincePrevious === undefined ||
      typeof point.continuousSincePrevious === "boolean")
  );
};

/** Read existing history from the same per-device key and legacy format. */
export const readChargingHistory = (
  deviceId: string,
  now = Date.now()
): BatterySample[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(storageKey(deviceId)) || "[]"
    );
    if (!Array.isArray(stored)) return [];
    const retained = stored
      .filter((sample) => isBatterySample(sample, now))
      .slice(-MAX_SAMPLES);
    if (retained.length !== stored.length) storeHistory(deviceId, retained);
    return retained;
  } catch {
    return [];
  }
};

/**
 * Persist genuine battery readings. Pass continuity flags only when supported
 * by observed visibility and BLE connection state.
 */
export const recordBatterySample = (
  deviceId: string,
  level: number,
  time = Date.now(),
  sessionId: string,
  history: BatterySample[] = readChargingHistory(deviceId, time),
  flags: Pick<BatterySample, "breakBefore" | "continuousSincePrevious"> = {}
): BatterySample[] => {
  if (
    !Number.isFinite(level) ||
    level < 0 ||
    level > 100 ||
    !Number.isFinite(time)
  ) {
    return history;
  }
  const retained = history.filter((sample) => isBatterySample(sample, time));
  const latest = retained[retained.length - 1];
  if (latest && time <= latest.time) return retained;
  if (
    latest?.level === level &&
    latest.sessionId === sessionId &&
    !flags.breakBefore
  ) {
    return retained;
  }
  const next = [
    ...retained,
    {
      level,
      time,
      sessionId,
      ...(flags.breakBefore ? { breakBefore: true } : {}),
      ...(flags.continuousSincePrevious === true && !flags.breakBefore
        ? { continuousSincePrevious: true }
        : {}),
    },
  ].slice(-MAX_SAMPLES);
  storeHistory(deviceId, next);
  return next;
};

/** Historical estimates do not establish that the device is charging. */
export const estimateChargingEta = (
  samples: BatterySample[],
  level: number,
  sessionId: string,
  now = Date.now()
): ChargingEta | undefined => {
  const prediction = predictChargingCurve(samples, level, sessionId, now);
  if (!prediction) return undefined;
  const latest = [...samples]
    .reverse()
    .find((sample) => sample.sessionId === sessionId);
  if (!latest) return undefined;
  return {
    ...prediction,
    expiresAt: latest.time + MAX_ESTIMATE_AGE_MS,
  };
};
