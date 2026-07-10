import type { AiAction } from "@/lib/alpaca/types";
import type {
  DecisionOutcomeLabel,
  HorizonKey,
  HorizonResult,
} from "@/lib/performance/types";

const HOLD_BAND = 0.0015; // 0.15%

/**
 * Score a decision vs a later price. Pure function — no orders, no secrets.
 */
export function scoreDecisionOutcome(input: {
  action: AiAction;
  entryPrice: number | null;
  laterPrice: number | null;
  horizon: HorizonKey;
  evaluatedAt?: string | null;
}): HorizonResult {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();

  if (
    input.entryPrice == null ||
    !(input.entryPrice > 0) ||
    input.laterPrice == null ||
    !(input.laterPrice > 0)
  ) {
    return {
      horizon: input.horizon,
      price: input.laterPrice,
      returnPct: null,
      estimatedPnlPct: null,
      reasonable: null,
      label: "insufficient_data",
      evaluatedAt,
    };
  }

  const returnPct = (input.laterPrice - input.entryPrice) / input.entryPrice;
  let estimatedPnlPct: number | null = null;
  let reasonable: boolean | null = null;
  let label: DecisionOutcomeLabel = "neutral";

  if (input.action === "BUY") {
    estimatedPnlPct = returnPct;
    if (returnPct > HOLD_BAND) {
      reasonable = true;
      label = "correct";
    } else if (returnPct < -HOLD_BAND) {
      reasonable = false;
      label = "incorrect";
    } else {
      reasonable = true;
      label = "neutral";
    }
  } else if (input.action === "SELL") {
    // Short-style paper estimate: profit when price falls.
    estimatedPnlPct = -returnPct;
    if (returnPct < -HOLD_BAND) {
      reasonable = true;
      label = "correct";
    } else if (returnPct > HOLD_BAND) {
      reasonable = false;
      label = "incorrect";
    } else {
      reasonable = true;
      label = "neutral";
    }
  } else {
    // HOLD is reasonable when move is small; large moves are "missed opportunity" (incorrect).
    estimatedPnlPct = 0;
    if (Math.abs(returnPct) <= HOLD_BAND * 2) {
      reasonable = true;
      label = "correct";
    } else {
      reasonable = false;
      label = "incorrect";
    }
  }

  return {
    horizon: input.horizon,
    price: input.laterPrice,
    returnPct: Number(returnPct.toFixed(5)),
    estimatedPnlPct:
      estimatedPnlPct == null ? null : Number(estimatedPnlPct.toFixed(5)),
    reasonable,
    label,
    evaluatedAt,
  };
}

export function pendingHorizon(horizon: HorizonKey): HorizonResult {
  return {
    horizon,
    price: null,
    returnPct: null,
    estimatedPnlPct: null,
    reasonable: null,
    label: "pending",
    evaluatedAt: null,
  };
}

export function overallFromHorizons(outcomes: {
  m15: HorizonResult;
  h1: HorizonResult;
  nextClose: HorizonResult;
}): DecisionOutcomeLabel {
  const ranked = [outcomes.h1, outcomes.m15, outcomes.nextClose];
  for (const o of ranked) {
    if (o.label === "correct" || o.label === "incorrect" || o.label === "neutral") {
      return o.label;
    }
  }
  if (
    outcomes.m15.label === "pending" ||
    outcomes.h1.label === "pending" ||
    outcomes.nextClose.label === "pending"
  ) {
    return "pending";
  }
  return "insufficient_data";
}
