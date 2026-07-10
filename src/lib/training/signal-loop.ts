/**
 * Phase 13 — training data loop for auto-trade and monitor decisions.
 * Stores decisions + multi-horizon outcomes. Never places orders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRecentBars } from "@/lib/alpaca/client";
import type { DecisionScores } from "@/lib/alpaca/types";
import { scoreDecisionOutcome } from "@/lib/performance/score";
import { getStrategyVersion } from "@/lib/strategy/version";
import type { AutoTradeSkipCode } from "@/lib/auto-trade/types";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "signal-training.jsonl");
const MAX_ENTRIES = 500;

export type SignalOutcomeHorizon = "m5" | "m15" | "h1" | "close";

export type SignalHorizonResult = {
  price: number | null;
  at: string | null;
  returnPct: number | null;
  estimatedPnlPct: number | null;
  label: "correct" | "incorrect" | "neutral" | "pending";
};

export type SignalTrainingEntry = {
  id: string;
  source: "auto_trade" | "monitor";
  symbol: string;
  action: "BUY" | "SELL" | "HOLD" | "WATCH" | "SKIP";
  strategyVersion: string;
  priceAtDecision: number | null;
  confidence: number;
  scores: Partial<DecisionScores> | null;
  placed: boolean;
  skipCodes: AutoTradeSkipCode[];
  reason: string;
  timestamp: string;
  paperOnly: true;
  outcomes: Record<SignalOutcomeHorizon, SignalHorizonResult>;
  signalGood: boolean | null;
  autoTradeDecisionId: string | null;
};

function newId(): string {
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyOutcomes(): SignalTrainingEntry["outcomes"] {
  const pending: SignalHorizonResult = {
    price: null,
    at: null,
    returnPct: null,
    estimatedPnlPct: null,
    label: "pending",
  };
  return { m5: { ...pending }, m15: { ...pending }, h1: { ...pending }, close: { ...pending } };
}

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

async function readAll(): Promise<SignalTrainingEntry[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const rows: SignalTrainingEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as SignalTrainingEntry;
        if (parsed?.paperOnly === true) rows.push(parsed);
      } catch {
        // skip corrupt line
      }
    }
    return rows;
  } catch {
    return [];
  }
}

async function writeAll(rows: SignalTrainingEntry[]): Promise<void> {
  await ensureDir();
  const trimmed = rows.slice(-MAX_ENTRIES);
  const body = trimmed.map((r) => JSON.stringify(r)).join("\n");
  await writeFile(FILE, body ? `${body}\n` : "", "utf8");
}

export async function recordSignalDecision(input: {
  source: "auto_trade" | "monitor";
  symbol: string;
  action: SignalTrainingEntry["action"];
  priceAtDecision?: number | null;
  confidence: number;
  scores?: Partial<DecisionScores> | null;
  placed: boolean;
  skipCodes?: AutoTradeSkipCode[];
  reason: string;
  autoTradeDecisionId?: string | null;
}): Promise<SignalTrainingEntry> {
  const entry: SignalTrainingEntry = {
    id: newId(),
    source: input.source,
    symbol: input.symbol.toUpperCase(),
    action: input.action,
    strategyVersion: getStrategyVersion(),
    priceAtDecision: input.priceAtDecision ?? null,
    confidence: input.confidence,
    scores: input.scores ?? null,
    placed: input.placed,
    skipCodes: input.skipCodes ?? [],
    reason: input.reason.slice(0, 400),
    timestamp: new Date().toISOString(),
    paperOnly: true,
    outcomes: emptyOutcomes(),
    signalGood: null,
    autoTradeDecisionId: input.autoTradeDecisionId ?? null,
  };
  const rows = await readAll();
  rows.push(entry);
  await writeAll(rows);
  return entry;
}

const MS: Record<SignalOutcomeHorizon, number> = {
  m5: 5 * 60_000,
  m15: 15 * 60_000,
  h1: 60 * 60_000,
  close: 6.5 * 60 * 60_000,
};

function findPriceAfter(
  bars: { t: string; c: number }[],
  decisionMs: number,
  horizonMs: number,
): { price: number; at: string } | null {
  const target = decisionMs + horizonMs;
  for (const bar of bars) {
    const t = Date.parse(bar.t);
    if (Number.isNaN(t) || t < target) continue;
    return { price: bar.c, at: bar.t };
  }
  const last = bars.at(-1);
  if (!last) return null;
  const lastT = Date.parse(last.t);
  if (!Number.isNaN(lastT) && lastT > decisionMs) {
    return { price: last.c, at: last.t };
  }
  return null;
}

/** Update pending signal outcomes from recent bars. */
export async function updateSignalOutcomes(limit = 80): Promise<number> {
  const rows = await readAll();
  if (rows.length === 0) return 0;

  const pending = rows
    .filter((r) =>
      Object.values(r.outcomes).some((o) => o.label === "pending"),
    )
    .slice(-limit);
  if (pending.length === 0) return 0;

  const symbols = [...new Set(pending.map((r) => r.symbol))];
  const barsBySymbol = await getRecentBars(symbols, "5Min", 120);
  let updated = 0;

  const next = rows.map((entry) => {
    if (!pending.find((p) => p.id === entry.id)) return entry;
    const decisionMs = Date.parse(entry.timestamp);
    if (Number.isNaN(decisionMs)) return entry;
    const bars = barsBySymbol[entry.symbol] ?? [];
    if (bars.length === 0) return entry;

    let changed = false;
    const outcomes = { ...entry.outcomes };
    const action =
      entry.action === "BUY" || entry.action === "SELL"
        ? entry.action
        : "HOLD";

    for (const horizon of Object.keys(MS) as SignalOutcomeHorizon[]) {
      if (outcomes[horizon].label !== "pending") continue;
      const hit = findPriceAfter(bars, decisionMs, MS[horizon]);
      if (!hit || entry.priceAtDecision == null) continue;
      const scored = scoreDecisionOutcome({
        action,
        entryPrice: entry.priceAtDecision,
        laterPrice: hit.price,
        horizon: horizon === "h1" ? "h1" : "m15",
        evaluatedAt: hit.at,
      });
      outcomes[horizon] = {
        price: hit.price,
        at: hit.at,
        returnPct: scored.returnPct,
        estimatedPnlPct: scored.estimatedPnlPct,
        label:
          scored.reasonable === true
            ? "correct"
            : scored.reasonable === false
              ? "incorrect"
              : "neutral",
      };
      changed = true;
    }

    if (!changed) return entry;
    updated += 1;
    const m15 = outcomes.m15;
    const signalGood =
      m15.label === "pending"
        ? null
        : m15.label === "correct"
          ? true
          : m15.label === "incorrect"
            ? false
            : null;
    return { ...entry, outcomes, signalGood };
  });

  await writeAll(next);
  return updated;
}

export async function readSignalTraining(limit = 100): Promise<SignalTrainingEntry[]> {
  const rows = await readAll();
  return rows.slice(-limit).reverse();
}
