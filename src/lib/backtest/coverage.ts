/**
 * Market data coverage inventory for Strategy Lab.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runDataQualityChecks } from "@/lib/backtest/data-quality";
import type { HistoricalBar } from "@/lib/backtest/types";

const CACHE_DIR = path.join(process.cwd(), "data", "historical");

export type CoverageStatus = "READY" | "PARTIAL" | "BLOCKED" | "STALE";

export type SymbolCoverageRow = {
  symbol: string;
  timeframe: string;
  earliest: string | null;
  latest: string | null;
  expectedCandles: number | null;
  actualCandles: number;
  coveragePercentage: number | null;
  missingSessions: number;
  duplicateCount: number;
  warnings: string[];
  dataSource: string;
  adjustmentStatus: string;
  lastRefresh: string | null;
  status: CoverageStatus;
  cacheFile: string;
};

/** Rough RTH 5Min expected bars between dates (weekdays × 78). */
export function estimateExpectedRthBars(
  start: string,
  end: string,
  timeframeMinutes: number,
): number {
  const a = Date.parse(`${start}T00:00:00.000Z`);
  const b = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  let weekdays = 0;
  for (let t = a; t <= b; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) weekdays += 1;
  }
  const perDay = Math.floor((6.5 * 60) / timeframeMinutes);
  return weekdays * perDay;
}

function countDuplicates(bars: HistoricalBar[]): number {
  const seen = new Set<string>();
  let dups = 0;
  for (const b of bars) {
    if (seen.has(b.timestamp)) dups += 1;
    else seen.add(b.timestamp);
  }
  return dups;
}

function countSessionGaps(bars: HistoricalBar[]): number {
  let gaps = 0;
  let prev = -Infinity;
  for (const b of bars) {
    const ms = Date.parse(b.timestamp);
    if (prev > 0) {
      const h = (ms - prev) / 3_600_000;
      if (h > 6 && h <= 80) gaps += 1;
    }
    prev = ms;
  }
  return gaps;
}

export async function buildCoverageInventory(input?: {
  startHint?: string;
  endHint?: string;
}): Promise<SymbolCoverageRow[]> {
  let files: string[] = [];
  try {
    files = (await readdir(CACHE_DIR)).filter(
      (f) => f.endsWith(".json") && !f.includes("checkpoint"),
    );
  } catch {
    return [];
  }

  const rows: SymbolCoverageRow[] = [];
  for (const file of files) {
    if (file.endsWith(".tmp")) continue;
    try {
      const full = path.join(CACHE_DIR, file);
      const raw = await readFile(full, "utf8");
      const st = await stat(full);
      const parsed = JSON.parse(raw) as {
        bars?: HistoricalBar[];
        source?: string;
        symbol?: string;
        timeframe?: string;
        start?: string;
        end?: string;
        cachedAt?: string;
        adjusted?: boolean;
      };
      const bars = parsed.bars ?? [];
      if (bars.length === 0) continue;
      const symbol =
        parsed.symbol ?? bars[0]?.symbol ?? file.split("_")[0] ?? "UNK";
      const timeframe = parsed.timeframe ?? "5Min";
      const start =
        parsed.start ?? input?.startHint ?? bars[0]?.timestamp.slice(0, 10);
      const end =
        parsed.end ??
        input?.endHint ??
        bars.at(-1)?.timestamp.slice(0, 10) ??
        start;
      const tfMin =
        timeframe === "1Min" ? 1 : timeframe === "1Day" ? 390 : 5;
      const expected = estimateExpectedRthBars(start, end, tfMin);
      const actual = bars.length;
      const coverage =
        expected > 0 ? Number(((actual / expected) * 100).toFixed(1)) : null;
      const dups = countDuplicates(bars);
      const dq = runDataQualityChecks({ [symbol]: bars });
      const ageMs = Date.now() - st.mtimeMs;
      const stale = ageMs > 14 * 86_400_000;
      let status: CoverageStatus = "READY";
      if (!dq.passed) status = "BLOCKED";
      else if (stale) status = "STALE";
      else if (coverage != null && coverage < 70) status = "PARTIAL";
      else if (actual < 100) status = "PARTIAL";

      rows.push({
        symbol: symbol.toUpperCase(),
        timeframe,
        earliest: bars[0]?.timestamp ?? null,
        latest: bars.at(-1)?.timestamp ?? null,
        expectedCandles: expected || null,
        actualCandles: actual,
        coveragePercentage: coverage,
        missingSessions: countSessionGaps(bars),
        duplicateCount: dups,
        warnings: [
          ...dq.warnings.map((w) => w.message),
          ...dq.blocking.map((w) => w.message),
        ],
        dataSource: parsed.source ?? bars[0]?.source ?? "unknown",
        adjustmentStatus: parsed.adjusted ? "adjusted" : "unadjusted/raw",
        lastRefresh: parsed.cachedAt ?? st.mtime.toISOString(),
        status,
        cacheFile: file,
      });
    } catch {
      // skip corrupt cache files
    }
  }

  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
