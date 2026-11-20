export interface BatteryCurveSample {
  level: number;
  time: number;
  sessionId: string;
  breakBefore?: boolean;
  continuousSincePrevious?: boolean;
}

export interface CurvePrediction {
  remainingMinutes: number;
  source: "history" | "live";
  historicalRunCount: number;
  adaptedToLive: boolean;
}

type Run = { sessionId: string; points: BatteryCurveSample[] };

const MINUTE = 60_000;
const MAX_GAP = 12 * MINUTE;
const RECENT_RISE_WINDOW = 30 * MINUTE;
const MAX_FRESHNESS = 30 * MINUTE;

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
    const mustSplit =
      !previous ||
      point.breakBefore === true ||
      point.sessionId !== current?.sessionId ||
      point.time <= previous.time ||
      (point.time - previous.time > MAX_GAP &&
        !point.continuousSincePrevious) ||
      point.level < previous.level;

    if (mustSplit || !current) {
      const next = { sessionId: point.sessionId, points: [] };
      current = next;
      runs.push(next);
    }
    current.points.push(point);
  }
  return runs;
};

const timeAtLevel = (run: Run, level: number): number | undefined => {
  const points = run.points;
  const last = points[points.length - 1];
  if (points.length < 2 || level < points[0].level || level > last.level) {
    return undefined;
  }
  if (level === points[0].level) return points[0].time;
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1];
    const after = points[index];
    if (after.level >= level && before.level < level) {
      return (
        before.time +
        ((level - before.level) / (after.level - before.level)) *
          (after.time - before.time)
      );
    }
  }
  return undefined;
};

const observedComplete = (run: Run, target: number): boolean => {
  const points = run.points;
  if (points.length < 3) return false;
  const endIndex = points.findIndex((point) => point.level >= target);
  if (endIndex < 2) return false;
  const end = points[endIndex];
  const previous = points[endIndex - 1];
  return (
    previous.level < target &&
    (end.time - previous.time <= MAX_GAP ||
      end.continuousSincePrevious === true) &&
    end.level - points[0].level >= 5 &&
    end.time - points[0].time >= 5 * MINUTE
  );
};

export const predictChargingCurve = (
  samples: BatteryCurveSample[],
  currentLevel: number,
  currentSessionId: string,
  now = Date.now(),
  targetLevel = 100
): CurvePrediction | undefined => {
  if (
    !Number.isFinite(currentLevel) ||
    currentLevel < 0 ||
    currentLevel >= targetLevel ||
    targetLevel > 100 ||
    targetLevel <= 0
  ) {
    return undefined;
  }

  const runs = splitChargingRuns(samples);
  const currentRuns = runs.filter((run) => run.sessionId === currentSessionId);
  const current = currentRuns[currentRuns.length - 1];
  if (!current || current.points.length < 2) return undefined;
  const points = current.points;
  const last = points[points.length - 1];
  if (
    last.level !== currentLevel ||
    now < last.time ||
    now - last.time > MAX_FRESHNESS
  ) {
    return undefined;
  }
  const observedRise = points.some(
    (point, index) =>
      index > 0 &&
      point.level > points[index - 1].level &&
      last.time - point.time <= RECENT_RISE_WINDOW
  );
  if (!observedRise) return undefined;

  const complete = runs.filter(
    (run) =>
      run.sessionId !== currentSessionId && observedComplete(run, targetLevel)
  );
  const applicable = complete.flatMap((run) => {
    const from = timeAtLevel(run, currentLevel);
    const to = timeAtLevel(run, targetLevel);
    return from === undefined || to === undefined || to <= from
      ? []
      : [{ run, remaining: (to - from) / MINUTE }];
  });

  if (applicable.length) {
    const historicalMinutes = median(applicable.map((item) => item.remaining));
    if (historicalMinutes === undefined) return undefined;
    let adjustment = 1;
    let adaptedToLive = false;
    const start = points.find(
      (point) =>
        point.level >= currentLevel - 20 && point.level <= currentLevel - 8
    );
    if (start && last.time - start.time >= 5 * MINUTE) {
      const matched = applicable.flatMap(({ run }) => {
        const from = timeAtLevel(run, start.level);
        const to = timeAtLevel(run, currentLevel);
        return from !== undefined && to !== undefined && to > from
          ? [(to - from) / MINUTE]
          : [];
      });
      const typicalMinutes = median(matched);
      if (typicalMinutes && typicalMinutes >= 3) {
        const ratio = (last.time - start.time) / MINUTE / typicalMinutes;
        adjustment = clamp(1 + 0.35 * (ratio - 1), 0.85, 1.15);
        adaptedToLive = true;
      }
    }
    return {
      remainingMinutes: Math.max(1, Math.ceil(historicalMinutes * adjustment)),
      source: "history",
      historicalRunCount: applicable.length,
      adaptedToLive,
    };
  }

  const recent = points.filter(
    (point) => last.time - point.time <= RECENT_RISE_WINDOW
  );
  const start = recent.find(
    (point) =>
      last.time - point.time >= 5 * MINUTE && last.level - point.level >= 3
  );
  if (!start) return undefined;
  const elapsedMinutes = (last.time - start.time) / MINUTE;
  const percentPerMinute = (last.level - start.level) / elapsedMinutes;
  if (!Number.isFinite(percentPerMinute) || percentPerMinute <= 0)
    return undefined;
  return {
    remainingMinutes: Math.max(
      1,
      Math.ceil((targetLevel - currentLevel) / percentPerMinute)
    ),
    source: "live",
    historicalRunCount: 0,
    adaptedToLive: false,
  };
};
