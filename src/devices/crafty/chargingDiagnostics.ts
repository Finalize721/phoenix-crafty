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
    !Number.isFinite(sample.level) ||
    sample.level < 0 ||
    sample.level > 100 ||
    typeof sample.time !== "number" ||
    !Number.isFinite(sample.time) ||
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
      predictionRateReason:
        used?.method === "interpolated"
          ? "no_direct_rate_measurement_for_this_percent_nearest_measured_rate_used"
          : undefined,
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
  const observationKey = (sessionId: string, time: number, level: number) =>
    JSON.stringify([sessionId, time, level]);
  const sampleIndexesByKey = new Map<string, number[]>();
  for (const { index, sample } of indexedSamples) {
    const key = observationKey(sample.sessionId, sample.time, sample.level);
    sampleIndexesByKey.set(key, [
      ...(sampleIndexesByKey.get(key) ?? []),
      index,
    ]);
  }
  const matchingIndexes = (sessionId: string, time: number, level: number) =>
    sampleIndexesByKey.get(observationKey(sessionId, time, level)) ?? [];
  const inputSamplesByKey = new Map(
    inputSamples.map((sample) => [
      observationKey(sample.sessionId, sample.time, sample.level),
      sample,
    ])
  );
  const observationStatus = new Map<
    number,
    { accepted: boolean; rejectionReasons: Set<string> }
  >();
  const statusFor = (index: number) => {
    let status = observationStatus.get(index);
    if (!status) {
      status = { accepted: false, rejectionReasons: new Set<string>() };
      observationStatus.set(index, status);
    }
    return status;
  };
  for (const interval of intervalAudit.accepted) {
    for (const index of [
      ...matchingIndexes(interval.sessionId, interval.startTime, interval.from),
      ...matchingIndexes(interval.sessionId, interval.endTime, interval.to),
    ]) {
      statusFor(index).accepted = true;
    }
  }
  for (const interval of intervalAudit.rejected) {
    for (const index of [
      ...matchingIndexes(
        interval.fromSessionId,
        interval.startTime,
        interval.from
      ),
      ...matchingIndexes(interval.toSessionId, interval.endTime, interval.to),
    ]) {
      for (const reason of interval.reasons) {
        statusFor(index).rejectionReasons.add(reason);
      }
    }
  }
  for (const interval of acceptedIntervals) {
    if (interval.estimatorEligible) continue;
    for (const index of [
      ...matchingIndexes(interval.sessionId, interval.startTime, interval.from),
      ...matchingIndexes(interval.sessionId, interval.endTime, interval.to),
    ]) {
      for (const reason of interval.estimatorRejectionReasons) {
        statusFor(index).rejectionReasons.add(reason);
      }
    }
  }

  const provisionalSegments = rateSegments.provisional.map((segment) => {
    const before = inputSamplesByKey.get(
      observationKey(segment.sessionId, segment.startTime, segment.from)
    );
    const after = inputSamplesByKey.get(
      observationKey(segment.sessionId, segment.endTime, segment.to)
    );
    const reasons = [
      ...(before?.origin === "notification"
        ? []
        : ["previous_observation_not_verified_change_notification"]),
      ...(after?.origin === "notification"
        ? []
        : ["current_observation_not_verified_change_notification"]),
      ...(after?.continuousSincePrevious === true
        ? []
        : ["continuity_not_verified"]),
      ...(before?.heaterActive === false && after?.heaterActive === false
        ? []
        : ["heater_off_not_verified"]),
    ];
    const selectedByLatestPrediction = latestPrediction
      ? latestPrediction.calculation.selectedIntervals.some(
          (interval) =>
            interval.method === "provisional_segment" &&
            interval.sessionId === segment.sessionId &&
            interval.startTime === segment.startTime &&
            interval.endTime === segment.endTime &&
            interval.fromLevel === segment.from &&
            interval.toLevel === segment.to
        )
      : false;
    return {
      ...segment,
      fromOrigin: before?.origin,
      toOrigin: after?.origin,
      unverifiedReasons: reasons,
      selectedByLatestPrediction,
    };
  });
  const provisionalSampleRoles = new Map<
    number,
    { candidate: boolean; selected: boolean; reasons: Set<string> }
  >();
  for (const segment of provisionalSegments) {
    for (const index of [
      ...matchingIndexes(segment.sessionId, segment.startTime, segment.from),
      ...matchingIndexes(segment.sessionId, segment.endTime, segment.to),
    ]) {
      let role = provisionalSampleRoles.get(index);
      if (!role) {
        role = { candidate: false, selected: false, reasons: new Set() };
        provisionalSampleRoles.set(index, role);
      }
      role.candidate = true;
      role.selected ||= segment.selectedByLatestPrediction;
      for (const reason of segment.unverifiedReasons) role.reasons.add(reason);
    }
  }

  const validObservationIndexes = new Set(
    indexedSamples.map(({ index }) => index)
  );
  const derivedObservations = [
    ...indexedSamples.map(({ index, sample }) => {
      const status = observationStatus.get(index);
      const rejected = Boolean(status?.rejectionReasons.size);
      const accepted = status?.accepted ?? false;
      const isolated =
        (!accepted && !rejected) || (sample.origin === "snapshot" && !accepted);
      const categories = [
        ...(isolated ? ["isolated"] : []),
        ...(accepted ? ["accepted"] : []),
        ...(rejected ? ["rejected"] : []),
      ];
      const classificationReasons = [
        ...(accepted
          ? ["part_of_classifier_accepted_notification_interval"]
          : []),
        ...(status ? [...status.rejectionReasons] : []),
        ...(isolated && sample.origin === "snapshot"
          ? [
              "snapshot_is_not_an_exact_percentage_transition",
              "snapshot_may_only_constrain_crossing_bounds",
            ]
          : []),
        ...(isolated && sample.origin !== "snapshot"
          ? ["no_accepted_transition_uses_this_observation"]
          : []),
        ...((sample.origin === "legacy" || sample.origin === undefined) &&
        !accepted
          ? ["provenance_not_verified_as_a_change_notification"]
          : []),
      ];
      const provisionalRole = provisionalSampleRoles.get(index);
      const classification = isolated
        ? sample.origin === "snapshot"
          ? "isolated_snapshot"
          : "isolated_observation"
        : accepted && rejected
          ? "accepted_and_rejected_observation"
          : accepted
            ? "accepted_charging_observation"
            : "rejected_charging_observation";
      return {
        observationIndex: index,
        observation: sample,
        classification,
        categories,
        classificationReasons,
        rejectionReasons: status ? [...status.rejectionReasons] : [],
        provisionalRateCandidate: provisionalRole?.candidate ?? false,
        selectedByLatestProvisionalPrediction:
          provisionalRole?.selected ?? false,
        provisionalReasons: provisionalRole ? [...provisionalRole.reasons] : [],
      };
    }),
    ...rawBatteryObservations.flatMap((observation, index) =>
      validObservationIndexes.has(index)
        ? []
        : [
            {
              observationIndex: index,
              observation,
              classification: "rejected_invalid_observation",
              categories: ["rejected"],
              classificationReasons: [
                "observation_does_not_match_supported_battery_sample_schema",
              ],
              rejectionReasons: [
                "observation_does_not_match_supported_battery_sample_schema",
              ],
              provisionalRateCandidate: false,
              selectedByLatestProvisionalPrediction: false,
              provisionalReasons: [],
            },
          ]
    ),
  ].sort((a, b) => a.observationIndex - b.observationIndex);

  const interpolatedRateIntervals = (latestCalculation?.rateUses ?? []).flatMap(
    (rate) =>
      rate.method === "interpolated"
        ? [
            {
              fromPercent: rate.fromLevel,
              toPercent: rate.toLevel,
              minutesPerPercent: rate.minutesPerPercent,
              durationMinutes: rate.durationMinutes,
              method: rate.method,
              classificationReasons: [
                "no_direct_rate_measurement_for_this_percent",
                "existing_estimator_used_the_nearest_measured_rate",
              ],
            },
          ]
        : []
  );
  const interpolatedCompletedRunCrossings = (
    latestCalculation?.selectedIntervals ?? []
  )
    .filter((interval) => interval.method === "completed_run")
    .flatMap((interval) =>
      [
        {
          level: interval.fromLevel,
          time: interval.startTime,
          boundary: "start",
        },
        {
          level: interval.toLevel,
          time: interval.endTime,
          boundary: "target",
        },
      ]
        .filter(
          (crossing) =>
            !inputSamples.some(
              (sample) =>
                sample.sessionId === interval.sessionId &&
                sample.level === crossing.level &&
                sample.time === crossing.time
            )
        )
        .map((crossing) => ({
          sessionId: interval.sessionId,
          ...crossing,
          classificationReasons: [
            "percentage_crossing_interpolated_between_verified_observations",
          ],
        }))
    );
  const interpolatedArrivals = rateSegments.verified.flatMap((segment) => {
    let interpolatedPercentageCount = 0;
    let firstInterpolatedLevel: number | undefined;
    let lastInterpolatedLevel: number | undefined;
    for (
      let level = Math.floor(segment.from) + 1;
      level < segment.to;
      level++
    ) {
      if (level <= segment.from) continue;
      interpolatedPercentageCount++;
      firstInterpolatedLevel ??= level;
      lastInterpolatedLevel = level;
    }
    if (
      !interpolatedPercentageCount ||
      firstInterpolatedLevel === undefined ||
      lastInterpolatedLevel === undefined
    ) {
      return [];
    }
    return [
      {
        sessionId: segment.sessionId,
        fromLevel: segment.from,
        toLevel: segment.to,
        interpolatedPercentageCount,
        firstInterpolatedLevel,
        lastInterpolatedLevel,
        firstInterpolatedAt:
          segment.startTime +
          ((firstInterpolatedLevel - segment.from) /
            (segment.to - segment.from)) *
            (segment.endTime - segment.startTime),
        lastInterpolatedAt:
          segment.startTime +
          ((lastInterpolatedLevel - segment.from) /
            (segment.to - segment.from)) *
            (segment.endTime - segment.startTime),
        classificationReasons: [
          "interior_percentage_arrivals_interpolated_between_verified_notification_observations",
        ],
      },
    ];
  });
  const isolatedCount = derivedObservations.filter((observation) =>
    observation.categories.includes("isolated")
  ).length;
  const acceptedCount = derivedObservations.filter((observation) =>
    observation.categories.includes("accepted")
  ).length;
  const rejectedCount = derivedObservations.filter((observation) =>
    observation.categories.includes("rejected")
  ).length;
  const unverifiedProvisionalIntervals = provisionalSegments.filter(
    (segment) => segment.unverifiedReasons.length > 0
  );
  const interpolatedCount =
    interpolatedArrivals.reduce(
      (count, arrival) => count + arrival.interpolatedPercentageCount,
      0
    ) +
    interpolatedRateIntervals.length +
    interpolatedCompletedRunCrossings.length;
  const snapshotsInProvisionalSegments = provisionalSegments.filter(
    (segment) =>
      segment.fromOrigin === "snapshot" || segment.toOrigin === "snapshot"
  );
  const selectedUnverifiedProvisionalIntervals =
    unverifiedProvisionalIntervals.filter(
      (segment) => segment.selectedByLatestPrediction
    );
  const snapshotObservationKeys = new Set(
    indexedSamples
      .filter(({ sample }) => sample.origin === "snapshot")
      .map(({ sample }) => JSON.stringify([sample.sessionId, sample.time]))
  );
  const snapshotTransitionRejections = intervalAudit.rejected.filter(
    (interval) =>
      interval.reasons.includes("session_changed") &&
      (snapshotObservationKeys.has(
        JSON.stringify([interval.fromSessionId, interval.startTime])
      ) ||
        snapshotObservationKeys.has(
          JSON.stringify([interval.toSessionId, interval.endTime])
        ))
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
      classificationCounts: {
        isolated: isolatedCount,
        accepted: acceptedCount,
        rejected: rejectedCount,
        interpolated: interpolatedCount,
        acceptedChargingIntervals: intervalAudit.accepted.length,
        rejectedChargingIntervals: rejectedForCoverage.length,
      },
      classificationCountDefinitions: {
        isolated:
          "Raw observations not used as accepted transitions; snapshots remain isolated even when rejected as a cross-session candidate pair.",
        accepted:
          "Unique raw observations participating in an interval accepted by the charging activity classifier; may overlap rejected when the estimator later excludes that interval.",
        rejected:
          "Unique raw observations participating in rejected intervals, estimator-excluded intervals, or invalid stored records.",
        interpolated:
          "Derived percentage arrivals or rate intervals interpolated by the existing estimator; these are not raw Bluetooth observations.",
      },
      derivedClassifications: derivedObservations,
      intervalAudit: {
        accepted: acceptedIntervals,
        rejected: intervalAudit.rejected,
      },
      interpolatedObservations: {
        verifiedIntervalArrivals: interpolatedArrivals,
        predictionRateIntervals: interpolatedRateIntervals,
        completedRunCrossings: interpolatedCompletedRunCrossings,
      },
      provisionalRateCandidates: {
        intervals: provisionalSegments,
        candidateCount: provisionalSegments.length,
        unverifiedCount: unverifiedProvisionalIntervals.length,
        selectedUnverifiedCount: selectedUnverifiedProvisionalIntervals.length,
      },
      evidence: extractObservationEvidence(historyForAudit),
      observed99Arrivals: arrivalEvents,
    },
    ruleAudit: {
      explicitSnapshotsInProvisionalRateSegments:
        snapshotsInProvisionalSegments.length,
      crossSessionSnapshotTransitionsRejected:
        snapshotTransitionRejections.length,
      unverifiedProvisionalRateCandidates:
        unverifiedProvisionalIntervals.length,
      selectedUnverifiedProvisionalRateIntervals:
        selectedUnverifiedProvisionalIntervals.length,
      findings: [
        ...(snapshotsInProvisionalSegments.length > 0
          ? ["explicit_snapshot_used_in_provisional_rate_segment"]
          : []),
        ...(selectedUnverifiedProvisionalIntervals.length > 0
          ? [
              "selected_provisional_estimate_uses_observations_without_verified_notification_continuity",
            ]
          : []),
      ],
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
