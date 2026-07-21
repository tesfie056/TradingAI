/**
 * Persist auto-trade decisions before order submission.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutoTradeDecision } from "@/lib/auto-trade/types";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "auto-trade-decisions.jsonl");
const MAX_ENTRIES = 300;

function newId(): string {
  return `atdec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

async function readAll(): Promise<AutoTradeDecision[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const rows: AutoTradeDecision[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as AutoTradeDecision;
        if (parsed?.paperOnly === true) rows.push(parsed);
      } catch {
        // skip
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export async function saveAutoTradeDecision(
  input: Omit<AutoTradeDecision, "id" | "createdAt" | "paperOnly"> & {
    id?: string;
    createdAt?: string;
  },
): Promise<AutoTradeDecision> {
  await ensureDir();
  const decision: AutoTradeDecision = {
    id: input.id ?? newId(),
    opportunityId: input.opportunityId,
    symbol: input.symbol.toUpperCase(),
    action: input.action,
    orderMode: input.orderMode,
    notional: input.notional,
    confidence: input.confidence,
    reason: input.reason,
    status: input.status,
    blockers: input.blockers,
    createdAt: input.createdAt ?? new Date().toISOString(),
    submittedAt: input.submittedAt,
    orderId: input.orderId,
    orderStatus: input.orderStatus,
    filledAvgPrice: input.filledAvgPrice,
    estimatedPnL: input.estimatedPnL,
    paperOnly: true,
  };
  await writeFile(FILE, `${JSON.stringify(decision)}\n`, { flag: "a" });
  return decision;
}

export async function updateAutoTradeDecision(
  id: string,
  patch: Partial<
    Pick<
      AutoTradeDecision,
      | "status"
      | "submittedAt"
      | "orderId"
      | "orderStatus"
      | "filledAvgPrice"
      | "estimatedPnL"
      | "blockers"
    >
  >,
): Promise<AutoTradeDecision | null> {
  const rows = await readAll();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const updated: AutoTradeDecision = { ...rows[idx]!, ...patch };
  rows[idx] = updated;
  await ensureDir();
  const content = rows.map((r) => JSON.stringify(r)).join("\n");
  await writeFile(FILE, content ? `${content}\n` : "", "utf8");
  return updated;
}

export async function readAutoTradeDecisions(
  limit = 40,
): Promise<AutoTradeDecision[]> {
  const rows = await readAll();
  return rows.slice(-limit).reverse();
}

export async function hasProcessedOpportunity(
  opportunityId: string,
): Promise<boolean> {
  const rows = await readAll();
  return rows.some(
    (r) =>
      r.opportunityId === opportunityId &&
      (r.status === "pending" ||
        r.status === "submitted" ||
        r.status === "filled"),
  );
}

export async function getRecentSymbolTrades(
  symbol: string,
  sinceMs: number,
): Promise<AutoTradeDecision[]> {
  const since = Date.now() - sinceMs;
  const rows = await readAll();
  return rows.filter((r) => {
    if (r.symbol !== symbol.toUpperCase()) return false;
    const t = new Date(r.submittedAt ?? r.createdAt).getTime();
    return t >= since;
  });
}

export async function pruneAutoTradeDecisions(): Promise<void> {
  const rows = await readAll();
  if (rows.length <= MAX_ENTRIES) return;
  const kept = rows.slice(-MAX_ENTRIES);
  await ensureDir();
  const content = kept.map((r) => JSON.stringify(r)).join("\n");
  await writeFile(FILE, content ? `${content}\n` : "", "utf8");
}
