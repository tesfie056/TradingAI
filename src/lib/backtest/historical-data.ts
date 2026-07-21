/**
 * Historical bar interface + disk cache (gitignored under data/).
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRecentBars, getHistoricalBarsPaged, type BarTimeframe } from "@/lib/alpaca/client";
import type { AlpacaBar } from "@/lib/alpaca/types";
import type { HistoricalBar } from "@/lib/backtest/types";

const CACHE_DIR = path.join(process.cwd(), "data", "historical");

function cacheKey(
  symbol: string,
  timeframe: BarTimeframe,
  start: string,
  end: string,
): string {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  const h = createHash("sha256")
    .update(`${symbol}|${timeframe}|${s}|${e}`)
    .digest("hex")
    .slice(0, 16);
  return `${symbol}_${timeframe}_${h}.json`;
}

function toHistorical(
  symbol: string,
  bar: AlpacaBar,
  source: string,
): HistoricalBar {
  return {
    symbol: symbol.toUpperCase(),
    timestamp: bar.t,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    tradeCount: null,
    vwap: null,
    bid: null,
    ask: null,
    adjusted: false,
    source,
    retrievedAt: new Date().toISOString(),
  };
}

export function alpacaToHistorical(
  symbol: string,
  bars: AlpacaBar[],
  source = "alpaca_iex",
): HistoricalBar[] {
  return bars.map((b) => toHistorical(symbol, b, source));
}

export function historicalToAlpaca(bars: HistoricalBar[]): AlpacaBar[] {
  return bars.map((b) => ({
    t: b.timestamp,
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
  }));
}

/** Stable chronological dedupe by timestamp (keeps first). */
export function dedupeHistoricalBars(bars: HistoricalBar[]): HistoricalBar[] {
  const seen = new Set<string>();
  const out: HistoricalBar[] = [];
  const sorted = [...bars].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  for (const b of sorted) {
    if (seen.has(b.timestamp)) continue;
    seen.add(b.timestamp);
    out.push(b);
  }
  return out;
}

/** Synthetic bars for offline verify (deterministic). */
export function generateSyntheticBars(input: {
  symbol: string;
  startIso: string;
  count: number;
  timeframeMinutes: number;
  startPrice?: number;
  seed?: number;
  /** Mild upward bias so shared evaluator can produce occasional BUYs. */
  trendBias?: number;
}): HistoricalBar[] {
  const startMs = Date.parse(input.startIso);
  const price0 = input.startPrice ?? 50;
  let seed = input.seed ?? 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const bias = input.trendBias ?? 0.52;
  const out: HistoricalBar[] = [];
  let px = price0;
  for (let i = 0; i < input.count; i++) {
    const t = new Date(startMs + i * input.timeframeMinutes * 60_000).toISOString();
    const drift = (rand() - (1 - bias)) * 0.012 * px;
    const o = px;
    const c = Math.max(1, px + drift);
    const h = Math.max(o, c) * (1 + rand() * 0.004);
    const l = Math.min(o, c) * (1 - rand() * 0.004);
    const vol = 100_000 + Math.floor(rand() * 50_000);
    out.push({
      symbol: input.symbol.toUpperCase(),
      timestamp: t,
      open: Number(o.toFixed(4)),
      high: Number(h.toFixed(4)),
      low: Number(l.toFixed(4)),
      close: Number(c.toFixed(4)),
      volume: vol,
      tradeCount: null,
      vwap: Number(((o + h + l + c) / 4).toFixed(4)),
      bid: Number((c * 0.9995).toFixed(4)),
      ask: Number((c * 1.0005).toFixed(4)),
      adjusted: false,
      source: "synthetic",
      retrievedAt: new Date().toISOString(),
    });
    px = c;
  }
  return out;
}

/**
 * Weekday RTH-ish 5Min bars across a calendar range (for walk-forward spans).
 * Still synthetic — not real market history.
 */
export function generateSyntheticRange(input: {
  symbol: string;
  startDate: string;
  endDate: string;
  timeframeMinutes?: number;
  startPrice?: number;
  seed?: number;
}): HistoricalBar[] {
  const tf = input.timeframeMinutes ?? 5;
  const barsPerDay = Math.floor((6.5 * 60) / tf);
  const out: HistoricalBar[] = [];
  let seed = input.seed ?? 42;
  let px = input.startPrice ?? 50;
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate}T00:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const dayIso = d.toISOString().slice(0, 10);
    const dayBars = generateSyntheticBars({
      symbol: input.symbol,
      startIso: `${dayIso}T14:30:00.000Z`,
      count: barsPerDay,
      timeframeMinutes: tf,
      startPrice: px,
      seed: seed++,
      trendBias: 0.53,
    });
    out.push(...dayBars);
    px = dayBars.at(-1)?.close ?? px;
  }
  return out;
}

async function readCache(file: string): Promise<HistoricalBar[] | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, file), "utf8");
    const parsed = JSON.parse(raw) as { bars: HistoricalBar[] };
    return parsed.bars ?? null;
  } catch {
    return null;
  }
}

async function writeCache(file: string, bars: HistoricalBar[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    path.join(CACHE_DIR, file),
    `${JSON.stringify({ bars, cachedAt: new Date().toISOString() }, null, 0)}\n`,
    "utf8",
  );
}

/**
 * Fetch historical bars with optional disk cache.
 * Uses Alpaca start/end when provided. Never commits data to git (data/ ignored).
 */
export async function getHistoricalBars(input: {
  symbol: string;
  timeframe?: BarTimeframe;
  start: string;
  end: string;
  limit?: number;
  useCache?: boolean;
  /** Use Alpaca pagination for multi-month ranges (I-3). */
  paginate?: boolean;
}): Promise<{ bars: HistoricalBar[]; datasetId: string; fromCache: boolean }> {
  const timeframe = input.timeframe ?? "5Min";
  const symbol = input.symbol.toUpperCase();
  const file = cacheKey(symbol, timeframe, input.start, input.end);
  const datasetId = `hist_${symbol}_${timeframe}_${file.replace(".json", "")}`;

  if (input.useCache !== false) {
    const cached = await readCache(file);
    if (cached && cached.length > 0) {
      return { bars: dedupeHistoricalBars(cached), datasetId, fromCache: true };
    }
  }

  let bars: HistoricalBar[];
  if (input.paginate) {
    const paged = await getHistoricalBarsPaged({
      symbol,
      timeframe,
      start: input.start,
      end: input.end,
    });
    bars = alpacaToHistorical(symbol, paged.bars, "alpaca_iex");
  } else {
    const raw = await getRecentBars(
      [symbol],
      timeframe,
      input.limit ?? 500,
      { start: input.start, end: input.end },
    );
    bars = alpacaToHistorical(symbol, raw[symbol] ?? [], "alpaca_iex");
  }
  bars = dedupeHistoricalBars(bars);
  if (bars.length > 0 && input.useCache !== false) {
    await writeCache(file, bars).catch(() => undefined);
  }
  return { bars, datasetId, fromCache: false };
}

export async function getHistoricalBarsMulti(input: {
  symbols: string[];
  timeframe?: BarTimeframe;
  start: string;
  end: string;
  limit?: number;
  useCache?: boolean;
  paginate?: boolean;
}): Promise<{
  bySymbol: Record<string, HistoricalBar[]>;
  datasetId: string;
}> {
  const bySymbol: Record<string, HistoricalBar[]> = {};
  const ids: string[] = [];
  for (const symbol of input.symbols) {
    const r = await getHistoricalBars({ ...input, symbol });
    bySymbol[symbol.toUpperCase()] = r.bars;
    ids.push(r.datasetId);
  }
  const datasetId = createHash("sha256")
    .update(ids.sort().join("|"))
    .digest("hex")
    .slice(0, 20);
  return { bySymbol, datasetId: `multi_${datasetId}` };
}
