/**
 * Challenger experiments — typed params only, new immutable versions.
 */

import { registerStrategyVersion } from "@/lib/strategy/registry";
import { getChampionIdentity } from "@/lib/strategy/registry";

export type ChallengerExperimentParams = {
  minConfidence?: number;
  minRiskReward?: number;
  openEntryDelayMinutes?: number;
  eodEntryCutoffMinutes?: number;
  regimeFilter?: string;
  symbolFilter?: string[];
  volumeFilterMin?: number;
  maxSpreadPct?: number;
  stopLossAtrMult?: number;
  takeProfitMult?: number;
};

export async function createChallengerDraft(input: {
  name: string;
  params: ChallengerExperimentParams;
  reason: string;
}): Promise<
  | { ok: true; strategyId: string; version: string }
  | { ok: false; error: string }
> {
  const champ = getChampionIdentity();
  const version = `v1.0.0-challenger-${Date.now().toString(36)}`;
  const result = await registerStrategyVersion({
    strategyId: champ.strategyId,
    name: input.name,
    version,
    status: "DRAFT",
    parentVersion: champ.version,
    entryRules: `Challenger of ${champ.version}: ${input.reason}`,
    exitRules: "Inherited bracket exits from parent (unchanged champion code path).",
    featureSet: ["shared_evaluator", "typed_params"],
    parameterValues: {
      ...Object.fromEntries(
        Object.entries(input.params).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(",") : (v as number | string | boolean),
        ]),
      ),
    },
    supportedRegimes: input.params.regimeFilter
      ? [input.params.regimeFilter]
      : ["trending_up", "trending_down", "range_bound"],
    supportedUniverse: input.params.symbolFilter?.join(",") ?? "parent",
    riskRequirements: ["paper_only", "no_broker_in_backtest"],
    backtestPeriod: { start: null, end: null },
    validationResults: null,
    paperTradingResults: null,
    rejectionReason: null,
    rollbackTarget: champ.version,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    strategyId: result.entry.strategyId,
    version: result.entry.version,
  };
}
