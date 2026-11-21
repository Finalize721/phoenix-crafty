import {
  type BatteryObservationOrigin,
  boundPercentArrival,
  extractObservationEvidence,
  isArrivalConsistentWithBounds,
} from "./observationQuality";

export interface BatteryCurveSample {
  level: number;
  time: number;
  sessionId: string;
  origin?: BatteryObservationOrigin;
  breakBefore?: boolean;
  continuousSincePrevious?: boolean;
}

export interface CurvePrediction {
  remainingMinutes: number;
  source: "history" | "live";
  targetLevel: 99;
  historicalRunCount: number;
  adaptedToLive: boolean;
  provisional: boolean;
  chargingObserved: boolean;
}

type Run = { sessionId: string; points: BatteryCurveSample[] };
type Segment = {
  from: number;
  to: number;
  elapsedMinutes: number;
  minutesPerPercent: number;
  sessionId: string;
};

const MINUTE = 60_000;
const MAX_GAP = 12 * MINUTE;
const MAX_FRESHNESS = 30 * MINUTE;
const RISE_WINDOW = 30 * MINUTE;

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const splitChargingRuns = (samples: BatteryCurveSample[]): Run[] => {
  const ordered = samples
    .filter(
      (point) =>
        point &&
        typeof point.sessionId === "string" &&
        Number.isFinite(point.level) &&
        point.level >= 0 &&
        point.level <= 100 &&
        Number.isFinite(point.time)
    )
    .sort((a, b) => a.time - b.time);

  const runs: Run[] = [];
  let current: Run | undefined;
  for (const point of ordered) {
    const previous = current?.points[current.points.length - 1];
    if (
      !previous ||
      point.sessionId !== current?.sessionId ||
      point.breakBefore === true ||
      point.time <= previous.time ||
      point.level < previous.level ||
      (point.time - previous.time > MAX_GAP &&
        point.continuousSincePrevious !== true)
    ) {
      current = { sessionId: point.sessionId, points: [] };
      runs.push(current);
    }
    if (current) current.points.push(point);
  }
  return runs;
};

const atLevel = (run: Run, level: number): number | undefined => {
  const evidence = extractObservationEvidence(run.points);
  const bounds = boundPercentArrival(run.points, level, run.sessionId);
  const observed = evidence.transitions.find(
    (arrival) => arrival.level === level
  );
  if (observed && isArrivalConsistentWithBounds(observed.at, bounds)) {
    return observed.at;
  }
  for (const segment of evidence.measuredSegments) {
    const arrival = segment.arrivals.find((item) => item.level === level);
    if (arrival && isArrivalConsistentWithBounds(arrival.at, bounds)) {
      return arrival.at;
    }
  }
  return undefined;
};

const observedTarget = (run: Run): boolean => {
  return (
    extractObservationEvidence(run.points).observed99ArrivalAt !== undefined
  );
};

const toSegments = (runs: Run[]): Segment[] => {
  const segments: Segment[] = [];
  for (const run of runs) {
    const evidence = extractObservationEvidence(run.points);
    for (const measured of evidence.measuredSegments) {
      const elapsed = measured.elapsedMs / MINUTE;
      if (elapsed <= 0 || elapsed > 120) continue;
      const minutesPerPercent =
        elapsed / (measured.toLevel - measured.fromLevel);
      if (minutesPerPercent < 0.1 || minutesPerPercent > 40) {
        continue;
      }
      segments.push({
        from: measured.fromLevel,
        to: measured.toLevel,
        elapsedMinutes: elapsed,
        minutesPerPercent,
        sessionId: measured.sessionId,
      });
    }
  }
  return segments;
};

const toLegacySegments = (runs: Run[]): Segment[] => {
  const segments: Segment[] = [];
  for (const run of runs) {
    for (let index = 1; index < run.points.length; index++) {
      const before = run.points[index - 1];
      const after = run.points[index];
      if (
        (before.origin !== undefined && before.origin !== "legacy") ||
        (after.origin !== undefined && after.origin !== "legacy")
      ) {
        continue;
      }
      const elapsed = (after.time - before.time) / MINUTE;
      if (after.level <= before.level || elapsed <= 0 || elapsed > 120) {
        continue;
      }
      const minutesPerPercent = elapsed / (after.level - before.level);
      if (minutesPerPercent < 0.1 || minutesPerPercent > 40) continue;
      segments.push({
        from: before.level,
        to: after.level,
        elapsedMinutes: elapsed,
        minutesPerPercent,
        sessionId: run.sessionId,
      });
    }
  }
  return segments;
};
const estimateFromSegments = (
  segments: Segment[],
  start: number
): { minutes: number; coverage: number; runCount: number } | undefined => {
  const intervals: {
    position: number;
    minutesPerPercent?: number;
  }[] = [];
  let total = 0;
  let directlyCovered = 0;
  const contributingSessions = new Set<string>();

  for (let percent = Math.floor(start); percent < 99; percent++) {
    const low = Math.max(start, percent);
    const high = Math.min(99, percent + 1);
    if (high <= low) continue;
    const matching = segments.filter(
      (segment) => segment.from <= low && segment.to >= high
    );
    const typical = median(
      matching.map((segment) => segment.minutesPerPercent)
    );
    if (typical !== undefined) {
      matching.forEach((segment) => {
        contributingSessions.add(segment.sessionId);
      });
      directlyCovered += high - low;
    }
    intervals.push({
      position: (low + high) / 2,
      minutesPerPercent: typical,
    });
    total += high - low;
  }

  const coverage = total ? directlyCovered / total : 0;
  if (!total || coverage < 0.2 || contributingSessions.size === 0)
    return undefined;

  const measured = intervals.filter(
    (interval): interval is typeof interval & { minutesPerPercent: number } =>
      interval.minutesPerPercent !== undefined
  );
  const overall = median(
    measured.map((interval) => interval.minutesPerPercent)
  );
  if (overall === undefined) return undefined;

  let minutes = 0;
  for (const interval of intervals) {
    let rate = interval.minutesPerPercent;
    if (rate === undefined) {
      const nearest = measured.reduce((best, candidate) =>
        Math.abs(candidate.position - interval.position) <
        Math.abs(best.position - interval.position)
          ? candidate
          : best
      );
      rate = clamp(nearest.minutesPerPercent, overall * 0.5, overall * 2);
    }
    const low = Math.max(start, Math.floor(interval.position));
    const high = Math.min(99, Math.floor(interval.position) + 1);
    minutes += (high - low) * rate;
  }
  return {
    minutes,
    coverage,
    runCount: contributingSessions.size,
  };
};

export const predictChargingCurve = (
  samples: BatteryCurveSample[],
  currentLevel: number,
  currentSessionId: string,
  now = Date.now()
): CurvePrediction | undefined => {
  const targetLevel = 99;
  if (
    !Number.isFinite(currentLevel) ||
    currentLevel < 0 ||
    currentLevel >= targetLevel
  ) {
    return undefined;
  }

  const runs = splitChargingRuns(samples);
  const activeRuns = runs.filter((run) => run.sessionId === currentSessionId);
  const active = activeRuns[activeRuns.length - 1];
  const points = active?.points;
  const last = points?.[points.length - 1];
  if (
    !points ||
    !last ||
    last.level !== currentLevel ||
    now < last.time ||
    now - last.time > MAX_FRESHNESS
  ) {
    return undefined;
  }
  const activeEvidence = extractObservationEvidence(points);
  const chargingObserved = activeEvidence.transitions.some(
    (arrival) => last.time - arrival.at <= RISE_WINDOW
  );

  const history = runs.filter((run) => run.sessionId !== currentSessionId);
  if (history.length) {
    const complete = history.filter(observedTarget);
    const exact = complete.flatMap((run) => {
      const from = atLevel(run, currentLevel);
      const to = atLevel(run, targetLevel);
      return from !== undefined && to !== undefined && to > from
        ? [{ minutes: (to - from) / MINUTE }]
        : [];
    });
    let baseline = median(exact.map((run) => run.minutes));
    let coverage = exact.length ? 1 : 0;
    let runCount = exact.length;
    const verifiedFullRun = exact.length > 0;

    if (baseline === undefined) {
      const verifiedSegments = toSegments(history);
      const partial = estimateFromSegments(verifiedSegments, currentLevel);
      const nearTargetWasObserved = verifiedSegments.some(
        (segment) => segment.to >= targetLevel - 2
      );
      if (
        partial &&
        (complete.length > 0 ||
          (partial.coverage >= 0.7 && nearTargetWasObserved))
      ) {
        baseline = partial.minutes;
        coverage = partial.coverage;
        runCount = partial.runCount;
      }
    }

    if (baseline === undefined) {
      const legacySegments = toLegacySegments(history);
      const legacy = estimateFromSegments(legacySegments, currentLevel);
      const legacyNearTarget = history.some((run) =>
        run.points.some(
          (point) =>
            (point.origin === undefined || point.origin === "legacy") &&
            point.level >= targetLevel - 2
        )
      );
      if (legacy && legacy.coverage >= 0.7 && legacyNearTarget) {
        baseline = legacy.minutes;
        coverage = legacy.coverage;
        runCount = legacy.runCount;
      }
    }

    if (baseline !== undefined && Number.isFinite(baseline) && baseline > 0) {
      let adjustment = 1;
      let adaptedToLive = false;
      const first = points.find(
        (point) =>
          point.level >= currentLevel - 20 && point.level <= currentLevel - 8
      );
      if (first && chargingObserved && last.time - first.time >= 5 * MINUTE) {
        const typical = median(
          complete.flatMap((run) => {
            const from = atLevel(run, first.level);
            const to = atLevel(run, currentLevel);
            return from !== undefined && to !== undefined && to > from
              ? [(to - from) / MINUTE]
              : [];
          })
        );
        if (typical && typical >= 3) {
          const ratio = (last.time - first.time) / MINUTE / typical;
          adjustment = clamp(1 + 0.35 * (ratio - 1), 0.85, 1.15);
          adaptedToLive = true;
        }
      }
      return {
        remainingMinutes: Math.max(1, Math.ceil(baseline * adjustment)),
        source: "history",
        targetLevel,
        historicalRunCount: runCount,
        adaptedToLive,
        provisional: !verifiedFullRun || coverage < 1 || !chargingObserved,
        chargingObserved,
      };
    }
  }

  if (!chargingObserved) return undefined;
  const latestMeasured = toSegments([active]).find(
    (segment) => segment.to === currentLevel
  );
  if (!latestMeasured || latestMeasured.elapsedMinutes < 2) return undefined;
  const rate = latestMeasured.minutesPerPercent;
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return {
    remainingMinutes: Math.max(
      1,
      Math.ceil((targetLevel - currentLevel) * rate)
    ),
    source: "live",
    targetLevel,
    historicalRunCount: 0,
    adaptedToLive: false,
    provisional: true,
    chargingObserved: true,
  };
};
