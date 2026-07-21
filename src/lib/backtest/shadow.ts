/**
 * Live paper-market shadow evaluation.
 * Challenger is structurally unable to call broker submission.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  evaluateStrategyAt,
  type StrategyEvalResult,
} from "@/lib/backtest/evaluator";
import { applyEntryCosts, defaultAssumptions, estimateSlippagePct, estimateSpreadPct } from "@/lib/backtest/costs";
import { alpacaToHistorical } from "@/lib/backtest/historical-data";
import type { AlpacaBar, AlpacaQuote } from "@/lib/alpaca/types";
import type { MarketRegime } from "@/lib/learning/regime";

const DIR = path.join(process.cwd(), "data", "shadow");
const DECISIONS = path.join(DIR, "decisions.jsonl");

export type ShadowDecisionRecord = {
  id: string;
  sessionId: string;
  decisionTime: string;
  symbol: string;
  regime: MarketRegime | "unknown";
  strategyVersion: string;
  role: "champion" | "challenger";
  action: string;
  confidence: number;
  proposal: {
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  };
  rejectionReasons: string[];
  intendedQty: number | null;
  simulatedFill: number | null;
  slippageEstimate: number | null;
  spreadEstimate: number | null;
  brokerSubmitAttempted: false;
  paperOnly: true;
};

export type ShadowSessionSummary = {
  sessionId: string;
  date: string;
  championProposals: number;
  challengerProposals: number;
  matchingProposals: number;
  championOnly: number;
  challengerOnly: number;
  simulatedTrades: number;
  safetyViolations: number;
  note: string;
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

async function appendJsonl(file: string, row: unknown) {
  await mkdir(DIR, { recursive: true });
  await writeFile(file, `${JSON.stringify(row)}\n`, { flag: "a" });
}

/**
 * Evaluate challenger in shadow mode — NEVER imports or calls broker adapters.
 */
export function evaluateChallengerShadow(input: {
  decisionTime: string;
  symbol: string;
  bars5Min: AlpacaBar[];
  quote?: AlpacaQuote | null;
  blockedRegimes: string[];
  strategyVersion: string;
}): StrategyEvalResult & { brokerSubmit: false; shadowOnly: true } {
  const result = evaluateStrategyAt({
    decisionTime: input.decisionTime,
    symbol: input.symbol,
    bars5Min: input.bars5Min,
    quote: input.quote,
    strategyVersion: input.strategyVersion,
    blockedRegimes: input.blockedRegimes,
  });
  // Structural guarantee: never true
  return {
    ...result,
    brokerSubmit: false,
    shadowOnly: true,
  };
}

export async function recordShadowPair(input: {
  sessionId: string;
  decisionTime: string;
  symbol: string;
  bars5Min: AlpacaBar[];
  quote?: AlpacaQuote | null;
  champion: StrategyEvalResult;
  challenger: StrategyEvalResult;
}): Promise<{ champion: ShadowDecisionRecord; challenger: ShadowDecisionRecord }> {
  const hist = alpacaToHistorical(input.symbol, input.bars5Min.slice(-40), "live_snapshot");
  const last = hist.at(-1);
  const assumptions = defaultAssumptions();
  const spreadPct = last
    ? estimateSpreadPct(last, hist, assumptions)
    : assumptions.fixedSpreadBps / 10_000;
  const slipPct = last
    ? estimateSlippagePct(last, hist, assumptions)
    : assumptions.fixedSlippageBps / 10_000;

  const make = (
    role: "champion" | "challenger",
    ev: StrategyEvalResult,
  ): ShadowDecisionRecord => {
    const fill =
      ev.proposedEntry != null
        ? applyEntryCosts(ev.proposedEntry, "buy", spreadPct, slipPct).fill
        : null;
    return {
      id: newId("sh"),
      sessionId: input.sessionId,
      decisionTime: input.decisionTime,
      symbol: input.symbol.toUpperCase(),
      regime: ev.regime,
      strategyVersion: ev.strategyVersion,
      role,
      action: ev.action,
      confidence: ev.confidence,
      proposal: {
        entry: ev.proposedEntry,
        stopLoss: ev.stopLoss,
        takeProfit: ev.takeProfit,
      },
      rejectionReasons: ev.rejectionReasons,
      intendedQty: ev.risk?.approved ? ev.risk.qty : null,
      simulatedFill: role === "challenger" ? fill : fill,
      slippageEstimate: slipPct,
      spreadEstimate: spreadPct,
      brokerSubmitAttempted: false,
      paperOnly: true,
    };
  };

  const champion = make("champion", input.champion);
  const challenger = make("challenger", input.challenger);
  // Challenger must never attempt broker submit
  if (challenger.brokerSubmitAttempted !== false) {
    throw new Error("Safety violation: challenger broker submit flag");
  }
  await appendJsonl(DECISIONS, champion);
  await appendJsonl(DECISIONS, challenger);
  return { champion, challenger };
}

export async function readShadowDecisions(
  limit = 500,
): Promise<ShadowDecisionRecord[]> {
  try {
    const raw = await readFile(DECISIONS, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ShadowDecisionRecord)
      .slice(-limit);
  } catch {
    return [];
  }
}

export function summarizeShadowDecisions(
  rows: ShadowDecisionRecord[],
): {
  sessionsCompleted: number;
  championProposals: number;
  challengerProposals: number;
  matchingProposals: number;
  championOnly: number;
  challengerOnly: number;
  simulatedTrades: number;
  safetyViolations: number;
  byRegime: Record<string, number>;
  note: string;
} {
  const sessions = new Set(rows.map((r) => r.sessionId));
  const champ = rows.filter((r) => r.role === "champion" && r.action === "BUY");
  const chall = rows.filter((r) => r.role === "challenger" && r.action === "BUY");
  const key = (r: ShadowDecisionRecord) =>
    `${r.sessionId}|${r.decisionTime}|${r.symbol}`;
  const champKeys = new Set(champ.map(key));
  const challKeys = new Set(chall.map(key));
  let matching = 0;
  for (const k of champKeys) if (challKeys.has(k)) matching += 1;
  const byRegime: Record<string, number> = {};
  for (const r of chall) {
    byRegime[r.regime] = (byRegime[r.regime] ?? 0) + 1;
  }
  const safetyViolations = rows.filter(
    (r) => r.role === "challenger" && r.brokerSubmitAttempted !== false,
  ).length;

  return {
    sessionsCompleted: sessions.size,
    championProposals: champ.length,
    challengerProposals: chall.length,
    matchingProposals: matching,
    championOnly: champ.length - matching,
    challengerOnly: chall.length - matching,
    simulatedTrades: chall.filter((r) => r.simulatedFill != null).length,
    safetyViolations,
    byRegime,
    note: "Challenger results are simulated and did not submit broker orders.",
  };
}

/** Explicit deny-list: shadow module must never re-export broker submit. */
export const SHADOW_BROKER_SUBMIT_EXPORTS: readonly string[] = [];
