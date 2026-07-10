/**
 * Local opportunity queue — data/opportunities.jsonl
 * Paper-only detections. Never places orders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MonitorOpportunity } from "@/lib/monitor/types";
import { appendMonitorLog } from "@/lib/monitor/logs";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "opportunities.jsonl");
const MAX_ENTRIES = 400;

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

function isOpportunity(value: unknown): value is MonitorOpportunity {
  if (!value || typeof value !== "object") return false;
  const v = value as MonitorOpportunity;
  return (
    typeof v.id === "string" &&
    typeof v.symbol === "string" &&
    v.paperOnly === true &&
    typeof v.action === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.expiresAt === "string"
  );
}

export async function appendOpportunities(
  opportunities: MonitorOpportunity[],
): Promise<void> {
  if (opportunities.length === 0) return;
  await ensureDir();
  const lines = opportunities.map((o) => JSON.stringify(o)).join("\n") + "\n";
  await writeFile(FILE, lines, { flag: "a" });
  for (const o of opportunities) {
    await appendMonitorLog({
      event: "opportunity_created",
      message: `Opportunity ${o.action} ${o.symbol} score=${o.score.toFixed(2)}`,
      meta: {
        symbol: o.symbol,
        action: o.action,
        score: o.score,
        readyForPaperPreview: o.readyForPaperPreview,
      },
    });
  }
}

export async function readOpportunities(limit = 100): Promise<MonitorOpportunity[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const entries: MonitorOpportunity[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as MonitorOpportunity;
        if (!isOpportunity(parsed)) continue;
        entries.push(parsed);
      } catch {
        /* skip */
      }
    }
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function readActiveOpportunities(
  now = Date.now(),
): Promise<MonitorOpportunity[]> {
  const all = await readOpportunities(200);
  return all.filter((o) => Date.parse(o.expiresAt) > now);
}

export async function expireStaleOpportunities(
  now = Date.now(),
): Promise<number> {
  const all = await readOpportunities(400);
  let expired = 0;
  for (const o of all) {
    if (Date.parse(o.expiresAt) <= now) {
      expired += 1;
    }
  }
  // Log a summary once per prune pass if any expired recently in the tail
  const recentlyExpired = all.filter((o) => {
    const exp = Date.parse(o.expiresAt);
    return exp <= now && now - exp < 6 * 60_000;
  });
  if (recentlyExpired.length > 0) {
    await appendMonitorLog({
      event: "opportunity_expired",
      level: "info",
      message: `${recentlyExpired.length} opportunity(ies) expired`,
      meta: { count: recentlyExpired.length },
    });
  }
  return expired;
}

export async function pruneOpportunities(): Promise<void> {
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

export function pickTopOpportunity(
  opportunities: MonitorOpportunity[],
): MonitorOpportunity | null {
  if (opportunities.length === 0) return null;
  const ranked = [...opportunities].sort((a, b) => {
    const readyBoost = (o: MonitorOpportunity) =>
      o.readyForPaperPreview ? 0.15 : 0;
    const actionBoost = (o: MonitorOpportunity) =>
      o.action === "BUY" || o.action === "SELL"
        ? 0.1
        : o.action === "WATCH"
          ? 0.05
          : 0;
    const sa = a.score * 0.6 + a.confidence * 0.4 + readyBoost(a) + actionBoost(a);
    const sb = b.score * 0.6 + b.confidence * 0.4 + readyBoost(b) + actionBoost(b);
    return sb - sa;
  });
  return ranked[0] ?? null;
}
