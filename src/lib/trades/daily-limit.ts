import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marketDayKey } from "@/lib/market/time";

const HISTORY_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(HISTORY_DIR, "paper-trade-log.jsonl");

type PaperTradeLogRow = {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  notional?: number | null;
  submittedAt: string;
  paperOnly: true;
};

async function ensureDir() {
  await mkdir(HISTORY_DIR, { recursive: true });
}

async function readAll(): Promise<PaperTradeLogRow[]> {
  try {
    const raw = await readFile(LOG_FILE, "utf8");
    const rows: PaperTradeLogRow[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as PaperTradeLogRow;
        if (
          parsed &&
          parsed.paperOnly === true &&
          typeof parsed.submittedAt === "string"
        ) {
          rows.push(parsed);
        }
      } catch {
        // skip bad lines
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/** Count paper trades submitted today (Eastern market day). Never logs secrets. */
export async function countDailyPaperTrades(
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  const day = marketDayKey(nowIso);
  const rows = await readAll();
  return rows.filter((r) => marketDayKey(r.submittedAt) === day).length;
}

export async function appendPaperTradeLog(row: {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  notional?: number | null;
  submittedAt: string;
}): Promise<void> {
  await ensureDir();
  const entry: PaperTradeLogRow = {
    id: row.id,
    symbol: row.symbol.toUpperCase(),
    side: row.side,
    qty: row.qty,
    notional: row.notional ?? null,
    submittedAt: row.submittedAt,
    paperOnly: true,
  };
  await writeFile(LOG_FILE, `${JSON.stringify(entry)}\n`, { flag: "a" });
}
