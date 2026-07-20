/**
 * I-3 minimum evidence checklist — informational only; never enables promotion.
 */

import type { BacktestRunRecord } from "@/lib/backtest/types";
import { meaningfulRegimeCount, analyzeRegimeCoverage } from "@/lib/backtest/regime-coverage";
import { summarizeShadowDecisions, readShadowDecisions } from "@/lib/backtest/shadow";

export type EvidenceItem = {
  id: string;
  category: "historical" | "shadow";
  label: string;
  passed: boolean;
  detail: string;
};

export type EvidenceChecklist = {
  historical: EvidenceItem[];
  shadow: EvidenceItem[];
  failed: EvidenceItem[];
  sufficientForPromotionReview: false;
  promotionEnabled: false;
  syntheticCannotSatisfy: true;
  note: string;
};

export function buildEvidenceChecklist(
  run: BacktestRunRecord | null,
  shadowSummary?: ReturnType<typeof summarizeShadowDecisions> | null,
): EvidenceChecklist {
  const syntheticBlocked = Boolean(run?.syntheticDataUsed);
  const regimes = run ? analyzeRegimeCoverage(run.trades) : [];
  const meaningful = meaningfulRegimeCount(regimes, 15);

  const historical: EvidenceItem[] = [
    {
      id: "real_data",
      category: "historical",
      label: "Real historical data only (no synthetic)",
      passed: Boolean(run && run.realDataOnly && !run.syntheticDataUsed),
      detail: run
        ? `realDataOnly=${run.realDataOnly} synthetic=${run.syntheticDataUsed} label=${run.label}`
        : "No real baseline run",
    },
    {
      id: "min_trades_200",
      category: "historical",
      label: "At least 200 total trades",
      passed: Boolean(run && !syntheticBlocked && run.metrics.totalTrades >= 200),
      detail: `${run?.metrics.totalTrades ?? 0} trades`,
    },
    {
      id: "min_symbols_10",
      category: "historical",
      label: "At least 10 symbols",
      passed: Boolean(run && !syntheticBlocked && run.symbols.length >= 10),
      detail: `${run?.symbols.length ?? 0} symbols`,
    },
    {
      id: "min_regimes_4",
      category: "historical",
      label: "At least 4 meaningful regimes (≥15 trades each)",
      passed: Boolean(run && !syntheticBlocked && meaningful >= 4),
      detail: `${meaningful} meaningful regimes`,
    },
    {
      id: "min_months_12",
      category: "historical",
      label: "At least ~12 months span when available",
      passed: Boolean(
        run &&
          !syntheticBlocked &&
          (Date.parse(run.periodEnd) - Date.parse(run.periodStart)) /
            86_400_000 >=
            360,
      ),
      detail: run ? `${run.periodStart} → ${run.periodEnd}` : "n/a",
    },
    {
      id: "wf_folds_5",
      category: "historical",
      label: "At least 5 walk-forward folds",
      passed: Boolean(run && !syntheticBlocked && run.folds.length >= 5),
      detail: `${run?.folds.length ?? 0} folds`,
    },
    {
      id: "oos_expectancy",
      category: "historical",
      label: "Positive locked OOS expectancy (proxy: overall expectancy)",
      passed: Boolean(
        run && !syntheticBlocked && (run.metrics.expectancy ?? 0) > 0,
      ),
      detail: `expectancy=${run?.metrics.expectancy ?? null}`,
    },
    {
      id: "pf_after_costs",
      category: "historical",
      label: "Profit factor ≥ 1.10 after costs",
      passed: Boolean(
        run && !syntheticBlocked && (run.metrics.profitFactor ?? 0) >= 1.1,
      ),
      detail: `pf=${run?.metrics.profitFactor ?? null}`,
    },
    {
      id: "max_dd",
      category: "historical",
      label: "Max drawdown ≤ 15%",
      passed: Boolean(
        run && !syntheticBlocked && (run.metrics.maxDrawdown ?? 1) <= 0.15,
      ),
      detail: `dd=${run?.metrics.maxDrawdown ?? null}`,
    },
    {
      id: "dq",
      category: "historical",
      label: "No blocking data-quality issues",
      passed: Boolean(run && !syntheticBlocked && run.dataQuality.passed),
      detail: run?.dataQualityStatus ?? "n/a",
    },
  ];

  const sh = shadowSummary;
  const shadow: EvidenceItem[] = [
    {
      id: "shadow_sessions_10",
      category: "shadow",
      label: "At least 10 full market sessions",
      passed: Boolean(sh && sh.sessionsCompleted >= 10),
      detail: `${sh?.sessionsCompleted ?? 0} sessions`,
    },
    {
      id: "shadow_proposals_30",
      category: "shadow",
      label: "At least 30 challenger proposals",
      passed: Boolean(sh && sh.challengerProposals >= 30),
      detail: `${sh?.challengerProposals ?? 0} challenger proposals`,
    },
    {
      id: "shadow_no_broker",
      category: "shadow",
      label: "No broker submissions by challenger",
      passed: Boolean(sh && sh.safetyViolations === 0),
      detail: `${sh?.safetyViolations ?? 0} violations`,
    },
    {
      id: "shadow_records",
      category: "shadow",
      label: "Complete decision records present",
      passed: Boolean(sh && sh.challengerProposals + sh.championProposals > 0),
      detail: sh?.note ?? "No shadow data",
    },
  ];

  const all = [...historical, ...shadow];
  return {
    historical,
    shadow,
    failed: all.filter((i) => !i.passed),
    sufficientForPromotionReview: false,
    promotionEnabled: false,
    syntheticCannotSatisfy: true,
    note: "Evidence thresholds indicate sufficiency only. Promotion remains disabled in I-3.",
  };
}

export async function buildEvidenceChecklistAsync(
  run: BacktestRunRecord | null,
): Promise<EvidenceChecklist> {
  const rows = await readShadowDecisions(2000);
  const shadow = summarizeShadowDecisions(rows);
  return buildEvidenceChecklist(run, shadow);
}
