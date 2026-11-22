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

export interface RejectedChargingInterval {
  from: number;
  to: number;
  elapsedMinutes: number;
  fromSessionId: string;
  toSessionId: string;
  startTime: number;
  endTime: number;
  reasons: string[];
}

export interface ChargingIntervalAudit {
  accepted: ChargingInterval[];
  rejected: RejectedChargingInterval[];
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

const transitionRejectionReasons = (
  before: ActivitySample,
  after: ActivitySample
): string[] => [
  ...(before.sessionId === after.sessionId ? [] : ["session_changed"]),
  ...(after.time > before.time ? [] : ["time_not_increasing"]),
  ...(after.time - before.time <= MAX_CONTINUITY_GAP ||
  after.continuousSincePrevious === true
    ? []
    : ["continuity_gap_exceeded"]),
  ...(after.breakBefore === true ? ["interruption_before_observation"] : []),
  ...(after.continuousSincePrevious === true
    ? []
    : ["continuity_not_verified"]),
  ...(after.origin === "notification" ? [] : ["not_a_change_notification"]),
  ...(after.level > before.level ? [] : ["not_a_rising_percentage"]),
  ...(before.heaterActive === false ? [] : ["heater_not_confirmed_off_before"]),
  ...(after.heaterActive === false ? [] : ["heater_not_confirmed_off_after"]),
];

const continuousRise = (a: ActivitySample, b: ActivitySample) =>
  transitionRejectionReasons(a, b).length === 0;

const rejectPair = (
  before: ActivitySample,
  after: ActivitySample,
  reasons: string[]
): RejectedChargingInterval => ({
  from: before.level,
  to: after.level,
  elapsedMinutes: (after.time - before.time) / MINUTE,
  fromSessionId: before.sessionId,
  toSessionId: after.sessionId,
  startTime: before.time,
  endTime: after.time,
  reasons,
});

/** Returns only reliable notification-to-notification charging intervals. */
export function findChargingIntervals(
  samples: readonly ActivitySample[]
): ChargingInterval[] {
  return diagnoseChargingIntervals(samples).accepted;
}

/** Audits the exact transitions used by the charging-interval classifier. */
export function diagnoseChargingIntervals(
  samples: readonly ActivitySample[]
): ChargingIntervalAudit {
  const sorted = samples
    .filter(isValidSample)
    .slice()
    .sort((a, b) => a.time - b.time);
  const groups: { points: ActivitySample[]; pairs: ActivitySample[][] }[] = [];
  const rejected: RejectedChargingInterval[] = [];
  let active: ActivitySample[] = [];

  for (const sample of sorted) {
    const previous = active[active.length - 1];
    if (!previous) {
      active = [sample];
      continue;
    }
    const reasons = transitionRejectionReasons(previous, sample);
    if (reasons.length) {
      if (active.length > 1) {
        groups.push({
          points: active,
          pairs: active.slice(1).map((point, index) => [active[index], point]),
        });
      }
      rejected.push(rejectPair(previous, sample, reasons));
      active = [sample];
    } else {
      active.push(sample);
    }
  }
  if (active.length > 1) {
    groups.push({
      points: active,
      pairs: active.slice(1).map((point, index) => [active[index], point]),
    });
  }

  const accepted: ChargingInterval[] = [];
  for (const group of groups) {
    const first = group.points[0];
    const last = group.points[group.points.length - 1];
    const groupRejections = [
      ...(group.pairs.length < 2 ? ["too_few_rising_observations"] : []),
      ...(last.level - first.level < 2 ? ["total_rise_below_two_percent"] : []),
      ...(last.time - first.time < 2 * MINUTE
        ? ["charging_run_shorter_than_two_minutes"]
        : []),
    ];
    if (groupRejections.length) {
      for (const [before, after] of group.pairs) {
        rejected.push(
          rejectPair(before, after, [
            ...groupRejections,
            ...(before.origin === "notification"
              ? []
              : ["previous_observation_not_a_change_notification"]),
          ])
        );
      }
      continue;
    }

    for (const [before, after] of group.pairs) {
      if (before.origin !== "notification") {
        rejected.push(
          rejectPair(before, after, [
            "previous_observation_not_a_change_notification",
          ])
        );
        continue;
      }
      accepted.push({
        from: before.level,
        to: after.level,
        elapsedMinutes: (after.time - before.time) / MINUTE,
        sessionId: after.sessionId,
        startTime: before.time,
        endTime: after.time,
      });
    }
  }
  return { accepted, rejected };
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
