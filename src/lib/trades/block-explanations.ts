import type { OrderGateBlocker, OrderGateCode } from "@/lib/trades/types";

export type BlockCategory =
  | "market"
  | "data"
  | "risk"
  | "execution"
  | "confirmation"
  | "order";

export type BlockExplanation = {
  code: OrderGateCode | "missing_confirmation";
  category: BlockCategory;
  title: string;
  detail: string;
  whatToChange: string;
};

export type PrimarySubmitStatus =
  | { kind: "ready"; label: "Trade Eligible" }
  | { kind: "blocked"; label: string; primaryCode: string; primaryReason: string };

export type SubmitButtonState = {
  disabled: boolean;
  label: string;
};

const CATEGORY_LABEL: Record<BlockCategory, string> = {
  market: "Market reason",
  data: "Data reason",
  risk: "Risk reason",
  execution: "Execution reason",
  confirmation: "Confirmation reason",
  order: "Order reason",
};

export function categoryLabel(category: BlockCategory): string {
  return CATEGORY_LABEL[category];
}

function explainCode(
  code: OrderGateCode | "missing_confirmation",
  message?: string,
): BlockExplanation {
  switch (code) {
    case "market_closed":
      return {
        code,
        category: "market",
        title: "Market closed",
        detail:
          "The U.S. stock market is currently closed. Paper stock orders are only allowed during market hours.",
        whatToChange: "Wait until the U.S. market opens",
      };
    case "stale_quote":
      return {
        code,
        category: "data",
        title: "Stale quote",
        detail:
          "The latest quote is old or from after-hours data, so the estimated price may not be reliable.",
        whatToChange: "Refresh the quote and try the preview again",
      };
    case "wide_spread":
      return {
        code,
        category: "data",
        title: "Wide spread",
        detail:
          "The bid/ask spread is too wide, which can cause bad fills or unreliable estimates.",
        whatToChange: "Make sure the spread is acceptable before submitting",
      };
    case "missing_price":
      return {
        code,
        category: "data",
        title: "Missing price",
        detail:
          "The app could not estimate a reliable price from the current quote or bars.",
        whatToChange: "Refresh market data and prepare the preview again",
      };
    case "high_risk":
      return {
        code,
        category: "risk",
        title: "High risk",
        detail:
          "The trade is marked high risk because market/data conditions are not safe.",
        whatToChange: "Risk must drop below HIGH before a paper submit is allowed",
      };
    case "hold_decision":
      return {
        code,
        category: "risk",
        title: "HOLD decision",
        detail:
          "The current paper decision is HOLD, so there is no BUY/SELL order to submit.",
        whatToChange: "Wait for a BUY or SELL setup that clears safety gates",
      };
    case "execution_disabled":
      return {
        code,
        category: "execution",
        title: "Order execution off",
        detail:
          "Paper order execution is OFF. Submits stay locked until ENABLE_PAPER_ORDER_EXECUTION=true in .env.local. Live trading remains blocked.",
        whatToChange:
          "Keep paper-only mode; enable paper execution in .env.local only if you intentionally want manual paper submits",
      };
    case "live_endpoint":
      return {
        code,
        category: "execution",
        title: "Live endpoint blocked",
        detail:
          "Orders are only allowed against the Alpaca paper trading endpoint. Live trading is blocked.",
        whatToChange: "Use ALPACA_BASE_URL=https://paper-api.alpaca.markets",
      };
    case "missing_approval":
    case "missing_confirmation":
      return {
        code: code === "missing_approval" ? "missing_approval" : "missing_confirmation",
        category: "confirmation",
        title: "Confirmation required",
        detail:
          "Manual confirmation is required. Orders are never placed automatically or with one click.",
        whatToChange: "Check the confirmation checkbox before submitting",
      };
    case "invalid_qty":
      return {
        code,
        category: "order",
        title: "Invalid quantity",
        detail: message ?? "Quantity must be a positive whole number.",
        whatToChange: "Enter a valid share quantity",
      };
    case "invalid_notional":
      return {
        code,
        category: "order",
        title: "Invalid dollar amount",
        detail: message ?? "Notional dollar amount must be a positive number.",
        whatToChange: "Enter a valid dollar amount for the paper trade",
      };
    case "invalid_side":
      return {
        code,
        category: "order",
        title: "Side mismatch",
        detail:
          message ??
          "The order side does not match the current paper decision action.",
        whatToChange: "Align BUY/SELL with the decision, then preview again",
      };
    case "max_notional":
      return {
        code,
        category: "execution",
        title: "Max trade size",
        detail: message ?? "Estimated notional exceeds the paper trade limit.",
        whatToChange: "Lower quantity so notional stays within the paper limit",
      };
    case "max_daily_trades":
      return {
        code,
        category: "execution",
        title: "Daily paper limit",
        detail: message ?? "The daily paper trade limit has been reached.",
        whatToChange: "Wait for the next Eastern market day or lower MAX_DAILY_PAPER_TRADES usage",
      };
    default:
      return {
        code,
        category: "order",
        title: "Blocked",
        detail: message ?? "This paper order is blocked by a safety gate.",
        whatToChange: "Review the safety gates and try again",
      };
  }
}

export function explainBlockers(
  blockers: OrderGateBlocker[],
): BlockExplanation[] {
  const seen = new Set<string>();
  const out: BlockExplanation[] = [];
  for (const b of blockers) {
    if (seen.has(b.code)) continue;
    seen.add(b.code);
    out.push(explainCode(b.code, b.message));
  }
  return out;
}

/**
 * Merge server gate blockers with client confirmation state for UI.
 * Does not weaken gates — only surfaces confirmation when other gates are clear
 * enough that confirmation is the remaining user action, or always when unchecked
 * alongside other blockers so the checklist is complete.
 */
export function collectUiBlockExplanations(input: {
  blockers: OrderGateBlocker[];
  approved: boolean;
}): BlockExplanation[] {
  const explained = explainBlockers(input.blockers);
  if (!input.approved) {
    const hasConfirm = explained.some(
      (e) =>
        e.code === "missing_approval" || e.code === "missing_confirmation",
    );
    if (!hasConfirm) {
      explained.push(explainCode("missing_confirmation"));
    }
  }
  return explained;
}

export type EligibilityCheckId =
  | "market_open"
  | "fresh_quote"
  | "spread_ok"
  | "risk_ok"
  | "confirmation";

export type EligibilityCheckItem = {
  id: EligibilityCheckId;
  label: string;
  pass: boolean;
  failHint: string;
};

/** Compact pass/fail checklist for the paper trade preview panel. */
export function buildTradeEligibilityChecklist(input: {
  blockers: OrderGateBlocker[];
  approved: boolean;
}): EligibilityCheckItem[] {
  const codes = new Set(input.blockers.map((b) => b.code));
  return [
    {
      id: "market_open",
      label: "Market open",
      pass: !codes.has("market_closed"),
      failHint: "Wait for U.S. market hours",
    },
    {
      id: "fresh_quote",
      label: "Fresh quote",
      pass: !codes.has("stale_quote") && !codes.has("missing_price"),
      failHint: "Refresh quote after market opens",
    },
    {
      id: "spread_ok",
      label: "Spread acceptable",
      pass: !codes.has("wide_spread"),
      failHint: "Spread often widens when closed",
    },
    {
      id: "risk_ok",
      label: "Risk below HIGH",
      pass: !codes.has("high_risk"),
      failHint: "Risk may clear when data is fresh",
    },
    {
      id: "confirmation",
      label: "Confirmation checked",
      pass: input.approved,
      failHint: "Check the confirmation box",
    },
  ];
}

const PRIMARY_PRIORITY: Array<OrderGateCode | "missing_confirmation"> = [
  "market_closed",
  "stale_quote",
  "wide_spread",
  "missing_price",
  "high_risk",
  "hold_decision",
  "execution_disabled",
  "live_endpoint",
  "max_notional",
  "max_daily_trades",
  "invalid_qty",
  "invalid_notional",
  "invalid_side",
  "missing_approval",
  "missing_confirmation",
];

export function pickPrimaryExplanation(
  explanations: BlockExplanation[],
): BlockExplanation | null {
  if (explanations.length === 0) return null;
  for (const code of PRIMARY_PRIORITY) {
    const hit = explanations.find((e) => e.code === code);
    if (hit) return hit;
  }
  return explanations[0] ?? null;
}

export function primarySubmitStatus(
  explanations: BlockExplanation[],
): PrimarySubmitStatus {
  if (explanations.length === 0) {
    return { kind: "ready", label: "Trade Eligible" };
  }
  const primary = pickPrimaryExplanation(explanations)!;
  if (primary.code === "market_closed") {
    return {
      kind: "blocked",
      label: "Trade Blocked",
      primaryCode: primary.code,
      primaryReason: "Market closed",
    };
  }
  if (
    primary.code === "stale_quote" ||
    primary.code === "wide_spread" ||
    primary.code === "missing_price"
  ) {
    return {
      kind: "blocked",
      label: "Trade Blocked",
      primaryCode: primary.code,
      primaryReason:
        primary.code === "wide_spread"
          ? "Wide spread"
          : primary.code === "missing_price"
            ? "Missing price"
            : "Stale quote",
    };
  }
  if (primary.code === "high_risk" || primary.code === "hold_decision") {
    return {
      kind: "blocked",
      label: "Trade Blocked",
      primaryCode: primary.code,
      primaryReason:
        primary.code === "high_risk" ? "High risk" : "HOLD decision",
    };
  }
  if (
    primary.code === "execution_disabled" ||
    primary.code === "live_endpoint"
  ) {
    return {
      kind: "blocked",
      label: "Trade Blocked",
      primaryCode: primary.code,
      primaryReason: "Execution off",
    };
  }
  if (
    primary.code === "missing_approval" ||
    primary.code === "missing_confirmation"
  ) {
    return {
      kind: "blocked",
      label: "Trade Blocked",
      primaryCode: primary.code,
      primaryReason: "Confirmation required",
    };
  }
  return {
    kind: "blocked",
    label: "Trade Blocked",
    primaryCode: primary.code,
    primaryReason: primary.title,
  };
}

export function submitButtonState(input: {
  explanations: BlockExplanation[];
  tradeBusy: boolean;
  canSubmitGates: boolean;
  approved: boolean;
  executionEnabled: boolean;
}): SubmitButtonState {
  if (input.tradeBusy) {
    return { disabled: true, label: "Submitting…" };
  }

  const primary = pickPrimaryExplanation(input.explanations);
  if (primary) {
    const labelByCode: Partial<
      Record<OrderGateCode | "missing_confirmation", string>
    > = {
      market_closed: "Cannot submit — market closed",
      stale_quote: "Cannot submit — quote stale",
      wide_spread: "Cannot submit — wide spread",
      missing_price: "Cannot submit — quote stale",
      high_risk: "Cannot submit — high risk",
      hold_decision: "Cannot submit — HOLD decision",
      execution_disabled: "Cannot submit — execution off",
      live_endpoint: "Cannot submit — execution off",
      missing_approval: "Cannot submit — check confirmation box",
      missing_confirmation: "Cannot submit — check confirmation box",
      invalid_qty: "Cannot submit — invalid quantity",
      invalid_notional: "Cannot submit — invalid dollar amount",
      invalid_side: "Cannot submit — side mismatch",
      max_notional: "Cannot submit — size limit",
      max_daily_trades: "Cannot submit — daily limit",
    };
    return {
      disabled: true,
      label: labelByCode[primary.code] ?? `Cannot submit — ${primary.title}`,
    };
  }

  const enabled =
    input.canSubmitGates && input.approved && input.executionEnabled;
  return {
    disabled: !enabled,
    label: "Confirm & submit paper order",
  };
}

export function uniqueWhatToChange(explanations: BlockExplanation[]): string[] {
  const out: string[] = [];
  const marketClosed = explanations.some((e) => e.code === "market_closed");
  for (const e of explanations) {
    if (!out.includes(e.whatToChange)) out.push(e.whatToChange);
  }
  if (marketClosed) {
    const refresh =
      "When the market opens, refresh quotes and re-check trade eligibility";
    if (!out.includes(refresh)) out.push(refresh);
  }
  out.push("Order execution must remain paper-only");
  if (!explanations.some((e) => e.category === "confirmation")) {
    out.push("Confirmation checkbox must be checked");
  }
  return out;
}

/** Codes that often appear as side-effects while the market is closed. */
const MARKET_CLOSED_SECONDARY = new Set([
  "stale_quote",
  "wide_spread",
  "high_risk",
  "missing_price",
]);

/**
 * Split blockers into a primary reason and secondary effects.
 * When market is closed, treat data/risk codes as secondary effects of the close.
 */
export function splitPrimarySecondaryExplanations(
  explanations: BlockExplanation[],
): {
  primary: BlockExplanation | null;
  secondary: BlockExplanation[];
  marketClosedNote: string | null;
} {
  const primary = pickPrimaryExplanation(explanations);
  if (!primary) {
    return { primary: null, secondary: [], marketClosedNote: null };
  }

  const marketClosed = explanations.some((e) => e.code === "market_closed");
  if (marketClosed) {
    const closed =
      explanations.find((e) => e.code === "market_closed") ?? primary;
    const secondary = explanations.filter(
      (e) =>
        e.code !== "market_closed" &&
        (MARKET_CLOSED_SECONDARY.has(e.code) ||
          e.category === "data" ||
          e.category === "risk"),
    );
    const other = explanations.filter(
      (e) =>
        e.code !== "market_closed" &&
        !secondary.some((s) => s.code === e.code),
    );
    return {
      primary: closed,
      secondary: [...secondary, ...other],
      marketClosedNote:
        "Stale quote, wide spread, and high risk often appear together while the market is closed (after-hours or stale session data). When the market opens, refresh data and re-check eligibility.",
    };
  }

  return {
    primary,
    secondary: explanations.filter((e) => e.code !== primary.code),
    marketClosedNote: null,
  };
}

export function groupExplanationsByCategory(
  explanations: BlockExplanation[],
): Array<{ category: BlockCategory; label: string; items: BlockExplanation[] }> {
  const order: BlockCategory[] = [
    "market",
    "data",
    "risk",
    "execution",
    "confirmation",
    "order",
  ];
  return order
    .map((category) => ({
      category,
      label: categoryLabel(category),
      items: explanations.filter((e) => e.category === category),
    }))
    .filter((g) => g.items.length > 0);
}
