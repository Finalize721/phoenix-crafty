import {
  type ActivitySample,
  diagnoseChargingIntervals,
  type RejectedChargingInterval,
} from "./chargingActivity";
import {
  type CurvePrediction,
  type CurvePredictionDiagnostics,
  collectChargingRateSegments,
} from "./chargingCurveModel";
import {
  type BatterySample,
  chargingHistoryStorageKey,
  selectEstimatorBatteryHistory,
} from "./chargingEta";
import { extractObservationEvidence } from "./observationQuality";

const TRACE_STORAGE_KEY = "craftyChargingDebugTrace";
const MAX_TRACE_ENTRIES = 200;

export interface EtaTraceSnapshot extends CurvePrediction {
  predictedCompletionAt?: number;
}

export interface Observed99Event {
  observedAt: number;
  observedLevel: number;
  sessionId: string;
  kind:
    | "verified_change_notification"
    | "snapshot_after_interruption"
    | "snapshot_without_verified_continuity"
    | "unverified_notification";
  exactArrivalTime: boolean;
  previousLevel?: number;
  previousTime?: number;
}

export interface ChargingEtaTraceEntry {
  kind: "eta_recalculation";
  recordedAt: number;
  input: {
    deviceId: string;
    currentLevel: number;
    sessionId: string;
    calculationTime: number;
    historySampleCount: number;
    historyFingerprint: string;
    latestSample?: BatterySample;
  };
  previousEta: EtaTraceSnapshot | null;
  updatedEta: EtaTraceSnapshot | null;
  calculation: CurvePredictionDiagnostics;
  observed99?: Observed99Event;
}

const traceStorageKey = (deviceId: string) =>
  `${TRACE_STORAGE_KEY}:${encodeURIComponent(deviceId)}`;

export const fingerprintBatterySamples = (samples: BatterySample[]): string => {
  const serialized = JSON.stringify(samples);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const getStorage = (): Storage => {
  if (typeof localStorage === "undefined") {
    throw new Error("Local storage is unavailable for charging diagnostics.");
  }
  return localStorage;
};

export const appendChargingEtaTrace = (
  deviceId: string,
  entry: ChargingEtaTraceEntry
): void => {
  const storage = getStorage();
  const key = traceStorageKey(deviceId);
  const stored = storage.getItem(key);
  let entries: ChargingEtaTraceEntry[] = [];
  if (stored !== null) {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      throw new Error(`Charging diagnostic trace at ${key} is not an array.`);
    }
    entries = parsed as ChargingEtaTraceEntry[];
  }
  storage.setItem(
    key,
    JSON.stringify([...entries, entry].slice(-MAX_TRACE_ENTRIES))
  );
};

interface StoredJsonValue {
  storageKey: string;
  rawStorageValue: string | null;
  parsedValue?: unknown;
  parseError?: string;
}

const readStoredJson = (key: string): StoredJsonValue => {
  const rawStorageValue = getStorage().getItem(key);
  if (rawStorageValue === null) {
    return { storageKey: key, rawStorageValue, parsedValue: [] };
  }
  try {
    return {
      storageKey: key,
      rawStorageValue,
      parsedValue: JSON.parse(rawStorageValue) as unknown,
    };
  } catch (error) {
    return {
      storageKey: key,
      rawStorageValue,
      parseError:
        error instanceof Error ? error.message : "Unable to parse stored JSON",
    };
  }
};

const asBatterySample = (value: unknown): BatterySample | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const sample = value as Record<string, unknown>;
  if (
    typeof sample.level !== "number" ||
    typeof sample.time !== "number" ||
    typeof sample.sessionId !== "string" ||
    (sample.origin !== undefined &&
      sample.origin !== "snapshot" &&
      sample.origin !== "notification" &&
      sample.origin !== "legacy") ||
    (sample.breakBefore !== undefined &&
      typeof sample.breakBefore !== "boolean") ||
    (sample.continuousSincePrevious !== undefined &&
      typeof sample.continuousSincePrevious !== "boolean") ||
    (sample.heaterActive !== undefined &&
      typeof sample.heaterActive !== "boolean")
  ) {
    return undefined;
  }
  return {
    level: sample.level,
    time: sample.time,
    sessionId: sample.sessionId,
    ...(sample.origin ? { origin: sample.origin } : {}),
    ...(sample.breakBefore !== undefined
      ? { breakBefore: sample.breakBefore }
      : {}),
    ...(sample.continuousSincePrevious !== undefined
      ? { continuousSincePrevious: sample.continuousSincePrevious }
      : {}),
    ...(sample.heaterActive !== undefined
      ? { heaterActive: sample.heaterActive }
      : {}),
  };
};

const asActivitySample = (value: unknown): ActivitySample | undefined => {
  const sample = asBatterySample(value);
  if (!sample) return undefined;
  return {
    level: sample.level,
    time: sample.time,
    sessionId: sample.sessionId,
    origin: sample.origin,
    breakBefore: sample.breakBefore,
    continuousSincePrevious: sample.continuousSincePrevious,
    heaterActive: sample.heaterActive,
  };
};

const observed99Events = (
  samples: Array<{ index: number; sample: BatterySample }>
): Array<Observed99Event & { observationIndex: number }> => {
  const ordered = [...samples].sort((a, b) => a.sample.time - b.sample.time);
  return ordered.flatMap(({ index, sample }, position) => {
    const event = classifyObserved99Arrival(
      sample,
      ordered[position - 1]?.sample
    );
    return event ? [{ observationIndex: index, ...event }] : [];
  });
};

export const classifyObserved99Arrival = (
  sample: BatterySample,
  previous?: BatterySample
): Observed99Event | undefined => {
  if (sample.level < 99) return undefined;
  const verified =
    sample.origin === "notification" &&
    sample.continuousSincePrevious === true &&
    sample.breakBefore !== true &&
    previous?.sessionId === sample.sessionId &&
    previous.level < 99 &&
    sample.time > previous.time;
  const afterInterruption =
    sample.breakBefore === true ||
    sample.continuousSincePrevious !== true ||
    previous?.sessionId !== sample.sessionId;
  return {
    observedAt: sample.time,
    observedLevel: sample.level,
    sessionId: sample.sessionId,
    kind: verified
      ? "verified_change_notification"
      : sample.origin === "snapshot"
        ? afterInterruption
          ? "snapshot_after_interruption"
          : "snapshot_without_verified_continuity"
        : "unverified_notification",
    exactArrivalTime: verified,
    ...(previous
      ? { previousLevel: previous.level, previousTime: previous.time }
      : {}),
  };
};

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const overlapsPercent = (from: number, to: number, percent: number): boolean =>
  Math.min(from, to) < percent + 1 && Math.max(from, to) > percent;

const estimatorRejectionReasons = (interval: {
  from: number;
  to: number;
  elapsedMinutes: number;
}): string[] => {
  const reasons: string[] = [];
  if (interval.elapsedMinutes <= 0 || interval.elapsedMinutes > 120) {
    reasons.push("interval_duration_outside_0_to_120_minutes");
  }
  const minutesPerPercent =
    interval.elapsedMinutes / (interval.to - interval.from);
  if (
    Number.isFinite(minutesPerPercent) &&
    (minutesPerPercent < 0.1 || minutesPerPercent > 40)
  ) {
    reasons.push("rate_outside_0_1_to_40_minutes_per_percent");
  }
  return reasons;
};

const buildCoverageTable = (
  verified: ReturnType<typeof collectChargingRateSegments>["verified"],
  provisional: ReturnType<typeof collectChargingRateSegments>["provisional"],
  rejected: RejectedChargingInterval[],
  currentLevel: number | undefined,
  calculation: CurvePredictionDiagnostics | undefined
) => {
  const rows = Array.from({ length: 99 }, (_, percent) => {
    const measured = verified.filter(
      (segment) => segment.from <= percent && segment.to >= percent + 1
    );
    const provisionalMatches = provisional.filter(
      (segment) => segment.from <= percent && segment.to >= percent + 1
    );
    const used = calculation?.rateUses?.find(
      (rate) => rate.fromLevel <= percent && rate.toLevel >= percent + 1
    );
    const rejectedObservations = rejected.filter((interval) =>
      overlapsPercent(interval.from, interval.to, percent)
    );
    return {
      fromPercent: percent,
      toPercent: percent + 1,
      acceptedObservationCount: measured.length,
      acceptedObservations: measured.map((segment) => ({
        sessionId: segment.sessionId,
        fromPercent: segment.from,
        toPercent: segment.to,
        elapsedMinutes: segment.elapsedMinutes,
        minutesPerPercent: segment.minutesPerPercent,
        startTime: segment.startTime,
        endTime: segment.endTime,
      })),
      individualDurationsMinutes: measured.map(
        (segment) => segment.minutesPerPercent
      ),
      medianDurationMinutes: median(
        measured.map((segment) => segment.minutesPerPercent)
      ),
      provisionalObservationCount: provisionalMatches.length,
      coverage:
        measured.length > 0
          ? "measured"
          : used?.method === "interpolated"
            ? "interpolated"
            : "missing",
      rejectedObservations,
      predictionDurationUsedMinutes: used?.durationMinutes,
      predictionRateUsedMinutesPerPercent: used?.minutesPerPercent,
      predictionRateMethod: used?.method,
      predictionUse:
        used !== undefined
          ? "per_percent_rate"
          : calculation?.baseline?.method === "completed_runs" &&
              currentLevel !== undefined &&
              percent + 1 > currentLevel
            ? "included_in_whole_run_median_not_apportioned"
            : "not_used",
    };
  });

  const measuredCoverage = (start: number, end: number) => {
    let covered = 0;
    for (const row of rows) {
      const overlap =
        Math.min(end, row.toPercent) - Math.max(start, row.fromPercent);
      if (overlap > 0 && row.acceptedObservationCount > 0) covered += overlap;
    }
    const possible = Math.max(0, end - start);
    return {
      coveredPercentPoints: covered,
      possiblePercentPoints: possible,
      fraction: possible > 0 ? covered / possible : null,
    };
  };

  return {
    totalHistorical: measuredCoverage(0, 99),
    remainingRange:
      currentLevel === undefined
        ? null
        : measuredCoverage(Math.max(0, currentLevel), 99),
    intervals: rows,
  };
};

export const downloadChargingDebugExport = (data: object): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `crafty-charging-debug-${new Date()
    .toISOString()
    .replace(/:/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const createChargingDebugExport = (
  deviceId: string,
  application: { version: string; gitCommit: string },
  now = Date.now()
) => {
  const rawBatteryHistory = readStoredJson(chargingHistoryStorageKey(deviceId));
  const rawBatteryObservations = Array.isArray(rawBatteryHistory.parsedValue)
    ? rawBatteryHistory.parsedValue
    : [];
  const indexedSamples = rawBatteryObservations.flatMap((value, index) => {
    const sample = asBatterySample(value);
    return sample ? [{ index, sample }] : [];
  });
  const modelSamples = selectEstimatorBatteryHistory(
    rawBatteryObservations,
    now
  );
  const traceStorage = readStoredJson(traceStorageKey(deviceId));
  const traceEntries = Array.isArray(traceStorage.parsedValue)
    ? (traceStorage.parsedValue as ChargingEtaTraceEntry[])
    : [];
  const latestRecalculation = [...traceEntries]
    .reverse()
    .find((entry) => entry.kind === "eta_recalculation");
  const latestPrediction = [...traceEntries]
    .reverse()
    .find((entry) => entry.kind === "eta_recalculation" && entry.updatedEta);
  const coverageTrace = latestPrediction ?? latestRecalculation;
  const tracedInput = coverageTrace?.input;
  let inputSamples = modelSamples;
  let inputSource: "replayed_trace_input" | "current_saved_history" =
    "current_saved_history";
  if (tracedInput) {
    const asOf = selectEstimatorBatteryHistory(
      rawBatteryObservations,
      tracedInput.calculationTime
    ).slice(0, tracedInput.historySampleCount);
    if (fingerprintBatterySamples(asOf) === tracedInput.historyFingerprint) {
      inputSamples = asOf;
      inputSource = "replayed_trace_input";
    }
  }
  const latestModelSample = modelSamples[modelSamples.length - 1];
  const currentLevel = tracedInput?.currentLevel ?? latestModelSample?.level;
  const currentSessionId =
    tracedInput?.sessionId ?? latestModelSample?.sessionId;
  const rateSegments = currentSessionId
    ? collectChargingRateSegments(inputSamples, currentSessionId)
    : { verified: [], provisional: [] };
  const historyForAudit = indexedSamples
    .map(({ sample }) => asActivitySample(sample))
    .filter((sample): sample is ActivitySample => sample !== undefined);
  const intervalAudit = diagnoseChargingIntervals(historyForAudit);
  const acceptedIntervals = intervalAudit.accepted.map((interval) => {
    const modelExclusionReasons = estimatorRejectionReasons(interval);
    return {
      ...interval,
      estimatorEligible: modelExclusionReasons.length === 0,
      estimatorRejectionReasons: modelExclusionReasons,
    };
  });
  const rejectedForCoverage: RejectedChargingInterval[] = [
    ...intervalAudit.rejected,
    ...acceptedIntervals
      .filter((interval) => !interval.estimatorEligible)
      .map((interval) => ({
        from: interval.from,
        to: interval.to,
        elapsedMinutes: interval.elapsedMinutes,
        fromSessionId: interval.sessionId,
        toSessionId: interval.sessionId,
        startTime: interval.startTime,
        endTime: interval.endTime,
        reasons: interval.estimatorRejectionReasons,
      })),
  ];
  const arrivalEvents = observed99Events(indexedSamples);
  const latestCalculation = latestPrediction?.calculation;
  const coverage = buildCoverageTable(
    rateSegments.verified,
    rateSegments.provisional,
    rejectedForCoverage,
    currentLevel,
    latestCalculation
  );

  const derivedObservations = indexedSamples.map(
    ({ index, sample }, position) => {
      const accepted = intervalAudit.accepted.find(
        (interval) =>
          interval.sessionId === sample.sessionId &&
          interval.endTime === sample.time &&
          interval.to === sample.level
      );
      const rejected = intervalAudit.rejected.find(
        (interval) =>
          interval.toSessionId === sample.sessionId &&
          interval.endTime === sample.time &&
          interval.to === sample.level
      );
      return {
        observationIndex: index,
        observation: sample,
        classification: accepted
          ? "accepted_charging_change"
          : rejected
            ? "rejected_charging_change"
            : sample.level >= 99
              ? "at_or_above_full_threshold"
              : sample.origin === "snapshot"
                ? "snapshot_not_used_as_rate"
                : "not_part_of_accepted_charging_interval",
        rejectionReasons: rejected?.reasons,
        previousObservationIndex:
          position > 0 ? indexedSamples[position - 1].index : undefined,
      };
    }
  );
  const latestPredictionSummary = latestPrediction
    ? {
        trace: latestPrediction,
        source: latestPrediction.updatedEta?.source,
        historicalBaseline: latestPrediction.calculation.baseline,
        liveAdjustment: latestPrediction.calculation.liveAdjustment,
        fallbackReason: latestPrediction.calculation.fallbackReason,
        remainingMinutes: latestPrediction.updatedEta?.remainingMinutes,
        predictedCompletionAt:
          latestPrediction.updatedEta?.predictedCompletionAt,
        historicalIntervalsSelected:
          latestPrediction.calculation.selectedIntervals,
      }
    : undefined;

  return {
    schemaVersion: 1,
    exportedAt: now,
    deviceId,
    application,
    rawBatteryHistory: {
      storageKey: rawBatteryHistory.storageKey,
      rawStorageValue: rawBatteryHistory.rawStorageValue,
      parseError: rawBatteryHistory.parseError,
      observations: rawBatteryObservations,
      observationCount: rawBatteryObservations.length,
      eligibleForEstimatorCount: modelSamples.length,
      excludedFromEstimatorCount:
        rawBatteryObservations.length - modelSamples.length,
    },
    estimatorInput: {
      source: inputSource,
      sessionId: currentSessionId,
      currentLevel,
      historySampleCount: inputSamples.length,
      historyFingerprint: fingerprintBatterySamples(inputSamples),
    },
    observations: {
      derivedClassifications: derivedObservations,
      intervalAudit: {
        accepted: acceptedIntervals,
        rejected: intervalAudit.rejected,
      },
      evidence: extractObservationEvidence(historyForAudit),
      observed99Arrivals: arrivalEvents,
    },
    prediction: {
      latestRecalculation,
      latestPrediction: latestPredictionSummary,
      source:
        latestRecalculation?.updatedEta?.source ??
        latestPrediction?.updatedEta?.source ??
        null,
      historicalBaseline:
        latestRecalculation?.calculation.baseline ??
        latestPrediction?.calculation.baseline ??
        null,
      liveAdjustment:
        latestRecalculation?.calculation.liveAdjustment ??
        latestPrediction?.calculation.liveAdjustment ??
        null,
      fallbackReason:
        latestRecalculation?.calculation.fallbackReason ??
        "no_saved_prediction_trace",
      remainingMinutes:
        latestRecalculation?.updatedEta?.remainingMinutes ??
        latestPrediction?.updatedEta?.remainingMinutes ??
        null,
      predictedCompletionAt:
        latestRecalculation?.updatedEta?.predictedCompletionAt ??
        latestPrediction?.updatedEta?.predictedCompletionAt ??
        null,
      historicalIntervalsSelected:
        latestPrediction?.calculation.selectedIntervals ?? [],
    },
    coverage,
    traceStorage: {
      storageKey: traceStorage.storageKey,
      rawStorageValue: traceStorage.rawStorageValue,
      parseError: traceStorage.parseError,
      entries: traceEntries,
      entryCount: traceEntries.length,
      retentionLimit: MAX_TRACE_ENTRIES,
    },
  };
};
