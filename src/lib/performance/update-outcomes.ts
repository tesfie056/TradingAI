import { getRecentBars } from "@/lib/alpaca/client";
import {
  readPerformanceHistory,
  writePerformanceHistory,
} from "@/lib/ai/history";
import { refreshOverall } from "@/lib/performance/from-decision";
import { scoreDecisionOutcome } from "@/lib/performance/score";
import type { DecisionPerformanceEntry } from "@/lib/performance/types";
import type { AlpacaBar } from "@/lib/alpaca/types";

const MS_15M = 15 * 60_000;
const MS_1H = 60 * 60_000;

function findPriceAfter(
  bars: AlpacaBar[],
  decisionMs: number,
  horizonMs: number,
): { price: number; at: string } | null {
  const target = decisionMs + horizonMs;
  for (const bar of bars) {
    const t = Date.parse(bar.t);
    if (Number.isNaN(t)) continue;
    if (t >= target) {
      return { price: bar.c, at: bar.t };
    }
  }
  // If bars don't reach horizon yet, use last bar only if it's past decision.
  const last = bars.at(-1);
  if (!last) return null;
  const lastT = Date.parse(last.t);
  if (!Number.isNaN(lastT) && lastT > decisionMs) {
    return { price: last.c, at: last.t };
  }
  return null;
}

function findNextSessionCloseApprox(
  bars: AlpacaBar[],
  decisionMs: number,
): { price: number; at: string } | null {
  // Approximate "next close" as last bar of the calendar day after decision,
  // or the last bar in the sample if same-day end is available.
  const decisionDay = new Date(decisionMs).toISOString().slice(0, 10);
  const sameDay: AlpacaBar[] = [];
  const laterDays: AlpacaBar[] = [];

  for (const bar of bars) {
    const t = Date.parse(bar.t);
    if (Number.isNaN(t) || t <= decisionMs) continue;
    const day = bar.t.slice(0, 10);
    if (day === decisionDay) sameDay.push(bar);
    else laterDays.push(bar);
  }

  const closeBar = laterDays.at(-1) ?? sameDay.at(-1);
  if (!closeBar) return null;
  return { price: closeBar.c, at: closeBar.t };
}

/**
 * Update pending decision outcomes using recent bars.
 * Never places orders. Never logs secrets.
 */
export async function updateDecisionOutcomes(limit = 120): Promise<{
  updated: number;
  entries: DecisionPerformanceEntry[];
}> {
  const newestFirst = await readPerformanceHistory(limit);
  if (newestFirst.length === 0) {
    return { updated: 0, entries: [] };
  }

  const symbols = [...new Set(newestFirst.map((e) => e.symbol))];
  const barsBySymbol = await getRecentBars(symbols, "5Min", 120);
  const now = Date.now();
  let updated = 0;

  const next = newestFirst.map((entry) => {
    let changed = false;
    const decisionMs = Date.parse(entry.timestamp);
    if (Number.isNaN(decisionMs)) return entry;

    const bars = barsBySymbol[entry.symbol] ?? [];
    const age = now - decisionMs;

    let outcomes = { ...entry.outcomes };

    if (entry.outcomes.m15.label === "pending" && age >= MS_15M) {
      const hit = findPriceAfter(bars, decisionMs, MS_15M);
      outcomes = {
        ...outcomes,
        m15: scoreDecisionOutcome({
          action: entry.action,
          entryPrice: entry.priceAtDecision,
          laterPrice: hit?.price ?? null,
          horizon: "m15",
          evaluatedAt: hit?.at ?? new Date().toISOString(),
        }),
      };
      changed = true;
    }

    if (entry.outcomes.h1.label === "pending" && age >= MS_1H) {
      const hit = findPriceAfter(bars, decisionMs, MS_1H);
      outcomes = {
        ...outcomes,
        h1: scoreDecisionOutcome({
          action: entry.action,
          entryPrice: entry.priceAtDecision,
          laterPrice: hit?.price ?? null,
          horizon: "h1",
          evaluatedAt: hit?.at ?? new Date().toISOString(),
        }),
      };
      changed = true;
    }

    if (entry.outcomes.nextClose.label === "pending" && age >= MS_1H) {
      const hit = findNextSessionCloseApprox(bars, decisionMs);
      if (hit) {
        outcomes = {
          ...outcomes,
          nextClose: scoreDecisionOutcome({
            action: entry.action,
            entryPrice: entry.priceAtDecision,
            laterPrice: hit.price,
            horizon: "nextClose",
            evaluatedAt: hit.at,
          }),
        };
        changed = true;
      }
    }

    if (!changed) return entry;
    updated += 1;
    return refreshOverall({ ...entry, outcomes });
  });

  if (updated > 0) {
    // Persist oldest-first.
    await writePerformanceHistory([...next].reverse());
  }

  return { updated, entries: next };
}
