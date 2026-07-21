/**
 * Chronological splits — never random.
 */

import type { ChronologicalSplit } from "@/lib/backtest/types";

function dayMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(dayMs(isoDate));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function assertOrdered(a: string, b: string, label: string) {
  if (dayMs(a) > dayMs(b)) {
    throw new Error(`${label}: start after end (${a} > ${b})`);
  }
}

/**
 * Reject random / overlapping / unlocked OOS mutations.
 */
export function validateChronologicalSplit(
  split: ChronologicalSplit,
): { ok: true } | { ok: false; error: string } {
  try {
    assertOrdered(split.training.start, split.training.end, "training");
    assertOrdered(split.validation.start, split.validation.end, "validation");
    if (split.purgeGapDays < 0) {
      return { ok: false, error: "purgeGapDays must be ≥ 0" };
    }
    const trainEndPlusGap = addDays(split.training.end, split.purgeGapDays);
    if (dayMs(split.validation.start) < dayMs(trainEndPlusGap)) {
      return {
        ok: false,
        error: "Validation overlaps training (purge gap not enforced)",
      };
    }
    if (split.outOfSample) {
      assertOrdered(
        split.outOfSample.start,
        split.outOfSample.end,
        "outOfSample",
      );
      const valEndPlusGap = addDays(split.validation.end, split.purgeGapDays);
      if (dayMs(split.outOfSample.start) < dayMs(valEndPlusGap)) {
        return {
          ok: false,
          error: "Out-of-sample overlaps validation (purge gap not enforced)",
        };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid split" };
  }
}

export function rejectRandomSplit(method: string): never {
  throw new Error(
    `Random train/test splits are forbidden (got "${method}"). Use chronological splits only.`,
  );
}

export function lockOutOfSample(
  split: ChronologicalSplit,
): ChronologicalSplit {
  if (!split.outOfSample) {
    throw new Error("Cannot lock missing out-of-sample period");
  }
  return { ...split, outOfSampleLocked: true };
}

export function assertOutOfSampleImmutable(
  original: ChronologicalSplit,
  next: ChronologicalSplit,
): void {
  if (!original.outOfSampleLocked) return;
  if (
    JSON.stringify(original.outOfSample) !== JSON.stringify(next.outOfSample)
  ) {
    throw new Error(
      "Locked out-of-sample dates cannot be changed silently within an experiment",
    );
  }
}

export function buildDefaultSplit(input: {
  start: string;
  end: string;
  purgeGapDays?: number;
}): ChronologicalSplit {
  const startMs = dayMs(input.start);
  const endMs = dayMs(input.end);
  const span = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
  const trainDays = Math.max(5, Math.floor(span * 0.5));
  const valDays = Math.max(3, Math.floor(span * 0.25));
  const purge = input.purgeGapDays ?? 1;
  const trainingEnd = addDays(input.start, trainDays);
  const validationStart = addDays(trainingEnd, purge);
  const validationEnd = addDays(validationStart, valDays);
  const oosStart = addDays(validationEnd, purge);
  return {
    id: `split_${input.start}_${input.end}`,
    training: { start: input.start, end: trainingEnd },
    validation: { start: validationStart, end: validationEnd },
    purgeGapDays: purge,
    outOfSample: { start: oosStart, end: input.end },
    outOfSampleLocked: true,
  };
}

export function generateWalkForwardWindows(input: {
  start: string;
  end: string;
  trainDays: number;
  testDays: number;
  stepDays: number;
  purgeGapDays?: number;
}): ChronologicalSplit[] {
  const purge = input.purgeGapDays ?? 1;
  const folds: ChronologicalSplit[] = [];
  let cursor = input.start;
  let i = 0;
  while (dayMs(addDays(cursor, input.trainDays + purge + input.testDays)) <= dayMs(input.end)) {
    const trainEnd = addDays(cursor, input.trainDays);
    const valStart = addDays(trainEnd, purge);
    const valEnd = addDays(valStart, input.testDays);
    folds.push({
      id: `wf_${i}_${cursor}`,
      training: { start: cursor, end: trainEnd },
      validation: { start: valStart, end: valEnd },
      purgeGapDays: purge,
      outOfSample: null,
      outOfSampleLocked: false,
    });
    cursor = addDays(cursor, input.stepDays);
    i += 1;
    if (i > 50) break;
  }
  return folds;
}

export function filterBarsByIsoRange<T extends { timestamp: string }>(
  bars: T[],
  start: string,
  end: string,
): T[] {
  const a = dayMs(start);
  const b = Date.parse(`${end}T23:59:59.999Z`);
  return bars.filter((x) => {
    const t = Date.parse(x.timestamp);
    return t >= a && t <= b;
  });
}
