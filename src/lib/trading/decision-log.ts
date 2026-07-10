/**
 * Structured explainable decision log for scans and proposals.
 * Paper only. Not shown on the main trader dashboard by default.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RiskRejectionCode } from "@/lib/risk/engine";
import type { TradeProposal } from "@/lib/trading/proposal";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "decision-log.jsonl");
const MAX = 800;

export type DecisionLogFinalAction =
  | "submitted"
  | "rejected_risk"
  | "rejected_eligibility"
  | "rejected_broker"
  | "skipped"
  | "scanned";

export type DecisionLogEntry = {
  id: string;
  time: string;
  symbol: string;
  strategy: string;
  marketState: string;
  indicators: Record<string, string | number | boolean | null>;
  confidence: number;
  proposedTrade: {
    direction: string;
    entry: number;
    stopLoss: number;
    takeProfit: number;
  } | null;
  riskValidation: {
    approved: boolean;
    code: RiskRejectionCode | string | null;
    reason: string | null;
    qty: number | null;
    notional: number | null;
  } | null;
  finalAction: DecisionLogFinalAction;
  rejectionReason: string | null;
  alpacaOrderId: string | null;
  error: string | null;
  paperOnly: true;
};

function newId(): string {
  return `dlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

export async function appendDecisionLog(
  input: Omit<DecisionLogEntry, "id" | "time" | "paperOnly"> & {
    id?: string;
    time?: string;
  },
): Promise<DecisionLogEntry> {
  await ensureDir();
  const entry: DecisionLogEntry = {
    id: input.id ?? newId(),
    time: input.time ?? new Date().toISOString(),
    symbol: input.symbol.toUpperCase(),
    strategy: input.strategy,
    marketState: input.marketState,
    indicators: input.indicators,
    confidence: input.confidence,
    proposedTrade: input.proposedTrade,
    riskValidation: input.riskValidation,
    finalAction: input.finalAction,
    rejectionReason: input.rejectionReason,
    alpacaOrderId: input.alpacaOrderId,
    error: input.error,
    paperOnly: true,
  };
  await writeFile(FILE, `${JSON.stringify(entry)}\n`, { flag: "a" });
  return entry;
}

export async function readDecisionLog(limit = 50): Promise<DecisionLogEntry[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const rows: DecisionLogEntry[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t) as DecisionLogEntry;
        if (parsed?.paperOnly === true) rows.push(parsed);
      } catch {
        // skip
      }
    }
    return rows.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function pruneDecisionLog(): Promise<void> {
  try {
    const raw = await readFile(FILE, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length <= MAX) return;
    await writeFile(FILE, `${lines.slice(-MAX).join("\n")}\n`, "utf8");
  } catch {
    // ignore
  }
}

export function proposalToLogTrade(p: TradeProposal) {
  return {
    direction: p.direction,
    entry: p.proposedEntry,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
  };
}
