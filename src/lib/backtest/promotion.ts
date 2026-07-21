/**
 * Read-only promotion eligibility (I-3). Never enables promotion.
 */

import type {
  BacktestRunRecord,
  PromotionCheck,
  PromotionEligibility,
} from "@/lib/backtest/types";
import { meaningfulRegimeCount, analyzeRegimeCoverage } from "@/lib/backtest/regime-coverage";

export function evaluatePromotionEligibility(
  run: BacktestRunRecord,
): PromotionEligibility {
  const m = run.metrics;
  const regimes = analyzeRegimeCoverage(run.trades);
  const meaningful = meaningfulRegimeCount(regimes, 15);
  const syntheticOk = !run.syntheticDataUsed && run.realDataOnly;

  const checks: PromotionCheck[] = [
    {
      id: "real_data_only",
      label: "Real historical data only (no synthetic)",
      passed: syntheticOk,
      detail: `realDataOnly=${run.realDataOnly} synthetic=${run.syntheticDataUsed}`,
    },
    {
      id: "min_trades",
      label: "Minimum total trades (≥200 real)",
      passed: syntheticOk && m.totalTrades >= 200,
      detail: `${m.totalTrades} trades`,
    },
    {
      id: "min_oos_trades",
      label: "Minimum out-of-sample trades (≥15)",
      passed: run.kind !== "oos" || (syntheticOk && m.totalTrades >= 15),
      detail: run.kind === "oos" ? `${m.totalTrades} OOS trades` : "N/A for this run kind",
    },
    {
      id: "positive_expectancy",
      label: "Positive expectancy",
      passed: syntheticOk && (m.expectancy ?? 0) > 0,
      detail: `expectancy=${m.expectancy}`,
    },
    {
      id: "profit_factor",
      label: "Profit factor ≥ 1.10 after costs",
      passed: syntheticOk && (m.profitFactor ?? 0) >= 1.1,
      detail: `pf=${m.profitFactor}`,
    },
    {
      id: "max_drawdown",
      label: "Max drawdown ≤ 15%",
      passed: syntheticOk && (m.maxDrawdown ?? 1) <= 0.15,
      detail: `dd=${m.maxDrawdown}`,
    },
    {
      id: "data_quality",
      label: "No blocking data-quality issues",
      passed: syntheticOk && run.dataQuality.passed,
      detail: `${run.dataQuality.blocking.length} blocking`,
    },
    {
      id: "no_broker",
      label: "No broker orders in backtest",
      passed: run.brokerOrdersSubmitted === false,
      detail: "brokerOrdersSubmitted=false",
    },
    {
      id: "multi_symbol",
      label: "≥10 symbols represented",
      passed: syntheticOk && run.symbols.length >= 10,
      detail: `${run.symbols.length} symbols`,
    },
    {
      id: "multi_regime",
      label: "≥4 meaningful regimes",
      passed: syntheticOk && meaningful >= 4,
      detail: `${meaningful} meaningful regimes`,
    },
    {
      id: "walk_forward",
      label: "Walk-forward ≥5 folds with ≥50% pass",
      passed:
        syntheticOk &&
        run.folds.length >= 5 &&
        run.folds.filter((f) => f.passed).length / run.folds.length >= 0.5,
      detail: `${run.folds.filter((f) => f.passed).length}/${run.folds.length} folds passed`,
    },
    {
      id: "paper_shadow",
      label: "Paper shadow evidence thresholds",
      passed: false,
      detail: "Shadow validation incomplete for promotion (I-3 readiness only)",
    },
    {
      id: "manual_approval",
      label: "Manual approval required",
      passed: false,
      detail: "Promotion UI disabled in Milestone I-3",
    },
  ];

  return {
    strategyVersion: run.strategyVersion,
    eligible: false,
    checks,
    manualApprovalRequired: true,
    promotionEnabled: false,
    paperOnly: true,
    liveTradingAllowed: false,
  };
}
