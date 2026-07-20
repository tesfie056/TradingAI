/**
 * Controlled historical download + cache (gitignored under data/historical).
 * Resumable via checkpoint JSON. Never commits datasets to git.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import {
  getHistoricalBarsPaged,
  type BarTimeframe,
} from "@/lib/alpaca/client";
import {
  alpacaToHistorical,
  dedupeHistoricalBars,
} from "@/lib/backtest/historical-data";
import type { HistoricalBar } from "@/lib/backtest/types";
import { runDataQualityChecks } from "@/lib/backtest/data-quality";

const CACHE_DIR = path.join(process.cwd(), "data", "historical");
const CHECKPOINT_DIR = path.join(CACHE_DIR, "checkpoints");

export type DownloadJobSpec = {
  symbols: string[];
  start: string;
  end: string;
  timeframe: BarTimeframe;
  adjustment?: "raw" | "split" | "dividend" | "all";
  feed?: "iex" | "sip";
};

export type SymbolDownloadResult = {
  symbol: string;
  status: "READY" | "PARTIAL" | "BLOCKED" | "FAILED";
  bars: number;
  earliest: string | null;
  latest: string | null;
  pages: number;
  fromCheckpoint: boolean;
  source: string;
  error?: string;
};

export type DownloadJobResult = {
  jobId: string;
  spec: DownloadJobSpec;
  results: SymbolDownloadResult[];
  completedAt: string;
};

function jobId(spec: DownloadJobSpec): string {
  return createHash("sha256")
    .update(
      `${spec.symbols.sort().join(",")}|${spec.timeframe}|${spec.start}|${spec.end}|${spec.adjustment ?? "raw"}|${spec.feed ?? "iex"}`,
    )
    .digest("hex")
    .slice(0, 16);
}

export function cacheFileName(
  symbol: string,
  timeframe: BarTimeframe,
  start: string,
  end: string,
): string {
  const h = createHash("sha256")
    .update(`${symbol}|${timeframe}|${start}|${end}`)
    .digest("hex")
    .slice(0, 16);
  return `${symbol.toUpperCase()}_${timeframe}_${h}.json`;
}

async function writeJsonAtomic(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 0)}\n`, "utf8");
  await rename(tmp, file);
}

export async function readCachedBars(
  symbol: string,
  timeframe: BarTimeframe,
  start: string,
  end: string,
): Promise<HistoricalBar[] | null> {
  try {
    const file = path.join(
      CACHE_DIR,
      cacheFileName(symbol, timeframe, start, end),
    );
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as {
      bars: HistoricalBar[];
      source?: string;
    };
    return dedupeHistoricalBars(parsed.bars ?? []);
  } catch {
    return null;
  }
}

export async function writeCachedBars(input: {
  symbol: string;
  timeframe: BarTimeframe;
  start: string;
  end: string;
  bars: HistoricalBar[];
  source: string;
}): Promise<string> {
  const file = cacheFileName(
    input.symbol,
    input.timeframe,
    input.start,
    input.end,
  );
  const full = path.join(CACHE_DIR, file);
  await writeJsonAtomic(full, {
    bars: dedupeHistoricalBars(input.bars),
    source: input.source,
    symbol: input.symbol.toUpperCase(),
    timeframe: input.timeframe,
    start: input.start,
    end: input.end,
    cachedAt: new Date().toISOString(),
    adjusted: false,
  });
  return file;
}

type Checkpoint = {
  jobId: string;
  spec: DownloadJobSpec;
  completedSymbols: string[];
  failed: { symbol: string; error: string }[];
  updatedAt: string;
};

async function readCheckpoint(id: string): Promise<Checkpoint | null> {
  try {
    const raw = await readFile(
      path.join(CHECKPOINT_DIR, `${id}.json`),
      "utf8",
    );
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return null;
  }
}

async function writeCheckpoint(cp: Checkpoint) {
  await writeJsonAtomic(path.join(CHECKPOINT_DIR, `${cp.jobId}.json`), cp);
}

/**
 * Download (or resume) historical bars into disk cache.
 */
export async function downloadHistoricalJob(
  spec: DownloadJobSpec,
  options?: {
    resume?: boolean;
    onProgress?: (msg: string) => void;
  },
): Promise<DownloadJobResult> {
  const id = jobId(spec);
  const resume = options?.resume !== false;
  let cp: Checkpoint | null = resume ? await readCheckpoint(id) : null;
  if (!cp) {
    cp = {
      jobId: id,
      spec,
      completedSymbols: [],
      failed: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const results: SymbolDownloadResult[] = [];
  const source = `alpaca_${spec.feed ?? "iex"}_${spec.adjustment ?? "raw"}`;

  for (const rawSymbol of spec.symbols) {
    const symbol = rawSymbol.toUpperCase();
    if (cp.completedSymbols.includes(symbol)) {
      const cached = await readCachedBars(
        symbol,
        spec.timeframe,
        spec.start,
        spec.end,
      );
      results.push({
        symbol,
        status: cached && cached.length >= 20 ? "READY" : "PARTIAL",
        bars: cached?.length ?? 0,
        earliest: cached?.[0]?.timestamp ?? null,
        latest: cached?.at(-1)?.timestamp ?? null,
        pages: 0,
        fromCheckpoint: true,
        source,
      });
      options?.onProgress?.(
        `resume skip ${symbol} (${cached?.length ?? 0} cached bars)`,
      );
      continue;
    }

    try {
      options?.onProgress?.(`downloading ${symbol} ${spec.timeframe}…`);
      const paged = await getHistoricalBarsPaged({
        symbol,
        timeframe: spec.timeframe,
        start: `${spec.start}T00:00:00.000Z`,
        end: `${spec.end}T23:59:59.999Z`,
        adjustment: spec.adjustment ?? "raw",
        feed: spec.feed ?? "iex",
        onPage: (info) =>
          options?.onProgress?.(
            `${symbol} page ${info.page}: +${info.barsThisPage} (total ${info.totalSoFar})`,
          ),
      });
      const bars = alpacaToHistorical(symbol, paged.bars, source);
      const deduped = dedupeHistoricalBars(bars);
      await writeCachedBars({
        symbol,
        timeframe: spec.timeframe,
        start: spec.start,
        end: spec.end,
        bars: deduped,
        source,
      });

      const dq = runDataQualityChecks({ [symbol]: deduped });
      const status: SymbolDownloadResult["status"] = !dq.passed
        ? "BLOCKED"
        : deduped.length < 500
          ? "PARTIAL"
          : "READY";

      results.push({
        symbol,
        status,
        bars: deduped.length,
        earliest: deduped[0]?.timestamp ?? null,
        latest: deduped.at(-1)?.timestamp ?? null,
        pages: paged.pages,
        fromCheckpoint: false,
        source,
      });

      cp.completedSymbols.push(symbol);
      cp.updatedAt = new Date().toISOString();
      await writeCheckpoint(cp);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      cp.failed.push({ symbol, error });
      cp.updatedAt = new Date().toISOString();
      await writeCheckpoint(cp);
      results.push({
        symbol,
        status: "FAILED",
        bars: 0,
        earliest: null,
        latest: null,
        pages: 0,
        fromCheckpoint: false,
        source,
        error,
      });
      options?.onProgress?.(`FAILED ${symbol}: ${error}`);
    }
  }

  return {
    jobId: id,
    spec,
    results,
    completedAt: new Date().toISOString(),
  };
}

/** Load multi-symbol bars strictly from cache (no network). */
export async function loadCachedUniverse(input: {
  symbols: string[];
  timeframe: BarTimeframe;
  start: string;
  end: string;
}): Promise<{
  bySymbol: Record<string, HistoricalBar[]>;
  missing: string[];
  sourceBySymbol: Record<string, string>;
}> {
  const bySymbol: Record<string, HistoricalBar[]> = {};
  const missing: string[] = [];
  const sourceBySymbol: Record<string, string> = {};
  for (const s of input.symbols) {
    const symbol = s.toUpperCase();
    const bars = await readCachedBars(
      symbol,
      input.timeframe,
      input.start,
      input.end,
    );
    if (!bars || bars.length === 0) {
      missing.push(symbol);
      continue;
    }
    bySymbol[symbol] = bars;
    sourceBySymbol[symbol] = bars[0]?.source ?? "cache";
  }
  return { bySymbol, missing, sourceBySymbol };
}
