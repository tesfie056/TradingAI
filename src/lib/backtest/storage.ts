/**
 * Persist backtest runs under data/backtests/ (gitignored).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BacktestRunRecord } from "@/lib/backtest/types";

const DIR = path.join(process.cwd(), "data", "backtests");
const INDEX = path.join(DIR, "index.jsonl");
const MAX = 100;

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

export async function saveBacktestRun(
  run: BacktestRunRecord,
): Promise<BacktestRunRecord> {
  await ensureDir();
  await writeFile(
    path.join(DIR, `${run.id}.json`),
    `${JSON.stringify(run, null, 2)}\n`,
    "utf8",
  );
  let lines: string[] = [];
  try {
    const raw = await readFile(INDEX, "utf8");
    lines = raw.split("\n").filter(Boolean);
  } catch {
    lines = [];
  }
  lines.push(
    JSON.stringify({
      id: run.id,
      createdAt: run.createdAt,
      kind: run.kind,
      strategyVersion: run.strategyVersion,
      metricsTrades: run.metrics.totalTrades,
    }),
  );
  if (lines.length > MAX) lines = lines.slice(-MAX);
  await writeFile(INDEX, `${lines.join("\n")}\n`, "utf8");
  return run;
}

export async function readBacktestRun(
  id: string,
): Promise<BacktestRunRecord | null> {
  try {
    const raw = await readFile(path.join(DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as BacktestRunRecord;
  } catch {
    return null;
  }
}

export async function listBacktestRuns(limit = 50): Promise<
  {
    id: string;
    createdAt: string;
    kind: string;
    strategyVersion: string;
    metricsTrades: number;
  }[]
> {
  try {
    const raw = await readFile(INDEX, "utf8");
    const rows = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as {
        id: string;
        createdAt: string;
        kind: string;
        strategyVersion: string;
        metricsTrades: number;
      });
    return rows.slice(-limit).reverse();
  } catch {
    return [];
  }
}
