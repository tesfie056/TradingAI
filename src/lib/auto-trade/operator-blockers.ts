/**
 * Operator-facing trading blockers for the Auto Trade dashboard.
 * Presentation only — does not change backend safety rules.
 */

import type { AutoTradeStatus } from "@/lib/auto-trade/types";

export type OperatorBlocker = {
  id: string;
  label: string;
  explanation: string;
  /** True when the operator must take an action to clear this blocker. */
  needsOperatorAction: boolean;
  severity: "info" | "warn" | "critical";
};

export type OperatorBlockerInput = {
  status: Pick<
    AutoTradeStatus,
    | "executionEnabled"
    | "envEnabled"
    | "effectivelyEnabled"
    | "killSwitch"
    | "panicStop"
    | "runtimeDisabled"
    | "dailyTradesUsed"
    | "maxDailyTrades"
    | "activeCooldowns"
    | "blockSummary"
  >;
  marketOpen: boolean | null | undefined;
  alpacaConnected: boolean;
  dataFreshness: string | null | undefined;
  eligibleCount: number | null | undefined;
  reconciliationComplete: boolean;
  hasLegacyConflict: boolean;
  hasManualIntervention: boolean;
  hasQualifiedBuy: boolean | null;
  openingDelayActive?: boolean;
  eodEntryCutoffActive?: boolean;
  consecutiveLossPause?: boolean;
  maxOpenPositionsReached?: boolean;
  spreadTooWide?: boolean;
  liquidityTooLow?: boolean;
  volatilityUnsafe?: boolean;
  pendingOrderConflict?: boolean;
  dailyLossLimitHit?: boolean;
  updatedAt?: string | null;
};

export type OperatorBlockerSummary = {
  primary: OperatorBlocker | null;
  additional: OperatorBlocker[];
  all: OperatorBlocker[];
  tradingActive: boolean;
  updatedAt: string | null;
};

function dataFreshnessLabel(freshness: string | null | undefined): string {
  if (freshness === "fresh") return "Current";
  if (freshness === "stale") return "Stale";
  if (freshness === "after_hours") return "After hours";
  if (freshness === "unavailable") return "Unavailable";
  return "Unknown";
}

export function marketDataStatusLabel(
  freshness: string | null | undefined,
): "Current" | "Stale" | "Unavailable" | "After hours" | "Unknown" {
  if (freshness === "fresh") return "Current";
  if (freshness === "stale") return "Stale";
  if (freshness === "after_hours") return "After hours";
  if (freshness === "unavailable") return "Unavailable";
  return "Unknown";
}

export function formatRemainingToGoal(remaining: number): string {
  if (remaining <= 0) return "Daily goal reached";
  if (remaining === 1) return "1 remaining to daily goal";
  return `${remaining} remaining to daily goal`;
}

export function buildOperatorBlockers(
  input: OperatorBlockerInput,
): OperatorBlockerSummary {
  const items: OperatorBlocker[] = [];
  const push = (b: OperatorBlocker) => {
    if (!items.some((x) => x.id === b.id)) items.push(b);
  };

  if (input.status.panicStop) {
    push({
      id: "emergency_stop",
      label: "Emergency Stop is active",
      explanation:
        "New activity is blocked. Open positions stay open until you close them separately.",
      needsOperatorAction: true,
      severity: "critical",
    });
  }
  if (input.status.killSwitch) {
    push({
      id: "kill_switch",
      label: "Kill switch is on",
      explanation:
        "Clear the kill switch, then resume scanning. Execution and Auto Trading stay off until you enable them.",
      needsOperatorAction: true,
      severity: "critical",
    });
  }
  if (!input.status.executionEnabled) {
    push({
      id: "execution_off",
      label: "Paper execution is turned off",
      explanation:
        "Paper orders cannot be submitted until you turn paper execution on.",
      needsOperatorAction: true,
      severity: "warn",
    });
  }
  if (!input.status.envEnabled) {
    push({
      id: "auto_off",
      label: "Auto Trading is turned off",
      explanation:
        "Scanning may continue, but the system will not submit automatic paper entries.",
      needsOperatorAction: true,
      severity: "warn",
    });
  }
  if (input.status.runtimeDisabled) {
    push({
      id: "paused",
      label: "New entries are paused",
      explanation: "Resume new entries when you want scanning proposals to continue.",
      needsOperatorAction: true,
      severity: "warn",
    });
  }
  if (input.marketOpen === false) {
    push({
      id: "market_closed",
      label: "The market is closed",
      explanation:
        "Scanning may continue, but no entries can be submitted while the market is closed.",
      needsOperatorAction: false,
      severity: "info",
    });
  }
  if (input.openingDelayActive) {
    push({
      id: "opening_delay",
      label: "Opening delay is active",
      explanation: "Entries wait until the opening delay window ends.",
      needsOperatorAction: false,
      severity: "info",
    });
  }
  if (input.eodEntryCutoffActive) {
    push({
      id: "eod_cutoff",
      label: "End-of-day entry cutoff",
      explanation: "New entries are blocked near market close.",
      needsOperatorAction: false,
      severity: "info",
    });
  }
  if (!input.alpacaConnected) {
    push({
      id: "alpaca_disconnected",
      label: "Alpaca is disconnected",
      explanation: "Paper account data is unavailable. New entries are blocked.",
      needsOperatorAction: true,
      severity: "critical",
    });
  }
  if (input.dataFreshness === "stale" || input.dataFreshness === "unavailable") {
    push({
      id: "data_stale",
      label: `Market data is ${dataFreshnessLabel(input.dataFreshness).toLowerCase()}`,
      explanation: "Market data is stale, so new entries are blocked.",
      needsOperatorAction: true,
      severity: "critical",
    });
  }
  if (!input.reconciliationComplete) {
    push({
      id: "reconciliation",
      label: "Reconciliation required",
      explanation:
        "Broker state is not fully reconciled. New entries stay blocked until reconciliation finishes.",
      needsOperatorAction: true,
      severity: "critical",
    });
  }
  if (input.hasManualIntervention) {
    push({
      id: "manual_intervention",
      label: "Manual attention required",
      explanation:
        "A Version 1 trade needs operator review before new activity continues safely.",
      needsOperatorAction: true,
      severity: "critical",
    });
  }
  if (input.hasLegacyConflict) {
    push({
      id: "legacy_conflict",
      label: "Legacy position conflict",
      explanation:
        "Legacy AAPL short blocks new AAPL entries. Version 1 will not manage or close it.",
      needsOperatorAction: true,
      severity: "warn",
    });
  }
  if ((input.eligibleCount ?? 0) === 0) {
    push({
      id: "no_eligible",
      label: "No eligible symbols",
      explanation:
        "No watchlist symbol currently passes Version 1 eligibility filters.",
      needsOperatorAction: true,
      severity: "warn",
    });
  }
  if (
    input.hasQualifiedBuy === false &&
    input.status.executionEnabled &&
    input.status.envEnabled &&
    input.marketOpen !== false
  ) {
    push({
      id: "no_setup",
      label: "No qualified setup",
      explanation: "No symbol currently meets the Version 1 strategy rules.",
      needsOperatorAction: false,
      severity: "info",
    });
  }
  if (input.status.dailyTradesUsed >= input.status.maxDailyTrades) {
    push({
      id: "max_trades",
      label: "Maximum trades reached",
      explanation: `The hard entry-submission cap is reached (${input.status.dailyTradesUsed} of ${input.status.maxDailyTrades}).`,
      needsOperatorAction: false,
      severity: "warn",
    });
  }
  if ((input.status.activeCooldowns?.length ?? 0) > 0) {
    push({
      id: "cooldown",
      label: "Cooldown active",
      explanation: "A recent trade cooldown is preventing a new entry on at least one symbol.",
      needsOperatorAction: false,
      severity: "info",
    });
  }
  if (input.dailyLossLimitHit) {
    push({
      id: "daily_loss",
      label: "Daily loss limit",
      explanation: "The daily loss limit is reached, so new entries are blocked.",
      needsOperatorAction: false,
      severity: "critical",
    });
  }
  if (input.consecutiveLossPause) {
    push({
      id: "consecutive_loss",
      label: "Consecutive-loss pause",
      explanation: "Trading paused after repeated losses.",
      needsOperatorAction: false,
      severity: "warn",
    });
  }
  if (input.maxOpenPositionsReached) {
    push({
      id: "max_open",
      label: "Maximum open positions",
      explanation: "No new entries until an open position is closed.",
      needsOperatorAction: false,
      severity: "warn",
    });
  }
  if (input.spreadTooWide) {
    push({
      id: "spread",
      label: "Spread too wide",
      explanation: "Current spreads are too wide for Version 1 entries.",
      needsOperatorAction: false,
      severity: "warn",
    });
  }
  if (input.liquidityTooLow) {
    push({
      id: "liquidity",
      label: "Liquidity too low",
      explanation: "Liquidity is below Version 1 requirements.",
      needsOperatorAction: false,
      severity: "warn",
    });
  }
  if (input.volatilityUnsafe) {
    push({
      id: "volatility",
      label: "Volatility unsafe",
      explanation: "Volatility is outside the Version 1 safety range.",
      needsOperatorAction: false,
      severity: "warn",
    });
  }
  if (input.pendingOrderConflict) {
    push({
      id: "pending_conflict",
      label: "Pending order conflict",
      explanation: "An existing pending order blocks a new entry.",
      needsOperatorAction: true,
      severity: "warn",
    });
  }

  const tradingActive = Boolean(
    input.status.effectivelyEnabled &&
      input.status.executionEnabled &&
      input.status.envEnabled &&
      !input.status.panicStop &&
      !input.status.killSwitch,
  );

  const primary = items[0] ?? null;
  return {
    primary,
    additional: items.slice(1),
    all: items,
    tradingActive,
    updatedAt: input.updatedAt ?? null,
  };
}

/** Map internal universe rejection text to short operator wording when needed. */
export function friendlyUniverseReason(reason: string | null | undefined): string {
  if (!reason) return "Did not meet Version 1 filters";
  const r = reason.toLowerCase();
  if (r.includes("price") && (r.includes("above") || r.includes("max"))) {
    return "Price is above the Version 1 range";
  }
  if (r.includes("price") && (r.includes("below") || r.includes("min"))) {
    return "Price is below the Version 1 range";
  }
  if (r.includes("volume") || r.includes("liquidity") || r.includes("adv")) {
    return "Trading volume is too low";
  }
  if (r.includes("spread")) return "Spread is too wide";
  if (r.includes("quote") && r.includes("unavailable")) {
    return "Current quote is unavailable";
  }
  if (r.includes("stale")) return "Market data is stale";
  if (r.includes("not tradable") || r.includes("tradable")) {
    return "Asset is not tradable";
  }
  if (r.includes("fractional")) return "Fractional trading is unavailable";
  return reason;
}

export function protectionStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
    case "protected":
      return "Protected";
    case "pending":
    case "pending_protection":
      return "Protection Pending";
    case "missing":
    case "unprotected":
      return "Missing Protection";
    case "manual":
    case "manual_attention":
      return "Manual Attention Required";
    default:
      if (!status) return "Unknown";
      if (status.toLowerCase().includes("manual")) {
        return "Manual Attention Required";
      }
      if (status.toLowerCase().includes("pending")) {
        return "Protection Pending";
      }
      if (status.toLowerCase().includes("missing") || status.toLowerCase().includes("none")) {
        return "Missing Protection";
      }
      return status.replace(/_/g, " ");
  }
}
