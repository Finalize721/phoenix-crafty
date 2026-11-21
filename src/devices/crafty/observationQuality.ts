/**
 * Battery observation provenance and evidence helpers for the charging model.
 * A snapshot records the level when it was read, not when it was reached.
 */
export type BatteryObservationOrigin = "snapshot" | "notification" | "legacy";

export interface QualitySample {
  level: number;
  time: number;
  sessionId: string;
  origin?: BatteryObservationOrigin;
  breakBefore?: boolean;
  continuousSincePrevious?: boolean;
}

export interface Arrival {
  level: number;
  at: number;
  quality: "observed" | "interpolated";
}

export interface TimedSegment {
  fromLevel: number;
  toLevel: number;
  elapsedMs: number;
  sessionId: string;
  confidence: "measured";
  arrivals: Arrival[];
}

export interface ObservationEvidence {
  transitions: Arrival[];
  measuredSegments: TimedSegment[];
  observed99ArrivalAt?: number;
}

/**
 * A verified interval requires two notification readings and uninterrupted
 * visibility/connection. A first read may timestamp an arrival, but never a
 * measured duration from its previous snapshot.
 */
export function extractObservationEvidence(
  samples: readonly QualitySample[]
): ObservationEvidence {
  const sorted = samples
    .filter(
      (point) =>
        point &&
        typeof point.sessionId === "string" &&
        Number.isFinite(point.time) &&
        Number.isFinite(point.level) &&
        point.level >= 0 &&
        point.level <= 100
    )
    .slice()
    .sort((a, b) => a.time - b.time);

  const transitions: Arrival[] = [];
  const measuredSegments: TimedSegment[] = [];
  let observed99ArrivalAt: number | undefined;

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const validInterval =
      previous.sessionId === current.sessionId &&
      current.time > previous.time &&
      current.level > previous.level &&
      current.breakBefore !== true &&
      current.continuousSincePrevious === true;
    if (!validInterval || current.origin !== "notification") continue;

    transitions.push({
      level: current.level,
      at: current.time,
      quality: "observed",
    });
    if (current.level === 99 && previous.level < 99) {
      observed99ArrivalAt = current.time;
    }

    if (previous.origin !== "notification") continue;
    const span = current.level - previous.level;
    const arrivals: Arrival[] = [];
    for (let level = previous.level + 1; level <= current.level; level++) {
      arrivals.push({
        level,
        at:
          previous.time +
          ((level - previous.level) / span) * (current.time - previous.time),
        quality: level === current.level ? "observed" : "interpolated",
      });
    }
    measuredSegments.push({
      fromLevel: previous.level,
      toLevel: current.level,
      elapsedMs: current.time - previous.time,
      sessionId: current.sessionId,
      confidence: "measured",
      arrivals,
    });
  }

  return { transitions, measuredSegments, observed99ArrivalAt };
}

export interface ArrivalBounds {
  afterExclusive?: number;
  byInclusive?: number;
}

/**
 * Returns event-time bounds from the latest uninterrupted observation
 * fragment. Bounds constrain candidate estimates; they are not rate data.
 */
export function boundPercentArrival(
  samples: readonly QualitySample[],
  level: number,
  sessionId: string
): ArrivalBounds | undefined {
  if (!Number.isInteger(level) || level < 1 || level > 100) return undefined;
  const rows = samples
    .filter(
      (point) =>
        point &&
        point.sessionId === sessionId &&
        Number.isFinite(point.time) &&
        Number.isFinite(point.level) &&
        point.level >= 0 &&
        point.level <= 100
    )
    .slice()
    .sort((a, b) => a.time - b.time);
  if (!rows.length) return undefined;

  const fragments: QualitySample[][] = [];
  let active: QualitySample[] = [];
  for (const row of rows) {
    const last = active[active.length - 1];
    if (
      last &&
      (row.breakBefore === true ||
        row.level < last.level ||
        row.time <= last.time ||
        (row.time - last.time > 12 * 60_000 &&
          row.continuousSincePrevious !== true))
    ) {
      fragments.push(active);
      active = [];
    }
    active.push(row);
  }
  if (active.length) fragments.push(active);

  const fragment = fragments[fragments.length - 1];
  if (!fragment) return undefined;
  const below = fragment.filter((point) => point.level < level);
  const lower = below[below.length - 1]?.time;
  const upper = fragment.find((point) => point.level >= level)?.time;
  if (lower === undefined && upper === undefined) return undefined;
  return {
    ...(lower !== undefined ? { afterExclusive: lower } : {}),
    ...(upper !== undefined ? { byInclusive: upper } : {}),
  };
}

export function isArrivalConsistentWithBounds(
  arrivalAt: number,
  bounds: ArrivalBounds | undefined
): boolean {
  if (!Number.isFinite(arrivalAt) || !bounds) return false;
  return (
    (bounds.afterExclusive === undefined ||
      arrivalAt > bounds.afterExclusive) &&
    (bounds.byInclusive === undefined || arrivalAt <= bounds.byInclusive)
  );
}
