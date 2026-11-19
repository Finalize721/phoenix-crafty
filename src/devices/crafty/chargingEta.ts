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
const MAX_SAMPLES = 40;
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CHARGING_WINDOW_MS = 30 * 60 * 1000;
const MAX_RATE_INTERVAL_MS = 60 * 60 * 1000;
const MIN_RATE_INTERVAL_MS = 60 * 1000;
const RATE_SAMPLE_COUNT = 8;

const storageKey = (deviceId: string) =>
  `${STORAGE_KEY}:${encodeURIComponent(deviceId)}`;

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
    return stored.filter(
      (sample): sample is BatterySample =>
        sample !== null &&
        typeof sample === "object" &&
        Number.isFinite(sample.level) &&
        sample.level >= 0 &&
        sample.level <= 100 &&
        Number.isFinite(sample.time) &&
        typeof sample.sessionId === "string" &&
        sample.time <= now &&
        now - sample.time <= MAX_HISTORY_AGE_MS
    );
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
  const next = [...history, { level, time, sessionId }].slice(-MAX_SAMPLES);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(storageKey(deviceId), JSON.stringify(next));
    } catch {
      // The current session can still estimate charging without persistence.
    }
  }
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
  const latest = history[history.length - 1];
  if (latest?.level === level && latest.sessionId === sessionId) return history;
  if (latest && time <= latest.time) return history;
  return appendSample(history, deviceId, level, time, sessionId);
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

  const rates: number[] = [];
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
      rates.push((increase * 60 * 60 * 1000) / elapsed);
    }
  }

  const recentRates = rates.slice(-RATE_SAMPLE_COUNT).sort((a, b) => a - b);
  const expiresAt = latest.time + CHARGING_WINDOW_MS;
  if (recentRates.length < 2) return { expiresAt };

  const middle = Math.floor(recentRates.length / 2);
  const rate =
    recentRates.length % 2
      ? recentRates[middle]
      : (recentRates[middle - 1] + recentRates[middle]) / 2;
  return {
    expiresAt,
    remainingMinutes: Math.ceil(((100 - level) / rate) * 60),
  };
};
