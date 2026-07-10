/**
 * Append-only auto-trade logs under data/auto-trade-logs.jsonl.
 * Never stores API keys or secrets.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutoTradeLogEntry,
  AutoTradeLogEvent,
  AutoTradeLogLevel,
  AutoTradeSkipCode,
} from "@/lib/auto-trade/types";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "auto-trade-logs.jsonl");
const MAX_ENTRIES = 500;

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

function newId(): string {
  return `atlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/PK[A-Z0-9]{10,}/gi, "[REDACTED_KEY]")
    .replace(/sk[_-][A-Za-z0-9]{10,}/gi, "[REDACTED_SECRET]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

export async function appendAutoTradeLog(input: {
  event: AutoTradeLogEvent;
  level?: AutoTradeLogLevel;
  message: string;
  symbol?: string;
  opportunityId?: string;
  skipCode?: AutoTradeSkipCode;
  meta?: AutoTradeLogEntry["meta"];
}): Promise<AutoTradeLogEntry> {
  await ensureDir();
  const entry: AutoTradeLogEntry = {
    id: newId(),
    event: input.event,
    level: input.level ?? "info",
    message: sanitizeMessage(input.message),
    timestamp: new Date().toISOString(),
    paperOnly: true,
    symbol: input.symbol,
    opportunityId: input.opportunityId,
    skipCode: input.skipCode,
    meta: input.meta,
  };
  await writeFile(FILE, `${JSON.stringify(entry)}\n`, { flag: "a" });
  return entry;
}

export async function readAutoTradeLogs(limit = 80): Promise<AutoTradeLogEntry[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const entries: AutoTradeLogEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as AutoTradeLogEntry;
        if (parsed?.paperOnly !== true || typeof parsed.event !== "string") continue;
        entries.push(parsed);
      } catch {
        // skip bad lines
      }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function pruneAutoTradeLogs(): Promise<void> {
  try {
    const raw = await readFile(FILE, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length <= MAX_ENTRIES) return;
    const kept = lines.slice(-MAX_ENTRIES);
    await writeFile(FILE, `${kept.join("\n")}\n`, "utf8");
  } catch {
    // no file yet
  }
}
