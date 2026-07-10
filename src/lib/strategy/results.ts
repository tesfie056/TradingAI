/**
 * Phase 15 — persist backtest results per strategy version.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BacktestResult } from "@/lib/performance/types";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "strategy-results.jsonl");
const MAX = 50;

export type StoredStrategyResult = BacktestResult & {
  storedAt: string;
};

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

export async function appendStrategyBacktestResult(
  result: BacktestResult,
): Promise<void> {
  await ensureDir();
  const row: StoredStrategyResult = {
    ...result,
    storedAt: new Date().toISOString(),
  };
  let existing = "";
  try {
    existing = await readFile(FILE, "utf8");
  } catch {
    // new file
  }
  const lines = existing.split("\n").filter((l) => l.trim());
  lines.push(JSON.stringify(row));
  const trimmed = lines.slice(-MAX);
  await writeFile(FILE, `${trimmed.join("\n")}\n`, "utf8");
}

export async function readStrategyResults(limit = 10): Promise<StoredStrategyResult[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const rows: StoredStrategyResult[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t) as StoredStrategyResult);
      } catch {
        // skip
      }
    }
    return rows.slice(-limit).reverse();
  } catch {
    return [];
  }
}
