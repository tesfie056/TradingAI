/**
 * Version 1 simple long entry strategy — public API.
 * Paper planning only in V1-3. Never submits orders.
 */

export {
  V1_STRATEGY_ID,
  V1_STRATEGY_VERSION,
  V1_SIMPLE_LONG_CONFIG,
  getV1SimpleLongConfig,
} from "@/lib/strategy/v1-simple-long/config";
export type { V1StrategyConfig } from "@/lib/strategy/v1-simple-long/config";
export type {
  V1StrategyResult,
  V1StrategyContext,
  V1ConditionResult,
  V1DecisionLabel,
} from "@/lib/strategy/v1-simple-long/types";
export {
  evaluateV1SimpleLong,
  type EvaluateV1SimpleLongInput,
} from "@/lib/strategy/v1-simple-long/evaluate";
export {
  buildV1FallbackExplanation,
  explainV1StrategyResult,
  applyLlmExplanationSafely,
} from "@/lib/strategy/v1-simple-long/explain";
export {
  rankV1BuyCandidates,
  partitionV1Decisions,
  isV1ExecutableBuyCandidate,
} from "@/lib/strategy/v1-simple-long/rank";
export {
  appendV1StrategyDecisions,
  saveV1StrategyLatest,
  readV1StrategyLatest,
} from "@/lib/strategy/v1-simple-long/log";
export { v1ResultToAiDecision } from "@/lib/strategy/v1-simple-long/map-to-decision";
export {
  minutesSinceRegularOpen,
  minutesUntilRegularClose,
} from "@/lib/strategy/v1-simple-long/timing";
