/**
 * Stress-test execution cost / fill scenarios (Milestone I-3).
 */

import { defaultAssumptions } from "@/lib/backtest/costs";
import { simulateSymbolPath } from "@/lib/backtest/execution";
import { computeMetrics } from "@/lib/backtest/metrics";
import type {
  BacktestMetrics,
  ExecutionAssumptions,
  HistoricalBar,
} from "@/lib/backtest/types";

export type StressScenarioId =
  | "base"
  | "moderate"
  | "high"
  | "one_bar_delay"
  | "gap_through_stop"
  | "reduced_fill"
  | "first_last_30m"
  | "high_vol_sessions";

export type StressScenarioResult = {
  id: StressScenarioId;
  label: string;
  assumptions: ExecutionAssumptions;
  metrics: BacktestMetrics;
  fragileHint: string | null;
};

function filterFirstLast30(bars: HistoricalBar[]): HistoricalBar[] {
  return bars.filter((b) => {
    try {
      const h = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          hour12: false,
        }).format(new Date(b.timestamp)),
      );
      const m = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          minute: "2-digit",
        }).format(new Date(b.timestamp)),
      );
      const mins = h * 60 + m;
      // RTH 9:30–16:00 ET → first/last 30m: 9:30–10:00 and 15:30–16:00
      return (mins >= 570 && mins < 600) || (mins >= 930 && mins <= 960);
    } catch {
      return true;
    }
  });
}

export async function runStressScenarios(input: {
  bySymbol: Record<string, HistoricalBar[]>;
  strategyVersion: string;
  minConfidence?: number;
  /** Must match baseline evalStep for comparable base scenario. */
  evalStep?: number;
  scenarios?: StressScenarioId[];
}): Promise<StressScenarioResult[]> {
  const symbols = Object.keys(input.bySymbol);
  const step = input.evalStep ?? 6;
  const allow = new Set(
    input.scenarios ?? [
      "base",
      "moderate",
      "high",
      "one_bar_delay",
      "gap_through_stop",
      "reduced_fill",
      "first_last_30m",
      "high_vol_sessions",
    ],
  );
  const defs: {
    id: StressScenarioId;
    label: string;
    assumptions: Partial<ExecutionAssumptions>;
    step?: number;
    barFilter?: (bars: HistoricalBar[]) => HistoricalBar[];
  }[] = [
    {
      id: "base",
      label: "Base (4 bps spread / 2 bps slip)",
      assumptions: { fixedSpreadBps: 4, fixedSlippageBps: 2 },
      step,
    },
    {
      id: "moderate",
      label: "Moderate stress (8 / 5 bps)",
      assumptions: { fixedSpreadBps: 8, fixedSlippageBps: 5 },
      step,
    },
    {
      id: "high",
      label: "High stress (15 / 10 bps)",
      assumptions: { fixedSpreadBps: 15, fixedSlippageBps: 10 },
      step,
    },
    {
      id: "one_bar_delay",
      label: "One-bar entry delay",
      assumptions: { fixedSpreadBps: 4, fixedSlippageBps: 2 },
      step: step + 1,
    },
    {
      id: "gap_through_stop",
      label: "Gap-through / conservative stop stress",
      assumptions: {
        fixedSpreadBps: 8,
        fixedSlippageBps: 12,
        slippageModel: "conservative_stress",
      },
      step,
    },
    {
      id: "reduced_fill",
      label: "Reduced fill quality",
      assumptions: {
        fixedSpreadBps: 10,
        fixedSlippageBps: 8,
        feeBps: 1,
      },
      step,
    },
    {
      id: "first_last_30m",
      label: "First/last 30 minutes only",
      assumptions: { fixedSpreadBps: 6, fixedSlippageBps: 4 },
      barFilter: filterFirstLast30,
      step,
    },
    {
      id: "high_vol_sessions",
      label: "Volatility-sensitive slippage",
      assumptions: {
        fixedSpreadBps: 6,
        fixedSlippageBps: 4,
        slippageModel: "volatility_sensitive",
      },
      step,
    },
  ];

  const out: StressScenarioResult[] = [];
  let baseAfter: number | null = null;

  for (const d of defs) {
    if (!allow.has(d.id)) continue;
    const assumptions = defaultAssumptions({
      ...d.assumptions,
      notes: [
        ...defaultAssumptions().notes,
        `Stress scenario: ${d.label}`,
        `evalStep=${d.step ?? step} (must match baseline for comparable base)`,
      ],
    });
    const trades = [];
    for (const symbol of symbols) {
      let bars = input.bySymbol[symbol] ?? [];
      if (d.barFilter) bars = d.barFilter(bars);
      if (bars.length < 40) continue;
      const { trades: t } = simulateSymbolPath({
        symbol,
        bars,
        assumptions,
        strategyVersion: input.strategyVersion,
        minConfidence: input.minConfidence,
        step: d.step ?? step,
      });
      trades.push(...t);
    }
    const metrics = computeMetrics(trades, assumptions.startingEquity);
    if (d.id === "base") baseAfter = metrics.totalReturnAfterCosts;

    let fragileHint: string | null = null;
    if (
      baseAfter != null &&
      d.id !== "base" &&
      baseAfter > 0 &&
      metrics.totalReturnAfterCosts <= 0
    ) {
      fragileHint =
        "Performance turns non-positive under this cost/fill stress — strategy marked fragile for this scenario.";
    }

    out.push({
      id: d.id,
      label: d.label,
      assumptions,
      metrics,
      fragileHint,
    });
  }

  return out;
}

/** Accounting sanity: higher costs must not improve after-cost return vs base. */
export function assertStressDoesNotImprove(
  results: StressScenarioResult[],
): void {
  const base = results.find((r) => r.id === "base");
  const high = results.find((r) => r.id === "high");
  if (!base || !high) return;
  if (high.metrics.totalReturnAfterCosts > base.metrics.totalReturnAfterCosts + 1e-6) {
    throw new Error(
      "Accounting error: high stress after-cost return improved vs base",
    );
  }
}
