import { findChargingIntervals } from "./chargingActivity";
import {
  type BatteryObservationOrigin,
  boundPercentArrival,
  isArrivalConsistentWithBounds,
} from "./observationQuality";

export interface BatteryCurveSample {
  level: number;
  time: number;
  sessionId: string;
  origin?: BatteryObservationOrigin;
  breakBefore?: boolean;
  continuousSincePrevious?: boolean;
  heaterActive?: boolean;
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

export interface CurvePredictionDiagnostics {
  input: {
    currentLevel: number;
    currentSessionId: string;
    calculationTime: number;
    historySampleCount: number;
    activeSessionSampleCount: number;
    latestSample?: BatteryCurveSample;
  };
  fallbackReason: string | null;
  baseline:
    | {
        method: "completed_runs" | "verified_segments" | "provisional_segments";
        minutes: number;
        coverage: number;
        runCount: number;
      }
    | undefined;
  liveAdjustment: {
    factor: number;
    applied: boolean;
    firstSample?: BatteryCurveSample;
    elapsedMinutes?: number;
    historicalMinutes?: number;
    ratio?: number;
    liveRateMinutesPerPercent?: number;
    liveRemainingMinutes?: number;
  };
  selectedIntervals: Array<{
    method:
      | "completed_run"
      | "verified_segment"
      | "provisional_segment"
      | "live_segment";
    sessionId: string;
    fromLevel: number;
    toLevel: number;
    startTime: number;
    endTime: number;
    elapsedMinutes: number;
    minutesPerPercent?: number;
    usedMinutes?: number;
  }>;
  rateUses?: Array<{
    fromLevel: number;
    toLevel: number;
    minutesPerPercent: number;
    durationMinutes: number;
    method: "measured" | "interpolated";
  }>;
  coverageCandidates: {
    verified?: {
      coverage: number;
      runCount: number;
      observedNearTarget: boolean;
      acceptedByEstimator: boolean;
      rejectionReasons: string[];
    };
    provisional?: {
      coverage: number;
      runCount: number;
      observedNearTarget: boolean;
      acceptedByEstimator: boolean;
      rejectionReasons: string[];
    };
  };
}

type Run = { sessionId: string; points: BatteryCurveSample[] };
export interface ChargingRateSegment {
  from: number;
  to: number;
  elapsedMinutes: number;
  minutesPerPercent: number;
  sessionId: string;
  startTime: number;
  endTime: number;
  kind?: "gauge_jump";
}
type Segment = ChargingRateSegment;

interface SegmentEstimateAudit {
  coverage?: number;
  runCount?: number;
  rateUses?: NonNullable<CurvePredictionDiagnostics["rateUses"]>;
  selectedSegments?: Segment[];
}

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
  const bounds = boundPercentArrival(run.points, level, run.sessionId);
  for (const interval of findChargingIntervals(run.points)) {
    if (level <= interval.from || level > interval.to) continue;
    const arrival =
      interval.startTime +
      ((level - interval.from) / (interval.to - interval.from)) *
        (interval.endTime - interval.startTime);
    if (isArrivalConsistentWithBounds(arrival, bounds)) return arrival;
  }
  return undefined;
};

const observedTarget = (run: Run): boolean => atLevel(run, 99) !== undefined;

const toSegments = (runs: Run[]): Segment[] => {
  const segments: Segment[] = [];
  for (const run of runs) {
    for (const interval of findChargingIntervals(run.points)) {
      const elapsed = interval.elapsedMinutes;
      if (elapsed <= 0 || elapsed > 120) continue;
      const minutesPerPercent = elapsed / (interval.to - interval.from);
      if (minutesPerPercent < 0.1 || minutesPerPercent > 40) {
        continue;
      }
      segments.push({
        from: interval.from,
        to: interval.to,
        elapsedMinutes: elapsed,
        minutesPerPercent,
        sessionId: interval.sessionId,
        startTime: interval.startTime,
        endTime: interval.endTime,
      });
    }
  }
  return segments;
};

/**
 * Crafty+ can report a large, repeatable jump to 80% while surrounding
 * percentage changes arrive at a normal charging cadence. This is NOT a set
 * of 1%-arrival timestamps: it only bounds one observed aggregate jump.
 *
 * Reject batched/replayed notifications (millisecond cadence) and app gaps.
 * Require corroboration from independent sessions before using the jump
 * to avoid extrapolating ~40 fictitious minutes across the missing band.
 */
const observedGaugeJumps = (runs: Run[]): Segment[] => {
  const candidates: Segment[] = [];
  for (const run of runs) {
    const points = run.points;
    for (let index = 2; index < points.length - 1; index++) {
      const previous = points[index - 2];
      const before = points[index - 1];
      const after = points[index];
      const following = points[index + 1];
      const elapsed = (after.time - before.time) / MINUTE;
      const beforeMs = before.time - previous.time;
      const afterMs = following.time - after.time;
      if (
        before.level < 30 ||
        before.level > 75 ||
        after.level !== 80 ||
        after.level - before.level < 10 ||
        elapsed < 10 / 60 ||
        elapsed > 2 ||
        previous.level !== before.level - 1 ||
        following.level !== after.level + 1 ||
        beforeMs < 20_000 ||
        beforeMs > 120_000 ||
        afterMs < 20_000 ||
        afterMs > 120_000 ||
        [previous, before, after, following].some(
          (sample) =>
            sample.origin === "snapshot" || sample.heaterActive === true
        ) ||
        before.continuousSincePrevious !== true ||
        after.continuousSincePrevious !== true ||
        following.continuousSincePrevious !== true ||
        after.breakBefore === true ||
        following.breakBefore === true
      ) {
        continue;
      }
      candidates.push({
        from: before.level,
        to: after.level,
        elapsedMinutes: elapsed,
        minutesPerPercent: elapsed / (after.level - before.level),
        sessionId: run.sessionId,
        startTime: before.time,
        endTime: after.time,
        kind: "gauge_jump",
      });
    }
  }
  return new Set(candidates.map((segment) => segment.sessionId)).size >= 2
    ? candidates
    : [];
};

/** Older, uncertain history may support an estimate, never verified rates. */
const toProvisionalSegments = (runs: Run[]): Segment[] => {
  const segments: Segment[] = [];
  for (const run of runs) {
    for (let index = 1; index < run.points.length; index++) {
      const before = run.points[index - 1];
      const after = run.points[index];
      if (
        before.heaterActive === true ||
        after.heaterActive === true ||
        before.origin === "snapshot" ||
        after.origin === "snapshot" ||
        before.breakBefore === true ||
        after.continuousSincePrevious === false
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
        startTime: before.time,
        endTime: after.time,
      });
    }
  }
  segments.push(...observedGaugeJumps(runs));
  return segments;
};

export const collectChargingRateSegments = (
  samples: BatteryCurveSample[],
  excludedSessionId: string
): { verified: ChargingRateSegment[]; provisional: ChargingRateSegment[] } => {
  const history = splitChargingRuns(samples).filter(
    (run) => run.sessionId !== excludedSessionId
  );
  return {
    verified: toSegments(history),
    provisional: toProvisionalSegments(history),
  };
};

const estimateFromSegments = (
  segments: Segment[],
  start: number,
  audit?: SegmentEstimateAudit
):
  | {
      minutes: number;
      coverage: number;
      runCount: number;
      rateUses: NonNullable<CurvePredictionDiagnostics["rateUses"]>;
      selectedSegments: Segment[];
    }
  | undefined => {
  const intervals: {
    position: number;
    low: number;
    high: number;
    minutesPerPercent?: number;
    matching: Segment[];
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
      low,
      high,
      minutesPerPercent: typical,
      matching,
    });
    total += high - low;
  }

  const coverage = total ? directlyCovered / total : 0;
  if (audit) {
    audit.coverage = coverage;
    audit.runCount = contributingSessions.size;
  }
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
  const rateUses: NonNullable<CurvePredictionDiagnostics["rateUses"]> = [];
  const selectedSegments = new Map<string, Segment>();
  for (const interval of intervals) {
    let rate = interval.minutesPerPercent;
    let method: "measured" | "interpolated" =
      interval.matching.length > 0 &&
      interval.matching.every((segment) => segment.kind === "gauge_jump")
        ? "interpolated"
        : "measured";
    let selected = interval.matching;
    if (rate === undefined) {
      const nearest = measured.reduce((best, candidate) =>
        Math.abs(candidate.position - interval.position) <
        Math.abs(best.position - interval.position)
          ? candidate
          : best
      );
      rate = clamp(nearest.minutesPerPercent, overall * 0.5, overall * 2);
      method = "interpolated";
      selected = segments.filter(
        (segment) =>
          segment.from <= nearest.position && segment.to > nearest.position
      );
    }
    const low = Math.max(start, Math.floor(interval.position));
    const high = Math.min(99, Math.floor(interval.position) + 1);
    minutes += (high - low) * rate;
    rateUses.push({
      fromLevel: low,
      toLevel: high,
      minutesPerPercent: rate,
      durationMinutes: (high - low) * rate,
      method,
    });
    for (const segment of selected) {
      selectedSegments.set(
        `${segment.sessionId}:${segment.startTime}:${segment.endTime}`,
        segment
      );
    }
  }
  const result = {
    minutes,
    coverage,
    runCount: contributingSessions.size,
    rateUses,
    selectedSegments: [...selectedSegments.values()],
  };
  if (audit) {
    audit.rateUses = result.rateUses;
    audit.selectedSegments = result.selectedSegments;
  }
  return result;
};

export const predictChargingCurve = (
  samples: BatteryCurveSample[],
  currentLevel: number,
  currentSessionId: string,
  now = Date.now(),
  diagnostics?: CurvePredictionDiagnostics
): CurvePrediction | undefined => {
  const targetLevel = 99;
  const setFallback = (reason: string) => {
    if (diagnostics) diagnostics.fallbackReason = reason;
  };
  if (diagnostics) {
    diagnostics.input = {
      currentLevel,
      currentSessionId,
      calculationTime: now,
      historySampleCount: samples.length,
      activeSessionSampleCount: 0,
    };
    diagnostics.fallbackReason = null;
    diagnostics.baseline = undefined;
    diagnostics.liveAdjustment = { factor: 1, applied: false };
    diagnostics.selectedIntervals = [];
    diagnostics.rateUses = undefined;
    diagnostics.coverageCandidates = {};
  }
  if (
    !Number.isFinite(currentLevel) ||
    currentLevel < 0 ||
    currentLevel >= targetLevel
  ) {
    setFallback(
      currentLevel >= targetLevel
        ? "target_already_reached"
        : "invalid_current_level"
    );
    return undefined;
  }

  const runs = splitChargingRuns(samples);
  const activeRuns = runs.filter((run) => run.sessionId === currentSessionId);
  const active = activeRuns[activeRuns.length - 1];
  const points = active?.points;
  const last = points?.[points.length - 1];
  if (diagnostics) {
    diagnostics.input.activeSessionSampleCount = points?.length ?? 0;
    diagnostics.input.latestSample = last;
  }
  if (!points || !last) {
    setFallback("no_current_session_samples");
    return undefined;
  }
  if (last.level !== currentLevel) {
    setFallback("latest_sample_level_mismatch");
    return undefined;
  }
  if (now < last.time) {
    setFallback("latest_sample_is_in_the_future");
    return undefined;
  }
  if (now - last.time > MAX_FRESHNESS) {
    setFallback("latest_sample_is_stale");
    return undefined;
  }
  const activeIntervals = findChargingIntervals(points);
  const chargingObserved = activeIntervals.some(
    (interval) => last.time - interval.endTime <= RISE_WINDOW
  );

  const history = runs.filter((run) => run.sessionId !== currentSessionId);
  if (history.length) {
    const complete = history.filter(observedTarget);
    // Use all reliable overlapping portions, not only runs that reached 99%.
    let baseline: number | undefined;
    let coverage = 0;
    let runCount = 0;
    let selectedMethod: "verified_segments" | "provisional_segments" | undefined;
    let selectedSegmentSet: Segment[] = [];
    let selectedRateUses: NonNullable<CurvePredictionDiagnostics["rateUses"]> =
      [];
    if (baseline === undefined) {
      const verifiedSegments = toSegments(history);
      const verifiedAudit: SegmentEstimateAudit = {};
      const partial = estimateFromSegments(
        verifiedSegments,
        currentLevel,
        diagnostics ? verifiedAudit : undefined
      );
      const nearTargetWasObserved = verifiedSegments.some(
        (segment) => segment.to >= targetLevel - 2
      );
      const accepted =
        partial &&
        partial.coverage >= 0.7 &&
        nearTargetWasObserved;
      const rejectionReasons = [
        ...(!partial
          ? [
              verifiedAudit.coverage === undefined ||
              verifiedAudit.coverage === 0
                ? "no_verified_segment_coverage"
                : verifiedAudit.coverage < 0.2
                  ? "verified_coverage_below_20_percent"
                  : "no_contributing_verified_sessions",
            ]
          : []),
        ...(partial && partial.coverage < 0.7
          ? ["verified_coverage_below_70_percent"]
          : []),
        ...(partial && !nearTargetWasObserved
          ? ["no_verified_observation_at_or_above_97_percent"]
          : []),
      ];
      if (diagnostics) {
        diagnostics.coverageCandidates.verified = {
          coverage: verifiedAudit.coverage ?? partial?.coverage ?? 0,
          runCount: verifiedAudit.runCount ?? partial?.runCount ?? 0,
          observedNearTarget: nearTargetWasObserved,
          acceptedByEstimator: Boolean(accepted),
          rejectionReasons,
        };
      }
      if (accepted && partial) {
        baseline = partial.minutes;
        coverage = partial.coverage;
        runCount = partial.runCount;
        selectedMethod = "verified_segments";
        selectedSegmentSet = partial.selectedSegments;
        selectedRateUses = partial.rateUses;
      }
    }

    if (baseline === undefined) {
      const provisionalSegments = toProvisionalSegments(history);
      const provisionalAudit: SegmentEstimateAudit = {};
      const provisional = estimateFromSegments(
        provisionalSegments,
        currentLevel,
        diagnostics ? provisionalAudit : undefined
      );
      const nearTargetWasObserved = history.some((run) =>
        run.points.some(
          (point) =>
            point.heaterActive !== true &&
            point.origin !== "snapshot" &&
            point.level >= targetLevel - 2
        )
      );
      const accepted =
        provisional && provisional.coverage >= 0.7 && nearTargetWasObserved;
      const rejectionReasons = [
        ...(!provisional
          ? [
              provisionalAudit.coverage === undefined ||
              provisionalAudit.coverage === 0
                ? "no_provisional_segment_coverage"
                : provisionalAudit.coverage < 0.2
                  ? "provisional_coverage_below_20_percent"
                  : "no_contributing_provisional_sessions",
            ]
          : []),
        ...(provisional && provisional.coverage < 0.7
          ? ["provisional_coverage_below_70_percent"]
          : []),
        ...(provisional && !nearTargetWasObserved
          ? ["no_provisional_observation_at_or_above_97_percent"]
          : []),
      ];
      if (diagnostics) {
        diagnostics.coverageCandidates.provisional = {
          coverage: provisionalAudit.coverage ?? provisional?.coverage ?? 0,
          runCount: provisionalAudit.runCount ?? provisional?.runCount ?? 0,
          observedNearTarget: nearTargetWasObserved,
          acceptedByEstimator: Boolean(accepted),
          rejectionReasons,
        };
      }
      if (accepted && provisional) {
        baseline = provisional.minutes;
        coverage = provisional.coverage;
        runCount = provisional.runCount;
        selectedMethod = "provisional_segments";
        selectedSegmentSet = provisional.selectedSegments;
        selectedRateUses = provisional.rateUses;
      }
    }

    if (baseline !== undefined && Number.isFinite(baseline) && baseline > 0) {
      let adjustment = 1;
      let adaptedToLive = false;
      let adjustmentDetails: CurvePredictionDiagnostics["liveAdjustment"] = {
        factor: 1,
        applied: false,
      };
      const first = points.find(
        (point) =>
          point.level >= currentLevel - 20 &&
          point.level <= currentLevel - 8 &&
          activeIntervals.some((interval) => interval.startTime === point.time)
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
          adjustmentDetails = {
            factor: adjustment,
            applied: true,
            firstSample: first,
            elapsedMinutes: (last.time - first.time) / MINUTE,
            historicalMinutes: typical,
            ratio,
          };
        }
      }
      if (diagnostics) {
        diagnostics.fallbackReason = null;
        diagnostics.baseline = {
          method: selectedMethod ?? "verified_segments",
          minutes: baseline,
          coverage,
          runCount,
        };
        diagnostics.liveAdjustment = adjustmentDetails;
        diagnostics.rateUses =
          selectedRateUses.length > 0 ? selectedRateUses : undefined;
        diagnostics.selectedIntervals = selectedSegmentSet.map((segment) => ({
            method:
              selectedMethod === "verified_segments"
                ? "verified_segment"
                : "provisional_segment",
            sessionId: segment.sessionId,
            fromLevel: segment.from,
            toLevel: segment.to,
            startTime: segment.startTime,
            endTime: segment.endTime,
            elapsedMinutes: segment.elapsedMinutes,
            minutesPerPercent: segment.minutesPerPercent,
          }));
      }
      return {
        remainingMinutes: Math.max(1, Math.ceil(baseline * adjustment)),
        source: "history",
        targetLevel,
        historicalRunCount: runCount,
        adaptedToLive,
        provisional:
          selectedMethod !== "verified_segments" || coverage < 1 || !chargingObserved,
        chargingObserved,
      };
    }
  }

  if (!chargingObserved) {
    setFallback(
      history.length
        ? "no_historical_baseline_or_recent_verified_charging"
        : "no_historical_samples_or_recent_verified_charging"
    );
    return undefined;
  }
  // Use a contiguous suffix of measured intervals, rather than extrapolating
  // one percentage jump or requiring each individual interval to last 2 min.
  const recent = toSegments([active]).filter(
    (segment) => segment.startTime >= last.time - RISE_WINDOW
  );
  const measured: Segment[] = [];
  let endTime = last.time;
  for (let index = recent.length - 1; index >= 0; index--) {
    const segment = recent[index];
    if (segment.endTime !== endTime) break;
    measured.unshift(segment);
    endTime = segment.startTime;
  }
  const duration = measured.reduce((sum, segment) => sum + segment.elapsedMinutes, 0);
  const gain = measured.reduce((sum, segment) => sum + segment.to - segment.from, 0);
  if (measured.length < 2 || duration < 2 || gain < 2) {
    setFallback("insufficient_contiguous_live_measurements");
    return undefined;
  }
  const rate = duration / gain;
  if (!Number.isFinite(rate) || rate <= 0) {
    setFallback("invalid_live_charging_rate");
    return undefined;
  }
  const remainingMinutes = Math.max(
    1,
    Math.ceil((targetLevel - currentLevel) * rate)
  );
  if (diagnostics) {
    diagnostics.fallbackReason = null;
    diagnostics.liveAdjustment.liveRateMinutesPerPercent = rate;
    diagnostics.liveAdjustment.liveRemainingMinutes = remainingMinutes;
    diagnostics.selectedIntervals = measured.map((segment) => ({
      method: "live_segment",
      sessionId: segment.sessionId,
      fromLevel: segment.from,
      toLevel: segment.to,
      startTime: segment.startTime,
      endTime: segment.endTime,
      elapsedMinutes: segment.elapsedMinutes,
      minutesPerPercent: segment.minutesPerPercent,
    }));
    diagnostics.rateUses = Array.from(
      { length: targetLevel - currentLevel },
      (_, index) => ({
        fromLevel: currentLevel + index,
        toLevel: currentLevel + index + 1,
        minutesPerPercent: rate,
        durationMinutes: rate,
        method: "interpolated" as const,
      })
    );
  }
  return {
    remainingMinutes,
    source: "live",
    targetLevel,
    historicalRunCount: 0,
    adaptedToLive: false,
    provisional: true,
    chargingObserved: true,
  };
};
