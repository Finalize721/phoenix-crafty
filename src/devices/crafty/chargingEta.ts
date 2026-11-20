import { isWithinHistoryRetention } from "../../utils/historyRetention";
import { predictChargingCurve } from "./chargingCurveModel";

export interface BatterySample {
  level: number;
  time: number;
  sessionId: string;
  breakBefore?: boolean;
  continuousSincePrevious?: boolean;
}

export interface ChargingEta {
  expiresAt: number;
  remainingMinutes?: number;
  source?: "history" | "live";
}

const STORAGE_KEY = "craftyChargingHistory";
const MAX_SAMPLES = 2500;
const CHARGING_WINDOW_MS = 30 * 60 * 1000;
const MAX_RATE_INTERVAL_MS = 60 * 60 * 1000;

const storageKey = (deviceId: string) =>
  `${STORAGE_KEY}:${encodeURIComponent(deviceId)}`;

const storeHistory = (deviceId: string, history: BatterySample[]) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(deviceId), JSON.stringify(history));
  } catch {
    // The current session can still estimate charging without persistence.
  }
};

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
    const retained = stored.filter(
      (sample): sample is BatterySample =>
        sample !== null &&
        typeof sample === "object" &&
        Number.isFinite(sample.level) &&
        sample.level >= 0 &&
        sample.level <= 100 &&
        isWithinHistoryRetention(sample.time, now) &&
        typeof sample.sessionId === "string" &&
        Number.isFinite(sample.time) &&
        (sample.breakBefore === undefined ||
          typeof sample.breakBefore === "boolean") &&
        (sample.continuousSincePrevious === undefined ||
          typeof sample.continuousSincePrevious === "boolean")
    );
    if (retained.length !== stored.length) storeHistory(deviceId, retained);
    return retained;
  } catch {
    return [];
  }
};

const appendSample = (
  history: BatterySample[],
  deviceId: string,
  level: number,
  time: number,
  sessionId: string,
  continuity: Pick<
    BatterySample,
    "breakBefore" | "continuousSincePrevious"
  > = {}
) => {
  const next = [
    ...history.filter((sample) => isWithinHistoryRetention(sample.time, time)),
    { level, time, sessionId, ...continuity },
  ].slice(-MAX_SAMPLES);
  storeHistory(deviceId, next);
  return next;
};

/** Records a connection's starting level or a subsequent battery change. */
export const recordBatterySample = (
  deviceId: string,
  level: number,
  time = Date.now(),
  sessionId: string,
  history = readChargingHistory(deviceId, time),
  continuity: Pick<
    BatterySample,
    "breakBefore" | "continuousSincePrevious"
  > = {}
) => {
  if (!Number.isFinite(level) || level < 0 || level > 100) return [];
  const retained = history.filter((sample) =>
    isWithinHistoryRetention(sample.time, time)
  );
  if (retained.length !== history.length) storeHistory(deviceId, retained);
  const latest = retained[retained.length - 1];
  if (latest?.level === level && latest.sessionId === sessionId)
    return retained;
  if (latest && time <= latest.time) return retained;
  return appendSample(retained, deviceId, level, time, sessionId, continuity);
};

/** Crafty has no charging flag, so a recent same-session rise establishes it. */
export const estimateChargingEta = (
  samples: BatterySample[],
  level: number,
  sessionId: string,
  now = Date.now()
): ChargingEta | undefined => {
  const previous = samples[samples.length - 2];
  const latest = samples[samples.length - 1];
  if (
    level >= 100 ||
    !previous ||
    !latest ||
    previous.sessionId !== sessionId ||
    latest.sessionId !== sessionId ||
    latest.level <= previous.level ||
    latest.time - previous.time > MAX_RATE_INTERVAL_MS ||
    now - latest.time > CHARGING_WINDOW_MS
  ) {
    return;
  }

  const expiresAt = latest.time + CHARGING_WINDOW_MS;
  const prediction = predictChargingCurve(samples, level, sessionId, now);
  if (!prediction) return { expiresAt };
  return {
    expiresAt,
    remainingMinutes: prediction.remainingMinutes,
    source: prediction.source,
  };
};
