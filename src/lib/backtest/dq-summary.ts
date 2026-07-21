/**
 * Lightweight data-quality summary cache — avoids reloading full bar files.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const CACHE_DIR = path.join(process.cwd(), "data", "historical");
const SUMMARY_DIR = path.join(CACHE_DIR, "dq-summaries");

export type CachedDqSummary = {
  file: string;
  fingerprint: string;
  symbol: string;
  barCount: number;
  earliest: string | null;
  latest: string | null;
  duplicateEstimate: number;
  gapWarnings: number;
  status: "READY" | "PARTIAL" | "BLOCKED" | "STALE";
  checkedAt: string;
  mtimeMs: number;
  sizeBytes: number;
};

/**
 * Stream-scan a cache JSON file for timestamps only (does not parse full OHLC array into memory twice).
 * For our format `{bars:[...]}` we still need JSON.parse — so we prefer summary cache by mtime+size.
 */
export async function getOrBuildDqSummary(
  fileName: string,
  options?: { timeoutMs?: number },
): Promise<CachedDqSummary> {
  const full = path.join(CACHE_DIR, fileName);
  const st = await stat(full);
  const fingerprint = createHash("sha256")
    .update(`${fileName}|${st.size}|${st.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
  const summaryFile = path.join(SUMMARY_DIR, `${fingerprint}.json`);
  try {
    const cached = JSON.parse(
      await readFile(summaryFile, "utf8"),
    ) as CachedDqSummary;
    if (cached.fingerprint === fingerprint) return cached;
  } catch {
    /* rebuild */
  }

  const timeoutMs = options?.timeoutMs ?? 60_000;
  const started = Date.now();

  // Read file; if huge, still parse once but cache summary aggressively
  const raw = await readFile(full, "utf8");
  if (Date.now() - started > timeoutMs) {
    throw new Error(`DQ summary timeout for ${fileName}`);
  }
  const parsed = JSON.parse(raw) as {
    bars?: { timestamp: string; symbol?: string }[];
    symbol?: string;
  };
  const bars = parsed.bars ?? [];
  const seen = new Set<string>();
  let dups = 0;
  let gaps = 0;
  let prev = -Infinity;
  for (const b of bars) {
    if (seen.has(b.timestamp)) dups += 1;
    seen.add(b.timestamp);
    const ms = Date.parse(b.timestamp);
    if (prev > 0) {
      const h = (ms - prev) / 3_600_000;
      if (h > 0.4 && h < 6) gaps += 1;
    }
    prev = ms;
  }
  const status: CachedDqSummary["status"] =
    bars.length < 100 ? "PARTIAL" : dups > 10 ? "BLOCKED" : "READY";
  const age = Date.now() - st.mtimeMs;
  const summary: CachedDqSummary = {
    file: fileName,
    fingerprint,
    symbol: parsed.symbol ?? bars[0]?.symbol ?? fileName.split("_")[0]!,
    barCount: bars.length,
    earliest: bars[0]?.timestamp ?? null,
    latest: bars.at(-1)?.timestamp ?? null,
    duplicateEstimate: dups,
    gapWarnings: gaps,
    status: age > 14 * 86_400_000 ? "STALE" : status,
    checkedAt: new Date().toISOString(),
    mtimeMs: st.mtimeMs,
    sizeBytes: st.size,
  };
  await mkdir(SUMMARY_DIR, { recursive: true });
  await writeFile(summaryFile, `${JSON.stringify(summary)}\n`, "utf8");
  return summary;
}

export async function listDqSummaries(): Promise<CachedDqSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(CACHE_DIR)).filter(
      (f) => f.endsWith(".json") && !f.includes("checkpoint"),
    );
  } catch {
    return [];
  }
  const out: CachedDqSummary[] = [];
  for (const f of files) {
    try {
      out.push(await getOrBuildDqSummary(f));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Progress-friendly line counter for jsonl (unused for bar JSON but available). */
export async function countJsonlLines(file: string): Promise<number> {
  let n = 0;
  const rl = readline.createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    void line;
    n += 1;
  }
  return n;
}
