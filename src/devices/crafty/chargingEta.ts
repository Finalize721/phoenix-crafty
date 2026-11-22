import { isWithinHistoryRetention } from "../../utils/historyRetention";
import { DEFAULT_USER_HINT_MAX_AGE_MS } from "./chargingActivity";
import {
  type BatteryCurveSample,
  type CurvePrediction,
  type CurvePredictionDiagnostics,
  predictChargingCurve,
} from "./chargingCurveModel";

export type BatterySample = BatteryCurveSample;

export interface ChargingEta extends CurvePrediction {
  expiresAt: number;
}

const STORAGE_KEY = "craftyChargingHistory";
const USER_HINT_STORAGE_KEY = "craftyChargingHint";
const MAX_SAMPLES = 2_500;
const MAX_ESTIMATE_AGE_MS = 30 * 60_000;

export const chargingHistoryStorageKey = (deviceId: string) =>
  `${STORAGE_KEY}:${encodeURIComponent(deviceId)}`;
const storageKey = chargingHistoryStorageKey;
const userHintStorageKey = (deviceId: string) =>
  `${USER_HINT_STORAGE_KEY}:${encodeURIComponent(deviceId)}`;

export const readUserChargingHintAt = (
  deviceId: string,
  now = Date.now()
): number | undefined => {
  if (typeof localStorage === "undefined") return undefined;
  const key = userHintStorageKey(deviceId);
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return undefined;
    const timestamp = Number(stored);
    if (
      !Number.isFinite(timestamp) ||
      timestamp > now ||
      now - timestamp > DEFAULT_USER_HINT_MAX_AGE_MS
    ) {
      localStorage.removeItem(key);
      return undefined;
    }
    return timestamp;
  } catch {
    return undefined;
  }
};

export const saveUserChargingHintAt = (
  deviceId: string,
  timestamp: number
): void => {
  if (typeof localStorage === "undefined" || !Number.isFinite(timestamp))
    return;
  try {
    localStorage.setItem(userHintStorageKey(deviceId), String(timestamp));
  } catch {
    // The manual estimate remains available for this session.
  }
};

export const clearUserChargingHintAt = (deviceId: string): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(userHintStorageKey(deviceId));
  } catch {
    // The hint also expires automatically.
  }
};

const storeHistory = (deviceId: string, history: BatterySample[]): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(deviceId), JSON.stringify(history));
  } catch (error) {
    // The live in-memory estimate still works, but future sessions lose data.
    console.warn("Could not persist Crafty charging history:", error);
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
      typeof point.continuousSincePrevious === "boolean") &&
    (point.heaterActive === undefined ||
      typeof point.heaterActive === "boolean") &&
    (point.origin === undefined ||
      point.origin === "snapshot" ||
      point.origin === "notification" ||
      point.origin === "legacy")
  );
};

export const selectEstimatorBatteryHistory = (
  stored: unknown,
  now = Date.now()
): BatterySample[] =>
  Array.isArray(stored)
    ? stored
        .filter((sample) => isBatterySample(sample, now))
        .slice(-MAX_SAMPLES)
    : [];

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
    const retained = selectEstimatorBatteryHistory(stored, now);
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
  flags: Pick<
    BatterySample,
    "breakBefore" | "continuousSincePrevious" | "origin" | "heaterActive"
  > = {}
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
      ...(flags.origin ? { origin: flags.origin } : {}),
      ...(flags.breakBefore ? { breakBefore: true } : {}),
      ...(flags.continuousSincePrevious === true && !flags.breakBefore
        ? { continuousSincePrevious: true }
        : {}),
      ...(flags.heaterActive !== undefined
        ? { heaterActive: flags.heaterActive }
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
): ChargingEta | undefined =>
  diagnoseChargingEta(samples, level, sessionId, now).estimate;

export interface ChargingEtaDiagnosis {
  estimate?: ChargingEta;
  diagnostics: CurvePredictionDiagnostics;
}

export const diagnoseChargingEta = (
  samples: BatterySample[],
  level: number,
  sessionId: string,
  now = Date.now()
): ChargingEtaDiagnosis => {
  const diagnostics: CurvePredictionDiagnostics = {
    input: {
      currentLevel: level,
      currentSessionId: sessionId,
      calculationTime: now,
      historySampleCount: samples.length,
      activeSessionSampleCount: 0,
    },
    fallbackReason: null,
    baseline: undefined,
    liveAdjustment: { factor: 1, applied: false },
    selectedIntervals: [],
    coverageCandidates: {},
  };
  const prediction = predictChargingCurve(
    samples,
    level,
    sessionId,
    now,
    diagnostics
  );
  if (!prediction) return { diagnostics };
  const latest = [...samples]
    .reverse()
    .find((sample) => sample.sessionId === sessionId);
  if (!latest) {
    diagnostics.fallbackReason = "no_latest_sample_for_estimate_expiry";
    return { diagnostics };
  }
  return {
    estimate: {
      ...prediction,
      expiresAt: latest.time + MAX_ESTIMATE_AGE_MS,
    },
    diagnostics,
  };
};
