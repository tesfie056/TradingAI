import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiDecision, DecisionHistoryEntry } from "@/lib/alpaca/types";
import { decisionToPerformanceEntry, refreshOverall } from "@/lib/performance/from-decision";
import type { DecisionPerformanceEntry } from "@/lib/performance/types";
import type { AccuracyBucket, PerformanceSummary } from "@/lib/performance/types";

const HISTORY_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(HISTORY_DIR, "decision-history.jsonl");
const MAX_ENTRIES = 800;

async function ensureDir() {
  await mkdir(HISTORY_DIR, { recursive: true });
}

function isPerfEntry(value: unknown): value is DecisionPerformanceEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as DecisionPerformanceEntry;
  return (
    typeof v.symbol === "string" &&
    v.paperOnly === true &&
    typeof v.action === "string" &&
    typeof v.timestamp === "string"
  );
}

/**
 * Append decisions to local JSONL. Never stores API keys.
 */
export async function appendDecisionHistory(
  decisions: AiDecision[],
  extras?: { aiProvider?: "heuristic" | "ollama" | "unknown" },
): Promise<DecisionPerformanceEntry[]> {
  if (decisions.length === 0) return [];
  await ensureDir();

  const rows = decisions.map((d) =>
    decisionToPerformanceEntry(d, {
      aiProvider: extras?.aiProvider,
    }),
  );

  const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(HISTORY_FILE, lines, { flag: "a" });
  return rows;
}

export async function readDecisionHistory(
  limit = 100,
): Promise<DecisionHistoryEntry[]> {
  const perf = await readPerformanceHistory(limit);
  return perf.map((p) => ({
    symbol: p.symbol,
    action: p.action,
    confidence: p.confidence,
    reasons: p.reasons,
    riskWarnings: p.riskWarnings,
    timestamp: p.timestamp,
    paperOnly: true as const,
  }));
}

export async function readPerformanceHistory(
  limit = 200,
): Promise<DecisionPerformanceEntry[]> {
  try {
    const raw = await readFile(HISTORY_FILE, "utf8");
    const entries: DecisionPerformanceEntry[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as DecisionPerformanceEntry & {
          priceAtDecision?: number | null;
        };
        if (!isPerfEntry(parsed)) continue;

        // Migrate older slim rows.
        if (!parsed.outcomes) {
          const migrated = decisionToPerformanceEntry({
            symbol: parsed.symbol,
            action: parsed.action,
            confidence: parsed.confidence,
            reasons: parsed.reasons ?? [],
            riskWarnings: parsed.riskWarnings ?? [],
            riskStatus: "unknown",
            timestamp: parsed.timestamp,
            paperOnly: true,
            metrics: {
              last: parsed.priceAtDecision ?? null,
              mid: parsed.priceAtDecision ?? null,
              spreadPct: null,
              trendPct: null,
              rangePct: null,
              volumeRatio: null,
            },
          });
          entries.push(migrated);
        } else {
          entries.push(parsed);
        }
      } catch {
        // skip corrupt lines
      }
    }

    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function writePerformanceHistory(
  entriesOldestFirst: DecisionPerformanceEntry[],
): Promise<void> {
  await ensureDir();
  const body =
    entriesOldestFirst.map((e) => JSON.stringify(e)).join("\n") +
    (entriesOldestFirst.length ? "\n" : "");
  await writeFile(HISTORY_FILE, body, { flag: "w" });
}

/** Trim file if it grows too large (best-effort). */
export async function pruneDecisionHistory(): Promise<void> {
  const entries = await readPerformanceHistory(MAX_ENTRIES * 2);
  if (entries.length <= MAX_ENTRIES) return;
  const keepNewest = entries.slice(0, MAX_ENTRIES);
  await writePerformanceHistory(keepNewest.reverse());
}

function bucketAccuracy(
  key: string,
  rows: DecisionPerformanceEntry[],
): AccuracyBucket {
  let correct = 0;
  let incorrect = 0;
  let neutral = 0;
  let pending = 0;
  const pnls: number[] = [];

  for (const r of rows) {
    if (r.overallLabel === "correct") correct += 1;
    else if (r.overallLabel === "incorrect") incorrect += 1;
    else if (r.overallLabel === "neutral") neutral += 1;
    else pending += 1;

    const pnl =
      r.outcomes.h1.estimatedPnlPct ??
      r.outcomes.m15.estimatedPnlPct ??
      r.outcomes.nextClose.estimatedPnlPct;
    if (pnl != null) pnls.push(pnl);
  }

  const decided = correct + incorrect + neutral;
  return {
    key,
    total: rows.length,
    correct,
    incorrect,
    neutral,
    pending,
    accuracy: decided > 0 ? Number((correct / decided).toFixed(3)) : null,
    avgEstimatedPnlPct:
      pnls.length > 0
        ? Number((pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(5))
        : null,
  };
}

export function summarizePerformance(
  entries: DecisionPerformanceEntry[],
): PerformanceSummary {
  const bySymbolMap = new Map<string, DecisionPerformanceEntry[]>();
  const byActionMap = new Map<string, DecisionPerformanceEntry[]>();
  const confMap = new Map<string, DecisionPerformanceEntry[]>();

  for (const e of entries) {
    const refreshed = refreshOverall(e);
    const sym = bySymbolMap.get(refreshed.symbol) ?? [];
    sym.push(refreshed);
    bySymbolMap.set(refreshed.symbol, sym);

    const act = byActionMap.get(refreshed.action) ?? [];
    act.push(refreshed);
    byActionMap.set(refreshed.action, act);

    const confKey =
      refreshed.confidence >= 0.75
        ? "high (≥75%)"
        : refreshed.confidence >= 0.5
          ? "medium (50–75%)"
          : "low (<50%)";
    const conf = confMap.get(confKey) ?? [];
    conf.push(refreshed);
    confMap.set(confKey, conf);
  }

  const evaluated = entries.filter((e) =>
    ["correct", "incorrect", "neutral"].includes(e.overallLabel),
  ).length;

  return {
    totalDecisions: entries.length,
    evaluated,
    bySymbol: [...bySymbolMap.entries()].map(([k, rows]) =>
      bucketAccuracy(k, rows),
    ),
    byAction: [...byActionMap.entries()].map(([k, rows]) =>
      bucketAccuracy(k, rows),
    ),
    confidenceBuckets: [...confMap.entries()].map(([k, rows]) =>
      bucketAccuracy(k, rows),
    ),
    paperOnly: true,
    orderExecutionEnabled: false,
  };
}
