/**
 * Phoenix Crafty charging-vs-usage evidence for the Crafty+ BLE protocol.
 * The driver exposes no confirmed charger-connected signal.
 */
export type SampleOrigin = "snapshot" | "notification" | "legacy";

export interface ActivitySample {
  level: number;
  time: number;
  sessionId: string;
  origin?: SampleOrigin;
  breakBefore?: boolean;
  continuousSincePrevious?: boolean;
  heaterActive?: boolean;
}

export interface ChargingInterval {
  from: number;
  to: number;
  elapsedMinutes: number;
  sessionId: string;
  startTime: number;
  endTime: number;
}

export type ActivityState =
  | "full"
  | "using"
  | "discharging"
  | "charging-likely"
  | "unknown";

export interface ChargingEvidence {
  state: ActivityState;
  showEta: boolean;
  manualOnly: boolean;
  canComputeHistoricalEta: boolean;
  chargingIntervals: ChargingInterval[];
}

export interface ChargingOptions {
  now?: number;
  userChargingHintAt?: number;
  userHintMaxAgeMs?: number;
}

export const DEFAULT_USER_HINT_MAX_AGE_MS = 3 * 60_000;

const MINUTE = 60_000;
const MAX_CONTINUITY_GAP = 12 * MINUTE;
const STATUS_FRESHNESS = 10 * MINUTE;

const isValidSample = (sample: ActivitySample) =>
  sample &&
  typeof sample.sessionId === "string" &&
  Number.isFinite(sample.time) &&
  Number.isFinite(sample.level) &&
  sample.level >= 0 &&
  sample.level <= 100;

const continuousRise = (a: ActivitySample, b: ActivitySample) =>
  a.sessionId === b.sessionId &&
  b.time > a.time &&
  (b.time - a.time <= MAX_CONTINUITY_GAP ||
    b.continuousSincePrevious === true) &&
  b.breakBefore !== true &&
  b.continuousSincePrevious === true &&
  b.origin === "notification" &&
  b.level > a.level &&
  a.heaterActive === false &&
  b.heaterActive === false;

/** Returns only reliable notification-to-notification charging intervals. */
export function findChargingIntervals(
  samples: readonly ActivitySample[]
): ChargingInterval[] {
  const sorted = samples
    .filter(isValidSample)
    .slice()
    .sort((a, b) => a.time - b.time);
  const groups: ActivitySample[][] = [];
  let active: ActivitySample[] = [];

  for (const sample of sorted) {
    const previous = active[active.length - 1];
    if (!previous || !continuousRise(previous, sample)) {
      if (active.length > 1) groups.push(active);
      active = [sample];
    } else {
      active.push(sample);
    }
  }
  if (active.length > 1) groups.push(active);

  return groups.flatMap((group) => {
    const risingEvents = group.slice(1);
    const duration = group[group.length - 1].time - group[0].time;
    if (
      risingEvents.length < 2 ||
      group[group.length - 1].level - group[0].level < 2 ||
      duration < 2 * MINUTE
    ) {
      return [];
    }

    const intervals: ChargingInterval[] = [];
    for (let index = 1; index < group.length; index++) {
      const before = group[index - 1];
      const after = group[index];
      if (before.origin !== "notification") continue;
      intervals.push({
        from: before.level,
        to: after.level,
        elapsedMinutes: (after.time - before.time) / MINUTE,
        sessionId: after.sessionId,
        startTime: before.time,
        endTime: after.time,
      });
    }
    return intervals;
  });
}

/** Assesses current connection activity without asserting a physical charger signal. */
export function assessChargingActivity(
  samples: readonly ActivitySample[],
  currentSessionId: string,
  options: ChargingOptions = {}
): ChargingEvidence {
  const now = options.now ?? Date.now();
  const current = samples
    .filter(
      (sample) => isValidSample(sample) && sample.sessionId === currentSessionId
    )
    .slice()
    .sort((a, b) => a.time - b.time);
  const last = current[current.length - 1];
  const allIntervals = findChargingIntervals(samples);
  let fragmentStart = current.length - 1;

  while (
    fragmentStart > 0 &&
    continuousRise(current[fragmentStart - 1], current[fragmentStart])
  ) {
    fragmentStart--;
  }

  const latestFragment = current.slice(fragmentStart);
  const eligible = findChargingIntervals(latestFragment);
  const unknown: ChargingEvidence = {
    state: "unknown",
    showEta: false,
    manualOnly: false,
    canComputeHistoricalEta: false,
    chargingIntervals: allIntervals,
  };
  if (!last || last.time > now || now - last.time > STATUS_FRESHNESS) {
    return unknown;
  }

  const base = { ...unknown, canComputeHistoricalEta: last.level < 99 };
  if (last.level >= 99) return { ...base, state: "full" };
  if (last.heaterActive === true) return { ...base, state: "using" };

  const previous = current[current.length - 2];
  if (
    previous &&
    last.level < previous.level &&
    last.breakBefore !== true &&
    last.origin === "notification" &&
    last.continuousSincePrevious === true
  ) {
    return { ...base, state: "discharging" };
  }
  if (eligible.some((interval) => now - interval.endTime <= STATUS_FRESHNESS)) {
    return { ...base, state: "charging-likely", showEta: true };
  }

  const hint = options.userChargingHintAt;
  const hintDuration = options.userHintMaxAgeMs ?? DEFAULT_USER_HINT_MAX_AGE_MS;
  if (
    hint !== undefined &&
    Number.isFinite(hint) &&
    now >= hint &&
    now - hint <= hintDuration
  ) {
    return { ...base, showEta: true, manualOnly: true };
  }
  return base;
}
