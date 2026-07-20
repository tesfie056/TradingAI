/**
 * Persist Version 1 strategy evaluations (all labels — not only BUY).
 * Never places orders. Does not fabricate outcomes.
 */

import { appendFile, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { V1StrategyResult } from "@/lib/strategy/v1-simple-long/types";

const DIR = path.join(process.cwd(), "data");
const LOG = path.join(DIR, "v1-strategy-decisions.jsonl");
const LATEST = path.join(DIR, "v1-strategy-latest.json");

export type V1StrategyLogRow = V1StrategyResult & {
  scanId: string;
  dataTimestamp: string | null;
};

export async function appendV1StrategyDecisions(
  rows: V1StrategyLogRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await mkdir(DIR, { recursive: true });
  const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await appendFile(LOG, lines, "utf8");
}

export async function saveV1StrategyLatest(input: {
  scanId: string;
  evaluatedAt: string;
  marketOpen: boolean | null;
  results: V1StrategyResult[];
}): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const body = {
    paperOnly: true as const,
    planningOnly: true as const,
    mutatedOrdersOrPositions: false as const,
    scanId: input.scanId,
    evaluatedAt: input.evaluatedAt,
    marketOpen: input.marketOpen,
    strategyId: input.results[0]?.strategyId ?? "v1-simple-long",
    strategyVersion: input.results[0]?.strategyVersion ?? "1.0.0",
    counts: {
      buy: input.results.filter((r) => r.decision === "BUY").length,
      watch: input.results.filter((r) => r.decision === "WATCH").length,
      skip: input.results.filter((r) => r.decision === "SKIP").length,
      hold: input.results.filter((r) => r.decision === "HOLD").length,
    },
    results: input.results,
  };
  await writeFile(LATEST, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

export async function readV1StrategyLatest(): Promise<{
  paperOnly: true;
  evaluatedAt: string;
  marketOpen: boolean | null;
  counts: { buy: number; watch: number; skip: number; hold: number };
  results: V1StrategyResult[];
  strategyId: string;
  strategyVersion: string;
} | null> {
  try {
    const raw = await readFile(LATEST, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.paperOnly !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}
