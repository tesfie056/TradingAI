/**
 * Append-only learning dataset under data/learning/.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  LearningEvent,
  LearningFeatureSnapshot,
  TradeReviewRecord,
} from "@/lib/learning/types";

const DIR = path.join(process.cwd(), "data", "learning");
const EVENTS = path.join(DIR, "events.jsonl");
const SNAPSHOTS = path.join(DIR, "feature-snapshots.jsonl");
const REVIEWS = path.join(DIR, "trade-reviews.jsonl");

const MAX_EVENTS = 5000;
const MAX_SNAPSHOTS = 5000;
const MAX_REVIEWS = 2000;

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

async function readJsonl<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, "utf8");
    const rows: T[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t) as T);
      } catch {
        // skip bad lines
      }
    }
    return rows;
  } catch {
    return [];
  }
}

async function appendJsonlPrune<T>(
  file: string,
  entry: T,
  max: number,
): Promise<void> {
  await ensureDir();
  const existing = await readJsonl<T>(file);
  existing.push(entry);
  const kept = existing.length > max ? existing.slice(-max) : existing;
  const body = kept.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(file, body, "utf8");
}

function newEventId(): string {
  return `le_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Outcomes must not appear in featureHash construction — validate separation. */
export function assertFeaturesExcludeOutcomes(
  snapshot: LearningFeatureSnapshot,
  event: LearningEvent,
): void {
  const featKeys = Object.keys(snapshot.features);
  for (const banned of [
    "realizedPnl",
    "exitPrice",
    "fillPrice",
    "mfe",
    "mae",
    "won",
  ]) {
    if (featKeys.includes(banned)) {
      throw new Error(`Feature vector must not include outcome field ${banned}`);
    }
  }
  if (event.outcomes && "features" in (event.outcomes as object)) {
    throw new Error("Outcomes must not nest features");
  }
  if (!snapshot.paperOnly || !event.paperOnly) {
    throw new Error("Learning records must be paperOnly");
  }
}

export async function appendFeatureSnapshot(
  snapshot: LearningFeatureSnapshot,
): Promise<LearningFeatureSnapshot> {
  if (!snapshot.paperOnly) throw new Error("paperOnly required");
  await appendJsonlPrune(SNAPSHOTS, snapshot, MAX_SNAPSHOTS);
  return snapshot;
}

export async function appendLearningEvent(
  input: Omit<LearningEvent, "id" | "paperOnly"> & { id?: string },
): Promise<LearningEvent> {
  const event: LearningEvent = {
    ...input,
    id: input.id ?? newEventId(),
    paperOnly: true,
  };
  await appendJsonlPrune(EVENTS, event, MAX_EVENTS);
  return event;
}

export async function appendTradeReview(
  review: TradeReviewRecord,
): Promise<TradeReviewRecord> {
  if (!review.paperOnly) throw new Error("paperOnly required");
  await appendJsonlPrune(REVIEWS, review, MAX_REVIEWS);
  return review;
}

export async function readFeatureSnapshots(
  limit = 500,
): Promise<LearningFeatureSnapshot[]> {
  const rows = await readJsonl<LearningFeatureSnapshot>(SNAPSHOTS);
  return rows.slice(-limit);
}

export async function readLearningEvents(
  limit = 500,
): Promise<LearningEvent[]> {
  const rows = await readJsonl<LearningEvent>(EVENTS);
  return rows.slice(-limit);
}

export async function readTradeReviews(
  limit = 500,
): Promise<TradeReviewRecord[]> {
  const rows = await readJsonl<TradeReviewRecord>(REVIEWS);
  return rows.slice(-limit);
}

export async function getLearningDatasetSummary(): Promise<{
  eventCount: number;
  snapshotCount: number;
  reviewCount: number;
  regimes: Record<string, number>;
  paperOnly: true;
}> {
  const [events, snapshots, reviews] = await Promise.all([
    readLearningEvents(MAX_EVENTS),
    readFeatureSnapshots(MAX_SNAPSHOTS),
    readTradeReviews(MAX_REVIEWS),
  ]);
  const regimes: Record<string, number> = {};
  for (const e of events) {
    regimes[e.regime] = (regimes[e.regime] ?? 0) + 1;
  }
  for (const s of snapshots) {
    if (!regimes[s.regime]) regimes[s.regime] = 0;
  }
  return {
    eventCount: events.length,
    snapshotCount: snapshots.length,
    reviewCount: reviews.length,
    regimes,
    paperOnly: true,
  };
}
