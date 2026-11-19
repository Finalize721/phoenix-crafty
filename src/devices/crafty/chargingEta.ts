import { isWithinHistoryRetention } from "../../utils/historyRetention";

export interface BatterySample {
  level: number;
  time: number;
  sessionId: string;
}

export interface ChargingEta {
  expiresAt: number;
  remainingMinutes?: number;
}

const STORAGE_KEY = "craftyChargingHistory";
const MAX_SAMPLES = 120;
const CHARGING_WINDOW_MS = 30 * 60 * 1000;
const MAX_RATE_INTERVAL_MS = 60 * 60 * 1000;
const MIN_RATE_INTERVAL_MS = 60 * 1000;
const RATE_SAMPLE_COUNT = 8;

type RateSample = { level: number; percentPerHour: number };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const rateBand = (level: number) => (level >= 90 ? 2 : level >= 80 ? 1 : 0);

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
        Number.isFinite(sample.time)
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
  sessionId: string
) => {
  const next = [
    ...history.filter((sample) => isWithinHistoryRetention(sample.time, time)),
    { level, time, sessionId },
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
  history = readChargingHistory(deviceId, time)
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
  return appendSample(retained, deviceId, level, time, sessionId);
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

  const rates: RateSample[] = [];
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1];
    const after = samples[index];
    const elapsed = after.time - before.time;
    const increase = after.level - before.level;
    if (
      before.sessionId === after.sessionId &&
      increase > 0 &&
      elapsed >= MIN_RATE_INTERVAL_MS &&
      elapsed <= MAX_RATE_INTERVAL_MS
    ) {
      rates.push({
        level: after.level,
        percentPerHour: (increase * 60 * 60 * 1000) / elapsed,
      });
    }
  }

  const recentRates = rates
    .slice(-RATE_SAMPLE_COUNT)
    .map((sample) => sample.percentPerHour);
  const expiresAt = latest.time + CHARGING_WINDOW_MS;
  if (recentRates.length < 2) return { expiresAt };

  const overallRate = median(recentRates);
  const ratesByBand: number[][] = [[], [], []];
  for (const sample of rates) {
    ratesByBand[rateBand(sample.level)].push(sample.percentPerHour);
  }
  const bandRates = ratesByBand.map((bandRates) =>
    bandRates.length > 0
      ? median(bandRates.slice(-RATE_SAMPLE_COUNT))
      : overallRate
  );
  let remainingMinutes = 0;
  for (let percent = Math.floor(level); percent < 100; percent++) {
    const fraction = Math.min(1, percent + 1 - level);
    const rate = bandRates[rateBand(percent)];
    remainingMinutes += (fraction * 60) / rate;
  }
  return {
    expiresAt,
    remainingMinutes: Math.ceil(remainingMinutes),
  };
};
