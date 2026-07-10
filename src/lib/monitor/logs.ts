/**
 * Append-only monitor logs under data/monitor-logs.jsonl.
 * Never stores API keys or secrets.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MonitorLogEntry, MonitorLogEvent, MonitorLogLevel } from "@/lib/monitor/types";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "monitor-logs.jsonl");
const MAX_ENTRIES = 500;

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

function newId(): string {
  return `mlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendMonitorLog(input: {
  event: MonitorLogEvent;
  level?: MonitorLogLevel;
  message: string;
  meta?: MonitorLogEntry["meta"];
}): Promise<MonitorLogEntry> {
  await ensureDir();
  const entry: MonitorLogEntry = {
    id: newId(),
    event: input.event,
    level: input.level ?? "info",
    message: sanitizeMessage(input.message),
    timestamp: new Date().toISOString(),
    paperOnly: true,
    meta: input.meta,
  };
  await writeFile(FILE, `${JSON.stringify(entry)}\n`, { flag: "a" });
  return entry;
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/PK[A-Z0-9]{10,}/gi, "[REDACTED_KEY]")
    .replace(/sk[_-][A-Za-z0-9]{10,}/gi, "[REDACTED_SECRET]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

export async function readMonitorLogs(limit = 80): Promise<MonitorLogEntry[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const entries: MonitorLogEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as MonitorLogEntry;
        if (parsed?.paperOnly !== true || typeof parsed.event !== "string") continue;
        entries.push(parsed);
      } catch {
        /* skip bad line */
      }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function pruneMonitorLogs(): Promise<void> {
  try {
    const raw = await readFile(FILE, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length <= MAX_ENTRIES) return;
    const kept = lines.slice(-MAX_ENTRIES);
    await writeFile(FILE, `${kept.join("\n")}\n`, "utf8");
  } catch {
    /* ignore */
  }
}
